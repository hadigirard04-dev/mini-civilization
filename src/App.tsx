import { civilizationView, ERAS, type ConstructionKind, type CivilizationView } from './sim/civilization'
import MiniMap from './ui/MiniMap'
import { buildingCount, survivalView, SEASONS, type BuildingKind } from './sim/survival'
import { CampaignDialog } from './ui/SurvivalPanel'
import { useEffect, useRef, useState } from 'react'
import { clampCamera, frameSettlement, screenToWorld, TILE, type Camera } from './render/camera'
import { render, type View } from './render/draw'
import { drawEntities, type Selection } from './render/entities'
import { buildTerrainCanvas, patchTerrainCanvas } from './render/terrain'
import { createWalkers, drawPlot, updateWalkers, type Walker } from './render/plot'
import { AUTO_SAVE_KEY, loadFrom, saveTo, SAVE_KEY } from './sim/save'
import {
  PLOT_AUTO_SAVE_KEY,
  PLOT_SAVE_KEY,
  detectSaveKind,
  loadPlot,
  savePlot,
  type SaveKind,
} from './sim/plot/save'
import { BLOCK_SIZE } from './sim/plot/config'
import { gridSize } from './sim/plot/blocks'
import { populationOf } from './sim/plot/economy'
import { PlotSim, type PlotView } from './sim/plot/sim'
import type { Block, Overlay, Policy } from './sim/plot/types'
import PlotPanel from './ui/PlotPanel'
import { Simulation } from './sim/simulation'
import type { ResourceType } from './sim/world'
import { getTile } from './sim/world'
import type { SimState } from './sim/types'
import Sidebar, { type SelectedTileInfo, type SelectedVillagerInfo, type UiSnapshot } from './ui/Sidebar'

type AnySim = PlotSim | Simulation
type NewMode = 'plot' | 'sandbox' | 'survival' | 'evolution'

function isPlot(sim: AnySim): sim is PlotSim {
  return sim instanceof PlotSim
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000)
}

