import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { createServer } from 'vite'

const output = resolve(process.argv[2] ?? 'output/plot-scenarios')
const days = Number(process.argv[3] ?? 12000)
const seeds = (process.argv[4] ?? '42,777,2026').split(',').map(Number)
assert(Number.isInteger(days) && days >= 1000, 'days must be an integer >= 1000')
assert(seeds.every(Number.isFinite), 'seeds must be numbers')
await mkdir(output, { recursive: true })
const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error' })
try {
  const { PlotSim } = await server.ssrLoadModule('/src/sim/plot/sim.ts')
  const { serializePlot, deserializePlot, savePlot } = await server.ssrLoadModule('/src/sim/plot/save.ts')
  const policies = ['balanced', 'food', 'growth', 'science', 'livable']
  const advanceDay = (sim) => { for (let t = 0; t < 60; t++) sim.tick() }
  const digest = (sim) => {
    const data = JSON.parse(serializePlot(sim))
    delete data.savedAt
    return createHash('sha256').update(JSON.stringify(data)).digest('hex')
  }
  const check = (sim) => {
    const s = sim.state, l = s.ledger, pop = l.children + l.adults + l.elderly
    assert(Math.abs(pop - (20 + l.births - l.deaths + l.immigrants)) < 1e-6, 'population ledger')
    assert(Math.abs(s.blocks.reduce((n, b) => n + b.population, 0) - pop) < 1e-6, 'block population')
    assert(Math.abs(s.settlements.reduce((n, c) => n + c.population, 0) - pop) < 1e-6, 'settlement population')
    assert.equal(s.stats.industryResidentialAdjacency, 0, 'industrial separation')
    for (const k of ['food', 'wood', 'stone', 'steel']) assert(Number.isFinite(l[k]) && l[k] >= 0, k)
  }
  const snapshot = (sim) => {
    const s = sim.state, v = sim.view()
    return {
      day: v.day, era: v.eraName, population: Math.round(v.population),
      developed: s.blocks.filter((b) => b.zone !== 'none').length,
      homes: s.stats.builtResidential, farms: s.stats.builtAgriculture,
      parks: s.blocks.filter((b) => b.zone === 'park' || b.civic === 'park').length,
      roads: s.stats.roadEdges, housing: s.stats.housingCapacity,
      foodDays: Number(v.foodDays.toFixed(1)), powerRatio: Number(v.power.ratio.toFixed(3)),
      knowledge: Math.round(s.ledger.knowledge),
      settlements: s.settlements.map((c) => ({ name: c.name, population: Math.round(c.population), links: c.links.length })),
      bottleneck: v.development.title,
    }
  }
  const fixture = async (sim, name) => {
    await writeFile(join(output, `${name}.json`), serializePlot(sim))
    savePlot(sim, { setItem: (_key, data) => { sim.__fixture = data } })
    await writeFile(join(output, `${name}.save.txt`), sim.__fixture)
    delete sim.__fixture
  }
  const report = { days, seeds: [], policies: [], continuationChecks: [] }
  for (const seed of seeds) {
    const sim = PlotSim.create(seed, 256)
    const started = performance.now()
    let resumed = null
    for (let day = 1; day <= days; day++) {
      advanceDay(sim)
      if (resumed) advanceDay(resumed)
      if (day % 200 === 0) check(sim)
      // 使用非规划日的中途存档，覆盖城市已有服务和工业的恢复路径。
      if (day === 5632) {
        resumed = new PlotSim(deserializePlot(serializePlot(sim)).state)
        resumed.rebuildDerived()
      }
      if (day === 5832) {
        assert.equal(digest(resumed), digest(sim), `seed ${seed}: save continuation`)
        report.continuationChecks.push({ seed, savedDay: 5632, comparedDay: 5832, result: 'pass' })
        resumed = null
      }
      if (seed === seeds[0] && [400, 3000, days].includes(day)) await fixture(sim, `seed-${seed}-day-${day}`)
    }
    const result = { seed, ...snapshot(sim), perTickMs: Number(((performance.now() - started) / (days * 60)).toFixed(4)) }
    report.seeds.push(result)
    console.log(JSON.stringify(result))
  }
  // 五种政策从同一份已经有学校与城区的存档开始，比较随后一年的实际产出。
  const base = PlotSim.create(seeds[0], 256)
  for (let day = 0; day < 3000; day++) advanceDay(base)
  const saved = serializePlot(base)
  for (const policy of policies) {
    const sim = new PlotSim(deserializePlot(saved).state)
    sim.rebuildDerived()
    sim.setPolicy(policy)
    const before = sim.state.ledger.knowledge
    let food = 0, staffed = 0
    for (let day = 0; day < 365; day++) {
      advanceDay(sim)
      food += sim.state.ledger.production.food
      staffed += sim.state.blocks.filter((b) => b.civic === 'school').reduce((n, b) => n + b.staffed, 0)
    }
    check(sim)
    report.policies.push({ policy, ...snapshot(sim), foodPerDay: Number((food / 365).toFixed(1)), knowledgePerDay: Number(((sim.state.ledger.knowledge - before) / 365).toFixed(1)), schoolStaff: Number((staffed / 365).toFixed(1)) })
  }
  await writeFile(join(output, 'scenarios.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ policies: report.policies.map(({ policy, foodPerDay, knowledgePerDay, roads, parks }) => ({ policy, foodPerDay, knowledgePerDay, roads, parks })), continuationChecks: report.continuationChecks }))
} finally { await server.close() }
