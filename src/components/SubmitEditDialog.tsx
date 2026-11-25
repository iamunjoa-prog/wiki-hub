import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DiffView } from './DiffView'
import { publicItems, type EditChecks } from './DocEditPanel'
import { sectionLabel, type SectionChange } from '../lib/docEdit'
import { joinSections, normBody, rebaseSections, splitSections, type SectionClash } from '../lib/draft'
import { editSubmitFailureText, requestDocEdit, StaleDocError, type EditProposalResult } from '../lib/proposeEdit'
import { checkKey, hitLines, PublicLeakError } from '../lib/publicCheck'
import { useApp } from '../store/AppStore'
import type { PublicHit, WikiDoc } from '../types'

/** 편집 기준 — 화면 묶음의 문서이거나, 409 뒤에는 서버가 준 최신본 */
export interface EditBase {
  version: number
  body: string
}

/** 409 뒤 상태 — 문구는 requests-doc-edit.md 4-3 */
type Stale =
  | { kind: 'rebased'; from: number; to: number; titles: string[]; before: string; latest: string; picked: boolean }
  | { kind: 'clash'; to: number; latest: string; merged: string; clashes: SectionClash[]; picks: Record<string, 'latest' | 'mine'> }
  | { kind: 'nofit'; to: number; latest: string; titles: string[] }
  | { kind: 'nobody'; to: number | null }

const titleList = (titles: string[]) => titles.map((t) => `「${sectionLabel(t)}」`).join(', ')

/**
 * 제출 확인 창 — 화면 가운데에 뜨고 페이지는 그대로다(doc-editing 2절 ③). 비교는 1차 허용안대로 장 단위 DiffView.
 * 차단이 있으면 [제출]이 꺼진다. 409 는 같은 창 안에서 최신본에 다시 얹거나 겹친 장만 나란히 보여 준다
 */
