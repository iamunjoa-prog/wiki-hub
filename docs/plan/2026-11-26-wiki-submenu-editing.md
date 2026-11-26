# 위키 하위 메뉴 이름 바꾸기·새로 만들기

작성 2026-11-26 · plan-pm · 브랜치 `claude/epic-tesla-34okcx` 기준

> 상위 지시(원문): "모든 위키 문서의 하위메뉴들의 메뉴명, 신규 하위메뉴는 자유롭게 생성할 수 있게 해줄래? 지금 메뉴명 수정도 안되니까 불편해"
> 직전 맥락: "편성은 영화/시리즈·TV 방송 장르별 대메뉴로 나누고 그 하위 메뉴들은 담당자들이 직접 구성하게 하려고"
>
> 이 문서는 코드와 지식 문서를 고치지 않는다. 기획, 범위, 수용 기준, 담당 분배만 정한다.
> **전제:** 지금 dev-front·dev-server 가 편성 2단 메뉴를 `movie-series`·`tv` 두 개로 줄이고 있다(`src/data/docs.ts`·`src/components/AppShell.tsx`·`src/pages/WikiIndex.tsx`·`server/knowledge.ts`). 이 문서는 그 변경이 들어간 상태를 기준으로 쓴다. 이 계획의 구현은 그 작업이 머지된 **뒤에** 시작한다.

---

## 문제

**누가:** 편성 담당자와 프로모션 담당자. 둘 다 실무자이고 개발자가 아니다.

**어떤 상황에서:** 편성을 "영화/시리즈"와 "TV 방송"으로 나눈 뒤, 그 아래를 담당자가 업무 단위로 직접 꾸리려 한다. 프로모션 담당자는 이미 있는 하위 메뉴 이름("운영 참고자료" 같은 것)이 실제 내용과 맞지 않는다고 느낀다.

**무엇을 못 하나**
1. **하위 메뉴 이름을 바꿀 수 없다.** 이름이 코드 두 곳에 박혀 있다(`src/data/docs.ts` `subcategories`, `server/knowledge.ts` `DOC_SUBCATEGORIES`). 이름 한 글자를 바꾸려 해도 개발자가 코드를 고치고 배포해야 한다. 허브 화면에는 이름을 바꾸는 입구가 없다.
2. **하위 메뉴를 새로 만들 수 없다.** 새 문서 화면(`NewDoc.tsx`)은 이미 있는 하위 메뉴 중에서만 고르게 한다. 서버(`isKnownPlace`)도 목록에 없는 하위 메뉴로 온 새 문서를 400으로 막는다. 그래서 "담당자가 직접 구성"이 지금 구조로는 불가능하다.
3. **목록이 세 곳에서 따로 논다.** 화면 목록, 서버 목록, 챗봇 프롬프트(`server/assistant-prompt.md` 245행)의 목록이 따로 관리된다. 이용 안내 문서도 실제와 이미 어긋나 있다. `지식/guide/writing.md` 63행에는 없어진 `spec`·`reference` id 와 줄인 편성 5개가 남아 있고, `지식/guide/tour.md` 33행은 "6개 서브메뉴"라고 쓰는데 실제로는 8개다. 하드코딩이 낳은 실제 증상이다.

---

## 현재 상태 (확인한 파일 경로 포함)

### 1. 메뉴 구조

| 단 | 정의 위치 | 지금 값(진행 중 변경 반영) |
| --- | --- | --- |
| 1단 카테고리 | `src/data/docs.ts` `categories`. 폴더 `지식/<id>/` 와 1:1. `CategoryId` 는 `src/types.ts` 의 유니온 타입 | `guide`(이용 안내) · `promotion`(프로모션) · `programming`(편성, `open: true`) |
| 1단 짧은 이름 | `src/data/docs.ts` `categoryShort` | 편성 · 프로모션 · 시스템 · 안내 |
| 2단 하위 메뉴(화면) | `src/data/docs.ts` `subcategories` (`{id,label}[]`) | 편성: `movie-series` 영화/시리즈 · `tv` TV 방송. 프로모션: `start` · `policy` · `process` · `system` · `banner-spec` · `insight` · `copy-guide` · `ops-reference` (8개). 이용 안내: 없음 |
| 2단 하위 메뉴(서버) | `server/knowledge.ts` 76행 `DOC_SUBCATEGORIES` (id 만). `isKnownPlace()` 가 이 목록을 본다 | 화면 목록과 같아야 한다는 주석만 있고, 맞추는 장치는 없다 |
| 2단 하위 메뉴(챗봇) | `server/assistant-prompt.md` 245행. 문장 안에 id 를 직접 나열한다 | 위와 같은 목록을 손으로 적어 둠 |
| 문서 소속 | 문서 프론트매터 `category`(폴더와 같음) · `subcategory`(id) | 목록에 없는 id 는 사이드바·위키 목록·이동 경로에서 "기타"로 묶인다(`AppShell.tsx` 117행, `WikiIndex.tsx` 17행) |
| 3단 | 없음. 사이드바 `depth3` 는 **문서 한 줄**이다. 열어 둔 카테고리(편성)는 그 끝에 `+ 문서 추가`(`/wiki/new?category=&sub=`)가 붙는다. 주석에 "담당자가 올린 문서가 곧 이 서브의 하위 메뉴다"라고 적혀 있다 | 프론트매터 `parent` 로 문서 트리를 만드는 코드(`src/data/knowledgeDocs.ts` `flattenTree`)는 있다. 하지만 지금 `parent` 를 쓰는 문서는 0건이고, 사이드바도 들여쓰기를 하지 않는다 |

