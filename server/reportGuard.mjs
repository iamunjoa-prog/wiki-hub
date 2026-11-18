/**
 * 챗봇 리포트(로컬 claude 실행)에만 붙는 PreToolUse 훅 — WebSearch 검색어·WebFetch 주소를 밖으로 내보내기 전에 검사한다.
 * 서버(server/cliBridge.ts)가 실행마다 임시 settings 파일로 붙이고, 규칙은 환경 변수로 넘긴다:
 *   HUB_REPORT_GUARD_RULES  server/publicCheck.ts searchGuardRules() 의 JSON — 정규식 원문과 정규화한 비공개 이름 목록
 *   HUB_REPORT_GUARD_LOG    호출 기록 파일. 통과한 검색어만 글자로 남기고, 거절한 것은 종류만 남긴다
 *   HUB_REPORT_GUARD_MAX_SEARCH · HUB_REPORT_GUARD_MAX_FETCH  이번 리포트의 호출 횟수 한도
 * 이 파일은 node 로 바로 돌아 TS 를 불러올 수 없다 — 규칙을 두 벌 두지 않으려고 대조만 하고 패턴은 서버에서 받는다.
 * 종료 코드 2 + stderr 면 그 호출만 거절되고 모델은 이유를 받는다. 무엇이든 읽지 못하면 거절한다(닫힌 쪽으로 실패)
 */
import { appendFileSync, readFileSync } from 'node:fs'

const REFUSE_TEXT =
  '검색어에 공개하면 안 되는 표현(금액·제휴사나 사람 이름·가린 이름·문서 코드·사내 시스템 이름)이 있어 거절했습니다. ' +
  '같은 내용을 말을 바꿔 다시 찾지 말고, 이 항목은 한계에 적으세요.'
const ADDRESS_TEXT = 'https 로 시작하는 공개 주소만 열 수 있습니다. 사내망 주소·IP 주소는 열지 않습니다.'
const LIMIT_TEXT = '이번 리포트의 검색 횟수 한도를 넘었습니다. 지금까지 찾은 자료로 정리하세요.'

const logFile = process.env.HUB_REPORT_GUARD_LOG

function log(entry) {
  if (!logFile) return
  try {
    appendFileSync(logFile, `${JSON.stringify(entry)}\n`)
  } catch {
    // 기록을 못 남겨도 검사는 그대로 한다
  }
}

function refuse(tool, kinds, message) {
  log({ tool, ok: false, kinds })
  process.stderr.write(message)
  process.exit(2)
}

/** 사설·내부 주소 — IP 로 적은 주소, 점 없는 사내 호스트, 사내 전용 도메인 끝 */
function badAddress(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return true
  }
  if (url.protocol !== 'https:') return true
  const host = url.hostname.toLowerCase()
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true
  if (!host.includes('.') || host === 'localhost') return true
  return /\.(local|localhost|internal|intranet|corp|lan|home|test)$/.test(host)
}

/** 이번 실행에서 이미 통과한 같은 도구 호출 수 */
function usedCount(tool) {
  if (!logFile) return 0
  try {
    return readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((e) => e.tool === tool && e.ok).length
  } catch {
    return 0
  }
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => (raw += d))
process.stdin.on('end', () => {
  let tool = 'unknown'
  try {
    const event = JSON.parse(raw)
    tool = event.tool_name
    const input = event.tool_input ?? {}
    const rules = JSON.parse(process.env.HUB_REPORT_GUARD_RULES ?? '')
    const fetch = tool === 'WebFetch'
    const text = String((fetch ? input.url : input.query) ?? '').trim()
    if (!text) refuse(tool, ['empty'], REFUSE_TEXT)

    // 주소는 퍼센트 인코딩을 풀어 같은 규칙으로 본다
    let subject = text
    if (fetch) {
      try {
        subject = decodeURIComponent(text)
      } catch {
        subject = text
      }
    }
    const kinds = []
    for (const p of rules.patterns) {
      // 문서 코드·사내 시스템 이름은 검색어 전용 규칙이다 — 공개 페이지 주소에는 걸지 않는다
      if (fetch && (p.kind === 'docCode' || p.kind === 'system')) continue
      if (new RegExp(p.source, p.flags.replace('g', '')).test(subject)) kinds.push(p.kind)
    }
    const norm = subject.toLowerCase().replace(/\s+/g, '')
    if (rules.terms.some((t) => norm.includes(t))) kinds.push('name')
    if (kinds.length) refuse(tool, kinds, REFUSE_TEXT)
    if (fetch && badAddress(text)) refuse(tool, ['address'], ADDRESS_TEXT)

    const limit = Number(fetch ? process.env.HUB_REPORT_GUARD_MAX_FETCH : process.env.HUB_REPORT_GUARD_MAX_SEARCH) || 0
    if (limit && usedCount(tool) >= limit) refuse(tool, ['limit'], LIMIT_TEXT)

    log({ tool, ok: true, text })
    process.exit(0)
  } catch {
    refuse(tool, ['error'], REFUSE_TEXT)
  }
})
