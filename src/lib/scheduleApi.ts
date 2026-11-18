import { useCallback, useEffect, useState } from 'react'
import type { BigBannerScheduleResponse, BtvScheduleResponse, ScheduleKind } from './scheduleLive'

/**
 * 편성/스케줄 화면(B tv·빅배너)이 원본 시트를 읽는 `GET /api/schedule` 호출과 날짜 표기.
 * 시트 주소는 서버 환경변수에만 있고, 화면은 응답의 `sheetUrl` 로만 원본을 연다.
 */

type ResponseOf<K extends ScheduleKind> = K extends 'btv' ? BtvScheduleResponse : BigBannerScheduleResponse

export async function fetchSchedule<K extends ScheduleKind>(kind: K, fresh = false): Promise<ResponseOf<K>> {
  let res: Response
  try {
    // 새로고침 버튼은 fresh=1 — 서버가 5분 캐시를 건너뛰고 시트를 다시 받는다(최소 간격 20초)
    res = await fetch(`/api/schedule?kind=${kind}${fresh ? '&fresh=1' : ''}`)
  } catch {
    throw new Error('허브 서버에 연결하지 못했습니다. 지금 할 일: 인터넷 연결을 확인하고 새로고침을 눌러 주세요.')
  }
  const data = await res.json().catch(() => ({}))
  // 서버 문구에 '지금 할 일'이 들어 있어 그대로 보여 준다
  if (!res.ok) throw new Error(data.error || `편성표를 불러오지 못했습니다 (HTTP ${res.status})`)
  return data as ResponseOf<K>
}

export interface ScheduleState<T> {
  /** 마지막으로 받은 데이터 — 새로고침이 실패해도 지우지 않고 계속 보여 준다 */
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useSchedule<K extends ScheduleKind>(kind: K): ScheduleState<ResponseOf<K>> {
  const [data, setData] = useState<ResponseOf<K> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchSchedule(kind, reloadKey > 0)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  return { data, loading, error, reload }
}

/* ── 날짜 표기 — 응답 날짜는 YYYY-MM-DD, 화면은 m/d ── */

const KST_MS = 9 * 60 * 60 * 1000

/** 오늘(KST) YYYY-MM-DD — 보는 PC 시간대와 상관없이 편성표 기준(한국)으로 맞춘다 */
export const kstToday = (now: Date = new Date()) => new Date(now.getTime() + KST_MS).toISOString().slice(0, 10)

/** ISO 시각 → KST HH:MM */
export const kstTime = (iso: string) => {
  const t = new Date(iso)
  return isNaN(t.getTime()) ? '-' : new Date(t.getTime() + KST_MS).toISOString().slice(11, 16)
}

/** YYYY-MM-DD → m/d */
export const md = (date: string) => {
  const [, m, d] = date.split('-').map(Number)
  return `${m}/${d}`
}

/** YYYY-MM-DD → YYYY-MM (월 묶음 키) */
export const monthKey = (date: string) => date.slice(0, 7)

/** 날짜 목록의 연-월을 연도별로 묶는다 — 시트가 해를 넘기면 같은 '1월'이 두 번 나올 수 있어 연도로 나눠 보여 준다 */
export function monthGroups(dates: string[]): { year: string; months: string[] }[] {
  const groups: { year: string; months: string[] }[] = []
  for (const key of [...new Set(dates.map(monthKey))]) {
    const year = key.slice(0, 4)
    const last = groups[groups.length - 1]
    if (last && last.year === year) last.months.push(key)
    else groups.push({ year, months: [key] })
  }
  return groups
}

/** YYYY-MM → '11월' */
export const monthLabel = (key: string) => `${Number(key.slice(5, 7))}월`

/** 처음 열 날짜 — 오늘이 있으면 오늘, 없으면 오늘 뒤 첫 날, 그마저 없으면 마지막 날 */
export function defaultIndex(dates: string[], today: string): number {
  const i = dates.findIndex((d) => d >= today)
  return i >= 0 ? i : dates.length - 1
}
