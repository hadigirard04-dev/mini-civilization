import { findPath } from './path'
import { createRng, type Rng } from './rng'
import type { SimState, Villager } from './types'
import {
  FOREST,
  GRASS,
  STONE,
  generateWorld,
  isWalkable,
  resourceType,
  type ResourceType,
  type World,
} from './world'

/** 模拟参数（一处集中，便于调平衡） */
export const PARAMS = {
  initialPop: 20,
  baseCapacity: 20,
  capacityPerHouse: 4,
  houseWood: 30,
  houseStone: 15,
  eatThreshold: 35,
  eatHunger: 5,
  restThreshold: 25,
  restUntil: 96,
  hungerDecay: 0.18,
  staminaMove: 0.03,
  restRate: 0.55,
  restRateHouse: 1.2,
  deathStarve: 90,
  workAge: 12,
  ageTicks: 250,
  moveSpeed: 0.18,
  gatherInterval: 2,
  buildPerTick: 0.008,
  staminaWork: 0.05,
  regenFood: 0.05,
  regenWood: 0.012,
  birthEvery: 600,
  birthFoodNeed: 120,
  historyEvery: 20,
  historyMax: 900,
} as const

const CARRY_CAP: Record<ResourceType, number> = { food: 16, wood: 10, stone: 10 }

const SURNAMES = ['林', '陈', '赵', '周', '吴', '郑', '王', '李', '张', '刘', '黄', '杨', '徐', '孙', '马', '朱', '胡', '郭', '何', '高']
const GIVENS = ['山', '禾', '雨', '石', '川', '木', '春', '安', '宁', '远', '舟', '岩', '桑', '野', '星', '麦', '竹', '岚', '青', '小满', '石头', '远山', '望', '临']

function makeName(rng: Rng): string {
  return rng.pick(SURNAMES) + rng.pick(GIVENS)
}

function makeVillager(id: number, cx: number, cy: number, rng: Rng, world: World): Villager {
  let x = cx
  let y = cy
  let placed = false
  for (let tries = 0; tries < 40 && !placed; tries++) {
    const gx = Math.floor(cx + rng.range(-6, 7))
    const gy = Math.floor(cy + rng.range(-6, 7))
    if (gx >= 0 && gy >= 0 && gx < world.size && gy < world.size && isWalkable(world, gx, gy)) {
      x = gx + 0.5
      y = gy + 0.5
      placed = true
    }
  }
  if (!placed) {
    x = Math.floor(cx) + 0.5
    y = Math.floor(cy) + 0.5
  }
  return {
    id,
    name: makeName(rng),
    x,
    y,
    hunger: rng.range(70, 100),
    stamina: rng.range(85, 100),
    age: Math.floor(rng.range(18, 43)),
    maxAge: rng.range(58, 76),
    task: 'idle',
    path: [],
    pathGoal: null,
    gatherTile: null,
    carry: 0,
    carryType: null,
    alive: true,
    deadTick: null,
    work: 0,
    cool: 0,
    hue: rng.range(0, 360),
    facing: rng.next() < 0.5 ? 1 : -1,
    movePhase: rng.range(0, 100),
    starve: 0,
    eatAnim: -1,
    sleepInPlace: false,
    failedTiles: [],
  }
}

function createInitialState(seed: number, rng: Rng): SimState {
  const world = generateWorld(seed)
  const cx = world.size / 2
  const cy = world.size / 2
  const villagers: Villager[] = []
  for (let i = 0; i < PARAMS.initialPop; i++) {
    villagers.push(makeVillager(i + 1, cx, cy, rng, world))
  }
  return {
    tick: 0,
    world,
    villagers,
    sites: [],
    buildings: [],
    stock: { food: 40, wood: 8, stone: 4 },
    consumed: { food: 0, wood: 0, stone: 0 },
    history: [],
    births: 0,
    deaths: 0,
    starveDeaths: 0,
    ageDeaths: 0,
    journal: [],
    milestones: [],
    walk: new Array<number>(world.size * world.size).fill(0),
    nextEventAt: 1500,
    nextId: PARAMS.initialPop + 1,
    rngState: rng.getState(),
  }
}

/**
 * 模拟核心：tick 驱动，纯数据、不依赖 DOM。
 * advance(dt) 按倍速累积推进，暂停时完全不推进状态。
 */
export class Simulation {
  state: SimState
  paused = false
  speed = 1
  readonly tickRate = 10
  private acc = 0
  private rng: Rng

