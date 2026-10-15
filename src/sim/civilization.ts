import type { SimState } from './types'
import { BUILDINGS, type BuildingKind } from './survival'

export type CivicKind =
  | 'campfire'
  | 'well'
  | 'workshop'
  | 'quarry'
  | 'market'
  | 'school'
  | 'clinic'
  | 'factory'
  | 'powerplant'
  | 'park'
  | 'skyscraper'
export type ConstructionKind = BuildingKind | CivicKind
export const ERAS = ['原始部落', '农业聚落', '繁荣城镇', '工业城市', '现代都市'] as const
export const ERA_SUBTITLES = [
  '篝火、帐篷与采集',
  '农田、木屋与粮仓',
  '街市、学校与砖房',
  '工厂、电站与城市街区',
  '高楼、绿地与电力生活',
]
export const CIVIC_YEAR_TICKS = 365 * 60
export const HOUSE_CAPACITY = [4, 6, 8, 12, 20]
export const CIVIC_BUILDINGS: Record<
  CivicKind,
  { name: string; era: number; wood: number; stone: number; steel: number; effect: string }
> = {
  campfire: { name: '部落篝火', era: 0, wood: 10, stone: 0, steel: 0, effect: '聚落中心' },
  well: { name: '水井', era: 0, wood: 15, stone: 10, steel: 0, effect: '每口井提升采收 5%，最多 15%' },
  quarry: { name: '采石场', era: 1, wood: 30, stone: 10, steel: 0, effect: '2 个采矿岗位，开采有限地下矿藏' },
  workshop: { name: '工坊', era: 1, wood: 40, stone: 20, steel: 0, effect: '木石采集 +15%，最多 +45%' },
  market: {
    name: '集市',
    era: 2,
    wood: 45,
    stone: 25,
    steel: 0,
    effect: '吸引成年移民；每月检查岗位、口粮和住房',
  },
  school: { name: '学校', era: 2, wood: 60, stone: 35, steel: 0, effect: '提供 2 个研究岗位，积累知识' },
  clinic: { name: '诊所', era: 2, wood: 45, stone: 40, steel: 0, effect: '减少老年死亡概率，改善休息' },
  factory: {
    name: '钢铁工厂',
    era: 3,
    wood: 75,
    stone: 50,
    steel: 0,
    effect: '3 个工业岗位；消耗木石与电力生产钢材',
  },
  powerplant: {
    name: '发电站',
    era: 3,
    wood: 80,
    stone: 50,
    steel: 0,
    effect: '提供 12 电力；城市与工厂消耗电力',
  },
  park: { name: '公园', era: 2, wood: 20, stone: 20, steel: 0, effect: '提升休息速度，改善城市环境' },
  skyscraper: {
    name: '现代高楼',
    era: 4,
    wood: 100,
    stone: 65,
    steel: 45,
    effect: '住房 +20，服务岗位 +32；消耗钢材',
  },
}
export interface CivilizationState {
  oreReserve: number
  immigrants: number
  migrationPool: number
  era: number
  knowledge: number
  steel: number
  autoBuild: boolean
  priority: 'balanced' | 'food' | 'growth' | 'science'
  roads: number[]
  transitions: Array<{ era: number; tick: number }>
}
export function createCivilization(size: number): CivilizationState {
  return {
    oreReserve: 60000,
    immigrants: 0,
    migrationPool: 6000,
    era: 0,
    knowledge: 0,
    steel: 0,
    autoBuild: true,
    priority: 'balanced',
    roads: Array(size * size).fill(0),
    transitions: [{ era: 0, tick: 0 }],
  }
}
const countCache = new WeakMap<SimState, { stamp: number; counts: Map<string, number> }>()
export function countCivic(s: SimState, kind: ConstructionKind, includeSites = false): number {
  const stamp = s.worldVersion + s.buildings.length
  let cache = countCache.get(s)
  if (!cache || cache.stamp !== stamp) {
    const counts = new Map<string, number>()
    for (const b of s.buildings) {
      const key = b.type ?? 'house'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    counts.set(
      'farm',
      s.world.tiles.reduce((n, t) => n + Number(t.terrain === 4), 0),
    )
    cache = { stamp, counts }
    countCache.set(s, cache)
  }
  return (
    (cache.counts.get(kind) ?? 0) +
    (includeSites ? s.sites.filter((b) => b.type === kind && b.upgradeId === undefined).length : 0)
  )
}
export function electricGrid(s: SimState) {
  const population = s.villagers.filter((v) => v.alive).length
  const supply = countCivic(s, 'powerplant') * 12
  const demand =
    s.civilization && s.civilization.era >= 3
      ? countCivic(s, 'factory') * 4 + countCivic(s, 'quarry') * 2 + population / 8
      : 0
  return { supply, demand, ratio: demand > 0 ? Math.min(1, supply / demand) : 1 }
}
export function housingCapacity(s: SimState): number {
  return 20 + s.buildings.reduce(
    (n, b) => n + (b.type === 'skyscraper' ? 20 : b.type === 'house' || !b.type ? HOUSE_CAPACITY[b.level ?? 0] : 0),
    0,
  )
}

/** 与每月迁入结算共用的规则；侧栏显示的是下次结算时按当前状态可迁入的人数。 */
export function migrationForecast(s: SimState) {
  const c = s.civilization!
  const population = s.villagers.filter((v) => v.alive).length
  const adults = s.villagers.filter((v) => v.alive && v.age >= 18).length
  const capacity = housingCapacity(s)
  const jobs = 20 + countCivic(s, 'farm') * 3 + countCivic(s, 'factory') * 30 +
    countCivic(s, 'market') * 12 + countCivic(s, 'skyscraper') * 32
  const gateway = c.era >= 1 && (c.era === 1 ? countCivic(s, 'granary') > 0 : countCivic(s, 'market') > 0)
  const foodMinimum = Math.max(120, population * 5)
  const limits = [
    { label: '本月迁入上限', available: Math.min(20, Math.max(1, Math.ceil(population * 0.03))) },
    { label: '空余住房', available: capacity - population },
    { label: '空余岗位', available: jobs - adults },
    { label: '安置口粮', available: Math.floor(s.stock.food / 20) },
    { label: '外部人口池', available: c.migrationPool },
    { label: '模拟人口上限', available: 1800 - population },
  ]
  const blockers = [] as string[]
  if (!gateway) blockers.push(c.era < 1 ? '需进入农业聚落' : c.era === 1 ? '需建成粮仓' : '需建成集市')
  if (s.stock.food <= foodMinimum) blockers.push(`口粮需超过 ${Math.floor(foodMinimum)}（当前 ${Math.floor(s.stock.food)}）`)
  for (const limit of limits.slice(1)) if (limit.available <= 0) blockers.push(`${limit.label}不足`)
  return {
    nextDay: Math.ceil((s.tick + 1) / 1800) * 30,
    count: blockers.length ? 0 : Math.max(0, Math.min(...limits.map((limit) => limit.available))),
    blockers,
    limits,
    jobs,
    adults,
  }
}

export function developmentDiagnostics(s: SimState): string[] {
  const c = s.civilization!
  const notes: string[] = []
  if (!c.autoBuild) notes.push('自主建设已暂停；需手动下达建设')
  if (s.sites.length >= 4) notes.push('4 处工地正在施工，建成后才能继续规划')
  const next = nextConstruction(s)
  if (next && c.autoBuild && s.sites.length < 4) {
    const cost = constructionCost(next)
    const missing = [
      ['木材', cost.wood - s.stock.wood],
      ['石料', cost.stone - s.stock.stone],
      ['钢材', cost.steel - c.steel],
    ].filter(([, amount]) => Number(amount) > 0)
    if (missing.length) notes.push(`下一项「${cost.name}」缺 ${missing.map(([name, amount]) => `${name} ${Math.ceil(Number(amount))}`).join('、')}`)
  }
  if (c.era < 4) {
    const unmet = eraRequirements(s).filter((r) => !r.met)
    if (unmet.length) notes.push(`时代条件待完成：${unmet.slice(0, 2).map((r) => `${r.label} ${Math.floor(r.value)}/${r.target}`).join('、')}`)
  }
  if (c.era >= 3 && electricGrid(s).ratio < 0.99) notes.push(`电力缺口 ${Math.ceil(electricGrid(s).demand - electricGrid(s).supply)}，工业与机械化农田受限`)
  return notes.slice(0, 4)
}
export function eraRequirements(s: SimState) {
  const c = s.civilization!
  const population = s.villagers.filter((v) => v.alive).length
  const req = (label: string, value: number, target: number) => ({
    label,
    value,
    target,
    met: value >= target,
  })
  const housing = countCivic(s, 'house') + countCivic(s, 'skyscraper')
  const power = electricGrid(s)
  switch (c.era) {
    case 0:
      return [
        req('农田', countCivic(s, 'farm'), 4),
        req('知识', c.knowledge, 80),
        req('人口', population, 20),
      ]
    case 1:
      return [
        req('农田', countCivic(s, 'farm'), 8),
        req('粮仓', countCivic(s, 'granary'), 1),
        req('工坊', countCivic(s, 'workshop'), 1),
        req('住房', housing, 5),
        req('知识', c.knowledge, 400),
        req('人口', population, 28),
      ]
    case 2:
      return [
        req('学校', countCivic(s, 'school'), 1),
        req('集市', countCivic(s, 'market'), 1),
        req('住房', housing, 10),
        req('知识', c.knowledge, 1600),
        req('人口', population, 40),
      ]
    case 3:
      return [
        req('工厂', countCivic(s, 'factory'), 2),
        req('电站', countCivic(s, 'powerplant'), 2),
        req('学校', countCivic(s, 'school'), 2),
        req('钢材', c.steel, 120),
        req('知识', c.knowledge, 5000),
        req('人口', population, 60),
        req('供电率', power.ratio * 100, 100),
      ]
    default:
      return []
  }
}
export function nextConstruction(s: SimState): ConstructionKind | null {
  const c = s.civilization!
  const population = s.villagers.filter((v) => v.alive).length
  const goals: Array<[ConstructionKind, number]> = [
    ['well', 1],
    ['farm', c.era === 0 ? 4 : Math.min(36, 8 + Math.ceil(population / 4))],
    [
      'house',
      Math.max(
        c.era >= 2 ? 10 : c.era === 1 ? 5 : 2,
        Math.ceil((population + 12 - 20) / HOUSE_CAPACITY[c.era]),
      ),
    ],
  ]
  if (c.era >= 1)
    goals.push(
      ['granary', Math.max(1, Math.ceil(population / 35))],
      ['workshop', c.era >= 2 ? 3 : 1],
      ['quarry', c.era >= 3 ? 4 : 2],
      ['farmhouse', c.era >= 2 ? 3 : 1],
    )
  if (c.era >= 2)
    goals.push(['market', 2], ['school', c.era >= 3 ? 3 : 2], ['clinic', 2], ['park', c.era >= 4 ? 6 : 2])
  if (c.era >= 3)
    goals.push(
      ['powerplant', Math.max(2, Math.ceil((population / 8 + 8 + countCivic(s, 'quarry') * 2) / 12))],
      ['factory', 2],
    )
  if (c.era >= 4) goals.push(['skyscraper', Math.max(8, Math.ceil(population / 12))])
  if (c.priority === 'food')
    goals.sort(
      (a, b) =>
        Number(['farm', 'farmhouse', 'granary'].includes(b[0])) -
        Number(['farm', 'farmhouse', 'granary'].includes(a[0])),
    )
  if (c.priority === 'science') goals.sort((a, b) => Number(b[0] === 'school') - Number(a[0] === 'school'))
  if (c.priority === 'growth')
    goals.sort(
      (a, b) => Number(b[0] === 'house' || b[0] === 'market') - Number(a[0] === 'house' || a[0] === 'market'),
    )
  for (const [kind, target] of goals) if (countCivic(s, kind, true) < target) return kind
  return null
}
export function civilizationView(s: SimState) {
  if (!s.civilization) return null
  const c = s.civilization
  return {
    ...c,
    roads: undefined,
    requirements: eraRequirements(s),
    electricity: electricGrid(s),
    buildings: s.buildings.length,
    roadTiles: c.roads.filter(Boolean).length,
    population: s.villagers.filter((v) => v.alive).length,
    migration: migrationForecast(s),
    diagnostics: developmentDiagnostics(s),
    demographics: {
      children: s.villagers.filter((v) => v.alive && v.age < 18).length,
      adults: s.villagers.filter((v) => v.alive && v.age >= 18 && v.age < 65).length,
      elderly: s.villagers.filter((v) => v.alive && v.age >= 65).length,
      pregnant: s.villagers.filter((v) => v.alive && v.pregnancyDue !== null && v.pregnancyDue !== undefined)
        .length,
      births: s.births,
      deaths: s.deaths,
    },
    jobs: {
      research: s.villagers.filter((v) => v.alive && v.civicJob === 'research').length,
      industry: s.villagers.filter((v) => v.alive && v.civicJob === 'industry').length,
    },
    catalog: Object.entries(CIVIC_BUILDINGS).map(([kind, b]) => ({
      kind: kind as CivicKind,
      ...b,
      count: countCivic(s, kind as CivicKind),
    })),
  }
}
export type CivilizationView = NonNullable<ReturnType<typeof civilizationView>>

export function constructionCost(kind: ConstructionKind) {
  if (Object.hasOwn(CIVIC_BUILDINGS, kind)) return CIVIC_BUILDINGS[kind as CivicKind]
  return { ...BUILDINGS[kind as BuildingKind], era: 0, steel: 0 }
}
export function constructionName(kind: ConstructionKind) {
  return constructionCost(kind).name
}
