import { useMemo } from 'react'
import { changeCards, summarizeCards, wordRanges, type ChangeCard } from '../lib/blocks'
import { sectionLabel, type SectionChange } from '../lib/docEdit'
import { diffStats } from './DiffView'

/** 장마다 바뀐 블록 카드 — 머리말은 적용대상 줄을 잠근 블록으로 읽게 preamble 로 */
export function sectionCards(c: SectionChange): ChangeCard[] {
  return changeCards(c.before, c.after, !c.title)
}

/** 패널 「바뀐 곳」 한 줄 — 블록으로 셀 수 없으면(빈 줄만 바뀜 등) 줄 수로 */
export function changeSummary(c: SectionChange, cards: ChangeCard[]): string {
  const s = summarizeCards(cards)
  if (s) return s
  const d = diffStats(c.before, c.after)
  return `추가 ${d.added}줄 / 삭제 ${d.removed}줄`
}

/** 보이는 글 한 줄 — 바뀐 단어만 칠한다(전: 빠진 단어 취소선, 후: 들어간 단어 진하게) */
function Marked({ text, other, side }: { text: string; other: string | null; side: 'added' | 'removed' }) {
  const parts = useMemo(() => {
    if (other === null) return [{ v: text, on: false }]
    const ranges = side === 'added' ? wordRanges(other, text, 'added') : wordRanges(text, other, 'removed')
    const out: { v: string; on: boolean }[] = []
    let i = 0
    for (const [s, e] of ranges) {
      if (s > i) out.push({ v: text.slice(i, s), on: false })
      out.push({ v: text.slice(s, e), on: true })
      i = e
    }
    if (i < text.length) out.push({ v: text.slice(i), on: false })
    return out
  }, [text, other, side])
  return (
    <>
      {parts.map((p, i) =>
        p.on ? (
          side === 'added' ? (
            <ins key={i}>{p.v}</ins>
          ) : (
            <del key={i}>{p.v}</del>
          )
        ) : (
          <span key={i}>{p.v}</span>
        ),
      )}
    </>
  )
}

function CardLine({ side, text, other }: { side: 'before' | 'after'; text: string; other: string | null }) {
  return (
    <div className={`card-line ${side}`}>
      <span className="card-side">{side === 'before' ? '전' : '후'}</span>
      <span className="card-text">
        <Marked text={text} other={other} side={side === 'before' ? 'removed' : 'added'} />
      </span>
    </div>
  )
}

/** 표 카드 — 머리 줄과 바뀐 칸이 든 행만. 전 행 위·후 행 아래, 바뀐 칸만 칠한다 */
function TableCard({ table }: { table: NonNullable<ChangeCard['table']> }) {
  const width = Math.max(table.head.length, ...table.rows.map((r) => Math.max(r.before?.length ?? 0, r.after?.length ?? 0)))
  const cols = Array.from({ length: width }, (_, i) => i)
  return (
    <div className="table-wrap">
      <table className="card-table">
        <thead>
          <tr>
            <th />
            {cols.map((c) => (
              <th key={c}>{table.head[c] ?? ''}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.flatMap((r) => {
            const out = []
            if (r.before)
              out.push(
                <tr key={`${r.no}-b`} className="before">
                  <td className="card-side">{r.no === 0 ? '머리 전' : `${r.no}행 전`}</td>
                  {cols.map((c) => {
                    const v = r.before![c] ?? ''
                    const other = r.after ? (r.after[c] ?? '') : null
                    return (
                      <td key={c} className={other !== null && other !== v ? 'chg' : undefined}>
                        <Marked text={v} other={other} side="removed" />
                      </td>
                    )
                  })}
                </tr>,
              )
            if (r.after)
              out.push(
                <tr key={`${r.no}-a`} className="after">
                  <td className="card-side">{r.no === 0 ? '머리 후' : `${r.no}행 후`}</td>
                  {cols.map((c) => {
                    const v = r.after![c] ?? ''
                    const other = r.before ? (r.before[c] ?? '') : null
                    return (
                      <td key={c} className={other === null || other !== v ? 'chg' : undefined}>
                        <Marked text={v} other={other} side="added" />
                      </td>
                    )
                  })}
                </tr>,
              )
            return out
          })}
        </tbody>
      </table>
    </div>
  )
}

/** 제출 확인 창의 전/후 카드 묶음 — 바뀐 블록만, 「장」 › 블록 위치를 제목으로(doc-editing 2절 ③) */
export function ChangeCardList({ changes }: { changes: SectionChange[] }) {
  const all = useMemo(() => changes.map((c) => ({ c, cards: sectionCards(c) })), [changes])
  return (
    <div className="change-cards">
      {all.flatMap(({ c, cards }) =>
        cards.map((card, i) => (
          <div key={`${c.kind}-${c.key}-${i}`} className={`change-card ${card.kind}`}>
            <span className="label strong">
              「{sectionLabel(c.title)}」 › {card.where}
            </span>
            {card.table ? (
              <TableCard table={card.table} />
            ) : (
              <>
                {card.before !== null && <CardLine side="before" text={card.before} other={card.kind === 'changed' ? card.after : null} />}
                {card.after !== null && <CardLine side="after" text={card.after} other={card.kind === 'changed' ? card.before : null} />}
              </>
            )}
          </div>
        )),
      )}
    </div>
  )
}

/** 바뀐 곳 개수 — 블록 카드 수. 카드로 셀 수 없는 장(빈 줄만 바뀜)은 1로 */
export const changeCount = (changes: SectionChange[]) => changes.reduce((n, c) => n + Math.max(sectionCards(c).length, 1), 0)
