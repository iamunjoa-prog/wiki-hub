# 카피·구좌 요청은 바로 답하기 + PPM 세부 상품 확인 — dev-front 구현 지시서

작성 `chatbot-planner` · 2026-11-19
근거 결정: `docs/plan/2026-11-19-pr38-replan.md`(브랜치 `docs/plan-pr38-replan`) 1단계 C1·C2·C3, 상위 지시자 11/19 결정
- 진행 확인 버튼은 지금처럼 "네, 진행할게요 / 아니요, 질문만 할게요" 두 개를 **유지**한다. 세 갈래·"기획부터" 단계 질문은 하지 않는다.
- B tv+는 PPM 안의 주력 상품이다. 사용자가 "PPM"이라고만 하면 PPM 안의 세부 상품을 한 번 더 묻는다.
- B tv+ 표시는 `[PPM]`으로 묶는다(Q4 결정, `docs/plan/2026-11-16-wiki-doc-readability.md` R6). `ProductScope`는 `'PPM' | 'PPV'` 그대로 둔다.
- 어드민(프로모션 자동화)으로 넘기는 값(`CampaignDraft`)은 바꾸지 않는다.

대화 규약(`server/assistant-prompt.md`)은 이 브랜치에서 이미 고쳤다. 이 문서는 화면·규칙 기반 쪽 구현만 다룬다. `server/`·`api/` 코드는 바꿀 것이 없다(엔진은 이력으로 세부 상품을 받는다).

---

## 1. 현재 문제 — 재현 결과

`src/lib/assistant.ts` 의 함수를 esbuild 로 묶어 node 에서 직접 불렀다(방법은 9절). main `a45a5ad` 기준.

| 입력 | 진행 확인 칩 | 규칙 기반 답 | 문제 |
| --- | --- | --- | --- |
| 다음 달 PPM 프로모션 기획하려는데 카피 추천해줘 | `confirm` 붙음 | "PPM(월정액) 프로모션이군요." 한 줄 | 카피 대신 진행 확인. 엔진 경로도 `requestEngine` 이 같은 `intentPromptFor` 로 칩을 붙인다 |
| 영화 신작 프로모션 기획하려는데 카피 추천해줘 | `confirm` 붙음 | "프로모션 진행은 상품 유형에 따라 적용 정책이 갈립니다." | 같음 |
| B tv+ 첫달 무료 이벤트 준비 중인데 배너 카피 써줘 | `confirm` 붙음 | 상품 유형 갈린다는 한 줄 | 같음 + **B tv+를 PPM으로 읽지 못한다**(`PRODUCTS` 키워드에 없음) |
| 월정액 프로모션 진행하려는데 노출 구좌 추천해줘 | 없음 | "정리했습니다. 이벤트명 · 이벤트 기간 · 이벤트 스킴만…" + 정리 카드 | `DECIDE_CUES` 의 `'진행하려'` 때문에 **방향 결정**으로 잡힌다. 엔진 경로는 `withNextStep` 이 다음 단계 칩과 정리 카드를 붙인다 |
| 다음 달 PPM 기획하려는데 카피 추천해줘 ('프로모션' 없음) | 없음 | 상품 트랙 문서 문장 2줄 | 칩은 안 뜨지만(`CAMPAIGN_NOUNS` 없음) 카피도 없다. 규칙 기반이 카피를 못 만든다는 말도 없다 |
| PPV 이벤트명 3개만 추천 | 없음 | 영화 PPV 카피 가이드 문장 2줄 | 이벤트명을 못 만든다는 말 없이 문서 문장만 나온다 |

plan-pm 이 지목한 정확한 예문("다음 달 PPM 기획하려는데 카피 추천해줘")은 '프로모션'이 없어서 칩이 뜨지 않았다. 칩은 **'프로모션·이벤트·배너'와 '기획·하려·준비'가 함께 있을 때** 뜬다. 위 표 1~3행이 그 경우다.

---

## 2. 바꿀 파일·함수

