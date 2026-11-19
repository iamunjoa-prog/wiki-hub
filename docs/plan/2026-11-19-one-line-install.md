# Mac 한 줄 설치 명령 (A안) — 보안 경고 없이 로컬 허브 받기

작성: plan-pm · 2026-11-19 · 브랜치 `claude/lucid-feynman-aqtmcx`

## 문제

**누가**: 내 Claude·ChatGPT 계정으로 챗봇을 쓰려고 로컬 허브를 처음 받는 Mac 사용자(편성·마케팅 실무자).

**어떤 상황에서 무엇을 못 하나**

1. **첫 실행에서 막힌다.** 브라우저로 받은 `wiki-hub.zip` 에는 macOS가 격리 표시(quarantine)를 붙인다. 그래서 `start-hub-mac.command` 를 처음 열면 "열지 않음" 창이 뜬다. [완료]를 누르면 아무 일도 일어나지 않는다. 시스템 설정 > 개인정보 보호 및 보안 > [그래도 열기]를 찾아야 하는데, 실무자는 오늘 실기기에서 여기서 멈췄다. 담당자가 터미널에서 격리 표시를 지운 뒤에야 켜졌다.
2. **매번 다른 폴더가 열린다.** 받을 때마다 다운로드 폴더에 `wiki-hub`, `wiki-hub (1)`~`(5)` 가 쌓인다. 그중 어느 실행기를 누르느냐에 따라 다른 폴더가 켜진다. 11/12 이전에 받은 폴더의 실행기는 자동 업데이트가 없다. 그래서 그 폴더로 켜면 옛 화면(옛 예시 질문)이 계속 뜬다.
3. **바탕화면 아이콘이 옛 폴더에 묶여 있다.** 아이콘 검사는 "아이콘이 있는가"만 본다. 옛 폴더를 가리키는 아이콘이 이미 있으면 새 폴더로 바꾸지 않는다.

**바뀌지 않는 사실(해결의 근거)**: curl로 받은 파일과 `curl … | bash` 로 실행한 스크립트에는 격리 표시가 붙지 않는다. 그래서 Gatekeeper가 막지 않는다. 실행기의 자동 업데이트(`update_hub`, `scripts/update-hub.ps1`)가 이미 이 방식으로 파일을 받고 있다.

## 현재 상태 (확인한 파일 경로 포함)

