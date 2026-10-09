import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/simulation'
import { WATER, getTile } from '../src/sim/world'

describe('长程稳定性', () => {
  it(
    '连续运行 10000 个 tick：无未捕获异常、资源不为负、居民不落水、人口不灭绝',
    { timeout: 60_000 },
    () => {
      const sim = new Simulation(12345)
      const s = sim.state

      for (let i = 0; i < 10_000; i++) {
        sim.tick()

        // 每 tick：居民永远站在可通行格上（落水即失败）
        for (const v of s.villagers) {
          if (!v.alive) continue
          const x = Math.floor(v.x)
          const y = Math.floor(v.y)
          if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) {
            throw new Error(`tick ${s.tick}: 居民 ${v.id} 坐标非法 (${v.x}, ${v.y})`)
          }
          const tile = getTile(s.world, x, y)
          if (!tile || tile.terrain === WATER) {
            throw new Error(`tick ${s.tick}: 居民 ${v.id} 落入水域 (${x}, ${y})`)
          }
        }

        // 每 250 tick：资源与人口硬不变量
        if (s.tick % 250 === 0) {
          if (s.stock.food < 0 || s.stock.wood < 0 || s.stock.stone < 0) {
            throw new Error(`tick ${s.tick}: 库存为负 ${JSON.stringify(s.stock)}`)
          }
          if (!Number.isFinite(s.stock.food) || !Number.isFinite(s.stock.wood) || !Number.isFinite(s.stock.stone)) {
            throw new Error(`tick ${s.tick}: 库存非法 ${JSON.stringify(s.stock)}`)
          }
          if (s.villagers.length > 80) {
            throw new Error(`tick ${s.tick}: 居民数量失控 ${s.villagers.length}`)
          }
          for (let t = 0; t < s.world.tiles.length; t++) {
            const res = s.world.tiles[t].resource
            if (!(res >= 0) || !Number.isFinite(res)) {
              throw new Error(`tick ${s.tick}: 格子 ${t} 资源非法 ${res}`)
            }
          }
        }
      }

      // 结束状态：文明仍在延续
      const alive = s.villagers.filter((v) => v.alive).length
      expect(alive).toBeGreaterThan(0)
      expect(s.stock.food).toBeGreaterThanOrEqual(0)
      expect(s.history.length).toBeGreaterThan(0)
      expect(s.tick).toBe(10_000)
    },
  )
})
