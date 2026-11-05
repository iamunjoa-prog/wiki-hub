import { readGithubRepo } from './env.js'

/**
 * "새 문서"·"문서 수정" — GitHub REST API로 브랜치를 만들고 마크다운 파일을 추가·수정해 PR을 연다.
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

/** GitHub가 돌려준 오류 — 상태 코드를 들고 있어, 호출한 쪽이 404 같은 경우를 따로 다룰 수 있다 */
export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

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
    throw new GitHubApiError(
      res.status,
      `GitHub API 오류 (${res.status}) — ${(detail as { message?: string } | null)?.message ?? res.statusText}`,
    )
  }
  return res.json()
}

/** 파일명은 코드에서 그대로 만든다 — 코드가 유일하므로 파일명도 유일하다 */
const slugify = (code: string) => code.toLowerCase()

// ── 새 문서·수정 PR이 함께 쓰는 조각 ───────────────────────────────────────────

/** 한글 경로용 — 슬래시는 살린다 */
const encodePath = (path: string) => encodeURIComponent(path).replace(/%2F/g, '/')

/** main의 현재 커밋 SHA */
async function baseSha(repo: string, token: string): Promise<string> {
  const ref = (await gh(`/repos/${repo}/git/ref/heads/main`, token)) as { object: { sha: string } }
  return ref.object.sha
}

async function createBranch(repo: string, token: string, branch: string, sha: string): Promise<void> {
  await gh(`/repos/${repo}/git/refs`, token, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  })
}

/** `sha`(기존 파일의 blob SHA)가 없으면 새 파일, 있으면 그 파일의 수정 커밋이다 — 새 문서와 수정의 유일한 차이 */
async function putFile(
  repo: string,
  token: string,
  file: { path: string; content: string; message: string; branch: string; sha?: string },
): Promise<void> {
  await gh(`/repos/${repo}/contents/${encodePath(file.path)}`, token, {
    method: 'PUT',
    body: JSON.stringify({
      message: file.message,
      content: Buffer.from(file.content, 'utf8').toString('base64'),
      branch: file.branch,
      ...(file.sha ? { sha: file.sha } : {}),
    }),
  })
}

async function openPr(
  repo: string,
  token: string,
  pr: { title: string; head: string; body: string },
): Promise<{ html_url: string; number: number }> {
  return (await gh(`/repos/${repo}/pulls`, token, {
    method: 'POST',
    body: JSON.stringify({ title: pr.title, head: pr.head, base: 'main', body: pr.body }),
  })) as { html_url: string; number: number }
}

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

  const sha = await baseSha(repo, token)

  const branch = `docs/${slugify(code)}-${Date.now().toString(36)}`
  await createBranch(repo, token, branch, sha)

  await putFile(repo, token, { path, content, message: `docs: ${code} ${input.title} 추가`, branch })

  const pr = await openPr(repo, token, {
    title: `새 문서: ${input.title} (${code})`,
    head: branch,
    body: [
      `${input.requestedBy}님이 위키 허브 "+"로 새 문서를 요청했습니다.`,
      '',
      `- 카테고리: ${input.category}${input.subcategory ? ` › ${input.subcategory}` : ''}`,
      `- 문서 코드: ${code}`,
      '',
      '내용을 확인하고 이상 없으면 머지해 주세요. 머지되면 다음 배포에서 위키에 반영됩니다.',
    ].join('\n'),
  })

  return { prUrl: pr.html_url, code, path }
}

// ── 기존 문서 수정 PR ──────────────────────────────────────────────────────────

/** 호출한 쪽이 고쳐서 다시 보낼 수 있는 문제 — API 입구가 상태 코드로 내려 준다 */
export class EditError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message)
    this.name = 'EditError'
  }
}

export interface EditDocInput {
  /** `지식/` 를 뺀 상대 경로 — WikiDoc.path 그대로 */
  docPath: string
  code: string
  title: string
  /** 프론트매터를 뺀 본문 전체 */
  body: string
  /** 승인자가 읽는 수정 사유 — PR 본문에 들어간다 */
  reason: string
  requestedBy: string
  /** 편집을 시작할 때 화면이 보고 있던 버전 */
  baseVersion: number
  /** 어디서 왔는지 — PR 본문에 한 줄로 남긴다 */
  via?: 'propose' | 'chat'
}

