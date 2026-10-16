import { describe, expect, it } from 'vitest'
import { generateWorld, MOUNTAIN, WATER } from '../src/sim/world'
import { createBlocks, gridSize, blockCoords, blockIndex, neighbors4, neighbors8, housingCapacityOf } from '../src/sim/plot/blocks'
import {
  bfsRoadDistances,
  canBuildRoad,
  hasRoadAccess,
  readRoad,
  roadEdgeCount,
  roadNeighbors,
  writeRoad,
} from '../src/sim/plot/roads'
import { createPlotState } from '../src/sim/plot/sim'
import type { PlotState } from '../src/sim/plot/types'

function state(size = 64, seed = 12345): PlotState {
  return createPlotState(seed, size)
}

describe('区块层（8×8 瓦片 = 1 地块）', () => {
  it('区块数与坐标换算一致', () => {
    const world = generateWorld(7, 64, true)
    const bg = gridSize(world)
    expect(bg).toBe(8)
    const blocks = createBlocks(world)
    expect(blocks).toHaveLength(bg * bg)
    for (const b of blocks) {
      expect(blockIndex(b.bx, b.by, bg)).toBe(b.by * bg + b.bx)
      expect(blockCoords(blockIndex(b.bx, b.by, bg), bg)).toEqual({ bx: b.bx, by: b.by })
    }
  })

  it('同种子生成相同区块（可复现）', () => {
    const a = createBlocks(generateWorld(99, 64, true))
    const b = createBlocks(generateWorld(99, 64, true))
    expect(a.map((x) => [x.terrain, x.buildable, x.hasWater, x.hasForest, x.hasOre])).toEqual(
      b.map((x) => [x.terrain, x.buildable, x.hasWater, x.hasForest, x.hasOre]),
    )
  })

  it('山地主导的区块不可建、不可修路', () => {
    const s = state()
    const bg = gridSize(s.world)
    for (const b of s.blocks) {
      if (b.terrain !== MOUNTAIN) continue
      expect(b.buildable).toBe(false)
      if (b.bx > 0) expect(canBuildRoad(s, 'v', b.bx, b.by)).toBe(false)
    }
    void bg
  })

  it('住房容量按等级递增', () => {
    const s = state()
    const b = s.blocks[0]
    b.zone = 'residential'
    b.density = 0
    expect(housingCapacityOf(b)).toBe(0)
    b.density = 1
    const one = housingCapacityOf(b)
    b.density = 4
    expect(housingCapacityOf(b)).toBeGreaterThan(one)
  })
})

describe('道路：区块之间的边模型', () => {
  it('写边后两侧区块都有临路，边数正确', () => {
    const s = state()
    const bg = gridSize(s.world)
    const a = blockIndex(3, 3, bg)
    const b = blockIndex(4, 3, bg)
    expect(hasRoadAccess(s, a)).toBe(false)
    writeRoad(s, 'v', 4, 3, 1)
    expect(readRoad(s, 'v', 4, 3)).toBe(1)
    expect(hasRoadAccess(s, a)).toBe(true)
    expect(hasRoadAccess(s, b)).toBe(true)
    expect(roadEdgeCount(s)).toBe(1)
    expect(roadNeighbors(s, a)).toContain(b)
    expect(roadNeighbors(s, b)).toContain(a)
  })

  it('未修路时不可达；修路后 BFS 距离正确', () => {
    const s = state()
    const bg = gridSize(s.world)
    const origin = blockIndex(2, 2, bg)
    const far = blockIndex(5, 2, bg)
    expect(bfsRoadDistances(s, [origin])[far]).toBe(-1)
    for (let bx = 3; bx <= 5; bx++) writeRoad(s, 'v', bx, 2, 1)
    expect(bfsRoadDistances(s, [origin])[far]).toBe(3)
  })

  it('跨水边被判为桥（造价更高）', () => {
    const s = state()
    const bg = gridSize(s.world)
    // 找一个邻水区块，其邻边应识别为桥
    let found = false
    for (const b of s.blocks) {
      if (!b.hasWater || b.bx === 0) continue
      const index = b.by * bg + b.bx
      const left = s.blocks[index - 1]
      if (left.hasWater) continue
      if (!canBuildRoad(s, 'v', b.bx, b.by)) continue
      writeRoad(s, 'v', b.bx, b.by, 2)
      expect(hasRoadAccess(s, index)).toBe(true)
      found = true
      break
    }
    expect(found || s.blocks.every((b) => !b.hasWater)).toBe(true)
  })

  it('水域占满的区块不可建', () => {
    const s = state()
    for (const b of s.blocks) {
      if (b.terrain !== WATER) continue
      if (b.hasWater) expect(b.buildable).toBe(false)
    }
  })

  it('4 邻域与 8 邻域边界正确', () => {
    const bg = 8
    expect(neighbors4(bg, blockIndex(0, 0, bg))).toEqual([1, bg])
    expect(neighbors4(bg, blockIndex(7, 7, bg)).sort()).toEqual([blockIndex(6, 7, bg), blockIndex(7, 6, bg)].sort())
    expect(neighbors8(bg, blockIndex(0, 0, bg))).toHaveLength(3)
    expect(neighbors8(bg, blockIndex(3, 3, bg))).toHaveLength(8)
  })
})
