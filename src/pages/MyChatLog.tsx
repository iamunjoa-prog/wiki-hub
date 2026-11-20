import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { RichText } from '../components/AssistantDock'
import { useAuth } from '../components/AuthGate'
import {
  ChatLogError,
  dayLabel,
  fetchMyChatLog,
  kstDay,
  kstTime,
  lastOf,
  mergeTurns,
  wikiDocOf,
  type MyChatLogItem,
  type Turn,
} from '../lib/chatLog'
import { useApp } from '../store/AppStore'

/** 정해진 줄 수까지만 보이고, 넘치면 펼치기 버튼을 붙인다 — 넘치는지는 그려 본 뒤에 잰다 */
function Clamp({ lines, more, children }: { lines: number; more: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [overflow, setOverflow] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !open) setOverflow(el.scrollHeight > el.clientHeight + 1)
  }, [open, children])
  return (
    <div className="mychat-clamp-wrap">
      <div ref={ref} className={open ? undefined : 'mychat-clamp'} style={open ? undefined : { maxHeight: `${lines * 1.7}em` }}>
        {children}
      </div>
      {(overflow || open) && (
        <button type="button" className="cli-os-switch mychat-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? '접기' : more}
        </button>
      )}
    </div>
  )
}

/** 질문 하나 — 마지막으로 성공한 시도의 답만 보인다(앞 실패는 숨김). 엔진·시간·오류 코드는 서버가 싣지 않는다 */
function readTurn(t: Turn<MyChatLogItem>) {
  const first = t.attempts[0]
  const last = lastOf(t)
  const ok = [...t.attempts].reverse().find((a) => a.status === 'ok')
  const failText = ok
    ? null
    : last.status === 'cancelled'
      ? '중간에 멈춘 질문이에요.'
      : last.mode === 'report'
        ? '리포트를 받지 못한 질문이에요.'
        : '이때는 챗봇이 답을 받지 못해 간단한 답변으로 대신했어요. 그 답은 저장되지 않아요.'
  return { first, ok, failText }
}

function Card({ turn }: { turn: Turn<MyChatLogItem> }) {
  const { docs, showToast } = useApp()
  const navigate = useNavigate()
  const { first, ok, failText } = readTurn(turn)
  const report = ok?.mode === 'report' ? ok.report : null
  // 위키에 있는 문서만 — 챗봇 창과 같다
  const sources = (report ? report.sources : (ok?.sources ?? [])).map((p) => wikiDocOf(docs, p)).filter((d) => d !== undefined)

  const copy = () => {
    const answer = report ? `${report.title}\n${report.summary}` : (ok?.a ?? failText ?? '')
    navigator.clipboard
      .writeText(`${first.q}\n\n${answer}`)
      .then(() => showToast('이 질문과 답을 복사했어요'))
      .catch(() => showToast('복사하지 못했어요. 글자를 직접 골라 복사해 주세요'))
  }

  return (
    <article className="mychat-card">
      <div className="mychat-top">
        <span className="muted">{kstTime(first.at)}</span>
        {report && <span className="tag">리포트</span>}
        <button type="button" className="btn sm" onClick={copy}>
          복사
        </button>
      </div>
      <Clamp lines={3} more="더 보기">
        <b className="chatlog-pre">{first.q}</b>
      </Clamp>
      {report ? (
        <div className="mychat-report">
          <b>{report.title}</b>
          <div className="chatlog-pre">{report.summary}</div>
        </div>
      ) : ok ? (
        <Clamp lines={4} more="전체 보기">
          <RichText text={ok.a} />
          {ok.aCut && <div className="muted mychat-cut">답이 길어 앞부분만 저장됐어요</div>}
        </Clamp>
      ) : (
        <div className="muted">{failText}</div>
      )}
      {sources.length > 0 && (
        <div className="sources">
          {sources.map((d) => (
            <button key={d.id} type="button" onClick={() => navigate(`/wiki/${d.id}`)}>
              {d.title}
            </button>
          ))}
        </div>
      )}
      {report && <div className="muted mychat-cut">리포트 본문은 저장되지 않아요. 받았을 때 .md로 저장해 두세요.</div>}
    </article>
  )
}

