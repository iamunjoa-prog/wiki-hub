import { diffArrays, diffWords } from 'diff'
import { MASKED } from './docEdit'

/**
 * 보이는 모양 편집(블록 편집)의 바탕 — 장 원문을 블록으로 나누고, 고친 블록만 다시 마크다운으로 쓴다
 * (docs/ux/2026-11-25-doc-editing.md 1-1·7절 R1·R2). 화면(DOM) 없이 도는 순수 함수만 둔다.
 *
 * 지키는 규칙
 * - 블록은 원문 위치(start·end)와 원문 글자(raw)를 들고 있다. 손대지 않은 블록은 raw 그대로 다시 잇는다 — 열고 닫기만 하면 변경 0.
 * - 블록을 편집할 수 있는 건 "읽은 모양을 다시 쓰면 원문과 글자 하나 다르지 않을 때"뿐이다. 아니면 모르는 블록(회색 상자)으로 그대로 둔다.
 * - 표는 행마다, 목록은 항목마다 원문을 따로 든다 — 칸 하나를 고치면 그 한 줄만 바뀐다.
 */

// ── 글 안 모양(인라인) ──

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; c: Inline[] }
  | { t: 'italic'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  /** 가린 표기(구*화) — 잠긴 칩. 글자를 채울 수 없다 */
  | { t: 'mask'; v: string }
  /** (보완 필요) — 눌러서 내용으로 바꾸는 칩 */
  | { t: 'todo' }

export const TODO_MARK = '(보완 필요)'
const MASK_AT = new RegExp(MASKED.source, 'y')
const HANGUL = /[가-힣]/
const SPACE = /\s/
const UNDERSCORE_PAIR = /(?:^|[^\p{L}\p{N}_])_+[^_\s](?:[^_]*[^_\s])?_+(?![\p{L}\p{N}_])/u

type Close = '**' | '*' | ']' | null

/** 글 안 모양 읽기 — 화면이 모르는 표기가 있으면 null(그 블록은 원문 그대로 둔다) */
export function parseInline(src: string): Inline[] | null {
  // `_기울임_` 처럼 밑줄이 짝을 이룰 수 있으면 모르는 모양 — 파일 이름의 `시스템(ACS)_사용자` 같은 밑줄은 글자 그대로
  if (UNDERSCORE_PAIR.test(src)) return null
  const r = readSeq(src, 0, null)
  if (!r || r[1] !== src.length) return null
  return renderInline(r[0]) === src ? r[0] : null
}

function readSeq(src: string, from: number, close: Close): [Inline[], number] | null {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf })
    buf = ''
  }
  let i = from
  while (i < src.length) {
    const ch = src[i]
    if (close === '**' && src.startsWith('**', i)) {
      flush()
      return [out, i + 2]
    }
    if (close === '*' && ch === '*' && src[i + 1] !== '*' && i > from && !SPACE.test(src[i - 1])) {
      flush()
      return [out, i + 1]
    }
    if (close === ']' && ch === ']') {
      flush()
      return [out, i + 1]
    }
    // 가린 표기는 한글 덩어리 시작에서만 잡는다 — maskLeaks 의 MASKED 전역 검색과 같은 자리를 잡게
    if (HANGUL.test(ch) && !(i > 0 && HANGUL.test(src[i - 1]))) {
      MASK_AT.lastIndex = i
      const m = MASK_AT.exec(src)
      if (m) {
        flush()
        out.push({ t: 'mask', v: m[0] })
        i += m[0].length
        continue
      }
    }
    if (src.startsWith(TODO_MARK, i)) {
      flush()
      out.push({ t: 'todo' })
      i += TODO_MARK.length
      continue
    }
    // 화면이 모르는 표기 — 다시 쓸 때 모양이 바뀔 수 있어 블록째 원문으로 둔다
    if (ch === '\\' || src.startsWith('~~', i) || src.startsWith('![', i) || src.startsWith('[^', i) || src.startsWith('***', i)) return null
    if (ch === '<' && /[A-Za-z/!?]/.test(src[i + 1] ?? '')) return null
    if (ch === '&' && /^&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(src.slice(i, i + 12))) return null
    if (ch === '`') {
      if (src[i + 1] === '`') return null
      const end = src.indexOf('`', i + 1)
      if (end < 0) return null
      flush()
      out.push({ t: 'code', v: src.slice(i + 1, end) })
      i = end + 1
      continue
    }
    if (src.startsWith('**', i)) {
      const r = readSeq(src, i + 2, '**')
      if (!r) return null
      flush()
      out.push({ t: 'bold', c: r[0] })
      i = r[1]
      continue
    }
    if (ch === '*' && close !== '*' && src[i + 1] !== undefined && !SPACE.test(src[i + 1])) {
      const r = readSeq(src, i + 1, '*')
      if (r) {
        flush()
        out.push({ t: 'italic', c: r[0] })
        i = r[1]
        continue
      }
      // 닫는 별표가 없으면 글자 그대로 (예: PPC-P-*)
    }
    if (ch === '[') {
      const r = readSeq(src, i + 1, ']')
      const href = r && src[r[1]] === '(' ? readHref(src, r[1] + 1) : null
      if (r && href) {
        flush()
        out.push({ t: 'link', href: href[0], c: r[0] })
        i = href[1]
        continue
      }
    }
    buf += ch
    i++
  }
  if (close) return null
  flush()
  return [out, i]
}