| 영역 | 파일 | 지금 동작 |
| --- | --- | --- |
| ZIP 만들기 | `server/hubZip.ts` | 서버 토큰으로 기본 브랜치 zipball을 받는다. 그것을 루트 실행기 2개 + `읽어주세요.txt` + `hub/`(앱 전체) 구성으로 다시 묶는다. `hub/.hub-version`(`{version: 커밋 7자리, repo}`)과, 계정을 고른 경우 `hub/hub-setup.json`(`{accounts:[…]}`)을 넣는다. `.command`·`.sh` 는 실행 권한 755로 넣는다 |
| ZIP 루트 파일 | `server/hubZipRoot.ts` | 얇은 루트 실행기 `start-hub-mac.command` 는 `HUB_LAUNCHER=<자기 경로>` 를 붙여 `hub/start-hub.command` 를 부른다. 안내문 Mac 절은 우클릭 → 열기 / 시스템 설정 [그래도 열기] 경로를 안내한다 |
| 배포 함수 | `api/download-hub.ts` | `guardApi(paid, RATE_DOWNLOAD)` 로 로그인한 담당자에게만 ZIP을 준다. `?account=claude|codex|both` 를 받는다. **브라우저 세션이 없는 한 줄 명령은 이 함수를 부를 수 없다** |
| 저장소 이름 | `server/env.ts` `readGithubRepo` | 환경변수 `GITHUB_REPO`, 없으면 기본값(공개 저장소)을 쓴다. 프론트에는 이 값이 없다 |
| 압축 제외 | `.gitattributes` | `docs/plan`·`screenshots` 등은 `export-ignore` 로 빠진다(codeload 압축에도 적용된다). `*.sh` 줄바꿈 규칙은 없다(`*.command`·`*.bat` 만 있다) |
| 정적 파일 | (없음) | `public/` 폴더가 없다. `vercel.json` 은 `/api/` 밖의 모든 경로를 `index.html` 로 돌린다 |
| Mac 실행기 | `start-hub.command` | `HUB_HOME=~/.wiki-hub`(node·CLI 자리), 기록은 `~/wiki-hub-기록/설치기록.txt`. `icon_ready()`(209행)는 `[ -e "$SHORTCUT" ]` 만 본다. `make_icon()`(307행)은 `HUB_LAUNCHER`(없으면 `$ROOT/start-hub.command`)로 심볼릭 링크를 만든다. `update_hub()`(377행)는 `github.com/<repo>.git/info/refs` 로 최신 커밋을 보고 `codeload.github.com/<repo>/zip/<sha>` 를 받는다. 백업·잠금·임시 폴더를 **`$ROOT` 의 상위 폴더**에 둔다(`.hub-backup`, `.hub-update.lock`, `.hub-update`). `ask_accounts()`(160행)와 `pause_exit()`(63행)는 표준 입력에서 `read` 한다 |
| 루트 다시 쓰기 | `scripts/hub-root.mjs` | 업데이트로 버전이 바뀌면 루트 실행기·안내문을 다시 쓴다. 상위 폴더에 루트 파일이 하나도 없으면 "ZIP 구성이 아님"으로 보고 건너뛴다 |
| Windows 실행기 | `start-hub.bat` → `scripts/setup.ps1` | `Test-IconReady`(151행)는 바로가기 `.lnk` 가 있고 그 TargetPath가 존재하면 true다. **다른 폴더를 가리켜도 true다.** 아이콘을 만드는 곳은 476행이고 `HUB_LAUNCHER` 를 우선 쓴다 |
| Windows 업데이트 | `scripts/update-hub.ps1` | `HttpWebRequest`·codeload로 받는다. Mac과 같은 흐름이다 |
| 내려받기 화면 | `src/components/LocalHubGuide.tsx` | 계정을 고르면 [내 PC용 허브 내려받기] 버튼이 켜진다. 그 아래에 OS별 3단계 안내가 있다(Mac: 더블클릭 → 우클릭 열기 → 로그인). "자세히 보기"에 시스템 설정 경로가 있다 |
| 화면 공용 로직 | `src/lib/localHub.ts` | `useHubDownload` 가 `/api/download-hub?account=` 를 fetch해 Blob으로 저장하고 토스트를 띄운다. `detectOs()` 는 Mac이 아니면 Windows를 기본으로 본다 |
| 화면을 쓰는 곳 | `src/components/LocalHubOnboarding.tsx`, `src/components/CliStatus.tsx` | 첫 안내 창과 설정 창(배포 허브에서만, `!isLocal`)이 `LocalHubGuide` 를 같이 쓴다. 첫 안내 창은 `onDownloaded` 로 아래 안내 문구를 "받은 파일로…"로 바꾼다. 계정 `unknown` 이면 안내를 보이지 않는다 |
| 스타일 | `src/styles.css` | `.cli-dl`·`.cli-steps`·`.cli-fold` |
| 문구 기준 | `docs/ux/2026-11-12-local-hub-beginner-copy.md` | 0-1절에 **"터미널에서 ~하세요"(명령 지시) 금지** 규칙이 있다. 이번 A안과 정면으로 충돌하므로 wiki-ux가 개정해야 한다. 3-3절은 Mac 단계 문구(G-2x)다 |

## 결정한 것 (PM 데스크 방향 검토 결과)

### D1. 스크립트는 raw.githubusercontent.com 에서 받는다

| 기준 | raw.githubusercontent.com | 배포 허브 정적 경로 |
| --- | --- | --- |
| 로그인 필요 | 없음 (공개 저장소) | 없음 (정적 파일). 다만 지금 `public/` 이 없어 새로 만들어야 한다 |
| 실행기가 받는 코드와 같은 출처인가 | 같다. 스크립트·codeload 압축·자동 업데이트가 모두 기본 브랜치 한 곳에서 나온다 | 다르다. 배포 시점과 기본 브랜치가 어긋나면 옛 스크립트로 새 코드를 받을 수 있다 |
| 저장소 이름 | 명령에 들어간다 | 스크립트 안에 따로 박아야 한다(어차피 codeload는 저장소 이름이 필요하다) |
| 회사망 | 실행기 업데이트가 이미 `github.com`·`codeload.github.com` 을 쓴다. `raw.githubusercontent.com` 이 막혔는지는 **미확인**(열린 질문 Q3) | 배포 도메인은 열려 있다 |

