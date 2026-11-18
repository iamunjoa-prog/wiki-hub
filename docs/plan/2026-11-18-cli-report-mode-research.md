# 로컬 CLI 리포트 모드 — dev-server 사전 조사 결과

작성 `dev-server` · 2026-11-18 · 기획안 `docs/plan/2026-11-18-cli-report-mode.md` 담당 분배 1번
코드 변경 없음. 실험은 임시 폴더에서 임시 프롬프트·스키마로 했고 저장소에 파일을 남기지 않았다.

조사 환경: Windows 11, `claude` 2.1.260 (이 PC 기본 모델 `claude-sonnet-5`), `codex-cli` 0.145.0. 둘 다 npm 전역 설치(`claude.cmd`·`codex.cmd`).

---

## 한눈에

| # | 조사 항목 | 결과 | 근거 |
| --- | --- | --- | --- |
| a | claude `-p` + `--tools …,WebSearch,WebFetch` 웹 검색 | **된다.** 단 `--allowedTools WebSearch,WebFetch` 를 같이 줘야 한다. `--tools` 만 주면 도구는 보이지만 `-p` 에서 권한 요청에 답할 사람이 없어 "haven't granted" 로 거절된다 | 실험 1·2 |
| a | `--json-schema` 와 같이 쓰기 | **된다.** 검색·페이지 열기 후 `structured_output` 이 스키마대로 온다 | 실험 2, 사례 실측 |
| b | 이 실행에만 PreToolUse 훅 붙이기 | **된다. `--settings <파일 경로>` 로.** 훅은 권한 검사보다 먼저 돌아 모든 WebSearch·WebFetch 호출을 본다. 종료 코드 2 + stderr 로 거절하면 그 호출만 막히고 모델은 이유를 받아 다시 검색한다 | 실험 1·2·3 |
| b | `--settings '<JSON 문자열>'` 인라인 | **Windows 에서 안 된다.** `cliBridge.ts` 의 `spawn(shell:true)` + `quote()` 경로(cmd.exe)에서 중첩 따옴표가 깨져 exit 255. 임시 settings 파일을 써서 경로로 넘긴다 | 실험 3 |
| c | `--output-format stream-json --verbose` 진행 단계 | **된다.** `assistant` 이벤트의 `tool_use`(이름·입력)로 "문서 읽는 중 / 외부 검색 중" 을 실시간으로 알 수 있고, 마지막 줄 `type:"result"` 에 지금과 같은 `structured_output` 이 온다. `--include-partial-messages` 를 더하면 최종 작성 구간에도 `input_json_delta` 가 흘러 "작성 중" 을 보일 수 있다 | 실험 2·4, 사례 실측 |
| d | codex 웹 검색 | **된다(실측).** `codex exec … -c 'web_search="live"'` 로 `--sandbox read-only`·`--output-schema` 와 함께 동작. `--search` 플래그는 최상위 전용이라 `codex exec --search` 는 오류, `codex --search exec` 형태만 받는다 | 실험 5 |
| d | codex 검색어 사전 차단 | **못 한다(구조상).** 검색은 OpenAI 쪽 내장 도구로 돌고, `--json` 의 `item.started` 이벤트에 검색어가 빈 값이다. 검색어는 끝난 뒤(`item.completed`)에야 보인다. codex 훅이 내장 web_search 를 가로채는지는 문서상 **미확인** | 실험 5 |
| e | 사례 3개 소요 시간 | 115초 · 124초 · 189초 (3개 동시 실행, 각 1회) | 사례 실측 |

결론: claude 는 기획안 그대로(웹 검색 + 훅 차단 + 스키마) 갈 수 있다. codex 는 검색은 되지만 사전 차단이 안 되므로 기획안 보안 절 "훅을 못 쓰는 엔진은 웹 검색을 켜지 않는다"에 따라 **codex 리포트는 위키만 근거**(열린 질문 Q8 (가))로 두는 것을 권한다.

---

## 실험 기록

