import type { Rng } from '../rng'
import { COSTS, ERAS, PLOT, POLICY, SETTLEMENT_NAMES } from './config'
import {
  blockIndex,
  blockCoords,
  gridSize,
  housingCapacityOf,
  isFertile,
  neighbors4,
  rebuildBlockBuildings,
} from './blocks'
import { canBuildRoad, connectionRoute, edgeBetween, hasRoadAccess, isBridge, readRoad, roadConnected, writeRoad } from './roads'
import { dailyFoodNeed, eraGateMet, eraRequirements, populationOf, powerDemand, recomputeCoverage, recomputeLandValue, recomputeLogistics, recomputePollution, recomputeStats, settleMigration } from './economy'
import type { Block, CivicKind, Construction, Ledger, PlotState, Zone } from './types'
import { MOUNTAIN } from '../world'
import { developmentDemand, plannedHousingOf } from './development'

type Cost = { wood: number; stone: number; steel?: number }

function canAfford(ledger: Ledger, cost: Cost, floor = true): boolean {
  const woodFloor = floor ? PLOT.materialFloor.wood : 0
  const stoneFloor = floor ? PLOT.materialFloor.stone : 0
  return (
    ledger.wood - cost.wood >= woodFloor &&
    ledger.stone - cost.stone >= stoneFloor &&
    ledger.steel - (cost.steel ?? 0) >= 0
  )
}

function pay(ledger: Ledger, cost: Cost): void {
  ledger.wood = Math.max(0, ledger.wood - cost.wood)
  ledger.stone = Math.max(0, ledger.stone - cost.stone)
  ledger.steel = Math.max(0, ledger.steel - (cost.steel ?? 0))
}

function startConstruction(block: Block, kind: string, days: number): void {
  const c: Construction = { kind, days, progress: 0 }
  block.construction = c
}

/** 定居点评分：淡水、林地、可耕平地、矿脉、地形优势 */
export function siteScore(state: PlotState, index: number): number {
  const b = state.blocks[index]
  if (b.settlement >= 0 || b.zone !== 'none' || b.construction) return -1
  if (!b.buildable) return -1
  if (b.terrain === MOUNTAIN) return -1
  const bg = gridSize(state.world)
  const { bx, by } = blockCoords(index, bg)
  let forest = 0
  let ore = 0
  let fertile = 0
  for (const nb of neighbors4(bg, index)) {
    const o = state.blocks[nb]
    if (o.hasForest) forest++
    if (o.hasOre) ore++
    if (isFertile(o)) fertile++
  }
  if (b.hasForest) forest += 2
  if (b.hasOre) ore += 2
  if (isFertile(b)) fertile += 2
  const distanceToCenter = Math.hypot(bx - bg / 2, by - bg / 2) / (bg / 2)
  const occupied = state.settlements.some((s) => {
    const c = blockCoords(s.center, bg)
    return Math.max(Math.abs(c.bx - bx), Math.abs(c.by - by)) < 6
  })
  if (occupied) return -1
  const score =
    0.28 * Math.min(1, forest / 4) +
    0.2 * Math.min(1, fertile / 4) +
    0.2 * Math.min(1, ore / 3) +
    0.22 * (b.hasWater ? 1 : 0) +
    0.1 * (1 - Math.min(1, distanceToCenter))
  return score
}

function claim(state: PlotState, settlementId: number, index: number): void {
  const b = state.blocks[index]
  if (b.settlement >= 0) return
  b.settlement = settlementId
  const s = state.settlements.find((x) => x.id === settlementId)
  s?.blocks.push(index)
}

/** 建立第一个聚落：中心广场 + 四面道路 */
export function foundFirstSettlement(state: PlotState, rng: Rng): number {
  const best = pickSite(state)
  const bg = gridSize(state.world)
  const { bx, by } = blockCoords(best, bg)
  const settlement = {
    id: 0,
    name: SETTLEMENT_NAMES[0],
    center: best,
    foundedTick: state.tick,
    blocks: [] as number[],
    population: 0,
    jobs: 0,
    housing: 0,
    links: [] as number[],
  }
  state.settlements.push(settlement)
  state.nextSettlementId = 1
  claim(state, 0, best)
  const center = state.blocks[best]
  center.zone = 'civic'
  center.civic = 'plaza'
  center.density = 1
  rebuildBlockBuildings(center, rng)
  // 四面道路：让中心直接具备临路条件
  const edges: Array<['v' | 'h', number, number]> = []
  if (bx > 0) edges.push(['v', bx, by])
  if (bx < bg - 1) edges.push(['v', bx + 1, by])
  if (by > 0) edges.push(['h', bx, by])
  if (by < bg - 1) edges.push(['h', bx, by + 1])
  for (const [dir, ex, ey] of edges) {
    if (!canBuildRoad(state, dir, ex, ey)) continue
    const bridge = isBridge(state, dir, ex, ey)
    pay(state.ledger, bridge ? COSTS.bridge : COSTS.road)
    writeRoad(state, dir, ex, ey, 1)
  }
  return best
}

