import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'vite'
import { createHash } from 'node:crypto'

const output = resolve(process.argv[2] ?? 'output/city-check')
const days = Number(process.argv[3] ?? 24000)
const seeds = (process.argv[4] ?? '42,777,2026').split(',').map(Number)
assert(Number.isInteger(days) && days >= 400)
await mkdir(output, { recursive: true })
const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error' })
try {
  const { PlotSim } = await server.ssrLoadModule('/src/sim/plot/sim.ts')
  const { savePlot, serializePlot, deserializePlot } = await server.ssrLoadModule('/src/sim/plot/save.ts')
  const { createBlockLayout, ensureBlockLayout } = await server.ssrLoadModule('/src/sim/plot/layout.ts')
  const { civicCapacityOf } = await server.ssrLoadModule('/src/sim/plot/economy.ts')
  const { dryFootprint, streetClearance, streetNeighbors, streetPath, pointAlongStreet } = await server.ssrLoadModule('/src/sim/plot/streets.ts')
  const { MOUNTAIN } = await server.ssrLoadModule('/src/sim/world.ts')
  const report = { days, seeds: [], continuationChecks: [], oldSave: null }
  const digest = (sim) => {
    const raw = JSON.parse(serializePlot(sim)); delete raw.savedAt
    return createHash('sha256').update(JSON.stringify(raw)).digest('hex')
  }
  const audit = (sim) => {
    const s = sim.state, v = sim.view(), kinds = {}, heights = {}, emptyBuilt = []
    let buildings = 0, fields = 0, bridges = 0, blockedLegacyRoads = 0
    for (let index = 0; index < s.blocks.length; index++) {
      const b = s.blocks[index]
      ensureBlockLayout(s, b)
      const streets = streetNeighbors(s, index).map((nb) => streetPath(s, index, nb))
      if (b.zone === 'none') assert.equal(b.buildings.length, 0, 'phantom building on undeveloped land')
      if (b.density > 0 && b.zone !== 'none' && !b.buildings.length) emptyBuilt.push([b.bx, b.by, b.zone])
      const rects = b.buildings.map((lot) => ({ x: b.bx * 8 + lot.tx, y: b.by * 8 + lot.ty, w: lot.w, h: lot.h }))
      rects.forEach((r, i) => {
        assert(dryFootprint(s.world, r), `wet/rock foundation: ${index}/${i}`)
        assert(streetClearance(r, streets), `street collision: ${index}/${i}`)
        rects.slice(i + 1).forEach((o) => assert(!(r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y), `lot collision: ${index}/${i}`))
      })
      assert.deepEqual(b.buildings, createBlockLayout(s, b), 'layout reconstruction')
      for (const lot of b.buildings) {
        if (lot.kind === 'field') fields++
        else if (!['garden', 'market-stall'].includes(lot.kind)) buildings++
        if (lot.kind === 'house') heights[lot.level] = (heights[lot.level] ?? 0) + 1
      }
      if (b.civic) {
        const k = kinds[b.civic] ??= { blocks: 0, units: 0, jobs: 0, staffed: 0 }
        k.blocks++; k.units += civicCapacityOf(b); k.jobs += b.jobs; k.staffed += b.staffed
      }
      for (const nb of streetNeighbors(s, index)) {
        if (nb < index) continue
        const path = streetPath(s, index, nb)
        if (!path.routable) { blockedLegacyRoads++; continue }
        if (path.bridge) bridges++
        for (let t = 0; t <= 1; t += 0.05) {
          const p = pointAlongStreet(path, t)
          assert.notEqual(s.world.tiles[Math.floor(p.y) * s.world.size + Math.floor(p.x)].terrain, MOUNTAIN, 'road crosses mountain')
        }
      }
    }
    const l = s.ledger
    assert(Math.abs(v.population - (20 + l.births - l.deaths + l.immigrants)) < 1e-6, 'population ledger')
    assert(Math.abs(s.blocks.reduce((n, b) => n + b.population, 0) - v.population) < 1e-6, 'block population')
    assert.equal(s.stats.industryResidentialAdjacency, 0)
    for (const key of ['food', 'wood', 'stone', 'steel']) assert(Number.isFinite(l[key]) && l[key] >= 0, key)
    return {
      day: v.day, population: Math.round(v.population), era: v.eraName,
      developed: s.blocks.filter((b) => b.zone !== 'none').length,
      homes: s.stats.builtResidential, farms: s.stats.builtAgriculture, housing: s.stats.housingCapacity,
      roads: s.stats.roadEdges, bridges, blockedLegacyRoads, buildings, fields, heights, emptyBuilt,
      civic: kinds, power: v.power, resources: { food: l.food, wood: l.wood, stone: l.stone, steel: l.steel },
      flows: { production: l.production, consumption: l.consumption },
      settlements: s.settlements.map((c) => ({ id: c.id, population: Math.round(c.population), links: c.links.length })),
    }
  }
  const fixture = async (sim, name) => {
    await writeFile(join(output, `${name}.json`), serializePlot(sim))
    let compressed
    savePlot(sim, { setItem: (_, value) => { compressed = value } })
    await writeFile(join(output, `${name}.save.txt`), compressed)
  }
  for (const seed of seeds) {
    const sim = PlotSim.create(seed, 256), checkpoints = [], start = performance.now()
    let resumed = null
    const powerWindow = []
    for (let day = 1; day <= days; day++) {
      for (let t = 0; t < 60; t++) sim.tick()
      if (day > days - 365) powerWindow.push(sim.state.stats.powerCoverage)
      if (resumed) for (let t = 0; t < 60; t++) resumed.tick()
      if ([5632, 23632].includes(day)) {
        resumed = new PlotSim(deserializePlot(serializePlot(sim)).state)
        resumed.rebuildDerived()
      }
      if ([5832, 23832].includes(day)) {
        if (digest(resumed) !== digest(sim)) {
          await writeFile(join(output, `continuation-original-${seed}-${day}.json`), serializePlot(sim))
          await writeFile(join(output, `continuation-restored-${seed}-${day}.json`), serializePlot(resumed))
        }
        assert.equal(digest(resumed), digest(sim), `seed ${seed}, day ${day}: save continuation`)
        report.continuationChecks.push({ seed, savedDay: day - 200, comparedDay: day, result: 'pass' })
        resumed = null
      }
      if ([400, 3000, 12000, days].includes(day)) {
        const result = audit(sim)
        assert.equal(result.blockedLegacyRoads, 0, 'new roads must have valid terrain paths')
        assert.equal(result.emptyBuilt.length, 0, 'every developed block must have physical lots')
        checkpoints.push(result)
        await fixture(sim, `seed-${seed}-day-${day}`)
        console.log(JSON.stringify({ seed, day, population: result.population, era: result.era, developed: result.developed, civicBlocks: Object.values(result.civic).reduce((n, k) => n + k.blocks, 0), power: result.power.ratio, heights: result.heights }))
      }
    }
    report.seeds.push({ seed, checkpoints, perTickMs: (performance.now() - start) / (days * 60),
      powerWindow: { days: powerWindow.length, mean: powerWindow.reduce((a, b) => a + b, 0) / powerWindow.length, minimum: Math.min(...powerWindow), below90: powerWindow.filter((x) => x < 0.9).length } })
  }
  if (process.argv[5]) {
    const file = deserializePlot(await readFile(process.argv[5], 'utf8'))
    assert(file, 'v4 save still readable')
    const sim = new PlotSim(file.state); sim.rebuildDerived()
    const before = audit(sim)
    for (let day = 0; day < 365; day++) for (let t = 0; t < 60; t++) sim.tick()
    report.oldSave = { before, after: audit(sim) }
  }
  await writeFile(join(output, 'city-check.json'), JSON.stringify(report, null, 2))
} finally { await server.close() }
