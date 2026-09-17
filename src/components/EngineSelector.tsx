import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ENGINE_PRIORITY } from '../lib/assistant'
import { useApp } from '../store/AppStore'
import type { Engine } from '../types'

/** 램프 3단계 — 장식색(초록·빨강)을 쓰지 않고 채움/실선/점선으로 구분한다 */
type Lamp = 'live' | 'ready' | 'unavailable'

const ENGINE_NAME: Record<Engine, string> = {
  claude: 'Claude CLI',
  codex: 'Codex CLI',
  gemini: 'Gemini API',
}

const ENGINE_DESC: Record<Engine, string> = {
  claude: '내 PC · 사내망 문서 그대로',
  codex: '내 PC · 연결됨',
  gemini: 'CLI가 없거나 실패할 때',
}

/** 쓸 수 없을 때 이유를 그대로 보여 준다 — 'CLI 없음'만으로는 뭘 해야 할지 알 수 없다 */
const UNAVAILABLE_REASON: Record<Engine, string> = {
  claude: '미설치',
  codex: '미설치',
  gemini: 'API 키 없음',
}

export function EngineRow({ state }: { state: Lamp }) {
  return <span className={`engine-lamp ${state}`} aria-hidden />
}

/**
 * 답변 엔진 셀렉터(2b). 히어로(다크 배경)와 드로어 헤더(라이트 배경) 두 곳에서 쓴다.
 *
 * 엔진 상태는 사용자마다 다르다 — CLI는 그 사람 PC에 설치·로그인돼 있어야 켜지고,
 * 없으면 서버의 Gemini API로 떨어진다. 그래서 고른 엔진(preferred)과 실제로 답하는
 * 엔진(effective)이 갈릴 수 있고, 갈릴 때는 그 사실을 화면에 남긴다.
 */
export function EngineSelector({ variant = 'hero' }: { variant?: 'hero' | 'drawer' }) {
  const { assistant, setEngine, refreshEngines } = useApp()
  const { engines, engine, preferred, detecting } = assistant
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // 바깥을 누르거나 Esc면 닫는다. Esc는 드롭다운을 먼저 먹고, 드로어는 그 다음이다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const lampOf = (e: Engine): Lamp =>
    engine === e ? 'live' : engines?.[e] ? 'ready' : 'unavailable'

  const current = engine
  const label = detecting ? '확인 중…' : current ? ENGINE_NAME[current] : '엔진 미연결'
  // 고른 적이 없어 자동으로 정해진 엔진에는 '기본' 태그를 붙인다
  const isDefault = !preferred && Boolean(current)
  const cliMissing = engines ? !engines.claude && !engines.codex : false

  return (
    <div className={`engine-select ${variant}`} ref={wrap}>
      <button
        type="button"
        className="engine-btn"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <EngineRow state={detecting ? 'ready' : current ? 'live' : 'unavailable'} />
        <span className="n">{label}</span>
        {isDefault && <span className="engine-default">기본</span>}
        <span className="chev" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="engine-menu" role="listbox">
          <div className="engine-menu-head">답변 엔진 선택</div>
          {ENGINE_PRIORITY.map((e) => {
            const state = lampOf(e)
            return (
              <div key={e} className={`engine-opt ${state}`} role="option" aria-selected={state === 'live'}>
                <EngineRow state={state} />
                <span className="engine-opt-text">
                  <b>{ENGINE_NAME[e]}</b>
                  <i>{ENGINE_DESC[e]}</i>
                </span>
                {state === 'live' && <span className="tag tag-accent">사용 중</span>}
                {state === 'ready' && (
                  <button
                    type="button"
                    className="engine-switch"
                    onClick={() => {
                      setEngine(e)
                      setOpen(false)
                    }}
                  >
                    전환
                  </button>
                )}
                {state === 'unavailable' && <span className="engine-why">{UNAVAILABLE_REASON[e]}</span>}
              </div>
            )
          })}
          <div className="engine-menu-foot">
            <button type="button" className="engine-recheck" onClick={() => refreshEngines()}>
              다시 확인
            </button>
            <button
              type="button"
              className="engine-settings"
              onClick={() => {
                setOpen(false)
                navigate('/systems')
              }}
            >
              연결 설정 ↗
            </button>
          </div>
        </div>
      )}

      {variant === 'hero' && cliMissing && !detecting && (
        <p className="engine-note">
          CLI 2종은 이 PC에서 감지되지 않았습니다 ·{' '}
          <button type="button" onClick={() => navigate('/systems')}>
            연결 방법
          </button>
        </p>
      )}
    </div>
  )
}
