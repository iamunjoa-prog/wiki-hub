/**
 * 수정 제안 임시 저장 — 기준 버전을 같이 적어, 문서가 새 버전으로 배포된 뒤 옛 초안이 묻지 않고 열리지 않게 한다
 * (requests-doc-edit.md 4-1). 편집은 장(H2) 단위라 "내가 고친 장"은 H2 구획을 비교해 계산한다.
 */

export interface EditDraft {
  /** 초안을 시작한 문서 버전. 옛 키에서 옮긴 초안은 모른다(null) */
  baseVersion: number | null
  /** 초안을 시작할 때의 본문 — 내가 고친 장을 가려내는 비교 기준 */
  baseBody: string | null
  body: string
  /** 쓰다 만 수정 사유 — 이어서 고칠 때 다시 채운다. 옛 초안은 없다('') */
  reason: string
  /** ISO 시각. 옛 키에서 옮긴 초안은 모른다(null) */
  savedAt: string | null
}

export interface DocSection {
  /** 같은 제목이 두 번 나와도 섞이지 않게 제목 뒤에 몇 번째인지 붙인다. 첫 H2 앞부분은 '' */
  key: string
  title: string
  text: string
}

export const normBody = (s: string) => s.replace(/\r\n?/g, '\n')
const norm = normBody

/**
 * 본문을 H2(`## `) 기준 장으로 나눈다 — 코드 블록 안의 `##` 는 장 제목이 아니다.
 * 본문이 `##` 로 바로 시작하면 빈 머리말을 만들지 않는다 — 그래야 joinSections 가 원문과 글자 하나 다르지 않게 되돌린다
 */
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
  return out
    .filter((s, i) => i > 0 || s.lines.length > 0)
    .map(({ title, lines }) => {
      const n = (seen.get(title) ?? 0) + 1
      seen.set(title, n)
      return { key: `${title}#${n}`, title, text: lines.join('\n') }
    })
}

/** splitSections 의 반대 — 장마다 나눈 줄을 그대로 다시 잇는다 */
export const joinSections = (sections: Pick<DocSection, 'text'>[]) => sections.map((s) => s.text).join('\n')

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

/** 최신본에서도 바뀐 내 장 — 옛 기준·최신·내 것을 나란히 보여 주려고 셋 다 든다 */
export interface SectionClash {
  key: string
  title: string
  base: string
  latest: string
  mine: string
}

export type SectionRebase =
  /** 내가 고친 장이 최신본에서도 그대로라 최신 본문 위에 내 장만 다시 얹었다 */
  | { kind: 'rebased'; body: string; titles: string[] }
  /**
   * 내가 고친 장 가운데 최신본에서도 바뀐 장이 있다. body 는 겹치지 않는 내 장만 얹은 최신 본문.
   * 장 구성이 달라(장이 생기거나 없어짐) 어디에 얹을지 모르면 clashes 가 null 이고 body 는 최신 본문 그대로다
   */
  | { kind: 'conflict'; body: string; titles: string[]; clashes: SectionClash[] | null }

/**
 * 옛 기준(base) 위에서 고친 본문(mine)을 최신 본문(latest) 위로 옮긴다 — 임시 저장 복원(4-1)과 409(4-3)가 같은 규칙을 쓴다.
 * 장이 같은지는 그 장의 원문 글자가 기준과 최신본에서 같은가로 본다
 */
export function rebaseSections(baseBody: string, body: string, latestBody: string): SectionRebase {
  const base = norm(baseBody)
  const latest = norm(latestBody)
  const changed = changedSections(base, norm(body))
  if (!changed) return { kind: 'conflict', body: latest, titles: [], clashes: null }
  const baseByKey = new Map(splitSections(base).map((s) => [s.key, s.text]))
  const latestSections = splitSections(latest)
  const latestByKey = new Map(latestSections.map((s) => [s.key, s.text]))
  if (changed.some((s) => !latestByKey.has(s.key))) return { kind: 'conflict', body: latest, titles: titlesOf(changed), clashes: null }
  // 내가 고친 장이 최신 본문에서도 시작할 때 그대로여야만 다시 얹는다
  const clash = changed.filter((s) => latestByKey.get(s.key) !== baseByKey.get(s.key))
  const clashKeys = new Set(clash.map((s) => s.key))
  const mineByKey = new Map(changed.filter((s) => !clashKeys.has(s.key)).map((s) => [s.key, s.text]))
  const merged = joinSections(latestSections.map((s) => ({ text: mineByKey.get(s.key) ?? s.text })))
  if (clash.length === 0) return { kind: 'rebased', body: merged, titles: titlesOf(changed) }
  return {
    kind: 'conflict',
    body: merged,
    titles: titlesOf(clash),
    clashes: clash.map((s) => ({ key: s.key, title: s.title, base: baseByKey.get(s.key) ?? '', latest: latestByKey.get(s.key) ?? '', mine: s.text })),
  }
}

/** 다시 열 때 초안을 어떻게 보여 줄지 정한다 — 어떤 경우에도 옛 초안을 묻지 않고 열지 않는다 */
export function planRestore(draft: EditDraft, docVersion: number, docBody: string): DraftRestore {
  const body = norm(draft.body)
  const latest = norm(docBody)
  if (draft.baseVersion === null || draft.baseBody === null) {
    return body === latest ? { kind: 'empty' } : { kind: 'conflict', titles: [] }
  }
  const base = norm(draft.baseBody)
  if (body === base) return { kind: 'empty' }
  if (draft.baseVersion === docVersion) return { kind: 'same', titles: titlesOf(changedSections(base, body)) }
  const r = rebaseSections(base, body, latest)
  return r.kind === 'rebased' ? r : { kind: 'conflict', titles: r.titles }
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
          reason: typeof v.reason === 'string' ? v.reason : '',
          savedAt: typeof v.savedAt === 'string' ? v.savedAt : null,
        }
      }
    } catch {
      // 깨진 값은 기준을 모르는 초안으로 다룬다 — 본문이 남아 있을 수 있어 버리지 않는다
    }
    return { baseVersion: null, baseBody: null, body: raw, reason: '', savedAt: null }
  }
  const legacy = localStorage.getItem(legacyKey(docId))
  if (legacy === null) return null
  const moved: EditDraft = { baseVersion: null, baseBody: null, body: legacy, reason: '', savedAt: null }
  saveDraft(accountId, docId, moved)
  localStorage.removeItem(legacyKey(docId))
  return moved
}

/** 저장 공간이 차거나 막히면 false — 화면이 "임시 저장 못 함"을 띄운다 */
export function saveDraft(accountId: string, docId: string, draft: EditDraft): boolean {
  try {
    localStorage.setItem(draftKey(accountId, docId), JSON.stringify(draft))
    return true
  } catch {
    return false
  }
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

/** 30일 넘은 초안 — 지우지는 않고 띠 문구에만 덧붙인다(doc-editing 4-1) */
export const draftIsOld = (iso: string | null, now = Date.now()) => {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isFinite(t) && now - t > 30 * 24 * 60 * 60 * 1000
}
