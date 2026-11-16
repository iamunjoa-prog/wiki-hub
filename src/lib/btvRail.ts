/**
 * 편성/스케줄 › 홈 › B tv — 실시간 조회 응답(`BtvLiveDay`)을 화면에 쓸 수 있는 형태로 푼다.
 *
 * 시트는 한 칸에 `[타겟/270만] B tv+ 9월 상위 비플리 (8/31~9/30)` 처럼
 * 유형·모수·이름·기간을 전부 몰아 적는다. 칸 풀이는 서버가 해서 내려 주고(src/lib/scheduleLive.ts),
 * 여기서는 순번·전일 대비·기간 막대처럼 화면이 쓰는 셈만 한다.
 */
import { SLOT_ZONES, type BtvLiveDay, type SlotKind, type SlotText, type SlotZone } from './scheduleLive'

export type { SlotKind }

export interface Slot extends SlotText {
  /** 구간 내 노출 순번 (1부터) — 시트 중간 빈칸도 순번을 차지한다 */
  order: number
  zone: SlotZone
}

/** 그 날 구간의 칸들 — null 은 시트의 중간 빈칸(빈 자리)이라 순번을 당기지 않는다 */
export function slotsOf(day: BtvLiveDay, zone: SlotZone): (Slot | null)[] {
  return day[zone].map((s, i) => (s ? { ...s, order: i + 1, zone } : null))
}

const filled = (day: BtvLiveDay, zone: SlotZone) => slotsOf(day, zone).filter((s): s is Slot => s !== null)

export const kindLabel: Record<SlotKind, string> = {
  mass: '매스',
  target: '타겟',
  content: '콘텐츠',
  etc: '일반',
}

export function dayCount(day: BtvLiveDay) {
  return SLOT_ZONES.reduce((n, z) => n + day[z].filter(Boolean).length, 0)
}

/** 같은 배너인지 — 시트 원문이 같으면 같은 배너로 본다 (구간을 옮겨도 신규로 치지 않는다) */
const keyOf = (s: SlotText) => s.raw

/**
 * 전일 대비 신규 투입 / 당일 종료.
 * 담당자가 매일 확인하는 건 "오늘 뭐가 바뀌었나" 하나라서, 날짜별 전체 목록보다
 * 이 차이를 먼저 보여준다.
 */
export function diffWithPrev(days: BtvLiveDay[], index: number) {
  const day = days[index]
  const prev = days[index - 1]
  if (!day || !prev) return { added: new Set<string>(), removed: [] as string[] }
  const all = (d: BtvLiveDay) => SLOT_ZONES.flatMap((z) => d[z].filter((s): s is SlotText => s !== null).map(keyOf))
  const cur = new Set(all(day))
  const before = new Set(all(prev))
  return {
    added: new Set([...cur].filter((k) => !before.has(k))),
    removed: [...before].filter((k) => !cur.has(k)),
  }
}

export const isNewSlot = (added: Set<string>, slot: Slot) => added.has(keyOf(slot))

/**
 * 연속 편성 구간. 모니터링에서 실제로 궁금한 건 "오늘 뭐가 걸렸나"보다
 * "이게 언제부터 언제까지 걸려 있나 / 뭐랑 겹치나"라서, 날짜별 목록을
 * 배너 단위 막대로 뒤집어 놓는다.
 */
export interface Run {
  zone: SlotZone
  /** 전달한 날짜 배열 안에서의 시작·끝 위치 (둘 다 포함) */
  from: number
  to: number
}

export interface RunRow {
  key: string
  zone: SlotZone
  name: string
  kind: SlotKind
  runs: Run[]
  /** 구간 길이 합 — 며칠 걸렸는지 */
  days: number
}

/** dayIndexes(days 인덱스 배열)를 배너별 연속 구간으로 접는다. */
export function runRows(days: BtvLiveDay[], dayIndexes: number[]): RunRow[] {
  const open = new Map<string, Run>()
  const rows = new Map<string, RunRow>()

  dayIndexes.forEach((di, col) => {
    const day = days[di]
    const seen = new Set<string>()

    for (const zone of SLOT_ZONES) {
      for (const slot of filled(day, zone)) {
        const key = `${zone}:${keyOf(slot)}`
        // 같은 날 같은 구간에 두 번 걸려도 막대는 하나로 센다
        if (seen.has(key)) continue
        seen.add(key)
        const cur = open.get(key)
        if (cur && cur.to === col - 1) {
          cur.to = col
          continue
        }
        const run: Run = { zone, from: col, to: col }
        open.set(key, run)
        const row = rows.get(key)
        if (row) {
          row.runs.push(run)
          continue
        }
        rows.set(key, { key, zone, name: slot.name, kind: slot.kind, runs: [run], days: 0 })
      }
    }

    for (const [key, run] of open) if (!seen.has(key) && run.to < col) open.delete(key)
  })

  const out = [...rows.values()]
  for (const row of out) row.days = row.runs.reduce((n, r) => n + (r.to - r.from + 1), 0)

  return out.sort(
    (a, b) =>
      SLOT_ZONES.indexOf(a.zone) - SLOT_ZONES.indexOf(b.zone) ||
      a.runs[0].from - b.runs[0].from ||
      b.days - a.days,
  )
}

/**
 * 매스(타겟 미해당) 사용자에게 실제로 보이는 슬롯.
 * 타겟 배너는 추출된 모수에게만 나가므로, 그 외 사용자가 보는 화면에서는 빠진다.
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

export function massCount(day: BtvLiveDay): MassCount {
  const n = { pre: 0, lib: 0, post: 0, total: 0, targetOnly: 0 }
  for (const zone of SLOT_ZONES) {
    for (const slot of filled(day, zone)) {
      if (isMassVisible(slot)) {
        n[zone] += 1
        n.total += 1
      } else n.targetOnly += 1
    }
  }
  return n
}
