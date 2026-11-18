import { SLOT_ZONES, zoneFill, zoneLabel, type BigBannerLiveDay, type BtvLiveDay, type SlotText } from '../src/lib/scheduleLive.js'
import type { ChatTurn } from './knowledge.js'
import { addDays, dowOfIso, getSchedule, kstToday } from './scheduleSource.js'

/**
 * 채팅 프롬프트에 넣는 편성표 발췌 — CLI(server/cliBridge.ts)·Gemini(server/gemini.ts, 배포 api/ask.ts)가 같은 것을 쓴다.
 *
 * 시트 전체를 넣으면 프롬프트가 커지고 모델이 날짜를 헷갈린다. 그래서 질문에서 날짜를 잡아 그 구간만 넣는다.
 * 순번·빈칸·정책 대비 남은 자리는 여기서 미리 세어 적는다 — 모델에게 칸을 세게 하면 틀린 배너를 고르는 사고가
 * 난다(실측 확인됨). 모델은 읽기만 하면 된다.
 */

type Env = Record<string, string | undefined>

/** 날짜를 말하지 않은 질문은 오늘부터 이만큼 */
const DEFAULT_SPAN_DAYS = 7
/** 한 번에 넣는 최대 일수 — 프롬프트가 커지지 않게 */
const MAX_SPAN_DAYS = 31

export interface DigestRange {
  from: string
  to: string
}

/** 이번 주 월요일 (YYYY-MM-DD) */
function mondayOf(isoDate: string): string {
  const dow = new Date(`${isoDate}T00:00:00Z`).getUTCDay()
  return addDays(isoDate, -((dow + 6) % 7))
}

/**
 * 문장에서 날짜를 잡는다 — 오늘·내일·모레·어제·이번 주·다음 주·지난주·m/d·m월 d일.
 * 여러 개면 가장 이른 날부터 가장 늦은 날까지. 못 잡으면 null
 */
