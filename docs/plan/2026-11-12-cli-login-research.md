# CLI 로그인 동작 조사 — P0-4 · 열린 질문 8·9

상위 기획: `docs/plan/2026-11-12-local-hub-beginner-setup.md` 의 "chatbot-planner 조사" 항목(P0-4 로그인, P1-6·P1-8, 열린 질문 8·9·10).
담당: chatbot-planner. 코드는 고치지 않았다.

## 조사 방법과 한계

- 조사 환경: Linux, Node v22.23.4, npm 10.9.9. 두 패키지를 임시 폴더에 설치했다(전역 설치 아님).
- 확인한 버전: **`@anthropic-ai/claude-code` 2.1.322**, **`@openai/codex` 0.167.2 (`codex-cli 0.167.2`)**.
- 실행한 것: `--help`, `auth status`/`login status`, 그리고 로그인 명령의 **앞부분만**. 브라우저 대신 무해한 명령을 연결하고(`BROWSER=/bin/true`) 10~20초 뒤에 강제로 끝냈다. **실제 로그인은 하지 않았다.**
- 로그인 이후 동작(성공 문구·종료 코드)은 실행하지 못해서, 패키지 안 실행 파일의 문자열과 코드 조각으로 확인했다. 이렇게 확인한 줄에는 "(코드 확인)"을 붙였다.
- 이 조사 환경은 호스팅 세션이 Claude 자격 증명을 따로 넣어 주고 있어서, 빈 홈 폴더에서도 `claude auth status` 가 `loggedIn: true` 로 나왔다. 그래서 **claude 미로그인 출력은 직접 보지 못했고** 코드로 확인했다.
- Windows·macOS에서는 실행하지 못했다. 브라우저 열기, PowerShell 출력 처리는 확인 필요로 남긴다.
- 아래 인용의 로그인 주소는 쿼리 부분을 `<redacted>` 로 지웠다.

---

## 1. `claude auth login` (2.1.322)

### 옵션 (`claude auth login --help` 원문)

```
--claudeai       Use Claude subscription (default)
--console        Use Anthropic Console (API usage billing) instead of Claude subscription
--email <email>  Pre-populate email address on the login page
--sso            Force SSO login flow
```

로그인 방식을 묻는 화면은 없다. 옵션을 주지 않으면 **Claude 구독(`--claudeai`)이 기본값**이다.

### 실행할 때 일어나는 일

1. 터미널에 아래 세 줄을 쓰고 브라우저를 연다. 입력 없이 실행하고 화면도 연결되지 않은 상태(TTY 아님)에서 실제로 나온 출력이다.
   ```
   Opening browser to sign in…
   If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?<redacted>
   Paste code here if prompted >
   ```
2. 동시에 이 PC 안에 로그인 결과를 받을 수신 창구(localhost)를 연다. 브라우저에서 로그인과 승인을 마치면 브라우저가 이 창구로 돌아오고, 터미널은 **입력 없이** 다음 단계로 넘어간다(코드 확인).
3. 성공하면 `Login successful.` 를 출력하고 **종료 코드 0**으로 스스로 끝난다(코드 확인). 회사가 중앙에서 설정을 관리하는 PC이면 그 사실을 알리는 줄이 한 줄 더 나온다. 화면이 연결된 터미널일 때만 나온다.
4. 실패하면 `Login failed: …` 를 출력하고 **종료 코드 1**로 끝난다. 코드 붙여넣기를 기다리던 중 입력이 끊기면 **130**으로 끝난다(코드 확인).

### 터미널에서 따로 요구하는 것

- **테마 선택·약관 동의·로그인 방식 선택은 없다.** 테마·폴더 신뢰 같은 첫 실행 질문은 `claude` 를 대화형으로 켤 때 나오는 것이고, `auth login` 경로에는 없다(코드 확인). 허브는 `claude -p`(비대화형)만 쓴다.
- 유일한 터미널 입력은 **코드 붙여넣기**다. 이 PC에서 수신 창구를 열 수 없을 때만 필요하다. 그때는 `The browser can't return the sign-in to Claude Code automatically. After you sign in, paste the code shown.` 와 `Paste code here > ` 가 나온다. 이 경로는 **화면이 연결된 터미널일 때만** 켜진다(코드 확인). 보통 PC에서는 드물 것으로 보지만 실기기 확인이 필요하다.
- 계정 선택(이메일·Google·SSO), 조직 선택, 접근 승인 같은 선택은 모두 **브라우저 안에서** 일어난다. 실제 화면은 로그인하지 않아 확인하지 못했다.

