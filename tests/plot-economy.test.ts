import { describe, expect, it } from 'vitest'
import { createRng } from '../src/sim/rng'
import { createPlotState, PlotSim } from '../src/sim/plot/sim'
import {
  dailyFoodNeed,
  distributePopulation,
  eraGateMet,
  eraRequirements,
  populationOf,
  powerDemand,
  powerSupply,
  recomputeCoverage,
  recomputeLandValue,
  recomputeLogistics,
  recomputePollution,
  recomputeStats,
  settleDay,
  settleMigration,
} from '../src/sim/plot/economy'
import { PLOT } from '../src/sim/plot/config'
import { gridSize } from '../src/sim/plot/blocks'

function advance(sim: PlotSim, days: number): void {
  for (let d = 0; d < days; d++) for (let t = 0; t < 60; t++) sim.tick()
}

describe('经济与人口', () => {
  it('每日结算后资源非负、无 NaN（INV2/INV5）', () => {
    const sim = PlotSim.create(11, 128)
    const rng = createRng(7)
    for (let d = 0; d < 200; d++) {
      advance(sim, 1)
      settleDay(sim.state, rng)
      const l = sim.state.ledger
      for (const key of ['food', 'wood', 'stone', 'steel'] as const) {
        expect(l[key]).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(l[key])).toBe(true)
      }
    }
  })

  it('人口账守恒：初始 20 + 出生 − 死亡 + 迁入 = 当前人口（INV1）', () => {
    const sim = PlotSim.create(123456, 128)
    for (let d = 0; d < 20; d++) {
      advance(sim, 100)
      const l = sim.state.ledger
      const expected = PLOT.founding.population + l.births - l.deaths + l.immigrants
      expect(Math.abs(populationOf(sim.state) - expected)).toBeLessThan(0.01)
    }
  })

  it('聚合人口分摊到住宅地块（总数一致）', () => {
    const sim = PlotSim.create(2024, 128)
    advance(sim, 500)
    const s = sim.state
    distributePopulation(s)
    const sum = s.blocks.reduce((n, b) => n + b.population, 0)
    const housed = s.blocks.some((b) => b.zone === 'residential' && b.density > 0)
    if (housed) expect(Math.abs(sum - populationOf(s))).toBeLessThan(0.01)
  })

  it('物流系数按路网距离分档，未联网时最低', () => {
    const s = createPlotState(31, 128)
    recomputeLogistics(s)
    for (const b of s.blocks) {
      expect(b.logistics).toBeGreaterThan(0)
      expect(b.logistics).toBeLessThanOrEqual(1)
    }
    expect(PLOT.logisticsUnconnected).toBeLessThan(1)
  })

  it('地价被污染压低、被公园与市场抬高', () => {
    const s = createPlotState(77, 128)
    const bg = gridSize(s.world)
    const a = s.blocks[bg + 1]
    const b = s.blocks[bg + 2]
    a.covered.market = 1
    a.covered.park = 1
    recomputeLandValue(s)
    const high = a.landValue
    b.pollution = 4
    recomputeLandValue(s)
    expect(high).toBeGreaterThan(b.landValue)
  })

  it('污染只在工业地块附近出现', () => {
    const s = createPlotState(55, 128)
    const bg = gridSize(s.world)
    const factory = s.blocks[bg * 4 + 4]
    factory.zone = 'industry'
    factory.industry = 'factory'
    factory.density = 2
    recomputePollution(s)
    const near = s.blocks[bg * 4 + 5].pollution
    const far = s.blocks[bg * 4 + 12].pollution
    expect(factory.pollution).toBeGreaterThan(near)
    expect(near).toBeGreaterThan(far)
    expect(far).toBe(0)
  })

  it('服务覆盖落在 0–1 且中心高于边缘', () => {
    const s = createPlotState(88, 128)
    const bg = gridSize(s.world)
    const market = s.blocks[bg * 5 + 5]
    market.zone = 'civic'
    market.civic = 'market'
    market.density = 1
    recomputeCoverage(s)
    const center = s.blocks[bg * 5 + 5].covered.market
    const edge = s.blocks[bg * 5 + 5 + PLOT.radius.market].covered.market
    expect(center, `center=${center} edge=${edge} r=${PLOT.radius.market} falloff=${PLOT.coverageFalloff}`).toBeGreaterThan(edge)
    expect(center).toBeLessThanOrEqual(1)
    expect(edge).toBeGreaterThanOrEqual(0)
  })

  it('电力供需只在工业时代之后统计', () => {
    const s = createPlotState(99, 128)
    expect(powerDemand(s)).toBe(0)
    s.era = 2
    const plant = s.blocks[gridSize(s.world) * 3 + 3]
    plant.zone = 'civic'
    plant.civic = 'powerplant'
    plant.density = 1
    expect(powerSupply(s)).toBeGreaterThan(0)
    expect(powerDemand(s)).toBeGreaterThanOrEqual(0)
  })

  it('迁入受住房、口粮与人口池限制', () => {
    const s = createPlotState(101, 128)
    const rng = createRng(3)
    recomputeStats(s)
    const before = s.ledger.immigrants
    const moved = settleMigration(s, rng)
    expect(moved).toBe(0)
    expect(s.ledger.immigrants).toBe(before)

    const home = s.blocks[gridSize(s.world) * 4 + 4]
    home.zone = 'residential'
    home.density = 2
    recomputeStats(s)
    const moved2 = settleMigration(s, rng)
    expect(moved2).toBeGreaterThan(0)
    expect(s.ledger.migrationPool).toBeLessThan(PLOT.migrationPool)
  })

  it('时代门槛随时代变化，且占用与门槛方向明确', () => {
    const sim = PlotSim.create(606, 128)
    expect(eraRequirements(sim.state).map((r) => r.label)).toContain('农业区建成')
    advance(sim, 3000)
    expect(sim.state.era).toBeGreaterThanOrEqual(1)
    if (sim.state.era === 1) {
      const labels = eraRequirements(sim.state).map((r) => r.label)
      expect(labels).toContain('路网边数')
      expect(labels).toContain('市场覆盖住宅')
    }
    const gate = eraGateMet(sim.state)
    if (gate) expect(sim.state.era).toBeLessThan(4)
  })

  it('粮食需求随人口增长', () => {
    const s = createPlotState(303, 128)
    const before = dailyFoodNeed(s)
    s.ledger.children += 100
    expect(dailyFoodNeed(s)).toBeGreaterThan(before)
  })
})
