import { useEffect, useRef } from 'react'
import { BUILDINGS, EVENTS, SEASONS, type BuildingKind, type SurvivalView } from '../sim/survival'

interface Props {
  c: SurvivalView
  blocked: boolean
  onWorkforce: (farmers: number, builders: number) => void
  onBuild: (kind: BuildingKind) => void
}
export default function SurvivalPanel({ c, blocked, onWorkforce, onBuild }: Props) {
  const w = c.workforce
  const winter = c.season === 3
  return (
    <>
      <section className={`panel campaign-panel season-${c.season}`}>
        <div className="chapter-label">FIRST WINTER / 首年生存</div>
        <h2 className="chapter-title">让村庄活过这个冬天</h2>
        <p className="hint">第一年结束时至少存活 20 人。建设与分工由你决定。</p>
        <div className="season-track" aria-label="季节进度">
          {SEASONS.map((s, i) => (
            <span key={s} className={c.season === i ? 'current' : ''}>
              {s}
            </span>
          ))}
        </div>
        <div className="season-caption">
          <b>
            第 {c.year} 年 · {SEASONS[c.season]}季 · 第 {c.day} 天
          </b>
          <span>{winter ? `距年末 ${c.daysLeft} 天` : `距入冬 ${c.winterIn} 天`}</span>
        </div>
        <div className="reserve-box">
          <div>
            <span>现有口粮可支撑</span>
            <b className={c.coverDays < 5 ? 'danger-text' : ''}>
              {c.coverDays.toFixed(1)} <small>个冬季日</small>
            </b>
          </div>
          <progress aria-label="冬季储粮进度" value={c.stock.food} max={c.reserveTarget || 1} />
          <p>
            30 天保守储粮目标 {c.reserveTarget} · 仓容 {c.foodCapacity}
          </p>
        </div>
        <p className="hint">此估计不含未来采收。冬季消耗 +40%，采收降至 30%。粮仓满后，溢出食物无法保存。</p>
        {c.assisted && <p className="assist-tag">本局使用过补给 · 结算会标记为辅助局</p>}
      </section>
      <section className="panel">
        <h2 className="panel-title">
          分配劳动力 <span className="section-meta">{w.adults} 名成人</span>
        </h2>
        {(['farmers', 'builders'] as const).map((key) => {
          const value = w[key]
          const name = key === 'farmers' ? '农夫' : '建筑工'
          return (
            <div className={`worker-row ${key}`} key={key}>
              <div>
                <b>{name}</b>
                <small>{key === 'farmers' ? '采收食物，优先农田' : '施工；闲时采木石'}</small>
              </div>
              <div className="stepper">
                <button
                  aria-label={`减少${name}`}
                  disabled={blocked || value === 0}
                  onClick={() =>
                    onWorkforce(
                      key === 'farmers' ? value - 1 : w.farmers,
                      key === 'builders' ? value - 1 : w.builders,
                    )
                  }
                >
                  −
                </button>
                <output aria-label={`${name}人数`}>{value}</output>
                <button
                  aria-label={`增加${name}`}
                  disabled={blocked || w.gatherers === 0}
                  onClick={() =>
                    onWorkforce(
                      key === 'farmers' ? value + 1 : w.farmers,
                      key === 'builders' ? value + 1 : w.builders,
                    )
                  }
                >
                  +
                </button>
              </div>
            </div>
          )
        })}
        <div className="worker-row gatherers">
          <div>
            <b>采集者</b>
            <small>剩余成人自动采集木材和石头</small>
          </div>
          <output>{w.gatherers}</output>
        </div>
        <p className="hint">幼儿不工作。多一名农夫，就少一名采集建材的人。建筑工为 0 时，工地停工。</p>
      </section>
      <section className="panel">
        <h2 className="panel-title">
          村庄建设 <span className="section-meta">{c.sites.length} / 4 在建</span>
        </h2>
        <div className="building-counts">
          住房 {c.houses} · 粮仓 {c.granaries} · 农舍 {c.farmhouses} · 农田 {c.farms}
        </div>
        <div className="build-grid">
          {(Object.keys(BUILDINGS) as BuildingKind[]).map((kind) => {
            const b = BUILDINGS[kind]
            return (
              <button
                key={kind}
                className={`build-card ${kind}`}
                disabled={blocked || c.sites.length >= 4 || c.stock.wood < b.wood || c.stock.stone < b.stone}
                onClick={() => onBuild(kind)}
              >
                <b>{b.name}</b>
                <span>{b.effect}</span>
                <small>
                  木材 {b.wood}
                  {b.stone ? ` · 石头 ${b.stone}` : ''}
                </small>
              </button>
            )
          })}
        </div>
        {c.sites.map((s) => (
          <div className="site-row" key={s.id}>
            <span>
              {BUILDINGS[s.type ?? 'house'].name} · {Math.floor(s.progress * 100)}%
            </span>
            <span>{s.builderId === null ? '等候建筑工' : '施工中'}</span>
          </div>
        ))}
        {c.sites.length > 0 && w.builders === 0 && (
          <p className="danger-text">没有建筑工。先分配至少 1 人。</p>
        )}
        <p className="hint">点建筑立即扣料，由建筑工施工。开局先建农田，粮仓让夏秋积粮有地方存。</p>
      </section>
    </>
  )
}

