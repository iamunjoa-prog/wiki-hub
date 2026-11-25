import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EditIcon } from './EditIcons'
import {
  addCol,
  addRow,
  align,
  alignBlocks,
  blockKindName,
  blockPlain,
  CALLOUTS,
  calloutKind,
  indentItem,
  insertBlock,
  isOrdered,
  listLayout,
  newCallout,
  newItem,
  newTable,
  normalizeInline,
  outdentItem,
  paraToList,
  parseSection,
  plainInline,
  relist,
  removeBlock,
  removeCol,
  removeRow,
  renderItem,
  replaceBlock,
  restoreRow,
  serializeSection,
  setCell,
  TODO_MARK,
  withNode,
  wordRanges,
  type Block,
  type BlockNode,
  type Inline,
  type ListItem,
  type Mark,
  type SectionModel,
  type TableRow,
} from '../lib/blocks'
import { useApp } from '../store/AppStore'

/**
 * 보이는 모양 그대로 고치는 장 편집 면(doc-editing 1-1·2절 ②). 편집기 라이브러리 없이 블록마다 작은 contentEditable 을 둔다 —
 * 칸이 블록·표 칸·목록 항목 하나라서 고친 곳만 다시 마크다운으로 쓸 수 있다(R1). 편집 모드에서만 불러온다(R3, SectionEditor 의 lazy)
 */

type Range2 = [number, number]

interface SurfaceCtx {
  readOnly: boolean
  /** 다음에 그려질 때 커서를 둘 칸 — `블록id:칸` */
  focus: React.MutableRefObject<{ key: string; at: 'start' | 'end' } | null>
  /** 링크 고르기 창이 열린 동안에는 칸을 다시 그리지 않는다 — 잡아 둔 선택 영역이 문서에서 떨어지지 않게 */
  hold: React.MutableRefObject<boolean>
}

