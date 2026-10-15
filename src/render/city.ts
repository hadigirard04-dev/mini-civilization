import type { Building, SimState } from '../sim/types'
import { TILE } from './camera'

const towerPalette = ['#6695a5', '#849eac', '#628697', '#809da4']
const sprites = new Map<string, HTMLCanvasElement>()

function shape(ctx: CanvasRenderingContext2D, color: string, points: number[][]) {
  ctx.fillStyle = color
  ctx.beginPath()
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
  ctx.closePath()
  ctx.fill()
}

function windows(ctx: CanvasRenderingContext2D, top: number, bottom: number, detail: boolean, glass = false) {
  ctx.fillStyle = glass ? '#b9e3e6' : '#f0d59a'
  if (!detail) {
    ctx.fillRect(4, top + 4, 8, Math.max(3, bottom - top - 8))
    return
  }
  for (let y = top + 4; y < bottom - 4; y += glass ? 6 : 8) {
    ctx.fillRect(3, y, 3, 4)
    ctx.fillRect(9, y, 3, 4)
  }
}

export function buildingHeight(b: Building): number {
  if (b.type === 'skyscraper') return 64 + (b.id % 5) * 10
  if (!b.type || b.type === 'house') return [18, 28, 38, 48, 50 + (b.id % 4) * 8][b.level ?? 0]
  return ['factory', 'powerplant', 'granary', 'quarry'].includes(b.type) ? 46 : 32
}

function smoke(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, id: number) {
  ctx.fillStyle = 'rgba(204,201,186,.48)'
  for (let i = 0; i < 3; i++) {
    const drift = (time * 0.008 + i * 8 + id) % 24
    ctx.fillRect(x + drift * 0.35, y - drift, 3 + drift * 0.12, 3 + drift * 0.08)
  }
}