  constructor(seedOrState: number | SimState) {
    if (typeof seedOrState === 'number') {
      this.rng = createRng(seedOrState ^ 0x5bf03635)
      this.state = createInitialState(seedOrState, this.rng)
    } else {
      this.state = seedOrState
      // 旧存档缺省字段回填（向前兼容）
      const n = seedOrState.world.size * seedOrState.world.size
      if (!this.state.journal) this.state.journal = []
      if (!this.state.milestones) this.state.milestones = []
      if (!this.state.walk || this.state.walk.length !== n) this.state.walk = new Array<number>(n).fill(0)
      if (!this.state.nextEventAt) this.state.nextEventAt = seedOrState.tick + 1500
      this.rng = createRng(0)
      this.rng.setState(seedOrState.rngState)
    }
    this.state.rngState = this.rng.getState()
  }

  /** 按真实时间推进（内部换算成 tick），暂停时不动 */
  advance(dtSeconds: number): void {
    if (this.paused) return
    this.acc += dtSeconds * this.speed
    const step = 1 / this.tickRate
    let guard = 0
    while (this.acc >= step) {
      this.acc -= step
      this.tick()
      if (++guard >= 1000) {
        this.acc = 0
        break
      }
    }
  }

  /** 推进一个模拟 tick */
  tick(): void {
    const s = this.state
    s.tick++
    const rng = this.rng

    for (const v of s.villagers) {
      if (!v.alive) continue
      v.age += 1 / PARAMS.ageTicks
      v.hunger = Math.max(0, v.hunger - PARAMS.hungerDecay)

      // 涓涓流进食：只在越过个人阈值时吃 1 口（自动节流），不打断任务、不丢路径。
      // 库存低于地板（6）时排队让位给采集回款；濒死（hunger<15）才破例。
      if (v.hunger < this.eatTrigger(v) && this.canEat(v)) {
        const take = Math.min(1, s.stock.food)
        s.stock.food -= take
        s.consumed.food += take
        v.hunger = Math.min(100, v.hunger + PARAMS.eatHunger * take)
        v.eatAnim = s.tick
      }

      // 死因一：长期饥饿
      if (v.hunger <= 0) {
        v.starve++
        if (v.starve >= PARAMS.deathStarve) {
          this.kill(v, 'starve')
          continue
        }
      } else {
        v.starve = 0
      }

      // 死因二：年老自然衰亡
      if (v.age >= v.maxAge && rng.next() < 1 / 400) {
        this.kill(v, 'age')
        continue
      }

      this.act(v)
    }

    // 清理超时尸体（非正常标记的死亡体保留）
    let hasStale = false
    for (const v of s.villagers) {
      if (!v.alive && v.deadTick !== null && s.tick - v.deadTick > 200) {
        hasStale = true
        break
      }
    }
    if (hasStale) {
      s.villagers = s.villagers.filter((v) => v.alive || v.deadTick === null || s.tick - v.deadTick <= 200)
    }

    // 建设、再生、出生（阶段 C 经济闭环）
    this.maybeCreateSite()
    this.regen()
    this.maybeBirth()

    // 纪事：里程碑检查（每 100 tick）与随机事件调度
    if (s.tick % 100 === 0) this.checkMilestones()
    if (s.tick >= s.nextEventAt) {
      this.triggerEvent()
      s.nextEventAt = s.tick + 600 + Math.floor(this.rng.next() * 900)
    }

    // 历史采样（供统计曲线）
    if (s.tick % PARAMS.historyEvery === 0) {
      let pop = 0
      for (const v of s.villagers) if (v.alive) pop++
      s.history.push({
        tick: s.tick,
        pop,
        food: s.stock.food,
        wood: s.stock.wood,
        stone: s.stock.stone,
      })
      if (s.history.length > PARAMS.historyMax) s.history.splice(0, s.history.length - PARAMS.historyMax)
    }

    s.rngState = rng.getState()
  }

  private kill(v: Villager, reason: 'starve' | 'age'): void {
    if (!v.alive) return
    v.alive = false
    v.task = 'idle'
    v.path = []
    v.pathGoal = null
    v.deadTick = this.state.tick
    this.state.deaths++
    if (reason === 'starve') this.state.starveDeaths = (this.state.starveDeaths ?? 0) + 1
    else this.state.ageDeaths = (this.state.ageDeaths ?? 0) + 1
    const site = this.state.sites.find((x) => x.builderId === v.id)
    if (site) site.builderId = null
  }