→ **raw를 쓴다.** 경로는 `https://raw.githubusercontent.com/<저장소>/HEAD/scripts/install-hub.sh` 로 한다. `HEAD` 가 기본 브랜치로 풀리는지는 수용 기준 S-1에서 확인하고, 안 되면 기본 브랜치 이름으로 고정한다. 회사망에서 raw가 막혔다면(Q3) 배포 정적 경로를 대체 경로로 추가하는 일을 2단계로 둔다.

**한 줄 명령 모양**(계정 값만 다르다):

```
curl -fsSL https://raw.githubusercontent.com/<저장소>/HEAD/scripts/install-hub.sh | bash -s -- claude
```

신뢰 범위는 지금의 자동 업데이트와 같다. 기본 브랜치에 머지된 코드가 실무자 Mac에서 돈다는 점은 이미 그렇다. 새로 늘어나는 위험은 없다.

### D2. 설치 위치는 `~/wiki-hub/hub/` 하나로 고정한다. 루트 실행기·안내문은 만들지 않는다

- `~/wiki-hub/hub/` 에 codeload 압축의 내용을 푼다. `.hub-version` 과 `hub-setup.json` 도 함께 넣는다(`hubZip.ts` 의 `hub/` 와 같은 구성).
- **`hub/` 한 겹을 꼭 둔다.** `update_hub` 가 백업·잠금을 `$ROOT` 의 상위에 두기 때문이다. `~/wiki-hub` 자체를 ROOT로 두면 홈 폴더에 `.hub-backup` 이 생긴다.
- **루트 실행기(`start-hub-mac.command`)·`읽어주세요.txt` 는 만들지 않는다.** 루트 실행기는 ZIP을 연 사람이 누를 파일이었다. 한 줄 설치에서는 터미널이 바로 켜고, 다음부터는 바탕화면 아이콘이 입구다. 만들지 않으면 `hubZipRoot.ts` 내용을 스크립트에 복사할 일이 없다. `hub-root.mjs` 도 지금 규칙("루트 파일이 없으면 건너뜀") 그대로 동작한다.
- 바탕화면 아이콘은 `~/wiki-hub/hub/start-hub.command` 를 가리킨다(`HUB_LAUNCHER` 를 넘기지 않는다 → `make_icon` 기본값).
- 홈 바로 아래라 다운로드·문서·데스크탑 폴더 접근 허용 창이 설치 폴더 때문에 뜨지는 않는다. 다만 아이콘을 만들 때 "터미널이 데스크탑 폴더에 접근" 허용 창은 뜰 수 있다(수용 기준 M-3에서 확인).

### D3. 이미 설치돼 있으면 덮지 않는다. 업데이트·실행으로 넘긴다

| `~/wiki-hub` 상태 | 설치 스크립트가 하는 일 |
| --- | --- |
| 없음 | 새로 설치한 뒤 실행기를 부른다 |
| `hub/.hub-version` 이 있다(이 스크립트나 같은 구성으로 설치됨) | 파일을 받지 않는다. 계정 인자가 있고 기존 `hub-setup.json` 과 다르면 그 파일만 고친다(Q2). 그다음 `hub/start-hub.command` 를 부른다. 새 버전이 있으면 실행기의 `update_hub` 가 바꾼다. 이미 켜져 있으면 브라우저만 열린다(기존 동작) |
| `hub/.git` 이 있다(개발 PC) | 아무것도 바꾸지 않고 실행기만 부른다 |
| 그 밖의 폴더·파일(예: 개발자가 clone한 저장소) | **건드리지 않는다.** "홈 폴더에 이미 다른 wiki-hub 폴더가 있어요" + 지금 할 일 한 줄 + 기록 위치를 보여 주고 끝낸다 |
| 지난번 설치가 중간에 끊긴 흔적(`~/wiki-hub.partial` 등) | 지우고 처음부터 설치한다 |

### D4. 설치 스크립트가 지킬 규칙

