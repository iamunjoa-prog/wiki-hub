import { useMemo } from 'react'
import { diffLines } from 'diff'

type Row = { left: string | null; right: string | null; kind: 'ctx' | 'add' | 'del' }

function buildRows(before: string, after: string): Row[] {
  const rows: Row[] = []
  const parts = diffLines(before, after)

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const lines = part.value.replace(/\n$/, '').split('\n')

    if (part.removed && parts[i + 1]?.added) {
      const nextLines = parts[i + 1].value.replace(/\n$/, '').split('\n')
      const max = Math.max(lines.length, nextLines.length)
      for (let j = 0; j < max; j++) {
        rows.push({
          left: lines[j] ?? null,
          right: nextLines[j] ?? null,
          kind: lines[j] === nextLines[j] ? 'ctx' : 'add',
        })
      }
      i++
      continue
    }

    for (const line of lines) {
      if (part.added) rows.push({ left: null, right: line, kind: 'add' })
      else if (part.removed) rows.push({ left: line, right: null, kind: 'del' })
      else rows.push({ left: line, right: line, kind: 'ctx' })
    }
  }
  return rows
}

export function diffStats(before: string, after: string) {
  const parts = diffLines(before, after)
  let added = 0
  let removed = 0
  for (const p of parts) {
    const count = p.value.replace(/\n$/, '').split('\n').length
    if (p.added) added += count
    if (p.removed) removed += count
  }
  return { added, removed, changed: added + removed > 0 }
}

export function DiffView({
  before,
  after,
  leftLabel,
  rightLabel,
  mode = 'split',
}: {
  before: string
  after: string
  leftLabel: string
  rightLabel: string
  mode?: 'split' | 'inline'
}) {
  const rows = useMemo(() => buildRows(before, after), [before, after])

  if (mode === 'inline') {
    return (
      <div className="panel" style={{ maxHeight: 360, overflow: 'auto' }}>
        {rows.map((r, i) => {
          if (r.kind === 'ctx')
            return (
              <div key={i} className="diff-line ctx">
                {r.left}
              </div>
            )
          return (
            <div key={i}>
              {r.left !== null && <div className="diff-line del">- {r.left}</div>}
              {r.right !== null && <div className="diff-line add">+ {r.right}</div>}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="diff-split" style={{ maxHeight: 360, overflow: 'auto' }}>
      <div className="diff-col">
        <div className="h label">{leftLabel}</div>
        {rows.map((r, i) => (
          <div
            key={i}
            className={`diff-line ${r.left === null ? 'pad' : r.kind === 'ctx' ? 'ctx' : 'del'}`}
          >
            {r.left ?? ''}
          </div>
        ))}
      </div>
      <div className="diff-col">
        <div className="h label strong">{rightLabel}</div>
        {rows.map((r, i) => (
          <div
            key={i}
            className={`diff-line ${r.right === null ? 'pad' : r.kind === 'ctx' ? 'ctx' : 'add'}`}
          >
            {r.right ?? ''}
          </div>
        ))}
      </div>
    </div>
  )
}
