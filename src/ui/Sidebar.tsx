import CivilizationPanel from './CivilizationPanel'
import type { CivilizationView, ConstructionKind } from '../sim/civilization'
import SurvivalPanel from './SurvivalPanel'
import { PROFESSION_LABEL, type Profession, type BuildingKind, type SurvivalView } from '../sim/survival'
import { useState } from 'react'
import type { HistoryPoint, JournalEntry, Stock, TaskKind } from '../sim/types'
import type { ResourceType, Terrain } from '../sim/world'
import { TERRAIN_NAMES, GRASS } from '../sim/world'
import type { Selection } from '../render/entities'
import StatsChart, { SERIES } from './StatsChart'

export interface SelectedVillagerInfo {
  civicJob?: 'research' | 'industry' | 'mining'
  sex?: 'female' | 'male'
  pregnancyDays?: number | null
  profession?: Profession
  id: number
  name: string
  age: number
  hunger: number
  stamina: number
  task: TaskKind
  carry: number
  carryType: ResourceType | null
  alive: boolean
}

export interface SelectedTileInfo {
  x: number
  y: number
  terrain: Terrain
  resource: number
  max: number
}

export interface UiSnapshot {
  civilization: CivilizationView | null
  campaign: SurvivalView | null
  blocked: boolean
  tick: number
  paused: boolean
  speed: number
  seed: number
  pop: number
  capacity: number
  buildings: number
  sites: number
  births: number
  deaths: number
  stock: Stock
  history: HistoryPoint[]
  journal: JournalEntry[]
  worldVersion: number
  villager: SelectedVillagerInfo | null
  tile: SelectedTileInfo | null
}

export const TASK_LABEL: Record<TaskKind, string> = {
  idle: '空闲',
  wander: '散步',
  eat: '进食',
  rest: '休息',
  deposit: '交粮',
  gather: '采集',
  build: '建设',
  research: '研究',
  industry: '工业生产',
  mining: '采矿',
}

const TERRAIN_LABEL = TERRAIN_NAMES
const RESOURCE_LABEL: Record<ResourceType, string> = { food: '食物', wood: '木材', stone: '石头' }

function fmt(n: number): string {
  return Math.floor(n).toLocaleString('zh-CN')
}

function bar(value: number, color: string): React.ReactNode {
  return (
    <div className="bar">
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  )
}

interface Props {
  ui: UiSnapshot
  selection: Selection
  onTogglePause: () => void
  onSpeed: (n: number) => void
  onReset: (seedText: string, mode?: 'survival' | 'sandbox' | 'evolution') => void
  onConstruct: (kind: ConstructionKind) => void
  onAuto: () => void
  onPriority: (priority: CivilizationView['priority']) => void
  onWorkforce: (farmers: number, builders: number) => void
  onBuild: (kind: BuildingKind) => void
  onGrant: (type: ResourceType) => void
  onClearSelection: () => void
  onSave: () => void
  onLoad: () => void
  saveMsg: string
  onReclaim: () => void
}