function pickSite(state: PlotState): number {
  let best = -1
  let bestScore = -1
  for (const b of state.blocks) {
    const index = b.by * gridSize(state.world) + b.bx
    const score = siteScore(state, index)
    if (score > bestScore) {
      bestScore = score
      best = index
    }
  }
  return best < 0 ? state.blocks.length / 2 : best
}

function settlementCenter(state: PlotState, id: number): { bx: number; by: number } | null {
  if (id < 0) return null
  const s = state.settlements.find((x) => x.id === id)
  if (!s) return null
  return blockCoords(s.center, gridSize(state.world))
}

/** 到所属聚落中心的距离（0–1，全部聚落共用一套判定） */
function distanceToOwnCenter(state: PlotState, b: Block): number {
  const center = settlementCenter(state, b.settlement)
  if (!center) return 0.5
  const d = Math.max(Math.abs(center.bx - b.bx), Math.abs(center.by - b.by))
  return Math.min(1, d / 10)
}

function roadUsefulness(state: PlotState, index: number, settlementId: number): number {
  const bg = gridSize(state.world)
  const b = state.blocks[index]
  const { bx, by } = blockCoords(index, bg)
  const distanceToCenter = distanceToOwnCenter(state, b)
  const claimedNeighbors = neighbors4(bg, index).filter((nb) => state.blocks[nb].settlement >= 0).length
  const resource = b.hasForest || b.hasOre ? 1 : 0
  const farm = isFertile(b) ? 1 : 0
  const roadNearby = readRoad(state, 'v', bx, by) > 0 || readRoad(state, 'h', bx, by) > 0 ? 0.2 : 0
  // 已有聚落之间还没有连通时，优先朝最近的其它聚落伸路（都市带的前身）
  const neighborSettlement = state.settlements.find((s) => s.id !== settlementId && s.links.length === 0)
  let towardNeighbor = 0
  if (neighborSettlement) {
    const c = blockCoords(neighborSettlement.center, bg)
    const d = Math.max(Math.abs(c.bx - bx), Math.abs(c.by - by))
    towardNeighbor = Math.max(0, 1 - d / 14) * (1 - distanceToCenter)
  }
  return (
    0.28 * resource +
    0.2 * (b.hasWater ? 1 : 0) +
    0.18 * farm +
    0.14 * (1 - distanceToCenter) +
    0.1 * Math.min(1, claimedNeighbors / 2) +
    0.12 * towardNeighbor +
    roadNearby
  )
}

/** 修建避开山地的跨水桥：仅在绕行代价明显更高时使用 */
function connectBlock(state: PlotState, settlementId: number, target: number): boolean {
  const bg = gridSize(state.world)
  const { bx, by } = blockCoords(target, bg)
  const options: Array<{ dir: 'v' | 'h'; ex: number; ey: number; cost: number; bridge: boolean }> = []
  if (bx > 0 && state.blocks[target - 1].settlement === settlementId) {
    options.push({ dir: 'v', ex: bx, ey: by, cost: 0, bridge: false })
  }
  if (bx < bg - 1 && state.blocks[target + 1].settlement === settlementId) {
    options.push({ dir: 'v', ex: bx + 1, ey: by, cost: 0, bridge: false })
  }
  if (by > 0 && state.blocks[target - bg].settlement === settlementId) {
    options.push({ dir: 'h', ex: bx, ey: by, cost: 0, bridge: false })
  }
  if (by < bg - 1 && state.blocks[target + bg].settlement === settlementId) {
    options.push({ dir: 'h', ex: bx, ey: by + 1, cost: 0, bridge: false })
  }
  for (const option of options) {
    if (!canBuildRoad(state, option.dir, option.ex, option.ey)) continue
    const existing = readRoad(state, option.dir, option.ex, option.ey)
    const bridge = isBridge(state, option.dir, option.ex, option.ey)
    if (existing === 0) {
      const cost = bridge ? COSTS.bridge : COSTS.road
      if (!canAfford(state.ledger, cost)) continue
      pay(state.ledger, cost)
    }
    const level = bridge ? 2 : 1
    writeRoad(state, option.dir, option.ex, option.ey, Math.max(existing, level))
    claim(state, settlementId, target)
    return true
  }
  return false
}

