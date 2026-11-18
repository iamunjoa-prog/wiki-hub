import { request as httpsRequest } from 'node:https'
import * as tls from 'node:tls'
import { readBigBannerSheetUrl, readBtvSheetUrl } from './env.js'
import {
  parseSlotText,
  SLOT_LIMIT,
  type BigBannerLiveDay,
  type BigBannerLiveSlot,
  type BigBannerScheduleResponse,
  type BtvLiveDay,
  type BtvScheduleResponse,
  type ScheduleKind,
  type ScheduleResponse,
  type SlotText,
  type SlotZone,
} from '../src/lib/scheduleLive.js'

/**
 * 편성표 실시간 조회 — 로컬 중계(server/cliBridge.ts)와 배포 함수(api/schedule.ts), 채팅 발췌(scheduleDigest.ts)가 함께 쓴다.
 *
 * 시트를 저장소에 복사해 두면 아무도 교체하지 않아 화면이 낡고, 제휴사 이름·모수가 공개 저장소에 남는다.
 * 그래서 시트 주소만 환경변수로 받고 그때그때 내려받는다. gviz(`/gviz/tq`)는 열 타입을 추론하다 행을
 * 잘라 먹어서 시트 전체를 그대로 주는 `/export?format=csv` 를 쓴다.
 */

type Env = Record<string, string | undefined>

const CACHE_MS = 5 * 60 * 1000
/** 채팅 답변은 시트를 받은 뒤에 모델을 부르므로(화면 대기 한도 90초) 오래 붙잡지 않는다 */
const FETCH_TIMEOUT_MS = 10_000
/** 응답에 담는 지난 날짜 — 그보다 오래된 편성은 화면·채팅 모두 쓰지 않는다 */
const PAST_DAYS = 60

/** 화면·채팅에 그대로 보여 줄 수 있는 한국어 문장을 담는다. status 는 HTTP 응답 코드 */
export class ScheduleError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ScheduleError'
    this.status = status
  }
}

const SHEET_ENV: Record<ScheduleKind, { name: string; read: (env: Env) => string | undefined; title: string }> = {
  btv: { name: 'HUB_BTV_SHEET_URL', read: readBtvSheetUrl, title: 'Today B tv 편성표' },
  bigbanner: { name: 'HUB_BIGBANNER_SHEET_URL', read: readBigBannerSheetUrl, title: '모바일 빅배너 편성표' },
}

export const isScheduleKind = (v: unknown): v is ScheduleKind => v === 'btv' || v === 'bigbanner'