| 실험 | 한 일 | 결과 |
| --- | --- | --- |
| 1 | `--tools Read,Grep,Glob,WebSearch,WebFetch` + `--settings` 훅 + `--json-schema` + `stream-json`. 검색 2회 지시(1회는 테스트용 가짜 차단어 `ZZTESTBLOCK` 포함) | 26초. 훅이 두 호출 모두 받음. 차단어 호출은 훅이 거절, 나머지는 **권한 미승인으로 거절**(`permission_denials` 2건). `--allowedTools` 필요 확인 |
| 2 | 1 + `--allowedTools WebSearch,WebFetch`, 검색 후 https 페이지 1개 WebFetch | 44초(API 33초, 6턴). 차단어 검색만 막히고 일반 검색·WebFetch 성공. 훅 로그에 WebFetch URL 도 찍힘. `structured_output` 정상 |
| 3 | `cliBridge.ts` 와 같은 방식(`spawn('claude', args.map(quote), {shell:true})`)으로 `--settings` 전달. 훅 스크립트를 공백·한글이 든 폴더에 둠 | 파일 경로: 성공(17초, 차단 1건). 인라인 JSON: cmd.exe 가 "파일 이름, 디렉터리 이름 또는 볼륨 레이블 구문이 잘못되었습니다" 로 즉시 실패(exit 255). 환경 변수(훅 로그 경로)는 자식 → 훅으로 그대로 전달됨 |
| 4 | `--include-partial-messages` + `--json-schema`, 도구 없음 | `stream_event` 의 `content_block_delta:input_json_delta` 37건 — StructuredOutput 입력이 조각으로 흐른다 |
| 5 | `codex exec --skip-git-repo-check --ephemeral --sandbox read-only --color never -c 'web_search="live"' --json --output-schema … -o … -` | 52초. 검색 1회(내부적으로 여러 검색어), 출처 URL 4개를 스키마대로 반환. 이벤트는 `item.started web_search {query:""}` → `item.completed web_search {query, action.queries[]}` |

---

## 사례 실측 (claude, 리포트용 임시 프롬프트·`REPORT_SCHEMA` 초안 형태)

조건: 작업 폴더 `지식/`, 도구 `Read,Grep,Glob,WebSearch,WebFetch`, 훅 붙임, 기본 모델(`claude-sonnet-5`), **세 사례를 동시에** 돌림(따로 돌리면 조금 짧을 수 있다). 각 1회. 기획안의 "사례 3개 × 3회"는 ops 실측(차례 6)으로 넘긴다.

| 사례 | 질문 | 전체 시간 | 첫 도구 호출 | 도구 사용 | 마지막 도구 → 결과 | 결과 |
| --- | --- | --- | --- | --- | --- | --- |
| S1 유형 A | 타사 프로모션 프로세스 대비 개선점 도출 | **189초** | 22초 | Glob 1 · Read 9 · WebSearch 3 (WebFetch 0) | 48초 → 188초 (약 140초가 본문 작성) | `compare`, 본문 약 4.4천 자, 근거 태그 30개, 위키 문서 8 · 외부 출처 5, 금액 패턴 0 |
| S2 유형 B | 현재 프로모션 프로세스·편성 이슈 점검 | **115초** | 22초 | Glob 1 · Read 12 | 42초 → 114초 | `audit`, 본문 약 3.7천 자, 태그 21개, 위키 문서 11, 웹 검색 0(기대대로), 빈칸 8 |
| S3 유형 C | 타짜 PPV 할인율 판단 자료 | **124초** | 23초 | Grep 6 · Read 6 | 61초 → 123초 | `brief`(유형 C `insight` 기대와 다름), 본문 약 2.6천 자, 태그 22개, 위키 문서 7, 웹 검색 0, **본문에 금액 패턴 4건** |

읽은 것