- macOS 기본 `/bin/bash` 3.2에서 돌아야 한다(`start-hub.command` 와 같은 제약).
- **본문 전체를 함수로 감싸고 마지막 줄에서 부른다.** 내려받기가 중간에 끊기면 반쪽 스크립트가 실행되는데, 이렇게 하면 그걸 막는다.
- `curl | bash` 는 표준 입력이 스크립트 자체다. 그래서 실행기를 부를 때 **`</dev/tty` 로 키보드를 이어 준다.** 그래야 계정 질문(`ask_accounts`)과 "아무 키나"(`pause_exit`)가 키보드를 읽고, 스크립트 본문을 먹지 않는다.
- 최신 커밋은 `info/refs` 로 받는다. 파일은 `codeload/zip/<sha>` 로 받아 임시 폴더에 푼다. 구성을 검사한 뒤(`package.json`·`start-hub.command`·`scripts/setup.ps1`) `~/wiki-hub/hub` 로 옮긴다. `update_hub` 의 검사와 같다.
- 계정 인자는 `claude|codex|both` 만 받는다. 없거나 다른 값이면 `hub-setup.json` 을 넣지 않는다. 그러면 실행기가 번호로 한 번 묻는다(기존 규칙).
- 창에는 한국어 진행 줄만 낸다. curl·ditto 출력은 `~/wiki-hub-기록/설치기록.txt` 에만 남긴다. 실패하면 "지금 할 일" 한 줄과 기록 위치를 보여 주고 `open -R` 로 기록을 연다(copy 문서 4-4절 규칙).
- 관리자 암호(sudo)는 쓰지 않는다.
- 다운로드 폴더의 옛 `wiki-hub (n)` 폴더는 **지우지 않는다**(사용자 파일이라서). 찾으면 안내 한 줄을 낼지는 Q4에서 정한다.

### D5. 바탕화면 아이콘 다시 만들기 규칙 (Mac·Windows 공통)

"지금 실행기" = `HUB_LAUNCHER`, 없으면 `$ROOT` 의 실행기. "고정 설치" = `~/wiki-hub/hub` (Mac만 해당. Windows는 이번에 고정 설치가 없다).

| 아이콘 상태 | 판정 |
| --- | --- |
| 없음 / 가리키는 곳이 없음(깨짐) | 다시 만든다 (지금과 같다) |
| 지금 실행기를 가리킴 | 그대로 둔다 |
| 다른 폴더를 가리키는데, 지금 실행기가 고정 설치다 | 고정 설치로 다시 만든다 |
| 고정 설치를 가리키고 고정 설치가 살아 있는데, 지금 실행기는 다른 폴더(다운로드의 옛 폴더)다 | **그대로 둔다** (옛 폴더가 고정 설치를 빼앗지 않게) |
| 고정 설치가 아닌 다른 폴더를 가리키고, 지금 실행기도 고정 설치가 아니다 | 지금 실행기로 다시 만든다 (마지막에 켠 폴더가 이긴다) |
| 아이콘이 링크·바로가기가 아닌 일반 파일이다 | 건드리지 않는다 (사용자가 만든 것) |

Windows `Test-IconReady` 는 고정 설치가 없으므로 "지금 실행기와 같은가"만 추가로 본다.

### D6. Windows `irm … | iex` 는 2단계로 미룬다

- **기술적으로는 같은 효과가 있다.** Mark-of-the-Web(Zone.Identifier)은 브라우저·첨부 처리기가 붙인다. `Invoke-RestMethod`·`Invoke-WebRequest`·`HttpWebRequest` 로 받은 파일에는 붙지 않는다. 그래서 SmartScreen 파란 창도 뜨지 않는다. `iex` 는 문자열을 실행하므로 실행 정책에도 걸리지 않는다.
- **이번에 미루는 이유**
  1. Windows는 [추가 정보 → 실행]이라는 화면 안의 통과 경로가 있다. Mac처럼 막다른 길이 아니다.
  2. `irm | iex` 형태는 회사 보안 프로그램(EDR·AMSI)이 악성 패턴으로 잡을 수 있다. 실무자 PC에서 확인하지 않았다(Q5).
  3. 이번 실기기 확인은 Mac만 준비돼 있다.
  4. Windows에는 고정 설치 위치를 정한 적이 없다(`%LOCALAPPDATA%` 아래로 할지 등).
- **이번에 Windows에서 하는 것**: D5 아이콘 규칙만 `scripts/setup.ps1` 에 넣는다. 화면에서 Windows 안내는 지금처럼 ZIP이다.