| 파일 | 함수·상수 | 바꿀 것 |
| --- | --- | --- |
| `src/lib/assistant.ts` | 새 `detectDeliverable(query): DeliverableKind \| null` (export) | 3절 판별 규칙 |
| | `detectCampaignIntent` | 맨 앞에 `if (detectDeliverable(query)) return false` |
| | `detectDecision` | `&& !detectDeliverable(query)` 추가. "진행하려는데 구좌 추천해줘"가 결정으로 잡히지 않게 |
| | `PRODUCTS` | PPM 키워드에 `'b tv+'`, `'btv+'`, `'b tv 플러스'`, `'btv플러스'`, `'비티비플러스'`, `'비티비 플러스'` 추가 (Q4: B tv+는 PPM) |
| | 새 `PPM_DETAILS`, `detectPpmDetail(text)` | 4절 |
| | `readSlots` / `CampaignSlots` | `ppmDetail: PpmDetail \| null` 추가. 상품과 같은 방식으로 **가장 최근에 세부 상품을 말한 사용자 발화**에서 읽는다. 최근 상품이 PPM이 아니면 `null` |
| | `readBrief` | 상품 라벨: 세부 상품이 있으면 `PPM(월정액) · B tv+` / `PPM(월정액) · 지상파·종편·CP 월정액`. 없으면 지금 그대로 |
| | `buildCampaignDraft` | **바꾸지 않는다.** `target`·`policyRefs` 가 지금과 글자 하나까지 같아야 한다 |
| | `keepUsable` | 4-3절 세부 상품 필터 |
| | `answer` | 지식 입력·수정 분기 바로 뒤에 `detectDeliverable` 분기 → 새 `deliverableReply` (5절) |
| | `askAssistant` | `withNextStep` 과 같은 자리에 `withRefine` (6절). 인자에 `refineAsked: { product: boolean; detail: boolean }` 추가 |
| | 새 상수 | `INTENT_PRODUCT_RETRY_QUESTION`, `PPM_DETAIL_QUESTION` (8절 문구) |
| `src/types.ts` | `IntentPrompt` | `kind` 에 `'ppm-detail'` 추가, `retry?: string` 추가(고르면 다시 보낼 원래 질문) |
| `src/components/AssistantDock.tsx` | `IntentChip` | `ppm-detail` 선택지 두 개(8절). 나머지 칩 그대로 |
| `src/store/AppStore.tsx` | `IntentChoice`, `INTENT_ANSWER_LABEL` | `'btvplus'`, `'ppm-other'` 추가 |
| | `resolveIntent` | 6-2절 |
| | `COPY_REQUEST` | `'지금 정리한 프로모션 기준으로 카피 후보를 추천해줘'` ('방향' → '후보'). `PLACEMENT_REQUEST` 는 그대로 |
| | 새 ref | `productRefineAskedRef`, `detailAskedRef` — 대화당 한 번. 새 대화를 열 때 다른 ref 와 함께 초기화 |

---

## 3. 결과물 요청 판별 (C1)

결과물 요청 = 카피·이벤트명·노출 구좌를 **만들어 달라는** 말. 맞으면 진행 확인 칩(`confirm`)을 붙이지 않고, 방향 결정·기획 상담으로도 보지 않는다.

```ts
export type DeliverableKind = 'copy' | 'name' | 'placement'

const DELIVERABLE_OBJECTS: [DeliverableKind, string[]][] = [
  ['name', ['이벤트명', '프로모션명', '행사명', '이벤트 이름', '프로모션 이름']],
  ['copy', ['카피', '문구', '헤드라인']],
  ['placement', ['구좌']],
]
/** 만들어 달라는 말 — '추천'은 맨몸도 센다("이벤트명 3개만 추천") */
const MAKE_CUES = /추천|써\s*줘|써\s*줄래|써\s*주세요|뽑아|만들어|지어|짜\s*줘|제안해|골라\s*줘|잡아\s*줘|\d+\s*(?:개|안|가지)/
/** 기준을 묻는 말 — 결과물이 아니라 사실 질문이다 */
const ASKS_RULE = /원칙|규칙|가이드|기준|규격|글자\s*수|몇\s*자|자수|뭐야|무엇|이란|의미/
/** 시스템 공지·품의 문구는 마케팅 카피가 아니다 */
const NOT_MARKETING = /acs|cbs|swing|공지|품의|메일/i
```

