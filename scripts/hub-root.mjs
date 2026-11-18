// 내려받은 ZIP 루트의 실행기 2개·안내문을 server/hubZipRoot.ts 내용으로 다시 쓴다.
// 켤 때 업데이트(scripts/update-hub.ps1 · start-hub.command)는 hub/ 만 바꾸므로, 루트는 npm install 뒤에 여기서 맞춘다.
// node 18 은 .ts 를 바로 못 읽어 typescript(개발 의존성)로 옮겨 불러온다. 바뀐 파일만 임시 파일 → 이름 바꾸기로 쓴다.
// 사용: node scripts/hub-root.mjs  (hub/.hub-version 이 없으면 아무것도 하지 않는다)

import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const parent = dirname(root)

const source = readFileSync(join(root, 'server', 'hubZipRoot.ts'), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

const versionFile = join(root, mod.HUB_VERSION_NAME)
if (!existsSync(versionFile)) {
  console.log('버전 파일이 없어 루트를 건드리지 않음')
  process.exit(0)
}
const { version } = JSON.parse(readFileSync(versionFile, 'utf8'))

// 실무자가 지운 실행기를 되살리지는 않는다 — ZIP 구성(루트에 안내문이나 실행기가 있는 폴더)일 때만 쓴다
const known = [mod.README_NAME, mod.ROOT_BAT_NAME, mod.ROOT_COMMAND_NAME]
if (!known.some((name) => existsSync(join(parent, name)))) {
  console.log(`ZIP 구성이 아니어서 건너뜀: ${parent}`)
  process.exit(0)
}

const files = [
  { name: mod.ROOT_BAT_NAME, text: mod.ROOT_BAT, mode: 0o644 },
  { name: mod.ROOT_COMMAND_NAME, text: mod.ROOT_COMMAND, mode: 0o755 },
  { name: mod.README_NAME, text: mod.readmeText(new Date(), version), mode: 0o644 },
]
for (const { name, text, mode } of files) {
  const target = join(parent, name)
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null
  // 안내문은 받은 날짜가 매번 달라서 버전 줄로만 비교한다
  const same = name === mod.README_NAME ? current?.includes(`버전(담당자용): ${version}`) : current === text
  if (same) continue
  const temp = `${target}.new`
  writeFileSync(temp, text, 'utf8')
  if (process.platform !== 'win32') chmodSync(temp, mode)
  renameSync(temp, target)
  console.log(`다시 씀: ${name}`)
}
