import type { Rng } from '../rng'
import { CIVIC_SPEC, INDUSTRY_SPEC, PLOT, POLICY, POWER } from './config'
import { gridSize, housingCapacityOf, neighbors4, neighbors8 } from './blocks'
import { bfsRoadDistances } from './roads'
import type { Block, Ledger, PlotState, PlotStats, Res } from './types'

export const RES_LABELS: Record<Res, string> = {
  food: '食物',
  wood: '木材',
  stone: '石头',
  steel: '钢材',
  electricity: '电力',
}

export function emptyLedger(): Ledger {
  const zero = (): Record<Res, number> => ({ food: 0, wood: 0, stone: 0, steel: 0, electricity: 0 })
  return {
    food: PLOT.founding.food,
    wood: PLOT.founding.wood,
    stone: PLOT.founding.stone,
    steel: 0,
    electricity: 0,
    production: zero(),
    consumption: zero(),
    storageCapacity: 1200,
    knowledge: 0,
    cumulativeSteel: 0,
    children: PLOT.founding.children,
    adults: PLOT.founding.adults,
    elderly: PLOT.founding.elderly,
    births: 0,
    deaths: 0,
    immigrants: 0,
    migrationPool: PLOT.migrationPool,
    oreReserve: PLOT.oreReserve,
  }
}

export function populationOf(state: PlotState): number {
  const l = state.ledger
  return l.children + l.adults + l.elderly
}

/** 把账本人口按“容量 × 地价吸引力”分摊到住宅地块（升级与覆盖判定读它） */
export function distributePopulation(state: PlotState): void {
  const l = state.ledger
  const pop = l.children + l.adults + l.elderly
  const rows = state.blocks.filter((b) => b.zone === 'residential' && b.density > 0)
  let totalWeight = 0
  for (const b of rows) {
    const weight = housingCapacityOf(b) * (0.5 + b.landValue)
    b.population = 0
    totalWeight += weight
    void b
  }
  if (totalWeight <= 0) return
  for (const b of rows) {
    const weight = housingCapacityOf(b) * (0.5 + b.landValue)
    b.population = (pop * weight) / totalWeight
  }
}

