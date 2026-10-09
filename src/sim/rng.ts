/** 种子随机数（mulberry32）：同种子必产同序列，保证世界生成与模拟可复现 */
export interface Rng {
  /** [0, 1) */
  next(): number
  /** [0, max) 的整数 */
  nextInt(max: number): number
  /** [min, max) 浮点 */
  range(min: number, max: number): number
  /** 从数组随机取一项 */
  pick<T>(arr: readonly T[]): T
  /** 序列内部状态（用于存档/恢复与状态一致性） */
  getState(): number
  /** 恢复内部状态 */
  setState(state: number): void
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    nextInt: (max: number) => Math.floor(next() * max),
    range: (min: number, max: number) => min + next() * (max - min),
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    getState: () => a >>> 0,
    setState: (state: number) => {
      a = state >>> 0
    },
  }
}
