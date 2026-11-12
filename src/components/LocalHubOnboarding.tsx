import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ONBOARDING_MAX_SHOWN, isLocalStatus, markSeenThisSession, readOnboarding, shouldShowOnboarding, writeOnboarding } from '../lib/localHub'
import { useApp } from '../store/AppStore'
import { useAuth } from './AuthGate'
import { LocalHubGuide } from './LocalHubGuide'

type Choice = 'yes' | 'no' | null

const LATER_TOAST = '대시보드 "챗봇 답변 엔진 → 내 PC에서 쓰기"에서 언제든 다시 볼 수 있습니다'

/**
 * 배포 허브에 들어온 실무자에게 "내 Claude Code·Codex 계정으로 챗봇 쓰기"를 한 번 안내한다.
 * 대시보드에서만 띄워 문서 딥링크로 들어온 사람의 작업을 끊지 않는다. 로컬 허브는 이미 CLI 연결 화면이 있어 띄우지 않는다.
 */
export function LocalHubOnboarding() {
  const { assistant, showToast } = useApp()
  const { user } = useAuth()
  const { pathname } = useLocation()
  const loginId = user?.loginId
  const status = assistant.engineStatus
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<Choice>(null)
  const [done, setDone] = useState(false)
  const [lastChance, setLastChance] = useState(false)

  // 엔진 상태를 받기 전에는 로컬인지 알 수 없어 기다린다
  useEffect(() => {
    if (open || pathname !== '/' || status === undefined || isLocalStatus(status)) return
    if (!shouldShowOnboarding(loginId)) return
    markSeenThisSession(loginId)
    setChoice(null)
    const record = readOnboarding(loginId)
    setDone(record?.state === 'done')
    setLastChance((record?.shown ?? 0) + 1 >= ONBOARDING_MAX_SHOWN)
    setOpen(true)
  }, [open, pathname, status, loginId])

  /** 닫기·Esc·바깥 클릭·다음에 — 이미 끝낸 사람(ZIP 받음)이면 기록을 되돌리지 않는다 */
  const later = useCallback(() => {
    setOpen(false)
    if (done) return
    writeOnboarding(loginId, 'later')
    showToast(LATER_TOAST)
  }, [done, loginId, showToast])

  const finish = () => {
    writeOnboarding(loginId, 'done')
    setOpen(false)
  }

  // ZIP을 받아도 창은 열어 둔다 — 단계를 보며 따라 하게
  const onDownloaded = useCallback(() => {
    writeOnboarding(loginId, 'done')
    setDone(true)
  }, [loginId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && later()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, later])

  if (!open) return null

  return (
    <div className="modal-back onb-back" onClick={later}>
      <div className="modal onb-modal" role="dialog" aria-label="내 계정으로 챗봇 쓰기" onClick={(ev) => ev.stopPropagation()}>
        <div className="panel-head">
          <span className="label strong">내 계정으로 챗봇 쓰기</span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={later}>
            닫기
          </button>
        </div>

        <div className="modal-body">
          <p className="onb-hello">{user ? `${user.name}님, 허브에 오신 것을 환영합니다.` : '허브에 오신 것을 환영합니다.'}</p>
          <ul className="onb-why">
            <li>
              Claude Code나 Codex 계정이 있으면 챗봇이 <b>내 계정으로</b> 답합니다.
            </li>
            <li>공용 AI 엔진이 붐비거나 한도에 걸려도 영향을 덜 받습니다.</li>
            <li>한 번 세팅하면 다음부터는 바탕화면 아이콘으로 켭니다.</li>
          </ul>

          <div className="onb-choice" role="radiogroup" aria-label="Claude Code·Codex 계정이 있나요">
            <button type="button" role="radio" aria-checked={choice === 'yes'} className={choice === 'yes' ? 'on' : ''} onClick={() => setChoice('yes')}>
              <span className="radio" />
              Claude Code·Codex 계정이 있어요
            </button>
            <button type="button" role="radio" aria-checked={choice === 'no'} className={choice === 'no' ? 'on' : ''} onClick={() => setChoice('no')}>
              <span className="radio" />
              계정이 없어요 · 잘 모르겠어요
            </button>
          </div>

          {choice === 'yes' && (
            <div className="onb-guide">
              <LocalHubGuide onDownloaded={onDownloaded} />
            </div>
          )}

          {choice === 'no' && (
            <div className="onb-guide">
              <p className="cli-guide">
                지금처럼 이 허브에서 바로 쓰시면 됩니다. 챗봇은 공용 AI 엔진으로 답합니다.
                <br />
                계정이 생기면 대시보드 <b>챗봇 답변 엔진 → 내 PC에서 쓰기</b>에서 이 안내를 다시 볼 수 있습니다.
              </p>
              <button type="button" className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={finish}>
                허브 시작하기
              </button>
            </div>
          )}
        </div>

        {choice !== 'no' && (
          <div className="onb-foot">
            <span className="muted">
              {done
                ? '받은 파일로 위 단계를 따라 하세요. 이 안내는 다시 자동으로 뜨지 않습니다.'
                : choice === 'yes'
                  ? '나중에 하시려면 [다음에] — 대시보드에서 언제든 다시 볼 수 있습니다.'
                  : lastChance
                    ? '고르지 않고 닫으면 다시 자동으로 뜨지 않습니다. 대시보드에서 언제든 다시 볼 수 있습니다.'
                    : `고르지 않고 닫으면 다음 ${user ? '로그인' : '접속'} 때 한 번 더 보여 드립니다.`}
            </span>
            <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={later}>
              {done ? '닫기' : '다음에'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