const Ctx = createContext<SurfaceCtx>({ readOnly: true, focus: { current: null }, hold: { current: false } })

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const DOC_CODE = /^([A-Z][A-Za-z0-9-]*)(?:#.*)?$/

/** 글 안 모양 → 편집 칸 HTML. marks 는 보이는 글 기준 바뀐 글자 범위 — 그 글자만 칠한다 */
function toHtml(nodes: Inline[], marks: Range2[]): string {
  let pos = 0
  const hit = (a: number, b: number) => marks.some(([s, e]) => s < b && e > a)
  const text = (v: string) => {
    let out = ''
    let i = 0
    for (const [s, e] of marks) {
      const a = Math.max(s - pos, i)
      const b = Math.min(e - pos, v.length)
      if (b <= a) continue
      out += esc(v.slice(i, a)) + `<mark class="ib-chg">${esc(v.slice(a, b))}</mark>`
      i = b
    }
    out += esc(v.slice(i))
    pos += v.length
    return out.replace(/\n/g, '<br>')
  }
  const walk = (ns: Inline[]): string =>
    ns
      .map((n) => {
        switch (n.t) {
          case 'text':
            return text(n.v)
          case 'code':
            return `<code>${text(n.v)}</code>`
          case 'bold':
            return `<b>${walk(n.c)}</b>`
          case 'italic':
            return `<i>${walk(n.c)}</i>`
          case 'link': {
            const code = DOC_CODE.exec(n.href)?.[1]
            const attrs = code ? ` data-code="${esc(code)}"` : /^https?:/i.test(n.href) ? ' class="ext"' : ''
            return `<a href="${esc(n.href)}"${attrs}>${walk(n.c)}</a>`
          }
          case 'mask': {
            const on = hit(pos, pos + n.v.length) ? ' chg' : ''
            pos += n.v.length
            return `<span class="ib-mask${on}" contenteditable="false" data-v="${esc(n.v)}" title="가려 둔 이름이에요. 글자를 채울 수 없고, 칩째로만 지울 수 있어요">${esc(n.v)}</span>`
          }
          case 'todo':
            pos += TODO_MARK.length
            return `<span class="ib-todo" contenteditable="false" title="눌러서 내용을 채워요">${TODO_MARK}</span>`
        }
      })
      .join('')
  return walk(nodes)
}

/** 편집 칸 DOM → 글 안 모양. 칠(mark)·브라우저가 끼운 span 은 걷어 낸다 */
function readDom(root: Node): Inline[] {
  const out: Inline[] = []
  const walk = (n: Node, into: Inline[]) => {
    n.childNodes.forEach((c, idx) => {
      if (c.nodeType === Node.TEXT_NODE) {
        into.push({ t: 'text', v: (c.nodeValue ?? '').replace(/ /g, ' ').replace(/​/g, '') })
        return
      }
      if (!(c instanceof HTMLElement)) return
      const tag = c.tagName
      if (c.classList.contains('ib-mask')) into.push({ t: 'mask', v: c.dataset.v ?? c.textContent ?? '' })
      else if (c.classList.contains('ib-todo')) into.push({ t: 'todo' })
      else if (tag === 'BR') into.push({ t: 'text', v: '\n' })
      else if (tag === 'B' || tag === 'STRONG' || (tag === 'SPAN' && /font-weight:\s*(bold|[6-9]00)/.test(c.style.cssText))) {
        const k: Inline[] = []
        walk(c, k)
        into.push({ t: 'bold', c: k })
      } else if (tag === 'I' || tag === 'EM') {
        const k: Inline[] = []
        walk(c, k)
        into.push({ t: 'italic', c: k })
      } else if (tag === 'CODE') into.push({ t: 'code', v: (c.textContent ?? '').replace(/ /g, ' ') })
      else if (tag === 'A') {
        const k: Inline[] = []
        walk(c, k)
        into.push({ t: 'link', href: c.getAttribute('href') ?? '', c: k })
      } else if (tag === 'DIV' || tag === 'P') {
        // Enter 를 막지 못한 경우(붙여넣기 등) 브라우저가 줄을 div 로 감싼다 — 줄바꿈으로 읽는다
        if (idx > 0) into.push({ t: 'text', v: '\n' })
        walk(c, into)
      } else walk(c, into)
    })
  }
  walk(root, out)
  return out
}

/** 끝에 붙은 줄바꿈(브라우저가 끼우는 빈 br)은 버린다. 한 줄 칸은 줄바꿈을 빈칸으로 */
function cleanRead(nodes: Inline[], single: boolean): Inline[] {
  const fix = (ns: Inline[]): Inline[] =>
    ns.map((n) => (n.t === 'text' ? { ...n, v: single ? n.v.replace(/\n/g, ' ') : n.v } : 'c' in n ? { ...n, c: fix(n.c) } : n))
  const out = normalizeInline(fix(nodes))
  const last = out[out.length - 1]
  if (last?.t === 'text') {
    const v = last.v.replace(/\n+$/, '')
    if (v) out[out.length - 1] = { t: 'text', v }
    else out.pop()
  }
  return out
}

function placeCaret(el: HTMLElement, at: 'start' | 'end') {
  el.focus({ preventScroll: false })
  const sel = window.getSelection()
  if (!sel) return
  const r = document.createRange()
  r.selectNodeContents(el)
  r.collapse(at === 'start')
  sel.removeAllRanges()
  sel.addRange(r)
}

/** 커서 자리에서 칸을 둘로 — 뒤쪽을 떼어 내 돌려준다(Enter 로 문단·항목 나누기) */
function splitAtCaret(el: HTMLElement, single: boolean): { before: Inline[]; after: Inline[] } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const r = sel.getRangeAt(0)
  if (!el.contains(r.startContainer)) return null
  r.deleteContents()
  const tail = document.createRange()
  tail.setStart(r.startContainer, r.startOffset)
  tail.setEnd(el, el.childNodes.length)
  const frag = tail.extractContents()
  return { before: cleanRead(readDom(el), single), after: cleanRead(readDom(frag), single) }
}

const caretAtStart = (el: HTMLElement) => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
  const r = document.createRange()
  r.selectNodeContents(el)
  r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset)
  return r.toString().length === 0 && !r.cloneContents().querySelector('.ib-mask, .ib-todo')
}

