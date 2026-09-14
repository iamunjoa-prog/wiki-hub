import { useCallback, useEffect, useMemo, useState } from 'react'
import { TopBar } from '../components/AppShell'
import { CAMPAIGN_APP_URL } from '../data/sheets'
import {
  CHANNEL_FILTERS,
  dateKey,
  fetchCampaignRows,
  filterRows,
  groupByDate,
  hasCoupon,
  type CampaignRow,
  type ChannelKey,
} from '../lib/campaignCalendar'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const MAX_ITEMS_PER_DAY = 3
const REFRESH_MS = 60_000

const period = (r: CampaignRow) => (r.end && r.end !== r.start ? `${r.start} ~ ${r.end}` : r.start)

const tagsOf = (r: CampaignRow) => [r.channel, r.category, hasCoupon(r) ? r.coupon : ''].filter(Boolean)

/** 캘린더 칸의 캠페인에 마우스를 올리면 보이는 요약 */
const summaryOf = (r: CampaignRow) =>
  [r.title, tagsOf(r).join(' · '), period(r), r.owner && `담당 ${r.owner}`, '클릭하면 캠페인 대시보드로 이동'].filter(Boolean).join('\n')

/**
 * 편성/스케줄 › 캠페인 — 캠페인 대시보드의 "캠페인 신청 캘린더"만 떼어 보여준다.
 * 신청·상세 확인은 캠페인 대시보드에서 한다 (캠페인·상세 보기 링크).
 */
