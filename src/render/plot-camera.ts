import type { PlotState } from '../sim/plot/types'
import { BLOCK_SIZE } from '../sim/plot/config'
import { TILE, type Camera } from './camera'

/** Follow inhabited neighborhoods, not distant reserved roads or other towns. */
export function framePlotSettlement(state: PlotState, settlementId: number, w: number, h: number): Camera {
  const settlement = state.settlements.find((s) => s.id === settlementId) ?? state.settlements[0]
  const center = state.blocks[settlement?.center ?? Math.floor(state.blocks.length / 2)]
  const homes = state.blocks.filter((b) => b.settlement === settlement?.id && b.zone === 'residential' && b.density > 0)
  const points = homes.length ? homes : [center]
  let total = 0, x = 0, y = 0
  for (const b of points) {
    const weight = Math.max(1, b.population)
    total += weight; x += (b.bx + 0.5) * BLOCK_SIZE * weight; y += (b.by + 0.5) * BLOCK_SIZE * weight
  }
  const spanX = Math.max(20, (Math.max(...points.map((b) => b.bx)) - Math.min(...points.map((b) => b.bx)) + 3) * BLOCK_SIZE)
  const spanY = Math.max(20, (Math.max(...points.map((b) => b.by)) - Math.min(...points.map((b) => b.by)) + 3) * BLOCK_SIZE)
  return { x: x / total, y: y / total, zoom: Math.max(0.7, Math.min(1.8, (w - 40) / (TILE * spanX), (h - 60) / (TILE * spanY))) }
}
