import { BLOCK_SIZE } from '../sim/plot/config'
import { ZONE_COLORS, gridSize } from '../sim/plot/blocks'
import type { Block, Overlay, PlotState } from '../sim/plot/types'
import type { Building } from '../sim/types'
import { drawCivicBuilding, type ArtContext } from './city'
import { drawVillager, type VillagerSprite } from './entities'
import { TILE, type Camera } from './camera'
import type { View } from './draw'

const TERRAIN_COLORS = ['#6d9949', '#345f35', '#4385a7', '#938877', '#b59a4b', '#d0b174', '#d2e0e4', '#638c7a', '#959b67', '#667480']

/** 采样居民：只做表现，沿路网在区块之间流动 */
export interface Walker {
  x: number
  y: number
  from: number
  to: number
  t: number
  speed: number
  /** walk = 赶路；carry = 搬运；build = 施工 */
  state: 'walk' | 'carry' | 'build'
  wait: number
  id: number
  phase: number
  facing: 1 | -1
  carryType: 'food' | 'wood' | 'stone'
}

export function createWalkers(state: PlotState, count: number, rand: () => number): Walker[] {
  const claimed = state.blocks.filter((b) => b.settlement >= 0)
  if (claimed.length === 0) return []
  const out: Walker[] = []
  for (let i = 0; i < count; i++) {
    const b = claimed[Math.floor(rand() * claimed.length)]
    out.push({
      x: (b.bx + rand()) * BLOCK_SIZE,
      y: (b.by + rand()) * BLOCK_SIZE,
      from: -1,
      to: -1,
      t: 0,
      speed: 0.5 + rand() * 0.6,
      state: 'walk',
      wait: 0,
      id: i,
      phase: rand() * Math.PI * 2,
      facing: 1,
      carryType: rand() < 0.5 ? 'food' : 'wood',
    })
  }
  return out
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
    w.state = 'walk'
    return
  }
  const pick = options[Math.floor(rand01(w.x * 3.1 + w.y * 7.7 + w.id) * options.length)]
  w.from = index
  w.to = pick
  w.t = 0
  const target = state.blocks[pick]
  // 目的地属性决定表现：去工地 → 施工；去仓储/市场 → 搬货；其余 → 赶路
  if (target.construction) {
    w.state = 'build'
    w.wait = 1.6 + rand01(w.id * 2.3) * 2.4
  } else if (target.zone === 'civic' && (target.civic === 'market' || target.civic === 'granary' || target.civic === 'plaza')) {
    w.state = 'carry'
    w.carryType = ['food', 'wood', 'stone'][Math.floor(rand01(w.id * 5.7) * 3)] as Walker['carryType']
    w.wait = 0.6
  } else {
    w.state = 'walk'
    w.wait = 0
  }
}