/** `(주소)` — 문서 앵커에 괄호가 들어가도(LINK 규칙과 같게) 짝을 맞춰 읽는다 */
function readHref(src: string, from: number): [string, number] | null {
  let depth = 0
  for (let j = from; j < src.length; j++) {
    const c = src[j]
    if (SPACE.test(c)) return null
    if (c === '(') depth++
    else if (c === ')') {
      if (depth === 0) return j > from ? [src.slice(from, j), j + 1] : null
      depth--
    }
  }
  return null
}

export function renderInline(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
          return n.v
        case 'bold':
          return `**${renderInline(n.c)}**`
        case 'italic':
          return `*${renderInline(n.c)}*`
        case 'code':
          return n.v.includes('`') ? `\`\` ${n.v} \`\`` : `\`${n.v}\``
        case 'link':
          return `[${renderInline(n.c)}](${n.href})`
        case 'mask':
          return n.v
        case 'todo':
          return TODO_MARK
      }
    })
    .join('')
}

/** 화면에 보이는 글자 — 비교 카드·바뀐 단어 칠에 쓴다 */
export function plainInline(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
        case 'code':
        case 'mask':
          return n.v
        case 'todo':
          return TODO_MARK
        default:
          return plainInline(n.c)
      }
    })
    .join('')
}

/**
 * 편집 칸에서 읽은 글 안 모양을 다듬는다 — 이웃한 글자·같은 굵게를 합치고, 굵게 앞뒤 빈칸은 밖으로 뺀다
 * (`** 글**` 은 마크다운에서 굵게가 안 된다)
 */
export function normalizeInline(nodes: Inline[], inside: 'bold' | 'italic' | null = null): Inline[] {
  const out: Inline[] = []
  const push = (n: Inline) => {
    const last = out[out.length - 1]
    if (n.t === 'text') {
      if (!n.v) return
      if (last?.t === 'text') {
        out[out.length - 1] = { t: 'text', v: last.v + n.v }
        return
      }
    }
    if ((n.t === 'bold' || n.t === 'italic') && last?.t === n.t) {
      out[out.length - 1] = { t: n.t, c: normalizeInline([...last.c, ...n.c], n.t) }
      return
    }
    out.push(n)
  }
  for (const n of nodes) {
    if (n.t === 'bold' || n.t === 'italic') {
      // 굵게 안의 굵게는 한 겹으로
      if (inside === n.t) {
        for (const c of normalizeInline(n.c, inside)) push(c)
        continue
      }
      const c = normalizeInline(n.c, n.t)
      const text = plainInline(c)
      if (!text.trim()) {
        if (text) push({ t: 'text', v: text })
        continue
      }
      const lead = /^\s*/.exec(text)![0]
      const trail = /\s*$/.exec(text)![0]
      if (lead) push({ t: 'text', v: lead })
      push({ t: n.t, c: trimEdges(c, lead.length, trail.length) })
      if (trail) push({ t: 'text', v: trail })
    } else if (n.t === 'link') {
      const c = normalizeInline(n.c)
      if (plainInline(c)) push({ ...n, c })
    } else if (n.t === 'code') {
      if (n.v) push(n)
    } else push(n)
  }
  return out
}

/** 앞뒤 빈칸 글자 수만큼 첫·끝 글 조각에서 걷어 낸다 — 빈칸은 늘 글 조각에 있으므로 거기서만 자른다 */
function trimEdges(nodes: Inline[], lead: number, trail: number): Inline[] {
  const out = nodes.map((n) => ({ ...n }))
  if (lead && out[0]?.t === 'text') out[0] = { t: 'text', v: out[0].v.slice(lead) }
  const last = out.length - 1
  if (trail && out[last]?.t === 'text') out[last] = { t: 'text', v: out[last].v.slice(0, out[last].v.length - trail) }
  return out.filter((n) => n.t !== 'text' || n.v)
}

// ── 블록 ──

export interface ListItem {
  indent: string
  /** `-`, `*`, `1.` 처럼 원문 기호 그대로 */
  marker: string
  /** 기호 뒤 빈칸 */
  gap: string
  /** `[ ] ` 할 일 표시 — 잠긴 채로 둔다 */
  task: string
  inl: Inline[]
  /** 항목이 여러 줄일 때 이어지는 줄의 들여쓰기 */
  cont: string
}

export interface TableRow {
  raw: string
  cells: Inline[][]
}

export type BlockNode =
  | { k: 'heading'; level: number; inl: Inline[] }
  | { k: 'para'; inl: Inline[] }
  /** `>` 인용 — 화면에서는 주의 상자 */
  | { k: 'quote'; inl: Inline[] }
  /** 목록 — 읽을 때 항목마다 다시 써도 원문과 같은지 확인했으므로 항목에서 바로 쓴다 */
  | { k: 'list'; items: ListItem[] }
  | { k: 'table'; head: TableRow; sep: string; aligns: string[]; rows: TableRow[] }
  | { k: 'hr' }
  /** 문서 첫 줄 적용대상 — 문서 머리 칩으로 보이므로 잠근다(1-1, 1차) */
  | { k: 'scope' }
  /** 화면이 모르는 모양 — 회색 상자로 그대로 둔다(R2) */
  | { k: 'unknown'; why: string }