판별 순서:

1. `detectKnowledgeEdit(query)` 이면 `null` (문서 고치기가 먼저).
2. `ASKS_RULE` 또는 `NOT_MARKETING` 에 걸리면 `null`.
3. `DELIVERABLE_OBJECTS` 를 위 순서대로 보고, 대상어가 있고 `MAKE_CUES` 도 있으면 그 종류를 돌려준다.

| 걸려야 한다 | 종류 |
| --- | --- |
| 다음 달 PPM 기획하려는데 카피 추천해줘 | copy |
| 영화 신작 프로모션 기획하려는데 카피 추천해줘 | copy |
| 배너 문구 뽑아줘 | copy |
| B tv+ 첫달 무료 이벤트 준비 중인데 배너 카피 써줘 | copy |
| PPV 이벤트명 3개만 추천 | name |
| 월정액 프로모션 진행하려는데 노출 구좌 추천해줘 | placement |
| 지금 정리한 프로모션 기준으로 카피 후보를 추천해줘 (칩) | copy |
| 지금 정리한 프로모션 기준으로 노출 구좌를 추천해줘 (칩) | placement |

| 걸리면 안 된다 | 이유 |
| --- | --- |
| 카피 작성 원칙이 뭐야? | 기준 질문 (`ASKS_RULE`) |
| 띠배너 카피 글자 수는? | 기준 질문 |
| 영화 PPV 카피 어떻게 쓰는 게 좋아? | 만들어 달라는 말 없음 → 지금처럼 판단 요청 |
| 좋은 구좌는 어디야? | 만들어 달라는 말 없음 → 지금처럼 판단 요청 |
| Swing 공지 문구 써줘 | 시스템 공지 (`NOT_MARKETING`) |
| 카피 가이드 문서 수정해줘 | 지식 입력·수정이 먼저 |
| 월정액 프로모션 기획하고 싶어 | 대상어 없음 → 지금처럼 진행 확인 칩 |

판별 단어는 대화 규약의 결과물 요청 기준("추천해줘, 써줘, 뽑아줘, 지어줘, 3개만", 원칙·규격·글자 수는 사실 질문)과 맞춰 두었다. 한쪽을 바꾸면 다른 쪽도 맞춘다.

---

## 4. PPM 세부 상품

### 4-1. 선택지와 위키 근거

| 선택지(칩 글자) | 값 | 위키 근거 |
| --- | --- | --- |
| B tv+ | `btvplus` | `지식/promotion/products.md` "B tv+ — 자체 OTT 결합 상품 · B tv 자체 OTT 번들 월정액", `지식/promotion/promotion-map.md` 상품 분류 표 PPM 대표 상품 첫 줄 |
| 지상파·종편·CP 월정액 | `ppm-other` | `지식/promotion/products.md` "PPM — 월정액 · 정의: 월 단위 구독 상품 (지상파·종편·CP별 월정액)" |

- 위키에 근거가 있는 PPM 하위 구분은 이 둘뿐이다. 개별 제휴사 이름으로 더 나누지 않는다(공개 저장소, `products.md` "개별 상품명은 여기 적지 않는다").
- **"TV 상품"이라는 글자는 쓰지 않는다.** 위키에서 "TV방송"은 **PPV**의 대표 상품이다(`promotion-map.md` 상품 분류 표). 칩에 "TV 상품"이라고 쓰면 사용자가 PPV를 고른 것으로 읽을 수 있고, 키워드로 읽을 때도 PPV와 섞인다.
- 실시간 채널은 PPM이 아니다(`promotion-map.md` "실시간 채널은 PPM이 아닙니다"). 선택지에 넣지 않는다.

### 4-2. 읽는 규칙

```ts
export type PpmDetail = 'btvplus' | 'ppm-other'
const PPM_DETAILS: { value: PpmDetail; label: string; keywords: string[] }[] = [
  { value: 'btvplus', label: 'B tv+', keywords: ['b tv+', 'btv+', 'b tv 플러스', 'btv플러스', '비티비플러스', '비티비 플러스'] },
  { value: 'ppm-other', label: '지상파·종편·CP 월정액', keywords: ['지상파', '종편', 'cp 월정액', 'cp별 월정액'] },
]
```