export default function Sidebar({
  ui,
  selection,
  onTogglePause,
  onSpeed,
  onReset,
  onGrant,
  onClearSelection,
  onSave,
  onLoad,
  saveMsg,
  onReclaim,
  onConstruct,
  onAuto,
  onPriority,
  onWorkforce,
  onBuild,
}: Props) {
  const [seedText, setSeedText] = useState('')
  const day = Math.floor(ui.tick / 60) + 1
  const last = ui.history.length > 0 ? ui.history[ui.history.length - 1] : null
  const popWarn = ui.pop >= ui.capacity

  const foodStatus =
    ui.stock.food < 20 ? (
      <em className="status danger">告急</em>
    ) : ui.stock.food < 60 ? (
      <em className="status warn">偏紧</em>
    ) : (
      <em className="status ok">充足</em>
    )
  const woodStatus =
    ui.stock.wood < 30 ? <em className="status warn">待建</em> : <em className="status ok">充足</em>
  const stoneStatus =
    ui.stock.stone < 15 ? <em className="status warn">待建</em> : <em className="status ok">充足</em>

  return (
    <aside className="sidebar">
      {/* 控制 */}
      <section className="panel">
        <div className="control-row">
          <button className="btn btn-primary" disabled={ui.blocked} onClick={onTogglePause}>
            {ui.blocked ? '等待决策 / 结算' : ui.paused ? '▶ 开始' : '⏸ 暂停'}
          </button>
          <div className="segmented" role="group" aria-label="模拟速度">
            {(ui.civilization ? [1, 10, 20, 50, 100, 200] : [1, 2, 5, 10, 20]).map((n) => (
              <button key={n} className={`seg${ui.speed === n ? ' active' : ''}`} onClick={() => onSpeed(n)}>
                {n}×
              </button>
            ))}
          </div>
        </div>
        <div className="seed-row">
          <input
            className="seed-input"
            placeholder="种子（留空随机）"
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter')
                onReset(seedText, ui.civilization ? 'evolution' : ui.campaign ? 'survival' : 'sandbox')
            }}
          />
          <button
            className="btn"
            onClick={() =>
              onReset(seedText, ui.civilization ? 'evolution' : ui.campaign ? 'survival' : 'sandbox')
            }
          >
            重新开始
          </button>
        </div>
        <div className="seed-row">
          <button className="btn save-btn" onClick={onSave}>
            保存存档
          </button>
          <button className="btn save-btn" onClick={onLoad}>
            读取存档
          </button>
          {saveMsg && <span className="save-msg">{saveMsg}</span>}
        </div>
      </section>

      <section className="panel mode-panel">
        <button className="btn" onClick={() => onReset(seedText, 'evolution')}>
          新建大陆文明演化
        </button>
        <div className="mode-buttons">
          <button className="btn" onClick={() => onReset(seedText, 'sandbox')}>
            自由沙盒
          </button>
          <button className="btn" onClick={() => onReset(seedText, 'survival')}>
            首年生存
          </button>
        </div>
        <p className="hint">先保存，再新建。文明演化使用大地图与独立人口模型。</p>
      </section>
      {ui.civilization && (
        <CivilizationPanel
          c={ui.civilization}
          tick={ui.tick}
          stock={ui.stock}
          capacity={ui.capacity}
          onBuild={onConstruct}
          onAuto={onAuto}
          onPriority={onPriority}
        />
      )}
      {ui.campaign && (
        <SurvivalPanel c={ui.campaign} blocked={ui.blocked} onWorkforce={onWorkforce} onBuild={onBuild} />
      )}
      {/* 时间与人口 */}
      <section className="panel">
        <h2 className="panel-title">时间与人口</h2>
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">天数</span>
            <span className="stat-value">第 {day} 天</span>
          </div>
          <div className="stat">
            <span className="stat-label">人口</span>
            <span className={`stat-value${popWarn ? ' full' : ''}`}>
              {ui.pop} / {ui.capacity}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">住房</span>
            <span className="stat-value">
              {ui.campaign ? ui.campaign.houses : ui.buildings} 座{ui.sites > 0 ? ` · ${ui.sites} 在建` : ''}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">出生 / 死亡</span>
            <span className="stat-value">
              {ui.births} / {ui.deaths}
            </span>
          </div>
        </div>
      </section>

      {/* 资源 */}
      <section className="panel">
        <h2 className="panel-title">村庄资源</h2>
        <div className="res-row">
          <i className="swatch" style={{ background: SERIES[1].color }} />
          <span className="res-name">食物</span>
          <span className="res-value">
            {fmt(ui.stock.food)}
            {ui.campaign ? ` / ${ui.campaign.foodCapacity}` : ''}
          </span>
          {foodStatus}
          <button
            disabled={ui.blocked}
            className="btn-mini"
            onClick={() => onGrant('food')}
            title="补充 50 食物"
          >
            +50
          </button>
        </div>
        <div className="res-row">
          <i className="swatch" style={{ background: SERIES[2].color }} />
          <span className="res-name">木材</span>
          <span className="res-value">{fmt(ui.stock.wood)}</span>
          {woodStatus}
          <button
            disabled={ui.blocked}
            className="btn-mini"
            onClick={() => onGrant('wood')}
            title="补充 50 木材"
          >
            +50
          </button>
        </div>
        <div className="res-row">
          <i className="swatch" style={{ background: SERIES[3].color }} />
          <span className="res-name">石头</span>
          <span className="res-value">{fmt(ui.stock.stone)}</span>
          {stoneStatus}
          <button
            disabled={ui.blocked}
            className="btn-mini"
            onClick={() => onGrant('stone')}
            title="补充 50 石头"
          >
            +50
          </button>
        </div>
      </section>

      {ui.campaign && <p className="hint supply-hint">+50 为辅助补给，使用后本局会标记为辅助局。</p>}
      {/* 统计曲线 */}
      <section className="panel">
        <h2 className="panel-title">历史曲线</h2>
        <div className="legend">
          {SERIES.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}
              <b>{last ? fmt(last[s.key]) : '–'}</b>
            </span>
          ))}
        </div>
        <StatsChart history={ui.history} tick={ui.tick} />
      </section>

      {/* 纪事：里程碑与随机事件 */}
      <section className="panel">
        <h2 className="panel-title">纪事</h2>
        {ui.journal.length === 0 ? (
          <p className="hint">尚无大事发生。第一座房屋、季节更替、重要决策……都会记在这里。</p>
        ) : (
          <ul className="journal-list">
            {ui.journal.slice(0, 8).map((e, i) => (
              <li key={`${e.tick}-${i}`} className={e.kind}>
                <span className="j-day">第{Math.floor(e.tick / 60) + 1}天</span>
                <i className="j-dot" />
                <span className="j-text">{e.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 详情 */}
      <section className="panel panel-detail">
        <h2 className="panel-title">
          详情
          {selection && (
            <button className="btn-x" onClick={onClearSelection} title="取消选中">
              ×
            </button>
          )}
        </h2>
        {ui.villager ? (
          <div className="detail">
            <div className="detail-head">
              <span className="v-name">{ui.villager.name}</span>
              <span className="v-task">{ui.villager.alive ? TASK_LABEL[ui.villager.task] : '已故'}</span>
            </div>
            <div className="detail-row">
              <span>职业</span>
              <span>
                {ui.villager.age < 12
                  ? '幼儿'
                  : ui.villager.profession
                    ? PROFESSION_LABEL[ui.villager.profession]
                    : '自由分工'}
              </span>
            </div>
            <div className="detail-row">
              <span>年龄</span>
              <span>{Math.floor(ui.villager.age)} 岁</span>
            </div>
            <div className="detail-row">
              <span>饥饿</span>
              <span className="bar-wrap">
                {bar(ui.villager.hunger, ui.villager.hunger < 30 ? '#c96a4a' : '#7fae4e')}
                <em>{Math.floor(ui.villager.hunger)}</em>
              </span>
            </div>
            <div className="detail-row">
              <span>体力</span>
              <span className="bar-wrap">
                {bar(ui.villager.stamina, '#e0a83c')}
                <em>{Math.floor(ui.villager.stamina)}</em>
              </span>
            </div>
            <div className="detail-row">
              <span>携带</span>
              <span>
                {ui.villager.carry > 0.05 && ui.villager.carryType
                  ? `${Math.floor(ui.villager.carry)} 单位${RESOURCE_LABEL[ui.villager.carryType]}`
                  : '空'}
              </span>
            </div>
          </div>
        ) : ui.tile ? (
          <div className="detail">
            <div className="detail-head">
              <span className="v-name">
                ({ui.tile.x}, {ui.tile.y})
              </span>
              <span className="v-task">{TERRAIN_LABEL[ui.tile.terrain]}</span>
            </div>
            <div className="detail-row">
              <span>地表资源</span>
              <span>{ui.tile.max > 0 ? `${Math.floor(ui.tile.resource)} / ${ui.tile.max}` : '无'}</span>
            </div>
            {ui.tile.max > 0 && (
              <div className="detail-row">{bar((ui.tile.resource / ui.tile.max) * 100, '#7fae4e')}</div>
            )}
            {ui.tile.terrain === GRASS && (
              <button
                className="btn farm-btn"
                disabled={ui.blocked || ui.stock.wood < 5}
                onClick={onReclaim}
                title="农田再生速度是草地的 3 倍，上限 60"
              >
                {ui.stock.wood >= 5
                  ? ui.campaign
                    ? '安排开垦（木材 −5，需建筑工）'
                    : '开垦为农田（木材 −5）'
                  : '开垦需 5 木材'}
              </button>
            )}
            {ui.tile.terrain === 4 && (
              <div className="detail-row">
                <span>耕作等级</span>
                <span className="farm-tag">高产农田 · 再生 ×3</span>
              </div>
            )}
          </div>
        ) : (
          <p className="hint">点击地图上的居民或格子查看详情；拖动平移、双指或滚轮缩放。</p>
        )}
      </section>
    </aside>
  )
}
