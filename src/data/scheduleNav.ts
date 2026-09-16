/**
 * 편성/스케줄 사이드바 트리 — 사이드바와 자리표시 화면이 같은 정의를 본다.
 *
 * 편성/스케줄 › B tv · 모바일 B tv › (홈 묶음 | 단일 화면).
 * 담당자가 실제로 일하는 단위가 "어느 플랫폼의 어느 지면"이라서 플랫폼을 위로 올렸다.
 */

/** 화면 하나로 가는 메뉴. soon 이 있으면 아직 화면이 없어 자리표시만 띄운다. */
export interface ScheduleLeaf {
  label: string
  path: string
  /** 자리표시 문구 — 화면을 만드는 중이면 '개발중', 데이터가 아직이면 '준비중' */
  soon?: '개발중' | '준비중'
}

/** 하위 메뉴를 접었다 펴는 묶음 (예: 홈) */
export interface ScheduleGroup {
  label: string
  children: ScheduleLeaf[]
}

export type ScheduleNode = ScheduleLeaf | ScheduleGroup

export const isGroup = (n: ScheduleNode): n is ScheduleGroup => 'children' in n

export interface SchedulePlatform {
  label: string
  children: ScheduleNode[]
}

export const scheduleNav: SchedulePlatform[] = [
  {
    label: 'B tv',
    children: [
      {
        label: '홈',
        children: [
          { label: 'Today B tv', path: '/sheets/btv' },
          { label: '오핫콘', path: '/sheets/btv/ohatcon', soon: '준비중' },
        ],
      },
      { label: '영화/시리즈', path: '/sheets/btv/movie', soon: '개발중' },
      { label: 'TV 방송', path: '/sheets/btv/tv', soon: '개발중' },
      { label: '캠페인 (ACS)', path: '/sheets/campaign' },
    ],
  },
  {
    label: '모바일 B tv',
    children: [
      {
        label: '홈',
        children: [
          { label: '빅배너', path: '/sheets/mobile/big-banner' },
          { label: '콘텐츠 블록', path: '/sheets/mobile/content-block', soon: '준비중' },
        ],
      },
      { label: '영화/시리즈', path: '/sheets/mobile/movie', soon: '개발중' },
      { label: 'TV 방송', path: '/sheets/mobile/tv', soon: '개발중' },
      { label: 'App·push (ACS)', path: '/sheets/mobile/app-push', soon: '개발중' },
    ],
  },
]

/** 경로가 속한 메뉴 길 — 화면 머리말의 '편성/스케줄 › B tv › 홈 › 오핫콘' 을 만든다 */
export function scheduleTrail(path: string): string[] | null {
  for (const platform of scheduleNav) {
    for (const node of platform.children) {
      if (isGroup(node)) {
        const leaf = node.children.find((c) => c.path === path)
        if (leaf) return ['편성/스케줄', platform.label, node.label, leaf.label]
      } else if (node.path === path) {
        return ['편성/스케줄', platform.label, node.label]
      }
    }
  }
  return null
}

/** 아직 화면이 없는 메뉴 전부 — 라우터가 자리표시 화면을 걸어 준다 */
export const schedulePlaceholders: ScheduleLeaf[] = scheduleNav.flatMap((p) =>
  p.children.flatMap((n) => (isGroup(n) ? n.children : [n])).filter((l) => l.soon),
)
