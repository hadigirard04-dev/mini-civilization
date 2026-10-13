import { createRng, type Rng } from '../sim/rng'
import {
  FARMLAND,
  FOREST,
  GRASS,
  STONE,
  WATER,
  DESERT,
  SNOW,
  WETLAND,
  HILLS,
  MOUNTAIN,
  type World,
} from '../sim/world'
import { TILE } from './camera'

/** 地形配色：自然、分层的像素风 */
const GRASS_BASES = ['#74a246', '#6f9c42', '#7aa84c']
const GRASS_DARK = '#5f8c37'
const GRASS_LIGHT = '#8cb75b'
const FOREST_FLOOR = '#4c7733'
const FOREST_FLOOR_DARK = '#416829'
const TRUNK = '#54402a'
const CANOPY = ['#2f5426', '#3a6830', '#477c3d']
const WATER_BASE = '#2f6f9e'
const WATER_BAND = '#3778a9'
const WATER_DEEP = '#2a628e'
const WATER_LIGHT = '#5b9bc7'
const STONE_BASES = ['#8b8676', '#807b6c']
const STONE_DARK = '#676255'
const STONE_LIGHT = '#a09b8a'
const SAND = '#a99a6e'

function fillBase(ctx: CanvasRenderingContext2D, px: number, py: number, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(px, py, TILE, TILE)
}

function speckle(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  color: string,
  count: number,
  rng: Rng,
): void {
  ctx.fillStyle = color
  for (let i = 0; i < count; i++) {
    ctx.fillRect(px + rng.nextInt(TILE), py + rng.nextInt(TILE), 1, 1)
  }
}

function drawTree(ctx: CanvasRenderingContext2D, tx: number, ty: number, rng: Rng): void {
  // 逐树抖动位置与形态，避免整片森林网格感
  const ox = rng.nextInt(5) - 2
  const oy = rng.nextInt(5) - 2
  const kind = rng.nextInt(4)
  if (kind === 3) {
    // 灌木：低矮两团
    ctx.fillStyle = CANOPY[0]
    ctx.fillRect(tx + 2 + ox, ty + 7 + oy, 7, 5)
    ctx.fillStyle = CANOPY[2]
    ctx.fillRect(tx + 4 + ox, ty + 6 + oy, 4, 3)
    return
  }
  const big = kind === 0
  const w = big ? 9 : 7
  const h = big ? 7 : 5
  // 树干
  ctx.fillStyle = TRUNK
  ctx.fillRect(tx + 4 + ox, ty + 9 + oy, 2, 4)
  // 树冠三层
  ctx.fillStyle = kind === 2 ? '#2a4a22' : CANOPY[0]
  ctx.fillRect(tx + (big ? 1 : 2) + ox, ty + (big ? 3 : 5) + oy, w, h)
  ctx.fillStyle = CANOPY[1]
  ctx.fillRect(tx + (big ? 2 : 3) + ox, ty + (big ? 2 : 4) + oy, w - 2, h - 2)
  ctx.fillStyle = CANOPY[2]
  ctx.fillRect(tx + 3 + ox, ty + (big ? 1 : 3) + oy, 3 + rng.nextInt(2), 3)
}