- **B tv+ 키워드는 상품(PPM)과 세부 상품을 함께 정한다.** "B tv+ 카피 써줘"는 PPM·B tv+이고 아무것도 묻지 않는다.
- **`ppm-other` 키워드는 상품을 정하지 않는다.** "지상파 드라마 단건 할인 카피"는 PPV다(지상파 방송 다시보기는 PPV). 그 발화 또는 앞선 사용자 발화로 상품이 PPM일 때만 세부 상품으로 읽는다.
- 한 발화에 둘 다 나오면 세부 상품을 정하지 않는다(`detectProduct` 의 비교 질문 처리와 같은 이유).
- 어시스턴트 턴은 읽지 않는다. 칩으로 고른 값은 사용자 발화로 남긴다(6-2절) — 되물은 문장이 조건으로 굳지 않게 하는 지금 규칙과 같다.

### 4-3. 근거 문서 고르기 (규칙 기반)

`scope` 는 둘 다 `'PPM'` 이다. 세부 상품은 `keepUsable` 과 검색 결과에서 줄을 더 거른다.

| 세부 상품 | 빼는 것 | 더하는 것 |
| --- | --- | --- |
| `btvplus` | `지상파`·`종편` 이 들어간 줄 (`benchmarks.md` 의 지상파·종편 행 등) | 검색 `context` 에 `B tv+` 를 덧붙여 `schemes.md` "이벤트 방식별 조합 (B tv+)", `targeting.md` "B tv+ 검증 타겟 그룹" 이 먼저 오게 |
| `ppm-other` | `today-btv-plus.md`(MKI-B-12) 문서 전체. 그리고 `b tv+` 가 들어 있으면서 `ppm`·`월정액별` 이 없는 줄 | 없음 |
| 모름 (PPM만) | 위 두 줄 종류 모두 — PPM 공통 줄만 남긴다 | 없음 |

`월정액 가입 빅배너 … B tv+ 및 월정액별 GNB` 처럼 둘 다 해당하는 줄은 남는다. `schemes.md` "쿠폰 종류 (B tv+ · PPM)" 표는 PPM 공통이라 남는다.

엔진은 이 필터를 거치지 않는다. 대신 대화 규약 근거 규칙("B tv+는 PPM 안의 세부 상품이다")이 같은 일을 한다.

---

## 5. 규칙 기반 결과물 답 (C3)

엔진이 없거나 모두 실패해 `answer()` 로 떨어졌을 때. 카피·이벤트명은 **지어내지 않는다.** 못 한다고 첫 줄에 밝히고, 위키의 기준을 보여 준다. 실패 원인 한 줄(`fallbackNotice`)은 지금처럼 따로 붙으니 원인을 이 답에서 반복하지 않는다.

형식 (5줄):

```
{첫 줄}
**{문서 제목}** ({코드})
· {기준 문장}
· {기준 문장}
{끝 줄}
```

| 종류 | 첫 줄 | 근거로 볼 문서 | 끝 줄 |
| --- | --- | --- | --- |
| copy | 지금은 규칙 기반으로 답하고 있어 카피 후보를 직접 만들 수 없습니다. 대신 위키의 카피 기준을 짚어 드립니다. | 영화 PPV: MKI-C-02. 그 밖: MKI-C-01. 상품이 PPM이면 기준 문장 하나를 MKI-C-04 "규제 검수"의 정가 전환 고지 줄로 쓴다 | AI 답변 엔진이 연결되면 같은 질문으로 방향이 다른 카피 3안을 받을 수 있습니다. |
| name | 지금은 규칙 기반으로 답하고 있어 이벤트명 후보를 직접 만들 수 없습니다. 대신 위키의 카피 기준을 짚어 드립니다. | 위와 같음 | AI 답변 엔진이 연결되면 같은 질문으로 이벤트명 후보 3개를 받을 수 있습니다. |
| placement | 지금은 규칙 기반으로 답하고 있어 구좌를 골라 드리지는 못하고, 위키 조합표에서 맞는 줄을 보여 드립니다. | MKI-05 플레이북의 해당 상품 절 → 없으면 MKI-B-00 | AI 답변 엔진이 연결되면 같은 질문으로 구좌 2~3개와 고른 이유를 받을 수 있습니다. |