/** "내 대화 기록" — 본인 기록만 날짜별로. 지우기·전체 복사·내려받기는 없다 */
export function MyChatLog() {
  const { user: account, refresh } = useAuth()
  const { chatLog: status, openDock } = useApp()
  const days = status?.retentionDays ?? 90
  const allowed = Boolean(account) && status?.where !== 'local' && status?.enabled !== false

  const [turns, setTurns] = useState<Turn<MyChatLogItem>[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [pages, setPages] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ChatLogError | null>(null)
  const [moreFailed, setMoreFailed] = useState(false)

  const load = useCallback(async (from: string | null, base: Turn<MyChatLogItem>[]) => {
    setLoading(true)
    setMoreFailed(false)
    if (!from) setError(null)
    try {
      const page = await fetchMyChatLog(from)
      setTurns(mergeTurns(base, page.items))
      setCursor(page.nextCursor)
      setPages((n) => (from ? n + 1 : 1))
    } catch (err) {
      console.info('[chatlog] 내 기록을 읽지 못했습니다:', (err as Error).message)
      if (from) setMoreFailed(true)
      else setError(err instanceof ChatLogError ? err : new ChatLogError(0, null, String(err)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (allowed) void load(null, [])
  }, [allowed, load])

  // KST 날짜로 묶는다 — 줄 순서는 이미 최신순
  const groups = useMemo(() => {
    const out: { day: string; turns: Turn<MyChatLogItem>[] }[] = []
    for (const t of turns) {
      const day = kstDay(t.attempts[0].at)
      const g = out[out.length - 1]
      if (g?.day === day) g.turns.push(t)
      else out.push({ day, turns: [t] })
    }
    return out
  }, [turns])

  const frame = (body: ReactNode) => (
    <>
      <TopBar />
      <div className="content flush mychat">
        <div className="panel-head">
          <span className="label strong">내 대화 기록</span>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
            최근 {days}일
          </span>
        </div>
        {body}
      </div>
    </>
  )

  if (!account || status?.where === 'local' || error?.code === 'deploy-only')
    return frame(
      <div className="empty">
        <div className="box" />
        내 대화 기록은 웹 주소 허브에서 볼 수 있어요.
        <span className="muted" style={{ fontSize: 13 }}>
          {status?.enabled
            ? '이 PC의 대화는 저장되지만, 보는 곳은 웹 주소 허브의 대화 기록이에요.'
            : '이 PC용 허브에서 나눈 대화는 저장되지 않아요.'}
        </span>
      </div>,
    )
  if (status?.enabled === false) return frame(<div className="hint chatlog-hint">지금은 대화 기록을 저장하지 않고 있어요.</div>)
  if (error?.status === 401)
    return frame(
      <div className="empty">
        <div className="box" />
        로그인이 풀렸어요. 다시 로그인해 주세요.
        <button className="btn sm" onClick={refresh}>
          다시 로그인
        </button>
      </div>,
    )

  return frame(
    <>
      <div className="hint chatlog-hint">
        최근 {days}일 대화만 보관돼요. 지우고 싶은 내용이 있으면 허브 관리자에게 말해 주세요.
        <br />
        팀 계정의 대화가 함께 보여요.
      </div>
      {error && (
        <div className="err chatlog-hint">
          기록을 불러오지 못했어요. 잠시 뒤 다시 눌러 보고, 계속 안 되면 허브 담당자에게 알려 주세요.{' '}
          <button className="btn sm" onClick={() => void load(null, [])}>
            다시 불러오기
          </button>
        </div>
      )}
      {!error && turns.length === 0 && (loading || status === undefined ? (
        <div className="empty">기록을 불러오는 중…</div>
      ) : (
        <div className="empty">
          <div className="box" />
          아직 저장된 대화가 없어요. 챗봇에 물어보면 여기에서 다시 볼 수 있어요.
          <button className="btn sm" onClick={openDock}>
            챗봇 열기
          </button>
        </div>
      ))}
      {groups.map((g) => (
        <section key={g.day} className="mychat-day">
          <div className="label">{dayLabel(g.day)}</div>
          {g.turns.map((t) => (
            <Card key={t.key} turn={t} />
          ))}
        </section>
      ))}
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
            {loading ? '기록을 불러오는 중…' : '이전 대화 더 보기'}
          </button>
        </div>
      )}
      {!cursor && pages > 1 && turns.length > 0 && (
        <div className="muted chatlog-more">여기까지예요. {days}일보다 오래된 대화는 지워졌어요.</div>
      )}
    </>,
  )
}
