import {
  CIVIC_YEAR_TICKS,
  ERAS,
  ERA_SUBTITLES,
  type CivilizationView,
  type ConstructionKind,
} from '../sim/civilization'
import type { Stock } from '../sim/types'
interface Props {
  c: CivilizationView
  tick: number
  stock: Stock
  capacity: number
  onBuild: (kind: ConstructionKind) => void
  onAuto: () => void
  onPriority: (p: CivilizationView['priority']) => void
}
export default function CivilizationPanel({ c, tick, stock, capacity, onBuild, onAuto, onPriority }: Props) {
  const days = Math.floor(tick / 60),
    year = Math.floor(tick / CIVIC_YEAR_TICKS) + 1
  return (
    <>
      <section className="panel evolution-panel">
        <div className="chapter-label">CIVILIZATION / 大陆文明演化</div>
        <h2 className="chapter-title">{ERAS[c.era]}</h2>
        <p className="hint">
          {ERA_SUBTITLES[c.era]} · 第 {year} 年，第 {(days % 365) + 1} 天
        </p>
        <div className="era-track">
          {ERAS.map((name, i) => (
            <span className={i === c.era ? 'current' : i < c.era ? 'done' : ''} key={name}>
              {i + 1}
              <small>{name}</small>
            </span>
          ))}
        </div>
        <div className="city-stats">
          <div>
            城市建筑<b>{c.buildings}</b>
          </div>
          <div>
            人口 / 容量
            <b>
              {c.population} / {capacity}
            </b>
          </div>
          <div>
            知识<b>{Math.floor(c.knowledge)}</b>
          </div>
          <div>
            钢材<b>{Math.floor(c.steel)}</b>
          </div>
        </div>
        {c.requirements.length > 0 ? (
          <>
            <h3 className="next-era">下一时代 · {ERAS[c.era + 1]}</h3>
            <div className="era-requirements">
              {c.requirements.map((r) => (
                <span className={r.met ? 'met' : ''} key={r.label}>
                  {r.met ? '✓' : '○'} {r.label} {Math.floor(r.value)} / {r.target}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="hint">现代阶段已开启。继续扩建住宅、服务设施与电站，吸引人口，形成更大的城区。</p>
        )}
        <p className="hint">
          256 × 256 大陆；时代由知识、人口和已建成设施解锁。旧住宅会施工升级，城区持续向外扩展。
        </p>
      </section>
      <section className="panel">
        <h2 className="panel-title">人口来源</h2>
        <div className="city-stats">
          <div>
            累计出生<b>{c.demographics.births}</b>
          </div>
          <div>
            累计迁入<b>{c.immigrants}</b>
          </div>
          <div>
            累计死亡<b>{c.demographics.deaths}</b>
          </div>
          <div>
            妊娠中<b>{c.demographics.pregnant}</b>
          </div>
        </div>
        <p className="hint">
          未成年 {c.demographics.children} · 成年 {c.demographics.adults} · 老年 {c.demographics.elderly}
        </p>
        <p className="hint">
          游戏历一年 365 天；18 岁成年。妊娠 270 天，产后间隔至少 2 年。迁入每 30
          天检查岗位、住房与口粮，区域迁入人口池剩余 {c.migrationPool} 人。
        </p>
      </section>
      <section className="panel">
        <h2 className="panel-title">城市发展</h2>
        <button className="btn auto-build" onClick={onAuto}>
          {c.autoBuild ? '✓ 自主建设开启' : '自主建设已暂停'}
        </button>
        <div className="development-priority">
          {(
            [
              ['balanced', '均衡'],
              ['food', '粮食'],
              ['growth', '扩张'],
              ['science', '研究'],
            ] as const
          ).map(([key, label]) => (
            <button
              className={`btn ${c.priority === key ? 'btn-primary' : ''}`}
              key={key}
              onClick={() => onPriority(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint">
          研究岗位 {c.jobs.research} · 工业岗位 {c.jobs.industry} · 道路 {c.roadTiles} 格
        </p>
        <p className="hint">
          电力 {c.electricity.supply.toFixed(0)} / {c.electricity.demand.toFixed(1)} · 供电率{' '}
          {(c.electricity.ratio * 100).toFixed(0)}%
        </p>
        <p className="hint">
          工业时代开始，供电会驱动农田机械化；停电也会压低粮食产能。地下矿藏剩余 {Math.floor(c.oreReserve)}。
        </p>
        <details className="civic-catalog">
          <summary>建设设施 / 解锁条件</summary>
          <div className="build-grid">
            {c.catalog
              .filter((b) => b.kind !== 'campfire')
              .map((b) => (
                <button
                  key={b.kind}
                  className="build-card"
                  disabled={
                    c.era < b.era || stock.wood < b.wood || stock.stone < b.stone || c.steel < b.steel
                  }
                  onClick={() => onBuild(b.kind)}
                >
                  <b>
                    {b.name} · {b.count}
                  </b>
                  <span>{c.era < b.era ? `${ERAS[b.era]}解锁` : b.effect}</span>
                  <small>
                    木 {b.wood} · 石 {b.stone}
                    {b.steel ? ` · 钢 ${b.steel}` : ''}
                  </small>
                </button>
              ))}
            {(['house', 'farm', 'granary', 'farmhouse'] as const).map((k, i) => (
              <button className="btn" key={k} onClick={() => onBuild(k)}>
                {['住房', '农田', '粮仓', '农舍'][i]}
              </button>
            ))}
          </div>
        </details>
      </section>
    </>
  )
}