/** 路网生长：从已归属区块向四周扩展（资源优先、连成片、受材料限制） */
export function growRoads(state: PlotState): number {
  const bg = gridSize(state.world)
  const policy = POLICY[state.policy]
  let built = 0
  for (const settlement of state.settlements) {
    // 只在“可用于住宅的临路空地不足”时继续开路，避免路网无意义地铺满地图
    let freeLand = 0
    for (const index of settlement.blocks) {
      const b = state.blocks[index]
      if (b.zone !== 'none' || b.construction || !b.buildable) continue
      if (!hasRoadAccess(state, index)) continue
      if (hasBuiltIndustryNeighbour(state, index, gridSize(state.world))) continue
      freeLand++
    }
    const needsTrunkRoads = state.era === 1 && state.stats.roadEdges < 60
    if (!needsTrunkRoads && freeLand >= Math.min(40, Math.max(PLOT.freeLandTarget, Math.ceil(settlement.population / PLOT.freeLandResidentsPerBlock)))) continue
    const budget = Math.max(1, Math.round(PLOT.roadsPerCycle * policy.road))
    const candidates = new Map<number, number>()
    for (const index of settlement.blocks) {
      for (const nb of neighbors4(bg, index)) {
        const b = state.blocks[nb]
        if (b.settlement >= 0 || !b.buildable || b.terrain === MOUNTAIN) continue
        candidates.set(nb, roadUsefulness(state, nb, settlement.id))
      }
    }
    const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1])
    let placed = 0
    for (const [index] of ranked) {
      if (placed >= budget) break
      if (connectBlock(state, settlement.id, index)) {
        placed++
        built++
      }
    }
  }
  return built
}

