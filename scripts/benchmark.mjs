import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'

const path = process.argv[2]
if (!path) {
  console.error('Usage: npm run benchmark -- /absolute/path/to/save.json [ticks=2000]')
  process.exit(1)
}
const ticks = Number(process.argv[3] ?? 2000)
if (!Number.isInteger(ticks) || ticks < 1) throw new Error('ticks must be a positive integer')
const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error' })
try {
  const { Simulation } = await server.ssrLoadModule('/src/sim/simulation.ts')
  const { deserialize } = await server.ssrLoadModule('/src/sim/save.ts')
  const file = deserialize(await readFile(path, 'utf8'))
  if (!file) throw new Error('Invalid save JSON')
  const sim = new Simulation(file.state)
  for (let i = 0; i < 200; i++) sim.tick()
  const samples = [], started = performance.now()
  for (let i = 0; i < ticks; i++) {
    const start = performance.now()
    sim.tick()
    samples.push(performance.now() - start)
  }
  const totalMs = performance.now() - started
  samples.sort((a, b) => a - b)
  console.log(JSON.stringify({ population: sim.state.villagers.filter((v) => v.alive).length,
    ticks, totalMs: Math.round(totalMs), meanMs: totalMs / ticks,
    p95Ms: samples[Math.min(ticks - 1, Math.floor(ticks * 0.95))] }, null, 2))
} finally {
  await server.close()
}