function legacyKind(storage: Storage): SaveKind {
  for (const key of [AUTO_SAVE_KEY, SAVE_KEY]) {
    const kind = detectSaveKind(storage, key)
    if (kind !== 'none') return kind
  }
  return 'none'
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
        civicJob: v.civicJob,
        sex: v.sex,
        pregnancyDays:
          v.pregnancyDue === null || v.pregnancyDue === undefined
            ? null
            : Math.max(0, Math.ceil((v.pregnancyDue - s.tick) / 60)),
        profession: v.profession,
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
    civilization: civilizationView(s),
    campaign: survivalView(s),
    blocked: sim.blocked,
    tick: s.tick,
    paused: sim.paused,
    speed: sim.speed,
    seed: s.world.seed,
    pop,
    capacity: sim.capacity,
    buildings:
      buildingCount(s, 'house') +
      (s.civilization ? s.buildings.filter((b) => b.type === 'skyscraper').length : 0),
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
  const simRef = useRef<AnySim | null>(null)
  const msgTimerRef = useRef(0)
  const startupNoticeRef = useRef('')

  if (!simRef.current) {
    const storage = window.localStorage
    let loaded: AnySim | null = null
    try {
      loaded = loadPlot(storage, PLOT_AUTO_SAVE_KEY) ?? loadPlot(storage, PLOT_SAVE_KEY)
    } catch {
      loaded = null
    }
    if (!loaded) {
      const kind = legacyKind(storage)
      if (kind === 'legacy-civilization') {
        startupNoticeRef.current = '旧文明存档（v0.3/v0.5）不能在新版继续，已开始新的大陆演化；自由沙盒与首年生存存档仍可读取'
      } else if (kind === 'legacy-other') {
        try {
          loaded = loadFrom(storage, AUTO_SAVE_KEY) ?? loadFrom(storage, SAVE_KEY)
        } catch {
          loaded = null
        }
      }
    }
    const sim: AnySim = loaded ?? PlotSim.create(randomSeed())
    sim.paused = true
    sim.speed = 20
    simRef.current = sim
  }
  const camRef = useRef<Camera>({
    x: simRef.current!.state.world.size / 2,
    y: simRef.current!.state.world.size / 2,
    zoom: isPlot(simRef.current!) ? 0.55 : 1.5,
  })
  const viewRef = useRef<View>({ w: 0, h: 0, dpr: 1 })
  const terrainRef = useRef<HTMLCanvasElement | null>(null)
  const selectionRef = useRef<Selection>(null)
  const worldVersionRef = useRef(0)
  const followRef = useRef(isPlot(simRef.current!) || !!simRef.current!.state.civilization)
  const followTargetRef = useRef<{ key: string; camera: Camera } | null>(null)
  const walkersRef = useRef<Walker[]>([])

  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__miniCiv = { simRef, camRef, selectionRef }
  }

  const [epoch, setEpoch] = useState(0)
  const [selection, setSelection] = useState<Selection>(null)
  const [saveMsg, setSaveMsg] = useState(startupNoticeRef.current)
  const [ui, setUi] = useState<UiSnapshot | null>(() =>
    isPlot(simRef.current!) ? null : makeSnapshot(simRef.current!, null),
  )
  const [plotUi, setPlotUi] = useState<PlotView | null>(() => (isPlot(simRef.current!) ? simRef.current!.view() : null))
  const [following, setFollowing] = useState(followRef.current)
  const [runtime, setRuntime] = useState({ fps: 0, speed: 0 })

  const selectedBlock = ((): Block | null => {
    const sim = simRef.current
    if (!sim || !isPlot(sim) || selection?.kind !== 'tile') return null
    const bg = gridSize(sim.state.world)
    const bx = Math.floor(selection.x / BLOCK_SIZE)
    const by = Math.floor(selection.y / BLOCK_SIZE)
    if (bx < 0 || by < 0 || bx >= bg || by >= bg) return null
    return sim.state.blocks[by * bg + bx]
  })()

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  // 世界重建（重置）时刷新离屏地形
  useEffect(() => {
    const sim = simRef.current!
    terrainRef.current = buildTerrainCanvas(sim.state.world)
    walkersRef.current = []
    if (isPlot(sim)) {
      setPlotUi(sim.view())
      setUi(null)
    } else {
      setUi(makeSnapshot(sim, selectionRef.current))
      setPlotUi(null)
    }
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
    let sampledAt = last,
      frames = 0,
      sampledTick = simRef.current!.state.tick
    const loop = (time: number) => {
      const dt = Math.min(0.25, (time - last) / 1000)
      last = time
      const sim = simRef.current
      const terrain = terrainRef.current
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (sim && terrain && canvas && ctx && viewRef.current.w > 0) {
        const plot = isPlot(sim)
        sim.advance(dt, plot ? 3 : 5)
        if (plot) {
          const state = sim.state
          const claimed = state.blocks.filter((b) => b.settlement >= 0)
          if (followRef.current && claimed.length > 0) {
            const s = state,
              view = viewRef.current
            const key = `${s.world.seed}/${claimed.length}/${view.w}/${view.h}`
            if (followTargetRef.current?.key !== key) {
              const points = claimed.map((b) => ({ x: b.bx * BLOCK_SIZE, y: b.by * BLOCK_SIZE }))
              const target = frameSettlement(points, s.world.size, view.w, view.h)
              // 城市变大后不要把整张地图缩成一片：保持街道级取景，超出画面的部分自然成长
              target.zoom = Math.max(0.3, target.zoom)
              followTargetRef.current = { key, camera: target }
            }
            const target = followTargetRef.current!.camera,
              alpha = 1 - Math.exp(-dt * 4)
            const camera = camRef.current
            camera.x += (target.x - camera.x) * alpha
            camera.y += (target.y - camera.y) * alpha
            camera.zoom += (target.zoom - camera.zoom) * alpha
          }
          const target = Math.max(24, Math.min(300, Math.round(populationOf(state) / 8)))
          if (walkersRef.current.length === 0 || Math.abs(walkersRef.current.length - target) > target * 0.4) {
            walkersRef.current = createWalkers(state, target, Math.random)
          }
          updateWalkers(state, walkersRef.current, dt)
          const blockIndex =
            selectionRef.current?.kind === 'tile'
              ? Math.floor(selectionRef.current.y / BLOCK_SIZE) * gridSize(state.world) +
                Math.floor(selectionRef.current.x / BLOCK_SIZE)
              : -1
          render(ctx, state.world, terrain, camRef.current, viewRef.current, time, (octx) => {
            drawPlot(octx, state, camRef.current, viewRef.current, time, walkersRef.current, blockIndex)
          })
        } else if (sim.state.civilization) {
          if (followRef.current) {
            const s = sim.state,
              view = viewRef.current
            const key = `${s.world.seed}/${s.worldVersion}/${s.buildings.length}/${s.civilization!.era}/${view.w}/${view.h}`
            if (followTargetRef.current?.key !== key) {
              const core = s.buildings.filter((b) => !['quarry', 'factory', 'powerplant', 'granary', 'farmhouse'].includes(b.type ?? ''))
              followTargetRef.current = { key, camera: frameSettlement(core, s.world.size, view.w, view.h, s.civilization!.era) }
            }
            const target = followTargetRef.current!.camera,
              alpha = 1 - Math.exp(-dt * 5)
            const camera = camRef.current
            camera.x += (target.x - camera.x) * alpha
            camera.y += (target.y - camera.y) * alpha
            camera.zoom += (target.zoom - camera.zoom) * alpha
          }
          render(ctx, sim.state.world, terrain, camRef.current, viewRef.current, time, (octx, t) => {
            drawEntities(octx, sim.state, camRef.current, viewRef.current, t, selectionRef.current)
          })
        } else {
          render(ctx, sim.state.world, terrain, camRef.current, viewRef.current, time, (octx, t) => {
            drawEntities(octx, sim.state, camRef.current, viewRef.current, t, selectionRef.current)
          })
        }
        frames++
        if (sim.state.tick < sampledTick) {
          sampledTick = sim.state.tick
          sampledAt = time
          frames = 0
        }
        if (time - sampledAt >= 1000) {
          const seconds = (time - sampledAt) / 1000
          setRuntime({
            fps: Math.round(frames / seconds),
            speed: Math.max(0, (sim.state.tick - sampledTick) / sim.tickRate / seconds),
          })
          sampledAt = time
          sampledTick = sim.state.tick
          frames = 0
        }
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
      if (isPlot(sim)) {
        setPlotUi(sim.view())
        return
      }
      const snap = makeSnapshot(sim, selectionRef.current)
      if (snap.worldVersion !== worldVersionRef.current) {
        worldVersionRef.current = snap.worldVersion
        if (terrainRef.current) patchTerrainCanvas(terrainRef.current, sim.state.world)
      }
      setUi(snap)
    }, 200)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const persist = () => {
      const sim = simRef.current
      if (!sim) return
      try {
        if (isPlot(sim)) savePlot(sim, window.localStorage, PLOT_AUTO_SAVE_KEY)
        else saveTo(sim, window.localStorage, AUTO_SAVE_KEY)
      } catch {
        setSaveMsg('自动保存失败，请检查浏览器存储空间')
      }
    }
    const timer = window.setInterval(persist, 5000)
    const onHidden = () => {
      if (document.visibilityState === 'hidden') persist()
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', persist)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', persist)
    }
  }, [])

  // 空格 = 开始/暂停
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName)) return
      if (e.code === 'Space') {
        e.preventDefault()
        const sim = simRef.current
        if (sim && !sim.blocked) {
          sim.paused = !sim.paused
          if (isPlot(sim)) setPlotUi((prev) => (prev ? { ...prev, paused: sim.paused } : prev))
          else setUi((prev) => (prev ? { ...prev, paused: sim.paused } : prev))
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
    const pointers = new Map<number, { x: number; y: number }>()
    let downT = 0
    let moved = 0
    const stopFollowing = () => {
      if (!followRef.current) return
      followRef.current = false
      setFollowing(false)
    }

    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      const view = viewRef.current
      return screenToWorld(camRef.current, view.w, view.h, clientX - rect.left, clientY - rect.top)
    }

    const pickVillager = (clientX: number, clientY: number) => {
      const sim = simRef.current
      if (!sim || isPlot(sim)) return null
      const w = toWorld(clientX, clientY)
      let best: { id: number } | null = null
      let bestD = 0.8
      for (const v of sim.state.villagers) {
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
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      dragging = true
      moved = pointers.size > 1 ? 999 : 0
      lastX = e.clientX
      lastY = e.clientY
      downT = Date.now()
      canvas.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (pointers.size >= 2 && pointers.has(e.pointerId)) {
        stopFollowing()
        const beforePair = [...pointers.values()].slice(0, 2)
        const distance = (p: typeof beforePair) => Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y)
        const mid = (p: typeof beforePair) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 })
        const before = toWorld(mid(beforePair).x, mid(beforePair).y)
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        const pair = [...pointers.values()].slice(0, 2)
        const ratio = distance(beforePair) > 1 ? distance(pair) / distance(beforePair) : 1
        const cam = camRef.current
        cam.zoom = Math.min(6, Math.max(0.06, cam.zoom * ratio))
        const rect = canvas.getBoundingClientRect()
        const center = mid(pair),
          view = viewRef.current,
          sps = TILE * cam.zoom
        cam.x = before.x - (center.x - rect.left - view.w / 2) / sps
        cam.y = before.y - (center.y - rect.top - view.h / 2) / sps
        clampCamera(cam, simRef.current!.state.world.size, view.w, view.h)
        moved = 999
        return
      }
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (!dragging) {
        canvas.style.cursor = pickVillager(e.clientX, e.clientY) ? 'pointer' : 'grab'
        return
      }
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      moved += Math.abs(dx) + Math.abs(dy)
      if (moved > 8) stopFollowing()
      const cam = camRef.current
      const sps = TILE * cam.zoom
      cam.x -= dx / sps
      cam.y -= dy / sps
      clampCamera(cam, simRef.current!.state.world.size, viewRef.current.w, viewRef.current.h)
    }
    const onUp = (e: PointerEvent) => {
      if (e.type !== 'pointercancel' && pointers.size === 1 && dragging && moved < 8 && Date.now() - downT < 600) {
        pick(e.clientX, e.clientY)
      }
      pointers.delete(e.pointerId)
      dragging = pointers.size > 0
      const remaining = [...pointers.values()][0]
      if (remaining) {
        lastX = remaining.x
        lastY = remaining.y
        moved = 999
      }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      stopFollowing()
      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const cam = camRef.current
      const view = viewRef.current
      const before = screenToWorld(cam, view.w, view.h, sx, sy)
      cam.zoom = Math.min(6, Math.max(0.06, cam.zoom * Math.exp(-e.deltaY * 0.0012)))
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
    if (sim.blocked) return
    sim.paused = !sim.paused
    if (isPlot(sim)) setPlotUi((prev) => (prev ? { ...prev, paused: sim.paused } : prev))
    else setUi((prev) => (prev ? { ...prev, paused: sim.paused } : prev))
  }
  const setSpeed = (n: number) => {
    const sim = simRef.current!
    sim.speed = n
    if (isPlot(sim)) setPlotUi((prev) => (prev ? { ...prev, speed: n } : prev))
    else setUi((prev) => (prev ? { ...prev, speed: n } : prev))
  }
  const resetWorld = (seedText: string, mode: NewMode = 'plot') => {
    const parsed = Number.parseInt(seedText.trim(), 10)
    const seed = Number.isFinite(parsed) ? parsed : randomSeed()
    const prev = simRef.current!
    const resolved: 'plot' | 'sandbox' | 'survival' = mode === 'evolution' ? 'plot' : mode
    const next: AnySim = resolved === 'plot' ? PlotSim.create(seed) : new Simulation(seed, resolved)
    next.paused = true
    next.speed = prev.speed
    simRef.current = next
    followRef.current = resolved === 'plot'
    followTargetRef.current = null
    walkersRef.current = []
    setFollowing(followRef.current)
    const half = next.state.world.size / 2
    camRef.current = { x: half, y: half, zoom: resolved === 'plot' ? 0.55 : camRef.current.zoom }
    setSelection(null)
    setEpoch((e) => e + 1)
    try {
      if (isPlot(next)) savePlot(next, window.localStorage, PLOT_AUTO_SAVE_KEY)
      else saveTo(next, window.localStorage, AUTO_SAVE_KEY)
    } catch {
      setSaveMsg('自动保存失败')
    }
  }
  const grant = (type: ResourceType) => {
    const sim = simRef.current!
    if (isPlot(sim)) return
    sim.grant(type, 50)
    setUi(makeSnapshot(sim, selectionRef.current))
  }
  const flashMsg = (msg: string) => {
    setSaveMsg(msg)
    window.clearTimeout(msgTimerRef.current)
    msgTimerRef.current = window.setTimeout(() => setSaveMsg(''), 2500)
  }
  const doSave = () => {
    const sim = simRef.current!
    try {
      if (isPlot(sim)) {
        savePlot(sim, window.localStorage, PLOT_SAVE_KEY)
        savePlot(sim, window.localStorage, PLOT_AUTO_SAVE_KEY)
      } else {
        saveTo(sim, window.localStorage)
        saveTo(sim, window.localStorage, AUTO_SAVE_KEY)
      }
      flashMsg('已保存 ✓')
    } catch {
      flashMsg('保存失败')
    }
  }
  const doLoad = () => {
    const sim = simRef.current!
    try {
      if (isPlot(sim)) {
        const loaded = loadPlot(window.localStorage, PLOT_SAVE_KEY) ?? loadPlot(window.localStorage, PLOT_AUTO_SAVE_KEY)
        if (!loaded) {
          flashMsg('没有可用存档')
          return
        }
        simRef.current = loaded
        followRef.current = true
        followTargetRef.current = null
        walkersRef.current = []
        setFollowing(true)
        setSelection(null)
        setEpoch((e) => e + 1)
        flashMsg('已读取 ✓')
        return
      }
      const loaded = loadFrom(window.localStorage)
      if (!loaded) {
        flashMsg('没有可用存档')
        return
      }
      simRef.current = loaded
      followRef.current = !!loaded.state.civilization
      followTargetRef.current = null
      setFollowing(followRef.current)
      setSelection(null)
      setEpoch((e) => e + 1)
      saveTo(loaded, window.localStorage, AUTO_SAVE_KEY)
      flashMsg('已读取 ✓')
    } catch {
      flashMsg('读取失败')
    }
  }
  const reclaim = () => {
    const sel = selectionRef.current
    const sim = simRef.current!
    if (isPlot(sim) || !sel || sel.kind !== 'tile') return
    const ok = sim.reclaimToFarmland(sel.x, sel.y)
    if (ok) {
      flashMsg(sim.state.campaign ? '已安排开垦，等待建筑工' : '已开垦为农田（木材 −5）')
      setUi(makeSnapshot(sim, selectionRef.current))
    } else {
      flashMsg('此处无法开垦')
    }
  }

  const changeWorkforce = (farmers: number, builders: number) => {
    const sim = simRef.current!
    if (isPlot(sim)) return
    if (sim.setWorkforce(farmers, builders)) setUi(makeSnapshot(sim, selectionRef.current))
  }
  const build = (kind: BuildingKind) => {
    const sim = simRef.current!
    if (isPlot(sim)) return
    if (!sim.orderBuilding(kind)) flashMsg('材料不足、工地已满或此处无可建草地')
    setUi(makeSnapshot(sim, selectionRef.current))
  }
  const choose = (choice: number) => {
    const sim = simRef.current!
    if (isPlot(sim)) return
    if (sim.resolveEvent(choice)) {
      setUi(makeSnapshot(sim, selectionRef.current))
      try {
        saveTo(sim, window.localStorage, AUTO_SAVE_KEY)
      } catch {
        flashMsg('自动保存失败')
      }
    }
  }

  const construct = (kind: ConstructionKind) => {
    const sim = simRef.current!
    if (isPlot(sim)) return
    if (!sim.orderCivic(kind)) flashMsg('材料不足、未解锁或施工队列已满')
    setUi(makeSnapshot(sim, selectionRef.current))
  }
  const toggleAuto = () => {
    const sim = simRef.current!
    if (isPlot(sim)) return
    const c = sim.state.civilization
    if (c) c.autoBuild = !c.autoBuild
    setUi(makeSnapshot(sim, selectionRef.current))
  }
  const setPriority = (priority: CivilizationView['priority']) => {
    const sim = simRef.current!
    if (isPlot(sim)) return
    const c = sim.state.civilization
    if (c) c.priority = priority
    setUi(makeSnapshot(sim, selectionRef.current))
  }
  const setPolicy = (policy: Policy) => {
    const sim = simRef.current!
    if (!isPlot(sim)) return
    sim.setPolicy(policy)
    setPlotUi(sim.view())
  }
  const setOverlay = (overlay: Overlay) => {
    const sim = simRef.current!
    if (!isPlot(sim)) return
    sim.setOverlay(overlay)
    setPlotUi(sim.view())
  }
  const navigate = (x: number, y: number) => {
    followRef.current = false
    setFollowing(false)
    camRef.current.x = x
    camRef.current.y = y
    clampCamera(camRef.current, simRef.current!.state.world.size, viewRef.current.w, viewRef.current.h)
  }
  const mapOverview = (city: boolean) => {
    followRef.current = false
    setFollowing(false)
    const sim = simRef.current!
    const s = sim.state
    const view = viewRef.current
    let minX = 0,
      maxX = s.world.size,
      minY = 0,
      maxY = s.world.size
    if (city) {
      if (isPlot(sim)) {
        const claimed = sim.state.blocks.filter((b) => b.settlement >= 0)
        if (claimed.length > 0) {
          minX = Math.min(...claimed.map((b) => b.bx)) * BLOCK_SIZE - BLOCK_SIZE
          maxX = Math.max(...claimed.map((b) => b.bx)) * BLOCK_SIZE + BLOCK_SIZE * 2
          minY = Math.min(...claimed.map((b) => b.by)) * BLOCK_SIZE - BLOCK_SIZE
          maxY = Math.max(...claimed.map((b) => b.by)) * BLOCK_SIZE + BLOCK_SIZE * 2
        }
      } else {
        const points = sim.state.buildings
        minX = Math.min(...points.map((b) => b.x), s.world.size / 2) - 8
        maxX = Math.max(...points.map((b) => b.x), s.world.size / 2) + 8
        minY = Math.min(...points.map((b) => b.y), s.world.size / 2) - 10
        maxY = Math.max(...points.map((b) => b.y), s.world.size / 2) + 8
      }
    }
    camRef.current = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      zoom: Math.min(view.w / (16 * (maxX - minX)), view.h / (16 * (maxY - minY)), 2),
    }
    clampCamera(camRef.current, s.world.size, view.w, view.h)
  }

  const plotMode = plotUi !== null
  const plotSim = simRef.current && isPlot(simRef.current) ? simRef.current : null

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">▦</span>
          微型文明
          <span className="brand-sub">
            {plotMode ? 'Plot Civilization' : ui?.civilization ? 'World Evolution' : ui?.campaign ? 'First Winter' : 'Sandbox'}
          </span>
        </div>
        <div className="topbar-meta">
          <span className="seed-tag">
            {plotMode || ui?.civilization ? '256×256' : '64×64'} · 种子 {plotMode ? plotUi.seed : ui?.seed}
          </span>
          <span className="topbar-hint">拖动平移 · 双指 / 滚轮缩放 · 空格暂停</span>
        </div>
      </header>
      <div className="main">
        <div className="stage" ref={wrapRef}>
          <canvas ref={canvasRef} />
          {plotMode && (
            <>
              <div className="city-map-heading">
                <b>{plotUi.eraName}</b>
                <span>
                  {Math.round(plotUi.population)} 人 · {plotUi.settlements.length} 聚落 · v0.6
                </span>
                <small>
                  {runtime.fps} FPS · 实速 {runtime.speed.toFixed(1)}× / 目标 {plotUi.speed}×
                </small>
              </div>
              <div className="map-controls">
                <button
                  className={following ? 'active' : ''}
                  onClick={() => {
                    followRef.current = true
                    followTargetRef.current = null
                    setFollowing(true)
                  }}
                >
                  跟随城市
                </button>
                <button onClick={() => mapOverview(true)}>全城总览</button>
                <button onClick={() => mapOverview(false)}>整片大陆</button>
              </div>
            </>
          )}
          {ui?.civilization && (
            <>
              <div className="city-map-heading">
                <b>{ERAS[ui.civilization.era]}</b>
                <span>
                  {ui.pop} 人 · {ui.civilization.buildings} 座建筑 · v0.5
                </span>
                <small>
                  {runtime.fps} FPS · 实速 {runtime.speed.toFixed(1)}× / 目标 {ui.speed}×
                </small>
              </div>
              <div className="map-controls">
                <button
                  className={following ? 'active' : ''}
                  onClick={() => {
                    followRef.current = true
                    followTargetRef.current = null
                    setFollowing(true)
                  }}
                >
                  跟随城市
                </button>
                <button onClick={() => mapOverview(true)}>全城总览</button>
                <button onClick={() => mapOverview(false)}>整片大陆</button>
              </div>
              <MiniMap state={simRef.current!.state as SimState} cam={camRef.current} view={viewRef.current} onNavigate={navigate} />
            </>
          )}
          {plotMode && plotUi.paused && <div className="pause-chip">‖ 已暂停</div>}
          {!plotMode && ui?.blocked && <div className="pause-chip">等待决策</div>}
          {!plotMode && !ui?.blocked && ui?.paused && <div className="pause-chip">‖ 已暂停</div>}
          {ui?.campaign && (
            <div className={`stage-season season-${ui.campaign.season}`}>
              {SEASONS[ui.campaign.season]}季 · 第 {ui.campaign.day} 天
              <span>
                口粮 {Math.floor(ui.stock.food)} / {ui.campaign.foodCapacity}
              </span>
            </div>
          )}
        </div>
        {plotMode ? (
          <PlotPanel
            view={plotUi}
            state={plotSim!.state}
            cam={camRef.current}
            canvasView={viewRef.current}
            fps={runtime.fps}
            runtimeSpeed={runtime.speed}
            selection={selectedBlock}
            saveMsg={saveMsg}
            onTogglePause={togglePause}
            onSpeed={setSpeed}
            onReset={(seed) => resetWorld(seed, 'plot')}
            onSave={doSave}
            onLoad={doLoad}
            onPolicy={setPolicy}
            onOverlay={setOverlay}
            onFollow={() => {
              followRef.current = true
              followTargetRef.current = null
              setFollowing(true)
            }}
            onCityOverview={() => mapOverview(true)}
            onContinent={() => mapOverview(false)}
            onNewMode={(mode) => resetWorld(String(plotUi.seed), mode)}
          />
        ) : (
          <Sidebar
            ui={ui!}
            selection={selection}
            onTogglePause={togglePause}
            onSpeed={setSpeed}
            onReset={(seedText, mode) => resetWorld(seedText, mode === 'evolution' ? 'plot' : mode)}
            onGrant={grant}
            onClearSelection={() => setSelection(null)}
            onSave={doSave}
            onLoad={doLoad}
            saveMsg={saveMsg}
            onReclaim={reclaim}
            onConstruct={construct}
            onAuto={toggleAuto}
            onPriority={setPriority}
            onWorkforce={changeWorkforce}
            onBuild={build}
          />
        )}
      </div>
      <CampaignDialog
        c={ui?.campaign ?? null}
        population={ui?.pop ?? 0}
        capacity={ui?.capacity ?? 0}
        onChoice={choose}
        onContinue={() => {
          const sim = simRef.current!
          if (isPlot(sim)) return
          sim.continueAfterYear()
          setUi(makeSnapshot(sim, selectionRef.current))
        }}
        onRestart={() => resetWorld(String(ui?.seed ?? ''), 'survival')}
      />
    </div>
  )
}