export interface Block {
  id: string
  /** 앞 블록과의 사이(빈 줄) — 그대로 되살린다 */
  lead: string
  /** 원문 글자. 손대지 않은 블록은 처음 읽은 그대로다 */
  raw: string
  /** 장 원문에서의 위치 [start, end). 편집으로 생긴 블록은 -1 */
  start: number
  end: number
  node: BlockNode
}

export interface SectionModel {
  blocks: Block[]
  /** 마지막 블록 뒤(다음 장과의 빈 줄) */
  tail: string
}

let uid = 0
export const newBlockId = () => `b${++uid}`

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6})(?:[ \t]+(.*))?$/
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const QUOTE = /^\s{0,3}>/
const TABLE_LINE = /^\s*\|/
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
export const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])( +)(\[[ xX]\] +)?(.*)$/
const HTML = /^\s*<[A-Za-z!/?]/
const DEF = /^\s*\[[^\]]+\]:/
const BLANK = /^\s*$/

/** 문단을 끊는 줄 — 다음 블록이 시작한다 */
function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    HTML.test(line) ||
    (TABLE_LINE.test(line) && next !== undefined && TABLE_SEP.test(next) && next.includes('|'))
  )
}

/** 표 한 줄을 칸으로 — `\|` 는 칸 나눔이 아니다 */
export function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '\\|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur)
      cur = ''
    } else cur += s[i]
  }
  cells.push(cur)
  return cells.map((c) => c.trim())
}

/** 칸 안 `|` 는 칸 나눔이 되지 않게 `\|` 로 */
export const escapePipe = (s: string) => s.replace(/\|/g, '\\|')
const unescapePipe = (s: string) => s.replace(/\\\|/g, '|')

function readCell(src: string): Inline[] | null {
  const inl = parseInline(unescapePipe(src))
  return inl && escapePipe(renderInline(inl)) === src ? inl : null
}

export function renderRow(cells: Inline[][]): string {
  return `| ${cells.map((c) => escapePipe(renderInline(c)).replace(/\n/g, ' ')).join(' | ')} |`
}

export function renderItem(it: ListItem): string {
  const [first, ...rest] = renderInline(it.inl).split('\n')
  return `${it.indent}${it.marker}${it.gap}${it.task}${first}${rest.map((l) => `\n${it.cont}${l}`).join('')}`
}

function renderQuote(inl: Inline[]): string {
  return renderInline(inl)
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n')
}

/** 블록 모양을 마크다운으로 — 고친 블록에만 쓴다. 잠긴·모르는 블록은 원문 그대로 */
export function renderNode(node: BlockNode, raw: string): string {
  switch (node.k) {
    case 'heading':
      return `${'#'.repeat(node.level)} ${renderInline(node.inl)}`
    case 'para':
      return renderInline(node.inl)
    case 'quote':
      return renderQuote(node.inl)
    case 'list':
      return node.items.map(renderItem).join('\n')
    case 'table':
      return [node.head.raw, node.sep, ...node.rows.map((r) => r.raw)].join('\n')
    case 'hr':
      return raw || '---'
    default:
      return raw
  }
}

function readList(lines: string[]): BlockNode {
  const items: ListItem[] = []
  const raws: string[] = []
  for (const line of lines) {
    const m = LIST_ITEM.exec(line)
    if (m) {
      items.push({ indent: m[1], marker: m[2], gap: m[3], task: m[4] ?? '', inl: [], cont: '' })
      raws.push(line)
      continue
    }
    const it = items[items.length - 1]
    const cont = /^\s*/.exec(line)![0]
    // 이어지는 줄은 들여쓰기가 같을 때만 — 줄마다 다르면 다시 쓸 때 모양이 바뀐다
    if (raws[raws.length - 1].includes('\n') && cont !== it.cont) return { k: 'unknown', why: '여러 줄 목록' }
    it.cont = cont
    raws[raws.length - 1] += `\n${line}`
  }
  for (let i = 0; i < items.length; i++) {
    const m = LIST_ITEM.exec(raws[i].split('\n')[0])!
    const body = [m[5], ...raws[i].split('\n').slice(1).map((l) => l.slice(items[i].cont.length))].join('\n')
    const inl = parseInline(body)
    if (!inl) return { k: 'unknown', why: '목록 안 표기' }
    items[i].inl = inl
    if (renderItem(items[i]) !== raws[i]) return { k: 'unknown', why: '목록 모양' }
  }
  return { k: 'list', items }
}

function readTable(lines: string[]): BlockNode {
  const parse = (line: string): TableRow | null => {
    const cells: Inline[][] = []
    for (const c of splitRow(line)) {
      const inl = readCell(c)
      if (!inl) return null
      cells.push(inl)
    }
    return { raw: line, cells }
  }
  const head = parse(lines[0])
  const rows = lines.slice(2).map(parse)
  if (!head || rows.some((r) => !r)) return { k: 'unknown', why: '표 안 표기' }
  return { k: 'table', head, sep: lines[1], aligns: splitRow(lines[1]), rows: rows as TableRow[] }
}