### 비대화형 실행

- 입력을 막고(`< /dev/null`) 출력을 파일로 돌려도 시작 단계는 정상으로 진행됐다(위 1번 출력). 입력이 닫혀도 붙여넣기 대기 중이 아니면 중단되지 않는다(코드 확인).
- **스스로 끝나는 시간 제한은 코드에서 찾지 못했다.** 사용자가 브라우저를 닫으면 터미널은 계속 기다릴 수 있다. 스크립트가 시간 제한을 걸어야 한다.
- 브라우저 없이 끝내는 방법(`CLAUDE_CODE_OAUTH_REFRESH_TOKEN`)은 미리 받은 토큰이 있어야 하므로 초보자 흐름에는 맞지 않는다.

## 2. `codex login` (0.167.2)

### 옵션 (`codex login --help` 요약)

- 옵션 없음: 브라우저로 ChatGPT 로그인(기본)
- `--device-auth`: 다른 기기에서 일회용 코드로 로그인
- `--with-api-key`, `--with-access-token`: 표준 입력으로 키·토큰을 넣는다(초보자 흐름 아님)

### 실행할 때 일어나는 일

1. 이 PC의 **고정 포트 1455**에 로그인 결과를 받을 서버를 열고 브라우저를 연다. 실제 출력:
   ```
   Starting local login server on http://localhost:1455.
   If your browser did not open, navigate to this URL to authenticate:

   https://auth.openai.com/oauth/authorize?<redacted>

   On a remote or headless machine? Use `codex login --device-auth` instead.
   ```
   (임시 폴더에서 실행해서 `WARNING: … PATH aliases …` 한 줄이 먼저 나왔다. 실무자 PC의 사용자 폴더에서는 나오지 않을 것으로 본다.)
2. 브라우저에서 ChatGPT 로그인을 마치면 1455번 포트로 돌아오고, 터미널은 **입력 없이** 진행한다.
3. 성공하면 `Successfully logged in` 을 출력하고 끝난다(코드 확인, 종료 코드 0 추정). 실패하면 `Error logging in: …` 또는 `Login server error: …` 를 내고 끝난다.

### 터미널에서 따로 요구하는 것

- **`codex login` 하위 명령에는 터미널 선택지가 없다.** 실행 파일 안의 "Choose how you want to use Codex / Sign in with ChatGPT / Sign in with Device Code / Use an OpenAI API key" 선택 화면은 `codex` 를 대화형으로 처음 켤 때 나오는 화면이다. `codex login` 은 그 화면을 거치지 않고 바로 브라우저 로그인으로 간다(실행해서 확인).
- 걸리는 점: **1455번 포트를 이미 쓰고 있으면** 로그인 서버를 열지 못하고 오류로 끝날 수 있다. 이전 로그인 창이 남아 있을 때가 대표적이다(실기기 확인 필요).
- `--device-auth` 는 이 환경에서 네트워크 오류로 끝나 확인하지 못했다. 코드를 화면에서 옮겨 적어야 하므로 초보자 기본 경로로는 쓰지 않는다.

### 비대화형 실행

- 입력을 막고 출력을 파일로 돌려도 시작 단계가 정상으로 진행됐다.
- 스스로 끝나는 시간 제한은 확인하지 못했다. 스크립트가 시간 제한을 걸어야 한다.

---

## 3. 로그인 확인 명령과 지금 판정 로직

### 출력 형식

