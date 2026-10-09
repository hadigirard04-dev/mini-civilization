import { useEffect, useRef } from 'react'
import type { HistoryPoint } from '../sim/types'

export const SERIES = [
  { key: 'pop' as const, color: '#e0a83c', label: '人口' },
  { key: 'food' as const, color: '#7fae4e', label: '食物' },
  { key: 'wood' as const, color: '#c08a52', label: '木材' },
  { key: 'stone' as const, color: '#9aa3ad', label: '石头' },
]

/** 历史统计曲线：每条序列按自身最大值归一化，实时刷新 */
export default function StatsChart({ history, tick }: { history: HistoryPoint[]; tick: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // 网格
    ctx.strokeStyle = '#232a1f'
    ctx.lineWidth = 1
    for (let i = 1; i <= 3; i++) {
      const y = Math.round((h * i) / 4) + 0.5
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    const pts = history.slice(-450)
    if (pts.length < 2) {
      ctx.fillStyle = '#77735f'
      ctx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('世界启动中，等待数据…', w / 2, h / 2)
      return
    }

    const pad = 4
    for (const s of SERIES) {
      let max = 1
      for (const p of pts) if (p[s.key] > max) max = p[s.key]
      ctx.beginPath()
      pts.forEach((p, i) => {
        const x = pad + (i / (pts.length - 1)) * (w - pad * 2)
        const y = h - 3 - (p[s.key] / max) * (h - 8)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.strokeStyle = s.color
      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      ctx.stroke()

      // 末端点
      const last = pts[pts.length - 1]
      const lx = w - pad
      const ly = h - 3 - (last[s.key] / max) * (h - 8)
      ctx.fillStyle = s.color
      ctx.beginPath()
      ctx.arc(lx, ly, 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [history, tick])

  return <canvas ref={ref} className="chart" />
}
