import { useEffect, useRef } from 'react'
import StatsChart from './StatsChart'
import { CIVIC_SPEC, ERAS, ERA_SUBTITLES, INDUSTRY_SPEC, POLICY } from '../sim/plot/config'
import { ZONE_LABELS } from '../sim/plot/blocks'
import { civicCapacityOf, RES_LABELS } from '../sim/plot/economy'
import type { PlotView } from '../sim/plot/sim'
import type { Block, Overlay, Policy, Res } from '../sim/plot/types'
import type { Camera } from '../render/camera'
import type { View } from '../render/draw'
import type { PlotState } from '../sim/plot/types'
import { drawPlotMiniMap } from '../render/plot'

const OVERLAYS: Array<{ key: Overlay; label: string }> = [
  { key: 'none', label: '无' },
  { key: 'zone', label: '分区' },
  { key: 'coverage', label: '服务覆盖' },
  { key: 'landValue', label: '地价' },
  { key: 'pollution', label: '污染' },
]

const POLICIES: Policy[] = ['balanced', 'food', 'growth', 'science', 'livable']
const ZONE_HINTS: Record<Block['zone'], string> = {
  none: '临路土地按实际需求开发；采集林地承担城市的原料供给。',
  residential: '人口、相邻住宅与地价同时达标后才会升高，高层集中在成熟街区。',
  agriculture: '田地随粮食需求扩产；物流与供电影响实际收成。',
  industry: '产能与库存决定是否开工；闲置厂地可改作公共设施或复育林地。',
  civic: '公共设施可在原址扩建，优先填补有居民的服务缺口。',
  park: '公园改善附近地价，让发展中的住宅区保留绿地。',
}
const POLICY_DETAILS: Record<Policy, string> = {
  balanced: '兼顾生产、建设与服务；粮食充足时，让劳动力转入其他岗位。',
  food: '农业产能 +25%，储备目标 40 天；投入更多劳动力保粮，建设与研究会放缓。',
  growth: '修路预算 +40%，分区预算 +30%；更快消耗木石，仍受实际住房与就业需求约束。',
  science: '学校优先级与知识产出 +50%；农业产能 −10%，先确认粮食能持续供给。',
  livable: '增加公园与诊所的优先级和规划名额；占用土地、材料与服务人员，换取本地地价与生活条件。',
}

interface Props {
  view: PlotView
  state: PlotState
  cam: Camera
  canvasView: View
  fps: number
  runtimeSpeed: number
  selection: Block | null
  saveMsg: string
  onTogglePause: () => void
  onSpeed: (n: number) => void
  onReset: (seed: string) => void
  onSave: () => void
  onLoad: () => void
  onPolicy: (p: Policy) => void
  onOverlay: (o: Overlay) => void
  onFollow: () => void
  onCityOverview: () => void
  onContinent: () => void
  onSettlement: (id: number) => void
  onNewMode: (mode: 'plot' | 'sandbox' | 'survival') => void
  onLoadLegacy: () => void
  legacyAvailable: boolean
}

function bar(value: number, color: string): React.ReactNode {
  return (
    <div className="bar-wrap">
      <div className="bar" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, background: color }} />
    </div>
  )
}

function formatRequirement(r: { label: string; value: number; target: number; met: boolean }): string {
  const isPercent = r.target === 70 || r.target === 90
  const isFloat = r.target < 5 && !Number.isInteger(r.value)
  const value = isFloat ? r.value.toFixed(2) : Math.round(r.value).toLocaleString('zh-CN')
  const target = isFloat ? r.target.toFixed(2) : String(r.target)
  return `${value} / ${target}${isPercent ? '%' : ''}`
}

function constructionLabel(kind: string): string {
  if (kind === 'upgrade') return '原址扩建'
  if (kind === 'restore:forest') return '复育林地'
  const [action, name] = kind.split(':')
  if (action === 'civic' || action === 'redevelop') return `${action === 'redevelop' ? '改造为' : '建设'}${CIVIC_SPEC[name as keyof typeof CIVIC_SPEC]?.name ?? '公共设施'}`
  if (action === 'industry') return `建设${INDUSTRY_SPEC[name as keyof typeof INDUSTRY_SPEC]?.name ?? '工业设施'}`
  return `建设${ZONE_LABELS[name as keyof typeof ZONE_LABELS] ?? '地块'}`
}

