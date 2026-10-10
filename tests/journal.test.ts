import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/simulation'

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick()
}

describe('纪事系统（里程碑 + 随机事件 + 足迹）', () => {
  it('居民移动会在地面留下足迹（供道路渲染）', () => {
    const sim = new Simulation(4242)
    run(sim, 400)
    const walk: number[] = sim.state.walk ?? []
    expect(walk.length).toBe(sim.state.world.size * sim.state.world.size)
    const total = walk.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(0)
    // 足迹应集中在村庄中心附近（居民活动区）
    const maxSeen = Math.max(...walk)
    expect(maxSeen).toBeGreaterThan(0)
  })

  it('长跑中触发随机事件并记入纪事，效果不产生负资源', () => {
    const sim = new Simulation(909)
    run(sim, 7000)
    const events = (sim.state.journal ?? []).filter((e) => e.kind === 'event')
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(sim.state.stock.food).toBeGreaterThanOrEqual(0)
    expect(sim.state.stock.stone).toBeGreaterThanOrEqual(0)
    expect(sim.state.stock.wood).toBeGreaterThanOrEqual(0)
  })

  it('首座房屋落成作为里程碑记入纪事', () => {
    const sim = new Simulation(31)
    sim.state.stock.wood = 200
    sim.state.stock.stone = 100
    run(sim, 3000)
    expect(sim.state.buildings.length).toBeGreaterThanOrEqual(1)
    const milestones = (sim.state.journal ?? []).filter((e) => e.kind === 'milestone')
    expect(milestones.some((e) => e.text.includes('房屋'))).toBe(true)
  })

  it('纪事条数有上限，不会无限增长', () => {
    const sim = new Simulation(77)
    run(sim, 9000)
    expect((sim.state.journal ?? []).length).toBeLessThanOrEqual(60)
  })
})
