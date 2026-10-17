import { describe, expect, it } from 'vitest'
import { createPlotState, PlotSim } from '../src/sim/plot/sim'
import { civicCapacityOf, gatherKind, powerDemand, powerSupply, recomputeStats, settleDay } from '../src/sim/plot/economy'
import { advanceConstruction, assignZones, completeStreets, connectResourceLand, forestBudget, planForestRestoration, planServices, planUpgrades, upgradeStreets } from '../src/sim/plot/planner'
import { bfsRoadDistances, readRoad, writeRoad } from '../src/sim/plot/roads'
import { createRng } from '../src/sim/rng'
import { GRASS } from '../src/sim/world'
import { deserializePlot, serializePlot } from '../src/sim/plot/save'

function town() {
  const s = createPlotState(42, 64)
  s.world.tiles.forEach((t) => { t.terrain = GRASS })
  s.blocks.forEach((b) => { b.terrain = GRASS; b.buildable = true; b.hasForest = false; b.hasOre = false; b.hasWater = false })
  s.settlements = [{ id: 0, name: 'town', center: 27, foundedTick: 0, blocks: [27], population: 1000, jobs: 0, housing: 1200, links: [] }]
  s.ledger.adults = 700; s.ledger.children = 250; s.ledger.elderly = 50
  s.ledger.food = 100000; s.ledger.wood = 10000; s.ledger.stone = 10000; s.ledger.steel = 10000
  s.ledger.knowledge = 100000; s.ledger.storageCapacity = 100000
  s.era = 3
  return s
}

