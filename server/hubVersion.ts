/**
 * 내 PC용 허브가 켜진 채로 새 버전이 나왔는지 화면에 알려 준다 — 로컬 중계(server/cliBridge.ts) 전용, 배포 함수는 없다.
 * 실제 교체는 다시 켤 때 실행기(scripts/update-hub.ps1 · start-hub.command)가 한다. 판정 방식은 그 스크립트와 같게 둔다.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HUB_VERSION_NAME } from './hubZipRoot.js'

export interface HubVersionReply {
  current: string | null
  latest: string | null
  updateAvailable: boolean
  checkedAt: string
  reason?: 'no-version' | 'git-checkout' | 'offline'
}

// update-hub.ps1 Read-HubVersion 과 같은 검사
const VERSION_PATTERN = /^[0-9a-f]{7,40}$/
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/
// 실행기($UpdateCheckTimeoutMs = 4000)보다 조금 넉넉히 — 화면 알림이라 늦어도 켜기를 막지 않는다
const CHECK_TIMEOUT_MS = 4500
// 여러 탭·포커스마다 GitHub 을 두드리지 않게 원격 결과만 묵혀 둔다
const CACHE_MS = 30 * 60 * 1000
// 실패는 짧게 — 망이 돌아오면 곧 다시 확인한다
const FAIL_CACHE_MS = 5 * 60 * 1000
// HEAD 는 맨 앞 줄에 온다 — 이만큼 읽고도 없으면 끊는다
const MAX_READ_BYTES = 4096

/** 허브 루트의 .hub-version — 없거나 형식이 다르면 null */
export function readHubVersion(root: string): { version: string; repo: string } | null {
  try {
    const json = JSON.parse(readFileSync(join(root, HUB_VERSION_NAME), 'utf8').replace(/^﻿/, '')) as {
      version?: unknown
      repo?: unknown
    }
    const version = String(json?.version ?? '')
    const repo = String(json?.repo ?? '')
    return VERSION_PATTERN.test(version) && REPO_PATTERN.test(repo) ? { version, repo } : null
  } catch {
    return null
  }
}

/** 기본 브랜치 끝 커밋(40자리) — 토큰·API 한도 없는 info/refs 의 HEAD 줄만 읽는다 (update-hub.ps1 Get-LatestCommit) */
export async function fetchLatestCommit(repo: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<string> {
  const res = await fetch(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`, {
    headers: { 'User-Agent': 'wiki-hub-update' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {})
    throw new Error(`HTTP ${res.status}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder('ascii')
  let text = ''
  try {
    while (text.length < MAX_READ_BYTES && !/[0-9a-f]{40} HEAD/.test(text)) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const m = /([0-9a-f]{40}) HEAD/.exec(text)
  if (!m) throw new Error('info/refs 에 HEAD 가 없음')
  return m[1]
}

type Fetcher = (repo: string) => Promise<string>

const cache = new Map<string, { at: number; latest: string | null }>()

/** 캐시를 비운다 — 확인용 */
export function clearHubVersionCache(): void {
  cache.clear()
}

/**
 * 화면이 받을 버전 상태. 개발 PC(.git 있음)와 버전 파일 없는 경우는 원격을 묻지 않는다.
 * 원격 실패는 오류가 아니라 reason:'offline' — 회사망·오프라인에서도 화면이 조용히 넘긴다
 */
export async function hubVersionStatus(
  root: string,
  opts: { fetchLatest?: Fetcher; now?: () => number; onError?: (message: string) => void } = {},
): Promise<HubVersionReply> {
  const now = opts.now ?? Date.now
  const checkedAt = () => new Date(now()).toISOString()
  if (existsSync(join(root, '.git'))) {
    return { current: readHubVersion(root)?.version ?? null, latest: null, updateAvailable: false, checkedAt: checkedAt(), reason: 'git-checkout' }
  }
  const current = readHubVersion(root)
  if (!current) return { current: null, latest: null, updateAvailable: false, checkedAt: checkedAt(), reason: 'no-version' }

  let entry = cache.get(current.repo)
  if (!entry || now() - entry.at >= (entry.latest ? CACHE_MS : FAIL_CACHE_MS)) {
    const at = now()
    let latest: string | null = null
    try {
      latest = await (opts.fetchLatest ?? fetchLatestCommit)(current.repo)
    } catch (err) {
      const e = err as Error
      opts.onError?.(e.name === 'TimeoutError' ? `${CHECK_TIMEOUT_MS}ms 안에 응답 없음` : e.message)
    }
    entry = { at, latest }
    cache.set(current.repo, entry)
  }
  const { at, latest } = entry
  const base = { current: current.version, latest, checkedAt: new Date(at).toISOString() }
  if (!latest) return { ...base, updateAvailable: false, reason: 'offline' }
  return { ...base, updateAvailable: !latest.startsWith(current.version) }
}