/** 需求 → 选址 → 划区（住宅/农业/工业/公园），并启动首建施工 */
export function assignZones(state: PlotState, rng: Rng): number {
  const bg = gridSize(state.world)
  const policy = POLICY[state.policy]
  const ledger = state.ledger
  const pop = populationOf(state)
  const building = state.blocks.filter((b) => b.construction !== null).length
  const budget = Math.max(1, Math.round((PLOT.zonesPerCycle * policy.zone) / (1 + building * 0.15)))

  type Candidate = { index: number; zone: Zone; score: number }
  const list: Candidate[] = []
  for (const b of state.blocks) {
    if (b.settlement < 0 || b.zone !== 'none' || !b.buildable) continue
    if (b.construction) continue
    const index = b.by * bg + b.bx
    const roadAccess = hasRoadAccess(state, index)
    const distance = distanceToOwnCenter(state, b)
    const industryNeighbours = neighbors4(bg, index).filter(
      (nb) => state.blocks[nb].zone === 'industry' && state.blocks[nb].density > 0,
    ).length
    const housingNeighbours = neighbors4(bg, index).filter(
      (nb) => state.blocks[nb].zone === 'residential' && state.blocks[nb].density > 0,
    ).length
    const oreNeighbours = neighbors4(bg, index).filter((nb) => state.blocks[nb].hasOre).length

    if (roadAccess && !hasBuiltIndustryNeighbour(state, index, bg)) {
      const score =
        0.34 * (1 - Math.min(1, b.pollution)) +
        0.26 * b.landValue +
        0.2 * (1 - Math.min(1, distance)) +
        0.12 * Math.min(1, housingNeighbours / 3) +
        0.08 * (state.stats.marketCoveredRatio > 0.6 ? b.covered.market : 0.5)
      list.push({ index, zone: 'residential', score })
    }
    if (!b.hasOre && (b.hasWater || isFertile(b) || b.hasForest)) {
      const score =
        0.4 * (b.hasWater ? 1 : 0) +
        0.26 * (isFertile(b) ? 1 : 0) +
        0.2 * Math.min(1, distance) +
        0.14 * (b.terrain === MOUNTAIN ? 0 : 1)
      list.push({ index, zone: 'agriculture', score })
    }
    if (state.era >= 1 && roadAccess && industryNeighbours === 0) {
      const hasResidentialNeighbour = neighbors8HasResidential(state, index, bg)
      if (!hasResidentialNeighbour) {
        const score =
          0.4 * Math.min(1, oreNeighbours / 2) +
          0.3 * (1 - b.landValue) +
          0.2 * Math.min(1, distance) +
          0.1 * (b.hasForest ? 1 : 0)
        list.push({ index, zone: 'industry', score })
      }
    }
    if (state.era >= 2 && roadAccess && housingNeighbours >= 2) {
      const score = 0.5 * (1 - b.landValue) + 0.3 * Math.min(1, housingNeighbours / 4) + 0.2 * b.covered.park
      list.push({ index, zone: 'park', score })
    }
  }

  let assigned = 0
  while (assigned < budget) {
    const demand = developmentDemand(state)
    const industries = state.blocks.filter((b) => b.zone === 'industry')
    const weight = (c: Candidate): number => {
      const block = state.blocks[c.index]
      const local = demand.local.get(block.settlement)
      if (block.zone !== 'none' || block.construction || !canAfford(ledger, COSTS.zone[c.zone])) return 0
      if (c.zone === 'residential') {
        if (hasBuiltIndustryNeighbour(state, c.index, bg)) return 0
        if (block.settlement > 0 && local && local.homes < 2) return 200
        return demand.housingGap > 0 ? 10 + demand.housingGap / 30 : 0
      }
      if (c.zone === 'agriculture') {
        if (block.settlement > 0 && local && local.farms < 1) return 180
        if (demand.farms < 6) return 8 + (6 - demand.farms) * 2
        return demand.foodGap > 0 ? 12 + demand.foodGap / PLOT.farm.food : 0
      }
      if (c.zone === 'industry') {
        if (neighbors8HasResidential(state, c.index, bg)) return 0
        if (industries.length >= Math.max(2, Math.ceil(pop / 150))) return 0
        return industries.length < state.settlements.length || demand.jobsGap > 0 ? 8 + demand.jobsGap / 8 : 0
      }
      return demand.parkGap > 0 ? 2 * policy.park : 0
    }
    let candidate: Candidate | undefined
    let best = 0
    for (const c of list) {
      const score = c.score * weight(c)
      if (score > best) { best = score; candidate = c }
    }
    if (!candidate) break
    const block = state.blocks[candidate.index]
    const cost = COSTS.zone[candidate.zone]
    pay(ledger, cost)
    block.zone = candidate.zone
    if (candidate.zone === 'industry') {
      block.industry = block.hasOre && rng.next() < 0.5 ? 'quarry' : 'factory'
    }
    startConstruction(
      block,
      candidate.zone === 'industry' ? `industry:${block.industry}` : `zone:${candidate.zone}`,
      PLOT.days.zone,
    )
    assigned++
  }
  return assigned
}

function neighbours8(state: PlotState, index: number, bg: number): number[] {
  const { bx, by } = blockCoords(index, bg)
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const x = bx + dx
      const y = by + dy
      if (x < 0 || y < 0 || x >= bg || y >= bg) continue
      out.push(state.blocks[blockIndex(x, y, bg)].by * bg + state.blocks[blockIndex(x, y, bg)].bx)
    }
  }
  return out
}

function neighbors8HasResidential(state: PlotState, index: number, bg: number): boolean {
  for (const nb of neighbours8(state, index, bg)) {
    if (state.blocks[nb].zone === 'residential') return true
  }
  return false
}

/** 住宅不得与工业相邻（含在建）：工业/住宅隔离不变量 INV4 */
function hasBuiltIndustryNeighbour(state: PlotState, index: number, bg: number): boolean {
  for (const nb of neighbours8(state, index, bg)) {
    if (state.blocks[nb].zone === 'industry') return true
  }
  return false
}

