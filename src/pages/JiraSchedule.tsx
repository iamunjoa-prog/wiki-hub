import { useEffect, useState } from 'react'
import { TopBar } from '../components/AppShell'

interface JiraScheduleItem {
  key: string
  title: string
  requestDate: string
  dueDate: string
  airPeriod: string
  target: string
  assignee: string
  status: string
  url: string
}

interface JiraScheduleReply {
  items: JiraScheduleItem[]
  note: string
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; reply: JiraScheduleReply }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }

const cell = (v: string) => v || '-'

export function JiraSchedule() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    fetch('/api/jiraSchedule')
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 404) {
          setState({ kind: 'unavailable' })
          return
        }
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setState({ kind: 'error', message: data.error || `HTTP ${res.status}` })
          return
        }
        setState({ kind: 'ready', reply: data as JiraScheduleReply })
      })
      .catch((err) => {
        if (!cancelled) setState({ kind: 'error', message: (err as Error).message })
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return (
    <>
      <TopBar />
      <div className="content">
        <div className="page-head">
          <span className="page-title">Jira 스케줄 확인</span>
          {state.kind === 'ready' && <span className="tag">{state.reply.items.length}건</span>}
          <button
            className="btn sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={state.kind === 'loading'}
          >
            새로고침
          </button>
        </div>

        <div className="hint" style={{ marginBottom: 14 }}>
          Jira 프로젝트 <code>BTVEVT</code>의 이미지 제작 요청 이슈를, 이 PC에 로그인된 Claude CLI가 Jira MCP로
          조회해 정리합니다.
          <br />
          <b>이 화면은 로컬 허브(내 PC에서 <code>npm run dev</code>로 켠 화면)에서만 동작합니다.</b> Jira MCP 연결이
          안 되어 있다면 팀 가이드를 먼저 따라 설정해 주세요.
        </div>

        {state.kind === 'loading' && <div className="panel">불러오는 중…</div>}

        {state.kind === 'unavailable' && (
          <div className="panel">
            <b>배포본에서는 지원되지 않는 화면입니다.</b>
            <div className="muted" style={{ marginTop: 6 }}>
              로컬에서 <code>npm run dev</code>로 허브를 켜고, Claude CLI에 Jira MCP를 연결한 뒤 다시 열어 주세요.
            </div>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="panel">
            <b>조회에 실패했습니다.</b>
            <div className="muted" style={{ marginTop: 6 }}>
              {state.message}
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              Jira MCP가 연결되어 있는지, Claude CLI에 로그인되어 있는지 확인해 주세요.
            </div>
          </div>
        )}

        {state.kind === 'ready' && (
          <div className="panel">
            {state.reply.note && (
              <div className="muted" style={{ marginBottom: 10 }}>
                {state.reply.note}
              </div>
            )}
            {state.reply.items.length === 0 ? (
              <div className="muted">진행 중인 이미지 제작 요청이 없습니다.</div>
            ) : (
              state.reply.items.map((it) => (
                <div key={it.key} className="row">
                  <span className="grow">
                    <a href={it.url} target="_blank" rel="noreferrer" className="mono">
                      {it.key}
                    </a>
                    {' · '}
                    {it.title}
                    <span className="muted">
                      {' · 요청 '}
                      {cell(it.requestDate)}
                      {' → 완료희망 '}
                      {cell(it.dueDate)}
                      {' · 편성 '}
                      {cell(it.airPeriod)}
                      {' · 대상 '}
                      {cell(it.target)}
                    </span>
                  </span>
                  <span className="muted">{it.assignee || '담당자 미정'}</span>
                  <span className="tag">{it.status}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </>
  )
}
