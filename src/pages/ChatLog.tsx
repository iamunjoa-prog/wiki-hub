import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Chevron, TopBar } from '../components/AppShell'
import { RichText } from '../components/AssistantDock'
import { useAuth } from '../components/AuthGate'
import { ENGINE_LABEL } from '../lib/assistant'
import { listUsers, type HubAccount } from '../lib/auth'
import {
  ChatLogError,
  MODE_LABEL,
  STATUS_LABEL,
  deleteChatLog,
  fetchChatLog,
  fetchChatLogUsage,
  formatMs,
  kstDay,
  kstDayAgo,
  kstTime,
  lastOf,
  mergeTurns,
  shortAt,
  wikiDocOf,
  type ChatLogMode,
  type ChatLogRecord,
  type ChatLogStatusCode,
  type ChatLogUsage,
  type Turn,
} from '../lib/chatLog'
import { REPORT_TYPE_NAME, WEB_OFF_TEXT } from '../lib/report'
import { useApp } from '../store/AppStore'
import type { Engine } from '../types'

/* ── 필터 (주소 쿼리) ───────────────────────────────────── */

interface Filters {
  days: number
  user: string
  engine: Engine | ''
  mode: ChatLogMode | ''
  status: ChatLogStatusCode | ''
  noSource: boolean
}

const DEFAULT_DAYS = 7
const ENGINES: Engine[] = ['claude', 'codex', 'gemini']
const MODES: ChatLogMode[] = ['qa', 'report', 'report-unavailable']
const STATUSES: ChatLogStatusCode[] = ['ok', 'fail', 'cancelled']
const MODE_OPTION: Record<ChatLogMode, string> = { qa: '일반 답', report: '리포트', 'report-unavailable': '리포트 안내' }
const INTENT_LABEL: Record<ChatLogRecord['intent'], string> = { qa: '일반', offer: '리포트 제안', report: '리포트' }
const pick = <T extends string>(v: string | null, allowed: T[]): T | '' => (v && (allowed as string[]).includes(v) ? (v as T) : '')

function readFilters(sp: URLSearchParams, periods: number[]): Filters {
  const days = Number(sp.get('days'))
  return {
    days: periods.includes(days) ? days : DEFAULT_DAYS,
    user: sp.get('user') ?? '',
    engine: pick(sp.get('engine'), ENGINES),
    mode: pick(sp.get('mode'), MODES),
    status: pick(sp.get('status'), STATUSES),
    noSource: sp.get('noSource') === '1',
  }
}

/** 기본값과 다른 것만 주소에 남긴다 — 관리자끼리 주소로 조건을 나눌 수 있게 */
function writeFilters(f: Filters): URLSearchParams {
  const sp = new URLSearchParams()
  if (f.days !== DEFAULT_DAYS) sp.set('days', String(f.days))
  if (f.user) sp.set('user', f.user)
  if (f.engine) sp.set('engine', f.engine)
  if (f.mode) sp.set('mode', f.mode)
  if (f.status) sp.set('status', f.status)
  if (f.noSource) sp.set('noSource', '1')
  return sp
}

/** 기간 칩 말고 켜진 조건 수 — 휴대폰 폭 "조건 더 보기 (n)" */
const extraCount = (f: Filters) => [f.user, f.engine, f.mode, f.status, f.noSource].filter(Boolean).length

/* ── 질문 한 줄 요약 ────────────────────────────────────── */

const RERUN_LABEL = { qa: '짧게 다시', report: '리포트로 다시' } as const

interface TurnView {
  first: ChatLogRecord
  last: ChatLogRecord
  /** 마지막으로 성공한 시도 — 답·근거는 이것을 본다 */
  ok: ChatLogRecord | undefined
  allFail: boolean
  path: string
  ms: number
  /** 성공한 일반 답의 근거 수. 그 밖에는 null(비워 둔다) */
  sourceCount: number | null
  /** 근거 없이 답했는데 본문에 편성표를 밝혔다 — 규약상 정상일 수 있는 답(검토 2-2 가) */
  schedule: boolean
  rerun: { label: string; title: string } | null
}

