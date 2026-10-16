import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate'
import {
  PLOT_AUTO_SAVE_KEY,
  PLOT_SAVE_KEY,
  PLOT_SAVE_PREFIX,
  PLOT_SAVE_VERSION,
  detectSaveKind,
  deserializePlot,
  loadPlot,
  savePlot,
  serializePlot,
} from '../src/sim/plot/save'
import { PlotSim } from '../src/sim/plot/sim'
import { AUTO_SAVE_KEY, SAVE_KEY, serialize, saveTo, type StorageLike } from '../src/sim/save'
import { Simulation } from '../src/sim/simulation'

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

function advance(sim: PlotSim, days: number): void {
  for (let d = 0; d < days; d++) for (let t = 0; t < 60; t++) sim.tick()
}

describe('存档 v4 与旧档兼容', () => {
  it('往返一致（INV6）：时间、时代、路网、地块、人口都恢复', () => {
    const sim = PlotSim.create(24680, 128)
    advance(sim, 700)
    const before = sim.state
    const json = serializePlot(sim)
    const file = deserializePlot(json)
    expect(file).toBeTruthy()
    const loaded = new PlotSim(file!.state)
    loaded.rebuildDerived()
    const after = loaded.state
    expect(after.tick).toBe(before.tick)
    expect(after.era).toBe(before.era)
    expect(after.policy).toBe(before.policy)
    expect(Array.from(after.vRoad)).toEqual(Array.from(before.vRoad))
    expect(Array.from(after.hRoad)).toEqual(Array.from(before.hRoad))
    expect(after.settlements.length).toBe(before.settlements.length)
    expect(after.blocks.map((b) => b.zone)).toEqual(before.blocks.map((b) => b.zone))
    expect(after.blocks.map((b) => b.density)).toEqual(before.blocks.map((b) => b.density))
    expect(after.ledger.food).toBeCloseTo(before.ledger.food, 6)
    expect(after.ledger.knowledge).toBeCloseTo(before.ledger.knowledge, 6)
    expect(after.rngState).toBe(before.rngState)
  })

  it('存档经压缩写入后可读回并继续推进', () => {
    const storage = memoryStorage()
    const sim = PlotSim.create(13579, 128)
    advance(sim, 300)
    savePlot(sim, storage)
    expect(storage.getItem(PLOT_SAVE_KEY)?.startsWith(PLOT_SAVE_PREFIX)).toBe(true)
    const loaded = loadPlot(storage)
    expect(loaded).toBeTruthy()
    const tickBefore = loaded!.state.tick
    loaded!.paused = false
    advance(loaded!, 10)
    expect(loaded!.state.tick).toBeGreaterThan(tickBefore)
  })

  it('损坏的存档返回 null 而不是抛错', () => {
    const storage = memoryStorage()
    storage.setItem(PLOT_SAVE_KEY, PLOT_SAVE_PREFIX + 'not-a-valid-payload')
    expect(loadPlot(storage)).toBeNull()
    expect(deserializePlot('{"version":4,"mode":"plot"}')).toBeNull()
    expect(deserializePlot('not json')).toBeNull()
  })

  it('存档版本与模式标记正确', () => {
    const sim = PlotSim.create(1, 128)
    const parsed = JSON.parse(serializePlot(sim)) as { version: number; mode: string }
    expect(parsed.version).toBe(PLOT_SAVE_VERSION)
    expect(parsed.mode).toBe('plot')
  })

  it('识别旧文明档并拒绝，沙盒/首年档仍可读取', () => {
    const storage = memoryStorage()
    // 旧文明档（v3 + civilization 字段）
    const civ = new Simulation(4242, 'evolution')
    saveTo(civ, storage, AUTO_SAVE_KEY)
    expect(detectSaveKind(storage, AUTO_SAVE_KEY)).toBe('legacy-civilization')
    expect(loadPlot(storage, AUTO_SAVE_KEY)).toBeNull()

    // 沙盒档仍能被旧通道读取
    const sandbox = new Simulation(4242, 'sandbox')
    saveTo(sandbox, storage, SAVE_KEY)
    expect(detectSaveKind(storage, SAVE_KEY)).toBe('legacy-other')
    expect(serialize(sandbox).length).toBeGreaterThan(0)
  })

  it('plot 与 legacy 存档互不干扰（键与判型分离）', () => {
    const storage = memoryStorage()
    const sim = PlotSim.create(2, 128)
    savePlot(sim, storage, PLOT_AUTO_SAVE_KEY)
    expect(detectSaveKind(storage, PLOT_AUTO_SAVE_KEY)).toBe('plot')
    expect(detectSaveKind(storage, AUTO_SAVE_KEY)).toBe('none')
    const legacy = new Simulation(2, 'sandbox')
    saveTo(legacy, storage, AUTO_SAVE_KEY)
    expect(detectSaveKind(storage, AUTO_SAVE_KEY)).toBe('legacy-other')
    expect(loadPlot(storage, PLOT_AUTO_SAVE_KEY)).toBeTruthy()
  })

  it('压缩格式可被 fflate 还原（防止 base64 前缀处理出错）', () => {
    const sim = PlotSim.create(3, 128)
    const raw = serializePlot(sim)
    const bytes = zlibSync(strToU8(raw), { level: 1 })
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    const rehydrated = strFromU8(unzlibSync(Uint8Array.from(atob(btoa(binary)), (c) => c.charCodeAt(0))))
    expect(rehydrated.length).toBeGreaterThan(0)
    expect(deserializePlot(rehydrated)).toBeTruthy()
  })
})
