import type { Building, SimState } from '../sim/types'
import { TILE } from './camera'

export function drawCivicBuilding(ctx: CanvasRenderingContext2D, b: Building, s: SimState, time: number) {
  const x = b.x * TILE,
    y = b.y * TILE,
    level = b.level ?? 0,
    kind = b.type ?? 'house'
  ctx.fillStyle = s.civilization!.era >= 2 ? '#b7b39e' : '#ad925e'
  ctx.fillRect(x - 1, y - 1, 18, 18)
  if (kind === 'campfire') {
    ctx.fillStyle = '#66503a'
    ctx.fillRect(x + 3, y + 8, 10, 3)
    ctx.fillStyle = '#edab35'
    ctx.fillRect(x + 5, y + 3, 6, 7)
    ctx.fillStyle = '#f4d56b'
    ctx.fillRect(x + 7, y + 5, 3, 4)
    return
  }
  if (kind === 'park') {
    ctx.fillStyle = '#70a452'
    ctx.fillRect(x, y, 16, 16)
    ctx.fillStyle = '#dacda8'
    ctx.fillRect(x + 7, y, 3, 16)
    ctx.fillRect(x, y + 8, 16, 3)
    ctx.fillStyle = '#2e673d'
    ctx.fillRect(x + 1, y + 1, 5, 6)
    ctx.fillRect(x + 10, y + 11, 5, 5)
    ctx.fillStyle = '#845b34'
    ctx.fillRect(x + 10, y + 3, 4, 2)
    return
  }
  if (kind === 'well') {
    ctx.fillStyle = '#837c6c'
    ctx.fillRect(x + 3, y + 5, 10, 9)
    ctx.fillStyle = '#528ba6'
    ctx.fillRect(x + 5, y + 7, 6, 4)
    ctx.fillStyle = '#765235'
    ctx.fillRect(x + 2, y + 1, 2, 12)
    ctx.fillRect(x + 12, y + 1, 2, 12)
    ctx.fillRect(x + 2, y, 12, 3)
    return
  }
  if (kind === 'house' && level === 0) {
    ctx.fillStyle = '#aa8b60'
    ctx.beginPath()
    ctx.moveTo(x, y + 13)
    ctx.lineTo(x + 8, y - 2)
    ctx.lineTo(x + 16, y + 13)
    ctx.fill()
    ctx.fillStyle = '#544536'
    ctx.fillRect(x + 6, y + 7, 4, 6)
    return
  }
  const high = kind === 'skyscraper' || (kind === 'house' && level >= 4)
  const height = high
    ? 28 + (b.id % 5) * 7
    : kind === 'house' && level >= 2
      ? 20
      : kind === 'school'
        ? 20
        : 14
  const top = y + 14 - height
  const color = high
    ? '#718c9c'
    : kind === 'factory' || kind === 'quarry'
      ? '#8c7770'
      : kind === 'powerplant'
        ? '#7f9290'
        : kind === 'school'
          ? '#d0c2a0'
          : kind === 'clinic'
            ? '#ece0cb'
            : kind === 'market'
              ? '#cfaf78'
              : kind === 'workshop'
                ? '#9d7850'
                : kind === 'granary'
                  ? '#d0b172'
                  : kind === 'farmhouse'
                    ? '#c1bc8a'
                    : level >= 2
                      ? '#b39b87'
                      : '#d4b986'
  ctx.fillStyle = 'rgba(12,21,20,.25)'
  ctx.fillRect(x + 3, y + 13, 17, 4)
  ctx.fillStyle = color
  ctx.fillRect(x + 1, top, 13, height)
  ctx.fillStyle = high ? '#435e71' : '#847562'
  ctx.fillRect(x + 13, top + 2, 3, height - 2)
  ctx.fillStyle = high
    ? '#b7c5ce'
    : kind === 'school'
      ? '#628dae'
      : kind === 'clinic'
        ? '#d2d6d2'
        : kind === 'granary'
          ? '#b08c3d'
          : kind === 'farmhouse'
            ? '#6a9049'
            : kind === 'factory' || kind === 'quarry'
              ? '#514c47'
              : '#935c43'
  ctx.fillRect(x, top - 2, 15, 3)
  ctx.fillStyle = high ? '#c6dce6' : '#729ca9'
  for (let yy = top + 3; yy < y + 10; yy += 5)
    for (let xx = x + 3; xx < x + 12; xx += 4) {
      ctx.fillRect(xx, yy, 2, 3)
    }
  ctx.fillStyle = '#3d4542'
  ctx.fillRect(x + 6, y + 10, 4, 4)
  if (kind === 'clinic') {
    ctx.fillStyle = '#cb514c'
    ctx.fillRect(x + 5, top + 4, 6, 2)
    ctx.fillRect(x + 7, top + 2, 2, 6)
  }
  if (kind === 'market') {
    ctx.fillStyle = '#b65340'
    ctx.fillRect(x, y + 8, 16, 3)
    ctx.fillStyle = '#e6d29d'
    for (let n = 0; n < 4; n++) ctx.fillRect(x + n * 4, y + 8, 2, 3)
  }
  if (kind === 'factory' || kind === 'quarry' || kind === 'powerplant') {
    ctx.fillStyle = '#5c625d'
    ctx.fillRect(x + 10, top - 11, 3, 12)
    if (kind === 'factory' || (kind === 'quarry' && s.civilization!.steel > 0)) {
      ctx.fillStyle = 'rgba(185,189,181,.4)'
      for (let n = 0; n < 3; n++) {
        const drift = (time * 0.012 + n * 7 + b.id) % 22
        ctx.fillRect(x + 10 + drift * 0.3, top - 12 - drift, 4, 3)
      }
    }
    if (kind === 'powerplant') {
      ctx.strokeStyle = '#e7c864'
      ctx.beginPath()
      ctx.moveTo(x + 5, y - 4)
      ctx.lineTo(x + 2, y + 3)
      ctx.lineTo(x + 7, y + 3)
      ctx.lineTo(x + 4, y + 8)
      ctx.stroke()
    }
  }
}
