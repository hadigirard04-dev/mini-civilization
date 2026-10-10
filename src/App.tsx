import { useEffect, useRef, useState } from 'react'
import { clampCamera, screenToWorld, TILE, type Camera } from './render/camera'
import { render, type View } from './render/draw'
import { drawEntities, type Selection } from './render/entities'
import { buildTerrainCanvas } from './render/terrain'
import { loadFrom, saveTo } from './sim/save'
import { Simulation } from './sim/simulation'
import type { ResourceType } from './sim/world'
import { getTile } from './sim/world'
import Sidebar, { type SelectedTileInfo, type SelectedVillagerInfo, type UiSnapshot } from './ui/Sidebar'

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000)
}

function makeSnapshot(sim: Simulation, selection: Selection): UiSnapshot {
  const s = sim.state
  let pop = 0
  for (const v of s.villagers) if (v.alive) pop++
  let villager: SelectedVillagerInfo | null = null
  let tile: SelectedTileInfo | null = null
  if (selection?.kind === 'villager') {
    const v = s.villagers.find((x) => x.id === selection.id)
    if (v) {
      villager = {
        id: v.id,
        name: v.name,
        age: v.age,
        hunger: v.hunger,
        stamina: v.stamina,
        task: v.task,
        carry: v.carry,
        carryType: v.carryType,
        alive: v.alive,
      }
    }
  } else if (selection?.kind === 'tile') {
    const t = getTile(s.world, selection.x, selection.y)
    if (t) tile = { x: selection.x, y: selection.y, terrain: t.terrain, resource: t.resource, max: t.max }
  }
  return {
    tick: s.tick,
    paused: sim.paused,
    speed: sim.speed,
    seed: s.world.seed,
    pop,
    capacity: sim.capacity,
    buildings: s.buildings.length,
    sites: s.sites.length,
    births: s.births,
    deaths: s.deaths,
    stock: { ...s.stock },
    history: s.history,
    journal: s.journal ?? [],
    worldVersion: s.worldVersion ?? 0,
    villager,
    tile,
  }
}