**하위 메뉴 목록을 읽는 화면:** `AppShell.tsx`(사이드바와 이동 경로 558행), `WikiIndex.tsx`(칩과 묶음 제목), `Dashboard.tsx` 160행(홈 카테고리 타일), `DocBits.tsx` `subLabel`, `NewDoc.tsx`(하위 메뉴 고르기).
**하위 메뉴 id 를 코드가 직접 쓰는 곳:** `src/lib/report.ts` `SUB_BY_TYPE`(`insight`·`ops-reference`), `src/lib/assistant.ts` 961·1082·1159행(`insight`·`banner-spec`·`copy-guide`), `NewDoc.tsx` `NO_AUTO_CODE`(`system`). 이 id 들은 이름이 바뀌어도 그대로여야 하고, 삭제는 막아야 한다.
**정렬:** 열어 둔 카테고리(편성)는 정해 둔 순서를 지킨다. 나머지 카테고리는 `filledFirst` 로 문서가 있는 하위 메뉴를 앞으로 보낸다(`AppShell.tsx` 157행, `WikiIndex.tsx` 53행).
**주소:** 문서는 `/wiki/<문서 코드>`, 하위 메뉴 목록은 `/wiki?category=<id>&sub=<id>`. 화면 어디에도 하위 메뉴의 **표시 이름**은 주소에 들어가지 않는다. 따라서 id 를 그대로 두면 이름을 바꿔도 링크가 깨지지 않는다.

### 2. 문서 코드 매기기

- `server/github.ts` 106행 `nextCode(siblingCodes, subcategory)`. 같은 하위 메뉴의 문서 코드에서 가장 많이 쓰인 접두를 골라 다음 번호를 매긴다. 예: `PPC-R-06` 다음은 `PPC-R-07`.
- 하위 메뉴에 문서가 없으면 **하위 메뉴 id 를 대문자로 바꿔 접두로 쓴다**(`movie-series` → `MOVIE-SERIES-01`). 이 규칙대로면 새 메뉴의 id 가 문서 코드에 그대로 드러난다.
- 코드가 숫자로 끝나지 않는 하위 메뉴(`system`: `PPC-ACS`·`PPC-CBS`·`PPC-SWG`)는 `null` 이 된다. 그래서 화면이 `NO_AUTO_CODE` 로 새 문서 대상에서 뺀다.
- 지금 쓰는 접두: `start`·`policy` 는 둘이 `PPC-P-` 를 나눠 쓴다(`PPC-P-00`, `PPC-P-01~03`). `insight` 는 `MKI-`, `banner-spec` 은 `MKI-B-`, `copy-guide` 는 `MKI-C-`, `ops-reference` 는 `PPC-R-`, 이용 안내는 `HUB-`. 편성은 문서가 0건이라 아직 접두가 없다.
- 문서 코드는 문서 id 이자 주소다(`knowledgeDocs.ts` 47행 `id: fm.code`). 따라서 **코드는 한 번 정해지면 바꾸지 않는다.**

### 3. 새 문서·수정 제안·승인 흐름

| 단계 | 지금 동작 | 파일 |
| --- | --- | --- |
| 새 문서 | 화면이 카테고리·하위 메뉴를 고르고 형제 문서 코드를 보낸다. 서버는 `isKnownPlace` 로 검사하고 `nextCode` 로 번호를 매긴 뒤 `docs/<code>-<ts>` 브랜치에 `.md` 하나를 커밋하고 PR 을 만든다 | `src/pages/NewDoc.tsx`, `src/lib/createDoc.ts`, `api/createDoc.ts`, `server/github.ts` `createDocPR` |
| 수정 제안 | `docs/edit-<code>-<ts>` 브랜치에 커밋하고 PR 을 만든다 | `server/github.ts` `createEditPR` |
| 제안 목록 | GitHub PR 최근 50건 가운데 `docs/` 브랜치만 읽는다. `docs/edit-` 이면 수정, **그 밖은 전부 새 문서로 본다**(603행 `parseProposalPr`) | `api/proposals.ts`, `src/pages/MyRequests.tsx`, `src/pages/Approvals.tsx` |
| 승인 | 허브에는 승인 버튼이 없다. 관리자가 GitHub 에서 머지한다. 승인 관리 화면은 "머지해도 다음 배포 전까지는 위키 화면에 반영되지 않습니다"라고 안내한다 | `Approvals.tsx` 199행, `docs/sections/requests-doc-edit.md` 1장 |
| 반영 | 화면은 빌드 때 묶은 `지식/**/*.md` 를 쓴다(`import.meta.glob`). 서버 Q&A 는 실행 중에 `지식/` 의 `.md` 를 읽는다(`knowledge.ts` `listDocs`, `vercel.json` 의 `api/ask.ts` `includeFiles`). 머지 뒤 **다음 배포**에 반영되고, 로컬 허브는 **업데이트** 때 반영된다 | `src/data/knowledgeDocs.ts`, `vercel.json` |

### 4. 권한

- 역할은 `member`(실무자)와 `admin`(관리자) 두 가지다(`src/types.ts`). 승인 관리는 관리자에게만 보인다(`Approvals.tsx` 79행).
- 계정 기능이 꺼진 환경(로컬 허브, Preview)에서는 데모 계정 "김OO"으로 돈다. 운영 배포에서 계정 기능이 꺼지면 새 문서와 수정 제안이 "허브 점검 중"으로 닫힌다(`docs/accounts.md` 45행, `server/guard.ts`).
- 머지 권한은 허브가 아니라 GitHub 에 있다(`requests-doc-edit.md` 3-4 권한표).

