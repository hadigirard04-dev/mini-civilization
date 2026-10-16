import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createRng } from '../src/sim/rng'
import { GRASS } from '../src/sim/world'
import { createPlotState, PlotSim } from '../src/sim/plot/sim'
import { PLOT } from '../src/sim/plot/config'
import { gridSize } from '../src/sim/plot/blocks'
import { dailyFoodNeed, distributePopulation, populationOf, recomputeCoverage, recomputeLandValue, recomputeStats, settleDay } from '../src/sim/plot/economy'
import { assignZones, connectSettlements, foundFirstSettlement, growRoads, planUpgrades, tryFoundSettlement } from '../src/sim/plot/planner'
import { roadConnected, roadEdgeCount } from '../src/sim/plot/roads'
import { deserializePlot, serializePlot } from '../src/sim/plot/save'
import type { PlotState } from '../src/sim/plot/types'

function flatState(): PlotState {
  const state = createPlotState(42, 128)
  for (const tile of state.world.tiles) tile.terrain = GRASS
  for (const b of state.blocks) Object.assign(b, { terrain: GRASS, buildable: true, hasWater: false, hasForest: false, hasOre: false })
  state.ledger.wood = 10000
  state.ledger.stone = 10000
  state.ledger.steel = 10000
  return state
}

function advance(sim: PlotSim, days: number): void {
  for (let t = 0; t < days * 60; t++) sim.tick()
}

