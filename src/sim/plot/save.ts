import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate'
import { generateWorld } from '../world'
import type { StorageLike } from '../save'
import { emptyLedger } from './economy'
import { createBlocks, gridSize } from './blocks'
import { PlotSim } from './sim'
import type { Block, CivicKind, Construction, Overlay, PlotState, Policy, Zone } from './types'

export const PLOT_SAVE_VERSION = 4
export const PLOT_SAVE_PREFIX = 'MC4P:'
export const PLOT_SAVE_KEY = 'mini-civ-plot-v4'
export const PLOT_AUTO_SAVE_KEY = 'mini-civ-plot-autosave-v4'
const ZONES: Zone[] = ['none', 'residential', 'agriculture', 'industry', 'civic', 'park']
const POLICIES: Policy[] = ['balanced', 'food', 'growth', 'science', 'livable']
const OVERLAYS: Overlay[] = ['none', 'zone', 'coverage', 'landValue', 'pollution']

export interface PlotSaveFile {
  version: 4
  mode: 'plot'
  savedAt: number
  speed: number
  paused: boolean
  state: PlotState
}

/** 区块只存“不可推导”的字段，覆盖/地价/物流/建筑描述符在载入后重算 */
type CompactBlock = [
  zone: number,
  density: number,
  civic: string | null,
  industry: string | null,
  construction: [string, number, number] | null,
  settlement: number,
]

function packBlock(b: Block): CompactBlock {
  const c: [string, number, number] | null = b.construction
    ? [b.construction.kind, b.construction.days, b.construction.progress]
    : null
  return [ZONES.indexOf(b.zone), b.density, b.civic, b.industry, c, b.settlement]
}

export function serializePlot(sim: PlotSim): string {
  const s = sim.state
  const file = {
    version: PLOT_SAVE_VERSION,
    mode: 'plot',
    savedAt: Date.now(),
    speed: sim.speed,
    paused: sim.paused,
    seed: s.world.seed,
    size: s.world.size,
    tick: s.tick,
    rngState: s.rngState,
    era: s.era,
    policy: s.policy,
    overlay: s.overlay,
    vRoad: Array.from(s.vRoad),
    hRoad: Array.from(s.hRoad),
    ledger: s.ledger,
    settlements: s.settlements,
    history: s.history,
    journal: s.journal,
    milestones: s.milestones,
    nextSettlementId: s.nextSettlementId,
    blocks: s.blocks.map(packBlock),
  }
  return JSON.stringify(file)
}

