import { HILLS, MOUNTAIN, WATER, type World } from '../world'
import { BLOCK_SIZE } from './config'
import type { PlotState } from './types'

export interface StreetPoint { x: number; y: number }
export interface StreetPath { points: StreetPoint[]; length: number; bridge: boolean; routable: boolean }
export interface GroundRect { x: number; y: number; w: number; h: number }

/** Geometry is derived from terrain and coordinates, never the simulation RNG. */
export function layoutNoise(x: number, y: number, seed = 0): number {
  let n = Math.imul(x + 19, 374761393) ^ Math.imul(y + 53, 668265263) ^ seed
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

const nodes = new WeakMap<World, Map<number, StreetPoint>>()
const paths = new WeakMap<World, Map<string, StreetPath>>()

export function dryGround(world: World, x: number, y: number): boolean {
  const tile = world.tiles[Math.floor(y) * world.size + Math.floor(x)]
  return x >= 0 && y >= 0 && x < world.size && y < world.size && !!tile && tile.terrain !== WATER && tile.terrain !== MOUNTAIN
}

export function dryFootprint(world: World, r: GroundRect): boolean {
  if (r.x < 0 || r.y < 0 || r.x + r.w > world.size || r.y + r.h > world.size) return false
  for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h - 1e-6); y++) {
    for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w - 1e-6); x++) {
      if (!dryGround(world, x, y)) return false
    }
  }
  return true
}

/** One shared junction per economic block, preferably on the block's dry interior. */
export function streetNode(state: PlotState, index: number): StreetPoint {
  const world = state.world
  let cache = nodes.get(world)
  if (!cache) { cache = new Map(); nodes.set(world, cache) }
  const existing = cache.get(index)
  if (existing) return existing
  const b = state.blocks[index]
  const idealX = 3.5 + (layoutNoise(b.bx, b.by, world.seed) - 0.5) * 2
  const idealY = 3.5 + (layoutNoise(b.bx, b.by, world.seed ^ 7919) - 0.5) * 2
  let best = Infinity
  let node = { x: b.bx * BLOCK_SIZE + 4.5, y: b.by * BLOCK_SIZE + 4.5 }
  for (let y = 1; y < BLOCK_SIZE - 1; y++) {
    for (let x = 1; x < BLOCK_SIZE - 1; x++) {
      const wx = b.bx * BLOCK_SIZE + x, wy = b.by * BLOCK_SIZE + y
      const dry = dryGround(world, wx, wy)
      let wetNeighbors = 0
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (!dryGround(world, wx + dx, wy + dy)) wetNeighbors++
      const score = Math.hypot(x - idealX, y - idealY) + (dry ? 0 : 100) + wetNeighbors * 1.8
      if (score < best) { best = score; node = { x: wx + 0.5, y: wy + 0.5 } }
    }
  }
  cache.set(index, node)
  return node
}

export function streetNeighbors(state: PlotState, index: number): number[] {
  const bg = Math.floor(state.world.size / BLOCK_SIZE)
  const bx = index % bg, by = Math.floor(index / bg)
  const result: number[] = []
  if (bx > 0 && state.vRoad[index]) result.push(index - 1)
  if (bx + 1 < bg && state.vRoad[index + 1]) result.push(index + 1)
  if (by > 0 && state.hRoad[index]) result.push(index - bg)
  if (by + 1 < bg && state.hRoad[index + bg]) result.push(index + bg)
  return result
}

export function streetLevel(state: PlotState, from: number, to: number): number {
  return Math.abs(from - to) === 1 ? state.vRoad[Math.max(from, to)] : state.hRoad[Math.max(from, to)]
}

