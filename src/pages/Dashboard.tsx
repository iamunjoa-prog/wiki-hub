import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EngineSelector } from '../components/EngineSelector'
import { RejectModal } from '../components/RejectModal'
import { useApp } from '../store/AppStore'

/** 히어로에 거는 예시 질문 — 실제로 문서에 답이 있는 것만 올린다 */
const EXAMPLE_QUESTIONS = [
  '판촉용 쿠폰 품의 결재선',
  'CBS 승인요청 버튼 오류',
  '전환동의 팝업 적용 버전',
]

/** 이번 주 월요일. 「이번 주 갱신」이 「전체 문서」와 같은 값이 되던 원인이 기준 부재였다 */
function startOfWeek(now = new Date()): string {
  const d = new Date(now)
  const day = (d.getDay() + 6) % 7 // 월요일 = 0
  d.setDate(d.getDate() - day)
  d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

/** 경과일 — 절대 날짜보다 "며칠 묵었는지"가 승인 판단에 쓰인다 */
function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return '오늘'
  if (days === 1) return '어제'
  return `${days}일 경과`
}

type Group = '오늘' | '이번 주' | '이전'

function groupOf(updatedAt: string, today: string, monday: string): Group {
  if (updatedAt >= today) return '오늘'
  if (updatedAt >= monday) return '이번 주'
  return '이전'
}

