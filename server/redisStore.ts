/**
 * Upstash Redis REST 연결 — 계정(server/accounts.ts)과 대화 기록(server/chatLog.ts)이 같은 저장소를 쓴다.
 * 연결하면 Vercel이 넣어 주는 KV_REST_API_URL / KV_REST_API_TOKEN (또는 UPSTASH_REDIS_REST_URL / _TOKEN) 을 그대로 읽는다.
 */

export type Env = Record<string, string | undefined>

export type RedisCommand = (string | number)[]

export interface RedisCallOptions {
  /** 오류 문구 앞머리 — 계정 쪽은 화면에 그대로 보이므로 지금 문구("계정 저장소")를 지킨다 */
  label?: string
  /** 기다릴 상한 — 대화 기록처럼 답 경로 뒤에 붙는 저장은 짧게 끊는다 */
  signal?: AbortSignal
}

export function readRedis(env: Env) {
  const url = (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL)?.trim()
  const token = (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN)?.trim()
  return url && token ? { url: url.replace(/\/$/, ''), token } : null
}

/** 저장소가 연결됐는지 — 값은 내보내지 않는다 */
export const storeConnected = (env: Env = process.env) => Boolean(readRedis(env))

async function post(path: string, body: unknown, env: Env, opts: RedisCallOptions): Promise<{ res: Response; data: unknown }> {
  const label = opts.label ?? '저장소'
  const conf = readRedis(env)
  if (!conf) throw new Error(`${label}(Upstash Redis)가 연결되지 않았습니다`)
  const res = await fetch(`${conf.url}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${conf.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  return { res, data: await res.json().catch(() => ({})) }
}

/** 명령 하나 — HTTP 한 번. 실패하면 throw 한다 */
export async function redis<T = unknown>(command: RedisCommand, env: Env = process.env, opts: RedisCallOptions = {}): Promise<T> {
  const { res, data } = await post('', command, env, opts)
  const body = data as { result?: T; error?: string }
  if (!res.ok || body.error) throw new Error(`${opts.label ?? '저장소'} 오류 — ${body.error ?? res.status}`)
  return body.result as T
}

/**
 * 여러 명령을 HTTP 한 번에 보낸다(Upstash /pipeline). 원자적이지 않고, 명령 수는 그대로 센다.
 * 한 명령이라도 실패하면 throw 한다 — 결과는 명령 순서대로
 */
export async function redisPipeline<T extends unknown[] = unknown[]>(
  commands: RedisCommand[],
  env: Env = process.env,
  opts: RedisCallOptions = {},
): Promise<T> {
  if (commands.length === 0) return [] as unknown as T
  const { res, data } = await post('/pipeline', commands, env, opts)
  const label = opts.label ?? '저장소'
  if (!res.ok || !Array.isArray(data)) throw new Error(`${label} 오류 — ${res.status}`)
  const items = data as { result?: unknown; error?: string }[]
  const failed = items.find((r) => r?.error)
  if (failed) throw new Error(`${label} 오류 — ${failed.error}`)
  return items.map((r) => r?.result) as T
}