function readQuote(lines: string[]): BlockNode {
  const content = lines.map((l) => l.replace(/^\s{0,3}> ?/, ''))
  if (content.some((c, i) => startsBlock(c, content[i + 1]) || TABLE_LINE.test(c))) return { k: 'unknown', why: '상자 안 모양' }
  const inl = parseInline(content.join('\n'))
  if (!inl || renderQuote(inl) !== lines.join('\n')) return { k: 'unknown', why: '상자 모양' }
  return { k: 'quote', inl }
}

/**
 * 장 원문을 블록으로 나눈다. 블록 사이 빈 줄은 lead·tail 로 들고 있어,
 * serializeSection(parseSection(t)) === t 가 어떤 글에서도 성립한다(R1 검수 스크립트가 43개 문서로 확인)
 */
export function parseSection(text: string, opts: { preamble?: boolean } = {}): SectionModel {
  const lines = text.split('\n')
  const starts: number[] = []
  let o = 0
  for (const l of lines) {
    starts.push(o)
    o += l.length + 1
  }
  const blocks: Block[] = []
  let prevEnd = 0
  const add = (from: number, to: number, node: BlockNode) => {
    const start = starts[from]
    const end = starts[to - 1] + lines[to - 1].length
    blocks.push({ id: newBlockId(), lead: text.slice(prevEnd, start), raw: text.slice(start, end), start, end, node })
    prevEnd = end
  }
  /** 빈 줄까지 — 모르는 블록의 끝 */
  const untilBlank = (from: number) => {
    let j = from + 1
    while (j < lines.length && !BLANK.test(lines[j])) j++
    return j
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (BLANK.test(line)) {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      let j = i + 1
      while (j < lines.length && !new RegExp(`^\\s*${fence[1]}`).test(lines[j])) j++
      const to = Math.min(j + 1, lines.length)
      add(i, to, { k: 'unknown', why: '코드 블록' })
      i = to
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      const level = h[1].length
      const inl = level >= 2 && level <= 4 ? parseInline(h[2] ?? '') : null
      const node: BlockNode = inl && `${h[1]} ${renderInline(inl)}` === line ? { k: 'heading', level, inl } : { k: 'unknown', why: '제목 모양' }
      add(i, i + 1, node)
      i++
      continue
    }
    if (HR.test(line)) {
      add(i, i + 1, { k: 'hr' })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      let j = i + 1
      while (j < lines.length && QUOTE.test(lines[j])) j++
      const scope = opts.preamble && blocks.length === 0 && /^> (대상 독자|적용대상) /.test(line)
      add(i, j, scope ? { k: 'scope' } : readQuote(lines.slice(i, j)))
      i = j
      continue
    }
    if (TABLE_LINE.test(line)) {
      let j = i + 1
      while (j < lines.length && TABLE_LINE.test(lines[j])) j++
      const sep = lines[i + 1]
      const ok = j - i >= 2 && TABLE_SEP.test(sep) && sep.includes('|')
      add(i, j, ok ? readTable(lines.slice(i, j)) : { k: 'unknown', why: '표 모양' })
      i = j
      continue
    }
    if (LIST_ITEM.test(line)) {
      let j = i + 1
      while (j < lines.length && !BLANK.test(lines[j]) && (LIST_ITEM.test(lines[j]) || !startsBlock(lines[j], lines[j + 1]))) j++
      add(i, j, readList(lines.slice(i, j)))
      i = j
      continue
    }
    if (HTML.test(line) || DEF.test(line) || /^( {4}|\t)/.test(line)) {
      const j = untilBlank(i)
      add(i, j, { k: 'unknown', why: HTML.test(line) ? 'HTML' : DEF.test(line) ? '각주·참조' : '들여 쓴 코드' })
      i = j
      continue
    }
    // 문단 — 빈 줄이나 다음 블록 시작까지. 바로 밑 `---`·`===` 는 제목 모양(setext)이라 통째로 원문으로 둔다
    let j = i + 1
    let setext = false
    while (j < lines.length && !BLANK.test(lines[j])) {
      if (SETEXT.test(lines[j])) {
        setext = true
        j++
        break
      }
      if (startsBlock(lines[j], lines[j + 1])) break
      j++
    }
    const inl = setext ? null : parseInline(lines.slice(i, j).join('\n'))
    add(i, j, inl ? { k: 'para', inl } : { k: 'unknown', why: setext ? '제목 모양' : '글 안 표기' })
    i = j
  }
  return { blocks, tail: text.slice(prevEnd) }
}

export function serializeSection(model: SectionModel): string {
  return model.blocks.map((b) => b.lead + b.raw).join('') + model.tail
}

// ── 편집 — 바꾼 블록만 raw 를 다시 쓴다 ──

export function withNode(block: Block, node: BlockNode): Block {
  return { ...block, node, raw: renderNode(node, block.raw) }
}

export function replaceBlock(model: SectionModel, id: string, next: Block | ((b: Block) => Block)): SectionModel {
  return { ...model, blocks: model.blocks.map((b) => (b.id === id ? (typeof next === 'function' ? next(b) : next) : b)) }
}

