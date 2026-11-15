import { useCallback, useState } from 'react'
import type { CliEngine, Engine, EngineStatus } from '../types'

/** 로컬 허브(내 PC에서 실행하는 허브) 안내에 쓰는 것들 — 설정 창과 첫 안내 창이 같이 쓴다 */

export const LOCAL_URL = 'http://localhost:5173'
export const DOWNLOAD_URL = '/api/download-hub'

const CLI_ENGINES: CliEngine[] = ['claude', 'codex']

export type Os = 'win' | 'mac'

/** 첫 안내 창·설정 창에서 고르는 계정. ZIP 설정 파일에 실려 설치·로그인할 연결 프로그램을 정한다 */
export type HubAccount = 'claude' | 'codex' | 'both'
export type AccountChoice = HubAccount | 'unknown'

/** 초보자 화면의 계정 이름 — ENGINE_LABEL(챗 답변 출처 표시)과 따로 둔다 */
export const ACCOUNT_NAME: Record<CliEngine, string> = { claude: 'Claude', codex: 'ChatGPT' }

export const accountNames = (a: HubAccount): string =>
  a === 'both' ? `${ACCOUNT_NAME.claude}와 ${ACCOUNT_NAME.codex}` : ACCOUNT_NAME[a === 'claude' ? 'claude' : 'codex']

/** 내려받기 실패 시 사용자에게 보이는 한 줄 — 서버 원문은 "담당자용 정보"로 접는다 */
export const DOWNLOAD_FAIL_TEXT = '지금 받을 수 없어요. 잠시 뒤 다시 눌러 보고, 계속 안 되면 허브 담당자에게 알려 주세요.'

/** 브라우저가 알려 주는 OS. Mac이 아니면(판단 불가 포함) Windows 안내를 기본으로 한다. */
export const detectOs = (): Os =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(`${navigator.platform} ${navigator.userAgent}`) ? 'mac' : 'win'

/** 엔진 상태에 CLI 항목이 있으면 로컬 허브다 — 배포 함수는 Gemini만 알려 준다 */
export const isLocalStatus = (status: Partial<Record<Engine, EngineStatus>> | null | undefined): boolean =>
  Boolean(status && CLI_ENGINES.some((e) => e in status))

/**
 * 허브 ZIP 내려받기. <a href>로 바로 받으면 서버가 503(토큰 없음)·401(로그인 필요) 등을 돌려줄 때
 * 브라우저가 JSON 오류 파일을 저장하거나 아무 일도 없어 보인다. 저장소는 작으니(소스+문서) fetch → Blob으로
 * 메모리에 받아도 부담이 없고, 실패 사유를 화면에 보여 줄 수 있어 이쪽을 택했다.
 */
export function useHubDownload(showToast: (msg: string) => void, account: HubAccount, onDownloaded?: () => void) {
  const [downloading, setDownloading] = useState(false)
  // 서버 원문(담당자용). 화면에는 DOWNLOAD_FAIL_TEXT 를 먼저 보인다
  const [error, setError] = useState('')

  const download = useCallback(async () => {
    setDownloading(true)
    setError('')
    try {
      const r = await fetch(`${DOWNLOAD_URL}?account=${account}`)
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `내려받지 못했습니다 (HTTP ${r.status})`)
      }
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = 'wiki-hub.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      showToast(`wiki-hub.zip 을 받았어요. 다운로드 폴더에서 압축을 풀고 ${detectOs() === 'mac' ? 'start-hub-mac.command 를 우클릭 → 열기하세요' : 'start-hub-windows.bat 을 더블클릭하세요'}`)
      onDownloaded?.()
    } catch (err) {
      const message = (err as Error).message || '내려받지 못했습니다'
      setError(message)
      showToast(DOWNLOAD_FAIL_TEXT)
    } finally {
      setDownloading(false)
    }
  }, [showToast, account, onDownloaded])

  return { downloading, error, download }
}

/* ---------- 첫 안내 창 기록 ---------- */

/** 'later' 로 닫은 사람에게 자동으로 보여 주는 최대 횟수 */
export const ONBOARDING_MAX_SHOWN = 2

export interface OnboardingRecord {
  state: 'later' | 'done'
  shown: number
  at: string
}

// 계정 기능이 꺼진 데모 모드는 계정이 없으니 브라우저 하나를 한 사람으로 본다
const recordKey = (loginId?: string) => `hub-onboarding:${loginId ?? 'browser'}`
const seenKey = (loginId?: string) => `hub-onboarding-seen:${loginId ?? 'browser'}`

export function readOnboarding(loginId?: string): OnboardingRecord | null {
  try {
    const raw = localStorage.getItem(recordKey(loginId))
    if (!raw) return null
    const r = JSON.parse(raw) as Partial<OnboardingRecord>
    if (r.state !== 'later' && r.state !== 'done') return null
    return { state: r.state, shown: Number(r.shown) || 0, at: String(r.at ?? '') }
  } catch {
    return null
  }
}

export function writeOnboarding(loginId: string | undefined, state: OnboardingRecord['state']) {
  const prev = readOnboarding(loginId)
  const next: OnboardingRecord = {
    state,
    shown: state === 'later' ? (prev?.shown ?? 0) + 1 : (prev?.shown ?? 0),
    at: new Date().toISOString(),
  }
  try {
    localStorage.setItem(recordKey(loginId), JSON.stringify(next))
  } catch {
    /* 저장소를 못 쓰면 다음 세션에 다시 뜰 뿐이다 */
  }
}

/** 이번 세션(탭)에서 이미 띄웠는지 — 새로고침이나 화면 이동으로 다시 뜨지 않게 한다 */
export function seenThisSession(loginId?: string): boolean {
  try {
    return sessionStorage.getItem(seenKey(loginId)) === '1'
  } catch {
    return false
  }
}

export function markSeenThisSession(loginId?: string) {
  try {
    sessionStorage.setItem(seenKey(loginId), '1')
  } catch {
    /* 못 남기면 같은 세션에 한 번 더 뜰 수 있다 */
  }
}

/** 로그아웃하면 같은 탭에서 다시 로그인해도 새 세션으로 본다 */
export function forgetSessionSeen(loginId?: string) {
  try {
    sessionStorage.removeItem(seenKey(loginId))
  } catch {
    /* 무시 */
  }
}

export function shouldShowOnboarding(loginId?: string): boolean {
  if (seenThisSession(loginId)) return false
  const r = readOnboarding(loginId)
  if (!r) return true
  return r.state !== 'done' && r.shown < ONBOARDING_MAX_SHOWN
}