## 이번 범위 / 범위 밖

### 이번 범위

1. 새 파일 `scripts/install-hub.sh`: D2·D3·D4대로 설치한다.
2. `start-hub.command`
   - D5 아이콘 규칙(`icon_ready`·`make_icon`)
   - `curl | bash` 로 불렸을 때 키보드 입력이 되도록 확인·보정
   - 설치 스크립트가 부를 때 첫 줄 문구가 어색하지 않은지 확인
3. `scripts/setup.ps1`: D5 아이콘 규칙(`Test-IconReady`·476행 근처)
4. `.gitattributes`: `*.sh text eol=lf`
5. 내려받기 화면(Mac 보기)
   - 계정 선택이 반영된 한 줄 명령, [복사] 버튼, "터미널 여는 법" 3단계
   - ZIP 받기는 "명령어 대신 파일로 받기" 같은 대안으로 남긴다
   - 명령을 복사해도 첫 안내 창의 `onDownloaded` 가 불려 아래 문구가 바뀐다
6. 문구 기준 개정: copy 문서 0-1절의 "터미널 명령 지시 금지"에 이 화면을 예외로 둔다. 3-3절에 한 줄 설치 단계 문구를 추가한다.
7. 실기기 Mac 확인(아래 M-항목), Windows 아이콘 규칙 확인 1회.

### 범위 밖

| 항목 | 이유 |
| --- | --- |
| Windows 한 줄 설치(`irm \| iex`) | D6. 보안 프로그램 반응을 확인하지 않았고, Windows 실기기 확인 일정도 없다. 2단계로 둔다 |
| 다운로드 폴더의 옛 `wiki-hub (n)` 자동 삭제 | 사용자 파일이다. 지울지는 사용자가 정한다(안내만 Q4) |
| 11/12 이전 옛 실행기 고치기 | 이미 실무자 PC에 있는 파일이라 바꿀 길이 없다. 아이콘이 고정 설치로 바뀌면 그 실행기를 누를 일이 줄어든다 |
| 코드 서명·공증(notarization) | Apple 개발자 계정과 인증서가 필요하다. 별도 결정이 필요하다 |
| ZIP 흐름 변경(`server/hubZip.ts`·`server/hubZipRoot.ts`·`api/download-hub.ts`) | 한 줄 설치는 ZIP을 쓰지 않는다. ZIP은 대안으로 그대로 둔다. `server/knowledge.ts` 와도 관계없다 |
| `읽어주세요.txt` 에 한 줄 설치 안내 추가 | ZIP을 이미 받은 사람이 보는 글이라 효과가 적다. 필요하면 Q6 |
| 배포 정적 경로(`public/install-hub.sh`) | D1. raw가 회사망에서 막힌 것으로 확인될 때만 2단계로 한다 |
| 로컬 허브 화면(`isLocal`)의 안내 | 로컬 허브에서는 내려받기 안내가 보이지 않는다(`CliStatus.tsx`). 바꿀 것이 없다 |

## 수용 기준

### 스크립트·저장소 (dev-server가 PR에서 확인)

- **S-1** 기본 브랜치에 머지된 뒤, `curl -fsSL https://raw.githubusercontent.com/<저장소>/HEAD/scripts/install-hub.sh` 가 HTTP 200으로 스크립트 본문을 돌려준다. 안 되면 경로를 기본 브랜치 이름으로 고친다.
- **S-2** `bash -n scripts/install-hub.sh` 가 통과한다. bash 3.2에서 쓸 수 없는 문법(연관 배열, `${var,,}`, `mapfile`)이 없다.
- **S-3** 스크립트 마지막 실행 줄은 본문 함수 호출 한 줄이다. 그 위에서 끊긴 파일을 실행하면 아무 동작도 하지 않는다.
- **S-4** 계정 인자가 `claude`·`codex`·`both` 일 때 `hub/hub-setup.json` 이 각각 `{"accounts":["claude"]}`·`{"accounts":["codex"]}`·`{"accounts":["claude","codex"]}` 다. 이는 `parseHubAccount` 결과와 같다. 인자가 없거나 다른 값이면 파일이 없다.
- **S-5** `hub/.hub-version` 은 `{"version":"<커밋 7자리>","repo":"<저장소>"}` 형식이고, 받은 커밋과 같다.
- **S-6** `~/wiki-hub` 가 D3 표의 "그 밖의 폴더"일 때, 스크립트 실행 전후로 그 폴더의 파일 목록과 수정 시각이 같다.
- **S-7** `.gitattributes` 에 `*.sh text eol=lf` 가 있다. codeload 압축 안의 `scripts/install-hub.sh` 에 CR이 없다.
- **S-8** `npm run build` 가 통과한다. 새·바뀐 파일 어디에도 제휴사 실명·매출 금액이 없다.