/** at 번째 앞에 끼운다. 맨 앞에 끼우면 장 첫머리 간격을 새 블록이 물려받는다 */
export function insertBlock(model: SectionModel, at: number, node: BlockNode, raw?: string, lead = '\n\n'): SectionModel {
  const blocks = [...model.blocks]
  const block: Block = { id: newBlockId(), lead, raw: raw ?? renderNode(node, ''), start: -1, end: -1, node }
  if (at === 0 && blocks.length > 0) {
    block.lead = blocks[0].lead
    blocks[0] = { ...blocks[0], lead: '\n\n' }
  } else if (blocks.length === 0) block.lead = model.tail ? '' : lead
  blocks.splice(at, 0, block)
  return { ...model, blocks }
}

export function removeBlock(model: SectionModel, id: string): SectionModel {
  const i = model.blocks.findIndex((b) => b.id === id)
  if (i < 0) return model
  const blocks = model.blocks.filter((b) => b.id !== id)
  if (i === 0 && blocks.length > 0) blocks[0] = { ...blocks[0], lead: model.blocks[0].lead }
  return { ...model, blocks }
}

export const emptyRow = (n: number): Inline[][] => Array.from({ length: n }, () => [])

export function tableWidth(node: Extract<BlockNode, { k: 'table' }>) {
  return Math.max(node.head.cells.length, node.aligns.length, ...node.rows.map((r) => r.cells.length))
}

/**
 * 행 원문에서 칸 하나의 글자만 바꾼다 — 칸 앞뒤 빈칸·다른 칸 모양은 원문 그대로(R1). 칸 자리를 못 찾으면 null
 */
function replaceCellRaw(raw: string, col: number, content: string): string | null {
  const bars: number[] = []
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && raw[i + 1] === '|') i++
    else if (raw[i] === '|') bars.push(i)
  }
  // 앞뒤 `|` 가 있는 행만 — `| a | b |` 의 칸 col 은 bars[col]~bars[col+1] 사이
  if (!raw.trimStart().startsWith('|') || !raw.trimEnd().endsWith('|') || col + 1 >= bars.length) return null
  const seg = raw.slice(bars[col] + 1, bars[col + 1])
  const lead = /^\s*/.exec(seg)![0] || ' '
  const trail = seg.trim() ? /\s*$/.exec(seg)![0] || ' ' : seg.length > 1 ? seg.slice(1) : ' '
  const next = content ? `${lead}${content}${trail}` : seg.trim() ? ' ' : seg
  return raw.slice(0, bars[col] + 1) + next + raw.slice(bars[col + 1])
}

/** 칸 하나 — 그 행의 그 칸 글자만 바꾼다. 글이 그대로면 행도 그대로. row -1 은 머리 줄 */
export function setCell(node: Extract<BlockNode, { k: 'table' }>, row: number, col: number, inl: Inline[]): BlockNode {
  const fix = (r: TableRow): TableRow => {
    if (renderInline(r.cells[col] ?? []) === renderInline(inl)) return r
    const cells = [...r.cells]
    while (cells.length <= col) cells.push([])
    cells[col] = inl
    const content = escapePipe(renderInline(inl)).replace(/\n/g, ' ')
    return { cells, raw: replaceCellRaw(r.raw, col, content) ?? renderRow(cells) }
  }
  if (row < 0) return { ...node, head: fix(node.head) }
  return { ...node, rows: node.rows.map((r, i) => (i === row ? fix(r) : r)) }
}

export function addRow(node: Extract<BlockNode, { k: 'table' }>, at: number): BlockNode {
  const cells = emptyRow(tableWidth(node))
  const rows = [...node.rows]
  rows.splice(at, 0, { cells, raw: renderRow(cells) })
  return { ...node, rows }
}

export function removeRow(node: Extract<BlockNode, { k: 'table' }>, at: number): BlockNode {
  return { ...node, rows: node.rows.filter((_, i) => i !== at) }
}

/** 지운 행 되살리기 — 원문 줄 그대로 */
export function restoreRow(node: Extract<BlockNode, { k: 'table' }>, at: number, row: TableRow): BlockNode {
  const rows = [...node.rows]
  rows.splice(at, 0, row)
  return { ...node, rows }
}

/** 열을 넣고 빼면 모든 행이 바뀐다 — 피할 수 없는 변경이다 */
export function addCol(node: Extract<BlockNode, { k: 'table' }>, at: number): BlockNode {
  const w = tableWidth(node)
  const fix = (r: TableRow): TableRow => {
    const cells = [...r.cells]
    while (cells.length < w) cells.push([])
    cells.splice(at, 0, [])
    return { cells, raw: renderRow(cells) }
  }
  const aligns = [...node.aligns]
  while (aligns.length < w) aligns.push('---')
  aligns.splice(at, 0, '---')
  return { ...node, head: fix(node.head), rows: node.rows.map(fix), aligns, sep: `| ${aligns.join(' | ')} |` }
}

export function removeCol(node: Extract<BlockNode, { k: 'table' }>, at: number): BlockNode {
  if (tableWidth(node) <= 1) return node
  const fix = (r: TableRow): TableRow => {
    const cells = r.cells.filter((_, i) => i !== at)
    return { cells, raw: renderRow(cells) }
  }
  const aligns = node.aligns.filter((_, i) => i !== at)
  return { ...node, head: fix(node.head), rows: node.rows.map(fix), aligns, sep: `| ${aligns.join(' | ')} |` }
}