### 5. 배포 제약

- `api/` 배포 함수가 **이미 12개로 Vercel 무료 한도에 차 있다.** 13번째 파일을 더하면 배포가 통째로 실패한다. `npm run build` 첫 단계의 `scripts/check-api-count.mjs` 가 이것을 막는다. 새 경로는 기존 함수에 분기를 넣고 `vercel.json` rewrites 로 잇는다(선례: `/api/docVersion` → `api/proposeEdit.ts?op=docVersion`).
- `vercel.json` 에서 `지식/**` 를 `includeFiles` 로 싣는 함수는 `api/ask.ts` 하나다. `api/createDoc.ts` 는 실행 중에 `지식/` 를 읽지 못한다.

---

## 이번 범위 / 범위 밖

### 이번 범위

1. **메뉴 정의를 코드에서 저장소 데이터로 옮긴다.** 카테고리마다 `지식/<카테고리>/_menu.json` 을 둔다(스키마는 아래 A). 화면(`src/data/docs.ts`)과 서버(`server/knowledge.ts`, 이것을 공유하는 `api/`)가 **같은 파일**을 읽는다. 코드에서 `subcategories`·`DOC_SUBCATEGORIES` 하드코딩을 없앤다.
2. **id 와 표시 이름을 나눈다.** 문서 프론트매터, 주소, 문서 코드에는 **id 만** 쓴다. 표시 이름은 `_menu.json` 에만 둔다. 이름을 바꿔도 `.md` 파일은 하나도 바뀌지 않는다.
3. **하위 메뉴 이름 바꾸기.** 사이드바와 위키 목록에서 시작한다. 대상은 프로모션·편성의 모든 하위 메뉴다.
4. **새 하위 메뉴 만들기.** 프로모션·편성에 만든다. 사용자는 **이름만** 넣는다. id 와 문서 코드 접두는 서버가 정한다(아래 B).
5. **하위 메뉴 순서 바꾸기.** 위·아래 한 칸씩 옮긴다. 담당자가 메뉴를 "구성"하려면 꼭 필요하다. `_menu.json` 배열 순서만 바꾸면 되니 비용이 작다.
6. **빈 하위 메뉴 지우기.** 문서가 0건이고 `fixed` 가 아닌 메뉴만 지울 수 있다.
7. 위 3~6은 **문서 제안과 같은 제안 → 승인(PR 머지) → 다음 배포** 흐름을 탄다(아래 C). 내 요청과 승인 관리에 "메뉴" 종류를 더한다.
8. 챗봇 프롬프트의 하위 메뉴 목록을 `_menu.json` 에서 만들어 넣는다. 사람이 손으로 적는 목록을 없앤다.
9. 이용 안내 문서(`writing.md` 63행, `tour.md` 33행)에서 메뉴 목록을 나열하지 않게 고친다. "사이드바에 보이는 이름 그대로 고르면 된다"는 안내로 바꾼다.
10. 메뉴 파일 검사. 빌드 때 JSON 형식, id 중복, 이름 중복, 문서의 `subcategory` 가 메뉴에 있는지를 본다. 메뉴에 없는 `subcategory` 는 지금처럼 "기타"로 보이고, 검사는 경고만 낸다.

### 범위 밖

| 항목 | 이유 |
| --- | --- |
| 문서를 다른 하위 메뉴로 옮기기 | 문서 여러 개의 프론트매터를 한 PR 에서 고쳐야 한다. 옮긴 문서의 코드 접두가 원래 메뉴의 것으로 남는 문제도 따로 정해야 한다. 다음 차수로 미룬다. 그동안은 문서 수정 제안으로 한 건씩 옮긴다 |
| 문서가 남아 있는 하위 메뉴 지우기 | "옮기기"가 먼저 있어야 한다. 지금 지우면 문서가 "기타"로 떨어진다 |
| 1단 카테고리 새로 만들기 | 폴더, `CategoryId` 타입, 챗봇 카테고리 판정 키워드(`src/lib/assistant.ts` 407행), 아이콘, 배포 `includeFiles` 가 함께 바뀐다. 지시도 "하위메뉴"에 한정돼 있다 |
| 1단 카테고리 이름 바꾸기 | 검토 요청 R4. 이번에는 `_menu.json` 에 이름 칸만 옮겨 두고 화면 입구는 만들지 않는다 |
| 3단 메뉴(하위 메뉴 아래 하위 메뉴) | 검토 요청 R5. 상위 지시자의 답을 받은 뒤 별도 계획으로 한다. 스키마에 `parent` 칸 자리만 남겨 둔다 |
| 이용 안내에 하위 메뉴 만들기 | 검토 요청 R3. 권장안은 이번에는 막는 것이다(기존 6개 문서가 전부 "기타"로 떨어진다) |
| 관리자가 누르면 바로 바뀌는 메뉴(배포 없이 반영) | 메뉴가 빌드에 묶이는 한, 머지해도 배포 전까지는 안 바뀐다. 배포 없이 바꾸려면 메뉴를 실행 중 저장소(`server/redisStore.ts`)로 옮겨야 하는데, 그러면 저장소 데이터와 실행 중 데이터가 갈라진다. 검토 요청 R2 |
| 챗봇 대화로 메뉴 바꾸기 | 답변 형식(`REPLY_SCHEMA` 의 action)을 넓혀야 한다. 화면 버튼으로 충분하다 |
| 하위 메뉴마다 담당자·권한 따로 두기 | 지금 문서 담당자 개념도 없다(`requests-doc-edit.md` 3-3 "문서 담당자" A안). 머지 권한도 GitHub 에 있어 허브가 막을 수 없다 |
| 기존 하위 메뉴 id·문서 코드 바꾸기 | 주소와 챗봇 근거 인용이 깨진다. id 는 이번부터 "바꾸지 않는 값"이다 |