export default function PlotPanel(props: Props) {
  const { view, state, selection } = props
  const miniRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = miniRef.current
    if (!canvas) return
    drawPlotMiniMap(canvas, state, props.cam, props.canvasView)
  }, [state, props.cam, props.canvasView, view.tick])

  const ledger = view.ledger
  const status = (ok: boolean): string => (ok ? 'ok' : 'warn')

  return (
    <aside className="sidebar">
      <section className="panel">
        <div className="panel-title">模拟</div>
        <button className="btn btn-primary" onClick={props.onTogglePause}>
          {view.paused ? '▶ 开始' : '‖ 暂停'}
        </button>
        <div className="segmented">
          {[1, 10, 20, 50, 100, 200].map((n) => (
            <button key={n} className={view.speed === n ? 'active' : ''} onClick={() => props.onSpeed(n)}>
              {n}×
            </button>
          ))}
        </div>
        <div className="hint">
          {props.fps} FPS · 实速 {props.runtimeSpeed.toFixed(1)}× / 目标 {view.speed}×
        </div>
        <div className="seed-row">
          <input className="seed-input" defaultValue={view.seed} key={view.seed} onKeyDown={(e) => {
            if (e.key === 'Enter') props.onReset((e.target as HTMLInputElement).value)
          }} />
          <button className="btn" onClick={(e) => {
            const input = (e.currentTarget.previousSibling as HTMLInputElement | null)?.value ?? ''
            props.onReset(input)
          }}>
            重新开始
          </button>
        </div>
        <div className="control-row">
          <button className="btn" onClick={props.onSave}>
            保存存档
          </button>
          <button className="btn" onClick={props.onLoad}>
            读取存档
          </button>
        </div>
        {props.saveMsg && <div className="save-msg">{props.saveMsg}</div>}
        {props.legacyAvailable && (
          <button className="btn" onClick={props.onLoadLegacy}>
            继续旧存档（沙盒 / 首年）
          </button>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">地块文明 · 大陆演化</div>
        <div className="detail-head">
          {ERAS[view.era]} · 第 {view.year} 年 第 {(view.day % 365) + 1} 天
        </div>
        <div className="hint">{ERA_SUBTITLES[view.era]}</div>
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">人口</span>
            <span className="stat-value">{Math.round(view.population).toLocaleString('zh-CN')}</span>
          </div>
          <div className="stat">
            <span className="stat-label">住房 / 入住</span>
            <span className="stat-value">
              {view.stats.housingCapacity > 0
                ? `${view.stats.housingCapacity} / ${Math.round((view.population / view.stats.housingCapacity) * 100)}%`
                : '尚无住房'}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">聚落</span>
            <span className="stat-value">{view.settlements.length}</span>
          </div>
          <div className="stat">
            <span className="stat-label">地块（已开发）</span>
            <span className="stat-value">
              {state.blocks.reduce((n, b) => n + Number(b.zone !== 'none'), 0)}
            </span>
          </div>
        </div>
        {view.requirements.length > 0 ? (
          <div className="detail">
            <div className="detail-head">下一时代条件（城市形态）</div>
            {view.requirements.map((r) => (
              <div className="detail-row" key={r.label}>
                <span className={r.met ? 'status ok' : 'status warn'}>{r.met ? '✓' : '○'}</span>
                <span>{r.label}</span>
                <span className="v-name">{formatRequirement(r)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="hint">已到现代都市：继续扩张、提高地价，形成都市带。</div>
        )}
        <div className="mode-buttons">
          <button className="btn" onClick={() => props.onNewMode('plot')}>
            大陆演化
          </button>
          <button className="btn" onClick={() => props.onNewMode('sandbox')}>
            自由沙盒
          </button>
          <button className="btn" onClick={() => props.onNewMode('survival')}>
            首年生存
          </button>
        </div>
      </section>

      <section className="panel development-panel" aria-label="发展观察">
        <div className="panel-title">发展观察</div>
        <div className="detail-head" role="status">{view.development.title}</div>
        <p className="development-reason">{view.development.reason}</p>
        <div className="segmented" aria-label="发展政策">
          {POLICIES.map((p) => (
            <button key={p} className={view.policy === p ? 'active' : ''} aria-pressed={view.policy === p} onClick={() => props.onPolicy(p)}>
              {POLICY[p].name}
            </button>
          ))}
        </div>
        <div className="policy-effect" aria-live="polite"><b>当前：{POLICY[view.policy].name}</b>{POLICY_DETAILS[view.policy]}</div>
        <div className="hint">下一日更新配工与产出，下一轮更新建设安排。</div>
        <div className="development-facts">
          <span>在建 <b>{view.development.construction}</b> 项</span>
          <span>待规划 <b>{view.development.nextPlanDays}</b> 天</span>
          <span>在建住房 <b>{Math.round(view.development.pendingHousing)}</b> 名额</span>
          <span>未在岗 <b>{Math.round(view.development.unemployed)}</b> 人</span>
        </div>
        {view.development.recommendation && view.development.recommendation !== view.policy && (
          <button className="btn" onClick={() => props.onPolicy(view.development.recommendation!)}>
            采用{POLICY[view.development.recommendation].name}政策
          </button>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">聚落</div>
        {view.settlements.map((s) => (
          <div className="detail-row" key={s.id}>
            <button className="settlement-focus" onClick={() => props.onSettlement(s.id)} aria-label={`查看${s.name}`}>{s.name} ↗</button>
            <span>{Math.round(s.population)} 人</span>
            <span className="v-name">
              {s.blocks.length} 块 · 岗位 {Math.round(s.jobs)} · {s.links.length > 0 ? '已连通' : '未连通'}
            </span>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel-title">资源（每日产 / 耗）</div>
        {(['food', 'wood', 'stone', 'steel'] as Res[]).map((res) => (
          <div className="res-row" key={res}>
            <span className="res-name">{RES_LABELS[res]}</span>
            <span className="res-value">
              {Math.round(ledger[res]).toLocaleString('zh-CN')}
              <span className="hint">
                {' '}
                +{ledger.production[res].toFixed(1)} / −{ledger.consumption[res].toFixed(1)}
              </span>
            </span>
          </div>
        ))}
        <div className="res-row">
          <span className="res-name">电力</span>
          <span className="res-value">
            {view.power.supply.toFixed(0)} / {view.power.demand.toFixed(0)}
            <span className="hint"> 覆盖 {(view.power.ratio * 100).toFixed(0)}%</span>
          </span>
        </div>
        {view.era >= 2 && <div className="hint">电力为实际发电 / 需求 · 装机容量 {view.power.capacity.toFixed(0)}</div>}
        <div className="res-row">
          <span className="res-name">知识</span>
          <span className="res-value">{Math.round(ledger.knowledge).toLocaleString('zh-CN')}</span>
        </div>
        <div className="hint">
          粮食 {view.foodDays.toFixed(0)} 天 · 仓储上限 {view.storageDays.toFixed(0)} 天 · 矿藏剩余 {Math.round(ledger.oreReserve)}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">人口与就业</div>
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">未成年</span>
            <span className="stat-value">{Math.round(ledger.children)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">成年</span>
            <span className="stat-value">{Math.round(ledger.adults)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">老年</span>
            <span className="stat-value">{Math.round(ledger.elderly)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">岗位 / 在岗</span>
            <span className="stat-value">
              {Math.round(view.jobs.total)} / {Math.round(view.jobs.staffed)}
            </span>
          </div>
        </div>
        <div className="hint">
          累计出生 {ledger.births} · 死亡 {ledger.deaths} · 迁入 {ledger.immigrants}（外部人口池 {Math.round(ledger.migrationPool)}）
        </div>
        <div className="hint">
          覆盖率：市场 {(view.coverage.market * 100).toFixed(0)}% · 学校 {(view.coverage.school * 100).toFixed(0)}% · 诊所{' '}
          {(view.coverage.clinic * 100).toFixed(0)}% · 公园 {(view.coverage.park * 100).toFixed(0)}% · 供水{' '}
          {(view.coverage.water * 100).toFixed(0)}%
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">图层</div>
        <div className="segmented">
          {OVERLAYS.map((o) => (
            <button key={o.key} className={view.overlay === o.key ? 'active' : ''} onClick={() => props.onOverlay(o.key)}>
              {o.label}
            </button>
          ))}
        </div>
        <canvas ref={miniRef} width={256} height={256} style={{ width: '100%', imageRendering: 'pixelated', marginTop: 8 }} />
        <div className="hint">浅色为已开发地块，深色线条为路网。</div>
      </section>

      <section className="panel">
        <div className="panel-title">历史曲线</div>
        <StatsChart history={view.history} tick={view.tick} />
      </section>

      <section className="panel">
        <div className="panel-title">纪事</div>
        <div className="journal-list">
          {view.journal.slice(0, 12).map((j, i) => (
            <div className="detail-row" key={`${j.tick}-${i}`}>
              <span className="j-day">第 {Math.floor(j.tick / 60)} 天</span>
              <span className="j-dot" />
              <span className="j-text">{j.text}</span>
            </div>
          ))}
        </div>
      </section>

      {selection && (
        <section className="panel panel-detail">
          <div className="panel-title">地块 ({selection.bx}, {selection.by})</div>
          <div className="detail-row">
            <span>{ZONE_LABELS[selection.zone]}</span>
            <span className="v-name">
              {selection.civic ? `${CIVIC_SPEC[selection.civic].name} · ${selection.density} 级` : selection.industry ? INDUSTRY_SPEC[selection.industry].name : `等级 ${selection.density}`}
            </span>
          </div>
          {(selection.zone === 'civic' || selection.zone === 'park') && selection.density > 0 && (
            <div className="detail-row"><span>设施规模</span><span className="v-name">{civicCapacityOf(selection)} 份服务能力 · 可在原址扩建</span></div>
          )}
          <div className="detail-row">
            <span>人口 / 岗位</span>
            <span className="v-name">
              {Math.round(selection.population)} / {Math.round(selection.jobs)}（在岗 {Math.round(selection.staffed)}）
            </span>
          </div>
          <div className="detail-row">
            <span>地价</span>
            <span className="v-name">
              {selection.landValue.toFixed(2)} {bar(selection.landValue, '#e0a83c')}
            </span>
          </div>
          <div className="detail-row">
            <span>物流系数</span>
            <span className="v-name">{selection.logistics.toFixed(2)}</span>
          </div>
          <div className="detail-row">
            <span>污染</span>
            <span className="v-name">{selection.pollution.toFixed(2)}</span>
          </div>
          <div className="detail-row">
            <span>服务</span>
            <span className="v-name">
              市 {(selection.covered.market * 100).toFixed(0)} · 学 {(selection.covered.school * 100).toFixed(0)} · 医{' '}
              {(selection.covered.clinic * 100).toFixed(0)} · 园 {(selection.covered.park * 100).toFixed(0)} · 水{' '}
              {(selection.covered.water * 100).toFixed(0)}
            </span>
          </div>
          {selection.construction && (
            <div className="detail-row">
              <span>在建</span>
              <span className="v-name">
                {constructionLabel(selection.construction.kind)} {(selection.construction.progress * 100).toFixed(0)}%
              </span>
            </div>
          )}
          <div className="detail-row">
            <span>地形</span>
            <span className="v-name">
              {selection.hasWater ? '临水 ' : ''}
              {selection.hasForest ? '林地 ' : ''}
              {selection.hasOre ? '矿脉 ' : ''}
              {selection.buildable ? '可建' : '不可建'}
            </span>
          </div>
          <div className={`hint status ${status(selection.buildable)}`}>
            {ZONE_HINTS[selection.zone]}
          </div>
        </section>
      )}
    </aside>
  )
}