interface DialogProps {
  c: SurvivalView | null
  population: number
  capacity: number
  onChoice: (choice: number) => void
  onContinue: () => void
  onRestart: () => void
}
export function CampaignDialog({ c, population, capacity, onChoice, onContinue, onRestart }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const result = c?.result && !c.continued ? c.result : null
  const event = EVENTS.find((e) => e.id === c?.pendingEvent)
  const visible = !!event || !!result
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (visible && !el.open) el.showModal()
    else if (!visible && el.open) el.close()
  }, [visible])
  if (!c) return null
  return (
    <dialog
      ref={ref}
      className="campaign-dialog"
      aria-labelledby="decision-title"
      onCancel={(e) => e.preventDefault()}
    >
      {event ? (
        <>
          <span className="chapter-label">VILLAGE COUNCIL / 时间已暂停</span>
          <h2 id="decision-title">{event.title}</h2>
          <p>{event.text}</p>
          <div className="decision-stats">
            口粮 {Math.floor(c.stock.food)} / {c.foodCapacity} · 木材 {Math.floor(c.stock.wood)} · 空余住房{' '}
            {Math.max(0, capacity - population)}
          </div>
          <div className="decision-options">
            {event.choices.map((choice, i) => {
              const housing = event.id === 'refugees' && i === 0 && capacity - population < 5
              const unavailable = c.stock.food < choice.food || c.stock.wood < choice.wood || housing
              const reason = housing
                ? '空余住房不足 5 人'
                : c.stock.food < choice.food
                  ? '食物不足'
                  : c.stock.wood < choice.wood
                    ? '木材不足'
                    : ''
              return (
                <button
                  key={i}
                  onClick={() => onChoice(i)}
                  disabled={unavailable}
                  className="decision-option"
                >
                  <b>{choice.label}</b>
                  <span>{choice.detail}</span>
                  {reason && <small>{reason}</small>}
                </button>
              )
            })}
          </div>
          <p className="hint">做出选择后按原速度继续；决定会写入首年纪事。</p>
        </>
      ) : result ? (
        <>
          <span className="chapter-label">YEAR ONE / {result.assisted ? '辅助局结算' : '首年结算'}</span>
          <h2 id="decision-title">{result.won ? '你守住了这个村庄' : '这个冬天，没有守住所有人'}</h2>
          <p>
            {result.won
              ? '第一年结束，村庄仍有至少 20 人。可以继续发展，也可以用同一种子检验另一套决策。'
              : '目标是年末至少存活 20 人。重新分配劳动力，尽早建设粮仓，为冬季留出储备。'}
          </p>
          <div className="result-grid">
            <div>
              存活人口<b>{result.population}</b>
            </div>
            <div>
              饿死 / 老死
              <b>
                {result.starveDeaths} / {result.ageDeaths}
              </b>
            </div>
            <div>
              最低储粮<b>{Math.floor(result.minFood)}</b>
            </div>
            <div>
              结束储粮<b>{Math.floor(result.food)}</b>
            </div>
          </div>
          <ul className="decision-history">
            {result.decisions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
          <div className="result-actions">
            <button className="btn btn-primary" onClick={onRestart}>
              同一种子再试
            </button>
            <button className="btn" onClick={onContinue}>
              继续发展
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  )
}
