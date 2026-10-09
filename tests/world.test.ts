import { describe, expect, it } from 'vitest'
import { FOREST, GRASS, STONE, WATER, generateWorld } from '../src/sim/world'

describe('世界生成', () => {
  it('同一随机种子生成相同的初始地图', () => {
    const a = generateWorld(20261009)
    const b = generateWorld(20261009)
    expect(a.size).toBe(64)
    expect(a.seed).toBe(20261009)
    expect(a.tiles.length).toBe(64 * 64)
    expect(a.tiles).toEqual(b.tiles)
  })

  it('不同随机种子生成不同的地图', () => {
    const a = generateWorld(1)
    const b = generateWorld(2)
    expect(a.tiles).not.toEqual(b.tiles)
  })

  it('地图包含草地、森林、水域和石地，且资源量始终非负并在上限内', () => {
    const w = generateWorld(42)
    const kinds = new Set(w.tiles.map((t) => t.terrain))
    expect(kinds.has(GRASS)).toBe(true)
    expect(kinds.has(FOREST)).toBe(true)
    expect(kinds.has(WATER)).toBe(true)
    expect(kinds.has(STONE)).toBe(true)
    for (const t of w.tiles) {
      expect(t.resource).toBeGreaterThanOrEqual(0)
      expect(t.resource).toBeLessThanOrEqual(t.max)
      if (t.terrain === WATER) {
        expect(t.resource).toBe(0)
        expect(t.max).toBe(0)
      }
    }
  })
})
