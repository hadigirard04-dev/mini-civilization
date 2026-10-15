import { it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { Simulation } from '../src/sim/simulation'
import { serialize, deserialize } from '../src/sim/save'
import { countCivic } from '../src/sim/civilization'
it.skipIf(process.env.CIVILIZATION_LONG !== '1')(
  '4000 天实际演化：五个时代、千人级城市、人口守恒与存档',
  { timeout: 420000 },
  () => {
    const sim = new Simulation(42, 'evolution'),
      s = sim.state
    const days = Number(process.env.CIVILIZATION_DAYS ?? 4000)
    if (process.env.CIVILIZATION_SNAPSHOT_DIR) writeFileSync(`${process.env.CIVILIZATION_SNAPSHOT_DIR}/day-0.json`, serialize(sim))
    for (let i = 0; i < days * 60; i++) {
      sim.tick()
      if (process.env.CIVILIZATION_SNAPSHOT_DIR && [500 * 60, 2000 * 60, 4000 * 60].includes(s.tick))
        writeFileSync(`${process.env.CIVILIZATION_SNAPSHOT_DIR}/day-${s.tick / 60}.json`, serialize(sim))
      if (s.tick % 12000 === 0) {
        const population = s.villagers.filter((v) => v.alive).length
        expect(population).toBe(20 + s.births + s.civilization!.immigrants - s.deaths)
        expect(s.stock.food).toBeGreaterThanOrEqual(0)
        expect(s.stock.wood).toBeGreaterThanOrEqual(0)
        expect(s.stock.stone).toBeGreaterThanOrEqual(0)
        if (process.env.CIVILIZATION_PROGRESS)
          writeFileSync(
            process.env.CIVILIZATION_PROGRESS,
            JSON.stringify({
              day: s.tick / 60,
              era: s.civilization!.era,
              population,
              births: s.births,
              immigrants: s.civilization!.immigrants,
              deaths: s.deaths,
              buildings: s.buildings.length,
              knowledge: s.civilization!.knowledge,
              steel: s.civilization!.steel,
            }),
          )
      }
    }
    const population = s.villagers.filter((v) => v.alive).length
    expect(s.civilization!.era).toBe(4)
    expect(s.civilization!.transitions.map((t) => t.era)).toEqual([0, 1, 2, 3, 4])
    expect(population).toBeGreaterThanOrEqual(days >= 4000 ? 1000 : 100)
    expect(s.buildings.length).toBeGreaterThanOrEqual(days >= 4000 ? 100 : 40)
    expect(countCivic(s, 'skyscraper')).toBeGreaterThanOrEqual(days >= 4000 ? 30 : 8)
    expect(countCivic(s, 'powerplant')).toBeGreaterThanOrEqual(days >= 4000 ? 5 : 2)
    expect(countCivic(s, 'quarry')).toBeGreaterThanOrEqual(2)
    expect(s.civilization!.oreReserve).toBeLessThan(60000)
    expect(s.civilization!.roads.filter(Boolean).length).toBeGreaterThan(100)
    const center = s.world.size / 2
    const averageRadius = (types: string[]) => {
      const buildings = s.buildings.filter((b) => types.includes(b.type ?? 'house'))
      return buildings.reduce((sum, b) => sum + Math.hypot(b.x - center, b.y - center), 0) / buildings.length
    }
    expect(averageRadius(['farmhouse', 'granary'])).toBeGreaterThan(averageRadius(['house', 'skyscraper']))
    expect(averageRadius(['factory', 'powerplant', 'quarry'])).toBeGreaterThan(averageRadius(['house', 'skyscraper']))
    expect(s.buildings.some((b) => b.type === 'house' && (b.level ?? 0) >= 3)).toBe(true)
    const json = serialize(sim)
    expect(deserialize(json)!.state).toEqual(s)
    expect(Buffer.byteLength(json) * 2).toBeLessThan(5000000)
    const paused = new Simulation(deserialize(json)!.state)
    paused.paused = true
    if (process.env.CIVILIZATION_CHECKPOINT)
      writeFileSync(process.env.CIVILIZATION_CHECKPOINT, serialize(paused))
  },
)
