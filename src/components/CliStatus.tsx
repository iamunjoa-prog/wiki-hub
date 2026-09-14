import { useEffect, useRef, useState } from 'react'
import { ENGINE_LABEL, requestLogin } from '../lib/assistant'
import { useApp } from '../store/AppStore'
import type { Engine } from '../types'

const ENGINES = Object.keys(ENGINE_LABEL) as Engine[]
const LOGIN_WAIT_MS = 180_000

/** 대시보드용 — 챗봇이 쓰는 로컬 CLI의 설치·로그인 상태와 로그인 진입점 */
export function CliStatus() {
  const { assistant, refreshEngines, showToast } = useApp()
  const status = assistant.engineStatus
  const [checking, setChecking] = useState(false)
  const [waiting, setWaiting] = useState<Engine | null>(null)
  const waitStart = useRef(0)

  const recheck = async () => {
    setChecking(true)
    await refreshEngines()
    setChecking(false)
  }

  // 로그인 창을 띄운 뒤에는 완료될 때까지 3초마다 다시 확인한다
  useEffect(() => {
    if (!waiting) return
    if (status?.[waiting].loggedIn) {
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

  const login = async (e: Engine) => {
    const r = await requestLogin(e)
    if (r?.opened) {
      waitStart.current = Date.now()
      setWaiting(e)
      showToast('로그인 창을 열었습니다 — 브라우저에서 로그인을 마쳐주세요')
    } else {
      showToast(`터미널에서 ${r?.command ?? `${e} login`} 을 실행해주세요`)
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="label strong">챗봇 CLI 연결</span>
        {status !== null && (
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={recheck} disabled={checking || status === undefined}>
            {checking ? '확인 중…' : '다시 확인'}
          </button>
        )}
      </div>

      {status === null ? (
        <div className="row cli-row">
          <span className="status-dot off" />
          <span className="grow">규칙 기반 답변으로 동작 중</span>
          <span className="muted">로컬 서버 아님</span>
        </div>
      ) : (
        ENGINES.map((e) => {
          const s = status?.[e]
          const state = !s ? 'loading' : !s.installed ? 'off' : s.loggedIn ? 'ok' : 'warn'
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
    </div>
  )
}
