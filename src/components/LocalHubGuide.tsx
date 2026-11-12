import { useState } from 'react'
import { LOCAL_URL, detectOs, useHubDownload, type Os } from '../lib/localHub'
import { useApp } from '../store/AppStore'

/**
 * 로컬 허브 내려받기·실행 안내 — 설정 창(CliStatus)과 첫 안내 창(LocalHubOnboarding)이 같이 쓴다.
 * 단계 문구는 이 파일 한 곳에만 둔다.
 */
export function LocalHubGuide({ onDownloaded }: { onDownloaded?: () => void }) {
  const { showToast } = useApp()
  const [os, setOs] = useState<Os>(detectOs)
  const { downloading, error, download } = useHubDownload(showToast, onDownloaded)
  const shell = os === 'mac' ? '터미널' : '검은 창'

  return (
    <>
      <div className="cli-os">
        <b>{os === 'mac' ? 'Mac' : 'Windows'}</b>
        <button type="button" className="cli-os-switch" onClick={() => setOs(os === 'mac' ? 'win' : 'mac')}>
          {os === 'mac' ? 'Windows 안내 보기' : 'Mac 안내 보기'}
        </button>
      </div>
      <ol className="cli-steps">
        <li>
          아래 <b>로컬 허브 내려받기</b>로 <code>wiki-hub.zip</code> 을 받습니다
        </li>
        <li>
          {os === 'mac' ? (
            <><b>더블클릭해 압축 풀기</b> (ZIP 안에서 바로 실행 금지)</>
          ) : (
            <>받은 파일을 <b>우클릭 → 모두 압축 풀기</b> (ZIP 안에서 바로 실행 금지)</>
          )}
        </li>
        <li>
          {/* Windows는 확장자가 숨겨져 start-hub가 두 개 보이므로 탐색기의 "종류"로 고르게 한다 */}
          {os === 'mac' ? (
            <>
              풀린 <b>wiki-hub</b> 폴더에서 <b style={{ whiteSpace: 'nowrap' }}>start-hub.command</b> 를{' '}
              <b>우클릭 → 열기</b> ("확인되지 않은 개발자" 경고 때문)
            </>
          ) : (
            <>
              풀린 <b>wiki-hub</b> 폴더에서 <b>start-hub</b>(종류: Windows 배치 파일)를 더블클릭
            </>
          )}
        </li>
        <li>
          {/* setup 은 CLI 설치·로그인을 하나씩 묻고, 로그인은 CLI가 띄우는 브라우저에서 한다. 허브는 세팅이 끝난 뒤 따로 열린다 */}
          {shell}이 묻는 대로 <b>Y</b>를 누릅니다(쓰지 않는 쪽은 N). 브라우저에 로그인 화면이 뜨면{' '}
          <b>Claude Code·Codex 계정으로 로그인</b>하세요. 세팅이 끝나면 허브가 브라우저에 열립니다
        </li>
      </ol>
      <span className="muted cli-note">
        wiki-hub 폴더에는 start-hub, 읽어주세요, hub 폴더만 있습니다. hub 폴더는 열지 않아도 됩니다.
      </span>
      <button
        type="button"
        className="btn sm primary"
        style={{ alignSelf: 'flex-start' }}
        disabled={downloading}
        onClick={download}
      >
        {downloading ? '받는 중…' : '로컬 허브 내려받기'}
      </button>
      {error && (
        <span role="alert" className="cli-note" style={{ color: 'var(--danger, #c0392b)' }}>
          {error}
        </span>
      )}
      <span className="muted cli-note">
        이미 받아 두셨다면:{' '}
        <a href={LOCAL_URL} target="_blank" rel="noreferrer">
          로컬 허브 열기 ↗
        </a>{' '}
        — 허브가 켜져 있을 때만 열립니다. 안 열리면 바탕화면 <b>플랫폼 담당 지식 허브</b>를 먼저 실행하세요.
      </span>
    </>
  )
}
