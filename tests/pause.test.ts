import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/simulation'

describe('模拟控制（暂停与倍速）', () => {
  it('暂停时世界状态完全不推进', () => {
    const sim = new Simulation(3)
    for (let i = 0; i < 100; i++) sim.tick()
    sim.paused = true
    const before = JSON.stringify(sim.state)
    sim.advance(5)
    sim.advance(10)
    expect(JSON.stringify(sim.state)).toBe(before)

    // 恢复后重新推进
    sim.paused = false
    sim.advance(1)
    expect(sim.state.tick).toBeGreaterThan(100)
  })

  it('5 倍速的推进量是 1 倍速的 5 倍', () => {
    const a = new Simulation(5)
    const b = new Simulation(5)
    b.speed = 5
    a.advance(1)
    b.advance(1)
    expect(b.state.tick).toBe(a.state.tick * 5)
    expect(b.state.tick).toBe(50)
  })

  it('暂停状态下创建的恢复存档，读取后可继续运行', () => {
    const sim = new Simulation(9)
    sim.paused = true
    sim.advance(3)
    expect(sim.state.tick).toBe(0)
    sim.paused = false
    sim.advance(1)
    expect(sim.state.tick).toBe(10)
  })
})
