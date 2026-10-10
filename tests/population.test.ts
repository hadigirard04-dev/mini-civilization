import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/simulation'

describe('人口积累', () => {
  it(
    '10000 tick 内出生不被存量线卡死，人口实现净积累（不靠饿死代价）',
    { timeout: 90_000 },
    () => {
      const report: string[] = []
      for (const seed of [20261009, 11]) {
        const sim = new Simulation(seed)
        for (let i = 0; i < 10_000; i++) sim.tick()
        const s = sim.state
        const alive = s.villagers.filter((v) => v.alive).length
        report.push(
          `seed=${seed} alive=${alive} births=${s.births} 老死=${s.ageDeaths} 饿死=${s.starveDeaths ?? 0}`,
        )
        expect(s.births, report.join(' | ')).toBeGreaterThanOrEqual(12)
        expect(alive, report.join(' | ')).toBeGreaterThanOrEqual(20)
        expect(s.starveDeaths ?? 0, report.join(' | ')).toBeLessThanOrEqual(2)
      }
    },
  )
})