function drawLocal(ctx: CanvasRenderingContext2D, b: Building, s: SimState, time: number, detail: boolean, power: number) {
  const kind = b.type ?? 'house', level = b.level ?? 0, era = s.civilization!.era
  ctx.fillStyle = kind === 'house' && level < 2 ? '#b49a67' : '#b4b5a4'
  ctx.fillRect(-2, -1, 21, 19)
  ctx.fillStyle = 'rgba(12,22,23,.28)'
  ctx.fillRect(5, 12, 19, 6)
  if (kind === 'campfire') {
    if (era < 2) {
      ctx.fillStyle = '#6e5944'
      ctx.fillRect(2, 10, 12, 3)
      shape(ctx, '#dc813c', [[4, 10], [7, 1], [10, 5], [12, -1], [14, 10]])
      shape(ctx, '#f4d37e', [[7, 10], [9, 4], [12, 10]])
    } else {
      ctx.fillStyle = '#d8d0b7'
      ctx.fillRect(-9, -7, 34, 29)
      ctx.fillStyle = '#8aa9a0'
      ctx.fillRect(-4, 4, 24, 11)
      ctx.fillStyle = '#c2bb9c'
      ctx.fillRect(3, era >= 3 ? -31 : -13, 10, era >= 3 ? 43 : 25)
      if (era >= 3) {
        ctx.fillStyle = '#f3e6b9'
        ctx.fillRect(4, -26, 8, 8)
        ctx.fillStyle = '#4b615f'
        ctx.fillRect(7, -25, 1, 4)
        ctx.fillRect(7, -22, 3, 1)
        shape(ctx, '#4d7169', [[1, -32], [8, -42], [15, -32]])
      }
      ctx.fillStyle = '#4e8760'
      ctx.fillRect(-6, -4, 5, 6)
      ctx.fillRect(16, -4, 5, 6)
    }
    return
  }
  if (kind === 'park') {
    ctx.fillStyle = '#68a66a'
    ctx.fillRect(-1, -1, 19, 18)
    ctx.fillStyle = '#e7d5a2'
    ctx.fillRect(6, 0, 4, 17)
    ctx.fillRect(-1, 7, 19, 3)
    ctx.fillStyle = '#306845'
    ctx.fillRect(-1, 0, 7, 7)
    ctx.fillRect(11, 10, 7, 7)
    ctx.fillStyle = '#806043'
    ctx.fillRect(11, 3, 5, 2)
    return
  }
  if (kind === 'well') {
    ctx.fillStyle = '#738e9a'
    ctx.fillRect(2, 5, 13, 10)
    ctx.fillStyle = '#3b718e'
    ctx.fillRect(4, 6, 8, 4)
    ctx.fillStyle = '#715642'
    ctx.fillRect(1, -2, 2, 16)
    ctx.fillRect(14, -2, 2, 16)
    shape(ctx, '#a26642', [[-1, 0], [8, -9], [18, 0]])
    return
  }
  if (kind === 'house' && level === 0) {
    shape(ctx, '#dac28b', [[-1, 14], [7, -7], [17, 14]])
    shape(ctx, '#a0855f', [[7, -7], [17, 14], [11, 14]])
    shape(ctx, '#56463b', [[4, 14], [7, 3], [11, 14]])
    ctx.fillStyle = '#72543b'
    ctx.fillRect(-2, 12, 2, 5)
    ctx.fillRect(16, 12, 2, 5)
    return
  }
  if (kind === 'house' && level === 1) {
    ctx.fillStyle = '#ac8150'
    ctx.fillRect(0, 1, 17, 14)
    ctx.fillStyle = '#785438'
    for (let y = 4; y < 14; y += 4) ctx.fillRect(0, y, 17, 1)
    shape(ctx, '#b6643e', [[-3, 3], [7, -13], [19, 3]])
    shape(ctx, '#78452f', [[7, -13], [19, 3], [12, 3]])
    ctx.fillStyle = '#ead8a3'
    ctx.fillRect(2, 6, 4, 4)
    ctx.fillStyle = '#57483a'
    ctx.fillRect(10, 7, 4, 8)
    ctx.fillRect(-3, 16, 23, 1)
    return
  }
  if (kind === 'house' && level === 2) {
    ctx.fillStyle = '#c38c68'
    ctx.fillRect(0, -10, 16, 25)
    ctx.fillStyle = '#8a624c'
    ctx.fillRect(13, -10, 4, 25)
    shape(ctx, '#765c54', [[-2, -9], [7, -21], [19, -9]])
    ctx.fillStyle = '#71594e'
    ctx.fillRect(12, -24, 3, 11)
    windows(ctx, -10, 14, detail)
    ctx.fillStyle = '#5c5146'
    ctx.fillRect(7, 8, 4, 7)
    return
  }
  if (kind === 'house' && level === 3) {
    ctx.fillStyle = '#c1b59b'
    ctx.fillRect(-1, -29, 17, 44)
    ctx.fillStyle = '#877c71'
    ctx.fillRect(13, -29, 5, 44)
    ctx.fillStyle = '#676964'
    ctx.fillRect(-2, -32, 21, 4)
    windows(ctx, -29, 14, detail)
    ctx.fillStyle = '#827e73'
    for (let y = -17; y < 12; y += 10) ctx.fillRect(-2, y, 17, 2)
    ctx.fillStyle = '#494e4a'
    ctx.fillRect(6, 8, 4, 7)
    return
  }
  if (kind === 'skyscraper' || (kind === 'house' && level >= 4)) {
    const top = 16 - buildingHeight(b)
    ctx.fillStyle = towerPalette[b.id % towerPalette.length]
    ctx.fillRect(0, top, 15, 16 - top)
    ctx.fillStyle = '#354f62'
    ctx.fillRect(12, top + 2, 5, 14 - top)
    ctx.fillStyle = '#b1cbd0'
    ctx.fillRect(-1, top - 2, 18, 3)
    ctx.fillRect(3, top - 8, 10, 6)
    if (kind === 'skyscraper') {
      ctx.fillStyle = '#d0d9c9'
      ctx.fillRect(7, top - 18, 1, 11)
    }
    windows(ctx, top, 15, detail, true)
    ctx.fillStyle = '#416477'
    ctx.fillRect(6, top + 1, 1, 14 - top)
    ctx.fillStyle = '#d7d9bb'
    ctx.fillRect(0, 12, 17, 3)
    return
  }
  if (kind === 'granary') {
    ctx.fillStyle = '#c6b58c'
    ctx.fillRect(0, -14, 11, 29)
    shape(ctx, '#8f8874', [[-1, -14], [5, -23], [12, -14]])
    ctx.fillStyle = '#a9956e'
    ctx.fillRect(12, -6, 7, 21)
    ctx.fillStyle = '#817252'
    for (let y = -8; y < 15; y += 6) ctx.fillRect(0, y, 11, 1)
    ctx.fillStyle = '#e4cd83'
    ctx.fillRect(2, 10, 6, 5)
    return
  }
  if (kind === 'factory' || kind === 'workshop') {
    const factory = kind === 'factory'
    ctx.fillStyle = factory ? '#9f745d' : '#b48b56'
    ctx.fillRect(-3, -9, 23, 24)
    shape(ctx, '#5c6465', [[-4, -9], [-4, -17], [3, -12], [3, -17], [10, -12], [10, -17], [21, -9]])
    ctx.fillStyle = '#537b8a'
    ctx.fillRect(-1, -5, 17, 5)
    ctx.fillStyle = '#564d43'
    ctx.fillRect(8, 5, 9, 10)
    if (factory) {
      ctx.fillStyle = '#8f5448'
      ctx.fillRect(13, -37, 5, 28)
      ctx.fillStyle = '#d2bbaa'
      ctx.fillRect(13, -29, 5, 3)
      ctx.fillRect(13, -19, 5, 3)
      if (time >= 0 && power > 0 && detail && s.stock.wood > 0 && s.stock.stone > 0) smoke(ctx, 14, -40, time, b.id)
    }
    return
  }
  if (kind === 'powerplant') {
    shape(ctx, '#b2bab3', [[-3, 14], [0, -12], [-1, -20], [10, -20], [9, -12], [13, 14]])
    ctx.fillStyle = '#6b858b'
    ctx.fillRect(-1, -22, 10, 4)
    ctx.fillRect(12, -4, 9, 19)
    ctx.fillStyle = '#d5b764'
    ctx.fillRect(14, 1, 2, 7)
    if (time >= 0 && detail) smoke(ctx, 3, -25, time, b.id)
    return
  }
  if (kind === 'quarry') {
    ctx.fillStyle = '#767d7a'
    ctx.fillRect(-2, 4, 21, 12)
    shape(ctx, '#a6a38f', [[0, 10], [4, -3], [11, 2], [14, 11]])
    ctx.fillStyle = '#d1ac50'
    ctx.fillRect(11, -13, 4, 20)
    ctx.fillRect(4, -13, 14, 3)
    ctx.fillStyle = '#53646c'
    ctx.fillRect(4, -9, 3, 6)
    return
  }
  if (kind === 'market') {
    ctx.fillStyle = '#e0c8a1'
    ctx.fillRect(-1, -3, 18, 18)
    shape(ctx, '#a45542', [[-4, -3], [7, -15], [21, -3]])
    ctx.fillStyle = '#b65d49'
    ctx.fillRect(-3, 5, 23, 5)
    ctx.fillStyle = '#f0d69c'
    for (let x = -2; x < 20; x += 5) ctx.fillRect(x, 5, 2, 5)
    ctx.fillStyle = '#705a40'
    ctx.fillRect(-1, 11, 19, 4)
    return
  }
  const school = kind === 'school', clinic = kind === 'clinic'
  ctx.fillStyle = clinic ? '#e6dfcb' : school ? '#d5bf8e' : '#b97855'
  ctx.fillRect(-1, -8, 19, 23)
  shape(ctx, clinic ? '#627d77' : school ? '#677d8e' : '#734d43', [[-4, -7], [8, -23], [22, -7]])
  windows(ctx, -7, 15, detail)
  ctx.fillStyle = '#534d42'
  ctx.fillRect(7, 7, 5, 8)
  if (clinic) {
    ctx.fillStyle = '#ba5149'
    ctx.fillRect(5, -17, 8, 3)
    ctx.fillRect(8, -20, 3, 9)
  }
  if (school) {
    ctx.fillStyle = '#d9c69c'
    ctx.fillRect(6, -30, 5, 10)
    ctx.fillStyle = '#617787'
    ctx.fillRect(5, -32, 7, 3)
  }
}

