import type { Proposal, Promotion, Sheet, SystemEntry, SystemRequest, WikiDoc } from '../types.js'

/**
 * 요청·승인 기록 — 문서 수정 제안, 편성표 등록·승격 요청, 시스템 등록 요청과 그 승인 결과.
 *
 * 배포 허브는 이 기록을 공용 저장소(Upstash Redis, /api/records)에 쌓아 담당자 모두가 같은 기록을 본다.
 * 저장소가 없으면(로컬 허브·설정 전 배포) 같은 규칙으로 메모리에서만 돈다.
 * 서버와 화면이 같은 규칙을 쓰도록 이 파일은 타입 말고는 아무것도 가져오지 않는다.
 */

/** 승인된 문서 수정 — git 커밋이 배포되기 전까지 화면에 먼저 보여 주는 덧씌움 */
export interface DocEdit {
  body: string
  /** 이 수정이 만든 버전. 배포된 문서 버전이 이보다 같거나 높으면 덧씌우지 않는다 */
  version: number
  updatedBy: string
  updatedAt: string
  /** git에 커밋됐으면 그 커밋 주소 */
  commitUrl?: string
}

export interface HubRecords {
  proposals: Record<string, Proposal>
  promotions: Record<string, Promotion>
  /** 담당자가 등록한 편성표 (코드에 있는 기본 편성표는 따로) */
  sheets: Record<string, Sheet>
  /** { 문서 id: 승인된 수정 } */
  docEdits: Record<string, DocEdit>
  /** 승격 승인으로 생긴 요약 문서 */
  addedDocs: Record<string, WikiDoc>
  systemRequests: Record<string, SystemRequest>
  /** { 시스템 id: 승인된 접속 주소 } */
  systemUrls: Record<string, string>
  /** 승인되어 목록에 추가된 시스템 */
  addedSystems: Record<string, SystemEntry>
}

export type Collection = keyof HubRecords

export const COLLECTIONS: Collection[] = [
  'proposals',
  'promotions',
  'sheets',
  'docEdits',
  'addedDocs',
  'systemRequests',
  'systemUrls',
  'addedSystems',
]

export const emptyRecords = (): HubRecords => ({
  proposals: {},
  promotions: {},
  sheets: {},
  docEdits: {},
  addedDocs: {},
  systemRequests: {},
  systemUrls: {},
  addedSystems: {},
})

type Decision = 'approved' | 'rejected'

export type RecordAction =
  | { kind: 'proposal.submit'; proposal: Proposal }
  /**
   * 승인이면 edit(새 본문·버전)과 문서 파일 경로를 함께 넘긴다.
   * 서버는 경로로 파일을 찾아 git에 커밋하고, edit 는 커밋 결과로 다시 만든다.
   */
  | { kind: 'proposal.decide'; id: string; decision: Decision; reason?: string; edit?: DocEdit; path?: string }
  | { kind: 'promotion.request'; promotion: Promotion }
  /** 승인이면 만들 요약 문서를 함께 넘긴다 */
  | { kind: 'promotion.decide'; id: string; decision: Decision; reason?: string; doc?: WikiDoc }
  | { kind: 'sheet.add'; sheet: Sheet }
  | { kind: 'system.request'; request: SystemRequest }
  | { kind: 'system.decide'; id: string; decision: Decision; reason?: string }

/** 기록 하나를 고치는 단위 — 서버는 이것만 저장소에 쓴다 */
export interface RecordWrite {
  collection: Collection
  id: string
  value: unknown
}

/**
 * 동작이 바꿀 기록을 계산한다. 규칙에 맞지 않으면 이유를 담아 던진다.
 * 같은 기록을 두 번 처리하거나, 이미 대기 중인 요청을 또 올리는 것을 여기서 막는다.
 */
