import type { Category, DocCommit, WikiDoc } from '../types'
import { knowledgeDocs } from './knowledgeDocs'

export const categories: Category[] = [
  { id: 'programming', label: '편성' },
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

export const relatedSites = [
  { title: '편성 시스템', desc: '편성표 등록 · 확정', url: 'https://example.com/programming' },
  { title: '프로모션 자동화', desc: 'Company A 프로모션 자동화 화면', url: 'https://btvcuration.github.io/campaign/' },
  { title: '지표 대시보드', desc: '일별 시청 지표', url: 'https://example.com/metrics' },
  { title: '컨플루언스', desc: '이관 예정 레거시 문서', url: 'https://example.com/wiki' },
]