### 실기기 Mac (ops가 macOS 15 한 대에서 확인. 14가 있으면 14도)

- **M-1** 허브를 설치한 적 없는 Mac에서 내려받기 화면의 명령을 복사해 터미널에 붙여 넣고 Enter를 누른다. 허브가 `http://localhost:5173` 으로 열릴 때까지 "열지 않음"·"확인되지 않은 개발자" 창이 한 번도 뜨지 않는다.
- **M-2** `xattr -r ~/wiki-hub | grep com.apple.quarantine` 출력이 비어 있다.
- **M-3** 바탕화면 "플랫폼 담당 지식 허브" 가 `~/wiki-hub/hub/start-hub.command` 를 가리킨다(`readlink`). 터미널을 모두 닫고 아이콘을 더블클릭하면 경고 창 없이 켜진다. 데스크탑 폴더 접근 허용 창이 떴다면, 그 창이 떴다는 사실과 [허용] 뒤 동작을 기록한다.
- **M-4** 터미널 창에 영어 줄(curl 진행률, ditto, npm 출력)이 보이지 않는다. 한국어 진행 줄만 보인다.
- **M-5** 허브가 켜진 상태에서 같은 명령을 다시 붙여 넣는다. 새 폴더가 생기지 않고(`ls ~ | grep wiki-hub` 가 `wiki-hub`·`wiki-hub-기록` 만 보인다), 브라우저만 열린다.
- **M-6** `claude` 로 설치한 뒤 `both` 명령을 붙여 넣으면 `hub-setup.json` 이 둘 다로 바뀌고, ChatGPT 연결 프로그램 설치·로그인 단계가 진행된다.
- **M-7** 오늘 상황을 재현한다. 바탕화면 아이콘이 `~/Downloads/wiki-hub (3)/start-hub-mac.command` 를 가리킬 때 명령을 붙여 넣으면, 끝난 뒤 아이콘이 `~/wiki-hub/hub/start-hub.command` 를 가리킨다.
- **M-8** M-7 뒤에 다운로드 폴더의 11/12 이후 폴더 실행기를 직접 연다. 끝난 뒤에도 아이콘은 여전히 `~/wiki-hub/hub/start-hub.command` 를 가리킨다.
- **M-9** 고정 설치가 없는 Mac에서 아이콘이 지운 폴더를 가리키면, 지금 연 폴더로 다시 만들어진다(기존 동작이 유지된다).
- **M-10** 계정을 "잘 모르겠어요"로 받은 명령(인자 없음)으로 설치하면, 계정 번호 질문이 뜨고 키보드 숫자 입력이 먹는다. 질문이 스크립트 본문을 읽어 엉뚱하게 넘어가지 않는다.
- **M-11** Wi-Fi를 끄고 명령을 붙여 넣는다. 창에 "지금 할 일" 한 줄과 `내 홈 폴더 > wiki-hub-기록 > 설치기록.txt` 가 보이고, Finder가 그 파일을 보여 준다. `~/wiki-hub` 는 생기지 않거나 전과 같다. 다시 켠 뒤 명령을 붙여 넣으면 정상 설치된다.
- **M-12** 설치 도중(받기 단계) 터미널을 닫았다가 명령을 다시 붙여 넣으면 정상 설치된다.
- **M-13** 관리자 암호를 묻는 창이 한 번도 뜨지 않는다.

### 화면 (dev-front가 확인. Mac 브라우저 1회는 ops)