export function drawCivicBuilding(ctx: CanvasRenderingContext2D, b: Building, s: SimState,
  time: number, detail = true, power = 1) {
  const kind = b.type ?? 'house'
  const variant = kind === 'skyscraper' || (kind === 'house' && (b.level ?? 0) >= 4) ? b.id % 20 : 0
  const key = `${kind}/${b.level ?? 0}/${variant}/${kind === 'campfire' ? s.civilization!.era : 0}/${Number(detail)}`
  let sprite = sprites.get(key)
  if (!sprite) {
    sprite = document.createElement('canvas')
    sprite.width = 44; sprite.height = 150
    const paint = sprite.getContext('2d')
    if (paint) {
      paint.translate(12, 126)
      drawLocal(paint, b, s, -1, detail, 0)
    }
    // 上限约 4 MiB，不随城市建筑数量无限增长。
    if (sprites.size >= 160) sprites.delete(sprites.keys().next().value!)
    sprites.set(key, sprite)
  }
  ctx.drawImage(sprite, b.x * TILE - 12, b.y * TILE - 126)
  if (detail && (kind === 'factory' || kind === 'powerplant')) {
    ctx.save()
    ctx.translate(b.x * TILE, b.y * TILE)
    if (kind === 'powerplant') smoke(ctx, 3, -25, time, b.id)
    else if (power > 0 && s.stock.wood > 0 && s.stock.stone > 0) smoke(ctx, 14, -40, time, b.id)
    ctx.restore()
  }
}
