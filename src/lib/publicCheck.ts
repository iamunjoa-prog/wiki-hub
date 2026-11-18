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
  /** 수정 제안은 모두 경고로만 받는다 */
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

function where(hit: PublicHit): string {
  if (hit.where === 'title') return '제목'
  if (hit.where === 'reason') return '등록 사유'
  return hit.line ? `${hit.line}번째 줄` : '본문'
}

/** 항목 한 줄 (8-5) — 금액은 리포트 반영이면 차단, 직접 작성·수정 제안이면 경고로 온다 */
export function hitMessage(hit: PublicHit, blocking: boolean): string {
  const at = `${where(hit)} 「${hit.text}」`
  switch (hit.kind) {
    case 'amount':
      return blocking
        ? `${at} — 금액입니다. 금액은 공개 저장소에 올릴 수 없습니다. "늘어나는 추세", "할인 폭이 큰 편"처럼 경향으로 바꿔 주세요.`
        : `${at} — 금액으로 보입니다. 공개 저장소에는 금액 대신 "할인 폭이 큰 편"처럼 경향으로 쓰는 것이 좋습니다.`
    case 'name':
      return `${at} — 공개하면 안 되는 이름 목록에 있는 이름입니다. "제휴사"처럼 일반 표현으로 바꿔 주세요.`
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
export function hitLines(hits: PublicHit[], blocking: boolean): string[] {
  const todos = hits.filter((h) => h.kind === 'todo').length
  const lines = hits.filter((h) => h.kind !== 'todo').map((h) => hitMessage(h, blocking))
  if (todos) lines.push(`채워야 할 칸 "(보완 필요)"가 ${todos}곳 있습니다. 그대로 제출해도 되지만, 아는 값이면 채워 주세요.`)
  return lines
}
