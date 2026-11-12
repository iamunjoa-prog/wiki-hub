# 로컬 허브 내려받기 — 풀면 실행 파일만 보이게

상위 지시: 배포 허브 "챗봇 답변 엔진 설정" 안내대로 ZIP을 받아 풀었더니 파일 약 30개가 섞여 나오고, 가이드의 폴더가 보이지 않고, start-hub.bat이 목록 중간에 묻혀 있다. **방향 결정(상위 지시자)**: 풀면 실행 파일만 보이게 한다(서버 재포장, 아래 A안).

## 문제

**누가**: 편성·마케팅 실무자. 배포 허브에서 챗봇을 CLI로 답받으려고 처음 로컬 허브를 설치한다. Windows 탐색기 기본 설정(확장자 숨김)을 쓴다.

**기대**: 안내대로 풀면 더블클릭할 파일 하나가 눈에 띄고, Y를 누르면 브라우저가 열린다.

**어긋난 것**

| 기대 | 실제 | 원인 |
| --- | --- | --- |
| 풀면 실행 파일이 바로 보인다 | 한 목록에 약 30개(폴더 9 + 파일 19)가 보인다 | `server/hubZip.ts` 가 **기본 브랜치(main)** zipball을 그대로 중계한다. export-ignore PR이 main에 없어서 지금 main 기준 최상위가 28개(178개 파일, 약 3.1MB)다. 머지해도 최상위가 18개 남는다 |
| `start-hub.bat` 을 찾는다 | 확장자가 숨겨져 `start-hub` 가 두 개 보이고 목록 중간에 묻힌다 | 실행기가 `src`·`server`·tsconfig 같은 개발 파일과 같은 높이에 있다. 가이드는 탐색기에 보이는 "종류"를 알려 주지 않는다 |
| "이름이 긴 폴더"로 들어간다 | 그런 폴더가 화면에 없었다 | zipball은 전체를 `owner-repo-커밋번호/` 하나로 감싼다. 반디집·알집 "자동으로 풀기"처럼 단일 최상위 폴더를 벗기는 도구를 쓰거나 풀 위치를 바꾸면 이 단계가 사라진다. **풀기 도구에 따라 폴더 깊이가 달라진다** |

## 현재 상태 (확인한 파일 경로 포함)

- `src/components/CliStatus.tsx` 96~120행 `downloadHub`: `/api/download-hub` 응답을 fetch → Blob으로 **메모리에 전부 받아** `wiki-hub.zip` 으로 저장한다. 112행 토스트는 "허브 ZIP을 내려받았습니다 — 압축을 풀고 start-hub 실행기를 실행하세요"다. 247~265행이 안내 단계이고, 3단계가 "이름이 긴 폴더(`owner-repo-커밋번호`) 안의 {launcher} 더블클릭"이다.
- `server/hubZip.ts` `proxyHubZip`: zipball 본문 스트림을 그대로 넘긴다. 압축을 풀거나 다시 묶지 않는다.
- `api/download-hub.ts`(배포)와 `server/cliBridge.ts` 537~552행(로컬)이 모두 `proxyHubZip` 만 부른다. 로컬은 `Readable.fromWeb(upstream.body)` 로 파이프하므로 본문 종류와 상관없이 동작한다. **`server/hubZip.ts` 한 곳만 고치면 배포와 로컬에 같이 반영된다.**
- `vercel.json`: `api/download-hub.ts` 는 `maxDuration: 60`, `includeFiles` 없음.
- `.gitattributes`(이 브랜치, main 미머지): `.claude .github docs/plan docs/campaign-handoff-mapping.md screenshots vercel.json` 과 루트 제출·발표 자료를 export-ignore로 뺀다. 이 상태로 묶으면 140개 파일, 약 0.36MB다.
- `package.json`: zip 처리 의존성이 없다.
- **실행기 경로 가정**
  - `start-hub.bat`: `cd /d "%~dp0"`. 자기 위치를 루트로 삼고 `%~dp0scripts\setup.ps1` → `npm run dev -- --open` 을 실행한다.
  - `scripts/setup.ps1`: `$root = Split-Path -Parent $PSScriptRoot`(scripts의 부모). 4단계에서 바탕화면 `플랫폼 담당 지식 허브.lnk` 를 `TargetPath = $root\start-hub.bat`, `WorkingDirectory = $root` 로 만든다. **이미 있으면 건너뛴다.**
  - `start-hub.command`: 심볼릭 링크를 끝까지 따라가 진짜 위치로 `cd` 한다. 4단계에서 `~/Desktop/플랫폼 담당 지식 허브.command` 를 `$ROOT/start-hub.command` 의 심볼릭 링크로 만든다. 이것도 이미 있으면 건너뛴다. 저장소 모드는 `100755` 다.
  - `server/cliBridge.ts` 47~48행: `ROOT = resolve(__dirname, '..')`. 앱은 자기 폴더 기준으로만 동작한다.
