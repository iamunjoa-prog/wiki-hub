import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * 배포 허브 API의 로그인 확인 — 화면이 붙여 보낸 Microsoft 365(Entra ID) ID 토큰을 검증한다.
 * 화면과 같은 앱 ID·테넌트를 쓰므로 Vercel에 넣은 VITE_ 값도 그대로 받는다.
 * 둘 다 비어 있으면 로그인 없는 데모 배포로 보고 확인을 건너뛴다.
 */

export interface AuthUser {
  name: string
  email: string
  roles: string[]
}

function readEntra(env: Record<string, string | undefined>) {
  const clientId = (env.ENTRA_CLIENT_ID || env.VITE_ENTRA_CLIENT_ID)?.trim()
  const tenantId = (env.ENTRA_TENANT_ID || env.VITE_ENTRA_TENANT_ID)?.trim()
  return clientId && tenantId ? { clientId, tenantId } : null
}

const jwksByTenant = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function jwks(tenantId: string) {
  let set = jwksByTenant.get(tenantId)
  if (!set) {
    set = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`))
    jwksByTenant.set(tenantId, set)
  }
  return set
}

export type AuthResult = { ok: true; user: AuthUser | null } | { ok: false; response: Response }

/** 로그인 확인. 통과하면 토큰의 사용자(데모 배포면 null), 아니면 돌려줄 401 응답 */
export async function requireUser(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<AuthResult> {
  const entra = readEntra(env)
  if (!entra) return { ok: true, user: null }

  const deny = (message: string): AuthResult => ({ ok: false, response: Response.json({ error: message }, { status: 401 }) })
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
  if (!token) return deny('로그인이 필요합니다')

  try {
    const { payload } = await jwtVerify(token, jwks(entra.tenantId), {
      issuer: `https://login.microsoftonline.com/${entra.tenantId}/v2.0`,
      audience: entra.clientId,
    })
    return {
      ok: true,
      user: {
        name: String(payload.name ?? payload.preferred_username ?? ''),
        email: String(payload.preferred_username ?? ''),
        roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
      },
    }
  } catch {
    return deny('로그인이 만료됐거나 올바르지 않습니다. 다시 로그인해 주세요')
  }
}