export function SubmitEditDialog({
  doc,
  base,
  body,
  reason,
  defaultReason,
  onReason,
  changes,
  checks,
  parts,
  pendingCount,
  onClose,
  onGoFix,
  onRebase,
  onReEdit,
  onSubmitted,
}: {
  doc: WikiDoc
  base: EditBase
  body: string
  reason: string
  defaultReason: string
  onReason: (v: string) => void
  changes: SectionChange[]
  checks: EditChecks
  parts: string[]
  pendingCount: number
  onClose: () => void
  onGoFix: (slot: number | null) => void
  /** 최신본 위에 다시 얹은 본문 — 편집 기준도 최신본으로 바꾼다 */
  onRebase: (next: EditBase, body: string) => void
  /** 최신본에서 다시 고치기 — 창을 닫고 겹친 장을 연다. 내 글은 패널 「참고」로 남긴다 */
  onReEdit: (next: EditBase, body: string, mine: string, keys: string[]) => void
  onSubmitted: (result: EditProposalResult) => void
}) {
  const { session } = useApp()
  const admin = session.role === 'admin'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serverBlocks, setServerBlocks] = useState<{ blocks: PublicHit[]; key: string } | null>(null)
  const [stale, setStale] = useState<Stale | null>(null)
  const [showTheirs, setShowTheirs] = useState(false)
  const [diffMode, setDiffMode] = useState<'inline' | 'split'>('inline')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const sendReason = reason.trim() || defaultReason
  const key = checkKey({ title: doc.title, body, reason: sendReason })
  const shownServer = serverBlocks && serverBlocks.key === key ? serverBlocks.blocks : null
  const publicBlocks = shownServer ?? checks.publicBlocks
  const blockItems = [...checks.leaks.map((l) => l.text)]
  const publicBlockLines = hitLines(publicBlocks, true, { body, reasonLabel: '수정 사유' })
  const warnItems = [...publicItems(checks.publicWarnings, false, body, parts), ...checks.warnings]
  const blocked = blockItems.length > 0 || publicBlocks.length > 0
  const firstSlot = [...checks.leaks, ...publicItems(publicBlocks, true, body, parts), ...warnItems].find((i) => i.slot !== null)?.slot ?? null
  const waiting = stale?.kind === 'clash' || stale?.kind === 'nofit' || stale?.kind === 'nobody'
  const canSend = !busy && !blocked && checks.publicCurrent && changes.length > 0 && Boolean(sendReason) && !waiting

  const handleStale = (err: StaleDocError) => {
    if (err.mainBody === null || err.mainVersion === null) {
      setStale({ kind: 'nobody', to: err.mainVersion })
      return
    }
    const latest = normBody(err.mainBody)
    const r = rebaseSections(base.body, body, latest)
    if (r.kind === 'rebased') {
      setStale({ kind: 'rebased', from: base.version, to: err.mainVersion, titles: r.titles, before: base.body, latest, picked: false })
      onRebase({ version: err.mainVersion, body: latest }, r.body)
    } else if (r.clashes) setStale({ kind: 'clash', to: err.mainVersion, latest, merged: r.body, clashes: r.clashes, picks: {} })
    else setStale({ kind: 'nofit', to: err.mainVersion, latest, titles: r.titles })
  }

  const submit = async () => {
    if (!canSend) return
    setBusy(true)
    setError(null)
    setServerBlocks(null)
    const at = key
    try {
      const res = await requestDocEdit({ ...doc, version: base.version }, body, sendReason, session.name)
      onSubmitted(res)
    } catch (err) {
      if (err instanceof PublicLeakError) setServerBlocks({ blocks: err.blocks, key: at })
      else if (err instanceof StaleDocError) handleStale(err)
      else setError(editSubmitFailureText(err, admin))
    } finally {
      setBusy(false)
    }
  }

  /** 겹친 장마다 고른 대로 최신본 위에 얹는다 — 다 고르면 [다시 제출]로 */
  const pick = (s: Extract<Stale, { kind: 'clash' }>, clashKey: string, choice: 'latest' | 'mine') => {
    const picks = { ...s.picks, [clashKey]: choice }
    if (s.clashes.some((c) => !picks[c.key])) {
      setStale({ ...s, picks })
      return
    }
    const mine = new Map(s.clashes.filter((c) => picks[c.key] === 'mine').map((c) => [c.key, c.mine]))
    const next = joinSections(splitSections(s.merged).map((sec) => ({ text: mine.get(sec.key) ?? sec.text })))
    setStale({ kind: 'rebased', from: base.version, to: s.to, titles: s.clashes.map((c) => c.title), before: base.body, latest: s.latest, picked: true })
    onRebase({ version: s.to, body: s.latest }, next)
  }

  const kindLabel = { changed: '고침', added: '새 장', removed: '지운 장' } as const

  return (
    <div className="modal-back submit-back" onClick={() => !busy && onClose()}>
      <div className="modal submit-modal" role="dialog" aria-modal="true" aria-label="이대로 제출할까요?" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span className="label strong">이대로 제출할까요?</span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={busy} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="modal-body submit-body">
          <span className="mono muted" style={{ fontSize: 12 }}>
            {doc.title} · {doc.code} · v{base.version} 기준
          </span>

          {stale?.kind === 'rebased' && (
            <div className="banner" role="status">
              <b>
                {stale.picked
                  ? `문서가 그사이 v${stale.to}로 바뀌어, 고른 대로 최신 문서 위에 다시 얹었습니다. 아직 제출하지 않았습니다.`
                  : `문서가 그사이 v${stale.to}로 바뀌었습니다 (다른 제안이 먼저 승인됨). 내가 고친 ${titleList(stale.titles)} 장은 바뀌지 않아 최신 문서 위에 다시 얹었습니다. 아직 제출하지 않았습니다.`}
              </b>
              <span className="banner-foot">이 화면의 위키 본문은 다음 배포 전까지 v{stale.from} 그대로입니다. 고칠 때는 v{stale.to} 기준으로 고칩니다.</span>
              <div className="form-actions">
                <button className="btn sm" onClick={() => setShowTheirs((v) => !v)}>
                  {showTheirs ? '바뀐 곳 닫기' : '바뀐 곳 보기'}
                </button>
              </div>
              {showTheirs && <DiffView before={stale.before} after={stale.latest} leftLabel={`v${stale.from}`} rightLabel={`v${stale.to}`} mode="inline" />}
            </div>
          )}

          {stale?.kind === 'clash' && (
            <div className="banner warn" role="alert">
              <b>
                문서가 그사이 v{stale.to}로 바뀌었고, 내가 고친 {titleList(stale.clashes.map((c) => c.title))} 장도 바뀌었습니다. 제출하지 않았습니다. 최신
                내용과 내 수정을 나란히 보여 드립니다. 합친 뒤 다시 제출해 주세요. 내 수정은 그대로 있습니다.
              </b>
              {stale.clashes.map((c) => (
                <div key={c.key} className="clash">
                  <span className="label strong">
                    「{sectionLabel(c.title)}」 {stale.picks[c.key] ? `· ${stale.picks[c.key] === 'mine' ? '내 것으로 덮기' : '최신본으로 두기'} 고름` : ''}
                  </span>
                  <DiffView before={c.latest} after={c.mine} leftLabel={`다른 분이 고친 최신본 v${stale.to}`} rightLabel="내 수정" />
                  <div className="form-actions">
                    <button className="btn sm" onClick={() => pick(stale, c.key, 'latest')}>
                      최신본으로 두기
                    </button>
                    <button className="btn sm" onClick={() => pick(stale, c.key, 'mine')}>
                      내 것으로 덮기
                    </button>
                    <button
                      className="btn sm primary"
                      onClick={() =>
                        onReEdit(
                          { version: stale.to, body: stale.latest },
                          stale.merged,
                          stale.clashes.map((x) => x.mine).join('\n\n'),
                          stale.clashes.map((x) => x.key),
                        )
                      }
                    >
                      최신본에서 다시 고치기
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {stale?.kind === 'nofit' && (
            <div className="banner warn" role="alert">
              <b>
                문서가 그사이 v{stale.to}로 바뀌었고, 내가 고친 {stale.titles.length ? `${titleList(stale.titles)} 장` : '장'}도 바뀌었습니다. 제출하지
                않았습니다. 장 구성이 달라 자동으로 합칠 수 없습니다. 최신 문서로 다시 열고 내 수정은 옆에 남겨 둡니다. 내 수정은 그대로 있습니다.
              </b>
              <div className="form-actions">
                <button className="btn sm primary" onClick={() => onReEdit({ version: stale.to, body: stale.latest }, stale.latest, body, [])}>
                  최신본에서 다시 고치기
                </button>
                <button className="btn sm" onClick={onClose}>
                  취소
                </button>
              </div>
            </div>
          )}

          {stale?.kind === 'nobody' && (
            <div className="banner warn" role="alert">
              <b>
                문서가 그사이 {stale.to ? `v${stale.to}로 ` : ''}바뀌었습니다. 제출하지 않았고, 내 수정은 임시 저장돼 있습니다. 새 내용이 위키에 반영된
                뒤(다음 배포 뒤) 다시 열어 제출해 주세요.
              </b>
              <div className="form-actions">
                <button className="btn sm" onClick={onClose}>
                  닫기
                </button>
              </div>
            </div>
          )}

          <div className="form-actions">
            <span className="label strong">바뀐 곳 {changes.length}</span>
            <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setDiffMode((m) => (m === 'inline' ? 'split' : 'inline'))}>
              {diffMode === 'inline' ? '좌우로 보기' : '한 줄로 보기'}
            </button>
          </div>
          {changes.map((c) => (
            <div key={`${c.kind}-${c.key}`} className="submit-change">
              <span className="label">
                「{sectionLabel(c.title)}」 · {kindLabel[c.kind]}
              </span>
              <DiffView before={c.before} after={c.after} leftLabel={`원본 v${base.version}`} rightLabel="내 수정" mode={diffMode} />
            </div>
          ))}

          {blockItems.length > 0 && (
            <div className="banner danger" role="alert">
              <b>제출하지 못했습니다 — 가려 둔 표기를 건드렸습니다</b>
              {blockItems.map((m) => (
                <span key={m}>· {m}</span>
              ))}
              <span>해당 부분을 원래 표기로 되돌려 주세요. 수정은 그대로 있습니다.</span>
            </div>
          )}
          {publicBlocks.length > 0 && (
            <div className="banner danger" role="alert">
              <b>제출하지 못했습니다 — 위키는 공개 저장소라 올릴 수 없는 표현이 있습니다</b>
              {publicBlockLines.map((m) => (
                <span key={m}>· {m}</span>
              ))}
              <span>고친 뒤 다시 제출해 주세요. 수정은 그대로 있습니다.</span>
            </div>
          )}
          {!blocked && (warnItems.length > 0 || pendingCount > 0) && (
            <div className="banner warn" role="status">
              <b>제출할 수 있지만 확인해 주세요 — 위키는 공개 저장소에 올라갑니다</b>
              {pendingCount > 0 && <span>· 이 문서에 대기 중인 제안이 {pendingCount}건 있습니다.</span>}
              {warnItems.map((m) => (
                <span key={m.text}>· {m.text}</span>
              ))}
            </div>
          )}
          {checks.publicFailed && <span className="muted" style={{ fontSize: 12.5 }}>공개 규칙 검사를 못 했어요. 제출은 할 수 있어요</span>}

          <div className="form-row">
            <span className="label strong">수정 사유 *</span>
            <textarea
              className="field"
              style={{ minHeight: 56 }}
              value={reason}
              placeholder={defaultReason}
              onChange={(e) => onReason(e.target.value)}
              aria-label="수정 사유"
            />
          </div>

          <div className="hint submit-after">
            <b>제출하면</b>
            <span>① 「대기 중」으로 내 요청에 올라갑니다</span>
            <span>② 관리자가 확인하고 승인(머지)합니다</span>
            <span>③ 승인되면 다음 배포 때 위키에 반영됩니다. 그 전까지 이 화면의 문서는 v{doc.version} 그대로입니다</span>
          </div>

          {error && (
            <div className="err" role="alert">
              {error}
            </div>
          )}
        </div>
        {/* 버튼 줄은 스크롤 밖에 둔다 — 바뀐 곳이 길어도 [제출]이 늘 보이게 */}
        <div className="form-actions submit-foot">
          {(blocked || warnItems.length > 0) && (
            <button className="btn" onClick={() => onGoFix(firstSlot)} disabled={busy}>
              {blocked ? '고치기' : '고치러 가기'}
            </button>
          )}
          <span style={{ marginLeft: 'auto' }} />
          <button className="btn" onClick={onClose} disabled={busy}>
            더 고치기
          </button>
          <button className="btn primary" disabled={!canSend} onClick={submit}>
            {busy
              ? '제안 올리는 중…'
              : !checks.publicCurrent
                ? '확인하는 중…'
                : stale?.kind === 'rebased'
                  ? '다시 제출'
                  : warnItems.length > 0
                    ? '그래도 제출'
                    : '제출'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 제출 뒤 — 같은 자리의 창이 완료 상태로 바뀐다. 문구는 requests-doc-edit.md 5-1 */
export function SubmitDoneDialog({
  result,
  titles,
  onClose,
}: {
  result: EditProposalResult
  titles: string[]
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { session } = useApp()
  const named = titles.length ? titleList(titles) : '문서'
  return (
    <div className="modal-back submit-back" onClick={onClose}>
      <div className="modal submit-modal done" role="dialog" aria-modal="true" aria-label="제출했어요" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span className="label strong">
            <span className="lamp ok" aria-hidden="true" /> 제출했어요 · 대기 중 · PR #{result.prNumber}
          </span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <span>
            {named} 수정 제안을 올렸습니다 · 대기 중. 관리자가 승인(머지)하면 다음 배포 때 위키에 반영됩니다. 지금 보이는 문서는 아직 그대로입니다.
          </span>
          <div className="form-actions" style={{ flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => navigate('/requests')}>
              내 요청에서 보기
            </button>
            <a className="btn" href={result.prUrl} target="_blank" rel="noreferrer">
              PR 보기 ↗
            </a>
            {session.role === 'admin' && (
              <a className="btn" href={result.prUrl} target="_blank" rel="noreferrer">
                PR에서 바로 머지하기 ↗
              </a>
            )}
            <button className="btn" onClick={onClose}>
              문서로 돌아가기
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