- **F-1** 배포 허브 첫 안내 창에서 Mac 보기로 계정 "Claude"를 고르면, 명령 끝이 `-- claude` 인 한 줄과 [복사] 버튼이 계정 선택 바로 아래에 보인다. "둘 다"면 `-- both`, "ChatGPT"면 `-- codex` 다. 노트북(1366×768) 화면에서 스크롤 없이 [복사]까지 보인다.
- **F-2** 계정 고르기 → [복사], 두 번 클릭으로 명령이 클립보드에 들어간다. 붙여 넣은 글자가 화면에 보이는 명령과 한 글자도 다르지 않다. 버튼은 "복사했어요"로 2초쯤 바뀐다.
- **F-3** 클립보드 권한이 없는 브라우저에서는 [복사]를 누르면 명령 칸 글자가 전체 선택되고 "command+C를 눌러 복사하세요" 안내가 보인다.
- **F-4** 터미널 여는 법이 단계로 보인다: command+스페이스 → "터미널" 입력 → return → command+V → return. "자세히 보기" 안에 "처음 5~10분, 창은 닫지 말고 노란 단추로 내려 두기"가 있다.
- **F-5** ZIP 받기는 Mac 보기에서 대안으로 한 번 클릭 안에 닿는다. 누르면 지금과 똑같이 `wiki-hub.zip` 을 받는다.
- **F-6** Windows 보기의 화면은 이번 변경 전과 같다(버튼·3단계·자세히 보기).
- **F-7** 첫 안내 창에서 [복사]를 누르면 아래 문구가 "받은 파일로…" 계열(wiki-ux가 정한 복사용 문구)로 바뀌고, 첫 안내 창이 다시 자동으로 뜨지 않는다(`onDownloaded` 호출).
- **F-8** 설정 창(`CliStatus.tsx`, 배포 허브)에서도 F-1~F-6이 같다.
- **F-9** 화면 어디에도 제휴사 실명·금액이 없고, "캠페인"이라는 말이 새로 생기지 않는다.

### Windows (ops 1회)

- **W-1** 바탕화면 바로가기가 다운로드의 다른 폴더 `start-hub-windows.bat` 을 가리킬 때 지금 폴더 실행기로 켜면, 바로가기 대상이 지금 폴더 실행기로 바뀐다.
- **W-2** 바로가기가 이미 지금 실행기를 가리키면 "아이콘을 만들었어요" 줄이 나오지 않는다.

## 담당 분배

같은 파일을 두 담당이 건드리지 않게 파일 단위로 나눈다. **실행기 스크립트 담당은 dev-server**다(11/12 기획부터 `setup.ps1`·`start-hub.command` 를 dev-server가 맡아 왔다).

| 순서 | 담당 | 맡는 파일 (이 담당만 수정) | 할 일 | 선행 |
| --- | --- | --- | --- | --- |
| 1a | dev-server | `scripts/install-hub.sh`(새 파일), `start-hub.command`, `scripts/setup.ps1`, `.gitattributes` | D2~D5 구현, S-1~S-8 확인, PR | 없음 |
| 1b | wiki-ux | `docs/ux/2026-11-12-local-hub-beginner-copy.md` (또는 새 `docs/ux/2026-11-19-one-line-install-copy.md`) | 0-1절 예외 규정. 화면 문구(명령 위 한 줄, 터미널 여는 법, 복사 완료·실패, ZIP 대안 링크, 첫 안내 창 아래 문구). 설치 스크립트 창 문구(시작·받는 중·이미 설치됨·다른 폴더 있음·실패 "지금 할 일")와 줄 ID | 없음 (1a와 병렬 가능, 파일 겹침 없음) |
| 1a′ | dev-server | (1a와 같은 파일) | 1b의 창 문구를 스크립트에 반영 | 1b |
| 2 | PM 데스크 | 해당 없음 | 1a PR을 **기본 브랜치에 먼저 머지**한다. raw 경로는 기본 브랜치의 스크립트를 가리키므로, 화면이 먼저 나가면 명령이 404가 된다 | 1a, 1a′ |
| 3 | dev-front | `src/lib/localHub.ts`, `src/components/LocalHubGuide.tsx`, `src/styles.css` | `installCommand(account)`·저장소 상수(`readGithubRepo` 기본값과 같은 값, Q1), 복사 처리. Mac 보기 배치 변경. F-1~F-9 확인, PR. `LocalHubOnboarding.tsx`·`CliStatus.tsx` 는 기존 prop으로 충분하면 건드리지 않는다. 바꿔야 하면 PM 데스크에 먼저 알린다 | 1b(문구), 2(실제 명령이 동작해야 F-2 끝까지 검증 가능) |
| 4 | ops | 해당 없음 (확인만) | 실기기 Mac M-1~M-13, Windows W-1·W-2 확인. 결과를 PM 데스크에 표로 보고 | 2, 3 배포 |
| 5 | PM 데스크 | 해당 없음 | diff·빌드 결과를 확인하고 통합해 보고 | 4 |

