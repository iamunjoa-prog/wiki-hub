import { CAMPAIGN_SHEET_API } from '../data/sheets'

/**
 * 편성/스케줄 › 캠페인 — 캠페인 대시보드의 "캠페인 신청 캘린더"와 같은 데이터·규칙으로 캘린더만 그린다.
 * 캠페인 대시보드(campaign-dashboard0-v2-4)의 loadSheet·applyFilters 로직을 옮겨 왔다.
 * API가 CORS를 열어 두어 보는 사람의 브라우저에서 직접 읽는다 — 허브 서버(Vercel)를 거치지 않는다.
 */

export type ChannelKey = 'tv' | 'toast' | 'coupon' | 'seg'

export const CHANNEL_FILTERS: { key: ChannelKey; label: string }[] = [
  { key: 'tv', label: 'TV팝업' },
  { key: 'toast', label: '토스트팝업' },
  { key: 'coupon', label: '쿠폰' },
  { key: 'seg', label: 'Seg채널' },
]

export interface CampaignRow {
  title: string
  start: string
  end: string
  channel: string
  category: string
  coupon: string
  target: string
  dept: string
  owner: string
  execAt: string
  /** 타겟 수 — 같은 날 안에서 큰 캠페인을 위에 보여주는 정렬 기준 */
  pop: number
  /** YYYY-MM-DD (시작일) */
  dateKey: string
}

export interface CalendarFilter {
  channels: ChannelKey[]
  excludeWireline: boolean
  search: string
}

interface GvizCell {
  v?: unknown
  f?: string | null
}

interface GvizResponse {
  status?: string
  errors?: { detailed_message?: string }[]
  table: {
    cols: { id?: string; label?: string; type?: string }[]
    rows?: { c?: (GvizCell | null)[] }[]
  }
}

export const dateKey = (y: number, mo: number, d: number) =>
  `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`

const cellText = (cell: GvizCell | null | undefined) =>
  cell ? String(cell.f != null ? cell.f : cell.v != null ? cell.v : '') : ''

function parseDateValue(str: string): { y: number; mo: number; d: number } | null {
  const s = str.trim()
  if (!s) return null
  let m = s.match(/^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/)
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] }
  const dt = new Date(s)
  return isNaN(dt.getTime()) ? null : { y: dt.getFullYear(), mo: dt.getMonth() + 1, d: dt.getDate() }
}

