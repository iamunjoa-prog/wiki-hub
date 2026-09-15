import { useEffect, useRef, useState } from 'react'
import { ENGINE_LABEL, requestLogin } from '../lib/assistant'
import { useApp } from '../store/AppStore'
import type { CliEngine, EngineStatus } from '../types'

const CLI_ENGINES: CliEngine[] = ['claude', 'codex']
const LOGIN_WAIT_MS = 180_000
const LOCAL_URL = 'http://localhost:5173'
const INSTALL_CMD: Record<CliEngine, string> = {
  claude: 'npm i -g @anthropic-ai/claude-code',
  codex: 'npm i -g @openai/codex',
}
const LOGIN_CMD: Record<CliEngine, string> = { claude: 'claude auth login', codex: 'codex login' }

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
      onClick={() => navigator.clipboard?.writeText(children).then(() => showToast('복사했습니다'))}
    >
      <span>{children}</span>
      <span className="muted">복사</span>
    </button>
  )
}

/**
 * 대시보드용 — 챗봇 답변 엔진 상태.
 * 로컬 허브: Claude·Codex CLI(설치·로그인) + Gemini API(키). 배포 허브: Gemini API만.
 * CLI가 있으면 CLI로, 없거나 실패하면 Gemini로, 둘 다 없으면 규칙 기반으로 답한다.
 */
export function CliStatus() {
  const { assistant, refreshEngines, showToast } = useApp()
  const status = assistant.engineStatus
  const [checking, setChecking] = useState(false)
  const [waiting, setWaiting] = useState<CliEngine | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const waitStart = useRef(0)

  const isLocal = Boolean(status && CLI_ENGINES.some((e) => e in status))
  const gemini = status?.gemini

  const recheck = async () => {
    setChecking(true)
    await refreshEngines()
    setChecking(false)
  }

  // 로그인 창을 띄운 뒤에는 완료될 때까지 3초마다 다시 확인한다
  useEffect(() => {
    if (!waiting) return
    if (status?.[waiting]?.loggedIn && Date.now() - waitStart.current > 4000) {
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

  const login = async (e: CliEngine) => {
    const r = await requestLogin(e)
    if (r?.opened) {
      waitStart.current = Date.now()
      setWaiting(e)
      showToast('로그인 창을 열었습니다 — 브라우저에서 로그인을 마쳐주세요')
    } else {
      showToast(`터미널에서 ${r?.command ?? LOGIN_CMD[e]} 을 실행해주세요`)
    }
  }

  const geminiRow = (
    <div className="row cli-row">
      <span className={`status-dot ${gemini?.loggedIn ? 'ok' : 'off'}`} />
      <span className="grow">
        Gemini API {isLocal && <span className="muted">· CLI가 없거나 실패할 때</span>}
      </span>
      {gemini?.loggedIn ? <span className="cli-ok">연결됨</span> : <span className="muted">API 키 없음</span>}
    </div>
  )

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="label strong">챗봇 답변 엔진</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {isLocal && (
            <button className="btn sm" onClick={recheck} disabled={checking}>
              {checking ? '확인 중…' : '다시 확인'}
            </button>
          )}
          <button className="btn sm" onClick={() => setSettingsOpen(true)}>
            ⚙ 연결 설정
          </button>
        </div>
      </div>

      {status === undefined && (
        <div className="row cli-row">
          <span className="status-dot loading" />
          <span className="grow muted">확인 중…</span>
        </div>
      )}

      {status === null && (
        <div className="row cli-row">
          <span className="status-dot off" />
          <span className="grow">규칙 기반 답변으로 동작 중</span>
        </div>
      )}

      {status && isLocal && (
        <>
          {CLI_ENGINES.map((e) => {
            const state = dotState(status[e])
            return (
              <div key={e} className="row cli-row">
                <span className={`status-dot ${state}`} />
                <span className="grow">{ENGINE_LABEL[e]} CLI</span>
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
          })}
          {geminiRow}
        </>
      )}

      {status && !isLocal && (
        <>
          {geminiRow}
          <div className="row cli-row">
            <span className="status-dot off" />
            <span className="grow">Claude · Codex CLI</span>
            <button className="btn sm" onClick={() => setSettingsOpen(true)}>
              내 PC에서 쓰기
            </button>
          </div>
        </>
      )}

      {settingsOpen && (
        <div className="modal-back" onClick={() => setSettingsOpen(false)}>
          <div className="modal cli-modal" role="dialog" aria-label="챗봇 답변 엔진 설정" onClick={(ev) => ev.stopPropagation()}>
            <div className="panel-head">
              <span className="label strong">챗봇 답변 엔진 설정</span>
              <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setSettingsOpen(false)}>
                닫기
              </button>
            </div>

            <div className="modal-body">
              {!isLocal ? (
                <>
                  <p className="cli-guide">
                    {gemini?.loggedIn ? (
                      <>
                        이 배포 허브에서는 챗봇이 <b>Gemini API</b>로 답합니다. 설치 없이 바로 쓰시면 됩니다.
                      </>
                    ) : (
                      <>
                        이 배포 허브에는 CLI도 Gemini API 키도 없어서 챗봇이 <b>규칙 기반 답변</b>으로 동작합니다.
                      </>
                    )}{' '}
                    Claude·Codex CLI로 답받고 싶다면 <b>내 PC에서 허브를 실행</b>하세요.
                  </p>
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
                      <span>브라우저가 자동으로 열리면 끝 — 다음부터는 바탕화면 바로가기로 실행</span>
                    </li>
                  </ol>
                  <a className="btn sm primary" style={{ alignSelf: 'flex-start' }} href={LOCAL_URL} target="_blank" rel="noreferrer">
                    로컬 허브 열기 ↗
                  </a>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    로컬 허브가 켜져 있을 때만 열립니다. "연결할 수 없음"이 뜨면 바탕화면 <b>플랫폼 담당 지식 허브</b>를 먼저 실행하세요.
                  </span>
                </>
              ) : (
                <>
                  <p className="cli-guide">
                    CLI가 연결돼 있으면 CLI로 답하고, 없거나 실패하면 Gemini API로 답합니다. 로그인은 이 PC에 터미널 창을 띄워
                    진행합니다.
                  </p>
                  {CLI_ENGINES.map((e) => {
                    const state = dotState(status?.[e])
                    const label =
                      state === 'ok' ? '연결됨' : state === 'warn' ? '로그인 필요' : state === 'off' ? '설치되지 않음' : '확인 중…'
                    return (
                      <div key={e} className="cli-setting">
                        <div className="cli-setting-head">
                          <span className={`status-dot ${state}`} />
                          <b>{ENGINE_LABEL[e]} CLI</b>
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
                  <div className="cli-setting">
                    <div className="cli-setting-head">
                      <span className={`status-dot ${gemini?.loggedIn ? 'ok' : 'off'}`} />
                      <b>Gemini API</b>
                      <span className={gemini?.loggedIn ? 'cli-ok' : 'muted'}>{gemini?.loggedIn ? '연결됨' : 'API 키 없음'}</span>
                    </div>
                    {gemini?.loggedIn ? (
                      <span className="muted">CLI가 없거나 응답에 실패하면 Gemini로 답합니다.</span>
                    ) : (
                      <>
                        <span className="muted">
                          허브 폴더에 <b>.env.local</b> 파일을 만들고 아래 한 줄을 넣은 뒤 허브를 다시 켜세요. (키는 이 PC에만 저장되고
                          커밋되지 않습니다)
                        </span>
                        <Cmd>GEMINI_API_KEY=여기에_발급받은_키</Cmd>
                      </>
                    )}
                  </div>
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