/** 글 칸 하나 — 블록·표 칸·목록 항목마다. 그린 뒤에는 손대지 않고(커서 유지), 칸을 떠날 때만 칠을 다시 그린다 */
function InlineEdit({
  fkey,
  nodes,
  marks,
  single = false,
  className,
  label,
  placeholder,
  onInput,
  onKey,
}: {
  fkey: string
  nodes: Inline[]
  marks: Range2[]
  single?: boolean
  className?: string
  label: string
  placeholder?: string
  onInput: (nodes: Inline[]) => void
  onKey?: (e: React.KeyboardEvent<HTMLDivElement>, el: HTMLDivElement) => void
}) {
  const ctx = useContext(Ctx)
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => toHtml(nodes, marks), [nodes, marks])
  const htmlRef = useRef(html)
  htmlRef.current = html

  useLayoutEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && !ctx.hold.current) el.innerHTML = html
  }, [html, ctx])
  useLayoutEffect(() => {
    const f = ctx.focus.current
    if (f && f.key === fkey && ref.current) {
      ctx.focus.current = null
      placeCaret(ref.current, f.at)
    }
  })

  const read = () => ref.current && onInput(cleanRead(readDom(ref.current), single))

  return (
    <div
      ref={ref}
      className={`ib${className ? ` ${className}` : ''}`}
      contentEditable={!ctx.readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      aria-multiline={!single}
      aria-readonly={ctx.readOnly}
      data-placeholder={placeholder}
      data-inl={fkey}
      spellCheck={false}
      onInput={read}
      onBlur={() => {
        // 떠날 때 칠을 지금 글 기준으로 다시 그린다
        if (ref.current && !ctx.hold.current) ref.current.innerHTML = htmlRef.current
      }}
      onPaste={(e) => {
        // 붙여넣기는 글자만 — 다른 곳의 서식·HTML 이 원문에 섞이지 않게
        e.preventDefault()
        const t = e.clipboardData.getData('text/plain')
        document.execCommand('insertText', false, single ? t.replace(/\s*\n\s*/g, ' ') : t)
      }}
      onDrop={(e) => e.preventDefault()}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (a) e.preventDefault()
        const todo = (e.target as HTMLElement).closest('.ib-todo')
        if (!todo || ctx.readOnly || !ref.current) return
        // (보완 필요) 칩을 누르면 같은 글자로 바꿔 골라 둔다 — 바로 타자를 치면 내용으로 바뀐다
        const tn = document.createTextNode(TODO_MARK)
        todo.replaceWith(tn)
        const r = document.createRange()
        r.selectNodeContents(tn)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(r)
      }}
      onKeyDown={(e) => {
        if (ctx.readOnly) return
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') e.preventDefault() // 기울임은 도구줄에 없다 — 모르는 모양을 만들지 않게
        if (ref.current) onKey?.(e, ref.current)
        if (!e.defaultPrevented && e.key === 'Enter' && single) e.preventDefault()
        if (!e.defaultPrevented && e.key === 'Enter' && e.shiftKey) {
          e.preventDefault()
          document.execCommand('insertLineBreak')
        }
      }}
    />
  )
}

/** 바뀐 글자 범위 — 바뀐 곳 표시를 끄면 칠하지 않는다 */
const marksOf = (show: boolean, before: string | null, after: string): Range2[] =>
  show && before !== null && before !== after ? wordRanges(before, after, 'added') : []

const NONE: Range2[] = []

type TableNode = Extract<BlockNode, { k: 'table' }>
type ListNode = Extract<BlockNode, { k: 'list' }>