- 시간의 대부분은 **마지막 본문 작성**(StructuredOutput 한 번에 전체 마크다운)이다. 도구 단계는 40~60초 안에 끝나고, 그 뒤 60~140초 동안 `stream-json` 에 도구 이벤트가 없다. 진행 표시를 도구 이벤트만으로 하면 "정리하는 중" 에서 1~2분 멈춰 보인다 → `--include-partial-messages` 의 `input_json_delta` 로 "작성 중(글자 수)" 을 갱신하는 것을 권한다.
- 시작~첫 도구 호출이 약 22초로 고정에 가깝다(CLI 기동 + 첫 추론).
- S1 의 실제 검색어 3개는 모두 일반 업계 영어 용어였고 금액·회사명·사람 이름·문서 코드가 없었다. 훅 로그와 `searchQueries` 가 일치했다.
- **S3 은 프롬프트에 "본문에 금액 금지" 를 넣었는데도 금액 패턴이 4건 나왔다**(위키 문서의 가격 표기를 옮긴 것으로 보임, 값은 여기 적지 않는다). 프롬프트 규칙만으로는 부족하다 → 기획안의 `checkReportReply` 의 `publicLeaks` 후검사는 필수이고, chatbot-planner 의 `report-prompt.md` 에도 "위키에 있는 가격도 옮기지 않는다" 를 분명히 넣어야 한다.
- S3 에서 `reportType` 을 `brief` 로 골랐다. 유형 판정은 서버(`detectReportIntent`)가 정해 프롬프트로 넘기는 편이 안정적이다.
- S1 검색어에 영어 "campaign" 이 들어갔다. 검색어 자체는 문제없지만 한국어 본문의 "캠페인" 용어 규칙(Target 프로모션 전용)은 프롬프트에서 따로 지켜야 한다.
- 비용 참고(CLI 가 보고한 값, 구독 로그인 사용자는 실제 청구와 다를 수 있음): 1회 약 0.24~0.46 USD 상당. 일반 Q&A 보다 크다.

---

## 서버 제한 시간 권장값

| 항목 | 기획안 제안 | 권장 | 이유 |
| --- | --- | --- | --- |
| 서버 claude 리포트 | 300초 | **300초** | 실측 최대 189초(동시 실행). 1.6배 여유. 기본 모델이 더 느린 PC(`HUB_CLAUDE_MODEL` 에 opus 지정 등)는 넘길 수 있어 ops 실측 후 재조정 |
| 서버 codex 리포트 | 360초 | **360초 유지(미실측)** | codex 리포트는 위키 전체(약 100KB)를 프롬프트에 넣는 방식이라 claude 와 성격이 다르다. 검색 1회짜리 짧은 실험이 52초. 리포트 실측은 차례 4 구현 후 |
| 화면 중단 | 서버 + 30초 | **서버 + 30초** (claude 330초 · codex 390초) | 지금 규칙(서버 120 → 화면 150)과 같은 간격 |
| 대기 문구 | 보통 2~4분 · 최대 5분 | **보통 2~3분 · 최대 5분** | 실측 115~189초 |
| 도구 호출 수 | — | 프롬프트로 검색 4회·페이지 열기 3회 상한(실측 S1 은 검색 3 · 열기 0). 훅에서 횟수를 세어 상한 초과 호출을 거절하는 것도 가능 | 시간·비용 상한 |

---

## 차례 4 에서 쓸 인자 목록

### claude 리포트 실행

```
claude -p
  --output-format stream-json --verbose --include-partial-messages
  --no-session-persistence
  [--model … --fallback-model …]            # 기존 claudeModelArgs()
  --tools Read,Grep,Glob,WebSearch,WebFetch
  --allowedTools WebSearch,WebFetch         # 없으면 -p 에서 웹 도구가 권한 미승인으로 거절된다
  --settings <임시 폴더>/settings.json       # PreToolUse 훅. 인라인 JSON 금지(Windows cmd.exe)
  --system-prompt-file server/report-prompt.md
  --append-system-prompt <짧은 한 줄>        # 지금처럼 8KB 미만만. 긴 블록은 stdin
  --json-schema <REPORT_SCHEMA JSON>        # 초안 형태로 약 1.3KB, 명령줄 한도 안
  (stdin: 편성표 블록 + 요청 본문)
작업 폴더: 지식/
```