export function newTable(): BlockNode {
  const head: Inline[][] = [[{ t: 'text', v: '항목' }], [{ t: 'text', v: '내용' }]]
  const row = emptyRow(2)
  return { k: 'table', head: { cells: head, raw: renderRow(head) }, sep: '| --- | --- |', aligns: ['---', '---'], rows: [{ cells: row, raw: renderRow(row) }] }
}

/** 목록 전체를 글머리 ↔ 번호로 바꾼다 — 번호는 들여쓰기마다 1부터 */
export function relist(items: ListItem[], ordered: boolean): ListItem[] {
  const out: ListItem[] = []
  for (const it of items) {
    if (isOrdered(it.marker) === ordered) {
      out.push(it)
      continue
    }
    const marker = nextMarker(out, out.length, ordered, it.indent)
    out.push({ ...it, marker, cont: it.indent + ' '.repeat(marker.length + it.gap.length) })
  }
  return out
}

/** Tab — 앞 항목 밑으로 한 칸. 앞 항목 글자 시작 자리까지 들여 써야 마크다운이 하위 목록으로 읽는다 */
export function indentItem(items: ListItem[], at: number): ListItem[] {
  const prev = items[at - 1]
  if (!prev || prev.indent.length < items[at].indent.length) return items
  const indent = prev.indent + ' '.repeat(prev.marker.length + prev.gap.length)
  return moveItem(items, at, indent)
}

/** Shift+Tab — 한 단계 밖으로 */
export function outdentItem(items: ListItem[], at: number): ListItem[] {
  const cur = items[at]
  if (!cur.indent) return items
  const parent = items.slice(0, at).reverse().find((it) => it.indent.length < cur.indent.length)
  return moveItem(items, at, parent?.indent ?? '')
}

function moveItem(items: ListItem[], at: number, indent: string): ListItem[] {
  const cur = items[at]
  const marker = isOrdered(cur.marker) ? nextMarker(items, at, true, indent) : cur.marker
  const next = [...items]
  next[at] = { ...cur, indent, marker, cont: indent + ' '.repeat(marker.length + cur.gap.length) }
  return next
}

/** 화면에 보일 번호·깊이 — 마크다운처럼 같은 들여쓰기 안에서 첫 번호부터 차례로 센다 */
export function listLayout(items: ListItem[]): { depth: number; label: string }[] {
  const stack: { len: number; next: number }[] = []
  return items.map((it) => {
    const len = it.indent.length
    while (stack.length && stack[stack.length - 1].len > len) stack.pop()
    let top = stack[stack.length - 1]
    if (!top || top.len < len) {
      top = { len, next: parseInt(it.marker, 10) || 1 }
      stack.push(top)
    }
    const depth = stack.length - 1
    const label = isOrdered(it.marker) ? `${top.next++}.` : '•'
    return { depth, label }
  })
}

export const isOrdered = (marker: string) => /^\d/.test(marker)

/** 같은 들여쓰기의 앞 항목 번호 다음 — 새 번호 항목에 쓴다 */
export function nextMarker(items: ListItem[], at: number, ordered: boolean, indent: string): string {
  if (!ordered) {
    const prev = items.slice(0, at).reverse().find((it) => it.indent === indent && !isOrdered(it.marker))
    return prev?.marker ?? '-'
  }
  const prev = items.slice(0, at).reverse().find((it) => it.indent === indent && isOrdered(it.marker))
  if (!prev) return '1.'
  return `${parseInt(prev.marker, 10) + 1}${prev.marker.slice(-1)}`
}

export function newItem(items: ListItem[], at: number, ordered: boolean, indent = '', inl: Inline[] = []): ListItem {
  const marker = nextMarker(items, at, ordered, indent)
  return { indent, marker, gap: ' ', task: '', inl, cont: indent + ' '.repeat(marker.length + 1) }
}

/** 문단 줄마다 목록 항목으로 */
export function paraToList(inl: Inline[], ordered: boolean): BlockNode {
  const lines = splitLines(inl)
  const items: ListItem[] = []
  for (const l of lines) items.push(newItem(items, items.length, ordered, '', l))
  return { k: 'list', items }
}

/** 줄바꿈(\n) 기준으로 글 안 모양을 나눈다 */
export function splitLines(inl: Inline[]): Inline[][] {
  const out: Inline[][] = [[]]
  for (const n of inl) {
    if (n.t !== 'text' || !n.v.includes('\n')) {
      out[out.length - 1].push(n)
      continue
    }
    const parts = n.v.split('\n')
    parts.forEach((p, i) => {
      if (i > 0) out.push([])
      if (p) out[out.length - 1].push({ t: 'text', v: p })
    })
  }
  return out
}

/** 주의 상자 종류 — 첫 글자로 정한다. 새로 넣을 때의 첫머리 글도 여기서 */
export const CALLOUTS = [
  { id: 'check', label: '확인 필요', head: '확인 필요: ' },
  { id: 'warn', label: '주의', head: '**주의** ' },
  { id: 'note', label: '참고', head: '' },
] as const

export function calloutKind(inl: Inline[]): (typeof CALLOUTS)[number] {
  const src = renderInline(inl).trimStart()
  if (/^\**확인 필요/.test(src)) return CALLOUTS[0]
  if (/^\**(주의|경고)/.test(src)) return CALLOUTS[1]
  return CALLOUTS[2]
}

