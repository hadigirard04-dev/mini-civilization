import { housingCapacityOf } from './blocks'
import { PLOT, POLICY } from './config'
import { dailyFoodNeed, farmDailyOutput, jobDemandOf, populationOf, workshopCount } from './economy'
import type { Block, PlotState } from './types'

export function plannedHousingOf(b: Block): number {
  if (b.zone !== 'residential') return 0
  const level = b.construction?.kind === 'upgrade' ? Math.min(4, b.density + 1) : Math.max(1, b.density)
  return PLOT.housingCapacity[level]
}

/** 已排队的建设也消耗未来需求；每落一个项目都重新读这份账。 */
export function developmentDemand(state: PlotState) {
  const pop = populationOf(state)
  const workshops = workshopCount(state)
  let housing = 0
  let farms = 0
  let foodCapacity = 0
  let parks = 0
  let jobs = 0
  const local = new Map(state.settlements.map((s) => [s.id, { homes: 0, farms: 0 }]))
  for (const b of state.blocks) {
    housing += plannedHousingOf(b)
    jobs += jobDemandOf(state, b)
    const settlement = local.get(b.settlement)
    if (b.zone === 'residential') {
      if (settlement) settlement.homes++
      if (b.density === 0) jobs += PLOT.residentialJobsPerLevel
    }
    if (b.zone === 'agriculture') {
      farms++
      foodCapacity += farmDailyOutput(state, b, workshops)
      if (settlement) settlement.farms++
    }
    if (b.zone === 'park' || b.civic === 'park' || b.construction?.kind === 'civic:park') parks++
    if (b.zone === 'industry' && b.density === 0) jobs += b.industry === 'quarry' ? 5 : 8
  }
  const foodTarget = dailyFoodNeed(state) * (state.policy === 'food' ? 1.5 : 1.2)
  return {
    housing,
    housingGap: Math.max(0, pop * (1 + PLOT.housingBufferRatio) + PLOT.housingBufferMin - housing),
    farms,
    foodCapacity,
    foodGap: Math.max(0, foodTarget - foodCapacity),
    jobsGap: Math.max(0, state.ledger.adults * 1.1 - jobs),
    parkGap: Math.max(0, Math.ceil(Math.max(1, pop / 300) * POLICY[state.policy].park) - parks),
    local,
  }
}

export interface DevelopmentView {
  title: string
  reason: string
  recommendation: PlotState['policy'] | null
  construction: number
  nextPlanDays: number
  vacantHousing: number
  pendingHousing: number
  unemployed: number
  foodBalance: number
}

/** 将当前约束翻译成玩家能观察和处理的反馈，不另存第二套模拟状态。 */
export function developmentView(state: PlotState): DevelopmentView {
  const need = dailyFoodNeed(state)
  const demand = developmentDemand(state)
  const builtHousing = state.blocks.reduce((n, b) => n + housingCapacityOf(b), 0)
  const construction = state.blocks.filter((b) => b.construction !== null).length
  const foodBalance = state.ledger.production.food - need
  const defaults = {
    construction,
    nextPlanDays: PLOT.planEveryDays - Math.floor(state.tick / 60) % PLOT.planEveryDays,
    vacantHousing: Math.max(0, builtHousing - populationOf(state)),
    pendingHousing: Math.max(0, demand.housing - builtHousing),
    unemployed: Math.max(0, state.ledger.adults - state.blocks.reduce((n, b) => n + b.staffed, 0)),
    foodBalance,
  }
  const result = (title: string, reason: string, recommendation: PlotState['policy'] | null): DevelopmentView =>
    ({ ...defaults, title, reason, recommendation })
  if (state.tick < 60 * 5) return result('先安家，再发展', '住宅与农田正在起步；每 5 天按需求规划，已排队的住房也会计入。', null)
  if (state.ledger.food < need * 10 || foodBalance < -need * 0.1) {
    return result('粮食承压', `每日净粮 ${foodBalance >= 0 ? '+' : ''}${foodBalance.toFixed(1)}，现有储粮约 ${(state.ledger.food / Math.max(1, need)).toFixed(0)} 天。粮食政策会提高产出与储备目标。`, 'food')
  }
  const young = state.settlements.find((s) => s.id > 0 && (demand.local.get(s.id)?.homes ?? 0) < 2)
  if (young) return result(`${young.name}正在起步`, '新聚落会优先取得自己的住宅与农田；全球住房富余也不会让它停止发育。', 'growth')
  if (demand.housingGap > 0) return result('住房需要扩充', `已有与在建住房合计 ${demand.housing} 人容量，还需约 ${Math.ceil(demand.housingGap)} 个居住名额。`, 'growth')
  if (state.era === 1 && state.stats.roadEdges < 60) return result('连起城镇骨架', `下一时代需要 60 条道路边，目前 ${state.stats.roadEdges} 条；扩张政策会加快这一轮路网建设。`, 'growth')
  if (state.era >= 2 && state.stats.powerCoverage < 0.9) {
    return result('供电不足', '覆盖采用当天实际发电量；缺燃料或缺工会影响供电，继续增加装机容量未必有效。', 'balanced')
  }
  const homes = state.blocks.filter((b) => b.zone === 'residential' && b.density > 0)
  const lowService = homes.some((b) => b.covered.market < 0.5 || b.covered.park < 0.5)
  if (state.era >= 1 && lowService) return result('服务跟上城区', '市场优先填补未覆盖住宅，公园落成会提高附近地价；宜居政策更重视这些设施。', 'livable')
  if (state.era < 3 && state.ledger.knowledge < 800) return result('积累知识', '有粮后释放的劳动力可以进入学校；研究政策提高学校优先级和知识产出。', 'science')
  if (state.era === 3 && state.settlements.filter((s) => s.links.length > 0).length < 2) {
    return result('连通聚落', '城际道路独立按预算修筑；缺木石时会等待材料，跨水段需要更贵的桥梁。', 'growth')
  }
  if (state.era === 3 && state.stats.highValueBlocks < 16) {
    const needsHomes = state.stats.builtResidential < 16
    return result(needsHomes ? '培育城区规模' : '提升居住品质', `现代都市需要 16 个高地价住宅，当前 ${state.stats.highValueBlocks} 个。${needsHomes ? '人口与住房需求增长后会扩建城区，不会为凑门槛铺空城。' : '宜居政策优先补公园和诊所，改善附近住宅的地价。'}`, needsHomes ? 'growth' : 'livable')
  }
  if (construction > 0) return result('建设进行中', `当前 ${construction} 项工程；规划器会等待相应需求落成，避免重复建设。`, null)
  return result('按需成长', '需求已基本满足时会放缓建设。人口、就业与覆盖发生变化后，再安排下一轮发展。', null)
}
