import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/simulation'
import { FARMLAND, GRASS, getTile, resourceType } from '../src/sim/world'

describe('农田开垦', () => {
  it('草地可花 5 木材开垦为农田，资源与记账守恒', () => {
    const sim = new Simulation(555)
    const w = sim.state.world
    // 找一块非中心保留区的草地
    let gx = -1
    let gy = -1
    for (let y = 1; y < w.size - 1 && gx < 0; y++) {
      for (let x = 1; x < w.size - 1; x++) {
        if (Math.abs(x + 0.5 - w.size / 2) <= 2.4 && Math.abs(y + 0.5 - w.size / 2) <= 2.4) continue
        if (w.tiles[y * w.size + x].terrain === GRASS) {
          gx = x
          gy = y
          break
        }
      }
    }
    expect(gx).toBeGreaterThanOrEqual(0)

    sim.state.stock.wood = 10
    const ok = sim.reclaimToFarmland(gx, gy)
    expect(ok).toBe(true)
    expect(getTile(w, gx, gy)!.terrain).toBe(FARMLAND)
    expect(sim.state.stock.wood).toBe(5)
    expect(sim.state.consumed.wood).toBe(5)
    // 首次开垦记入纪事
    expect((sim.state.journal ?? []).some((e) => e.text.includes('农田'))).toBe(true)
  })

  it('非草地或木材不足时开垦失败，世界不变', () => {
    const sim = new Simulation(555)
    const w = sim.state.world
    // 找一块水（不可开垦）
    const waterIdx = w.tiles.findIndex((t) => t.terrain === 2)
    const wx = waterIdx % w.size
    const wy = (waterIdx / w.size) | 0
    sim.state.stock.wood = 3
    expect(sim.reclaimToFarmland(wx, wy)).toBe(false)
    expect(sim.state.stock.wood).toBe(3)

    // 草地但木材不足
    const grassIdx = w.tiles.findIndex((t) => t.terrain === GRASS)
    const gx = grassIdx % w.size
    const gy = (grassIdx / w.size) | 0
    expect(sim.reclaimToFarmland(gx, gy)).toBe(false)
    expect(getTile(w, gx, gy)!.terrain).toBe(GRASS)
  })

  it('农田再生速度显著高于普通草地（高产）', () => {
    const sim = new Simulation(808)
    const w = sim.state.world
    // 找草地开垦，另找一块普通草地作对照，双双采空
    let farmIdx = -1
    let grassIdx = -1
    for (let i = 0; i < w.tiles.length; i++) {
      const t = w.tiles[i]
      if (t.terrain === GRASS) {
        const x = i % w.size
        const y = (i / w.size) | 0
        const reserved = Math.abs(x + 0.5 - w.size / 2) <= 2.4 && Math.abs(y + 0.5 - w.size / 2) <= 2.4
        if (!reserved && farmIdx < 0) farmIdx = i
        else if (!reserved && grassIdx < 0) grassIdx = i
      }
      if (farmIdx >= 0 && grassIdx >= 0) break
    }
    sim.reclaimToFarmland(farmIdx % w.size, (farmIdx / w.size) | 0)
    const farm = w.tiles[farmIdx]
    const grass = w.tiles[grassIdx]
    expect(farm.terrain).toBe(FARMLAND)
    farm.resource = 0
    grass.resource = 0
    sim.state.villagers = [] // 隔离采集干扰
    for (let i = 0; i < 300; i++) sim.tick()
    expect(farm.resource).toBeGreaterThan(grass.resource * 2)
    expect(farm.resource).toBeLessThanOrEqual(farm.max)
    expect(resourceType(FARMLAND)).toBe('food')
  })

  it('居民优先采集农田（粮田是主粮源）', () => {
    const sim = new Simulation(313)
    const w = sim.state.world
    // 在中心附近造一块农田
    const cx = Math.floor(w.size / 2)
    const cy = Math.floor(w.size / 2) + 4
    w.tiles[cy * w.size + cx] = { terrain: FARMLAND, resource: 60, max: 60 }
    sim.state.stock.food = 0
    sim.state.stock.wood = 0
    sim.state.stock.stone = 0
    let minResource = 60
    for (let i = 0; i < 800; i++) {
      sim.tick()
      const r = w.tiles[cy * w.size + cx].resource
      if (r < minResource) minResource = r
    }
    // 农田被采过（存量被取走），且存粮从 0 回涨说明食物在进账
    expect(minResource).toBeLessThan(60)
    expect(sim.state.stock.food + sim.state.consumed.food).toBeGreaterThan(40)
  })
})
