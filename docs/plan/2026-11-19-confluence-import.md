# 사내 Confluence 페이지를 위키 지식 문서로 가져오기

작성 `plan-pm` · 2026-11-19
상위 지시: "컨플루언스 프로젝트(스페이스)를 지정해서 그 중 해시태그(레이블)나 특정 페이지 트리에 있는 페이지를 위키 지식문서(`지식/`)로 가져오게 하고 싶다."
사내 Confluence 는 **사내 서버형(Server/Data Center)** 이고 사내망 주소다. 이 문서에서는 주소를 `<사내 컨플루언스 주소>` 로만 적는다.

PM 데스크가 정한 전제(그대로 반영):

- 실행 위치는 **실무자 PC의 로컬 허브(vite 중계, `server/cliBridge.ts`)** 뿐이다. 배포(`api/`, Vercel)는 사내망에 닿지 않으므로 기능을 끄고 안내 문구만 보여 준다.
- 주소·토큰·스페이스 키는 코드에 두지 않는다. 개인별 `.env.local` 의 `CONFLUENCE_BASE_URL`, `CONFLUENCE_TOKEN` 으로 읽는다.
- 선택 기준은 스페이스 키(여러 개) + 레이블 / 상위 페이지(트리) / 둘의 조합을 **모두** 지원한다.
- 바로 커밋하지 않는다. 미리보기 → 분류(`DOC_SUBCATEGORIES`) 지정 → PR 검토 후 반영.
- 기존 가림 규칙·비공개 이름 검사·금액 경고를 가져오기에도 **반드시** 적용한다.
- 1차는 **새로 가져오기만** 한다. 원본 페이지 id·버전은 머리말에 남기고, 재가져오기(갱신)·충돌 처리는 2차로 미룬다.

---

## 문제

| 누가 | 어떤 상황에서 | 무엇을 못 하나 |
| --- | --- | --- |
| 편성·마케팅 실무자 | 팀 운영 기준·체크리스트·규격이 사내 Confluence 스페이스에 이미 정리되어 있다 | 허브 챗봇은 `지식/` 의 문서만 근거로 답한다. Confluence 에만 있는 기준은 챗봇이 모르고, 실무자는 Confluence 를 따로 열어 찾아야 한다. |
| 실무자 | 그 페이지를 허브에 넣고 싶다 | 길이 "+ 새 문서" 화면에 손으로 옮기는 것뿐이다. 한 페이지씩 복사하고, 표를 마크다운으로 다시 만들고, 정보 패널·펼치기 같은 매크로를 풀어 쓰고, 이름·사내 주소를 직접 가려야 한다. 페이지가 수십 개면 대부분 넣지 않고 끝난다. |
| 실무자 | 넣을 페이지가 "레이블 `배너규격`이 붙은 것"이나 "어느 상위 페이지 아래 전부"처럼 묶음으로 정해져 있다 | 허브에는 묶음으로 고르는 방법이 없다. 어떤 페이지를 이미 옮겼는지도 기록이 남지 않아, 같은 페이지가 두 번 들어가거나 빠진다. |
| 승인자 | 옮겨 온 문서의 PR 을 검토한다 | 원본이 어느 페이지의 몇 번째 판(버전)인지, 옮기면서 무엇이 빠졌는지(매크로·첨부) 알 수 없다. 나중에 원본이 바뀌어도 대조할 근거가 없다. |
| 허브 관리자 | 공개 저장소에 사내 문서가 들어온다 | 사내 원문에는 임직원 실명·제휴사 실명·금액·사내 주소가 섞여 있기 쉽다. 손으로 옮기면 가림이 사람마다 다르고 빠지기 쉽다. |

---

## 현재 상태 (확인한 파일 경로 포함)

### 1. "새 문서" 흐름 — 가져오기가 다시 쓸 길

| 항목 | 지금 | 근거 |
| --- | --- | --- |
| 입구 | 위키 문서 목록의 "+ 새 문서" → `/wiki/new`. 카테고리·서브메뉴는 쿼리(`category`, `sub`)나 넘겨받은 초안(prefill)으로 채운다 | `src/pages/WikiIndex.tsx:73-76`, `src/App.tsx:29`, `src/pages/NewDoc.tsx:41-63` |
| 미리보기·공개 검사 | 편집/미리보기 탭, 제출 전 `/api/publicCheck` 로 검사하고 차단·경고를 줄 단위로 보여 준다 | `src/pages/NewDoc.tsx:65-131`, `server/cliBridge.ts:915-936` |
| PR 생성 | `createDocPR` 가 공개 검사 → `nextCode(siblingCodes, subcategory)` 로 문서 코드 채번 → 브랜치 `docs/<code>-<시각>` → 파일 `지식/<category>/<code>.md` 1개 → PR 1개 | `server/github.ts:251-294` |
| 입력 계약 | `CreateDocInput { category, subcategory, title, scope, body, requestedBy, siblingCodes, via, reason }`. 본문에 `---` 머리말이 오면 거절 | `server/github.ts:38-88` |
| 머리말 | 서버가 `title·code·category·subcategory·version: 1·updatedBy·updatedAt·ownerId·scope·parent: null·order` 를 쓴다. `source`·`status` 는 쓰지 않는다 | `server/github.ts:145-166` |
| 기존 문서의 머리말 | `source: "…"`, `status: 정리완료` 칸을 쓰는 문서가 있다 (예: 이용 안내 문서) | `지식/guide/tour.md:1-16` |
| 머리말 읽기 | 화면은 `키: 값` 을 모두 읽고 쓰는 칸만 꺼낸다. 모르는 키(예: `sourcePageId`)는 무시되어 화면이 깨지지 않는다 | `src/data/knowledgeDocs.ts:14-34`, `:41-60` |
| 분류 목록 | `DOC_SUBCATEGORIES` — programming 5개, promotion 8개, guide 0개. 화면 목록(`src/data/docs.ts`)과 같아야 한다 | `server/knowledge.ts:72-88`, `src/data/docs.ts:11-33` |
| 크기 상한 | 제목 80자, 본문 50,000자, 요청 본문 512KB | `server/knowledge.ts:113`, `:366-367` |
| 진입 표시 | `DocVia = 'form' \| 'chat' \| 'report' \| 'attachment'`, PR 본문 `- 진입:` 줄은 `VIA_LABEL` | `server/publicCheck.ts:24-25`, `server/github.ts:11-18`, `src/lib/publicCheck.ts:8` |
| 배포 함수 | `api/createDoc.ts` 는 같은 `createDocPR` 을 부르되 비공개 이름 목록을 읽지 못해 금액·별표 2개만 검사한다 | `api/createDoc.ts:31-33` |

### 2. 공개 규칙 검사·가림 규칙

