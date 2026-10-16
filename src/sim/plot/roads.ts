import { WATER } from '../world'
import { BLOCK_SIZE } from './config'
import { blockCoords, blockIndex, gridSize, isMountainBlock } from './blocks'
import type { PlotState } from './types'

/** 道路等级：0 无，1 土路，2 街，3 大道 */
export type RoadDir = 'v' | 'h'

function vIndex(bx: number, by: number, bg: number): number {
  return blockIndex(bx, by, bg)
}

function hIndex(bx: number, by: number, bg: number): number {
  return blockIndex(bx, by, bg)
}

function blockHasWater(state: PlotState, index: number): boolean {
  const b = state.blocks[index]
  if (b.hasWater) return true
  const bg = gridSize(state.world)
  const { bx, by } = blockCoords(index, bg)
  const first = by * BLOCK_SIZE
  const firstX = bx * BLOCK_SIZE
  for (let t = 0; t < BLOCK_SIZE; t++) {
    if (state.world.tiles[first * state.world.size + firstX + t].terrain === WATER) return true
    if (state.world.tiles[(first + t) * state.world.size + firstX].terrain === WATER) return true
    if (state.world.tiles[(first + BLOCK_SIZE - 1) * state.world.size + firstX + t].terrain === WATER) return true
    if (state.world.tiles[(first + t) * state.world.size + firstX + BLOCK_SIZE - 1].terrain === WATER) return true
  }
  return false
}

/** 读取一条边上的道路等级 */
export function readRoad(state: PlotState, dir: RoadDir, bx: number, by: number): number {
  const bg = gridSize(state.world)
  if (dir === 'v') {
    if (bx <= 0 || bx >= bg || by < 0 || by >= bg) return 0
    return state.vRoad[vIndex(bx, by, bg)]
  }
  if (by <= 0 || by >= bg || bx < 0 || bx >= bg) return 0
  return state.hRoad[hIndex(bx, by, bg)]
}

export function isBridge(state: PlotState, dir: RoadDir, bx: number, by: number): boolean {
  const bg = gridSize(state.world)
  if (dir === 'v') {
    const left = blockIndex(bx - 1, by, bg)
    const right = blockIndex(bx, by, bg)
    return blockHasWater(state, left) || blockHasWater(state, right)
  }
  const top = blockIndex(bx, by - 1, bg)
  const bottom = blockIndex(bx, by, bg)
  return blockHasWater(state, top) || blockHasWater(state, bottom)
}

/** 该边是否允许修路（两侧都不能是山地主导） */
export function canBuildRoad(state: PlotState, dir: RoadDir, bx: number, by: number): boolean {
  const bg = gridSize(state.world)
  if (dir === 'v') {
    if (bx <= 0 || bx >= bg || by < 0 || by >= bg) return false
    return !isMountainBlock(state.blocks[blockIndex(bx - 1, by, bg)]) && !isMountainBlock(state.blocks[blockIndex(bx, by, bg)])
  }
  if (by <= 0 || by >= bg || bx < 0 || bx >= bg) return false
  return !isMountainBlock(state.blocks[blockIndex(bx, by - 1, bg)]) && !isMountainBlock(state.blocks[blockIndex(bx, by, bg)])
}

export function writeRoad(state: PlotState, dir: RoadDir, bx: number, by: number, level: number): void {
  const bg = gridSize(state.world)
  if (dir === 'v') state.vRoad[vIndex(bx, by, bg)] = level
  else state.hRoad[hIndex(bx, by, bg)] = level
}

/** 区块是否临路（四条边任意一条有路） */
export function hasRoadAccess(state: PlotState, index: number): boolean {
  const bg = gridSize(state.world)
  const { bx, by } = blockCoords(index, bg)
  if (bx > 0 && state.vRoad[vIndex(bx, by, bg)] > 0) return true
  if (bx < bg - 1 && state.vRoad[vIndex(bx + 1, by, bg)] > 0) return true
  if (by > 0 && state.hRoad[hIndex(bx, by, bg)] > 0) return true
  if (by < bg - 1 && state.hRoad[hIndex(bx, by + 1, bg)] > 0) return true
  return false
}