- 결과 파싱: stdout 을 줄 단위로 버퍼링해 JSON 한 줄씩 읽고, `type:"result"` 줄의 `structured_output`·`is_error` 를 지금 `claudeJson` 과 같이 검사한다. 중간 줄은 진행 단계로만 쓴다.
- 웹 검색을 끄는 경우(비공개 이름 목록 파일 없음 — Q3 (가)): `--tools Read,Grep,Glob`, `--allowedTools`·`--settings` 빼고 같은 스키마.
- 검색어 기록: 훅 로그 대신 `stream-json` 의 `tool_use` 입력(`query`·`url`)을 서버가 모으면 된다. 모델이 채운 `searchQueries` 와 대조해 다르면 서버 값으로 덮는다.
- 취소(`그만하고 짧게 답 받기`): 지금 `run()` 의 `child.kill()` 과 같은 방식. Windows `shell:true` 에서는 `cmd.exe` 만 죽고 손자 프로세스가 남을 수 있어 `taskkill /pid <pid> /T /F` 를 권한다(기존 제한 시간 처리에도 같은 문제가 있을 수 있음, 미확인).

### 진행 단계로 쓸 이벤트 (claude `stream-json`)

| 이벤트 | 위치 | 화면 단계 |
| --- | --- | --- |
| `{"type":"system","subtype":"init"}` | 시작 | 준비 중 |
| `assistant` → `message.content[].type=="tool_use"`, `name` 이 `Read`·`Grep`·`Glob` | 도구 호출 | 위키 문서 읽는 중 (N개) |
| 같은 이벤트, `name=="WebSearch"`(`input.query`)·`WebFetch`(`input.url`) | 도구 호출 | 외부 자료 찾는 중 |
| `user` → `tool_result` 에 `is_error:true` 이고 내용이 `PreToolUse:` 로 시작 | 훅 거절 | (화면엔 숨기고 서버 로그에만) |
| `stream_event` → `content_block_delta.delta.type=="input_json_delta"` | 최종 작성 | 정리하는 중 (작성 글자 수) |
| `{"type":"result"}` | 끝 | 결과 |

화면까지 보내려면 `/api/ask` 를 스트리밍 응답(예: NDJSON 또는 SSE)으로 바꾸거나 리포트 전용 경로를 새로 둬야 한다. 지금 `/api/ask` 는 한 번에 JSON 을 돌려주므로 **API 계약 변경**이다. 열린 질문 Q4 (가)(경과 시간 문구)로 먼저 가면 계약은 바뀌지 않는다.

### codex 리포트 실행

```
codex exec --skip-git-repo-check --ephemeral --sandbox read-only --color never
  [-m …] --output-schema <schema 파일> --output-last-message <파일> -
  # 웹 검색을 켤 때만(권장하지 않음): -c 'web_search="live"'  또는  codex --search exec …
  # 진행 단계가 필요하면 --json (JSONL 이벤트)
```

- 웹 검색을 켜면 검색어를 사전에 막을 방법이 없다(시작 이벤트에 검색어가 비어 있음). 기획안 보안 절 기준으로 **codex 는 웹 검색을 켜지 않고 위키만 근거**, 카드에 「이 엔진은 외부 검색을 하지 않았습니다」.
- 상위 지시자가 "사후 검사만으로 codex 검색 허용"을 고르면: `--json` 의 `item.completed web_search` 에서 `action.queries[]` 를 모아 `publicLeaks` 로 검사하고, 걸리면 그 리포트를 폐기·경고하는 방식까지만 가능하다(검색어는 이미 외부로 나간 뒤).

---

## PreToolUse 훅 — 가능 여부와 설정 예시

가능하다(claude 2.1.260 실측). 설정은 실행마다 임시 폴더에 파일로 써서 `--settings <경로>` 로 넘기고, 끝나면 지운다(지금 `codexJson` 의 `mkdtempSync`·`rmSync` 와 같은 방식).

