#!/bin/bash
# 플랫폼 담당 지식 허브 더블클릭 실행기 (macOS) — Windows의 start-hub.bat + scripts/setup.ps1 에 해당한다.
# 세팅 점검 -> 허브 실행 -> 브라우저 자동 열기. 이미 갖춰진 항목은 조용히 건너뛴다.
#   ./start-hub.command --check : 설치·생성 없이 상태만 확인

# 바탕화면 바로가기는 이 파일의 심볼릭 링크라서, 링크를 끝까지 따라가 진짜 위치를 찾는다
SELF="$0"
while [ -L "$SELF" ]; do
  LINK="$(readlink "$SELF")"
  case "$LINK" in /*) SELF="$LINK" ;; *) SELF="$(dirname "$SELF")/$LINK" ;; esac
done
cd "$(dirname "$SELF")" || exit 1
ROOT="$(pwd)"
CHECK=0
[ "$1" = "--check" ] && CHECK=1

has() { command -v "$1" >/dev/null 2>&1; }
ask() {
  [ "$CHECK" = 1 ] && return 1
  local a
  read -r -p "$1 (Y/N) " a
  [[ "$a" =~ ^[Yy] ]]
}
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
ok() { printf '\033[32m%s\033[0m\n' "$1"; }
fail() { printf '\033[31m%s\033[0m\n' "$1"; }
pause_exit() { # $1 = 종료 코드. 더블클릭으로 연 창이 바로 닫히지 않게 한다
  echo
  read -r -n 1 -s -p "아무 키나 누르면 창을 닫습니다..."
  echo
  exit "$1"
}

CLI_NAMES=(claude codex)
cli_pkg() { [ "$1" = claude ] && echo '@anthropic-ai/claude-code' || echo '@openai/codex'; }

logged_in() {
  if [ "$1" = claude ]; then
    claude auth status 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.exit(JSON.parse(s).loggedIn===true?0:1)}catch{process.exit(1)}})'
  else
    local out
    out="$(codex login status 2>&1)" || return 1
    [[ "$out" == *"logged in"* && "$out" != *"not logged in"* ]]
  fi
}

SHORTCUT="$HOME/Desktop/플랫폼 담당 지식 허브.command"

# 1. Node.js
if ! has node; then
  warn "[필요] Node.js가 설치되어 있지 않습니다."
  if has brew && ask "Homebrew로 Node.js를 지금 설치할까요?"; then
    brew install node
    hash -r
  fi
  if ! has node; then
    warn "Node.js를 설치한 뒤 다시 실행해 주세요: https://nodejs.org"
    [ "$CHECK" = 1 ] && exit 1
    pause_exit 1
  fi
fi

# 2. 챗봇용 CLI 설치
if [ "$CHECK" = 0 ]; then
  for name in "${CLI_NAMES[@]}"; do
    has "$name" && continue
    warn "[안내] $name CLI가 없습니다. 없어도 허브는 쓸 수 있고, 챗봇은 다른 CLI나 규칙 기반으로 답합니다."
    if ask "$name CLI를 설치할까요?"; then
      npm i -g "$(cli_pkg "$name")" || fail "[오류] 설치에 실패했습니다. 권한 문제라면 앞에 sudo 를 붙여 터미널에서 직접 실행해 보세요."
      hash -r
    fi
  done

  # 3. CLI 로그인
  for name in "${CLI_NAMES[@]}"; do
    has "$name" || continue
    logged_in "$name" && continue
    warn "[안내] $name CLI 로그인이 필요합니다."
    if ask "지금 $name 에 로그인할까요? (브라우저가 열립니다)"; then
      if [ "$name" = claude ]; then claude auth login; else codex login; fi
    fi
  done

  # 4. 바탕화면 바로가기 (macOS에는 .lnk가 없어 심볼릭 링크를 만든다)
  if [ -d "$HOME/Desktop" ] && [ ! -e "$SHORTCUT" ] && [ ! -L "$SHORTCUT" ]; then
    # 내려받은 ZIP의 루트 실행기가 HUB_LAUNCHER 로 자기 경로를 넘기면 그걸 가리킨다 (격리 승인을 받은 파일과 같게)
    TARGET="${HUB_LAUNCHER:-$ROOT/start-hub.command}"
    [ -f "$TARGET" ] || TARGET="$ROOT/start-hub.command"
    if ln -s "$TARGET" "$SHORTCUT"; then
      ok "[완료] 바탕화면에 '플랫폼 담당 지식 허브' 바로가기를 만들었습니다. 다음부터는 그걸 더블클릭하세요."
    fi
  fi

  # 5. 패키지
  if [ ! -d "$ROOT/node_modules" ]; then
    echo "처음 실행이라 필요한 패키지를 설치합니다. 1~2분 걸릴 수 있어요..."
    if ! npm install; then
      fail "[오류] 패키지 설치에 실패했습니다."
      pause_exit 1
    fi
  fi
else
  [ -d "$ROOT/node_modules" ] || echo "[확인] 패키지 설치 필요"
  echo "[확인] Node.js $(node --version)"
  for name in "${CLI_NAMES[@]}"; do
    installed=false; logged=false
    if has "$name"; then installed=true; logged_in "$name" && logged=true; fi
    echo "[확인] $name: 설치=$installed 로그인=$logged"
  done
  if [ -L "$SHORTCUT" ] || [ -e "$SHORTCUT" ]; then echo "[확인] 바탕화면 바로가기: true"; else echo "[확인] 바탕화면 바로가기: false"; fi
  exit 0
fi

echo
echo "허브를 시작합니다. 잠시 후 브라우저가 자동으로 열립니다."
echo "** 이 창을 닫으면 허브가 꺼집니다 **"
echo
npm run dev -- --open
pause_exit $?
