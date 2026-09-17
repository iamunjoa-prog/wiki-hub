import type { SystemEntry, SystemRequest } from '../types'

/**
 * 시스템 목록 공용 저장소 — 로컬 허브가 팀 공유 드라이브의 JSON 파일을 대신 읽고 써 준다.
 *
 * 배포본(Vercel)에는 이 경로가 없다. 사내 주소를 회사 밖에 두지 않으려는 것이라,
 * 경로가 없으면 `null` 을 돌려주고 화면은 메모리 상태로 동작한다.
 */
export interface SystemsState {
  /** 코드에 있는 시스템에 나중에 붙인 접속 주소 */
  urls: Record<string, string>
  /** 승인되어 목록에 추가된 시스템 */
  added: SystemEntry[]
  requests: SystemRequest[]
  /** 공유 위치가 지정됐는지 — false 면 이 PC에만 쌓인다 */
  shared: boolean
  updatedAt: string
}

export type SystemsAction =
  | { kind: 'request'; request: SystemRequest }
  | { kind: 'decide'; id: string; decision: 'approved' | 'rejected'; reason?: string }

async function readJson(res: Response): Promise<SystemsState | null> {
  if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return null
  return (await res.json()) as SystemsState
}

export async function fetchSystemsState(): Promise<SystemsState | null> {
  try {
    return await readJson(await fetch('/api/systems'))
  } catch {
    return null
  }
}

/** 요청·승인을 공용 파일에 반영하고 반영된 전체 상태를 돌려받는다 */
export async function postSystemsAction(action: SystemsAction): Promise<SystemsState | null> {
  try {
    return await readJson(
      await fetch('/api/systems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      }),
    )
  } catch {
    return null
  }
}

/** 저장소가 없을 때 쓰는 빈 상태 — 화면은 이 위에서 메모리로만 돈다 */
export const EMPTY_SYSTEMS_STATE: SystemsState = {
  urls: {},
  added: [],
  requests: [],
  shared: false,
  updatedAt: '',
}

/**
 * 요청·승인을 상태에 반영한다. 서버가 파일에 적용하는 규칙과 같은 규칙이며,
 * 저장소가 없을 때(배포본) 메모리에서 같은 화면을 보여 주는 데 쓴다.
 */
export function reduceSystems(state: SystemsState, action: SystemsAction): SystemsState {
  if (action.kind === 'request') {
    return { ...state, requests: [action.request, ...state.requests] }
  }
  const target = state.requests.find((r) => r.id === action.id)
  const requests = state.requests.map((r) =>
    r.id === action.id ? { ...r, status: action.decision, rejectReason: action.reason } : r,
  )
  if (!target || action.decision !== 'approved') return { ...state, requests }
  if (target.targetSystemId) {
    return { ...state, requests, urls: { ...state.urls, [target.targetSystemId]: target.url } }
  }
  return {
    ...state,
    requests,
    added: [
      ...state.added,
      {
        id: target.id,
        name: target.name,
        desc: target.desc,
        url: target.url || undefined,
        access: target.access,
        group: target.group,
      },
    ],
  }
}
