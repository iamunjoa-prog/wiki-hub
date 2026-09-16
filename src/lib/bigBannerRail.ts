/**
 * 편성/스케줄 › 홈 › 모바일 B tv — 빅배너 시트 셀을 화면에 쓸 수 있는 형태로 푼다.
 *
 * B tv 레일(`btvRail`)과 달리 구간(앞·콘텐츠·뒤) 구분이 없다. 빅배너는 한 줄에
 * 순번대로 롤링 노출되므로 "몇 번째로 보이는가"와 "언제부터 언제까지 걸리는가"
 * 두 가지만 풀어 주면 된다.
 */
import { banners, bigBannerDays, type BigBanner, type BigBannerDay } from '../data/bigBannerSchedule'

export interface BigSlot {
  /** 노출 순번 (1부터) */
  order: number
  /** banners 인덱스 */
  label: number
  banner: BigBanner
  /** 제목 꼬리의 기간 표기를 걷어낸 이름 */
  name: string
  /** `~7/13`, `7/27~8/9` */
  period?: string
  /** 런칭 이벤트·프로모션 배너인지 (기간 표기가 붙은 건) */
  isEvent: boolean
  /** B tv Air에도 같이 걸리는지 */
  onAir: boolean
}

const PERIOD = /\s*\(\s*(~?\s*\d{1,2}\/\d{1,2}(?:\s*~\s*\d{1,2}\/\d{1,2})?)\s*\)\s*$/

function parse(label: number, order: number): BigSlot {
  const banner = banners[label]
  let name = banner.title.trim()
  let period: string | undefined

  const p = name.match(PERIOD)
  if (p) {
    period = p[1].replace(/\s+/g, '')
    name = name.slice(0, p.index).trim()
  }

  return {
    order,
    label,
    banner,
    name,
    period,
    isEvent: Boolean(period),
    onAir: banner.air.trim().toUpperCase().startsWith('O'),
  }
}

/** 그 날 순번대로의 빅배너. 시트 빈 칸(-1)은 순번에서 빼고 당긴다 */
export function slotsOf(day: BigBannerDay): BigSlot[] {
  return day.slots.filter((i) => i >= 0).map((i, n) => parse(i, n + 1))
}

export const dayCount = (day: BigBannerDay) => day.slots.filter((i) => i >= 0).length

/**
 * 해시태그 원문을 조각으로.
 * 시트는 `#a|#b`와 `#a #b`를 섞어 쓰는데, `#B tv+ max`처럼 태그 안에 공백이 있는
 * 경우가 많아 공백은 다음 `#` 앞에서만 끊는다.
 */
export const tagList = (tags: string) =>
  (tags.includes('|') ? tags.split('|') : tags.split(/\s+(?=#)/))
    .map((t) => t.trim())
    .filter((t) => t.length > 1)

/** m/d → 월 숫자 */
export const monthOf = (date: string) => Number(date.split('/')[0])

export const months = [...new Set(bigBannerDays.map((d) => monthOf(d.date)))]

/** m/d 를 비교 가능한 숫자로 (같은 연도의 편성표라서 월·일만으로 충분하다) */
export const dateKey = (date: string) => {
  const [m, d] = date.split('/').map(Number)
  return m * 100 + d
}

/**
 * 조회기준일 이후의 날짜만 남긴다.
 * 담당자가 여는 순간 궁금한 건 지난 편성이 아니라 오늘·내일 무엇이 걸려 있는지라서,
 * 기본 화면은 기준일부터 시작한다. 기준일이 편성표 범위 밖이면 전체를 준다.
 */
export function indexesFrom(base: string) {
  const key = dateKey(base)
  const from = bigBannerDays.map((d, i) => ({ d, i })).filter(({ d }) => dateKey(d.date) >= key)
  return from.length > 0 ? from.map((x) => x.i) : bigBannerDays.map((_, i) => i)
}

/** 조회기준일(오늘)에 해당하는 인덱스. 없으면 그 뒤 첫 날, 그마저 없으면 마지막 날 */
export function indexOfBase(base: string) {
  const key = dateKey(base)
  const i = bigBannerDays.findIndex((d) => dateKey(d.date) >= key)
  return i >= 0 ? i : bigBannerDays.length - 1
}

/** 전일 대비 신규 투입 / 전일 종료 */
export function diffWithPrev(index: number) {
  const day = bigBannerDays[index]
  const prev = bigBannerDays[index - 1]
  const cur = new Set(day.slots.filter((i) => i >= 0))
  if (!prev) return { added: new Set<number>(), removed: [] as string[] }
  const before = new Set(prev.slots.filter((i) => i >= 0))
  return {
    added: new Set([...cur].filter((i) => !before.has(i))),
    removed: [...before].filter((i) => !cur.has(i)).map((i) => parse(i, 0).name),
  }
}

export interface BigRun {
  label: number
  /** 전달한 날짜 배열 안에서의 시작·끝 위치 (둘 다 포함) */
  from: number
  to: number
}

export interface BigRunRow {
  key: string
  label: number
  name: string
  isEvent: boolean
  runs: BigRun[]
  /** 구간 길이 합 — 며칠 걸렸는지 */
  days: number
}

/** dayIndexes(bigBannerDays 인덱스 배열)를 배너별 연속 구간으로 접는다. */
export function runRows(dayIndexes: number[]): BigRunRow[] {
  const open = new Map<number, BigRun>()
  const rows = new Map<number, BigRunRow>()

  dayIndexes.forEach((di, col) => {
    const seen = new Set<number>()

    for (const label of bigBannerDays[di].slots) {
      if (label < 0) continue
      seen.add(label)
      const cur = open.get(label)
      if (cur && cur.to === col - 1) {
        cur.to = col
        continue
      }
      const run: BigRun = { label, from: col, to: col }
      open.set(label, run)
      const row = rows.get(label)
      if (row) {
        row.runs.push(run)
        continue
      }
      const slot = parse(label, 0)
      rows.set(label, { key: String(label), label, name: slot.name, isEvent: slot.isEvent, runs: [run], days: 0 })
    }

    for (const [label, run] of open) if (!seen.has(label) && run.to < col) open.delete(label)
  })

  const out = [...rows.values()]
  for (const row of out) row.days = row.runs.reduce((n, r) => n + (r.to - r.from + 1), 0)

  return out.sort((a, b) => a.runs[0].from - b.runs[0].from || b.days - a.days)
}