export function newCallout(id: (typeof CALLOUTS)[number]['id']): BlockNode {
  const head = CALLOUTS.find((c) => c.id === id)!.head
  return { k: 'quote', inl: parseInline(head.trimEnd() ? `${head}내용을 적어 주세요` : '내용을 적어 주세요')! }
}

// ── 바뀐 곳 — 원문 글자만으로 계산한다. 블록 편집·원문 보기·AI 제안 어느 길로 바꿨든 같은 결과 ──

export type Mark = 'same' | 'changed' | 'new'

export type Aligned<T> =
  | { k: 'keep'; now: T; index: number; base: T | null; mark: Mark }
  /** 지운 것 — at 번째 앞에 되살린다 */
  | { k: 'gone'; base: T; at: number }

/**
 * 기준과 지금을 줄 세운다. 지워지고 들어온 것이 붙어 있으면 같은 종류끼리 "고침"으로 짝짓는다
 * (같은 종류 판단은 sameKind 로 — 블록은 종류, 표 행·목록 항목은 늘 같다)
 */
export function align<T>(base: T[], now: T[], key: (t: T) => string, sameKind: (a: T, b: T) => boolean = () => true): Aligned<T>[] {
  const out: Aligned<T>[] = []
  let bi = 0
  let ni = 0
  const parts = diffArrays(base.map(key), now.map(key))
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p]
    if (!part.added && !part.removed) {
      for (let k = 0; k < part.value.length; k++) out.push({ k: 'keep', now: now[ni], index: ni++, base: base[bi++], mark: 'same' })
      continue
    }
    // 지움·들어옴 한 덩어리
    const removed: T[] = []
    const added: T[] = []
    while (p < parts.length && (parts[p].added || parts[p].removed)) {
      if (parts[p].removed) for (let k = 0; k < parts[p].value.length; k++) removed.push(base[bi++])
      else for (let k = 0; k < parts[p].value.length; k++) added.push(now[ni++])
      p++
    }
    p--
    const used = new Set<number>()
    const pairs = added.map((a) => {
      const j = removed.findIndex((r, idx) => !used.has(idx) && sameKind(r, a))
      if (j >= 0) used.add(j)
      return j >= 0 ? removed[j] : null
    })
    const firstIndex = ni - added.length
    // 지운 것은 원래 순서에서 앞섰던 "고침" 짝 바로 뒤에 둔다 — 되살리면 제자리로 돌아가 짝이 깨지지 않게
    const pairOf = pairs.map((p) => (p ? removed.indexOf(p) : -1))
    const goneAt = removed.map((_, idx) => {
      let at = 0
      pairOf.forEach((ri, j) => {
        if (ri >= 0 && ri < idx) at = Math.max(at, j + 1)
      })
      return at
    })
    for (let j = 0; j <= added.length; j++) {
      removed.forEach((r, idx) => {
        if (!used.has(idx) && goneAt[idx] === j) out.push({ k: 'gone', base: r, at: firstIndex + j })
      })
      if (j < added.length) out.push({ k: 'keep', now: added[j], index: firstIndex + j, base: pairs[j], mark: pairs[j] ? 'changed' : 'new' })
    }
  }
  return out
}

export const alignBlocks = (base: Block[], now: Block[]) =>
  align(base, now, (b) => b.raw, (a, b) => a.node.k === b.node.k)

/** 보이는 글 — 비교 카드에 쓴다 */
export function blockPlain(b: Block): string {
  const n = b.node
  switch (n.k) {
    case 'heading':
    case 'para':
    case 'quote':
      return plainInline(n.inl)
    case 'list':
      return n.items.map((it) => plainInline(it.inl)).join('\n')
    case 'table':
      return [n.head, ...n.rows].map((r) => r.cells.map(plainInline).join(' · ')).join('\n')
    case 'hr':
      return '── 구분선 ──'
    default:
      return b.raw
  }
}

/** 단어 비교 — 새로 들어간(added) 또는 빠진(removed) 글자 범위 [시작, 끝) */
export function wordRanges(before: string, after: string, side: 'added' | 'removed'): [number, number][] {
  const out: [number, number][] = []
  let at = 0
  for (const part of diffWords(before, after)) {
    const mine = side === 'added' ? !part.removed : !part.added
    if (!mine) continue
    if (part[side]) out.push([at, at + part.value.length])
    at += part.value.length
  }
  return out
}

const KIND_NAME: Record<BlockNode['k'], string> = {
  heading: '작은 제목',
  para: '문단',
  quote: '주의 상자',
  list: '목록',
  table: '표',
  hr: '구분선',
  scope: '적용대상 줄',
  unknown: '원문 상자',
}

export const blockKindName = (b: Block, first = false) => (b.node.k === 'heading' && b.node.level === 2 && first ? '장 제목' : KIND_NAME[b.node.k])

export interface CardRow {
  /** 몇 번째 행(머리 줄은 0) */
  no: number
  before: string[] | null
  after: string[] | null
}

