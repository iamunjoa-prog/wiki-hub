import { useState } from 'react'
import { ACCOUNT_NAME, isLocalStatus } from '../lib/localHub'
import { useApp } from '../store/AppStore'
import { EngineGuideModal } from './EngineGuide'
import { CLI_ENGINES, dotState } from './EngineSettings'

/**
 * 대시보드용 — 챗봇 답변 엔진 상태.
 * 로컬 허브: Claude·Codex CLI(설치·로그인) + Gemini API(키). 배포 허브: Gemini API만.
 * CLI가 있으면 CLI로, 없거나 실패하면 Gemini로, 둘 다 없으면 규칙 기반으로 답한다.
 * 기본 보이는 문구는 초보자 문구표(C·T 줄)를 따르고, 설치 명령·키 안내는 담당자용 접힘에만 둔다.
 * 설정 창은 앱 전체에서 하나(EngineSettings)라 여기서는 열기만 한다 — 로그인 대기도 그 창과 같은 상태를 본다.
 */
export function CliStatus() {
  const { assistant, refreshEngines, openEngineSettings, engineLogin, loginEngine } = useApp()
  const status = assistant.engineStatus
  const [checking, setChecking] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  const isLocal = isLocalStatus(status)
  const gemini = status?.gemini

  const recheck = async () => {
    setChecking(true)
    await refreshEngines()
    setChecking(false)
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
          <button className="btn sm" onClick={openEngineSettings}>
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
                  (engineLogin.waiting === e ? (
                    <span className="muted">로그인 기다리는 중…</span>
                  ) : (
                    <>
                      <span className="cli-warn">로그인이 필요해요</span>
                      <button className="btn sm accent" onClick={() => loginEngine(e)}>
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
              <button className="btn sm" onClick={openEngineSettings}>
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
    </div>
  )
}