  /** 是否允许开吃：库存低于地板（6）时排队者先去干活，濒死（hunger<15）才破例 */
  private canEat(v: Villager): boolean {
    const floor = v.hunger < 15 ? 1 : 6
    return this.state.stock.food >= floor
  }

  /** 个体进食阈值：30~60 宽带错峰，避免全班同时补课击穿库存 */
  private eatTrigger(v: Villager): number {
    return PARAMS.eatThreshold - 5 + (v.id % 7) * 5
  }

  /** 行动分发：移动优先，到达后按任务继续（进食已在 tick 层涓涓流处理） */
  private act(v: Villager): void {
    if (v.path.length > 0) {
      this.stepPath(v)
      return
    }
    switch (v.task) {
      case 'eat':
        // 旧存档残留任务：进食已全局化，降级为空闲
        v.task = 'idle'
        break
      case 'rest':
        this.actRest(v)
        break
      case 'gather':
        this.actGather(v)
        break
      case 'deposit':
        this.actDeposit(v)
        break
      case 'build':
        this.actBuild(v)
        break
      case 'wander':
        v.task = 'idle'
        break
      case 'idle':
        if (v.cool > 0) {
          v.cool--
          return
        }
        this.chooseTask(v)
        break
    }
  }

  private stepPath(v: Villager): void {
    const w = v.path[0]
    const tx = w.x + 0.5
    const ty = w.y + 0.5
    const dx = tx - v.x
    const dy = ty - v.y
    const d = Math.hypot(dx, dy)
    const speed = PARAMS.moveSpeed * (v.stamina <= 0 ? 0.45 : 1)
    if (d <= speed) {
      v.x = tx
      v.y = ty
      v.path.shift()
      if (v.path.length === 0) v.pathGoal = null
    } else {
      v.x += (dx / d) * speed
      v.y += (dy / d) * speed
      if (dx !== 0) v.facing = dx > 0 ? 1 : -1
    }
    v.movePhase += speed * 16
    v.stamina = Math.max(0, v.stamina - PARAMS.staminaMove)

    // 足迹：走过的格子累积踩踏，密集处渲染为土路
    const world = this.state.world
    const wi = Math.floor(v.y) * world.size + Math.floor(v.x)
    if (wi >= 0 && wi < this.state.walk.length) this.state.walk[wi]++
  }

  /** 写入纪事（最新在前，容量 60） */
  private log(kind: 'milestone' | 'event', text: string): void {
    const s = this.state
    s.journal.unshift({ tick: s.tick, kind, text })
    if (s.journal.length > 60) s.journal.length = 60
  }

  /** 里程碑检查：一次性达成即记录 */
  private checkMilestones(): void {
    const s = this.state
    const alive = this.aliveCount()
    const checks: Array<[string, boolean, string]> = [
      ['first_house', s.buildings.length >= 1, '第一座房屋落成，村庄有了家'],
      ['pop30', alive >= 30, '人口达到 30'],
      ['pop50', alive >= 50, '人口达到 50'],
      ['day100', s.tick >= 5940, '村庄安然度过第 100 天'],
      ['houses5', s.buildings.length >= 5, '住房增至 5 座'],
      ['births10', s.births >= 10, '累计出生达 10 人'],
    ]
    for (const [id, ok, text] of checks) {
      if (ok && !s.milestones.includes(id)) {
        s.milestones.push(id)
        this.log('milestone', text)
      }
    }
  }

  /** 随机事件：库存一次性效果 + 纪事（绝不让资源为负） */
  private triggerEvent(): void {
    const s = this.state
    const roll = this.rng.nextInt(6)
    switch (roll) {
      case 0: {
        const gain = Math.round(Math.max(30, s.stock.food * 0.3))
        s.stock.food += gain
        this.log('event', `风调雨顺，粮食丰收（食物 +${gain}）`)
        break
      }
      case 1: {
        const loss = Math.round(s.stock.food * 0.25)
        s.stock.food -= loss
        this.log('event', `蝗虫过境，啃食了存粮（食物 −${loss}）`)
        break
      }
      case 2:
        s.stock.food += 50
        this.log('event', '狩猎队满载而归（食物 +50）')
        break
      case 3:
        s.stock.stone += 30
        this.log('event', '有人探到新石脉（石头 +30）')
        break
      case 4: {
        const alive = this.aliveCount()
        if (alive < 60) {
          const p = makeVillager(s.nextId++, s.world.size / 2, s.world.size / 2, this.rng, s.world)
          s.villagers.push(p)
          this.log('event', `旅人${p.name}路过村庄，留了下来`)
        } else {
          s.stock.wood += 40
          this.log('event', '过路商人留下了赠礼（木材 +40）')
        }
        break
      }
      default: {
        const gain = 40
        s.stock.food += gain
        this.log('event', `雨后浆果格外饱满（食物 +${gain}）`)
        break
      }
    }
  }