- **판단**: 앱 전체를 하위 폴더로 옮겨도 실행·설치·서버 경로는 고칠 곳이 없다. 고칠 것은 **바탕화면 바로가기가 무엇을 가리키느냐** 하나다(아래 설계 3).

### 방향 비교 (요약)

| 항목 | 현재 | 제안 | 영향 | PM 의견 |
| --- | --- | --- | --- | --- |
| A. 서버 재포장 | zipball을 그대로 중계 | `server/hubZip.ts` 가 다시 묶어 루트에 실행기 2개 + 안내 txt + `hub/` 만 둔다 | 어떤 풀기 도구에서도 4개만 보인다. 공수는 dev-server 1일, dev-front 0.5일. 의존성이 하나 늘고 스트리밍 대신 버퍼링한다 | **채택(상위 지시자 결정)** |
| B. 저장소 구조 변경 | 앱이 루트 | 앱을 `app/` 으로 옮긴다 | zipball 감싸는 폴더가 그대로 남아 A가 또 필요하다. Vercel·에이전트 규약·진행 중인 PR과 충돌한다 | 하지 않음 |
| C. export-ignore + 문구만 | — | 문구에 분기 추가 | 18개 사이에서 찾아야 하는 것은 같다 | export-ignore 머지만 A의 선행 조건으로 한다 |

## 이번 범위 / 범위 밖

### 이번 범위

1. export-ignore PR을 main에 머지한다(선행).
2. `server/hubZip.ts` 재포장(설계 1·2·4).
3. 바로가기가 루트 실행기를 가리키도록 `scripts/setup.ps1`·`start-hub.command` 를 조금 고친다(설계 3).
4. `src/components/CliStatus.tsx` 안내 단계와 토스트 문구(설계 5).

### 설계

**1. 받은 ZIP의 구조**

```
wiki-hub.zip                최상위 항목 4개, 단일 최상위 폴더 없음
├─ start-hub.bat            얇은 실행기 (ASCII만, CRLF)
├─ start-hub.command        얇은 실행기 (ASCII만, LF, 0755)
├─ 읽어주세요.txt           안내 + 받은 날짜·버전 (UTF-8 BOM, CRLF)
└─ hub/                     zipball 내용 전체 (export-ignore 반영분, 상대 구조 그대로)
```

