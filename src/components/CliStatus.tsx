import { useEffect, useRef, useState } from 'react'
import { requestLogin } from '../lib/assistant'
import { ACCOUNT_NAME, isLocalStatus, type AccountChoice as Choice } from '../lib/localHub'
import { useApp } from '../store/AppStore'
import type { CliEngine, EngineStatus } from '../types'
import { EngineGuideModal } from './EngineGuide'
import { AccountChoice, LocalHubGuide } from './LocalHubGuide'

const CLI_ENGINES: CliEngine[] = ['claude', 'codex']
const LOGIN_WAIT_MS = 180_000
const INSTALL_CMD: Record<CliEngine, string> = {
  claude: 'npm i -g @anthropic-ai/claude-code',
  codex: 'npm i -g @openai/codex',
}

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
 * 기본 보이는 문구는 초보자 문구표(C·T 줄)를 따르고, 설치 명령·키 안내는 담당자용 접힘에만 둔다.
 */
export function CliStatus() {
  const { assistant, refreshEngines, showToast } = useApp()
  const status = assistant.engineStatus
  const [checking, setChecking] = useState(false)
  const [waiting, setWaiting] = useState<CliEngine | null>(null)
  const [timedOut, setTimedOut] = useState<CliEngine | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [account, setAccount] = useState<Choice | null>(null)
  const waitStart = useRef(0)

  const isLocal = isLocalStatus(status)
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
      showToast(`${ACCOUNT_NAME[waiting]} 계정이 연결됐어요`)
      setWaiting(null)
      return
    }
    const t = setInterval(() => {
      if (Date.now() - waitStart.current > LOGIN_WAIT_MS) {
        setTimedOut(waiting)
        setWaiting(null)
      } else refreshEngines()
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
    setTimedOut(null)
    if (r?.opened) {
      waitStart.current = Date.now()
      setWaiting(e)
      showToast(`브라우저에서 ${ACCOUNT_NAME[e]} 계정으로 로그인해 주세요`)
    } else {
      showToast('로그인 화면을 열지 못했어요. 바탕화면의 플랫폼 담당 지식 허브를 다시 켠 뒤 눌러 주세요')
    }
  }

  const geminiRow = (
    <div className="row cli-row">
      <span className={`status-dot ${gemini?.loggedIn ? 'ok' : 'off'}`} />
      <span className="grow">
        공용 AI 엔진 {isLocal && <span className="muted">· 내 계정이 연결 안 됐을 때</span>}
      </span>
      {gemini?.loggedIn ? <span className="cli-ok">사용 중</span> : <span className="muted">연결 안 됨</span>}
    </div>
  )
  // 로컬 허브의 공용 엔진 행은 이 PC에 키가 있을 때만 의미가 있다 — 없으면 행 대신 연결 안내를 크게 보인다
  const noAccount = isLocal && !CLI_ENGINES.some((e) => status?.[e]?.loggedIn)

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
          <span className="grow">간단한 답변만 하는 중이에요</span>
        </div>
      )}

      {status && isLocal && (
        <>
          {CLI_ENGINES.map((e) => {
            const state = dotState(status[e])
            return (
              <div key={e} className="row cli-row">
                <span className={`status-dot ${state}`} />
                <span className="grow">{ACCOUNT_NAME[e]} 계정</span>
                {state === 'loading' && <span className="muted">확인 중…</span>}
                {/* [연결하기](설치 API)가 생기기 전까지는 상태만 보인다 */}
                {state === 'off' && <span className="muted">연결 안 됨</span>}
                {state === 'ok' && <span className="cli-ok">연결됨</span>}
                {state === 'warn' &&
                  (waiting === e ? (
                    <span className="muted">로그인 기다리는 중…</span>
                  ) : (
                    <>
                      <span className="cli-warn">로그인이 필요해요</span>
                      <button className="btn sm accent" onClick={() => login(e)}>
                        로그인
                      </button>
                    </>
                  ))}
              </div>
            )
          })}
          {gemini?.loggedIn && geminiRow}
          {noAccount && !gemini?.loggedIn && (
            <p className="cli-note cli-alert">
              지금은 내 계정이 연결되지 않아 간단한 답만 드려요. 연결하려면 [로그인]을 눌러 주세요.
            </p>
          )}
        </>
      )}

      {status && !isLocal && (
        <>
          {geminiRow}
          <div className="row cli-row">
            <span className="status-dot off" />
            <span className="grow">내 Claude·ChatGPT 계정</span>
            <span className="cli-cta">
              <button className="btn sm" onClick={() => setSettingsOpen(true)}>
                내 PC에서 쓰기
              </button>
              <span className="cli-hint">내 계정으로 답받기</span>
            </span>
          </div>
        </>
      )}

      {/* 머리 버튼 줄은 좁은 패널에서 넘친다 — 차이 안내는 패널 아래 작은 링크로 둔다 */}
      <div className="cli-hint engine-guide-link">
        <button type="button" className="cli-os-switch" onClick={() => setGuideOpen(true)}>
          내 AI 계정과 공용 엔진, 무슨 차이가 있나요?
        </button>
      </div>
      {guideOpen && <EngineGuideModal onClose={() => setGuideOpen(false)} />}

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
                    지금 챗봇은 {gemini?.loggedIn ? <b>공용 AI 엔진</b> : <b>간단한 답변</b>}으로 답해요. 내 계정으로 답받으려면{' '}
                    <b>내 PC에서 허브를 켜세요</b>.
                  </p>
                  {/* 첫 안내 창과 같은 질문 — 고른 계정만 설치·로그인하게 ZIP에 싣는다. 둘 다를 기본으로 두면 없는 계정 로그인을 기다리게 된다 */}
                  <AccountChoice value={account} onChange={setAccount} />
                  {account && account !== 'unknown' && <LocalHubGuide account={account} />}
                  {account === 'unknown' && (
                    <p className="cli-guide">지금처럼 이 허브에서 바로 쓰시면 돼요. 챗봇은 공용 AI 엔진으로 답해요.</p>
                  )}
                </>
              ) : (
                <>
                  <p className="cli-guide">
                    내 계정이 연결돼 있으면 챗봇이 내 계정으로 답하고, 아니면 공용 AI 엔진으로 답해요.
                  </p>
                  {CLI_ENGINES.map((e) => {
                    const state = dotState(status?.[e])
                    const name = ACCOUNT_NAME[e]
                    const label =
                      state === 'ok' ? '연결됨' : state === 'warn' ? '로그인이 필요해요' : state === 'off' ? '연결 안 됨' : '확인 중…'
                    return (
                      <div key={e} className="cli-setting">
                        <div className="cli-setting-head">
                          <span className={`status-dot ${state}`} />
                          <b>{name} 계정</b>
                          <span className={state === 'ok' ? 'cli-ok' : state === 'warn' ? 'cli-warn' : 'muted'}>{label}</span>
                        </div>
                        {state === 'off' ? (
                          <>
                            {/* [연결하기](로컬 설치 API, P1-4)가 생기기 전 임시 문구 — 설치 명령은 담당자용으로 접는다 */}
                            <span className="muted">
                              이 PC에는 아직 {name} 연결 프로그램이 없어요. 허브 담당자에게 설치를 부탁해 주세요.
                            </span>
                            <details className="cli-fold">
                              <summary>담당자용 정보</summary>
                              <Cmd>{INSTALL_CMD[e]}</Cmd>
                            </details>
                          </>
                        ) : (
                          state !== 'loading' && (
                            <>
                              {state === 'warn' && (
                                <span className="muted">
                                  {waiting === e
                                    ? '브라우저에서 로그인을 마치면 저절로 바뀌어요. 검은 창이 하나 더 열려도 닫지 마세요. 끝나면 저절로 닫혀요.'
                                    : timedOut === e
                                      ? '아직 연결되지 않았어요. [로그인]을 다시 눌러 주세요.'
                                      : `[로그인]을 누르면 브라우저에 로그인 화면이 열려요. ${name} 계정으로 로그인해 주세요.`}
                                </span>
                              )}
                              <div className="form-actions">
                                <button
                                  className={`btn sm${state === 'ok' ? '' : ' accent'}`}
                                  disabled={waiting === e}
                                  onClick={() => login(e)}
                                >
                                  {waiting === e ? '로그인 기다리는 중…' : state === 'ok' ? '다시 로그인 · 계정 바꾸기' : '로그인'}
                                </button>
                              </div>
                            </>
                          )
                        )}
                      </div>
                    )
                  })}
                  {/* 공용 엔진 키는 초보자가 할 일이 아니다 — 담당자용으로 접고 안은 그대로 둔다 */}
                  <details className="cli-setting cli-fold">
                    <summary>고급 설정 (담당자용)</summary>
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
                  </details>
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
