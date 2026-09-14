import type { Category, DocCommit, WikiDoc } from '../types'
import { ppcDocs } from './ppcDocs'

export const categories: Category[] = [
  { id: 'insight', label: '장르별 편성 인사이트' },
  { id: 'marketing', label: '마케팅 정책' },
  { id: 'programming', label: '편성 정책' },
]

export const categoryShort: Record<Category['id'], string> = {
  insight: '인사이트',
  marketing: '마케팅',
  programming: '편성',
}

export const docs: WikiDoc[] = [
  {
    id: 'doc-ins-01',
    path: 'insight/variety.md',
    title: '예능 편성 인사이트',
    category: 'insight',
    code: 'INS-G-01',
    version: 14,
    updatedBy: '김OO',
    updatedAt: '2026-09-02',
    ownerId: 'kim',
    body: `## 요약

예능 장르는 **주중 저녁(19–22시)** 과 **주말 오후** 두 개의 소비 봉우리를 가진다.
신규 유입 캠페인은 주중 봉우리에, 잔존 강화 캠페인은 주말 봉우리에 붙이는 것이 효율이 높다.

## 시간대별 시청 지표

| 시간대 | 재생 점유율 | 신규 유입 기여 | 권장 캠페인 |
| --- | --- | --- | --- |
| 07–12시 | 6% | 낮음 | 미집행 |
| 12–18시 | 14% | 보통 | 잔존 강화 |
| 19–22시 | 48% | **높음** | 신규 유입 |
| 22–02시 | 32% | 보통 | 재방문 유도 |

## 신규 유입 관점 인사이트

- 예능 신규 유입은 **시즌 첫 회 공개 후 7일 이내**에 78%가 발생한다. 캠페인 시작일은 신규 회차 공개일보다 앞서야 한다.
- 예능 신규 시청자는 첫 시청 후 14일 내 재방문하지 않으면 이탈률이 급격히 상승한다. 캠페인 기간은 **최소 3주** 를 확보한다.
- 예능 단독 타겟보다 \`예능 + 리얼리티\` 조합 타겟의 CPI가 약 12% 낮다.

## 9월 시즌 특이사항

9월은 하반기 신규 예능 편성이 집중되는 달이다. 2026년 9월은 9월 15일 주에 신규 3개 타이틀이 동시 공개되므로,
캠페인은 **09/15 시작 – 10/05 종료** 구간이 지표상 가장 유리하다.

> 근거 기간 산정은 [신규 유입 캠페인 기준](MKT-P-03)의 "노출 누적 3주 원칙"과 일치한다.

## 제외 조건

- 청소년 시청 보호 시간대(07–09시) 광고 노출 제외
- 종영 4주 경과 타이틀은 신규 유입 캠페인 소재에서 제외
`,
  },
  {
    id: 'doc-ins-02',
    path: 'insight/drama-season.md',
    title: '드라마 시즌제 편성 사례',
    category: 'insight',
    code: 'INS-G-02',
    version: 8,
    updatedBy: '최OO',
    updatedAt: '2026-08-22',
    ownerId: 'choi',
    body: `## 요약

시즌제 드라마는 **시즌 간 공백 관리**가 잔존율을 좌우한다. 공백이 8주를 넘으면 다음 시즌 첫 주 복귀율이 절반 이하로 떨어진다.

## 사례 비교

| 사례 | 시즌 공백 | 다음 시즌 첫 주 복귀율 |
| --- | --- | --- |
| A 시리즈 | 4주 | 71% |
| B 시리즈 | 9주 | 34% |
| C 시리즈 | 6주 | 58% |

## 운영 원칙

- 시즌 공백이 6주를 넘으면 공백 구간에 **스핀오프 또는 리캡 콘텐츠**를 편성한다.
- 시즌 종료 2주 전부터 다음 시즌 예고를 홈 GNB 상단에 배치한다.
- 드라마 캠페인은 회차 단위가 아니라 **시즌 단위 기간**으로 설정한다.
`,
  },
  {
    id: 'doc-ins-03',
    path: 'insight/movie.md',
    title: '영화 편성 인사이트',
    category: 'insight',
    code: 'INS-G-03',
    version: 5,
    updatedBy: '박OO',
    updatedAt: '2026-08-14',
    ownerId: 'park',
    body: `## 요약

영화는 개별 타이틀 화제성보다 **묶음 큐레이션**의 전환 기여가 크다. 단품 노출 대비 큐레이션 배치 시 재생 전환율이 약 1.6배다.

## 배치 원칙

- 신작 단품은 홈 GNB 최상단 1개 슬롯까지만 사용한다.
- 나머지는 테마 큐레이션(감독/배우/무드) 열로 구성한다.
- 극장 개봉 종료 후 60일 이내 타이틀은 "최신작" 배지를 유지한다.

## 캠페인 연계

영화 장르는 신규 유입보다 **휴면 고객 재방문** 캠페인에서 성과가 좋다.
신규 유입 캠페인을 영화 단독으로 설계하는 것은 권장하지 않는다.
`,
  },
  {
    id: 'doc-pgm-01',
    path: 'programming/weekend.md',
    title: '주말 편성 가이드',
    category: 'programming',
    code: 'PGM-P-02',
    version: 9,
    updatedBy: '박OO',
    updatedAt: '2026-08-27',
    ownerId: 'park',
    body: `## 주말 슬롯 구성

주말은 가족 시청 비중이 높아 **키즈·예능 혼합 편성**을 기본으로 한다.

| 슬롯 | 시간 | 기본 장르 |
| --- | --- | --- |
| 오전 | 08–12시 | 키즈 |
| 오후 | 12–18시 | 예능 / 영화 |
| 저녁 | 18–22시 | 드라마 / 예능 |

## 운영 규칙

- 주말 오후 슬롯은 최소 2주 단위로 고정하고 주중에 변경하지 않는다.
- 연휴 편성은 별도 승인 절차를 따른다.
- 홈 GNB 상단 배너는 주말 시작 24시간 전까지 확정한다.
`,
  },
  {
    id: 'doc-pgm-02',
    path: 'programming/change-approval.md',
    title: '편성 변경 승인 절차',
    category: 'programming',
    code: 'PGM-P-04',
    version: 6,
    updatedBy: '박OO',
    updatedAt: '2026-08-11',
    ownerId: 'park',
    body: `## 적용 범위

확정 편성표 게시 이후의 모든 변경에 적용한다.

## 절차

1. 변경 요청자가 사유와 영향 범위를 작성한다.
2. 편성 담당이 대체 슬롯을 검토한다.
3. 본부 승인 후 편성표와 GNB에 반영한다.

## 긴급 변경

방송 사고·저작권 이슈 등 긴급 사유는 선반영 후 24시간 내 사후 승인을 받는다.
사후 승인이 거절되면 원복한다.
`,
  },
  // 지식/marketing/ppc/ 아래 실제 컨플루언스 이관 문서 (빌드 타임 로드)
  ...ppcDocs,
]

export const docCommits: Record<string, DocCommit[]> = {
  'doc-ins-01': [
    { version: 14, author: '김OO', at: '2026-09-02', message: '9월 시즌 특이사항 추가 (신규 3개 타이틀 동시 공개)' },
    { version: 13, author: '김OO', at: '2026-08-19', message: '시간대별 시청 지표 표 수치 갱신' },
    { version: 12, author: '최OO', at: '2026-07-28', message: '제외 조건에 종영 4주 경과 타이틀 추가' },
  ],
  'doc-mkt-01': [
    { version: 11, author: '이OO', at: '2026-08-25', message: '장르별 표준 예산 표 개정' },
    { version: 10, author: '이OO', at: '2026-08-02', message: '노출 누적 3주 원칙 명문화' },
  ],
}

export const relatedSites = [
  { title: '편성 시스템', desc: '편성표 등록 · 확정', url: 'https://example.com/programming' },
  { title: '캠페인 실행', desc: 'Company A 캠페인 화면', url: 'https://btvcuration.github.io/campaign/' },
  { title: '지표 대시보드', desc: '일별 시청 지표', url: 'https://example.com/metrics' },
  { title: '컨플루언스', desc: '이관 예정 레거시 문서', url: 'https://example.com/wiki' },
]
