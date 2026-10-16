import { it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { PlotSim } from '../src/sim/plot/sim'
import { PLOT } from '../src/sim/plot/config'
import { gridSize } from '../src/sim/plot/blocks'
import { hasRoadAccess } from '../src/sim/plot/roads'
import { eraGateMet, populationOf, recomputeStats } from '../src/sim/plot/economy'

it.skipIf(process.env.PLOT_LONG !== '1')(
  '12000 天实际演化：多聚落与工业城市、形态不变量、性能预算',
  { timeout: 600000 },
  () => {
    const days = Number(process.env.PLOT_DAYS ?? 12000)
    const sim = PlotSim.create(Number(process.env.PLOT_SEED ?? 42), 256)
    const started = performance.now()
    for (let day = 0; day < days; day++) {
      for (let t = 0; t < 60; t++) sim.tick()
      if (day % 1000 !== 0) continue
      const s = sim.state
      recomputeStats(s)
      const bg = gridSize(s.world)
      // INV1 人口账
      const l = s.ledger
      expect(Math.abs(populationOf(s) - (PLOT.founding.population + l.births - l.deaths + l.immigrants))).toBeLessThan(0.01)
      // INV2 资源非负
      for (const key of ['food', 'wood', 'stone', 'steel'] as const) expect(l[key]).toBeGreaterThanOrEqual(0)
      // INV3 临路
      for (const b of s.blocks) {
        if (!['residential', 'industry', 'civic', 'park'].includes(b.zone)) continue
        expect(hasRoadAccess(s, b.by * bg + b.bx)).toBe(true)
      }
      // INV4 工业与住宅不相邻
      expect(s.stats.industryResidentialAdjacency).toBe(0)
      // INV5 无 NaN
      expect(Number.isFinite(populationOf(s))).toBe(true)
      expect(Number.isFinite(l.knowledge)).toBe(true)
      // INV7 时代单调不减（而且在跑完后应达成工业时代）
      expect(s.era).toBeLessThanOrEqual(4)
    }
    const s = sim.state
    const elapsed = performance.now() - started
    const perTick = elapsed / (days * 60)
    const summary = {
      days,
      era: s.era,
      population: Math.round(populationOf(s)),
      settlements: s.settlements.map((x) => ({ name: x.name, population: Math.round(x.population), links: x.links.length })),
      stats: s.stats,
      ledger: {
        food: Math.round(s.ledger.food),
        wood: Math.round(s.ledger.wood),
        stone: Math.round(s.ledger.stone),
        steel: Math.round(s.ledger.steel),
        knowledge: Math.round(s.ledger.knowledge),
        births: s.ledger.births,
        deaths: s.ledger.deaths,
        immigrants: s.ledger.immigrants,
      },
      eraGate: eraGateMet(s),
      requirements: sim.view().requirements,
      perTickMs: Number(perTick.toFixed(4)),
    }
    if (process.env.PLOT_REPORT) writeFileSync(process.env.PLOT_REPORT, JSON.stringify(summary, null, 1))

    // 达成工业城市（形态门槛），人口突破千级门槛的一半以上
    expect(s.era).toBeGreaterThanOrEqual(3)
    expect(populationOf(s)).toBeGreaterThan(600)
    // 性能：单 tick 平均远低于 1ms（对照 v0.5 逐个体模拟的 ~5ms/帧预算）
    expect(perTick).toBeLessThan(0.5)
  },
)
