import { BLOCK_SIZE } from '../sim/plot/config'
import { ZONE_COLORS, gridSize } from '../sim/plot/blocks'
import type { Block, Overlay, PlotState } from '../sim/plot/types'
import {
  DESERT,
  FOREST,
  GRASS,
  HILLS,
  MOUNTAIN,
  SNOW,
  STONE,
  WATER,
  WETLAND,
  type World,
} from '../sim/world'
import { TILE, type Camera } from './camera'
import type { View } from './draw'

const TERRAIN_COLORS = ['#6d9949', '#345f35', '#4385a7', '#938877', '#b59a4b', '#d0b174', '#d2e0e4', '#638c7a', '#959b67', '#667480']

const HOUSE_BODY = ['#8a6a45', '#a8814f', '#b9744e', '#7d8b96', '#9fb3c8']
const HOUSE_ROOF = ['#6b4f34', '#8a5b3a', '#8f4438', '#5d6b78', '#7a8fa6']

export interface Walker {
  x: number
  y: number
  from: number
  to: number
  t: number
  speed: number
  tone: number
}

export function createWalkers(state: PlotState, count: number, rng: () => number): Walker[] {
  const bg = gridSize(state.world)
  const claimed = state.blocks.filter((b) => b.settlement >= 0)
  if (claimed.length === 0) return []
  const out: Walker[] = []
  for (let i = 0; i < count; i++) {
    const b = claimed[Math.floor(rng() * claimed.length)]
    const x = (b.bx + rng()) * BLOCK_SIZE
    const y = (b.by + rng()) * BLOCK_SIZE
    out.push({ x, y, from: -1, to: -1, t: 0, speed: 0.4 + rng() * 0.5, tone: Math.floor(rng() * 4) })
  }
  void bg
  return out
}

/** 居民动画：只做表现，沿道路边在区块之间走动 */
export function updateWalkers(state: PlotState, walkers: Walker[], dt: number): void {
  const bg = gridSize(state.world)
  for (const w of walkers) {
    if (w.to < 0) {
      pickTarget(state, w, bg)
      continue
    }
    w.t += dt * w.speed
    if (w.t >= 1) {
      const target = state.blocks[w.to]
      w.x = (target.bx + 0.5) * BLOCK_SIZE
      w.y = (target.by + 0.5) * BLOCK_SIZE
      pickTarget(state, w, bg)
      continue
    }
    const from = state.blocks[w.from]
    const to = state.blocks[w.to]
    const fx = (from.bx + 0.5) * BLOCK_SIZE
    const fy = (from.by + 0.5) * BLOCK_SIZE
    const tx = (to.bx + 0.5) * BLOCK_SIZE
    const ty = (to.by + 0.5) * BLOCK_SIZE
    w.x = fx + (tx - fx) * w.t
    w.y = fy + (ty - fy) * w.t
  }
}

function pickTarget(state: PlotState, w: Walker, bg: number): void {
  const bx = Math.floor(w.x / BLOCK_SIZE)
  const by = Math.floor(w.y / BLOCK_SIZE)
  const index = by * bg + bx
  const options: number[] = []
  if (bx > 0 && state.vRoad[index] > 0) options.push(index - 1)
  if (bx < bg - 1 && state.vRoad[index + 1] > 0) options.push(index + 1)
  if (by > 0 && state.hRoad[index] > 0) options.push(index - bg)
  if (by < bg - 1 && state.hRoad[index + bg] > 0) options.push(index + bg)
  if (options.length === 0) {
    w.from = -1
    w.to = -1
    return
  }
  w.from = index
  w.to = options[Math.floor(rand01(w.x * 7 + w.y * 13) * options.length)]
  w.t = 0
}

