import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import { TopBar } from '../components/AppShell'
import { EngineToggle } from '../components/AssistantDock'
import { DiffView, diffStats } from '../components/DiffView'
import { ENGINE_LABEL, requestAiEdit, type AiEditResult } from '../lib/assistant'
import { brokenAnchorMessage, brokenAnchors, editWarnings, maskLeaks } from '../lib/docEdit'
import { draftTimeLabel, loadDraft, planRestore, removeDraft, saveDraft, type DraftRestore, type EditDraft } from '../lib/draft'
import { requestDocEdit, type EditProposalResult } from '../lib/proposeEdit'
import { hitLines, requestPublicCheck } from '../lib/publicCheck'
import { useApp } from '../store/AppStore'
import type { PublicHit, WikiDoc } from '../types'

/**
 * 수정 제안의 공개 규칙 검사 — 경고만 보이고 제출은 막지 않는다(requests-report.md 13절 R-A).
 * 이미 문서에 있던 줄까지 짚으면 고칠 수 없는 경고가 쌓이므로, 이번에 새로 생기거나 바뀐 줄만 남긴다
 */
function usePublicWarnings(doc: WikiDoc | undefined, body: string, reason: string, active: boolean): PublicHit[] {
  const [hits, setHits] = useState<PublicHit[]>([])
  useEffect(() => {
    if (!doc || !active) return
    let alive = true
    const t = setTimeout(() => {
      requestPublicCheck({ title: doc.title, body, reason: reason.trim() || undefined, target: 'edit' })
        .then((res) => {
          if (!alive) return
          const norm = (t: string) => t.replace(/\r\n?/g, '\n').split('\n')
          const before = new Set(norm(doc.body).map((l) => l.trim()))
          const lines = norm(body)
          const fresh = (h: PublicHit) =>
            h.where === 'reason' || (h.where === 'body' && h.line !== null && !before.has((lines[h.line - 1] ?? '').trim()))
          setHits([...res.blocks, ...res.warnings].filter(fresh))
        })
        // 검사를 못 해도 제출은 막지 않는다 — 서버 수정 제안 경로는 이 검사와 별개다
        .catch((err) => console.info('[propose] 공개 검사 실패:', (err as Error).message))
    }, 600)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [doc, body, reason, active])
  return active ? hits : []
}

const AI_WAIT_HINT = { claude: '1~2분', codex: '2~3분', gemini: '20~40초' } as const

/**
 * 내 PC의 Claude·Codex CLI(배포 허브는 Gemini)에게 수정 요청을 보내 본문을 고친다.
 * 결과는 편집 칸에만 들어가고, 변경 확인 → 제안 제출(= GitHub PR) → 머지 → 다음 배포를 거쳐야 반영된다.
 */
function AiEditBox({
  doc,
  body,
  onApply,
  onUndo,
  onReview,
}: {
  doc: WikiDoc
  body: string
  onApply: (result: AiEditResult) => void
  onUndo: () => void
  onReview: () => void
}) {
  const { assistant } = useApp()
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<(AiEditResult & { added: number; removed: number }) | null>(null)

  const engines = assistant.usableEngines
  const available = engines.length > 0

  const run = async () => {
    if (!instruction.trim() || busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const result = await requestAiEdit(doc, body, instruction.trim(), engines)
      const stats = diffStats(body, result.body)
      onApply(result)
      setDone({ ...result, added: stats.added, removed: stats.removed })
      setInstruction('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-edit">
      <div className="ai-edit-head">
        <span className="label strong">AI로 수정</span>
        <span className="muted" style={{ fontSize: 12.5 }}>
          바꿀 내용을 말로 적으면 연결된 CLI가 본문을 고쳐 줍니다
        </span>
        <EngineToggle label="엔진" busy={busy} />
      </div>

      {!available ? (
        <span className="muted" style={{ fontSize: 13 }}>
          {assistant.engineStatus === undefined
            ? '엔진 확인 중…'
            : '쓸 수 있는 엔진이 없습니다 — 메인의 챗봇 답변 엔진에서 Claude·Codex CLI를 로그인하거나 Gemini API 키를 설정하세요.'}
        </span>
      ) : (
        <div className="ai-edit-form">
          <textarea
            className="field"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                run()
              }
            }}
            placeholder="예: 쿠폰 발급 한도를 시간당 12만 건으로 바꾸고, 변경 이력 표에 오늘 날짜로 한 줄 추가해 줘"
            aria-label="AI 수정 요청"
            disabled={busy}
          />
          <button className="btn accent" disabled={!instruction.trim() || busy} onClick={run} title="Ctrl+Enter">
            {busy ? '수정 중…' : '수정 요청'}
          </button>
        </div>
      )}

      {busy && assistant.engine && (
        <span className="muted" style={{ fontSize: 12.5 }}>
          {ENGINE_LABEL[assistant.engine]}가 문서를 고치는 중… ({AI_WAIT_HINT[assistant.engine]} 내외)
        </span>
      )}
      {error && <span className="err">{error}</span>}
      {done && (
        <div className="ai-edit-result">
          <b>✓ {done.by}</b>
          <span>
            추가 {done.added}줄 / 삭제 {done.removed}줄
            {done.summary && ` · ${done.summary}`}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              className="btn sm"
              onClick={() => {
                onUndo()
                setDone(null)
              }}
            >
              되돌리기
            </button>
            <button className="btn sm primary" onClick={onReview} disabled={done.added + done.removed === 0}>
              변경 확인 →
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

/** 다시 열 때 임시 저장한 수정을 어떻게 할지 묻는다 — 문구는 requests-doc-edit.md 4-1 */
function DraftRestorePanel({
  restore,
  docVersion,
  onContinue,
  onDiscard,
  onMerge,
}: {
  restore: { draft: EditDraft; plan: DraftRestore }
  docVersion: number
  onContinue: (body: string) => void
  onDiscard: () => void
  onMerge: () => void
}) {
  const { draft, plan } = restore
  const when = draftTimeLabel(draft.savedAt)
  const titles = plan.kind === 'empty' ? [] : plan.titles
  const titleNote = titles.length > 0 ? ` (${titles.map((t) => `「${t}」`).join(', ')})` : ''
  const from = `임시 저장한 수정은 v${draft.baseVersion} 기준인데 문서가 v${docVersion}로 바뀌었`

  let message: string
  if (plan.kind === 'same') message = `${when ? `${when}에 ` : ''}임시 저장한 수정이 있습니다${titleNote}.`
  else if (plan.kind === 'rebased')
    message = `${from}습니다. 내가 고친 장은 바뀌지 않아 최신 문서 위에 다시 얹었습니다.`
  else if (draft.baseVersion === null)
    message =
      '임시 저장한 수정이 어느 버전 기준인지 알 수 없습니다. 그 사이 문서가 바뀌었다면 그대로 제출할 때 바뀐 내용을 되돌리게 됩니다.'
  else message = `${from}고, 내가 고친 장도 바뀌었습니다. 그대로 제출하면 그 사이 바뀐 내용을 되돌리게 됩니다.`

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="label strong">임시 저장한 수정</span>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className={`banner${plan.kind === 'conflict' ? ' warn' : ''}`} role="status">
          <b>{message}</b>
          {plan.kind === 'rebased' && titles.length > 0 && <span>다시 얹은 장: {titles.map((t) => `「${t}」`).join(', ')}</span>}
          <span>
            {when ? `${when} 임시 저장 · ` : ''}이 PC의 이 브라우저에만 있고, 아직 제출하지 않았습니다.
          </span>
          {plan.kind === 'conflict' && (
            <span>
              [나란히 보며 합치기]를 누르면 최신 문서로 시작하고, 옆에 내 임시 저장본을 띄워 둡니다. 필요한 부분만 복사해 옮겨 주세요.
            </span>
          )}
        </div>
        <div className="form-actions">
          {plan.kind === 'same' && (
            <>
              <button className="btn primary" onClick={() => onContinue(draft.body)}>
                이어서 고치기
              </button>
              <button className="btn" onClick={onDiscard}>
                버리고 새로 고치기
              </button>
            </>
          )}
          {plan.kind === 'rebased' && (
            <>
              <button className="btn primary" onClick={() => onContinue(plan.body)}>
                이어서 고치기
              </button>
              <button className="btn" onClick={onDiscard}>
                버리기
              </button>
            </>
          )}
          {plan.kind === 'conflict' && (
            <>
              <button className="btn primary" onClick={onMerge}>
                나란히 보며 합치기
              </button>
              <button className="btn" onClick={onDiscard}>
                버리기
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function ProposeEdit() {
  const { docId } = useParams()
  const navigate = useNavigate()
  const { docs, session, proposals, ensureProposals } = useApp()
  const doc = docs.find((d) => d.id === docId)
  const [beforeAi, setBeforeAi] = useState<string | null>(null)

  // 초안은 계정별로 둔다 — 로그인 없는 데모에서는 데모 계정 아이디를 쓴다
  const accountId = session.loginId ?? session.userId
  /** 다시 열 때 고를 때까지 편집 칸을 열지 않는다 — 옛 초안이 묻지 않고 열리면 그 사이 바뀐 내용을 되돌린다 */
  const [restore, setRestore] = useState<{ draft: EditDraft; plan: DraftRestore } | null>(null)
  /** [나란히 보며 합치기] 때 옆에 두는 옛 초안 — 읽기 전용 */
  const [mergeRef, setMergeRef] = useState<EditDraft | null>(null)
  const [copied, setCopied] = useState(false)
  const loadedFor = useRef<string | null>(null)
  const [step, setStep] = useState<1 | 2>(1)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [body, setBody] = useState('')
  const [reason, setReason] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<'split' | 'inline'>('split')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<{ message: string; status?: number } | null>(null)
  const [result, setResult] = useState<EditProposalResult | null>(null)

  useEffect(() => ensureProposals(), [ensureProposals])
  const publicHits = usePublicWarnings(doc, body, reason, step === 2)

  // 제출 전 안전장치 — LLM 이 아니라 규칙이 거른다 (src/lib/docEdit.ts)
  const checks = useMemo(() => {
    if (!doc || step !== 2) return null
    return {
      leaks: maskLeaks(doc.body, body),
      warnings: editWarnings(doc.body, body),
      broken: brokenAnchors(doc, body, docs),
    }
  }, [doc, docs, body, step])

  useEffect(() => {
    if (!doc || !docId) return
    // 문서 목록이 다시 그려져도 고른 결과를 되묻지 않게 계정·문서·버전마다 한 번만 읽는다
    const loadKey = `${accountId}.${docId}@${doc.version}`
    if (loadedFor.current === loadKey) return
    loadedFor.current = loadKey
    setBody(doc.body)
    setRestore(null)
    setMergeRef(null)
    const draft = loadDraft(accountId, docId)
    if (!draft) return
    const plan = planRestore(draft, doc.version, doc.body)
    if (plan.kind === 'empty') removeDraft(accountId, docId)
    else setRestore({ draft, plan })
  }, [doc, docId, accountId])

  useEffect(() => {
    if (!doc || !docId || restore || !body || body === doc.body) return
    const t = setTimeout(() => {
      // 고르고 난 뒤의 편집은 늘 지금 화면의 문서 기준이다
      const now = new Date()
      saveDraft(accountId, docId, { baseVersion: doc.version, baseBody: doc.body, body, savedAt: now.toISOString() })
      setSavedAt(now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))
    }, 2000)
    return () => clearTimeout(t)
  }, [body, doc, docId, accountId, restore])

  if (!doc) {
    return (
      <>
        <TopBar />
        <div className="content">
          <div className="empty">문서를 찾을 수 없습니다</div>
        </div>
      </>
    )
  }

  const stats = diffStats(doc.body, body)

  const openProposals = (proposals ?? []).filter(
    (p) => p.kind === 'edit' && p.status === 'pending' && p.docCode === doc.code,
  ).length

  const submit = async () => {
    if (busy || !reason.trim() || (checks?.leaks.length ?? 0) > 0) return
    setBusy(true)
    setSubmitError(null)
    try {
      const res = await requestDocEdit(doc, body, reason.trim(), session.name)
      // 초안은 PR 이 실제로 만들어진 뒤에만 지운다 — 실패하면 긴 수정이 그대로 남아야 한다
      removeDraft(accountId, docId!)
      setResult(res)
    } catch (err) {
      setSubmitError({ message: (err as Error).message, status: (err as { status?: number }).status })
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <>
        <TopBar />
        <div className="content">
          <div className="page-head">
            <span className="page-title">수정 제안 완료</span>
          </div>
          <div className="panel">
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span>
                <b>
                  {doc.title} ({doc.code})
                </b>{' '}
                수정으로 PR #{result.prNumber}을 만들었습니다. 관리자가 확인하고 머지하면 다음 배포에서 위키에 반영됩니다.
              </span>
              <span className="muted">
                머지한 뒤에도 재배포하기 전까지는 이 화면의 문서가 그대로입니다 (v{doc.version} 유지). 지금 바뀐 것은 없습니다.
              </span>
              <div className="form-actions">
                <button className="btn primary" onClick={() => window.open(result.prUrl, '_blank', 'noopener,noreferrer')}>
                  PR 열어보기 →
                </button>
                <button className="btn" onClick={() => navigate('/requests')}>
                  내 요청 현황
                </button>
                <button className="btn" onClick={() => navigate(`/wiki/${doc.id}`)}>
                  문서로 돌아가기
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar />
      <div className="content">
        <div className="page-head">
          <span className="page-title">수정 제안 · {step}단계 {step === 1 ? '편집' : '확인'}</span>
          <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
            {doc.title} v{doc.version}
          </span>
        </div>

        {step === 1 && restore ? (
          <DraftRestorePanel
            restore={restore}
            docVersion={doc.version}
            onContinue={(next) => {
              setBody(next)
              setRestore(null)
            }}
            onDiscard={() => {
              removeDraft(accountId, doc.id)
              setBody(doc.body)
              setRestore(null)
            }}
            onMerge={() => {
              setMergeRef(restore.draft)
              setBody(doc.body)
              setRestore(null)
            }}
          />
        ) : step === 1 ? (
          <div className="panel">
            <div className="panel-head">
              <button
                className={`btn sm${tab === 'edit' ? ' primary' : ''}`}
                onClick={() => setTab('edit')}
              >
                편집
              </button>
              <button
                className={`btn sm${tab === 'preview' ? ' primary' : ''}`}
                onClick={() => setTab('preview')}
              >
                미리보기
              </button>
              <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                {savedAt
                  ? `임시 저장됨 · ${savedAt} · 이 PC의 이 브라우저에만 있습니다. 아직 제출하지 않았습니다.`
                  : '고치면 이 브라우저에 자동으로 임시 저장합니다'}
              </span>
            </div>

            <div style={{ padding: 14 }}>
              <AiEditBox
                doc={doc}
                body={body}
                onApply={(result) => {
                  setBeforeAi(body)
                  setBody(result.body)
                  setTab('edit')
                  if (!reason.trim() && result.summary) setReason(`${result.summary} (AI 수정 · ${result.by})`)
                }}
                onUndo={() => {
                  if (beforeAi !== null) setBody(beforeAi)
                  setBeforeAi(null)
                }}
                onReview={() => setStep(2)}
              />
              {mergeRef && (
                <div className="banner warn" role="status" style={{ marginBottom: 10 }}>
                  <b>최신 문서(v{doc.version})로 시작했습니다.</b>
                  <span>
                    오른쪽 임시 저장본에서 내가 고친 부분을 복사해 왼쪽에 옮겨 주세요. 오른쪽은 고칠 수 없고, 아직 제출하지
                    않았습니다.
                  </span>
                </div>
              )}
              <div style={mergeRef ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } : undefined}>
                {tab === 'edit' ? (
                  <textarea
                    className="field"
                    style={{ minHeight: 380 }}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    aria-label="마크다운 편집"
                  />
                ) : (
                  <div className="md" style={{ minHeight: 380 }}>
                    <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkCjkFriendly]}>{body}</ReactMarkdown>
                  </div>
                )}
                {mergeRef && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="label strong">
                        내 임시 저장본{mergeRef.baseVersion !== null ? ` (v${mergeRef.baseVersion} 기준)` : ''} · 읽기 전용
                      </span>
                      <button
                        className="btn sm"
                        style={{ marginLeft: 'auto' }}
                        onClick={() => {
                          navigator.clipboard
                            ?.writeText(mergeRef.body)
                            .then(() => {
                              setCopied(true)
                              setTimeout(() => setCopied(false), 1500)
                            })
                            .catch(() => setCopied(false))
                        }}
                      >
                        {copied ? '복사됨' : '전체 복사'}
                      </button>
                      <button className="btn sm" onClick={() => setMergeRef(null)}>
                        닫기
                      </button>
                    </div>
                    <textarea
                      className="field"
                      style={{ minHeight: 350, flex: 1 }}
                      value={mergeRef.body}
                      readOnly
                      aria-label="내 임시 저장본 (읽기 전용)"
                    />
                  </div>
                )}
              </div>

              <div className="form-actions" style={{ marginTop: 14 }}>
                <button className="btn primary" disabled={!stats.changed} onClick={() => setStep(2)}>
                  다음 · 변경 확인
                </button>
                <button className="btn" onClick={() => navigate(`/wiki/${doc.id}`)}>
                  취소
                </button>
                {!stats.changed && (
                  <span className="mono muted" style={{ fontSize: 10.5 }}>
                    변경 사항이 없습니다
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="panel">
            <div className="panel-head">
              <span className="label strong">변경 내용 확인</span>
              <button
                className="btn sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => setDiffMode((m) => (m === 'split' ? 'inline' : 'split'))}
              >
                {diffMode === 'split' ? '좌우' : '인라인'} ▾
              </button>
            </div>

            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {checks && checks.leaks.length > 0 && (
                <div className="banner danger" role="alert">
                  <b>제출할 수 없습니다 — 가려 둔 표기를 건드렸습니다</b>
                  {checks.leaks.map((m) => (
                    <span key={m}>· {m}</span>
                  ))}
                  <span>편집으로 돌아가 해당 부분을 원래 표기로 되돌려 주세요.</span>
                </div>
              )}
              {publicHits.length > 0 && (
                <div className="banner warn" role="status">
                  <b>제출은 할 수 있지만 확인해 주세요 — 위키는 공개 저장소에 올라갑니다</b>
                  {hitLines(publicHits, false).map((m) => (
                    <span key={m}>· {m}</span>
                  ))}
                </div>
              )}
              {checks && (checks.warnings.length > 0 || checks.broken.length > 0) && (
                <div className="banner warn" role="status">
                  <b>제출은 할 수 있지만 확인해 주세요</b>
                  {checks.warnings.map((m) => (
                    <span key={m}>· {m}</span>
                  ))}
                  {checks.broken.length > 0 && (
                    <span>
                      · 다른 문서에서 이 문서의 소제목을 가리키는 링크가 끊깁니다 — {brokenAnchorMessage(checks.broken)}
                      <br />
                      &nbsp;&nbsp;(소제목 {[...new Set(checks.broken.map((b) => b.anchor))].length}개 · 끊기는 링크 {checks.broken.length}개)
                    </span>
                  )}
                </div>
              )}
              {openProposals > 0 && (
                <div className="banner warn" role="status">
                  이 문서에 열려 있는 제안이 이미 {openProposals}건 있습니다 — 둘 다 머지하려면 나중에 머지하는 쪽에서 충돌할 수 있습니다.
                </div>
              )}
              <DiffView
                before={doc.body}
                after={body}
                leftLabel={`원본 v${doc.version}`}
                rightLabel="내 제안"
                mode={diffMode}
              />

              <span className="mono muted" style={{ fontSize: 10.5 }}>
                추가 {stats.added}줄 / 삭제 {stats.removed}줄
              </span>

              <div className="form-row">
                <span className="label strong">수정 사유 *</span>
                <textarea
                  className="field"
                  style={{ minHeight: 64 }}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="무엇을 왜 바꿨는지 적어 주세요 — 승인자가 판단하는 근거가 됩니다"
                />
              </div>

              {submitError && (
                <div className="err" role="alert">
                  제출하지 못했습니다 — {submitError.message}
                  {submitError.status === 409 && (
                    <>
                      <br />
                      재배포 전이라면 화면의 문서가 옛 버전일 수 있습니다. 편집한 내용은 그대로 남아 있습니다.
                    </>
                  )}
                </div>
              )}

              <div className="form-actions">
                <button
                  className="btn primary"
                  disabled={!reason.trim() || busy || (checks?.leaks.length ?? 0) > 0}
                  onClick={submit}
                >
                  {busy ? 'PR 만드는 중…' : '제안 제출'}
                </button>
                <button className="btn" disabled={busy} onClick={() => setStep(1)}>
                  편집으로
                </button>
                <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                  제출 → GitHub PR 생성 · 머지 후 다음 배포에서 반영
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