export function dailyFoodNeed(state: PlotState): number {
  const l = state.ledger
  return l.adults * PLOT.eat.adult + l.children * PLOT.eat.child + l.elderly * PLOT.eat.elder
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** 服务覆盖：市场/学校/诊所/公园按半径衰减；电力按供需；水按水厂与自然水体 */
export function recomputeCoverage(state: PlotState): void {
  const bg = gridSize(state.world)
  const types = ['market', 'school', 'clinic', 'park', 'waterworks'] as const
  const sources: Record<string, number[]> = { market: [], school: [], clinic: [], park: [], waterworks: [] }
  for (const b of state.blocks) {
    if (b.zone === 'civic' && b.civic && b.density > 0 && sources[b.civic]) sources[b.civic].push(b.by * bg + b.bx)
  }
  const radiusOf: Record<string, number> = {
    market: PLOT.radius.market,
    school: PLOT.radius.school,
    clinic: PLOT.radius.clinic,
    park: PLOT.radius.park,
    waterworks: PLOT.radius.waterworks,
  }
  for (const b of state.blocks) {
    const cur = b.covered
    for (const t of types) {
      const source = sources[t]
      let cov = 0
      if (source.length > 0) {
        const r = radiusOf[t]
        for (const s of source) {
          const sbx = s % bg
          const sby = Math.floor(s / bg)
          const d = Math.max(Math.abs(sbx - b.bx), Math.abs(sby - b.by))
          if (d <= r) cov += 1 - PLOT.coverageFalloff * (d / r)
        }
      }
      const key = t === 'waterworks' ? 'water' : t
      ;(cur as unknown as Record<string, number>)[key] = clamp01(cov)
    }
    if (b.hasWater) cur.water = Math.max(cur.water, 1)
  }
  // 电力：全局供需比
  const demand = powerDemand(state)
  const supply = powerSupply(state)
  const ratio = demand > 0 ? clamp01(supply / demand) : 1
  for (const b of state.blocks) b.covered.power = ratio
}

export function powerSupply(state: PlotState): number {
  let supply = 0
  for (const b of state.blocks) {
    if (b.zone === 'civic' && b.civic === 'powerplant' && b.density > 0) {
      supply += CIVIC_SPEC.powerplant.output?.electricity ?? 0
    }
  }
  return supply
}

export function powerDemand(state: PlotState): number {
  // 工业时代之前没有电力需求（否则早期会显示供电率 0）
  if (state.era < 2) return 0
  let demand = populationOf(state) * POWER.residentialPerPerson
  for (const b of state.blocks) {
    if (b.density <= 0) continue
    if (b.zone === 'industry' && b.industry === 'factory') demand += POWER.factory
    if (b.zone === 'industry' && b.industry === 'quarry') demand += POWER.quarry
    if (b.zone === 'civic' && b.civic === 'waterworks') demand += POWER.waterworks
    if (b.zone === 'civic' && b.civic === 'school') demand += POWER.school
    if (b.zone === 'civic' && b.civic === 'clinic') demand += POWER.clinic
  }
  return demand
}

/** 污染：工业块为源，按区块距离衰减 */
export function recomputePollution(state: PlotState): void {
  const bg = gridSize(state.world)
  const sources: Array<{ bx: number; by: number; strength: number }> = []
  for (const b of state.blocks) {
    if (b.zone === 'industry' && b.density > 0) {
      sources.push({ bx: b.bx, by: b.by, strength: b.industry === 'factory' ? 1 + 0.2 * (b.density - 1) : 0.7 })
    }
  }
  for (const b of state.blocks) {
    let total = 0
    for (const s of sources) {
      const d = Math.max(Math.abs(s.bx - b.bx), Math.abs(s.by - b.by))
      if (d === 0) total += s.strength
      else if (d === 1) total += s.strength * 0.5
      else if (d === 2) total += s.strength * 0.25
    }
    b.pollution = total
    void bg
  }
}

/** 地价：服务覆盖 + 水岸 − 污染 − 工业邻接 */
export function recomputeLandValue(state: PlotState): void {
  const bg = gridSize(state.world)
  for (const b of state.blocks) {
    const index = b.by * bg + b.bx
    let industryNeighbors = 0
    for (const nb of neighbors8(bg, index)) {
      const other = state.blocks[nb]
      if (other.zone === 'industry' && other.density > 0) industryNeighbors++
    }
    const pollutionPenalty = 0.1 * Math.min(1, b.pollution)
    const industryPenalty = 0.15 * Math.min(1, industryNeighbors / 2)
    const value =
      0.25 * b.covered.market +
      0.2 * b.covered.school +
      0.15 * b.covered.clinic +
      0.2 * b.covered.park +
      0.1 * (b.hasWater ? 1 : 0) +
      (0.13 - pollutionPenalty - industryPenalty)
    b.landValue = clamp01(value)
  }
}

/** 物流系数：从仓储/市场/广场沿路网 BFS，按跳数分档 */
export function recomputeLogistics(state: PlotState): void {
  const hubs: number[] = []
  for (const b of state.blocks) {
    if (b.zone === 'civic' && (b.civic === 'market' || b.civic === 'granary' || b.civic === 'plaza')) {
      hubs.push(b.by * gridSize(state.world) + b.bx)
    }
  }
  if (hubs.length === 0) {
    for (const b of state.blocks) b.logistics = PLOT.logisticsUnconnected
    return
  }
  const dist = bfsRoadDistances(state, hubs)
  for (const b of state.blocks) {
    const d = dist[b.by * gridSize(state.world) + b.bx]
    if (d < 0) {
      b.logistics = PLOT.logisticsUnconnected
      continue
    }
    let factor = PLOT.logisticsTiers[PLOT.logisticsTiers.length - 1].factor
    for (const tier of PLOT.logisticsTiers) {
      if (d <= tier.maxDistance) {
        factor = tier.factor
        break
      }
    }
    b.logistics = factor
  }
}

/** 可采集判定：已归属区块，或紧邻归属区块的外围林/矿（居民会走出城边伐木采矿） */
export function isGatherable(state: PlotState, b: Block): boolean {
  if (b.zone !== 'none') return false
  if (b.settlement >= 0) return true
  const bg = gridSize(state.world)
  const index = b.by * bg + b.bx
  for (const nb of neighbors4(bg, index)) if (state.blocks[nb].settlement >= 0) return true
  return false
}

/**
 * 采集决策（岗位与产出必须共用同一判定，否则会出现“派了采矿工却产出木材”的错位）：
 * 石料缺口优先开矿，其次木材缺口伐木；库存都够则没人去采集。
 */
export function gatherKind(state: PlotState, b: Block): 'ore' | 'forest' | null {
  if (b.zone !== 'none' || !isGatherable(state, b)) return null
  const stoneShort = state.ledger.stone < PLOT.stoneTarget
  const woodShort = state.ledger.wood < PLOT.woodTarget
  if (b.hasOre && stoneShort) return 'ore'
  if (b.hasForest && woodShort) return 'forest'
  return null
}

/** 岗位需求（每块） */
export function jobDemandOf(state: PlotState, b: Block): number {
  if (b.zone === 'residential') return b.density > 0 ? PLOT.residentialJobsPerLevel * b.density : 0
  if (b.zone === 'agriculture') return b.density > 0 ? 3 * b.density : 0
  if (b.zone === 'industry') {
    if (b.density <= 0 || !b.industry) return 0
    const spec = INDUSTRY_SPEC[b.industry]
    // 库存够用就不必继续满负荷生产（避免木石钢堆成山）
    if (b.industry === 'quarry' && state.ledger.stone > PLOT.stoneTarget * 3) return 0
    if (b.industry === 'factory' && state.ledger.steel > PLOT.steelTarget) return 0
    return spec.jobs * (1 + 0.2 * (b.density - 1))
  }
  if (b.zone === 'civic') return b.density > 0 && b.civic ? CIVIC_SPEC[b.civic].jobs : 0
  if (b.zone === 'park') return b.density > 0 ? 1 : 0
  const gather = gatherKind(state, b)
  if (gather === 'ore') return PLOT.gather.ore.jobs
  if (gather === 'forest') return PLOT.gather.forest.jobs
  return 0
}

function priorityOf(state: PlotState, b: Block): number {
  const p = POLICY[state.policy]
  const l = state.ledger
  const woodShort = l.wood < PLOT.woodTarget
  const stoneShort = l.stone < PLOT.stoneTarget
  if (b.zone === 'agriculture') return 100 * p.farm
  if (b.zone === 'none' && b.hasOre) return stoneShort ? 94 : 20
  if (b.zone === 'none' && b.hasForest) return woodShort ? 90 : 18
  if (b.zone === 'civic' && b.civic === 'powerplant') return 86
  if (b.zone === 'industry' && b.industry === 'quarry') return stoneShort ? 85 : 40
  if (b.zone === 'industry') return 80
  if (b.zone === 'civic' && b.civic === 'school') return 74 * p.school
  if (b.zone === 'civic' && b.civic === 'market') return 70
  if (b.zone === 'civic' && b.civic === 'waterworks') return 66
  if (b.zone === 'civic' && b.civic === 'clinic') return 64
  if (b.zone === 'civic' && b.civic === 'granary') return 60
  if (b.zone === 'civic' && b.civic === 'plaza') return 50
  if (b.zone === 'park') return 40 * p.park
  return 10
}

/** 每日结算：岗位分配 → 产出 → 消耗 → 人口动态 */
export function settleDay(state: PlotState, rng: Rng): void {
  const l = state.ledger
  const bg = gridSize(state.world)
  const workers = l.adults
  const order = [...state.blocks].sort((a, b) => priorityOf(state, b) - priorityOf(state, a))
  let remaining = workers
  let totalJobs = 0
  for (const b of order) {
    const demand = jobDemandOf(state, b)
    b.jobs = demand
    const staffed = Math.min(demand, Math.max(0, remaining))
    b.staffed = staffed
    remaining -= staffed
    totalJobs += demand
  }
  void totalJobs
  void bg

  // 电力：电站产出（受木石限制）
  let electricity = 0
  for (const b of state.blocks) {
    if (b.zone === 'civic' && b.civic === 'powerplant' && b.density > 0 && b.jobs > 0) {
      const ratio = b.staffed / b.jobs
      const woodNeed = (CIVIC_SPEC.powerplant.input?.wood ?? 0) * ratio
      const stoneNeed = (CIVIC_SPEC.powerplant.input?.stone ?? 0) * ratio
      const fuel = Math.min(1, woodNeed > 0 ? l.wood / woodNeed : 1, stoneNeed > 0 ? l.stone / stoneNeed : 1)
      l.wood = Math.max(0, l.wood - woodNeed * fuel)
      l.stone = Math.max(0, l.stone - stoneNeed * fuel)
      l.consumption.wood += woodNeed * fuel
      l.consumption.stone += stoneNeed * fuel
      electricity += (CIVIC_SPEC.powerplant.output?.electricity ?? 0) * ratio * fuel
    }
  }
  l.electricity = electricity
  const demand = powerDemand(state)
  const powerRatio = demand > 0 ? Math.min(1, electricity / demand) : 1
  for (const b of state.blocks) b.covered.power = powerRatio

  // 工厂：受电力与木石限制
  const factories = state.blocks.filter((b) => b.zone === 'industry' && b.industry === 'factory' && b.density > 0)
  let factoryWood = 0
  let factoryStone = 0
  let factoryPower = 0
  for (const b of factories) {
    const ratio = b.jobs > 0 ? b.staffed / b.jobs : 0
    const spec = INDUSTRY_SPEC.factory
    factoryWood += (spec.input.wood ?? 0) * ratio
    factoryStone += (spec.input.stone ?? 0) * ratio
    if (state.era >= 2) factoryPower += (spec.input.electricity ?? 0) * ratio
  }
  const factoryLimit = Math.min(
    1,
    factoryWood > 0 ? l.wood / factoryWood : 1,
    factoryStone > 0 ? l.stone / factoryStone : 1,
    factoryPower > 0 ? electricity / factoryPower : 1,
  )

  // 产出与消耗
  const prod: Record<Res, number> = { food: 0, wood: 0, stone: 0, steel: 0, electricity: 0 }
  const cons: Record<Res, number> = { food: 0, wood: 0, stone: 0, steel: 0, electricity: 0 }
  const workshops = state.blocks.filter((b) => b.zone === 'civic' && b.civic === 'workshop').length
  const policy = POLICY[state.policy]

  for (const b of state.blocks) {
    const ratio = b.jobs > 0 ? b.staffed / b.jobs : 0
    if (ratio <= 0) continue
    const gather = gatherKind(state, b)
    if (b.zone === 'agriculture' && b.density > 0) {
      const machinery = 1 + PLOT.machineryPowerBonus * powerRatio
      const level = 1 + PLOT.farm.levelBonus * (b.density - 1)
      prod.food += PLOT.farm.food * level * ratio * b.logistics * machinery * (1 + PLOT.workshopBonus * workshops) * policy.farm
    } else if (gather === 'forest') {
      prod.wood += PLOT.gather.forest.wood * ratio * b.logistics
    } else if (gather === 'ore') {
      const ore = Math.min(l.oreReserve, PLOT.gather.ore.ore * ratio)
      prod.stone += PLOT.gather.ore.stone * ratio * b.logistics * (l.oreReserve > 0 ? 1 : 0)
      l.oreReserve = Math.max(0, l.oreReserve - ore)
    } else if (b.zone === 'industry' && b.industry === 'quarry') {
      const level = 1 + 0.2 * (b.density - 1)
      const ore = Math.min(l.oreReserve, 1 * ratio)
      prod.stone += (INDUSTRY_SPEC.quarry.output.stone ?? 0) * ratio * b.logistics * level * (l.oreReserve > 0 ? 1 : 0)
      l.oreReserve = Math.max(0, l.oreReserve - ore)
    } else if (b.zone === 'industry' && b.industry === 'factory') {
      const level = 1 + 0.25 * (b.density - 1)
      const spec = INDUSTRY_SPEC.factory
      const scale = ratio * factoryLimit
      prod.steel += (spec.output.steel ?? 0) * scale * b.logistics * level
      cons.wood += (spec.input.wood ?? 0) * scale
      cons.stone += (spec.input.stone ?? 0) * scale
      // 工业时代前是手工业，不耗电（否则钢材永远产不出来，时代门槛锁死）
      if (state.era >= 2) cons.electricity += (spec.input.electricity ?? 0) * scale
    } else if (b.zone === 'civic' && b.civic && b.civic !== 'powerplant') {
      const spec = CIVIC_SPEC[b.civic]
      const out = spec.output
      if (out) {
        prod.food += (out.food ?? 0) * ratio
        prod.wood += (out.wood ?? 0) * ratio
        prod.stone += (out.stone ?? 0) * ratio
        prod.steel += (out.steel ?? 0) * ratio
        l.knowledge += (out.knowledge ?? 0) * ratio
      }
      const input = spec.input
      if (input) {
        cons.wood += (input.wood ?? 0) * ratio
        cons.stone += (input.stone ?? 0) * ratio
        cons.electricity += (input.electricity ?? 0) * ratio
      }
    }
  }

  l.wood = Math.max(0, l.wood - cons.wood)
  l.stone = Math.max(0, l.stone - cons.stone)
  l.food += prod.food
  l.wood += prod.wood
  l.stone += prod.stone
  l.steel += prod.steel
  l.cumulativeSteel += prod.steel
  l.production = prod
  l.consumption = { ...cons, food: l.consumption.food }
  l.storageCapacity = state.blocks.reduce((n, b) => {
    if (b.zone === 'civic' && b.civic && b.density > 0) return n + (CIVIC_SPEC[b.civic].storage ?? 0)
    return n
  }, 900)
  if (l.food > l.storageCapacity) l.food = l.storageCapacity

  // 人口：食物消耗、出生、死亡、年龄结构
  const need = dailyFoodNeed(state)
  const eaten = Math.min(l.food, need)
  l.food = Math.max(0, l.food - eaten)
  l.consumption.food = need
  const deficit = need - eaten
  const clinics = state.blocks.filter((b) => b.zone === 'civic' && b.civic === 'clinic' && b.density > 0).length
  const clinicCov = clinics > 0 ? clamp01(clinics * 0.35) : 0
  const pop = populationOf(state)
  if (pop <= 0) return
  const elderShare = l.elderly / pop
  const pollutionAvg = state.blocks.reduce((n, b) => n + b.pollution, 0) / state.blocks.length
  const capacity = state.stats.housingCapacity
  const spare = Math.max(0, capacity - pop)
  const foodSecurity = clamp01(l.food / Math.max(1, need * 10))
  const crowdPenalty = pop > capacity ? 1 + (pop - capacity) / Math.max(1, capacity) : 1

  const birthExpected =
    pop * PLOT.birthRate * foodSecurity * (1 + clinicCov) * (spare > 0 ? 1 : 0.25) * (l.adults >= 2 ? 1 : 0)
  const deathExpected =
    pop *
    PLOT.deathRate *
    (1 + PLOT.elderDeathWeight * elderShare) *
    (1 + PLOT.pollutionDeathWeight * Math.min(1, pollutionAvg)) *
    (1 - PLOT.clinicDeathReduction * clinicCov) *
    crowdPenalty
  const starveDeaths = deficit > 0 ? Math.max(1, pop * 0.002) : 0
  const births = Math.floor(birthExpected) + (rng.next() < birthExpected % 1 ? 1 : 0)
  const deaths = Math.floor(deathExpected) + (rng.next() < deathExpected % 1 ? 1 : 0) + starveDeaths

  l.children += births
  l.births += births
  const toAdults = l.children / (PLOT.yearsToAdult * 365)
  const toElder = l.adults / (PLOT.yearsToElder * 365)
  l.children = Math.max(0, l.children - toAdults)
  l.adults = Math.max(0, l.adults - toElder + toAdults)
  l.elderly = l.elderly + toElder
  const total = l.children + l.adults + l.elderly
  if (deaths > 0 && total > 0) {
    const share = Math.min(1, deaths / total)
    l.children -= l.children * share
    l.adults -= l.adults * share
    l.elderly -= l.elderly * share
  }
  l.deaths += deaths
  if (l.children < 0) l.children = 0
  if (l.adults < 0) l.adults = 0
  if (l.elderly < 0) l.elderly = 0
}

/** 每 30 日的迁入结算（工作、住房、口粮、人口池限制） */
export function settleMigration(state: PlotState, rng: Rng): number {
  const l = state.ledger
  const pop = populationOf(state)
  if (pop <= 0) return 0
  const meanLandValue =
    state.blocks.filter((b) => b.zone === 'residential' && b.density > 0).reduce((n, b) => n + b.landValue, 0) /
    Math.max(1, state.stats.builtResidential)
  const jobs = state.blocks.reduce((n, b) => n + b.jobs, 0)
  const jobSpare = jobs - l.adults
  const need = Math.max(1, dailyFoodNeed(state))
  const foodSecurity = clamp01(l.food / (need * 10))
  const linked = state.settlements.filter((s) => s.links.length > 0).length / Math.max(1, state.settlements.length)
  const attractiveness =
    PLOT.attractiveness.landValue * meanLandValue +
    PLOT.attractiveness.jobs * clamp01(jobSpare / Math.max(1, l.adults)) +
    PLOT.attractiveness.food * foodSecurity +
    PLOT.attractiveness.links * linked
  const spareHousing = Math.max(0, state.stats.housingCapacity - pop)
  const foodLimit = Math.floor(l.food / PLOT.foodPerMigrant)
  const jobLimit = Math.max(1, jobSpare + 4)
  const wanted = Math.round(attractiveness * pop * PLOT.migrationRate)
  const floor = attractiveness >= 0.15 && spareHousing > 0 ? 1 : 0
  const count = Math.floor(
    Math.max(0, Math.min(Math.max(wanted, floor), spareHousing, foodLimit, l.migrationPool, PLOT.migrationMax, jobLimit)),
  )
  if (count <= 0) return 0
  void rng
  l.adults += count
  l.immigrants += count
  l.migrationPool -= count
  l.food = Math.max(0, l.food - count * PLOT.foodPerMigrant * 0.4)
  return count
}

/** 每轮统计：时代门槛与 UI 都读它 */
export function recomputeStats(state: PlotState): void {
  const bg = gridSize(state.world)
  const stats: PlotStats = {
    roadEdges: 0,
    residentialBlocks: 0,
    builtResidential: 0,
    agricultureBlocks: 0,
    builtAgriculture: 0,
    industryBlocks: 0,
    civicBlocks: 0,
    housingCapacity: 0,
    meanDensity: 0,
    industryResidentialAdjacency: 0,
    marketCoveredRatio: 0,
    powerCoverage: 1,
    highValueBlocks: 0,
    households: 0,
  }
  for (let i = 0; i < state.vRoad.length; i++) if (state.vRoad[i] > 0) stats.roadEdges++
  for (let i = 0; i < state.hRoad.length; i++) if (state.hRoad[i] > 0) stats.roadEdges++

  let densitySum = 0
  let marketCoveredPeople = 0
  let totalPeople = 0
  for (const b of state.blocks) {
    if (b.zone === 'residential') {
      stats.residentialBlocks++
      if (b.density > 0) {
        stats.builtResidential++
        densitySum += b.density
        if (b.landValue >= 0.6) stats.highValueBlocks++
      }
      stats.housingCapacity += housingCapacityOf(b)
    } else if (b.zone === 'agriculture') {
      stats.agricultureBlocks++
      if (b.density > 0) stats.builtAgriculture++
    } else if (b.zone === 'industry') {
      stats.industryBlocks++
    } else if (b.zone === 'civic') {
      stats.civicBlocks++
    }
  }
  for (const b of state.blocks) {
    if (b.zone !== 'residential') continue
    const people = Math.min(b.population, housingCapacityOf(b))
    totalPeople += people
    if (b.covered.market >= PLOT.coveredLine) marketCoveredPeople += people
    if (b.density > 0 && b.covered.market >= PLOT.coveredLine) {
      // 已建成且被市场覆盖的住宅计入达标
    }
  }
  stats.meanDensity = stats.builtResidential > 0 ? densitySum / stats.builtResidential : 0
  stats.marketCoveredRatio = totalPeople > 0 ? marketCoveredPeople / totalPeople : 0
  stats.powerCoverage = state.blocks.length > 0 ? state.blocks[0].covered.power : 1
  stats.households = Math.round(populationOf(state) / 4)

  // 工业与住宅的相邻对（切比雪夫距离 ≤ 1；含在建，任何一对都算违例）
  for (const b of state.blocks) {
    if (b.zone !== 'industry') continue
    const index = b.by * bg + b.bx
    for (const nb of neighbors8(bg, index)) {
      const other = state.blocks[nb]
      if (other.zone === 'residential') {
        stats.industryResidentialAdjacency++
        break
      }
    }
  }
  state.stats = stats
}

export interface Requirement {
  label: string
  value: number
  target: number
  met: boolean
}

/** 时代门槛：全部是城市形态指标（不再靠攒数字） */
export function eraRequirements(state: PlotState): Requirement[] {
  const s = state.stats
  const req = (label: string, value: number, target: number): Requirement => ({
    label,
    value,
    target,
    met: value + 1e-9 >= target,
  })
  switch (state.era) {
    case 0:
      return [
        req('农业区建成', s.builtAgriculture, 6),
        req('仓储天数', s.roadEdges >= 0 ? Math.floor(state.ledger.storageCapacity / Math.max(1, dailyFoodNeed(state))) : 0, 30),
      ]
    case 1:
      return [
        req('路网边数', s.roadEdges, 60),
        req('市场覆盖住宅', s.marketCoveredRatio * 100, 70),
        req('住房平均等级', s.meanDensity, 2),
        req('知识', state.ledger.knowledge, 800),
      ]
    case 2:
      return [
        req('工业/住宅相邻', s.industryResidentialAdjacency, 0),
        req('电力覆盖', s.powerCoverage * 100, 90),
        req('累计钢材', state.ledger.cumulativeSteel, 2000),
      ]
    case 3:
      return [
        req('高地价住宅', s.highValueBlocks, 16),
        req('连通聚落', state.settlements.filter((x) => x.links.length > 0).length, 2),
      ]
    default:
      return []
  }
}

/** 门槛是否全部达成的判定方向（相邻数、缺工类指标为“越小越好”） */
const LOWER_IS_BETTER = new Set(['工业/住宅相邻'])

export function eraGateMet(state: PlotState): boolean {
  const list = eraRequirements(state)
  if (list.length === 0) return false
  return list.every((r) => (LOWER_IS_BETTER.has(r.label) ? r.value <= r.target : r.met))
}