- 검색은 지금 `answer()` 의 `SearchInput` 을 쓰되 `preferSubcategory` 를 copy·name 은 `['copy-guide']`, placement 는 `['insight', 'banner-spec']` 로 준다. `scope`·세부 상품 필터(4-3절)는 그대로 건다.
- 상품이 PPM 이면 MKI-C-02(영화 PPV 카피 가이드)를 쓰지 않는다. 지금도 `scope` 가 PPV 라 `inScope` 에서 빠지지만, 상품을 모를 때도 "영화"·"PPV"가 질문에 없으면 MKI-C-02 대신 MKI-C-01 을 고른다.
- `sources` 는 실제로 문장을 뽑은 문서만.
- 결과물 요청은 진행 확인 칩·정리 카드를 붙이지 않는다. 상품·세부 상품 칩은 6절 `withRefine` 이 붙인다.

---

## 6. 칩 동작

### 6-1. 답 아래에 붙는 확인 (`withRefine`)

`askAssistant` 가 엔진 답·규칙 기반 답 모두에 같은 규칙으로 붙인다. `reply.intent`·`report`·`reportFailed`·`cancelled` 가 있으면 건너뛴다. 대상 질문은 **결과물 요청과 판단 요청(`wantsAdvice`)** 뿐이다. 사실 질문·매뉴얼·절차 질문에는 붙이지 않는다(PPM 정책은 세부 상품과 관계없이 같다).

| 조건 (이번 질문까지의 사용자 발화 기준) | 붙일 것 |
| --- | --- |
| 결과물 요청 + 상품 모름 + `productRefineAsked` 아님 | `{ kind: 'product-qa', question: INTENT_PRODUCT_RETRY_QUESTION, retry: query }` |
| (결과물 요청 또는 판단 요청) + 상품 PPM + 세부 상품 모름 + `detailAsked` 아님 | `{ kind: 'ppm-detail', question: PPM_DETAIL_QUESTION, retry: query }` |
| 그 밖 | 없음 |

판단 요청인데 상품을 모르는 경우는 지금처럼 아무것도 붙이지 않는다(이번 범위 밖).

붙였으면 해당 ref 를 `true` 로. `resumeNextRef`(다음 단계 칩 복귀)는 `reply.intent` 가 없을 때만 동작하므로, 확인 칩이 먼저 뜨고 그 재요청 답 뒤에 다음 단계 칩이 붙는다. 따로 고칠 것 없다.

### 6-2. 고른 뒤 (`resolveIntent`)

| 칩 | 고른 값 | 동작 |
| --- | --- | --- |
| `confirm` | 네 | **지금 그대로.** 상품을 알면 바로 어드민, 모르면 `product` 칩. 세부 상품은 묻지 않는다(어드민으로 넘기는 값이 없다) |
| `confirm` | 아니요 | 상품 모름 → 지금 그대로 `product-qa`. 상품 PPV → 지금 그대로. **상품 PPM + 세부 모름** → 본문 `알겠습니다. PPM(월정액) 기준으로 답하겠습니다.` + `ppm-detail` 칩(`retry` 없음). PPM + 세부 앎 → `알겠습니다. PPM(월정액) 중 {세부 라벨} 기준으로 답하겠습니다. …` |
| `product` | PPM·PPV | **지금 그대로** 어드민 열기. `openCampaignAdmin(scope)` 인자 변화 없음 |
| `product-qa` (`retry` 없음) | PPV | 지금 그대로 |
| | PPM | 사용자 발화 `월정액(PPM) 기준으로 물어볼게요` + 본문 `월정액(PPM) 기준으로 답하겠습니다.` + `ppm-detail` 칩(`retry` 없음) |
| `product-qa` (`retry` 있음) | PPV | `ask('단건(PPV) 기준으로 ' + retry, { via: '단건(PPV) 기준으로 다시' })` |
| | PPM | 세부 상품을 이미 알면 `ask('월정액(PPM) 기준으로 ' + retry, …)`. 모르면 본문 없는 메시지에 `ppm-detail` 칩(같은 `retry`)만 띄운다 |
| `ppm-detail` (`retry` 없음) | B tv+ / 지상파·종편·CP 월정액 | 사용자 발화 `{라벨} 기준으로 물어볼게요` + 본문 `PPM(월정액) 중 {라벨} 기준으로 답하겠습니다. 궁금한 것을 물어봐 주세요.` |
| `ppm-detail` (`retry` 있음) | 같음 | `ask(라벨 + ' 기준으로 ' + retry, { via: 라벨 + ' 기준으로 다시' })` |
| `next` | 카피·구좌·연결·나중에 | 지금 그대로 (카피 칩이 보내는 문장만 2절대로 바뀜) |