| 명령 | 로그인됨 | 로그인 안 됨 | 출력 위치 |
| --- | --- | --- | --- |
| `claude auth status` (기본 `--json`) | `{"loggedIn": true, "authMethod": "claude.ai", …}` 종료 코드 0. 구독 로그인이면 `subscriptionType`·`email`·`orgName` 이 붙는다(코드 확인) | `{"loggedIn": false, "authMethod": "none", …}` **종료 코드 1**(코드 확인: `process.exit(loggedIn ? 0 : 1)`) | stdout |
| `claude auth status --text` | `Login method: …` 줄들 | `Not logged in. Run claude auth login to authenticate.` | stdout |
| `codex login status` | `Logged in using ChatGPT` (그 밖에 `… using access token` 등. 코드 확인) | `Not logged in`, **종료 코드 1**(실행해서 확인) | **stderr** (미로그인은 실행해서 확인, 로그인됨은 같은 경로로 추정) |

주의할 점:

- `claude auth status` 는 환경 변수 `ANTHROPIC_API_KEY` 만 있어도 `loggedIn: true`, `authMethod: "api_key"` 를 낸다(실행해서 확인). 구독 계정이 아니라 API 사용량 과금으로 붙은 상태도 "연결됨"으로 보인다. 초보자 PC에서 이 변수가 있을 가능성은 낮다.
- `codex login status` 는 결과를 **stderr로** 낸다. stdout만 읽으면 언제나 빈 문자열이다.

### 지금 판정이 맞는가

| 위치 | 판정 | 결과 |
| --- | --- | --- |
| `scripts/setup.ps1` `Test-LoggedIn` claude | `claude auth status 2>$null \| ConvertFrom-Json` → `.loggedIn -eq $true` | **맞다.** 미로그인이어도 JSON이 나오므로 false가 된다 |
| `scripts/setup.ps1` `Test-LoggedIn` codex | `2>&1` 로 합친 뒤 `$LASTEXITCODE -eq 0` + `-match 'logged in'` + `-notmatch 'not logged in'` | **맞다.** PowerShell `-match` 는 대소문자를 가리지 않는다. Windows PowerShell 5.1은 stderr를 오류 레코드로 감싸 `codex : Logged in using ChatGPT` 처럼 앞뒤 글자가 붙지만, 부분 일치라 결과는 같다. 실기기 확인은 못 했다 |
| `start-hub.command` `logged_in` claude | JSON `loggedIn===true` | **맞다** |
| `start-hub.command` `logged_in` codex | `[[ "$out" == *"logged in"* && "$out" != *"not logged in"* ]]` | **틀렸다.** bash의 `==` 패턴 비교는 대소문자를 가린다. 실제 문구 `Logged in using ChatGPT` 에는 소문자 `logged in` 이 없어서 **로그인돼 있어도 늘 "로그인 안 됨"으로 본다.** 그래서 Mac에서는 codex에 로그인했어도 실행할 때마다 로그인을 다시 묻는다. 아래 재현 참고 |
| `server/cliBridge.ts` `checkLogin` | claude JSON / codex `/logged in/i` (stdout+stderr 합침) | **맞다** |

Mac 판정 재현(같은 비교식을 bash로 실행):

```
bash 판정 [Logged in using ChatGPT] -> false   ← 로그인됐는데 false
bash 판정 [Not logged in] -> true              ← 종료 코드 1 때문에 앞에서 이미 false로 끝나 실제로는 문제없음
```

고치는 방법(dev-server에게 넘김): 대소문자를 가리지 않게 비교한다. 예: `shopt -s nocasematch` 를 함수 안에서 켜고 끄기, 또는 `grep -qi '^logged in'`. 더 단순하게는 **종료 코드만 본다**(`codex login status >/dev/null 2>&1`). 미로그인일 때 1로 끝나는 것은 실행해서 확인했다. 로그인됐을 때 0인지는 확인 필요.

---

## 4. 질문 없이 로그인을 끝내는 호출 방식 — 권고 (열린 질문 8의 답)

**결론: 두 CLI 모두 로그인 명령에서 터미널 선택지를 내지 않는다. 그래서 "옵션으로 자동 지정"할 것은 claude의 `--claudeai` 하나뿐이고, 나머지는 브라우저 안의 일이다. 스크립트는 "그 화면만 한국어로 안내"할 필요가 거의 없다.** 남는 예외는 claude 코드 붙여넣기와 codex 포트 충돌 두 가지다. 둘 다 "실패 → 나중에 [로그인] 버튼" 경로로 보내면 된다.