export function pickRange(text: string, today: string): DigestRange | null {
  const found: DigestRange[] = []
  const day = (d: string) => found.push({ from: d, to: d })
  const week = (offset: number) => {
    const mon = addDays(mondayOf(today), offset * 7)
    found.push({ from: mon, to: addDays(mon, 6) })
  }
  if (/오늘|금일|지금/.test(text)) day(today)
  if (/내일|명일/.test(text)) day(addDays(today, 1))
  if (/모레/.test(text)) day(addDays(today, 2))
  if (/어제/.test(text)) day(addDays(today, -1))
  if (/이번\s*주|금주/.test(text)) week(0)
  if (/다음\s*주|담주|차주|next\s*week/i.test(text)) week(1)
  if (/지난\s*주|저번\s*주/.test(text)) week(-1)

  const year = Number(today.slice(0, 4))
  const dates = [
    ...text.matchAll(/(?<![\d.])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/g),
    ...text.matchAll(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g),
  ]
  for (const m of dates) {
    const mm = Number(m[1])
    const dd = Number(m[2])
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue
    // 연도를 말하지 않으므로 반년 넘게 지난 날짜는 내년으로 본다 (12월에 묻는 1/5)
    let y = year
    const candidate = `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    if (candidate < addDays(today, -183)) y += 1
    day(`${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`)
  }
  if (!found.length) return null
  const from = found.map((r) => r.from).sort()[0]
  const to = found.map((r) => r.to).sort().reverse()[0]
  return { from, to: to > addDays(from, MAX_SPAN_DAYS - 1) ? addDays(from, MAX_SPAN_DAYS - 1) : to }
}

/** 질문에 날짜가 없으면 바로 앞 사용자 발화에서 찾고("다음 주는?" → "빈 슬롯은?"), 그래도 없으면 오늘부터 7일 */
export function rangeFor(query: string, history: ChatTurn[], today: string): DigestRange {
  const own = pickRange(query, today)
  if (own) return own
  for (const turn of [...history].reverse()) {
    if (turn.role !== 'user') continue
    const r = pickRange(turn.text, today)
    if (r) return r
  }
  return { from: today, to: addDays(today, DEFAULT_SPAN_DAYS - 1) }
}

const kstTime = (isoTime: string) => new Date(new Date(isoTime).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')

const KIND_TAG: Record<SlotText['kind'], string> = { mass: '[매스] ', target: '[타겟] ', content: '', etc: '' }

function slotLine(order: number, s: SlotText | null): string {
  if (!s) return `  ${order}. (빈칸)`
  return `  ${order}. ${KIND_TAG[s.kind]}${s.name}${s.reach ? ` (모수 ${s.reach})` : ''}${s.period ? ` ${s.period}` : ''}`
}

function btvDayText(day: BtvLiveDay, limits: Record<string, number>): string {
  const zones = SLOT_ZONES.map((zone) => {
    const slots = day[zone]
    const f = zoneFill(slots, limits[zone])
    const state = [
      `정책 최대 ${f.limit}`,
      `채움 ${f.filled}`,
      f.over ? `정책 초과 ${f.over}` : `남은 자리 ${f.free}`,
      `빈 순번 ${f.gaps.length ? f.gaps.join('·') : '없음'}`,
    ].join(' · ')
    const lines = slots.length ? slots.map((s, i) => slotLine(i + 1, s)) : ['  (편성 없음)']
    return [`- ${zoneLabel[zone]} (${state})`, ...lines].join('\n')
  })
  return [`### ${day.date} (${day.dow})`, ...zones].join('\n')
}

function outOfRange(range: DigestRange, from: string, to: string): string {
  return `요청한 기간(${range.from}~${range.to})은 시트에 데이터가 없다. 시트가 담은 기간: ${from}~${to}.`
}

async function btvDigest(range: DigestRange, env: Env, now: Date): Promise<string> {
  try {
    const data = await getSchedule('btv', env, now)
    const days = data.days.filter((d) => d.date >= range.from && d.date <= range.to)
    return [
      `## Today B tv 편성표 — 기간 ${range.from}~${range.to}`,
      `데이터 기준 시각: ${kstTime(data.fetchedAt)} (KST) · 원본 시트: ${data.sheetUrl}${data.stale ? ' · 주의: 최근 시트 받기에 실패해 마지막으로 받은 데이터다' : ''}`,
      '순번 = 노출 순서. (빈칸)은 시트에서 그 순번 칸이 비어 있다는 뜻이다.',
      ...(days.length ? days.map((d) => btvDayText(d, data.limits)) : [outOfRange(range, data.from, data.to)]),
    ].join('\n')
  } catch (err) {
    return `## Today B tv 편성표\n불러오지 못했다 — ${(err as Error).message}`
  }
}

/** 빅배너는 날짜별 순번을 제목으로 풀고, 카피·태그·랜딩 같은 상세는 기간 안에 나온 배너만 따로 붙인다 */
async function bigBannerDigest(range: DigestRange, env: Env, now: Date): Promise<string> {
  try {
    const data = await getSchedule('bigbanner', env, now)
    const days: BigBannerLiveDay[] = data.days.filter((d) => d.date >= range.from && d.date <= range.to)
    const dayLines = days.map((day) =>
      day.slots.length
        ? `${day.date}(${day.dow}) — ${day.slots.map((s, n) => `${n + 1}.${s ? s.title : '(빈칸)'}`).join(' · ')}`
        : `${day.date}(${day.dow}) — 편성 없음`,
    )
    const seen = new Map<string, string>()
    for (const day of days)
      for (const b of day.slots)
        if (b && !seen.has(b.title))
          seen.set(b.title, `· ${b.title} — 문구: ${b.copy.replace(/\n/g, ' / ')} · 태그: ${b.tags} · 랜딩: ${b.landing} · air 편성: ${b.air}`)
    return [
      `## 모바일 B tv 빅배너 편성표 — 기간 ${range.from}~${range.to}`,
      `데이터 기준 시각: ${kstTime(data.fetchedAt)} (KST) · 원본 시트: ${data.sheetUrl}${data.stale ? ' · 주의: 최근 시트 받기에 실패해 마지막으로 받은 데이터다' : ''}`,
      ...(days.length
        ? ['### 날짜별 순번', ...dayLines, '### 배너 상세(카피·태그·랜딩) — 제목으로 찾아 인용한다', ...seen.values()]
        : [outOfRange(range, data.from, data.to)]),
    ].join('\n')
  } catch (err) {
    return `## 모바일 B tv 빅배너 편성표\n불러오지 못했다 — ${(err as Error).message}`
  }
}

/** 편성표 답변 규칙 — 위키 답변 규약(server/assistant-prompt.md)과 따로, 실시간 편성 데이터에만 붙는다 */
const SCHEDULE_RULES = [
  '편성표 답변 규칙:',
  '- <schedule> 안의 내용만 근거로 답한다. 없는 배너·날짜·순번을 지어내지 않는다.',
  '- 날짜를 말하지 않은 질문은 오늘 기준으로 답한다.',
  '- "1~3순위"·"상위 배너"는 콘텐츠 앞 배너 1~3번으로 답하고, 콘텐츠(수동 편성)·콘텐츠 뒤 배너도 앞 순번을 짧게 덧붙인다. (빈칸) 순번은 비어 있다고 그대로 말한다.',
  '- "빈 슬롯"·"빈 자리"는 날짜·구간별로 정책 최대 대비 남은 자리 수와 비어 있는 순번을 적어 답한다. 정책 초과인 날은 초과라고 밝힌다.',
  '- 편성표를 근거로 한 답에는 데이터 기준 시각과 출처 "원본 시트"를 밝힌다.',
  '- "불러오지 못했다"고 적힌 편성표는 데이터를 받지 못한 것이다. 그 사실과 적힌 이유를 그대로 전하고 편성 내용을 추측하지 않는다.',
  '- 요청한 기간이 시트에 없으면 시트가 담은 기간을 알려 준다.',
].join('\n')

/**
 * 질문에 맞춘 편성표 블록 — 오늘 날짜(KST)·답변 규칙·<schedule> 발췌를 묶는다.
 * env 는 로컬 중계가 .env.local 값을 넘기고, 배포 함수는 process.env 를 쓴다
 */
export async function buildScheduleBlock(
  input: { query: string; history: ChatTurn[] },
  env: Env = process.env,
  now: Date = new Date(),
): Promise<string> {
  const today = kstToday(now)
  const range = rangeFor(input.query, input.history, today)
  const [btv, big] = await Promise.all([btvDigest(range, env, now), bigBannerDigest(range, env, now)])
  return [
    `오늘(KST): ${today} (${dowOfIso(today)}). 이번 주 = ${mondayOf(today)}~${addDays(mondayOf(today), 6)}, 다음 주 = ${addDays(mondayOf(today), 7)}~${addDays(mondayOf(today), 13)}.`,
    SCHEDULE_RULES,
    `<schedule>\n${btv}\n\n---\n\n${big}\n</schedule>`,
  ].join('\n\n')
}
