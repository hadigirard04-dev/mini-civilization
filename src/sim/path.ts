import type { Point } from './types'
import { isWalkable, type World } from './world'

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

function heuristic(x: number, y: number, tx: number, ty: number): number {
  return Math.abs(x - tx) + Math.abs(y - ty)
}

/**
 * 线段可通行校验（Amanatides–Woo 网格行走）：
 * 按浮点射线逐格枚举线段真正经过的每个格子——与居民实际移动完全一致，
 * 角点经过时保守地要求侧翼格也可通行，杜绝擦角落水。
 * 输入为连续世界坐标（格 c 覆盖 [c, c+1)）。
 */
function segWalkable(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  let ix = Math.floor(x0)
  let iy = Math.floor(y0)
  if (!isWalkable(world, ix, iy)) return false
  const dx = x1 - x0
  const dy = y1 - y0
  if (dx === 0 && dy === 0) return true

  const stepX = dx > 0 ? 1 : -1
  const stepY = dy > 0 ? 1 : -1
  const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx)
  const tDeltaY = dy === 0 ? Infinity : Math.abs(1 / dy)
  let tMaxX = dx === 0 ? Infinity : ((stepX > 0 ? ix + 1 : ix) - x0) / dx
  let tMaxY = dy === 0 ? Infinity : ((stepY > 0 ? iy + 1 : iy) - y0) / dy

  for (let guard = 0; guard < 400; guard++) {
    let t: number
    if (tMaxX < tMaxY) {
      t = tMaxX
      tMaxX += tDeltaX
      ix += stepX
    } else {
      // 含角点相等情形：先 Y 后 X 顺序步进，侧翼格也被校验
      t = tMaxY
      tMaxY += tDeltaY
      iy += stepY
    }
    if (t > 1 || Number.isNaN(t)) break
    if (!isWalkable(world, ix, iy)) return false
  }
  return true
}

/** 路径拉直：从真实起点出发，贪心跳到仍可直线通行的最远路点（逐段按实际移动线校验） */
function smooth(world: World, sx: number, sy: number, pts: Point[]): Point[] {
  if (pts.length === 0) return pts
  const out: Point[] = []
  let ax = sx
  let ay = sy
  let i = 0
  while (i < pts.length) {
    let best = i
    for (let j = pts.length - 1; j > i; j--) {
      if (segWalkable(world, ax, ay, pts[j].x + 0.5, pts[j].y + 0.5)) {
        best = j
        break
      }
    }
    out.push(pts[best])
    ax = pts[best].x + 0.5
    ay = pts[best].y + 0.5
    i = best + 1
  }
  return out
}

/**
 * A* 寻路（4 邻接，曼哈顿启发）+ 直线拉直。
 * 返回从起点之后到目标格的路点数组（含目标）；起点即目标返回 []；不可达返回 null。
 */
export function findPath(world: World, sx: number, sy: number, tx: number, ty: number): Point[] | null {
  const size = world.size
  const startX = Math.floor(sx)
  const startY = Math.floor(sy)
  const goalX = Math.floor(tx)
  const goalY = Math.floor(ty)
  if (startX < 0 || startY < 0 || startX >= size || startY >= size) return null
  if (goalX < 0 || goalY < 0 || goalX >= size || goalY >= size) return null
  if (!isWalkable(world, goalX, goalY)) return null
  if (startX === goalX && startY === goalY) return []

  const startI = startY * size + startX
  const goalI = goalY * size + goalX
  const n = size * size
  const gScore = new Float64Array(n).fill(Infinity)
  const came = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)

  // 二叉堆（按 f 存储），允许重复项，出堆时用 closed 去重
  const heapI: number[] = []
  const heapF: number[] = []
  const push = (idx: number, f: number): void => {
    heapI.push(idx)
    heapF.push(f)
    let c = heapI.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (heapF[p] <= heapF[c]) break
      ;[heapF[p], heapF[c]] = [heapF[c], heapF[p]]
      ;[heapI[p], heapI[c]] = [heapI[c], heapI[p]]
      c = p
    }
  }
  const pop = (): number => {
    const top = heapI[0]
    const lastI = heapI.pop()!
    const lastF = heapF.pop()!
    if (heapI.length > 0) {
      heapI[0] = lastI
      heapF[0] = lastF
      let c = 0
      for (;;) {
        const l = 2 * c + 1
        const r = l + 1
        let m = c
        if (l < heapI.length && heapF[l] < heapF[m]) m = l
        if (r < heapI.length && heapF[r] < heapF[m]) m = r
        if (m === c) break
        ;[heapF[m], heapF[c]] = [heapF[c], heapF[m]]
        ;[heapI[m], heapI[c]] = [heapI[c], heapI[m]]
        c = m
      }
    }
    return top
  }

  gScore[startI] = 0
  push(startI, heuristic(startX, startY, goalX, goalY))

  let found = false
  while (heapI.length > 0) {
    const cur = pop()
    if (closed[cur]) continue
    closed[cur] = 1
    if (cur === goalI) {
      found = true
      break
    }
    const cx = cur % size
    const cy = (cur / size) | 0
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
      if (!isWalkable(world, nx, ny)) continue
      const ni = ny * size + nx
      if (closed[ni]) continue
      const ng = gScore[cur] + 1
      if (ng < gScore[ni]) {
        gScore[ni] = ng
        came[ni] = cur
        push(ni, ng + heuristic(nx, ny, goalX, goalY))
      }
    }
  }
  if (!found) return null

  const raw: Point[] = []
  let node = goalI
  while (node !== startI) {
    raw.push({ x: node % size, y: (node / size) | 0 })
    node = came[node]
    if (node < 0) return null
  }
  raw.reverse()
  return smooth(world, sx, sy, raw)
}
