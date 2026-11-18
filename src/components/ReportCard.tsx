import { Children, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import { hitLines } from '../lib/publicCheck'
import { REPORT_TYPE_NAME, WEB_OFF_TEXT, reportFile, reportFileName, reportMarkdown } from '../lib/report'
import { useApp } from '../store/AppStore'
import type { ChatMessage, WikiDoc } from '../types'

/** 근거 태그 — 문장 끝 [위키]·[외부]·[추정]을 색이 다른 작은 표시로 그린다 */
const TAG = /(\[(?:위키|외부|추정)\])/
const TAG_CLASS: Record<string, string> = { '[위키]': 'wiki', '[외부]': 'ext', '[추정]': 'guess' }

function tagged(children: ReactNode): ReactNode {
  return Children.map(children, (c) =>
    typeof c === 'string'
      ? c.split(TAG).map((part, i) =>
          TAG_CLASS[part] ? (
            <span key={i} className={`rtag ${TAG_CLASS[part]}`}>
              {part.slice(1, -1)}
            </span>
          ) : (
            part
          ),
        )
      : c,
  )
}

const findDoc = (docs: WikiDoc[], p: string) =>
  docs.find((d) => d.path === p.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^지식\//, ''))

/** 리포트 본문 렌더러 — HTML 원문은 그리지 않는다(react-markdown 기본). 문서 코드 링크는 허브 안 이동, https 는 새 탭 */
function useReportComponents(): Components {
  const { docs } = useApp()
  const navigate = useNavigate()
  return useMemo(() => {
    const wrap =
      <T extends 'p' | 'li' | 'td' | 'th' | 'strong' | 'em' | 'h1' | 'h2' | 'h3' | 'h4'>(Tag: T) =>
      ({ children }: { children?: ReactNode }) => {
        const El = Tag as 'p'
        return <El>{tagged(children)}</El>
      }
    return {
      p: wrap('p'),
      li: wrap('li'),
      td: wrap('td'),
      th: wrap('th'),
      strong: wrap('strong'),
      em: wrap('em'),
      h1: wrap('h1'),
      h2: wrap('h2'),
      h3: wrap('h3'),
      h4: wrap('h4'),
      table: ({ children }) => (
        <div className="table-wrap">
          <table>{children}</table>
        </div>
      ),
      a: ({ href, children }) => {
        const target = docs.find((d) => d.code === href || d.path === href)
        if (target) {
          return (
            <a
              href={`/wiki/${target.id}`}
              onClick={(e) => {
                e.preventDefault()
                navigate(`/wiki/${target.id}`)
              }}
            >
              {children}
            </a>
          )
        }
        if (href && /^https:\/\//i.test(href)) {
          return (
            <a href={href} target="_blank" rel="noreferrer noopener" className="ext">
              {children}
            </a>
          )
        }
        // 허브 안 문서도 https 도 아닌 주소는 누를 수 없게 글자로만 둔다
        return <span>{children}</span>
      },
    }
  }, [docs, navigate])
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 클립보드 권한이 없는 창(http 사내 주소 등)에서는 선택 복사로 대신한다
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

const REFLECT_TITLE = '새 문서 화면을 이 리포트 내용으로 채워 엽니다. 제출하기 전에는 아무 데도 올라가지 않습니다.'

/**
 * 리포트 카드 — 말풍선의 3줄 요약 아래에 붙는다. 리포트는 개인 보고 문서라 저장소·허브 서버에 쓰지 않는다.
 * 위키에 올리려면 [위키에 반영 요청] → 공개 검사 → 새 문서 화면(미리 채움) → 제출 (docs/sections/requests-report.md)
 */
export function ReportCard({ msg }: { msg: ChatMessage }) {
  const report = msg.report!
  const { docs, assistant, askAgain, startReflect, openReflectEditor, closeReflect, showToast } = useApp()
  const navigate = useNavigate()
  const components = useReportComponents()
  const markdown = useMemo(() => reportMarkdown(report), [report])
  const [expanded, setExpanded] = useState(false)
  const [wide, setWide] = useState(false)

  const reflect = msg.reportReflect
  const checking = reflect?.stage === 'checking'
  const masked = [report.masked.amount && `금액 ${report.masked.amount}곳`, report.masked.name && `이름 ${report.masked.name}곳`].filter(Boolean)
  const createdAt = msg.reportMeta?.createdAt
    ? new Date(msg.reportMeta.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''

  const body = (
    <div className="md report-md">
      <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkCjkFriendly]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  )

  return (
    <div className="report-card">
      <div className="report-switch">
        <span>리포트로 정리했습니다 · 짧은 답이 필요하면</span>
        <button type="button" disabled={assistant.pending} onClick={() => askAgain(msg.id, 'qa')}>
          짧게 답 받기
        </button>
      </div>

      <div className="report-head">
        <b>{report.title}</b>
        <span className="muted">
          {[REPORT_TYPE_NAME[report.reportType], msg.reportMeta?.engine, createdAt].filter(Boolean).join(' · ')}
        </span>
      </div>

      {report.warnings.length > 0 && (
        <div className="banner warn" role="status">
          공개되면 안 되는 표현이 있을 수 있습니다 — 위키 반영 전에 고쳐야 합니다
        </div>
      )}
      {masked.length > 0 && (
        <div className="report-note">
          {masked.join(' · ')}을 가렸습니다. 본문에는 "(금액 생략)"·"(이름 생략)"으로 보입니다.
        </div>
      )}
      {report.webSearchOff && <div className="report-note">{WEB_OFF_TEXT[report.webSearchOff]}</div>}

      <div className="report-legend">
        <span className="rtag wiki">위키</span> 위키 문서에 적힌 내용 <span className="rtag ext">외부</span> 공개된 외부 자료{' '}
        <span className="rtag guess">추정</span> 둘을 바탕으로 한 판단
      </div>

      <div className={`report-body${expanded ? ' open' : ''}`}>{body}</div>
      <div className="report-toggle">
        <button type="button" className="btn sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '접기' : '펼치기'}
        </button>
        <button type="button" className="btn sm" onClick={() => setWide(true)}>
          넓혀 보기
        </button>
      </div>

      <div className="report-refs">
        <span className="label">근거 위키 문서</span>
        {report.sourcePaths.length ? (
          <div className="sources">
            {report.sourcePaths.map((p) => {
              const d = findDoc(docs, p)
              return d ? (
                <button key={p} type="button" onClick={() => navigate(`/wiki/${d.id}`)}>
                  {d.title}
                </button>
              ) : (
                <span key={p} className="muted">
                  {p}
                </span>
              )
            })}
          </div>
        ) : (
          <span className="muted">없음</span>
        )}

        <span className="label">외부 출처</span>
        {report.externalSources.length ? (
          <ul>
            {report.externalSources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="ext">
                  {s.title}
                </a>{' '}
                <span className="muted">· {s.accessedAt} 확인</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="muted">없음</span>
        )}

        <span className="label">사용한 검색어</span>
        {report.searchQueries.length ? (
          <ul className="muted">
            {report.searchQueries.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        ) : (
          <span className="muted">웹 검색을 하지 않았습니다</span>
        )}
      </div>

      {report.gaps.length > 0 && (
        <div className="report-refs">
          <span className="label">위키에 아직 없는 것</span>
          <ul>
            {report.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="report-actions">
        <button type="button" className="btn sm" disabled={checking} onClick={() => download(reportFileName(msg), reportFile(msg))}>
          .md로 저장
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={checking}
          onClick={async () => showToast((await copyText(markdown)) ? '리포트 마크다운을 복사했습니다' : '복사하지 못했습니다')}
        >
          복사
        </button>
        {reflect?.stage === 'handed' ? (
          <button type="button" className="btn sm primary" onClick={() => openReflectEditor(msg.id)}>
            새 문서 화면 다시 열기
          </button>
        ) : reflect?.stage === 'submitted' ? (
          <button type="button" className="btn sm primary" onClick={() => navigate('/requests')}>
            내 요청에서 보기
          </button>
        ) : (
          <button
            type="button"
            className="btn sm primary"
            title={REFLECT_TITLE}
            disabled={checking || reflect?.stage === 'blocked' || reflect?.stage === 'halted'}
            onClick={() => startReflect(msg.id)}
          >
            위키에 반영 요청
          </button>
        )}
      </div>

      {!reflect && (
        <div className="report-note">이 리포트는 내 대화에만 있습니다. 위키에 올리려면 [위키에 반영 요청]을 눌러 주세요.</div>
      )}
      {checking && <div className="report-note">공개해도 되는 내용인지 검사하는 중입니다. 몇 초 걸립니다.</div>}
      {reflect?.stage === 'handed' && <div className="report-note">새 문서 화면으로 넘겼습니다 · 아직 제출 전입니다.</div>}
      {reflect?.stage === 'submitted' && (
        <div className="report-note">
          제안을 올렸습니다 · 대기 중 · {reflect.code}
          {reflect.prNumber ? ` · PR #${reflect.prNumber}` : ''}
        </div>
      )}
      {reflect?.stage === 'failed' && (
        <div className="report-note">
          검사를 하지 못했습니다. 잠시 뒤 [위키에 반영 요청]을 다시 눌러 주세요. 계속되면 관리자에게 알려 주세요.
        </div>
      )}
      {reflect?.stage === 'blocked' && (
        <div className="banner danger" role="alert">
          <b>위키에 올릴 수 없는 표현이 있습니다</b>
          <span>위키는 누구나 볼 수 있는 공개 저장소에 올라갑니다. 아래 줄을 고쳐야 제출할 수 있습니다.</span>
          {hitLines(reflect.check.blocks, true).map((line) => (
            <span key={line}>· {line}</span>
          ))}
          <span>[새 문서 화면에서 고치기]를 누르면 리포트 내용이 채워진 화면이 열립니다. 고친 뒤 [다시 검사]를 눌러 주세요.</span>
          <div className="form-actions">
            <button type="button" className="btn sm primary" onClick={() => openReflectEditor(msg.id)}>
              새 문서 화면에서 고치기
            </button>
            <button type="button" className="btn sm" onClick={() => closeReflect(msg.id)}>
              닫기
            </button>
          </div>
        </div>
      )}
      {reflect?.stage === 'halted' && (
        <div className="banner" role="status">
          <b>지금은 위키 반영을 할 수 없습니다</b>
          <span>
            공개하면 안 되는 이름을 확인하는 목록이 이 허브에 연결되어 있지 않습니다. 리포트는 [.md로 저장]이나 [복사]로 쓰실 수
            있습니다. 위키 반영이 필요하면 관리자에게 알려 주세요.
          </span>
          <div className="form-actions">
            <button type="button" className="btn sm" onClick={() => closeReflect(msg.id)}>
              닫기
            </button>
          </div>
        </div>
      )}

      {wide && (
        <div className="modal-back report-wide-back" onClick={() => setWide(false)}>
          <div className="modal report-wide" role="dialog" aria-label={report.title} onClick={(e) => e.stopPropagation()}>
            <div className="panel-head">
              <span className="label strong">{report.title}</span>
              <button type="button" className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setWide(false)}>
                닫기
              </button>
            </div>
            <div className="modal-body">{body}</div>
          </div>
        </div>
      )}
    </div>
  )
}