### A. 메뉴 파일 형식 (권장안. 확정은 dev-server, 검토 요청 R1)

자리: `지식/<카테고리 id>/_menu.json`. 카테고리마다 한 장이다. "폴더가 곧 1단 메뉴" 원칙을 지키고, 편성 메뉴 변경과 프로모션 메뉴 변경이 같은 파일에서 부딪히지 않는다. `_` 로 시작하고 `.md` 가 아니므로 지금의 문서 읽기(`**/*.md`, `listDocs`)에 걸리지 않는다.

```json
{
  "label": "편성",
  "order": 3,
  "open": true,
  "codePrefix": "PGM",
  "allowNewSub": true,
  "subs": [
    { "id": "movie-series", "label": "영화/시리즈", "codePrefix": "PGM-S01-" },
    { "id": "tv", "label": "TV 방송", "codePrefix": "PGM-S02-" }
  ]
}
```

| 칸 | 뜻 | 누가 바꾸나 |
| --- | --- | --- |
| `label` · `order` · `open` | 1단 이름·순서·"0건이어도 열기". 지금 `categories` 에 있는 값을 옮긴다 | 이번에는 ops 의 직접 PR 만 |
| `codePrefix`(카테고리) | 새 하위 메뉴의 코드 접두를 만들 때 쓰는 머리글. 편성 `PGM`(ops 확인), 프로모션 `PPC`, 이용 안내 `HUB` | ops |
| `allowNewSub` | 화면에 [새 하위 메뉴]를 보일지. 프로모션·편성 `true`, 이용 안내 `false`(R3) | ops |
| `subs[]` 순서 | 사이드바·위키 목록·새 문서 고르기·홈 타일의 순서 | 화면 제안 |
| `subs[].id` | 바꾸지 않는 값. 프론트매터 `subcategory`, 주소 `?sub=` 에 쓴다 | 만들 때 서버가 정한다. 그 뒤로는 아무도 바꾸지 않는다 |
| `subs[].label` | 화면에 보이는 이름 | 화면 제안 |
| `subs[].codePrefix` | 이 메뉴에 처음 올라오는 문서의 코드 접두. 문서가 생긴 뒤에는 지금처럼 형제 코드가 우선한다 | 만들 때 서버가 정한다 |
| `subs[].autoCode: false` | 번호를 자동으로 매길 수 없는 메뉴(`system`). `NO_AUTO_CODE` 를 대신한다 | ops |
| `subs[].fixed: true` | 코드가 id 를 직접 쓰는 메뉴(`insight`·`ops-reference`·`banner-spec`·`copy-guide`·`system`). 이름은 바꿀 수 있지만 지울 수 없다 | ops |
| `subs[].parent` | **자리만 둔다. 이번에는 쓰지 않는다**(R5) | — |

읽는 방법(원칙만 정한다. 구현 방식은 dev-server·dev-front 가 고른다):
- 화면: `import.meta.glob('/지식/*/_menu.json', { eager: true })`. 빌드 때 묶는다.
- 서버와 api: `server/knowledge.ts` 한 곳에서 읽어 `DOC_SUBCATEGORIES`·`isKnownPlace`·프롬프트 목록을 만든다. **배포 함수에서도 반드시 읽혀야 한다.** JSON 정적 import(번들에 포함)를 권장한다. 실행 중 `readFileSync` 를 쓴다면 `vercel.json` 의 `api/createDoc.ts`·`api/ask.ts` 등 해당 함수에 `includeFiles` 를 빠짐없이 더해야 한다.

**반영 시점:** 메뉴 제안 PR 머지 → 다음 배포 때 화면과 서버가 **동시에** 바뀐다. 같은 빌드에 묶이므로 둘이 갈라지지 않는다. 로컬 허브는 다음 업데이트 때 바뀐다. 머지 뒤 배포 전까지는 새 메뉴가 화면에도 서버 검사에도 없다. 그래서 "새 메뉴에 첫 문서 올리기"는 배포 뒤에야 할 수 있다. 안내 문구에 이 점을 밝힌다.

### B. id 와 코드 접두 자동 생성 규칙 (권장안)

- **새 메뉴 id:** 서버가 `sub-NN` 으로 정한다(NN 은 그 카테고리에서 아직 안 쓴 가장 작은 두 자리 번호, `sub-01` 부터). 한글 이름을 로마자로 바꾸지 않는다. 로마자 변환은 결과가 흔들리고, 이름을 바꾸면 의미 있는 id 가 오히려 이름과 어긋난다. 사용자에게 id 는 보이지 않는다.
- **새 메뉴 코드 접두:** `<카테고리 codePrefix>-S<NN>-`. 예: 편성에 세 번째로 만든 메뉴의 첫 문서는 `PGM-S03-01`. 서버는 저장소 전체 문서 코드와 기존 메뉴 접두 가운데 같은 머리로 시작하는 것이 없는지 확인하고, 있으면 다음 번호로 넘긴다.
- **`nextCode` 변경:** 형제 문서가 0건일 때 id 를 대문자로 바꾸던 규칙을 버리고 `subs[].codePrefix + "01"` 을 쓴다. 형제 문서가 있으면 지금 규칙(가장 많이 쓰인 접두의 다음 번호)을 그대로 쓴다. 그래서 기존 프로모션 코드는 하나도 바뀌지 않는다.
- **기존 메뉴:** ops 가 옮길 때 id 는 그대로 둔다. `codePrefix` 는 문서가 있는 메뉴면 지금 쓰는 접두를 적고(예: `ops-reference` → `PPC-R-`), 편성 두 메뉴처럼 문서가 없는 메뉴면 새 규칙으로 적는다(`PGM-S01-`·`PGM-S02-`).
- **이름 규칙:** 1~20자, 한 줄, 앞뒤 공백은 지운다. `/`·`·` 는 허용한다(예: "영화/시리즈"). 같은 카테고리 안에서 이미 쓰는 이름(공백·대소문자 무시)과 같으면 막는다. 공개 규칙 검사(`publicLeaks`)를 통과해야 한다. 제휴사 실명을 메뉴 이름으로 쓸 수 없다.

