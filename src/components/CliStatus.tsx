import { useEffect, useRef, useState } from 'react'
import { ENGINE_LABEL, requestLogin } from '../lib/assistant'
import { useApp } from '../store/AppStore'
import type { Engine, EngineStatus } from '../types'

const ENGINES = Object.keys(ENGINE_LABEL) as Engine[]
const LOGIN_WAIT_MS = 180_000
/** start-hub.bat 은 5173 포트로 고정 실행한다 (vite.config.ts strictPort) */
const LOCAL_URL = 'http://localhost:5173/'
/** scripts/setup.ps1 이 등록하는 링크 — 누르면 이 PC에서 start-hub.bat 이 실행된다 */
const LAUNCH_URL = 'wikihub://start'
const INSTALL_CMD: Record<Engine, string> = {
  claude: 'npm i -g @anthropic-ai/claude-code',
  codex: 'npm i -g @openai/codex',
}
const LOGIN_CMD: Record<Engine, string> = { claude: 'claude auth login', codex: 'codex login' }

type DotState = 'loading' | 'off' | 'ok' | 'warn'

const dotState = (s: EngineStatus | undefined): DotState =>
  !s ? 'loading' : !s.installed ? 'off' : s.loggedIn ? 'ok' : 'warn'

/** 누르면 클립보드에 복사되는 명령어 */
function Cmd({ children }: { children: string }) {
  const { showToast } = useApp()
  return (
    <button
      type="button"
      className="cmd"
      title="클릭해서 복사"
      onClick={() => navigator.clipboard?.writeText(children).then(() => showToast('명령어를 복사했습니다'))}
    >
      <span>{children}</span>
      <span className="muted">복사</span>
    </button>
  )
}

