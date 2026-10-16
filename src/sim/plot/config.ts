import type { CivicKind, IndustryKind, Policy, Res, Zone } from './types'

/** 区块边长（瓦片） */
export const BLOCK_SIZE = 8
/** 每游戏日的 tick 数（沿用 60 帧节奏：1× 下 1 游戏日 = 1 秒） */
export const TICKS_PER_DAY = 60
export const DAYS_PER_YEAR = 365

export type Cost = { wood: number; stone: number; steel?: number }

/**
 * 全部可调参数集中在这里：改数值不需要动逻辑。
 * 标「初值」的是尚未平衡的起点，长测与试玩后再调。
 */
export const PLOT = {
  /** 开局资源（初值） */
  founding: {
    population: 20,
    adults: 12,
    children: 6,
    elderly: 2,
    food: 200,
    wood: 80,
    stone: 50,
  },
  /** 规划器每 N 游戏日跑一次 */
  planEveryDays: 5,
  migrationEveryDays: 30,
  eraCheckEveryDays: 30,
  historyEveryTicks: 20,
  historyMax: 900,
  /** 外部人口池与矿藏总量 */
  migrationPool: 6000,
  oreReserve: 400000,
  /** 每轮规划最多产出多少动作（防止一次铺满地图） */
  roadsPerCycle: 5,
  zonesPerCycle: 5,
  upgradesPerCycle: 6,
  servicesPerCycle: 2,
  /** 建成新聚落的条件 */
  newSettlementPopulation: 900,
  newSettlementScore: 0.55,
  /** 文明最多几座聚落（都市带规模） */
  maxSettlements: 6,
  /** 施工天数 */
  days: { zone: 4, civic: 8, upgrade: 5 },
  /** 建设前必须保留的材料底（设为 0 表示不设下限；生产不会断，因为广场拾捡保底） */
  materialFloor: { wood: 0, stone: 0 },

  /** 住房容量：density 0/1/2/3/4 */
  housingCapacity: [0, 30, 70, 150, 320],
  /** 住宅升级需要的地价门槛（索引 = 目标等级） */
  upgradeLandValue: [0, 0, 0.3, 0.45, 0.6],
  /** 升级还要求城市整体入住率（不按单块，避免给未来人口预留的住房卡住升级） */
  upgradeOccupancy: 0.55,
  /** 住宅区就业（商业服务岗位/块） */
  residentialJobsPerLevel: 3,

  /** 采集：未开发但有林/矿的区块 */
  gather: {
    forest: { jobs: 2, wood: 6 },
    ore: { jobs: 2, stone: 5, ore: 1 },
  },
  /** 木石库存目标：只有低于目标时才派人采集（避免木材堆成山） */
  woodTarget: 320,
  stoneTarget: 220,
  /** 钢材库存目标：够了就减产 */
  steelTarget: 4000,
  /** 已有这么多“临路可建空地”时不再开路（让路网服务需求而不是铺满地图） */
  freeLandTarget: 12,

  /** 农业：每块每日产粮（density 1 起，每级 +22%） */
  farm: { food: 30, levelBonus: 0.22 },
  /** 机械化和工坊加成 */
  machineryPowerBonus: 0.5,
  workshopBonus: 0.15,

  /** 物流系数分档：路网边距离（跳数）→ 系数 */
  logisticsTiers: [
    { maxDistance: 8, factor: 1 },
    { maxDistance: 16, factor: 0.85 },
    { maxDistance: 24, factor: 0.7 },
    { maxDistance: Number.POSITIVE_INFINITY, factor: 0.55 },
  ],
  /** 未接入路网的区块 */
  logisticsUnconnected: 0.45,

  /** 服务半径（区块数） */
  radius: { market: 6, school: 5, clinic: 5, park: 3, waterworks: 6 },
  /** 覆盖衰减：cov = 1 - falloff × d / r（边缘仍有余量，重叠服务可以叠加） */
  coverageFalloff: 0.7,
  /** 覆盖达标的判定线（用于时代门槛与 UI） */
  coveredLine: 0.5,

  /** 人口动态（每日，初值） */
  birthRate: 0.0002,
  deathRate: 0.00008,
  elderDeathWeight: 6,
  pollutionDeathWeight: 0.5,
  clinicDeathReduction: 0.4,
  /** 年龄结构推进：儿童 → 成年 → 老年 */
  yearsToAdult: 18,
  yearsToElder: 47,
  /** 迁入 */
  migrationRate: 0.04,
  migrationMax: 40,
  attractiveness: { landValue: 0.35, jobs: 0.25, food: 0.25, links: 0.15 },
  /** 食物消耗（每人每日） */
  eat: { adult: 0.35, child: 0.2, elder: 0.28 },
  /** 迁入每人需要的安置口粮与最低储粮 */
  foodPerMigrant: 20,
  foodFloorBase: 120,
  foodFloorPerPerson: 5,
  /** 住房需求缓冲：按人口比例预留（城市总是为下一批居民提前拓地） */
  housingBufferRatio: 0.35,
  housingBufferMin: 20,
} as const

