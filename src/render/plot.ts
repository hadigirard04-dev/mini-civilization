import { BLOCK_SIZE } from '../sim/plot/config'
import { ZONE_COLORS, gridSize } from '../sim/plot/blocks'
import { ensureBlockLayout } from '../sim/plot/layout'
import { dryFootprint, dryGround, pointAlongStreet, streetLevel, streetNeighbors, streetNode, streetPath, type StreetPath } from '../sim/plot/streets'
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
  const bg = gridSize(state.world)
  const claimed = state.blocks.filter((b) => b.settlement >= 0 && streetNeighbors(state, b.by * bg + b.bx).length > 0)
  if (claimed.length === 0) return []
  const out: Walker[] = []
  for (let i = 0; i < count; i++) {
    const b = claimed[Math.floor(rand() * claimed.length)]
    const index = b.by * bg + b.bx
    const node = streetNode(state, index)
    out.push({
      x: node.x,
      y: node.y,
      from: index,
      to: -1,
      t: 0,
      speed: 0.8 + rand() * 0.7,
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

function pickTarget(state: PlotState, w: Walker): void {
  const index = w.to >= 0 ? w.to : w.from
  let options = streetNeighbors(state, index)
  if (options.length > 1) options = options.filter((nb) => nb !== w.from)
  if (options.length === 0) {
    w.to = -1
    w.state = 'walk'
    return
  }
  const pick = options[Math.floor(rand01(w.phase + w.id * 7.7 + w.x) * options.length)]
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
  for (const w of walkers) {
    if (w.state === 'build' && w.to >= 0 && w.t >= 1) {
      // 到了工地先干一会儿活
      w.wait -= dt
      if (w.wait <= 0) {
        w.state = 'walk'
        pickTarget(state, w)
      }
      continue
    }
    if (w.to < 0) {
      pickTarget(state, w)
      continue
    }
    const path = streetPath(state, w.from, w.to)
    w.t = Math.min(1, w.t + (dt * w.speed) / Math.max(0.001, path.length))
    w.phase += dt * 7
    const next = pointAlongStreet(path, w.t)
    w.facing = next.x >= w.x ? 1 : -1
    w.x = next.x
    w.y = next.y
    if (w.t >= 1 && w.state !== 'build') pickTarget(state, w)
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

function traceStreet(ctx: CanvasRenderingContext2D, path: StreetPath): void {
  ctx.beginPath()
  path.points.forEach((p, i) => i ? ctx.lineTo(p.x * TILE, p.y * TILE) : ctx.moveTo(p.x * TILE, p.y * TILE))
}

/** The graph, walkers and visible streets use exactly the same terrain route. */
function drawRoads(
  ctx: CanvasRenderingContext2D,
  state: PlotState,
  firstX: number,
  lastX: number,
  firstY: number,
  lastY: number,
): void {
  const bg = gridSize(state.world)
  ctx.save()
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  for (let by = firstY; by <= lastY; by++) for (let bx = firstX; bx <= lastX; bx++) {
    const index = by * bg + bx
    for (const nb of streetNeighbors(state, index)) {
      if (nb < index) continue
      const level = streetLevel(state, index, nb), path = streetPath(state, index, nb)
      const width = level >= 3 ? 12 : level === 2 ? 8.5 : 5.5
      traceStreet(ctx, path)
      ctx.strokeStyle = level >= 2 ? '#c0bba2' : '#8d865c'; ctx.lineWidth = width + 3; ctx.stroke()
      ctx.strokeStyle = level >= 3 ? '#777e78' : level === 2 ? '#aaa78f' : '#b7a77c'; ctx.lineWidth = width; ctx.stroke()
      if (level >= 3) {
        ctx.strokeStyle = '#d5c9a0'; ctx.lineWidth = 0.8; ctx.setLineDash([5, 7]); ctx.stroke(); ctx.setLineDash([])
      }
      // Only the actual wet stretch is a bridge, not an entire block beside water.
      for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i - 1], b = path.points[i], length = Math.hypot(b.x - a.x, b.y - a.y)
        const steps = Math.max(1, Math.ceil(length * 2))
        for (let j = 0; j < steps; j++) {
          const t = (j + 0.5) / steps, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t
          if (dryGround(state.world, x, y)) continue
          const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length
          ctx.strokeStyle = '#dcc399'; ctx.lineWidth = width + 3
          ctx.beginPath(); ctx.moveTo((x - dx * 0.3) * TILE, (y - dy * 0.3) * TILE); ctx.lineTo((x + dx * 0.3) * TILE, (y + dy * 0.3) * TILE); ctx.stroke()
          ctx.strokeStyle = '#6b5842'; ctx.lineWidth = 1.2
          ctx.beginPath(); ctx.moveTo(x * TILE - dy * (width / 2 + 1), y * TILE + dx * (width / 2 + 1)); ctx.lineTo(x * TILE + dy * (width / 2 + 1), y * TILE - dx * (width / 2 + 1)); ctx.stroke()
        }
      }
    }
  }
  ctx.restore()
}

function drawField(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, variant = 0): void {
  const px = x * TILE
  const py = y * TILE
  const pw = w * TILE
  const ph = h * TILE
  ctx.fillStyle = ['#9fae52', '#79964b', '#b7aa62', '#8ba657'][variant % 4]
  ctx.fillRect(px, py, pw, ph)
  ctx.fillStyle = 'rgba(56,84,32,.5)'
  if (variant % 2) {
    for (let i = 2; i < ph; i += 5) ctx.fillRect(px + 1, py + i, pw - 2, 1.2)
  } else for (let i = 2; i < pw; i += 5) ctx.fillRect(px + i, py + 1, 1.2, ph - 2)
  ctx.fillStyle = 'rgba(28,48,18,.35)'
  ctx.fillRect(px, py, pw, 1.2)
  ctx.fillRect(px, py + ph - 1.2, pw, 1.2)
  ctx.fillRect(px, py, 1.2, ph)
  ctx.fillRect(px + pw - 1.2, py, 1.2, ph)
}

function drawGarden(ctx: CanvasRenderingContext2D, x: number, y: number, variant: number): void {
  ctx.fillStyle = 'rgba(29,56,33,.2)'
  ctx.beginPath(); ctx.ellipse(x * TILE + 9, y * TILE + 13, 7, 3, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#776646'; ctx.fillRect(x * TILE + 7, y * TILE + 7, 2, 8)
  ctx.fillStyle = ['#3e7146', '#557c44', '#68854c', '#447752'][variant % 4]
  ctx.beginPath(); ctx.ellipse(x * TILE + 8, y * TILE + 5, 7, 6, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#87a666'; ctx.fillRect(x * TILE + 4, y * TILE + 1, 5, 3)
}

function drawLotGround(ctx: CanvasRenderingContext2D, state: PlotState, block: Block): void {
  const ox = block.bx * BLOCK_SIZE, oy = block.by * BLOCK_SIZE
  for (const b of block.buildings) {
    const x = ox + b.tx, y = oy + b.ty
    if (b.kind === 'field') {
      if (block.density > 0) drawField(ctx, x, y, b.w, b.h, b.variant)
      continue
    }
    const garden = block.zone === 'residential' || block.zone === 'agriculture' || block.zone === 'park'
    const pad = { x: x - 0.15, y: y - 0.15, w: b.w + 0.3, h: b.h + 0.3 }
    const safePad = dryFootprint(state.world, pad) ? pad : { x, y, w: b.w, h: b.h }
    if (b.kind !== 'garden') {
      ctx.fillStyle = garden ? '#8e9e6a' : block.zone === 'industry' ? '#9b9b83' : '#beb79a'
      ctx.fillRect(safePad.x * TILE, safePad.y * TILE, safePad.w * TILE, safePad.h * TILE)
    }
    if (b.frontX !== undefined && b.frontY !== undefined) {
      ctx.strokeStyle = garden ? '#bfb38b' : '#c8c1a6'; ctx.lineWidth = garden ? 2.2 : 3.5
      ctx.beginPath(); ctx.moveTo((x + b.w / 2) * TILE, (y + b.h / 2) * TILE)
      ctx.lineTo((ox + b.frontX) * TILE, (oy + b.frontY) * TILE); ctx.stroke()
    }
  }
}

function drawConstruction(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, progress: number): void {
  const px = x * TILE, py = y * TILE, width = w * TILE, height = h * TILE
  ctx.fillStyle = '#ae9e73'; ctx.fillRect(px, py, width, height)
  ctx.strokeStyle = '#715d40'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.strokeRect(px + 1, py + 1, width - 2, height - 2); ctx.setLineDash([])
  ctx.fillStyle = '#816742'
  for (const dx of [1, width - 3]) { ctx.fillRect(px + dx, py - 5, 2, height + 5); ctx.fillRect(px + dx - 2, py - 3, 6, 2) }
  ctx.fillStyle = '#d8bf82'; ctx.fillRect(px + 4, py + height - 4, Math.max(1, (width - 8) * progress), 2)
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

  // Clear only occupied lots and paths, leaving the natural edges of each block.
  for (let by = firstY; by <= lastY; by++) for (let bx = firstX; bx <= lastX; bx++) {
    const block = state.blocks[by * bg + bx]
    ensureBlockLayout(state, block)
    drawLotGround(ctx, state, block)
  }

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
  drawRoads(ctx, state, firstX, lastX, firstY, lastY)

  // 4. 建筑与居民：按 y 排序做前后遮挡（与旧沙盒同一套画法）
  const art: ArtContext = { era: state.era, hasFuel: state.ledger.wood > 0 && state.ledger.stone > 0 }
  const detail = z >= 0.55
  const dots = z < 0.65
  const items: Array<{ y: number; draw: () => void }> = []
  for (let by = firstY; by <= lastY; by++) {
    for (let bx = firstX; bx <= lastX; bx++) {
      const block = state.blocks[by * bg + bx]
      for (let i = 0; i < block.buildings.length; i++) {
        const b = block.buildings[i]
        if (b.kind === 'field') continue
        const wx = bx * BLOCK_SIZE + b.tx
        const wy = by * BLOCK_SIZE + b.ty
        if (block.density === 0 && block.construction) {
          items.push({ y: wy, draw: () => drawConstruction(ctx, wx, wy, b.w, b.h, block.construction!.progress) })
          continue
        }
        if (b.kind === 'garden') {
          items.push({ y: wy, draw: () => drawGarden(ctx, wx, wy, b.variant ?? 0) })
          continue
        }
        if (b.kind === 'market-stall') {
          items.push({ y: wy, draw: () => {
            ctx.fillStyle = '#73533e'; ctx.fillRect(wx * TILE + 1, wy * TILE + 4, 12, 8)
            ctx.fillStyle = (b.variant ?? 0) % 2 ? '#c5ab66' : '#ab6550'; ctx.fillRect(wx * TILE - 1, wy * TILE, 16, 5)
            ctx.fillStyle = '#e5d1a3'; ctx.fillRect(wx * TILE + 4, wy * TILE, 3, 5)
          } })
          continue
        }
        const info = artOf(b.kind, block, state.era)
        const fake: Building = {
          id: block.bx * 977 + block.by * 131 + (b.variant ?? i),
          x: wx + 0.15,
          y: wy + 0.03,
          type: info.type,
          level: b.level ?? info.level,
        }
        items.push({ y: wy, draw: () => drawCivicBuilding(ctx, fake, art, timeMs, detail, block.covered.power) })
        if (block.construction && i === 0) {
          items.push({ y: wy + 0.1, draw: () => {
            ctx.strokeStyle = '#c5a56b'; ctx.lineWidth = 1.2
            ctx.strokeRect(wx * TILE - 3, wy * TILE - 20, 27, 40)
            ctx.beginPath(); ctx.moveTo(wx * TILE - 3, wy * TILE - 6); ctx.lineTo(wx * TILE + 24, wy * TILE - 6); ctx.stroke()
          } })
        }
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
  ctx.strokeStyle = 'rgba(40,36,28,0.9)'
  ctx.lineWidth = 0.8
  for (let by = 0; by < bg; by++) {
    for (let bx = 0; bx < bg; bx++) {
      const index = by * bg + bx
      for (const nb of streetNeighbors(state, index)) {
        if (nb < index) continue
        const path = streetPath(state, index, nb)
        ctx.beginPath()
        path.points.forEach((p, i) => i ? ctx.lineTo(p.x / BLOCK_SIZE * cell, p.y / BLOCK_SIZE * cell) : ctx.moveTo(p.x / BLOCK_SIZE * cell, p.y / BLOCK_SIZE * cell))
        ctx.stroke()
      }
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