권고하는 호출 순서(Windows·Mac 공통 설계, 구현은 dev-server):

1. **이미 로그인했으면 건너뛴다.** 확인 명령으로 판정한다(위 3의 판정. Mac codex는 고친 판정으로).
2. **명령을 고정한다.**
   - claude: `claude auth login --claudeai`. 기본값과 같지만 구독 경로를 명시해, 이후 기본값이 바뀌어도 Console(API 과금) 화면으로 가지 않게 한다.
   - codex: `codex login`(옵션 없음). `--device-auth` 는 쓰지 않는다.
3. **CLI 출력은 창에 보이지 않게 로그 파일로 보낸다**(AC-3). 표준 입력은 그대로 둔다. 시작 단계는 화면 없이도 진행되는 것을 확인했다.
   - 창에는 한국어 한 줄만: "브라우저에서 ○○ 계정으로 로그인해 주세요. 마치면 자동으로 다음으로 넘어갑니다."
   - 출력이 숨겨지므로 브라우저가 안 열렸을 때의 주소도 안 보인다. 그래서 스크립트가 로그 파일에서 `https://` 로 시작하는 첫 주소를 읽어 **직접 한 번 더 연다**(Windows `Start-Process`, Mac `open`). 창에는 "브라우저가 안 열리면 잠시 기다려 주세요"만 쓴다.
4. **끝났는지는 종료 코드가 아니라 확인 명령으로 판단한다.** 로그인 프로세스를 띄운 채 3초마다 확인 명령을 돌린다.
   - 로그인됨으로 바뀌면 "연결됨"을 보여 주고 다음으로 간다(CLI는 스스로 끝난다. 남아 있으면 끝낸다).
   - 프로세스가 먼저 끝났는데 로그인 안 됨이면 "아직 연결 안 됨" + "허브는 그대로 열립니다. 나중에 허브 화면의 [로그인] 버튼으로 다시 할 수 있어요."
   - **시간 제한 5분**(제안값). 넘으면 프로세스를 끝내고 같은 "아직 연결 안 됨" 문구를 보인다. 두 CLI 모두 스스로 끝나는 시간 제한을 찾지 못했으므로 꼭 필요하다. 끝내지 않으면 codex는 1455번 포트를 쥔 채 남아, 다음 로그인이 포트 충돌로 실패할 수 있다.
5. **실패 원인별 한 줄**(wiki-ux 문구표에 넘길 원인 목록):
   - 시간 초과·브라우저를 닫음 → "로그인을 마치지 않았어요"
   - claude 로그에 `paste the code` 가 있음 → "이 PC에서는 자동 연결이 안 돼요. 허브 화면의 [로그인]으로 다시 해 주세요"
   - codex 로그에 `Login server error` 또는 포트 관련 오류 → "이전 로그인 창이 남아 있어요. 검은 창을 모두 닫고 다시 실행해 주세요"
   - 그 밖의 `Login failed` / `Error logging in` → "로그인에 실패했어요" + 로그 위치

허브 화면의 [로그인] 버튼(`server/cliBridge.ts` `openLoginTerminal`)에 대한 같은 방향의 권고(P1-4):

- 지금은 Windows가 `cmd /k`, Mac이 Terminal `do script` 로 창을 띄운다. 로그인이 끝나도 창이 남고 영어 출력이 보인다.
- 위 3·4와 같이 **로컬 서버가 창 없이 직접 실행하고**, 화면은 `/api/engines` 를 몇 초마다 확인해 결과를 보이면 된다. 붙여넣기가 필요한 드문 경우만 지금처럼 터미널 창으로 보낸다. 다만 claude의 붙여넣기 경로는 화면이 연결된 터미널일 때만 켜지므로, 창 없이 실행하면 그 경우는 실패로 끝난다. 이것도 "아직 연결 안 됨"으로 안내한다.

## 5. 계정 종류와 CLI의 대응 (P1-6 · 열린 질문 10)

