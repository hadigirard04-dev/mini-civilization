import type { CivilizationState, ConstructionKind } from './civilization'
import type { ResourceType, World } from './world'
import type { CampaignState, Profession } from './survival'

export interface Point {
  x: number
  y: number
}

/** 居民当前任务 */
export type TaskKind =
  'idle' | 'wander' | 'eat' | 'rest' | 'deposit' | 'gather' | 'build' | 'research' | 'industry' | 'mining'

export interface Villager {
  sex?: 'female' | 'male'
  pregnancyDue?: number | null
  lastBirthTick?: number
  motherId?: number
  civicJob?: 'research' | 'industry' | 'mining'
  profession?: Profession
  id: number
  name: string
  /** 连续坐标（格为单位，0.5 为格中心） */
  x: number
  y: number
  /** 饥饿值 0~100 */
  hunger: number
  /** 体力 0~100 */
  stamina: number
  /** 年龄（岁，小数随时间增长） */
  age: number
  /** 自然寿命上限（岁） */
  maxAge: number
  task: TaskKind
  /** 当前路径路点（空 = 未在移动） */
  path: Point[]
  /** 当前路径目标格（用于避免重复寻路） */
  pathGoal: Point | null
  /** 采集目标格索引 */
  gatherTile: number | null
  /** 手中携带量与类型（一次只带一种） */
  carry: number
  carryType: ResourceType | null
  alive: boolean
  /** 死亡时刻（null = 未死或非正常标记） */
  deadTick: number | null
  /** 任务内进度计数 */
  work: number
  /** 决策冷却（空闲等待 tick 数） */
  cool: number
  /** 服色色相（渲染区分） */
  hue: number
  facing: 1 | -1
  /** 步行相位（渲染动画） */
  movePhase: number
  /** 连续饥饿 tick 数 */
  starve: number
  /** 最近一次就地进食的 tick（渲染动画用；-1 = 未进食） */
  eatAnim: number
  /** 休息时是否原地睡（寻路失败兜底） */
  sleepInPlace: boolean
  /** 近期寻路失败的格（避免反复撞死路） */
  failedTiles: number[]
}

export interface BuildSite {
  id: number
  x: number
  y: number
  /** 施工进度 0~1 */
  progress: number
  builderId: number | null
  /** 工地类型：住房或农田（旧存档缺省视为住房） */
  upgradeId?: number
  type?: ConstructionKind
}

export interface Building {
  level?: number
  type?: Exclude<ConstructionKind, 'farm'>
  id: number
  x: number
  y: number
}

export interface Stock {
  food: number
  wood: number
  stone: number
}

export interface HistoryPoint {
  tick: number
  pop: number
  food: number
  wood: number
  stone: number
}

/** 纪事条目：里程碑（成就）或随机事件 */
export interface JournalEntry {
  tick: number
  kind: 'milestone' | 'event'
  text: string
}

/** 全部可序列化的模拟状态（存档 = 直接 JSON 化本结构） */
export interface SimState {
  /** null 为旧版沙盒；首年挑战独立保存，旧存档不会强行切换玩法。 */
  civilization: CivilizationState | null
  campaign: CampaignState | null
  tick: number
  world: World
  villagers: Villager[]
  sites: BuildSite[]
  buildings: Building[]
  /** 村庄公共库存 */
  stock: Stock
  /** 累计消耗（进食 + 建设） */
  consumed: Stock
  history: HistoryPoint[]
  births: number
  deaths: number
  /** 死因统计：饿死（经济崩溃的信号）与老死（自然更替） */
  starveDeaths: number
  ageDeaths: number
  /** 地形变更计数（农田落成等），UI 据此重建离屏地形层 */
  worldVersion: number
  /** 纪事（里程碑 + 随机事件），最新在前 */
  journal: JournalEntry[]
  /** 已达成的里程碑 id（防重复记录） */
  milestones: string[]
  /** 每格累计踩踏步数（渲染土路用） */
  walk: number[]
  /** 下一次随机事件的 tick */
  nextEventAt: number
  nextId: number
  rngState: number
}
