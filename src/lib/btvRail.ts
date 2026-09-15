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
