import {
  createCivilization,
  ERAS,
  HOUSE_CAPACITY,
  countCivic,
  electricGrid,
  eraRequirements,
  nextConstruction,
  constructionCost,
  constructionName,
  CIVIC_YEAR_TICKS,
  type ConstructionKind,
} from './civilization'
import {
  BUILDINGS,
  EVENTS,
  YEAR_TICKS,
  WINTER_TICK,
  createCampaign,
  seasonAt,
  foodCapacity,
  farmBonus,
  buildingCount,
  workforce,
  type BuildingKind,
} from './survival'
import { findPath } from './path'
import { createRng, type Rng } from './rng'
import type { SimState, Villager, Building } from './types'
import {
  FARMLAND,
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
  moveSpeed: 0.21,
  gatherInterval: 2,
  buildPerTick: 0.008,
  staminaWork: 0.05,
  regenFood: 0.09,
  regenWood: 0.012,
  /** 农田：开垦成本与高产参数 */
  farmWoodCost: 5,
  farmMax: 60,
  regenFarm: 0.24,
  /** 自动开垦：农田上限与启动木材线（不抢 30 的建房料） */
  farmCap: 12,
  farmAutoWood: 55,
  birthEvery: 450,
  /** 出生：库存门槛与真实消耗分离（门槛过高会卡死生育窗口，消耗过大会连锁断档） */
  birthFoodNeed: 70,
  birthFoodCost: 40,
  historyEvery: 20,
  historyMax: 900,
} as const

const CARRY_CAP: Record<ResourceType, number> = { food: 16, wood: 10, stone: 10 }

const SURNAMES = [
  '林',
  '陈',
  '赵',
  '周',
  '吴',
  '郑',
  '王',
  '李',
  '张',
  '刘',
  '黄',
  '杨',
  '徐',
  '孙',
  '马',
  '朱',
  '胡',
  '郭',
  '何',
  '高',
]
const GIVENS = [
  '山',
  '禾',
  '雨',
  '石',
  '川',
  '木',
  '春',
  '安',
  '宁',
  '远',
  '舟',
  '岩',
  '桑',
  '野',
  '星',
  '麦',
  '竹',
  '岚',
  '青',
  '小满',
  '石头',
  '远山',
  '望',
  '临',
]

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
    maxAge: rng.range(64, 84),
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

