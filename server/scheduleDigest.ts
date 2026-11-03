import { scheduleDays, zoneLabel, SOURCE_SHEET_URL as BTV_SHEET_URL } from '../src/data/btvSchedule'
import { slotsOf } from '../src/lib/btvRail'
import {
  bigBannerDays,
  banners,
  SOURCE_SHEET_URL as BIG_SHEET_URL,
  SCHEDULE_YEAR,
} from '../src/data/bigBannerSchedule'

/**
 * 편성표는 시트를 그대로 옮긴 원본 데이터라 배너 이름이 `labels`/`banners` 풀에
 * 인덱스로만 들어 있다(중복 저장을 피하려고). CLI에 원본 소스를 그대로 넘기면
 * 모델이 그 인덱스를 직접 세다가 틀린 배너를 골라 답하는 사고가 난다(실측 확인됨).
 * 그래서 화면이 쓰는 것과 같은 파싱 함수(`slotsOf`)로 여기서 미리 이름을 풀어
 * 날짜 옆에 바로 적어 준다 — 모델은 셈할 필요 없이 읽기만 하면 된다.
 */
function btvDigest(): string {
  const zones = ['pre', 'lib', 'post'] as const
  const lines = scheduleDays.map((day) => {
    const parts = zones.map((zone) => {
      const slots = slotsOf(day, zone)
      const text = slots.length
        ? slots.map((s) => `${s.name}${s.reach ? `(${s.reach})` : ''}${s.period ? ` ${s.period}` : ''}`).join(' · ')
        : '없음'
      return `${zoneLabel[zone]}: ${text}`
    })
    return `${day.date}(${day.dow}) — ${parts.join(' / ')}`
  })
  return [`## Today B tv 편성표 (출처: ${BTV_SHEET_URL})`, ...lines].join('\n')
}

/** 빅배너는 날짜별 순번을 배너 제목으로 풀고, 카피·태그·랜딩 같은 상세는 별도 목록으로 붙인다 */
function bigBannerDigest(): string {
  const dayLines = bigBannerDays.map((day) => {
    const names = day.slots.map((i, n) => `${n + 1}.${i === -1 ? '(빈칸)' : banners[i].title}`)
    return `${day.date}(${day.dow}) — ${names.join(' · ')}`
  })
  const detailLines = banners.map(
    (b) => `· ${b.title} — 문구: ${b.copy.replace(/\n/g, ' / ')} · 태그: ${b.tags} · 랜딩: ${b.landing} · air 편성: ${b.air}`,
  )
  return [
    `## 모바일 B tv 빅배너 편성표 (${SCHEDULE_YEAR}년, 출처: ${BIG_SHEET_URL})`,
    '### 날짜별 순번',
    ...dayLines,
    '### 배너 상세(카피·태그·랜딩) — 제목으로 찾아 인용한다',
    ...detailLines,
  ].join('\n')
}

let cached: string | null = null

/** 편성표 두 종류를 사람이 읽는 형태로 미리 풀어 하나로 합친다. 데이터는 서버가 뜬 동안 바뀌지 않으므로 한 번만 만든다. */
export function buildScheduleDigest(): string {
  if (cached) return cached
  cached = [btvDigest(), bigBannerDigest()].join('\n\n---\n\n')
  return cached
}
