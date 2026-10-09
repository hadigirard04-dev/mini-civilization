import { describe, expect, it } from 'vitest'
import { findPath } from '../src/sim/path'
import { FOREST, GRASS, WATER, generateWorld, isWalkable, type Terrain, type Tile, type World } from '../src/sim/world'

/** 用字符串构造微型世界：# 为水域，其余为可通行草地 */
function miniWorld(rows: string[]): World {
  const size = rows.length
  const tiles: Tile[] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const terrain: Terrain = rows[y][x] === '#' ? WATER : GRASS
      tiles.push({ terrain, resource: 0, max: 0 })
    }
  }
  return { size, seed: 0, tiles }
}

/** 与实现同规格的独立校验：按格中心连线（连续坐标）逐格枚举，任何经过格不可为水域 */
function lineWalkable(w: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const sx = x0 + 0.5
  const sy = y0 + 0.5
  const ex = x1 + 0.5
  const ey = y1 + 0.5
  let ix = Math.floor(sx)
  let iy = Math.floor(sy)
  const dx = ex - sx
  const dy = ey - sy
  if (!isWalkable(w, ix, iy)) return false
  if (dx === 0 && dy === 0) return true
  const stepX = dx > 0 ? 1 : -1
  const stepY = dy > 0 ? 1 : -1
  const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx)
  const tDeltaY = dy === 0 ? Infinity : Math.abs(1 / dy)
  let tMaxX = dx === 0 ? Infinity : ((stepX > 0 ? ix + 1 : ix) - sx) / dx
  let tMaxY = dy === 0 ? Infinity : ((stepY > 0 ? iy + 1 : iy) - sy) / dy
  for (let guard = 0; guard < 400; guard++) {
    let t: number
    if (tMaxX < tMaxY) {
      t = tMaxX
      tMaxX += tDeltaX
      ix += stepX
    } else {
      t = tMaxY
      tMaxY += tDeltaY
      iy += stepY
    }
    if (t > 1 || Number.isNaN(t)) break
    if (!isWalkable(w, ix, iy)) return false
  }
  return true
}

describe('寻路', () => {
  it('绕开水域找到路径，每段连线不穿过水', () => {
    const w = miniWorld(['..#..', '..#..', '..#..', '.....', '..#..'])
    const path = findPath(w, 0, 0, 4, 0)
    expect(path).not.toBeNull()
    const p = path!
    expect(p.length).toBeGreaterThanOrEqual(2)
    expect(p.length).toBeLessThanOrEqual(6)
    expect(p[p.length - 1]).toEqual({ x: 4, y: 0 })
    let prev = { x: 0, y: 0 }
    for (const step of p) {
      expect(lineWalkable(w, prev.x, prev.y, step.x, step.y)).toBe(true)
      expect(isWalkable(w, step.x, step.y)).toBe(true)
      prev = step
    }
  })

  it('目标被水域完全隔断时返回 null', () => {
    const w = miniWorld(['.#.', '###'])
    expect(findPath(w, 0, 0, 2, 0)).toBeNull()
    expect(findPath(w, 0, 0, 1, 0)).toBeNull()
  })

  it('真实世界中从中心到可通行远点存在路径', () => {
    const w = generateWorld(3)
    let tx = -1
    let ty = -1
    search: for (let y = 4; y < 12; y++) {
      for (let x = 4; x < 12; x++) {
        const t = w.tiles[y * w.size + x]
        if ((t.terrain === GRASS || t.terrain === FOREST) && isWalkable(w, x, y)) {
          tx = x
          ty = y
          break search
        }
      }
    }
    expect(tx).toBeGreaterThanOrEqual(0)
    const path = findPath(w, 32, 32, tx, ty)
    expect(path).not.toBeNull()
    expect(path![path!.length - 1]).toEqual({ x: tx, y: ty })
  })
})