function rand01(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

function tintFor(overlay: Overlay, block: Block): string | null {
  if (overlay === 'zone') return block.zone === 'none' ? null : ZONE_COLORS[block.zone]
  if (overlay === 'coverage') {
    const avg = (block.covered.market + block.covered.school + block.covered.clinic + block.covered.park + block.covered.water) / 5
    return `rgba(86,196,120,${(0.08 + avg * 0.55).toFixed(3)})`
  }
  if (overlay === 'landValue') return `rgba(224,168,60,${(0.06 + block.landValue * 0.6).toFixed(3)})`
  if (overlay === 'pollution') return block.pollution > 0.01 ? `rgba(200,70,60,${Math.min(0.6, block.pollution * 0.4).toFixed(3)})` : null
  return null
}

export function drawPlot(
  ctx: CanvasRenderingContext2D,
  state: PlotState,
  cam: Camera,
  view: View,
  timeMs: number,
  walkers: Walker[],
  selection: number,
): void {
  const bg = gridSize(state.world)
  const z = cam.zoom
  const sps = TILE * z
  // 可见区块范围（cam 是世界瓦片坐标，必须先换算成区块坐标再裁剪）
  const halfBlocksX = view.w / 2 / sps / BLOCK_SIZE
  const halfBlocksY = view.h / 2 / sps / BLOCK_SIZE
  const firstX = Math.max(0, Math.floor(cam.x / BLOCK_SIZE - halfBlocksX) - 1)
  const lastX = Math.min(bg - 1, Math.ceil(cam.x / BLOCK_SIZE + halfBlocksX) + 1)
  const firstY = Math.max(0, Math.floor(cam.y / BLOCK_SIZE - halfBlocksY) - 1)
  const lastY = Math.min(bg - 1, Math.ceil(cam.y / BLOCK_SIZE + halfBlocksY) + 1)

  // 1. 区块底色（分区/图层）
  if (state.overlay !== 'none') {
    for (let by = firstY; by <= lastY; by++) {
      for (let bx = firstX; bx <= lastX; bx++) {
        const block = state.blocks[by * bg + bx]
        const tint = tintFor(state.overlay, block)
        if (!tint) continue
        ctx.fillStyle = tint
        ctx.fillRect(bx * BLOCK_SIZE * TILE, by * BLOCK_SIZE * TILE, BLOCK_SIZE * TILE, BLOCK_SIZE * TILE)
      }
    }
  }

  // 2. 建筑
  for (let by = firstY; by <= lastY; by++) {
    for (let bx = firstX; bx <= lastX; bx++) {
      const block = state.blocks[by * bg + bx]
      if (block.buildings.length === 0) continue
      const ox = bx * BLOCK_SIZE * TILE
      const oy = by * BLOCK_SIZE * TILE
      for (const b of block.buildings) {
        drawBuilding(ctx, b, ox, oy, block, timeMs)
      }
    }
  }

  // 3. 居民
  for (const w of walkers) {
    const px = w.x * TILE
    const py = w.y * TILE
    if (px < cam.x * TILE - view.w / 2 / z - 32 || px > cam.x * TILE + view.w / 2 / z + 32) continue
    if (py < cam.y * TILE - view.h / 2 / z - 32 || py > cam.y * TILE + view.h / 2 / z + 32) continue
    const bob = Math.sin((timeMs * 0.008 + w.tone) + w.t) * 0.6
    ctx.fillStyle = ['#e8d7a8', '#d7b98a', '#c9d3a0', '#a9b7c9'][w.tone % 4]
    ctx.fillRect(px - 2, py - 3 + bob, 4, 5)
    ctx.fillStyle = '#2b2a22'
    ctx.fillRect(px - 2, py + 2 + bob, 4, 1)
  }

  // 4. 道路（画在建筑之上，视觉上形成街网）
  for (let by = firstY; by <= lastY + 1; by++) {
    for (let bx = firstX; bx <= lastX + 1; bx++) {
      const x0 = bx * BLOCK_SIZE * TILE
      const y0 = by * BLOCK_SIZE * TILE
      if (bx > 0 && bx < bg && by < bg) {
        const level = state.vRoad[by * bg + bx]
        if (level > 0) {
          const width = level >= 3 ? 6 : level === 2 ? 4 : 2.5
          ctx.fillStyle = level >= 3 ? '#6b6459' : level === 2 ? '#7d7467' : '#8a7f6c'
          ctx.fillRect(x0 - width / 2, y0, width, BLOCK_SIZE * TILE)
        }
      }
      if (by > 0 && by < bg && bx < bg) {
        const level = state.hRoad[by * bg + bx]
        if (level > 0) {
          const width = level >= 3 ? 6 : level === 2 ? 4 : 2.5
          ctx.fillStyle = level >= 3 ? '#6b6459' : level === 2 ? '#7d7467' : '#8a7f6c'
          ctx.fillRect(x0, y0 - width / 2, BLOCK_SIZE * TILE, width)
        }
      }
    }
  }

  // 5. 中央广场与选中高亮
  if (selection >= 0) {
    const b = state.blocks[selection]
    ctx.strokeStyle = '#f4b93e'
    ctx.lineWidth = 2
    ctx.strokeRect(b.bx * BLOCK_SIZE * TILE + 1, b.by * BLOCK_SIZE * TILE + 1, BLOCK_SIZE * TILE - 2, BLOCK_SIZE * TILE - 2)
  }
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  b: { kind: string; tx: number; ty: number; w: number; h: number; level: number },
  ox: number,
  oy: number,
  block: Block,
  timeMs: number,
): void {
  const x = ox + b.tx * TILE
  const y = oy + b.ty * TILE
  const w = b.w * TILE
  const h = b.h * TILE
  switch (b.kind) {
    case 'house': {
      const level = Math.max(1, Math.min(4, block.density))
      ctx.fillStyle = HOUSE_BODY[level]
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4)
      ctx.fillStyle = HOUSE_ROOF[level]
      ctx.fillRect(x + 2, y + 2, w - 4, Math.max(3, h * 0.22))
      if (level >= 3) {
        // 高层：窗格
        ctx.fillStyle = level >= 4 ? 'rgba(226,240,255,0.35)' : 'rgba(40,44,40,0.35)'
        for (let wy = y + h * 0.3; wy < y + h - 5; wy += 6) ctx.fillRect(x + 4, wy, w - 8, 2)
      }
      break
    }
    case 'field': {
      ctx.fillStyle = '#7fae4e'
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = 'rgba(58,86,34,0.55)'
      for (let i = 3; i < w; i += 6) ctx.fillRect(x + i, y + 2, 1.5, h - 4)
      break
    }
    case 'farmhouse':
      ctx.fillStyle = '#a8814f'
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = '#7a4b32'
      ctx.fillRect(x, y, w, 4)
      break
    case 'factory': {
      ctx.fillStyle = '#8d9099'
      ctx.fillRect(x + 2, y + 4, w - 4, h - 6)
      ctx.fillStyle = '#6b7078'
      ctx.fillRect(x + w * 0.2, y - 6, 6, 12)
      const smoke = Math.sin(timeMs * 0.001 + x) * 2
      ctx.fillStyle = 'rgba(220,220,220,0.35)'
      ctx.fillRect(x + w * 0.2 + smoke, y - 14, 8, 8)
      break
    }
    case 'quarry':
      ctx.fillStyle = '#7a6a55'
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4)
      ctx.fillStyle = '#5b4d3c'
      ctx.fillRect(x + 8, y + 8, w - 16, h - 16)
      break
    case 'hut':
      ctx.fillStyle = '#6d5a3f'
      ctx.fillRect(x, y, w, h)
      break
    case 'park': {
      ctx.fillStyle = '#4f8f57'
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = '#2f6b3c'
      for (let i = 0; i < 6; i++) {
        const tx = x + 6 + ((i * 37) % Math.max(8, w - 12))
        const ty = y + 6 + ((i * 53) % Math.max(8, h - 12))
        ctx.beginPath()
        ctx.arc(tx, ty, 7, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    default: {
      drawCivic(ctx, b.kind, x, y, w, h, block)
    }
  }
}

function drawCivic(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, w: number, h: number, block: Block): void {
  const cx = x + w / 2
  const cy = y + h / 2
  switch (kind) {
    case 'plaza':
      ctx.fillStyle = '#b8a882'
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = '#e0a83c'
      ctx.beginPath()
      ctx.arc(cx, cy, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#8a5b2a'
      ctx.fillRect(cx - 1.5, cy - 12, 3, 8)
      break
    case 'market':
      ctx.fillStyle = '#c8843f'
      ctx.fillRect(x + 2, y + h * 0.3, w - 4, h * 0.55)
      ctx.fillStyle = '#8f4a2f'
      ctx.fillRect(x + 2, y + h * 0.3, w - 4, 5)
      ctx.fillStyle = '#e6cf9a'
      for (let i = x + 6; i < x + w - 6; i += 8) ctx.fillRect(i, y + h * 0.5, 4, 6)
      break
    case 'granary':
      ctx.fillStyle = '#b9a06a'
      ctx.fillRect(x + w * 0.15, y + h * 0.25, w * 0.7, h * 0.65)
      ctx.fillStyle = '#8d7748'
      ctx.fillRect(x + w * 0.15, y + h * 0.25, w * 0.7, 6)
      break
    case 'workshop':
      ctx.fillStyle = '#8a7358'
      ctx.fillRect(x + 3, y + h * 0.35, w - 6, h * 0.55)
      ctx.fillStyle = '#6b5942'
      ctx.fillRect(x + w * 0.2, y + h * 0.1, 8, 12)
      break
    case 'school':
      ctx.fillStyle = '#c8b48c'
      ctx.fillRect(x + 2, y + h * 0.3, w - 4, h * 0.6)
      ctx.fillStyle = '#7a5a3a'
      ctx.fillRect(x + 2, y + h * 0.3, w - 4, 5)
      ctx.fillStyle = '#3f6fa8'
      ctx.fillRect(cx - 1, y + h * 0.05, 2, h * 0.3)
      ctx.fillRect(cx - 1, y + h * 0.05, 10, 6)
      break
    case 'clinic':
      ctx.fillStyle = '#dfe4e0'
      ctx.fillRect(x + 3, y + h * 0.25, w - 6, h * 0.65)
      ctx.fillStyle = '#b8443c'
      ctx.fillRect(cx - 2, cy - 6, 4, 14)
      ctx.fillRect(cx - 7, cy - 1, 14, 4)
      break
    case 'waterworks':
      ctx.fillStyle = '#7f8fa6'
      ctx.fillRect(x + w * 0.2, y + h * 0.3, w * 0.6, h * 0.55)
      ctx.fillStyle = '#5d8fc0'
      ctx.beginPath()
      ctx.arc(cx, y + h * 0.28, w * 0.28, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'powerplant':
      ctx.fillStyle = '#6f747c'
      ctx.fillRect(x + 3, y + h * 0.35, w - 6, h * 0.55)
      ctx.fillStyle = '#565b62'
      ctx.fillRect(cx - 5, y + h * 0.05, 10, h * 0.35)
      ctx.strokeStyle = 'rgba(240,240,200,0.5)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx - 8, y)
      ctx.lineTo(cx + 8, y)
      ctx.stroke()
      break
    default:
      ctx.fillStyle = '#9aa39a'
      ctx.fillRect(x + 4, y + 4, w - 8, h - 8)
  }
  void block
}

/** 缩略图：地形 + 分区 + 路网 + 视口框 */
export function drawPlotMiniMap(canvas: HTMLCanvasElement, state: PlotState, cam: Camera, view: View): void {
  const bg = gridSize(state.world)
  const size = canvas.width
  const cell = size / bg
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, size, size)
  const world: World = state.world
  const step = Math.max(1, Math.floor(world.size / bg))
  for (let by = 0; by < bg; by++) {
    for (let bx = 0; bx < bg; bx++) {
      const terrain = world.tiles[(by * step + Math.floor(step / 2)) * world.size + (bx * step + Math.floor(step / 2))].terrain
      ctx.fillStyle = TERRAIN_COLORS[terrain] ?? '#6d9949'
      ctx.fillRect(bx * cell, by * cell, cell + 0.6, cell + 0.6)
    }
  }
  for (let by = 0; by < bg; by++) {
    for (let bx = 0; bx < bg; bx++) {
      const block = state.blocks[by * bg + bx]
      if (block.zone === 'residential') ctx.fillStyle = '#e0a83c'
      else if (block.zone === 'agriculture') ctx.fillStyle = '#a8c46a'
      else if (block.zone === 'industry') ctx.fillStyle = '#8d9099'
      else if (block.zone === 'civic') ctx.fillStyle = '#6ca8d6'
      else if (block.zone === 'park') ctx.fillStyle = '#4f8f57'
      else continue
      ctx.fillRect(bx * cell, by * cell, cell, cell)
    }
  }
  ctx.fillStyle = 'rgba(40,36,28,0.9)'
  for (let by = 0; by < bg; by++) {
    for (let bx = 0; bx < bg; bx++) {
      if (bx < bg - 1 && state.vRoad[by * bg + bx + 1] > 0) ctx.fillRect((bx + 1) * cell - 0.4, by * cell, 0.8, cell)
      if (by < bg - 1 && state.hRoad[(by + 1) * bg + bx] > 0) ctx.fillRect(bx * cell, (by + 1) * cell - 0.4, cell, 0.8)
    }
  }
  const sps = TILE * cam.zoom
  const halfW = view.w / 2 / sps / BLOCK_SIZE
  const halfH = view.h / 2 / sps / BLOCK_SIZE
  const scale = cell / 1
  ctx.strokeStyle = '#f4f9ff'
  ctx.lineWidth = 1
  ctx.strokeRect(
    (cam.x / BLOCK_SIZE - halfW) * scale,
    (cam.y / BLOCK_SIZE - halfH) * scale,
    halfW * 2 * scale,
    halfH * 2 * scale,
  )
}

/** 地形像素图（与旧模式共用 terrain.ts 的离屏画布） */
export function terrainColor(terrain: number): string {
  return TERRAIN_COLORS[terrain] ?? '#6d9949'
}

export const TERRAIN_IDS = { GRASS, FOREST, WATER, STONE, HILLS, MOUNTAIN, DESERT, SNOW, WETLAND }