/** 편집 URL(`/spreadsheets/d/<id>/edit?gid=<gid>#gid=<gid>`)에서 내려받기 주소를 만든다. gid 가 없으면 첫 탭 */
export function exportCsvUrl(sheetUrl: string): string | null {
  const id = /\/spreadsheets\/d\/([\w-]+)/.exec(sheetUrl)?.[1]
  if (!id) return null
  const gid = /[?#&]gid=(\d+)/.exec(sheetUrl)?.[1] ?? '0'
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`
}

/* ── 내려받기 ─────────────────────────────────────────── */

let caList: string[] | null | undefined

/**
 * 사내망은 보안 장비가 HTTPS 인증서를 회사 인증서로 바꿔 끼워서, Node 기본 인증서 목록만으로는 연결이 끊긴다
 * (브라우저·curl 은 운영체제 인증서 저장소를 봐서 된다). 실행기마다 옵션을 붙이는 대신 여기서 운영체제 저장소를 함께 믿는다.
 * getCACertificates 가 없는 옛 Node 는 기본 목록 그대로 — 그때는 NODE_EXTRA_CA_CERTS 가 남은 길이다
 */
function trustedCas(): string[] | undefined {
  if (caList !== undefined) return caList ?? undefined
  const get = (tls as unknown as { getCACertificates?: (type: string) => string[] }).getCACertificates
  try {
    caList = get ? [...new Set([...get('default'), ...get('system')])] : null
  } catch {
    caList = null
  }
  return caList ?? undefined
}

const CERT_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_UNTRUSTED',
  'CERT_HAS_EXPIRED',
])

/** 구글은 내려받기 주소를 다른 호스트로 넘긴다(307) — 몇 번까지 따라간다 */
function download(url: string, redirects = 5): Promise<{ type: string; text: string }> {
  return new Promise((done, fail) => {
    const req = httpsRequest(url, { ca: trustedCas(), timeout: FETCH_TIMEOUT_MS }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume()
        done(download(new URL(res.headers.location, url).toString(), redirects - 1))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        if (status !== 200) return fail(Object.assign(new Error(`HTTP ${status}`), { status }))
        done({ type: String(res.headers['content-type'] ?? ''), text: Buffer.concat(chunks).toString('utf8') })
      })
      res.on('error', fail)
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    req.on('error', fail)
    req.end()
  })
}

/** 원문 오류는 서버 로그에만 — 화면·채팅에는 "지금 할 일" 이 붙은 쉬운 문장만 나간다 */
function friendlyFetchError(err: unknown, title: string): ScheduleError {
  const e = err as { code?: string; status?: number }
  if (e?.code && CERT_CODES.has(e.code))
    return new ScheduleError(502, `회사 보안 인증서 때문에 ${title} 시트에 연결하지 못했습니다. 지금 할 일: 허브를 껐다 다시 켜 주세요. 계속되면 담당자에게 허브 기록 파일을 보내 주세요`)
  if (e?.status === 401 || e?.status === 403 || e?.status === 404)
    return new ScheduleError(502, `${title} 시트를 열 수 없습니다. 지금 할 일: 시트 공유 설정이 '링크가 있는 사람 보기' 인지 확인해 주세요`)
  return new ScheduleError(502, `${title} 시트를 불러오지 못했습니다. 지금 할 일: 인터넷 연결을 확인하고 잠시 뒤 다시 열어 주세요`)
}

/* ── CSV ─────────────────────────────────────────────── */

/** 따옴표 안 줄바꿈·쉼표·`""` 를 처리하는 CSV 파서 — 시트 칸에 줄바꿈이 흔하다 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/* ── 날짜 ────────────────────────────────────────────── */

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const MD = /^\s*(\d{1,2})\/(\d{1,2})\s*$/

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const dowOf = (y: number, m: number, d: number) => DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
const dowCell = (s: string | undefined) => /[일월화수목금토]/.exec(s ?? '')?.[0]

/** 오늘(KST) — 배포 함수는 UTC 로 돌아 Date 의 지역 시각을 쓰면 아침 9시 전까지 하루가 밀린다 */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export const dowOfIso = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number)
  return dowOf(y, m, d)
}

interface DatedEntry {
  m: number
  d: number
  dow?: string
}

/**
 * 시트 날짜는 `m/d` 뿐이고 여러 해가 한 탭에 이어 쌓인다. 날짜가 뒤로 돌아가는 곳(12/31 → 1/1, 다음 해 표 시작)에서
 * 묶음을 나누고, 묶음마다 '그 해의 실제 요일 == 요일 칸' 이 가장 많이 맞는 해를 고른다.
 * 요일 칸이 빈 묶음은 앞 묶음의 다음 해로 둔다
 */
export function assignYears(entries: DatedEntry[], todayYear: number): (number | null)[] {
  const years: (number | null)[] = new Array(entries.length).fill(null)
  let start = 0
  let prevYear: number | null = null
  const flush = (end: number) => {
    const block = entries.slice(start, end)
    let best: number | null = null
    let bestScore = 0
    for (let y = todayYear - 8; y <= todayYear + 2; y++) {
      const score = block.filter((e) => e.dow && dowOf(y, e.m, e.d) === e.dow).length
      if (score > bestScore) {
        best = y
        bestScore = score
      }
    }
    const year = best ?? (prevYear !== null ? prevYear + 1 : null)
    for (let i = start; i < end; i++) years[i] = year
    if (year !== null) prevYear = year
  }
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1]
    const b = entries[i]
    if (b.m * 100 + b.d <= a.m * 100 + a.d) {
      flush(i)
      start = i
    }
  }
  if (entries.length) flush(entries.length)
  return years
}

/** 수식 오류 칸은 빈칸으로 본다 */
const isBlank = (s: string | undefined) => !s?.trim() || /^#(REF!|N\/A|VALUE!|NAME\?|DIV\/0!|ERROR!|NUM!)$/.test(s.trim())

const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** 뒤쪽 빈칸은 순번이 아니라 남는 칸이다 — 중간 빈칸만 위치를 지킨다 */
function trimTail<T>(list: (T | null)[]): (T | null)[] {
  let end = list.length
  while (end > 0 && list[end - 1] === null) end--
  return list.slice(0, end)
}

/* ── Today B tv ──────────────────────────────────────── */

const ZONE_HEADER: Record<SlotZone, string> = { pre: '콘텐츠 앞 배너', lib: '라이브러리 편성', post: '콘텐츠 뒤 배너' }

/**
 * 행이 날짜, 열이 순번인 시트. 머리 행에서 구간 제목('콘텐츠 앞 배너' · '라이브러리 편성' · '콘텐츠 뒤 배너')이
 * 시작되는 칸을 찾는다 — 열 위치를 고정하면 시트에 칸 하나만 끼워도 다른 구간 배너가 섞여 나온다
 */
export function parseBtvCsv(text: string, todayYear: number): BtvLiveDay[] {
  const rows = parseCsv(text)
  const h = rows.findIndex((r) => r.some((c) => norm(c) === ZONE_HEADER.pre) && r.some((c) => norm(c) === ZONE_HEADER.lib))
  if (h < 0) throw new Error('구간 머리 행을 찾지 못함')
  const head = rows[h]
  const preStart = head.findIndex((c) => norm(c) === ZONE_HEADER.pre)
  const libStart = head.findIndex((c, i) => i > preStart && norm(c) === ZONE_HEADER.lib)
  const postStart = head.findIndex((c, i) => i > libStart && norm(c) === ZONE_HEADER.post)
  if (libStart < 0 || postStart < 0) throw new Error('구간 머리 칸을 찾지 못함')
  // 뒤 배너는 끝 표시가 없어 바로 아래 행의 칸 이름(배너1, 배너2 …)이 있는 데까지로 본다
  const sub = rows[h + 1] ?? []
  let postEnd = postStart + 1
  for (let i = postStart; i < sub.length; i++) if (!isBlank(sub[i])) postEnd = i + 1
  const ranges: Record<SlotZone, [number, number]> = {
    pre: [preStart, libStart],
    lib: [libStart, postStart],
    post: [postStart, postEnd],
  }

  // 날짜 열 — 머리 아래에서 `m/d` 가 가장 많이 나오는 앞쪽 열
  const body = rows.slice(h + 1)
  let dateCol = -1
  let most = 0
  for (let c = 0; c < Math.min(preStart, 6); c++) {
    const n = body.filter((r) => MD.test(r[c] ?? '')).length
    if (n > most) {
      most = n
      dateCol = c
    }
  }
  if (dateCol < 0) throw new Error('날짜 열을 찾지 못함')

  const dated = body.filter((r) => MD.test(r[dateCol] ?? ''))
  const entries = dated.map((r) => {
    const [, m, d] = MD.exec(r[dateCol])!
    return { m: Number(m), d: Number(d), dow: dowCell(r[dateCol + 1]) }
  })
  const years = assignYears(entries, todayYear)

  const byDate = new Map<string, BtvLiveDay>()
  dated.forEach((r, i) => {
    const y = years[i]
    if (y === null) return
    const { m, d } = entries[i]
    const zone = (z: SlotZone): (SlotText | null)[] =>
      trimTail(r.slice(...ranges[z]).map((c) => (isBlank(c) ? null : parseSlotText(c, z))))
    // 같은 날짜가 두 번 나오면 아래쪽(나중에 적은) 행을 쓴다
    byDate.set(iso(y, m, d), { date: iso(y, m, d), dow: dowOf(y, m, d), pre: zone('pre'), lib: zone('lib'), post: zone('post') })
  })
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/* ── 모바일 빅배너 ───────────────────────────────────── */

const BIG_FIELDS: [keyof BigBannerLiveSlot, RegExp][] = [
  ['copy', /문구/],
  ['tags', /태그/],
  ['image', /이미지/],
  ['landing', /랜딩/],
  ['air', /air/i],
]

const BIG_TITLE = /빅배너\s*제목/

/**
 * 열이 날짜, 행이 순번인 시트. 순번 하나가 6행 묶음(빅배너 제목 · 2줄 문구 · 해시태그 · 이미지 경로 · 랜딩 · air 편성여부)이고
 * 묶음 첫 행에 '빅배너 제목' 이 적혀 있다. 날짜 행은 그 위에서 `m/d` 가 가장 많은 행, 요일 행은 그 바로 위·아래 행이다
 */
export function parseBigBannerCsv(text: string, todayYear: number): BigBannerLiveDay[] {
  const rows = parseCsv(text)
  const firstSlot = rows.findIndex((r) => r.some((c) => BIG_TITLE.test(c)))
  if (firstSlot < 0) throw new Error('빅배너 제목 행을 찾지 못함')
  const labelCol = rows[firstSlot].findIndex((c) => BIG_TITLE.test(c))

  let dateRow = -1
  let most = 0
  for (let r = 0; r < firstSlot; r++) {
    const n = rows[r].filter((c) => MD.test(c)).length
    if (n > most) {
      most = n
      dateRow = r
    }
  }
  if (dateRow < 0) throw new Error('날짜 행을 찾지 못함')
  const dowCount = (r: number) => rows[r].filter((c) => c.trim().length === 1 && dowCell(c)).length
  const dowRow = [dateRow - 1, dateRow + 1].filter((r) => r >= 0 && r < firstSlot).sort((a, b) => dowCount(b) - dowCount(a))[0]

  // 순번 묶음 — '빅배너 제목' 행에서 시작해 다음 '빅배너 제목' 행 앞까지, 칸 이름으로 필드를 고른다
  const groups: Partial<Record<keyof BigBannerLiveSlot, number>>[] = []
  for (let r = firstSlot; r < rows.length; r++) {
    const label = rows[r][labelCol] ?? ''
    if (BIG_TITLE.test(label)) groups.push({ title: r })
    else if (groups.length) {
      const field = BIG_FIELDS.find(([, re]) => re.test(label))
      const g = groups[groups.length - 1]
      if (field && g[field[0]] === undefined) g[field[0]] = r
    }
  }

  const cols = rows[dateRow].flatMap((c, i) => (i > labelCol && MD.test(c) ? [i] : []))
  const entries = cols.map((i) => {
    const [, m, d] = MD.exec(rows[dateRow][i])!
    return { m: Number(m), d: Number(d), dow: dowRow === undefined ? undefined : dowCell(rows[dowRow][i]) }
  })
  const years = assignYears(entries, todayYear)

  const byDate = new Map<string, BigBannerLiveDay>()
  cols.forEach((col, k) => {
    const y = years[k]
    if (y === null) return
    const { m, d } = entries[k]
    const cell = (r: number | undefined) => (r === undefined || isBlank(rows[r]?.[col]) ? '' : rows[r][col].trim())
    const slots = trimTail(
      groups.map((g): BigBannerLiveSlot | null => {
        const title = cell(g.title)
        if (!title) return null
        return { title, copy: cell(g.copy), tags: cell(g.tags), image: cell(g.image), landing: cell(g.landing), air: cell(g.air) }
      }),
    )
    byDate.set(iso(y, m, d), { date: iso(y, m, d), dow: dowOf(y, m, d), slots })
  })
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/* ── 캐시·조회 ───────────────────────────────────────── */

interface Snapshot {
  sheetUrl: string
  fetchedAt: string
  /** 성공한 받기 시각(ms) — 5분 캐시 판정 */
  at: number
  days: BtvLiveDay[] | BigBannerLiveDay[]
}

const cache = new Map<ScheduleKind, Snapshot>()
const inflight = new Map<ScheduleKind, Promise<Snapshot>>()
/** 실패 직후 요청마다 다시 받으러 가지 않게(매번 제한 시간만큼 기다리게 된다) 마지막 실패 시각을 둔다 */
const failedAt = new Map<ScheduleKind, { at: number; error: unknown }>()
const RETRY_AFTER_FAIL_MS = 30_000
/** 화면 새로고침(?fresh=1)이 시트를 다시 받는 최소 간격 — 연타·자동 호출로 구글에 요청이 몰리지 않게 */
const FRESH_MIN_MS = 20_000
/** 마지막으로 시트를 받으러 간 시각 — fresh 최소 간격 판정 */
const attemptAt = new Map<ScheduleKind, number>()

async function load(kind: ScheduleKind, sheetUrl: string, now: Date): Promise<Snapshot> {
  const { title, name } = SHEET_ENV[kind]
  const csvUrl = exportCsvUrl(sheetUrl)
  if (!csvUrl)
    throw new ScheduleError(503, `${title} 시트 주소가 올바르지 않습니다. 지금 할 일: 허브 설정의 ${name} 항목에 구글 시트 주소창의 주소를 그대로 붙여 넣어 주세요`)
  let res: { type: string; text: string }
  try {
    res = await download(csvUrl)
  } catch (err) {
    console.warn(`[schedule] ${kind} 내려받기 실패 — ${(err as { code?: string }).code ?? ''} ${(err as Error).message}`)
    throw friendlyFetchError(err, title)
  }
  // 공개가 아닌 시트는 로그인 화면(HTML)을 200 으로 준다
  if (/text\/html/i.test(res.type)) {
    console.warn(`[schedule] ${kind} CSV 대신 HTML 을 받음 — 시트 공개 설정 확인 필요`)
    throw new ScheduleError(502, `${title} 시트를 열 수 없습니다. 지금 할 일: 시트 공유 설정이 '링크가 있는 사람 보기' 인지 확인해 주세요`)
  }
  const year = Number(kstToday(now).slice(0, 4))
  let days: BtvLiveDay[] | BigBannerLiveDay[]
  try {
    days = kind === 'btv' ? parseBtvCsv(res.text, year) : parseBigBannerCsv(res.text, year)
  } catch (err) {
    console.warn(`[schedule] ${kind} 시트 구조를 읽지 못함 — ${(err as Error).message}`)
    throw new ScheduleError(502, `${title} 시트의 형식이 바뀌어 읽지 못했습니다. 지금 할 일: 허브 담당자에게 알려 주세요`)
  }
  return { sheetUrl, fetchedAt: now.toISOString(), at: now.getTime(), days }
}

/**
 * 5분 안에 받은 게 있으면 그대로, 아니면 새로 받는다. 받기에 실패하면 마지막 성공본을 `stale: true` 로 주고,
 * 그마저 없으면 ScheduleError(한국어 문장)를 던진다
 */
async function snapshot(kind: ScheduleKind, env: Env, now: Date, fresh: boolean): Promise<{ snap: Snapshot; stale: boolean }> {
  const { title, name, read } = SHEET_ENV[kind]
  const sheetUrl = read(env)
  if (!sheetUrl)
    throw new ScheduleError(503, `${title} 시트 주소가 설정되지 않았습니다. 지금 할 일: 허브 설정(.env.local, 배포 허브는 환경변수)에 ${name} 항목을 적어 주세요`)
  const cached = cache.get(kind)
  const usable = cached && cached.sheetUrl === sheetUrl ? cached : undefined
  // 새로고침(fresh)은 캐시·실패 대기를 건너뛰되, 마지막으로 받으러 간 지 20초 안이면 평소처럼 답한다
  const force = fresh && now.getTime() - (attemptAt.get(kind) ?? 0) >= FRESH_MIN_MS
  if (!force) {
    if (usable && now.getTime() - usable.at < CACHE_MS) return { snap: usable, stale: false }
    const lastFail = failedAt.get(kind)
    if (lastFail && now.getTime() - lastFail.at < RETRY_AFTER_FAIL_MS) {
      if (usable) return { snap: usable, stale: true }
      throw lastFail.error
    }
  }

  let pending = inflight.get(kind)
  if (!pending) {
    attemptAt.set(kind, now.getTime())
    pending = load(kind, sheetUrl, now).finally(() => inflight.delete(kind))
    inflight.set(kind, pending)
  }
  try {
    const snap = await pending
    cache.set(kind, snap)
    failedAt.delete(kind)
    return { snap, stale: false }
  } catch (err) {
    failedAt.set(kind, { at: now.getTime(), error: err })
    if (usable) return { snap: usable, stale: true }
    throw err
  }
}

export interface ScheduleOptions {
  /** 5분 캐시를 건너뛰고 지금 다시 받는다(최소 간격 20초) — 화면 새로고침 버튼용 */
  fresh?: boolean
}

/** GET /api/schedule 응답 — 오늘(KST) 기준 지난 60일부터 시트 끝까지 */
export async function getSchedule(kind: 'btv', env?: Env, now?: Date, opts?: ScheduleOptions): Promise<BtvScheduleResponse>
export async function getSchedule(kind: 'bigbanner', env?: Env, now?: Date, opts?: ScheduleOptions): Promise<BigBannerScheduleResponse>
export async function getSchedule(kind: ScheduleKind, env?: Env, now?: Date, opts?: ScheduleOptions): Promise<ScheduleResponse>
export async function getSchedule(
  kind: ScheduleKind,
  env: Env = process.env,
  now: Date = new Date(),
  opts: ScheduleOptions = {},
): Promise<ScheduleResponse> {
  const { snap, stale } = await snapshot(kind, env, now, Boolean(opts.fresh))
  const from = addDays(kstToday(now), -PAST_DAYS)
  const meta = { sheetUrl: snap.sheetUrl, fetchedAt: snap.fetchedAt, stale }
  if (kind === 'btv') {
    const days = (snap.days as BtvLiveDay[]).filter((d) => d.date >= from)
    return { kind, ...meta, from, to: days[days.length - 1]?.date ?? from, limits: { ...SLOT_LIMIT }, days }
  }
  const days = (snap.days as BigBannerLiveDay[]).filter((d) => d.date >= from)
  return { kind, ...meta, from, to: days[days.length - 1]?.date ?? from, days }
}

/** 응답을 만드는 쪽(로컬·배포)이 같은 상태·본문을 쓰게 오류를 한 형태로 접는다 */
export function scheduleErrorBody(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof ScheduleError) return { status: err.status, body: { error: err.message } }
  console.error('[schedule]', err)
  return { status: 500, body: { error: '편성표를 불러오지 못했습니다. 지금 할 일: 잠시 뒤 다시 열어 주세요' } }
}
