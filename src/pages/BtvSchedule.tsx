import { useMemo, useState } from 'react'
import { TopBar } from '../components/AppShell'
import {
  SLOT_LIMIT,
  SOURCE_SHEET_URL,
  scheduleDays,
  zoneLabel,
  type SlotZone,
} from '../data/btvSchedule'
import { dayCount, diffWithPrev, kindLabel, monthOf, months, slotsOf, type Slot } from '../lib/btvRail'

const ZONES: SlotZone[] = ['pre', 'lib', 'post']

/** 오늘 날짜가 편성표 범위 밖일 수 있으므로, 없으면 첫 날짜를 연다 */
const todayKey = () => {
  const n = new Date()
  return `${n.getMonth() + 1}/${n.getDate()}`
}

function SlotCard({ slot, isNew }: { slot: Slot; isNew: boolean }) {
  return (
    <li className={`rail-card k-${slot.kind}`} title={slot.raw}>
      <span className="rail-order">{slot.order}</span>
      <div className="rail-body">
        <div className="rail-name">{slot.name}</div>
        <div className="rail-meta">
          <span className={`rail-kind k-${slot.kind}`}>
            {kindLabel[slot.kind]}
            {slot.reach && ` · ${slot.reach}`}
          </span>
          {slot.period && <span className="mono muted">{slot.period}</span>}
          {isNew && <span className="rail-new">신규</span>}
        </div>
      </div>
    </li>
  )
}

export function BtvSchedule() {
  const [month, setMonth] = useState(() => monthOf(todayKey()) || months[0])
  const [index, setIndex] = useState(() => {
    const i = scheduleDays.findIndex((d) => d.date === todayKey())
    return i >= 0 ? i : 0
  })

  const day = scheduleDays[index]
  const diff = useMemo(() => diffWithPrev(index), [index])
  const visible = scheduleDays
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => monthOf(d.date) === month)

  const zones = ZONES.map((z) => ({ zone: z, slots: slotsOf(day, z) }))

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
          <a
            className="btn sm"
            style={{ marginLeft: 'auto' }}
            href={SOURCE_SHEET_URL}
            target="_blank"
            rel="noreferrer"
          >
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
                  <span className="btv-day-n mono">{dayCount(d)}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="btv-rail">
            <header className="btv-rail-head">
              <div>
                <h1>
                  {day.date} <em>{day.dow}요일</em>
                </h1>
                <p className="mono muted">
                  이 날 홈 Today B tv 레일에 위에서부터 순서대로 노출되는 구성입니다
                </p>
              </div>
              <div className="btv-counts">
                {zones.map(({ zone, slots }) => (
                  <div key={zone} className="btv-count">
                    <b>{slots.length}</b>
                    <span>{zoneLabel[zone]}</span>
                  </div>
                ))}
              </div>
            </header>

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

            {zones.map(({ zone, slots }) => (
              <div key={zone} className={`btv-zone z-${zone}`}>
                <div className="btv-zone-head">
                  <span className="label strong">{zoneLabel[zone]}</span>
                  <span className="mono muted">
                    {slots.length} / 정책 {SLOT_LIMIT[zone]}
                  </span>
                </div>
                {slots.length === 0 ? (
                  <div className="btv-zone-empty">편성 없음</div>
                ) : (
                  <ol className="rail-cards">
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
          </section>
        </div>
      </div>
    </>
  )
}
