import { strToU8, strFromU8, zlibSync, unzlibSync } from 'fflate'
import { CIVIC_BUILDINGS } from './civilization'
import { EVENTS } from './survival'
import { Simulation } from './simulation'
import type { SimState } from './types'

export const SAVE_KEY = 'mini-civ-save-v1'
export const AUTO_SAVE_KEY = 'mini-civ-autosave-v2'
export const SAVE_VERSION = 3

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
  if (sim.state.civilization) {
    return JSON.stringify({
      ...file,
      state: {
        ...file.state,
        world: {
          ...file.state.world,
          tiles: file.state.world.tiles.map((t) => [t.terrain, t.resource, t.max]),
        },
      },
    })
  }
  return JSON.stringify(file)
}

/** 从 JSON 字符串恢复状态；损坏或不支持的版本返回 null；接受 v1 沙盒 */
export function deserialize(json: string): SaveFile | null {
  try {
    const file = JSON.parse(json) as SaveFile
    if (!file || typeof file !== 'object') return null
    if (![1, 2, SAVE_VERSION].includes(file.version)) return null
    if (
      !file.state ||
      typeof file.state.tick !== 'number' ||
      !file.state.world ||
      !Array.isArray(file.state.villagers)
    ) {
      return null
    }
    if (
      file.version === 3 &&
      file.state.world &&
      Array.isArray(file.state.world.tiles) &&
      Array.isArray(file.state.world.tiles[0])
    ) {
      const raw = file.state.world.tiles as unknown as number[][]
      if (raw.some((t) => !Array.isArray(t) || t.length !== 3)) return null
      file.state.world.tiles = raw.map((t) => ({
        terrain: t[0],
        resource: t[1],
        max: t[2],
      })) as SimState['world']['tiles']
    }
    const s = file.state
    const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
    const nonnegative = (n: unknown) => finite(n) && n >= 0
    if (
      !Number.isInteger(s.tick) ||
      s.tick < 0 ||
      !Number.isInteger(s.world.size) ||
      s.world.size < 4 ||
      s.world.size > 256
    )
      return null
    if (!Array.isArray(s.world.tiles) || s.world.tiles.length !== s.world.size ** 2) return null
    if (
      s.world.tiles.some(
        (t) =>
          !t ||
          !Number.isInteger(t.terrain) ||
          t.terrain < 0 ||
          t.terrain > 9 ||
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
          (b.type &&
            !['house', 'farm', 'granary', 'farmhouse', ...Object.keys(CIVIC_BUILDINGS)].includes(b.type)),
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
          (b.type && !['house', 'granary', 'farmhouse', ...Object.keys(CIVIC_BUILDINGS)].includes(b.type)),
      )
    )
      return null
    if (s.civilization) {
      const c = s.civilization
      if (c.oreReserve === undefined) c.oreReserve = 60000
      if (
        !Number.isInteger(c.era) ||
        c.era < 0 ||
        c.era > 4 ||
        !nonnegative(c.oreReserve) ||
        !nonnegative(c.knowledge) ||
        !nonnegative(c.steel) ||
        !nonnegative(c.immigrants) ||
        !nonnegative(c.migrationPool) ||
        !Array.isArray(c.roads) ||
        c.roads.length !== s.world.tiles.length ||
        c.roads.some((n) => !Number.isInteger(n) || n < 0 || n > 1) ||
        !Array.isArray(c.transitions) ||
        typeof c.autoBuild !== 'boolean' ||
        !['balanced', 'food', 'growth', 'science'].includes(c.priority)
      )
        return null
    }
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
  const json = serialize(sim)
  if (sim.state.civilization) {
    const bytes = zlibSync(strToU8(json), { level: 1 })
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    storage.setItem(key, 'MC3Z:' + btoa(binary))
  } else storage.setItem(key, json)
}

/** 从存储读取为可继续运行的模拟（保留暂停和待处理事件）；无档或损坏返回 null */
export function loadFrom(storage: StorageLike, key: string = SAVE_KEY): Simulation | null {
  const json = storage.getItem(key)
  if (!json) return null
  try {
    const decoded = json.startsWith('MC3Z:')
      ? strFromU8(unzlibSync(Uint8Array.from(atob(json.slice(5)), (c) => c.charCodeAt(0))))
      : json
    const file = deserialize(decoded)
    if (!file) return null
    const sim = new Simulation(file.state)
    if ([1, 2, 5, 10, 20, 50, 100, 200].includes(file.speed)) sim.speed = file.speed
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