| 항목 | 지금 | 근거 |
| --- | --- | --- |
| 검사 종류 | 금액·비공개 이름·별표 2개·회사 표기·URL·이메일·전화·`(보완 필요)`·수치 | `server/publicCheck.ts:11`, `:150-187` |
| 차단 기준 | 새 문서에서 비공개 이름·별표 2개는 항상 차단, 금액은 `via: 'report'` 일 때만 차단(그 밖은 경고), 수치 경고는 리포트만 | `server/publicCheck.ts:189-212` |
| 비공개 이름 목록 | `HUB_PRIVATE_TERMS_FILE` 이 가리키는 공유 드라이브 파일. 없으면 `namesChecked: false` 로 이름 검사를 건너뛴다 | `server/env.ts:71-78`, `server/publicCheck.ts:108-133` |
| 자동 가림 | 리포트 후검사용 `maskPublicLeaks` 가 금액을 `(금액 생략)`, 목록 이름을 `(이름 생략)` 으로 바꾼다 | `server/publicCheck.ts:221-245` |
| 사람이 쓰는 가림 규칙 | 임직원 `홍*동`, 부서 `미디어*팀`, 사내 URL `(사내 Confluence 원문 · URL 생략)`. 별표는 하나만 | `server/edit-prompt.md:12-15` |
| 로그 원칙 | 걸린 표기는 로그에 남기지 않고 종류별 건수만(`hitCounts`) | `server/publicCheck.ts:214-219`, `api/createDoc.ts:37-38` |

### 3. 사내망 연동 선례 — "Jira 스케줄 확인"

| 항목 | 지금 | 근거 |
| --- | --- | --- |
| 설정 읽기 | `.env.local` 의 `JIRA_BASE_URL`·`JIRA_PROJECT_KEY` 를 `readJiraBaseUrl`·`readJiraProjectKey` 로 읽는다. 끝 `/` 는 잘라 낸다 | `server/env.ts:54-61`, `server/cliBridge.ts:654-656` |
| 조회 방식 | REST 를 직접 부르지 않고, 로그인된 claude CLI 에 Jira MCP(서버 이름 `jira`)를 열어 모델이 이슈 설명의 표를 읽어 정리한다(`--tools mcp__jira`, 읽기 전용 지시) | `server/cliBridge.ts:568-582`, `server/jiraSchedule.ts:52-66` |
| 경로 | `GET /api/jiraSchedule` 는 cliBridge 에만 있고 `api/` 에는 없다 → 배포본은 404 | `server/cliBridge.ts:748-773` |
| 배포본 안내 | 화면이 404 를 받으면 "배포본에서는 지원되지 않는 화면입니다" 패널을 띄운다 | `src/pages/JiraSchedule.tsx:36-41`, `:85-92` |
| 켤 때 상태 줄 | 허브 창에 `jira ✓ 설정됨 / ✗ 설정 안 됨(스케줄 확인 비활성)` 한 줄 | `server/cliBridge.ts:665-667` |
| 설정 안내 | 개인 액세스 토큰 발급 → `claude mcp add jira …` 등록 안내 | `docs/jira-mcp-setup.md` |
| 요청 입구 | 로컬 출처(`http://localhost:5173` 등)만 받고, 본문 크기를 먼저 자른다 | `server/guard.ts:40`, `server/cliBridge.ts:584-634` |

### 4. 실행기 기록 위치

| 항목 | 지금 | 근거 |
| --- | --- | --- |
| 기록 폴더 | Mac `~/wiki-hub-기록/설치기록.txt`, Windows `%USERPROFILE%\wiki-hub-기록` | `start-hub.command:29-30`, `scripts/setup.ps1:26` |
| 허브 실행 중 로그 | vite 중계의 `[cli-bridge] …` 줄은 허브 창(터미널)에 찍힌다 | `server/cliBridge.ts` 전반 |

### 5. 지금 없는 것

- Confluence 관련 코드·환경변수·화면은 **하나도 없다.** (`grep -ri confluence server api src` 결과는 `edit-prompt.md` 의 가림 문구뿐)
- XHTML(storage 형식) 파서 의존성이 없다. 지금 의존성은 `react-markdown`·`remark-gfm`·`diff`·`fflate` 등이다(`package.json`).
- 여러 파일을 한 PR 로 올리는 함수가 없다. `createDocPR` 은 파일 1개·PR 1개다.

---

## 방식 비교 — REST 직접 호출 vs MCP

| 기준 | A. REST 직접 호출 (PAT, `Authorization: Bearer`) | B. claude CLI + Confluence MCP (Jira 방식) |
| --- | --- | --- |
| 호출 | vite 중계가 `fetch('<사내 컨플루언스 주소>/rest/api/content/search?cql=…')` 를 직접 부른다 | 모델이 MCP 도구로 검색·본문을 받아 JSON 으로 정리한다 |
| 결과 일관성 | 같은 조건이면 늘 같은 목록·같은 변환 결과 | 모델이 목록을 줄이거나 표를 요약할 수 있다. 같은 조건에서 결과가 달라질 수 있다 |
| 페이지 id·버전 기록 | API 응답 값을 그대로 쓴다 | 모델이 옮겨 적는다 — 틀려도 서버가 검증할 방법이 없다 |
| 변환·가림 | 코드 규칙으로 변환하고 손실을 줄 번호까지 표시할 수 있다 | 변환을 모델에 맡긴다. "무엇이 빠졌는지"를 보장할 수 없다 |
| 필요 조건 | Confluence DC 7.9 이상의 개인 액세스 토큰 + `.env.local` 두 줄 | claude CLI 설치·로그인 + MCP 서버 설치(`uvx` 등) + 등록. Codex·Gemini 만 쓰는 PC는 못 쓴다 |
| 속도·비용 | 페이지당 HTTP 1회, 수 초 | 페이지 수에 비례해 모델 토큰·시간이 든다(수십 페이지면 수 분) |
| 초보자 설정 | 토큰 복사 → `.env.local` 에 붙여 넣기 (실행기 안내로 끝낼 수 있음) | 터미널 명령 `claude mcp add …` 이 필요하다 |
| 사내 인증서 | Node `fetch` 가 사내 인증서를 모르면 실패 → `NODE_EXTRA_CA_CERTS` 안내 필요 | MCP 서버(파이썬 등)도 같은 문제를 따로 겪는다 |
| 테스트 | 변환 함수를 저장소 안 예시 XHTML 로 시험할 수 있다 | 모델 출력이라 회귀 시험이 어렵다 |

**권고: A. REST 직접 호출.** 이번 기능의 핵심은 "원문을 빠짐없이, 같은 규칙으로 옮기고, 무엇을 가렸고 무엇이 빠졌는지 남기는 것"이다. 이 셋은 모델 해석이 아니라 코드 규칙이어야 지켜진다. Jira 스케줄은 이슈 설명 속 비정형 표를 "해석"해야 해서 MCP 가 맞았지만, Confluence storage 는 구조가 정해진 XHTML 이라 해석이 필요 없다.
B 는 2차 이후 "가져온 문서를 요약해 기존 문서에 합치기" 같은 해석형 기능에서 다시 검토한다.

---

## 이번 범위 / 범위 밖

### 1차 (이번 범위)

