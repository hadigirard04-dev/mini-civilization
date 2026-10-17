import { BLOCK_SIZE } from './config'
import { dryFootprint, layoutNoise, nearestStreetPoint, streetClearance, streetNeighbors, streetPath, type GroundRect } from './streets'
import type { Block, BlockBuilding, PlotState } from './types'

const layouts = new WeakMap<Block, string>()

function overlaps(a: GroundRect, b: GroundRect, gap = 0.12): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
}

/** Ground lots belong to streets, not a shuffled array of house sprites. */
export function createBlockLayout(state: PlotState, block: Block): BlockBuilding[] {
  if (block.zone === 'none' || (!block.density && !block.construction)) return []
  const bg = Math.floor(state.world.size / BLOCK_SIZE), index = block.by * bg + block.bx
  const ox = block.bx * BLOCK_SIZE, oy = block.by * BLOCK_SIZE
  const streets = streetNeighbors(state, index).map((nb) => streetPath(state, index, nb))
  const seed = state.world.seed ^ Math.imul(block.bx + 1, 7919) ^ Math.imul(block.by + 1, 104729)
  const density = Math.max(1, block.density)
  const civic = block.civic ?? block.construction?.kind.replace('civic:', '')
  const occupied: GroundRect[] = []
  const result: BlockBuilding[] = []
  const candidates: Array<GroundRect & { score: number; frontX: number; frontY: number }> = []

  const lots = (w: number, h: number, fields = false) => {
    candidates.length = 0
    // Dense candidate sampling permits a shoreline to trim lots individually. The
    // selected rectangles retain stable coordinates when their density grows.
    for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
      const x = ox + 0.18 + col * 0.82 + layoutNoise(col, row, seed) * 0.16
      const y = oy + 0.18 + row * 0.82 + layoutNoise(row, col, seed ^ 953) * 0.16
      const r = { x, y, w, h }
      if (x + w > ox + BLOCK_SIZE - 0.12 || y + h > oy + BLOCK_SIZE - 0.12) continue
      if (!dryFootprint(state.world, r) || !streetClearance(r, streets)) continue
      if (occupied.some((other) => overlaps(r, other))) continue
      const front = nearestStreetPoint({ x: x + w / 2, y: y + h / 2 }, streets)
      if (!fields && streets.length && front.distance > 3.6) continue
      // Keep the front garden/path on dry terrain too.
      const steps = Math.ceil(front.distance * 4)
      let dryAccess = true
      if (!fields && Number.isFinite(front.distance)) {
        for (let i = 0; i <= steps; i++) {
          const t = i / Math.max(1, steps)
          if (!dryFootprint(state.world, { x: (x + w / 2) * (1 - t) + front.x * t - 0.08, y: (y + h / 2) * (1 - t) + front.y * t - 0.08, w: 0.16, h: 0.16 })) { dryAccess = false; break }
        }
      }
      if (!dryAccess) continue
      const distance = Number.isFinite(front.distance) ? front.distance : 2
      candidates.push({ ...r, frontX: front.x - ox, frontY: front.y - oy, score: (fields ? -distance * 0.1 : distance * 0.4) + layoutNoise(col, row, seed ^ 3571) * 0.9 })
    }
    candidates.sort((a, b) => a.score - b.score)
  }
  const place = (kind: string, count: number, w = 1.42, h = 1.2, fields = false) => {
    lots(w, h, fields)
    let placed = 0
    for (const c of candidates) {
      if (placed >= count) break
      if (occupied.some((other) => overlaps(c, other))) continue
      occupied.push(c)
      result.push({ kind, tx: c.x - ox, ty: c.y - oy, w, h, frontX: c.frontX, frontY: c.frontY, variant: Math.floor(layoutNoise(Math.round(c.x * 10), Math.round(c.y * 10), seed) * 4) })
      placed++
    }
  }

  if (block.zone === 'residential') {
    place('house', [0, 4, 6, 8, 10][density])
    const settlement = state.settlements.find((s) => s.id === block.settlement)
    const center = settlement ? state.blocks[settlement.center] : block
    const centrality = Math.max(0, 1 - Math.hypot(block.bx - center.bx, block.by - center.by) / 7)
    for (const b of result) {
      const n = layoutNoise(Math.round(b.tx * 100), Math.round(b.ty * 100), seed ^ 73)
      b.level = density === 1 ? (state.era === 0 ? 0 : 1)
        : density === 2 ? (n < 0.35 ? 1 : 2)
        : density === 3 ? (n < 0.3 ? 2 : 3)
        : n < 0.18 ? 2 : n < 0.82 - centrality * 0.25 || state.era < 3 ? 3 : 4
    }
  } else if (block.zone === 'agriculture') {
    place('farmhouse', 1, 1.3, 1.15)
    place('field', [0, 5, 8, 11, 14][density], 1.5, 1.5, true)
  } else if (block.zone === 'industry') {
    place(block.industry === 'quarry' ? 'quarry' : 'factory', 1, 1.85, 1.45)
    place('workshop', density >= 3 ? 2 : density >= 2 ? 1 : 0, 1.6, 1.3)
  } else if (block.zone === 'civic') {
    const kind = civic === 'plaza' ? 'campfire' : civic === 'waterworks' ? 'well' : civic ?? 'market'
    place(kind, 1, 1.85, 1.5)
    if (density >= 2 && civic !== 'plaza' && civic !== 'park') place(kind, density >= 4 ? 2 : 1, 1.65, 1.3)
    if (civic === 'market') place('market-stall', 2, 0.9, 0.8)
    if (civic === 'school' || civic === 'clinic') place('garden', 3, 0.8, 0.8)
    if (civic === 'park') place('garden', 7, 1.05, 1.05)
  } else if (block.zone === 'park') {
    place('garden', 9, 1.05, 1.05)
  }
  return result
}

/** Roads can be added beside an existing block, so refresh on topology changes as
 * well as construction. No layout or art cache is part of a saved simulation. */
export function ensureBlockLayout(state: PlotState, block: Block): void {
  const bg = Math.floor(state.world.size / BLOCK_SIZE), index = block.by * bg + block.bx
  const key = `${block.zone}/${block.density}/${block.civic}/${block.industry}/${block.construction?.kind}/${state.era}/${streetNeighbors(state, index).join(',')}`
  if (layouts.get(block) === key) return
  block.buildings = createBlockLayout(state, block)
  layouts.set(block, key)
}
