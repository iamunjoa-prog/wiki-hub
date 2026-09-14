import type { WikiDoc } from '../types'

/**
 * `지식/` 트리를 빌드 타임에 읽어 WikiDoc[]로 변환한다.
 * 폴더가 곧 메뉴(카테고리), 파일 하나가 문서 하나다.
 * 프론트매터 규격은 이용 안내 › 문서 작성 규칙(HUB-03) 문서 참고.
 */
const files = import.meta.glob('/지식/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

interface Frontmatter {
  [key: string]: string
}

function parseFrontmatter(source: string): { fm: Frontmatter; body: string } {
  // Windows 체크아웃은 CRLF라, 편집 칸·AI 결과(LF)와 비교하면 모든 줄이 바뀐 것으로 잡힌다 — LF로 통일한다
  const raw = source.replace(/\r\n?/g, '\n')
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { fm: {}, body: raw }
  const [, fmBlock, rest] = match
  const fm: Frontmatter = {}
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    let value = m[2].trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    fm[key] = value
  }
  return { fm, body: rest.replace(/^\r?\n+/, '') }
}

interface ParsedDoc extends WikiDoc {
  order: number
  parent: string | null
}

const parsed: ParsedDoc[] = Object.entries(files)
  .map(([filePath, raw]): ParsedDoc | null => {
    const { fm, body } = parseFrontmatter(raw)
    if (!fm.code) return null
    const path = filePath.replace(/^\/지식\//, '')
    return {
      id: fm.code,
      path,
      title: fm.title ?? path,
      category: (fm.category as WikiDoc['category']) || 'promotion',
      code: fm.code,
      body,
      version: Number(fm.version) || 1,
      updatedBy: fm.updatedBy || '-',
      updatedAt: fm.updatedAt || '-',
      ownerId: fm.ownerId || 'ppc-team',
      order: Number(fm.order) || 0,
      parent: fm.parent && fm.parent !== 'null' ? fm.parent : null,
    }
  })
  .filter((d): d is ParsedDoc => d !== null)

/**
 * `order`는 프론트매터 규약상 "같은 부모 아래" 정렬 순서라 코드끼리 값이 겹친다
 * (예: PPC-ACS-01·PPC-CBS-01·PPC-P-00 모두 order=1, 부모가 다름).
 * 전역 정렬 대신 parent→order로 트리를 만들어 깊이 우선(DFS)으로 펼친다.
 */
function flattenTree(docs: ParsedDoc[]): WikiDoc[] {
  const byParent = new Map<string, ParsedDoc[]>()
  for (const d of docs) {
    const key = d.parent ?? '__root__'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(d)
  }
  for (const children of byParent.values()) children.sort((a, b) => a.order - b.order)

  const visited = new Set<string>()
  const out: WikiDoc[] = []

  function walk(doc: ParsedDoc) {
    if (visited.has(doc.code)) return
    visited.add(doc.code)
    const { order: _order, parent: _parent, ...wikiDoc } = doc
    out.push(wikiDoc)
    for (const child of byParent.get(doc.code) ?? []) walk(child)
  }

  for (const root of byParent.get('__root__') ?? []) walk(root)
  // parent 코드가 트리에 없는 고아 문서(오타 등)도 누락 없이 뒤에 붙인다.
  for (const d of [...docs].sort((a, b) => a.order - b.order)) {
    if (!visited.has(d.code)) walk(d)
  }

  return out
}

export const knowledgeDocs: WikiDoc[] = flattenTree(parsed)