export interface EditDocResult {
  prUrl: string
  prNumber: number
  branch: string
  path: string
  /** 새로 올라간 버전 */
  version: number
}

const MAX_REASON = 2_000

export function parseEditDocInput(raw: unknown): EditDocInput {
  const r = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const oneLine = (v: unknown) => str(v).replace(/[\r\n]+/g, ' ').trim()

  const docPath = str(r.docPath).trim()
  if (!docPath || !docPath.endsWith('.md') || docPath.startsWith('/') || docPath.includes('\\') || docPath.split('/').includes('..'))
    throw new EditError(400, '문서 경로가 올바르지 않습니다')
  const code = str(r.code).trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(code)) throw new EditError(400, '문서 코드가 올바르지 않습니다')
  const title = oneLine(r.title)
  if (!title) throw new EditError(400, '제목이 비어 있습니다')
  if (title.length > MAX_TITLE) throw new EditError(400, `제목은 ${MAX_TITLE}자 이내로 입력해 주세요`)

  const body = str(r.body).replace(/\r\n?/g, '\n')
  if (!body.trim()) throw new EditError(400, '본문이 비어 있습니다')
  if (body.length > MAX_BODY) throw new EditError(400, '본문이 너무 깁니다')
  // 프론트매터는 서버가 main 파일에서 가져와 다시 쓴다 — 본문에 --- 블록이 오면 지어낸 것이다
  if (/^\s*---\s*\n/.test(body)) throw new EditError(400, '본문에 프론트매터(--- 블록)가 들어 있습니다. 본문만 보내 주세요')

  const reason = str(r.reason).replace(/\r\n?/g, '\n').trim()
  if (!reason) throw new EditError(400, '수정 사유가 비어 있습니다')
  if (reason.length > MAX_REASON) throw new EditError(400, `수정 사유는 ${MAX_REASON}자 이내로 입력해 주세요`)

  const baseVersion = Number(r.baseVersion)
  if (!Number.isInteger(baseVersion) || baseVersion < 1) throw new EditError(400, '기준 버전이 올바르지 않습니다')

  return {
    docPath,
    code,
    title,
    body,
    reason,
    requestedBy: oneLine(r.requestedBy) || '알 수 없음',
    baseVersion,
    via: r.via === 'chat' ? 'chat' : 'propose',
  }
}

/**
 * 파일을 프론트매터와 본문으로 가른다. 정규식은 src/data/knowledgeDocs.ts 의 parseFrontmatter 와
 * 같아야 한다 — 둘이 갈라지면 화면이 보는 본문과 서버가 쓰는 본문이 어긋난다.
 * `gap` 은 닫는 `---` 와 본문 사이의 빈 줄 — 원문 그대로 되돌려 쓰려고 따로 들고 있다.
 */
export function splitFrontmatter(source: string): {
  fm: string
  gap: string
  body: string
  values: Record<string, string>
  crlf: boolean
} {
  const crlf = source.includes('\r\n')
  const raw = source.replace(/\r\n?/g, '\n')
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { fm: '', gap: '', body: raw, values: {}, crlf }
  const [, fm, rest] = match
  const gap = rest.match(/^\n*/)![0]
  const values: Record<string, string> = {}
  for (const line of fm.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    values[m[1]] = value
  }
  return { fm, gap, body: rest.slice(gap.length), values, crlf }
}

/**
 * 프론트매터 블록을 **줄 단위로** 복사하고 version·updatedBy·updatedAt 세 줄만 바꾼다.
 * YAML 로 파싱해 다시 쓰지 않는 이유 — `systems: [CBS, ACS]`·`source: "…"` 같은 값과 따옴표·키 순서가
 * 재배치되면 diff 가 문서 전체로 번진다. code·category·order·parent 는 절대 건드리지 않는다.
 */