  /** 按需求优先级选择任务（进食不占用任务槽，走 tick 层涓涓流） */
  private chooseTask(v: Villager): void {
    const s = this.state
    v.work = 0
    v.pathGoal = null

    // 幼儿：休息、玩耍（进食由涓涓流覆盖）
    if (v.age < PARAMS.workAge) {
      if (v.stamina < 30) {
        v.task = 'rest'
        v.sleepInPlace = false
        return
      }
      v.task = 'wander'
      v.cool = 25
      this.startWander(v)
      return
    }

    // 1) 累了休息（有房睡房）
    if (v.stamina < PARAMS.restThreshold) {
      v.task = 'rest'
      v.sleepInPlace = false
      return
    }
    // 2) 手上有货先交库
    if (v.carry > 0.05 && v.carryType) {
      v.task = 'deposit'
      return
    }
    // 3) 工地缺人去建设（无工地则采集）
    const site = s.sites.find((x) => x.builderId === null || x.builderId === v.id)
    if (site) {
      site.builderId = v.id
      v.task = 'build'
      return
    }
    // 4) 按村庄短缺采集
    v.task = 'gather'
    v.gatherTile = null
  }

  /** 当前村庄最短缺的资源 */
  private neededResource(): ResourceType {
    const st = this.state.stock
    if (st.food < 20) return 'food'
    if (st.wood < PARAMS.houseWood) return 'wood'
    if (st.stone < PARAMS.houseStone) return 'stone'
    if (st.food < 150) return 'food'
    // 全部充裕：主要囤粮，少量存料（各有上限，不浪费人力）
    const r = this.rng.next()
    if (r < 0.7) return 'food'
    if (r < 0.87) return st.wood < 120 ? 'wood' : 'food'
    return st.stone < 80 ? 'stone' : 'food'
  }

  private findResourceTile(type: ResourceType, v: Villager): number | null {
    const w = this.state.world
    const terrain = type === 'food' ? GRASS : type === 'wood' ? FOREST : STONE
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < w.tiles.length; i++) {
      const t = w.tiles[i]
      if (t.terrain !== terrain || t.resource < 1) continue
      if (v.failedTiles.includes(i)) continue
      const x = i % w.size
      const y = (i / w.size) | 0
      const dx = x + 0.5 - v.x
      const dy = y + 0.5 - v.y
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best >= 0 ? best : null
  }

  private actGather(v: Villager): void {
    const s = this.state
    const w = s.world

    if (v.gatherTile === null) {
      const type: ResourceType = v.carry > 0.05 && v.carryType ? v.carryType : this.neededResource()
      const tile = this.findResourceTile(type, v)
      if (tile === null) {
        v.task = 'idle'
        v.cool = 40
        return
      }
      v.gatherTile = tile
    }

    const g = v.gatherTile
    const gx = g % w.size
    const gy = (g / w.size) | 0
    const tile = w.tiles[g]
    const rt = resourceType(tile.terrain)!

    // 格子采空或类型不符：手上有货先交库，否则换目标
    if (tile.resource < 1 || (v.carry > 0.05 && v.carryType !== rt)) {
      if (v.carry > 0.05 && v.carryType) {
        v.task = 'deposit'
      } else {
        v.gatherTile = null
      }
      return
    }

    // 不在目标格上：走过去
    if (Math.floor(v.x) !== gx || Math.floor(v.y) !== gy) {
      if (!v.pathGoal || v.pathGoal.x !== gx || v.pathGoal.y !== gy) {
        if (v.work % 15 === 0) {
          const path = findPath(w, v.x, v.y, gx, gy)
          if (path && path.length > 0) {
            v.path = path
            v.pathGoal = { x: gx, y: gy }
          } else {
            // 死路：记入黑名单换一块
            v.failedTiles.push(g)
            if (v.failedTiles.length > 8) v.failedTiles.shift()
            v.gatherTile = null
            v.work = 0
            return
          }
        }
        v.work++
      }
      return
    }

    // 站在目标格上：周期采集
    v.work++
    if (v.work % PARAMS.gatherInterval === 0) {
      const cap = CARRY_CAP[rt]
      if (v.carry >= cap) {
        v.task = 'deposit'
        return
      }
      const take = Math.min(1, tile.resource, cap - v.carry)
      tile.resource -= take
      v.carry += take
      v.carryType = rt
    }
  }