settings.json (서버가 생성)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "WebSearch|WebFetch",
        "hooks": [{ "type": "command", "command": "node \"<허브 경로>/server/reportGuard.mjs\"" }]
      }
    ]
  }
}
```

훅 스크립트 골격 (실험에 쓴 형태, 파일 이름은 예시)

```js
// stdin 으로 { tool_name, tool_input } 이 온다. 종료 코드 2 + stderr 면 그 호출만 거절되고 모델이 이유를 받는다
let raw = ''
process.stdin.on('data', (d) => (raw += d))
process.stdin.on('end', () => {
  const { tool_name, tool_input } = JSON.parse(raw)
  const text = tool_name === 'WebFetch' ? tool_input.url : tool_input.query
  if (blocked(tool_name, text)) {   // 금액 패턴·비공개 이름 목록·문서 코드·내부 시스템 이름, WebFetch 는 https 아님·사설 IP·사내 주소
    process.stderr.write('검색어에 공개하면 안 되는 표현이 있어 거절했습니다. 일반 업계 용어로 바꿔 다시 검색하세요.')
    process.exit(2)
  }
  process.exit(0)
})
```

확인된 동작

| 항목 | 결과 |
| --- | --- |
| 훅 실행 순서 | 권한 검사보다 먼저 돈다(권한 미승인 호출도 훅이 먼저 봤다) → 모든 웹 호출이 훅을 거친다 |
| 거절 방식 | 종료 코드 2 + stderr. 모델에는 `PreToolUse:WebSearch hook error: … <stderr>` 가 도구 오류로 전달되고, 모델은 다음 검색을 이어 간다 |
| 경로에 공백·한글 | 문제없음(명령 안에서 큰따옴표로 감쌈) |
| 환경 변수 | 서버가 `spawn` 에 넘긴 환경이 훅까지 전달된다 → 비공개 이름 목록 경로(`HUB_PRIVATE_TERMS_FILE` 제안)를 훅이 직접 읽을 수 있다. 목록 내용을 명령줄·설정 파일에 싣지 않아도 된다 |
| 인라인 `--settings '{…}'` | Windows `shell:true` 경로에서 실패 → 파일만 쓴다 |

주의·미확인

- 훅 스크립트는 `server/` 에 두되 로컬 전용이다. `api/` 배포 함수는 리포트 모드가 없으므로 영향 없음. 검사 규칙은 `publicLeaks` 와 같은 함수를 써야 서버 후검사와 기준이 같아진다 → 훅이 `.mjs` 에서 TS 를 바로 못 부르므로 공용 규칙을 어떻게 나눌지(규칙을 JSON 으로 넘기거나 훅을 `tsx` 없이 도는 JS 로 두는 등) 차례 4 에서 정한다.
- 사용자 PC 의 `~/.claude/settings.json` 에 다른 훅·권한 설정이 있으면 함께 적용된다(합쳐짐). 격리하려면 `--setting-sources ""` 같은 방법이 있으나 **미확인**(로그인 정보에 영향이 없는지 확인 필요).
- `--max-budget-usd` 로 1회 비용 상한을 걸 수 있으나 구독 로그인에서 동작하는지 **미확인**.

---

## 대안 (훅을 못 쓰는 경우)

| 대안 | 막는 시점 | 한계 |
| --- | --- | --- |
| 프롬프트 규칙만 | 모델 판단 | S3 실측에서 "금액 금지" 규칙이 본문에서 지켜지지 않았다. 검색어에도 같은 일이 생길 수 있다 |
| 결과 후검사(`searchQueries`·`stream-json` 검색어를 `publicLeaks` 로) | 끝난 뒤 | 검색어는 이미 외부로 나갔다. 경고·로그·리포트 폐기만 가능 |
| 웹 검색 끄기 | 실행 전 | 가장 확실. codex 에 권장 |

claude 는 훅이 되므로 세 겹(규칙 + 훅 + 후검사)을 모두 쓴다.

---

## 기획안·다른 담당에 넘길 것

| 받는 쪽 | 내용 |
| --- | --- |
| PM 데스크 / 상위 지시자 | Q8: codex 는 검색 자체는 되지만 사전 차단이 안 된다. (가) 위키만 근거 권장 유지. Q4: 실제 단계 표시는 기술적으로 되지만 `/api/ask` 스트리밍 계약 변경이 든다 |
| chatbot-planner | `report-prompt.md` 에 "위키에 적힌 가격·금액도 본문에 옮기지 않는다", 유형은 서버가 지정한 값을 따른다, 한국어 본문에서 "캠페인" 용어 규칙. codex 문장은 "외부 검색 안 함" 기준 |
| ops | 사례 3개 × 3회 실측(단독 실행, 각 PC 기본 모델·opus 지정 각각). 이번 값은 동시 실행 1회 |
| dev-server (차례 4) | `--allowedTools` 필수, settings 는 임시 파일, stdout 줄 버퍼링, Windows 취소 시 프로세스 트리 종료, `publicLeaks` 후검사 필수 |