export function bumpFrontmatter(
  fm: string,
  opts: { updatedBy: string; today: string },
): { fm: string; version: number } {
  const lines = fm.split('\n')
  const keyIndex = (key: string) => lines.findIndex((l) => new RegExp(`^${key}:`).test(l))

  const versionAt = keyIndex('version')
  const current = versionAt >= 0 ? Number(lines[versionAt].replace(/^version:\s*/, '').replace(/^"|"$/g, '').trim()) || 1 : 1
  const version = current + 1

  const set = (key: string, value: string) => {
    const at = keyIndex(key)
    if (at >= 0) lines[at] = `${key}: ${value}`
    else lines.push(`${key}: ${value}`)
  }
  set('version', String(version))
  set('updatedBy', opts.updatedBy.replace(/[\r\n]+/g, ' ').trim())
  set('updatedAt', opts.today)
  return { fm: lines.join('\n'), version }
}

/** 한국 시간 기준 오늘 — 배포 서버는 UTC 라 자정 무렵에 하루 어긋나지 않게 한다 */
function todayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
}

export async function createEditPR(
  input: EditDocInput,
  opts: { token: string; env?: Record<string, string | undefined> },
): Promise<EditDocResult> {
  const repo = readGithubRepo(opts.env)
  const { token } = opts
  const path = `지식/${input.docPath}`

  // main 의 한 커밋에 고정해 읽는다 — 읽는 사이에 main 이 움직여도 blob SHA 와 브랜치 기준이 어긋나지 않는다
  const sha = await baseSha(repo, token)

  let file: { sha: string; content?: string; encoding?: string }
  try {
    file = (await gh(`/repos/${repo}/contents/${encodePath(path)}?ref=${sha}`, token)) as typeof file
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) throw new EditError(404, `그 문서를 저장소에서 찾지 못했습니다 (${path})`)
    throw err
  }
  if (!file.sha || file.encoding !== 'base64' || typeof file.content !== 'string')
    throw new Error(`저장소의 ${path} 를 읽지 못했습니다 (문서가 아니거나 너무 큽니다)`)

  const current = splitFrontmatter(Buffer.from(file.content, 'base64').toString('utf8'))
  if (!current.fm) throw new Error(`저장소의 ${path} 에 프론트매터가 없습니다`)
  if (current.values.code !== input.code)
    throw new EditError(400, `문서 코드가 맞지 않습니다 (저장소: ${current.values.code ?? '없음'}, 요청: ${input.code})`)

  // 최신성 — 화면의 본문은 배포 당시 번들이다. 머지는 됐지만 아직 재배포 전이면, 이 제안이 남의 수정을 되돌린다
  const mainVersion = Number(current.values.version) || 1
  if (mainVersion !== input.baseVersion)
    throw new EditError(409, `이 문서는 그 사이 v${mainVersion}으로 바뀌었습니다. 문서를 다시 열어 수정해 주세요`)

  if (/^\s*---\s*\n/.test(input.body)) throw new EditError(400, '본문에 프론트매터(--- 블록)가 들어 있습니다. 본문만 보내 주세요')
  const body = input.body.replace(/\r\n?/g, '\n').replace(/\s*$/, '')
  if (body === current.body.replace(/\s*$/, '')) throw new EditError(400, '저장소의 현재 본문과 같습니다. 변경 사항이 없습니다')

  const bumped = bumpFrontmatter(current.fm, { updatedBy: input.requestedBy, today: todayKst() })
  let content = `---\n${bumped.fm}\n---\n${current.gap}${body}\n`
  if (current.crlf) content = content.replace(/\n/g, '\r\n')

  // 제안마다 새 브랜치 — 문서당 하나로 고정하면 두 번째 제안이 첫 제안 위에 덮어써서 조용히 삼킨다
  const branch = `docs/edit-${slugify(input.code)}-${Date.now().toString(36)}`
  await createBranch(repo, token, branch, sha)
  await putFile(repo, token, {
    path,
    content,
    message: `docs: ${input.code} ${input.title} 수정`,
    branch,
    sha: file.sha,
  })

  const pr = await openPr(repo, token, {
    title: `문서 수정: ${input.title} (${input.code})`,
    head: branch,
    body: [
      `${input.requestedBy}님이 위키 허브에서 문서 수정을 제안했습니다.`,
      '',
      `- 문서: ${input.title} (${input.code})`,
      `- 경로: ${path}`,
      `- 버전: v${input.baseVersion} → v${bumped.version}`,
      `- 진입: ${input.via === 'chat' ? '챗봇 대화' : '수정 제안 화면'}`,
      '',
      '## 수정 사유',
      '',
      input.reason,
      '',
      '내용을 확인하고 이상 없으면 머지해 주세요. 머지되면 다음 배포에서 위키에 반영됩니다.',
    ].join('\n'),
  })

  return { prUrl: pr.html_url, prNumber: pr.number, branch, path, version: bumped.version }
}