  private actDeposit(v: Villager): void {
    const s = this.state
    const w = s.world
    const cx = w.size / 2
    const cy = w.size / 2

    if (Math.hypot(v.x - cx, v.y - cy) <= 1.7) {
      if (v.carry > 0.05 && v.carryType) {
        s.stock[v.carryType] += v.carry
        v.carry = 0
        v.carryType = null
        v.failedTiles.length = 0
      }
      v.task = 'idle'
      v.work = 0
      v.pathGoal = null
      return
    }

    const gx = Math.floor(cx) - 1
    const gy = Math.floor(cy) - 1
    if (!v.pathGoal || v.pathGoal.x !== gx || v.pathGoal.y !== gy) {
      if (v.work % 15 === 0) {
        const path = findPath(w, v.x, v.y, gx, gy)
        if (path && path.length > 0) {
          v.path = path
          v.pathGoal = { x: gx, y: gy }
        } else {
          // 回不了村中心（孤岛）：原地入库，经济不被卡死
          if (v.carry > 0.05 && v.carryType) {
            s.stock[v.carryType] += v.carry
            v.carry = 0
            v.carryType = null
          }
          v.task = 'idle'
          v.work = 0
        }
      }
      v.work++
    }
  }

  private actRest(v: Villager): void {
    const s = this.state
    if (v.stamina >= PARAMS.restUntil) {
      v.task = 'idle'
      v.work = 0
      v.pathGoal = null
      return
    }

    const house = v.sleepInPlace ? null : this.nearestBuilding(v)
    if (house) {
      const hx = house.x + 0.5
      const hy = house.y + 0.5
      const d = Math.hypot(v.x - hx, v.y - hy)
      if (d > 0.9) {
        if (!v.pathGoal && v.work % 15 === 0) {
          const path = findPath(s.world, v.x, v.y, house.x, house.y)
          if (path && path.length > 0) {
            v.path = path
            v.pathGoal = { x: house.x, y: house.y }
          } else {
            v.sleepInPlace = true
          }
        }
        v.work++
        return
      }
      v.stamina += PARAMS.restRateHouse
    } else {
      v.stamina += PARAMS.restRate
    }
    v.stamina = Math.min(100, v.stamina)
  }

  private nearestBuilding(v: Villager): { x: number; y: number } | null {
    const buildings = this.state.buildings
    if (buildings.length === 0) return null
    let best: { x: number; y: number } | null = null
    let bestD = Infinity
    for (const b of buildings) {
      const d = Math.abs(b.x + 0.5 - v.x) + Math.abs(b.y + 0.5 - v.y)
      if (d < bestD) {
        bestD = d
        best = b
      }
    }
    return best
  }

  private startWander(v: Villager): void {
    const w = this.state.world
    for (let tries = 0; tries < 6; tries++) {
      const gx = Math.floor(v.x + this.rng.range(-3, 4))
      const gy = Math.floor(v.y + this.rng.range(-3, 4))
      if (gx < 0 || gy < 0 || gx >= w.size || gy >= w.size) continue
      if (!isWalkable(w, gx, gy)) continue
      if (gx === Math.floor(v.x) && gy === Math.floor(v.y)) continue
      const path = findPath(w, v.x, v.y, gx, gy)
      if (path && path.length > 0) {
        v.path = path
        v.pathGoal = { x: gx, y: gy }
        return
      }
    }
  }

  /** 村庄人口容量 = 基础 20 + 每座住房 4 */
  get capacity(): number {
    return PARAMS.baseCapacity + PARAMS.capacityPerHouse * this.state.buildings.length
  }

  private aliveCount(): number {
    let n = 0
    for (const v of this.state.villagers) if (v.alive) n++
    return n
  }

