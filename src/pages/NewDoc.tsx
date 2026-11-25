import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import { TopBar } from '../components/AppShell'
import { categories, categoryShort, subcategories } from '../data/docs'
import { PublicLeakError, requestNewDoc, type NewDocResult } from '../lib/createDoc'
import { checkKey, hitLines, requestPublicCheck } from '../lib/publicCheck'
import { clearPrefill, readPrefill, savePrefill, type NewDocPrefill } from '../lib/report'
import { useApp } from '../store/AppStore'
import type { CategoryId, ProductScope, PublicCheckResult } from '../types'

/** 코드가 숫자로 안 끝나는 서브메뉴(ACS·CBS·Swing 등)는 다음 번호를 자동으로 못 매긴다 */
const NO_AUTO_CODE = new Set(['system'])

const DEFAULT_CATEGORY: CategoryId = 'promotion'
const subsOf = (category: CategoryId) => subcategories[category].filter((s) => !NO_AUTO_CODE.has(s.id))

/** 화면 이동 state 로 넘어온 미리 채움 — 새로고침 뒤에도 고치던 내용이 남도록 같은 리포트의 sessionStorage 값을 먼저 쓴다 */
function usePrefill(): { prefill: NewDocPrefill | null; check: PublicCheckResult | null } {
  const location = useLocation()
  return useMemo(() => {
    const state = (location.state ?? null) as { prefill?: NewDocPrefill; check?: PublicCheckResult } | null
    if (!state?.prefill) return { prefill: null, check: null }
    const saved = readPrefill()
    const same = saved && saved.fromMessageId === state.prefill.fromMessageId
    // 고친 내용이 있으면 화면 이동 때 받은 검사 결과는 옛 글의 결과다 — 다시 검사하게 버린다
    const edited = same && (saved.title !== state.prefill.title || saved.body !== state.prefill.body || saved.reason !== state.prefill.reason)
    return { prefill: same ? saved : state.prefill, check: edited ? null : (state.check ?? null) }
    // 처음 연 순간의 값만 쓴다 — 고치는 동안 sessionStorage 가 바뀌어도 다시 읽지 않는다
  }, [location.key])
}

interface CheckState {
  result: PublicCheckResult
  /** 검사한 글 — 지금 글과 다르면 고친 뒤 아직 검사하지 않은 것이다 */
  key: string
  /** 화면 검사를 지나 서버가 막았다(400 public-leak) */
  server?: boolean
}