- **최상위 폴더를 두지 않는 이유**: 최상위 항목이 여러 개면 Windows "모두 압축 풀기"(기본 대상 `…\wiki-hub`), 반디집 자동 풀기, Mac 아카이브 유틸리티가 모두 ZIP 이름으로 `wiki-hub` 폴더를 만든다. 반대로 `wiki-hub/` 하나로 감싸면 Windows에서는 `wiki-hub\wiki-hub\`, 반디집에서는 한 단계가 되어 도구마다 다시 갈라진다.
- **하위 폴더 이름 `hub`**: 얇은 bat 안의 경로에 한글이 없어야 `chcp` 전에도 안전하다. 짧고 루트 실행기 이름(start-**hub**)과 짝이 맞는다. 뜻은 `읽어주세요.txt` 가 설명한다(대안은 열린 질문 1).
- 루트에 `.gitattributes`·`.gitignore`·`.env.example`·`CLAUDE.md` 등 점 파일과 설정 파일은 두지 않는다. 모두 `hub/` 안으로 들어간다.

**2. 얇은 실행기 내용** (`server/hubZipRoot.ts` 의 문자열 상수로 둔다. 저장소 파일로 두면 Vercel `includeFiles` 가 필요하고 줄바꿈이 `.gitattributes` 에 묶인다.)

`start-hub.bat` — ASCII만 쓴다(chcp 전 한글 파싱 문제를 피한다). 줄바꿈은 `\r\n`:

```bat
@echo off
rem Platform knowledge hub launcher. The real launcher is hub\start-hub.bat
set "HUB_LAUNCHER=%~f0"
call "%~dp0hub\start-hub.bat" %*
exit /b %errorlevel%
```

`start-hub.command` — ASCII, `\n`, 권한 0755. 바탕화면 심볼릭 링크로 실행될 수 있으므로 링크를 따라가는 부분은 원본과 같은 방식으로 쓴다:

```bash
#!/bin/bash
# Platform knowledge hub launcher. The real launcher is hub/start-hub.command
SELF="$0"
while [ -L "$SELF" ]; do
  LINK="$(readlink "$SELF")"
  case "$LINK" in /*) SELF="$LINK" ;; *) SELF="$(dirname "$SELF")/$LINK" ;; esac
done
DIR="$(cd "$(dirname "$SELF")" && pwd)"
HUB_LAUNCHER="$DIR/start-hub.command" exec /bin/bash "$DIR/hub/start-hub.command" "$@"
```

- 내부 실행기는 `/bin/bash 경로` 로 부르므로 실행 권한이 없어도 돈다. 그래도 `hub/start-hub.command` 는 0755로 유지한다(저장소 안에서 직접 실행하는 경우).

**3. 바탕화면 바로가기 — 루트 실행기를 가리키게 한다**

- **왜**: Mac 아카이브 유틸리티는 푼 파일 전체에 격리 속성을 붙인다. 실무자는 루트 `start-hub.command` 만 "우클릭 → 열기"로 승인한다. 바로가기가 `hub/start-hub.command` 를 가리키면 다음 날 바로가기를 더블클릭할 때 "확인되지 않은 개발자" 경고가 다시 뜰 수 있다(ops 실기 확인 대상). Windows도 실무자가 실제로 누른 파일과 바로가기 대상이 같아야 문의 대응이 쉽다.
- **방법**: 얇은 실행기가 환경변수 `HUB_LAUNCHER` 로 자기 경로를 넘긴다. 내부는 값이 있고 파일이 있으면 그것을, 없으면 지금처럼 자기 실행기를 바로가기 대상으로 쓴다. 저장소에서 직접 실행할 때(환경변수 없음)는 동작이 지금과 같다.
- `scripts/setup.ps1` 4단계:
  ```powershell
  $launcher = if ($env:HUB_LAUNCHER -and (Test-Path $env:HUB_LAUNCHER)) { $env:HUB_LAUNCHER } else { Join-Path $root 'start-hub.bat' }
  $link.TargetPath = $launcher
  $link.WorkingDirectory = Split-Path -Parent $launcher
  ```
  (`start-hub.bat` 의 `setlocal` 은 부모 환경을 그대로 물려받으므로 내부 bat은 고치지 않는다.)
- `start-hub.command` 4단계: `TARGET="${HUB_LAUNCHER:-$ROOT/start-hub.command}"`, `[ -f "$TARGET" ] || TARGET="$ROOT/start-hub.command"`, `ln -s "$TARGET" "$SHORTCUT"`.
- 바로가기가 이미 있으면 건너뛰는 동작은 그대로 둔다(옛 폴더를 가리키는 문제는 범위 밖, 열린 질문 3).
- `start-hub.bat` 과 `start-hub.command` 의 나머지(경로·`cd`·`npm`)는 고치지 않는다.

**4. 재포장 (`server/hubZip.ts`)**

- 순수 함수 `repackHubZip(zipball: Uint8Array, now: Date): Uint8Array` 를 만들고 `proxyHubZip` 이 부른다. 검증하기 쉽게 GitHub 호출과 분리한다.
- 흐름:
  1. `upstream.arrayBuffer()` 로 받는다. 20MB를 넘으면 502 "허브 파일이 너무 커서 묶지 못했습니다 — 관리자에게 알려 주세요"로 응답한다.
  2. zip을 푼다. 첫 경로 조각(`owner-repo-<sha>/`)을 벗기고 `hub/` 를 앞에 붙인다. 디렉터리 항목(`/` 로 끝남)은 버린다. 첫 조각에서 `/-([0-9a-f]{7,40})$/` 로 버전을 뽑는다(못 뽑으면 `알 수 없음`).
  3. 루트에 설계 2의 실행기 2개와 `읽어주세요.txt` 를 더한다.
  4. 압축한다(deflate). 권한은 Unix(made-by 3)로 기록한다. `*.command`·`*.sh` 는 `0o100755`, 나머지 파일은 `0o100644` 다. 원본 권한을 읽을 수 있는 라이브러리면 원본을 따르고, 없으면 이 규칙을 쓴다.
  5. 한글 항목명(`지식/…`, `읽어주세요.txt`)에는 UTF-8 플래그(general purpose bit 11)를 켠다.
  6. `Content-Type: application/zip`, 기존 `Content-Disposition`(`wiki-hub.zip`), `Cache-Control: no-store`, **`Content-Length`(결과 길이)** 로 응답한다. 결과 크기와 항목 수를 `console.info` 로 한 줄 남긴다.
- 풀기·묶기 중 예외가 나면 502 `{ error: '허브 파일을 묶지 못했습니다 — 잠시 뒤 다시 시도해 주세요' }` 로 응답한다(원문은 서버 로그에만 남긴다).
- 토큰 없음(503)·형식 오류(500)·GitHub 실패(502) 경로와 문구는 그대로 둔다.
- 의존성: 순수 JS zip 라이브러리 하나(예: fflate)를 권한다. 선택은 dev-server에 맡기되 위 4·5를 지원하는지 확인한다. `api/download-hub.ts`·`server/cliBridge.ts` 는 고치지 않는다.
- 스트리밍을 포기하는 근거: 결과가 1MB 안팎이고 클라이언트가 이미 Blob으로 전부 받는다. 결과는 Vercel 함수 응답 한도(4.5MB) 아래여야 한다.

**5. 화면 문구 (`src/components/CliStatus.tsx`)**

Windows 안내 단계:

1. 아래 **로컬 허브 내려받기**로 `wiki-hub.zip` 을 받습니다
2. 받은 파일을 **우클릭 → 모두 압축 풀기** (ZIP 안에서 바로 실행 금지)
3. 풀린 **wiki-hub** 폴더에서 **start-hub**(종류: Windows 배치 파일)를 더블클릭
4. 검은 창이 묻는 대로 **Y**를 누르면 세팅이 끝나고 브라우저가 열립니다

Mac 안내 단계:

1. 아래 **로컬 허브 내려받기**로 `wiki-hub.zip` 을 받습니다
2. **더블클릭해 압축 풀기** (ZIP 안에서 바로 실행 금지)
3. 풀린 **wiki-hub** 폴더에서 **start-hub.command** 를 **우클릭 → 열기** ("확인되지 않은 개발자" 경고 때문)
4. 터미널이 묻는 대로 **Y**를 누르면 세팅이 끝나고 브라우저가 열립니다

단계 아래 보조 한 줄(muted, 12.5px): `wiki-hub 폴더에는 start-hub, 읽어주세요, hub 폴더만 있습니다. hub 폴더는 열지 않아도 됩니다.`

- 지금의 Mac 전용 `<li>`("확인되지 않은 개발자" 경고는 우클릭 → 열기)는 3단계에 합친다. "이름이 긴 폴더"·`owner-repo-커밋번호` 문구를 지운다. `launcher` 변수(61행)는 Mac 3단계에서 계속 쓴다.
- 112행 토스트: `wiki-hub.zip 을 받았습니다 — 압축을 풀고 wiki-hub 폴더의 start-hub 를 실행하세요`
- "이미 받아 두셨다면: 로컬 허브 열기 ↗ …" 줄은 그대로 둔다.

`읽어주세요.txt` (wiki-ux 확정 전 초안. `{}` 는 서버가 채운다):

```
플랫폼 담당 지식 허브 — 내 PC에서 실행하기

Windows : start-hub (종류: Windows 배치 파일) 를 더블클릭하세요.
Mac     : start-hub.command 를 우클릭 → 열기 하세요.

묻는 대로 Y를 누르면 세팅이 끝나고 브라우저가 열립니다.
다음부터는 바탕화면의 "플랫폼 담당 지식 허브" 를 더블클릭하면 됩니다.
창을 닫으면 허브가 꺼집니다.

hub 폴더는 허브 프로그램 파일입니다. 옮기거나 지우지 마세요.

받은 날짜: {YYYY-MM-DD (KST)}   버전: {커밋 앞 7자리}
```

### 범위 밖

- 저장소 구조 변경(B안): 감싸는 폴더 문제를 풀지 못하고 배포·규약과 충돌한다.
- OS별 ZIP(`?os=win`): 혼란은 더 줄지만 다른 OS 동료에게 넘길 수 없다. 실기 피드백을 본 뒤 정한다(열린 질문 2).
- 바로가기가 옛 폴더를 가리키는 업데이트 문제: setup의 기존 "있으면 건너뜀" 동작에서 생기며 별도 흐름이 필요하다(열린 질문 3).
- setup 질문 순서·문구: 이번 문제(찾기)와 무관하다.
- 설치 프로그램·코드 서명: 비용이 범위를 넘는다.
- Mac 격리 속성 제거(`xattr`): 바로가기를 승인된 루트 실행기로 돌려 피한다. 보안 경고를 우회하지 않는다.

## 수용 기준

export-ignore가 머지된 main을 기준으로, 배포 허브에서 받은 `wiki-hub.zip` 으로 확인한다.

**ZIP 구조 (dev-server가 검증)**

1. ZIP 항목 목록에서 `/` 가 없는 최상위 항목은 정확히 `start-hub.bat`, `start-hub.command`, `읽어주세요.txt` 세 개이고, 나머지 항목은 모두 `hub/` 로 시작한다. `owner-repo-커밋번호/` 로 시작하는 항목은 없다.
2. `hub/` 아래 파일 목록이 같은 커밋의 `git archive` 목록과 일치한다(`hub/` 접두사만 다르다). 제출·발표 html, 게시판 본문 txt, `vercel.json`, `.claude/`, `.github/`, `screenshots/` 는 어디에도 없다.
3. `start-hub.command` 와 `hub/start-hub.command` 의 외부 속성이 `0o100755`(made-by Unix)다. 루트 `start-hub.bat` 은 모든 줄이 CRLF이고 ASCII만 있다. `읽어주세요.txt` 는 UTF-8 BOM으로 시작하고 CRLF이며, 받은 날짜와 7자리 버전이 채워져 있다.
4. 한글 항목명(`hub/지식/…`, `읽어주세요.txt`)에 UTF-8 플래그가 켜져 있다.
5. 로컬(`npm run dev`)의 `/api/download-hub` 와 배포 `/api/download-hub` 가 같은 구조의 ZIP을 준다(1~4 동일).
6. 응답에 `Content-Length` 가 있고, 크기가 4.5MB 미만이며, 배포 함수가 60초 안에 끝난다. 서버 로그에 크기·항목 수 한 줄이 남는다.
7. 토큰 없음(503)·GitHub 실패(502)·로그인 필요(401) 문구는 지금과 같다. 깨진 zip을 `repackHubZip` 에 넣으면 예외가 밖으로 새지 않고 502 한 줄 안내가 나간다.
8. `npm run build` 를 통과한다.

**실무자 화면 (ops가 실기로 검증)**

9. Windows 10/11 탐색기에서 우클릭 → 모두 압축 풀기(기본 대상)를 하면 열리는 `wiki-hub` 폴더에 항목이 4개(`start-hub` 배치 파일, `start-hub` COMMAND 파일, `읽어주세요`, `hub`)만 보인다. 반디집 "자동으로 풀기"도 같은 결과다.
10. Windows에서 루트 `start-hub` 더블클릭 → 기존 setup 질문 → Y → 브라우저에 `http://localhost:5173` 이 열린다. 새로 만든 바탕화면 바로가기의 대상은 `…\wiki-hub\start-hub.bat`, 시작 위치는 `…\wiki-hub` 이고, 바로가기를 더블클릭해도 허브가 켜진다.
11. Mac에서 더블클릭으로 풀면 `wiki-hub` 폴더에 같은 4개가 보인다. 루트 `start-hub.command` 우클릭 → 열기 → Y → 브라우저가 열린다. 바탕화면 바로가기는 `…/wiki-hub/start-hub.command` 를 가리키는 심볼릭 링크이고, 다음 날 더블클릭할 때 "확인되지 않은 개발자" 경고 없이 허브가 켜진다.
12. 루트 `start-hub.bat --check`·`./start-hub.command --check` 가 상태만 출력하고 끝난다(인자가 전달된다).
13. 저장소 안에서 `start-hub.bat`·`start-hub.command` 를 직접 실행하면(환경변수 없음) 바로가기 대상이 저장소의 실행기다(지금과 같다).
14. `읽어주세요.txt` 가 Windows 메모장과 Mac 텍스트 편집기에서 깨지지 않는다.

**화면 문구 (dev-front가 검증)**

15. 설정 창의 Windows·Mac 안내 어디에도 "이름이 긴 폴더"와 `owner-repo` 가 없다. Windows 3단계에 `start-hub` 와 "Windows 배치 파일"이 함께 있다. Mac 안내는 4단계다.
16. 내려받기 성공 토스트가 설계 5의 문장과 같다.

## 담당 분배

| 순서 | 담당 | 작업 지시 | 건드리는 파일 | 의존 |
| --- | --- | --- | --- | --- |
| 0 | PM 데스크 / ops | export-ignore PR을 main에 머지한다. 배포 허브에서 받은 ZIP의 `owner-repo-*/` 아래 최상위가 18개인지 확인한다 | `.gitattributes`(PR 머지만) | 없음 |
| 1 | wiki-ux | `읽어주세요.txt` 문안과 설정 창 안내 단계(설계 5)를 확정해 `docs/ux/2026-11-12-hub-download-guide.md` 에 남긴다. 반나절 안에 끝낸다. 늦어지면 dev-server·dev-front는 이 문서 초안으로 먼저 구현하고, 문구만 나중에 바꾼다 | `docs/ux/` | 열린 질문 1 |
| 2 | dev-server | 설계 2·3·4를 구현한다: (a) zip 의존성 추가, (b) `server/hubZipRoot.ts`(얇은 실행기 2개와 안내 txt 생성 함수, 줄바꿈 명시), (c) `server/hubZip.ts` 의 `repackHubZip` 과 `proxyHubZip` 연결, (d) `scripts/setup.ps1` 4단계와 `start-hub.command` 4단계에 `HUB_LAUNCHER` 처리. 수용 기준 1~8·12·13을 검증한다. 1~4는 `git archive --format=zip --prefix=owner-wiki-hub-abc1234/ HEAD` 결과를 `repackHubZip` 에 넣고 항목 목록·외부 속성·플래그·줄바꿈을 출력해 PR 본문에 붙인다. 5·7은 로컬 `npm run dev` + `GITHUB_TOKEN` 으로 확인한다. PR을 올린다 | `server/hubZip.ts`, `server/hubZipRoot.ts`(신규), `scripts/setup.ps1`, `start-hub.command`, `package.json`, `package-lock.json` | 0 (1은 문구만) |
| 3 | dev-front | 설계 5를 반영한다: `CliStatus.tsx` 247~265행 안내 단계, 보조 한 줄, 112행 토스트. 수용 기준 15·16·8을 확인한다. 2와 파일이 겹치지 않아 병렬로 작업할 수 있지만, 문구가 새 ZIP 구조를 전제하므로 **머지는 2 뒤에** 한다 | `src/components/CliStatus.tsx` | 2 머지 |
| 4 | ops | 2·3 배포 후 수용 기준 9~14를 Windows(기본 풀기·반디집)와 Mac에서 확인한다. Windows "열기 - 보안 경고" 대화상자가 뜨는지 기록한다. 뜨면 wiki-ux에 안내 문구 추가를 요청한다 | 없음(확인만) | 2, 3 배포 |

`start-hub.command` 와 `scripts/setup.ps1` 은 dev-server만 건드린다. dev-front와 같은 파일을 쓰지 않으므로 2와 3은 병렬로 진행하고 머지 순서만 지킨다.

## 열린 질문

1. **하위 폴더 이름**: `hub`(추천: bat 경로 안전, 짧음)와 `허브 파일` 같은 한글 이름(뜻은 분명하지만 얇은 bat에 한글 경로가 들어가 코드페이지 위험이 생김) 중 무엇으로 할까요?
2. **OS별 ZIP**: 설정 창이 OS를 알고 있으니 `?os=win|mac` 으로 실행기를 하나만 넣어 최상위를 3개로 줄일 수 있습니다. 이번에 넣을까요? PM 의견은 이번에는 두 개를 다 넣고 실기 피드백 뒤에 정하자는 것입니다.
3. **업데이트(다시 받기)**: 새로 받아 다른 위치에 풀면 기존 바탕화면 바로가기가 옛 폴더를 가리킵니다. "바로가기 대상이 현재 실행기와 다르면 다시 만들지 묻기"를 별도 기획으로 잡을까요?
4. **CLAUDE.md가 로컬 챗봇 문맥에 섞이는지(미확인)**: 로컬 챗봇은 `claude -p` 를 `hub/지식/` 에서 실행합니다(`server/cliBridge.ts` 160~172행). 상위 폴더의 CLAUDE.md(PM 데스크 규약)가 함께 읽힐 수 있습니다. export-ignore에 `/CLAUDE.md` 를 더할지 chatbot-planner가 확인할까요?
