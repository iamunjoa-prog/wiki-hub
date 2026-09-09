import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TopBar } from '../components/AppShell'
import { DiffView, diffStats } from '../components/DiffView'
import { useApp } from '../store/AppStore'

export function ProposeEdit() {
  const { docId } = useParams()
  const navigate = useNavigate()
  const { docs, submitProposal } = useApp()
  const doc = docs.find((d) => d.id === docId)

  const draftKey = `wikihub.draft.${docId}`
  const [step, setStep] = useState<1 | 2>(1)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [body, setBody] = useState('')
  const [reason, setReason] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<'split' | 'inline'>('split')

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

  const submit = () => {
    submitProposal(doc.id, body, reason.trim())
    localStorage.removeItem(draftKey)
    navigate('/requests')
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
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
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

              <div className="form-actions">
                <button className="btn primary" disabled={!reason.trim()} onClick={submit}>
                  제안 제출
                </button>
                <button className="btn" onClick={() => setStep(1)}>
                  편집으로
                </button>
                <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                  제출 → 승인 대기
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