export function savePlot(sim: PlotSim, storage: StorageLike, key: string = PLOT_SAVE_KEY): void {
  const bytes = zlibSync(strToU8(serializePlot(sim)), { level: 1 })
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  storage.setItem(key, PLOT_SAVE_PREFIX + btoa(binary))
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function deserializePlot(json: string): PlotSaveFile | null {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    if (!raw || raw.version !== PLOT_SAVE_VERSION || raw.mode !== 'plot') return null
    const size = raw.size
    if (!isFiniteNumber(size) || ![64, 128, 256].includes(size)) return null
    const seed = raw.seed
    if (!isFiniteNumber(seed)) return null
    const blocks = raw.blocks
    if (!Array.isArray(blocks)) return null
    const bg = Math.floor(size / 8)
    if (blocks.length !== bg * bg) return null
    const vRoad = raw.vRoad
    const hRoad = raw.hRoad
    if (!Array.isArray(vRoad) || !Array.isArray(hRoad) || vRoad.length !== bg * bg || hRoad.length !== bg * bg) return null
    if (!isFiniteNumber(raw.tick) || raw.tick < 0) return null
    const era = raw.era
    if (!isFiniteNumber(era) || era < 0 || era > 4) return null

    const world = generateWorld(seed, size, true)
    const state: PlotState = {
      world,
      blocks: createBlocks(world),
      settlements: (raw.settlements as PlotState['settlements']) ?? [],
      vRoad: Uint8Array.from(vRoad as number[]),
      hRoad: Uint8Array.from(hRoad as number[]),
      ledger: (raw.ledger as PlotState['ledger']) ?? emptyLedger(),
      stats: {
        roadEdges: 0,
        residentialBlocks: 0,
        builtResidential: 0,
        agricultureBlocks: 0,
        builtAgriculture: 0,
        industryBlocks: 0,
        civicBlocks: 0,
        housingCapacity: 0,
        meanDensity: 0,
        industryResidentialAdjacency: 0,
        marketCoveredRatio: 0,
        powerCoverage: 1,
        highValueBlocks: 0,
        households: 0,
      },
      era,
      tick: raw.tick,
      rngState: isFiniteNumber(raw.rngState) ? raw.rngState : seed,
      policy: POLICIES.includes(raw.policy as Policy) ? (raw.policy as Policy) : 'balanced',
      overlay: OVERLAYS.includes(raw.overlay as Overlay) ? raw.overlay as Overlay : 'none',
      history: Array.isArray(raw.history) ? (raw.history as PlotState['history']) : [],
      journal: Array.isArray(raw.journal) ? (raw.journal as PlotState['journal']) : [],
      milestones: Array.isArray(raw.milestones) ? (raw.milestones as string[]) : [],
      nextSettlementId: isFiniteNumber(raw.nextSettlementId) ? raw.nextSettlementId : 1,
    }
    for (let i = 0; i < blocks.length; i++) {
      const row = blocks[i] as CompactBlock
      if (!Array.isArray(row) || row.length !== 6) return null
      const block = state.blocks[i]
      const zoneIndex = row[0]
      if (!isFiniteNumber(zoneIndex) || zoneIndex < 0 || zoneIndex >= ZONES.length) return null
      block.zone = ZONES[zoneIndex]
      block.density = Math.max(0, Math.min(4, Math.round(row[1])))
      block.civic = (row[2] as CivicKind | null) ?? null
      block.industry = (row[3] as Block['industry']) ?? null
      const c = row[4]
      const construction: Construction | null = c
        ? { kind: c[0], days: Math.max(0.1, c[1]), progress: Math.max(0, c[2]) }
        : null
      block.construction = construction
      block.settlement = Math.round(row[5] ?? -1)
    }
    return {
      version: PLOT_SAVE_VERSION,
      mode: 'plot',
      savedAt: isFiniteNumber(raw.savedAt) ? raw.savedAt : Date.now(),
      speed: isFiniteNumber(raw.speed) ? raw.speed : 20,
      paused: raw.paused !== false,
      state,
    }
  } catch {
    return null
  }
}

export function loadPlot(storage: StorageLike, key: string = PLOT_SAVE_KEY): PlotSim | null {
  const raw = storage.getItem(key)
  if (!raw || !raw.startsWith(PLOT_SAVE_PREFIX)) return null
  try {
    const json = strFromU8(unzlibSync(Uint8Array.from(atob(raw.slice(PLOT_SAVE_PREFIX.length)), (c) => c.charCodeAt(0))))
    const file = deserializePlot(json)
    if (!file) return null
    const sim = new PlotSim(file.state)
    if ([1, 2, 5, 10, 20, 50, 100, 200].includes(file.speed)) sim.speed = file.speed
    sim.paused = file.paused
    sim.rebuildDerived()
    return sim
  } catch {
    return null
  }
}

/** 存档类型判定：旧版文明档要给出明确提示而不是静默失败 */
export type SaveKind = 'plot' | 'legacy-civilization' | 'legacy-other' | 'none'

export function detectSaveKind(storage: StorageLike, key: string): SaveKind {
  const raw = storage.getItem(key)
  if (!raw) return 'none'
  if (raw.startsWith(PLOT_SAVE_PREFIX)) return 'plot'
  // 旧文明档是压过的（MC3Z:），需要先解压再判型
  const json = raw.startsWith('MC3Z:')
    ? (() => {
        try {
          return strFromU8(unzlibSync(Uint8Array.from(atob(raw.slice(5)), (c) => c.charCodeAt(0))))
        } catch {
          return null
        }
      })()
    : raw
  if (!json) return 'none'
  try {
    const parsed = JSON.parse(json) as { version?: number; state?: { civilization?: unknown; campaign?: unknown } }
    if (parsed.state?.civilization) return 'legacy-civilization'
    if (parsed.state) return 'legacy-other'
    return 'none'
  } catch {
    return 'none'
  }
}

export function gridOf(state: PlotState): number {
  return gridSize(state.world)
}
