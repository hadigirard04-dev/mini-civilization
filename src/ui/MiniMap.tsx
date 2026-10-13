import { useEffect, useRef } from 'react'
import type { SimState } from '../sim/types'
import type { Camera } from '../render/camera'
import type { View } from '../render/draw'
const COLORS = [
  '#6d9949',
  '#345f35',
  '#4385a7',
  '#938877',
  '#b59a4b',
  '#d0b174',
  '#d2e0e4',
  '#638c7a',
  '#959b67',
  '#667480',
]
export default function MiniMap({
  state,
  cam,
  view,
  onNavigate,
}: {
  state: SimState
  cam: Camera
  view: View
  onNavigate: (x: number, y: number) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const cache = useRef<{ seed: number; version: number; canvas: HTMLCanvasElement } | null>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const { world } = state,
      size = world.size
    if (!cache.current || cache.current.seed !== world.seed || cache.current.version !== state.worldVersion) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const cc = canvas.getContext('2d')!,
        pixels = cc.createImageData(size, size)
      for (let i = 0; i < world.tiles.length; i++) {
        const color = COLORS[world.tiles[i].terrain]
        pixels.data[i * 4] = parseInt(color.slice(1, 3), 16)
        pixels.data[i * 4 + 1] = parseInt(color.slice(3, 5), 16)
        pixels.data[i * 4 + 2] = parseInt(color.slice(5, 7), 16)
        pixels.data[i * 4 + 3] = 255
      }
      cc.putImageData(pixels, 0, 0)
      cache.current = { seed: world.seed, version: state.worldVersion, canvas }
    }
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(cache.current.canvas, 0, 0, 128, 128)
    ctx.fillStyle = '#f8d881'
    for (const b of state.buildings) ctx.fillRect((b.x / size) * 128, (b.y / size) * 128, 2, 2)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1
    const scale = 128 / size,
      hw = view.w / (16 * cam.zoom) / 2,
      hh = view.h / (16 * cam.zoom) / 2
    ctx.strokeRect((cam.x - hw) * scale, (cam.y - hh) * scale, hw * 2 * scale, hh * 2 * scale)
  })
  return (
    <div className="mini-map">
      <span>大陆 · 点按定位</span>
      <canvas
        width={128}
        height={128}
        ref={ref}
        aria-label="大陆小地图"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onNavigate(
            ((e.clientX - r.left) / r.width) * state.world.size,
            ((e.clientY - r.top) / r.height) * state.world.size,
          )
        }}
      />
    </div>
  )
}
