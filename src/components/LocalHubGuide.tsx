import { useState } from 'react'
import {
  DOWNLOAD_FAIL_TEXT,
  LOCAL_URL,
  accountNames,
  detectOs,
  useHubDownload,
  type AccountChoice as Choice,
  type HubAccount,
  type Os,
} from '../lib/localHub'
import { useApp } from '../store/AppStore'

/*
 * 로컬 허브 계정 선택·내려받기·실행 안내 — 설정 창(CliStatus)과 첫 안내 창(LocalHubOnboarding)이 같이 쓴다.
 * 문구는 docs/ux/2026-11-12-local-hub-beginner-copy.md 의 A·G 줄이며 이 파일 한 곳에만 둔다.
 */

const CHOICES: { value: Choice; label: string; sub?: string }[] = [
  // 초보자는 구독 이름으로 알아보므로 보조 설명에 붙인다 (CLI 로그인 조사 권고)
  { value: 'claude', label: 'Claude', sub: '유료 구독(Pro·Max 등)' },
  { value: 'codex', label: 'ChatGPT (Codex)', sub: '유료 구독(Plus·Pro 등)' },
  { value: 'both', label: '둘 다 있어요' },
  { value: 'unknown', label: '잘 모르겠어요 · 계정이 없어요' },
]

const QUESTION = '어떤 AI 계정을 쓰고 계신가요?'

/** 계정 4지선다 — 고른 값이 ZIP 설정 파일에 실려 검은 창이 묻지 않게 된다 */
export function AccountChoice({ value, onChange }: { value: Choice | null; onChange: (v: Choice) => void }) {
  return (
    <div className="onb-ask">
      <span className="onb-q">{QUESTION}</span>
      <span className="muted onb-q-sub">브라우저나 앱에서 로그인해 쓰는 Claude·ChatGPT 계정을 말해요.</span>
      <div className="onb-choice" role="radiogroup" aria-label={QUESTION}>
        {CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={value === c.value}
            className={value === c.value ? 'on' : ''}
            onClick={() => onChange(c.value)}
          >
            <span className="radio" />
            <span className="onb-choice-text">
              {c.label}
              {c.sub && <small>{c.sub}</small>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function LocalHubGuide({ account, onDownloaded }: { account: HubAccount; onDownloaded?: () => void }) {
  const { showToast } = useApp()
  const [os, setOs] = useState<Os>(detectOs)
  const { downloading, error, download } = useHubDownload(showToast, account, onDownloaded)
  const names = accountNames(account)

  // 브라우저 로그인 말고는 손댈 일이 없다 — 설치·로그인 대상은 ZIP 설정 파일로 정해진다
  const wait = (shell: string) => (
    <li>
      {shell}이 혼자 준비해요(5~10분). 로그인 화면이 뜨면 <b>{names} 계정</b>으로 로그인
    </li>
  )

  return (
    <>
      <p className="cli-guide">받아서 아래 순서대로 하면 끝나요. 중간에 고를 일은 없어요.</p>
      <div className="cli-os">
        <b>{os === 'mac' ? 'Mac' : 'Windows'}</b>
        <button type="button" className="cli-os-switch" onClick={() => setOs(os === 'mac' ? 'win' : 'mac')}>
          {os === 'mac' ? 'Windows 안내 보기' : 'Mac 안내 보기'}
        </button>
      </div>
      <button
        type="button"
        className="btn sm primary"
        style={{ alignSelf: 'flex-start' }}
        disabled={downloading}
        onClick={download}
      >
        {downloading ? '받는 중…' : '내 PC용 허브 내려받기'}
      </button>
      {error && (
        <div role="alert" className="cli-note">
          <span style={{ color: 'var(--danger)' }}>{DOWNLOAD_FAIL_TEXT}</span>
          {/* 토큰·저장소 설정 같은 서버 원문은 초보자에게 보이지 않게 접는다 */}
          <details className="cli-fold">
            <summary>담당자용 정보</summary>
            <span className="muted">{error}</span>
          </details>
        </div>
      )}
      {os === 'mac' ? (
        <ol className="cli-steps">
          <li>
            받은 <code>wiki-hub.zip</code> 을 <b>더블클릭</b>해 압축 풀기 (Safari로 받았다면 이미 풀려 있어요)
          </li>
          <li>
            풀린 폴더에서 <b style={{ whiteSpace: 'nowrap' }}>start-hub-mac.command</b> <b>우클릭 → 열기 → 열기</b>
            {/* macOS 15부터는 우클릭 → 열기로 넘어가지지 않아 시스템 설정 경로를 접어 둔다 */}
            <details className="cli-fold">
              <summary>[열기] 버튼이 안 보이면</summary>
              <span className="cli-note">
                <b>완료</b> → 화면 왼쪽 위 <b>Apple 메뉴 → 시스템 설정 → 개인정보 보호 및 보안</b>에서 아래로 내려
                "start-hub-mac.command" 옆 <b>그래도 열기</b> → 다시 뜨는 창에서 <b>그래도 열기</b> → Mac 암호 입력.{' '}
                <b>휴지통으로 이동</b>은 누르지 마세요.
              </span>
            </details>
          </li>
          <li>
            "터미널이 … 폴더에 접근하려고 합니다" 창이 뜨면 <b>허용</b>
          </li>
          {wait('터미널 창')}
          <li>
            허브가 열리면 끝. 터미널 창은 <b>닫지 말고 노란 단추로 내리기</b>
          </li>
        </ol>
      ) : (
        <ol className="cli-steps">
          <li>
            받은 <code>wiki-hub.zip</code> 을 <b>우클릭 → 모두 압축 풀기 → 압축 풀기</b> (더블클릭으로 열기만 하면 안 돼요)
          </li>
          <li>
            풀린 폴더에서 <b style={{ whiteSpace: 'nowrap' }}>start-hub-windows</b> 더블클릭 (hub 폴더는 열지 않아도 돼요)
          </li>
          <li>
            파란 <b>"Windows의 PC 보호"</b> 창이 뜨면 <b>추가 정보 → 실행</b> ("보안 경고" 창이면 <b>실행</b>)
          </li>
          {wait('검은 창')}
          <li>
            허브가 열리면 끝. 검은 창은 <b>닫지 말고 최소화</b>
          </li>
        </ol>
      )}
      <span className="muted cli-note">
        다음부터는(이미 설치했다면) 바탕화면 <b>플랫폼 담당 지식 허브</b> 더블클릭. 켜져 있으면 브라우저만 열려요.{' '}
        <a href={LOCAL_URL} target="_blank" rel="noreferrer">
          켜져 있는 허브 열기 ↗
        </a>
      </span>
    </>
  )
}