| 계정 질문 보기 | 로그인할 CLI | 근거 | 확인 필요 |
| --- | --- | --- | --- |
| Claude 유료 구독(Pro·Max 등) | claude, `--claudeai` | `--help`: "Use Claude subscription (default)". 실행 파일 안 문구가 Pro·Max·Team 요금제를 구독 로그인 대상으로 든다 | 무료 요금제로 로그인했을 때 `claude -p` 가 실제로 답하는지 |
| ChatGPT 유료 구독(Plus·Pro 등) | codex, 옵션 없음 | 실행 파일 안 문구: "Usage included with Plus, Pro, Business, and Enterprise plans" | 무료·저가 요금제의 사용 가능 여부 |

상품 이름으로 묻는 안(PM 의견)은 위 근거와 맞다. 문구는 "Claude 유료 구독(Pro·Max 등)", "ChatGPT 유료 구독(Plus·Pro 등)"을 권한다. 회사 단체 요금제(Team·Business·Enterprise)는 "등"에 포함한다.

---

## 6. 열린 질문 9 — CLI가 연결되지 않은 로컬 허브의 답변 엔진

### 지금 엔진 선택이 어떻게 되는가

- 화면(`src/store/AppStore.tsx`)은 `/api/engines` 가 `installed && loggedIn` 이라고 알려 준 엔진만 쓴다. 순서는 사용자가 고른 엔진 → `ENGINE_PRIORITY`(`claude → codex → gemini`, `src/lib/assistant.ts`)다. 하나도 없거나 모두 실패하면 `askAssistant` 가 규칙 기반 `answer()` 로 답한다(`RULE_BASED_LABEL` "규칙 기반 (문서 기준)").
- 로컬 허브의 `/api/engines`(`server/cliBridge.ts`)는 claude·codex 상태에 더해, `.env.local` 에서 읽은 Gemini 키(`server/env.ts` `readGeminiKey`, 이름 `GEMINI_API_KEY` 또는 `Gemini_API`)가 있을 때만 `gemini: loggedIn true` 를 준다. 로컬 `/api/ask` 의 `engine: 'gemini'` 는 **이 PC의 키로 Gemini를 직접 부른다**(`server/gemini.ts` `askGemini`).
- 배포 허브의 `api/ask.ts` 는 배포 환경 변수의 키로 Gemini를 부른다. 앞단 검사는 두 가지다. ① `Origin` 헤더가 **있으면** 같은 호스트여야 한다. ② `requireUser`: 계정 기능이 켜져 있으면 `hub_session` 쿠키(HttpOnly·Secure·SameSite=Lax)가 있어야 한다.
- 그래서 초보자의 로컬 허브(키 없음)에서 CLI 로그인이 실패하면 **규칙 기반만 남는다.** 같은 질문이라도 배포 허브보다 답이 나쁘다.

### 선택지

