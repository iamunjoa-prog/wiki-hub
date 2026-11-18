/**
 * 편성/스케줄 › 홈 › 모바일 B tv — 실시간 조회 응답(`BigBannerLiveDay`)을 화면에 쓸 수 있는 형태로 푼다.
 *
 * B tv 레일(`btvRail`)과 달리 구간(앞·콘텐츠·뒤) 구분이 없다. 빅배너는 한 줄에
 * 순번대로 롤링 노출되므로 "몇 번째로 보이는가"와 "언제부터 언제까지 걸리는가"
 * 두 가지만 풀어 주면 된다. 하루 슬롯 수는 시트마다 달라(실측 18개) 상한을 두지 않는다.
 */
import type { BigBannerLiveDay, BigBannerLiveSlot } from './scheduleLive'

export interface BigSlot {
  /** 노출 순번 (1부터) — 시트 중간 빈칸도 순번을 차지한다 */
  order: number
  /** 같은 배너를 묶는 키 */
  key: string
  banner: BigBannerLiveSlot
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

/** 같은 배너인지 — 제목이 같으면 같은 배너로 본다 (문구만 고친 날을 신규로 치지 않는다) */
const keyOf = (banner: BigBannerLiveSlot) => banner.title.trim()

function parse(banner: BigBannerLiveSlot, order: number): BigSlot {
  let name = banner.title.trim()
  let period: string | undefined

  const p = name.match(PERIOD)
  if (p) {
    period = p[1].replace(/\s+/g, '')
    name = name.slice(0, p.index).trim()
  }

  return {
    order,
    key: keyOf(banner),
    banner,
    name,
    period,
    isEvent: Boolean(period),
    onAir: banner.air.trim().toUpperCase().startsWith('O'),
  }
}

/** 그 날 순번대로의 빅배너. 시트 빈 칸은 null 로 두어 '빈 자리'로 보여 준다 */
export function slotsOf(day: BigBannerLiveDay): (BigSlot | null)[] {
  return day.slots.map((b, i) => (b ? parse(b, i + 1) : null))
}

export const dayCount = (day: BigBannerLiveDay) => day.slots.filter(Boolean).length

/**
 * 해시태그 원문을 조각으로.
 * 시트는 `#a|#b`와 `#a #b`를 섞어 쓰는데, `#B tv+ max`처럼 태그 안에 공백이 있는
 * 경우가 많아 공백은 다음 `#` 앞에서만 끊는다.
 */
export const tagList = (tags: string) =>
  (tags.includes('|') ? tags.split('|') : tags.split(/\s+(?=#)/))
    .map((t) => t.trim())
    .filter((t) => t.length > 1)

/**
 * 조회기준일 이후의 날짜만 남긴다.
 * 담당자가 여는 순간 궁금한 건 지난 편성이 아니라 오늘·내일 무엇이 걸려 있는지라서,
 * 기본 화면은 기준일부터 시작한다. 기준일이 편성표 범위 밖이면 전체를 준다.
 * 날짜가 YYYY-MM-DD 라 문자열 비교로 순서를 정한다.
 */
export function indexesFrom(days: BigBannerLiveDay[], base: string) {
  const from = days.map((d, i) => ({ d, i })).filter(({ d }) => d.date >= base)
  return from.length > 0 ? from.map((x) => x.i) : days.map((_, i) => i)
}

/** 전일 대비 신규 투입 / 전일 종료 */
export function diffWithPrev(days: BigBannerLiveDay[], index: number) {
  const day = days[index]
  const prev = days[index - 1]
  if (!day || !prev) return { added: new Set<string>(), removed: [] as string[] }
  const live = (d: BigBannerLiveDay) => d.slots.filter((b): b is BigBannerLiveSlot => b !== null)
  const cur = new Set(live(day).map(keyOf))
  const before = live(prev)
  return {
    added: new Set([...cur].filter((k) => !before.some((b) => keyOf(b) === k))),
    removed: [...new Set(before.filter((b) => !cur.has(keyOf(b))).map((b) => parse(b, 0).name))],
  }
}

export interface BigRun {
  /** 전달한 날짜 배열 안에서의 시작·끝 위치 (둘 다 포함) */
  from: number
  to: number
}

export interface BigRunRow {
  key: string
  name: string
  isEvent: boolean
  runs: BigRun[]
  /** 구간 길이 합 — 며칠 걸렸는지 */
  days: number
}

/** dayIndexes(days 인덱스 배열)를 배너별 연속 구간으로 접는다. */
export function runRows(days: BigBannerLiveDay[], dayIndexes: number[]): BigRunRow[] {
  const open = new Map<string, BigRun>()
  const rows = new Map<string, BigRunRow>()

  dayIndexes.forEach((di, col) => {
    const seen = new Set<string>()

    for (const banner of days[di].slots) {
      if (!banner) continue
      const key = keyOf(banner)
      // 같은 날 같은 배너가 두 순번에 걸려도 막대는 하나로 센다
      if (seen.has(key)) continue
      seen.add(key)
      const cur = open.get(key)
      if (cur && cur.to === col - 1) {
        cur.to = col
        continue
      }
      const run: BigRun = { from: col, to: col }
      open.set(key, run)
      const row = rows.get(key)
      if (row) {
        row.runs.push(run)
        continue
      }
      const slot = parse(banner, 0)
      rows.set(key, { key, name: slot.name, isEvent: slot.isEvent, runs: [run], days: 0 })
    }

    for (const [key, run] of open) if (!seen.has(key) && run.to < col) open.delete(key)
  })

  const out = [...rows.values()]
  for (const row of out) row.days = row.runs.reduce((n, r) => n + (r.to - r.from + 1), 0)

  return out.sort((a, b) => a.runs[0].from - b.runs[0].from || b.days - a.days)
}