function route(state: PlotState, from: number, to: number, allowWater: boolean): StreetPoint[] | null {
  const a = streetNode(state, from), b = streetNode(state, to), world = state.world
  const ba = state.blocks[from], bb = state.blocks[to]
  const left = Math.min(ba.bx, bb.bx) * BLOCK_SIZE, top = Math.min(ba.by, bb.by) * BLOCK_SIZE
  const width = (Math.abs(ba.bx - bb.bx) + 1) * BLOCK_SIZE, height = (Math.abs(ba.by - bb.by) + 1) * BLOCK_SIZE
  const start = (Math.floor(a.y) - top) * width + Math.floor(a.x) - left
  const end = (Math.floor(b.y) - top) * width + Math.floor(b.x) - left
  const cost = new Float64Array(width * height).fill(Infinity)
  const previous = new Int16Array(width * height).fill(-1)
  const open = [start], closed = new Uint8Array(width * height)
  cost[start] = 0
  const point = (id: number): StreetPoint => ({ x: left + id % width + 0.5, y: top + Math.floor(id / width) + 0.5 })
  const passable = (x: number, y: number) => dryGround(world, x, y) || allowWater && world.tiles[y * world.size + x].terrain !== MOUNTAIN
  if (!allowWater && (!dryGround(world, a.x, a.y) || !dryGround(world, b.x, b.y))) return null
  while (open.length) {
    let best = 0, bestScore = Infinity
    for (let i = 0; i < open.length; i++) {
      const p = point(open[i])
      const score = cost[open[i]] + Math.hypot(p.x - b.x, p.y - b.y)
      if (score < bestScore) { best = i; bestScore = score }
    }
    const current = open.splice(best, 1)[0]
    if (current === end) {
      const result = [point(end)]
      for (let cur = end; cur !== start;) { cur = previous[cur]; result.push(point(cur)) }
      return result.reverse()
    }
    closed[current] = 1
    const cx = current % width, cy = Math.floor(current / width)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const next = y * width + x
      if (closed[next] || !passable(left + x, top + y)) continue
      // Do not cut a dry diagonal through the corner of a lake or mountain.
      if (dx && dy && (!passable(left + cx + dx, top + cy) || !passable(left + cx, top + cy + dy))) continue
      const terrain = world.tiles[(top + y) * world.size + left + x].terrain
      const penalty = terrain === WATER ? 12 : terrain === MOUNTAIN ? 24 : terrain === HILLS ? 1.3 : 1
      const tentative = cost[current] + Math.hypot(dx, dy) * penalty
      if (tentative >= cost[next]) continue
      if (cost[next] === Infinity) open.push(next)
      cost[next] = tentative; previous[next] = current
    }
  }
  return null
}

/** Route in the two adjacent blocks; a bridge is used only if no dry route exists. */
export function streetPath(state: PlotState, from: number, to: number): StreetPath {
  const lo = Math.min(from, to), hi = Math.max(from, to), key = `${from}/${to}`
  let cache = paths.get(state.world)
  if (!cache) { cache = new Map(); paths.set(state.world, cache) }
  let path = cache.get(key)
  if (!path && from > to) {
    const forward = streetPath(state, to, from)
    path = { ...forward, points: [...forward.points].reverse() }
    cache.set(key, path)
  }
  if (!path) {
    const dry = route(state, lo, hi, false)
    const crossing = dry ?? route(state, lo, hi, true)
    const raw = crossing ?? [streetNode(state, lo), streetNode(state, hi)]
    const points = raw.filter((p, i) => {
      if (i === 0 || i === raw.length - 1) return true
      const a = raw[i - 1], b = raw[i + 1]
      return (p.x - a.x) * (b.y - p.y) !== (p.y - a.y) * (b.x - p.x)
    })
    let length = 0
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    path = { points, length, bridge: !dry, routable: !!crossing }
    cache.set(key, path)
  }
  return path
}

export function pointAlongStreet(path: StreetPath, t: number): StreetPoint {
  let remaining = Math.max(0, Math.min(1, t)) * path.length
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], length = Math.hypot(b.x - a.x, b.y - a.y)
    if (remaining <= length) return { x: a.x + (b.x - a.x) * remaining / length, y: a.y + (b.y - a.y) * remaining / length }
    remaining -= length
  }
  return path.points[path.points.length - 1]
}

export function nearestStreetPoint(p: StreetPoint, paths: StreetPath[]): StreetPoint & { distance: number } {
  let best = { ...p, distance: Infinity }
  for (const path of paths) for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], dx = b.x - a.x, dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
    const x = a.x + dx * t, y = a.y + dy * t, distance = Math.hypot(p.x - x, p.y - y)
    if (distance < best.distance) best = { x, y, distance }
  }
  return best
}

/** Conservative clearance for the largest avenue, shared by lots and construction sites. */
export function streetClearance(rect: GroundRect, streets: StreetPath[], margin = 0.52): boolean {
  for (const path of streets) for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], length = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(1, Math.ceil(length / 0.2))
    for (let step = 0; step <= steps; step++) {
      const t = step / steps
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t
      if (x > rect.x - margin && x < rect.x + rect.w + margin && y > rect.y - margin && y < rect.y + rect.h + margin) return false
    }
  }
  return true
}