### C. 화면 흐름 (권장안. 상세는 wiki-ux, 상태·문구는 requests-planner)

- **입구:**
  - 사이드바 하위 메뉴 줄에 마우스를 올리거나 키보드로 고르면 `⋯` 가 뜬다. 거기서 [이름 바꾸기] · [위로] · [아래로] · [지우기]를 고른다.
  - 카테고리를 펼쳤을 때 하위 메뉴 목록 끝에 `+ 새 하위 메뉴` 한 줄을 둔다(`allowNewSub` 인 카테고리만).
  - 위키 목록(`/wiki?category=`)의 하위 메뉴 칩 줄 끝에 [메뉴 편집]을 두고, 같은 동작을 한 화면에 모은다.
- **누가:** 문서 제안을 올릴 수 있는 사람은 누구나 메뉴 제안도 올릴 수 있다(실무자·관리자 모두). 막히는 조건도 문서 제안과 같다. 운영 배포에서 계정 기능이 꺼져 있으면 닫힌다. 머지는 GitHub 권한자가 한다. 관리자도 같은 제안 PR 을 거친다. 관리자만 바로 반영하는 길은 두지 않는다. 바로 반영해도 배포 전에는 화면이 안 바뀌기 때문이다(R2).
- **한 번에 하나:** 제안 하나에는 동작 하나만 담는다(이름 바꾸기 1건, 새 메뉴 1건, 순서 1칸, 지우기 1건). PR diff 가 `_menu.json` 한 장의 몇 줄로 끝나서 승인자가 보기 쉽다. 같은 카테고리에 대기 중인 메뉴 제안이 있으면 편집을 시작할 때 알린다. 제출은 막지 않는다(`requests-doc-edit.md` 3-3 "같은 문서 대기 제안" B안과 같은 원칙).
- **새 메뉴의 수정 사유:** 사유 칸은 두되 선택으로 한다. 비우면 "근거 미기재"로 PR 에 올라간다. 이름 바꾸기도 같다.
- **안내 문구 원칙(초보자 기준):**
  - id·JSON·PR·머지·배포 같은 말을 실무자 화면 본문에 쓰지 않는다. "승인", "다음 반영 때"로 쓴다. PR 링크는 [자세히 보기 ↗] 로 둔다.
  - 제출 직후에는 **지금은 안 바뀐다**는 점과 **언제 바뀌는지**를 한 줄로 쓴다. 예: 「'영화/시리즈' 이름을 '영화·시리즈'로 바꾸자는 제안을 올렸습니다. 관리자가 승인하면 다음 반영 때 사이드바에 새 이름이 보입니다.」
  - 막힐 때는 이유와 지금 할 일을 함께 쓴다. 예: 「문서가 3개 있어 지울 수 없습니다. 문서를 다른 메뉴로 옮긴 뒤 지워 주세요.」 「이 메뉴는 챗봇 답변이 쓰는 메뉴라 지울 수 없습니다. 이름은 바꿀 수 있습니다.」
  - 새 메뉴 완료 문구에는 "승인되고 반영된 뒤에 이 메뉴에 문서를 올릴 수 있습니다"를 넣는다.
- **승인 관리·내 요청:** 종류 태그에 "메뉴"를 더한다. 카드에는 `카테고리 › 바꾸기 전 → 바꾼 뒤`(새 메뉴는 `+ 이름`, 지우기는 `− 이름`, 순서는 `이름 ↑/↓`)를 한 줄로 보인다. 상태 이름은 문서 제안과 같다(대기 중 · 머지됨 · 닫힘).
- **정렬 원칙 변경:** 메뉴 순서를 사람이 정하게 되므로, `filledFirst`(문서 있는 메뉴를 앞으로)를 하위 메뉴에서는 쓰지 않는다. 모든 카테고리에서 `_menu.json` 순서를 그대로 쓴다. 빈 메뉴는 지금처럼 흐리게 보인다(R6).

### D. 서버 계약 (권장안. 확정은 dev-server)

- 새 배포 함수 파일을 만들지 않는다(12개 한도). `/api/proposeMenu` 를 `vercel.json` rewrite 로 `api/createDoc.ts?op=menu` 에 잇는다. 어느 함수에 붙일지는 dev-server 가 정한다.
- 요청 본문: `{ category, op: 'rename'|'add'|'move'|'remove', subId?, label?, direction?: 'up'|'down', reason, via }`.
- 서버가 하는 일:
  1. main 의 `지식/<category>/_menu.json` 을 GitHub 에서 읽는다(sha 포함).
  2. 동작 하나를 적용한다. `add` 면 id 와 접두를 정한다.
  3. 검사한다: 이름 규칙, 공개 규칙, `fixed` 지우기 금지, main 기준 문서 0건, `allowNewSub`.
  4. `docs/menu-<category>-<ts>` 브랜치에 그 파일 하나를 커밋하고 PR 을 연다.