| # | 항목 | 내용 |
| --- | --- | --- |
| S1 | 설정 | `.env.local` 의 `CONFLUENCE_BASE_URL`·`CONFLUENCE_TOKEN` 을 `server/env.ts` 에서 읽는다. 허브 창 상태 줄에 `confluence ✓ 설정됨 / ✗ 설정 안 됨(가져오기 비활성)` 을 붙인다. 토큰은 화면으로 보내지 않는다 |
| S2 | 조건으로 찾기 | 스페이스 키(1개 이상, 필수) + 레이블(0개 이상) + 상위 페이지(0개 이상)를 화면에서 입력 → 서버가 CQL 을 **직접 조립**한다. 화면은 CQL 문자열을 보내지 않는다 |
| S3 | 목록·선택 | 찾은 페이지를 트리(상위 페이지 기준 들여쓰기)로 보여 주고 체크박스로 고른다. 이미 가져온 페이지는 "이미 있음 (문서 코드)"로 표시하고 고를 수 없게 한다 |
| S4 | 변환 | 고른 페이지의 storage(XHTML)를 마크다운으로 변환한다. 변환 규칙·손실 표시는 [변환 규칙](#storagexhtml--마크다운-변환-규칙) 절 |
| S5 | 자동 가림 | 사용자 언급 → `홍*동`, 사내 주소 → `(사내 Confluence 원문 · URL 생략)`, 이메일·전화 → `(연락처 생략)`, 비공개 이름 목록 일치 → `(이름 생략)`. 자세한 표는 [민감정보 처리](#민감정보-처리) 절 |
| S6 | 미리보기·분류 | 페이지마다 변환본 미리보기, 손실 목록, 공개 검사 결과(차단·경고)를 보여 준다. 한꺼번에 카테고리·서브메뉴·적용 범위(PPM/PPV/공통)를 정하고, 페이지별로 바꿀 수 있다. 제목·본문은 고칠 수 있다 |
| S7 | PR 제출 | 고른 페이지 묶음(최대 10개)을 **PR 1개**로 올린다. 문서 코드는 서브메뉴별로 이어서 채번한다. 머리말에 원본 페이지 id·버전·가져온 날을 남긴다. 진입은 `via: 'confluence'` (PR 본문 `- 진입: 사내 Confluence`) |
| S8 | 트리 유지 | 같은 묶음 안에 상위 페이지도 들어 있으면 하위 문서 머리말 `parent` 에 상위 문서 코드를 넣는다. 같은 묶음 안 페이지끼리의 링크는 문서 코드 링크(`[제목](CODE)`)로 바꾼다 |
| S9 | 배포본 | `api/` 에 경로를 두지 않는다(404). 화면은 404 를 받으면 "로컬 허브에서만 쓸 수 있어요" 안내를 띄운다. 위키 목록의 입구 버튼은 배포본에서 눌러도 같은 안내로 간다 |
| S10 | 초보자 안내 | 토큰 발급·설정 안내 문서(쉬운 한국어), 실패 시 화면에 "지금 할 일" 한 줄 + 기록 위치 |

### 2차 (다음에)

| 항목 | 미루는 이유 |
| --- | --- |
| 재가져오기(원본이 바뀐 페이지 갱신) | 위키에서 고친 내용과 원본 변경이 겹칠 때의 규칙(누가 이기나, 줄 단위 병합)을 정해야 한다. 1차에서 남긴 `sourcePageId`·`sourceVersion` 으로 "원본이 바뀜" 표시부터 시작할 수 있다 |
| 충돌 처리(같은 페이지가 열린 PR 에 이미 있음) | 1차는 `지식/` 에 반영된 문서만 대조한다. 열린 PR 까지 대조하려면 제안 목록 API 를 함께 봐야 한다 |
| 첨부 파일(PDF·Word) 본문 가져오기 | 첨부를 문서로 넣는 흐름은 `docs/plan/2026-11-13-chat-doc-draft-and-attachments.md` 의 첨부 기능과 합쳐 설계해야 중복이 없다 |
| 기존 문서에 합치기 제안(AI) | 해석형 기능이라 MCP·CLI 를 다시 검토할 자리다 |
| 본문 속 일반 글자로 쓴 임직원 이름·부서명 자동 가림 | 규칙으로 찾을 수 없다(사람 이름과 일반 낱말 구분 불가). 1차는 미리보기에서 사람이 확인하고, 필요하면 수정 제안 화면의 "AI로 수정"을 쓴다 |
| 페이지 분류 자동 추천 | 레이블→서브메뉴 대응표를 운영하면서 쌓은 뒤 판단한다 |

### 범위 밖 (하지 않음)

| 항목 | 이유 |
| --- | --- |
| 배포본(Vercel)에서 가져오기 | 사내망에 닿지 않고, 개인 토큰을 공개 서버에 둘 수 없다 |
| 화면에서 CQL 직접 입력 | 검색 범위를 넘는 조회·오입력을 막기 어렵다. 조건 입력칸으로 충분하다 |
| PR 없이 `지식/` 에 바로 쓰기 | 공개 저장소라 사람 검토를 거쳐야 한다(전제) |
| Confluence 쪽에 쓰기(레이블 달기·댓글 등) | 읽기만 한다. 토큰도 읽기 용도로만 안내한다 |
| Confluence Cloud 지원 | 사내는 Server/DC 다. Cloud 는 인증·API 경로가 다르다 |
| 이미지 내려받아 저장소에 올리기 | 공개 저장소에 사내 이미지가 올라간다. 1차는 자리 표시만 |

---

## 사용자 흐름

```
위키 문서 목록 ─[Confluence 에서 가져오기]→ ① 조건 입력 ─[찾기]→ ② 페이지 고르기 ─[미리보기]→
③ 미리보기·분류 (페이지별 변환본·손실·공개 검사) ─[PR 로 제출]→ ④ 완료 (PR 링크, 문서 코드 목록)
```

| 단계 | 사용자가 하는 일 | 화면이 보여 주는 것 | 막히는 경우 |
| --- | --- | --- | --- |
| 0. 입구 | 위키 문서 목록에서 [Confluence 에서 가져오기] | — | 배포본 → "로컬 허브에서만 쓸 수 있어요" 안내. 설정 없음 → 설정 안내 링크(단계 진행 불가) |
| ① 조건 | 스페이스 키 입력(여러 개, 쉼표·엔터로 추가). 레이블 입력(선택). 상위 페이지 입력(선택, 페이지 주소를 붙여 넣으면 id 를 뽑는다). 레이블이 여러 개면 "하나라도 붙은 것 / 모두 붙은 것" 선택. 상위 페이지 자체를 포함할지 선택(기본: 포함) | 조건을 한국어 한 줄로 풀어 보여 줌 (예: "스페이스 2곳에서, 레이블 `배너규격` 이 붙고, 상위 페이지 1개 아래에 있는 페이지") | 스페이스 키 없음 → [찾기] 비활성 |
| ② 고르기 | 체크박스로 고른다(최대 10개). 상위 페이지를 고르면 하위 전체 선택 보조 버튼 | 트리 목록: 제목·스페이스·마지막 수정일·레이블. 이미 가져온 페이지는 회색 "이미 있음 (코드)". 결과가 상한(200개)을 넘으면 "조건을 좁혀 주세요" | 0건 → "조건에 맞는 페이지가 없어요. 스페이스 키와 레이블 철자를 확인해 주세요" |
| ③ 미리보기·분류 | 위에서 한꺼번에 카테고리·서브메뉴·적용 범위를 고른다. 페이지별로 바꿀 수 있다. 제목·본문을 고칠 수 있다. 등록 사유(선택) | 페이지별: 변환본 미리보기 / 원문과 달라진 점(손실 목록, 자동 가림 건수) / 공개 검사 결과(차단·경고 줄 번호). 차단이 하나라도 있으면 그 페이지에 빨간 표시 | 차단 남음 → [PR 로 제출] 비활성 + "빨간 표시 페이지를 고치거나 빼 주세요". 비공개 이름 목록 없음 → 제출 비활성(아래 민감정보 절) |
| ④ 완료 | — | PR 링크, 새 문서 코드·경로 목록, "승인되면 위키에 나타나요" | PR 실패 → "지금 할 일" 한 줄 + 기록 위치 |

화면 배치·단계 표시·문구는 `wiki-ux`·`requests-planner` 가 정한다. 위 표는 흐름과 막힘 조건의 기준이다.

---

## API·데이터 계약 초안

### 환경변수 (`.env.local`, 로컬 허브 전용)

| 이름 | 필수 | 뜻 | 예 (자리표시자) |
| --- | --- | --- | --- |
| `CONFLUENCE_BASE_URL` | 예 | 사내 Confluence 주소. 끝 `/` 는 서버가 잘라 낸다. 컨텍스트 경로(`/confluence` 등)가 있으면 포함 | `<사내 컨플루언스 주소>` |
| `CONFLUENCE_TOKEN` | 예 | 개인 액세스 토큰(PAT). `Authorization: Bearer <토큰>` 으로만 쓴다 | — |
| `CONFLUENCE_DEFAULT_SPACES` | 아니요 | 화면 ① 의 스페이스 칸 기본값(쉼표 구분). 공개 저장소라 코드·예시 파일에 실제 키를 적지 않는다 | — |
| `NODE_EXTRA_CA_CERTS` | 상황에 따라 | 사내 인증서 때문에 연결이 막힐 때 Node 가 읽는 표준 변수. 검증을 끄는 설정(`NODE_TLS_REJECT_UNAUTHORIZED=0`)은 **쓰지 않는다** | — |

`server/env.ts` 에 `readConfluenceBaseUrl`·`readConfluenceToken`·`readConfluenceDefaultSpaces` 를 `readJiraBaseUrl` 과 같은 꼴로 둔다.

### Confluence 쪽 호출 (서버 → `<사내 컨플루언스 주소>`)

| 용도 | 호출 | 비고 |
| --- | --- | --- |
| 연결 확인 | `GET /rest/api/space?limit=1` | 토큰 유효성·네트워크만 본다 |
| 찾기 | `GET /rest/api/content/search?cql=<조립한 CQL>&limit=50&start=<n>&expand=ancestors,metadata.labels,version,space` | 목록 단계는 본문(`body.storage`)을 받지 않는다. `start` 로 넘기며 최대 200개까지 |
| 본문 | `GET /rest/api/content/{id}?expand=body.storage,ancestors,metadata.labels,version,space` | 고른 페이지만, 동시에 3개 이하 |
| 사용자 이름 | `GET /rest/api/user?key=<userkey>` (또는 `username=`) | 사용자 언급을 `홍*동` 으로 가릴 때만. 같은 묶음 안에서 캐시 |

**CQL 조립 규칙** (서버만 조립, 입력값은 형식 검사 후 따옴표로 감싼다):

```
type = page
AND space in ("<키1>", "<키2>")
[AND label in ("<레이블1>", "<레이블2>")]                        -- 레이블 "하나라도"
[AND label = "<레이블1>" AND label = "<레이블2>"]                -- 레이블 "모두"
[AND (ancestor = <id1> OR id = <id1> OR ancestor = <id2> ...)]    -- "상위 페이지 자체 포함"이면 id = 를 함께
ORDER BY title
```

- 스페이스 키: `^~?[A-Za-z0-9_]{1,64}$`, 1~10개. 레이블: 공백·따옴표·괄호·쉼표 없는 1~100자, 소문자로 맞춤, 0~10개. 상위 페이지 id: 숫자 1~5개. 페이지 주소를 붙여 넣으면 `pageId=<숫자>` 또는 `/pages/<숫자>` 에서 id 만 뽑고 주소는 버린다.
- 레이블과 상위 페이지를 함께 주면 **AND** 다(둘 다 만족). "레이블 또는 트리"가 필요하면 두 번 찾아 고른다 — 열린 질문 Q2.

### 허브 API (vite 중계 `server/cliBridge.ts` 에만, `api/` 에는 없음)

모두 기존 요청 입구(로컬 출처·본문 크기 검사)를 지난다. 배포본은 경로가 없어 404.

**`GET /api/confluence/status`**

```ts
{ configured: boolean;            // 주소·토큰 둘 다 있음
  reachable: boolean | null;      // 연결 확인 결과, configured=false 면 null
  problem?: ConfluenceProblem;    // 아래 오류 분류
  defaultSpaces: string[];
  namesChecked: boolean }         // HUB_PRIVATE_TERMS_FILE 을 읽었는가
```

**`POST /api/confluence/search`** (본문 상한 `MAX_FORM_BYTES` 16KB)

```ts
// 요청
{ spaces: string[]; labels: string[]; labelMode: 'any' | 'all';
  ancestors: string[]; includeAncestor: boolean }
// 응답
{ items: Array<{
    pageId: string; title: string; spaceKey: string;
    version: number; updatedAt: string;          // version.when 의 날짜
    labels: string[];
    parentPageId: string | null;                 // ancestors 의 마지막
    depth: number;                               // 화면 트리 들여쓰기
    imported: { code: string; path: string } | null   // 지식/ 머리말 sourcePageId 대조
  }>;
  total: number; truncated: boolean;             // 200개 상한을 넘었는가
  summary: string }                              // 조건 한 줄 풀이
```

**`POST /api/confluence/preview`** (본문 상한 `MAX_FORM_BYTES`)

```ts
// 요청
{ pageIds: string[] }   // 1~10개, imported 인 페이지는 서버가 거절
// 응답
{ items: Array<{
    pageId: string; title: string; version: number; parentPageId: string | null;
    body: string;                                 // 변환·자동 가림을 마친 마크다운 (머리말 없음)
    losses: Array<{ kind: LossKind; line: number; label: string }>;
    masked: { user: number; url: number; contact: number; name: number };
    check: PublicCheckResult;                     // via:'confluence', target:'new' 로 검사한 결과
    tooLong: boolean                              // 본문 50,000자 초과 — 잘라 내지 않고 제출 불가로 표시
  }> }
```

`LossKind = 'macro' | 'attachment' | 'image' | 'jira' | 'table' | 'link' | 'unknown'`

**`POST /api/confluence/import`** (본문 상한 새 상수 `MAX_IMPORT_BYTES`, 10페이지 × 본문 상한을 담을 크기)

```ts
// 요청
{ items: Array<{
    pageId: string; version: number;              // preview 에서 받은 값
    category: string; subcategory: string | null; scope: 'PPM' | 'PPV' | '공통';
    title: string; body: string;                  // 사용자가 고쳤을 수 있다
    parentPageId: string | null
  }>;
  siblingCodes: Record<string, string[]>;          // 서브메뉴(없으면 카테고리) → 현재 코드들
  requestedBy: string; reason: string }
// 응답
{ prUrl: string; prNumber: number;
  docs: Array<{ pageId: string; code: string; path: string }> }
```

- 서버는 제출 직전 **다시** `publicLeaks` 를 돌린다(화면 검사를 믿지 않는다). 한 페이지라도 차단이면 PR 을 만들지 않고 `400 { code: 'public-leak', items: [{ pageId, blocks }] }`.
- 비공개 이름 목록을 못 읽으면 `400 { code: 'names-unchecked' }` (민감정보 절 M6).
- 같은 `pageId` 가 `지식/` 에 이미 있으면 `409 { code: 'already-imported', pageId, existing: { code, path } }`.
- 문서 코드는 `nextCode` 를 페이지 순서대로 반복 적용해 묶음 안에서 겹치지 않게 채번한다. 자동 채번이 안 되는 서브메뉴는 기존과 같이 `400 { code: 'no_auto_code' }`.
- PR 1개: 브랜치 `docs/confluence-<시각>`, 파일 N개, 제목 `Confluence 가져오기: <첫 제목> 외 N-1건`. PR 본문에 진입·요청자·문서 코드 목록·페이지별 손실 건수·자동 가림 건수·경고 건수를 적는다. **페이지 제목 외의 원문·주소·스페이스 키는 PR 본문에 적지 않는다.**
- GitHub 쓰기는 `server/github.ts` 에 `createImportPR` 로 두고 기존 `gh`·`putFile`·`openPr`·`buildMarkdown` 을 다시 쓴다(파일 N개는 순서대로 `putFile` 또는 Git Data API 로 한 커밋 — `dev-server` 판단).

**오류 분류 `ConfluenceProblem`** — 화면은 이 값으로 "지금 할 일" 한 줄을 고른다(문구는 `requests-planner`).

| code | 원인 | 지금 할 일 (초안) |
| --- | --- | --- |
| `not-configured` | 주소·토큰 없음 | "설정 안내를 따라 `.env.local` 에 두 줄을 넣고 허브를 다시 켜 주세요." |
| `unauthorized` | 401 | "토큰이 틀렸거나 만료됐어요. 새 토큰을 받아 바꿔 넣어 주세요." |
| `forbidden` | 403 또는 스페이스 권한 없음 | "이 스페이스를 볼 권한이 없어요. 스페이스 키를 확인하거나 관리자에게 권한을 요청해 주세요." |
| `network` | 주소를 못 찾음·연결 거절·시간 초과 | "회사망(또는 VPN)에 연결돼 있는지 확인해 주세요." |
| `certificate` | 사내 인증서 검증 실패 | "회사 인증서 설정이 필요해요. 설정 안내의 '인증서' 절을 따라 주세요." |
| `bad-input` | 조건 형식 오류 | 칸별 안내 |
| `upstream` | 그 밖의 5xx | "Confluence 가 응답하지 않아요. 잠시 뒤 다시 해 주세요." |

모든 실패 화면은 끝에 "자세한 기록: 허브 창(검은 창)의 `[cli-bridge] confluence` 줄" 을 함께 보여 준다. 허브 창 로그에는 **건수·페이지 id·HTTP 상태만** 남긴다. 토큰·주소·CQL·스페이스 키·페이지 제목·본문은 남기지 않는다.

### 문서 머리말 (가져온 문서)

`buildMarkdown` 이 쓰는 기존 칸에 아래를 더한다.

```yaml
source: "사내 Confluence"
sourcePageId: 123456789
sourceVersion: 7
importedAt: 2026-11-19
```

- 스페이스 키·원본 주소·원본 작성자는 **적지 않는다**(공개 저장소). 페이지 id 는 사내망 밖에서 의미가 없는 숫자라 남긴다.
- `parent` 는 같은 묶음의 상위 페이지가 있으면 그 문서 코드, 없으면 `null`.
- 나중의 수정 제안(`createEditPR`)이 이 칸을 지우지 않아야 한다 — `bumpFrontmatter` 가 모르는 키를 그대로 두는지 `dev-server` 가 확인한다(`server/github.ts:395-418`).
- "이미 가져옴" 판정은 `지식/**/*.md` 머리말의 `sourcePageId` 로 한다(`server/knowledge.ts` 의 문서 목록 읽기와 같은 방식).

### 진입 표시

`DocVia` 에 `'confluence'` 를 더한다(`server/publicCheck.ts`, `src/lib/publicCheck.ts` 두 곳 동시). `VIA_LABEL.confluence = '사내 Confluence'`.

---

## storage(XHTML) → 마크다운 변환 규칙

원칙: **옮길 수 있는 것은 옮기고, 못 옮긴 것은 그 자리에 표시를 남긴다. 소리 없이 지우지 않는다**(목차처럼 의미가 없는 것만 예외).
손실 표시는 본문 안 `*(원문 확인 필요: <무엇>)*` 한 줄 + 미리보기의 손실 목록(줄 번호)이다. 별표는 하나(기울임)라 별표 2개 검사에 걸리지 않는다.

| 원문 요소 | 변환 | 손실 표시 |
| --- | --- | --- |
| `h1`·`h2` | `##` | — |
| `h3`~`h6` | `###` (위키 규칙상 `##`·`###` 만) | — |
| 문단·줄바꿈·굵게·기울임·취소선·인라인 코드 | 마크다운 그대로. 굵게는 짝을 맞춘다(`balanceBold` 와 같은 결과) | — |
| 목록(중첩 포함)·작업 목록(`ac:task-list`) | `-`·`1.`·`- [ ]`/`- [x]` | — |
| 단순 표(병합 없음, 칸 안이 글자뿐) | GFM 표. 첫 줄이 `th` 면 머리줄, 아니면 첫 줄을 머리줄로 | — |
| 병합 셀(`rowspan`·`colspan`) 있는 표 | 병합을 풀어 같은 값을 반복해 채운다 | `table` "병합된 칸을 풀어 썼어요" |
| 칸 안에 목록·여러 문단 | 칸 안에서 `<br>` 대신 ` · ` 로 이어 붙인다 | — |
| 표 안의 표 | 안쪽 표는 글자만 남긴다 | `table` "표 안의 표" |
| 정보·참고·주의·경고·팁 패널(`info`·`note`·`warning`·`tip`·`panel`) | `> **참고:**` / `> **주의:**` / `> **경고:**` / `> **팁:**` 인용 블록. 패널 제목이 있으면 이름 뒤에 | — |
| 펼치기(`expand`) | 펼친 상태로 내용을 옮기고, 제목은 굵은 한 줄 | — |
| 코드 블록(`code`·`noformat`) | 펜스 코드 블록, 언어 값 유지 | — |
| 상태 표시(`status`) | `[상태: <글자>]` | — |
| 목차·하위 페이지 목록·최근 변경·레이블 목록(`toc`·`children`·`pagetree`·`recently-updated`·`contentbylabel`) | 지운다. `children`·`pagetree` 는 같은 묶음 하위 문서 코드 링크 목록으로 바꿀 수 있으면 바꾼다 | `toc` 는 없음, 나머지는 `macro` |
| Jira 이슈 하나(`jira` + `key`) | 이슈 키 글자만 (`ABC-123`), 주소 없음 | — |
| Jira 표·검색(`jira` + `jqlQuery`) | 지운다 | `jira` "Jira 이슈 목록 — 원문에서 확인" |
| 첨부 파일(`view-file`·`ri:attachment` 링크) | `*(첨부 파일 생략)*`. 파일 이름은 적지 않는다 | `attachment` |
| 이미지(`ac:image`) | `*(이미지 생략)*`. `ac:alt`·캡션이 있으면 그 글자를 덧붙인다 | `image` |
| 페이지 링크(`ac:link` → `ri:page`) | 같은 묶음 안이면 `[제목](CODE)`, 이미 가져온 페이지면 그 코드, 아니면 링크 글자만 | 묶음 밖이면 `link` |
| 사용자 언급(`ri:user`) | 표시 이름을 받아 `홍*동` 으로 가린다. 이름을 못 받으면 `(담당자)` | — (가림 건수로 집계) |
| 바깥 링크(`a href`) | 사내 주소면 [민감정보](#민감정보-처리) 규칙, 공개 주소면 `[글자](주소)` 유지(공개 검사 `url` 경고로 사람이 본다) | — |
| 날짜(`time`) | `YYYY-MM-DD` | — |
| 이모티콘(`ac:emoticon`) | 지운다 | — |
| 그 밖의 매크로·모르는 태그 | 안쪽 글자만 남긴다(`ac:rich-text-body` 가 있으면 그 내용) | `unknown` "<매크로 이름>" |

- 변환 결과 본문이 50,000자를 넘으면 자르지 않고 `tooLong: true` 로 돌려 제출을 막는다("페이지를 나눠서 가져와 주세요").
- 변환은 순수 함수(`storageToMarkdown(xhtml, ctx) → { body, losses, masked }`)로 두고, 저장소 안 **가짜 예시 XHTML**(실명·주소 없음)로 시험한다.
- XHTML 파서 의존성을 새로 들일지, 정규식·간단한 토크나이저로 갈지는 `dev-server` 가 정한다. 새 의존성을 들이면 보고 표에 밝힌다.

---

## 민감정보 처리

| # | 무엇 | 처리 | 시점 |
| --- | --- | --- | --- |
| M1 | 사용자 언급(`ri:user`)·사용자 프로필 매크로 | 표시 이름을 `홍*동` (첫 글자·`*`·끝 글자, 두 글자 이름은 `홍*`)으로 자동 가림 | 변환 |
| M2 | 사내 주소 — `CONFLUENCE_BASE_URL` 의 호스트, 그리고 점 없는 호스트·사설 IP·`.local`·`.corp` 류 | `(사내 Confluence 원문 · URL 생략)` 으로 바꾼다(링크 글자는 남긴다) | 변환 |
| M3 | 이메일·전화번호 | `(연락처 생략)` 으로 바꾼다 | 변환 |
| M4 | 비공개 이름 목록(`HUB_PRIVATE_TERMS_FILE`) 일치 | 미리보기에서 `(이름 생략)` 으로 자동 가림(`maskPublicLeaks` 와 같은 규칙) + 건수 표시. 사용자가 되살려 쓰면 제출 시 차단 | 변환 + 제출 |
| M5 | 금액 | 공개 검사로 경고(줄 번호 표시). 자동 가림·차단 여부는 열린 질문 Q1. 결정 전 기본값은 **경고 + 미리보기에서 "(금액 생략)으로 바꾸기" 버튼** | 미리보기 + 제출 |
| M6 | 비공개 이름 목록을 못 읽음 | **가져오기 제출 차단.** 사내 원문은 제휴사 실명이 섞일 가능성이 높아, 리포트 반영(`NewDoc.tsx:81` `reportHalted`)과 같은 수준으로 막는다. 안내: "비공개 이름 목록 파일이 연결돼 있지 않아 제출할 수 없어요. 허브 담당자에게 `HUB_PRIVATE_TERMS_FILE` 설정을 요청해 주세요." | 상태 + 제출 |
| M7 | 별표 2개 가림·회사 표기(`주식회사`·`(주)` 등) | 기존 공개 검사 그대로(별표 2개 차단, 회사 표기 경고) | 제출 |
| M8 | 본문 속 일반 글자 임직원 이름·부서명 | 규칙으로 못 찾는다. 미리보기 위에 "이름·부서명이 글자로 쓰여 있으면 `홍*동`·`미디어*팀` 처럼 가려 주세요" 안내를 고정하고, 제출 전 확인 체크("가림을 확인했어요")를 받는다 | 미리보기 |
| M9 | 원본 작성자·최종 수정자·스페이스 키·원본 주소 | 머리말·PR 본문·로그 어디에도 옮기지 않는다. `updatedBy` 는 기존과 같이 요청자 | 제출 |

모든 차단·경고는 `server/publicCheck.ts` 의 `publicLeaks` 한 곳의 규칙을 쓴다. 가져오기 전용 규칙을 따로 만들지 않는다(`via: 'confluence'` 분기만 더한다).

---

## 수용 기준

**설정·실행 위치**

1. `.env.local` 에 `CONFLUENCE_BASE_URL`·`CONFLUENCE_TOKEN` 이 없으면 허브 창 상태 줄에 `confluence ✗ 설정 안 됨(가져오기 비활성)` 이 뜨고, 가져오기 화면은 설정 안내 링크만 보여 주며 [찾기] 를 누를 수 없다.
2. 둘 다 있으면 상태 줄에 `confluence ✓ 설정됨` 이 뜬다. 상태 줄·로그 어디에도 토큰·주소가 찍히지 않는다.
3. 배포본에서 `/api/confluence/*` 는 404 이고, 가져오기 화면은 "로컬 허브에서만 쓸 수 있어요" 안내를 띄운다. `api/` 폴더에 confluence 파일이 없다.
4. 브라우저 개발자 도구의 네트워크 응답 어디에도 토큰과 `CONFLUENCE_BASE_URL` 값이 나오지 않는다.
5. 저장소 전체(`.env.example`·`docs/` 포함)에서 회사 도메인·실제 스페이스 키·토큰을 검색하면 0건이다.

**찾기·고르기**

6. 스페이스 키 1개만 넣고 찾으면 그 스페이스의 페이지만 나온다(서버가 만든 CQL 에 `type = page AND space in (...)` 이 들어간다).
7. 레이블 2개 + "하나라도"는 둘 중 하나라도 붙은 페이지, "모두"는 둘 다 붙은 페이지만 나온다.
8. 상위 페이지 id 를 넣으면 그 아래 모든 깊이의 하위 페이지가 나오고, "상위 페이지 자체 포함"을 켜면 그 페이지도 나온다.
9. 레이블과 상위 페이지를 함께 넣으면 둘 다 만족하는 페이지만 나온다.
10. 페이지 주소를 상위 페이지 칸에 붙여 넣으면 id 만 남고 주소는 화면 상태·요청 본문에 남지 않는다.
11. 화면이 `cql` 문자열을 보내도 서버는 무시한다. 형식에 맞지 않는 스페이스 키·레이블(따옴표·괄호 포함)은 400 과 칸별 안내로 돌아온다.
12. 결과가 200개를 넘으면 200개까지만 보여 주고 "조건을 좁혀 주세요" 가 뜬다. 11개째를 고르려 하면 "한 번에 10개까지" 안내가 뜬다.
13. `지식/` 에 같은 `sourcePageId` 문서가 있는 페이지는 "이미 있음 (문서 코드)" 로 보이고 고를 수 없다. 서버에 직접 보내도 409 `already-imported` 다.

**변환**

14. 가짜 예시 XHTML 시험 묶음(정보 패널·펼치기·병합 표·Jira 이슈·Jira 표·첨부·이미지·사용자 언급·사내 링크·모르는 매크로·`h1`~`h4` 를 포함)을 변환하면 위 변환 규칙 표와 같은 결과가 나온다.
15. 변환본의 소제목은 `##`·`###` 뿐이다.
16. 옮기지 못한 요소마다 본문에 `*(원문 확인 필요: …)*` 한 줄이 남고, 미리보기 손실 목록에 같은 개수·같은 줄 번호로 나온다. 목차 매크로만 표시 없이 지워진다.
17. 같은 묶음 안 페이지로 가는 링크는 `[제목](문서 코드)` 로 바뀌고, PR 머지 뒤 `scripts/check-anchors.mjs` 가 깨진 링크 0개를 보고한다.
18. 50,000자를 넘는 페이지는 잘리지 않고 제출 불가로 표시된다.

**민감정보**

19. 사용자 언급은 `홍*동` 꼴로만 나온다(별표 1개). 변환본에 별표 2개 가림이 0건이다.
20. `CONFLUENCE_BASE_URL` 호스트로 가는 링크는 모두 `(사내 Confluence 원문 · URL 생략)` 으로 바뀐다. 이메일·전화번호는 `(연락처 생략)` 이다.
21. 비공개 이름 목록에 있는 이름이 원문에 있으면 미리보기에서 `(이름 생략)` 으로 바뀌어 있고, 사용자가 이름을 되살려 제출하면 서버가 400 `public-leak` 으로 막는다.
22. `HUB_PRIVATE_TERMS_FILE` 이 없거나 못 읽으면 [PR 로 제출] 이 비활성이고, 서버에 직접 보내도 400 `names-unchecked` 다.
23. 금액이 있으면 미리보기에 줄 번호와 함께 경고가 뜬다(Q1 결정에 따라 차단 여부가 달라진다).
24. 머리말·PR 본문·허브 창 로그에 스페이스 키·원본 주소·원본 작성자 이름이 0건이다. 로그의 공개 검사 결과는 `hitCounts` 꼴(종류별 건수)뿐이다.

**제출·반영**

25. 페이지 3개를 서로 다른 서브메뉴 2곳으로 나눠 제출하면 PR 1개에 파일 3개가 들어가고, 문서 코드가 서브메뉴별로 이어지며 서로 겹치지 않는다.
26. 각 파일 머리말에 `source: "사내 Confluence"`, `sourcePageId`, `sourceVersion`, `importedAt` 이 있고, 위키 화면이 그 문서를 정상으로 그린다.
27. 상위 페이지와 하위 페이지를 함께 가져오면 하위 문서 `parent` 가 상위 문서 코드다.
28. PR 본문에 `- 진입: 사내 Confluence`, 문서 코드 목록, 페이지별 손실·자동 가림·경고 건수가 있다.
29. 가져온 문서에 수정 제안을 한 번 올려도 `sourcePageId`·`sourceVersion` 이 머리말에 남아 있다.
30. PR 이 승인·머지되기 전에는 `지식/` 에 아무 파일도 생기지 않는다.

**초보자 안내·실패**

31. 설정 안내 문서만 보고 토큰 발급 → `.env.local` 설정 → 첫 가져오기까지 터미널 명령 없이 끝낼 수 있다(`.env.local` 은 메모장·텍스트 편집기로 연다).
32. 토큰 틀림·권한 없음·회사망 미연결·인증서 문제 각각에서 화면에 영어 원문이 아닌 "지금 할 일" 한 줄과 기록 위치가 뜬다.
33. `npm run build` 가 통과한다.

---

## 위험·대응

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| 사내 Confluence 버전이 7.9 미만이라 개인 액세스 토큰이 없다 | REST 방식 불가 | 착수 전 확인(Q3). 안 되면 Basic 인증(아이디·비밀번호)은 **쓰지 않고** MCP 방식 재검토 |
| 회사가 PAT 발급을 막아 두었다 | 기능 불가 | Q3 로 확인. 막혀 있으면 담당 부서 허용 요청이 먼저 |
| Node `fetch` 가 사내 인증서를 몰라 연결 실패 | 첫 사용에서 막힘 | `certificate` 분류로 따로 안내. `ops` 가 `NODE_EXTRA_CA_CERTS` 설정 절을 쓴다. 검증 끄기는 금지 |
| 사내 원문에 금액·제휴사 실명이 많다 | 공개 저장소 유출 | M1~M9, 이름 목록 없으면 제출 차단(M6), 서버 재검사, PR 사람 검토 |
| 글자로 쓴 임직원 이름은 자동으로 못 가린다 | 실명 유출 | 미리보기 고정 안내 + 제출 전 확인 체크(M8), 승인자 PR 검토. 2차에서 자동 가림 검토 |
| storage 매크로 종류가 예상보다 많다 | 손실 표시가 많아져 문서 품질 저하 | 모르는 매크로는 글자만 남기고 표시. 1차 운영 뒤 자주 나온 매크로를 규칙에 더한다 |
| 한 번에 많이 가져와 위키 분류가 흐트러진다 | 메뉴 품질 저하 | 10개 상한, 분류 필수 선택, PR 검토 |
| 같은 페이지를 두 사람이 동시에 가져온다 | 중복 문서 | 1차는 `지식/` 반영본만 대조. 열린 PR 대조는 2차(위험으로 PR 검토자가 본다) |
| 원본이 바뀌어도 위키는 그대로다 | 오래된 기준을 챗봇이 인용 | 1차는 `sourceVersion` 기록까지. 2차 재가져오기에서 "원본이 바뀜" 표시 |
| `server/github.ts`·`server/publicCheck.ts` 는 배포 함수도 쓴다 | 한쪽만 고치면 로컬·배포가 갈라짐 | `DocVia`·`VIA_LABEL` 추가는 배포에도 무해한 확장으로만. `createImportPR` 은 로컬에서만 불리지만 같은 파일에 둬 규칙을 한 벌로 |
| 기존 `docs/jira-mcp-setup.md` 에 회사 도메인이 적혀 있다 | 공개 저장소 규칙 위반(이번 기능과 별개) | `ops` 에 자리표시자로 바꾸도록 별건으로 넘긴다 |

---

## 담당 분배

### 순서

```
1단계 (병렬)  requests-planner : 흐름·상태·권한·안내 문구      → docs/sections/requests-confluence-import.md
              wiki-ux          : 화면 배치·단계 표시·입구 위치   → docs/ux/2026-11-xx-confluence-import.md
2단계         dev-server       : 서버 구현 (1단계 문구의 오류 분류 code 를 받아서)
3단계 (병렬)  dev-front        : 화면 구현 (2단계 API 계약 확정 후)
              ops              : 설정 안내·.env.example·도메인 정리 (2단계 환경변수 이름 확정 후)
```

### 담당별 일

| 담당 | 맡는 일 | 손대는 파일 | 의존 |
| --- | --- | --- | --- |
| `requests-planner` | 가져오기를 "새 문서"의 한 갈래로 보고 흐름·상태(조건 → 고르기 → 미리보기 → 제출 → 완료/실패)·막힘 조건·안내 문구를 정한다. 오류 분류별 "지금 할 일" 문구, M6·M8 문구, PR 본문 꼴, 배포본 안내 문구 | `docs/sections/requests-confluence-import.md` (새 파일) | 없음 |
| `wiki-ux` | 입구 위치(위키 목록 "+ 새 문서" 옆 버튼 제안), 4단계 화면 배치, 트리 목록·페이지별 미리보기·손실 목록·검사 결과 배치, 일괄/개별 분류 지정 방식 | `docs/ux/2026-11-xx-confluence-import.md` (새 파일) | 없음 |
| `dev-server` | `server/env.ts` 읽기 함수 3개 · 새 `server/confluence.ts`(CQL 조립·REST 호출·오류 분류·`storageToMarkdown`·자동 가림·`sourcePageId` 대조) · `server/cliBridge.ts` 에 `/api/confluence/status·search·preview·import` 와 상태 줄 · `server/publicCheck.ts` 에 `DocVia 'confluence'` · `server/github.ts` 에 `VIA_LABEL.confluence`·`createImportPR`·머리말 칸 추가·`bumpFrontmatter` 가 새 칸을 보존하는지 확인 · `server/knowledge.ts` 에 `MAX_IMPORT_BYTES` · 가짜 예시 XHTML 시험 | `server/env.ts`, `server/confluence.ts`(새), `server/cliBridge.ts`, `server/publicCheck.ts`, `server/github.ts`, `server/knowledge.ts`, 시험용 예시 파일 | 1단계 문구(오류 code 목록) |
| `dev-front` | 가져오기 화면(새 페이지)·라우트·위키 목록 입구 버튼·배포본 404 안내·`src/lib/publicCheck.ts` 의 `DocVia` 맞추기·미리보기(기존 마크다운 렌더 재사용)·제출 후 제안 목록 새로고침 | `src/pages/ConfluenceImport.tsx`(새), `src/App.tsx`, `src/pages/WikiIndex.tsx`, `src/lib/publicCheck.ts`, `src/lib/confluence.ts`(새, 호출 함수) | 2단계 API 확정 |
| `ops` | 설정 안내 문서(토큰 발급 화면 따라가기, `.env.local` 두 줄, 인증서 절, 자주 막히는 곳 — 쉬운 한국어, 도메인은 자리표시자) · `.env.example` 에 환경변수 설명(값 없음) · `docs/jira-mcp-setup.md` 의 회사 도메인을 자리표시자로 바꾸기(별건) · 이용 안내 문서에 가져오기 한 줄 소개 | `docs/confluence-setup.md`(새), `.env.example`, `docs/jira-mcp-setup.md`, `지식/guide/` 해당 문서 | 2단계 환경변수 이름 |
| `chatbot-planner` | 1차 일 없음. 가져온 문서는 `지식/` 에 들어가면 자동으로 챗봇 근거가 된다. 2차 "기존 문서에 합치기"에서 참여 | — | — |

### 겹치는 파일

| 파일 | 함께 손대는 담당 | 처리 |
| --- | --- | --- |
| `server/publicCheck.ts` ↔ `src/lib/publicCheck.ts` | `dev-server` ↔ `dev-front` | 같은 `DocVia` 목록을 두 곳에 둔다. `dev-server` 먼저, `dev-front` 가 따라 맞춘다 |
| `server/github.ts` | `dev-server` 만 | 배포 `api/createDoc.ts`·`api/proposeEdit.ts` 도 쓰므로 기존 함수 동작은 바꾸지 않는다 |
| `server/cliBridge.ts` | `dev-server` 만 | 같은 기간에 다른 cliBridge 작업과 동시에 돌리지 않는다 |
| `.env.example` | `ops` 만 | `dev-server` 는 이름만 넘기고 파일은 `ops` 가 쓴다 |
| `src/pages/WikiIndex.tsx` | `dev-front` 만 | 입구 버튼 자리는 `wiki-ux` 안을 따른다 |

---

## 열린 질문

| # | 질문 | 선택지 | 영향 | PM 의견 |
| --- | --- | --- | --- | --- |
| Q1 | 가져온 본문에 **금액**이 있을 때 어떻게 할까요? | (가) 경고만 — 직접 쓴 새 문서와 같음 (나) 자동으로 `(금액 생략)` 으로 바꾸고 미리보기에 표시 (다) 리포트 반영처럼 제출 차단 | (가)는 사람이 놓치면 공개 저장소에 올라간다. (다)는 가격 정책 문서처럼 금액이 핵심인 페이지는 가져올 수 없다 | **(나) 자동 가림** — 사내 원문은 금액이 섞일 가능성이 높고, 금액이 꼭 필요한 문서는 경향으로 다시 쓰는 것이 저장소 규칙이다 |
| Q2 | 레이블과 상위 페이지를 함께 넣을 때 **둘 다 만족(AND)** 만 지원해도 될까요? | (가) AND 만 (나) "둘 중 하나라도(OR)" 선택도 제공 | (나)는 화면 선택지가 하나 늘고 결과가 커지기 쉽다. (가)는 OR 이 필요하면 두 번 찾아야 한다 | **(가) AND 만** — 주로 쓸 방식이 정해지면 2차에서 더한다 |
| Q3 | 사내 Confluence 에서 **개인 액세스 토큰(PAT)** 을 각자 발급할 수 있나요? (버전 7.9 이상, 회사 정책상 허용) | (가) 된다 → REST 방식으로 진행 (나) 안 된다/모른다 → 발급 가능 여부를 먼저 확인 | 안 되면 REST 방식 전체가 막힌다. Jira 는 PAT 로 쓰고 있어 될 가능성은 높다 | 착수 전 한 명이 실제로 발급해 `GET /rest/api/space?limit=1` 이 되는지만 확인하면 된다 |