export function NewDoc() {
  const { docs, session, refreshProposals, markReportSubmitted } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { prefill, check: handedCheck } = usePrefill()
  const via = prefill?.via ?? 'form'

  // 새 문서는 대부분 프로모션 문서라 메뉴 순서와 상관없이 프로모션을 기본으로 둔다
  const initialCategory = prefill?.category ?? (params.get('category') as CategoryId | null) ?? DEFAULT_CATEGORY
  const initialSub = prefill?.subcategory ?? params.get('sub')

  const [category, setCategory] = useState<CategoryId>(
    categories.some((c) => c.id === initialCategory) ? initialCategory : DEFAULT_CATEGORY,
  )
  const subs = useMemo(() => subsOf(category), [category])
  // 선택 칸은 첫 항목을 보여 주므로 값도 첫 항목으로 둔다 — 비워 두면 손대지 않고 낸 문서가 서브메뉴 없이 올라간다
  const [subcategory, setSubcategory] = useState<string | null>(() => {
    const first = subsOf(category)
    return first.some((s) => s.id === initialSub) ? initialSub : (first[0]?.id ?? null)
  })
  const [title, setTitle] = useState(prefill?.title ?? '')
  const [scope, setScope] = useState<ProductScope | '공통'>(prefill?.scope ?? '공통')
  const [body, setBody] = useState(prefill?.body ?? '')
  const [reason, setReason] = useState(prefill?.reason ?? '')
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<NewDocResult | null>(null)

  const key = checkKey({ title, body, reason })
  const [check, setCheck] = useState<CheckState | null>(() =>
    handedCheck && prefill ? { result: handedCheck, key: checkKey(prefill) } : null,
  )
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')

  const dirty = Boolean(check && check.key !== key)
  const blocked = Boolean(check && check.result.blocks.length > 0)
  // 리포트 반영은 이름 검사 없이 공개 저장소로 넘기지 않는다 (requests-report.md 7-3)
  const namesMissing = Boolean(check && !check.result.namesChecked)
  const reportHalted = via === 'report' && namesMissing && !dirty

  const runCheck = async (): Promise<PublicCheckResult | null> => {
    setChecking(true)
    setCheckError('')
    const at = key
    try {
      const res = await requestPublicCheck({ title: title.trim(), body, reason: reason.trim() || undefined, via, target: 'new' })
      setCheck({ result: res, key: at })
      return res
    } catch (err) {
      console.info('[newdoc] 공개 검사 실패:', (err as Error).message)
      setCheckError('공개 검사를 하지 못했습니다. 잠시 뒤 [다시 검사]를 눌러 주세요. 계속되면 관리자에게 알려 주세요.')
      return null
    } finally {
      setChecking(false)
    }
  }

  // 미리 채워 열렸는데 검사 결과를 받지 못했으면(새로고침·다시 열기) 바로 한 번 검사한다
  const autoChecked = useRef(false)
  useEffect(() => {
    if (!prefill || check || autoChecked.current) return
    autoChecked.current = true
    void runCheck()
  }, [prefill])

  // 미리 채운 화면은 고치는 내용을 sessionStorage 에 이어 둔다 — 새로고침해도 남는다. 제출 성공·취소 때 지운다
  useEffect(() => {
    if (!prefill || result) return
    savePrefill({ ...prefill, category, subcategory, scope, title, body, reason })
  }, [prefill, result, category, subcategory, scope, title, body, reason])

  const onCategoryChange = (next: CategoryId) => {
    setCategory(next)
    setSubcategory(subsOf(next)[0]?.id ?? null)
  }

  const submit = async () => {
    if (!title.trim() || !body.trim() || busy || checking || blocked) return
    setError('')
    // 검사하지 않은 글은 먼저 검사한다. 이번에 처음 보인 경고가 있으면 한 번 멈춰 읽게 한다 — 다시 누르면 제출된다
    if (!check || dirty) {
      const res = await runCheck()
      if (!res || res.blocks.length || res.warnings.length || (via === 'report' && !res.namesChecked)) return
    }
    if (reportHalted) return
    setBusy(true)
    try {
      const res = await requestNewDoc(
        { category, subcategory, title: title.trim(), scope, body, via, reason: reason.trim() },
        docs,
        session.name,
      )
      clearPrefill()
      if (prefill?.fromMessageId) markReportSubmitted(prefill.fromMessageId, res.code, res.prNumber)
      // 바로 [내 요청에서 보기]를 눌러도 방금 올린 제안이 보이게 목록을 다시 읽는다
      void refreshProposals()
      setResult(res)
    } catch (err) {
      if (err instanceof PublicLeakError) {
        setCheck({ result: { blocks: err.blocks, warnings: [], namesChecked: check?.result.namesChecked ?? true }, key, server: true })
      } else {
        setError(`제출하지 못했습니다 — ${(err as Error).message} 입력한 내용은 그대로 있습니다.`)
      }
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <>
        <TopBar />
        <div className="content">
          <div className="page-head">
            <span className="page-title">제안을 올렸습니다</span>
          </div>
          <div className="panel">
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span>
                새 문서 「{title.trim()}」(<b>{result.code}</b>)이 '대기 중'으로 올라갔습니다. 관리자가 승인(머지)하면 다음 배포 때 위키에
                새 문서로 보입니다.
              </span>
              <span className="muted">진행 상태는 내 요청 현황에서 볼 수 있습니다.</span>
              <div className="form-actions">
                <button className="btn primary" onClick={() => navigate('/requests')}>
                  내 요청에서 보기
                </button>
                <button className="btn" onClick={() => window.open(result.prUrl, '_blank', 'noopener,noreferrer')}>
                  제안 보기 ↗
                </button>
                <button className="btn" onClick={() => navigate('/wiki')}>
                  위키로 돌아가기
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  const hadHits = Boolean(check && (check.result.blocks.length || check.result.warnings.length))

  return (
    <>
      <TopBar />
      <div className="content">
        <div className="page-head">
          <span className="page-title">새 문서</span>
        </div>

        <div className="panel form-card">
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {prefill?.reportTitle && (
              <div className="hint">
                챗봇 리포트 「{prefill.reportTitle}」 내용을 채웠습니다. 위치·제목을 확인하고, 고친 뒤 제출해 주세요.
              </div>
            )}

            <div className="form-grid">
              <div className="form-row">
                <span className="label strong">카테고리 *</span>
                <select className="field" value={category} onChange={(e) => onCategoryChange(e.target.value as CategoryId)}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              {subs.length > 0 && (
                <div className="form-row">
                  <span className="label strong">서브메뉴 *</span>
                  <select className="field" value={subcategory ?? ''} onChange={(e) => setSubcategory(e.target.value)}>
                    {subs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {via === 'report' && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      리포트 종류로 고른 추천 위치입니다. 맞는지 확인해 주세요.
                    </span>
                  )}
                </div>
              )}
              <div className="form-row">
                <span className="label strong">적용 상품</span>
                <select className="field" value={scope} onChange={(e) => setScope(e.target.value as ProductScope | '공통')}>
                  <option value="공통">공통</option>
                  <option value="PPM">PPM(월정액)</option>
                  <option value="PPV">PPV(단건)</option>
                </select>
              </div>
              <div className="form-row">
                <span className="label strong">작성자</span>
                <input className="field" value={`${session.name} · ${session.team}`} readOnly />
              </div>
            </div>

            <div className="form-row">
              <span className="label strong">제목 *</span>
              <input
                className="field"
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: 오늘의 픽 배너"
              />
            </div>

            <div className="form-row">
              <span className="label strong">본문 * (마크다운)</span>
              {via === 'report' && (
                <span className="muted" style={{ fontSize: 12 }}>
                  [위키]·[외부]·[추정] 표시는 지우지 말아 주세요. 읽는 사람이 무엇이 정해진 내용이고 무엇이 판단인지 구분하는
                  표시입니다.
                </span>
              )}
              <div className="panel-head" style={{ padding: 0, marginBottom: 6 }}>
                <button className={`btn sm${tab === 'edit' ? ' primary' : ''}`} onClick={() => setTab('edit')}>
                  편집
                </button>
                <button className={`btn sm${tab === 'preview' ? ' primary' : ''}`} onClick={() => setTab('preview')}>
                  미리보기
                </button>
              </div>
              {tab === 'edit' ? (
                <textarea
                  className="field"
                  style={{ minHeight: 320 }}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="문서 본문을 마크다운으로 적어 주세요"
                  aria-label="마크다운 편집"
                />
              ) : (
                <div className="md" style={{ minHeight: 320 }}>
                  {body.trim() ? (
                    <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkCjkFriendly]}>{body}</ReactMarkdown>
                  ) : (
                    <span className="muted">본문을 입력하면 여기 미리보기가 뜹니다</span>
                  )}
                </div>
              )}
            </div>

            <div className="form-row">
              <span className="label strong">등록 사유</span>
              <textarea
                className="field"
                style={{ minHeight: 56 }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="왜 이 문서가 필요한지 적어 주세요 — 승인자가 읽습니다"
                aria-label="등록 사유"
              />
            </div>

            {checking && <div className="hint">공개해도 되는 내용인지 검사하는 중입니다. 몇 초 걸립니다.</div>}
            {!checking && checkError && <div className="err">{checkError}</div>}
            {!checking && check && dirty && (hadHits || namesMissing) && (
              <div className="hint">고친 내용은 아직 검사하지 않았습니다. [다시 검사]를 눌러 주세요.</div>
            )}
            {!checking && check && !dirty && (
              <>
                {check.server && (
                  <div className="err">제출하지 않았습니다. 아래 줄을 고친 뒤 다시 제출해 주세요. 입력한 내용은 그대로 있습니다.</div>
                )}
                {check.result.blocks.length > 0 && (
                  <div className="banner danger" role="alert">
                    <b>제출할 수 없습니다 — 공개 저장소에 올릴 수 없는 표현이 있습니다</b>
                    {hitLines(check.result.blocks, true, { body }).map((line) => (
                      <span key={line}>· {line}</span>
                    ))}
                  </div>
                )}
                {check.result.warnings.length > 0 && (
                  <div className="banner warn" role="status">
                    <b>제출은 할 수 있지만 확인해 주세요</b>
                    {hitLines(check.result.warnings, false, { body }).map((line) => (
                      <span key={line}>· {line}</span>
                    ))}
                    {namesMissing && via !== 'report' && (
                      <span className="banner-foot">
                        이 허브에서는 제휴사 이름을 자동으로 확인하지 못했습니다. 제휴사 이름이 들어가 있지 않은지 직접 확인해 주세요.
                      </span>
                    )}
                  </div>
                )}
                {namesMissing && via !== 'report' && check.result.warnings.length === 0 && (
                  <div className="hint">
                    이 허브에서는 제휴사 이름을 자동으로 확인하지 못했습니다. 제휴사 이름이 들어가 있지 않은지 직접 확인해 주세요.
                  </div>
                )}
                {reportHalted && (
                  <div className="banner" role="status">
                    <b>지금은 위키 반영을 할 수 없습니다</b>
                    <span>
                      공개하면 안 되는 이름을 확인하는 목록이 이 허브에 연결되어 있지 않습니다. 위키 반영이 필요하면 관리자에게 알려
                      주세요.
                    </span>
                  </div>
                )}
                {!hadHits && !namesMissing && <span className="muted">공개 규칙 검사를 통과했습니다.</span>}
              </>
            )}

            <div className="hint">
              문서 코드는 같은 서브메뉴의 다음 번호로 자동으로 매겨집니다. 제출하면 공개 저장소(GitHub)에 바로 올라갑니다. 반려돼도
              기록은 지워지지 않습니다. 관리자가 승인(머지)하면 다음 배포 때 위키에 보입니다.
            </div>

            {error && <div className="err">{error}</div>}

            <div className="form-actions">
              <button
                className="btn primary"
                disabled={!title.trim() || !body.trim() || busy || checking || blocked || reportHalted}
                onClick={submit}
              >
                {busy
                  ? 'PR 만드는 중…'
                  : check && !dirty && check.result.warnings.length > 0
                    ? `그대로 제출 · ${categoryShort[category]}`
                    : `PR로 제출 · ${categoryShort[category]}`}
              </button>
              <button className="btn" disabled={!title.trim() || !body.trim() || busy || checking} onClick={() => void runCheck()}>
                다시 검사
              </button>
              <button
                className="btn"
                onClick={() => {
                  clearPrefill()
                  navigate(-1)
                }}
                disabled={busy}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