| 안 | 내용 | 초보자 경험 | 필요한 일 | 보안·운영 영향 |
| --- | --- | --- | --- | --- |
| A. 규칙 기반 + 연결 안내 (P1-8 대안) | 지금 동작을 유지하고 화면에 "지금은 내 계정이 연결되지 않아 간단한 답만 드려요. 연결하려면 [로그인]"을 크게 보인다 | 답 품질이 배포 허브보다 낮다. 다만 무엇을 하면 나아지는지는 보인다 | 화면 문구만(dev-front·wiki-ux) | 새 위험 없음 |
| B1. 배포 허브 경유 — 사용자별 토큰 | 로컬 서버가 배포 허브 `/api/ask` 로 **서버 대 서버** 중계한다. 배포 허브는 ZIP을 내려받은 사용자에게 수명이 짧은 "로컬 허브 토큰"을 발급해 ZIP 설정 파일에 넣는다. `/api/ask` 는 쿠키 외에 이 토큰도 받는다 | 배포 허브와 같은 답을 받는다. 초보자는 아무것도 하지 않는다 | dev-server: 토큰 발급·검증·만료·폐기, `/api/ask` 인증 확장, 로컬 `/api/engines` 의 gemini 행 의미 변경. dev-front: "공용 AI 엔진" 표기 | 토큰이 새면 그 사용자 권한으로 공용 키 사용량을 쓸 수 있다. 만료·폐기·사용자별 사용량 기록이 필요하다. 질문과 대화 이력이 배포 허브를 거쳐 Gemini로 간다(배포 허브를 쓸 때와 같은 범위) |
| B2. 배포 허브 경유 — 로컬 화면에서 허브 계정 로그인 | 로컬 화면에서 배포 허브 아이디·비밀번호를 받고, 로컬 서버가 배포 `/api/auth` 로 중계해 세션 쿠키를 서버에 보관한 뒤 `/api/ask` 를 부른다 | 로그인 한 번이 더 생긴다 | dev-server: 중계·세션 보관. 기존 계약을 그대로 쓴다 | 비밀번호가 로컬 서버를 지난다. 세션 12시간 만료마다 다시 로그인해야 한다 |
| B3. 브라우저에서 배포 허브 직접 호출 | 로컬 화면이 배포 허브 `/api/ask` 를 바로 부른다 | 해당 없음 | `Origin` 검사·CORS 허용을 풀어야 한다 | **권하지 않는다.** 같은 출처 제한을 풀게 되고, SameSite=Lax 쿠키는 다른 사이트에서 보내는 요청에 실리지 않아 계정 기능이 켜진 배포에서는 어차피 통과하지 못한다 |
| C. Gemini 키를 로컬에 배포 | ZIP이나 `.env.local` 에 공용 키를 넣어 준다 | 바로 좋아진다 | 키 주입 | **보안 위험 — 하지 않는다.** 키가 실무자 PC마다 평문 파일로 남는다. 한 번 나가면 회수할 수 없고(다시 발급해 모두에게 다시 배포해야 함), 퇴사자·분실 PC·ZIP 전달로 새어 나간다. 누가 쓰는지 구분되지 않아 사용량 남용을 막을 수 없다 |
| D. 사용자 본인 키 (지금의 고급 설정) | 실무자가 자기 Gemini 키를 `.env.local` 에 넣는다 | 초보자는 못 한다 | 이미 있다. P1-4대로 "고급 설정"으로 접는다 | 개인 키는 본인 책임. 공용 키 위험은 없다 |

### 방침 (한 줄)

**지금은 A로 간다. 초보자 원칙에 맞는 목표는 B1이지만 사용자별 토큰 계약이 생긴 뒤에만 켠다. C(공용 Gemini 키 로컬 배포)는 하지 않는다.**

이유:

- 상위 원칙("알아서")에 가장 맞는 것은 B1이다. 그러나 지금 배포 `/api/ask` 는 쿠키 인증만 받으므로 로컬 서버가 부를 방법이 없다. 새 인증 계약 없이 열 수 있는 길은 B3나 C뿐인데, 둘 다 위험하다.
- 대화 규약 쪽에서는 B1과 A 모두 일관성이 지켜진다. B1은 배포 허브와 같은 `server/assistant-prompt.md`·같은 문서 묶음으로 답한다. A는 규칙 기반이 상품 유형 필터(`SCOPE_ONLY_TERMS`)와 빈칸 표시 줄 제외(`GAP_MARKERS`)를 이미 거친다. 엔진이 바뀌어도 근거 규칙과 상품 유형 분리가 깨지지 않는다.
- B1에서 남는 대화 쪽 영향: 배포 번들의 문서는 배포 시점의 기본 브랜치다. 로컬 문서는 ZIP을 받은 시점의 기본 브랜치다. 시점이 다르면 출처 링크의 본문이 로컬 화면과 조금 다를 수 있다. 출처 경로는 같은 저장소라 깨지지 않는다.

### 따로 확인이 필요한 점

`api/ask.ts` 의 출처 검사는 `Origin` 헤더가 **있을 때만** 작동한다(`if (origin && …)`). 그래서 서버나 스크립트에서 보내는 요청은 이 검사를 지나간다. 계정 기능이 켜진 배포에서는 `requireUser` 가 막는다. 하지만 계정 기능이 꺼진 배포(데모 모드)에서는 **누구나 서버 대 서버로 공용 Gemini 키를 쓸 수 있다.** 지금 운영 배포가 계정 기능을 켜 두었는지 ops·dev-server가 확인해야 한다. 이 조사에서는 바꾸지 않았다.