function TableEdit({
  block,
  base,
  mark,
  show,
  onNode,
  focusKey,
}: {
  block: Block & { node: TableNode }
  base: TableNode | null
  mark: Mark
  show: boolean
  onNode: (node: BlockNode, focus?: { key: string; at: 'start' | 'end' }) => void
  focusKey: (sub: string) => string
}) {
  const ctx = useContext(Ctx)
  const n = block.node
  const width = Math.max(n.head.cells.length, n.aligns.length, ...n.rows.map((r) => r.cells.length))
  const [at, setAt] = useState<{ row: number; col: number }>({ row: 0, col: 0 })
  const rowsAligned = useMemo(() => (base && mark === 'changed' ? align(base.rows, n.rows, (r) => r.raw) : null), [base, mark, n.rows])
  const cellBase = (row: TableRow | null, col: number) => (row ? plainInline(row.cells[col] ?? []) : null)

  const cell = (row: TableRow, r: number, c: number, baseRow: TableRow | null, rowMark: Mark, head: boolean) => {
    const inl = row.cells[c] ?? []
    const before = rowMark === 'changed' ? cellBase(baseRow, c) : null
    const now = plainInline(inl)
    const changed = show && before !== null && before !== now
    const Tag = head ? 'th' : 'td'
    return (
      <Tag key={c} className={changed ? 'bk-cell-chg' : undefined} onFocus={() => setAt({ row: r, col: c })}>
        <InlineEdit
          fkey={focusKey(`r${r}c${c}`)}
          nodes={inl}
          marks={changed ? marksOf(show, before, now) : NONE}
          single
          label={head ? `표 머리 ${c + 1}번째 칸` : `표 ${r + 1}행 ${c + 1}번째 칸`}
          onInput={(v) => onNode(setCell(n, r, c, v))}
          onKey={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const next = document.querySelector<HTMLElement>(`[data-inl="${focusKey(`r${r + 1}c${c}`)}"]`)
              if (next) placeCaret(next, 'end')
            }
          }}
        />
      </Tag>
    )
  }

  const op = (fn: () => BlockNode, focus?: { row: number; col: number }) =>
    onNode(fn(), focus ? { key: focusKey(`r${focus.row}c${focus.col}`), at: 'end' } : undefined)

  const bodyRows: ReactNode[] = []
  const entries = rowsAligned ?? n.rows.map((r, i) => ({ k: 'keep' as const, now: r, index: i, base: null, mark: mark === 'new' ? ('new' as Mark) : ('same' as Mark) }))
  for (const e of entries) {
    if (e.k === 'gone') {
      if (!show || ctx.readOnly) continue
      bodyRows.push(
        <tr key={`gone-${e.at}-${e.base.raw}`} className="bk-gone-row">
          <td colSpan={width}>
            <span>지운 행 · 「{e.base.cells.map(plainInline).join(' · ').slice(0, 30)}」</span>
            <button className="btn sm" onMouseDown={(ev) => ev.preventDefault()} onClick={() => op(() => restoreRow(n, e.at, e.base))}>
              되살리기
            </button>
          </td>
        </tr>,
      )
      continue
    }
    const r = e.index
    bodyRows.push(
      <tr key={`r-${r}`} className={show && e.mark === 'new' && mark === 'changed' ? 'bk-row-new' : undefined}>
        {Array.from({ length: width }, (_, c) => cell(e.now, r, c, e.base, e.mark, false))}
      </tr>,
    )
  }
  const headChanged = base && mark === 'changed' && base.head.raw !== n.head.raw

  return (
    <div className="bk-table">
      {!ctx.readOnly && (
        <div className="bk-table-bar" role="toolbar" aria-label="표 고치기">
          <span className="muted">{at.row >= 0 ? `${at.row + 1}행 ${at.col + 1}열` : `머리 ${at.col + 1}열`}</span>
          <TbBtn onClick={() => op(() => addRow(n, Math.max(at.row, 0)), { row: Math.max(at.row, 0), col: at.col })}>행 추가 ↑</TbBtn>
          <TbBtn onClick={() => op(() => addRow(n, at.row + 1), { row: at.row + 1, col: at.col })}>행 추가 ↓</TbBtn>
          <TbBtn onClick={() => op(() => addCol(n, at.col), { row: at.row, col: at.col })}>열 추가 ←</TbBtn>
          <TbBtn onClick={() => op(() => addCol(n, at.col + 1), { row: at.row, col: at.col + 1 })}>열 추가 →</TbBtn>
          <TbBtn disabled={at.row < 0 || n.rows.length === 0} onClick={() => op(() => removeRow(n, at.row))}>
            행 지우기
          </TbBtn>
          <TbBtn disabled={width <= 1} onClick={() => op(() => removeCol(n, at.col))}>
            열 지우기
          </TbBtn>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {Array.from({ length: width }, (_, c) => cell(n.head, -1, c, headChanged ? base!.head : null, headChanged ? 'changed' : 'same', true))}
            </tr>
          </thead>
          <tbody>{bodyRows}</tbody>
        </table>
      </div>
    </div>
  )
}

function TbBtn({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="btn sm" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  )
}

function ListEdit({
  block,
  base,
  mark,
  show,
  onNode,
  onExit,
  focusKey,
}: {
  block: Block & { node: ListNode }
  base: ListNode | null
  mark: Mark
  show: boolean
  onNode: (node: BlockNode | null, focus?: { key: string; at: 'start' | 'end' }) => void
  /** 빈 항목에서 Enter — 목록을 끝내고 아래에 문단 */
  onExit: (items: ListItem[]) => void
  focusKey: (sub: string) => string
}) {
  const ctx = useContext(Ctx)
  const items = block.node.items
  const layout = listLayout(items)
  const aligned = useMemo(
    () =>
      base && mark === 'changed'
        ? align(base.items, items, renderItem)
        : items.map((it, i) => ({ k: 'keep' as const, now: it, index: i, base: null as ListItem | null, mark: (mark === 'new' ? 'new' : 'same') as Mark })),
    [base, mark, items],
  )
  const set = (next: ListItem[], focus?: { i: number; at: 'start' | 'end' }) =>
    onNode(next.length ? { k: 'list', items: next } : null, focus ? { key: focusKey(`i${focus.i}`), at: focus.at } : undefined)

  return (
    <div className="bk-list" role="list">
      {aligned.map((e) => {
        if (e.k === 'gone') {
          if (!show || ctx.readOnly) return null
          return (
            <div key={`gone-${e.at}-${renderItem(e.base)}`} className="bk-gone bk-gone-item">
              <span>지운 항목 · 「{plainInline(e.base.inl).slice(0, 20)}」</span>
              <button
                className="btn sm"
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => {
                  const next = [...items]
                  next.splice(e.at, 0, e.base)
                  set(next)
                }}
              >
                되살리기
              </button>
            </div>
          )
        }
        const i = e.index
        const it = e.now
        const before = e.mark === 'changed' && e.base ? plainInline(e.base.inl) : null
        const now = plainInline(it.inl)
        const cls = show && mark === 'changed' ? (e.mark === 'new' ? ' bk-li-new' : before !== null && before !== now ? ' bk-li-chg' : '') : ''
        return (
          <div key={`i-${i}`} className={`bk-li${cls}`} role="listitem" style={{ paddingLeft: layout[i].depth * 22 }}>
            <span className="bk-li-mark" aria-hidden="true">
              {layout[i].label}
            </span>
            {it.task && <span className="bk-li-task" aria-hidden="true">{/x/i.test(it.task) ? '☑' : '☐'}</span>}
            <InlineEdit
              fkey={focusKey(`i${i}`)}
              nodes={it.inl}
              marks={marksOf(show, before, now)}
              label={`목록 ${i + 1}번째 항목`}
              placeholder="항목"
              onInput={(v) => set(items.map((x, j) => (j === i ? { ...x, inl: v } : x)))}
              onKey={(ev, el) => {
                if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
                  ev.preventDefault()
                  if (plainInline(it.inl) === '' && el.textContent === '') {
                    onExit(items.filter((_, j) => j !== i))
                    return
                  }
                  const parts = splitAtCaret(el, false)
                  if (!parts) return
                  const next = items.map((x, j) => (j === i ? { ...x, inl: parts.before } : x))
                  next.splice(i + 1, 0, newItem(next, i + 1, isOrdered(it.marker), it.indent, parts.after))
                  set(next, { i: i + 1, at: 'start' })
                } else if (ev.key === 'Tab') {
                  ev.preventDefault()
                  set(ev.shiftKey ? outdentItem(items, i) : indentItem(items, i), { i, at: 'end' })
                } else if (ev.key === 'Backspace' && el.textContent === '' && !el.querySelector('.ib-mask, .ib-todo')) {
                  ev.preventDefault()
                  set(
                    items.filter((_, j) => j !== i),
                    i > 0 ? { i: i - 1, at: 'end' } : undefined,
                  )
                }
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

/** 링크 넣기 — 위키 문서 고르기(문서 코드·제목 검색). 바깥 주소는 직접 넣는다 */
function LinkPicker({ onPick, onClose }: { onPick: (href: string, label: string) => void; onClose: () => void }) {
  const { docs } = useApp()
  const [q, setQ] = useState('')
  const [url, setUrl] = useState('')
  const query = q.trim().toLowerCase()
  const list = docs.filter((d) => !query || d.code.toLowerCase().includes(query) || d.title.toLowerCase().includes(query)).slice(0, 8)
  const urlOk = /^https?:\/\/\S+$/i.test(url.trim())
  return (
    <div className="bk-pop" role="dialog" aria-label="링크 넣기" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="form-actions">
        <span className="label strong">링크 넣기 · 위키 문서 고르기</span>
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onClose}>
          닫기
        </button>
      </div>
      <input className="field" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="문서 코드나 제목으로 찾기" aria-label="문서 찾기" />
      <div className="bk-pop-list">
        {list.map((d) => (
          <button key={d.id} className="bk-pop-item" onClick={() => onPick(d.code, d.title)}>
            <span className="tag">{d.code}</span> {d.title}
          </button>
        ))}
        {list.length === 0 && <span className="muted">맞는 문서가 없어요</span>}
      </div>
      <div className="form-actions">
        <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="주소 직접 넣기 (https://로 시작)" aria-label="주소 직접 넣기" />
        <button className="btn sm" disabled={!urlOk} onClick={() => onPick(url.trim(), url.trim())}>
          넣기
        </button>
      </div>
    </div>
  )
}

/** 지운 블록 — 한 줄로 접고 [되살리기] */
function GoneBlock({ block, first, onRestore }: { block: Block; first: boolean; onRestore?: () => void }) {
  const text = blockPlain(block).replace(/\s+/g, ' ').trim()
  return (
    <div className="bk-gone" role="note">
      <span>
        지운 {blockKindName(block, first)} · 「{text.slice(0, 20)}
        {text.length > 20 ? '…' : ''}」
      </span>
      {onRestore && (
        <button className="btn sm" onMouseDown={(e) => e.preventDefault()} onClick={onRestore}>
          되살리기
        </button>
      )}
    </div>
  )
}

/**
 * 장 하나의 블록 편집 면. text 는 장 원문, baseText 는 편집을 시작할 때의 장(바뀐 곳 칠 기준, 새 장이면 null).
 * readOnly 면 AI 제안 미리보기 — 같은 칠 규칙으로 그리되 고칠 수 없다
 */
export default function BlockSurface({
  text,
  baseText,
  preamble,
  readOnly = false,
  showMarks,
  onChange,
  renderMd,
  tools,
  children,
  label,
}: {
  text: string
  baseText: string | null
  preamble: boolean
  readOnly?: boolean
  showMarks: boolean
  onChange?: (text: string) => void
  renderMd: (text: string) => ReactNode
  /** 도구줄 오른쪽(장 단위 단추) */
  tools?: ReactNode
  /** 도구줄 바로 밑(AI 부탁 칸 등) */
  children?: ReactNode
  label: string
}) {
  const [model, setModel] = useState<SectionModel>(() => parseSection(text, { preamble }))
  const modelRef = useRef(model)
  const emitted = useRef(text)
  const focus = useRef<{ key: string; at: 'start' | 'end' } | null>(null)
  const hold = useRef(false)
  const active = useRef<{ id: string; el: HTMLElement } | null>(null)
  const savedRange = useRef<Range | null>(null)
  const [menu, setMenu] = useState<'block' | 'callout' | 'link' | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const ctx = useMemo<SurfaceCtx>(() => ({ readOnly, focus, hold }), [readOnly])

  // 밖에서 바뀐 장(되돌리기·AI 받기·원문 보기)은 다시 읽는다 — 내가 낸 글이면 그대로 둔다
  useEffect(() => {
    if (text === emitted.current) return
    emitted.current = text
    const m = parseSection(text, { preamble })
    modelRef.current = m
    setModel(m)
  }, [text, preamble])

  const commit = useCallback(
    (next: SectionModel) => {
      modelRef.current = next
      setModel(next)
      const t = serializeSection(next)
      emitted.current = t
      onChange?.(t)
    },
    [onChange],
  )
  const update = (id: string, node: BlockNode | null, f?: { key: string; at: 'start' | 'end' }) => {
    if (f) focus.current = f
    const m = modelRef.current
    commit(node ? replaceBlock(m, id, (b) => withNode(b, node)) : removeBlock(m, id))
  }

  const baseModel = useMemo(() => (baseText === null ? null : parseSection(baseText, { preamble })), [baseText, preamble])
  const aligned = useMemo(() => alignBlocks(baseModel?.blocks ?? [], model.blocks), [baseModel, model])

  const activeIndex = () => {
    const id = active.current?.id
    const i = id ? modelRef.current.blocks.findIndex((b) => b.id === id) : -1
    return i
  }
  const insertAfterActive = (node: BlockNode, sub: string) => {
    const m = modelRef.current
    const i = activeIndex()
    const at = i >= 0 ? i + 1 : m.blocks.length
    const next = insertBlock(m, at, node)
    focus.current = { key: `${next.blocks[at].id}:${sub}`, at: 'end' }
    commit(next)
  }

  const fmt = (cmd: 'bold') => {
    if (!active.current || !document.contains(active.current.el)) return setHint('고칠 글자를 먼저 골라 주세요')
    document.execCommand('styleWithCSS', false, 'false')
    document.execCommand(cmd)
  }
  const openLink = () => {
    const el = active.current?.el
    const sel = window.getSelection()
    if (!el || !document.contains(el) || !sel || sel.rangeCount === 0 || !el.contains(sel.getRangeAt(0).startContainer)) {
      setHint('링크를 걸 글자를 먼저 골라 주세요')
      return
    }
    savedRange.current = sel.getRangeAt(0).cloneRange()
    hold.current = true
    setMenu('link')
  }
  const putLink = (href: string, title: string) => {
    const el = active.current?.el
    const r = savedRange.current
    setMenu(null)
    hold.current = false
    if (!el || !r) return
    el.focus()
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(r)
    if (r.collapsed) document.execCommand('insertHTML', false, `<a href="${esc(href)}">${esc(title)}</a>`)
    else document.execCommand('createLink', false, href)
  }
  const toList = (ordered: boolean) => {
    const i = activeIndex()
    const b = i >= 0 ? modelRef.current.blocks[i] : null
    if (b?.node.k === 'para') {
      focus.current = { key: `${b.id}:i0`, at: 'end' }
      update(b.id, paraToList(b.node.inl, ordered))
    } else if (b?.node.k === 'list') update(b.id, { k: 'list', items: relist(b.node.items, ordered) })
    else insertAfterActive({ k: 'list', items: [newItem([], 0, ordered)] }, 'i0')
  }

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 2500)
    return () => clearTimeout(t)
  }, [hint])

  const blockView = (b: Block, base: Block | null, mark: Mark, index: number) => {
    const n = b.node
    const first = index === 0
    const fk = (sub: string) => `${b.id}:${sub}`
    const before = mark === 'changed' && base ? blockPlain(base) : null
    const inline = (inl: Inline[], props: { single?: boolean; className?: string; label: string; placeholder?: string; onKey?: Parameters<typeof InlineEdit>[0]['onKey'] }) => (
      <InlineEdit
        fkey={fk('t')}
        nodes={inl}
        marks={marksOf(showMarks, before, plainInline(inl))}
        onInput={(v) => update(b.id, { ...(n as Extract<BlockNode, { inl: Inline[] }>), inl: v })}
        {...props}
      />
    )
    /** 문단·제목에서 Enter — 커서 뒤를 새 문단으로 */
    const splitKey: Parameters<typeof InlineEdit>[0]['onKey'] = (e, el) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        const parts = splitAtCaret(el, n.k === 'heading')
        if (!parts) return
        const m = modelRef.current
        const i = m.blocks.findIndex((x) => x.id === b.id)
        const withBefore = replaceBlock(m, b.id, (x) => withNode(x, { ...(n as Extract<BlockNode, { inl: Inline[] }>), inl: parts.before }))
        const next = insertBlock(withBefore, i + 1, { k: 'para', inl: parts.after })
        focus.current = { key: `${next.blocks[i + 1].id}:t`, at: 'start' }
        commit(next)
      } else if (e.key === 'Backspace' && n.k === 'para' && el.textContent === '' && !el.querySelector('.ib-mask, .ib-todo')) {
        e.preventDefault()
        const m = modelRef.current
        const i = m.blocks.findIndex((x) => x.id === b.id)
        const prev = m.blocks[i - 1]
        if (prev) focus.current = { key: `${prev.id}:t`, at: 'end' }
        commit(removeBlock(m, b.id))
      } else if (e.key === 'Backspace' && n.k === 'para' && caretAtStart(el)) {
        // 문단 맨 앞 Backspace 는 아무것도 하지 않는다 — 앞 블록과 합치면 모양이 바뀔 수 있어 고치지 않은 블록까지 다시 쓰게 된다
        e.preventDefault()
      }
    }
    switch (n.k) {
      case 'heading':
        return (
          <div className="bk-heading">
            {inline(n.inl, { single: true, className: `bk-h bk-h${n.level}`, label: first && n.level === 2 ? '장 제목' : '작은 제목', onKey: splitKey })}
            <span className="bk-side muted">{first && n.level === 2 ? '장 제목' : '작은 제목'}</span>
          </div>
        )
      case 'para':
        return inline(n.inl, { className: 'bk-p', label: '문단', placeholder: '글을 적어 주세요', onKey: splitKey })
      case 'quote': {
        const kind = calloutKind(n.inl)
        return (
          <div className={`bk-callout bk-callout-${kind.id}`}>
            <span className="bk-callout-kind">{kind.label}</span>
            {inline(n.inl, { className: 'bk-callout-text', label: `주의 상자 · ${kind.label}` })}
          </div>
        )
      }
      case 'list':
        return (
          <ListEdit
            block={b as Block & { node: ListNode }}
            base={base?.node.k === 'list' ? base.node : null}
            mark={mark}
            show={showMarks}
            focusKey={fk}
            onNode={(node, f) => update(b.id, node, f)}
            onExit={(items) => {
              const m = modelRef.current
              const i = m.blocks.findIndex((x) => x.id === b.id)
              const kept = items.length ? replaceBlock(m, b.id, (x) => withNode(x, { k: 'list', items })) : removeBlock(m, b.id)
              const at = items.length ? i + 1 : i
              const next = insertBlock(kept, at, { k: 'para', inl: [] })
              focus.current = { key: `${next.blocks[at].id}:t`, at: 'start' }
              commit(next)
            }}
          />
        )
      case 'table':
        return (
          <TableEdit
            block={b as Block & { node: TableNode }}
            base={base?.node.k === 'table' ? base.node : null}
            mark={mark}
            show={showMarks}
            focusKey={fk}
            onNode={(node, f) => update(b.id, node, f)}
          />
        )
      case 'hr':
        return <hr className="bk-hr" />
      case 'scope':
        return (
          <div className="bk-locked" role="note">
            <span className="bk-locked-label">
              <EditIcon name="lock" /> 문서 머리 칩으로 보이는 적용대상 줄이에요 · 원문 보기에서 고칠 수 있어요
            </span>
            <div className="md bk-locked-md">{renderMd(b.raw)}</div>
          </div>
        )
      case 'unknown':
        return (
          <div className="bk-unknown" role="note">
            <span className="bk-locked-label">이 부분은 원문 보기에서 고칠 수 있어요 · {n.why}</span>
            <div className="md bk-locked-md">{renderMd(b.raw)}</div>
          </div>
        )
    }
  }

  const firstH2 = (b: Block, i: number) => i === 0 && b.node.k === 'heading' && b.node.level === 2 && !preamble

  return (
    <Ctx.Provider value={ctx}>
      <div
        className={`bk-surface${readOnly ? ' readonly' : ''}${showMarks ? '' : ' marks-off'}`}
        aria-label={label}
        onFocus={(e) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>('[data-inl]')
          const bid = (e.target as HTMLElement).closest<HTMLElement>('[data-bid]')?.dataset.bid
          if (el && bid) active.current = { id: bid, el }
        }}
      >
        {!readOnly && (
          <div className="sec-toolbar bk-toolbar" role="toolbar" aria-label="편집 도구줄">
            <button className="btn sm" title="굵게 (Ctrl+B)" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt('bold')}>
              <EditIcon name="bold" /> 굵게
            </button>
            <button className="btn sm" onMouseDown={(e) => e.preventDefault()} onClick={openLink}>
              <EditIcon name="link" /> 링크
            </button>
            <button className="btn sm" onMouseDown={(e) => e.preventDefault()} onClick={() => toList(false)}>
              <EditIcon name="list" /> 목록
            </button>
            <button className="btn sm" onMouseDown={(e) => e.preventDefault()} onClick={() => toList(true)}>
              <EditIcon name="listOrdered" /> 번호
            </button>
            <span className="bk-menu-wrap">
              <button className="btn sm" aria-expanded={menu === 'block'} onMouseDown={(e) => e.preventDefault()} onClick={() => setMenu((m) => (m === 'block' ? null : 'block'))}>
                <EditIcon name="plus" /> 블록 ▾
              </button>
              {menu === 'block' && (
                <span className="bk-menu" role="menu">
                  {(
                    [
                      ['문단', () => insertAfterActive({ k: 'para', inl: [] }, 't')],
                      ['작은 제목', () => insertAfterActive({ k: 'heading', level: 3, inl: [{ t: 'text', v: '작은 제목' }] }, 't')],
                      ['표 (2칸)', () => insertAfterActive(newTable(), 'r0c0')],
                      ['구분선', () => insertAfterActive({ k: 'hr' }, 't')],
                    ] as const
                  ).map(([name, run]) => (
                    <button
                      key={name}
                      role="menuitem"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setMenu(null)
                        run()
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </span>
              )}
            </span>
            <span className="bk-menu-wrap">
              <button className="btn sm" aria-expanded={menu === 'callout'} onMouseDown={(e) => e.preventDefault()} onClick={() => setMenu((m) => (m === 'callout' ? null : 'callout'))}>
                <EditIcon name="callout" /> 주의 상자 ▾
              </button>
              {menu === 'callout' && (
                <span className="bk-menu" role="menu">
                  {CALLOUTS.map((c) => (
                    <button
                      key={c.id}
                      role="menuitem"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setMenu(null)
                        insertAfterActive(newCallout(c.id), 't')
                      }}
                    >
                      {c.label}
                    </button>
                  ))}
                </span>
              )}
            </span>
            <span className="bk-tool-gap" />
            {tools}
            {hint && (
              <span className="bk-hint" role="status">
                {hint}
              </span>
            )}
            {menu === 'link' && (
              <LinkPicker
                onPick={putLink}
                onClose={() => {
                  hold.current = false
                  setMenu(null)
                }}
              />
            )}
          </div>
        )}
        {children}
        <div className="md bk-blocks">
          {aligned.map((a) => {
            if (a.k === 'gone') {
              if (!showMarks) return null
              const restore = readOnly
                ? undefined
                : () => {
                    focus.current = null
                    commit(insertBlock(modelRef.current, a.at, a.base.node, a.base.raw, a.base.lead))
                  }
              return <GoneBlock key={`gone-${a.base.id}`} block={a.base} first={baseModel?.blocks[0] === a.base} onRestore={restore} />
            }
            const b = a.now
            const mark = baseText === null ? 'new' : a.mark
            const cls = showMarks && mark !== 'same' ? ` bk-${mark}` : ''
            return (
              <div key={b.id} className={`bk bk-${b.node.k}${cls}`} data-bid={b.id}>
                {showMarks && mark === 'new' && baseText !== null && <span className="bk-newchip">새로</span>}
                {blockView(b, a.base, mark, a.index)}
                {!readOnly && !firstH2(b, a.index) && (
                  <button
                    className="bk-del"
                    title="이 블록 지우기 — 지운 자리에서 되살릴 수 있어요"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commit(removeBlock(modelRef.current, b.id))}
                  >
                    지우기
                  </button>
                )}
              </div>
            )
          })}
          {model.blocks.length === 0 && !readOnly && (
            <button className="btn sm" onClick={() => insertAfterActive({ k: 'para', inl: [] }, 't')}>
              ＋ 문단 넣기
            </button>
          )}
        </div>
      </div>
    </Ctx.Provider>
  )
}

