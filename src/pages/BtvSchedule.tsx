import { useMemo, useState } from 'react'
import { TopBar } from '../components/AppShell'
import {
  SLOT_LIMIT,
  SOURCE_SHEET_URL,
  scheduleDays,
  zoneLabel,
  type SlotZone,
} from '../data/btvSchedule'
import {
  dayCount,
  diffWithPrev,
  kindLabel,
  massCount,
  monthOf,
  months,
  runRows,
  slotsOf,
  type Slot,
} from '../lib/btvRail'

const ZONES: SlotZone[] = ['pre', 'lib', 'post']

/** 오늘 날짜가 편성표 범위 밖일 수 있으므로, 없으면 첫 날짜를 연다 */
const todayKey = () => {
  const n = new Date()
  return `${n.getMonth() + 1}/${n.getDate()}`
}

function SlotCard({ slot, isNew }: { slot: Slot; isNew: boolean }) {
  return (
    <li className={`rail-card k-${slot.kind}${slot.kind === 'target' ? ' targeted' : ''}`} title={slot.raw}>
      <span className="rail-order">{slot.order}</span>
      <div className="rail-body">
        <div className="rail-name">{slot.name}</div>
        <div className="rail-meta">
          <span className={`rail-kind k-${slot.kind}`}>
            {kindLabel[slot.kind]}
            {slot.reach && ` · ${slot.reach}`}
          </span>
          {slot.period && <span className="mono muted">{slot.period}</span>}
          {slot.kind === 'target' && <span className="rail-only">매스 미노출</span>}
          {isNew && <span className="rail-new">신규</span>}
        </div>
      </div>
    </li>
  )
}

/**
 * 기간 타임라인 — 행이 배너, 열이 날짜. 한 달치를 한 화면에 깔아
 * 겹침·종료일·공백을 한눈에 본다. 막대나 날짜 머리를 누르면 그 날로 이동한다.
 */