- 다시 보내는 문장 앞에 라벨을 붙이는 이유: 라벨 글자(`B tv+`, `지상파…`, `월정액(PPM)`, `단건(PPV)`)가 그대로 `readSlots` 키워드에 걸려 상품·세부 상품이 사용자 발화로 확정된다. 엔진도 이력에서 같은 문장을 본다.
- 재요청은 대화당 한 번이다. 재요청 답에는 같은 확인이 다시 붙지 않는다(ref 가 이미 `true`).
- 어느 경로에서도 `buildCampaignDraft`·`openCampaignAdmin` 의 인자는 바뀌지 않는다.

---

## 7. 문구 원문

| 이름 | 원문 |
| --- | --- |
| `INTENT_PRODUCT_RETRY_QUESTION` | 월정액(PPM)인가요, 단건(PPV)인가요? 고르시면 그 상품 기준으로 다시 맞춰 드립니다. |
| `PPM_DETAIL_QUESTION` | PPM 중 B tv+ 상품인가요, 지상파·종편·CP 월정액인가요? 고르시면 그 상품 기준으로 맞춰 답합니다. |
| `ppm-detail` 선택지 | `B tv+` · `지상파·종편·CP 월정액` |
| `INTENT_ANSWER_LABEL.btvplus` | B tv+ |
| `INTENT_ANSWER_LABEL['ppm-other']` | 지상파·종편·CP 월정액 |
| 정리 카드 상품 칸 | `PPM(월정액) · B tv+` / `PPM(월정액) · 지상파·종편·CP 월정액` / 세부 모름이면 `PPM(월정액)` |
| `COPY_REQUEST` | 지금 정리한 프로모션 기준으로 카피 후보를 추천해줘 |
| 규칙 기반 첫 줄·끝 줄 | 5절 표 |
| '아니요' 뒤 PPM | 알겠습니다. PPM(월정액) 기준으로 답하겠습니다. |
| 세부 고른 뒤 (retry 없음) | PPM(월정액) 중 {라벨} 기준으로 답하겠습니다. 궁금한 것을 물어봐 주세요. |

`retry` 가 있는 칩의 질문 문구가 "다시 맞춰 드립니다"인 것은 답을 이미 한 번 받은 뒤이기 때문이다. `retry` 없는 `product-qa` 는 지금 문구(`INTENT_PRODUCT_QA_QUESTION`)를 그대로 쓴다.

---

## 8. 수용 기준

"엔진"은 claude·codex·gemini 중 하나가 답한 경우, "규칙"은 규칙 기반으로 떨어진 경우.