function rand01(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

export function updateWalkers(state: PlotState, walkers: Walker[], dt: number): void {
  const bg = gridSize(state.world)
  for (const w of walkers) {
    if (w.state === 'build' && w.to >= 0 && w.t >= 1) {
      // 到了工地先干一会儿活
      w.wait -= dt
      if (w.wait <= 0) {
        w.state = 'walk'
        pickTarget(state, w, bg)
      }
      continue
    }
    if (w.to < 0) {
      pickTarget(state, w, bg)
      continue
    }
    const from = state.blocks[w.from]
    const to = state.blocks[w.to]
    const fx = (from.bx + 0.5) * BLOCK_SIZE
    const fy = (from.by + 0.5) * BLOCK_SIZE
    const tx = (to.bx + 0.5) * BLOCK_SIZE
    const ty = (to.by + 0.5) * BLOCK_SIZE
    const len = Math.max(0.001, Math.hypot(tx - fx, ty - fy))
    w.t = Math.min(1, w.t + (dt * w.speed) / len)
    w.phase += dt * 7
    w.x = fx + (tx - fx) * w.t
    w.y = fy + (ty - fy) * w.t
    w.facing = tx >= fx ? 1 : -1
    if (w.t >= 1) w.x = tx
    if (w.t >= 1 && w.state !== 'build') pickTarget(state, w, bg)
  }
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

/** 道路：画在地面层（建筑之下），宽度随缩放与等级变化 */
function drawRoads(
  ctx: CanvasRenderingContext2D,
  state: PlotState,
  firstX: number,
  lastX: number,
  firstY: number,
  lastY: number,
  zoom: number,
): void {
  const bg = gridSize(state.world)
  const scale = Math.max(0.85, Math.min(1.7, zoom))
  for (let by = firstY; by <= lastY + 1; by++) {
    for (let bx = firstX; bx <= lastX + 1; bx++) {
      const x0 = bx * BLOCK_SIZE * TILE
      const y0 = by * BLOCK_SIZE * TILE
      if (bx > 0 && bx < bg && by < bg) {
        const level = state.vRoad[by * bg + bx]
        if (level > 0) {
          const width = (level >= 3 ? 6.5 : level === 2 ? 4.6 : 3.2) * scale
          ctx.fillStyle = level >= 3 ? '#a49b86' : level === 2 ? '#aba189' : '#b2a992'
          ctx.fillRect(x0 - width / 2, y0, width, BLOCK_SIZE * TILE)
          ctx.fillStyle = 'rgba(88,78,62,.30)'
          ctx.fillRect(x0 - width / 2, y0, 0.7, BLOCK_SIZE * TILE)
          ctx.fillRect(x0 + width / 2 - 0.7, y0, 0.7, BLOCK_SIZE * TILE)
        }
      }
      if (by > 0 && by < bg && bx < bg) {
        const level = state.hRoad[by * bg + bx]
        if (level > 0) {
          const width = (level >= 3 ? 6.5 : level === 2 ? 4.6 : 3.2) * scale
          ctx.fillStyle = level >= 3 ? '#a49b86' : level === 2 ? '#aba189' : '#b2a992'
          ctx.fillRect(x0, y0 - width / 2, BLOCK_SIZE * TILE, width)
          ctx.fillStyle = 'rgba(88,78,62,.30)'
          ctx.fillRect(x0, y0 - width / 2, BLOCK_SIZE * TILE, 0.7)
          ctx.fillRect(x0, y0 + width / 2 - 0.7, BLOCK_SIZE * TILE, 0.7)
        }
      }
    }
  }
}

function drawField(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const px = x * TILE
  const py = y * TILE
  const pw = w * TILE
  const ph = h * TILE
  ctx.fillStyle = '#7fae4e'
  ctx.fillRect(px, py, pw, ph)
  ctx.fillStyle = 'rgba(56,84,32,.5)'
  for (let i = 2; i < pw; i += 5) ctx.fillRect(px + i, py + 1, 1.4, ph - 2)
  ctx.fillStyle = 'rgba(28,48,18,.35)'
  ctx.fillRect(px, py, pw, 1.2)
  ctx.fillRect(px, py + ph - 1.2, pw, 1.2)
  ctx.fillRect(px, py, 1.2, ph)
  ctx.fillRect(px + pw - 1.2, py, 1.2, ph)
}

/** 描述符 → 旧沙盒那套美术的类型与等级 */
function artOf(kind: string, block: Block, era: number): { type: Building['type']; level: number } {
  if (kind === 'house') {
    const level = Math.max(0, Math.min(4, block.density - 1 + (era >= 4 ? 1 : 0)))
    return { type: 'house', level }
  }
  if (kind === 'farmhouse') return { type: 'house', level: 1 }
  if (kind === 'hut') return { type: 'house', level: 0 }
  if (kind === 'campfire') return { type: 'campfire', level: 0 }
  return { type: kind as Building['type'], level: 0 }
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
  const halfBlocksX = view.w / 2 / sps / BLOCK_SIZE
  const halfBlocksY = view.h / 2 / sps / BLOCK_SIZE
  const firstX = Math.max(0, Math.floor(cam.x / BLOCK_SIZE - halfBlocksX) - 1)
  const lastX = Math.min(bg - 1, Math.ceil(cam.x / BLOCK_SIZE + halfBlocksX) + 1)
  const firstY = Math.max(0, Math.floor(cam.y / BLOCK_SIZE - halfBlocksY) - 1)
  const lastY = Math.min(bg - 1, Math.ceil(cam.y / BLOCK_SIZE + halfBlocksY) + 1)

  // 1. 区块底色（分区 / 图层）
  if (state.overlay !== 'none') {
    for (let by = firstY; by <= lastY; by++) {
      for (let bx = firstX; bx <= lastX; bx++) {
        const tint = tintFor(state.overlay, state.blocks[by * bg + bx])
        if (!tint) continue
        ctx.fillStyle = tint
        ctx.fillRect(bx * BLOCK_SIZE * TILE, by * BLOCK_SIZE * TILE, BLOCK_SIZE * TILE, BLOCK_SIZE * TILE)
      }
    }
  }

  // 2. 道路（地面层）
  drawRoads(ctx, state, firstX, lastX, firstY, lastY, z)

  // 3. 田地（地面层，在建筑之下）
  for (let by = firstY; by <= lastY; by++) {
    for (let bx = firstX; bx <= lastX; bx++) {
      const block = state.blocks[by * bg + bx]
      const ox = bx * BLOCK_SIZE
      const oy = by * BLOCK_SIZE
      for (const b of block.buildings) {
        if (b.kind !== 'field') continue
        drawField(ctx, ox + b.tx, oy + b.ty, b.w, b.h)
      }
    }
  }

  // 4. 建筑与居民：按 y 排序做前后遮挡（与旧沙盒同一套画法）
  const art: ArtContext = { era: state.era, hasFuel: state.ledger.wood > 0 && state.ledger.stone > 0 }
  const detail = z >= 0.55
  const dots = z < 0.65
  const power = state.blocks[0]?.covered.power ?? 1
  const items: Array<{ y: number; draw: () => void }> = []
  for (let by = firstY; by <= lastY; by++) {
    for (let bx = firstX; bx <= lastX; bx++) {
      const block = state.blocks[by * bg + bx]
      for (let i = 0; i < block.buildings.length; i++) {
        const b = block.buildings[i]
        if (b.kind === 'field') continue
        const wx = bx * BLOCK_SIZE + b.tx
        const wy = by * BLOCK_SIZE + b.ty
        const info = artOf(b.kind, block, state.era)
        const fake: Building = {
          id: block.bx * 977 + block.by * 131 + i,
          x: wx,
          y: wy,
          type: info.type,
          level: info.level,
        }
        items.push({ y: wy, draw: () => drawCivicBuilding(ctx, fake, art, timeMs, detail, power) })
      }
    }
  }
  const stride = dots ? Math.max(1, Math.ceil(walkers.length / 260)) : 1
  for (let i = 0; i < walkers.length; i++) {
    const w = walkers[i]
    if (dots && i % stride !== 0) continue
    if (w.x < cam.x - halfBlocksX * BLOCK_SIZE - 4 || w.x > cam.x + halfBlocksX * BLOCK_SIZE + 4) continue
    if (w.y < cam.y - halfBlocksY * BLOCK_SIZE - 6 || w.y > cam.y + halfBlocksY * BLOCK_SIZE + 4) continue
    const sprite: VillagerSprite = {
      id: w.id,
      x: w.x,
      y: w.y,
      path: w.state === 'build' ? [] : [{ x: w.x, y: w.y }],
      movePhase: w.phase,
      task: w.state === 'build' ? 'build' : 'gather',
      profession: w.state === 'carry' ? 'gatherer' : 'farmer',
      hue: (w.id * 47) % 360,
      carry: w.state === 'carry' ? 1 : 0,
      carryType: w.carryType,
      facing: w.facing,
      eatAnim: -1,
    }
    items.push({
      y: w.y,
      draw: () => {
        if (dots) {
          ctx.fillStyle = '#f5d998'
          ctx.fillRect(w.x * TILE, w.y * TILE, 2, 2)
        } else drawVillager(ctx, sprite, timeMs, state.tick)
      },
    })
  }
  items.sort((a, b) => a.y - b.y)
  for (const item of items) item.draw()

  // 5. 选中地块高亮
  if (selection >= 0) {
    const b = state.blocks[selection]
    ctx.strokeStyle = '#f4b93e'
    ctx.lineWidth = 1.6
    ctx.strokeRect(b.bx * BLOCK_SIZE * TILE + 1, b.by * BLOCK_SIZE * TILE + 1, BLOCK_SIZE * TILE - 2, BLOCK_SIZE * TILE - 2)
  }
}

/** 缩略图：地形 + 分区 + 路网 + 视口框 */
export function drawPlotMiniMap(canvas: HTMLCanvasElement, state: PlotState, cam: Camera, view: View): void {
  const bg = gridSize(state.world)
  const size = canvas.width
  const cell = size / bg
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, size, size)
  const step = Math.max(1, Math.floor(state.world.size / bg))
  for (let by = 0; by < bg; by++) {
    for (let bx = 0; bx < bg; bx++) {
      const terrain = state.world.tiles[(by * step + Math.floor(step / 2)) * state.world.size + (bx * step + Math.floor(step / 2))].terrain
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
  ctx.strokeStyle = '#f4f9ff'
  ctx.lineWidth = 1
  ctx.strokeRect(
    (cam.x / BLOCK_SIZE - halfW) * cell,
    (cam.y / BLOCK_SIZE - halfH) * cell,
    halfW * 2 * cell,
    halfH * 2 * cell,
  )
}
