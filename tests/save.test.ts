import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/simulation'
import { SAVE_KEY, loadFrom, saveTo, serialize, type StorageLike } from '../src/sim/save'

function memoryStorage(): StorageLike {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
}

describe('存档与恢复', () => {
  it('保存并恢复后关键模拟状态完全一致', () => {
    const sim = new Simulation(77)
    for (let i = 0; i < 500; i++) sim.tick()
    const store = memoryStorage()
    saveTo(sim, store)
    expect(store.getItem(SAVE_KEY)).not.toBeNull()

    const restored = loadFrom(store)
    expect(restored).not.toBeNull()
    expect(restored!.state).toEqual(sim.state)
  })

  it('恢复后的模拟能继续运行（而不是只恢复画面）', () => {
    const sim = new Simulation(77)
    for (let i = 0; i < 300; i++) sim.tick()
    const store = memoryStorage()
    saveTo(sim, store)
    const restored = loadFrom(store)!
    const tickBefore = restored.state.tick
    restored.advance(1)
    expect(restored.state.tick).toBeGreaterThan(tickBefore)
    expect(restored.paused).toBe(false)
  })

  it('存档损坏时安全返回 null，不抛异常', () => {
    const store = memoryStorage()
    store.setItem(SAVE_KEY, '{broken json')
    expect(loadFrom(store)).toBeNull()
    store.setItem(SAVE_KEY, JSON.stringify({ version: 999, state: { tick: 1 } }))
    expect(loadFrom(store)).toBeNull()
    expect(loadFrom(memoryStorage())).toBeNull()
  })

  it('序列化结果可直接 JSON 解析且包含完整状态', () => {
    const sim = new Simulation(8)
    for (let i = 0; i < 50; i++) sim.tick()
    const json = serialize(sim)
    const parsed = JSON.parse(json) as { version: number; state: { tick: number } }
    expect(parsed.version).toBeGreaterThanOrEqual(1)
    expect(parsed.state.tick).toBe(sim.state.tick)
  })
})
