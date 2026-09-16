import type { Category, DocCommit, RelatedSite, WikiDoc } from '../types'
import { knowledgeDocs } from './knowledgeDocs'

/**
 * 위키에 노출하는 카테고리.
 * 편성은 문서 대신 편성/스케줄 화면에서 다루기로 해 목록에서 감춘다 —
 * `categoryShort`·`CategoryId`에는 남겨 두어 과거 문서가 깨지지 않게 한다.
 */
export const categories: Category[] = [
  { id: 'promotion', label: '프로모션' },
  { id: 'insight', label: '마케팅 인사이트' },
  { id: 'system', label: '시스템 매뉴얼' },
  { id: 'guide', label: '이용 안내' },
]

export const categoryShort: Record<Category['id'], string> = {
  programming: '편성',
  promotion: '프로모션',
  insight: '인사이트',
  system: '시스템',
  guide: '안내',
}

/** 지식/ 폴더의 마크다운이 곧 위키 문서다. 더미 데이터는 두지 않는다. */
export const docs: WikiDoc[] = knowledgeDocs

/** 문서별 수정 이력. 비어 있으면 WikiDoc 화면이 '문서 등록' 한 줄로 대체한다. */
export const docCommits: Record<string, DocCommit[]> = {}

export const relatedSites: RelatedSite[] = [
  {
    title: '프로모션 자동화',
    desc: 'Target 프로모션 등록 · 실행',
    url: 'https://btvcuration.github.io/campaign/',
    access: '로컬',
  },
  {
    title: 'CBS',
    desc: '콘텐츠 편성 · 승인요청',
    url: 'http://btvcbs.skbroadband.com/',
    access: '클라우드 PC',
  },
  {
    title: 'ACS',
    desc: '광고 소재 · 캠페인 관리',
    url: 'http://114.202.130.40:9093/',
    access: '로컬',
  },
]
