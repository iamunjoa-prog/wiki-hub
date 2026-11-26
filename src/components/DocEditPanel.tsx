import { useEffect, useMemo, useState } from 'react'
import { changeCount, changeSummary, sectionCards } from './ChangeCards'
import {
  brokenAnchors,
  editWarnings,
  headingId,
  maskLeaks,
  sectionLabel,
  type BrokenAnchor,
  type SectionChange,
} from '../lib/docEdit'
import { draftIsOld, draftTimeLabel, type DraftRestore, type EditDraft } from '../lib/draft'
import { checkKey, hitLines, requestPublicCheck } from '../lib/publicCheck'
import type { ProposalPr, PublicHit, WikiDoc } from '../types'

/** 확인할 것 한 줄 — slot 은 누르면 갈 장(편집 칸 순서), 모르면 null */
export interface CheckItem {
  text: string
  slot: number | null
}

export interface EditChecks {
  /** 가린 표기 채움·별표 2개 — 제출을 막는다(화면 규칙) */
  leaks: CheckItem[]
  /** 공개 규칙 검사 차단(이름·별표 2개) — 제출을 막는다 */
  publicBlocks: PublicHit[]
  publicWarnings: PublicHit[]
  /** 편집 경고·링크 끊김 — 제출은 된다 */
  warnings: CheckItem[]
  broken: BrokenAnchor[]
  /** 서버에 못 닿아 공개 규칙 검사를 못 했다 — 제출은 막지 않는다(서버가 제출 때 다시 본다) */
  publicFailed: boolean
  /** 지금 글로 공개 규칙 검사를 마쳤는가 — 제출 확인 창이 「확인하는 중…」을 고른다 */
  publicCurrent: boolean
  blocked: boolean
}

interface PublicState {
  key: string
  blocks: PublicHit[]
  warnings: PublicHit[]
  failed: boolean
}

/** 본문 n번째 줄이 든 편집 칸 — 본문은 칸을 '\n' 으로 이은 것이라 줄 수를 더해 가며 찾는다 */
export function slotOfLine(parts: string[], line: number): number | null {
  let end = 0
  for (let i = 0; i < parts.length; i++) {
    end += parts[i].split('\n').length
    if (line <= end) return i
  }
  return null
}

/**
 * 편집 중 검사 — 다 고친 뒤가 아니라 고치는 동안 돌린다(doc-editing 3절). 규칙 검사는 바로, 공개 규칙 검사는 600ms 쉬면 한 번.
 * 이미 문서에 있던 줄은 짚지 않는다 — 고칠 수 없는 경고를 쌓지 않는다
 */
