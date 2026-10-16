import { createRng, type Rng } from '../rng'
import { generateWorld } from '../world'
import { DAYS_PER_YEAR, ERAS, ERA_SUBTITLES, PLOT, POLICY, TICKS_PER_DAY } from './config'
import { createBlocks, gridSize, rebuildBlockBuildings } from './blocks'
import {
  dailyFoodNeed,
  distributePopulation,
  emptyLedger,
  eraRequirements,
  populationOf,
  powerDemand,
  powerSupply,
  recomputeCoverage,
  recomputeLandValue,
  recomputeLogistics,
  recomputePollution,
  recomputeStats,
  settleDay,
  type Requirement,
} from './economy'
import {
  advanceConstruction,
  foundFirstSettlement,
  milestone,
  runMonthCycle,
  runPlannerCycle,
  updateSettlementTotals,
} from './planner'
import type { Ledger, Overlay, PlotState, Policy, Settlement } from './types'

export interface PlotView {
  era: number
  eraName: string
  eraSubtitle: string
  tick: number
  day: number
  year: number
  paused: boolean
  speed: number
  seed: number
  population: number
  ledger: Ledger
  requirements: Requirement[]
  settlements: Settlement[]
  policy: Policy
  overlay: Overlay
  stats: PlotState['stats']
  history: PlotState['history']
  journal: PlotState['journal']
  foodDays: number
  storageDays: number
  power: { supply: number; demand: number; ratio: number }
  jobs: { total: number; staffed: number; spare: number }
  coverage: { market: number; school: number; clinic: number; park: number; water: number }
}

export function createPlotState(seed: number, size = 256): PlotState {
  const world = generateWorld(seed, size, true)
  const state: PlotState = {
    world,
    blocks: createBlocks(world),
    settlements: [],
    vRoad: new Uint8Array(gridSize(world) * gridSize(world)),
    hRoad: new Uint8Array(gridSize(world) * gridSize(world)),
    ledger: emptyLedger(),
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
    era: 0,
    tick: 0,
    rngState: seed >>> 0,
    policy: 'balanced',
    overlay: 'none',
    history: [],
    journal: [],
    milestones: [],
    nextSettlementId: 0,
  }
  return state
}

/** 地块级文明模拟：区块账本 + 道路边图 + 自动规划器 */
export class PlotSim {
  state: PlotState
  paused = true
  speed = 20
  blocked = false
  readonly tickRate = TICKS_PER_DAY
  private rng: Rng
  private accumulator = 0

  constructor(state: PlotState) {
    this.state = state
    this.rng = createRng(state.rngState)
  }

  /** 载入存档后重建派生字段与建筑描述符 */
  rebuildDerived(): void {
    PlotSim.refreshDerived(this.state, this.rng)
  }

  static create(seed: number, size = 256): PlotSim {
    const state = createPlotState(seed, size)
    const sim = new PlotSim(state)
    foundFirstSettlement(state, sim.rng)
    runPlannerCycle(state, sim.rng)
    recomputeStats(state)
    distributePopulation(state)
    milestone(state, 'founded', '部落在选定的河湾落脚，开始修筑道路')
    return sim
  }

  setPolicy(policy: Policy): void {
    this.state.policy = policy
  }

  setOverlay(overlay: Overlay): void {
    this.state.overlay = overlay
  }

  /** 与 Simulation 相同的推进契约：dt 秒 × 倍速，受每帧预算限制 */
  advance(dt: number, budgetMs: number): void {
    if (this.paused || this.blocked) {
      this.accumulator = 0
      return
    }
    this.accumulator += dt * this.speed * this.tickRate
    const budget = Math.max(0.5, budgetMs)
    const start = performance.now()
    let guard = 0
    while (this.accumulator >= 1 && performance.now() - start < budget && guard < 4000) {
      this.tick()
      this.accumulator -= 1
      guard++
    }
    if (this.accumulator > this.tickRate * 2) this.accumulator = this.tickRate * 2
  }

