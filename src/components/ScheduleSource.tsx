import { kstTime, type ScheduleState } from '../lib/scheduleApi'
import type { ScheduleResponse } from '../lib/scheduleLive'

/** 편성표 머리 줄 오른쪽 — 원본 시트를 받은 시각 · 새로고침 · 원본 시트 링크. B tv·빅배너 화면이 같이 쓴다 */
export function ScheduleSourceActions({ state }: { state: ScheduleState<ScheduleResponse> }) {
  const { data, loading, reload } = state
  return (
    <>
      {data && (
        <span className="mono muted sched-at" title={`시트에서 받은 시각 ${data.fetchedAt}`}>
          원본 시트 기준 {kstTime(data.fetchedAt)}
        </span>
      )}
      <button className="btn sm" onClick={reload} disabled={loading}>
        {loading && data ? '불러오는 중…' : '새로고침'}
      </button>
      {data?.sheetUrl && (
        <a className="btn sm" href={data.sheetUrl} target="_blank" rel="noreferrer">
          원본 시트 ↗
        </a>
      )}
    </>
  )
}

/**
 * 시트를 새로 못 읽었을 때의 안내. 데이터가 있으면 그 위에 한 줄로 띄우고 화면은 그대로 둔다 —
 * 담당자는 조금 지난 편성이라도 보는 편이 빈 화면보다 낫다.
 */
export function ScheduleNotice({ state }: { state: ScheduleState<ScheduleResponse> }) {
  const { data, error } = state
  if (!data) return null
  if (error)
    return (
      <div className="sched-notice">
        <b>새로고침에 실패해 {kstTime(data.fetchedAt)} 기준으로 보여요.</b> {error}
      </div>
    )
  if (data.stale)
    return <div className="sched-notice">시트를 새로 못 읽어 {kstTime(data.fetchedAt)} 기준으로 보여요.</div>
  return null
}

/** 첫 불러오기 — 데이터가 아직 하나도 없을 때만 본문 대신 보여 준다 */
export function ScheduleEmptyState({ state }: { state: ScheduleState<ScheduleResponse> }) {
  const { loading, error, reload } = state
  if (loading) return <div className="panel sched-state">원본 시트에서 편성표를 불러오는 중…</div>
  return (
    <div className="panel sched-state">
      <b>편성표를 불러오지 못했습니다.</b>
      <div className="muted" style={{ marginTop: 6 }}>
        {error}
      </div>
      <button className="btn sm" style={{ marginTop: 10 }} onClick={reload}>
        다시 불러오기
      </button>
    </div>
  )
}
