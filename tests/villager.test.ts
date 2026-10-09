import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/simulation'
import { WATER, getTile } from '../src/sim/world'

describe('居民状态机', () => {
  it('居民饥饿随时间下降', () => {
    const sim = new Simulation(7)
    const v = sim.state.villagers[0]
    const before = v.hunger
    for (let i = 0; i < 100; i++) sim.tick()
    expect(v.hunger).toBeLessThan(before)
  })

  it('死亡居民不再行动：位置、任务、数值全部冻结', () => {
    const sim = new Simulation(7)
    for (let i = 0; i < 60; i++) sim.tick()
    const v = sim.state.villagers[0]
    v.alive = false
    const snap = {
      x: v.x,
      y: v.y,
      task: v.task,
      hunger: v.hunger,
      stamina: v.stamina,
      carry: v.carry,
      path: v.path.length,
    }
    for (let i = 0; i < 100; i++) sim.tick()
    expect(v.x).toBe(snap.x)
    expect(v.y).toBe(snap.y)
    expect(v.task).toBe(snap.task)
    expect(v.hunger).toBe(snap.hunger)
    expect(v.stamina).toBe(snap.stamina)
    expect(v.carry).toBe(snap.carry)
    expect(v.path.length).toBe(snap.path)
  })

  it('居民会采集资源，资源进入村庄库存或被消耗（只增不凭空消失的采集闭环）', () => {
    const sim = new Simulation(7)
    const woodBefore = sim.state.stock.wood
    const stoneBefore = sim.state.stock.stone
    for (let i = 0; i < 1500; i++) sim.tick()
    const woodTotal = sim.state.stock.wood + sim.state.consumed.wood
    const stoneTotal = sim.state.stock.stone + sim.state.consumed.stone
    expect(woodTotal).toBeGreaterThan(woodBefore + 5)
    expect(stoneTotal).toBeGreaterThan(stoneBefore + 2)
  })

  it('居民会持续移动（不在原地静止）', () => {
    const sim = new Simulation(7)
    const start = sim.state.villagers.map((v) => ({ x: v.x, y: v.y }))
    for (let i = 0; i < 500; i++) sim.tick()
    const movedCount = sim.state.villagers.filter((v, i) => {
      if (!v.alive) return false
      return Math.abs(v.x - start[i].x) + Math.abs(v.y - start[i].y) > 0.5
    }).length
    expect(movedCount).toBeGreaterThan(3)
  })

  it('饥饿的居民就地进食：不打断手头任务与路径，库存扣减、饥饿回升', () => {
    const sim = new Simulation(13)
    const v = sim.state.villagers[0]
    v.hunger = 10
    v.task = 'deposit'
    v.path = [{ x: 31, y: 31 }]
    v.pathGoal = { x: 31, y: 31 }
    v.carry = 5
    v.carryType = 'wood'
    sim.state.stock.food = 100
    const foodBefore = sim.state.stock.food
    const hungerBefore = v.hunger
    sim.tick()
    expect(v.task).toBe('deposit')
    expect(v.path.length).toBe(1)
    expect(v.hunger).toBeGreaterThan(hungerBefore)
    expect(sim.state.stock.food).toBeLessThan(foodBefore)
  })

  it('居民移动与停留始终不进入水域', () => {
    const sim = new Simulation(11)
    const world = sim.state.world
    for (let i = 0; i < 600; i++) {
      sim.tick()
      for (const v of sim.state.villagers) {
        if (!v.alive) continue
        const t = getTile(world, Math.floor(v.x), Math.floor(v.y))
        expect(t?.terrain).not.toBe(WATER)
      }
    }
  })
})
