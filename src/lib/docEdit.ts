import type { WikiDoc } from '../types'

/**
 * 문서 수정 제안의 안전장치 — LLM 이 아니라 **규칙**이 하는 검사.
 * 전부 `before`/`after` 문자열(과 문서 목록)만 받는 순수 함수라 화면 없이 바로 시험할 수 있다.
 *
 * 왜 규칙인가: 배포 허브의 Gemini 는 문서 하나만 받아 보므로 다른 문서의 링크가 끊긴다는 걸 알 수 없고,
 * 가려 둔 표기를 채워 달라는 요청도 모델마다 다르게 다룬다. 사람이 PR 을 올리기 전에 마지막으로 거르는 층이다.
 */

/**
 * 소제목 앵커. 문서 간 링크(`CODE#h-소제목`)와 `WikiDoc` 화면의 소제목 id 가 이 한 규칙을 쓴다.
 * scripts/check-anchors.mjs 는 node 스크립트라 TS 를 못 불러와 같은 한 줄을 따로 들고 있다 —
 * 규칙을 바꾸면 그쪽도 함께 바꾼다.
 */
export const headingId = (text: string) => `h-${text.trim().replace(/\s+/g, '-')}`

/** 소제목 줄(H2~H4)의 텍스트 */
function headingTexts(body: string): string[] {
  return [...body.matchAll(/^#{2,4}\s+(.*)$/gm)].map((m) => m[1].trim())
}

/**
 * 한글 사이에 별표가 **하나** 낀 가려진 표기. 양옆이 한글이라 `**굵게**` 의 별표 둘과는 겹치지 않는다
 * (`**류*영 매니저**` 처럼 굵게 안에 있어도 잡는다).
 */
const MASKED = /[가-힣]+\*[가-힣]+/g

/** 한 줄에서 짝이 맞는 `**굵게**` 를 걷어낸 뒤에도 남는, 한글에 붙은 별표 두 개 — 별표 2개로 가린 표기 */
function doubleStarMasks(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const rest = line.replace(/\*\*[^*\n]+\*\*/g, ' ')
    for (const m of rest.matchAll(/[가-힣]+\*\*[가-힣]*/g)) out.push(m[0])
  }
  return out
}

/**
 * 치명 — 제출을 막는다. 가려 둔 표기가 실명·정식 명칭으로 채워졌거나, 별표 2개로 가려졌다.
 * - 가린 표기가 사라졌고, 그 보이는 앞·뒤 글자 사이에 글자가 채워진 새 낱말이 생겼으면 복원으로 본다.
 * - `미디어**팀` 처럼 별표 둘로 가린 표기가 새로 생겼으면 위반으로 본다 — 화면이 깨지고,
 *   그게 다음 챗봇 답변에서 가짜 조직명을 만든다 (지식/guide/writing.md).
 */
export function maskLeaks(before: string, after: string): string[] {
  const problems: string[] = []

  const countOf = (text: string) => {
    const m = new Map<string, number>()
    for (const [token] of text.matchAll(MASKED)) m.set(token, (m.get(token) ?? 0) + 1)
    return m
  }
  const was = countOf(before)
  const now = countOf(after)

  const beforeWords = new Set(before.match(/[가-힣]+/g) ?? [])
  const newWords = (after.match(/[가-힣]+/g) ?? []).filter((w) => !beforeWords.has(w))

  for (const [token, n] of was) {
    if ((now.get(token) ?? 0) >= n) continue // 그대로 남아 있다
    const [left, right] = token.split('*')
    const filled = newWords.find((w) => new RegExp(`${left}[가-힣]{1,8}${right}`).test(w))
    if (filled) problems.push(`가려진 표기 「${token}」가 채워진 것으로 보입니다 (${filled}) — 가린 표기는 그대로 둬야 합니다`)
  }

  const seen = new Set(doubleStarMasks(before))
  for (const token of new Set(doubleStarMasks(after))) {
    if (!seen.has(token)) problems.push(`별표 2개로 가린 표기 「${token}」가 생겼습니다 — 가릴 때는 별표를 하나만 씁니다`)
  }

  return problems
}

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length

/** 경고 — 노란 배너, 제출은 허용한다. 섹션을 지우는 수정은 정당할 수 있어서 막지는 않는다 */
export function editWarnings(before: string, after: string): string[] {
  const out: string[] = []

  const was = headingTexts(before)
  const now = new Set(headingTexts(after))
  const gone = was.filter((h) => !now.has(h))
  if (gone.length) {
    const shown = gone.slice(0, 4).map((h) => `「${h}」`).join(' ')
    out.push(`소제목이 사라졌습니다/바뀌었습니다: ${shown}${gone.length > 4 ? ` 외 ${gone.length - 4}개` : ''}`)
  }

  if (after.length < before.length * 0.7) out.push('본문의 30% 이상이 사라졌습니다')

  const rowsBefore = count(before, /^\|/gm)
  const rowsAfter = count(after, /^\|/gm)
  if (rowsBefore > 0 && rowsAfter < rowsBefore * 0.8) out.push(`표 행이 ${rowsBefore}줄에서 ${rowsAfter}줄로 줄었습니다`)

  const fencesBefore = count(before, /^```/gm)
  const fencesAfter = count(after, /^```/gm)
  if (fencesBefore !== fencesAfter) out.push(`코드 블록 표시(\`\`\`)가 ${fencesBefore}개에서 ${fencesAfter}개로 달라졌습니다`)

  // 비어 있다고 표시해 둔 항목 — 조용히 지워지면 챗봇이 빈 칸을 사실처럼 인용한다
  const blank = /\(보완 필요\)|아직 못 채운 것/g
  if (count(after, blank) < count(before, blank)) out.push('비어 있다고 표시해 둔 항목((보완 필요) 등)이 지워졌습니다')

  return out
}

/** 다른 문서 링크 — scripts/check-anchors.mjs 의 LINK 와 같은 모양 */
const LINK = /\[[^\]]+\]\(([A-Z][A-Za-z0-9-]*)(?:#((?:[^()\s]|\([^()]*\))*))?\)/g

export interface BrokenAnchor {
  /** 링크가 들어 있는 파일 (`지식/...`) */
  from: string
  anchor: string
}

/**
 * 이 수정으로 없어지는 소제목을 가리키는 링크 — 문서 코드·소제목 텍스트가 주소라서
 * 소제목을 한 글자만 고쳐도 다른 문서의 링크가 에러 없이 문서 맨 위로 떨어진다.
 * 작성 규칙 문서(guide/writing.md)는 예시용 가짜 앵커를 담고 있어 검사하지 않는다.
 */
export function brokenAnchors(doc: Pick<WikiDoc, 'id' | 'code' | 'body'>, after: string, docs: Pick<WikiDoc, 'id' | 'path' | 'body'>[]): BrokenAnchor[] {
  const kept = new Set(headingTexts(after).map(headingId))
  const removed = new Set(headingTexts(doc.body).map(headingId).filter((a) => !kept.has(a)))
  if (removed.size === 0) return []

  const out: BrokenAnchor[] = []
  const seen = new Set<string>()
  for (const d of docs) {
    if (d.path.endsWith('guide/writing.md')) continue
    const text = d.id === doc.id ? after : d.body
    for (const [, code, anchor] of text.matchAll(LINK)) {
      if (code !== doc.code || !anchor || !removed.has(anchor)) continue
      const key = `${d.path}\n${anchor}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ from: `지식/${d.path}`, anchor })
    }
  }
  return out
}

/** 배너 한 줄 — `지식/promotion/ppm.md 외 4곳의 링크가 끊깁니다` */
export function brokenAnchorMessage(broken: BrokenAnchor[]): string | null {
  const files = [...new Set(broken.map((b) => b.from))]
  if (files.length === 0) return null
  return files.length === 1
    ? `${files[0]}의 링크가 끊깁니다`
    : `${files[0]} 외 ${files.length - 1}곳의 링크가 끊깁니다`
}
