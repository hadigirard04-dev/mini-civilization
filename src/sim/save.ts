import { Simulation } from './simulation'
import type { SimState } from './types'

export const SAVE_KEY = 'mini-civ-save-v1'
export const SAVE_VERSION = 1

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
  state: SimState
}

/** 将当前模拟完整序列化为 JSON 字符串 */
export function serialize(sim: Simulation): string {
  const file: SaveFile = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    speed: sim.speed,
    state: sim.state,
  }
  return JSON.stringify(file)
}

/** 从 JSON 字符串恢复状态；损坏或版本不符返回 null */
export function deserialize(json: string): SaveFile | null {
  try {
    const file = JSON.parse(json) as SaveFile
    if (!file || typeof file !== 'object') return null
    if (file.version !== SAVE_VERSION) return null
    if (!file.state || typeof file.state.tick !== 'number' || !file.state.world || !Array.isArray(file.state.villagers)) {
      return null
    }
    return file
  } catch {
    return null
  }
}

/** 保存到存储 */
export function saveTo(sim: Simulation, storage: StorageLike): void {
  storage.setItem(SAVE_KEY, serialize(sim))
}

/** 从存储读取为可继续运行的模拟（恢复后不处于暂停）；无档或损坏返回 null */
export function loadFrom(storage: StorageLike): Simulation | null {
  const json = storage.getItem(SAVE_KEY)
  if (!json) return null
  const file = deserialize(json)
  if (!file) return null
  try {
    const sim = new Simulation(file.state)
    if (typeof file.speed === 'number' && file.speed > 0) sim.speed = file.speed
    sim.paused = false
    return sim
  } catch {
    return null
  }
}

/** 清除存档 */
export function clearSave(storage: StorageLike): void {
  storage.removeItem(SAVE_KEY)
}
