import { describe, expect, it, vi } from 'vitest'
import { Simulation } from '../src/sim/simulation'
import { frameSettlement, worldToScreen } from '../src/render/camera'

describe('高倍速与城市场景', () => {
  it('达到单帧预算后让出执行权，之后仍能推进剩余模拟量', () => {
    const sim = new Simulation(42)
    sim.speed = 20
    let clock = 0
    const timer = vi.spyOn(performance, 'now').mockImplementation(() => clock++)
    try {
      sim.advance(0.1, 2)
      expect(sim.state.tick).toBe(2)
      sim.advance(0)
      expect(sim.state.tick).toBe(20)
    } finally { timer.mockRestore() }
  })

  it('降低目标速度时不会继续追赶旧的快进积压', () => {
    const sim = new Simulation(42)
    sim.speed = 200
    let clock = 0
    const timer = vi.spyOn(performance, 'now').mockImplementation(() => clock++)
    try {
      sim.advance(0.1, 1)
      const before = sim.state.tick
      sim.speed = 1
      sim.advance(0)
      expect(sim.state.tick).toBe(before)
    } finally { timer.mockRestore() }
  })

  it('交货选择最近的粮仓，并识别后续新增的仓库', () => {
    const sim = new Simulation(42, 'evolution'), s = sim.state
    s.civilization!.autoBuild = false
    s.buildings.push({ id: 990, x: 136, y: 128, type: 'granary' },
      { id: 991, x: 130, y: 128, type: 'granary' })
    const v = s.villagers[0]
    Object.assign(v, { x: 128.5, y: 128.5, task: 'deposit', path: [], pathGoal: null, carry: 10, carryType: 'food', work: 0 })
    sim.tick()
    expect(v.pathGoal).toEqual({ x: 130, y: 128 })
    s.buildings.push({ id: 992, x: 129, y: 128, type: 'granary' })
    Object.assign(v, { task: 'deposit', path: [], pathGoal: null, work: 0 })
    sim.tick()
    expect(v.carry).toBe(0)
  })

  it('手机取景包含城区顶部天际线与建筑底部', () => {
    const points = [{ x: 119, y: 119 }, { x: 139, y: 141 }]
    const camera = frameSettlement(points, 256, 390, 340, 4)
    const top = worldToScreen(camera, 390, 340, 119, 119 - 7.5)
    const bottom = worldToScreen(camera, 390, 340, 140, 142)
    expect(top.x).toBeGreaterThan(0)
    expect(top.y).toBeGreaterThan(0)
    expect(bottom.x).toBeLessThan(390)
    expect(bottom.y).toBeLessThan(340)
  })
})