function Timeline({
  dayIndexes,
  index,
  onPick,
}: {
  dayIndexes: number[]
  index: number
  onPick: (i: number) => void
}) {
  const rows = useMemo(() => runRows(dayIndexes), [dayIndexes])
  const cols = `200px repeat(${dayIndexes.length}, minmax(16px, 1fr))`
  /** 선택한 날짜 열 — 모든 행에 세로선으로 깔아 그 날 무엇이 걸려 있는지 짚어준다 */
  const cursor = dayIndexes.indexOf(index)

  if (rows.length === 0) return <div className="btv-zone-empty">이 달에는 편성이 없습니다</div>

  return (
    <div className="btv-timeline">
      <div className="tl-row tl-head" style={{ gridTemplateColumns: cols }}>
        <span className="tl-name muted mono">배너 / 콘텐츠</span>
        {dayIndexes.map((di, col) => {
          const d = scheduleDays[di]
          return (
            <button
              key={d.date}
              className={`tl-date${di === index ? ' on' : ''}${
                d.dow === '일' ? ' sun' : d.dow === '토' ? ' sat' : ''
              }`}
              onClick={() => onPick(di)}
              title={`${d.date} ${d.dow} · ${dayCount(d)}건`}
              style={{ gridColumn: col + 2 }}
            >
              {d.date.split('/')[1]}
            </button>
          )
        })}
      </div>

      {rows.map((row) => (
        <div key={row.key} className={`tl-row z-${row.zone}`} style={{ gridTemplateColumns: cols }}>
          <span className="tl-name" title={row.name}>
            <i className={`tl-dot z-${row.zone}`} aria-hidden />
            <span className="nav-ellipsis">{row.name}</span>
          </span>
          {cursor >= 0 && <i className="tl-cursor" style={{ gridColumn: cursor + 2 }} aria-hidden />}
          {row.runs.map((run) => (
            <button
              key={run.from}
              className={`tl-bar z-${row.zone}${row.kind === 'target' ? ' targeted' : ''}`}
              style={{ gridColumn: `${run.from + 2} / ${run.to + 3}` }}
              onClick={() => onPick(dayIndexes[run.from])}
              title={`${row.name} · ${scheduleDays[dayIndexes[run.from]].date}~${
                scheduleDays[dayIndexes[run.to]].date
              } (${run.to - run.from + 1}일)`}
            >
              <span className="tl-bar-days">{run.to - run.from + 1}일</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

export function BtvSchedule() {
  const [month, setMonth] = useState(() => monthOf(todayKey()) || months[0])
  const [index, setIndex] = useState(() => {
    const i = scheduleDays.findIndex((d) => d.date === todayKey())
    return i >= 0 ? i : 0
  })
  const [mode, setMode] = useState<'day' | 'span'>('day')

  const day = scheduleDays[index]
  const diff = useMemo(() => diffWithPrev(index), [index])
  const mass = useMemo(() => massCount(day), [day])
  const visible = useMemo(
    () =>
      scheduleDays.map((d, i) => ({ d, i })).filter(({ d }) => monthOf(d.date) === month),
    [month],
  )
  const dayIndexes = useMemo(() => visible.map((v) => v.i), [visible])

  const zones = ZONES.map((z) => ({ zone: z, slots: slotsOf(day, z) }))

  const pick = (i: number) => {
    setIndex(i)
    const m = monthOf(scheduleDays[i].date)
    if (m !== month) setMonth(m)
  }

  return (
    <>
      <TopBar />
      <div className="content flush sheetzone btv-page">
        <div className="panel-head" style={{ background: 'var(--surface)', flex: 'none' }}>
          <span className="label strong">편성/스케줄 › 홈 › B tv</span>
          <span className="tag solid">Today B tv 스케줄링</span>
          <span className="mono muted" style={{ fontSize: 10.5 }}>
            콘텐츠 앞 {SLOT_LIMIT.pre} · 콘텐츠 {SLOT_LIMIT.lib} · 콘텐츠 뒤 {SLOT_LIMIT.post} 노출 정책
          </span>
          <div className="btv-seg" style={{ marginLeft: 'auto' }}>
            <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>
              하루 레일
            </button>
            <button className={mode === 'span' ? 'on' : ''} onClick={() => setMode('span')}>
              기간 타임라인
            </button>
          </div>
          <a className="btn sm" href={SOURCE_SHEET_URL} target="_blank" rel="noreferrer">
            원본 시트 ↗
          </a>
        </div>

        <div className="btv-split">
          <aside className="btv-days">
            <div className="btv-month-row">
              {months.map((m) => (
                <button
                  key={m}
                  className={`chip${m === month ? ' on' : ''}`}
                  onClick={() => {
                    setMonth(m)
                    const first = scheduleDays.findIndex((d) => monthOf(d.date) === m)
                    if (first >= 0) setIndex(first)
                  }}
                >
                  {m}월
                </button>
              ))}
            </div>
            <div className="btv-day-cap mono muted">막대 = 전체 편성 · 숫자 = 매스 기준</div>
            <div className="btv-day-list">
              {visible.map(({ d, i }) => (
                <button
                  key={d.date}
                  className={`btv-day${i === index ? ' on' : ''}${dayCount(d) === 0 ? ' idle' : ''}`}
                  onClick={() => setIndex(i)}
                >
                  <span className="btv-day-date">
                    {d.date}
                    <em className={d.dow === '일' ? 'sun' : d.dow === '토' ? 'sat' : ''}>{d.dow}</em>
                  </span>
                  <span className="btv-day-bars" aria-hidden>
                    {ZONES.map((z) => (
                      <i key={z} className={`bar z-${z}`} style={{ width: d[z].length * 5 }} />
                    ))}
                  </span>
                  <span className="btv-day-n mono" title={`매스 ${massCount(d).total} · 전체 ${dayCount(d)}`}>
                    {massCount(d).total}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="btv-rail">
            <header className="btv-rail-head">
              <div>
                <h1>
                  {mode === 'day' ? (
                    <>
                      {day.date} <em>{day.dow}요일</em>
                    </>
                  ) : (
                    <>
                      {month}월 <em>편성 기간</em>
                    </>
                  )}
                </h1>
                <p className="mono muted">
                  {mode === 'day'
                    ? `이 날 홈 Today B tv 레일에 1번부터 왼쪽 → 오른쪽으로 넘겨가며 노출됩니다 · 타겟 ${mass.targetOnly}건을 뺀 매스 기준 ${mass.total}개`
                    : '가로는 날짜, 세로는 배너입니다. 빗금 막대는 타겟 배너라 매스 화면에는 안 나옵니다'}
                </p>
              </div>
              {mode === 'day' && (
                <div className="btv-counts">
                  {zones.map(({ zone, slots }) => (
                    <div key={zone} className="btv-count">
                      <b>
                        {mass[zone]}
                        <i>/{slots.length}</i>
                      </b>
                      <span>{zoneLabel[zone]}</span>
                    </div>
                  ))}
                  <div className="btv-count strong" title="타겟 배너는 추출 모수에게만 나가므로 제외한 수">
                    <b>{mass.total}</b>
                    <span>매스 기준 노출</span>
                  </div>
                </div>
              )}
            </header>

            {mode === 'span' ? (
              <Timeline dayIndexes={dayIndexes} index={index} onPick={pick} />
            ) : (
              <>
                {diff.removed.length > 0 && (
                  <div className="btv-ended">
                    <span className="label">전일 종료</span>
                    {diff.removed.map((r) => (
                      <span key={r} className="tag wait">
                        {r}
                      </span>
                    ))}
                  </div>
                )}

                {/* 실제 레일이 좌→우로 넘어가므로 화면도 앞 배너 | 콘텐츠 | 뒤 배너 3열로 눕힌다 */}
                <div className="btv-lanes">
                  {zones.map(({ zone, slots }) => (
                    <div key={zone} className={`btv-lane z-${zone}`}>
                      <div className="btv-zone-head">
                        <span className="label strong">{zoneLabel[zone]}</span>
                        <span
                          className={`mono muted${mass[zone] > SLOT_LIMIT[zone] ? ' over' : ''}`}
                          title={`매스 ${mass[zone]} · 전체 ${slots.length} · 정책 ${SLOT_LIMIT[zone]}`}
                        >
                          매스 {mass[zone]} / 전체 {slots.length} · 정책 {SLOT_LIMIT[zone]}
                        </span>
                      </div>
                      {slots.length === 0 ? (
                        <div className="btv-zone-empty">편성 없음</div>
                      ) : (
                        <ol className="rail-cards lane">
                          {slots.map((s) => (
                            <SlotCard
                              key={`${s.zone}-${s.order}`}
                              slot={s}
                              isNew={diff.added.has(day[zone][s.order - 1])}
                            />
                          ))}
                        </ol>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
