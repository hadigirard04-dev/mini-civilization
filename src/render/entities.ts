import { BUILDINGS, PROFESSION_LABEL, seasonAt } from '../sim/survival'
import type { SimState, Villager } from '../sim/types'
import { TILE, worldToScreen, type Camera } from './camera'
import type { View } from './draw'

export type Selection = { kind: 'villager'; id: number } | { kind: 'tile'; x: number; y: number } | null

/** 资源色（图例与携带物共用） */
export const RESOURCE_COLOR: Record<string, string> = {
  food: '#7fae4e',
  wood: '#c08a52',
  stone: '#9aa3ad',
}

const SKIN = '#e0b48a'
const SKIN_2 = '#c99a70'
const HAIR = '#3b2f23'
const PANTS = '#4a4234'
const ROOF = '#b2593c'
const ROOF_DARK = '#8f4530'
const WALL = '#d9cfb0'
const WALL_SHADE = '#b8ad8d'
const DOOR = '#4a3524'
const WINDOW = '#7fb4d8'

function drawGrave(ctx: CanvasRenderingContext2D, v: Villager): void {
  const px = v.x * TILE
  const py = v.y * TILE
  ctx.fillStyle = 'rgba(20, 24, 16, 0.55)'
  ctx.beginPath()
  ctx.ellipse(px, py + 2, 5, 3, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#8d8674'
  ctx.fillRect(px - 0.5, py - 5, 1, 5)
  ctx.fillRect(px - 2, py - 3.5, 4, 1)
}

function drawVillager(ctx: CanvasRenderingContext2D, v: Villager, timeMs: number, tick: number): void {
  const px = Math.round(v.x * TILE)
  const py = Math.round(v.y * TILE)
  const walking = v.path.length > 0
  const phase = v.movePhase * 0.9
  const legA = walking ? Math.round(Math.sin(phase) * 2) : 0
  const legB = -legA
  const bob = walking ? (Math.abs(Math.sin(phase)) > 0.5 ? 1 : 0) : 0

  ctx.save()
  ctx.translate(px, py)

  // 影子
  ctx.fillStyle = 'rgba(10, 14, 8, 0.3)'
  ctx.beginPath()
  ctx.ellipse(0, 5, 4.5, 2, 0, 0, Math.PI * 2)
  ctx.fill()

  if (v.task === 'rest' && !walking) {
    // 躺下休息：横向身体 + 浮动的 z
    ctx.fillStyle = PANTS
    ctx.fillRect(-4, 1, 7, 3)
    ctx.fillStyle =
      v.profession === 'farmer'
        ? '#8db35d'
        : v.profession === 'builder'
          ? '#dfac45'
          : v.profession === 'gatherer'
            ? '#8aafb6'
            : `hsl(${v.hue}, 45%, 50%)`
    ctx.fillRect(-4, -2, 7, 3)
    ctx.fillStyle = SKIN
    ctx.fillRect(3, -2, 3, 3)
    ctx.fillStyle = '#cfd8e2'
    const zt = ((timeMs * 0.04 + v.id * 13) % 22) | 0
    ctx.fillRect(6, -6 - zt * 0.3, 2, 2)
    if (zt > 10) ctx.fillRect(8, -10 - (zt - 10) * 0.3, 2, 2)
    ctx.restore()
    return
  }

  // 腿（行走交替）
  ctx.fillStyle = PANTS
  ctx.fillRect(-2.5, 2, 2, 3 + Math.max(0, legA))
  ctx.fillRect(0.5, 2, 2, 3 + Math.max(0, legB))

  // 携带物（背后的筐）
  if (v.carry > 0.05 && v.carryType) {
    ctx.fillStyle = RESOURCE_COLOR[v.carryType] ?? '#ccc'
    ctx.fillRect(v.facing > 0 ? -5.5 : 3, -2, 3, 3)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 0.5
    ctx.strokeRect(v.facing > 0 ? -5.5 : 3, -2, 3, 3)
  }

  // 身体
  ctx.fillStyle =
    v.profession === 'farmer'
      ? '#8db35d'
      : v.profession === 'builder'
        ? '#dfac45'
        : v.profession === 'gatherer'
          ? '#8aafb6'
          : `hsl(${v.hue}, 45%, 50%)`
  ctx.fillRect(-3, -2 - bob, 6, 5)

  // 手臂（进食时抬起；建设时挥锤）
  if (v.eatAnim != null && v.eatAnim >= 0 && tick - v.eatAnim < 10) {
    // 就地进食：抬手送食 + 食物方块
    const raise = Math.floor(timeMs / 220 + v.id) % 2
    ctx.fillStyle = SKIN_2
    ctx.fillRect(v.facing > 0 ? 3 : -4.5, -4 + raise * 2, 2, 2)
    ctx.fillStyle = '#e8c34a'
    ctx.fillRect(v.facing > 0 ? 4 : -5, -5 + raise * 2, 1.5, 1.5)
  } else if (v.task === 'build' && !walking) {
    const swing = Math.floor(timeMs / 160 + v.id) % 2
    ctx.fillStyle = SKIN_2
    ctx.fillRect(v.facing > 0 ? 3 : -4.5, -3 - swing, 2, 3)
    ctx.fillStyle = '#9aa3ad'
    ctx.fillRect(v.facing > 0 ? 4 : -5, -5 - swing * 2, 3, 2)
    ctx.fillStyle = '#6f5233'
    ctx.fillRect(v.facing > 0 ? 5 : -4, -3 - swing * 2, 1, 3)
  } else {
    ctx.fillStyle = SKIN_2
    ctx.fillRect(v.facing > 0 ? 3 : -4.5, -2, 2, 4)
  }

  // 头
  ctx.fillStyle = SKIN
  ctx.fillRect(-2.5, -7 - bob, 5, 4)
  ctx.fillStyle = HAIR
  ctx.fillRect(-2.5, -7 - bob, 5, 1.5)
  // 眼睛（朝向）
  ctx.fillStyle = '#241c14'
  ctx.fillRect((v.facing > 0 ? 1 : -1.5) + 0, -5.5 - bob, 1, 1)

  ctx.restore()
}

function drawHouse(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const px = x * TILE
  const py = y * TILE
  ctx.fillStyle = 'rgba(10, 14, 8, 0.35)'
  ctx.fillRect(px + 2, py + 13, 12, 2)
  // 墙
  ctx.fillStyle = WALL
  ctx.fillRect(px + 2, py + 5, 12, 9)
  ctx.fillStyle = WALL_SHADE
  ctx.fillRect(px + 2, py + 12, 12, 2)
  // 门与窗
  ctx.fillStyle = DOOR
  ctx.fillRect(px + 7, py + 9, 3, 5)
  ctx.fillStyle = WINDOW
  ctx.fillRect(px + 3.5, py + 7, 2.5, 2.5)
  ctx.fillRect(px + 11, py + 7, 2.5, 2.5)
  // 屋顶（阶梯山墙）
  ctx.fillStyle = ROOF
  ctx.fillRect(px, py + 3, 16, 3)
  ctx.fillRect(px + 2, py + 1, 12, 2)
  ctx.fillStyle = ROOF_DARK
  ctx.fillRect(px, py + 5, 16, 1)
}

function drawSite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
  timeMs: number,
): void {
  const px = x * TILE
  const py = y * TILE
  // 地基木板
  ctx.fillStyle = '#7a5c3a'
  ctx.fillRect(px + 1, py + 5, 14, 2)
  ctx.fillRect(px + 1, py + 9, 14, 2)
  ctx.fillStyle = '#634a2d'
  ctx.fillRect(px + 2, py + 5, 1, 8)
  ctx.fillRect(px + 13, py + 5, 1, 8)
  // 角桩 + 顶部横梁
  ctx.fillStyle = '#8a6a44'
  ctx.fillRect(px + 2, py + 2, 2, 11)
  ctx.fillRect(px + 12, py + 2, 2, 11)
  const flag = Math.floor(timeMs / 400) % 2
  ctx.fillStyle = flag ? '#e0a83c' : '#c99434'
  ctx.fillRect(px + 2, py - 1, 3, 2)
  // 进度条
  ctx.fillStyle = 'rgba(10, 12, 8, 0.75)'
  ctx.fillRect(px + 1, py - 5, 14, 2.5)
  ctx.fillStyle = '#e0a83c'
  ctx.fillRect(px + 1, py - 5, 14 * Math.min(1, progress), 2.5)
}

