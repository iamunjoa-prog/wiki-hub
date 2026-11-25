import { useMemo, useState } from 'react'
import { TopBar } from '../components/AppShell'
import { ScheduleEmptyState, ScheduleNotice, ScheduleSourceActions } from '../components/ScheduleSource'
import {
  dayCount,
  diffWithPrev,
  isNewSlot,
  kindLabel,
  massCount,
  runRows,
  slotsOf,
  type Slot,
} from '../lib/btvRail'
import { defaultIndex, kstToday, md, monthGroups, monthKey, monthLabel, useSchedule } from '../lib/scheduleApi'
import { SLOT_LIMIT, SLOT_ZONES, zoneFill, zoneLabel, type BtvLiveDay, type SlotZone } from '../lib/scheduleLive'

const dowClass = (dow: string) => (dow === '일' ? 'sun' : dow === '토' ? 'sat' : '')

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

/** 시트 중간 빈칸 — 순번은 차지하지만 아무것도 안 걸린 자리라, 당겨 붙이지 않고 그대로 보여 준다 */
function EmptySlot({ order }: { order: number }) {
  return (
    <li className="rail-card empty" title="시트에서 이 순번이 비어 있습니다">
      <span className="rail-order">{order}</span>
      <div className="rail-body">
        <div className="rail-name">빈 자리</div>
      </div>
    </li>
  )
}

/**
 * 기간 타임라인 — 행이 배너, 열이 날짜. 한 달치를 한 화면에 깔아
 * 겹침·종료일·공백을 한눈에 본다. 막대나 날짜 머리를 누르면 그 날로 이동한다.
 */
