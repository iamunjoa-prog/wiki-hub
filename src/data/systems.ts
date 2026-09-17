import type { SystemAccess, SystemEntry, SystemGroupId } from '../types'

/**
 * 시스템 메뉴 — 담당자가 실제로 로그인해서 일하는 시스템 목록.
 *
 * 편성 관련 / 마케팅 관련로 나눈다. 같은 배너를 다루더라도 편성 시스템은 지면에 무엇을 올릴지,
 * 마케팅 시스템은 누구에게 무엇을 보낼지를 정하는 도구라 섞이면 담당자가 헤맨다.
 */
export const systemGroups: { id: SystemGroupId; label: string; desc: string }[] = [
  { id: 'programming', label: '편성 관련', desc: '지면·콘텐츠를 어디에 올릴지 정하는 시스템' },
  { id: 'marketing', label: '마케팅 관련', desc: '프로모션·캠페인을 누구에게 보낼지 정하는 시스템' },
]

/** 망 플래그 선택지 — 등록 폼과 카드가 같은 값을 쓴다 */
export const systemAccessOptions: SystemAccess[] = ['로컬 전용', '클라우드 전용']

export const systems: SystemEntry[] = [
  {
    id: 'euxp',
    name: 'EUXP',
    desc: '시놉시스 배너 편성',
    access: '로컬 전용',
    group: 'programming',
  },
  {
    id: 'ncms',
    name: 'NCMS',
    desc: '콘텐츠 메타 · 배너 편성',
    access: '로컬 전용',
    group: 'programming',
  },
  {
    id: 'schedule-preview',
    name: '편성 미리보기',
    desc: '편성 결과를 실제 화면 그대로 확인',
    access: '로컬 전용',
    group: 'programming',
  },
  {
    id: 'acs',
    name: 'ACS',
    desc: '광고 소재 · 캠페인 관리',
    url: 'http://114.202.130.40:9093/',
    access: '로컬 전용',
    group: 'marketing',
  },
  {
    id: 'cbs',
    name: 'CBS',
    desc: '콘텐츠 편성 · 승인요청',
    url: 'http://btvcbs.skbroadband.com/',
    access: '클라우드 전용',
    group: 'marketing',
  },
  {
    id: 'campaign-automation',
    name: '프로모션 자동화',
    desc: 'Target 프로모션 등록 · 실행',
    url: 'https://btvcuration.github.io/campaign/',
    access: '로컬 전용',
    group: 'marketing',
  },
]

/**
 * 대시보드 '자주 사용하는 시스템'의 기본 즐겨찾기.
 * 처음 들어온 담당자에게 빈 칸부터 보여 주지 않으려고 매일 여는 세 곳을 미리 켜 둔다.
 */
export const defaultFavoriteSystems = ['campaign-automation', 'cbs', 'acs']