export function useEditChecks({
  doc,
  docs,
  baseBody,
  body,
  reason,
  changes,
  slotOfKey,
}: {
  /** 문서를 못 찾았어도 훅 순서를 지키려고 부른다 — 그때는 아무것도 검사하지 않는다 */
  doc: WikiDoc | undefined
  docs: WikiDoc[]
  baseBody: string
  body: string
  reason: string
  changes: SectionChange[]
  slotOfKey: (key: string) => number | null
}): EditChecks {
  const changed = Boolean(doc) && body !== baseBody
  const title = doc?.title ?? ''
  const [pub, setPub] = useState<PublicState | null>(null)
  const key = checkKey({ title, body, reason })

  useEffect(() => {
    if (!changed) return
    let alive = true
    const t = setTimeout(() => {
      requestPublicCheck({ title, body, reason: reason.trim() || undefined, target: 'edit' })
        .then((res) => {
          if (!alive) return
          const before = new Set(baseBody.split('\n').map((l) => l.trim()))
          const lines = body.split('\n')
          const fresh = (h: PublicHit) =>
            h.where === 'reason' || (h.where === 'body' && h.line !== null && !before.has((lines[h.line - 1] ?? '').trim()))
          setPub({ key, blocks: res.blocks.filter(fresh), warnings: res.warnings.filter(fresh), failed: false })
        })
        .catch((err) => {
          // 검사를 못 해도 화면에서는 막지 않는다 — 서버가 제출 때 한 번 더 검사해 막는다
          console.info('[doc-edit] 공개 검사 실패:', (err as Error).message)
          if (alive) setPub({ key, blocks: [], warnings: [], failed: true })
        })
    }, 600)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [title, baseBody, body, reason, key, changed])

  const local = useMemo(() => {
    if (!changed || !doc) return { leaks: [], warnings: [], broken: [] as BrokenAnchor[] }
    // 장마다 돌려 「장」 이름을 앞에 붙인다. 장 사이를 옮겨 채운 경우처럼 장에서 못 잡으면 문서 전체 결과를 위치 없이 쓴다
    const leaks: CheckItem[] = []
    const warnings: CheckItem[] = []
    for (const c of changes) {
      const at = `「${sectionLabel(c.title)}」 장`
      const slot = slotOfKey(c.key)
      for (const m of maskLeaks(c.before, c.after)) leaks.push({ text: `${at} — ${m}`, slot })
      if (c.kind !== 'added') for (const m of editWarnings(c.before, c.after)) warnings.push({ text: `${at} — ${m}`, slot })
    }
    if (leaks.length === 0) for (const m of maskLeaks(baseBody, body)) leaks.push({ text: m, slot: null })
    const broken = brokenAnchors({ ...doc, body: baseBody }, body, docs)
    for (const anchor of new Set(broken.map((b) => b.anchor))) {
      const from = broken.filter((b) => b.anchor === anchor).map((b) => {
        const d = docs.find((x) => `지식/${x.path}` === b.from)
        return d ? `「${d.title}」(${d.code})` : b.from
      })
      const slot = slotOfKey(changes.find((c) => c.before.split('\n').some((l) => /^#{2,4}\s/.test(l) && headingId(l.replace(/^#{2,4}\s+/, '')) === anchor))?.key ?? '')
      warnings.push({ text: `소제목이 바뀌어 다른 문서 ${from.length}곳의 링크가 이 장을 못 찾습니다 — ${from.join(', ')}`, slot })
    }
    return { leaks, warnings, broken }
  }, [changed, changes, slotOfKey, baseBody, body, doc, docs])

  const current = pub !== null && pub.key === key
  const publicBlocks = changed && current ? pub.blocks : []
  const publicWarnings = changed && current ? pub.warnings : []
  return {
    leaks: local.leaks,
    warnings: local.warnings,
    broken: local.broken,
    publicBlocks,
    publicWarnings,
    publicFailed: changed && current && pub.failed,
    publicCurrent: !changed || current,
    blocked: local.leaks.length > 0 || publicBlocks.length > 0,
  }
}

/** 공개 규칙 검사 결과를 칸 위치와 함께 — 위치 문구는 「장」 › n번째 줄 (publicCheck.ts sectionLine) */
export function publicItems(hits: PublicHit[], blocking: boolean, body: string, parts: string[]): CheckItem[] {
  const todos = hits.filter((h) => h.kind === 'todo')
  const rest = hits.filter((h) => h.kind !== 'todo')
  const lines = hitLines(rest, blocking, { body, reasonLabel: '수정 사유' })
  const items = rest.map((h, i) => ({ text: lines[i], slot: h.where === 'body' && h.line ? slotOfLine(parts, h.line) : null }))
  if (todos.length) items.push({ text: hitLines(todos, blocking)[0], slot: todos[0].line ? slotOfLine(parts, todos[0].line) : null })
  return items
}

/** 같은 문서에 승인을 기다리는 제안 — 편집을 시작할 때 한 번 알린다(requests-doc-edit.md 4-2). 목록을 못 읽었으면 아무것도 안 그린다 */
export function PendingProposalsNote({
  pending,
  myName,
  onDismiss,
}: {
  pending: ProposalPr[]
  myName: string
  onDismiss: () => void
}) {
  if (pending.length === 0) return null
  const mine = pending.filter((p) => p.requestedBy === myName)
  const others = pending.filter((p) => p.requestedBy !== myName)
  const day = (p: ProposalPr) => p.requestedAt.slice(5, 10).replace('-', '/')
  const first = mine[0] ?? others[0]
  return (
    <div className="banner warn edit-pending" role="status">
      {others.length > 0 && (
        <span>
          이 문서에 승인을 기다리는 제안이 {others.length}건 있습니다 ({others[0].requestedBy} · {day(others[0])}). 같은 문서를 고치면 나중에
          승인되는 쪽은 다시 올려야 할 수 있습니다.
        </span>
      )}
      {mine.length > 0 && (
        <span>
          이 문서에 내가 올린 제안이 대기 중입니다 (PR #{mine[0].prNumber} · {day(mine[0])}). 지금 고친 것은 별도 제안으로 올라가고, 둘 중
          나중에 승인되는 쪽은 다시 올려야 할 수 있습니다. 앞 제안을 고치려는 것이면 그 PR 에 의견으로 남겨 주세요.
        </span>
      )}
      <div className="form-actions">
        <button className="btn sm" onClick={onDismiss}>
          그래도 고치기
        </button>
        <a className="btn sm" href={first.prUrl} target="_blank" rel="noreferrer">
          {mine.length > 0 ? '내 제안 보기 ↗' : '대기 중 제안 보기 ↗'}
        </a>
      </div>
    </div>
  )
}

/**
 * 문서 머리 위 임시 저장 띠 — 초안이 있을 때만. 고를 때까지 편집 칸을 초안으로 채우지 않는다
 * (문구는 requests-doc-edit.md 4-1, [버리기]는 한 번 더 묻는다 — doc-editing 4-1)
 */
export function DraftBanner({
  draft,
  plan,
  docVersion,
  onContinue,
  onMerge,
  onDiscard,
}: {
  draft: EditDraft
  plan: Exclude<DraftRestore, { kind: 'empty' }>
  docVersion: number
  onContinue: () => void
  onMerge: () => void
  onDiscard: () => void
}) {
  const [asking, setAsking] = useState(false)
  const when = draftTimeLabel(draft.savedAt)
  const titleNote = plan.titles.length > 0 ? ` (${plan.titles.map((t) => `「${sectionLabel(t)}」`).join(', ')})` : ''
  const from = `임시 저장한 수정은 v${draft.baseVersion} 기준인데 문서가 v${docVersion}로 바뀌었`

  let message: string
  if (plan.kind === 'same') message = `${when ? `${when}에 ` : ''}임시 저장한 수정이 있습니다${titleNote}.`
  else if (plan.kind === 'rebased') message = `${from}습니다. 내가 고친 장은 바뀌지 않아 최신 문서 위에 다시 얹었습니다.`
  else if (draft.baseVersion === null)
    message = '임시 저장한 수정이 어느 버전 기준인지 알 수 없습니다. 그 사이 문서가 바뀌었다면 그대로 제출할 때 바뀐 내용을 되돌리게 됩니다.'
  else message = `${from}고, 내가 고친 장도 바뀌었습니다. 그대로 제출하면 그 사이 바뀐 내용을 되돌리게 됩니다.`

  const count = Math.max(plan.titles.length, 1)
  return (
    <div className={`banner draft-banner${plan.kind === 'conflict' ? ' warn' : ''}`} role="status">
      <b>{message}</b>
      <span className="banner-foot">
        {when ? `${when} 임시 저장 · ` : ''}이 PC의 이 브라우저에만 있고, 아직 제출하지 않았습니다.
        {draftIsOld(draft.savedAt) ? ' 오래된 수정이에요.' : ''}
      </span>
      {asking ? (
        <div className="form-actions">
          <span>고친 내용 {count}개 장을 지울까요? 되돌릴 수 없어요.</span>
          <button className="btn sm" onClick={onDiscard}>
            지우기
          </button>
          <button className="btn sm" onClick={() => setAsking(false)}>
            그대로 두기
          </button>
        </div>
      ) : (
        <div className="form-actions">
          {plan.kind === 'conflict' ? (
            <button className="btn sm primary" onClick={onMerge}>
              나란히 보며 합치기
            </button>
          ) : (
            <button className="btn sm primary" onClick={onContinue}>
              이어서 고치기
            </button>
          )}
          <button className="btn sm" onClick={() => setAsking(true)}>
            버리기
          </button>
        </div>
      )}
    </div>
  )
}

/** 오른쪽 칸의 편집 패널 — 바뀐 곳 · 확인할 것 · 수정 사유 · 제출하기 (doc-editing 2절 ②) */
export function DocEditPanel({
  changes,
  checks,
  body,
  parts,
  reason,
  defaultReason,
  onReason,
  onFillReason,
  onJump,
  slotOfKey,
  onSubmit,
  onDiscardAll,
  pendingNote,
  reference,
  onCloseReference,
}: {
  changes: SectionChange[]
  checks: EditChecks
  body: string
  parts: string[]
  reason: string
  defaultReason: string
  onReason: (v: string) => void
  onFillReason: () => void
  onJump: (slot: number | null) => void
  slotOfKey: (key: string) => number | null
  onSubmit: () => void
  onDiscardAll: () => void
  pendingNote: React.ReactNode
  /** 409·합치기 때 옆에 남겨 둔 내 글 — 복사해서 옮겨 쓴다 */
  reference: { label: string; text: string } | null
  onCloseReference: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [askDiscard, setAskDiscard] = useState(false)
  const blockItems = [...checks.leaks, ...publicItems(checks.publicBlocks, true, body, parts)]
  const warnItems = [...publicItems(checks.publicWarnings, false, body, parts), ...checks.warnings]
  const kindLabel = { changed: '고침', added: '새 장', removed: '지움' } as const

  return (
    <aside className="doc-edit-panel" aria-label="편집 패널">
      <div className="edit-panel-sec">
        <div className="label strong">
          {/* 켜진 램프는 편집 바 하나만 — 차단 없을 때 여기는 글자만 */}
          {checks.blocked ? (
            <>
              <span className="lamp warn" aria-hidden="true" /> 제출 전 확인
            </>
          ) : (
            '편집 중'
          )}
        </div>
      </div>

      {pendingNote}

      <div className="edit-panel-sec">
        <div className="label">바뀐 곳 {changeCount(changes)}</div>
        {changes.length === 0 ? (
          <span className="muted edit-panel-empty">아직 바뀐 곳이 없어요</span>
        ) : (
          changes.map((c) => (
            // 줄 수 대신 블록으로 센다 — 「표 칸 1 바뀜 · 문단 1 추가」
            <button key={`${c.kind}-${c.key}`} className="edit-change" onClick={() => onJump(c.kind === 'removed' ? null : slotOfKey(c.key))}>
              <span className="edit-change-title">{sectionLabel(c.title)}</span>
              <span className="muted">
                {c.kind === 'changed' ? '' : `${kindLabel[c.kind]} · `}
                {changeSummary(c, sectionCards(c))}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="edit-panel-sec">
        <div className="label">확인할 것 {blockItems.length + warnItems.length}</div>
        {blockItems.map((it) => (
          <button key={`b-${it.text}`} className="edit-check block" onClick={() => onJump(it.slot)}>
            ⛔ {it.text}
          </button>
        ))}
        {warnItems.map((it) => (
          <button key={`w-${it.text}`} className="edit-check warn" onClick={() => onJump(it.slot)}>
            ⚠ {it.text}
          </button>
        ))}
        {blockItems.length + warnItems.length === 0 && changes.length > 0 && checks.publicCurrent && !checks.publicFailed && (
          <span className="muted edit-panel-empty">걸린 곳이 없어요</span>
        )}
        {changes.length > 0 && !checks.publicCurrent && <span className="muted edit-panel-empty">공개 규칙 확인하는 중…</span>}
        {checks.publicFailed && <span className="muted edit-panel-empty">공개 규칙 검사를 못 했어요. 제출은 할 수 있어요</span>}
      </div>

      {reference && (
        <div className="edit-panel-sec">
          <div className="form-actions">
            <span className="label strong">참고: {reference.label}</span>
            <button
              className="btn sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => {
                navigator.clipboard
                  ?.writeText(reference.text)
                  .then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                  .catch(() => setCopied(false))
              }}
            >
              {copied ? '복사됨' : '복사'}
            </button>
            <button className="btn sm" onClick={onCloseReference}>
              닫기
            </button>
          </div>
          <textarea className="field edit-reference" value={reference.text} readOnly aria-label={`참고: ${reference.label} (읽기 전용)`} />
        </div>
      )}

      <div className="edit-panel-sec">
        <span className="label strong">수정 사유 *</span>
        <textarea
          className="field edit-reason"
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          placeholder={defaultReason || '무엇을 왜 바꿨는지 적어 주세요 — 승인자가 판단하는 근거가 됩니다'}
          aria-label="수정 사유"
        />
        {defaultReason && reason.trim() !== defaultReason && (
          <button className="btn sm" onClick={onFillReason}>
            바뀐 곳으로 사유 채우기
          </button>
        )}
        <button className="btn primary block" disabled={changes.length === 0} onClick={onSubmit}>
          제출하기
        </button>
        <span className="muted edit-panel-foot">승인 뒤 다음 배포에서 반영돼요. 제출하기 전까지는 이 PC에만 임시 저장돼요.</span>
        {changes.length > 0 &&
          (askDiscard ? (
            <div className="form-actions">
              <span className="muted edit-panel-foot">고친 내용을 모두 지울까요? 되돌릴 수 없어요.</span>
              <button
                className="btn sm"
                onClick={() => {
                  // 다음에 다시 고쳤을 때 확인 줄이 미리 열려 있지 않게
                  setAskDiscard(false)
                  onDiscardAll()
                }}
              >
                지우기
              </button>
              <button className="btn sm" onClick={() => setAskDiscard(false)}>
                그대로 두기
              </button>
            </div>
          ) : (
            <button className="btn sm edit-discard" onClick={() => setAskDiscard(true)}>
              고친 것 모두 버리기
            </button>
          ))}
      </div>
    </aside>
  )
}