  /** 材料充足且规划住房不足时，自动落位一处工地（真实扣料） */
  private maybeCreateSite(): void {
    const s = this.state
    const alive = this.aliveCount()
    const desired = Math.max(0, Math.ceil((alive + 1 - PARAMS.baseCapacity) / PARAMS.capacityPerHouse))
    if (s.sites.length + s.buildings.length >= desired) return
    if (s.stock.wood < PARAMS.houseWood || s.stock.stone < PARAMS.houseStone) return
    const spot = this.findBuildSpot()
    if (!spot) return
    s.stock.wood -= PARAMS.houseWood
    s.stock.stone -= PARAMS.houseStone
    s.consumed.wood += PARAMS.houseWood
    s.consumed.stone += PARAMS.houseStone
    s.sites.push({ id: s.nextId++, x: spot.x, y: spot.y, progress: 0, builderId: null })
  }

  /** 由内向外环搜一块未被占用的草地（中央广场保留不建） */
  private findBuildSpot(): { x: number; y: number } | null {
    const s = this.state
    const w = s.world
    const mid = Math.floor(w.size / 2)
    const cx = w.size / 2
    const cy = w.size / 2
    for (let r = 2; r <= 16; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const x = mid + dx
          const y = mid + dy
          if (x < 1 || y < 1 || x >= w.size - 1 || y >= w.size - 1) continue
          if (w.tiles[y * w.size + x].terrain !== GRASS) continue
          // 中央广场保留（交粮与活动空间）
          if (Math.abs(x + 0.5 - cx) <= 2.4 && Math.abs(y + 0.5 - cy) <= 2.4) continue
          if (s.sites.some((si) => si.x === x && si.y === y)) continue
          if (s.buildings.some((b) => b.x === x && b.y === y)) continue
          return { x, y }
        }
      }
    }
    return null
  }

  /** 施工：走到工地，持续作业直到落成 */
  private actBuild(v: Villager): void {
    const s = this.state
    const site = s.sites.find((x) => x.builderId === v.id) ?? s.sites[0]
    if (!site) {
      v.task = 'idle'
      return
    }
    site.builderId = v.id

    if (Math.floor(v.x) !== site.x || Math.floor(v.y) !== site.y) {
      if (!v.pathGoal || v.pathGoal.x !== site.x || v.pathGoal.y !== site.y) {
        if (v.work % 15 === 0) {
          const path = findPath(s.world, v.x, v.y, site.x, site.y)
          if (path && path.length > 0) {
            v.path = path
            v.pathGoal = { x: site.x, y: site.y }
          } else {
            v.task = 'idle'
            v.cool = 40
            return
          }
        }
        v.work++
      }
      return
    }

    // 体力不支先去休息，材料与工地保留
    if (v.stamina < 5) {
      v.task = 'rest'
      v.sleepInPlace = false
      v.pathGoal = null
      return
    }

    v.stamina = Math.max(0, v.stamina - PARAMS.staminaWork)
    site.progress += PARAMS.buildPerTick
    if (site.progress >= 1) {
      s.sites = s.sites.filter((x) => x.id !== site.id)
      s.buildings.push({ id: site.id, x: site.x, y: site.y })
      v.task = 'idle'
      v.work = 0
      v.pathGoal = null
    }
  }

  /** 地表资源有限再生（草地食物 / 森林木材，石头不可再生） */
  private regen(): void {
    const tiles = this.state.world.tiles
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i]
      if (t.max <= 0 || t.resource >= t.max) continue
      if (t.terrain === GRASS) {
        t.resource = Math.min(t.max, t.resource + PARAMS.regenFood)
      } else if (t.terrain === FOREST) {
        t.resource = Math.min(t.max, t.resource + PARAMS.regenWood)
      }
    }
  }

  /** 定期生育：人口未满 + 口粮充足 + 有成年人 */
  private maybeBirth(): void {
    const s = this.state
    if (s.tick % PARAMS.birthEvery !== 0) return
    let adults = 0
    let alive = 0
    for (const v of s.villagers) {
      if (!v.alive) continue
      alive++
      if (v.age >= PARAMS.workAge) adults++
    }
    if (alive >= this.capacity) return
    if (adults < 2) return
    if (s.stock.food < PARAMS.birthFoodNeed) return
    s.stock.food -= PARAMS.birthFoodNeed
    s.consumed.food += PARAMS.birthFoodNeed
    const baby = makeVillager(s.nextId++, s.world.size / 2, s.world.size / 2, this.rng, s.world)
    baby.age = 0
    baby.hunger = 90
    baby.stamina = 100
    s.villagers.push(baby)
    s.births++
  }

  /** 手动补充资源（玩家干预，永不为负） */
  grant(type: ResourceType, amount: number): void {
    this.state.stock[type] = Math.max(0, this.state.stock[type] + amount)
  }
}