- PR 본문 형식(`parseProposalPr` 가 읽는다): 첫 줄 `<이름>님이 …`, `- 메뉴: <카테고리 이름> › <대상>`, `- 변경: <전> → <후>`, `- 진입: …`, `## 변경 사유`. 문구는 requests-planner 가 정한다.
- `parseProposalPr`: `docs/menu-` 브랜치를 `kind: 'menu'` 로 읽는다. 지금은 `docs/edit-` 가 아니면 전부 `new` 로 읽으므로 **이 분기를 먼저 넣어야** 메뉴 PR 이 "새 문서"로 잘못 보이지 않는다. 기존 브랜치의 판정은 바뀌지 않아야 한다.
- 실패 응답은 지금 `EditError` 처럼 한국어 문장과 상태 코드로 준다(400 입력 오류, 409 그사이 main 이 바뀌어 대상 메뉴가 없음, 503 토큰 없음).

---

## 수용 기준

### 데이터 이전(동작 그대로)

1. `src/`·`server/`·`api/` 에서 하위 메뉴 **표시 이름**(예: "영화/시리즈", "운영 참고자료")을 grep 하면 0건이다. 이름은 `지식/*/_menu.json` 에만 있다. 지식 문서 본문은 검사 대상이 아니다.
2. `src/data/docs.ts` 의 `subcategories`, `server/knowledge.ts` 의 `DOC_SUBCATEGORIES` 가 리터럴 목록이 아니다. 둘 다 `_menu.json` 에서 만들어진다.
3. 옮긴 직후 사이드바·위키 목록·홈 타일·새 문서 고르기·이동 경로에 보이는 1단·2단 이름과 순서가 옮기기 전과 같다. 단, R6 을 채택하면 프로모션 순서는 `_menu.json` 순서가 된다.
4. 기존 문서 `.md` 는 하나도 바뀌지 않는다. 기존 문서 주소 `/wiki/<코드>` 와 `/wiki?category=promotion&sub=insight` 는 그대로 열린다.

### 이름 바꾸기

5. `_menu.json` 에서 `label` 한 줄만 바꾸고 빌드하면, 코드 변경 없이 사이드바·위키 목록 칩·묶음 제목·홈 타일·새 문서 고르기·이동 경로·문서 화면의 소속 표시(`subLabel`)가 모두 새 이름으로 보인다.
6. 사이드바에서 하위 메뉴 줄 하나의 이름 바꾸기 입력 칸까지 **2번 이내 조작**(⋯ → 이름 바꾸기)으로 닿는다. 위키 목록 화면에서도 같은 입구가 있다.
7. 이름 바꾸기 제안 PR 의 diff 는 `지식/<카테고리>/_menu.json` **한 파일, 한 줄**이다.
8. 빈 이름, 21자 이상, 같은 카테고리의 기존 이름과 같은 이름, 공개 규칙 위반 이름은 서버가 400 과 한국어 문장으로 막는다. 이때 PR 은 생기지 않는다.

### 새 하위 메뉴

9. 편성을 펼친 사이드바 끝의 `+ 새 하위 메뉴` 에서 이름만 넣고 제출하면 PR 이 생긴다. diff 는 `_menu.json` 에 `{ id: "sub-NN", label, codePrefix }` 항목 하나를 더한 것뿐이다.
10. 머지하고 배포한 뒤, 새 메뉴는 문서가 0건이어도 사이드바에 보인다. 열어 둔 카테고리에서는 `+ 문서 추가` 가 붙는다. 새 문서 화면의 고르기 목록에도 나온다.
11. 그 메뉴에 처음 올린 문서의 코드는 `<codePrefix>01` 이다(예: `PGM-S03-01`). 서버 `isKnownPlace` 가 코드 변경 없이 이 메뉴를 받아들인다. 로컬 허브(`server/` 중계)와 배포(`api/`)가 같은 결과를 낸다.
12. 이용 안내(`allowNewSub: false`)에는 `+ 새 하위 메뉴` 가 보이지 않는다. 서버에 직접 요청해도 400 이다.

### 순서·지우기

13. [위로]/[아래로] 제안의 diff 는 같은 파일에서 두 항목의 자리만 바꾼다. 머지와 배포 뒤 사이드바·위키 목록·새 문서 고르기 순서가 같이 바뀐다.
14. 문서가 1건 이상인 메뉴와 `fixed` 메뉴는 [지우기]가 비활성이고, 이유 한 줄이 보인다. 서버도 main 기준으로 다시 확인해 400 을 준다.

### 제안 목록·챗봇·문서

15. 내 요청과 승인 관리에서 메뉴 제안이 "메뉴" 태그와 `전 → 후` 한 줄로 보인다. 기존 새 문서·수정 PR 의 종류 판정은 바뀌지 않는다(`parseProposalPr` 테스트 또는 기존 PR 3건 이상으로 확인).
16. `server/assistant-prompt.md` 에 하위 메뉴 id 가 직접 적혀 있지 않다. 엔진에 넘어가는 프롬프트에는 `_menu.json` 에서 만든 목록(id·이름)이 들어간다. 새 메뉴가 배포된 뒤 챗봇이 그 id 로 낸 새 문서 초안이 버려지지 않는다(`knowledge.ts` 538행 경로).
17. `지식/guide/writing.md`·`지식/guide/tour.md` 에 하위 메뉴 id 목록과 개수가 적혀 있지 않다.

### 빌드·배포