---

## 결론 표

| 항목 | 현재 | 제안 | 영향 | 의견 |
| --- | --- | --- | --- | --- |
| 열린 질문 8: 로그인이 터미널 선택을 요구하나 | 확인 안 됨("CLI 버전마다 다르다") | 두 CLI 모두 로그인 명령에서 테마·약관·방식 선택이 없다. claude는 `--claudeai` 로 구독 경로를 고정한다. 선택은 브라우저 안에서만 한다 | 스크립트에 CLI별 선택 화면 안내가 필요 없다 | "옵션 자동 지정" 안으로 닫는다 |
| P0-4 호출 방식 | `claude auth login` / `codex login` 을 창에서 그대로 실행한다. 결과 확인 없음 | 출력은 로그로 보내고, 주소를 다시 열고, 3초마다 상태 확인, 5분 제한, 끝나면 "연결됨/아직 연결 안 됨" | AC-3·AC-5 충족. 포트가 남아 생기는 재로그인 실패를 막는다 | dev-server 구현. 시간 제한 값은 ops 실기기에서 조정 |
| Mac codex 로그인 판정 | `start-hub.command` 대소문자 구분 비교 → 로그인돼 있어도 false | 대소문자 무시 비교 또는 종료 코드 판정 | Mac에서 codex 로그인을 매번 다시 묻는 문제가 사라진다 | 버그. dev-server가 P0-4와 함께 고친다 |
| Windows·서버 판정 | `setup.ps1`·`cliBridge.ts` 판정 | 유지 | 없음 | 맞다. PS 5.1 실기기 확인만 남음 |
| 허브 [로그인] 버튼 | `cmd /k`·Terminal 창을 띄우고 창이 남는다 | 로컬 서버가 창 없이 실행하고 화면이 상태를 확인한다. 붙여넣기 경우만 실패로 안내한다 | P1-4 충족 | dev-server(API)·dev-front |
| 계정 질문 문구 (질문 10) | "Claude Code·Codex 계정" | "Claude 유료 구독(Pro·Max 등)" / "ChatGPT 유료 구독(Plus·Pro 등)" | 초보자가 자기 구독으로 알아본다 | 실행 파일 문구와 맞다. 무료 요금제 동작은 확인 필요 |
| 열린 질문 9: CLI 미연결 시 엔진 | 키 없는 로컬은 규칙 기반 | 지금은 A(규칙 기반 + 큰 연결 안내). 목표는 B1(사용자별 토큰으로 배포 허브 경유) | A는 문구만. B1은 새 인증 계약이 필요하다 | B1을 상위 지시자 결정 사항으로 올린다 |
| Gemini 키 로컬 배포 | 하지 않음 | **하지 않는다(보안 위험)** | 키 회수 불가, 사용량 남용 | 금지 |
| 배포 `/api/ask` 출처 검사 | `Origin` 없는 요청은 통과 | 계정 기능 켜짐 여부 확인 | 꺼져 있으면 공용 키가 사실상 열려 있다 | ops·dev-server 확인 |

## 확인하지 못한 것

- 실제 로그인 완료 후의 출력과 종료 코드. 성공 문구는 실행 파일 문자열로만 확인했다. 특히 `codex login status` 가 로그인됐을 때 0으로 끝나는지와 출력 위치.
- 빈 환경에서의 `claude auth status` 미로그인 JSON. 조사 환경이 자격 증명을 넣어 줘서 코드로만 확인했다.
- Windows·macOS에서 브라우저가 실제로 열리는지, Windows PowerShell 5.1에서 `codex login status 2>&1` 판정, 회사망에서 localhost 콜백(claude)·1455번 포트(codex)가 막히는지.
- 브라우저 안의 화면 구성(계정·조직 선택, 승인 화면)과 무료 요금제 계정의 CLI 사용 가능 여부.
- `codex login --device-auth` 동작(이 환경에서 네트워크 오류).
- 운영 배포의 계정 기능 켜짐 여부.
