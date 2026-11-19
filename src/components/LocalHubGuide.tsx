import { useEffect, useRef, useState } from 'react'
import {
  DOWNLOAD_FAIL_TEXT,
  LOCAL_URL,
  detectOs,
  installCommand,
  useHubDownload,
  type AccountChoice as Choice,
  type HubAccount,
  type Os,
} from '../lib/localHub'
import { useApp } from '../store/AppStore'

/*
 * 로컬 허브 계정 선택·내려받기·실행 안내 — 설정 창(CliStatus)과 첫 안내 창(LocalHubOnboarding)이 같이 쓴다.
 * 문구는 docs/ux/2026-11-12-local-hub-beginner-copy.md 의 A·G 줄이며 이 파일 한 곳에만 둔다.
 * 노트북 화면에서 내려받기 버튼이 잘리지 않게 버튼을 계정 선택 바로 아래에 두고, 긴 설명은 "자세히 보기"로 접는다.
 * Mac 보기는 ZIP 대신 한 줄 설치 명령이 주 경로다 — 받은 파일을 열 때의 보안 경고를 거치지 않는다
 * (docs/ux/2026-11-19-one-line-install-copy.md G-30~G-59).
 */

/** 머리말 한 줄 — 두 창이 같은 말로 시작한다 */
export const HUB_LEAD = '내 Claude·ChatGPT 계정으로 답받으려면 내 PC에서 허브를 켜세요.'

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

type CopyState = 'idle' | 'copied' | 'select'

/** Mac 한 줄 설치 명령 칸 + [복사] — 계정을 고르기 전에는 빈 칸만 보이고 누를 수 없다 */
function InstallCommand({ account, onCopied }: { account: HubAccount | null; onCopied?: () => void }) {
  const [state, setState] = useState<CopyState>('idle')
  const [flash, setFlash] = useState(false)
  const box = useRef<HTMLElement>(null)
  const command = account ? installCommand(account) : ''

  // 계정을 바꾸면 명령이 달라지니 복사 안내를 처음으로 되돌린다 — 렌더 중에 맞춰 옛 안내가 한 번도 보이지 않게
  const [shownFor, setShownFor] = useState(account)
  if (shownFor !== account) {
    setShownFor(account)
    setState('idle')
    setFlash(false)
  }

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(false), 2000)
    return () => clearTimeout(t)
  }, [flash])

  const selectBox = () => {
    const sel = window.getSelection()
    if (!box.current || !sel) return
    const range = document.createRange()
    range.selectNodeContents(box.current)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  const copy = async () => {
    if (!command) return
    let ok = false
    try {
      await navigator.clipboard.writeText(command)
      ok = true
    } catch {
      // 클립보드 권한이 없는 창(http 사내 주소 등)에서는 명령 칸을 선택해 두고 한 번 더 시도한다
      selectBox()
      try {
        ok = document.execCommand('copy')
      } catch {
        ok = false
      }
    }
    setState(ok ? 'copied' : 'select')
    setFlash(ok)
    // 손으로 복사하게 되더라도 받는 단계에 들어선 것으로 본다
    onCopied?.()
  }

  return (
    <div className="cli-dl">
      <span className="muted cli-note" aria-live="polite">
        {!account ? (
          '계정을 고르면 설치 명령이 나와요.'
        ) : state === 'copied' ? (
          '복사했어요. 아래 1~2단계대로 터미널에 붙여 넣으세요.'
        ) : state === 'select' ? (
          <>
            자동 복사가 안 돼요. 글자가 선택돼 있으니 <b>command+C</b>를 눌러 복사하세요.
          </>
        ) : (
          '아래 한 줄을 복사해 터미널에 붙여 넣으면 설치돼요.'
        )}
      </span>
      <div className="cli-copy">
        <code ref={box} className={`cmd cli-cmd${account ? '' : ' empty'}`} title={account ? '눌러서 복사' : undefined} onClick={copy}>
          {command}
        </code>
        <button type="button" className="btn primary" disabled={!account} onClick={copy}>
          {flash ? '복사했어요' : '복사'}
        </button>
      </div>
    </div>
  )
}