- chatbot-planner·requests-planner: 이번에는 할 일이 없다.
- dev-server는 `server/`·`api/` 를 이번에 수정하지 않는다. 그러니 `server/knowledge.ts` 공유 규칙에 걸리는 변경도 없다.

## 열린 질문

| # | 질문 | 선택지 | PM 권고 |
| --- | --- | --- | --- |
| Q1 | 화면이 명령에 넣을 저장소 이름을 어디서 얻나 | (a) `src/lib/localHub.ts` 상수(`readGithubRepo` 기본값과 같게, 주석으로 묶음) (b) 빌드 때 환경변수 `VITE_HUB_REPO` 로 주입 (c) 서버 API로 받기 | (a). 배포가 기본값 외 저장소를 쓰는 일이 없다면 가장 단순하다. 배포에 `GITHUB_REPO` 를 다르게 설정해 쓰는지 확인 필요 |
| Q2 | 이미 설치된 PC에서 다른 계정 명령을 붙여 넣으면 | (a) `hub-setup.json` 을 새 값으로 바꾼다 (b) 기존 값을 지킨다 | (a). 바꿔도 연결 프로그램 설치·로그인이 늘 뿐이고 지워지는 것은 없다 |
| Q3 | 회사망에서 `raw.githubusercontent.com` 이 열려 있나 | 확인 결과에 따라 배포 정적 경로를 2단계로 추가 | ops가 사무실망에서 S-1 명령을 한 번 돌려 확인 |
| Q4 | 다운로드 폴더의 옛 `wiki-hub (n)` 폴더 | (a) 설치 스크립트가 찾으면 "옛 폴더는 휴지통에 버려도 돼요" 한 줄 (b) 화면 "자세히 보기"에만 적기 (c) 아무 안내 없음 | (a)+(b). 지우는 것은 사용자가 한다 |
| Q5 | Windows 한 줄 설치를 언제 하나 | 회사 PC 1대에서 `irm \| iex` 가 보안 프로그램에 잡히는지 먼저 확인하고 다음 계획으로 | 확인을 ops에 맡기고, 결과를 보고 다음 기획 문서로 |
| Q6 | ZIP 안 `읽어주세요.txt` Mac 절에 "한 줄 설치가 더 쉬워요" 안내를 넣을지 | 넣으면 `server/hubZipRoot.ts`(dev-server)와 copy 문서 5장이 바뀐다 | 이번엔 넣지 않는다. 필요하면 다음 차례로 |
| Q7 | 설치 위치 이름 | (a) `~/wiki-hub` (보이는 폴더) (b) `~/.wiki-hub/app` (숨김, 개발자 clone과 겹치지 않음) | (a). 보이는 폴더가 문의할 때 설명하기 쉽다. 개발자 clone과 겹치면 D3에서 멈추고 안내한다 |
| Q8 | Mac 보기에서 ZIP 버튼의 무게 | (a) 명령을 주, ZIP을 작은 링크로 (b) 둘을 같은 크기 탭으로 | (a). 오늘 막힌 곳이 ZIP 경로다. 최종 배치는 wiki-ux가 정한다 |

## PM 데스크 결정 (2026-11-19)

- Q1 (a) 상수 · Q2 (a) 새 값으로 바꿈 · Q4 (a)+(b) · Q6 이번엔 안 함 · Q7 (a) `~/wiki-hub` · Q8 (a) 명령이 주, ZIP은 작은 링크.
- Q3: 클라우드 환경에서 `raw.githubusercontent.com/<저장소>/HEAD/...` 가 200으로 응답함을 확인(S-1 통과). 사무실망 확인은 ops 실기기 단계에 남긴다.
- Q5: Windows 한 줄 설치는 2단계.
- 머지 순서: 스크립트와 화면을 한 PR로 묶는다. 머지되면 기본 브랜치와 배포에 함께 들어가므로 화면이 먼저 나가 404가 나는 일이 없다.
