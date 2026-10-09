import { WATER, type World } from '../sim/world'
import { TILE, type Camera } from './camera'

export interface View {
  /** CSS 像素尺寸 */
  w: number
  h: number
  dpr: number
}

/** 水面微光：按时间轻微呼吸 + 漂移的高光短横 */
function drawWaterShimmer(ctx: CanvasRenderingContext2D, world: World, cam: Camera, view: View, timeMs: number): void {
  const sps = TILE * cam.zoom
  const left = Math.max(0, Math.floor(cam.x - view.w / 2 / sps) - 1)
  const right = Math.min(world.size - 1, Math.ceil(cam.x + view.w / 2 / sps) + 1)
  const top = Math.max(0, Math.floor(cam.y - view.h / 2 / sps) - 1)
  const bottom = Math.min(world.size - 1, Math.ceil(cam.y + view.h / 2 / sps) + 1)
  if ((right - left) * (bottom - top) > 6000) return

  const t = timeMs * 0.0016
  ctx.fillStyle = '#a8d4f2'
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (world.tiles[y * world.size + x].terrain !== WATER) continue
      const wave = Math.sin(t + x * 0.9 + y * 0.7)
      if (wave < 0.35) continue
      const px = x * TILE
      const py = y * TILE
      ctx.globalAlpha = 0.08 + 0.14 * ((wave - 0.35) / 0.65)
      const oy = ((timeMs * 0.02 + x * 5 + y * 3) % 10) | 0
      ctx.fillRect(px + 3, py + 2 + oy, 6, 1)
      ctx.fillRect(px + 8, py + 8 + ((oy + 4) % 8), 4, 1)
    }
  }
  ctx.globalAlpha = 1
}

/** 主渲染入口：设好世界变换后绘制地形与动态元素 */
export function render(
  ctx: CanvasRenderingContext2D,
  world: World,
  terrain: HTMLCanvasElement,
  cam: Camera,
  view: View,
  timeMs: number,
  drawOverlay?: (ctx: CanvasRenderingContext2D, timeMs: number) => void,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#0b0e09'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.imageSmoothingEnabled = false

  const z = cam.zoom
  const { w, h, dpr } = view
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (w / 2 - cam.x * z * TILE), dpr * (h / 2 - cam.y * z * TILE))
  ctx.drawImage(terrain, 0, 0)
  drawWaterShimmer(ctx, world, cam, view, timeMs)
  drawOverlay?.(ctx, timeMs)
}
