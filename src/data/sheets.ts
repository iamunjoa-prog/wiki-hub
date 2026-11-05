import type { Promotion, Sheet, SheetPlatform } from '../types'

export const gnbList = ['홈', '영화/시리즈', 'TV 방송', '키즈', '스포츠']

/** 편성/스케줄 목록 화면의 플랫폼 구분 (사이드바 트리는 data/scheduleNav.ts) */
export const platformLabel: Record<SheetPlatform, string> = { btv: 'B tv', mobile: '모바일 B tv' }

/** 캠페인 대시보드 › 캠페인 신청 및 캘린더 — 편성/스케줄 › 캠페인의 "상세 보기"가 이동하는 곳 */
export const CAMPAIGN_APP_URL = 'https://pg-apps.skbroadband.com/campaign-dashboard0-v2-4/#calendar'

/** 캠페인 신청 캘린더 데이터(구글 시트 gviz 응답) — 캠페인 대시보드 API가 CORS를 열어 두어 브라우저에서 직접 읽는다 */
export const CAMPAIGN_SHEET_API =
  'https://pg-apps.skbroadband.com/campaign-dashboard0-v2-4/api/applications/sheet?gid=0&tqx=out:json'

export const sheets: Sheet[] = [
  {
    id: 'sh-01',
    name: '홈 9월 편성표',
    type: 'sheet',
    url: 'https://docs.google.com/spreadsheets/d/EXAMPLE-HOME-0926/edit',
    gnb: '홈',
    platform: 'btv',
    ownerId: 'kim',
    ownerName: '김OO',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    description: '홈 GNB 상단 배너 및 큐레이션 열 9월 편성 계획',
    lastCheckedAt: '2026-09-08',
  },
  {
    id: 'sh-02',
    name: '영화/시리즈 편성표',
    type: 'screen',
    url: 'https://intra.example.com/programming/movie-series',
    gnb: '영화/시리즈',
    ownerId: 'park',
    ownerName: '박OO',
    periodStart: '2026-09-10',
    periodEnd: '2026-10-20',
    description: '담당자 자체 개발 편성 화면 (테마 큐레이션 편성 반영)',
    lastCheckedAt: '2026-09-05',
    embedBlocked: true,
  },
  {
    id: 'sh-03',
    name: 'TV 방송 편성표',
    type: 'sheet',
    url: 'https://docs.google.com/spreadsheets/d/EXAMPLE-TV-Q3/edit',
    gnb: 'TV 방송',
    ownerId: 'lee',
    ownerName: '이OO',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    description: 'Q3 실시간 채널 편성 및 특집 편성 일정',
    lastCheckedAt: '2026-08-29',
  },
  {
    id: 'sh-04',
    name: '키즈 편성표',
    type: 'screen',
    url: 'https://intra.example.com/programming/kids',
    gnb: '키즈',
    ownerId: 'choi',
    ownerName: '최OO',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-14',
    description: '키즈 GNB 2주 단위 편성 화면',
    lastCheckedAt: '2026-09-07',
  },
  {
    id: 'sh-05',
    name: '스포츠 특집 편성표',
    type: 'sheet',
    url: 'https://docs.google.com/spreadsheets/d/EXAMPLE-SPORTS/edit',
    gnb: '스포츠',
    ownerId: 'kim',
    ownerName: '김OO',
    periodStart: '2026-09-20',
    periodEnd: '2026-10-10',
    description: '가을 스포츠 특집 중계 편성',
    lastCheckedAt: '2026-09-06',
  },
]

export const initialPromotions: Promotion[] = [
  {
    id: 'pm-01',
    sheetId: 'sh-01',
    sheetName: '홈 9월 편성표',
    targetCategory: null,
    status: 'pending',
    requestedBy: '김OO',
    requestedAt: '2026-09-07',
  },
  {
    id: 'pm-02',
    sheetId: 'sh-04',
    sheetName: '키즈 편성표',
    targetCategory: null,
    status: 'pending',
    requestedBy: '최OO',
    requestedAt: '2026-09-07',
  },
]
