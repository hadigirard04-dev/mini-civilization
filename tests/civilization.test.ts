import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/simulation'
import { CIVIC_YEAR_TICKS, createCivilization, electricGrid, countCivic } from '../src/sim/civilization'
import { deserialize, serialize, saveTo, loadFrom } from '../src/sim/save'
import { findPath } from '../src/sim/path'
import { generateWorld, MOUNTAIN } from '../src/sim/world'

describe('大陆与文明', () => {
  it('256×256 大陆可复现，包含多种自然地形；旧模式仍为 64×64', () => {
    const a = generateWorld(42, 256, true),
      b = generateWorld(42, 256, true)
    expect(a).toEqual(b)
    expect(a.tiles).toHaveLength(65536)
    const terrain = new Set<number>(a.tiles.map((t) => t.terrain))
    for (const type of [0, 1, 2, 3, 5, 6, 7, 8, 9]) expect(terrain.has(type), `terrain=${type}`).toBe(true)
    expect(new Simulation(42).state.world.size).toBe(64)
  })
  it('山地不能穿越；大地图长直线不会漏检后段障碍', () => {
    const w = generateWorld(42, 256, true)
    for (const t of w.tiles) {
      t.terrain = 0
      t.resource = 40
      t.max = 40
    }
    w.tiles[240 * 256 + 240].terrain = MOUNTAIN
    expect(findPath(w, 0.5, 0.5, 240, 240)).toBeNull()
    const route = findPath(w, 0.5, 0.5, 250, 250)
    expect(route).not.toBeNull()
    expect(route!.length).toBeGreaterThan(1)
  })
  it('年月与年龄一致，婴儿不会直接成为劳动力', () => {
    const sim = new Simulation(42, 'evolution')
    sim.state.civilization!.autoBuild = false
    const person = sim.state.villagers[0],
      age = person.age
    person.age = 0
    person.task = 'idle'
    person.civicJob = 'research'
    sim.tick()
    expect(person.age).toBeCloseTo(1 / CIVIC_YEAR_TICKS, 12)
    expect(['wander', 'rest']).toContain(person.task)
    person.age = age
    const before = person.age
    sim.tick()
    expect(person.age - before).toBeCloseTo(1 / CIVIC_YEAR_TICKS, 12)
  })
  it('妊娠到期才出生，新生儿年龄为 0；人口来源满足恒等式', () => {
    const sim = new Simulation(42, 'evolution')
    const c = sim.state.civilization!
    c.autoBuild = false
    const mother = sim.state.villagers[0]
    mother.sex = 'female'
    mother.pregnancyDue = 270 * 60
    sim.state.tick = mother.pregnancyDue - 2
    sim.tick()
    expect(sim.state.births).toBe(0)
    sim.tick()
    expect(sim.state.births).toBe(1)
    const baby = sim.state.villagers.find((v) => v.motherId === mother.id)!
    expect(baby).toBeDefined()
    expect(baby.age).toBeCloseTo(0, 3)
    expect(mother.pregnancyDue).toBeNull()
    expect(sim.state.villagers.filter((v) => v.alive).length).toBe(
      20 + sim.state.births + c.immigrants - sim.state.deaths,
    )
  })
  it('迁入需要住房与口粮，并扣减外部人口池和安置口粮', () => {
    const sim = new Simulation(42, 'evolution'),
      s = sim.state,
      c = s.civilization!
    c.era = 1
    c.autoBuild = false
    s.buildings.push({ id: 990, x: 132, y: 132, type: 'granary', level: 1 })
    s.stock.food = 1000
    s.tick = 1799
    const pool = c.migrationPool
    sim.tick()
    expect(c.immigrants).toBe(0) // 无空余岗位
    for (let i = 0; i < 4; i++) {
      s.world.tiles[120 * 256 + 120 + i] = { terrain: 4, resource: 60, max: 60 }
    }
    s.worldVersion++
    s.tick = 3599
    sim.tick()
    expect(c.immigrants).toBe(1)
    expect(c.migrationPool).toBe(pool - 1)
    expect(s.consumed.food).toBeGreaterThanOrEqual(20)
    s.stock.food = 0
    s.tick = 5399
    sim.tick()
    expect(c.immigrants).toBe(1)
  })
  it('挂机天数不会直接升级时代；需要建成条件', () => {
    const sim = new Simulation(42, 'evolution'),
      s = sim.state,
      c = s.civilization!
    c.autoBuild = false
    c.knowledge = 1000
    s.tick = 119999
    sim.tick()
    expect(c.era).toBe(0)
    for (let i = 0; i < 4; i++) {
      const t = s.world.tiles[120 * 256 + 120 + i]
      t.terrain = 4
      t.max = 60
      t.resource = 60
    }
    s.worldVersion++
    s.tick = 120059
    sim.tick()
    expect(c.era).toBe(1)
  })
  it('工厂需要工人、原料和电力；停电不凭空产钢材', () => {
    const sim = new Simulation(42, 'evolution'),
      s = sim.state,
      c = s.civilization!
    c.era = 3
    c.autoBuild = false
    const worker = s.villagers[0]
    worker.task = 'industry'
    worker.civicJob = 'industry'
    worker.x = 131.5
    worker.y = 131.5
    worker.path = []
    s.buildings.push({ id: 990, x: 131, y: 131, type: 'factory', level: 3 })
    s.stock.food = 600
    s.stock.wood = 100
    s.stock.stone = 100
    expect(electricGrid(s).ratio).toBe(0)
    sim.tick()
    expect(c.steel).toBe(0)
    s.buildings.push({ id: 991, x: 135, y: 131, type: 'powerplant', level: 3 })
    sim.tick()
    expect(c.steel).toBeGreaterThan(0)
    expect(s.consumed.wood).toBeGreaterThan(0)
    expect(s.consumed.stone).toBeGreaterThan(0)
  })
  it('大地图紧凑存档保留完整状态，损坏时代和道路被拒绝；接受旧 v2', () => {
    const sim = new Simulation(42, 'evolution')
    sim.state.civilization!.priority = 'science'
    sim.tick()
    const json = serialize(sim)
    const decoded = deserialize(json)!
    expect(decoded.state).toEqual(sim.state)
    expect(Buffer.byteLength(json)).toBeLessThan(2400000)
    const restored = new Simulation(decoded.state)
    sim.tick()
    restored.tick()
    expect(restored.state).toEqual(sim.state)
    const file = JSON.parse(json)
    file.state.civilization.era = 99
    expect(deserialize(JSON.stringify(file))).toBeNull()
    file.state.civilization = createCivilization(64)
    expect(deserialize(JSON.stringify(file))).toBeNull()
    const old = JSON.parse(serialize(new Simulation(42)))
    old.version = 2
    delete old.state.civilization
    const migrated = new Simulation(deserialize(JSON.stringify(old))!.state)
    expect(migrated.state.civilization).toBeNull()
  })
  it('压缩存档可恢复，损坏压缩数据安全返回空档', () => {
    const sim = new Simulation(42, 'evolution'),
      values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    }
    saveTo(sim, storage)
    expect(values.values().next().value!.startsWith('MC3Z:')).toBe(true)
    expect(loadFrom(storage)!.state).toEqual(sim.state)
    for (const key of values.keys()) values.set(key, 'MC3Z:invalid!')
    expect(loadFrom(storage)).toBeNull()
  })

  it('采石场的矿产有限且守恒，没有矿藏就不产石料', () => {
    const sim = new Simulation(42, 'evolution'),
      s = sim.state,
      c = s.civilization!
    c.autoBuild = false
    c.era = 1
    c.oreReserve = 0.05
    const miner = s.villagers[0]
    miner.task = 'mining'
    miner.civicJob = 'mining'
    miner.x = 131.5
    miner.y = 131.5
    miner.path = []
    s.buildings.push({ id: 990, x: 131, y: 131, type: 'quarry', level: 1 })
    const before = s.stock.stone
    sim.tick()
    expect(c.oreReserve).toBe(0)
    expect(s.stock.stone - before).toBeCloseTo(0.05, 8)
    const after = s.stock.stone
    sim.tick()
    expect(s.stock.stone).toBe(after)
  })

  it('自主建设可以暂停，手动建造不会忽略材料和解锁条件', () => {
    const sim = new Simulation(42, 'evolution')
    sim.state.civilization!.autoBuild = false
    for (let i = 0; i < 120; i++) sim.tick()
    expect(sim.state.sites).toHaveLength(0)
    expect(sim.orderCivic('factory')).toBe(false)
    expect(sim.orderCivic('farm')).toBe(true)
    expect(countCivic(sim.state, 'farm', true)).toBe(1)
  })
})