export const COSTS: Record<'road' | 'street' | 'avenue' | 'bridge' | 'upgrade', Cost> & {
  zone: Record<Zone, Cost>
  civic: Record<CivicKind, Cost>
} = {
  /** 土路：只需木料（时代 0 也能铺，避免石料死锁） */
  road: { wood: 1, stone: 0 },
  street: { wood: 1, stone: 2 },
  avenue: { wood: 2, stone: 4, steel: 2 },
  bridge: { wood: 2, stone: 8 },
  upgrade: { wood: 18, stone: 12 },
  zone: {
    none: { wood: 0, stone: 0 },
    residential: { wood: 12, stone: 6 },
    agriculture: { wood: 5, stone: 0 },
    industry: { wood: 25, stone: 15 },
    civic: { wood: 0, stone: 0 },
    park: { wood: 8, stone: 5 },
  },
  civic: {
    plaza: { wood: 10, stone: 0 },
    market: { wood: 45, stone: 25 },
    granary: { wood: 30, stone: 20 },
    workshop: { wood: 40, stone: 20 },
    school: { wood: 60, stone: 35 },
    clinic: { wood: 45, stone: 40 },
    park: { wood: 20, stone: 20 },
    waterworks: { wood: 40, stone: 30 },
    powerplant: { wood: 80, stone: 50 },
  },
}

export interface CivicSpec {
  name: string
  jobs: number
  output?: Partial<Record<Res | 'knowledge', number>>
  input?: Partial<Record<Res, number>>
  storage?: number
}

export const CIVIC_SPEC: Record<CivicKind, CivicSpec> = {
  /** 广场：居民在城郊拾捡木石，是早期不会断料的安全阀 */
  plaza: { name: '中央广场', jobs: 4, storage: 400, output: { wood: 1, stone: 0.5 } },
  market: { name: '集市', jobs: 4, storage: 600 },
  granary: { name: '粮仓', jobs: 2, storage: 900 },
  workshop: { name: '工坊', jobs: 3 },
  school: { name: '学校', jobs: 4, output: { knowledge: 14 } },
  clinic: { name: '诊所', jobs: 3 },
  park: { name: '公园', jobs: 1 },
  waterworks: { name: '水厂', jobs: 2, input: { electricity: 1 } },
  powerplant: { name: '发电站', jobs: 3, output: { electricity: 16 }, input: { wood: 1, stone: 0.5 } },
}

export interface IndustrySpec {
  name: string
  jobs: number
  output: Partial<Record<Res, number>>
  input: Partial<Record<Res, number>>
}

export const INDUSTRY_SPEC: Record<IndustryKind, IndustrySpec> = {
  factory: { name: '钢铁工厂', jobs: 8, output: { steel: 1.6 }, input: { wood: 2, stone: 1.5, electricity: 5 } },
  quarry: { name: '采石场', jobs: 5, output: { stone: 5 }, input: {} },
}

/** 电力需求 */
export const POWER = {
  residentialPerPerson: 0.015,
  factory: 5,
  quarry: 1.5,
  waterworks: 1,
  school: 0.5,
  clinic: 0.5,
}

/** 政策：只改系数与权重，不新开分支逻辑 */
export const POLICY: Record<
  Policy,
  {
    name: string
    farm: number
    road: number
    zone: number
    school: number
    park: number
    upgrade: number
  }
> = {
  balanced: { name: '均衡', farm: 1, road: 1, zone: 1, school: 1, park: 1, upgrade: 1 },
  food: { name: '粮食', farm: 1.25, road: 0.9, zone: 1, school: 0.9, park: 0.9, upgrade: 1 },
  growth: { name: '扩张', farm: 0.9, road: 1.4, zone: 1.3, school: 0.9, park: 0.9, upgrade: 1.15 },
  science: { name: '研究', farm: 0.9, road: 0.9, zone: 0.95, school: 1.5, park: 1, upgrade: 0.95 },
  livable: { name: '宜居', farm: 0.95, road: 0.95, zone: 1, school: 1.05, park: 1.5, upgrade: 1.05 },
}

/** 时代（沿用五个时代的骨架，门槛换成城市形态指标） */
export const ERAS = ['原始部落', '农业聚落', '繁荣城镇', '工业城市', '现代都市'] as const
export const ERA_SUBTITLES = [
  '篝火、帐篷与采集',
  '农田、木屋与粮仓',
  '街市、学校与砖房',
  '工厂、电站与城市街区',
  '高楼、绿地与电力生活',
] as const

/** 聚落命名用（按建立顺序取） */
export const SETTLEMENT_NAMES = [
  '起始地',
  '河湾',
  '林口',
  '石岗',
  '北滩',
  '南陌',
  '东岭',
  '西洼',
  '长桥',
  '梧桐',
] as const
