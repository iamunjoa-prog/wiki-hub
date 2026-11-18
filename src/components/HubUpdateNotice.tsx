import { useState } from 'react'
import {
  dismissLegacy,
  dismissUpdate,
  isLegacyDismissed,
  isUpdateDismissed,
  shortVersion,
  useHubVersion,
} from '../lib/hubVersion'
import { detectOs } from '../lib/localHub'

/** 바탕화면 아이콘 이름 — 실행 안내(server/hubZipRoot.ts readmeText "다음부터")와 같게 적는다 */
const SHORTCUT_NAME = '플랫폼 담당 지식 허브'

/**
 * 내 PC 허브 새 버전 알림 띠. 켤 때 자동으로 바뀌므로 "닫고 다시 켜기"만 안내한다.
 * 배포본(경로 없음)·개발용 폴더·확인 실패면 아무것도 보이지 않는다.
 */
export function HubUpdateNotice() {
  const info = useHubVersion()
  const [howOpen, setHowOpen] = useState(false)
  // 닫은 버전을 화면 상태로도 들고 있어야 저장소를 못 쓰는 브라우저에서도 바로 사라진다
  const [closed, setClosed] = useState<string | null>(null)

  if (!info) return null

  if (info.reason === 'no-version') {
    if (closed === 'legacy' || isLegacyDismissed()) return null
    return (
      <div className="hub-notice legacy" role="status">
        <span className="hub-notice-text">
          이 허브는 자동 업데이트가 안 되는 이전 버전이에요. 허브 화면에서 새로 받아 주세요.
        </span>
        <div className="hub-notice-actions">
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              dismissLegacy()
              setClosed('legacy')
            }}
          >
            닫기
          </button>
        </div>
      </div>
    )
  }

  const latest = info.latest
  if (!info.updateAvailable || !latest || closed === latest || isUpdateDismissed(latest)) return null

  const mac = detectOs() === 'mac'
  return (
    <div className="hub-notice" role="status">
      <span className="hub-notice-text">
        <b>허브 새 버전이 나왔어요.</b> 허브를 닫고 다시 켜면 자동으로 바뀝니다.
      </span>
      <div className="hub-notice-actions">
        <button type="button" className="btn sm" aria-expanded={howOpen} onClick={() => setHowOpen((v) => !v)}>
          다시 켜는 방법
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            dismissUpdate(latest)
            setClosed(latest)
          }}
        >
          닫기
        </button>
      </div>
      {howOpen && (
        <div className="hub-notice-how">
          <ol>
            {mac ? (
              <li>허브와 함께 열린 터미널 창을 닫아요. 허브가 꺼집니다.</li>
            ) : (
              <li>허브와 함께 열린 검은 창을 닫아요(오른쪽 위 X). 허브가 꺼집니다.</li>
            )}
            <li>
              바탕화면의 <b>{SHORTCUT_NAME}</b> 를 더블클릭해요.
            </li>
            <li>창이 새 버전으로 바꾼 뒤 브라우저에 허브를 다시 열어 줍니다. 잠시만 기다려 주세요.</li>
          </ol>
          <p className="muted">하던 작업이 있으면 마친 뒤에 다시 켜도 돼요.</p>
          <p className="hub-notice-meta">
            담당자용: 지금 {shortVersion(info.current)} → 새 {shortVersion(latest)}
          </p>
        </div>
      )}
    </div>
  )
}