| # | 입력 (대화) | 기대 결과 |
| --- | --- | --- |
| 1 | 다음 달 PPM 프로모션 기획하려는데 카피 추천해줘 (엔진) | 진행 확인 칩 **없음**. `· 정공법: … / …`, `· 감성·호기심: …`, `· 혜택 강조: …` 3줄 + 빈 줄 + 주의 한 줄(월정액 전용 가이드 없음, 정가 전환 고지). 작품명·할인율은 `〈…〉` 자리 표시. `sourcePaths` 에 `promotion/copy-principles.md`, `promotion/copy-movie-ppv.md` 없음. 답 아래 `ppm-detail` 칩 |
| 2 | 1과 같은 입력 (규칙) | 첫 줄 "지금은 규칙 기반으로 답하고 있어 카피 후보를 직접 만들 수 없습니다. …". 근거 MKI-C-01, 기준 문장 하나가 정가 전환 고지 줄. MKI-C-02 없음. 진행 확인 칩 없음, `ppm-detail` 칩 있음 |
| 3 | 1 다음 칩 "B tv+" | 사용자 말풍선 "B tv+ 기준으로 다음 달 PPM 프로모션 기획하려는데 카피 추천해줘", 위에 작게 "B tv+ 기준으로 다시". 새 답에 확인 칩 다시 없음 |
| 4 | 월정액 프로모션 진행하려는데 노출 구좌 추천해줘 (엔진) | 정리 카드·다음 단계 칩 **없음**(지금은 결정으로 잡힘). `· 구좌 이름: 이유` 2~3줄, 근거 `promotion/playbook.md`·`placements.md`·`banner-specs.md` 중 하나 이상. Today B tv+ 는 나오지 않음(세부 모름 → PPM 공통). `ppm-detail` 칩 |
| 5 | 4 다음 칩 "지상파·종편·CP 월정액" (규칙) | 근거에 MKI-B-12(Today B tv+ 배너) 없음. 본문에 `B tv+` 전용 줄 없음 |
| 6 | B tv+ 첫달 무료 이벤트 준비 중인데 배너 카피 써줘 | 진행 확인 칩 없음, `ppm-detail` 칩 없음, `product-qa` 칩 없음. `readSlots(...).product.scope === 'PPM'`, `ppmDetail === 'btvplus'` |
| 7 | 배너 문구 뽑아줘 | 진행 확인 칩 없음. 공통 원칙 3안(엔진) 또는 C3 답(규칙). 답 아래 `product-qa` 칩, 질문 "월정액(PPM)인가요, 단건(PPV)인가요? 고르시면 그 상품 기준으로 다시 맞춰 드립니다." |
| 8 | 7 다음 칩 "월정액(PPM)" | 본문 없는 메시지에 `ppm-detail` 칩만. 여기서 "B tv+"를 고르면 "B tv+ 기준으로 배너 문구 뽑아줘" 재요청, 답에 확인 칩 없음 |
| 9 | 7 다음 칩 "단건(PPV)" | 바로 "단건(PPV) 기준으로 배너 문구 뽑아줘" 재요청. `ppm-detail` 칩 없음. 답에 전환 동의·자동 해지·약정 없음 |
| 10 | PPV 이벤트명 3개만 추천 | 진행 확인 칩 없음. 엔진: `· 이벤트명: 이유` 3줄. 규칙: "…이벤트명 후보를 직접 만들 수 없습니다…" 첫 줄. 확인 칩 없음 |
| 11 | 월정액 프로모션 기획하고 싶어 → "아니요, 질문만 할게요" | 진행 확인 칩은 **지금처럼 두 버튼**. '아니요' 뒤 "알겠습니다. PPM(월정액) 기준으로 답하겠습니다." + `ppm-detail` 칩. "B tv+" 고르면 사용자 말풍선 "B tv+ 기준으로 물어볼게요" + "PPM(월정액) 중 B tv+ 기준으로 답하겠습니다. 궁금한 것을 물어봐 주세요." |
| 12 | PPM 프로모션 기획하려고 해 → "네, 진행할게요" | `ppm-detail` 칩 **없이** 바로 어드민 새 탭. `buildCampaignDraft` 결과가 변경 전과 같음(`target: 'PPM(월정액)'`, `policyRefs` 동일) |
| 13 | 프로모션 기획하려고 해 → 아니요 → 월정액(PPM) | 사용자 말풍선 "월정액(PPM) 기준으로 물어볼게요" + "월정액(PPM) 기준으로 답하겠습니다." + `ppm-detail` 칩 |
| 14 | PPM 신규 가입 프로모션 타겟 어떻게 잡는 게 좋아? | 판단 요청 그대로. 답 아래 `ppm-detail` 칩(`retry`). B tv+ 고르면 재요청 답에 `targeting.md` B tv+ 그룹이 근거로 올 수 있음 |
| 15 | PPM 전환동의 팝업은 어느 UI 버전부터 돼? | 사실 질문, 지금 답 그대로. `ppm-detail` 칩 **없음** |
| 16 | 지상파 드라마 단건 할인 배너 카피 써줘 | 상품 PPV, `ppmDetail` null, `ppm-detail` 칩 없음 |
| 17 | 카피 작성 원칙이 뭐야? / 띠배너 카피 글자 수는? / Swing 공지 문구 써줘 | 결과물 요청 아님. 지금 답 그대로 |
| 18 | 회귀: 판촉 쿠폰 품의 결재선은? / 프로모션 어떤 순서로 진행돼? / CBS 승인요청 방법 | 지금 동작(사실 답 / 절차 답 / 매뉴얼 답) 그대로. 확인 칩 없음 |
| 19 | 회귀: 방향 결정 → 다음 단계 칩 "카피 추천받기" (대화에 PPM만 있음) | 보낸 문장 "지금 정리한 프로모션 기준으로 카피 후보를 추천해줘"가 결과물 요청. 답 아래 `ppm-detail` 칩 → 고른 뒤 재요청 답 아래에 다음 단계 칩이 다시 붙음 |
| 20 | 회귀: 1·4·6·7·10 입력과 `COPY_REQUEST` | `mayBeReport(...) === false` |

