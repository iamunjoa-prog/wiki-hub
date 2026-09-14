import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/** 로컬 CLI 중계(vite 플러그인)와 배포 함수(api/)가 함께 쓰는 답변 형식·문서 묶음 */

export interface CliReply {
  text: string
  sourcePaths: string[]
}

// OpenAI·Gemini 구조화 출력 모두 받아들이는 형태: additionalProperties:false 와 전체 required
export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    sourcePaths: { type: 'array', items: { type: 'string' } },
  },
  required: ['text', 'sourcePaths'],
  additionalProperties: false,
}

function listDocs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name)
    if (e.isDirectory()) return listDocs(full)
    return e.name.endsWith('.md') ? [full] : []
  })
}

const docsCache = new Map<string, string>()

/**
 * 위키 문서 전체(약 100KB)를 한 프롬프트 블록으로 묶는다 — 문서를 직접 열어볼 수 없는 엔진(Codex 샌드박스, Gemini API)용.
 * 서버가 떠 있는 동안 문서는 바뀌지 않으므로 폴더별로 한 번만 읽는다.
 */
export function buildDocsBlock(knowledgeDir: string): string {
  const cached = docsCache.get(knowledgeDir)
  if (cached) return cached
  const block = listDocs(knowledgeDir)
    .map((file) => {
      const path = relative(knowledgeDir, file).replace(/\\/g, '/')
      return `<document path="${path}">\n${readFileSync(file, 'utf8')}\n</document>`
    })
    .join('\n\n')
  docsCache.set(knowledgeDir, block)
  return block
}