/** 公共服务：按覆盖缺口与需求决定建什么、建在哪 */
export function planServices(state: PlotState, rng: Rng): number {
  const bg = gridSize(state.world)
  const ledger = state.ledger
  const policy = POLICY[state.policy]
  const pop = populationOf(state)
  const need = Math.max(1, dailyFoodNeed(state))
  const wants: Array<{ kind: CivicKind; priority: number }> = []
  const count = (kind: CivicKind): number =>
    state.blocks.filter((b) => b.density > 0 && (b.zone === 'civic' && b.civic === kind || kind === 'park' && b.zone === 'park')).length
  const pending = (kind: CivicKind): number =>
    state.blocks.filter((b) => b.construction?.kind === `civic:${kind}` || kind === 'park' && b.zone === 'park' && b.construction !== null).length

  if (count('granary') + pending('granary') < 1 + Math.floor(pop / 400) && ledger.storageCapacity < need * 30) {
    wants.push({ kind: 'granary', priority: 95 })
  }
  if (state.era >= 1 && count('market') + pending('market') < 1 + Math.floor(pop / 400)) {
    wants.push({ kind: 'market', priority: 92 })
  }
  if (count('workshop') + pending('workshop') < 1 + Math.floor(pop / 500)) {
    wants.push({ kind: 'workshop', priority: 78 })
  }
  const needKnowledge = state.era < 4 && eraRequirements(state).some((r) => r.label === '知识' && !r.met)
  if (count('school') + pending('school') < 1 + Math.floor(pop / 800)) {
    // 时代门槛需要知识时，规划器优先建学校（规划器朝门槛努力）
    wants.push({ kind: 'school', priority: needKnowledge ? 97 : 70 * policy.school })
  }
  const waterCovered =
    state.blocks.filter((b) => b.zone === 'residential' && b.covered.water >= PLOT.coveredLine).length /
    Math.max(1, state.stats.residentialBlocks)
  if (state.stats.residentialBlocks > 3 && waterCovered < 0.6 && count('waterworks') + pending('waterworks') < 1 + Math.floor(pop / 500)) {
    wants.push({ kind: 'waterworks', priority: 80 })
  }
  if (state.era >= 2 && count('clinic') + pending('clinic') < Math.ceil((1 + Math.floor(pop / 1200)) * (state.policy === 'livable' ? 1.3 : 1))) {
    wants.push({ kind: 'clinic', priority: 66 * (state.policy === 'livable' ? policy.park : 1) })
  }
  if (state.era >= 2 && count('powerplant') + pending('powerplant') < Math.ceil(powerDemand(state) / 16) && state.stats.powerCoverage < 0.92) {
    wants.push({ kind: 'powerplant', priority: 88 })
  }
  if (state.era >= 1 && count('park') + pending('park') < Math.ceil((1 + Math.floor(pop / 300)) * policy.park)) {
    wants.push({ kind: 'park', priority: 55 * policy.park })
  }
  if (wants.length === 0) return 0

  wants.sort((a, b) => b.priority - a.priority)
  let built = 0
  const budget = Math.max(1, Math.round(PLOT.servicesPerCycle))
  for (const want of wants) {
    if (built >= budget) break
    const cost = COSTS.civic[want.kind]
    if (!canAfford(ledger, cost)) continue
    const emptyCivic = state.blocks.find((b) => b.zone === 'civic' && b.civic === null && !b.construction && b.settlement >= 0)
    let target = emptyCivic
    if (!target) {
      const candidates = state.blocks.filter((b) => {
        if (b.settlement < 0 || b.zone !== 'none' || !b.buildable || b.construction) return false
        const index = b.by * bg + b.bx
        return hasRoadAccess(state, index)
      })
      if (candidates.length === 0) continue
      const scoreOf = (b: Block): number => {
        if (want.kind === 'powerplant' || want.kind === 'waterworks') {
          // 电站远离住宅；水厂优先靠水
          const penalty = neighbors4(bg, b.by * bg + b.bx).filter((nb) => state.blocks[nb].zone === 'residential').length
          return (want.kind === 'waterworks' && b.hasWater ? 0.6 : 0) - penalty * 0.3 + (want.kind === 'powerplant' ? 1 - b.landValue : 0)
        }
        if (want.kind === 'market' || want.kind === 'school' || want.kind === 'clinic' || want.kind === 'park') {
          const kind = want.kind
          const radius = PLOT.radius[kind]
          return state.blocks.reduce((score, home) => {
            if (home.zone !== 'residential') return score
            const distance = Math.max(Math.abs(home.bx - b.bx), Math.abs(home.by - b.by))
            if (distance > radius) return score
            const gain = Math.max(0, Math.min(1 - home.covered[kind], 1 - PLOT.coverageFalloff * distance / radius))
            return score + gain * Math.max(1, home.population, plannedHousingOf(home) * 0.25)
          }, 0)
        }
        const busy = neighbors4(bg, b.by * bg + b.bx).filter((nb) => state.blocks[nb].zone === 'residential').length
        return busy / 4 + (b.landValue > 0 ? 0.3 : 0)
      }
      candidates.sort((a, b) => scoreOf(b) - scoreOf(a))
      target = candidates[0]
      target.zone = 'civic'
    }
    pay(ledger, cost)
    startConstruction(target, `civic:${want.kind}`, PLOT.days.civic)
    void rng
    built++
  }
  return built
}