/** 배포 허브에서 이 PC의 로컬 허브가 켜져 있는지 본다 — no-cors라 응답은 못 읽지만 연결 성공 여부는 알 수 있다 */
async function probeLocalHub(): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 1500)
  try {
    await fetch(`${LOCAL_URL}api/engines`, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

type HubState = 'checking' | 'running' | 'stopped' | 'starting'
const HUB_LABEL: Record<HubState, string> = {
  checking: '확인 중…',
  running: '켜져 있음',
  stopped: '꺼져 있음',
  starting: '켜는 중…',
}

/** 로컬 허브가 켜져 있으면 열기, 꺼져 있으면 wikihub:// 링크로 실행 */
function LocalHubLauncher() {
  const [state, setState] = useState<HubState>('checking')
  const startedAt = useRef(0)

  useEffect(() => {
    probeLocalHub().then((ok) => setState(ok ? 'running' : 'stopped'))
  }, [])

  // 실행을 누른 뒤에는 서버가 뜰 때까지 2초마다 확인한다 (첫 실행은 설치 때문에 오래 걸릴 수 있음)
  useEffect(() => {
    if (state !== 'starting') return
    const t = setInterval(async () => {
      if (await probeLocalHub()) setState('running')
      else if (Date.now() - startedAt.current > 180_000) setState('stopped')
    }, 2000)
    return () => clearInterval(t)
  }, [state])

  const launch = () => {
    startedAt.current = Date.now()
    setState('starting')
    window.location.href = LAUNCH_URL
  }

  const dot = state === 'running' ? 'ok' : state === 'stopped' ? 'off' : 'loading'
  return (
    <div className="cli-setting">
      <div className="cli-setting-head">
        <span className={`status-dot ${dot}`} />
        <b>이 PC의 로컬 허브</b>
        <span className={state === 'running' ? 'cli-ok' : 'muted'}>{HUB_LABEL[state]}</span>
      </div>
      {state === 'running' ? (
        <a className="btn sm primary" style={{ alignSelf: 'flex-start' }} href={LOCAL_URL} target="_blank" rel="noreferrer">
          로컬 허브 열기 ↗
        </a>
      ) : (
        <>
          <button className="btn sm primary" style={{ alignSelf: 'flex-start' }} onClick={launch} disabled={state !== 'stopped'}>
            {state === 'starting' ? '켜는 중… 브라우저에서 열기를 허용해 주세요' : '로컬 허브 실행'}
          </button>
          <span className="cli-note">
            버튼을 눌러도 아무 일이 없다면 이 PC에 아직 세팅이 안 된 것입니다. 아래 <b>처음 쓰는 PC라면</b>을 따라 한 번만
            세팅하세요.
          </span>
        </>
      )}
    </div>
  )
}

/** 대시보드용 — 챗봇이 쓰는 로컬 CLI의 설치·로그인 상태와 연결 설정 */
export function CliStatus() {
  const { assistant, refreshEngines, showToast } = useApp()
  const status = assistant.engineStatus
  const [checking, setChecking] = useState(false)
  const [waiting, setWaiting] = useState<Engine | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const waitStart = useRef(0)

  const recheck = async () => {
    setChecking(true)
    await refreshEngines()
    setChecking(false)
  }

  // 로그인 창을 띄운 뒤에는 완료될 때까지 3초마다 다시 확인한다
  useEffect(() => {
    if (!waiting) return
    if (status?.[waiting].loggedIn && Date.now() - waitStart.current > 4000) {
      showToast(`${ENGINE_LABEL[waiting]} CLI가 연결되었습니다`)
      setWaiting(null)
      return
    }
    const t = setInterval(() => {
      if (Date.now() - waitStart.current > LOGIN_WAIT_MS) setWaiting(null)
      else refreshEngines()
    }, 3000)
    return () => clearInterval(t)
  }, [waiting, status, refreshEngines, showToast])

  useEffect(() => {
    if (!settingsOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSettingsOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen])

  const login = async (e: Engine) => {
    const r = await requestLogin(e)
    if (r?.opened) {
      waitStart.current = Date.now()
      setWaiting(e)
      showToast('로그인 창을 열었습니다 — 브라우저에서 로그인을 마쳐주세요')
    } else {
      showToast(`터미널에서 ${r?.command ?? LOGIN_CMD[e]} 을 실행해주세요`)
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="label strong">챗봇 CLI 연결</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {status && (
            <button className="btn sm" onClick={recheck} disabled={checking}>
              {checking ? '확인 중…' : '다시 확인'}
            </button>
          )}
          <button className="btn sm" onClick={() => setSettingsOpen(true)}>
            ⚙ 연결 설정
          </button>
        </div>
      </div>

      {status === null ? (
        <div className="row cli-row">
          <span className="status-dot off" />
          <span className="grow">규칙 기반 답변으로 동작 중</span>
          <button className="btn sm" onClick={() => setSettingsOpen(true)}>
            CLI 연결 방법
          </button>
        </div>
      ) : (
        ENGINES.map((e) => {
          const state = dotState(status?.[e])
          return (
            <div key={e} className="row cli-row">
              <span className={`status-dot ${state}`} />
              <span className="grow">{ENGINE_LABEL[e]}</span>
              {state === 'loading' && <span className="muted">확인 중…</span>}
              {state === 'off' && <span className="muted">설치되지 않음</span>}
              {state === 'ok' && <span className="cli-ok">연결됨</span>}
              {state === 'warn' &&
                (waiting === e ? (
                  <span className="muted">로그인 기다리는 중…</span>
                ) : (
                  <>
                    <span className="cli-warn">로그인 필요</span>
                    <button className="btn sm accent" onClick={() => login(e)}>
                      로그인
                    </button>
                  </>
                ))}
            </div>
          )
        })
      )}

      {settingsOpen && (
        <div className="modal-back" onClick={() => setSettingsOpen(false)}>
          <div className="modal cli-modal" role="dialog" aria-label="챗봇 CLI 연결 설정" onClick={(ev) => ev.stopPropagation()}>
            <div className="panel-head">
              <span className="label strong">챗봇 CLI 연결 설정</span>
              <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setSettingsOpen(false)}>
                닫기
              </button>
            </div>

            <div className="modal-body">
              {status === null ? (
                <>
                  <p className="cli-guide">
                    지금 보고 계신 배포 허브에는 CLI가 없어서 챗봇이 <b>규칙 기반 답변</b>으로 동작합니다.
                    Claude·Codex 답변은 <b>이 PC에서 켠 로컬 허브</b>에서 받을 수 있어요.
                  </p>
                  <LocalHubLauncher />
                  <details className="cli-first">
                  <summary>처음 쓰는 PC라면</summary>
                  <ol className="cli-steps">
                    <li>
                      <span>
                        허브 폴더의 <b>start-hub.bat</b> 더블클릭
                      </span>
                    </li>
                    <li>
                      <span>
                        안내에 따라 <b>Y</b>만 누르면 Node.js·CLI 설치, 로그인, 바탕화면 바로가기까지 자동으로 세팅됩니다
                      </span>
                    </li>
                    <li>
                      <span>브라우저가 자동으로 열리면 끝 — 다음부터는 바탕화면 바로가기나 위 [로컬 허브 실행] 버튼으로 켜세요</span>
                    </li>
                  </ol>
                  </details>
                </>
              ) : (
                <>
                  <p className="cli-guide">
                    로그인은 이 PC에 터미널 창을 띄워 진행합니다. 브라우저에서 로그인을 마치면 자동으로 연결됩니다.
                  </p>
                  {ENGINES.map((e) => {
                    const state = dotState(status?.[e])
                    const label =
                      state === 'ok' ? '연결됨' : state === 'warn' ? '로그인 필요' : state === 'off' ? '설치되지 않음' : '확인 중…'
                    return (
                      <div key={e} className="cli-setting">
                        <div className="cli-setting-head">
                          <span className={`status-dot ${state}`} />
                          <b>{ENGINE_LABEL[e]}</b>
                          <span className={state === 'ok' ? 'cli-ok' : state === 'warn' ? 'cli-warn' : 'muted'}>{label}</span>
                        </div>
                        {state === 'off' ? (
                          <>
                            <span className="muted">터미널에서 설치한 뒤 다시 확인을 누르세요</span>
                            <Cmd>{INSTALL_CMD[e]}</Cmd>
                          </>
                        ) : (
                          state !== 'loading' && (
                            <div className="form-actions">
                              <button
                                className={`btn sm${state === 'ok' ? '' : ' accent'}`}
                                disabled={waiting === e}
                                onClick={() => login(e)}
                              >
                                {waiting === e ? '로그인 기다리는 중…' : state === 'ok' ? '다시 로그인 · 계정 변경' : '로그인'}
                              </button>
                              <span className="muted">{LOGIN_CMD[e]}</span>
                            </div>
                          )
                        )}
                      </div>
                    )
                  })}
                  <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={recheck} disabled={checking}>
                    {checking ? '확인 중…' : '다시 확인'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
