import { accountsEnabled } from '../server/accounts.js'
import { requireUser, sameOrigin } from '../server/auth.js'
import { applyAction, loadRecords } from '../server/records.js'
import type { RecordAction } from '../src/lib/records.js'

/**
 * 요청·승인 기록 — GET 전체 기록, POST 동작 하나(요청·승인·반려·편성표 등록).
 * 계정 기능이 꺼진 배포면 404 — 화면은 메모리 상태로 동작한다.
 */

const error = (status: number, message: string) => Response.json({ error: message }, { status })

export async function GET(request: Request): Promise<Response> {
  if (!accountsEnabled()) return error(404, '공용 저장소가 꺼져 있습니다')
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  try {
    return Response.json({ records: await loadRecords() })
  } catch (err) {
    console.error('[api/records]', err)
    return error(502, (err as Error).message)
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!accountsEnabled()) return error(404, '공용 저장소가 꺼져 있습니다')
  if (!sameOrigin(request)) return error(403, '허용되지 않은 요청입니다')
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response

  let action: RecordAction
  try {
    action = (await request.json()) as RecordAction
  } catch {
    return error(400, '요청 형식이 올바르지 않습니다')
  }

  try {
    return Response.json(await applyAction(action, auth.account!))
  } catch (err) {
    console.error('[api/records]', err)
    return error(400, (err as Error).message)
  }
}
