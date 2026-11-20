import { accountsEnabled } from '../server/accounts.js'
import {
  chatLogConfig,
  chatLogUsage,
  deleteChatTurn,
  isChatLogId,
  listChatLog,
  listMyChatLog,
  parseChatLogFilter,
} from '../server/chatLog.js'
import { guardApi } from '../server/guard.js'
import { MAX_FORM_BYTES } from '../server/knowledge.js'

/**
 * 챗봇 대화 기록 조회(배포 허브) — 함수 수 제한 때문에 한 파일로 둔다.
 * GET ?view=status(누구나) · mine(본인) · all·usage(관리자), DELETE(관리자, 질문 하나 = 그 시도 전부).
 * 기록은 관리자 화면 밖으로 나가지 않는다 — 한 번에 50건까지만 돌려주고 캐시하지 않는다.
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로가 status 만 답한다.
 */

const NO_STORE = { 'Cache-Control': 'no-store' }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE })
const error = (status: number, message: string) => json({ error: message }, status)

/** 계정 기능이 꺼진 데모 배포는 저장하지 않으므로 볼 것도 없다 */
const OFF_TEXT = '계정 기능이 꺼져 있어 대화 기록을 저장하지 않습니다'

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url, 'http://localhost').searchParams
  const view = params.get('view') ?? 'status'

  if (view === 'status') {
    const guard = await guardApi(request)
    if (!guard.ok) return guard.response
    // mine — 이 허브에서 본인 기록을 볼 수 있나(로그인한 계정이 있고 저장이 켜짐). 화면이 메뉴·고지를 이 값으로 고른다
    const enabled = accountsEnabled()
    return json({ enabled, retentionDays: chatLogConfig().days, where: 'deploy', mine: enabled && Boolean(guard.account) })
  }

  if (view === 'mine') {
    const guard = await guardApi(request)
    if (!guard.ok) return guard.response
    if (!guard.account) return error(404, OFF_TEXT)
    try {
      return json(await listMyChatLog(guard.account.loginId, params.get('cursor') ?? undefined))
    } catch (err) {
      return storeFailed('mine', err)
    }
  }

  if (view === 'all' || view === 'usage') {
    const guard = await guardApi(request, { user: { admin: true } })
    if (!guard.ok) return guard.response
    if (!guard.account) return error(404, OFF_TEXT)
    try {
      return json(view === 'all' ? await listChatLog(parseChatLogFilter(params)) : await chatLogUsage())
    } catch (err) {
      return storeFailed(view, err)
    }
  }

  return error(400, 'view 는 status·mine·all·usage 중 하나여야 합니다')
}

/**
 * 관리자만 지운다(D4) — 고른 기록과 같은 질문(turnId)의 시도를 모두 함께 지운다(ux P-2, 질문 원문이 남지 않게).
 * id 는 쿼리(?id=) 또는 JSON 본문 { id }
 */
export async function DELETE(request: Request): Promise<Response> {
  const guard = await guardApi(request, { user: { admin: true }, maxBytes: MAX_FORM_BYTES })
  if (!guard.ok) return guard.response
  if (!guard.account) return error(404, OFF_TEXT)
  const body = (guard.body ?? {}) as Record<string, unknown>
  const id = new URL(request.url, 'http://localhost').searchParams.get('id') ?? body.id
  if (!isChatLogId(id)) return error(400, '지울 기록 id 가 올바르지 않습니다')
  try {
    const ids = await deleteChatTurn(id)
    console.info(`[api/chatlog] 질문 1개 삭제 — 시도 ${ids.length}건`)
    return json({ ok: true, deleted: ids.length, ids })
  } catch (err) {
    return storeFailed('delete', err)
  }
}

/** 저장소 오류 원문은 함수 로그에만 분류로 — 응답 본문을 로그에 쓰지 않는다 */
function storeFailed(view: string, err: unknown): Response {
  console.error(`[api/chatlog] ${view} 저장소 오류 — ${(err as Error)?.name ?? 'Error'}`)
  return error(502, '대화 기록을 읽지 못했어요. 잠시 뒤 다시 시도해 주세요')
}
