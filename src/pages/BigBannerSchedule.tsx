import { useMemo, useState } from 'react'
import { TopBar } from '../components/AppShell'
import {
  SCHEDULE_YEAR,
  SOURCE_SHEET_URL,
  bigBannerDays,
} from '../data/bigBannerSchedule'
import {
  dayCount,
  diffWithPrev,
  indexOfBase,
  indexesFrom,
  monthOf,
  months,
  runRows,
  slotsOf,
  tagList,
  type BigSlot,
} from '../lib/bigBannerRail'

/** 조회기준일 — 편성표에 연도가 없으므로 m/d로 맞춘다 */
const todayKey = () => {
  const n = new Date()
  return `${n.getMonth() + 1}/${n.getDate()}`
}

function BannerCard({ slot, isNew }: { slot: BigSlot; isNew: boolean }) {
  const { banner } = slot
  return (
    <li className={`big-card${slot.isEvent ? ' evt' : ''}`}>
      <span className="big-order">{slot.order}</span>
      <div className="big-body">
        <div className="big-title">
          {slot.name}
          {slot.period && <span className="mono muted"> {slot.period}</span>}
          {isNew && <span className="rail-new">신규</span>}
        </div>
        {banner.copy && <p className="big-copy">{banner.copy}</p>}
        {banner.tags && (
          <div className="big-tags">
            {tagList(banner.tags).map((t, i) => (
              <span key={`${t}-${i}`} className="big-tag">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="big-meta mono muted">
          {banner.landing && <span title="랜딩">→ {banner.landing}</span>}
          <span className={slot.onAir ? 'big-air on' : 'big-air'} title={banner.air || 'air 편성여부 미기재'}>
            air {slot.onAir ? 'O' : banner.air.trim() || '-'}
          </span>
          {banner.image && (
            <span className="big-img" title={banner.image}>
              {banner.image.startsWith('http') ? (
                <a href={banner.image} target="_blank" rel="noreferrer">
                  이미지 ↗
                </a>
              ) : (
                <span className="nav-ellipsis">{banner.image}</span>
              )}
            </span>
          )}
        </div>
      </div>
    </li>
  )
}

/** 기간 타임라인 — 행이 배너, 열이 날짜. B tv 화면과 같은 방식으로 겹침·종료일을 본다 */
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
  const cursor = dayIndexes.indexOf(index)

  if (rows.length === 0) return <div className="btv-zone-empty">이 기간에는 편성이 없습니다</div>

  return (
    <div className="btv-timeline">
      <div className="tl-row tl-head" style={{ gridTemplateColumns: cols }}>
        <span className="tl-name muted mono">빅배너</span>
        {dayIndexes.map((di, col) => {
          const d = bigBannerDays[di]
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
        <div key={row.key} className="tl-row z-lib" style={{ gridTemplateColumns: cols }}>
          <span className="tl-name" title={row.name}>
            <i className="tl-dot z-lib" aria-hidden />
            <span className="nav-ellipsis">{row.name}</span>
          </span>
          {cursor >= 0 && <i className="tl-cursor" style={{ gridColumn: cursor + 2 }} aria-hidden />}
          {row.runs.map((run) => (
            <button
              key={run.from}
              className={`tl-bar z-lib${row.isEvent ? ' targeted' : ''}`}
              style={{ gridColumn: `${run.from + 2} / ${run.to + 3}` }}
              onClick={() => onPick(dayIndexes[run.from])}
              title={`${row.name} · ${bigBannerDays[dayIndexes[run.from]].date}~${
                bigBannerDays[dayIndexes[run.to]].date
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

export function BigBannerSchedule() {
  const base = todayKey()
  const [index, setIndex] = useState(() => indexOfBase(base))
  const [mode, setMode] = useState<'day' | 'span'>('day')
  /** 기본은 조회기준일부터. 지난 편성은 담당자가 따로 켜서 본다 */
  const [showPast, setShowPast] = useState(false)

  const day = bigBannerDays[index]
  const slots = useMemo(() => slotsOf(day), [day])
  const diff = useMemo(() => diffWithPrev(index), [index])
  const events = slots.filter((s) => s.isEvent).length
  const onAir = slots.filter((s) => s.onAir).length

  const dayIndexes = useMemo(
    () => (showPast ? bigBannerDays.map((_, i) => i) : indexesFrom(base)),
    [showPast, base],
  )
  const visible = dayIndexes.map((i) => ({ d: bigBannerDays[i], i }))
  const maxCount = Math.max(1, ...visible.map(({ d }) => dayCount(d)))

  const pick = (i: number) => setIndex(i)

  return (
    <>
      <TopBar />
      <div className="content flush sheetzone btv-page">
        <div className="panel-head" style={{ background: 'var(--surface)', flex: 'none' }}>
          <span className="label strong">편성/스케줄 › 홈 › 모바일 B tv</span>
          <span className="tag solid">빅배너 스케줄</span>
          <span className="mono muted" style={{ fontSize: 10.5 }}>
            조회기준 {base} · 순번대로 롤링 노출
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
              {months.map((m) => {
                const first = dayIndexes.find((i) => monthOf(bigBannerDays[i].date) === m)
                return (
                  <button
                    key={m}
                    className={`chip${monthOf(day.date) === m ? ' on' : ''}`}
                    disabled={first === undefined}
                    onClick={() => first !== undefined && setIndex(first)}
                  >
                    {m}월
                  </button>
                )
              })}
              <button className={`chip${showPast ? ' on' : ''}`} onClick={() => setShowPast((v) => !v)}>
                지난 편성
              </button>
            </div>
            <div className="btv-day-cap mono muted">
              {showPast ? `${bigBannerDays[0].date}~ 전체` : `${base} 이후`} · 숫자 = 빅배너 수
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
                    <i className="bar z-lib" style={{ width: (dayCount(d) / maxCount) * 60 }} />
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
                  {day.date === base && <span className="tag solid">조회기준</span>}
                </h1>
                <p className="mono muted">
                  {mode === 'day'
                    ? `모바일 B tv 홈 빅배너에 1번부터 순번대로 롤링 노출됩니다 · ${SCHEDULE_YEAR}년 편성표`
                    : '가로는 날짜, 세로는 배너입니다. 빗금 막대는 기간이 정해진 런칭·이벤트 배너입니다'}
                </p>
              </div>
              <div className="btv-counts">
                <div className="btv-count">
                  <b>{slots.length}</b>
                  <span>빅배너</span>
                </div>
                <div className="btv-count">
                  <b>{events}</b>
                  <span>런칭·이벤트</span>
                </div>
                <div className="btv-count strong" title="B tv Air에도 같이 걸리는 배너 수">
                  <b>{onAir}</b>
                  <span>air 동시 편성</span>
                </div>
              </div>
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

                {slots.length === 0 ? (
                  <div className="btv-zone-empty">이 날은 아직 편성이 등록되지 않았습니다</div>
                ) : (
                  <ol className="big-cards">
                    {slots.map((s) => (
                      <BannerCard key={`${s.order}-${s.label}`} slot={s} isNew={diff.added.has(s.label)} />
                    ))}
                  </ol>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
