/**
 * 편성표 실시간 조회(`GET /api/schedule`)의 응답 계약과, 시트 칸 텍스트를 푸는 공용 함수.
 *
 * 서버(server/scheduleSource.ts · scheduleDigest.ts)와 화면이 같은 파일을 import 한다.
 * 그래서 이 파일은 다른 파일을 import 하지 않고 브라우저 전용 API도 쓰지 않는다
 * (서버는 Node ESM 으로 이 파일을 그대로 불러간다).
 */

/** 구간 — 홈 Today B tv 레일에서 콘텐츠 앞 / 콘텐츠 / 콘텐츠 뒤 */
export type SlotZone = 'pre' | 'lib' | 'post'

export const SLOT_ZONES: SlotZone[] = ['pre', 'lib', 'post']

export const zoneLabel: Record<SlotZone, string> = {
  pre: '콘텐츠 앞 배너',
  lib: '콘텐츠 (수동 편성)',
  post: '콘텐츠 뒤 배너',
}

/** 운영 정책 — 시트 머리에 적힌 구간별 최대 노출 수 (실제로는 넘겨 까는 날이 있어 '정책 초과'로 보여 준다) */
export const SLOT_LIMIT: Record<SlotZone, number> = { pre: 5, lib: 10, post: 5 }

export type SlotKind = 'mass' | 'target' | 'content' | 'etc'

/** 시트 한 칸을 유형·모수·이름·기간으로 나눈 것 */
export interface SlotText {
  kind: SlotKind
  /** 유형 태그·기간을 걷어낸 이름 */
  name: string
  /** 타겟 캠페인의 모수 — `270만`, `0.5천` */
  reach?: string
  /** `m/d~m/d` 로 맞춘 기간 — 끝이 없으면 `m/d~` */
  period?: string
  /** 시트 원문 — 검색·툴팁용 */
  raw: string
}

const TAG = /^\s*\[(매스|타겟)(?:\/([^\]]+))?\]\s*/
// `(8/31~9/30)` `(11.4~11.18` `(26.11.2~)` `(11/2 ~ 12/7)` `(11/6~19)` — 닫는 괄호가 빠진 칸도 있다
const DATE = String.raw`(?:\d{2}\.)?\d{1,2}[./]\d{1,2}`
const PERIOD = new RegExp(String.raw`\(\s*(${DATE})\s*~\s*(${DATE}|\d{1,2})?\s*\)?`, 'g')

/** `26.11.2` `11.4` `11/4` → `11/4` */
function normDate(s: string): string {
  const parts = s.split(/[./]/)
  const [m, d] = parts.slice(-2).map(Number)
  return `${m}/${d}`
}

/** 시트 칸 하나를 푼다 — B tv 화면(src/lib/btvRail.ts)과 채팅 발췌가 같은 규칙을 쓴다 */
export function parseSlotText(raw: string, zone: SlotZone): SlotText {
  let name = raw.trim()
  let kind: SlotKind = zone === 'lib' ? 'content' : 'etc'
  let reach: string | undefined
  let period: string | undefined

  const tag = name.match(TAG)
  if (tag) {
    kind = tag[1] === '매스' ? 'mass' : 'target'
    reach = tag[2]?.trim() || undefined
    name = name.slice(tag[0].length)
  }

  // 기간 표기는 이름 뒤쪽에 붙으므로 마지막 것을 쓴다 — 괄호 뒤에 담당 팀 메모가 붙은 칸도 있어 끝 고정으로 찾지 않는다
  const found = [...name.matchAll(PERIOD)]
  const p = found[found.length - 1]
  if (p && p.index !== undefined) {
    const from = normDate(p[1])
    // `(11/6~19)` 처럼 끝 날짜의 월을 생략한 칸은 시작 월을 붙인다
    const to = p[2] ? (/[./]/.test(p[2]) ? normDate(p[2]) : `${from.split('/')[0]}/${Number(p[2])}`) : ''
    period = `${from}~${to}`
    name = `${name.slice(0, p.index)} ${name.slice(p.index + p[0].length)}`
  }

  return { kind, name: name.replace(/\s+/g, ' ').trim(), reach, period, raw: raw.trim() }
}

/* ── GET /api/schedule?kind=btv|bigbanner 응답 ── */

export type ScheduleKind = 'btv' | 'bigbanner'

interface ScheduleMeta {
  /** 원본 시트를 여는 주소 (편집 URL) */
  sheetUrl: string
  /** 이 데이터를 시트에서 받은 시각 (ISO) */
  fetchedAt: string
  /** 최근 받기에 실패해 마지막 성공본을 준 것이면 true */
  stale: boolean
  /** 응답에 담은 기간 — 오늘(KST) 기준 과거 60일부터 시트 끝까지 (YYYY-MM-DD) */
  from: string
  to: string
}

/** Today B tv 하루 — 배열 위치가 노출 순번(0 = 1번), 시트 빈칸은 null 로 위치를 지킨다 */
export interface BtvLiveDay {
  /** YYYY-MM-DD */
  date: string
  /** 요일 한 글자 — 시트가 비워 둔 날도 날짜로 계산해 채운다 */
  dow: string
  pre: (SlotText | null)[]
  lib: (SlotText | null)[]
  post: (SlotText | null)[]
}

export interface BtvScheduleResponse extends ScheduleMeta {
  kind: 'btv'
  limits: Record<SlotZone, number>
  days: BtvLiveDay[]
}

/** 빅배너 한 칸 — 시트의 6행 묶음(제목·2줄 문구·해시태그·이미지·랜딩·air 편성여부) */
export interface BigBannerLiveSlot {
  title: string
  /** 시트 원문의 줄바꿈을 살린다 */
  copy: string
  tags: string
  image: string
  landing: string
  air: string
}

export interface BigBannerLiveDay {
  date: string
  dow: string
  /** 노출 순번대로 — 빈 칸은 null */
  slots: (BigBannerLiveSlot | null)[]
}

export interface BigBannerScheduleResponse extends ScheduleMeta {
  kind: 'bigbanner'
  days: BigBannerLiveDay[]
}

export type ScheduleResponse = BtvScheduleResponse | BigBannerScheduleResponse

/** 실패 응답 — 화면에 그대로 보여 줄 수 있는 한국어 문장 */
export interface ScheduleErrorResponse {
  error: string
}

/** 구간 하나의 채움 상태 — 화면의 '정책 초과' 표시와 채팅 발췌의 '빈 자리' 계산이 같은 셈을 쓴다 */
export interface ZoneFill {
  /** 채워진 칸 수 */
  filled: number
  /** 정책 최대 */
  limit: number
  /** 정책 최대까지 남은 자리 (넘겼으면 0) */
  free: number
  /** 정책 최대를 넘긴 칸 수 */
  over: number
  /** 비어 있는 순번 (1부터) — 중간 빈칸과, 정책 최대까지 아직 안 채운 뒤쪽 순번 */
  gaps: number[]
}

export function zoneFill(slots: (SlotText | null)[], limit: number): ZoneFill {
  const filled = slots.filter(Boolean).length
  const gaps: number[] = []
  for (let i = 0; i < Math.max(limit, slots.length); i++) if (!slots[i]) gaps.push(i + 1)
  return { filled, limit, free: Math.max(0, limit - filled), over: Math.max(0, filled - limit), gaps }
}
