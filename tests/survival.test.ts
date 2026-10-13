import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/simulation'
import { BUILDINGS, EVENTS, YEAR_TICKS, foodCapacity, seasonAt, workforce } from '../src/sim/survival'
import { AUTO_SAVE_KEY, deserialize, loadFrom, saveTo, SAVE_KEY, serialize } from '../src/sim/save'

function ticks(sim: Simulation, n: number) {
  for (let i = 0; i < n; i++) sim.tick()
}
function roundTrip(sim: Simulation) {
  const json = serialize(sim)
  return loadFrom({ getItem: (key) => (key === SAVE_KEY ? json : null), setItem() {}, removeItem() {} })!
}

describe('首年生存机制', () => {
  it('旧版默认沙盒；首年挑战有明确的初始分工和储粮上限', () => {
    expect(new Simulation(42).state.campaign).toBeNull()
    const sim = new Simulation(42, 'survival')
    expect(workforce(sim.state)).toEqual({ adults: 20, farmers: 10, builders: 2, gatherers: 8 })
    expect(foodCapacity(sim.state)).toBe(300)
    expect([0, 1800, 3600, 5400, 7200].map(seasonAt)).toEqual([0, 1, 2, 3, 0])
  })

  it('调整职业不丢携带物，释放工地；非法分工不改状态', () => {
    const sim = new Simulation(42, 'survival')
    const v = sim.state.villagers[0]
    v.carry = 7
    v.carryType = 'food'
    sim.state.sites.push({ id: 900, x: 30, y: 30, progress: 0.2, builderId: v.id, type: 'house' })
    expect(sim.setWorkforce(0, 20)).toBe(true)
    expect(v.profession).toBe('builder')
    expect(v.carry).toBe(7)
    expect(sim.state.sites[0].builderId).toBeNull()
    const state = serialize(sim)
    expect(sim.setWorkforce(20, 1)).toBe(false)
    expect(sim.setWorkforce(-1, 2)).toBe(false)
    expect(sim.setWorkforce(1.5, 2)).toBe(false)
    expect(serialize(sim).replace(/"savedAt":\d+/, '')).toBe(state.replace(/"savedAt":\d+/, ''))
  })

  it('粮仓和农舍不提供人口容量，住房才提供；补给不超过仓容并标记辅助', () => {
    const sim = new Simulation(42, 'survival')
    sim.state.buildings.push(
      { id: 90, x: 30, y: 30, type: 'granary' },
      { id: 91, x: 31, y: 30, type: 'farmhouse' },
    )
    expect(sim.capacity).toBe(20)
    expect(foodCapacity(sim.state)).toBe(1200)
    sim.grant('food', 5000)
    expect(sim.state.stock.food).toBe(1200)
    expect(sim.state.campaign!.assisted).toBe(true)
    sim.state.buildings.push({ id: 92, x: 30, y: 31, type: 'house' })
    expect(sim.capacity).toBe(24)
  })

  it('施工扣料一次、无建筑工不施工，有建筑工才落成', () => {
    const sim = new Simulation(42, 'survival')
    sim.setWorkforce(10, 0)
    const before = { ...sim.state.stock }
    expect(sim.orderBuilding('farm')).toBe(true)
    expect(sim.state.stock.wood).toBe(before.wood - BUILDINGS.farm.wood)
    ticks(sim, 200)
    expect(sim.state.sites[0].progress).toBe(0)
    sim.setWorkforce(10, 2)
    ticks(sim, 300)
    expect(sim.state.sites).toHaveLength(0)
    expect(sim.state.world.tiles.filter((t) => t.terrain === 4)).toHaveLength(1)
    expect(sim.state.consumed.wood).toBe(5)
    sim.state.stock.wood = 0
    const n = sim.state.sites.length
    expect(sim.orderBuilding('granary')).toBe(false)
    expect(sim.state.sites.length).toBe(n)
  })

  it('选择事件时冻结，无法重复选择；接纳难民要检查口粮和住房', () => {
    const sim = new Simulation(42, 'survival')
    sim.state.tick = EVENTS[0].at - 1
    sim.tick()
    expect(sim.state.campaign!.pendingEvent).toBe('refugees')
    const before = serialize(sim)
    sim.advance(100)
    sim.tick()
    expect(sim.state.tick).toBe(EVENTS[0].at)
    expect(serialize(sim).replace(/"savedAt":\d+/, '')).toBe(before.replace(/"savedAt":\d+/, ''))
    expect(sim.resolveEvent(0)).toBe(false)
    sim.state.buildings.push(
      { id: 900, x: 30, y: 30, type: 'house' },
      { id: 901, x: 30, y: 31, type: 'house' },
    )
    sim.state.stock.food = 89
    expect(sim.resolveEvent(0)).toBe(false)
    sim.state.stock.food = 140
    expect(sim.resolveEvent(0)).toBe(true)
    expect(sim.state.stock.food).toBe(50)
    expect(sim.state.villagers.filter((v) => v.alive)).toHaveLength(25)
    expect(workforce(sim.state).adults).toBe(25)
    expect(sim.resolveEvent(0)).toBe(false)
    expect(sim.state.campaign!.decisions).toHaveLength(1)
  })

  it('入冬远行即使无粮无木也能放弃，不会锁死时间', () => {
    const sim = new Simulation(42, 'survival')
    sim.state.campaign!.pendingEvent = 'harvest'
    sim.state.stock.food = 0
    sim.state.stock.wood = 0
    expect(sim.resolveEvent(0)).toBe(false)
    expect(sim.resolveEvent(1)).toBe(false)
    expect(sim.resolveEvent(2)).toBe(true)
    expect(sim.blocked).toBe(false)
    expect(sim.state.stock.food).toBe(0)
    expect(sim.state.stock.wood).toBe(0)
    expect(sim.resolveEvent(3)).toBe(false)
  })

  it('冬季消耗比春季高 40%，并减慢食物再生', () => {
    const spring = new Simulation(42, 'survival'),
      winter = new Simulation(42, 'survival')
    winter.state.tick = 5500
    winter.state.campaign!.resolvedEvents = EVENTS.map((e) => e.id)
    const tile = spring.state.world.tiles.findIndex((t) => t.terrain === 0)
    spring.state.world.tiles[tile].resource = 0
    winter.state.world.tiles[tile].resource = 0
    const hunger = spring.state.villagers[0].hunger
    spring.tick()
    winter.tick()
    expect(hunger - winter.state.villagers[0].hunger).toBeCloseTo(
      (hunger - spring.state.villagers[0].hunger) * 1.4,
    )
    expect(winter.state.world.tiles[tile].resource).toBeLessThan(spring.state.world.tiles[tile].resource)
  })

  it('存档保留待处理事件，恢复后推进结果一致；支持 v1 沙盒和暂停状态', () => {
    const sim = new Simulation(77, 'survival')
    ticks(sim, EVENTS[0].at)
    const restored = roundTrip(sim)
    expect(restored.state).toEqual(sim.state)
    expect(restored.blocked).toBe(true)
    sim.resolveEvent(1)
    restored.resolveEvent(1)
    ticks(sim, 400)
    ticks(restored, 400)
    expect(restored.state).toEqual(sim.state)
    sim.paused = true
    expect(roundTrip(sim).paused).toBe(true)
    const old = JSON.parse(serialize(new Simulation(77)))
    old.version = 1
    delete old.state.campaign
    delete old.paused
    const loaded = loadFrom({ getItem: () => JSON.stringify(old), setItem() {}, removeItem() {} })!
    expect(loaded.state.campaign).toBeNull()
    loaded.tick()
    expect(loaded.state.tick).toBe(1)
  })

  it('自动保存不覆盖手动回退点', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    }
    const sim = new Simulation(42, 'survival')
    saveTo(sim, storage)
    ticks(sim, 100)
    saveTo(sim, storage, AUTO_SAVE_KEY)
    expect(loadFrom(storage)!.state.tick).toBe(0)
    expect(loadFrom(storage, AUTO_SAVE_KEY)!.state.tick).toBe(100)
  })

  it('损坏的地形、库存或挑战状态被拒绝', () => {
    for (const corrupt of [
      (s: Simulation['state']) => {
        s.world.tiles = []
      },
      (s: Simulation['state']) => {
        s.stock.food = -1
      },
      (s: Simulation['state']) => {
        s.campaign!.farmers = -1
      },
      (s: Simulation['state']) => {
        s.campaign!.pendingEvent = 'unknown' as never
      },
    ]) {
      const sim = new Simulation(42, 'survival')
      corrupt(sim.state)
      expect(deserialize(serialize(sim))).toBeNull()
    }
  })

  it('首年结束只结算一次，冻结结果后可继续；灭村提前结算', () => {
    const sim = new Simulation(42, 'survival')
    sim.state.tick = YEAR_TICKS - 1
    sim.state.campaign!.resolvedEvents = EVENTS.map((e) => e.id)
    sim.tick()
    const result = { ...sim.state.campaign!.result! }
    expect(result.won).toBe(true)
    expect(sim.blocked).toBe(true)
    sim.tick()
    expect(sim.state.tick).toBe(YEAR_TICKS)
    sim.continueAfterYear()
    sim.tick()
    expect(sim.state.tick).toBe(YEAR_TICKS + 1)
    expect(sim.state.campaign!.result).toEqual(result)
    const empty = new Simulation(42, 'survival')
    empty.state.villagers = []
    empty.tick()
    expect(empty.state.campaign!.result!.won).toBe(false)
    expect(empty.state.campaign!.result!.population).toBe(0)
  })
})

