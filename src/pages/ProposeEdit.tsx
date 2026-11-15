import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import { TopBar } from '../components/AppShell'
import { EngineToggle } from '../components/AssistantDock'
import { DiffView, diffStats } from '../components/DiffView'
import { ENGINE_LABEL, requestAiEdit, type AiEditResult } from '../lib/assistant'
import { brokenAnchorMessage, brokenAnchors, editWarnings, maskLeaks } from '../lib/docEdit'
import { requestDocEdit, type EditProposalResult } from '../lib/proposeEdit'
import { useApp } from '../store/AppStore'
import type { WikiDoc } from '../types'

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

export function ProposeEdit() {
  const { docId } = useParams()
  const navigate = useNavigate()
  const { docs, session, proposals, ensureProposals } = useApp()
  const doc = docs.find((d) => d.id === docId)
  const [beforeAi, setBeforeAi] = useState<string | null>(null)

  const draftKey = `wikihub.draft.${docId}`
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
    if (!doc) return
    setBody(localStorage.getItem(draftKey) ?? doc.body)
  }, [doc, draftKey])

  useEffect(() => {
    if (!doc || !body || body === doc.body) return
    const t = setTimeout(() => {
      localStorage.setItem(draftKey, body)
      setSavedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))
    }, 2000)
    return () => clearTimeout(t)
  }, [body, doc, draftKey])

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
      localStorage.removeItem(draftKey)
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

        {step === 1 ? (
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
                {savedAt ? `자동 임시저장 · ${savedAt}` : '변경 시 자동 임시저장'}
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
