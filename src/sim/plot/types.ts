import type { World } from '../world'
import type { HistoryPoint, JournalEntry } from '../types'

/** 区块用途（规划器分配；none = 未开发，但可能正在采集林/矿） */
export type Zone = 'none' | 'residential' | 'agriculture' | 'industry' | 'civic' | 'park'
export type Res = 'food' | 'wood' | 'stone' | 'steel' | 'electricity'
export type CivicKind =
  | 'plaza'
  | 'market'
  | 'granary'
  | 'workshop'
  | 'school'
  | 'clinic'
  | 'park'
  | 'waterworks'
  | 'powerplant'
export type IndustryKind = 'factory' | 'quarry'
export type Policy = 'balanced' | 'food' | 'growth' | 'science' | 'livable'
export type Overlay = 'none' | 'zone' | 'coverage' | 'landValue' | 'pollution'

export interface Coverage {
  market: number
  school: number
  clinic: number
  park: number
  water: number
  power: number
}

/** 渲染用建筑描述符：仅表现，不参与结算 */
export interface BlockBuilding {
  kind: string
  tx: number
  ty: number
  w: number
  h: number
  level: number
}

export interface Construction {
  kind: string
  days: number
  progress: number
}

/** 区块：本模式的唯一账本单位（8×8 瓦片） */
export interface Block {
  bx: number
  by: number
  /** 主导地形（由 64 瓦片投票） */
  terrain: number
  buildable: boolean
  hasWater: boolean
  hasForest: boolean
  hasOre: boolean
  zone: Zone
  /** 0 = 已划区未建成；1–4 = 建成等级 */
  density: number
  population: number
  jobs: number
  staffed: number
  civic: CivicKind | null
  industry: IndustryKind | null
  buildings: BlockBuilding[]
  covered: Coverage
  landValue: number
  pollution: number
  /** 物流系数 0–1（到最近仓储/市场的路网距离） */
  logistics: number
  construction: Construction | null
  settlement: number
}

export interface Settlement {
  id: number
  name: string
  center: number
  foundedTick: number
  blocks: number[]
  population: number
  jobs: number
  housing: number
  /** 路网可达的其他聚落 id */
  links: number[]
}

export interface Ledger {
  food: number
  wood: number
  stone: number
  steel: number
  electricity: number
  production: Record<Res, number>
  consumption: Record<Res, number>
  storageCapacity: number
  knowledge: number
  cumulativeSteel: number
  children: number
  adults: number
  elderly: number
  births: number
  deaths: number
  immigrants: number
  migrationPool: number
  oreReserve: number
}

/** 每轮统计（时代门槛与 UI 都读它） */
export interface PlotStats {
  roadEdges: number
  residentialBlocks: number
  builtResidential: number
  agricultureBlocks: number
  builtAgriculture: number
  industryBlocks: number
  civicBlocks: number
  housingCapacity: number
  meanDensity: number
  industryResidentialAdjacency: number
  marketCoveredRatio: number
  powerCoverage: number
  highValueBlocks: number
  households: number
}

export interface PlotState {
  world: World
  blocks: Block[]
  settlements: Settlement[]
  /** 竖边（块 (bx-1,by) 与 (bx,by) 之间）：0 无路，1 土路，2 街，3 大道 */
  vRoad: Uint8Array
  /** 横边（块 (bx,by-1) 与 (bx,by) 之间） */
  hRoad: Uint8Array
  ledger: Ledger
  stats: PlotStats
  era: number
  tick: number
  rngState: number
  policy: Policy
  overlay: Overlay
  history: HistoryPoint[]
  journal: JournalEntry[]
  milestones: string[]
  nextSettlementId: number
}
