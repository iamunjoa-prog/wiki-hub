import { readGithubRepo } from './env.js'

/**
 * "새 문서" — GitHub REST API로 브랜치를 만들고 마크다운 파일을 추가해 PR을 연다.
 * 로컬 개발 서버(cliBridge.ts)와 배포 함수(api/createDoc.ts)가 이 모듈을 함께 쓴다 —
 * 로컬도 배포도 git 명령이 아니라 GitHub API 하나로 동일하게 동작한다.
 */

export interface CreateDocInput {
  category: string
  /** 서브메뉴 없는 카테고리(이용 안내)는 null */
  subcategory: string | null
  title: string
  scope: 'PPM' | 'PPV' | '공통'
  body: string
  requestedBy: string
  /** 같은 서브메뉴(없으면 같은 카테고리) 문서들의 현재 코드 — 다음 번호를 여기서 뽑는다 */
  siblingCodes: string[]
}

export interface CreateDocResult {
  prUrl: string
  code: string
  path: string
}

const MAX_TITLE = 80
const MAX_BODY = 50_000

export function parseCreateDocInput(raw: unknown): CreateDocInput {
  const r = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const category = str(r.category).trim()
  if (!category) throw new Error('카테고리가 비어 있습니다')
  const subRaw = str(r.subcategory).trim()
  const title = str(r.title).trim().replace(/[\r\n]+/g, ' ')
  if (!title) throw new Error('제목이 비어 있습니다')
  if (title.length > MAX_TITLE) throw new Error(`제목은 ${MAX_TITLE}자 이내로 입력해 주세요`)
  const body = str(r.body).replace(/\r\n?/g, '\n').trim()
  if (!body) throw new Error('본문이 비어 있습니다')
  if (body.length > MAX_BODY) throw new Error('본문이 너무 깁니다')
  const scopeRaw = str(r.scope)
  const scope = scopeRaw === 'PPM' || scopeRaw === 'PPV' ? scopeRaw : '공통'
  const requestedBy = str(r.requestedBy).trim() || '알 수 없음'
  const siblingCodes = Array.isArray(r.siblingCodes) ? r.siblingCodes.filter((c): c is string => typeof c === 'string') : []
  return { category, subcategory: subRaw || null, title, scope, body, requestedBy, siblingCodes }
}

/**
 * 같은 서브메뉴 코드들의 접두사·숫자 패턴에서 다음 번호를 뽑는다 (예: PPC-R-06 다음 → PPC-R-07).
 * 코드가 하나도 없으면(빈 서브메뉴) 서브메뉴 id로 새 접두사를 만들고,
 * 코드는 있지만 숫자로 안 끝나면(ACS·CBS 같은 시스템 코드) null — 이 경우는 호출한 쪽에서 막는다.
 */
export function nextCode(siblingCodes: string[], subcategory: string | null): string | null {
  const withNum = siblingCodes
    .map((c) => {
      const m = c.match(/^(.*?)(\d+)$/)
      return m ? { prefix: m[1], num: Number(m[2]), width: m[2].length } : null
    })
    .filter((x): x is { prefix: string; num: number; width: number } => x !== null)

  if (withNum.length === 0) {
    if (siblingCodes.length > 0) return null // 코드가 있는데 전부 숫자로 안 끝남 — 자동 채번 불가
    const slug = (subcategory ?? 'doc').toUpperCase().replace(/[^A-Z0-9]+/g, '-')
    return `${slug}-01`
  }

  const counts = new Map<string, number>()
  for (const w of withNum) counts.set(w.prefix, (counts.get(w.prefix) ?? 0) + 1)
  let bestPrefix = withNum[0].prefix
  let bestCount = 0
  for (const [p, c] of counts) {
    if (c > bestCount) {
      bestPrefix = p
      bestCount = c
    }
  }
  const matching = withNum.filter((w) => w.prefix === bestPrefix)
  const maxEntry = matching.reduce((a, b) => (b.num > a.num ? b : a))
  return `${bestPrefix}${String(maxEntry.num + 1).padStart(maxEntry.width, '0')}`
}

function todayDate(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/** 새 문서 조회수는 항상 전체 목록 맨 뒤에 붙는다 — 형제 문서들의 order 값을 몰라도 되게 하는 선택이다 */
function tailOrder(): number {
  return 9000 + (Math.floor(Date.now() / 1000) % 90000)
}

function buildMarkdown(input: CreateDocInput, code: string): string {
  const lines = [
    '---',
    `title: ${input.title}`,
    `code: ${code}`,
    `category: ${input.category}`,
    `subcategory: ${input.subcategory ?? 'null'}`,
    'version: 1',
    `updatedBy: ${input.requestedBy}`,
    `updatedAt: ${todayDate()}`,
    'ownerId: ppc-team',
    `scope: ${input.scope}`,
    'parent: null',
    `order: ${tailOrder()}`,
    '---',
    '',
    input.body,
    '',
  ]
  return lines.join('\n')
}

const API = 'https://api.github.com'

async function gh(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'wiki-hub-new-doc',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(`GitHub API 오류 (${res.status}) — ${(detail as { message?: string } | null)?.message ?? res.statusText}`)
  }
  return res.json()
}

/** 파일명은 코드에서 그대로 만든다 — 코드가 유일하므로 파일명도 유일하다 */
const slugify = (code: string) => code.toLowerCase()

export async function createDocPR(
  input: CreateDocInput,
  opts: { token: string; env?: Record<string, string | undefined> },
): Promise<CreateDocResult> {
  const repo = readGithubRepo(opts.env)
  const { token } = opts

  const code = nextCode(input.siblingCodes, input.subcategory)
  if (!code) {
    throw new Error('이 서브메뉴는 문서 코드 체계가 불규칙해 자동으로 새 코드를 만들 수 없습니다')
  }

  const path = `지식/${input.category}/${slugify(code)}.md`
  const content = buildMarkdown(input, code)

  const baseRef = (await gh(`/repos/${repo}/git/ref/heads/main`, token)) as { object: { sha: string } }
  const baseSha = baseRef.object.sha

  const branch = `docs/${slugify(code)}-${Date.now().toString(36)}`
  await gh(`/repos/${repo}/git/refs`, token, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  })

  await gh(`/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, token, {
    method: 'PUT',
    body: JSON.stringify({
      message: `docs: ${code} ${input.title} 추가`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
    }),
  })

  const pr = (await gh(`/repos/${repo}/pulls`, token, {
    method: 'POST',
    body: JSON.stringify({
      title: `새 문서: ${input.title} (${code})`,
      head: branch,
      base: 'main',
      body: [
        `${input.requestedBy}님이 위키 허브 "+"로 새 문서를 요청했습니다.`,
        '',
        `- 카테고리: ${input.category}${input.subcategory ? ` › ${input.subcategory}` : ''}`,
        `- 문서 코드: ${code}`,
        '',
        '내용을 확인하고 이상 없으면 머지해 주세요. 머지되면 다음 배포에서 위키에 반영됩니다.',
      ].join('\n'),
    }),
  })) as { html_url: string }

  return { prUrl: pr.html_url, code, path }
}
