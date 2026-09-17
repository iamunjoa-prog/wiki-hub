import type { Category, DocCommit, Subcategory, WikiDoc } from '../types'
import { knowledgeDocs } from './knowledgeDocs'

/**
 * 위키 문서 1단 메뉴.
 * 시스템 매뉴얼(ACS·CBS·Swing)은 프로모션 > 시스템 매뉴얼로 옮겨서, 여기(1단 메뉴)에는
 * 더 이상 '시스템'을 따로 두지 않는다 — `categoryShort`·`subcategories`에는 남겨 두어
 * CategoryId 타입과 과거 문서가 깨지지 않게 한다. 시스템 접속 주소·즐겨찾기는 별도로
 * /systems 화면(사이드바 '시스템' 링크)에서 다룬다 — 이 위키 카테고리와는 다른 기능이다.
 */
export const categories: Category[] = [
  { id: 'programming', label: '편성' },
  { id: 'promotion', label: '프로모션' },
  { id: 'guide', label: '이용 안내' },
]

export const categoryShort: Record<Category['id'], string> = {
  programming: '편성',
  promotion: '프로모션',
  system: '시스템',
  guide: '안내',
}

/**
 * 카테고리 아래 2단 메뉴. 여기 없는 카테고리(이용 안내)는 서브메뉴 없이 문서를 바로 나열한다.
 * 편성, 그리고 프로모션의 업무 프로세스는 아직 문서가 없는 빈 서브메뉴다 —
 * 자리만 먼저 잡아 두고 문서가 채워지면 그대로 나타난다.
 *
 * 프로모션 서브메뉴는 비공개 참고 위키(ax-promotion-wiki)의 1~6번 목차를 그대로 따른다.
 */
export const subcategories: Record<Category['id'], Subcategory[]> = {
  programming: [
    { id: 'movie-series', label: '영화/시리즈' },
    { id: 'tv', label: 'TV 방송' },
    { id: 'animation', label: '애니메이션' },
    { id: 'kids', label: '키즈' },
    { id: 'free', label: '무료' },
  ],
  promotion: [
    { id: 'start', label: '시작하기' },
    { id: 'policy', label: '정책' },
    { id: 'process', label: '업무 프로세스' },
    { id: 'system', label: '시스템 매뉴얼' },
    { id: 'spec', label: '규격·제약' },
    { id: 'reference', label: '참조' },
  ],
  system: [],
  guide: [],
}

/** 지식/ 폴더의 마크다운이 곧 위키 문서다. 더미 데이터는 두지 않는다. */
export const docs: WikiDoc[] = knowledgeDocs

/** 문서별 수정 이력. 비어 있으면 WikiDoc 화면이 '문서 등록' 한 줄로 대체한다. */
export const docCommits: Record<string, DocCommit[]> = {}
