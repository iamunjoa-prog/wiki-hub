import { useEffect, useState } from 'react'
import { ACCOUNT_NAME, isLocalStatus, type AccountChoice as Choice } from '../lib/localHub'
import { useApp } from '../store/AppStore'
import type { CliEngine, EngineStatus } from '../types'
import { AccountChoice, HUB_LEAD, LocalHubGuide } from './LocalHubGuide'

export const CLI_ENGINES: CliEngine[] = ['claude', 'codex']
const INSTALL_CMD: Record<CliEngine, string> = {
  claude: 'npm i -g @anthropic-ai/claude-code',
  codex: 'npm i -g @openai/codex',
}

export type DotState = 'loading' | 'off' | 'ok' | 'warn'

export const dotState = (s: EngineStatus | undefined): DotState =>
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
 * 챗봇 답변 엔진 설정 창 — 앱에 한 번만 그린다. 홈 칸 [⚙ 연결 설정]·인사 줄·어시스턴트 [연결하기]·⚙ 가 모두 이 창을 연다
 * (home-engine-assistant-cards F2). 웹 주소 허브는 "내 PC에서 쓰기" 안내, 내 PC 허브는 계정 줄과 담당자용 고급 설정.
 */
export function EngineSettings() {
  const { assistant, engineSettingsOpen, closeEngineSettings, engineLogin, loginEngine, refreshEngines, openDockWith } = useApp()
  const status = assistant.engineStatus
  const gemini = status?.gemini
  const isLocal = isLocalStatus(status)
  const { waiting, timedOut, connected } = engineLogin
  const [checking, setChecking] = useState(false)
  const [account, setAccount] = useState<Choice | null>(null)

  useEffect(() => {
    if (!engineSettingsOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeEngineSettings()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engineSettingsOpen, closeEngineSettings])

  if (!engineSettingsOpen) return null

  const recheck = async () => {
    setChecking(true)
    await refreshEngines()
    setChecking(false)
  }

  // 모달 안 빨강은 하나 — [바로 물어보기 ›]가 있으면 그것, 없으면 로그인이 필요한 첫 계정의 [로그인] (UX A-3)
  const justConnected = !!connected && dotState(status?.[connected]) === 'ok'
  const firstLogin = justConnected ? undefined : CLI_ENGINES.find((e) => dotState(status?.[e]) === 'warn')

  // 연결 뒤 다음 걸음 — 창을 닫고 어시스턴트 입력칸에 커서를 둔다(빈 글로 채우면 커서만 옮긴다)
  const askNow = () => {
    closeEngineSettings()
    openDockWith('')
  }

  return (
    <div className="modal-back hub-back" onClick={closeEngineSettings}>
      <div className="modal cli-modal" role="dialog" aria-label="챗봇 답변 엔진 설정" onClick={(ev) => ev.stopPropagation()}>
        <div className="panel-head">
          <span className="label strong">챗봇 답변 엔진 설정</span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={closeEngineSettings}>
            닫기
          </button>
        </div>

        <div className="modal-body">
          {!isLocal ? (
            <>
              <p className="cli-guide">{HUB_LEAD}</p>
              {/* 첫 안내 창과 같은 질문 — 고른 계정만 설치·로그인하게 ZIP에 싣는다. 둘 다를 기본으로 두면 없는 계정 로그인을 기다리게 된다 */}
              <AccountChoice value={account} onChange={setAccount} />
              {account === 'unknown' ? (
                <p className="cli-guide">지금처럼 이 허브에서 바로 쓰시면 돼요. 챗봇은 공용 AI 엔진으로 답해요.</p>
              ) : (
                <LocalHubGuide account={account} />
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
                    ) : state === 'ok' && connected === e ? (
                      // 이번에 로그인이 끝난 계정 줄에만 — 이미 연결돼 있던 계정에는 붙이지 않는다 (F3)
                      <>
                        <span className="muted">이제 챗봇이 {name} 계정으로 답해요.</span>
                        <div className="form-actions">
                          <button className="btn sm accent" onClick={askNow}>
                            바로 물어보기 ›
                          </button>
                        </div>
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
                              className={`btn sm${e === firstLogin && waiting !== e ? ' accent' : ''}`}
                              disabled={waiting === e}
                              onClick={() => loginEngine(e)}
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
  )
}
