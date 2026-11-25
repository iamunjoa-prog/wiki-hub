import { categories, subcategories } from '../data/docs'
import { kstToday } from '../lib/scheduleApi'
import type { WikiDoc } from '../types'

/**
 * 문서를 가리키는 작은 부품 — 문서 머리·근거 카드·홈 목록이 같은 모양을 쓴다 (identity-redesign 2-8).
 * 카테고리는 사각·띠, 상태는 원 램프 + 글자. 색만으로 뜻을 싣지 않는다
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** 두 YYYY-MM-DD 사이 날 수 — 시간대 영향을 받지 않게 UTC 자정끼리 잰다 */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)

export type Freshness = { level: 'ok' | 'warn' | 'old'; label: string; days: number }

/**
 * 최신성 — 1차는 갱신일 기준(30일 이내 최신 · 90일 이내 확인 권장 · 넘으면 오래됨).
 * 확인일 칸(reviewedAt)이 생기면 3차에 그 기준으로 바꾼다. 화면에는 "갱신일 기준"을 숨기지 않는다
 */
export function freshnessOf(updatedAt: string, today = kstToday()): Freshness {
  const days = Math.max(0, daysBetween(updatedAt.slice(0, 10), today))
  if (days <= 30) return { level: 'ok', label: '최신', days }
  if (days <= 90) return { level: 'warn', label: '확인 권장', days }
  return { level: 'old', label: '오래됨', days }
}

const LAMP_CLASS: Record<Freshness['level'], string> = { ok: 'ok', warn: 'warn', old: 'no' }

export function FreshLamp({ updatedAt, basis = false }: { updatedAt: string; basis?: boolean }) {
  const f = freshnessOf(updatedAt)
  return (
    <span className="lamp-label" title={`갱신일 기준 · ${f.days}일 전 갱신`}>
      <span className={`lamp ${LAMP_CLASS[f.level]}`} aria-hidden="true" />
      {f.label}
      {basis && <span className="lamp-basis">갱신일 기준</span>}
    </span>
  )
}

/** 적용대상 칩 — [PPM] [PPV] [공통]. B tv+ 문서는 프론트매터가 PPM 이라 [PPM]으로 보인다 */
export function ScopeChip({ scope }: { scope: WikiDoc['scope'] }) {
  const s = scope ?? '공통'
  return (
    <span className={`scope-chip${s === '공통' ? '' : ' strong'}`} title={`적용대상 ${s}`}>
      [{s}]
    </span>
  )
}

export const categoryLabel = (id: WikiDoc['category']) => categories.find((c) => c.id === id)?.label ?? id

/** 2단 메뉴 이름 — 서브메뉴가 있는 카테고리인데 소속이 없으면 사이드바처럼 '기타' */
export function subLabel(doc: Pick<WikiDoc, 'category' | 'subcategory'>): string | null {
  const subs = subcategories[doc.category] ?? []
  if (subs.length === 0) return null
  return subs.find((s) => s.id === doc.subcategory)?.label ?? '기타'
}

/** `11-18 (7일 전)` — 오늘이면 '오늘' */
export function agoLabel(date: string): string {
  const d = Math.max(0, daysBetween(date.slice(0, 10), kstToday()))
  return d === 0 ? '오늘' : `${d}일 전`
}