function drawStockpile(ctx: CanvasRenderingContext2D, state: SimState): void {
  const cx = state.world.size / 2
  const cy = state.world.size / 2
  const ox = cx * TILE
  const oy = cy * TILE

  // 中央交粮垫
  ctx.fillStyle = 'rgba(96, 82, 56, 0.45)'
  ctx.fillRect(ox - 7, oy - 7, 14, 14)
  ctx.strokeStyle = 'rgba(224, 168, 60, 0.5)'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.strokeRect(ox - 7.5, oy - 7.5, 15, 15)
  ctx.setLineDash([])

  // 木材堆（左上）
  const logs = Math.max(0, Math.min(4, Math.round(state.stock.wood / 40)))
  for (let i = 0; i < logs; i++) {
    ctx.fillStyle = i % 2 ? '#a8794a' : '#8a6a44'
    ctx.fillRect(ox - 17, oy - 13 - i * 2.5, 8, 2)
  }
  // 石堆（左下）
  const stones = Math.max(0, Math.min(4, Math.round(state.stock.stone / 25)))
  for (let i = 0; i < stones; i++) {
    ctx.fillStyle = i % 2 ? '#9aa3ad' : '#7d858e'
    ctx.fillRect(ox - 17 + (i % 2) * 3, oy + 9 - i * 3, 5, 3)
  }
  // 粮堆（右下）
  const food = Math.max(0, Math.min(5, Math.round(state.stock.food / 150)))
  ctx.fillStyle = '#7fae4e'
  for (let i = 0; i < food; i++) {
    ctx.fillRect(ox + 9 + (i % 3) * 3, oy + 11 - Math.floor(i / 3) * 3 - (i % 2), 3, 3)
  }
}

