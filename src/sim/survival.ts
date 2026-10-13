import type { SimState } from './types'

export type Profession = 'farmer' | 'builder' | 'gatherer'
export type BuildingKind = 'house' | 'granary' | 'farmhouse' | 'farm'
export const DAYS_PER_SEASON = 30
export const TICKS_PER_DAY = 60
export const YEAR_TICKS = 120 * TICKS_PER_DAY
export const WINTER_TICK = 90 * TICKS_PER_DAY
export const SEASONS = ['春', '夏', '秋', '冬'] as const
export const PROFESSION_LABEL = { farmer: '农夫', builder: '建筑工', gatherer: '采集者' }
export const BUILDINGS: Record<BuildingKind, { name: string; wood: number; stone: number; effect: string }> =
  {
    house: { name: '住房', wood: 30, stone: 15, effect: '人口容量 +4，休息更快' },
    granary: { name: '粮仓', wood: 45, stone: 20, effect: '储粮上限 +900' },
    farmhouse: { name: '农舍', wood: 40, stone: 10, effect: '农田采收 / 再生 +25%（最多 +75%）' },
    farm: { name: '农田', wood: 5, stone: 0, effect: '高产食物地块，需建筑工开垦' },
  }
export const EVENTS = [
  {
    id: 'refugees',
    at: 17 * TICKS_PER_DAY,
    title: '五名难民在村口',
    text: '他们能马上工作，也会马上吃饭。接纳需要空余住房和安置口粮。',
    choices: [
      { label: '接纳五人', detail: '食物 −90；成年劳动力 +5；需要 5 个空位', food: 90, wood: 0 },
      { label: '婉拒，保留口粮', detail: '人口和库存保持不变', food: 0, wood: 0 },
    ],
  },
  {
    id: 'merchant',
    at: 47 * TICKS_PER_DAY,
    title: '粮商经过村庄',
    text: '商人愿意用粮食换木材。现在交换，就会推迟粮仓或农舍建设；粮仓太小，换来的粮食会溢出。',
    choices: [
      { label: '用木材换粮', detail: '木材 −35；食物 +220（受储粮上限限制）', food: 0, wood: 35 },
      { label: '留下建材', detail: '保留木材，没有额外食物', food: 0, wood: 0 },
    ],
  },
  {
    id: 'harvest',
    at: 77 * TICKS_PER_DAY,
    title: '入冬前的最后一趟',
    text: '只能派出一支远行队。寻找口粮还是运回建材？冬季将减慢采收，增加食物消耗。',
    choices: [
      { label: '带粮返村', detail: '木材 −20（车具）；食物 +160（受上限限制）', food: 0, wood: 20 },
      { label: '搬运建材', detail: '食物 −60（远行口粮）；木材 +50，石头 +20', food: 60, wood: 0 },
      { label: '放弃远行', detail: '无消耗，也无额外收获；留在村里准备冬季', food: 0, wood: 0 },
    ],
  },
] as const
export type EventId = (typeof EVENTS)[number]['id']
export interface YearResult {
  won: boolean
  population: number
  starveDeaths: number
  ageDeaths: number
  minFood: number
  food: number
  assisted: boolean
  tick: number
  decisions: string[]
}
export interface CampaignState {
  farmers: number
  builders: number
  pendingEvent: EventId | null
  resolvedEvents: EventId[]
  decisions: string[]
  minFood: number
  assisted: boolean
  result: YearResult | null
  continued: boolean
}
export function createCampaign(): CampaignState {
  return {
    farmers: 10,
    builders: 2,
    pendingEvent: null,
    resolvedEvents: [],
    decisions: [],
    minFood: 140,
    assisted: false,
    result: null,
    continued: false,
  }
}
export function seasonAt(tick: number): number {
  return Math.floor(tick / (DAYS_PER_SEASON * TICKS_PER_DAY)) % 4
}
export function buildingCount(state: SimState, kind: Exclude<BuildingKind, 'farm'>): number {
  return state.buildings.filter((b) => (b.type ?? 'house') === kind).length
}
export function foodCapacity(state: SimState): number {
  return state.campaign ? 300 + 900 * buildingCount(state, 'granary') : Infinity
}
export function farmBonus(state: SimState): number {
  return 1 + Math.min(3, buildingCount(state, 'farmhouse')) * 0.25
}
export function workforce(state: SimState) {
  const adults = state.villagers.filter((v) => v.alive && v.age >= 12).length
  const farmers = Math.min(adults, state.campaign?.farmers ?? 0)
  const builders = Math.min(adults - farmers, state.campaign?.builders ?? 0)
  return { adults, farmers, builders, gatherers: adults - farmers - builders }
}
export function survivalView(state: SimState) {
  const c = state.campaign
  if (!c) return null
  const population = state.villagers.filter((v) => v.alive).length
  // 保守估计：只计已有储粮，不把未来采收或携带中的口粮算进去。
  const winterUsePerDay = ((population * 0.18 * 1.4) / 5) * TICKS_PER_DAY
  return {
    ...c,
    result: c.result ? { ...c.result } : null,
    season: seasonAt(state.tick),
    day: (Math.floor(state.tick / TICKS_PER_DAY) % 120) + 1,
    year: Math.floor(state.tick / YEAR_TICKS) + 1,
    winterIn: Math.max(0, Math.ceil((WINTER_TICK - (state.tick % YEAR_TICKS)) / TICKS_PER_DAY)),
    daysLeft: Math.ceil((YEAR_TICKS - (state.tick % YEAR_TICKS)) / TICKS_PER_DAY),
    coverDays: winterUsePerDay ? state.stock.food / winterUsePerDay : 0,
    reserveTarget: Math.ceil(winterUsePerDay * DAYS_PER_SEASON),
    foodCapacity: foodCapacity(state),
    workforce: workforce(state),
    houses: buildingCount(state, 'house'),
    granaries: buildingCount(state, 'granary'),
    farmhouses: buildingCount(state, 'farmhouse'),
    farms: state.world.tiles.filter((t) => t.terrain === 4).length,
    sites: state.sites.map((s) => ({ ...s })),
    stock: { ...state.stock },
  }
}
export type SurvivalView = NonNullable<ReturnType<typeof survivalView>>
