#!/bin/bash
# 플랫폼 담당 지식 허브 한 줄 설치 (macOS) — 브라우저로 받은 ZIP 대신 터미널에서 받아 격리 표시(quarantine) 없이 설치한다.
#   curl -fsSL https://raw.githubusercontent.com/<저장소>/HEAD/scripts/install-hub.sh | bash -s -- claude|codex|both
# 설치 자리는 ~/wiki-hub/hub 하나로 고정한다 (docs/plan/2026-11-19-one-line-install.md D2·D3). 이미 있으면 덮지 않고 실행기로 넘긴다.
# 구성은 server/hubZip.ts 의 hub/ 와 같다 — .hub-version 과(계정 인자가 있으면) hub-setup.json 을 넣고, 루트 실행기·안내문은 만들지 않는다.
# 창에는 docs/ux/2026-11-19-one-line-install-copy.md 의 W-6x·W-7x 줄만 낸다. curl·압축 풀기 출력은 기록 파일로만 보낸다. sudo 는 쓰지 않는다.
# macOS 기본 /bin/bash(3.2)에서 돌아야 한다 — 연관 배열·${var,,}·mapfile 을 쓰지 않는다.
# 본문 전체를 함수로 감싸고 맨 끝 한 줄에서 부른다. 받기가 중간에 끊긴 반쪽 스크립트는 아무것도 하지 않는다.
#   HUB_INSTALL_NO_START=1 : 설치만 하고 실행기를 부르지 않는다 (담당자 확인용)
#   HUB_INSTALL_ANY_OS=1   : Mac 이 아니어도 설치한다 (담당자 확인용 — 실행기는 Mac 전용 문구다)