/** 청사진 카드 — 면을 채우지 않고 네 꼭지에 등록 마크를 남긴다 */
function Card({
  title,
  aside,
  children,
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="card blueprint">
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      <header className="card-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  )
}

export function Dashboard() {
  const {
    docs,
    sheets,
    proposals,
    promotions,
    systems,
    systemRequests,
    session,
    assistant,
    ask,
    showToast,
    decideProposal,
    decidePromotion,
    decideSystemRequest,
  } = useApp()
  const navigate = useNavigate()
  const canApprove = session.role === 'admin'

  const [mode, setMode] = useState<'ask' | 'search'>('ask')
  const [query, setQuery] = useState('')
  const [rejecting, setRejecting] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  // ⌘K / Ctrl+K — 어느 화면에서든 히어로 입력으로 들어온다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const monday = startOfWeek()
  const updatedThisWeek = docs.filter((d) => d.updatedAt >= monday).length

  // 승인 대기 — 문서·편성표·시스템 세 종류를 한 줄로 합쳐 오래 묵은 순으로 본다
  const approvals = useMemo(
    () =>
      [
        ...proposals
          .filter((p) => p.status === 'pending')
          .map((p) => ({ id: p.id, kind: 'proposal' as const, title: p.docTitle, at: p.requestedAt })),
        ...promotions
          .filter((p) => p.status === 'pending')
          .map((p) => ({ id: p.id, kind: 'promotion' as const, title: `${p.sheetName} 승격`, at: p.requestedAt })),
        ...systemRequests
          .filter((r) => r.status === 'pending')
          .map((r) => ({ id: r.id, kind: 'system' as const, title: `${r.name} 등록`, at: r.requestedAt })),
      ].sort((a, b) => a.at.localeCompare(b.at)),
    [proposals, promotions, systemRequests],
  )
  const shown = approvals.slice(0, 3)

  // 최근 갱신 — 태그·작성자·날짜 열을 빼고 날짜 그룹 + 제목만 남긴다
  const recent = useMemo(() => {
    const sorted = [...docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 7)
    const out: { group: Group; items: typeof sorted }[] = []
    for (const d of sorted) {
      const g = groupOf(d.updatedAt, today, monday)
      const last = out[out.length - 1]
      if (last && last.group === g) last.items.push(d)
      else out.push({ group: g, items: [d] })
    }
    return out
  }, [docs, today, monday])

  const decide = async (
    item: (typeof approvals)[number],
    decision: 'approved' | 'rejected',
    reason?: string,
  ) => {
    if (item.kind === 'proposal') await decideProposal(item.id, decision, reason)
    else if (item.kind === 'promotion') await decidePromotion(item.id, decision, { reason })
    else await decideSystemRequest(item.id, decision, reason)
    showToast(decision === 'approved' ? '승인했습니다' : '반려했습니다')
  }

  const submit = (text: string) => {
    const q = text.trim()
    if (!q) return
    if (mode === 'search') {
      navigate(`/search?q=${encodeURIComponent(q)}`)
      return
    }
    // 질문은 우측 드로어로 — 대시보드는 그대로 두고 승인·문서 작업과 나란히 본다
    ask(q)
    setQuery('')
  }

  const rejectingItem = approvals.find((a) => a.id === rejecting)

  return (
    <div className="content dash">
      {/* ---------- 히어로: 질문/검색 단일 진입 ---------- */}
      <section className="hero">
        <p className="hero-kicker">ASK · SEARCH</p>
        <h1 className="hero-title">문서를 찾거나, 문서에 물어보세요</h1>

        <form
          className="hero-bar"
          onSubmit={(e) => {
            e.preventDefault()
            submit(query)
          }}
        >
          <div className="hero-seg" role="tablist">
            {(['ask', 'search'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={mode === m ? 'on' : ''}
                onClick={() => setMode(m)}
              >
                {m === 'ask' ? '질문' : '검색'}
              </button>
            ))}
          </div>

          <EngineSelector />

          <input
            ref={input}
            className="hero-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === 'ask' ? '월정액 할인 쿠폰 프로모션 배너 진행 가능해?' : '문서 제목·내용 검색'
            }
            aria-label={mode === 'ask' ? '문서에 질문' : '문서 검색'}
          />

          <button className="btn primary hero-submit" type="submit" disabled={assistant.pending}>
            {mode === 'ask' ? '질문' : '검색'}
          </button>
        </form>

        {mode === 'ask' && (
          <div className="hero-chips">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button key={q} type="button" onClick={() => submit(q)}>
                {q}
              </button>
            ))}
          </div>
        )}

        <p className="hero-meta">답변에 근거 문서 표시 · 엔진은 왼쪽에서 전환</p>
      </section>

      {/* ---------- KPI + 주 액션 ---------- */}
      <div className="kpi-bar">
        <div className="kpi-set">
          <div className="kpi-item">
            <b>{docs.length}</b>
            <span>전체 문서</span>
          </div>
          <div className="kpi-item">
            <b className="accent">{updatedThisWeek}</b>
            <span>이번 주 갱신</span>
          </div>
          <div className="kpi-item">
            <b>{approvals.length}</b>
            <span>내 승인 대기</span>
          </div>
        </div>
        <div className="kpi-actions">
          <button className="btn primary blueprint" onClick={() => navigate('/wiki')}>
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />+ 새 문서
          </button>
          <button className="btn" onClick={() => navigate('/requests')}>
            요청 등록
          </button>
        </div>
      </div>

      {/* ---------- 3열 ---------- */}
      <div className="dash-grid">
        <Card
          title="내 승인 대기"
          aside={approvals.length > 0 ? <span className="tag tag-accent">{approvals.length}</span> : undefined}
        >
          {shown.length === 0 && <p className="card-empty">처리할 승인 건이 없습니다</p>}
          {shown.map((a) => (
            <div key={a.id} className="approval-row">
              <span className="t">{a.title}</span>
              <div className="approval-act">
                {canApprove ? (
                  <>
                    <button className="btn primary xs" onClick={() => decide(a, 'approved')}>
                      승인
                    </button>
                    <button className="btn ghost xs" onClick={() => setRejecting(a.id)}>
                      반려
                    </button>
                  </>
                ) : (
                  <span className="muted">승인 권한 없음</span>
                )}
                <span className="muted">{daysAgo(a.at)}</span>
              </div>
            </div>
          ))}
        </Card>

        <Card
          title="최근 업데이트"
          aside={
            <button className="card-link" onClick={() => navigate('/wiki')}>
              전체
            </button>
          }
        >
          {recent.length === 0 && (
            <p className="card-empty">
              최근 7일 갱신 문서가 없습니다
              <button className="btn ghost xs" onClick={() => navigate('/wiki')}>
                + 새 문서
              </button>
            </p>
          )}
          {recent.map((g) => (
            <div key={g.group} className="recent-group">
              <h3>{g.group}</h3>
              {g.items.map((d) => (
                <button key={d.id} className="recent-item" onClick={() => navigate(`/wiki/${d.id}`)}>
                  {d.title}
                </button>
              ))}
            </div>
          ))}
        </Card>

        <div className="dash-col">
          <Card title="바로 열기">
            <div className="quick-grid">
              {sheets.slice(0, 4).map((s) => (
                <button key={s.id} className="quick-chip" onClick={() => navigate(`/sheets?id=${s.id}`)}>
                  {s.name}
                </button>
              ))}
            </div>
          </Card>

          <Card title="외부 시스템">
            {systems.slice(0, 3).map((s) => (
              <a
                key={s.id}
                className="ext-row"
                href={s.url || undefined}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  if (!s.url) {
                    e.preventDefault()
                    navigate('/systems')
                  }
                }}
              >
                <span className="t">{s.name} ↗</span>
                <span className="muted">{s.access === '클라우드 전용' ? '클라우드' : '로컬'}</span>
              </a>
            ))}
          </Card>
        </div>
      </div>

      {rejectingItem && (
        <RejectModal
          onCancel={() => setRejecting(null)}
          onConfirm={async (reason) => {
            setRejecting(null)
            await decide(rejectingItem, 'rejected', reason)
          }}
        />
      )}
    </div>
  )
}