/** 升级：住宅只看本地地价与入住率；农业/工业在材料富余时扩产 */
export function planUpgrades(state: PlotState): number {
  const ledger = state.ledger
  const need = Math.max(1, dailyFoodNeed(state))
  const foodDays = ledger.food / need
  let started = 0
  const budget = Math.max(1, Math.round(PLOT.upgradesPerCycle * POLICY[state.policy].upgrade))
  for (const b of state.blocks) {
    if (started >= budget) break
    if (b.construction || b.density <= 0 || b.density >= Math.min(4, state.era + 1)) continue
    const next = b.density + 1
    if (b.zone === 'residential') {
      const futureHousing = state.blocks.reduce((n, row) => n + plannedHousingOf(row), 0)
      const occupancy = futureHousing > 0 ? populationOf(state) / futureHousing : 0
      if (b.landValue < PLOT.upgradeLandValue[next]) continue
      if (occupancy < PLOT.upgradeOccupancy) continue
    } else if (b.zone === 'agriculture') {
      if (foodDays > 60) continue
    } else if (b.zone === 'industry') {
      if (b.staffed < b.jobs * 0.9) continue
    } else continue
    const cost = { wood: COSTS.upgrade.wood * next, stone: COSTS.upgrade.stone * next, steel: next >= 3 ? 20 * next : 0 }
    if (!canAfford(ledger, cost)) continue
    pay(ledger, cost)
    startConstruction(b, 'upgrade', PLOT.days.upgrade)
    started++
  }
  return started
}

/** 施工推进（每日）：完成时把 zone/density/civic 落到账本 */
export function advanceConstruction(state: PlotState, rng: Rng): number {
  let done = 0
  for (const b of state.blocks) {
    const c = b.construction
    if (!c) continue
    c.progress += 1 / Math.max(0.1, c.days)
    if (c.progress < 1) continue
    if (c.kind === 'upgrade') {
      b.density = Math.min(4, b.density + 1)
    } else if (c.kind.startsWith('civic:')) {
      b.civic = c.kind.slice('civic:'.length) as CivicKind
      b.density = 1
    } else if (c.kind.startsWith('industry:')) {
      b.industry = c.kind.slice('industry:'.length) as 'factory' | 'quarry'
      b.density = 1
    } else if (c.kind.startsWith('zone:')) {
      b.density = 1
    }
    b.construction = null
    rebuildBlockBuildings(b, rng)
    done++
  }
  return done
}

/** 建立新聚落（人口达到阈值且有合适空位） */
export function tryFoundSettlement(state: PlotState, rng: Rng): number | null {
  if (state.settlements.length >= PLOT.maxSettlements) return null
  // 上一座新城还没长起来（至少 12 个地块）就不再开新的，避免地图上撒满空聚落
  const newest = state.settlements[state.settlements.length - 1]
  if (state.settlements.length > 1 && newest.blocks.length < 12) return null
  // 按聚落数递进：900 人开第一座新城、之后每多 900 人再开一座
  if (populationOf(state) < PLOT.newSettlementPopulation * state.settlements.length) return null
  if (!canAfford(state.ledger, { wood: COSTS.civic.plaza.wood + 8, stone: 32 })) return null
  let best = -1
  let bestScore: number = PLOT.newSettlementScore
  const bg = gridSize(state.world)
  for (const b of state.blocks) {
    const index = b.by * bg + b.bx
    const score = siteScore(state, index)
    if (score > bestScore) {
      bestScore = score
      best = index
    }
  }
  if (best < 0) return null
  pay(state.ledger, COSTS.civic.plaza)
  const id = state.nextSettlementId++
  const settlement = {
    id,
    name: SETTLEMENT_NAMES[id % SETTLEMENT_NAMES.length],
    center: best,
    foundedTick: state.tick,
    blocks: [] as number[],
    population: 0,
    jobs: 0,
    housing: 0,
    links: [] as number[],
  }
  state.settlements.push(settlement)
  claim(state, id, best)
  const center = state.blocks[best]
  center.zone = 'civic'
  center.civic = 'plaza'
  center.density = 1
  rebuildBlockBuildings(center, rng)
  // 新城中心本身也须临路，不能等下一轮规划才满足不变量。
  for (const nb of neighbors4(bg, best)) {
    if (state.blocks[nb].settlement < 0 && state.blocks[nb].buildable) connectBlock(state, id, nb)
  }
  return id
}

