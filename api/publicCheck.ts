import { guardApi, RATE_CHECK } from '../server/guard.js'
import { MAX_PR_BYTES } from '../server/knowledge.js'
import { hitCounts, parsePublicCheckInput, publicLeaks } from '../server/publicCheck.js'

/**
 * 공개 규칙 검사 — 새 문서 제출 전에 화면이 부른다. 아무것도 저장하지 않는다.
 * 배포본은 공유 드라이브의 이름 목록을 읽을 수 없어 namesChecked:false 로 금액·별표 2개·경고만 본다(requests-report.md 13절 R-B).
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로 중계가 쓰인다.
 */

const error = (status: number, message: string) => Response.json({ error: message }, { status })

export async function POST(request: Request): Promise<Response> {
  // 키·토큰을 쓰지 않는 검사라 점검 중에도 닫지 않는다 — 출처·형식·크기·로그인·호출 횟수만 본다
  const guard = await guardApi(request, { maxBytes: MAX_PR_BYTES, rate: RATE_CHECK })
  if (!guard.ok) return guard.response

  try {
    const result = publicLeaks(parsePublicCheckInput(guard.body))
    // 걸린 표기는 로그에 남기지 않는다 — 종류별 건수만
    if (result.blocks.length) console.info(`[api/publicCheck] block ${hitCounts(result.blocks)}`)
    return Response.json(result)
  } catch (err) {
    return error(400, (err as Error).message || '요청 형식이 올바르지 않습니다')
  }
}
