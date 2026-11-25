/**
 * 선 아이콘 모음 — 24 격자, 굵기 1.75, 둥근 끝 (identity-redesign 2-7).
 * 새 아이콘 라이브러리를 들이지 않고 쓰는 것만 인라인 SVG로 둔다. 색은 글자색(currentColor)을 따른다
 */
export type IconName =
  | 'search'
  | 'home'
  | 'ask'
  | 'inbox'
  | 'book'
  | 'megaphone'
  | 'grid-time'
  | 'calendar'
  | 'link-out'
  | 'check-badge'
  | 'users'
  | 'history'
  | 'pencil'
  | 'lamp'

const PATHS: Record<IconName, React.ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  home: <path d="M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10" />,
  ask: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />,
  inbox: (
    <>
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M5.5 5h13L21 13v6H3v-6Z" />
    </>
  ),
  book: <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5ZM4 19a2 2 0 0 1 2-2h13" />,
  megaphone: <path d="M3 10v4h3l9 5V5l-9 5H3ZM18 9a4 4 0 0 1 0 6M7 14l1.5 6h3" />,
  'grid-time': (
    <>
      <path d="M3 4h18v7M3 4v16h8M3 9h18M9 4v16" />
      <circle cx="17" cy="17" r="4" />
      <path d="M17 15v2l1.5 1" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  'link-out': <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  'check-badge': (
    <>
      <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6Z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />,
  lamp: <circle cx="12" cy="12" r="5" />,
}

export function Icon({ name, size = 16 }: { name: IconName; size?: 16 | 20 }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

/** 컬러바 마크 — 이용 안내·프로모션·편성 3색 세로 칸 12×12, 사이 1px 틈. 회사 로고 대신 쓴다 (2-8 ①) */
export function ColorBarMark() {
  return (
    <svg className="colorbar-mark" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="0" y="0" width="3.33" height="12" fill="var(--cat-guide)" />
      <rect x="4.33" y="0" width="3.33" height="12" fill="var(--cat-promo)" />
      <rect x="8.67" y="0" width="3.33" height="12" fill="var(--cat-prog)" />
    </svg>
  )
}
