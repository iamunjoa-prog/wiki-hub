import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * 로컬 개발 전용 — 브라우저의 POST /api/ask 를 내 PC에 로그인된 Claude Code CLI로 넘긴다.
 * 배포본(Vercel)에는 이 경로가 없으므로 프론트엔드가 규칙 기반 답변으로 대체한다.
 */

const ROOT = resolve(__dirname, '..')
const KNOWLEDGE_DIR = resolve(ROOT, '지식')
const PROMPT_FILE = resolve(__dirname, 'assistant-prompt.md')
const TIMEOUT_MS = 120_000

const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    sourcePaths: { type: 'array', items: { type: 'string' } },
  },
  required: ['text', 'sourcePaths'],
}

export interface CliReply {
  text: string
  sourcePaths: string[]
}

/** Windows의 npm 셸 래퍼(claude.cmd)는 cmd.exe를 거쳐야 실행되므로 인자 속 따옴표를 이스케이프한다. */
const IS_WIN = process.platform === 'win32'
const quote = (arg: string) => (IS_WIN ? `"${arg.replace(/"/g, '\\"')}"` : arg)

function runClaude(query: string): Promise<CliReply> {
  const args = [
    '-p',
    '--output-format', 'json',
    '--no-session-persistence',
    '--tools', 'Read,Grep,Glob',
    '--system-prompt-file', PROMPT_FILE,
    '--json-schema', JSON.stringify(REPLY_SCHEMA),
  ]

  return new Promise((resolvePromise, reject) => {
    const child = spawn('claude', args.map(quote), { cwd: KNOWLEDGE_DIR, shell: IS_WIN })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`claude CLI 응답이 ${TIMEOUT_MS / 1000}초를 넘었습니다`))
    }, TIMEOUT_MS)

    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const out = JSON.parse(stdout)
        if (out.is_error || !out.structured_output) {
          throw new Error(out.result || `claude CLI 오류 (exit ${code})`)
        }
        resolvePromise(out.structured_output as CliReply)
      } catch (err) {
        reject(new Error(`${(err as Error).message}${stderr ? `\n${stderr}` : ''}`))
      }
    })

    // 한글 질문은 인자 대신 stdin으로 넘겨 셸 인코딩·줄바꿈 문제를 피한다.
    child.stdin.end(query)
  })
}

export function cliBridge(): Plugin {
  return {
    name: 'cli-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/ask', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const { query } = JSON.parse(body) as { query?: string }
            if (!query?.trim()) throw new Error('질문이 비어 있습니다')
            const started = Date.now()
            const reply = await runClaude(query.trim())
            server.config.logger.info(`[cli-bridge] ${((Date.now() - started) / 1000).toFixed(1)}s · ${query.trim()}`)
            res.end(JSON.stringify(reply))
          } catch (err) {
            server.config.logger.error(`[cli-bridge] ${(err as Error).message}`)
            res.statusCode = 502
            res.end(JSON.stringify({ error: (err as Error).message }))
          }
        })
      })
    },
  }
}