---

## 9. 세 엔진 확인 방법

### 규칙 기반

1. 함수 단위: esbuild 로 `src/lib/assistant.ts` 를 묶어 node 에서 `answer`·`detectDeliverable`·`intentPromptFor`·`readSlots` 를 직접 부른다. `src/data/knowledgeDocs.ts` 의 `import.meta.glob(...)` 은 vite 전용이라, esbuild 플러그인 `onLoad({ filter: /knowledgeDocs\.ts$/ })` 에서 그 호출을 `{ '/지식/…md': 본문, … }` 객체 문자열로 바꿔 끼운다(`지식/` 을 fs 로 읽어 만든다). 1절 재현이 이 방법이다.
2. 화면: `.env.local` 에 `GEMINI_API_KEY` 를 두지 않고, Claude Code·Codex 로그인이 없는 상태에서 `npm run dev` → 대화창. 답 하단 "답변 · 규칙 기반 (문서 기준)" 확인. 8절 2·5·10·17·18.

### Gemini

1. `.env.local` 에 `GEMINI_API_KEY=` 를 넣고 `npm run dev`.
2. 대화창 엔진 선택에서 Gemini(공용 AI). 답 하단 "답변 · Gemini".
3. 8절 1·3·4·6·7·9·10·14. Gemini 는 위키 전체를 시스템 지시로 받으므로 세부 상품 필터 없이 대화 규약만으로 B tv+ 줄을 가려야 한다 — 5번 대화(지상파·종편·CP 월정액)에서 Today B tv+ 가 나오지 않는지 특히 본다.

### 로컬 CLI (Claude Code·Codex)

1. 로컬 허브 PC 에서 Claude Code 또는 Codex 로그인 후 `npm run dev` (중계 `server/cliBridge.ts`).
2. 엔진 선택에서 Claude 또는 Codex. 답 하단 "답변 · Claude"/"Codex".
3. 8절 1·3·4·7·10·19. 결과물 요청 문장이 리포트 대기("리포트를 정리하는 중")로 넘어가지 않는지 확인(20번).

엔진 답의 형식(3줄 후보, 자리 표시, `sourcePaths`)은 대화 규약이 정한다. 형식이 어긋나면 화면 코드가 아니라 `server/assistant-prompt.md` 를 chatbot-planner 에게 돌려보낸다.

---

## 10. 이번에 하지 않는 것

| 항목 | 이유 |
| --- | --- |
| 진행 확인 칩 세 갈래, "기획부터" 단계 질문 | 11/19 결정으로 하지 않음 |
| 어드민으로 세부 상품·이벤트명 넘기기 | 프로모션 자동화 쪽 파라미터 합의 전 |
| 다음 단계 안내 문구 변경(P1) | 이번 지시 범위 밖 |
| 판단 요청에서 상품을 모를 때 상품 칩 | 이번 지시 범위 밖. 지금 동작 유지 |
| 사실 질문에 세부 상품 칩 | PPM 정책은 세부 상품과 관계없이 같다. 묻는 횟수만 는다 |