function drawTile(ctx: CanvasRenderingContext2D, world: World, x: number, y: number, rng: Rng): void {
  const tile = world.tiles[y * world.size + x]
  const px = x * TILE
  const py = y * TILE
  const alt = (x + y) % 2 === 0

  switch (tile.terrain) {
    case GRASS: {
      fillBase(ctx, px, py, alt ? GRASS_BASES[0] : GRASS_BASES[1])
      speckle(ctx, px, py, GRASS_DARK, 6, rng)
      speckle(ctx, px, py, GRASS_LIGHT, 5, rng)
      if (rng.next() < 0.3) {
        ctx.fillStyle = GRASS_BASES[2]
        ctx.fillRect(px + rng.nextInt(12), py + rng.nextInt(12), 2, 2)
      }
      break
    }
    case FOREST: {
      fillBase(ctx, px, py, FOREST_FLOOR)
      speckle(ctx, px, py, FOREST_FLOOR_DARK, 7, rng)
      const trees = rng.next() < 0.4 ? 2 : 1
      drawTree(ctx, px + (trees === 1 ? 2 : 0), py + (trees === 1 ? 2 : 0), rng)
      if (trees === 2) drawTree(ctx, px + 8, py + 6, rng)
      break
    }
    case WATER: {
      fillBase(ctx, px, py, alt ? WATER_BASE : WATER_BAND)
      for (let r = 2; r < TILE; r += 5) {
        ctx.fillStyle = WATER_DEEP
        ctx.fillRect(px, py + r, TILE, 1)
      }
      speckle(ctx, px, py, WATER_LIGHT, 3, rng)
      // 湖岸朝向陆地一侧加沙边
      const neighbors = [
        { dx: 0, dy: -1, edge: [0, 0, TILE, 2] },
        { dx: 0, dy: 1, edge: [0, TILE - 2, TILE, 2] },
        { dx: -1, dy: 0, edge: [0, 0, 2, TILE] },
        { dx: 1, dy: 0, edge: [TILE - 2, 0, 2, TILE] },
      ]
      ctx.fillStyle = SAND
      for (const n of neighbors) {
        const nx = x + n.dx
        const ny = y + n.dy
        if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue
        const nt = world.tiles[ny * world.size + nx]
        if (nt.terrain !== WATER) ctx.fillRect(px + n.edge[0], py + n.edge[1], n.edge[2], n.edge[3])
      }
      break
    }
    case STONE: {
      fillBase(ctx, px, py, alt ? STONE_BASES[0] : STONE_BASES[1])
      ctx.fillStyle = STONE_DARK
      ctx.fillRect(px + 2 + rng.nextInt(6), py + 3 + rng.nextInt(6), 3 + rng.nextInt(3), 2)
      speckle(ctx, px, py, STONE_LIGHT, 5, rng)
      break
    }
    case DESERT: {
      fillBase(ctx, px, py, alt ? '#c9ac70' : '#d6ba7f')
      speckle(ctx, px, py, '#b6995f', 4, rng)
      ctx.fillStyle = '#e4cd96'
      ctx.fillRect(px + 2, py + 7, 11, 1)
      break
    }
    case SNOW: {
      fillBase(ctx, px, py, alt ? '#d0dee3' : '#bdced8')
      speckle(ctx, px, py, '#eaf3ef', 5, rng)
      ctx.fillStyle = '#91a6b5'
      ctx.fillRect(px + 3, py + 10, 6, 2)
      break
    }
    case WETLAND: {
      fillBase(ctx, px, py, '#688d77')
      ctx.fillStyle = '#43848d'
      ctx.fillRect(px + 2, py + 6, 11, 5)
      ctx.fillStyle = '#b9ad62'
      ctx.fillRect(px + 3, py + 2, 1, 7)
      ctx.fillRect(px + 10, py + 4, 1, 6)
      break
    }
    case HILLS: {
      fillBase(ctx, px, py, '#90945d')
      ctx.fillStyle = '#787d51'
      ctx.fillRect(px + 2, py + 5, 12, 8)
      ctx.fillStyle = '#abb47d'
      ctx.fillRect(px + 5, py + 2, 6, 6)
      break
    }
    case MOUNTAIN: {
      fillBase(ctx, px, py, '#716f71')
      ctx.fillStyle = '#525e67'
      ctx.beginPath()
      ctx.moveTo(px, py + 15)
      ctx.lineTo(px + 8, py - 3)
      ctx.lineTo(px + 16, py + 15)
      ctx.fill()
      ctx.fillStyle = '#d1dbdf'
      ctx.fillRect(px + 6, py, 4, 4)
      break
    }
    case FARMLAND: {
      // 深棕耕地 + 横向垄沟 + 零星绿芽
      fillBase(ctx, px, py, '#6b4a2a')
      ctx.fillStyle = '#5a3d21'
      for (let r = 1; r < TILE; r += 4) {
        ctx.fillRect(px, py + r, TILE, 2)
      }
      ctx.fillStyle = '#d5be58'
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(px + 1 + rng.nextInt(TILE - 3), py + 1 + rng.nextInt(TILE - 3), 2, 1)
      }
      break
    }
  }
}

/** 离屏生成整张地形画布（世界变化时重建一次） */
const rendered = new WeakMap<HTMLCanvasElement, number[]>()
export function buildTerrainCanvas(world: World): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = world.size * TILE
  canvas.height = world.size * TILE
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const rng = createRng(world.seed ^ 0x1234567)
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      drawTile(ctx, world, x, y, rng)
    }
  }
  rendered.set(
    canvas,
    world.tiles.map((t) => t.terrain),
  )
  return canvas
}

/** 仅重画变化地块，避免 256×256 地图每次建设都重绘全图。 */
export function patchTerrainCanvas(canvas: HTMLCanvasElement, world: World): void {
  const old = rendered.get(canvas),
    ctx = canvas.getContext('2d')
  if (!old || !ctx) return
  for (let i = 0; i < old.length; i++)
    if (old[i] !== world.tiles[i].terrain) {
      drawTile(ctx, world, i % world.size, Math.floor(i / world.size), createRng(world.seed ^ (i * 73856093)))
      old[i] = world.tiles[i].terrain
    }
}
