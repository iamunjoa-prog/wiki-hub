// 대시보드 "이번 주 업데이트" 세는 규칙 — PC 시간대와 상관없이 한국 시간 이번 주 월요일 ~ 오늘

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 오늘(KST) YYYY-MM-DD — en-CA 형식이 YYYY-MM-DD 로 나온다 */
export const kstDate = (now: Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

/** 해당 날짜가 속한 주의 월요일 YYYY-MM-DD (일요일은 6일 전) */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d)
  const dow = new Date(t).getUTCDay()
  const back = dow === 0 ? 6 : dow - 1
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10)
}

/** 월요일 ≤ updatedAt ≤ 오늘 인 문서 수. '-'·빈 값·날짜 꼴이 아닌 값·미래 날짜(오타)는 세지 않는다 */
export function countWeeklyUpdates(dates: readonly string[], today: string): number {
  const monday = mondayOf(today)
  return dates.filter((v) => DATE_RE.test(v) && v >= monday && v <= today).length
}

/** 보조 줄 "11/16(월)부터" — 앞자리 0 없이 */
export function weekStartLabel(today: string): string {
  const [, m, d] = mondayOf(today).split('-').map(Number)
  return `${m}/${d}(월)부터`
}