  tick(): void {
    const state = this.state
    state.tick++
    const day = Math.floor(state.tick / TICKS_PER_DAY)
    if (state.tick % PLOT.historyEveryTicks === 0) {
      state.history.push({
        tick: state.tick,
        pop: Math.round(populationOf(state)),
        food: Math.round(state.ledger.food),
        wood: Math.round(state.ledger.wood),
        stone: Math.round(state.ledger.stone),
      })
      if (state.history.length > PLOT.historyMax) state.history.splice(0, state.history.length - PLOT.historyMax)
    }
    if (state.tick % TICKS_PER_DAY !== 0) {
      state.rngState = this.rng.getState()
      return
    }
    advanceConstruction(state, this.rng)
    distributePopulation(state)
    recomputeStats(state)
    settleDay(state, this.rng)
    if (day % PLOT.planEveryDays === 0) runPlannerCycle(state, this.rng)
    if (day > 0 && day % PLOT.migrationEveryDays === 0) runMonthCycle(state, this.rng)
    this.recordMilestones()
    updateSettlementTotals(state)
    state.rngState = this.rng.getState()
  }

  private recordMilestones(): void {
    const state = this.state
    if (state.stats.builtResidential >= 1) milestone(state, 'first-house', '第一座住宅建成')
    if (state.stats.builtAgriculture >= 6) milestone(state, 'farm-six', '农田连片，农业聚落成形')
    if (state.stats.builtResidential >= 20) milestone(state, 'twenty-houses', '城镇规模扩大，住宅超过 20 个地块')
    if (state.stats.roadEdges >= 60) milestone(state, 'road-60', '路网成形：道路边超过 60')
    if (state.settlements.length >= 2) milestone(state, 'settlement-2', '第二个聚落建立，文明开始扩张')
    const pop = Math.round(populationOf(state))
    if (pop >= 1000) milestone(state, 'pop-1000', '人口突破 1000')
    if (pop >= 10000) milestone(state, 'pop-10000', '人口突破 1 万，现代都市规模')
  }

  view(): PlotView {
    const state = this.state
    const need = Math.max(1, dailyFoodNeed(state))
    const jobs = state.blocks.reduce((n, b) => n + b.jobs, 0)
    const staffed = state.blocks.reduce((n, b) => n + b.staffed, 0)
    const avg = (pick: (b: PlotState['blocks'][number]) => number): number => {
      const rows = state.blocks.filter((b) => b.zone === 'residential' && b.density > 0)
      if (rows.length === 0) return 0
      return rows.reduce((n, b) => n + pick(b), 0) / rows.length
    }
    const supply = powerSupply(state)
    const demand = powerDemand(state)
    return {
      era: state.era,
      eraName: ERAS[state.era],
      eraSubtitle: ERA_SUBTITLES[state.era],
      tick: state.tick,
      day: Math.floor(state.tick / TICKS_PER_DAY),
      year: Math.floor(Math.floor(state.tick / TICKS_PER_DAY) / DAYS_PER_YEAR) + 1,
      paused: this.paused,
      speed: this.speed,
      seed: state.world.seed,
      population: populationOf(state),
      ledger: state.ledger,
      requirements: eraRequirements(state),
      settlements: state.settlements,
      policy: state.policy,
      overlay: state.overlay,
      stats: state.stats,
      history: state.history,
      journal: state.journal,
      foodDays: state.ledger.food / need,
      storageDays: state.ledger.storageCapacity / need,
      power: { supply, demand, ratio: demand > 0 ? Math.min(1, supply / demand) : 1 },
      jobs: { total: jobs, staffed, spare: jobs - state.ledger.adults },
      coverage: {
        market: avg((b) => b.covered.market),
        school: avg((b) => b.covered.school),
        clinic: avg((b) => b.covered.clinic),
        park: avg((b) => b.covered.park),
        water: avg((b) => b.covered.water),
      },
    }
  }

  /** 政策滑杆的展示用文案 */
  policyName(): string {
    return POLICY[this.state.policy].name
  }

  /** 载入后重建派生字段（覆盖/地价/物流/污染/人口分布） */
  static refreshDerived(state: PlotState, rng: Rng): void {
    for (const b of state.blocks) rebuildBlockBuildings(b, rng)
    recomputeCoverage(state)
    recomputeLandValue(state)
    recomputeLogistics(state)
    recomputePollution(state)
    recomputeStats(state)
    distributePopulation(state)
    updateSettlementTotals(state)
  }
}
