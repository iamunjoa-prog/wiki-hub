import { guardApi } from '../server/guard.js'
import { getSchedule, isScheduleKind, scheduleErrorBody } from '../server/scheduleSource.js'

/**
 * 편성표 실시간 조회 — GET /api/schedule?kind=btv|bigbanner. 시트 주소는 HUB_BTV_SHEET_URL·HUB_BIGBANNER_SHEET_URL.
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로 중계가 쓰인다.
 * 시트 캐시(5분)는 함수 인스턴스 메모리에 있어 인스턴스가 바뀌면 다시 받는다.
 */

export async function GET(request: Request): Promise<Response> {
  // 제휴 배너 이름·모수가 담긴 내부 편성표라 운영에서 계정 기능이 꺼지면 닫고, 다른 사이트가 부르지 못하게 한다
  const guard = await guardApi(request, { paid: true })
  if (!guard.ok) return guard.response

  const params = new URL(request.url, 'http://localhost').searchParams
  const kind = params.get('kind')
  if (!isScheduleKind(kind)) return Response.json({ error: 'kind 는 btv 또는 bigbanner 여야 합니다' }, { status: 400 })

  try {
    // ?fresh=1 — 새로고침 버튼. 캐시를 건너뛰되 최소 간격(20초)은 scheduleSource 가 지킨다
    return Response.json(await getSchedule(kind, process.env, new Date(), { fresh: params.get('fresh') === '1' }))
  } catch (err) {
    const { status, body } = scheduleErrorBody(err)
    console.error(`[api/schedule] ${kind} ${body.error}`)
    return Response.json(body, { status })
  }
}
