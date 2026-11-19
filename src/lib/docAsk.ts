/**
 * 이 문서로 질문 — 위키 문서 화면에서 챗봇에 그 문서를 근거로 묻는 칩·접두어.
 * 보내는 문장에는 문서 코드만 넣는다. 제목은 `문서`·`수정`·`기획`·`한눈에` 같은 대화 판별 단어에 걸려
 * 위키 수정 안내·진행 확인·리포트로 빠지므로 사람에게 보이는 자리(패널 표시 줄·via)에만 둔다.
 */

/** 칩 = 보내는 문장. 뒷부분도 판별 단어를 쓰지 않게 골랐다 — `짧게` 는 리포트로 넘어가지 않게 하는 짧은 답 신호 */
export const docAskChips = (code: string): string[] => [
  `${code} 핵심만 짧게 알려줘`,
  `${code} 기준으로 실무에서 놓치기 쉬운 점 알려줘`,
]

/** 패널이 열린 채 입력창에서 보낼 때 앞에 붙는 글자 */
export const docAskPrefix = (code: string) => `${code} 기준으로`

/** 직접 입력 전송 문장 — 이미 그 코드로 시작하면 다시 붙이지 않는다 */
export const docAskSentence = (code: string, text: string) =>
  text.startsWith(code) ? text : `${docAskPrefix(code)} ${text}`

/** 사용자 말풍선 위에 작게 보이는 이름 — 말풍선에는 코드만 보이니 제목으로 보완한다 */
export const docAskVia = (title: string) => `이 문서로 질문 · ${title}`

export const docAskPlaceholder = (code: string) => `${code}에서 궁금한 점을 쓰세요`

export const docAskHint = (code: string) => `입력창에 쓰면 앞에 "${docAskPrefix(code)}"를 붙여 보냅니다`
