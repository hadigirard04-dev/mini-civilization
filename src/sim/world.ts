import { createRng, type Rng } from './rng'

export const GRASS = 0
export const FOREST = 1
export const WATER = 2
export const STONE = 3
/** 农田：由草地开垦而来，不参与自然生成 */
export const FARMLAND = 4

export const DESERT = 5
export const SNOW = 6
export const WETLAND = 7
export const HILLS = 8
export const MOUNTAIN = 9
export const TERRAIN_NAMES = [
  '草原',
  '森林',
  '湖泊 / 河流',
  '矿区',
  '农田',
  '沙漠',
  '雪地',
  '湿地',
  '丘陵',
  '山地',
]
export type Terrain = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type ResourceType = 'food' | 'wood' | 'stone'

export interface Tile {
  terrain: Terrain
  /** 当前资源量（草地=食物，森林=木材，石地=石头，水域无资源） */
  resource: number
  /** 再生上限 */
  max: number
}

export interface World {
  size: number
  seed: number
  tiles: Tile[]
}

/** 各地形资源上限 */
const GRASS_MAX = 40
const FOREST_MAX = 60
const STONE_MAX = 40

/** 地形对应的资源类型 */
export function resourceType(terrain: Terrain): ResourceType | null {
  switch (terrain) {
    case GRASS:
    case FARMLAND:
    case WETLAND:
      return 'food'
    case FOREST:
      return 'wood'
    case STONE:
    case HILLS:
      return 'stone'
    default:
      return null
  }
}

export function tileIndex(world: World, x: number, y: number): number {
  return y * world.size + x
}

export function inBounds(world: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.size && y < world.size
}

export function getTile(world: World, x: number, y: number): Tile | null {
  if (!inBounds(world, x, y)) return null
  return world.tiles[y * world.size + x]
}

/** 水域不可通行，其余地形可通行 */
export function isWalkable(world: World, x: number, y: number): boolean {
  const t = getTile(world, x, y)
  return t !== null && t.terrain !== WATER && t.terrain !== MOUNTAIN
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 平滑值噪声：在 points×points 控制网格上双线性插值 */
function makeNoise(rng: Rng, points: number): (u: number, v: number) => number {
  const grid = new Float64Array(points * points)
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next()
  return (u: number, v: number): number => {
    const fx = u * (points - 1)
    const fy = v * (points - 1)
    const x0 = Math.min(Math.floor(fx), points - 2)
    const y0 = Math.min(Math.floor(fy), points - 2)
    const tx = smoothstep(fx - x0)
    const ty = smoothstep(fy - y0)
    const a = grid[y0 * points + x0]
    const b = grid[y0 * points + x0 + 1]
    const c = grid[(y0 + 1) * points + x0]
    const d = grid[(y0 + 1) * points + x0 + 1]
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty)
  }
}

/** 取升序排序后的分位数切点（保证各地形在任意种子下都出现） */
function percentileCut(values: Float64Array, p: number): number {
  const sorted = Array.from(values).sort((x, y) => x - y)
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))
  return sorted[i]
}

/** 生成 64×64 世界：双八度高程 + 湿度，按分位数划定水域/石地/森林 */
export function generateWorld(seed: number, size = 64, biomes = false): World {
  if (![64, 128, 256].includes(size)) throw new Error('Unsupported world size')
  const elevNoise = makeNoise(createRng(seed ^ 0x9e3779b9), 6)
  const detailNoise = makeNoise(createRng(seed ^ 0x85ebca6b), 14)
  const moistNoise = makeNoise(createRng(seed ^ 0xc2b2ae35), 8)
  const rng = createRng(seed ^ 0x27d4eb2f)

  const n = size * size
  const elev = new Float64Array(n)
  const moist = new Float64Array(n)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1)
      const v = y / (size - 1)
      const i = y * size + x
      elev[i] = 0.65 * elevNoise(u, v) + 0.35 * detailNoise(u, v)
      moist[i] = moistNoise(u, v)
    }
  }

  // 分位数切点：低处约 14% 为水，高处约 10% 为石地
  const waterCut = percentileCut(elev, 0.14)
  const stoneCut = percentileCut(elev, 0.9)

  const tiles: Tile[] = new Array(n)
  const landIdx: number[] = []
  for (let i = 0; i < n; i++) {
    if (elev[i] <= waterCut) {
      tiles[i] = { terrain: WATER, resource: 0, max: 0 }
    } else if (elev[i] >= stoneCut) {
      tiles[i] = { terrain: STONE, resource: 0, max: 0 }
    } else {
      tiles[i] = { terrain: GRASS, resource: 0, max: 0 }
      landIdx.push(i)
    }
  }

  // 陆地中按湿度划森林（约 42% 分位），其余为草地
  const landMoist = new Float64Array(landIdx.length)
  for (let k = 0; k < landIdx.length; k++) landMoist[k] = moist[landIdx[k]]
  const forestCut = percentileCut(landMoist, 0.42)
  for (const i of landIdx) {
    tiles[i] =
      moist[i] >= forestCut
        ? { terrain: FOREST, resource: 0, max: 0 }
        : { terrain: GRASS, resource: 0, max: 0 }
  }

  if (biomes) {
    const mountainCut = percentileCut(elev, 0.96)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = y * size + x,
          t = tiles[i]
        if (t.terrain === WATER) continue
        if (elev[i] >= mountainCut) t.terrain = MOUNTAIN
        else if (y < size * 0.17) t.terrain = SNOW
        else if (x > size * 0.72 && y > size * 0.55) t.terrain = DESERT
        else if (t.terrain === STONE && moist[i] > 0.45) t.terrain = HILLS
        else if (moist[i] > 0.72 && elev[i] < waterCut + 0.13) t.terrain = WETLAND
      }
    // 出生区是可持续的小片混合平原，外围的生态差异仍完整保留。
    const mid = size / 2
    for (let y = mid - 14; y <= mid + 14; y++)
      for (let x = mid - 14; x <= mid + 14; x++) {
        const i = y * size + x
        const terrain =
          Math.abs(x - mid) < 6 && Math.abs(y - mid) < 6
            ? GRASS
            : (x * 7 + y * 11 + seed) % 9 < 3
              ? FOREST
              : (x + y) % 13 === 0
                ? STONE
                : GRASS
        tiles[i] = { terrain, resource: 0, max: 0 }
      }
  }

  // 中央留出空地作为村庄中心（保证出生点与建设地）
  const mid = Math.floor(size / 2)
  for (let y = mid - 2; y <= mid + 1; y++) {
    for (let x = mid - 2; x <= mid + 1; x++) {
      tiles[y * size + x] = { terrain: GRASS, resource: 0, max: 0 }
    }
  }

  // 初始资源充盈度 55%~100%
  for (const t of tiles) {
    switch (t.terrain) {
      case GRASS:
      case WETLAND:
        t.max = GRASS_MAX
        break
      case FOREST:
        t.max = FOREST_MAX
        break
      case STONE:
      case HILLS:
        t.max = STONE_MAX
        break
      default:
        t.max = 0
    }
    t.max > 0 && (t.resource = t.max * (0.55 + 0.45 * rng.next()))
  }

  return { size, seed, tiles }
}