export function recordWrites(state: HubRecords, action: RecordAction): RecordWrite[] {
  switch (action.kind) {
    case 'proposal.submit': {
      if (state.proposals[action.proposal.id]) throw new Error('이미 있는 요청입니다')
      return [{ collection: 'proposals', id: action.proposal.id, value: action.proposal }]
    }
    case 'proposal.decide': {
      const target = pending(state.proposals[action.id])
      const writes: RecordWrite[] = [
        { collection: 'proposals', id: action.id, value: { ...target, status: action.decision, rejectReason: action.reason } },
      ]
      if (action.decision === 'approved' && action.edit) {
        writes.push({ collection: 'docEdits', id: target.docId, value: action.edit })
      }
      return writes
    }
    case 'promotion.request': {
      const p = action.promotion
      if (state.promotions[p.id]) throw new Error('이미 있는 요청입니다')
      if (Object.values(state.promotions).some((x) => x.sheetId === p.sheetId && x.status === 'pending')) {
        throw new Error('이미 승격 요청이 대기 중입니다')
      }
      return [{ collection: 'promotions', id: p.id, value: p }]
    }
    case 'promotion.decide': {
      const target = pending(state.promotions[action.id])
      const writes: RecordWrite[] = [
        {
          collection: 'promotions',
          id: action.id,
          value: {
            ...target,
            status: action.decision,
            rejectReason: action.reason,
            targetCategory: action.doc?.category ?? null,
          },
        },
      ]
      if (action.decision === 'approved' && action.doc) {
        writes.push({ collection: 'addedDocs', id: action.doc.id, value: action.doc })
      }
      return writes
    }
    case 'sheet.add': {
      if (state.sheets[action.sheet.id]) throw new Error('이미 있는 편성표입니다')
      return [{ collection: 'sheets', id: action.sheet.id, value: action.sheet }]
    }
    case 'system.request': {
      const r = action.request
      if (state.systemRequests[r.id]) throw new Error('이미 있는 요청입니다')
      if (
        r.targetSystemId &&
        Object.values(state.systemRequests).some((x) => x.targetSystemId === r.targetSystemId && x.status === 'pending')
      ) {
        throw new Error('이미 주소 등록 요청이 대기 중입니다')
      }
      return [{ collection: 'systemRequests', id: r.id, value: r }]
    }
    case 'system.decide': {
      const target = pending(state.systemRequests[action.id])
      const writes: RecordWrite[] = [
        { collection: 'systemRequests', id: action.id, value: { ...target, status: action.decision, rejectReason: action.reason } },
      ]
      if (action.decision !== 'approved') return writes
      // 주소만 채우는 요청과 새 시스템을 나눠 담는다
      if (target.targetSystemId) {
        writes.push({ collection: 'systemUrls', id: target.targetSystemId, value: target.url })
      } else {
        const added: SystemEntry = {
          id: target.id,
          name: target.name,
          desc: target.desc,
          url: target.url || undefined,
          access: target.access,
          group: target.group,
        }
        writes.push({ collection: 'addedSystems', id: target.id, value: added })
      }
      return writes
    }
  }
}

function pending<T extends { status: string }>(target: T | undefined): T {
  if (!target) throw new Error('없는 요청입니다')
  if (target.status !== 'pending') throw new Error('이미 처리된 요청입니다')
  return target
}

export function applyWrites(state: HubRecords, writes: RecordWrite[]): HubRecords {
  const next = { ...state }
  for (const w of writes) {
    next[w.collection] = { ...next[w.collection], [w.id]: w.value } as never
  }
  return next
}

/** 요청 목록은 최근 것이 위로 — 같은 날이면 나중에 만든 id가 위로 */
export function newestFirst<T extends { id: string; requestedAt: string }>(items: Record<string, T>): T[] {
  return Object.values(items).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id))
}

/**
 * 코드(지식/ 폴더)에서 읽은 문서에 승인된 수정과 승격 문서를 얹는다.
 * git 커밋이 배포되면 문서 버전이 따라 올라와 덧씌움은 저절로 빠진다.
 */
export function mergeDocs(seed: WikiDoc[], records: HubRecords): WikiDoc[] {
  const docs = seed.map((d) => {
    const edit = records.docEdits[d.id]
    return edit && edit.version > d.version
      ? { ...d, body: edit.body, version: edit.version, updatedBy: edit.updatedBy, updatedAt: edit.updatedAt }
      : d
  })
  const codes = new Set(seed.map((d) => d.code))
  const added = Object.values(records.addedDocs).filter((d) => !codes.has(d.code))
  return [...docs, ...added]
}

/* ── 화면 쪽 창구 ───────────────────────────────────────── */

/** 공용 저장소의 기록. 저장소가 없으면(로컬 허브·설정 전 배포) null — 화면은 메모리로 돈다 */
export async function fetchRecords(): Promise<HubRecords | null> {
  try {
    const res = await fetch('/api/records')
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return null
    return ((await res.json()) as { records: HubRecords }).records
  } catch {
    return null
  }
}

/** 동작 하나를 저장소에 반영하고, 반영된 전체 기록과 알림 문구를 돌려받는다 */
export async function postRecordAction(action: RecordAction): Promise<{ records: HubRecords; notice?: string }> {
  const res = await fetch('/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  })
  const data = (await res.json().catch(() => ({}))) as { records?: HubRecords; notice?: string; error?: string }
  if (!res.ok || !data.records) throw new Error(data.error || `HTTP ${res.status}`)
  return { records: data.records, notice: data.notice }
}