describe('地块玩法的实际反馈', () => {
  it('已有和排队住房一起满足需求后，停止继续划住宅', () => {
    const s = flatState()
    const rng = createRng(1)
    foundFirstSettlement(s, rng)
    for (let i = 0; i < 3; i++) growRoads(s)
    for (const b of s.blocks.slice(0, 6)) Object.assign(b, { zone: 'agriculture', density: 1 })
    recomputeStats(s)
    for (let i = 0; i < 3; i++) assignZones(s, rng)
    const homes = s.blocks.filter((b) => b.zone === 'residential')
    expect(homes.length).toBe(2)
    expect(homes.every((b) => b.construction !== null)).toBe(true)
  })

  it('公园分区落成后，周围住宅获得服务与地价提升', () => {
    const s = flatState()
    const bg = gridSize(s.world)
    const park = s.blocks[4 * bg + 4]
    const home = s.blocks[4 * bg + 5]
    Object.assign(home, { zone: 'residential', density: 1 })
    recomputeCoverage(s)
    recomputeLandValue(s)
    const before = home.landValue
    Object.assign(park, { zone: 'park', density: 1 })
    recomputeCoverage(s)
    recomputeLandValue(s)
    expect(home.covered.park).toBeGreaterThan(0.5)
    expect(home.landValue).toBeGreaterThan(before)
  })

  it('粮食充足时，农田释放劳动力给学校而非永久占满所有成年人', () => {
    const s = flatState()
    s.ledger.food = dailyFoodNeed(s) * 40
    for (const b of s.blocks.slice(0, 10)) Object.assign(b, { zone: 'agriculture', density: 1, logistics: 1 })
    const school = s.blocks[40]
    Object.assign(school, { zone: 'civic', civic: 'school', density: 1 })
    recomputeStats(s)
    settleDay(s, createRng(7))
    expect(school.staffed).toBeGreaterThan(0)
    expect(s.ledger.knowledge).toBeGreaterThan(0)
    expect(s.ledger.production.food).toBeGreaterThanOrEqual(dailyFoodNeed(s))
  })

  it('新聚落在全局住房富余时仍获得自己的起步住宅', () => {
    const s = flatState()
    for (const b of s.blocks) Object.assign(b, { hasForest: true, hasWater: true })
    const rng = createRng(8)
    foundFirstSettlement(s, rng)
    for (let i = 0; i < 3; i++) growRoads(s)
    for (const i of s.settlements[0].blocks.filter((i) => s.blocks[i].zone === 'none').slice(0, 12)) {
      Object.assign(s.blocks[i], { zone: 'residential', density: 4 })
    }
    Object.assign(s.ledger, { adults: 1200, children: 400, elderly: 200 })
    recomputeStats(s)
    distributePopulation(s)
    const id = tryFoundSettlement(s, rng)
    expect(id).not.toBeNull()
    for (let n = 0; n < 3; n++) {
      growRoads(s)
      assignZones(s, rng)
    }
    expect(s.blocks.filter((b) => b.settlement === id && b.zone === 'residential').length).toBeGreaterThan(0)
  })

  it('发电量与燃料消耗记入当天流量账，燃料耗尽时实际发电归零', () => {
    const s = flatState()
    s.era = 2
    const plant = s.blocks[30]
    Object.assign(plant, { zone: 'civic', civic: 'powerplant', density: 1 })
    const wood = s.ledger.wood
    settleDay(s, createRng(3))
    expect(s.ledger.production.electricity).toBeGreaterThan(0)
    expect(wood - s.ledger.wood).toBeCloseTo(s.ledger.consumption.wood - s.ledger.production.wood)
    s.ledger.wood = 0
    s.ledger.stone = 0
    settleDay(s, createRng(3))
    expect(s.ledger.production.electricity).toBe(0)
    expect(new PlotSim(s).view().power.supply).toBe(0)
  })

  it('每个游戏日结束后聚落与地块人口之和等于当前人口', () => {
    const sim = PlotSim.create(42, 128)
    advance(sim, 100)
    for (let day = 0; day < 30; day++) {
      advance(sim, 1)
      expect(sim.state.blocks.reduce((n, b) => n + b.population, 0)).toBeCloseTo(populationOf(sim.state), 6)
      expect(sim.state.settlements.reduce((n, s) => n + s.population, 0)).toBeCloseTo(populationOf(sim.state), 6)
    }
  })

  it('保存并恢复之后，后续 200 天发展与连续运行保持一致', () => {
    const uninterrupted = PlotSim.create(777, 128)
    advance(uninterrupted, 500)
    const file = deserializePlot(serializePlot(uninterrupted))!
    const restored = new PlotSim(file.state)
    restored.rebuildDerived()
    expect(restored.view().jobs.total).toBeGreaterThan(0)
    advance(uninterrupted, 200)
    advance(restored, 200)
    const comparable = (sim: PlotSim) => {
      const data = JSON.parse(serializePlot(sim))
      delete data.savedAt
      return createHash('sha256').update(JSON.stringify(data)).digest('hex')
    }
    expect(comparable(restored)).toEqual(comparable(uninterrupted))
  })

  it('工业和住宅的零相邻条件在界面和跨时代检查中采用相同方向', () => {
    const s = flatState()
    s.era = 2
    s.stats.industryResidentialAdjacency = 1
    const condition = new PlotSim(s).view().requirements.find((r) => r.label === '工业/住宅相邻')!
    expect(condition.met).toBe(false)
    s.stats.industryResidentialAdjacency = 0
    expect(new PlotSim(s).view().requirements.find((r) => r.label === '工业/住宅相邻')!.met).toBe(true)
    expect(PLOT.founding.population).toBe(populationOf(s))
  })

  it('早期住宅即使地价和材料充足，也不能提前长成高层', () => {
    const s = flatState()
    const home = s.blocks[10]
    Object.assign(home, { zone: 'residential', density: 1, landValue: 1 })
    recomputeStats(s)
    planUpgrades(s)
    expect(home.construction).toBeNull()
    s.era = 1
    planUpgrades(s)
    expect(home.construction?.kind).toBe('upgrade')
  })

  it('城区空地够用时仍会按预算修城际道路，缺材料时不会免费连通', () => {
    const s = flatState()
    const city = (id: number, center: number) => ({ id, center, name: String(id), foundedTick: 0, blocks: [center], population: 50, jobs: 0, housing: 60, links: [] })
    s.settlements = [city(0, 34), city(1, 204)]
    s.ledger.wood = 0
    s.ledger.stone = 0
    expect(connectSettlements(s)).toBe(0)
    expect(roadConnected(s, 34, 204)).toBe(false)
    s.ledger.wood = 100
    for (let i = 0; i < 20; i++) expect(connectSettlements(s)).toBeLessThanOrEqual(2)
    expect(roadConnected(s, 34, 204)).toBe(true)
    expect(100 - s.ledger.wood).toBe(roadEdgeCount(s))
  })

  it('保存与恢复保留玩家选择的政策和地图图层', () => {
    const sim = PlotSim.create(123, 128)
    sim.setPolicy('science')
    sim.setOverlay('pollution')
    const file = deserializePlot(serializePlot(sim))!
    const restored = new PlotSim(file.state)
    restored.rebuildDerived()
    expect(restored.view().policy).toBe('science')
    expect(restored.view().overlay).toBe('pollution')
  })
})
