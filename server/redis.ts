/**
 * Upstash Redis(REST) 창구 — 계정과 요청·승인 기록이 같은 저장소를 쓴다.
 * Vercel에서 연결하면 KV_REST_API_URL / KV_REST_API_TOKEN (또는 UPSTASH_REDIS_REST_URL / _TOKEN) 이 들어온다.
 */

type Env = Record<string, string | undefined>

export function readRedis(env: Env = process.env) {
  const url = (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL)?.trim()
  const token = (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN)?.trim()
  return url && token ? { url: url.replace(/\/$/, ''), token } : null
}

async function post<T>(path: string, body: unknown, env: Env): Promise<T> {
  const conf = readRedis(env)
  if (!conf) throw new Error('저장소(Upstash Redis)가 연결되지 않았습니다')
  const res = await fetch(`${conf.url}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${conf.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok || (!Array.isArray(data) && data.error)) throw new Error(`저장소 오류 — ${data.error ?? res.status}`)
  return data
}

export async function redis<T = unknown>(command: (string | number)[], env: Env = process.env): Promise<T> {
  return (await post<{ result: T }>('', command, env)).result
}

/** 여러 명령을 한 번에 보낸다 — 순서대로 결과가 돌아온다 */
export async function redisPipeline<T = unknown>(commands: (string | number)[][], env: Env = process.env): Promise<T[]> {
  if (commands.length === 0) return []
  const results = await post<{ result?: T; error?: string }[]>('/pipeline', commands, env)
  return results.map((r) => {
    if (r.error) throw new Error(`저장소 오류 — ${r.error}`)
    return r.result as T
  })
}
