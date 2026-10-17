import { describe, expect, it } from 'vitest'
import { createPlotState } from '../src/sim/plot/sim'
import { createBlockLayout } from '../src/sim/plot/layout'
import { blockIndex, rebuildBlockBuildings } from '../src/sim/plot/blocks'
import { dryFootprint, dryGround, nearestStreetPoint, pointAlongStreet, streetClearance, streetNeighbors, streetNode, streetPath } from '../src/sim/plot/streets'
import { GRASS, MOUNTAIN, WATER } from '../src/sim/world'
import { createRng } from '../src/sim/rng'
import { createWalkers, updateWalkers } from '../src/render/plot'

function neighborhood(seed = 42) {
  const s = createPlotState(seed, 64)
  s.world.tiles.forEach((t) => { t.terrain = GRASS })
  s.blocks.forEach((b) => { b.terrain = GRASS; b.buildable = true })
  const index = blockIndex(3, 3, 8)
  const b = s.blocks[index]
  b.zone = 'residential'; b.density = 4; b.settlement = 0; s.era = 4
  s.vRoad[index] = 1; s.vRoad[index + 1] = 1
  s.hRoad[index] = 1; s.hRoad[index + 8] = 1
  return { s, b, index }
}

describe('street geometry and urban lots', () => {
  it('all adjoining streets meet at one junction and follow the same reverse route', () => {
    const { s, index } = neighborhood()
    for (const nb of streetNeighbors(s, index)) {
      const path = streetPath(s, index, nb)
      expect(path.points[0]).toEqual(streetNode(s, index))
      expect(path.points.at(-1)).toEqual(streetNode(s, nb))
      expect(path.points).toEqual([...streetPath(s, nb, index).points].reverse())
    }
  })

  it('routes around an inland lake instead of cutting the dry path over water', () => {
    const { s, index } = neighborhood()
    for (let y = 24; y < 28; y++) s.world.tiles[y * 64 + 31].terrain = WATER
    const path = streetPath(s, index, index + 1)
    for (let i = 0; i <= 300; i++) {
      const p = pointAlongStreet(path, i / 300)
      expect(dryGround(s.world, p.x, p.y)).toBe(true)
    }
  })

  it('retains a real crossing where a full water channel cannot be bypassed', () => {
    const { s, index } = neighborhood()
    for (let y = 24; y < 32; y++) s.world.tiles[y * 64 + 31].terrain = WATER
    const path = streetPath(s, index, index + 1)
    expect(Array.from({ length: 100 }, (_, i) => pointAlongStreet(path, i / 99)).some((p) => !dryGround(s.world, p.x, p.y))).toBe(true)
    expect(dryGround(s.world, path.points[0].x, path.points[0].y)).toBe(true)
  })

  it('keeps actual building footprints off water, mountain, streets and other lots', () => {
    const { s, b, index } = neighborhood()
    for (let y = 24; y < 32; y++) for (let x = 24; x < 26; x++) s.world.tiles[y * 64 + x].terrain = y < 28 ? WATER : MOUNTAIN
    const buildings = createBlockLayout(s, b)
    expect(buildings.length).toBeGreaterThan(0)
    const streets = streetNeighbors(s, index).map((nb) => streetPath(s, index, nb))
    const rects = buildings.map((lot) => ({ x: b.bx * 8 + lot.tx, y: b.by * 8 + lot.ty, w: lot.w, h: lot.h }))
    rects.forEach((r, i) => {
      expect(dryFootprint(s.world, r)).toBe(true)
      expect(streetClearance(r, streets)).toBe(true)
      rects.slice(i + 1).forEach((other) => {
        expect(r.x < other.x + other.w && r.x + r.w > other.x && r.y < other.y + other.h && r.y + r.h > other.y).toBe(false)
      })
    })
  })

  it('retains existing foundations during density upgrades and mixes building heights', () => {
    const { s, b } = neighborhood()
    b.density = 1
    const early = createBlockLayout(s, b)
    b.density = 4
    const late = createBlockLayout(s, b)
    expect(late.length).toBeGreaterThanOrEqual(early.length)
    early.forEach((lot) => expect(late.some((x) => x.tx === lot.tx && x.ty === lot.ty)).toBe(true))
    expect(new Set(late.map((lot) => lot.level)).size).toBeGreaterThan(1)
    expect(late).toEqual(createBlockLayout(s, b))
  })

  it('never invents houses on unclaimed resource land or consumes the simulation RNG', () => {
    const { s, b } = neighborhood()
    const rng = createRng(731), before = rng.getState()
    rebuildBlockBuildings(b, rng, s)
    expect(rng.getState()).toBe(before)
    b.zone = 'none'; b.hasForest = true; b.hasOre = true; b.settlement = -1
    rebuildBlockBuildings(b, rng, s)
    expect(b.buildings).toEqual([])
  })

  it('walkers start on junctions and move along the rendered street, including bends', () => {
    const { s } = neighborhood()
    const walkers = createWalkers(s, 12, createRng(33).next)
    expect(walkers).toHaveLength(12)
    for (let step = 0; step < 150; step++) {
      updateWalkers(s, walkers, 0.2)
      for (const w of walkers) {
        if (w.to < 0) continue
        expect(nearestStreetPoint(w, [streetPath(s, w.from, w.to)]).distance).toBeLessThan(1e-7)
      }
    }
  })
})
