/**
 * 수정 제안 임시 저장 — 기준 버전을 같이 적어, 문서가 새 버전으로 배포된 뒤 옛 초안이 묻지 않고 열리지 않게 한다
 * (requests-doc-edit.md 4-1). 편집은 문서 전체 단위라 "내가 고친 장"은 H2 구획을 비교해 계산한다.
 */

export interface EditDraft {
  /** 초안을 시작한 문서 버전. 옛 키에서 옮긴 초안은 모른다(null) */
  baseVersion: number | null
  /** 초안을 시작할 때의 본문 — 내가 고친 장을 가려내는 비교 기준 */
  baseBody: string | null
  body: string
  /** ISO 시각. 옛 키에서 옮긴 초안은 모른다(null) */
  savedAt: string | null
}

export interface DocSection {
  /** 같은 제목이 두 번 나와도 섞이지 않게 제목 뒤에 몇 번째인지 붙인다. 첫 H2 앞부분은 '' */
  key: string
  title: string
  text: string
}

const norm = (s: string) => s.replace(/\r\n?/g, '\n')

/** 본문을 H2(`## `) 기준 장으로 나눈다 — 코드 블록 안의 `##` 는 장 제목이 아니다 */
export function splitSections(body: string): DocSection[] {
  const out: { title: string; lines: string[] }[] = [{ title: '', lines: [] }]
  let fence: string | null = null
  for (const line of norm(body).split('\n')) {
    const f = /^\s*(```|~~~)/.exec(line)
    if (f) fence = fence === null ? f[1] : fence === f[1] ? null : fence
    if (fence === null && !f && /^##\s/.test(line)) out.push({ title: line.replace(/^##\s+/, '').trim(), lines: [] })
    out[out.length - 1].lines.push(line)
  }
  const seen = new Map<string, number>()
  return out.map(({ title, lines }) => {
    const n = (seen.get(title) ?? 0) + 1
    seen.set(title, n)
    return { key: `${title}#${n}`, title, text: lines.join('\n') }
  })
}

const joinSections = (sections: DocSection[]) => sections.map((s) => s.text).join('\n')

/** 초안이 바꾼 장 — 장이 새로 생기거나 없어졌으면 장 단위로 다시 얹을 수 없으므로 null */
export function changedSections(baseBody: string, body: string): DocSection[] | null {
  const base = splitSections(baseBody)
  const mine = splitSections(body)
  if (base.length !== mine.length || base.some((s, i) => s.key !== mine[i].key)) return null
  return mine.filter((s, i) => s.text !== base[i].text)
}

export type DraftRestore =
  /** 고친 것이 없다 — 묻지 않고 지운다 */
  | { kind: 'empty' }
  | { kind: 'same'; titles: string[] }
  /** 문서가 바뀌었지만 내 장은 그대로라 최신 본문 위에 내 장만 다시 얹었다 */
  | { kind: 'rebased'; body: string; titles: string[] }
  /** 내 장도 바뀌었거나 기준을 모른다 — 그대로 이어 고치면 그 사이 바뀐 내용을 되돌린다 */
  | { kind: 'conflict'; titles: string[] }

const titlesOf = (sections: DocSection[] | null) => (sections ?? []).map((s) => s.title).filter(Boolean)

/** 다시 열 때 초안을 어떻게 보여 줄지 정한다 — 어떤 경우에도 옛 초안을 묻지 않고 열지 않는다 */
export function planRestore(draft: EditDraft, docVersion: number, docBody: string): DraftRestore {
  const body = norm(draft.body)
  const latest = norm(docBody)
  if (draft.baseVersion === null || draft.baseBody === null) {
    return body === latest ? { kind: 'empty' } : { kind: 'conflict', titles: [] }
  }
  const base = norm(draft.baseBody)
  if (body === base) return { kind: 'empty' }
  const changed = changedSections(base, body)
  if (draft.baseVersion === docVersion) return { kind: 'same', titles: titlesOf(changed) }
  if (!changed) return { kind: 'conflict', titles: [] }

  const baseByKey = new Map(splitSections(base).map((s) => [s.key, s.text]))
  const latestSections = splitSections(latest)
  const latestByKey = new Map(latestSections.map((s) => [s.key, s.text]))
  // 내가 고친 장이 최신 본문에서도 시작할 때 그대로여야만 다시 얹는다
  const untouched = changed.every((s) => latestByKey.get(s.key) === baseByKey.get(s.key))
  if (!untouched) return { kind: 'conflict', titles: titlesOf(changed) }
  const mineByKey = new Map(changed.map((s) => [s.key, s.text]))
  const rebased = joinSections(latestSections.map((s) => ({ ...s, text: mineByKey.get(s.key) ?? s.text })))
  return { kind: 'rebased', body: rebased, titles: titlesOf(changed) }
}

// ── 저장소 — 계정별 키. 다른 계정의 초안은 열지 않는다 ──

export const draftKey = (accountId: string, docId: string) => `wikihub.draft.${accountId}.${docId}`
const legacyKey = (docId: string) => `wikihub.draft.${docId}`

/** 내 초안을 읽는다. 옛 키(계정·버전 없음) 초안은 읽은 뒤 새 키로 옮기고 옛 키는 지운다 */
export function loadDraft(accountId: string, docId: string): EditDraft | null {
  const key = draftKey(accountId, docId)
  const raw = localStorage.getItem(key)
  if (raw !== null) {
    try {
      const v = JSON.parse(raw) as Partial<EditDraft>
      if (typeof v.body === 'string') {
        return {
          baseVersion: typeof v.baseVersion === 'number' ? v.baseVersion : null,
          baseBody: typeof v.baseBody === 'string' ? v.baseBody : null,
          body: v.body,
          savedAt: typeof v.savedAt === 'string' ? v.savedAt : null,
        }
      }
    } catch {
      // 깨진 값은 기준을 모르는 초안으로 다룬다 — 본문이 남아 있을 수 있어 버리지 않는다
    }
    return { baseVersion: null, baseBody: null, body: raw, savedAt: null }
  }
  const legacy = localStorage.getItem(legacyKey(docId))
  if (legacy === null) return null
  const moved: EditDraft = { baseVersion: null, baseBody: null, body: legacy, savedAt: null }
  saveDraft(accountId, docId, moved)
  localStorage.removeItem(legacyKey(docId))
  return moved
}

export function saveDraft(accountId: string, docId: string, draft: EditDraft) {
  localStorage.setItem(draftKey(accountId, docId), JSON.stringify(draft))
}

export function removeDraft(accountId: string, docId: string) {
  localStorage.removeItem(draftKey(accountId, docId))
}

/** 「{월/일 시:분}」 */
export function draftTimeLabel(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