export default function App() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<Simulation | null>(null)
  const msgTimerRef = useRef(0)
  if (!simRef.current) {
    // 启动时优先恢复本地存档
    let loaded: Simulation | null = null
    try {
      loaded = loadFrom(window.localStorage)
    } catch {
      loaded = null
    }
    simRef.current = loaded ?? new Simulation(randomSeed())
  }
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__miniCiv = { simRef }
  }
  const camRef = useRef<Camera>({ x: 32, y: 32, zoom: 1.5 })
  const viewRef = useRef<View>({ w: 0, h: 0, dpr: 1 })
  const terrainRef = useRef<HTMLCanvasElement | null>(null)
  const selectionRef = useRef<Selection>(null)
  const worldVersionRef = useRef(0)

  const [epoch, setEpoch] = useState(0)
  const [selection, setSelection] = useState<Selection>(null)
  const [saveMsg, setSaveMsg] = useState('')
  const [ui, setUi] = useState<UiSnapshot>(() => makeSnapshot(simRef.current!, null))

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  // 世界重建（重置）时刷新离屏地形
  useEffect(() => {
    const sim = simRef.current!
    terrainRef.current = buildTerrainCanvas(sim.state.world)
    setUi(makeSnapshot(sim, selectionRef.current))
  }, [epoch])

  // 画布尺寸跟随容器（含 devicePixelRatio）
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const observer = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      viewRef.current = { w, h, dpr }
      const sim = simRef.current
      if (sim) clampCamera(camRef.current, sim.state.world.size, w, h)
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  // 游戏循环：模拟推进 + 渲染（模拟与渲染分离）
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (time: number) => {
      const dt = Math.min(0.25, (time - last) / 1000)
      last = time
      const sim = simRef.current
      const terrain = terrainRef.current
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (sim && terrain && canvas && ctx && viewRef.current.w > 0) {
        sim.advance(dt)
        render(ctx, sim.state.world, terrain, camRef.current, viewRef.current, time, (octx, t) => {
          drawEntities(octx, sim.state, camRef.current, viewRef.current, t, selectionRef.current)
        })
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // 侧栏快照（200ms 节流）；地形变更（农田落成）时重建离屏地形层
  useEffect(() => {
    const timer = window.setInterval(() => {
      const sim = simRef.current
      if (!sim) return
      const snap = makeSnapshot(sim, selectionRef.current)
      if (snap.worldVersion !== worldVersionRef.current) {
        worldVersionRef.current = snap.worldVersion
        terrainRef.current = buildTerrainCanvas(sim.state.world)
      }
      setUi(snap)
    }, 200)
    return () => window.clearInterval(timer)
  }, [])

  // 空格 = 开始/暂停
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') {
        e.preventDefault()
        const sim = simRef.current
        if (sim) {
          sim.paused = !sim.paused
          setUi((prev) => ({ ...prev, paused: sim.paused }))
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 拖动平移 / 滚轮缩放 / 点击选取
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let dragging = false
    let lastX = 0
    let lastY = 0
    let downX = 0
    let downY = 0
    let downT = 0
    let moved = 0

    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      const view = viewRef.current
      return screenToWorld(camRef.current, view.w, view.h, clientX - rect.left, clientY - rect.top)
    }

    const pickVillager = (clientX: number, clientY: number) => {
      const w = toWorld(clientX, clientY)
      let best: { id: number } | null = null
      let bestD = 0.8
      for (const v of simRef.current!.state.villagers) {
        if (!v.alive) continue
        const d = Math.hypot(v.x - w.x, v.y - w.y)
        if (d < bestD) {
          bestD = d
          best = { id: v.id }
        }
      }
      return best
    }

    const pick = (clientX: number, clientY: number) => {
      const v = pickVillager(clientX, clientY)
      if (v) {
        setSelection({ kind: 'villager', id: v.id })
        return
      }
      const w = toWorld(clientX, clientY)
      const size = simRef.current!.state.world.size
      const tx = Math.floor(w.x)
      const ty = Math.floor(w.y)
      if (tx >= 0 && ty >= 0 && tx < size && ty < size) {
        setSelection({ kind: 'tile', x: tx, y: ty })
      } else {
        setSelection(null)
      }
    }

    const onDown = (e: PointerEvent) => {
      dragging = true
      moved = 0
      lastX = downX = e.clientX
      lastY = downY = e.clientY
      downT = Date.now()
      canvas.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) {
        canvas.style.cursor = pickVillager(e.clientX, e.clientY) ? 'pointer' : 'grab'
        return
      }
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      moved += Math.abs(dx) + Math.abs(dy)
      const cam = camRef.current
      const sps = TILE * cam.zoom
      cam.x -= dx / sps
      cam.y -= dy / sps
      clampCamera(cam, simRef.current!.state.world.size, viewRef.current.w, viewRef.current.h)
    }
    const onUp = (e: PointerEvent) => {
      if (dragging && moved < 6 && Date.now() - downT < 600 && downX === e.clientX && downY === e.clientY) {
        pick(e.clientX, e.clientY)
      }
      dragging = false
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const cam = camRef.current
      const view = viewRef.current
      const before = screenToWorld(cam, view.w, view.h, sx, sy)
      cam.zoom = Math.min(6, Math.max(0.4, cam.zoom * Math.exp(-e.deltaY * 0.0012)))
      const sps = TILE * cam.zoom
      cam.x = before.x - (sx - view.w / 2) / sps
      cam.y = before.y - (sy - view.h / 2) / sps
      clampCamera(cam, simRef.current!.state.world.size, view.w, view.h)
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [])

  // 控制回调
  const togglePause = () => {
    const sim = simRef.current!
    sim.paused = !sim.paused
    setUi((prev) => ({ ...prev, paused: sim.paused }))
  }
  const setSpeed = (n: number) => {
    const sim = simRef.current!
    sim.speed = n
    setUi((prev) => ({ ...prev, speed: n }))
  }
  const resetWorld = (seedText: string) => {
    const parsed = Number.parseInt(seedText.trim(), 10)
    const seed = Number.isFinite(parsed) ? parsed : randomSeed()
    const prev = simRef.current!
    const next = new Simulation(seed)
    next.speed = prev.speed
    simRef.current = next
    const half = next.state.world.size / 2
    camRef.current = { x: half, y: half, zoom: camRef.current.zoom }
    setSelection(null)
    setEpoch((e) => e + 1)
  }
  const grant = (type: ResourceType) => {
    const sim = simRef.current!
    sim.grant(type, 50)
    setUi(makeSnapshot(sim, selectionRef.current))
  }
  const flashMsg = (msg: string) => {
    setSaveMsg(msg)
    window.clearTimeout(msgTimerRef.current)
    msgTimerRef.current = window.setTimeout(() => setSaveMsg(''), 2000)
  }
  const doSave = () => {
    try {
      saveTo(simRef.current!, window.localStorage)
      flashMsg('已保存 ✓')
    } catch {
      flashMsg('保存失败')
    }
  }
  const doLoad = () => {
    try {
      const loaded = loadFrom(window.localStorage)
      if (!loaded) {
        flashMsg('没有可用存档')
        return
      }
      simRef.current = loaded
      setSelection(null)
      setEpoch((e) => e + 1)
      flashMsg('已读取 ✓')
    } catch {
      flashMsg('读取失败')
    }
  }
  const reclaim = () => {
    const sel = selectionRef.current
    if (!sel || sel.kind !== 'tile') return
    const sim = simRef.current!
    const ok = sim.reclaimToFarmland(sel.x, sel.y)
    if (ok) {
      flashMsg('已开垦为农田（木材 −5）')
      setUi(makeSnapshot(sim, selectionRef.current))
    } else {
      flashMsg('此处无法开垦')
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">▦</span>
          微型文明
          <span className="brand-sub">Mini Civilization</span>
        </div>
        <div className="topbar-meta">
          <span className="seed-tag">种子 {ui.seed}</span>
          <span className="topbar-hint">拖动平移 · 滚轮缩放 · 空格暂停</span>
        </div>
      </header>
      <div className="main">
        <div className="stage" ref={wrapRef}>
          <canvas ref={canvasRef} />
          {ui.paused && <div className="pause-chip">‖ 已暂停</div>}
        </div>
        <Sidebar
          ui={ui}
          selection={selection}
          onTogglePause={togglePause}
          onSpeed={setSpeed}
          onReset={resetWorld}
          onGrant={grant}
          onClearSelection={() => setSelection(null)}
          onSave={doSave}
          onLoad={doLoad}
          saveMsg={saveMsg}
          onReclaim={reclaim}
        />
      </div>
    </div>
  )
}