function viewOf(t: Turn<ChatLogRecord>): TurnView {
  const first = t.attempts[0]
  const last = lastOf(t)
  const ok = [...t.attempts].reverse().find((a) => a.status === 'ok')
  const allFail = t.attempts.every((a) => a.status === 'fail')
  const steps = t.attempts.map(
    (a) => `${ENGINE_LABEL[a.engine]}${a.status === 'fail' ? ' 실패' : a.status === 'cancelled' ? ' 멈춤' : ''}`,
  )
  // 일반 답이 모두 실패하면 브라우저가 간단한 답변으로 대신했다(D5). 리포트 실패는 넘기지 않고 멈춘다
  if (allFail && last.mode === 'qa') steps.push('간단한 답변')
  const answered = last.status === 'ok' && last.mode === 'qa'
  // 다시 묻기 — 칩 경로(via)가 있으면 그 이름을, 없으면 고른 모드로 짐작한다(직접 친 "짧게 답해줘")
  const rerun = first.modeOverride
    ? {
        label: RERUN_LABEL[first.modeOverride],
        title: first.via ? `화면에서 고른 경로 · ${first.via}` : '직접 입력으로 다시 물었어요 (예: 짧게 답해줘)',
      }
    : first.via
      ? { label: first.via, title: '화면에서 고른 경로' }
      : null
  return {
    first,
    last,
    ok,
    allFail,
    path: steps.join(' → '),
    ms: t.attempts.reduce((sum, a) => sum + a.ms, 0),
    sourceCount: answered ? last.sources.length : null,
    schedule: answered && last.noSource && /편성표/.test(last.a),
    rerun,
  }
}

/** 같은 대화의 바로 앞 질문 — 지금 불러온 목록 안에서만 찾는다 */
function previousTurns(turns: Turn<ChatLogRecord>[]): Map<string, ChatLogRecord> {
  const byChat = new Map<string, Turn<ChatLogRecord>[]>()
  for (const t of turns) {
    const f = t.attempts[0]
    if (!f.chatId) continue
    const k = `${f.loginId}|${f.chatId}`
    byChat.set(k, [...(byChat.get(k) ?? []), t])
  }
  const prev = new Map<string, ChatLogRecord>()
  for (const list of byChat.values()) {
    list.sort((a, b) => a.attempts[0].at.localeCompare(b.attempts[0].at))
    list.forEach((t, i) => i > 0 && prev.set(t.key, lastOf(list[i - 1])))
  }
  return prev
}

/* ── 사용자 이름 ───────────────────────────────────────── */

interface Who {
  name: string
  team: string
  /** 계정 목록에 있다 — 없으면(지워진 계정) 아이디를 회색으로 */
  known: boolean
  /** 관리자 PC 기록(local:<PC 이름>) */
  local: boolean
}

function whoOf(loginId: string, users: Map<string, HubAccount>): Who {
  if (loginId.startsWith('local:')) return { name: loginId.slice(6), team: '', known: true, local: true }
  const u = users.get(loginId)
  return u ? { name: u.name, team: u.team, known: true, local: false } : { name: loginId, team: '', known: false, local: false }
}

function WhoLabel({ who }: { who: Who }) {
  return (
    <>
      <span className={who.known ? undefined : 'muted'}>{who.name}</span>
      {who.local && <span className="tag">내 PC</span>}
    </>
  )
}

/* ── 사용량 띠 ─────────────────────────────────────────── */

const NEAR = 0.7
const NEAR_TEXT = '한도에 가까워요 · 운영 담당에게 알려 주세요'
const ESTIMATE_TITLE = '실제 값은 Upstash 콘솔과 조금 다를 수 있어요'

const mb = (bytes: number) => {
  const v = bytes / 1024 / 1024
  return v < 10 ? v.toFixed(1) : String(Math.round(v))
}
const man = (n: number) => (n < 10_000 ? n.toLocaleString() : `${Number((n / 10_000).toFixed(1))}만`)
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