/** 通过道路可直达的相邻区块 */
export function roadNeighbors(state: PlotState, index: number): number[] {
  const bg = gridSize(state.world)
  const { bx, by } = blockCoords(index, bg)
  const out: number[] = []
  if (bx > 0 && state.vRoad[vIndex(bx, by, bg)] > 0) out.push(index - 1)
  if (bx < bg - 1 && state.vRoad[vIndex(bx + 1, by, bg)] > 0) out.push(index + 1)
  if (by > 0 && state.hRoad[hIndex(bx, by, bg)] > 0) out.push(index - bg)
  if (by < bg - 1 && state.hRoad[hIndex(bx, by + 1, bg)] > 0) out.push(index + bg)
  return out
}

export function roadEdgeCount(state: PlotState): number {
  let n = 0
  for (let i = 0; i < state.vRoad.length; i++) if (state.vRoad[i] > 0) n++
  for (let i = 0; i < state.hRoad.length; i++) if (state.hRoad[i] > 0) n++
  return n
}

/** 从若干源点沿路网做 BFS，返回每个区块的跳数（-1 = 不可达） */
export function bfsRoadDistances(state: PlotState, sources: number[]): Int16Array {
  const bg = gridSize(state.world)
  const dist = new Int16Array(bg * bg).fill(-1)
  const queue: number[] = []
  for (const s of sources) {
    if (s < 0 || s >= dist.length) continue
    dist[s] = 0
    queue.push(s)
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    const d = dist[cur] + 1
    for (const nb of roadNeighbors(state, cur)) {
      if (dist[nb] !== -1) continue
      dist[nb] = d
      queue.push(nb)
    }
  }
  return dist
}

/** 两点间是否路网可达 */
export function roadConnected(state: PlotState, from: number, to: number): boolean {
  return bfsRoadDistances(state, [from])[to] >= 0
}

export function edgeBetween(state: PlotState, from: number, to: number): { dir: RoadDir; bx: number; by: number } {
  const bg = gridSize(state.world)
  const a = blockCoords(from, bg)
  const b = blockCoords(to, bg)
  return a.bx !== b.bx
    ? { dir: 'v', bx: Math.max(a.bx, b.bx), by: a.by }
    : { dir: 'h', bx: a.bx, by: Math.max(a.by, b.by) }
}

/** 城际通道独立于城区空地需求，优先陆路，必要时才考虑桥梁。 */
export function connectionRoute(state: PlotState, from: number, to: number, bridges: boolean): number[] | null {
  const previous = new Int16Array(state.blocks.length).fill(-1)
  const queue = [from]
  previous[from] = from
  const bg = gridSize(state.world)
  for (let head = 0; head < queue.length && previous[to] < 0; head++) {
    const cur = queue[head]
    const { bx, by } = blockCoords(cur, bg)
    const neighbors: number[] = []
    if (bx > 0) neighbors.push(cur - 1)
    if (bx + 1 < bg) neighbors.push(cur + 1)
    if (by > 0) neighbors.push(cur - bg)
    if (by + 1 < bg) neighbors.push(cur + bg)
    for (const next of neighbors) {
      if (previous[next] >= 0) continue
      const e = edgeBetween(state, cur, next)
      if (!canBuildRoad(state, e.dir, e.bx, e.by)) continue
      if (!bridges && isBridge(state, e.dir, e.bx, e.by)) continue
      previous[next] = cur
      queue.push(next)
    }
  }
  if (previous[to] < 0) return null
  const route = [to]
  for (let cur = to; cur !== from;) { cur = previous[cur]; route.push(cur) }
  return route.reverse()
}