18. `_menu.json` 이 JSON 형식에 어긋나거나, id 가 중복되거나, 이름이 중복되면 `npm run build` 가 한국어 문장과 함께 실패한다. 문서의 `subcategory` 가 메뉴에 없으면 경고만 낸다.
19. `api/` 함수 수가 12개 그대로다(`check:api-count` 통과).
20. `npm run build` 를 통과한다. 배포 함수에서 메뉴 파일을 읽지 못하는 일이 없다(Preview 배포에서 새 문서 제안 1건으로 확인).

---

## 담당 분배

### 순서와 의존

```
0. (진행 중) 편성 2단 축소 — dev-front·dev-server. 머지까지 기다린다. 아래 모든 코드 작업과 파일이 겹친다
1. [병렬, 문서만] requests-planner · wiki-ux · ops(메뉴 파일 초안 값 정리)
2. ops       — 지식/*/_menu.json 3장 추가 (코드가 아직 안 읽으므로 동작 변화 없음)
3. dev-server — 메뉴 읽기 · isKnownPlace · nextCode · 제안 API · parseProposalPr · 프롬프트 목록 주입
   chatbot-planner — assistant-prompt.md 목록 줄을 자리표시로 교체 (3과 같은 PR 로 묶거나 바로 뒤에)
4. dev-front — docs.ts 를 메뉴 파일에서 읽기 → 화면 전체 → 메뉴 편집 UI → 내 요청·승인 관리 "메뉴"
5. ops       — writing.md · tour.md 목록 문장 정리 (2026-11-26 작성 규칙 개편 계획이 writing.md 를 고친 뒤)
```

### 담당별 일

| 순서 | 담당 | 맡는 일 | 산출물·건드리는 파일 | 앞에 끝나야 하는 것 |
| --- | --- | --- | --- | --- |
| 1 | requests-planner | 메뉴 제안의 상태, 권한(누가 어떤 동작을), 막힘 조건과 문구, 제출 직후 문구, 승인 관리·내 요청 카드 문구, PR 본문 형식 문장, "다음 반영 때" 표현 통일 | `docs/sections/requests-menu.md` (새 파일) | 검토 요청 R2·R3 답 |
| 1 | wiki-ux | 사이드바 `⋯`·`+ 새 하위 메뉴` 자리, 위키 목록 [메뉴 편집] 화면, 휴대폰 폭 서랍에서의 동작, 키보드 접근, 대기 중 제안 표시 자리, 정렬 원칙(R6) | `docs/ux/2026-11-26-wiki-menu-editing.md` (새 파일) | R5·R6 답 |
| 1→2 | ops | 기존 목록을 `_menu.json` 3장으로 옮긴다: id 유지, `codePrefix`·`fixed`·`autoCode`·`allowNewSub` 값, 편성 접두 `PGM` 확인. `programming/` 폴더가 비어 있어도 파일이 실리는지 확인 | `지식/guide/_menu.json`, `지식/promotion/_menu.json`, `지식/programming/_menu.json` | 0번 머지(편성 `movie-series`·`tv` 확정) |
| 3 | dev-server | `server/knowledge.ts`: 메뉴 읽기(배포 함수 포함), `DOC_SUBCATEGORIES`·`isKnownPlace` 를 파일 기반으로 바꾸기, 프롬프트 목록 만들기. `server/github.ts`: `nextCode` 의 `codePrefix`, 메뉴 제안 PR 만들기, `parseProposalPr` 의 `menu`. 연결 함수 분기와 `vercel.json` rewrite. 로컬 중계(`server/cliBridge.ts`) 같은 경로. 메뉴 검사 스크립트와 빌드 연결. API 계약을 PR 본문에 적는다 | `server/knowledge.ts`, `server/github.ts`, `server/cliBridge.ts`, `api/createDoc.ts`(또는 고른 함수), `vercel.json`, `scripts/check-menu.mjs`, `package.json` | 2, requests-planner(PR 본문·오류 문구) |
| 3 | chatbot-planner | `assistant-prompt.md` 245행 목록을 dev-server 와 정한 자리표시로 바꾸고, 목록이 바뀌어도 규약 문장이 그대로 읽히는지 본다. 새 메뉴 id(`sub-NN`)는 의미가 없으므로 모델이 **이름으로 고르고 id 로 답하게** 규약을 쓴다 | `server/assistant-prompt.md` | dev-server 와 자리표시 이름 합의 |
| 4 | dev-front | `src/data/docs.ts` 를 `import.meta.glob` 메뉴 읽기로 바꾸기. `AppShell.tsx`·`WikiIndex.tsx`·`Dashboard.tsx`·`DocBits.tsx`·`NewDoc.tsx`(`NO_AUTO_CODE` 를 `autoCode` 로) 정리. 메뉴 편집 UI. 제안 호출. `MyRequests.tsx`·`Approvals.tsx` "메뉴" 표시. `src/types.ts` `ProposalPr.kind` | 위 파일, 새 `src/lib/menu.ts` | 3(API 계약), wiki-ux, requests-planner |
| 5 | ops | `writing.md` 63행·31행, `tour.md` 33행에서 목록과 개수 빼기. 운영 문서에 "메뉴 파일 직접 고칠 때" 절차 한 단락 | `지식/guide/writing.md`, `지식/guide/tour.md`, `docs/ops/` | 4 배포, 작성 규칙 개편 계획(writing.md)의 반영 |

