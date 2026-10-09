import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/simulation'
import { FOREST, GRASS } from '../src/sim/world'

function aliveCount(sim: Simulation): number {
  return sim.state.villagers.filter((v) => v.alive).length
}

/** 距中心最远的某类地形格（居民不会去打扰的角落） */
function farthestTile(sim: Simulation, terrain: number): number {
  const w = sim.state.world
  const cx = w.size / 2
  const cy = w.size / 2
  let best = -1
  let bestD = -1
  for (let i = 0; i < w.tiles.length; i++) {
    if (w.tiles[i].terrain !== terrain) continue
    const x = (i % w.size) + 0.5
    const y = ((i / w.size) | 0) + 0.5
    const d = (x - cx) ** 2 + (y - cy) ** 2
    if (d > bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

describe('经济与生态系统', () => {
  it('长期运行中三种资源均不会变成负数', () => {
    const sim = new Simulation(21)
    for (let i = 0; i < 3000; i++) {
      sim.tick()
      if (i % 100 === 0) {
        expect(sim.state.stock.food).toBeGreaterThanOrEqual(0)
        expect(sim.state.stock.wood).toBeGreaterThanOrEqual(0)
        expect(sim.state.stock.stone).toBeGreaterThanOrEqual(0)
      }
    }
    for (const t of sim.state.world.tiles) {
      expect(t.resource).toBeGreaterThanOrEqual(0)
    }
  })

  it('公共食物耗尽时居民挨饿，但库存绝不会被吃到负数', () => {
    const sim = new Simulation(21)
    sim.state.stock.food = 0
    for (let i = 0; i < 500; i++) sim.tick()
    expect(sim.state.stock.food).toBeGreaterThanOrEqual(0)
    expect(sim.state.consumed.food).toBeGreaterThanOrEqual(0)
  })

  it('建筑无法凭空产生资源：全程资源只按成本减少，且房屋真实落成', () => {
    const sim = new Simulation(33)
    // 清空全部地表资源：排除一切采集进账，只剩消耗
    for (const t of sim.state.world.tiles) {
      t.resource = 0
      t.max = 0
    }
    sim.state.stock.wood = 60
    sim.state.stock.stone = 30

    let prevWood = 60
    let prevStone = 30
    for (let i = 0; i < 2500; i++) {
      sim.tick()
      const w = sim.state.stock.wood
      const st = sim.state.stock.stone
      expect(w).toBeGreaterThanOrEqual(0)
      expect(st).toBeGreaterThanOrEqual(0)
      expect(w).toBeLessThanOrEqual(prevWood + 1e-9)
      expect(st).toBeLessThanOrEqual(prevStone + 1e-9)
      // 守恒：初始 = 当前库存 + 累计建设消耗（建造不会变出资源）
      expect(w + sim.state.consumed.wood).toBeCloseTo(60, 6)
      expect(st + sim.state.consumed.stone).toBeCloseTo(30, 6)
      prevWood = w
      prevStone = st
    }
    expect(sim.state.buildings.length).toBeGreaterThanOrEqual(1)
    expect(sim.state.consumed.wood).toBeGreaterThanOrEqual(30)
  })

  it('采空的森林与草地会有限再生（不超过上限）', () => {
    const sim = new Simulation(33)
    sim.state.villagers = [] // 隔离：没有居民采集
    const forestIdx = farthestTile(sim, FOREST)
    const grassIdx = farthestTile(sim, GRASS)
    const forest = sim.state.world.tiles[forestIdx]
    const grass = sim.state.world.tiles[grassIdx]
    forest.resource = 0
    grass.resource = 0
    for (let i = 0; i < 500; i++) sim.tick()
    expect(forest.resource).toBeGreaterThan(0)
    expect(forest.resource).toBeLessThanOrEqual(forest.max)
    expect(grass.resource).toBeGreaterThan(0)
    expect(grass.resource).toBeLessThanOrEqual(grass.max)
  })

  it('食物与住房充足时人口会增长', () => {
    const sim = new Simulation(5)
    sim.state.stock.food = 500
    sim.state.stock.wood = 120
    sim.state.stock.stone = 60
    for (let i = 0; i < 3000; i++) sim.tick()
    expect(sim.state.births).toBeGreaterThan(0)
    expect(aliveCount(sim)).toBeGreaterThan(20)
  })

  it('食物归零时居民会饿死（饥饿影响生存）', () => {
    const sim = new Simulation(9)
    for (const t of sim.state.world.tiles) {
      if (t.terrain === GRASS) {
        t.resource = 0
        t.max = 0
      }
    }
    sim.state.stock.food = 0
    const before = aliveCount(sim)
    for (let i = 0; i < 4000; i++) sim.tick()
    expect(sim.state.deaths).toBeGreaterThan(0)
    expect(aliveCount(sim)).toBeLessThan(before)
  })

  it('住房提供人口容量：每座房 +4 人', () => {
    const sim = new Simulation(1)
    expect(sim.capacity).toBe(20)
    sim.state.buildings.push({ id: 999, x: 30, y: 30 })
    expect(sim.capacity).toBe(24)
  })
})