/** 제출 확인 창의 전/후 카드 하나 — 바뀐 블록 하나(doc-editing 2절 ③) */
export interface ChangeCard {
  where: string
  kind: 'changed' | 'new' | 'deleted'
  before: string | null
  after: string | null
  /** 표 — 머리 줄과 바뀐 칸이 든 행만 */
  table?: { head: string[]; rows: CardRow[] }
  /** 패널 요약에 세는 단위 — 표 칸 수·목록 항목 수, 나머지는 1 */
  units: number
}

const plainCells = (r: TableRow) => r.cells.map(plainInline)

/** 장 하나의 바뀐 블록 카드 — 장 원문 둘만 받는다 */
export function changeCards(beforeText: string, afterText: string, preamble = false): ChangeCard[] {
  const base = beforeText ? parseSection(beforeText, { preamble }).blocks : []
  const now = afterText ? parseSection(afterText, { preamble }).blocks : []
  const cards: ChangeCard[] = []
  const ordinal = (list: Block[], b: Block) => list.filter((x) => x.node.k === b.node.k).indexOf(b) + 1
  const named = (list: Block[], b: Block) => {
    const first = list[0] === b
    const name = blockKindName(b, first)
    if (b.node.k === 'heading') return `${name} 「${plainInline(b.node.inl)}」`
    const n = ordinal(list, b)
    return list.filter((x) => x.node.k === b.node.k).length > 1 ? `${n}번째 ${name}` : name
  }
  for (const a of align(base, now, (b) => b.raw, (x, y) => x.node.k === y.node.k)) {
    if (a.k === 'gone') {
      cards.push({ where: `지운 ${blockKindName(a.base, base[0] === a.base)}`, kind: 'deleted', before: blockPlain(a.base), after: null, units: 1 })
      continue
    }
    if (a.mark === 'same') continue
    if (a.mark === 'new' || !a.base) {
      cards.push({ where: `새 ${blockKindName(a.now)}`, kind: 'new', before: null, after: blockPlain(a.now), units: 1 })
      continue
    }
    const b = a.base.node
    const n = a.now.node
    if (b.k === 'table' && n.k === 'table') {
      const rows: CardRow[] = []
      let cells = 0
      if (b.head.raw !== n.head.raw) {
        rows.push({ no: 0, before: plainCells(b.head), after: plainCells(n.head) })
        cells += diffCells(plainCells(b.head), plainCells(n.head))
      }
      for (const r of align(b.rows, n.rows, (x) => x.raw)) {
        if (r.k === 'gone') {
          rows.push({ no: b.rows.indexOf(r.base) + 1, before: plainCells(r.base), after: null })
          cells += r.base.cells.length
        } else if (r.mark !== 'same') {
          rows.push({ no: r.index + 1, before: r.base ? plainCells(r.base) : null, after: plainCells(r.now) })
          cells += r.base ? diffCells(plainCells(r.base), plainCells(r.now)) : r.now.cells.length
        }
      }
      const only = rows.length === 1 ? rows[0] : null
      const label = only ? `${named(now, a.now)} ${only.no === 0 ? '머리 줄' : `${only.no}행`}${(only.after ?? only.before)?.[0] ? ` 「${(only.after ?? only.before)![0]}」` : ''}` : `${named(now, a.now)} · 바뀐 행 ${rows.length}`
      cards.push({ where: label, kind: 'changed', before: null, after: null, table: { head: plainCells(n.head), rows }, units: Math.max(cells, 1) })
      continue
    }
    if (b.k === 'list' && n.k === 'list') {
      const bs: string[] = []
      const as: string[] = []
      let first = -1
      let count = 0
      for (const r of align(b.items, n.items, (x) => renderItem(x))) {
        if (r.k === 'gone') {
          bs.push(plainInline(r.base.inl))
          count++
          if (first < 0) first = r.at
        } else if (r.mark !== 'same') {
          if (r.base) bs.push(plainInline(r.base.inl))
          as.push(plainInline(r.now.inl))
          count++
          if (first < 0) first = r.index
        }
      }
      const where = count === 1 ? `${named(now, a.now)} ${first + 1}번째 항목` : `${named(now, a.now)} · 바뀐 항목 ${count}`
      cards.push({ where, kind: 'changed', before: bs.join('\n') || null, after: as.join('\n') || null, units: Math.max(count, 1) })
      continue
    }
    cards.push({ where: named(now, a.now), kind: 'changed', before: blockPlain(a.base), after: blockPlain(a.now), units: 1 })
  }
  return cards
}

function diffCells(a: string[], b: string[]) {
  let n = 0
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? '') !== (b[i] ?? '')) n++
  return n
}

/** 패널 「바뀐 곳」 한 줄 — `표 칸 1 바뀜 · 문단 1 추가` */
export function summarizeCards(cards: ChangeCard[]): string {
  const counts = new Map<string, number>()
  for (const c of cards) {
    const kind = c.table ? '표 칸' : c.where.replace(/^(지운|새) /, '').replace(/^\d+번째 /, '').replace(/ .*$/, '')
    const verb = c.kind === 'new' ? '추가' : c.kind === 'deleted' ? '지움' : c.table ? '바뀜' : '고침'
    const k = `${kind} ${verb}`
    counts.set(k, (counts.get(k) ?? 0) + (c.table ? c.units : c.kind === 'changed' && kind === '목록' ? c.units : 1))
  }
  return [...counts].map(([k, n]) => k.replace(/ (\S+)$/, ` ${n} $1`)).join(' · ')
}
