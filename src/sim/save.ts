import { EVENTS } from './survival'
import { Simulation } from './simulation'
import type { SimState } from './types'

export const SAVE_KEY = 'mini-civ-save-v1'
export const AUTO_SAVE_KEY = 'mini-civ-autosave-v2'
export const SAVE_VERSION = 2

/** 可注入的存储（浏览器 localStorage / 测试内存存储） */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SaveFile {
  version: number
  savedAt: number
  /** 恢复时应用的模拟速度 */
  speed: number
  paused?: boolean
  state: SimState
}

/** 将当前模拟完整序列化为 JSON 字符串 */
export function serialize(sim: Simulation): string {
  const file: SaveFile = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    speed: sim.speed,
    paused: sim.paused,
    state: sim.state,
  }
  return JSON.stringify(file)
}

/** 从 JSON 字符串恢复状态；损坏或不支持的版本返回 null；接受 v1 沙盒 */
export function deserialize(json: string): SaveFile | null {
  try {
    const file = JSON.parse(json) as SaveFile
    if (!file || typeof file !== 'object') return null
    if (file.version !== 1 && file.version !== SAVE_VERSION) return null
    if (
      !file.state ||
      typeof file.state.tick !== 'number' ||
      !file.state.world ||
      !Array.isArray(file.state.villagers)
    ) {
      return null
    }
    const s = file.state
    const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
    const nonnegative = (n: unknown) => finite(n) && n >= 0
    if (
      !Number.isInteger(s.tick) ||
      s.tick < 0 ||
      !Number.isInteger(s.world.size) ||
      s.world.size < 4 ||
      s.world.size > 128
    )
      return null
    if (!Array.isArray(s.world.tiles) || s.world.tiles.length !== s.world.size ** 2) return null
    if (
      s.world.tiles.some(
        (t) =>
          !t ||
          !Number.isInteger(t.terrain) ||
          t.terrain < 0 ||
          t.terrain > 4 ||
          !nonnegative(t.resource) ||
          !nonnegative(t.max),
      )
    )
      return null
    if (
      !s.stock ||
      !s.consumed ||
      !['food', 'wood', 'stone'].every(
        (k) =>
          nonnegative(s.stock[k as keyof typeof s.stock]) &&
          nonnegative(s.consumed[k as keyof typeof s.consumed]),
      )
    )
      return null
    if (
      !Array.isArray(s.sites) ||
      !Array.isArray(s.buildings) ||
      !Array.isArray(s.history) ||
      !finite(s.rngState) ||
      !nonnegative(s.nextId)
    )
      return null
    if (
      s.villagers.some(
        (v) =>
          !v ||
          !finite(v.id) ||
          !finite(v.x) ||
          !finite(v.y) ||
          !finite(v.age) ||
          !finite(v.hunger) ||
          !finite(v.stamina) ||
          !Array.isArray(v.path) ||
          !Array.isArray(v.failedTiles) ||
          typeof v.alive !== 'boolean',
      )
    )
      return null
    if (
      s.sites.some(
        (b) =>
          !b ||
          !finite(b.id) ||
          !finite(b.x) ||
          !finite(b.y) ||
          !nonnegative(b.progress) ||
          (b.type && !['house', 'farm', 'granary', 'farmhouse'].includes(b.type)),
      )
    )
      return null
    if (
      s.buildings.some(
        (b) =>
          !b ||
          !finite(b.id) ||
          !finite(b.x) ||
          !finite(b.y) ||
          (b.type && !['house', 'granary', 'farmhouse'].includes(b.type)),
      )
    )
      return null
    if (s.campaign) {
      const c = s.campaign
      const validEvent = (id: unknown) => EVENTS.some((e) => e.id === id)
      if (
        !Number.isInteger(c.farmers) ||
        c.farmers < 0 ||
        !Number.isInteger(c.builders) ||
        c.builders < 0 ||
        !nonnegative(c.minFood)
      )
        return null
      if (c.pendingEvent !== null && !validEvent(c.pendingEvent)) return null
      if (
        !Array.isArray(c.resolvedEvents) ||
        c.resolvedEvents.some((id) => !validEvent(id)) ||
        !Array.isArray(c.decisions) ||
        c.decisions.some((d) => typeof d !== 'string')
      )
        return null
      if (typeof c.assisted !== 'boolean' || typeof c.continued !== 'boolean') return null
      if (
        c.result &&
        (typeof c.result.won !== 'boolean' ||
          typeof c.result.assisted !== 'boolean' ||
          !nonnegative(c.result.tick) ||
          !nonnegative(c.result.population) ||
          !nonnegative(c.result.food) ||
          !nonnegative(c.result.minFood) ||
          !nonnegative(c.result.starveDeaths) ||
          !nonnegative(c.result.ageDeaths) ||
          !Array.isArray(c.result.decisions))
      )
        return null
    }
    return file
  } catch {
    return null
  }
}

/** 保存到存储 */
export function saveTo(sim: Simulation, storage: StorageLike, key: string = SAVE_KEY): void {
  storage.setItem(key, serialize(sim))
}

/** 从存储读取为可继续运行的模拟（保留暂停和待处理事件）；无档或损坏返回 null */
export function loadFrom(storage: StorageLike, key: string = SAVE_KEY): Simulation | null {
  const json = storage.getItem(key)
  if (!json) return null
  const file = deserialize(json)
  if (!file) return null
  try {
    const sim = new Simulation(file.state)
    if ([1, 2, 5, 10, 20].includes(file.speed)) sim.speed = file.speed
    sim.paused = file.paused === true
    return sim
  } catch {
    return null
  }
}

/** 清除存档 */
export function clearSave(storage: StorageLike): void {
  storage.removeItem(SAVE_KEY)
}