// ── 제안 목록 (진실의 원천은 GitHub PR) ───────────────────────────────────────

export interface ProposalPr {
  prNumber: number
  prUrl: string
  kind: 'new' | 'edit'
  docCode: string | null
  docTitle: string
  reason: string
  requestedBy: string
  status: 'pending' | 'approved' | 'rejected'
  requestedAt: string
}

interface PullJson {
  number?: number
  html_url?: string
  title?: string
  body?: string | null
  state?: string
  merged_at?: string | null
  created_at?: string
  head?: { ref?: string }
}

const PR_FOOTER = '내용을 확인하고 이상 없으면 머지해 주세요.'

/**
 * PR JSON → 제안. 허브가 만든 PR 만 읽는다(브랜치가 `docs/` 로 시작).
 * PR 본문의 형식을 못 읽으면 추측해 채우지 않고 빈 값으로 둔다 — 화면은 "PR에서 확인"으로 떨어진다.
 */
export function parseProposalPr(pr: PullJson): ProposalPr | null {
  const ref = pr.head?.ref ?? ''
  if (!ref.startsWith('docs/') || typeof pr.number !== 'number' || !pr.html_url) return null
  const kind: ProposalPr['kind'] = ref.startsWith('docs/edit-') ? 'edit' : 'new'
  const text = (pr.body ?? '').replace(/\r\n?/g, '\n')

  const requestedBy = text.split('\n', 1)[0].match(/^(.+?)님이 /)?.[1].trim() ?? ''

  let docCode: string | null = null
  let docTitle = ''
  if (kind === 'edit') {
    const m = text.match(/^- 문서: (.+) \(([A-Za-z0-9-]+)\)\s*$/m)
    if (m) {
      docTitle = m[1]
      docCode = m[2]
    }
  } else {
    docCode = text.match(/^- 문서 코드: ([A-Za-z0-9-]+)\s*$/m)?.[1] ?? null
    docTitle = (pr.title ?? '').match(/^새 문서: (.+) \([A-Za-z0-9-]+\)$/)?.[1] ?? ''
  }
  if (!docTitle) docTitle = pr.title ?? ''

  let reason = ''
  const at = text.indexOf('## 수정 사유\n')
  if (at >= 0) {
    const rest = text.slice(at + '## 수정 사유\n'.length)
    const end = rest.lastIndexOf(PR_FOOTER)
    reason = (end >= 0 ? rest.slice(0, end) : rest).trim()
  }

  return {
    prNumber: pr.number,
    prUrl: pr.html_url,
    kind,
    docCode,
    docTitle,
    reason,
    requestedBy,
    status: pr.merged_at ? 'approved' : pr.state === 'open' ? 'pending' : 'rejected',
    requestedAt: (pr.created_at ?? '').slice(0, 10),
  }
}

/** 최근 갱신순 50건 중 허브가 만든 PR — 화면이 렌더마다 부르지 않게, 호출은 진입 시 1회 + 수동 새로고침 */
export async function listProposalPrs(opts: {
  token: string
  env?: Record<string, string | undefined>
}): Promise<ProposalPr[]> {
  const repo = readGithubRepo(opts.env)
  const pulls = (await gh(`/repos/${repo}/pulls?state=all&per_page=50&sort=updated&direction=desc`, opts.token)) as PullJson[]
  return pulls.map(parseProposalPr).filter((p): p is ProposalPr => p !== null)
}