/** 聚落间路网连通（时代 3+ 才有实际意义，这里始终计算以便 UI 显示） */
export function updateSettlementLinks(state: PlotState): void {
  for (const a of state.settlements) {
    a.links = []
    for (const b of state.settlements) {
      if (a.id === b.id) continue
      if (roadConnected(state, a.center, b.center)) a.links.push(b.id)
    }
  }
}

export function connectSettlements(state: PlotState): number {
  if (state.settlements.length < 2) return 0
  const budget = Math.max(1, Math.round(2 * POLICY[state.policy].road))
  let built = 0
  for (const target of state.settlements.slice(1)) {
    const source = state.settlements[0]
    if (roadConnected(state, source.center, target.center)) continue
    const a = state.blocks[source.center]
    const b = state.blocks[target.center]
    const direct = Math.abs(a.bx - b.bx) + Math.abs(a.by - b.by)
    let route = connectionRoute(state, source.center, target.center, false)
    if (!route || route.length - 1 > direct * 3) route = connectionRoute(state, source.center, target.center, true)
    if (!route) continue
    for (let i = 1; i < route.length; i++) {
      const e = edgeBetween(state, route[i - 1], route[i])
      if (readRoad(state, e.dir, e.bx, e.by) > 0) continue
      if (built >= budget) return built
      const bridge = isBridge(state, e.dir, e.bx, e.by)
      const cost = bridge ? COSTS.bridge : COSTS.road
      if (!canAfford(state.ledger, cost)) return built
      pay(state.ledger, cost)
      writeRoad(state, e.dir, e.bx, e.by, bridge ? 2 : 1)
      built++
    }
  }
  return built
}

/** 聚落级统计（人口/岗位/住房按块汇总） */
export function updateSettlementTotals(state: PlotState): void {
  for (const s of state.settlements) {
    s.population = 0
    s.jobs = 0
    s.housing = 0
  }
  for (const b of state.blocks) {
    if (b.settlement < 0) continue
    const s = state.settlements.find((x) => x.id === b.settlement)
    if (!s) continue
    s.population += b.population
    s.jobs += b.jobs
    s.housing += housingCapacityOf(b)
  }
}

/** 规划器完整一轮：路网 → 划区 → 公共服务 → 升级 */
export function runPlannerCycle(state: PlotState, rng: Rng): void {
  recomputeStats(state)
  recomputePollution(state)
  growRoads(state)
  assignZones(state, rng)
  planServices(state, rng)
  recomputeCoverage(state)
  recomputeLandValue(state)
  recomputeLogistics(state)
  planUpgrades(state)
  // 人口足够且有合适空位时建立新聚落（多聚落文明）
  if (state.tick % (PLOT.planEveryDays * 6) === 0) {
    const founded = tryFoundSettlement(state, rng)
    if (founded !== null) {
      milestone(state, `settlement-${founded}`, `新的聚落沿着资源与水源建立（第 ${state.settlements.length} 个）`)
    }
  }
  connectSettlements(state)
  updateSettlementLinks(state)
  updateSettlementTotals(state)
  recomputePollution(state)
}

/** 每 30 日：迁入 → 重新规划 → 时代检查 */
export function runMonthCycle(state: PlotState, rng: Rng): void {
  settleMigration(state, rng)
  recomputeStats(state)
  if (eraGateMet(state)) {
    state.era += 1
    state.journal.unshift({
      tick: state.tick,
      kind: 'milestone',
      text: `进入「${ERAS[state.era]}」`,
    })
    if (state.journal.length > 60) state.journal.length = 60
  }
}

export function milestone(state: PlotState, key: string, text: string): void {
  if (state.milestones.includes(key)) return
  state.milestones.push(key)
  state.journal.unshift({ tick: state.tick, kind: 'milestone', text })
  if (state.journal.length > 60) state.journal.length = 60
}
