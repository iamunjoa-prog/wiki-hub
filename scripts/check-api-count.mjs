#!/usr/bin/env node
/**
 * api/ 배포 함수 수가 Vercel 무료(Hobby) 계정 한도 12개를 넘지 않는지 본다.
 *
 * 왜 필요한가 — 13개가 되면 Vercel 배포가 통째로 실패하는데, 로컬 빌드는 아무 문제 없이 지나간다
 * (PR #108 에서 api/docVersion.ts 를 더해 배포가 멈췄다). 새 경로는 기존 함수에 분기로 넣고
 * vercel.json rewrites 로 바깥 주소를 잇는다 — 예: /api/docVersion → api/proposeEdit.ts 의 GET.
 *
 * npm run build 의 첫 단계로 돈다. 넘으면 종료 코드 1로 끝난다.
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const API_DIR = 'api'
const LIMIT = 12
/** Vercel 이 함수로 세는 파일 — `_` 로 시작하는 파일·폴더와 .d.ts 는 세지 않는다 */
const FUNCTION_FILE = /\.(ts|js|mjs|cjs|tsx|jsx)$/

function listFunctions(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) return []
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listFunctions(full)
    return FUNCTION_FILE.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
  })
}

const files = listFunctions(API_DIR)
if (files.length > LIMIT) {
  console.error(`\nVercel 무료 계정은 함수 ${LIMIT}개까지 — api/ 파일을 합치세요 (지금 ${files.length}개)`)
  console.error('지금 할 일: 새 경로는 성격이 가까운 기존 api/ 파일에 분기로 넣고 vercel.json rewrites 로 주소를 잇습니다.')
  console.error(`api/ 함수 파일: ${files.map((f) => f.replace(/\\/g, '/')).join(', ')}\n`)
  process.exit(1)
}
console.log(`api/ 함수 ${files.length}개 (한도 ${LIMIT})`)