function createInitialState(seed: number, rng: Rng, large = false): SimState {
  const world = generateWorld(seed, large ? 256 : 64, large)
  const cx = world.size / 2
  const cy = world.size / 2
  const villagers: Villager[] = []
  for (let i = 0; i < PARAMS.initialPop; i++) {
    villagers.push(makeVillager(i + 1, cx, cy, rng, world))
  }
  return {
    tick: 0,
    civilization: null,
    campaign: null,
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
    worldVersion: 0,
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
  private populationTick = -1
  private populationCount = 0
  private gridRatio = 1
  private workplacesVersion = -1
  private workplaces: Record<'research' | 'industry' | 'mining', Building[]> = {
    research: [],
    industry: [],
    mining: [],
  }
  private occupied = new Set<number>()
  private occupiedVersion = -1
  private rng: Rng

  constructor(seedOrState: number | SimState, mode: 'sandbox' | 'survival' | 'evolution' = 'sandbox') {
    if (typeof seedOrState === 'number') {
      this.rng = createRng(seedOrState ^ 0x5bf03635)
      this.state = createInitialState(seedOrState, this.rng, mode === 'evolution')
      if (mode === 'evolution') {
        this.state.civilization = createCivilization(this.state.world.size)
        for (const v of this.state.villagers) this.initializeDemographics(v)
        this.state.stock = { food: 160, wood: 20, stone: 10 }
        const mid = this.state.world.size / 2
        this.state.buildings.push({ id: this.state.nextId++, x: mid, y: mid, type: 'campfire', level: 0 })
        for (let i = 0; i < 2; i++) {
          const spot = this.findBuildSpot()
          if (spot) this.state.buildings.push({ id: this.state.nextId++, ...spot, type: 'house', level: 0 })
        }
        this.log('milestone', '部落在这片大陆落脚。从农田与知识开始，逐步建设现代都市。')
      }
      if (mode === 'survival') {
        this.state.campaign = createCampaign()
        this.state.stock = { food: 140, wood: 35, stone: 20 }
        this.assignWorkforce()
        this.log('milestone', '首年目标：度过冬季，至少存活 20 人。先安排农夫、开垦农田，再准备粮仓。')
      }
    } else {
      this.state = seedOrState
      if (!this.state.civilization) this.state.civilization = null
      else if (this.state.civilization.oreReserve === undefined) this.state.civilization.oreReserve = 60000
      if (!this.state.campaign) this.state.campaign = null
      // 旧存档缺省字段回填（向前兼容）
      const n = seedOrState.world.size * seedOrState.world.size
      if (!this.state.journal) this.state.journal = []
      if (!this.state.milestones) this.state.milestones = []
      if (!this.state.walk || this.state.walk.length !== n) this.state.walk = new Array<number>(n).fill(0)
      if (!this.state.nextEventAt) this.state.nextEventAt = seedOrState.tick + 1500
      if (this.state.worldVersion == null) this.state.worldVersion = 0
      for (const site of this.state.sites) if (!site.type) site.type = 'house'
      this.rng = createRng(0)
      this.rng.setState(seedOrState.rngState)
    }
    this.state.rngState = this.rng.getState()
  }

  /** 按真实时间推进（内部换算成 tick），暂停时不动 */
  advance(dtSeconds: number): void {
    if (this.paused || this.blocked) return
    this.acc += dtSeconds * this.speed
    const step = 1 / this.tickRate
    let guard = 0
    while (this.acc >= step) {
      this.acc -= step
      this.tick()
      if (this.blocked) {
        this.acc = 0
        break
      }
      if (++guard >= 1000) {
        this.acc = 0
        break
      }
    }
  }

  /** 推进一个模拟 tick */
  tick(): void {
    if (this.blocked) return
    const s = this.state
    s.tick++
    if (s.civilization) this.gridRatio = electricGrid(s).ratio
    const winter = !!s.campaign && seasonAt(s.tick) === 3
    if (s.campaign && s.tick % 60 === 1) this.assignWorkforce()
    const rng = this.rng

    for (const v of s.villagers) {
      if (!v.alive) continue
      v.age += 1 / (s.campaign ? YEAR_TICKS : s.civilization ? CIVIC_YEAR_TICKS : PARAMS.ageTicks)
      v.hunger = Math.max(
        0,
        v.hunger -
          PARAMS.hungerDecay *
            (winter ? 1.4 : 1) *
            (s.civilization ? (v.age < 5 ? 0.4 : v.age < 18 ? 0.7 : 1) : 1),
      )

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
      if (
        v.age >= v.maxAge &&
        rng.next() < 1 / (400 * (1 + (s.civilization ? countCivic(s, 'clinic') : 0)))
      ) {
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
    if (!s.campaign && !s.civilization) {
      this.maybeCreateSite()
      this.maybeCreateFarmSite()
    }
    this.regen()
    this.maybeBirth()

    // 纪事：里程碑检查（每 100 tick）与随机事件调度
    if (s.tick % 100 === 0) this.checkMilestones()
    if (!s.campaign && !s.civilization && s.tick >= s.nextEventAt) {
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

    if (s.campaign) this.updateCampaign()
    if (s.civilization) this.updateCivilization()
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
    this.populationTick = -1
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
      case 'research':
      case 'industry':
      case 'mining':
        this.actCivicWork(v)
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
    const era = this.state.civilization?.era ?? 0
    const road = this.state.civilization?.roads[Math.floor(v.y) * this.state.world.size + Math.floor(v.x)]
    const speed = PARAMS.moveSpeed * (v.stamina <= 0 ? 0.45 : 1) * (1 + era * 0.12) * (road ? 1.35 : 1)
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
      ['first_house', buildingCount(s, 'house') >= 1, '第一座房屋落成，村庄有了家'],
      ['pop30', alive >= 30, '人口达到 30'],
      ['pop50', alive >= 50, '人口达到 50'],
      ['day100', s.tick >= 5940, '村庄安然度过第 100 天'],
      ['houses5', buildingCount(s, 'house') >= 5, '住房增至 5 座'],
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
    if (v.age < (s.civilization ? 18 : PARAMS.workAge)) {
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
    if (s.civilization && v.civicJob) {
      v.task = v.civicJob
      return
    }
    // 3) 工地缺人去建设（无工地则采集）
    const site =
      !s.campaign || v.profession === 'builder'
        ? s.sites.find((x) => x.builderId === null || x.builderId === v.id)
        : null
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
  private neededResource(v?: Villager): ResourceType {
    if (this.state.campaign && v) {
      if (v.profession === 'farmer') return 'food'
      // 建筑工在没有工地时帮采建材；采集者负责木石，不会悄悄替代农夫。
      return this.state.stock.wood < this.state.stock.stone * 2 + 30 ? 'wood' : 'stone'
    }
    const st = this.state.stock
    if (this.state.civilization) {
      const pop = this.aliveCount()
      if (st.food < Math.max(100, pop * 6) && (!v || v.id % 5 !== 0)) return 'food'
      if (st.wood < 250) return 'wood'
      if (st.stone < 180) return 'stone'
      return 'food'
    }
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
    const s = this.state,
      w = s.world
    if (this.occupiedVersion !== s.worldVersion + s.buildings.length) {
      this.occupied = new Set(s.buildings.map((b) => b.y * w.size + b.x))
      this.occupiedVersion = s.worldVersion + s.buildings.length
    }
    const search = (radius: number): number | null => {
      let best = -1,
        bestD = Infinity
      const left = s.civilization ? Math.max(0, Math.floor(v.x) - radius) : 0
      const right = s.civilization ? Math.min(w.size - 1, Math.floor(v.x) + radius) : w.size - 1
      const top = s.civilization ? Math.max(0, Math.floor(v.y) - radius) : 0
      const bottom = s.civilization ? Math.min(w.size - 1, Math.floor(v.y) + radius) : w.size - 1
      for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++) {
          const i = y * w.size + x,
            t = w.tiles[i]
          if (
            t.resource < 1 ||
            resourceType(t.terrain) !== type ||
            v.failedTiles.includes(i) ||
            (s.civilization && this.occupied.has(i))
          )
            continue
          const d =
            ((x + 0.5 - v.x) ** 2 + (y + 0.5 - v.y) ** 2) *
            (s.campaign && v.profession === 'farmer' && t.terrain === FARMLAND ? 0.55 : 1)
          if (d < bestD) {
            bestD = d
            best = i
          }
        }
      return best < 0 ? null : best
    }
    return (
      (s.civilization ? search(5) : null) ??
      search(12) ??
      (s.civilization ? (search(32) ?? search(64)) : null)
    )
  }

  private actGather(v: Villager): void {
    const s = this.state
    const w = s.world

    if (v.gatherTile === null) {
      const type: ResourceType = v.carry > 0.05 && v.carryType ? v.carryType : this.neededResource(v)
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
      const cap = CARRY_CAP[rt] * (1 + (s.civilization?.era ?? 0) * 0.75)
      if (v.carry >= cap) {
        v.task = 'deposit'
        return
      }
      const harvest =
        s.campaign && rt === 'food'
          ? (seasonAt(s.tick) === 3 ? 0.3 : 1) * (tile.terrain === FARMLAND ? farmBonus(s) : 1)
          : s.civilization && tile.terrain === FARMLAND
            ? farmBonus(s) * (s.civilization.era >= 3 ? 1 + (s.civilization.era - 2) * 2 * this.gridRatio : 1)
            : 1
      const take = Math.min(
        harvest *
          (s.civilization
            ? 1 +
              s.civilization.era * 0.3 +
              (rt === 'food'
                ? Math.min(3, countCivic(s, 'well')) * 0.05
                : Math.min(3, countCivic(s, 'workshop')) * 0.15)
            : 1),
        tile.resource,
        cap - v.carry,
      )
      tile.resource -= take
      v.carry += take
      v.carryType = rt
    }
  }

  private actDeposit(v: Villager): void {
    const s = this.state
    const w = s.world
    const depot = s.civilization
      ? s.buildings
          .filter((b) => b.type === 'market' || b.type === 'granary')
          .sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y))[0]
      : null
    const cx = depot ? depot.x + 0.5 : w.size / 2
    const cy = depot ? depot.y + 0.5 : w.size / 2

    if (Math.hypot(v.x - cx, v.y - cy) <= 1.7) {
      if (v.carry > 0.05 && v.carryType) {
        this.addStock(v.carryType, v.carry)
        v.carry = 0
        v.carryType = null
        v.failedTiles.length = 0
      }
      v.task = 'idle'
      v.work = 0
      v.pathGoal = null
      return
    }

    const gx = depot ? depot.x : Math.floor(cx) - 1
    const gy = depot ? depot.y : Math.floor(cy) - 1
    if (!v.pathGoal || v.pathGoal.x !== gx || v.pathGoal.y !== gy) {
      if (v.work % 15 === 0) {
        const path = findPath(w, v.x, v.y, gx, gy)
        if (path && path.length > 0) {
          v.path = path
          v.pathGoal = { x: gx, y: gy }
        } else {
          // 回不了村中心（孤岛）：原地入库，经济不被卡死
          if (v.carry > 0.05 && v.carryType) {
            this.addStock(v.carryType, v.carry)
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
      v.stamina += PARAMS.restRateHouse * (1 + (s.civilization ? countCivic(s, 'park') * 0.1 : 0))
    } else {
      v.stamina += PARAMS.restRate
    }
    v.stamina = Math.min(100, v.stamina)
  }

  private nearestBuilding(v: Villager): { x: number; y: number } | null {
    const buildings = this.state.buildings.filter((b) => !b.type || b.type === 'house')
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
    if (this.state.civilization)
      return (
        20 +
        this.state.buildings.reduce(
          (n, b) =>
            n +
            (b.type === 'skyscraper' ? 20 : b.type === 'house' || !b.type ? HOUSE_CAPACITY[b.level ?? 0] : 0),
          0,
        )
      )
    return PARAMS.baseCapacity + PARAMS.capacityPerHouse * buildingCount(this.state, 'house')
  }

  private aliveCount(): number {
    if (this.populationTick === this.state.tick) return this.populationCount
    this.populationCount = this.state.villagers.reduce((n, v) => n + Number(v.alive), 0)
    this.populationTick = this.state.tick
    return this.populationCount
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
    s.sites.push({ id: s.nextId++, x: spot.x, y: spot.y, progress: 0, builderId: null, type: 'house' })
  }

  /** 由内向外环搜一块未被占用的草地（中央广场保留不建） */
  private findBuildSpot(): { x: number; y: number } | null {
    const s = this.state
    const w = s.world
    const mid = Math.floor(w.size / 2)
    const cx = w.size / 2
    const cy = w.size / 2
    const occupied = new Set([...s.sites, ...s.buildings].map((b) => b.y * w.size + b.x))
    for (let r = 2; r <= (s.civilization ? Math.min(100, w.size / 2 - 2) : 16); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const x = mid + dx
          const y = mid + dy
          if (x < 1 || y < 1 || x >= w.size - 1 || y >= w.size - 1) continue
          const terrain = w.tiles[y * w.size + x].terrain
          if (s.civilization ? ![GRASS, FOREST, STONE, 5, 6, 7, 8].includes(terrain) : terrain !== GRASS)
            continue
          if (s.civilization && (x % 4 === 0 || y % 4 === 0)) continue
          // 中央广场保留（交粮与活动空间）
          if (Math.abs(x + 0.5 - cx) <= 2.4 && Math.abs(y + 0.5 - cy) <= 2.4) continue
          if (occupied.has(y * w.size + x)) continue
          if (!findPath(w, cx, cy, x, y)) continue
          return { x, y }
        }
      }
    }
    return null
  }

  /** 施工：走到工地，持续作业直到落成 */
  private actBuild(v: Villager): void {
    const s = this.state
    const site = s.sites.find((x) => x.builderId === v.id) ?? s.sites.find((x) => x.builderId === null)
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
            site.builderId = null
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
      site.builderId = null
      v.task = 'rest'
      v.sleepInPlace = false
      v.pathGoal = null
      return
    }

    v.stamina = Math.max(0, v.stamina - PARAMS.staminaWork)
    site.progress += PARAMS.buildPerTick
    if (site.progress >= 1) {
      s.sites = s.sites.filter((x) => x.id !== site.id)
      if (site.type === 'farm') {
        this.completeFarm(site.x, site.y)
      } else {
        const upgraded =
          site.upgradeId !== undefined ? s.buildings.find((b) => b.id === site.upgradeId) : null
        if (upgraded) upgraded.level = s.civilization?.era ?? upgraded.level ?? 0
        else
          s.buildings.push({
            id: site.id,
            x: site.x,
            y: site.y,
            type: site.type ?? 'house',
            ...(s.civilization ? { level: s.civilization.era } : {}),
          })
        if (s.civilization) this.connectRoad(site.x, site.y)
        if (s.campaign) this.log('milestone', `${constructionName(site.type ?? 'house')}落成`)
      }
      v.task = 'idle'
      v.work = 0
      v.pathGoal = null
    }
  }

  /** 木材富余且农田未满时，立一块开垦工地（一次只立一块，居民施工后落成） */
  private maybeCreateFarmSite(): void {
    const s = this.state
    if (s.sites.some((x) => x.type === 'farm')) return
    let farms = 0
    for (const t of s.world.tiles) if (t.terrain === FARMLAND) farms++
    if (farms >= PARAMS.farmCap) return
    if (s.stock.wood < PARAMS.farmAutoWood) return
    const spot = this.findBuildSpot()
    if (!spot) return
    s.stock.wood -= PARAMS.farmWoodCost
    s.consumed.wood += PARAMS.farmWoodCost
    s.sites.push({ id: s.nextId++, x: spot.x, y: spot.y, progress: 0, builderId: null, type: 'farm' })
  }

  /** 农田落成：格子转为农田并记里程碑（手动/自动共用），地形变更计数 +1 */
  private completeFarm(x: number, y: number): void {
    const s = this.state
    const tile = s.world.tiles[y * s.world.size + x]
    if (tile.terrain === GRASS) {
      tile.terrain = FARMLAND
      tile.max = PARAMS.farmMax
      if (tile.resource > tile.max) tile.resource = tile.max
    }
    s.worldVersion++
    if (!s.milestones.includes('first_farm')) {
      s.milestones.push('first_farm')
      this.log('milestone', '第一块农田开垦，刀耕火种')
    }
  }

  /** 地表资源有限再生（草地食物 / 农田高产 / 森林木材，石头不可再生） */
  private regen(): void {
    const tiles = this.state.world.tiles
    const buckets = this.state.civilization ? 16 : 1
    const winter = !!this.state.campaign && seasonAt(this.state.tick) === 3
    const civ = this.state.civilization
    const bonus =
      (this.state.campaign || civ ? farmBonus(this.state) : 1) *
      (civ && civ.era >= 3 ? 1 + (civ.era - 2) * 2 * this.gridRatio : 1)
    for (let i = this.state.tick % buckets; i < tiles.length; i += buckets) {
      const t = tiles[i]
      if (t.max <= 0 || t.resource >= t.max) continue
      if (t.terrain === GRASS || t.terrain === 7) {
        t.resource = Math.min(t.max, t.resource + PARAMS.regenFood * buckets * (winter ? 0.12 : 1))
      } else if (t.terrain === FARMLAND) {
        t.resource = Math.min(t.max, t.resource + PARAMS.regenFarm * bonus * buckets * (winter ? 0.25 : 1))
      } else if (t.terrain === FOREST) {
        t.resource = Math.min(t.max, t.resource + PARAMS.regenWood * buckets)
      }
    }
  }

  /** 定期生育：人口未满 + 口粮充足 + 有成年人 */
  private maybeBirth(): void {
    const s = this.state
    if (s.civilization) {
      this.demographicBirths()
      return
    }
    if (s.tick % (s.campaign ? 1800 : PARAMS.birthEvery) !== 0) return
    let adults = 0
    let alive = 0
    for (const v of s.villagers) {
      if (!v.alive) continue
      alive++
      if (v.age >= (s.civilization ? 18 : PARAMS.workAge)) adults++
    }
    if (alive >= this.capacity || (s.civilization && alive >= 1800)) return
    if (adults < 2) return
    if (s.stock.food < PARAMS.birthFoodNeed) return
    s.stock.food -= PARAMS.birthFoodCost
    s.consumed.food += PARAMS.birthFoodCost
    const baby = makeVillager(s.nextId++, s.world.size / 2, s.world.size / 2, this.rng, s.world)
    baby.age = 0
    baby.hunger = 90
    baby.stamina = 100
    s.villagers.push(baby)
    s.births++
    this.populationTick = -1
  }

  private initializeDemographics(v: Villager): void {
    if (!v.sex) v.sex = this.rng.next() < 0.5 ? 'female' : 'male'
    if (v.pregnancyDue === undefined) v.pregnancyDue = null
    if (v.lastBirthTick === undefined) v.lastBirthTick = -CIVIC_YEAR_TICKS * 2
  }

  private demographicBirths(): void {
    const s = this.state,
      c = s.civilization!
    const adults = s.villagers.filter((v) => v.alive && v.age >= 18)
    const hasPartner = adults.some((v) => v.sex === 'male' && v.age < 65)
    for (const mother of s.villagers) {
      if (!mother.alive) continue
      this.initializeDemographics(mother)
      if (
        mother.pregnancyDue !== null &&
        mother.pregnancyDue !== undefined &&
        s.tick >= mother.pregnancyDue
      ) {
        const baby = makeVillager(s.nextId++, mother.x, mother.y, this.rng, s.world)
        baby.age = 0
        baby.hunger = 90
        baby.stamina = 100
        baby.motherId = mother.id
        this.initializeDemographics(baby)
        s.villagers.push(baby)
        s.births++
        this.populationTick = -1
        mother.pregnancyDue = null
        mother.lastBirthTick = s.tick
      }
      if (
        s.tick % 1800 !== 0 ||
        !hasPartner ||
        mother.sex !== 'female' ||
        mother.age < 18 ||
        mother.age > 42 ||
        mother.pregnancyDue !== null
      )
        continue
      // 270 天妊娠，产后至少间隔两年；参数是游戏模型，不是人口预测。
      if (
        s.tick - (mother.lastBirthTick ?? 0) < 2 * CIVIC_YEAR_TICKS ||
        mother.hunger < 45 ||
        s.stock.food < this.aliveCount() * 5 ||
        this.aliveCount() >= this.capacity
      )
        continue
      if (this.rng.next() < (c.era >= 3 ? 0.035 : 0.06)) mother.pregnancyDue = s.tick + 270 * 60
    }
  }

  orderCivic(kind: ConstructionKind): boolean {
    const s = this.state,
      c = s.civilization
    if (!c || s.sites.length >= 4 || this.blocked) return false
    const cost = constructionCost(kind)
    if (c.era < cost.era) return false
    const steel = cost.steel
    if (s.stock.wood < cost.wood || s.stock.stone < cost.stone || c.steel < steel) return false
    const spot = this.findBuildSpot()
    if (!spot) return false
    s.stock.wood -= cost.wood
    s.stock.stone -= cost.stone
    c.steel -= steel
    s.consumed.wood += cost.wood
    s.consumed.stone += cost.stone
    const tile = s.world.tiles[spot.y * s.world.size + spot.x]
    tile.terrain = GRASS
    tile.resource = 0
    tile.max = 40
    s.worldVersion++
    s.sites.push({ id: s.nextId++, ...spot, type: kind, progress: 0, builderId: null })
    return true
  }

  private connectRoad(x: number, y: number): void {
    const s = this.state,
      c = s.civilization!
    const path = findPath(s.world, s.world.size / 2, s.world.size / 2, x, y)
    if (!path) return
    let px = s.world.size / 2,
      py = px
    for (const point of path) {
      const length = Math.max(1, Math.ceil(Math.hypot(point.x - px, point.y - py) * 2))
      for (let n = 0; n <= length; n++) {
        const gx = Math.floor(px + ((point.x - px) * n) / length),
          gy = Math.floor(py + ((point.y - py) * n) / length),
          i = gy * s.world.size + gx
        if (!c.roads[i] && isWalkable(s.world, gx, gy) && s.stock.stone >= 0.2) {
          c.roads[i] = 1
          s.stock.stone -= 0.2
          s.consumed.stone += 0.2
        }
      }
      px = point.x
      py = point.y
    }
  }

  private actCivicWork(v: Villager): void {
    const s = this.state,
      c = s.civilization
    if (!c) {
      v.task = 'idle'
      return
    }
    const kind = v.task === 'research' ? 'school' : v.task === 'mining' ? 'quarry' : 'factory'
    if (this.workplacesVersion !== s.buildings.length) {
      this.workplaces = {
        research: s.buildings.filter((b) => b.type === 'school'),
        industry: s.buildings.filter((b) => b.type === 'factory'),
        mining: s.buildings.filter((b) => b.type === 'quarry'),
      }
      this.workplacesVersion = s.buildings.length
    }
    const places = this.workplaces[kind === 'school' ? 'research' : kind === 'quarry' ? 'mining' : 'industry']
    const job = places[v.id % Math.max(1, places.length)]
    if (!job) {
      v.task = 'idle'
      return
    }
    if (Math.hypot(job.x + 0.5 - v.x, job.y + 0.5 - v.y) > 1) {
      const path = findPath(s.world, v.x, v.y, job.x, job.y)
      if (path) {
        v.path = path
        v.pathGoal = { x: job.x, y: job.y }
      } else {
        v.task = 'idle'
        v.cool = 40
      }
      return
    }
    if (v.stamina < 5) {
      v.task = 'rest'
      return
    }
    v.stamina -= 0.025
    if (kind === 'school') c.knowledge += 0.08
    else if (kind === 'quarry') {
      const extracted = Math.min(c.oreReserve, 0.08 * (c.era >= 3 ? this.gridRatio : 1))
      c.oreReserve -= extracted
      this.addStock('stone', extracted)
    } else if (s.stock.wood >= 0.015 && s.stock.stone >= 0.01) {
      const powered = this.gridRatio
      c.steel += 0.02 * powered
      s.stock.wood -= 0.015 * powered
      s.stock.stone -= 0.01 * powered
      s.consumed.wood += 0.015 * powered
      s.consumed.stone += 0.01 * powered
    }
  }

  private updateCivilization(): void {
    const s = this.state,
      c = s.civilization!
    const adults = s.villagers.filter((v) => v.alive && v.age >= 18)
    if (s.stock.food > 20) c.knowledge += adults.length * 0.0006
    if (s.tick % 60 === 0) {
      if (c.era < 4 && eraRequirements(s).every((r) => r.met)) {
        c.era++
        c.transitions.push({ era: c.era, tick: s.tick })
        this.log('milestone', `文明进入${ERAS[c.era]}：新的生产方式与建筑已解锁`)
      }
      if (c.autoBuild) {
        const next = nextConstruction(s)
        if (next) this.orderCivic(next)
        else if (s.sites.length < 4) {
          const old = s.buildings.find(
            (b) =>
              b.type === 'house' &&
              (b.level ?? 0) < c.era &&
              !s.sites.some((site) => site.upgradeId === b.id),
          )
          if (old && s.stock.wood >= 20 && s.stock.stone >= 25 && (c.era < 4 || c.steel >= 10)) {
            s.stock.wood -= 20
            s.stock.stone -= 25
            s.consumed.wood += 20
            s.consumed.stone += 25
            if (c.era >= 4) c.steel -= 10
            s.sites.push({
              id: s.nextId++,
              x: old.x,
              y: old.y,
              type: 'house',
              upgradeId: old.id,
              progress: 0,
              builderId: null,
            })
          }
        }
      }
    }
    if (s.tick % 300 === 0) {
      const miners = Math.min(12, countCivic(s, 'quarry') * 2)
      const researchers = Math.min(8, countCivic(s, 'school') * 2),
        industrial = Math.min(12, countCivic(s, 'factory') * 3)
      adults
        .sort((a, b) => a.id - b.id)
        .forEach((v, i) => {
          const job =
            i < researchers
              ? 'research'
              : i < researchers + industrial
                ? 'industry'
                : i < researchers + industrial + miners
                  ? 'mining'
                  : undefined
          if (v.civicJob === job) return
          for (const site of s.sites) if (site.builderId === v.id) site.builderId = null
          v.civicJob = job
          v.task = 'idle'
          v.path = []
          v.pathGoal = null
          v.gatherTile = null
          v.cool = 0
        })
    }
    // 迁移每月结算：有人愿意来，还须有岗位、住房和安置口粮；外部人口池有限。
    if (
      c.era >= 1 &&
      s.tick % 1800 === 0 &&
      (c.era === 1 ? countCivic(s, 'granary') > 0 : countCivic(s, 'market') > 0) &&
      s.stock.food > Math.max(120, this.aliveCount() * 5)
    ) {
      const jobs =
        20 +
        countCivic(s, 'farm') * 3 +
        countCivic(s, 'factory') * 30 +
        countCivic(s, 'market') * 12 +
        countCivic(s, 'skyscraper') * 32
      const count = Math.max(
        0,
        Math.min(
          Math.max(1, Math.ceil(this.aliveCount() * 0.03)),
          20,
          this.capacity - this.aliveCount(),
          1800 - this.aliveCount(),
          c.migrationPool,
          jobs - adults.length,
          Math.floor(s.stock.food / 20),
        ),
      )
      for (let i = 0; i < count; i++) {
        const person = makeVillager(s.nextId++, s.world.size / 2, s.world.size / 2, this.rng, s.world)
        this.initializeDemographics(person)
        s.villagers.push(person)
        this.populationTick = -1
      }
      c.immigrants += count
      c.migrationPool -= count
      s.stock.food -= count * 20
      s.consumed.food += count * 20
      if (count > 0) this.log('event', `最近 30 天迁入 ${count} 名成年人（安置口粮 −${count * 20}）`)
    }
  }

  get blocked(): boolean {
    const c = this.state.campaign
    return !!c && (!!c.pendingEvent || (!!c.result && !c.continued))
  }

  private addStock(type: ResourceType, amount: number): void {
    const cap = type === 'food' ? foodCapacity(this.state) : Infinity
    this.state.stock[type] = Math.min(cap, Math.max(0, this.state.stock[type] + amount))
  }

  /** 成人按稳定 id 排列分工。调整任务不丢携带物，工地释放给新建筑工。 */
  private assignWorkforce(): void {
    const s = this.state
    if (!s.campaign) return
    const { farmers, builders } = workforce(s)
    const adults = s.villagers
      .filter((v) => v.alive && v.age >= (s.civilization ? 18 : PARAMS.workAge))
      .sort((a, b) => a.id - b.id)
    adults.forEach((v, i) => {
      const next = i < farmers ? 'farmer' : i < farmers + builders ? 'builder' : 'gatherer'
      if (v.profession === next) return
      v.profession = next
      for (const site of s.sites) if (site.builderId === v.id) site.builderId = null
      v.task = 'idle'
      v.path = []
      v.pathGoal = null
      v.gatherTile = null
      v.cool = 0
      v.work = 0
    })
  }

  setWorkforce(farmers: number, builders: number): boolean {
    const c = this.state.campaign
    if (
      !c ||
      this.blocked ||
      !Number.isInteger(farmers) ||
      !Number.isInteger(builders) ||
      farmers < 0 ||
      builders < 0 ||
      farmers + builders > workforce(this.state).adults
    )
      return false
    c.farmers = farmers
    c.builders = builders
    this.assignWorkforce()
    return true
  }

  orderBuilding(kind: BuildingKind): boolean {
    const s = this.state
    if (!s.campaign || this.blocked || !Object.hasOwn(BUILDINGS, kind) || s.sites.length >= 4) return false
    const cost = BUILDINGS[kind]
    if (s.stock.wood < cost.wood || s.stock.stone < cost.stone) return false
    const spot = this.findBuildSpot()
    if (!spot) return false
    s.stock.wood -= cost.wood
    s.stock.stone -= cost.stone
    s.consumed.wood += cost.wood
    s.consumed.stone += cost.stone
    s.sites.push({ id: s.nextId++, ...spot, progress: 0, builderId: null, type: kind })
    this.log('event', `安排建设${cost.name}（木材 −${cost.wood}，石头 −${cost.stone}）`)
    return true
  }

  resolveEvent(choice: number): boolean {
    const s = this.state
    const c = s.campaign
    if (!c?.pendingEvent || !Number.isInteger(choice)) return false
    const event = EVENTS.find((e) => e.id === c.pendingEvent)!
    const cost = event.choices[choice]
    if (!cost) return false
    if (s.stock.food < cost.food || s.stock.wood < cost.wood) return false
    if (event.id === 'refugees' && choice === 0 && this.capacity - this.aliveCount() < 5) return false
    s.stock.food -= cost.food
    s.stock.wood -= cost.wood
    s.consumed.food += cost.food
    s.consumed.wood += cost.wood
    if (event.id === 'refugees' && choice === 0) {
      for (let i = 0; i < 5; i++)
        s.villagers.push(makeVillager(s.nextId++, s.world.size / 2, s.world.size / 2, this.rng, s.world))
      this.populationTick = -1
    } else if (event.id === 'merchant' && choice === 0) this.addStock('food', 220)
    else if (event.id === 'harvest') {
      if (choice === 0) this.addStock('food', 160)
      else if (choice === 1) {
        this.addStock('wood', 50)
        this.addStock('stone', 20)
      }
    }
    const record = `第 ${Math.floor(s.tick / 60) + 1} 天 · ${event.title}：${cost.label}`
    c.decisions.push(record)
    c.resolvedEvents.push(event.id)
    c.pendingEvent = null
    c.minFood = Math.min(c.minFood, s.stock.food)
    this.assignWorkforce()
    this.log('event', record)
    s.rngState = this.rng.getState()
    return true
  }

  continueAfterYear(): void {
    if (this.state.campaign?.result) this.state.campaign.continued = true
  }

  private updateCampaign(): void {
    const s = this.state
    const c = s.campaign!
    c.minFood = Math.min(c.minFood, s.stock.food)
    if (s.tick % 1800 === 0) {
      const season = ['春季播种', '夏季生长', '秋季储备', '冬季到来：食物消耗 +40%，采收仅为 30%'][
        seasonAt(s.tick)
      ]
      this.log('milestone', season)
    }
    const population = this.aliveCount()
    if (!c.result && (s.tick >= YEAR_TICKS || population === 0)) {
      c.result = {
        won: s.tick >= YEAR_TICKS && population >= 20,
        population,
        starveDeaths: s.starveDeaths,
        ageDeaths: s.ageDeaths,
        minFood: c.minFood,
        food: s.stock.food,
        assisted: c.assisted,
        tick: s.tick,
        decisions: [...c.decisions],
      }
      this.log(
        'milestone',
        c.result.won ? '首年目标达成：文明度过了第一个冬天' : '首年目标未达成：需要重新规划分工与储粮',
      )
      return
    }
    if (c.result) return
    const event = EVENTS.find((e) => s.tick >= e.at && !c.resolvedEvents.includes(e.id))
    if (event) c.pendingEvent = event.id
    if (s.tick === WINTER_TICK - 600) this.log('event', '距冬季还有 10 天：检查粮仓、储粮和农夫数量')
  }

  /** 手动补充资源（玩家干预，永不为负） */
  grant(type: ResourceType, amount: number): void {
    if (this.blocked) return
    if (this.state.campaign && amount > 0) this.state.campaign.assisted = true
    this.addStock(type, amount)
  }

  /**
   * 开垦农田：草地 → 高产农田，消耗木材并记账。
   * 中央广场保留区不可开垦。成功后 UI 需重建离屏地形层（setEpoch）。
   */
  reclaimToFarmland(x: number, y: number): boolean {
    const s = this.state
    const w = s.world
    if (this.blocked || (s.campaign && s.sites.length >= 4)) return false
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= w.size || y >= w.size)
      return false
    const tile = w.tiles[y * w.size + x]
    if (tile.terrain !== GRASS) return false
    const cx = w.size / 2
    const cy = w.size / 2
    if (Math.abs(x + 0.5 - cx) <= 2.4 && Math.abs(y + 0.5 - cy) <= 2.4) return false
    if (s.sites.some((si) => si.x === x && si.y === y)) return false
    if (s.buildings.some((b) => b.x === x && b.y === y)) return false
    if (s.stock.wood < PARAMS.farmWoodCost) return false

    s.stock.wood -= PARAMS.farmWoodCost
    s.consumed.wood += PARAMS.farmWoodCost
    if (s.campaign) {
      s.sites.push({ id: s.nextId++, x, y, progress: 0, builderId: null, type: 'farm' })
    } else this.completeFarm(x, y)
    return true
  }
}
