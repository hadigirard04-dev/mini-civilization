import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/simulation'
import { FARMLAND, GRASS } from '../src/sim/world'

function countFarms(sim: Simulation): number {
  return sim.state.world.tiles.filter((t) => t.terrain === FARMLAND).length
}

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick()
}

describe('居民自动开垦', () => {
  it('木材富余时居民自动开垦农田（真实扣料、落成）', () => {
    const sim = new Simulation(606)
    sim.state.stock.wood = 70
    run(sim, 2500)
    expect(countFarms(sim)).toBeGreaterThanOrEqual(1)
    expect(sim.state.consumed.wood).toBeGreaterThanOrEqual(5)
  })

  it('农田数量有上限，不会无限扩张', () => {
    const sim = new Simulation(607)
    const w = sim.state.world
    // 预置 12 块农田（上限），留足草地
    let placed = 0
    for (let i = 0; i < w.tiles.length && placed < 12; i++) {
      if (w.tiles[i].terrain === GRASS) {
        w.tiles[i] = { terrain: FARMLAND, resource: 60, max: 60 }
        placed++
      }
    }
    sim.state.stock.wood = 500
    run(sim, 3000)
    expect(countFarms(sim)).toBe(12)
  })

  it('木材不足时当下不立项，建房 30 料优先扣', () => {
    const sim = new Simulation(608)
    sim.state.stock.wood = 40
    sim.state.stock.stone = 30 // 石头齐备，隔离缺石变量
    for (let i = 0; i < 50; i++) sim.tick()
    // 40 → 立房扣 30 → 余 10，远低于开垦线 55：不开垦工地
    expect(countFarms(sim)).toBe(0)
    expect(sim.state.sites.filter((s) => s.type === 'farm')).toHaveLength(0)
    // 建房料优先：住房工地已立项且木料被房扣走
    expect(sim.state.sites.some((s) => s.type === 'house')).toBe(true)
    expect(sim.state.stock.wood).toBeLessThan(55)
  })
})