describe('neighborhood development', () => {
  it('places water service near underserved homes instead of repeatedly choosing distant water', () => {
    const s = town()
    for (const i of [0, 1, 8, 9]) {
      Object.assign(s.blocks[i], { zone: 'residential', density: 2, population: 250 })
      Object.assign(s.blocks[i].covered, { market: 1, school: 1, clinic: 1, park: 1, water: 0 })
    }
    Object.assign(s.blocks[20], { zone: 'civic', civic: 'market', density: 3 })
    Object.assign(s.blocks[21], { zone: 'civic', civic: 'school', density: 2 })
    Object.assign(s.blocks[22], { zone: 'park', density: 3 })
    Object.assign(s.blocks[23], { zone: 'civic', civic: 'clinic', density: 2 })
    Object.assign(s.blocks[27], { zone: 'civic', civic: 'workshop', density: 3 })
    s.blocks[18].settlement = 0; s.blocks[63].settlement = 0; s.blocks[63].hasWater = true
    writeRoad(s, 'v', 3, 2, 1); writeRoad(s, 'v', 7, 7, 1)
    recomputeStats(s); s.stats.powerCoverage = 1
    planServices(s, createRng(1))
    expect(s.blocks[18].construction?.kind).toBe('civic:waterworks')
    expect(s.blocks[63].construction).toBeNull()
  })

  it('expands an existing service campus before occupying another parcel', () => {
    const s = town(), campus = s.blocks[27], home = s.blocks[28]
    Object.assign(campus, { zone: 'civic', civic: 'market', density: 1, settlement: 0 })
    Object.assign(home, { zone: 'residential', density: 2, settlement: 0, population: 1000 })
    Object.assign(home.covered, { market: 1, school: 1, clinic: 1, park: 1, water: 1 })
    writeRoad(s, 'v', 4, 3, 1)
    const before = s.ledger.wood
    planServices(s, createRng(1))
    expect(campus.construction?.kind).toBe('upgrade')
    expect(civicCapacityOf(campus, true)).toBe(2)
    expect(s.blocks.filter((b) => b.construction?.kind === 'civic:market')).toHaveLength(0)
    expect(s.ledger.wood).toBeLessThan(before)
    for (let i = 0; i < 6; i++) advanceConstruction(s, createRng(1))
    expect(campus.density).toBe(2)
    expect(civicCapacityOf(campus)).toBe(2)
  })

  it('an expanded power station pays for all of its actual generation', () => {
    const s = town(), plant = s.blocks[27]
    s.ledger.adults = 10000
    Object.assign(plant, { zone: 'civic', civic: 'powerplant', density: 4, settlement: 0 })
    const before = s.ledger.wood
    recomputeStats(s); settleDay(s, createRng(3))
    expect(powerSupply(s)).toBe(128)
    expect(s.ledger.production.electricity).toBe(128)
    expect(s.ledger.consumption.wood).toBe(8)
    expect(s.ledger.consumption.stone).toBe(4)
    expect(before - s.ledger.wood).toBe(8)
  })

  it('idle factories do not demand power and spare generators do not waste fuel', () => {
    const s = town(), plant = s.blocks[27], factory = s.blocks[30]
    Object.assign(plant, { zone: 'civic', civic: 'powerplant', density: 4, settlement: 0 })
    Object.assign(factory, { zone: 'industry', industry: 'factory', density: 4, settlement: 0 })
    expect(s.ledger.steel).toBeGreaterThan(4000)
    expect(powerDemand(s)).toBe(15)
    settleDay(s, createRng(3))
    expect(powerSupply(s)).toBe(128)
    expect(s.ledger.production.electricity).toBeCloseTo(15)
    expect(s.ledger.consumption.electricity).toBeCloseTo(15)
    expect(s.ledger.consumption.wood).toBeCloseTo(15 / 16)
    expect(s.ledger.electricity).toBeCloseTo(0)
  })

  it('a non-planning-day save continues identically through a fuel shortage', () => {
    const sim = PlotSim.create(42, 128)
    const advance = (sim: PlotSim, days: number) => { for (let n = 0; n < days * 60; n++) sim.tick() }
    advance(sim, 401)
    const s = sim.state
    s.era = 3
    s.ledger.adults += 1000; s.ledger.immigrants += 1000
    s.ledger.wood = 0; s.ledger.stone = 0; s.ledger.steel = 3999
    const empty = s.blocks.find((b) => b.settlement >= 0 && b.zone === 'none')!
    Object.assign(empty, { zone: 'civic', civic: 'powerplant', density: 2 })
    sim.rebuildDerived(); advance(sim, 1)
    expect(s.stats.powerCoverage).toBeLessThan(1)
    const restored = new PlotSim(deserializePlot(serializePlot(sim))!.state)
    restored.rebuildDerived()
    advance(sim, 200); advance(restored, 200)
    const comparable = (sim: PlotSim) => { const raw = JSON.parse(serializePlot(sim)); delete raw.savedAt; return raw }
    expect(comparable(restored)).toEqual(comparable(sim))
  })

  it('builds a paid loop that shortens an actual neighborhood detour', () => {
    const s = town()
    for (const i of [18, 19, 26, 27]) Object.assign(s.blocks[i], { zone: 'park', density: 1, settlement: 0 })
    writeRoad(s, 'v', 3, 2, 1); writeRoad(s, 'h', 3, 3, 1); writeRoad(s, 'v', 3, 3, 1)
    expect(bfsRoadDistances(s, [18])[26]).toBe(3)
    const before = s.ledger.wood
    expect(completeStreets(s, 0, 1)).toBe(1)
    expect(bfsRoadDistances(s, [18])[26]).toBe(1)
    expect(s.ledger.wood).toBe(before - 1)
  })

  it('connects remote raw materials with wood-only roads when stone is exhausted', () => {
    const s = town()
    s.blocks[27].settlement = 0
    s.blocks[31].hasOre = true
    s.ledger.stone = 0
    s.ledger.production.stone = 0.5; s.ledger.consumption.stone = 0.5
    const before = s.ledger.wood
    expect(connectResourceLand(s, 0, 2)).toBe(2)
    expect(s.ledger.wood).toBe(before - 2)
    expect(s.ledger.stone).toBe(0)
    expect(bfsRoadDistances(s, [27])[29]).toBe(2)
  })

  it('does not fill scarce land with idle factories when steel stocks already suffice', () => {
    const s = town()
    for (let i = 0; i < 6; i++) Object.assign(s.blocks[i], { zone: 'residential', density: 4 })
    for (let i = 56; i < 62; i++) Object.assign(s.blocks[i], { zone: 'agriculture', density: 4 })
    Object.assign(s.blocks[63], { zone: 'industry', industry: 'factory', density: 4 })
    for (const i of [18, 19, 26, 27, 28, 34, 35, 36]) s.blocks[i].settlement = 0
    for (const y of [2, 3, 4]) for (const x of [3, 4]) writeRoad(s, 'v', x, y, 1)
    recomputeStats(s); assignZones(s, createRng(1))
    expect(s.blocks.filter((b) => b.zone === 'industry')).toHaveLength(1)
  })

  it('pays to restore an idle forest brownfield and only clears its industry on completion', () => {
    const s = town()
    for (const i of [18, 19, 26, 27]) Object.assign(s.blocks[i], { zone: 'industry', industry: 'factory', density: 4, settlement: 0, hasForest: true })
    s.ledger.wood = 50; s.ledger.consumption.wood = 100
    expect(planForestRestoration(s)).toBe(true)
    const target = s.blocks.find((b) => b.construction?.kind === 'restore:forest')!
    expect(target.zone).toBe('industry')
    expect(s.ledger.wood).toBe(42)
    for (let day = 0; day < 8; day++) advanceConstruction(s, createRng(1))
    expect(target.zone).toBe('none')
    expect(target.industry).toBeNull()
    expect(gatherKind(s, target)).toBe('forest')
    expect(forestBudget(s).capacity).toBeGreaterThanOrEqual(6)
  })

  it('converts a paid idle brownfield into essential utility capacity when land is full', () => {
    const s = town()
    s.blocks.forEach((b) => Object.assign(b, { zone: 'park', density: 1, settlement: 0 }))
    for (const i of [18, 19, 26]) Object.assign(s.blocks[i], { zone: 'industry', industry: 'factory', density: 4 })
    s.stats.powerCoverage = 0
    writeRoad(s, 'v', 3, 2, 1); writeRoad(s, 'h', 3, 3, 1); writeRoad(s, 'v', 3, 3, 1)
    const before = s.ledger.wood
    expect(planServices(s, createRng(1))).toBe(1)
    const target = s.blocks.find((b) => b.construction?.kind === 'redevelop:powerplant')!
    expect(target.zone).toBe('industry')
    expect(s.ledger.wood).toBe(before - 80)
    for (let day = 0; day < 8; day++) advanceConstruction(s, createRng(1))
    expect(target.zone).toBe('civic')
    expect(target.civic).toBe('powerplant')
    expect(powerSupply(s)).toBe(16)
    expect(s.blocks.filter((b) => b.zone === 'industry')).toHaveLength(2)
  })

  it('does not construct loops for free; street upgrades preserve connectivity', () => {
    const s = town()
    for (const i of [18, 19, 26, 27]) Object.assign(s.blocks[i], { zone: 'park', density: 1, settlement: 0 })
    writeRoad(s, 'v', 3, 2, 1); writeRoad(s, 'h', 3, 3, 1); writeRoad(s, 'v', 3, 3, 1)
    s.ledger.wood = 0
    expect(completeStreets(s, 0)).toBe(0)
    s.ledger.wood = 1000
    const before = Array.from(bfsRoadDistances(s, [18]))
    expect(upgradeStreets(s)).toBe(2)
    expect(readRoad(s, 'v', 3, 2)).toBe(3)
    expect(Array.from(bfsRoadDistances(s, [18]))).toEqual(before)
  })

  it('an isolated house cannot become an apartment just because the global era advanced', () => {
    const s = town(), home = s.blocks[27]
    Object.assign(home, { zone: 'residential', density: 2, landValue: 1, settlement: 0 })
    recomputeStats(s); planUpgrades(s)
    expect(home.construction).toBeNull()
    for (const i of [26, 28]) Object.assign(s.blocks[i], { zone: 'residential', density: 2, landValue: 1, settlement: 0 })
    recomputeStats(s); planUpgrades(s)
    expect(home.construction?.kind).toBe('upgrade')
  })
})
