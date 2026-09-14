import { useEffect, useRef, useState } from 'react'
import { ENGINE_LABEL, requestLogin } from '../lib/assistant'
import { useApp } from '../store/AppStore'
import type { Engine, EngineStatus } from '../types'

const ENGINES = Object.keys(ENGINE_LABEL) as Engine[]
const LOGIN_WAIT_MS = 180_000
const LOCAL_URL = 'http://localhost:5173'
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
                    Claude·Codex로 답변받으려면 <b>내 PC에서 허브를 실행</b>한 뒤 로그인하세요.
                  </p>
                  <ol className="cli-steps">
                    <li>
                      CLI 설치 (쓸 것만)
                      <Cmd>{INSTALL_CMD.claude}</Cmd>
                      <Cmd>{INSTALL_CMD.codex}</Cmd>
                    </li>
                    <li>
                      <span>
                        허브 폴더의 <b>start-hub.bat</b> 더블클릭 — 브라우저가 자동으로 열립니다
                      </span>
                    </li>
                    <li>
                      <span>
                        로컬 허브 대시보드의 <b>⚙ 연결 설정</b>에서 로그인
                      </span>
                    </li>
                  </ol>
                  <a className="btn sm primary" style={{ alignSelf: 'flex-start' }} href={LOCAL_URL} target="_blank" rel="noreferrer">
                    로컬 허브 열기 ↗
                  </a>
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
