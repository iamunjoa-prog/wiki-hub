/**
 * 편성/스케줄 › 홈 › B tv — 시트 셀 텍스트를 화면에 쓸 수 있는 형태로 푼다.
 *
 * 시트는 한 칸에 `[타겟/270만] B tv+ 9월 상위 비플리 (8/31~9/30)` 처럼
 * 유형·모수·이름·기간을 전부 몰아 적는다. 표를 그대로 옮기지 않고 카드로
 * 보여주려면 이 네 조각을 분리해야 한다.
 */
import { labels, scheduleDays, type ScheduleDay, type SlotZone } from '../data/btvSchedule'

export type SlotKind = 'mass' | 'target' | 'content' | 'etc'

export interface Slot {
  /** 구간 내 노출 순번 (1부터) */
  order: number
  zone: SlotZone
  kind: SlotKind
  /** 유형 태그를 걷어낸 이름 */
  name: string
  /** 타겟 캠페인의 모수 — `270만`, `0.5천` */
  reach?: string
  /** `8/31~9/30` */
  period?: string
  /** 시트 원문 — 검색·툴팁용 */
  raw: string
}

const TAG = /^\[(매스|타겟)(?:\/([^\]]+))?\]\s*/
const PERIOD = /\s*\(([\d]{1,2}\/[\d]{1,2}\s*~[^)]*)\)\s*$/

function parse(raw: string, zone: SlotZone, order: number): Slot {
  let name = raw.trim()
  let kind: SlotKind = zone === 'lib' ? 'content' : 'etc'
  let reach: string | undefined
  let period: string | undefined

  const tag = name.match(TAG)
  if (tag) {
    kind = tag[1] === '매스' ? 'mass' : 'target'
    reach = tag[2]?.trim()
    name = name.slice(tag[0].length)
  }

  const p = name.match(PERIOD)
  if (p) {
    period = p[1].replace(/\s+/g, '')
    name = name.slice(0, p.index).trim()
  }

  return { order, zone, kind, name: name.trim(), reach, period, raw: raw.trim() }
}

export function slotsOf(day: ScheduleDay, zone: SlotZone): Slot[] {
  return day[zone].map((i, n) => parse(labels[i], zone, n + 1))
}

export const kindLabel: Record<SlotKind, string> = {
  mass: '매스',
  target: '타겟',
  content: '콘텐츠',
  etc: '일반',
}

/** m/d → 월 숫자 */
export const monthOf = (date: string) => Number(date.split('/')[0])

export const months = [...new Set(scheduleDays.map((d) => monthOf(d.date)))]

export function dayCount(day: ScheduleDay) {
  return day.pre.length + day.lib.length + day.post.length
}

/**
 * 전일 대비 신규 투입 / 당일 종료.
 * 담당자가 매일 확인하는 건 "오늘 뭐가 바뀌었나" 하나라서, 날짜별 전체 목록보다
 * 이 차이를 먼저 보여준다.
 */
export function diffWithPrev(index: number) {
  const day = scheduleDays[index]
  const prev = scheduleDays[index - 1]
  const cur = new Set([...day.pre, ...day.lib, ...day.post])
  if (!prev) return { added: new Set<number>(), removed: [] as string[] }
  const before = new Set([...prev.pre, ...prev.lib, ...prev.post])
  return {
    added: new Set([...cur].filter((i) => !before.has(i))),
    removed: [...before].filter((i) => !cur.has(i)).map((i) => labels[i]),
  }
}

/**
 * 연속 편성 구간. 모니터링에서 실제로 궁금한 건 "오늘 뭐가 걸렸나"보다
 * "이게 언제부터 언제까지 걸려 있나 / 뭐랑 겹치나"라서, 날짜별 목록을
 * 배너 단위 막대로 뒤집어 놓는다.
 */
export interface Run {
  zone: SlotZone
  /** labels 인덱스 */
  label: number
  /** 전달한 날짜 배열 안에서의 시작·끝 위치 (둘 다 포함) */
  from: number
  to: number
}

export interface RunRow {
  key: string
  zone: SlotZone
  label: number
  name: string
  kind: SlotKind
  runs: Run[]
  /** 구간 길이 합 — 며칠 걸렸는지 */
  days: number
}

const ZONE_ORDER: SlotZone[] = ['pre', 'lib', 'post']

/** dayIndexes(scheduleDays 인덱스 배열)를 배너별 연속 구간으로 접는다. */
export function runRows(dayIndexes: number[]): RunRow[] {
  const open = new Map<string, Run>()
  const rows = new Map<string, RunRow>()

  dayIndexes.forEach((di, col) => {
    const day = scheduleDays[di]
    const seen = new Set<string>()

    for (const zone of ZONE_ORDER) {
      for (const label of day[zone]) {
        const key = `${zone}:${label}`
        seen.add(key)
        const cur = open.get(key)
        if (cur && cur.to === col - 1) {
          cur.to = col
          continue
        }
        const run: Run = { zone, label, from: col, to: col }
        open.set(key, run)
        const row = rows.get(key)
        if (row) {
          row.runs.push(run)
          continue
        }
        const slot = parse(labels[label], zone, 0)
        rows.set(key, { key, zone, label, name: slot.name, kind: slot.kind, runs: [run], days: 0 })
      }
    }

    for (const [key, run] of open) if (!seen.has(key) && run.to < col) open.delete(key)
  })

  const out = [...rows.values()]
  for (const row of out) row.days = row.runs.reduce((n, r) => n + (r.to - r.from + 1), 0)

  return out.sort(
    (a, b) =>
      ZONE_ORDER.indexOf(a.zone) - ZONE_ORDER.indexOf(b.zone) ||
      a.runs[0].from - b.runs[0].from ||
      b.days - a.days,
  )
}

/**
 * 매스(타겟 미해당) 사용자에게 실제로 보이는 슬롯.
 * 타겟 배너는 추출된 모수에게만 나가므로, 그 외 사용자가 보는 화면에서는 빠진다.
 * 정책 상한(앞 5 / 콘텐츠 10 / 뒤 5)과 비교해야 하는 숫자도 이쪽이다.
 */
export const isMassVisible = (slot: Slot) => slot.kind !== 'target'

export interface MassCount {
  pre: number
  lib: number
  post: number
  total: number
  /** 타겟 배너 수 — 매스 화면에서 빠지는 만큼 */
  targetOnly: number
}

export function massCount(day: ScheduleDay): MassCount {
  const n = { pre: 0, lib: 0, post: 0, total: 0, targetOnly: 0 }
  for (const zone of ZONE_ORDER) {
    for (const slot of slotsOf(day, zone)) {
      if (isMassVisible(slot)) {
        n[zone] += 1
        n.total += 1
      } else n.targetOnly += 1
    }
  }
  return n
}
