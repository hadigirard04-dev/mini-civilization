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

/** 街区布局：在一格里铺出成片的 1 格建筑（视觉密度随等级提高） */
function scatterBuildings(
  out: BlockBuilding[],
  kind: string,
  count: number,
  rng: Rng,
  slots = 6,
  spacing = 1.3,
): void {
  const cells: Array<[number, number]> = []
  for (let j = 0; j < slots; j++) {
    for (let i = 0; i < slots; i++) cells.push([0.4 + i * spacing, 0.4 + j * spacing])
  }
  // 洗牌后取前 count 个，位置在同一小区块内稳定（同一 rng 序列可复现）
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    const tmp = cells[i]
    cells[i] = cells[j]
    cells[j] = tmp
  }
  for (let i = 0; i < Math.min(count, cells.length); i++) {
    const [tx, ty] = cells[i]
    out.push({ kind, tx, ty, w: 1, h: 1 })
  }
}

/** 建筑描述符：仅渲染用，zone/density 变化时重建 */
export function rebuildBlockBuildings(block: Block, rng: Rng): void {
  const out: BlockBuilding[] = []
  if (block.zone === 'residential' && block.density > 0) {
    scatterBuildings(out, 'house', [0, 9, 16, 24, 32][Math.min(4, block.density)], rng, 8, 0.82)
  } else if (block.zone === 'agriculture' && block.density > 0) {
    const patches = 1 + Math.min(3, block.density - 1)
    for (let i = 0; i < patches; i++) {
      const gx = i % 2
      const gy = Math.floor(i / 2) % 2
      out.push({ kind: 'field', tx: 0.3 + gx * 3.6, ty: 0.3 + gy * 3.6, w: 3.4, h: 3.4 })
    }
    out.push({ kind: 'farmhouse', tx: 6.2, ty: 6.2, w: 1, h: 1 })
  } else if (block.zone === 'industry' && block.density > 0) {
    const kind = block.industry === 'quarry' ? 'quarry' : 'factory'
    out.push({ kind, tx: 3.5, ty: 4.5, w: 1, h: 1 })
    if (block.density >= 2) out.push({ kind, tx: 5.6, ty: 5.6, w: 1, h: 1 })
    if (block.density >= 3) out.push({ kind, tx: 2.2, ty: 5.8, w: 1, h: 1 })
  } else if (block.zone === 'civic' && block.civic) {
    const art: Record<string, string> = { plaza: 'campfire', waterworks: 'well' }
    out.push({ kind: art[block.civic] ?? block.civic, tx: 3.5, ty: 4.5, w: 1, h: 1 })
  } else if (block.zone === 'park' && block.density > 0) {
    scatterBuildings(out, 'park', 4 + block.density, rng, 5, 1.5)
  } else if (block.zone === 'none') {
    if (block.hasForest || block.hasOre) {
      scatterBuildings(out, 'hut', 2, rng, 4, 2.2)
    }
  }
  block.buildings = out
}

/** 区块住房容量（按等级） */
export function housingCapacityOf(block: Block): number {
  return block.zone === 'residential' ? PLOT.housingCapacity[Math.min(4, block.density)] : 0
}