export function CampaignApp() {
  const [rows, setRows] = useState<CampaignRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  const today = new Date()
  const todayKey = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate())
  const [month, setMonth] = useState({ y: today.getFullYear(), m: today.getMonth() })

  const [channels, setChannels] = useState<ChannelKey[]>([])
  const [excludeWireline, setExcludeWireline] = useState(false)
  const [search, setSearch] = useState('')
  const [openDay, setOpenDay] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await fetchCampaignRows())
      setError(null)
      setUpdatedAt(new Date().toLocaleTimeString('ko-KR'))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  // 캠페인 대시보드와 같이 60초마다 새로 읽는다
  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (!openDay) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenDay(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openDay])

  const filtered = useMemo(
    () => filterRows(rows ?? [], { channels, excludeWireline, search }),
    [rows, channels, excludeWireline, search],
  )
  const byDate = useMemo(() => groupByDate(filtered), [filtered])

  const { y, m } = month
  const firstWeekday = new Date(y, m, 1).getDay()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const monthPrefix = `${y}-${String(m + 1).padStart(2, '0')}-`
  const monthCount = filtered.filter((r) => r.dateKey.startsWith(monthPrefix)).length

  const shiftMonth = (delta: number) =>
    setMonth(({ y, m }) => {
      const d = new Date(y, m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })

  const toggleChannel = (key: ChannelKey) =>
    setChannels((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  const dayEntries = openDay ? (byDate.get(openDay) ?? []) : []

  const status = error
    ? '불러오기 실패'
    : !rows
      ? '불러오는 중…'
      : updatedAt
        ? `마지막 갱신 ${updatedAt}`
        : ''

  return (
    <>
      <TopBar>
        <a className="btn sm" style={{ marginLeft: 'auto' }} href={CAMPAIGN_APP_URL} target="_blank" rel="noreferrer">
          캠페인 대시보드 열기 ↗
        </a>
      </TopBar>

      <div className="content">
        <div className="camp-cal">
          <div className="page-head">
            <span className="page-title">캠페인 신청 캘린더</span>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {status}
            </span>
            <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={load} disabled={loading}>
              {loading ? '갱신 중…' : '↻ 새로고침'}
            </button>
          </div>

          <div className="panel camp-cal-filters">
            <span className="label strong">채널</span>
            <div className="chip-row">
              {CHANNEL_FILTERS.map((c) => (
                <button
                  key={c.key}
                  className={`chip${channels.includes(c.key) ? ' on' : ''}`}
                  aria-pressed={channels.includes(c.key)}
                  onClick={() => toggleChannel(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <label className="camp-cal-check">
              <input type="checkbox" checked={excludeWireline} onChange={(e) => setExcludeWireline(e.target.checked)} />
              유선 캠페인 제외
            </label>
            <div className="search-input camp-cal-search">
              <span className="mono muted">⌕</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="캠페인명 검색"
                aria-label="캠페인명 검색"
              />
            </div>
          </div>

          <div className="camp-cal-toolbar">
            <button className="btn sm" onClick={() => shiftMonth(-1)}>
              ‹ 이전달
            </button>
            <span className="camp-cal-month">
              {y}년 {m + 1}월
            </span>
            <button className="btn sm" onClick={() => shiftMonth(1)}>
              다음달 ›
            </button>
            <button className="btn sm" onClick={() => setMonth({ y: today.getFullYear(), m: today.getMonth() })}>
              오늘
            </button>
            <span className="muted camp-cal-hint">
              {rows ? `${m + 1}월 ${monthCount}건 · ` : ''}캠페인을 누르면 캠페인 대시보드로 이동합니다
            </span>
          </div>

          {error && !rows ? (
            <div className="panel empty">
              <div className="box" />
              캠페인 캘린더를 불러오지 못했습니다
              <span style={{ fontSize: 12.5 }}>{error}</span>
              <span style={{ fontSize: 12.5 }}>
                사내망(VPN)에 연결돼 있는지 확인한 뒤 새로고침하거나,{' '}
                <a href={CAMPAIGN_APP_URL} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
                  캠페인 대시보드
                </a>
                에서 확인하세요
              </span>
            </div>
          ) : (
            <div className="camp-cal-grid" aria-busy={!rows}>
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`camp-cal-head${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>
                  {w}
                </div>
              ))}
              {Array.from({ length: firstWeekday }, (_, i) => (
                <div key={`blank-${i}`} className="camp-cal-cell blank" />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1
                const key = dateKey(y, m + 1, day)
                const entries = byDate.get(key) ?? []
                const weekday = (firstWeekday + i) % 7
                return (
                  <div
                    key={key}
                    className={`camp-cal-cell${entries.length ? ' has' : ''}${key === todayKey ? ' today' : ''}`}
                  >
                    <div className="camp-cal-day">
                      <span className={weekday === 0 ? 'sun' : weekday === 6 ? 'sat' : undefined}>{day}</span>
                      {entries.length > 0 && (
                        <button className="camp-cal-count" onClick={() => setOpenDay(key)} title="이날 캠페인 모두 보기">
                          {entries.length}건
                        </button>
                      )}
                    </div>
                    {entries.slice(0, MAX_ITEMS_PER_DAY).map((r, idx) => (
                      <a
                        key={idx}
                        className="camp-cal-item"
                        href={CAMPAIGN_APP_URL}
                        target="_blank"
                        rel="noreferrer"
                        title={summaryOf(r)}
                      >
                        {r.title}
                      </a>
                    ))}
                    {entries.length > MAX_ITEMS_PER_DAY && (
                      <button className="camp-cal-more" onClick={() => setOpenDay(key)}>
                        +{entries.length - MAX_ITEMS_PER_DAY}개 더보기
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {openDay && (
        <div className="modal-back" onClick={() => setOpenDay(null)}>
          <div
            className="modal camp-day-modal"
            role="dialog"
            aria-label={`${openDay} 캠페인`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-head">
              <span className="label strong">
                {openDay} · {dayEntries.length}건
              </span>
              <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setOpenDay(null)}>
                닫기
              </button>
            </div>
            <div className="camp-day-list">
              {dayEntries.map((r, i) => {
                const meta = [
                  ['기간', period(r)],
                  ['타겟', r.target],
                  ['부서', r.dept],
                  ['담당자', r.owner],
                  ['실행시각', r.execAt],
                ].filter(([, v]) => v)
                return (
                  <div key={i} className="camp-day-item">
                    <div className="camp-day-title">{r.title}</div>
                    {tagsOf(r).length > 0 && (
                      <div className="chip-row">
                        {tagsOf(r).map((t, j) => (
                          <span key={j} className="tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    <dl className="camp-day-meta">
                      {meta.map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )
              })}
            </div>
            <div className="camp-day-foot">
              <a className="btn sm primary" href={CAMPAIGN_APP_URL} target="_blank" rel="noreferrer">
                캠페인 대시보드에서 상세 보기 ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