/** 屏幕空间的文字标签（名字/地名），保持字体不随缩放变形 */
function drawLabels(
  ctx: CanvasRenderingContext2D,
  state: SimState,
  cam: Camera,
  view: View,
  selection: Selection,
): void {
  if (!selection) return
  const dpr = view.dpr
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'

  if (selection.kind === 'villager') {
    const v = state.villagers.find((x) => x.id === selection.id && x.alive)
    if (v) {
      const s = worldToScreen(cam, view.w, view.h, v.x, v.y - 0.75)
      const label = `${v.name} · ${v.profession ? PROFESSION_LABEL[v.profession] : `${Math.floor(v.age)}岁`}`
      ctx.fillStyle = 'rgba(10, 13, 9, 0.85)'
      const w = ctx.measureText(label).width + 10
      ctx.fillRect(s.x - w / 2, s.y - 16, w, 16)
      ctx.fillStyle = '#e0a83c'
      ctx.fillText(label, s.x, s.y - 3)
    }
  } else {
    const s = worldToScreen(cam, view.w, view.h, selection.x + 0.5, selection.y + 0.5)
    const t = state.world.tiles[selection.y * state.world.size + selection.x]
    const names = ['草地 · 食物', '森林 · 木材', '水域', '石地 · 石头', '农田 · 食物']
    const building = state.buildings.find((b) => b.x === selection.x && b.y === selection.y)
    const label = `(${selection.x}, ${selection.y}) ${building ? BUILDINGS[building.type ?? 'house'].name : names[t.terrain]}`
    ctx.fillStyle = 'rgba(10, 13, 9, 0.85)'
    const w = ctx.measureText(label).width + 10
    ctx.fillRect(s.x - w / 2, s.y - 16, w, 16)
    ctx.fillStyle = '#e0a83c'
    ctx.fillText(label, s.x, s.y - 3)
  }
  ctx.restore()
}