/** 계정을 고르기 전(null)에도 버튼 자리를 보여 주되 누를 수 없게 한다 — 무엇을 받게 되는지 먼저 보이게 */
export function LocalHubGuide({ account, onDownloaded }: { account: HubAccount | null; onDownloaded?: () => void }) {
  const { showToast } = useApp()
  const [os, setOs] = useState<Os>(detectOs)
  const { downloading, done, error, download } = useHubDownload(showToast, account ?? 'both', onDownloaded)
  const mac = os === 'mac'

  return (
    <>
      {mac ? (
        <>
          <InstallCommand account={account} onCopied={onDownloaded} />
          <div className="cli-zip">
            <button type="button" className="cli-os-switch" disabled={!account || downloading} onClick={download}>
              {downloading ? '받는 중…' : '명령어 대신 파일(ZIP)로 받기'}
            </button>
            {done && (
              <span className="muted">
                <code>wiki-hub.zip</code> 이 다운로드 폴더에 받아졌어요. 여는 법은 '자세히 보기'에 있어요.
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="cli-dl">
          <button type="button" className="btn primary" disabled={!account || downloading} onClick={download}>
            {downloading ? '받는 중…' : '내 PC용 허브 내려받기'}
          </button>
          <span className="muted cli-note">
            {account ? (
              <>
                <code>wiki-hub.zip</code> 이 다운로드 폴더에 받아져요.
              </>
            ) : (
              '계정을 고르면 받을 수 있어요'
            )}
          </span>
        </div>
      )}
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

      <div className="cli-os">
        <b>{mac ? '설치 순서 (Mac)' : '받은 뒤 할 일 (Windows)'}</b>
        <button type="button" className="cli-os-switch" onClick={() => setOs(mac ? 'win' : 'mac')}>
          {mac ? 'Windows 안내 보기' : 'Mac 안내 보기'}
        </button>
      </div>
      {mac ? (
        <ol className="cli-steps">
          <li>
            <b>command+스페이스</b>를 눌러 <b>터미널</b>이라고 쓰고 <b>return</b>
          </li>
          <li>
            열린 터미널 창에 <b>command+V</b>로 붙여 넣고 <b>return</b>
          </li>
          <li>
            터미널 창이 혼자 준비해요(처음 5~10분). 브라우저에 로그인 화면이 뜨면 <b>로그인</b>
          </li>
          <li>
            허브가 열리면 끝! 다음부터는 바탕화면 <b>플랫폼 담당 지식 허브</b>를 더블클릭
          </li>
        </ol>
      ) : (
        <ol className="cli-steps">
          <li>
            받은 파일 <b>우클릭 → 모두 압축 풀기</b>
          </li>
          <li>
            풀린 폴더의 <b>start-hub-windows</b> 더블클릭 (파란 창이 뜨면 <b style={{ whiteSpace: 'nowrap' }}>추가 정보 → 실행</b>)
          </li>
          <li>
            브라우저에 로그인 창이 뜨면 <b>로그인</b> — 끝! (첫 실행은 5~10분)
          </li>
        </ol>
      )}

      <details className="cli-fold cli-more">
        <summary>자세히 보기</summary>
        {mac ? (
          <ul>
            <li>
              Spotlight 검색창이 안 뜨면: Finder → <b>응용 프로그램 → 유틸리티 → 터미널</b>을 더블클릭하세요.
            </li>
            <li>
              처음 5~10분은 터미널 창이 혼자 준비해요. 키보드는 누르지 않아도 되고, 창은 <b>닫지 말고</b> 노란 단추로 내려 두세요.
            </li>
            <li>
              "터미널이 … 폴더에 접근하려고 합니다" 창이 뜨면 <b>허용</b>.
            </li>
            {/* 설치 스크립트는 관리자 권한을 쓰지 않는다 — 아래 ZIP 경로의 Mac 암호와 헷갈리지 않게 먼저 둔다 */}
            <li>Mac 암호는 묻지 않아요. 암호 창이 뜨면 입력하지 말고 허브 담당자에게 알려 주세요.</li>
            <li>
              허브는 <b>내 홈 폴더 &gt; wiki-hub</b> 에 설치돼요. 이 폴더는 열거나 옮기지 않아도 돼요.
            </li>
            <li>
              예전에 받은 다운로드 폴더의 <b>wiki-hub</b>, <b>wiki-hub (1)</b> 같은 폴더는 이제 쓰지 않아요. 휴지통에 버려도 돼요.
            </li>
            <li>
              이미 설치했어도 같은 명령을 다시 붙여 넣어도 괜찮아요. 새로 깔지 않고 허브를 켜요. 계정을 바꿔 골랐다면 그 계정으로 바꿔
              줘요.
            </li>
            <li>
              {/* macOS 15부터는 우클릭 → 열기로 넘어가지지 않아 시스템 설정 경로를 함께 둔다 */}
              파일(ZIP)로 받았다면: 받은 파일 <b>더블클릭</b>해 압축 풀기 → <b>start-hub-mac.command</b> 우클릭 → <b>열기 → 열기</b>.{' '}
              <b>완료</b>만 보이면 <b>Apple 메뉴 → 시스템 설정 → 개인정보 보호 및 보안</b>에서 아래로 내려 <b>그래도 열기</b> → 한 번 더{' '}
              <b>그래도 열기</b> → Mac 암호. <b>휴지통으로 이동</b>은 누르지 마세요.
            </li>
            {/* 스크립트가 시작되기 전 받기 자체가 실패하면 영어 오류만 나오고 스크립트가 막을 수 없다 */}
            <li>
              붙여 넣은 뒤 영어 한 줄만 나오고 멈추면 인터넷이나 회사 네트워크 문제예요. 위의 <b>파일(ZIP)로 받기</b>로 설치하세요.
            </li>
          </ul>
        ) : (
          <ul>
            <li>더블클릭으로 열기만 하면 안 돼요. 꼭 <b>모두 압축 풀기</b>로 푸세요.</li>
            <li>
              "보안 경고" 창이 뜨면 <b>실행</b>.
            </li>
            <li>
              검은 창이 혼자 준비해요(처음 5~10분). 키보드는 누르지 않아도 되고, 창은 <b>닫지 말고 최소화</b>해 두세요.
            </li>
            <li>풀린 폴더의 start-hub-windows, start-hub-mac, 읽어주세요, hub 중 hub 폴더는 열지 않아도 돼요.</li>
          </ul>
        )}
        <ul>
          <li>
            다음부터는 바탕화면의 <b>플랫폼 담당 지식 허브</b>를 더블클릭하세요. 켜져 있으면 브라우저만 열려요.{' '}
            <a href={LOCAL_URL} target="_blank" rel="noreferrer">
              켜져 있는 허브 열기 ↗
            </a>
          </li>
          <li>
            잘 안 되면{' '}
            {mac ? '내 홈 폴더 > wiki-hub-기록 > 설치기록.txt' : 'C:\\Users\\(내 이름)\\wiki-hub-기록\\설치기록.txt'} 파일을 허브 담당자에게
            보내 주세요.
          </li>
        </ul>
      </details>
    </>
  )
}