**같은 파일 겹침 주의**
- `src/data/docs.ts`·`AppShell.tsx`·`WikiIndex.tsx`·`server/knowledge.ts` 는 0번 작업이 고치는 중이다. 0번 머지 전에는 3·4번을 시작하지 않는다.
- `지식/guide/writing.md` 는 `docs/plan/2026-11-26-writing-guide-beginner-chat-edit.md` 계획도 고친다. 5번은 그 반영 뒤에 한다.
- `server/knowledge.ts`(dev-server)와 `server/assistant-prompt.md`(chatbot-planner)는 파일이 달라 3번 안에서 병렬로 해도 된다. 자리표시 이름만 먼저 맞춘다.
- `vercel.json` 은 dev-server 만 고친다.

---

## 열린 질문 · 상위 지시자 검토 요청

| # | 항목 | 현재 | 제안 | 영향 | PM 의견 |
| --- | --- | --- | --- | --- | --- |
| R1 | 메뉴 정의 위치 | 코드 두 곳과 챗봇 프롬프트에 손으로 적은 목록 | A안 `지식/<카테고리>/_menu.json` 카테고리별 한 장 / B안 `지식/menu.json` 한 장 | A: 편성과 프로모션 메뉴 제안이 서로 부딪히지 않는다. "폴더 = 1단 메뉴"와 맞는다. B: 파일 하나라 읽기가 단순하지만, 동시 제안끼리 충돌이 잦다 | **A 권장** |
| R2 | 반영 방식 | 메뉴 변경 입구 없음(개발자가 코드 수정) | A안 문서 제안과 같은 제안 → 승인(머지) → 다음 배포 / B안 관리자 즉시 반영(실행 중 저장소) | A: 기존 흐름과 문구를 그대로 쓰고 저장소가 원본으로 남는다. 반영은 배포 뒤다. B: 바로 보이지만 메뉴가 저장소 밖에 생겨 문서 `subcategory`·서버 검사·로컬 허브와 갈라진다 | **A 권장.** "관리자가 승인하면 다음 반영 때"를 문구로 분명히 한다 |
| R3 | 이용 안내에 하위 메뉴 만들기 | 이용 안내는 하위 메뉴 없이 문서 6개를 바로 나열 | 이번에는 막기(`allowNewSub: false`) | 열면 기존 6개 문서가 전부 "기타"로 떨어진다. 옮기기 기능이 생긴 뒤에 열 수 있다 | **막기 권장.** "모든 위키" 가운데 이용 안내는 이번에 이름 바꿀 대상이 없다 |
| R4 | 1단 카테고리 이름 바꾸기 | 코드(`categories`·`categoryShort`) | 이번에는 `_menu.json` 으로 이름만 옮기고 화면 입구는 만들지 않음. 바꿀 때는 ops 직접 PR | 챗봇 카테고리 판정 키워드(`assistant.ts` 407행 "편성")와 이름이 어긋날 수 있다. 1단은 자주 바뀌지 않는다 | **범위 밖 권장.** 지시는 "하위메뉴"였다. 필요하면 다음 차수에 같은 흐름으로 연다 |
| R5 | 3단 메뉴 (편성 › 영화/시리즈 › 담당자 메뉴 › 문서) | 2단 아래는 **문서 한 줄**뿐. 편성은 `+ 문서 추가` 로 문서가 곧 하위 메뉴 역할 | A안 지금처럼 "문서 = 하위 메뉴 한 줄" 유지 / B안 하위 메뉴에 `parent` 를 허용해 한 단계 더 중첩(최대 3단 + 문서) / C안 문서 `parent` 로 묶음 문서 아래에 문서를 단다(코드 일부 있음) | B 는 사이드바 들여쓰기, 이동 경로, 위키 목록 칩, 새 문서 고르기, `isKnownPlace`·`docRank`, 챗봇 목록, 휴대폰 폭 서랍 폭까지 손이 간다. 이번 범위의 약 1.5~2배다. C 는 비용이 작지만 "메뉴"가 아니라 "문서"라 빈 메뉴를 먼저 만들 수 없다 | **답 필요.** 직전 맥락("장르별 대메뉴 아래를 담당자가 구성")이 B 를 뜻하는지 확인 부탁드린다. 이번 1차(이름 바꾸기·새 메뉴·순서)는 어느 답이든 필요하므로 먼저 진행한다. 스키마에 `parent` 자리를 남겨 B 로 이어 갈 수 있게 한다 |
| R6 | 하위 메뉴 정렬 | 편성은 정한 순서. 프로모션은 문서 있는 메뉴를 앞으로(`filledFirst`) | 모든 카테고리에서 `_menu.json` 순서 그대로 | 담당자가 정한 순서가 그대로 보인다. 프로모션에서 빈 메뉴(업무 프로세스)가 중간에 흐리게 남는다 | **채택 권장.** 순서를 바꿀 수 있는데 화면이 다시 섞으면 "바꿨는데 안 바뀐다"가 된다 |
| R7 | 문서 옮기기·문서 있는 메뉴 지우기 | 문서 수정 제안으로 프론트매터를 한 건씩 고쳐야 함 | 이번 범위 밖. 다음 차수에 "옮기기" 한 묶음으로 | 이번에는 문서가 있는 메뉴를 지울 수 없다 | **다음 차수 권장** |
| R8 | 편성 문서 코드 머리글 | 편성 문서 0건, 접두 없음(지금 규칙이면 `MOVIE-SERIES-01`·`TV-01`) | `PGM` 머리글, 메뉴별 `PGM-S01-`·`PGM-S02-` | 새 메뉴 id 가 코드에 드러나지 않고, 다른 카테고리 코드와 겹치지 않는다 | **채택 권장.** 팀에서 쓰는 다른 약어가 있으면 알려 달라 |
