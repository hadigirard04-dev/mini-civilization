import type { Rng } from '../rng'
import { FOREST, GRASS, HILLS, MOUNTAIN, STONE, WATER, WETLAND, type World } from '../world'
import { BLOCK_SIZE, PLOT } from './config'
import type { Block, BlockBuilding, Zone } from './types'

export const ZONE_COLORS: Record<Zone, string> = {
  none: 'rgba(0,0,0,0)',
  residential: 'rgba(224,168,60,0.30)',
  agriculture: 'rgba(127,174,78,0.32)',
  industry: 'rgba(154,163,173,0.32)',
  civic: 'rgba(108,168,214,0.34)',
  park: 'rgba(96,190,132,0.30)',
}

export const ZONE_LABELS: Record<Zone, string> = {
  none: '未开发',
  residential: '住宅区',
  agriculture: '农业区',
  industry: '工业区',
  civic: '公共设施',
  park: '公园',
}

/** 区块网格边长（区块数） */
export function gridSize(world: World): number {
  return Math.floor(world.size / BLOCK_SIZE)
}

export function blockIndex(bx: number, by: number, bg: number): number {
  return by * bg + bx
}

export function blockCoords(index: number, bg: number): { bx: number; by: number } {
  return { bx: index % bg, by: Math.floor(index / bg) }
}

/** 切比雪夫距离（区块） */
export function blockDistance(a: { bx: number; by: number }, b: { bx: number; by: number }): number {
  return Math.max(Math.abs(a.bx - b.bx), Math.abs(a.by - b.by))
}

/** 4 邻域（共享边） */
export function neighbors4(bg: number, index: number): number[] {
  const { bx, by } = blockCoords(index, bg)
  const out: number[] = []
  if (bx > 0) out.push(index - 1)
  if (bx < bg - 1) out.push(index + 1)
  if (by > 0) out.push(index - bg)
  if (by < bg - 1) out.push(index + bg)
  return out
}

/** 8 邻域（含对角）：工业与住宅的隔离判定用它 */
export function neighbors8(bg: number, index: number): number[] {
  const { bx, by } = blockCoords(index, bg)
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const x = bx + dx
      const y = by + dy
      if (x < 0 || y < 0 || x >= bg || y >= bg) continue
      out.push(blockIndex(x, y, bg))
    }
  }
  return out
}

function dominant(counts: number[]): number {
  let best = GRASS
  let bestCount = -1
  for (let t = 0; t < counts.length; t++) {
    if (counts[t] > bestCount) {
      bestCount = counts[t]
      best = t
    }
  }
  return best
}

/** 由世界瓦片聚合出区块层：主导地形 + 水/林/矿特征 + 可建性 */
export function createBlocks(world: World): Block[] {
  const bg = gridSize(world)
  const blocks: Block[] = new Array(bg * bg)
  for (let by = 0; by < bg; by++) {
    for (let bx = 0; bx < bg; bx++) {
      const counts = new Array(10).fill(0)
      for (let ty = 0; ty < BLOCK_SIZE; ty++) {
        for (let tx = 0; tx < BLOCK_SIZE; tx++) {
          const x = bx * BLOCK_SIZE + tx
          const y = by * BLOCK_SIZE + ty
          counts[world.tiles[y * world.size + x].terrain]++
        }
      }
      const terrain = dominant(counts)
      const waterCount = counts[WATER]
      const forestCount = counts[FOREST]
      const oreCount = counts[STONE] + counts[HILLS]
      const mountainCount = counts[MOUNTAIN]
      blocks[blockIndex(bx, by, bg)] = {
        bx,
        by,
        terrain,
        buildable: terrain !== MOUNTAIN && mountainCount < 24 && waterCount < 26,
        hasWater: waterCount >= 4,
        hasForest: forestCount >= 4,
        hasOre: oreCount >= 4,
        zone: 'none',
        density: 0,
        population: 0,
        jobs: 0,
        staffed: 0,
        civic: null,
        industry: null,
        buildings: [],
        covered: { market: 0, school: 0, clinic: 0, park: 0, water: 0, power: 0 },
        landValue: 0,
        pollution: 0,
        logistics: 1,
        construction: null,
        settlement: -1,
      }
    }
  }
  return blocks
}

/** 山地主导的区块不能修路（必须绕行） */
export function isMountainBlock(block: Block): boolean {
  return block.terrain === MOUNTAIN
}

/** 湿地/沙漠/雪地也能建，但产出偏弱（由 characteristic 记录在 terrain 里） */
export function isFertile(block: Block): boolean {
  return block.terrain === GRASS || block.terrain === WETLAND || block.terrain === FOREST
}

/** 建筑描述符：仅渲染用，zone/density 变化时重建 */
export function rebuildBlockBuildings(block: Block, rng: Rng): void {
  const out: BlockBuilding[] = []
  const push = (kind: string, tx: number, ty: number, w: number, h: number): void => {
    out.push({ kind, tx, ty, w, h, level: block.density })
  }
  if (block.zone === 'residential' && block.density > 0) {
    const size = block.density >= 3 ? 3 : 2
    const slots = [1, 1 + size + 1, 1 + (size + 1) * 2].filter((v) => v + size <= BLOCK_SIZE - 1)
    for (const ty of slots) {
      for (const tx of slots) {
        if (rng.next() < 0.18) continue
        push('house', tx, ty, size, size)
      }
    }
  } else if (block.zone === 'agriculture' && block.density > 0) {
    push('field', 0, 0, BLOCK_SIZE, BLOCK_SIZE)
    if (block.density >= 2) push('farmhouse', 5, 5, 2, 2)
  } else if (block.zone === 'industry' && block.density > 0) {
    if (block.industry === 'quarry') {
      push('quarry', 1, 2, 5, 4)
    } else {
      push('factory', 1, 2, 5, 4)
      if (block.density >= 2) push('factory', 5, 5, 2, 2)
    }
  } else if (block.zone === 'civic' && block.civic) {
    push(block.civic, 2, 2, 4, 4)
  } else if (block.zone === 'park' && block.density > 0) {
    push('park', 1, 1, 6, 6)
  } else if (block.zone === 'none') {
    if (block.hasForest) push('hut', 3, 3, 2, 2)
    else if (block.hasOre) push('hut', 3, 3, 2, 2)
  }
  block.buildings = out
}

/** 区块住房容量（按等级） */
export function housingCapacityOf(block: Block): number {
  return block.zone === 'residential' ? PLOT.housingCapacity[Math.min(4, block.density)] : 0
}
