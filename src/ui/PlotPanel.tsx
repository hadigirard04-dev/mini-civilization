import { useEffect, useRef } from 'react'
import StatsChart from './StatsChart'
import { ERAS, ERA_SUBTITLES, POLICY } from '../sim/plot/config'
import { ZONE_LABELS } from '../sim/plot/blocks'
import { RES_LABELS } from '../sim/plot/economy'
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
  onNewMode: (mode: 'plot' | 'sandbox' | 'survival') => void
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
              {view.stats.residentialBlocks + view.stats.agricultureBlocks + view.stats.industryBlocks + view.stats.civicBlocks}
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

      <section className="panel">
        <div className="panel-title">聚落</div>
        {view.settlements.map((s) => (
          <div className="detail-row" key={s.id}>
            <span className="farm-tag">{s.name}</span>
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
        <div className="panel-title">政策</div>
        <div className="segmented">
          {POLICIES.map((p) => (
            <button key={p} className={view.policy === p ? 'active' : ''} onClick={() => props.onPolicy(p)}>
              {POLICY[p].name}
            </button>
          ))}
        </div>
        <div className="hint">政策改变规划器权重：粮食偏农业、扩张偏修路、研究偏学校、宜居偏公园与诊所。</div>
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
              {selection.civic ? selection.civic : selection.industry ? selection.industry : `等级 ${selection.density}`}
            </span>
          </div>
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
                {selection.construction.kind} {(selection.construction.progress * 100).toFixed(0)}%
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
            人口密度与地价决定这里能长到几级；工业与住宅不得相邻。
          </div>
        </section>
      )}
    </aside>
  )
}