/** gviz date 셀은 v가 "Date(y,m,d,...)" 문자열(월 0부터) */
function parseGvizDate(cell: GvizCell | null | undefined, colType?: string) {
  if (!cell) return null
  if ((colType === 'date' || colType === 'datetime') && typeof cell.v === 'string') {
    const m = cell.v.match(/^Date\((\d+),(\d+),(\d+)/)
    if (m) return { y: +m[1], mo: +m[2] + 1, d: +m[3] }
  }
  return parseDateValue(cellText(cell))
}

/** QA 자동화·로컬 점검으로 시트에 남은 행("[테스트…]", "5[…]" 등)은 실제 신청 건이 아니다 */
function isTestCampaignTitle(title: string): boolean {
  const t = title.trim()
  if (!t) return false
  if (/^\[?\s*테스트/.test(t)) return true
  if (/^\d+\s*\[/.test(t)) return true
  return /\[[^\]]*(테스트|검증|플레이라이트|playwright|자동화|디버그|debug|qa)[^\]]*\]/i.test(t)
}

const parsePop = (str: string) => {
  const n = Number(str.replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? 0 : n
}

export async function fetchCampaignRows(): Promise<CampaignRow[]> {
  const res = await fetch(`${CAMPAIGN_SHEET_API}&_=${Date.now()}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  const start = text.indexOf('(')
  const end = text.lastIndexOf(')')
  if (start === -1 || end === -1) throw new Error('시트 응답 형식을 해석하지 못했습니다')
  const json = JSON.parse(text.slice(start + 1, end)) as GvizResponse
  if (json.status === 'error') throw new Error(json.errors?.[0]?.detailed_message || '시트를 읽을 수 없습니다')

  // 헤더에 섞인 "[ 26년 1월 ]" 같은 개인 메모는 떼고 비교한다
  const headers = json.table.cols.map((c, i) => {
    const raw = c.label || c.id || `col${i}`
    return raw.replace(/\[[^\]]*\]/g, '').trim() || raw
  })
  const types = json.table.cols.map((c) => c.type)

  const col = (...preds: ((h: string) => boolean)[]) => {
    for (const p of preds) {
      const i = headers.findIndex(p)
      if (i !== -1) return i
    }
    return -1
  }
  const exact = (name: string) => col((h) => h === name, (h) => h.includes(name))

  const dateCol = col((h) => h === '시작일', (h) => h.includes('시작일'), (h) => /시작|발송일|캠페인.?일자/.test(h))
  if (dateCol === -1) throw new Error(`시작일 컬럼을 찾지 못했습니다 (헤더: ${headers.join(', ')})`)
  const titleCol = Math.max(0, col((h) => h.includes('캠페인명'), (h) => h.includes('캠페인')))
  const popCol = col((h) => h.replace(/\s+/g, '') === '타겟수', (h) => /타겟\s*수/.test(h))
  const ownerCol = col((h) => h === '담당자', (h) => h.includes('담당자'), (h) => h.includes('운영자'))
  const idx = {
    end: exact('종료일'),
    channel: exact('채널'),
    category: exact('구분'),
    coupon: exact('쿠폰'),
    target: exact('타겟'),
    dept: exact('부서'),
    exec: exact('실행시각'),
  }

  const rows: CampaignRow[] = []
  const seen = new Set<string>() // 시트 이동·복사 중 완전히 같은 행이 두 번 들어간 경우 제거
  for (const r of json.table.rows ?? []) {
    const cells = r.c ?? []
    const texts = headers.map((_, i) => cellText(cells[i]))
    const val = (i: number) => (i === -1 ? '' : texts[i].trim())
    if (isTestCampaignTitle(val(titleCol))) continue
    const signature = texts.join('')
    if (seen.has(signature)) continue
    seen.add(signature)
    const parsed = parseGvizDate(cells[dateCol], types[dateCol])
    if (!parsed) continue
    rows.push({
      title: val(titleCol) || '(제목 없음)',
      start: val(dateCol),
      end: val(idx.end),
      channel: val(idx.channel),
      category: val(idx.category),
      coupon: val(idx.coupon),
      target: val(idx.target),
      dept: val(idx.dept),
      owner: val(ownerCol),
      execAt: val(idx.exec),
      pop: popCol === -1 ? 0 : parsePop(val(popCol)),
      dateKey: dateKey(parsed.y, parsed.mo, parsed.d),
    })
  }
  return rows
}

const CHANNEL_PATTERNS: Record<ChannelKey, RegExp> = {
  tv: /tv\s*팝업/i,
  toast: /토스트\s*팝업/,
  coupon: /쿠폰/,
  seg: /타겟\s*배너|(?:^|[^가-힣])배너|seg/i,
}

const NO_COUPON = /^(n|아니오|없음|no|-|x)$/i

export const hasCoupon = (r: CampaignRow) => Boolean(r.coupon) && !NO_COUPON.test(r.coupon)

function matchesChannel(r: CampaignRow, key: ChannelKey): boolean {
  if (CHANNEL_PATTERNS[key].test(r.channel)) return true
  return key === 'coupon' && hasCoupon(r)
}

/** 캠페인 대시보드의 "유선 캠페인 제외" 기준 부서 */
const WIRELINE_DEPT = '밸류애드팀'

export function filterRows(rows: CampaignRow[], f: CalendarFilter): CampaignRow[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (f.channels.length === 0 || f.channels.some((k) => matchesChannel(r, k))) &&
      !(f.excludeWireline && r.dept === WIRELINE_DEPT) &&
      (!q || r.title.toLowerCase().includes(q)),
  )
}

/** 시작일별로 묶고, 하루 안에서는 타겟 수가 큰 캠페인부터 */
export function groupByDate(rows: CampaignRow[]): Map<string, CampaignRow[]> {
  const map = new Map<string, CampaignRow[]>()
  for (const r of rows) {
    const list = map.get(r.dateKey)
    if (list) list.push(r)
    else map.set(r.dateKey, [r])
  }
  for (const list of map.values()) list.sort((a, b) => b.pop - a.pop)
  return map
}
