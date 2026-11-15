import { useState } from 'react'
import {
  DOWNLOAD_FAIL_TEXT,
  LOCAL_URL,
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
 * 노트북 화면에서 내려받기 버튼이 잘리지 않게 버튼을 계정 선택 바로 아래에 두고, 긴 설명은 "자세히 보기"로 접는다.
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

/** 계정을 고르기 전(null)에도 버튼 자리를 보여 주되 누를 수 없게 한다 — 무엇을 받게 되는지 먼저 보이게 */
export function LocalHubGuide({ account, onDownloaded }: { account: HubAccount | null; onDownloaded?: () => void }) {
  const { showToast } = useApp()
  const [os, setOs] = useState<Os>(detectOs)
  const { downloading, error, download } = useHubDownload(showToast, account ?? 'both', onDownloaded)
  const mac = os === 'mac'

  return (
    <>
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
        <b>받은 뒤 할 일 ({mac ? 'Mac' : 'Windows'})</b>
        <button type="button" className="cli-os-switch" onClick={() => setOs(mac ? 'win' : 'mac')}>
          {mac ? 'Windows 안내 보기' : 'Mac 안내 보기'}
        </button>
      </div>
      {mac ? (
        <ol className="cli-steps">
          <li>
            받은 파일 <b>더블클릭</b>해 압축 풀기
          </li>
          <li>
            풀린 폴더의 <b>start-hub-mac.command</b> 우클릭 → <b>열기</b> (막히면 아래 '자세히 보기')
          </li>
          <li>
            브라우저에 로그인 창이 뜨면 <b>로그인</b> — 끝!
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
            <li>Safari로 받았다면 이미 풀려 있어요.</li>
            <li>
              우클릭(또는 control+클릭) → <b>열기</b> 뒤 뜨는 창에서 다시 <b>열기</b>를 누르세요.
            </li>
            <li>
              {/* macOS 15부터는 우클릭 → 열기로 넘어가지지 않아 시스템 설정 경로를 함께 둔다 */}
              <b>완료</b>만 보이면: <b>완료</b> → <b>Apple 메뉴 → 시스템 설정 → 개인정보 보호 및 보안</b>에서 아래로 내려{' '}
              <b>그래도 열기</b> → 한 번 더 <b>그래도 열기</b> → Mac 암호. <b>휴지통으로 이동</b>은 누르지 마세요.
            </li>
            <li>
              "터미널이 … 폴더에 접근하려고 합니다" 창이 뜨면 <b>허용</b>.
            </li>
            <li>
              터미널 창이 혼자 준비해요(처음 5~10분). 키보드는 누르지 않아도 되고, 창은 <b>닫지 말고</b> 노란 단추로 내려 두세요.
            </li>
            <li>hub 폴더는 열지 않아도 돼요.</li>
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