function UsageStrip({ usage, failed, days }: { usage: ChatLogUsage | null; failed: boolean; days: number }) {
  const u = usage
  const cells = [
    {
      label: '오늘 저장',
      value: u ? `${u.today.attempts.toLocaleString()} / ${u.dailyCap.toLocaleString()}` : '—',
      sub: u?.today.over ? `상한을 넘어 ${u.today.over.toLocaleString()}건은 내용 없이 건수만 남았어요` : '',
      warn: Boolean(u && u.dailyCap > 0 && u.today.attempts / u.dailyCap >= NEAR),
    },
    {
      label: `최근 ${u?.retentionDays ?? days}일`,
      value: u ? `${u.records.toLocaleString()}건` : '—',
      sub: `${u?.retentionDays ?? days}일 지나면 저절로 지워져요`,
      warn: false,
    },
    {
      label: '저장 용량(추정)',
      value: u ? `${mb(u.estimatedBytes)} MB / ${mb(u.storageLimitBytes)} MB` : '—',
      sub: u ? `${pct(u.estimatedBytes, u.storageLimitBytes)}%` : '',
      warn: Boolean(u && u.estimatedBytes / u.storageLimitBytes >= NEAR),
      title: ESTIMATE_TITLE,
    },
    {
      label: '이번 달 명령 수(추정)',
      value: u ? `${man(u.estimatedMonthCommands)} / ${man(u.monthCommandLimit)}` : '—',
      sub: u ? `${pct(u.estimatedMonthCommands, u.monthCommandLimit)}%` : '',
      warn: Boolean(u && u.estimatedMonthCommands / u.monthCommandLimit >= NEAR),
      title: ESTIMATE_TITLE,
    },
  ]
  return (
    <div className="chatlog-usage">
      <div className="kpi-grid compact">
        {cells.map((c) => (
          <div key={c.label} className={`kpi${c.warn ? ' warn' : ''}`} title={c.title}>
            <span className="label">{c.label}</span>
            <b>{c.value}</b>
            <span className="sub">{[c.sub, c.warn && NEAR_TEXT].filter(Boolean).join(' · ')}</span>
          </div>
        ))}
      </div>
      {failed && <div className="muted chatlog-note">사용량을 읽지 못했어요. 목록은 그대로 볼 수 있어요.</div>}
      {/* 엔진별 실패율을 필터를 바꿔 가며 세지 않게 — 숫자만 둔다(검토 절차 2-5) */}
      {u && u.engines7d.length > 0 && (
        <div className="muted chatlog-note">
          최근 7일 엔진별 시도 ·{' '}
          {u.engines7d
            .map(
              (e) =>
                `${ENGINE_LABEL[e.engine]} ${e.attempts.toLocaleString()}건${e.fail || e.cancelled ? ` (실패 ${e.fail}${e.cancelled ? ` · 멈춤 ${e.cancelled}` : ''})` : ''}`,
            )
            .join(' · ')}
        </div>
      )}
    </div>
  )
}

/* ── 펼친 줄 ───────────────────────────────────────────── */

const WHERE_LABEL = { deploy: '웹 주소 허브', local: '내 PC용 허브' } as const

function Sources({ paths }: { paths: string[] }) {
  const { docs } = useApp()
  const navigate = useNavigate()
  if (paths.length === 0) return <span className="muted">근거 없이 답했어요</span>
  return (
    <div className="sources">
      {paths.map((p) => {
        const doc = wikiDocOf(docs, p)
        return doc ? (
          <button key={p} type="button" onClick={() => navigate(`/wiki/${doc.id}`)}>
            {doc.title}
          </button>
        ) : (
          <span key={p} className="chatlog-ghost" title="위키에 없는 문서예요">
            {p}
          </span>
        )
      })}
    </div>
  )
}

