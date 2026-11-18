import { useEffect, useRef, useState } from 'react'
import type { HubVersionInfo } from '../types'

/** 내 PC 허브 새 버전 알림 — 켤 때만 바뀌므로 켜 둔 채 쓰는 동안 새 버전이 나오면 화면에서 알린다 */

const CHECK_EVERY_MS = 3 * 60 * 60 * 1000
/** 창에 돌아왔을 때는 마지막 확인이 이보다 오래됐을 때만 다시 묻는다 */
const RECHECK_ON_RETURN_MS = 60 * 60 * 1000

const DISMISSED_UPDATE_KEY = 'hub-update-dismissed'
const DISMISSED_LEGACY_KEY = 'hub-legacy-notice-dismissed'

/** 'none' — 배포본(경로 없음)이라 더 묻지 않는다. 'error' — 이번만 실패, 다음 확인 때 다시 묻는다 */
type FetchResult = HubVersionInfo | 'none' | 'error'

const isInfo = (v: unknown): v is HubVersionInfo =>
  !!v && typeof v === 'object' && typeof (v as HubVersionInfo).updateAvailable === 'boolean'

export async function fetchHubVersion(): Promise<FetchResult> {
  try {
    const res = await fetch('/api/hubVersion', { headers: { Accept: 'application/json' } })
    if (res.status === 404) return 'none'
    if (!res.ok) return 'error'
    const data: unknown = await res.json().catch(() => null)
    // 200 인데 모양이 다르면(화면 HTML 이 돌아오는 등) 이 경로가 없는 허브로 본다
    return isInfo(data) ? data : 'none'
  } catch {
    return 'error'
  }
}

/** 처음 1번, 그 뒤 3시간마다, 창에 돌아왔을 때 1시간이 넘었으면 1번 확인한다 */
export function useHubVersion(): HubVersionInfo | null {
  const [info, setInfo] = useState<HubVersionInfo | null>(null)
  const lastChecked = useRef(0)
  const stopped = useRef(false)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval> | undefined

    const check = async () => {
      if (stopped.current) return
      lastChecked.current = Date.now()
      const r = await fetchHubVersion()
      if (!alive) return
      if (r === 'none') {
        stopped.current = true
        clearInterval(timer)
        setInfo(null)
      } else if (r !== 'error') setInfo(r)
      // 네트워크 오류는 조용히 넘기고 보이던 안내는 그대로 둔다
    }

    const onReturn = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastChecked.current > RECHECK_ON_RETURN_MS) check()
    }

    check()
    timer = setInterval(check, CHECK_EVERY_MS)
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [])

  return info
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 저장 못 하면 이번 화면에서만 숨긴다 */
  }
}

/** 닫기는 그 새 버전에만 적용된다 — 더 새 버전이 나오면 다시 보인다 */
export const isUpdateDismissed = (latest: string) => read(DISMISSED_UPDATE_KEY) === latest
export const dismissUpdate = (latest: string) => write(DISMISSED_UPDATE_KEY, latest)

export const isLegacyDismissed = () => read(DISMISSED_LEGACY_KEY) === '1'
export const dismissLegacy = () => write(DISMISSED_LEGACY_KEY, '1')

/** 담당자용 표시 — 앞 7자리만 */
export const shortVersion = (v: string | null) => (v ? v.slice(0, 7) : '알 수 없음')
