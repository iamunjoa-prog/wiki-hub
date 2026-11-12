/**
 * "로컬 허브 내려받기" — private 저장소의 zipball을 서버 토큰으로 받아, 풀면 실행기만 보이게 다시 묶어 돌려준다.
 * 배포(api/download-hub.ts)와 로컬(server/cliBridge.ts)이 함께 쓴다. 토큰은 서버 밖으로 나가지 않는다.
 */

import { unzipSync, zipSync, strToU8, type Zippable } from 'fflate'
import { HUB_DIR, README_NAME, ROOT_BAT, ROOT_COMMAND, readmeText } from './hubZipRoot.js'

export const HUB_ZIP_FILENAME = 'wiki-hub.zip'

// 받은 zipball이 이보다 크면 묶지 않는다 — 결과가 Vercel 응답 한도(4.5MB)를 넘길 크기다
const MAX_ZIPBALL_BYTES = 20 * 1024 * 1024

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/

const fail = (status: number, message: string) => Response.json({ error: message }, { status })

function describeGithubFailure(status: number): string {
  const head = `GitHub에서 허브를 받지 못했습니다 (HTTP ${status})`
  if (status === 401) return `${head} — 토큰이 만료됐거나 잘못되었습니다. GITHUB_TOKEN을 확인해 주세요`
  if (status === 403) return `${head} — 토큰 권한이 부족하거나 GitHub 호출 한도를 넘었습니다. 잠시 뒤 다시 시도하거나 토큰 권한(Contents: Read)을 확인해 주세요`
  if (status === 404) return `${head} — 저장소를 찾을 수 없거나 토큰이 이 저장소에 접근할 수 없습니다. GITHUB_REPO와 토큰의 저장소 범위를 확인해 주세요`
  return `${head} — 잠시 뒤 다시 시도해 주세요`
}

// fflate unzipSync 가 원본 권한을 주지 않아 확장자로 정한다 (made-by Unix 라야 풀 때 권한이 적용된다)
const fileMode = (path: string) => (/\.(command|sh)$/.test(path) ? 0o100755 : 0o100644)

/**
 * zipball(최상위 owner-repo-<sha>/ 하나)을 루트에 실행기 2개 + 안내 txt + hub/ 만 있는 ZIP으로 다시 묶는다.
 * 최상위 폴더를 두지 않아야 풀기 도구마다 폴더 깊이가 갈라지지 않는다. 한글 항목명은 fflate가 UTF-8 플래그를 켠다
 */
export function repackHubZip(zipball: Uint8Array, now: Date): Uint8Array {
  return repack(zipball, now).zip
}

function repack(zipball: Uint8Array, now: Date): { zip: Uint8Array; files: number } {
  const entries = unzipSync(zipball)
  const out: Zippable = {}
  const entry = (data: Uint8Array, mode: number): Zippable[string] => [data, { os: 3, attrs: mode << 16, mtime: now }]
  let top: string | undefined
  let count = 0
  for (const [path, data] of Object.entries(entries)) {
    const cut = path.indexOf('/')
    if (cut <= 0) throw new Error(`zipball 최상위 폴더 밖의 항목: ${path}`)
    const head = path.slice(0, cut)
    if (top === undefined) top = head
    else if (head !== top) throw new Error(`zipball 최상위 폴더가 둘 이상: ${top}, ${head}`)
    const rest = path.slice(cut + 1)
    if (!rest || rest.endsWith('/')) continue // 디렉터리 항목은 버린다 (파일 경로로 다시 생긴다)
    const name = `${HUB_DIR}/${rest}`
    out[name] = entry(data, fileMode(name))
    count++
  }
  if (!top || count === 0) throw new Error('zipball에 파일이 없습니다')

  const version = /-([0-9a-f]{7,40})$/.exec(top)?.[1].slice(0, 7) ?? '알 수 없음'
  out['start-hub.bat'] = entry(strToU8(ROOT_BAT), 0o100644)
  out['start-hub.command'] = entry(strToU8(ROOT_COMMAND), 0o100755)
  out[README_NAME] = entry(strToU8(readmeText(now, version)), 0o100644)
  return { zip: zipSync(out, { level: 6 }), files: count + 3 }
}

/** 기본 브랜치의 zipball을 받아 다시 묶은 뒤 첨부 파일 응답으로 돌려준다. 결과가 1MB 안팎이고 화면이 Blob으로 다 받으므로 버퍼링한다 */
export async function proxyHubZip(token: string | undefined, repo: string): Promise<Response> {
  if (!token)
    return fail(
      503,
      '서버에 GitHub 토큰이 설정되지 않아 허브를 내려받을 수 없습니다. 관리자에게 환경변수 GITHUB_TOKEN(또는 GH_TOKEN) 설정을 요청해 주세요. (값을 넣은 뒤 반드시 재배포해야 적용됩니다 — 이미 돌고 있는 배포에는 반영되지 않습니다)',
    )
  if (!REPO_PATTERN.test(repo)) return fail(500, `GITHUB_REPO 형식이 올바르지 않습니다 (owner/repo): ${repo}`)

  let upstream: Response
  try {
    // ref를 생략하면 GitHub가 기본 브랜치를 쓴다 (리다이렉트는 fetch가 따라간다)
    upstream = await fetch(`https://api.github.com/repos/${repo}/zipball`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'wiki-hub-download',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  } catch (err) {
    return fail(502, `GitHub에 연결하지 못했습니다 — ${(err as Error).message}`)
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => {})
    return fail(502, describeGithubFailure(upstream.status))
  }

  const tooBig = '허브 파일이 너무 커서 묶지 못했습니다 — 관리자에게 알려 주세요'
  const declared = Number(upstream.headers.get('content-length'))
  if (declared > MAX_ZIPBALL_BYTES) {
    await upstream.body.cancel().catch(() => {})
    return fail(502, tooBig)
  }

  let repacked: { zip: Uint8Array; files: number }
  try {
    const zipball = new Uint8Array(await upstream.arrayBuffer())
    if (zipball.byteLength > MAX_ZIPBALL_BYTES) return fail(502, tooBig)
    repacked = repack(zipball, new Date())
  } catch (err) {
    // 원문은 서버 로그에만 — 화면에는 한 줄 안내
    console.error(`[download-hub] repack 실패: ${(err as Error).message}`)
    return fail(502, '허브 파일을 묶지 못했습니다 — 잠시 뒤 다시 시도해 주세요')
  }
  const { zip, files } = repacked
  console.info(`[download-hub] ${zip.byteLength} bytes · ${files} files`)

  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      // 파일명은 ASCII 고정 — 한글 파일명은 헤더 인코딩 문제를 만든다
      'Content-Disposition': `attachment; filename="${HUB_ZIP_FILENAME}"`,
      'Cache-Control': 'no-store',
      'Content-Length': String(zip.byteLength),
    },
  })
}
