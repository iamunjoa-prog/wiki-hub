import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * 시스템 목록 공용 저장 — 팀 공유 드라이브의 JSON 파일 하나.
 *
 * 사내 시스템 주소는 공개 저장소에 두지 않기로 해서 코드가 아니라 이 파일에 쌓인다.
 * 사내 DB가 생기기 전까지의 자리이므로, 읽고 쓰는 창구를 여기 하나로 모아 둔다.
 *
 * 파일 위치는 허브 폴더의 `.env.local` 에서 `HUB_SYSTEMS_FILE` 로 지정한다.
 *   HUB_SYSTEMS_FILE=\\사내서버\팀공유\wiki-hub\systems.json
 * 지정하지 않으면 내 PC(홈 폴더)에만 쌓여 공유되지 않는다.
 */

export interface StoredSystem {
  id: string
  name: string
  desc: string
  access: string
  group: string
  url?: string
}

export interface StoredRequest {
  id: string
  targetSystemId?: string
  name: string
  desc: string
  url: string
  access: string
  group: string
  status: 'pending' | 'approved' | 'rejected'
  rejectReason?: string
  requestedBy: string
  requestedAt: string
}

export interface SystemsFile {
  version: 1
  /** 코드에 있는 시스템에 나중에 붙인 접속 주소 — { 시스템id: 주소 } */
  urls: Record<string, string>
  /** 담당자가 새로 올려 승인된 시스템 */
  added: StoredSystem[]
  requests: StoredRequest[]
  updatedAt: string
}

const EMPTY: SystemsFile = { version: 1, urls: {}, added: [], requests: [], updatedAt: '' }

/** 공유 위치를 지정하지 않았을 때 쓰는 내 PC 경로 — 공유되지 않는다 */
const FALLBACK = join(homedir(), '.wiki-hub', 'systems.json')

export function systemsFilePath(env: Record<string, string | undefined>): string {
  const configured = env.HUB_SYSTEMS_FILE?.trim()
  return configured ? resolve(configured) : FALLBACK
}

/** 공유 위치가 지정됐는지 — 화면에 "이 PC에만 저장 중"을 알려 주는 데 쓴다 */
export function isShared(env: Record<string, string | undefined>): boolean {
  return Boolean(env.HUB_SYSTEMS_FILE?.trim())
}

export function readSystemsFile(path: string): SystemsFile {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SystemsFile>
    return {
      version: 1,
      urls: parsed.urls ?? {},
      added: parsed.added ?? [],
      requests: parsed.requests ?? [],
      updatedAt: parsed.updatedAt ?? '',
    }
  } catch {
    // 파일이 아직 없거나 깨졌으면 빈 상태로 시작한다 — 첫 쓰기에서 새로 만든다
    return { ...EMPTY }
  }
}

export function writeSystemsFile(path: string, data: SystemsFile): SystemsFile {
  const next = { ...data, version: 1 as const, updatedAt: new Date().toISOString() }
  const body = JSON.stringify(next, null, 2)
  mkdirSync(dirname(path), { recursive: true })
  try {
    // 쓰는 도중 다른 사람이 읽어도 반쪽 파일을 보지 않게 임시 파일에 쓰고 갈아 끼운다
    const tmp = `${path}.tmp`
    writeFileSync(tmp, body, 'utf8')
    renameSync(tmp, path)
  } catch {
    // 공유 드라이브가 rename 을 막는 경우가 있어 곧바로 쓰는 길을 남겨 둔다
    writeFileSync(path, body, 'utf8')
  }
  return next
}

/**
 * 읽기 → 고치기 → 쓰기. 쓰기 직전에 다시 읽어서 그 사이 다른 사람이 넣은 요청을 덮지 않는다.
 * 파일 하나를 여럿이 쓰는 방식이라 같은 순간의 동시 수정까지는 막지 못한다 — 사내 DB로 옮길 때 정리한다.
 */
export function updateSystemsFile(path: string, edit: (data: SystemsFile) => SystemsFile): SystemsFile {
  return writeSystemsFile(path, edit(readSystemsFile(path)))
}