const ROAD_MIN = 25

/** 土路：踩踏密集的格子渐变为土色（画面层的「痕迹」） */
function drawRoads(ctx: CanvasRenderingContext2D, state: SimState): void {
  const w = state.world
  const size = w.size
  const walk = state.walk
  if (!walk) return
  ctx.fillStyle = 'rgba(124, 96, 58, 0.44)'
  for (let i = 0; i < walk.length; i++) {
    if (walk[i] < ROAD_MIN) continue
    const t = w.tiles[i].terrain
    if (t === 2) continue // 水域
    ctx.fillRect((i % size) * TILE + 3, ((i / size) | 0) * TILE + 3, TILE - 6, TILE - 6)
  }
}

/** 实体层：土路 → 交粮点 → 住房/工地 → 尸体 → 居民 → 选中高亮 → 屏幕标签 */
export function drawEntities(
  ctx: CanvasRenderingContext2D,
  state: SimState,
  cam: Camera,
  view: View,
  timeMs: number,
  selection: Selection,
): void {
  if (state.campaign) {
    const season = seasonAt(state.tick)
    const tint = [
      'rgba(135,175,65,.05)',
      'rgba(220,197,80,.05)',
      'rgba(202,132,63,.12)',
      'rgba(196,222,237,.25)',
    ][season]
    ctx.fillStyle = tint
    ctx.fillRect(0, 0, state.world.size * TILE, state.world.size * TILE)
    if (season === 3) {
      ctx.fillStyle = '#ecf2eab0'
      for (let i = 0; i < 75; i++) {
        const x = (i * 137 + timeMs * 0.008) % (state.world.size * TILE)
        const y = (i * 73 + timeMs * 0.012) % (state.world.size * TILE)
        ctx.fillRect(x, y, 1.5, 1.5)
      }
    }
  }
  drawRoads(ctx, state)
  drawStockpile(ctx, state)
  for (const b of state.buildings) {
    drawHouse(ctx, b.x, b.y)
    // 不同建筑用屋顶色与门口物件区分。
    if (b.type === 'granary' || b.type === 'farmhouse') {
      const px = b.x * TILE,
        py = b.y * TILE
      ctx.fillStyle = b.type === 'granary' ? '#dfac45' : '#709b52'
      ctx.fillRect(px + 1, py - 3, 14, 3)
      if (b.type === 'granary') {
        ctx.fillStyle = '#d7be80'
        ctx.fillRect(px + 10, py + 9, 4, 4)
      } else {
        ctx.fillStyle = '#9aca68'
        ctx.fillRect(px + 1, py + 9, 2, 5)
        ctx.fillRect(px + 4, py + 9, 2, 5)
      }
    }
  }
  for (const s of state.sites) drawSite(ctx, s.x, s.y, s.progress, timeMs)
  for (const v of state.villagers) {
    if (!v.alive) drawGrave(ctx, v)
  }
  for (const v of state.villagers) {
    if (v.alive) drawVillager(ctx, v, timeMs, state.tick)
  }

  // 选中高亮
  if (selection) {
    ctx.strokeStyle = '#e0a83c'
    ctx.lineWidth = 1.2
    if (selection.kind === 'villager') {
      const v = state.villagers.find((x) => x.id === selection.id && x.alive)
      if (v) {
        ctx.beginPath()
        ctx.ellipse(v.x * TILE, v.y * TILE + 5, 6.5, 3, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
    } else {
      ctx.strokeRect(selection.x * TILE + 0.5, selection.y * TILE + 0.5, TILE - 1, TILE - 1)
    }
  }

  drawLabels(ctx, state, cam, view, selection)
}