install_hub_main() {
  # 저장소 이름 — server/env.ts readGithubRepo 기본값, src/lib/localHub.ts HUB_REPO 와 같게 유지
  local REPO='iamunjoa-prog/wiki-hub'
  local BASE="$HOME/wiki-hub"
  local HUB="$BASE/hub"
  # 받는 동안의 자리. 같은 디스크에 두어 마지막에 이름 바꾸기 한 번으로 ~/wiki-hub 가 생기게 한다
  local PARTIAL="$HOME/wiki-hub.partial"
  local LOG_DIR="$HOME/wiki-hub-기록"
  local LOG_FILE="$LOG_DIR/설치기록.txt"
  local SHORTCUT="$HOME/Desktop/플랫폼 담당 지식 허브.command"
  local OS_NAME
  OS_NAME="$(uname -s)"
  local account="${1:-}" accounts_json='' labels='' state state_label cleaned=0 latest version='-' stage incoming out pid start next code

  say() { printf '%s\n' "$1"; }
  ok() { printf '\033[32m%s\033[0m\n' "$1"; }
  warn() { printf '\033[33m%s\033[0m\n' "$1"; }
  fail() { printf '\033[31m%s\033[0m\n' "$1"; }
  log() { printf '%s\n' "$1" >>"$LOG_FILE" 2>/dev/null; }
  has_tty() { (exec </dev/tty) 2>/dev/null; }
  reveal_log() {
    if [ "$OS_NAME" = Darwin ]; then open -R "$LOG_FILE"; else xdg-open "$LOG_DIR"; fi >/dev/null 2>&1
  }
  # W-91m — curl | bash 는 표준 입력이 이 스크립트라서 키보드(/dev/tty)에서 읽는다
  pause_end() {
    echo
    say "아무 키나 누르면 끝납니다. 그다음 창 왼쪽 위 빨간 단추로 창을 닫아 주세요."
    if has_tty; then read -r -n 1 -s </dev/tty; fi
    echo
  }
  # 멈추는 실패 — 문제 한 줄 · 지금 할 일 · 기록 위치를 보이고 기록 파일을 Finder 에서 보여 준다 (copy 문서 4-4절 네 줄 묶음)
  stop_with_help() {
    log "[멈춤] $1"
    echo
    fail "$1"
    say "지금 할 일: $2"
    say "기록 파일: $LOG_FILE"
    reveal_log
    say "기록 파일이 있는 폴더를 열어 두었어요."
    pause_end
    return 1
  }
  # 외부 도구 출력에서 원인을 가른다 (start-hub.command classify 와 같은 근거) — W-72 · W-71 · W-73 · W-74
  stop_download() {
    if grep -Eqi 'certificate|SSL' "$1" 2>/dev/null; then
      stop_with_help "회사 네트워크 보안 때문에 내려받기가 막혔어요." "기록 파일을 허브 담당자에게 보내 주세요. 그동안은 허브 화면의 '파일(ZIP)로 받기'로 설치할 수 있어요."
    elif grep -Eqi 'No space left' "$1" 2>/dev/null; then
      stop_with_help "Mac 저장 공간이 부족해요." "필요 없는 파일을 지워 공간을 비운 뒤, 허브 화면에서 명령을 다시 복사해 붙여 넣어 주세요."
    elif grep -Eqi 'resolve host|connect|unreachable|timed out|reset' "$1" 2>/dev/null; then
      stop_with_help "인터넷에 연결되지 않아 내려받지 못했어요." "인터넷 연결을 확인한 뒤, 허브 화면에서 명령을 다시 복사해 이 창에 붙여 넣고 return 을 눌러 주세요."
    else
      stop_with_help "허브 파일을 받았지만 열지 못했어요." "허브 화면에서 명령을 다시 복사해 붙여 넣어 보고, 같은 화면이 나오면 기록 파일을 허브 담당자에게 보내 주세요."
    fi
  }

  # 실행기를 부른다. 표준 입력을 키보드(/dev/tty)로 이어 줘야 계정 질문·"아무 키나"가 스크립트 본문을 읽지 않는다
  start_launcher() {
    if [ "${HUB_INSTALL_NO_START:-}" = 1 ]; then log "[설치] 실행기 부르기 건너뜀 (HUB_INSTALL_NO_START)"; return 0; fi
    log "[설치] 실행기 부름 $HUB/start-hub.command"
    # 바탕화면 아이콘이 고정 설치를 가리키도록 루트 실행기 경로는 넘기지 않는다
    unset HUB_LAUNCHER
    if has_tty; then exec /bin/bash "$HUB/start-hub.command" </dev/tty; fi
    exec /bin/bash "$HUB/start-hub.command" </dev/null
    # exec 가 돌아오면 실행기를 열지 못한 것이다 — W-76
    stop_with_help "설치는 끝났지만 허브를 켜지 못했어요." "허브 화면에서 명령을 다시 복사해 붙여 넣어 보고, 같은 화면이 나오면 기록 파일을 허브 담당자에게 보내 주세요."
  }

  # W-69 — 다운로드 폴더의 옛 ZIP 폴더는 지우지 않고 한 줄만 알린다 (사용자 파일이다).
  # 바탕화면 아이콘의 링크 문자열만 본다. 다운로드 폴더를 읽거나 -e 로 확인하면 macOS 가 폴더 접근 허용 창을 띄울 수 있다
  notice_old_folders() {
    local target
    [ -L "$SHORTCUT" ] || return 0
    target="$(readlink "$SHORTCUT" 2>/dev/null)"
    case "$target" in
      "$HOME/Downloads/wiki-hub"*)
        log "[설치] 아이콘이 다운로드 폴더의 옛 폴더를 가리킴: $target"
        warn "예전에 다운로드 폴더에 받은 wiki-hub 폴더는 이제 쓰지 않아요. 휴지통에 버려도 됩니다."
        ;;
    esac
  }

  printf '\033]0;%s\007' '플랫폼 담당 지식 허브'

  # W-77 — 기록 폴더 줄 없이 두 줄만
  if [ "$OS_NAME" != Darwin ] && [ "${HUB_INSTALL_ANY_OS:-}" != 1 ]; then
    fail "이 설치 명령은 Mac 전용이에요."
    say "지금 할 일: Windows 라면 허브 화면에서 'Windows 안내 보기'를 눌러 파일로 받아 설치해 주세요."
    return 1
  fi

  case "$account" in
    claude) accounts_json='"claude"'; labels='Claude' ;;
    codex) accounts_json='"codex"'; labels='ChatGPT' ;;
    both) accounts_json='"claude","codex"'; labels='Claude와 ChatGPT' ;;
    *) account='' ;; # 없거나 모르는 값이면 계정 파일을 넣지 않는다 — 실행기가 번호로 한 번 묻는다
  esac

  say "플랫폼 담당 지식 허브를 설치합니다."
  say "내 홈 폴더 > wiki-hub 에 설치해요. Mac 암호는 묻지 않아요. 이 창은 닫지 마세요."

  if ! mkdir -p "$LOG_DIR" 2>/dev/null || ! : >>"$LOG_FILE" 2>/dev/null; then
    # 기록 파일도 못 만드는 경우 — 열어 둘 폴더가 없어 문제·할 일 두 줄만 낸다 (W-75)
    echo
    fail "내 홈 폴더에 허브를 설치할 수 없어요."
    say "지금 할 일: 이 창을 찍어 허브 담당자에게 보내 주세요."
    pause_end
    return 1
  fi

  # ---------- ~/wiki-hub 상태 (D3) ----------
  if [ -e "$PARTIAL" ] || [ -L "$PARTIAL" ]; then
    rm -rf "$PARTIAL"
    cleaned=1
  fi
  # 비어 있는 폴더는 없는 것으로 본다
  [ -d "$BASE" ] && [ ! -L "$BASE" ] && rmdir "$BASE" 2>/dev/null
  if [ ! -e "$BASE" ] && [ ! -L "$BASE" ]; then
    state=new; state_label='새로'; [ "$cleaned" = 1 ] && state_label='끊긴 흔적'
  elif [ -e "$HUB/.git" ]; then state=dev; state_label='git'
  elif [ -f "$HUB/.hub-version" ] && [ -f "$HUB/start-hub.command" ]; then
    state=installed; state_label='이미 설치'
    version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$HUB/.hub-version" 2>/dev/null | head -n 1)"
  else state=other; state_label='다른 폴더'
  fi
  # L-05
  log "===== 한 줄 설치 $(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S') KST · $(sw_vers -productName 2>/dev/null || uname -s) $(sw_vers -productVersion 2>/dev/null || uname -r) · 계정 인자 ${account:-없음} · 상태 $state_label · 커밋 ${version:--} ====="

  case "$state" in
    dev)
      say "허브가 이미 설치돼 있어요. 새로 받지 않고 그대로 씁니다."
      notice_old_folders
      start_launcher
      return $?
      ;;
    installed)
      say "허브가 이미 설치돼 있어요. 새로 받지 않고 그대로 씁니다."
      # 계정 인자가 기존 선택과 다르면 그 파일만 새 값으로 바꾼다 (기획 Q2 결정)
      if [ -n "$account" ] && [ "$(tr -d ' \t\r\n' <"$HUB/hub-setup.json" 2>/dev/null)" != "{\"accounts\":[$accounts_json]}" ]; then
        if printf '{"accounts":[%s]}\n' "$accounts_json" >"$HUB/hub-setup.json" 2>>"$LOG_FILE"; then
          log "[설치] 계정 선택을 $account 로 바꿈"
          ok "고른 계정을 바꿨어요: $labels"
        fi
      fi
      notice_old_folders
      start_launcher
      return $?
      ;;
    other)
      log "[설치] 다른 wiki-hub 폴더가 있어 아무것도 바꾸지 않음"
      stop_with_help "내 홈 폴더에 이미 다른 wiki-hub 폴더가 있어 설치를 멈췄어요. 그 폴더는 건드리지 않았어요." "그 폴더를 지우거나 옮기지 말고, 기록 파일을 허브 담당자에게 보내 주세요."
      return 1
      ;;
  esac

  # ---------- 새로 설치 ----------
  [ "$cleaned" = 1 ] && say "지난번에 끊긴 설치를 정리했어요. 처음부터 다시 받습니다."
  say "허브 파일을 내려받는 중… (1분쯤)"
  stage="$PARTIAL/unpack"
  out="$PARTIAL/curl.txt"
  if ! mkdir -p "$stage" 2>>"$LOG_FILE"; then
    stop_with_help "내 홈 폴더에 허브를 설치할 수 없어요." "기록 파일을 허브 담당자에게 보내 주세요."
    return 1
  fi
  # 최신 커밋은 공개 저장소의 git 광고(info/refs — API 호출 한도에 걸리지 않는다)로 본다. 실행기 update_hub 와 같은 방식이다
  latest="$(curl -fsS --max-time 20 --retry 2 -A wiki-hub-update "https://github.com/$REPO.git/info/refs?service=git-upload-pack" 2>"$out" | head -c 4096 | grep -aEo '[0-9a-f]{40} HEAD' | head -n 1 | cut -c1-40)"
  cat "$out" >>"$LOG_FILE" 2>/dev/null
  if [ -z "$latest" ]; then
    log "[설치] 최신 버전 확인 실패"
    stop_download "$out"
    rm -rf "$PARTIAL"
    return 1
  fi
  version="$(printf '%s' "$latest" | cut -c1-7)"
  log "[설치] 받을 커밋 $version"

  # 받기는 뒤에서 돌리고, 2분을 넘으면 1분마다 W-23 을 낸다 (start-hub.command run_tool 과 같다)
  curl -fsSL --max-time 600 --retry 2 -o "$PARTIAL/hub.zip" "https://codeload.github.com/$REPO/zip/$latest" >"$out" 2>&1 </dev/null &
  pid=$!
  start=$SECONDS
  next=120
  while kill -0 "$pid" 2>/dev/null; do
    sleep 1
    if [ $((SECONDS - start)) -ge "$next" ] && kill -0 "$pid" 2>/dev/null; then
      say "아직 진행 중이에요. 창을 닫지 마세요."
      next=$((next + 60))
    fi
  done
  wait "$pid"
  code=$?
  cat "$out" >>"$LOG_FILE" 2>/dev/null
  if [ "$code" != 0 ]; then
    log "[설치] 압축 받기 실패 (종료 코드 $code)"
    stop_download "$out"
    rm -rf "$PARTIAL"
    return 1
  fi
  # ditto 가 한글 파일명을 그대로 푼다 (unzip 은 macOS 에서 깨질 수 있다)
  if [ "$OS_NAME" = Darwin ]; then
    ditto -x -k "$PARTIAL/hub.zip" "$stage" >"$out" 2>&1
  else
    unzip -q "$PARTIAL/hub.zip" -d "$stage" >"$out" 2>&1
  fi
  code=$?
  cat "$out" >>"$LOG_FILE" 2>/dev/null
  if [ "$code" != 0 ]; then
    log "[설치] 받은 압축을 풀지 못함 (종료 코드 $code)"
    if grep -Eqi 'No space left' "$out" 2>/dev/null; then stop_download "$out"
    else stop_with_help "허브 파일을 받았지만 열지 못했어요." "허브 화면에서 명령을 다시 복사해 붙여 넣어 보고, 같은 화면이 나오면 기록 파일을 허브 담당자에게 보내 주세요."
    fi
    rm -rf "$PARTIAL"
    return 1
  fi
  # codeload 압축은 최상위 폴더(repo-커밋) 하나 아래에 파일이 있다. 구성 검사는 update_hub 와 같다
  incoming="$(find "$stage" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [ -z "$incoming" ] || [ ! -f "$incoming/package.json" ] || [ ! -f "$incoming/start-hub.command" ] || [ ! -f "$incoming/scripts/setup.ps1" ]; then
    log "[설치] 받은 압축의 구성이 예상과 다름"
    rm -rf "$PARTIAL"
    stop_with_help "허브 파일을 받았지만 열지 못했어요." "허브 화면에서 명령을 다시 복사해 붙여 넣어 보고, 같은 화면이 나오면 기록 파일을 허브 담당자에게 보내 주세요."
    return 1
  fi
  # server/hubZipRoot.ts hubVersionText 와 같은 형식 — 실행기가 켤 때 이 저장소에서 최신을 받는다
  printf '{"version":"%s","repo":"%s"}\n' "$version" "$REPO" >"$incoming/.hub-version"
  # server/hubZip.ts 와 같은 형식 (parseHubAccount 결과를 JSON 으로)
  [ -n "$account" ] && printf '{"accounts":[%s]}\n' "$accounts_json" >"$incoming/hub-setup.json"
  chmod +x "$incoming/start-hub.command" "$incoming"/scripts/*.sh 2>/dev/null
  mkdir -p "$PARTIAL/wiki-hub" && mv "$incoming" "$PARTIAL/wiki-hub/hub" 2>>"$LOG_FILE"
  # 받는 사이 다른 창이 ~/wiki-hub 를 만들었으면 그 안으로 옮겨 넣지 않는다 (mv 는 있는 폴더 안으로 들어간다)
  if [ ! -d "$PARTIAL/wiki-hub/hub" ] || [ -e "$BASE" ] || [ -L "$BASE" ] || ! mv "$PARTIAL/wiki-hub" "$BASE" 2>>"$LOG_FILE"; then
    log "[설치] ~/wiki-hub 로 옮기지 못함"
    rm -rf "$PARTIAL"
    stop_with_help "내 홈 폴더에 허브를 설치할 수 없어요." "기록 파일을 허브 담당자에게 보내 주세요."
    return 1
  fi
  rm -rf "$PARTIAL"
  log "[설치] 설치함 $HUB · 커밋 $version · 계정 ${account:-없음}"
  ok "허브 파일을 설치했어요."
  notice_old_folders
  start_launcher
}

install_hub_main "$@"