function Timeline({
  days,
  dayIndexes,
  index,
  onPick,
}: {
  days: BtvLiveDay[]
  dayIndexes: number[]
  index: number
  onPick: (i: number) => void
}) {
  const rows = useMemo(() => runRows(days, dayIndexes), [days, dayIndexes])
  const cols = `200px repeat(${dayIndexes.length}, minmax(16px, 1fr))`
  /** 선택한 날짜 열 — 모든 행에 세로선으로 깔아 그 날 무엇이 걸려 있는지 짚어준다 */
  const cursor = dayIndexes.indexOf(index)

  if (rows.length === 0) return <div className="btv-zone-empty">이 달에는 편성이 없습니다</div>

  return (
    <div className="btv-timeline">
      <div className="tl-row tl-head" style={{ gridTemplateColumns: cols }}>
        <span className="tl-name muted mono">배너 / 콘텐츠</span>
        {dayIndexes.map((di, col) => {
          const d = days[di]
          return (
            <button
              key={d.date}
              className={`tl-date${di === index ? ' on' : ''} ${dowClass(d.dow)}`}
              onClick={() => onPick(di)}
              title={`${md(d.date)} ${d.dow} · ${dayCount(d)}건`}
              style={{ gridColumn: col + 2 }}
            >
              {Number(d.date.slice(8))}
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
              title={`${row.name} · ${md(days[dayIndexes[run.from]].date)}~${md(days[dayIndexes[run.to]].date)} (${
                run.to - run.from + 1
              }일)`}
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
  const state = useSchedule('btv')
  const [mode, setMode] = useState<'day' | 'span'>('day')
  const limits = state.data?.limits ?? SLOT_LIMIT

  return (
    <>
      <TopBar />
      <div className="content flush sheetzone btv-page">
        <div className="panel-head" style={{ background: 'var(--surface)', flex: 'none' }}>
          <span className="tag solid">Today B tv 스케줄링</span>
          <span className="mono muted" style={{ fontSize: 10.5 }}>
            콘텐츠 앞 {limits.pre} · 콘텐츠 {limits.lib} · 콘텐츠 뒤 {limits.post} 노출 정책
          </span>
          <div className="btv-seg" style={{ marginLeft: 'auto' }}>
            <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>
              하루 레일
            </button>
            <button className={mode === 'span' ? 'on' : ''} onClick={() => setMode('span')}>
              기간 타임라인
            </button>
          </div>
          <ScheduleSourceActions state={state} />
        </div>
        <ScheduleNotice state={state} />

        {state.data && state.data.days.length > 0 ? (
          <BtvBody days={state.data.days} limits={limits} mode={mode} />
        ) : state.data ? (
          <div className="panel sched-state">원본 시트에 읽을 수 있는 날짜가 없습니다.</div>
        ) : (
          <ScheduleEmptyState state={state} />
        )}
      </div>
    </>
  )
}

function BtvBody({
  days,
  limits,
  mode,
}: {
  days: BtvLiveDay[]
  limits: Record<SlotZone, number>
  mode: 'day' | 'span'
}) {
  const today = kstToday()
  /** 고른 날짜 — 인덱스 대신 날짜로 들고 있어 새로고침으로 목록이 바뀌어도 같은 날을 지킨다 */
  const [picked, setPicked] = useState<string | null>(null)

  const dates = useMemo(() => days.map((d) => d.date), [days])
  const found = picked ? dates.indexOf(picked) : -1
  const index = found >= 0 ? found : defaultIndex(dates, today)
  const day = days[index]
  const month = monthKey(day.date)

  const diff = useMemo(() => diffWithPrev(days, index), [days, index])
  const mass = useMemo(() => massCount(day), [day])
  const groups = useMemo(() => monthGroups(dates), [dates])
  const visible = useMemo(
    () => days.map((d, i) => ({ d, i })).filter(({ d }) => monthKey(d.date) === month),
    [days, month],
  )
  const dayIndexes = useMemo(() => visible.map((v) => v.i), [visible])

  const zones = SLOT_ZONES.map((z) => ({ zone: z, slots: slotsOf(day, z), fill: zoneFill(day[z], limits[z]) }))

  const pick = (i: number) => setPicked(days[i].date)

  return (
    <div className="btv-split">
      <aside className="btv-days">
        <div className="btv-month-row">
          {groups.map((g) => (
            <span key={g.year} className="btv-month-group">
              <span className="btv-year mono muted">{g.year}</span>
              {g.months.map((m) => (
                <button
                  key={m}
                  className={`chip${m === month ? ' on' : ''}`}
                  onClick={() => {
                    // 이번 달이면 오늘을, 다른 달이면 그 달 첫날을 연다
                    const first = days.findIndex((d) => monthKey(d.date) === m)
                    const todayIdx = dates.indexOf(today)
                    pick(todayIdx >= 0 && monthKey(today) === m ? todayIdx : first)
                  }}
                >
                  {monthLabel(m)}
                </button>
              ))}
            </span>
          ))}
        </div>
        <div className="btv-day-cap mono muted">막대 = 전체 편성 · 숫자 = 매스 기준</div>
        <div className="btv-day-list">
          {visible.map(({ d, i }) => {
            const m = massCount(d)
            return (
              <button
                key={d.date}
                className={`btv-day${i === index ? ' on' : ''}${dayCount(d) === 0 ? ' idle' : ''}`}
                onClick={() => pick(i)}
              >
                <span className="btv-day-date">
                  {md(d.date)}
                  <em className={dowClass(d.dow)}>{d.dow}</em>
                </span>
                <span className="btv-day-bars" aria-hidden>
                  {SLOT_ZONES.map((z) => (
                    <i key={z} className={`bar z-${z}`} style={{ width: d[z].filter(Boolean).length * 5 }} />
                  ))}
                </span>
                <span className="btv-day-n mono" title={`매스 ${m.total} · 전체 ${dayCount(d)}`}>
                  {m.total}
                </span>
                {d.date === today && <span className="btv-today">오늘</span>}
              </button>
            )
          })}
        </div>
      </aside>

      <section className="btv-rail">
        <header className="btv-rail-head">
          <div>
            <h1>
              {mode === 'day' ? (
                <>
                  {md(day.date)} <em>{day.dow}요일</em>
                  {day.date === today && <span className="tag solid">오늘</span>}
                </>
              ) : (
                <>
                  {monthLabel(month)} <em>{month.slice(0, 4)}년 편성 기간</em>
                </>
              )}
            </h1>
            <p className="mono muted">
              {mode === 'day'
                ? `${day.date.slice(0, 4)}년 · 이 날 홈 Today B tv 레일에 1번부터 왼쪽 → 오른쪽으로 넘겨가며 노출됩니다 · 타겟 ${mass.targetOnly}건을 뺀 매스 기준 ${mass.total}개`
                : '가로는 날짜, 세로는 배너입니다. 빗금 막대는 타겟 배너라 매스 화면에는 안 나옵니다'}
            </p>
          </div>
          {mode === 'day' && (
            <div className="btv-counts">
              {zones.map(({ zone, fill }) => (
                <div key={zone} className="btv-count">
                  <b>
                    {mass[zone]}
                    <i>/{fill.filled}</i>
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
          <Timeline days={days} dayIndexes={dayIndexes} index={index} onPick={pick} />
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
              {zones.map(({ zone, slots, fill }) => (
                <div key={zone} className={`btv-lane z-${zone}`}>
                  <div className="btv-zone-head">
                    <span className="label strong">{zoneLabel[zone]}</span>
                    <span
                      className={`mono muted${fill.over > 0 ? ' over' : ''}`}
                      title={`매스 ${mass[zone]} · 빈 순번 ${fill.gaps.join(', ') || '없음'}`}
                    >
                      정책 최대 {fill.limit} · 현재 {fill.filled}
                      {fill.over > 0 && ` (초과 ${fill.over})`}
                    </span>
                  </div>
                  {slots.length === 0 ? (
                    <div className="btv-zone-empty">편성 없음</div>
                  ) : (
                    <ol className="rail-cards lane">
                      {slots.map((s, i) =>
                        s ? (
                          <SlotCard key={`${zone}-${i}`} slot={s} isNew={isNewSlot(diff.added, s)} />
                        ) : (
                          <EmptySlot key={`${zone}-${i}`} order={i + 1} />
                        ),
                      )}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
