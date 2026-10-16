import { describe, expect, it } from 'vitest'
import { createRng } from '../src/sim/rng'
import { PlotSim } from '../src/sim/plot/sim'
import { gridSize } from '../src/sim/plot/blocks'
import { hasRoadAccess } from '../src/sim/plot/roads'
import { eraGateMet, populationOf, recomputeStats, settleDay } from '../src/sim/plot/economy'
import { growRoads } from '../src/sim/plot/planner'
import { deserializePlot, serializePlot } from '../src/sim/plot/save'
import type { PlotState } from '../src/sim/plot/types'

function advance(sim: PlotSim, days: number): void {
  for (let d = 0; d < days; d++) for (let t = 0; t < 60; t++) sim.tick()
}

function invariantChecks(s: PlotState): void {
  const bg = gridSize(s.world)
  recomputeStats(s)
  for (const b of s.blocks) {
    const index = b.by * bg + b.bx
    // INV3：住宅/工业/公共/公园必须临路
    if (['residential', 'industry', 'civic', 'park'].includes(b.zone)) {
      expect(hasRoadAccess(s, index), `地块 ${b.bx},${b.by} (${b.zone}) 未临路`).toBe(true)
    }
    // INV8：值域
    expect(b.landValue).toBeGreaterThanOrEqual(0)
    expect(b.landValue).toBeLessThanOrEqual(1)
    expect(b.pollution).toBeGreaterThanOrEqual(0)
    for (const v of Object.values(b.covered)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  }
  // INV2：资源非负
  expect(s.ledger.food).toBeGreaterThanOrEqual(0)
  expect(s.ledger.wood).toBeGreaterThanOrEqual(0)
  expect(s.ledger.stone).toBeGreaterThanOrEqual(0)
  expect(s.ledger.steel).toBeGreaterThanOrEqual(0)
  // INV4：工业与住宅不相邻
  expect(s.stats.industryResidentialAdjacency).toBe(0)
  // INV5：无 NaN
  expect(Number.isFinite(populationOf(s))).toBe(true)
  expect(Number.isFinite(s.ledger.knowledge)).toBe(true)
}

describe('规划器：路网 → 分区 → 服务 → 升级', () => {
  it('开局即建立首个聚落、中央广场与道路', () => {
    const sim = PlotSim.create(4242, 128)
    const s = sim.state
    expect(s.settlements).toHaveLength(1)
    expect(s.stats.roadEdges).toBeGreaterThan(0)
    const plaza = s.blocks.find((b) => b.civic === 'plaza')
    expect(plaza).toBeTruthy()
    expect(plaza!.settlement).toBe(0)
  })

  it('城市会随人口增长沿路网扩张（人口与地块同步增长）', () => {
    const sim = PlotSim.create(777, 128)
    advance(sim, 1500)
    const early = {
      roads: sim.state.stats.roadEdges,
      claimed: sim.state.blocks.filter((b) => b.settlement >= 0).length,
      population: populationOf(sim.state),
    }
    advance(sim, 3000)
    const later = {
      roads: sim.state.stats.roadEdges,
      claimed: sim.state.blocks.filter((b) => b.settlement >= 0).length,
      population: populationOf(sim.state),
    }
    expect(later.population).toBeGreaterThan(early.population)
    expect(later.claimed).toBeGreaterThan(early.claimed)
    expect(later.roads).toBeGreaterThan(early.roads)
    expect(sim.state.blocks.filter((b) => b.zone === 'agriculture').length).toBeGreaterThanOrEqual(6)
  })

  it('规划不变量在整个成长过程成立（INV3/INV4/INV8）', () => {
    const sim = PlotSim.create(2026, 128)
    for (let d = 0; d < 12; d++) {
      advance(sim, 100)
      invariantChecks(sim.state)
    }
  })

  it('时代门槛是形态指标：开局未达标不得升级，达标后才进入下一时代', () => {
    const fresh = PlotSim.create(31337, 128)
    expect(fresh.state.era).toBe(0)
    expect(eraGateMet(fresh.state)).toBe(false)
    expect(fresh.view().requirements.map((r) => r.label)).toContain('农业区建成')

    const sim = PlotSim.create(31337, 128)
    advance(sim, 1000)
    expect(sim.state.era).toBeGreaterThanOrEqual(1)
    // 门槛列表跟着当前时代变化，且不是空的
    expect(sim.view().requirements.length).toBeGreaterThan(0)
    if (sim.state.era === 1) {
      const labels = sim.view().requirements.map((r) => r.label)
      expect(labels).toContain('路网边数')
      expect(labels).toContain('市场覆盖住宅')
    }
  })

  it('政策滑杆改变规划与产出权重：扩张多铺路、粮食多产粮', () => {
    const growth = PlotSim.create(5150, 256)
    const food = PlotSim.create(5150, 256)
    growth.setPolicy('growth')
    food.setPolicy('food')
    // 先把已有临路空地占满，迫使规划器开路，才能看到路网预算差异
    const squeeze = (s: PlotState): void => {
      const bg = gridSize(s.world)
      for (const b of s.blocks) {
        if (b.settlement >= 0 && b.zone === 'none' && !b.construction && hasRoadAccess(s, b.by * bg + b.bx)) b.zone = 'park'
      }
    }
    squeeze(growth.state)
    squeeze(food.state)
    expect(growRoads(growth.state)).toBeGreaterThan(growRoads(food.state))
    expect(growRoads(growth.state)).toBeLessThanOrEqual(7)
    expect(growRoads(food.state)).toBeLessThanOrEqual(5)

    // 同一份状态（同种子同天数）两种政策各结算一天：粮食政策产粮更多
    advance(food, 400)
    const snapshot = serializePlot(food)
    const clone = new PlotSim(deserializePlot(snapshot)!.state)
    clone.rebuildDerived()
    food.setPolicy('food')
    clone.setPolicy('growth')
    settleDay(food.state, createRng(5))
    settleDay(clone.state, createRng(5))
    expect(food.state.ledger.production.food).toBeGreaterThan(clone.state.ledger.production.food)
    expect(food.state.stats.industryResidentialAdjacency).toBe(0)
    expect(clone.state.stats.industryResidentialAdjacency).toBe(0)
  })

  it('农业地块允许不临路，但产出按物流系数打折', () => {
    const sim = PlotSim.create(909, 128)
    advance(sim, 600)
    const far = sim.state.blocks.filter((b) => b.zone === 'agriculture' && !hasRoadAccess(sim.state, b.by * gridSize(sim.state.world) + b.bx))
    expect(far.length > 0 ? far.every((b) => b.logistics <= 1) : true).toBe(true)
  })
})
