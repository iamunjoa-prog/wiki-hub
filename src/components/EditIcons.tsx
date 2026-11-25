/** 편집 도구줄 선 아이콘 16px — 버튼에는 늘 글자를 같이 쓴다(초보자 기준, doc-editing 2절 ②) */
const PATHS = {
  bold: 'M5 3h4a2.5 2.5 0 0 1 0 5H5zM5 8h5a2.5 2.5 0 0 1 0 5H5z',
  link: 'M7 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8',
  list: 'M6 4h8M6 8h8M6 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  listOrdered: 'M7 4h7M7 8h7M7 12h7M2 3h1.2v3M2 6h2.4M2 10.2a1 1 0 1 1 1.8.6L2 13h2.4',
  plus: 'M8 3v10M3 8h10',
  callout: 'M3 3h10v8H8l-3 2.5V11H3zM8 5.5v2.2M8 9.3h.01',
  sparkle: 'M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3zM12.5 11.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z',
  undo: 'M5.5 3.5L2.5 6.5l3 3M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7',
  lock: 'M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z',
} as const

export type EditIconName = keyof typeof PATHS

export function EditIcon({ name }: { name: EditIconName }) {
  return (
    <svg className="edit-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
