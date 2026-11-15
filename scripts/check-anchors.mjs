#!/usr/bin/env node
/**
 * 지식 문서의 **문서 간 링크**가 가리키는 대상이 실제로 있는지 검사한다.
 *
 * 왜 필요한가 — 링크 주소는 문서 코드와 소제목 **텍스트**다 (`PPC-P-01#h-상품-분류-체계-(PPV-/-PPM)`).
 * 소제목을 한 글자만 고쳐도 그 소제목을 가리키던 링크가 전부 조용히 끊긴다. 에러가 나지 않고
 * 그냥 문서 맨 위로 이동해 버리기 때문에, 고친 사람도 깨진 걸 모른다.
 *
 * 실행
 *   npm run check:anchors
 *
 * 소제목을 고쳤거나 문서를 옮겼으면 커밋 전에 한 번 돌린다.
 * 깨진 링크가 있으면 어디를 고쳐야 하는지 짚어 주고 종료 코드 1로 끝난다.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const KNOWLEDGE_DIR = '지식'
/** 작성 규칙 문서는 링크 **쓰는 법**을 설명하느라 예시용 가짜 앵커를 담고 있다 */
const SKIP = ['guide/writing.md']

/** src/lib/docEdit.ts 의 headingId 와 같은 규칙이어야 한다 (단일 출처 — node 스크립트라 TS 를 못 불러와 한 줄을 따로 둔다) */
const headingPlain = (text) => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').replace(/`/g, '')
const headingId = (text) => `h-${headingPlain(text).trim().replace(/\s+/g, '-')}`

function listMarkdown(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listMarkdown(full)
    return entry.name.endsWith('.md') ? [full] : []
  })
}

const files = listMarkdown(KNOWLEDGE_DIR).sort()

/** 문서 코드 → { path, 소제목 앵커 집합 } */
const byCode = new Map()
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const code = source.match(/^code:\s*(\S+)\s*$/m)?.[1]
  if (!code) continue // 프론트매터에 코드가 없으면 위키 문서로 올라가지 않는다
  const anchors = new Set()
  for (const [, text] of source.matchAll(/^#{2,4}\s+(.*)$/gm)) anchors.add(headingId(text))
  byCode.set(code, { path: relative('.', file).replace(/\\/g, '/'), anchors })
}

/**
 * `[라벨](코드)` 와 `[라벨](코드#h-소제목)`. 소제목에 괄호가 들어가기도 해서(`(Step-1~6)`)
 * 주소 안의 괄호를 한 겹까지 함께 받는다.
 */
const LINK = /\[[^\]]+\]\(([A-Z][A-Za-z0-9-]*)(?:#((?:[^()\s]|\([^()]*\))*))?\)/g

const problems = []
let checked = 0

for (const file of files) {
  const shown = relative('.', file).replace(/\\/g, '/')
  if (SKIP.some((s) => shown.endsWith(s))) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const [, code, anchor] of line.matchAll(LINK)) {
      checked++
      const target = byCode.get(code)
      if (!target) {
        problems.push({ where: `${shown}:${i + 1}`, link: code + (anchor ? `#${anchor}` : ''), why: `문서 코드 ${code} 가 없습니다`, hint: '' })
        continue
      }
      if (!anchor) continue
      if (target.anchors.has(anchor)) continue
      // 가장 비슷한 소제목을 함께 알려 준다 — 보통 소제목을 고치고 링크를 안 고친 경우다
      const wanted = anchor.replace(/^h-/, '').replace(/-/g, ' ')
      const near = [...target.anchors]
        .map((a) => ({ a, shared: overlap(wanted, a.replace(/^h-/, '').replace(/-/g, ' ')) }))
        .sort((x, y) => y.shared - x.shared)
        .filter((x) => x.shared > 0)[0]
      problems.push({
        where: `${shown}:${i + 1}`,
        link: `${code}#${anchor}`,
        why: `${target.path} 에 그 소제목이 없습니다`,
        hint: near ? `이것을 뜻한 것 같습니다 → ${code}#${near.a}` : '',
      })
    }
  })
}

/** 두 문구가 공유하는 단어 수 — 비슷한 소제목을 추천하는 데만 쓴다 */
function overlap(a, b) {
  const left = new Set(a.toLowerCase().split(/[\s·—]+/).filter(Boolean))
  const right = b.toLowerCase().split(/[\s·—]+/).filter(Boolean)
  return right.filter((w) => left.has(w)).length
}

console.log(`지식 문서 ${byCode.size}개 · 문서 간 링크 ${checked}개 검사`)

if (problems.length === 0) {
  console.log('깨진 링크 없음')
  process.exit(0)
}

console.log(`\n깨진 링크 ${problems.length}개\n`)
for (const p of problems) {
  console.log(`  ${p.where}`)
  console.log(`    ${p.link}`)
  console.log(`    ${p.why}`)
  if (p.hint) console.log(`    ${p.hint}`)
  console.log('')
}
console.log('소제목을 고쳤으면 그 소제목을 가리키는 링크도 함께 고쳐야 합니다.')
process.exit(1)