function ReportBlock({ r }: { r: ChatLogRecord }) {
  const report = r.report!
  return (
    <div className="chatlog-report">
      <b>{report.title}</b>
      <span className="muted">{REPORT_TYPE_NAME[report.type] ?? report.type}</span>
      <div className="chatlog-pre">{report.summary}</div>
      <Sources paths={report.sources} />
      {report.gaps.length > 0 && (
        <>
          <span className="label">위키 빈칸</span>
          <ul>
            {report.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </>
      )}
      {report.external.length > 0 && (
        <>
          <span className="label">외부 출처</span>
          <ul>
            {report.external.map((e) => (
              <li key={e.url}>
                <a href={e.url} target="_blank" rel="noreferrer">
                  {e.title || e.url} ↗
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {report.searchQueries.length > 0 && (
        <div className="muted mono">검색어 · {report.searchQueries.join(' · ')}</div>
      )}
      <div className="muted">
        웹 검색 {report.webSearch ? '켬' : '끔'}
        {report.webSearchOff && ` — ${WEB_OFF_TEXT[report.webSearchOff]}`}
        {(report.masked.amount > 0 || report.masked.name > 0) &&
          ` · 가린 금액 ${report.masked.amount}건 · 가린 이름 ${report.masked.name}건`}
      </div>
      <div className="muted">리포트 본문은 저장하지 않아요 ({report.chars.toLocaleString()}자)</div>
    </div>
  )
}

function Answer({ v }: { v: TurnView }) {
  if (v.ok?.mode === 'report' && v.ok.report) return <ReportBlock r={v.ok} />
  if (v.ok)
    return (
      <div className="chatlog-answer">
        {v.ok.aCut && <span className="muted chatlog-cut">앞 1,500자만 저장됨</span>}
        <RichText text={v.ok.a} />
      </div>
    )
  if (v.last.status === 'cancelled') return <span className="muted">중간에 멈춘 질문이에요.</span>
  if (v.last.mode === 'qa')
    return (
      <span className="muted">
        모든 엔진이 답하지 못해 사용자에게는 간단한 답변(규칙 기반)이 나갔어요. 그 답은 저장되지 않아요.
      </span>
    )
  return <span className="muted">리포트를 만들지 못했어요. 사용자에게는 「짧게 답 받기」 안내가 나갔어요.</span>
}

function Attempts({ turn }: { turn: Turn<ChatLogRecord> }) {
  const engineName = (a: ChatLogRecord) => `${ENGINE_LABEL[a.engine]}${a.model ? ` (${a.model})` : ''}`
  return (
    <>
      <table className="chatlog-attempts">
        <thead>
          <tr>
            <th>순서</th>
            <th>엔진</th>
            <th>모드</th>
            <th>결과</th>
            <th>오류 분류</th>
            <th>걸린 시간</th>
            <th>어디서</th>
          </tr>
        </thead>
        <tbody>
          {turn.attempts.map((a, i) => (
            <tr key={a.id}>
              <td>{i + 1}</td>
              <td>{engineName(a)}</td>
              <td>{MODE_LABEL[a.mode]}</td>
              <td>{STATUS_LABEL[a.status]}</td>
              <td className="mono">{a.errorCode ?? '—'}</td>
              <td>{formatMs(a.ms)}</td>
              <td>{WHERE_LABEL[a.where]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* 휴대폰 폭에서는 표 대신 시도마다 2줄 */}
      <ol className="chatlog-attempt-list">
        {turn.attempts.map((a) => (
          <li key={a.id}>
            <div>
              {engineName(a)} · {MODE_LABEL[a.mode]} · {STATUS_LABEL[a.status]}
              {a.errorCode && <span className="mono"> · {a.errorCode}</span>}
            </div>
            <div className="muted">
              {formatMs(a.ms)} · {WHERE_LABEL[a.where]}
            </div>
          </li>
        ))}
      </ol>
    </>
  )
}

function Detail({
  turn,
  v,
  who,
  prev,
  onChat,
  onDelete,
}: {
  turn: Turn<ChatLogRecord>
  v: TurnView
  who: Who
  prev: ChatLogRecord | undefined
  onChat: () => void
  onDelete: () => void
}) {
  const { first } = v
  // 자동 판정과 고른 모드가 다르면 굵게 — 판정 오판을 찾는 줄이다
  const overrideDiffers =
    first.modeOverride !== null && (first.modeOverride === 'report') !== (first.intent === 'report')
  return (
    <div className="chatlog-detail">
      <dl>
        <dt>누가</dt>
        <dd>
          <WhoLabel who={who} />
          {who.team && <span className="muted"> · {who.team}</span>}
        </dd>
        <dt>질문</dt>
        <dd className="chatlog-pre">{first.q}</dd>
        <dt>답</dt>
        <dd>
          <Answer v={v} />
        </dd>
        {v.ok && v.ok.mode === 'qa' && (
          <>
            <dt>근거</dt>
            <dd>
              <Sources paths={v.ok.sources} />
            </dd>
          </>
        )}
        <dt>시도</dt>
        <dd>
          <Attempts turn={turn} />
          <div className={`chatlog-judge${overrideDiffers ? ' strong' : ''}`}>
            자동 판정: {INTENT_LABEL[first.intent]} · 고른 모드:{' '}
            {first.modeOverride ? INTENT_LABEL[first.modeOverride] : '없음'}
            {first.notice === 'offer' && ' · 안내: 리포트 제안'}
            {first.notice === 'local-only' && ' · 안내: 리포트는 내 PC용 허브에서'}
            {v.rerun && ` · 다시 묻기: ${v.rerun.label}`}
          </div>
          {prev && (
            <div className="chatlog-judge">
              같은 대화 앞 질문: {MODE_LABEL[prev.mode]} · {STATUS_LABEL[prev.status]} · 자동 판정 {INTENT_LABEL[prev.intent]}
            </div>
          )}
        </dd>
      </dl>
      <div className="form-actions">
        {first.chatId && (
          <button type="button" className="btn sm" onClick={onChat}>
            같은 대화 보기
          </button>
        )}
        <button type="button" className="btn sm chatlog-del" onClick={onDelete}>
          이 질문 기록 지우기
        </button>
      </div>
    </div>
  )
}

/* ── 같은 대화 보기 ────────────────────────────────────── */

function SameChat({ turn, who, onClose }: { turn: Turn<ChatLogRecord>; who: Who; onClose: () => void }) {
  const first = turn.attempts[0]
  const [turns, setTurns] = useState<Turn<ChatLogRecord>[] | null>(null)
  const [failed, setFailed] = useState(false)
  const focusRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    setFailed(false)
    setTurns(null)
    // 그 사람 색인만 훑으면 빠짐이 적다(PR #95 계약)
    fetchChatLog({ chat: first.chatId!, user: first.loginId, limit: 200 })
      .then((page) => setTurns(mergeTurns([], page.items).reverse()))
      .catch((err: Error) => {
        console.info('[chatlog] 같은 대화를 읽지 못했습니다:', err.message)
        setFailed(true)
      })
  }, [first.chatId, first.loginId])

  useEffect(load, [load])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    if (turns) focusRef.current?.scrollIntoView({ block: 'center' })
  }, [turns])

  const range =
    turns && turns.length > 0
      ? (() => {
          const start = turns[0].attempts[0].at
          const end = lastOf(turns[turns.length - 1]).at
          return `${shortAt(start)}~${kstDay(start) === kstDay(end) ? kstTime(end) : shortAt(end)}`
        })()
      : shortAt(first.at)

  return (
    <div className="modal-back report-wide-back" onClick={onClose}>
      <div className="modal report-wide chatlog-chat" role="dialog" aria-label="같은 대화" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span className="label strong">
            같은 대화 · {who.name} · {range}
            {turns && ` · 질문 ${turns.length}개`}
          </span>
          <button type="button" className="btn sm" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {!turns && !failed && <div className="muted">기록을 불러오는 중…</div>}
          {failed && (
            <div className="err">
              기록을 불러오지 못했어요. 잠시 뒤 다시 눌러 보고, 계속 안 되면 허브 담당자에게 알려 주세요.{' '}
              <button type="button" className="btn sm" onClick={load}>
                다시 불러오기
              </button>
            </div>
          )}
          {turns && (
            <div className="chatlog-chat-log">
              {turns.map((t) => {
                const v = viewOf(t)
                const here = t.key === turn.key
                return (
                  <div key={t.key} className="chatlog-chat-turn" ref={here ? focusRef : undefined}>
                    <div className={`msg user${here ? ' focus' : ''}`}>
                      <span className="msg-via">{shortAt(v.first.at)}</span>
                      {v.first.q}
                    </div>
                    <div className="msg bot">
                      <Answer v={v} />
                      <div className="by">
                        {v.path} · {formatMs(v.ms)}
                        {v.sourceCount !== null && ` · 근거 ${v.sourceCount}`}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── 지우기 확인 ───────────────────────────────────────── */

function DeleteModal({
  turn,
  who,
  onCancel,
  onDeleted,
}: {
  turn: Turn<ChatLogRecord>
  who: Who
  onCancel: () => void
  onDeleted: () => void
}) {
  const first = turn.attempts[0]
  const total = turn.attempts.length
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // 처음 초점은 [취소] — Enter 를 잘못 눌러 지우는 일을 막는다
  useEffect(() => cancelRef.current?.focus(), [])

  const run = async () => {
    setBusy(true)
    setFailed(false)
    const done = new Set(gone)
    try {
      // 서버가 같은 질문의 시도를 함께 지운다. 남은 것이 있으면(쪽 경계·turnId 없음) 남은 것만 다시 부른다
      for (let left = turn.attempts.filter((a) => !done.has(a.id)); left.length > 0; left = left.filter((a) => !done.has(a.id))) {
        const id = left[0].id
        const res = await deleteChatLog(id)
        res.ids.forEach((x) => done.add(x))
        // 0건이면 이미 없는 기록이다(만료·다른 관리자가 지움)
        done.add(id)
      }
      onDeleted()
    } catch (err) {
      console.info('[chatlog] 지우지 못했습니다:', (err as Error).message)
      setGone(done)
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <div className="modal-back" onClick={busy ? undefined : onCancel}>
      <div className="modal chatlog-delete" role="alertdialog" aria-label="이 기록을 지울까요?" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span className="label strong">이 기록을 지울까요?</span>
        </div>
        <div className="modal-body">
          <div>
            {shortAt(first.at)} · {who.name}
          </div>
          <div className="chatlog-pre">“{first.q.length > 60 ? `${first.q.slice(0, 60)}…` : first.q}”</div>
          <div>지우면 되돌릴 수 없어요.</div>
          {total > 1 && <div>엔진을 바꿔 다시 시도한 기록 {total - 1}건도 함께 지워져요.</div>}
          {failed && (
            <div className="err">
              지우지 못했어요. 잠시 뒤 [지우기]를 다시 눌러 주세요.
              {gone.size > 0 && ` ${total}건 중 ${Math.min(gone.size, total)}건을 지웠어요. 다시 누르면 남은 것만 지워요.`}
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn accent" disabled={busy} onClick={() => void run()}>
              {busy ? '지우는 중…' : '지우기'}
            </button>
            <button type="button" className="btn" ref={cancelRef} disabled={busy} onClick={onCancel}>
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── 화면 ──────────────────────────────────────────────── */

/** 조건이 있으면 빈 쪽에도 다음 커서가 올 수 있다 — 한 번 누를 때 이만큼까지 이어 읽는다 */
const MAX_EMPTY_HOPS = 5

/** 관리자 "대화 기록" — 질문 단위 목록, 한 줄 펼침, 같은 대화 보기, 질문 단위 지우기. 내보내기 기능은 두지 않는다 */
export function ChatLog() {
  const { user: account, refresh } = useAuth()
  const { chatLog: status, showToast } = useApp()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const days = status?.retentionDays ?? 90
  const periods = useMemo(() => [1, 7, 30, days], [days])
  const filters = readFilters(sp, periods)
  const filterKey = writeFilters(filters).toString()
  const allowed = account?.role === 'admin' && status?.enabled !== false

  const [users, setUsers] = useState<Map<string, HubAccount>>(new Map())
  const [usage, setUsage] = useState<ChatLogUsage | null>(null)
  const [usageFailed, setUsageFailed] = useState(false)
  const [turns, setTurns] = useState<Turn<ChatLogRecord>[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ChatLogError | null>(null)
  const [moreFailed, setMoreFailed] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [chatOf, setChatOf] = useState<Turn<ChatLogRecord> | null>(null)
  const [deleting, setDeleting] = useState<Turn<ChatLogRecord> | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  /** 조건을 바꾸면 앞 요청의 늦은 응답을 버린다 */
  const seq = useRef(0)

  const loadUsage = useCallback(() => {
    setUsageFailed(false)
    fetchChatLogUsage()
      .then(setUsage)
      .catch((err: Error) => {
        console.info('[chatlog] 사용량을 읽지 못했습니다:', err.message)
        setUsage(null)
        setUsageFailed(true)
      })
  }, [])

  const load = useCallback(
    async (from: string | null, base: Turn<ChatLogRecord>[]) => {
      const mine = ++seq.current
      setLoading(true)
      setMoreFailed(false)
      if (!from) setError(null)
      const f = readFilters(new URLSearchParams(filterKey), periods)
      let next = from
      let merged = base
      try {
        for (let hop = 0; hop < MAX_EMPTY_HOPS; hop++) {
          const page = await fetchChatLog({
            from: kstDayAgo(f.days - 1),
            to: kstDay(),
            user: f.user || undefined,
            engine: f.engine || undefined,
            mode: f.mode || undefined,
            status: f.status || undefined,
            noSource: f.noSource,
            cursor: next,
          })
          if (mine !== seq.current) return
          const before = merged.length
          merged = mergeTurns(merged, page.items)
          next = page.nextCursor
          if (merged.length > before || !next) break
        }
        setTurns(merged)
        setCursor(next)
      } catch (err) {
        if (mine !== seq.current) return
        console.info('[chatlog] 목록을 읽지 못했습니다:', (err as Error).message)
        if (from) setMoreFailed(true)
        else setError(err instanceof ChatLogError ? err : new ChatLogError(0, null, String(err)))
      } finally {
        if (mine === seq.current) setLoading(false)
      }
    },
    [filterKey, periods],
  )

  useEffect(() => {
    if (!allowed) return
    setTurns([])
    setCursor(null)
    setOpenKey(null)
    void load(null, [])
  }, [allowed, load])

  useEffect(() => {
    if (!allowed) return
    loadUsage()
    listUsers()
      .then((list) => setUsers(new Map(list.map((u) => [u.loginId, u]))))
      .catch((err: Error) => console.info('[chatlog] 계정 목록을 읽지 못했습니다:', err.message))
  }, [allowed, loadUsage])

  const views = useMemo(() => new Map(turns.map((t) => [t.key, viewOf(t)])), [turns])
  const prevOf = useMemo(() => previousTurns(turns), [turns])

  // 권한·환경별 상태 — 막다른 길이 아니라 어디서 볼 수 있는지 알려 준다
  const gate = (body: React.ReactNode, button?: React.ReactNode) => (
    <>
      <TopBar />
      <div className="content flush">
        <div className="panel-head">
          <span className="label strong">대화 기록</span>
          <span className="tag solid">관리자 전용</span>
        </div>
        <div className="empty">
          <div className="box" />
          {body}
          {button}
        </div>
      </div>
    </>
  )
  const toMain = (
    <button className="btn sm" onClick={() => navigate('/')}>
      메인으로
    </button>
  )
  if (!account || error?.code === 'deploy-only') return gate('대화 기록은 웹 주소 허브에 관리자로 로그인해서 볼 수 있어요.')
  if (account.role !== 'admin' || error?.status === 403) return gate('관리자만 볼 수 있어요.', toMain)
  if (error?.status === 401)
    return gate(
      '로그인이 풀렸어요. 다시 로그인해 주세요.',
      <button className="btn sm" onClick={refresh}>
        다시 로그인
      </button>,
    )

  const setFilters = (patch: Partial<Filters>) => setSp(writeFilters({ ...filters, ...patch }))
  const isDefault = filterKey === ''
  const onlyNoSource = filters.noSource && extraCount(filters) === 1 && filters.days === DEFAULT_DAYS
  const extra = extraCount(filters)

  const localIds = [...new Set(turns.map((t) => t.attempts[0].loginId).filter((id) => id.startsWith('local:')))]
  if (filters.user.startsWith('local:') && !localIds.includes(filters.user)) localIds.push(filters.user)
  const userList = [...users.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.team.localeCompare(b.team, 'ko'))
  const unknownUser = filters.user && !filters.user.startsWith('local:') && !users.has(filters.user)

  const refreshAll = () => {
    setTurns([])
    setCursor(null)
    setOpenKey(null)
    void load(null, [])
    loadUsage()
  }

  return (
    <>
      <TopBar />
      <div className="content flush chatlog">
        <div className="panel-head">
          <span className="label strong">대화 기록</span>
          <span className="tag solid">관리자 전용</span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} disabled={loading || status?.enabled === false} onClick={refreshAll}>
            새로고침
          </button>
        </div>

        {status === undefined ? (
          <div className="empty">기록을 불러오는 중…</div>
        ) : status?.enabled === false ? (
          <div className="hint chatlog-hint">
            지금은 대화 기록을 저장하지 않고 있어요. 저장소 연결 설정(KV_REST_API_URL·KV_REST_API_TOKEN)이 있어야 기록이 남아요.
          </div>
        ) : (
          <>
            <div className="hint chatlog-hint">
              기록은 {days}일 뒤 저절로 지워져요. 내려받기·전체 복사 기능은 없어요. 기록에서 찾은 문제를 위키·PR·이슈로 옮길
              때는 질문을 그대로 붙이지 말고 "이번 주 근거 없는 답이 여러 건"처럼 경향으로 적어 주세요. 웹 주소 허브에서는 질문
              중 사용자가 멈춰도 '성공'으로 남을 수 있어요.
            </div>

            <UsageStrip usage={usage} failed={usageFailed} days={days} />

            <div className="filter-bar chatlog-filters">
              <span className="label">기간</span>
              {periods.map((d) => (
                <button key={d} type="button" className={`chip${filters.days === d ? ' on' : ''}`} onClick={() => setFilters({ days: d })}>
                  {d === 1 ? '오늘' : `${d}일`}
                </button>
              ))}
              <button type="button" className="btn sm chatlog-more-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
                조건 더 보기{extra > 0 && ` (${extra})`}
              </button>
              <div className={`chatlog-filters-rest${moreOpen ? ' open' : ''}`}>
                <label className="chatlog-field">
                  <span className="label">사용자</span>
                  <select className="field" value={filters.user} onChange={(e) => setFilters({ user: e.target.value })}>
                    <option value="">모든 사람</option>
                    {userList.map((u) => (
                      <option key={u.loginId} value={u.loginId}>
                        {u.name}
                        {u.team && ` · ${u.team}`}
                      </option>
                    ))}
                    {unknownUser && <option value={filters.user}>{filters.user}</option>}
                    {localIds.length > 0 && (
                      <optgroup label="내 PC용 허브(관리자 PC)">
                        {localIds.map((id) => (
                          <option key={id} value={id}>
                            {id.slice(6)}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
                <label className="chatlog-field">
                  <span className="label">엔진</span>
                  <select className="field" value={filters.engine} onChange={(e) => setFilters({ engine: e.target.value as Engine | '' })}>
                    <option value="">모두</option>
                    {ENGINES.map((e) => (
                      <option key={e} value={e}>
                        {ENGINE_LABEL[e]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="chatlog-field">
                  <span className="label">모드</span>
                  <select className="field" value={filters.mode} onChange={(e) => setFilters({ mode: e.target.value as ChatLogMode | '' })}>
                    <option value="">모두</option>
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {MODE_OPTION[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="chatlog-field">
                  <span className="label">결과</span>
                  <select
                    className="field"
                    value={filters.status}
                    onChange={(e) => setFilters({ status: e.target.value as ChatLogStatusCode | '' })}
                  >
                    <option value="">모두</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="camp-cal-check">
                  <input type="checkbox" checked={filters.noSource} onChange={(e) => setFilters({ noSource: e.target.checked })} />
                  근거 없이 답한 것만
                </label>
              </div>
              {!isDefault && (
                <button type="button" className="btn sm" onClick={() => setSp(new URLSearchParams())}>
                  조건 모두 풀기
                </button>
              )}
            </div>

            <div className="muted chatlog-count">질문 {turns.length}개</div>

            {error && (
              <div className="err chatlog-hint">
                기록을 불러오지 못했어요. 잠시 뒤 다시 눌러 보고, 계속 안 되면 허브 담당자에게 알려 주세요.{' '}
                <button className="btn sm" onClick={() => void load(null, [])}>
                  다시 불러오기
                </button>
              </div>
            )}
            {!error && turns.length === 0 && (loading ? (
              <div className="empty">기록을 불러오는 중…</div>
            ) : (
              <div className="empty">
                <div className="box" />
                {isDefault
                  ? '아직 저장된 대화가 없어요. 챗봇에 질문이 들어오면 여기에 쌓여요.'
                  : onlyNoSource
                    ? '이 기간에는 근거 없이 답한 질문이 없어요.'
                    : '이 조건에 맞는 기록이 없어요. 기간을 늘리거나 조건을 풀어 보세요.'}
                {!isDefault && (
                  <button className="btn sm" onClick={() => setSp(new URLSearchParams())}>
                    조건 모두 풀기
                  </button>
                )}
              </div>
            ))}

            <div>
              {turns.map((t) => {
                const v = views.get(t.key)!
                const who = whoOf(v.first.loginId, users)
                const open = openKey === t.key
                const prev = prevOf.get(t.key)
                return (
                  <div key={t.key} className={`chatlog-item${open ? ' open' : ''}`}>
                    <button type="button" className="row chatlog-row" aria-expanded={open} onClick={() => setOpenKey(open ? null : t.key)}>
                      <span className="c-mode tag">{MODE_LABEL[v.last.mode]}</span>
                      <span className="c-at">{shortAt(v.first.at)}</span>
                      <span className="c-user">
                        <WhoLabel who={who} />
                      </span>
                      <span className="grow c-q">{v.first.q}</span>
                      <span className={`c-result tag ${v.last.status === 'ok' ? 'ok' : v.last.status === 'fail' ? 'no' : 'wait'}`}>
                        {STATUS_LABEL[v.last.status]}
                      </span>
                      <span className="c-meta">
                        {v.rerun && (
                          <span className="c-rerun tag" title={v.rerun.title}>
                            {prev ? `앞 ${MODE_LABEL[prev.mode]} → ${v.rerun.label}` : v.rerun.label}
                          </span>
                        )}
                        <span className="c-path">{v.path}</span>
                        {v.sourceCount !== null && (
                          <span className={`c-src tag${v.sourceCount === 0 ? ' warn' : ''}`}>근거 {v.sourceCount}</span>
                        )}
                        {v.schedule && (
                          <span className="c-src tag" title="답에 편성표를 밝혔어요 — 근거 문서 없이 편성표로 답했을 수 있어요">
                            편성표
                          </span>
                        )}
                        <span className="c-ms">{formatMs(v.ms)}</span>
                      </span>
                      <span className="c-chev">
                        <Chevron open={open} />
                      </span>
                    </button>
                    {open && (
                      <Detail
                        turn={t}
                        v={v}
                        who={who}
                        prev={prev}
                        onChat={() => setChatOf(t)}
                        onDelete={() => setDeleting(t)}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            {moreFailed && (
              <div className="err chatlog-hint">
                더 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.{' '}
                <button className="btn sm" onClick={() => void load(cursor, turns)}>
                  다시 불러오기
                </button>
              </div>
            )}
            {cursor && !moreFailed && (
              <div className="chatlog-more">
                <button className="btn" disabled={loading} onClick={() => void load(cursor, turns)}>
                  {loading ? '기록을 불러오는 중…' : '질문 50개 더 보기'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {chatOf && <SameChat turn={chatOf} who={whoOf(chatOf.attempts[0].loginId, users)} onClose={() => setChatOf(null)} />}
      {deleting && (
        <DeleteModal
          turn={deleting}
          who={whoOf(deleting.attempts[0].loginId, users)}
          onCancel={() => setDeleting(null)}
          onDeleted={() => {
            setTurns((prev) => prev.filter((t) => t.key !== deleting.key))
            setOpenKey(null)
            setDeleting(null)
            showToast('기록을 지웠어요')
          }}
        />
      )}
    </>
  )
}
