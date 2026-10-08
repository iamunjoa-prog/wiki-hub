import type { Account } from './accounts.js'
import { readGithubToken } from './env.js'
import { commitDocEdit, commitNewDoc } from './github.js'
import { redisPipeline } from './redis.js'
import {
  COLLECTIONS,
  applyWrites,
  emptyRecords,
  recordWrites,
  type DocEdit,
  type HubRecords,
  type RecordAction,
} from '../src/lib/records.js'

/**
 * 요청·승인 기록 저장 — 모음(collection)마다 Redis 해시 하나, 기록 하나가 필드 하나다.
 * 기록을 하나씩 따로 쓰므로 두 사람이 동시에 다른 요청을 올려도 서로 덮지 않는다.
 *
 * 화면이 보낸 동작을 그대로 믿지 않는다 — 요청자 이름은 로그인 계정에서, 승인은 관리자만,
 * 문서 수정 승인은 git 커밋 결과로 다시 만든다.
 */

const keyOf = (c: string) => `hub:rec:${c}`

export async function loadRecords(): Promise<HubRecords> {
  const results = await redisPipeline<string[]>(COLLECTIONS.map((c) => ['HGETALL', keyOf(c)]))
  const records = emptyRecords()
  COLLECTIONS.forEach((c, i) => {
    const flat = results[i] ?? []
    const map: Record<string, unknown> = {}
    for (let j = 0; j + 1 < flat.length; j += 2) map[flat[j]] = JSON.parse(flat[j + 1])
    records[c] = map as never
  })
  return records
}

const today = () => new Date().toISOString().slice(0, 10)

const MAX_BODY = 50_000

export interface ApplyResult {
  records: HubRecords
  /** 화면에 덧붙여 알릴 말 — git 커밋 주소나, git에 반영하지 못한 이유 */
  notice?: string
}

/** 동작 하나를 검사하고 저장한다. 규칙에 맞지 않으면 이유를 담아 던진다 */
export async function applyAction(raw: RecordAction, account: Account): Promise<ApplyResult> {
  const state = await loadRecords()
  const action = authorize(raw, account)
  // 규칙(대기 중인 요청인지 등)을 git 커밋보다 먼저 확인한다 — 이미 처리된 요청으로 커밋이 생기지 않게
  recordWrites(state, action)
  let notice: string | undefined

  // 문서를 바꾸는 승인은 git에 먼저 커밋한다 — 커밋이 실패하면 승인도 하지 않는다
  if (action.kind === 'proposal.decide' && action.decision === 'approved') {
    const proposal = state.proposals[action.id]
    const synced = await syncProposal(proposal, account, state.docEdits[proposal.docId], action.path)
    action.edit = synced.edit
    notice = synced.notice
  }
  if (action.kind === 'promotion.decide' && action.decision === 'approved' && action.doc) {
    notice = await syncPromotion(action.doc, account)
  }

  const writes = recordWrites(state, action)
  await redisPipeline(writes.map((w) => ['HSET', keyOf(w.collection), w.id, JSON.stringify(w.value)]))
  return { records: applyWrites(state, writes), notice }
}

/** 요청자·승인 권한을 로그인 계정 기준으로 다시 채운다 */
/** 지식/ 아래 "카테고리/파일.md" 모양만 받는다 — 다른 경로의 파일을 고치지 못하게 한다 */
const isDocPath = (path: string) => /^[a-z-]+\/[A-Za-z0-9._-]+\.md$/.test(path) && !path.includes('..')

function authorize(action: RecordAction, account: Account): RecordAction {
  const by = { requestedBy: account.name, requestedAt: today(), status: 'pending' as const }
  const isDecision = action.kind.endsWith('.decide')
  if (isDecision && account.role !== 'admin') throw new Error('관리자만 승인·반려할 수 있습니다')

  switch (action.kind) {
    case 'proposal.submit': {
      const p = action.proposal
      if (typeof p.newBody !== 'string' || p.newBody.length > MAX_BODY) throw new Error('본문이 너무 깁니다')
      return { ...action, proposal: { ...p, ...by, rejectReason: undefined } }
    }
    case 'promotion.request':
      return { ...action, promotion: { ...action.promotion, ...by, targetCategory: null, rejectReason: undefined } }
    case 'system.request':
      return { ...action, request: { ...action.request, ...by, rejectReason: undefined } }
    case 'sheet.add':
      return { ...action, sheet: { ...action.sheet, ownerId: account.loginId, ownerName: account.name, lastCheckedAt: today() } }
    case 'proposal.decide':
      // edit 는 서버가 git 커밋 뒤에 다시 만든다
      if (action.path !== undefined && !isDocPath(action.path)) throw new Error('문서 경로가 올바르지 않습니다')
      return { ...action, edit: undefined }
    case 'promotion.decide': {
      if (action.decision !== 'approved') return { ...action, doc: undefined }
      if (!action.doc?.category) throw new Error('승격할 카테고리를 골라 주세요')
      if (!isDocPath(action.doc.path)) throw new Error('문서 경로가 올바르지 않습니다')
      return { ...action, doc: { ...action.doc, updatedBy: account.name, updatedAt: today(), version: 1 } }
    }
    case 'system.decide':
      return action
  }
}

/** 수정 제안 승인을 git에 커밋한다. GitHub 토큰이 없으면 허브 화면에만 반영하고 그 사실을 알린다 */
async function syncProposal(
  proposal: HubRecords['proposals'][string],
  account: Account,
  previous: DocEdit | undefined,
  path: string | undefined,
): Promise<{ edit: DocEdit; notice?: string }> {
  const base: DocEdit = {
    body: proposal.newBody,
    version: Math.max(previous?.version ?? 0, proposal.baseVersion) + 1,
    updatedBy: proposal.requestedBy,
    updatedAt: today(),
  }
  const token = readGithubToken()
  if (!token || !path) {
    return { edit: base, notice: 'GitHub 토큰이 없어 git에는 반영하지 않았습니다 — 허브 화면에만 보입니다' }
  }
  const result = await commitDocEdit(
    {
      path,
      body: proposal.newBody,
      updatedBy: proposal.requestedBy,
      message: `docs: ${proposal.docId} 수정 — ${proposal.reason || '수정 제안 승인'}\n\n요청 ${proposal.requestedBy} · 승인 ${account.name} (위키 허브)`,
    },
    { token },
  )
  return { edit: { ...base, version: result.version, commitUrl: result.commitUrl }, notice: 'git에 커밋했습니다' }
}

async function syncPromotion(doc: NonNullable<Extract<RecordAction, { kind: 'promotion.decide' }>['doc']>, account: Account) {
  const token = readGithubToken()
  if (!token) return 'GitHub 토큰이 없어 git에는 반영하지 않았습니다 — 허브 화면에만 보입니다'
  await commitNewDoc(
    {
      path: doc.path,
      title: doc.title,
      code: doc.code,
      category: doc.category,
      updatedBy: account.name,
      ownerId: doc.ownerId,
      body: doc.body,
      message: `docs: ${doc.code} ${doc.title} 추가 — 편성표 승격\n\n승인 ${account.name} (위키 허브)`,
    },
    { token },
  )
  return 'git에 커밋했습니다'
}
