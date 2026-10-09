import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/simulation'

describe('食物平衡（真实开局长期生存）', () => {
  it(
    '默认开局（无玩家补给）连续 10000 tick 不发生饥饿崩盘：死亡受控且人口存活',
    { timeout: 60_000 },
    () => {
      const report: string[] = []
      for (const seed of [11, 42, 12345, 777, 20261009]) {
        const sim = new Simulation(seed)
        for (let i = 0; i < 10_000; i++) sim.tick()
        const alive = sim.state.villagers.filter((v) => v.alive).length
        report.push(`seed=${seed} alive=${alive} deaths=${sim.state.deaths}(饿${sim.state.starveDeaths}/老${sim.state.ageDeaths})`)
        // 验收：1 万 tick（约 166 模拟天）后文明仍延续，且不发生饥饿崩盘。
        // （老死属自然更替：10000 tick 内岁数 +40，全员经历到寿期，不计入崩盘）
        expect(alive, report.join(' | ')).toBeGreaterThanOrEqual(10)
        expect(sim.state.starveDeaths ?? 0, report.join(' | ')).toBeLessThanOrEqual(2)
      }
    },
  )
})
