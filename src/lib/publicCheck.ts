import type { PublicCheckResult, PublicHit } from '../types'

/**
 * 공개 규칙 검사 — 위키는 공개 저장소에 올라가므로 새 문서·수정 제안을 내기 전에 서버에 묻는다.
 * 비공개 이름 목록은 서버만 읽는다. 화면은 걸린 위치·표기만 받는다 (docs/sections/requests-report.md 7절)
 */

export type DocVia = 'form' | 'chat' | 'report' | 'attachment'

export interface PublicCheckInput {
  title: string
  body: string
  reason?: string
  via?: DocVia
  /** 수정 제안은 이름·별표 2개만 차단, 금액은 경고로 받는다 */
  target?: 'new' | 'edit'
}

export async function requestPublicCheck(input: PublicCheckInput): Promise<PublicCheckResult> {
  const res = await fetch('/api/publicCheck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = (await res.json().catch(() => null)) as Partial<PublicCheckResult> & { error?: string } | null
  if (!res.ok || !data || !Array.isArray(data.blocks) || !Array.isArray(data.warnings)) {
    throw new Error(data?.error || `HTTP ${res.status}`)
  }
  return { blocks: data.blocks, warnings: data.warnings, namesChecked: data.namesChecked === true }
}

/** 검사 결과를 비교할 때 쓰는 열쇠 — 검사한 뒤 글이 바뀌었는지만 본다 */
export const checkKey = (input: Pick<PublicCheckInput, 'title' | 'body' | 'reason'>) =>
  JSON.stringify([input.title.trim(), input.body.replace(/\r\n?/g, '\n').trim(), (input.reason ?? '').trim()])

/** 서버 검사에 막힌 제출(400 public-leak) — 아무것도 올라가지 않았다. 화면이 blocks 로 빨강 상자를 다시 그린다 */
export class PublicLeakError extends Error {
  constructor(readonly blocks: PublicHit[]) {
    super('공개 저장소에 올릴 수 없는 표현이 있습니다')
    this.name = 'PublicLeakError'
  }
}

/** 새 문서·수정 제안 응답이 400 public-leak 이면 PublicLeakError 로 던진다 — 두 화면이 같은 차단 상자를 그린다 */
export function throwIfPublicLeak(status: number, data: { code?: string; blocks?: unknown }): void {
  if (status === 400 && data.code === 'public-leak' && Array.isArray(data.blocks)) throw new PublicLeakError(data.blocks as PublicHit[])
}

/** 위치를 적을 때 쓰는 글 — body 는 검사한 글과 같은 본문일 때만 넘긴다 */
export interface HitPlace {
  body?: string
  /** 사유 칸 이름 — 새 문서는 "등록 사유", 수정 제안은 "수정 사유" */
  reasonLabel?: string
}

/**
 * 본문 n번째 줄을 "「장 제목」 › 몇째 줄"로 — 긴 문서에서 줄 번호만으로는 찾기 어렵다.
 * 줄 수는 그 장 제목 아래의 빈 줄을 뺀 줄로 센다. 코드 블록 안의 # 줄은 제목으로 보지 않는다
 */
function sectionLine(body: string, line: number): string | null {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  if (line < 1 || line > lines.length) return null
  let heading: string | null = null
  let count = 0
  let fence = false
  for (let i = 0; i < line; i++) {
    const l = lines[i]
    const m = fence ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l)
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    if (m) {
      // 걸린 줄이 장 제목 자체면 그 제목으로 짚는다
      if (i === line - 1) return `「${m[1]}」 장 제목`
      heading = m[1]
      count = 0
    } else if (l.trim()) count++
  }
  return heading ? `「${heading}」 장 › ${count}번째 줄` : null
}

function where(hit: PublicHit, place: HitPlace): string {
  if (hit.where === 'title') return '제목'
  if (hit.where === 'reason') return place.reasonLabel ?? '등록 사유'
  if (!hit.line) return '본문'
  return (place.body !== undefined && sectionLine(place.body, hit.line)) || `본문 ${hit.line}번째 줄`
}

/** 항목 한 줄 (8-5) — 금액은 리포트 반영이면 차단, 직접 작성·수정 제안이면 경고로 온다 */
export function hitMessage(hit: PublicHit, blocking: boolean, place: HitPlace = {}): string {
  const at = `${where(hit, place)} 「${hit.text}」`
  switch (hit.kind) {
    case 'amount':
      return blocking
        ? `${at} — 금액입니다. 금액은 공개 저장소에 올릴 수 없습니다. "늘어나는 추세", "할인 폭이 큰 편"처럼 경향으로 바꿔 주세요.`
        : `${at} — 금액으로 보입니다. 공개 저장소에는 금액 대신 "할인 폭이 큰 편"처럼 경향으로 쓰는 것이 좋습니다.`
    case 'name':
      return `${at} — 공개하면 안 되는 이름 목록에 있는 이름입니다. "A사", "제휴사"처럼 바꿔 주세요.`
    case 'doubleStar':
      return `${at} — 별표 2개로 가린 표기입니다. 가릴 때는 별표를 하나만 씁니다(예: 미디어*팀).`
    case 'company':
      return `${at} — 회사 이름으로 보입니다. 제휴사 이름이면 "제휴사"로 바꿔 주세요.`
    case 'url':
      return `${at} — 인터넷 주소입니다. 사내 주소면 "(URL 생략)"으로 바꿔 주세요.`
    case 'email':
      return `${at} — 이메일 주소입니다. 지워 주세요.`
    case 'phone':
      return `${at} — 전화번호입니다. 지워 주세요.`
    case 'figure':
      return `${at} — 수치입니다. 위키 문서에는 "높은 편", "줄어드는 추세"처럼 경향으로 써 주세요.`
    case 'todo':
      return `${at} — 채워야 할 칸입니다.`
  }
}

/** 상자에 그릴 줄들 — "(보완 필요)"는 곳마다 쓰지 않고 개수 한 줄로 묶는다 (W5) */
export function hitLines(hits: PublicHit[], blocking: boolean, place: HitPlace = {}): string[] {
  const todos = hits.filter((h) => h.kind === 'todo').length
  const lines = hits.filter((h) => h.kind !== 'todo').map((h) => hitMessage(h, blocking, place))
  if (todos) lines.push(`채워야 할 칸 "(보완 필요)"가 ${todos}곳 있습니다. 그대로 제출해도 되지만, 아는 값이면 채워 주세요.`)
  return lines
}