it('五种真实地形：合理储粮能保住 20 人，只挂机无法通过冬季', { timeout: 60000 }, () => {
  for (const seed of [11, 42, 12345, 777, 20261009]) {
    for (const planned of [false, true]) {
      const sim = new Simulation(seed, 'survival')
      if (planned) sim.setWorkforce(13, 2)
      for (let step = 0; step < YEAR_TICKS + 10 && !sim.state.campaign!.result; step++) {
        const c = sim.state.campaign!
        if (c.pendingEvent) expect(sim.resolveEvent(c.pendingEvent === 'harvest' ? 0 : 1)).toBe(true)
        if (planned && step % 20 === 0 && !sim.blocked) {
          const farms =
            sim.state.world.tiles.filter((t) => t.terrain === 4).length +
            sim.state.sites.filter((t) => t.type === 'farm').length
          const count = (kind: string) =>
            sim.state.buildings.filter((b) => b.type === kind).length +
            sim.state.sites.filter((t) => t.type === kind).length
          if (farms < 10) sim.orderBuilding('farm')
          else if (count('granary') < 2) sim.orderBuilding('granary')
          else if (count('farmhouse') < 2) sim.orderBuilding('farmhouse')
          if (step === 5400) sim.setWorkforce(18, 0)
        }
        sim.tick()
        expect(sim.state.stock.food).toBeGreaterThanOrEqual(0)
        expect(sim.state.stock.food).toBeLessThanOrEqual(foodCapacity(sim.state))
      }
      const result = sim.state.campaign!.result!
      expect(result.won, `seed=${seed} planned=${planned}`).toBe(planned)
      expect(result.assisted).toBe(false)
      expect(result.decisions).toHaveLength(3)
      if (planned) {
        expect(result.population).toBeGreaterThanOrEqual(20)
        expect(result.starveDeaths).toBe(0)
      } else expect(result.population).toBeLessThan(20)
    }
  }
})
