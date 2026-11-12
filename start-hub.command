#!/bin/bash
# 플랫폼 담당 지식 허브 더블클릭 실행기 (macOS) — Windows의 start-hub.bat + scripts/setup.ps1 에 해당한다.
# 준비(실행 준비물 → 프로그램 파일 → 연결 프로그램 → 로그인 → 아이콘) -> 허브 켜기 -> 브라우저 열기. 이미 갖춘 단계는 줄을 내지 않는다.
# 창에는 docs/ux/2026-11-12-local-hub-beginner-copy.md 의 한국어 줄만 낸다. 외부 도구 출력은 기록 파일로만 보낸다.
# macOS 기본 /bin/bash(3.2)에서 돌아야 한다 — 연관 배열·${var,,}·mapfile 을 쓰지 않는다.
#   ./start-hub.command --check : 설치·생성 없이 상태만 확인 (담당자용)

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

HUB_URL="http://localhost:5173/"
HUB_PORT=5173
# 휴대용 실행 준비물·연결 프로그램 자리 (server/env.ts readHubHomeDir 와 같다). 관리자 권한 없이 쓸 수 있는 홈 아래
HUB_HOME="$HOME/.wiki-hub"
NODE_DIR="$HUB_HOME/node"
TOOLS_DIR="$HUB_HOME/tools"
TOOLS_BIN="$TOOLS_DIR/node_modules/.bin"
LOG_DIR="$HOME/wiki-hub-기록"
LOG_FILE="$LOG_DIR/설치기록.txt"
SETUP_FILE="$ROOT/hub-setup.json"
SHORTCUT="$HOME/Desktop/플랫폼 담당 지식 허브.command"
NODE_MIN_MAJOR=18
LOGIN_LIMIT=300
OS_NAME="$(uname -s)"

export PATH="$TOOLS_BIN:$PATH"
printf '\033]0;%s\007' '플랫폼 담당 지식 허브'

say() { printf '%s\n' "$1"; }
ok() { printf '\033[32m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
fail() { printf '\033[31m%s\033[0m\n' "$1"; }
has() { command -v "$1" >/dev/null 2>&1; }

log() { [ "$CHECK" = 1 ] || printf '%s\n' "$1" >>"$LOG_FILE" 2>/dev/null; }
# 기록에 로그인 주소의 쿼리(일회용 코드)·토큰을 남기지 않는다
mask() { sed -E 's#(https?://[^[:space:]?]*)\?[^[:space:]]*#\1?***#g; s#(([Tt]oken|[Cc]ode|[Pp]assword|[Ss]ecret)[=:][[:space:]]*)[^[:space:]]+#\1***#g'; } # BSD sed 에는 I 플래그가 없다

open_url() {
  if [ "$OS_NAME" = Darwin ]; then open "$1"; else xdg-open "$1"; fi >/dev/null 2>&1
}
reveal_log() {
  if [ "$OS_NAME" = Darwin ]; then open -R "$LOG_FILE"; else xdg-open "$LOG_DIR"; fi >/dev/null 2>&1
}

pause_exit() { # $1 = 종료 코드. 더블클릭으로 연 창이 바로 닫히지 않게 한다
  echo
  say "아무 키나 누르면 끝납니다. 그다음 창 왼쪽 위 빨간 단추로 창을 닫아 주세요."
  read -r -n 1 -s
  echo
  exit "$1"
}

# 멈추는 실패 — 문제 한 줄 · 지금 할 일 · 기록 위치를 보이고 기록 폴더를 연다
stop_with_help() {
  log "[멈춤] $1"
  echo
  fail "$1"
  say "지금 할 일: $2"
  say "기록 파일: $LOG_FILE"
  reveal_log
  say "기록 파일이 있는 폴더를 열어 두었어요."
  pause_exit 1
}

# 외부 도구 출력에서 원인을 가른다 — 회사망 인증서 · 인터넷 없음 · 저장 공간 부족
FAIL_KIND=""
classify() {
  if grep -Eqi 'SELF_SIGNED_CERT|UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY_LEAF|CERT_HAS_EXPIRED|certificate|SSL' "$1"; then FAIL_KIND=cert
  elif grep -Eqi 'ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|Could not resolve host|Failed to connect|network is unreachable|timed out' "$1"; then FAIL_KIND=net
  elif grep -Eqi 'ENOSPC|No space left' "$1"; then FAIL_KIND=space
  else FAIL_KIND=""
  fi
}

# 단계 실패를 원인별 문구로 끝낸다. $1·$2 = 원인을 모를 때의 문제·지금 할 일
stop_step() {
  case "$FAIL_KIND" in
    cert) stop_with_help "회사 네트워크 보안 때문에 내려받기가 막혔어요." "기록 파일을 허브 담당자에게 보내 주세요." ;;
    net) stop_with_help "인터넷에 연결되지 않아 내려받지 못했어요." "인터넷 연결을 확인한 뒤 start-hub 를 다시 더블클릭해 주세요." ;;
    space) stop_with_help "PC 저장 공간이 부족해요." "필요 없는 파일을 지워 공간을 비운 뒤 start-hub 를 다시 더블클릭해 주세요." ;;
    *) stop_with_help "$1" "$2" ;;
  esac
}

# 외부 도구를 창에 아무것도 내지 않고 실행한다. 출력은 가려서 기록에 붙이고, 2분을 넘으면 1분마다 안내한다
run_tool() {
  local out pid code start next
  out="$(mktemp "${TMPDIR:-/tmp}/wiki-hub.XXXXXX")"
  log "> $*"
  "$@" >"$out" 2>&1 </dev/null &
  pid=$!
  CHILD_PID=$pid
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
  CHILD_PID=""
  classify "$out"
  mask <"$out" >>"$LOG_FILE" 2>/dev/null
  rm -f "$out"
  return "$code"
}

STEP_STARTED=0
step_begin() { STEP_STARTED=$SECONDS; log "[단계 $1 시작] $2"; }
step_end() { log "[단계 $1 끝] 종료 코드 $2 · $((SECONDS - STEP_STARTED))초"; }

# 창을 닫거나 Ctrl+C 로 끝낼 때 띄워 둔 허브·로그인 프로그램을 남기지 않는다 (비대화형 bash 의 백그라운드 작업은 SIGINT 를 무시한다)
CHILD_PID=""
stop_tree() {
  [ -n "$1" ] || return 0
  pkill -P "$1" >/dev/null 2>&1
  kill "$1" >/dev/null 2>&1
}
trap 'stop_tree "$CHILD_PID"; exit 130' INT TERM HUP

account_label() { [ "$1" = claude ] && echo 'Claude' || echo 'ChatGPT'; }

# ---------- 계정 선택 ----------
ACCOUNTS=()
SETUP_STATE=missing
read_accounts() {
  ACCOUNTS=()
  SETUP_STATE=missing
  [ -f "$SETUP_FILE" ] || return 0
  local body
  body="$(tr -d ' \t\r\n' <"$SETUP_FILE")"
  if [[ "$body" != *'"accounts":['*']'* ]]; then
    SETUP_STATE=broken
    return 0
  fi
  SETUP_STATE=file
  [[ "$body" == *'"claude"'* ]] && ACCOUNTS+=(claude)
  [[ "$body" == *'"codex"'* ]] && ACCOUNTS+=(codex)
  return 0
}

ask_accounts() {
  local key picked json
  say "처음 한 번만 여쭤볼게요. 어떤 AI 계정을 쓰고 계신가요?"
  say "번호 키를 하나 눌러 주세요."
  say "  1  Claude"
  say "  2  ChatGPT (Codex)"
  say "  3  둘 다"
  say "  4  잘 모르겠어요 (설치 없이 허브만 엽니다)"
  while :; do
    # 입력을 받을 수 없으면(창 없이 실행) 설치 없이 허브만 연다
    if ! read -r -n 1 -s key; then key=4; fi
    case "$key" in
      1) ACCOUNTS=(claude); picked='Claude'; json='"claude"'; break ;;
      2) ACCOUNTS=(codex); picked='ChatGPT (Codex)'; json='"codex"'; break ;;
      3) ACCOUNTS=(claude codex); picked='둘 다'; json='"claude","codex"'; break ;;
      4) ACCOUNTS=(); picked='잘 모르겠어요'; json=''; break ;;
      *) say "1, 2, 3, 4 중 하나를 눌러 주세요." ;;
    esac
  done
  printf '{"accounts":[%s]}\n' "$json" >"$SETUP_FILE" 2>/dev/null
  say "'$picked'로 진행할게요. 다음부터는 묻지 않아요."
  log "계정 선택(창에서): ${ACCOUNTS[*]:-unknown}"
}

# ---------- 상태 확인 ----------
node_major() {
  local v
  v="$(node --version 2>/dev/null)" || return 1
  v="${v#v}"
  echo "${v%%.*}"
}
node_ok() {
  local m
  m="$(node_major)" || return 1
  [ -n "$m" ] && [ "$m" -ge "$NODE_MIN_MAJOR" ] 2>/dev/null
}

logged_in() {
  if [ "$1" = claude ]; then
    claude auth status 2>/dev/null | grep -Eq '"loggedIn"[[:space:]]*:[[:space:]]*true'
  else
    # codex 는 "Logged in using ChatGPT" / "Not logged in" 을 stderr 로 낸다 — 종료 코드와 대소문자 무시 비교를 함께 본다
    local out
    out="$(codex login status 2>&1)" || return 1
    printf '%s' "$out" | grep -qi 'logged in' && ! printf '%s' "$out" | grep -qi 'not logged in'
  fi
}

files_ready() { [ -f "$ROOT/node_modules/vite/bin/vite.js" ] && [ -f "$ROOT/node_modules/.package-lock.json" ]; }
icon_ready() { [ ! -d "$HOME/Desktop" ] || [ -e "$SHORTCUT" ]; }

# hub = 이 허브가 응답 · other = 다른 프로그램이 5173 을 씀 · none = 비어 있음
hub_state() {
  local body
  if body="$(curl -s --max-time 3 "$HUB_URL" 2>/dev/null)"; then
    case "$body" in *'<title>플랫폼 담당 지식 허브</title>'*) echo hub ;; *) echo other ;; esac
  else
    echo none
  fi
}

# ---------- 단계 ----------
install_node() { # run_tool 안에서 돈다 — 출력은 모두 기록으로 간다
  local os arch key tmp ver name base expected actual
  case "$OS_NAME" in Darwin) os=darwin ;; Linux) os=linux ;; *) echo "지원하지 않는 OS: $OS_NAME"; return 1 ;; esac
  case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; x86_64) arch=x64 ;; *) echo "지원하지 않는 CPU: $(uname -m)"; return 1 ;; esac
  if [ "$os" = darwin ]; then key="osx-$arch-tar"; else key="linux-$arch"; fi
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/wiki-hub-node.XXXXXX")" || return 1
  curl -fsS --retry 2 -o "$tmp/index.json" https://nodejs.org/dist/index.json || { rm -rf "$tmp"; return 1; }
  ver="$(tr '{' '\n' <"$tmp/index.json" | grep '"lts":"' | grep "\"$key\"" | head -n 1 | sed -E 's/.*"version":"(v[0-9.]+)".*/\1/')"
  case "$ver" in v[0-9]*) ;; *) echo "LTS 버전을 찾지 못함"; rm -rf "$tmp"; return 1 ;; esac
  name="node-$ver-$os-$arch"
  base="https://nodejs.org/dist/$ver"
  echo "내려받기 $base/$name.tar.gz"
  curl -fsS --retry 2 -o "$tmp/$name.tar.gz" "$base/$name.tar.gz" || { rm -rf "$tmp"; return 1; }
  curl -fsS --retry 2 -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt" || { rm -rf "$tmp"; return 1; }
  expected="$(grep " $name.tar.gz\$" "$tmp/SHASUMS256.txt" | awk '{print $1}')"
  if has shasum; then actual="$(shasum -a 256 "$tmp/$name.tar.gz" | awk '{print $1}')"; else actual="$(sha256sum "$tmp/$name.tar.gz" | awk '{print $1}')"; fi
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then echo "체크섬 불일치: $expected / $actual"; rm -rf "$tmp"; return 1; fi
  tar -xzf "$tmp/$name.tar.gz" -C "$tmp" || { rm -rf "$tmp"; return 1; }
  mkdir -p "$HUB_HOME" && rm -rf "$NODE_DIR" && mv "$tmp/$name" "$NODE_DIR" || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  echo "설치 $NODE_DIR ($ver)"
}

install_cli() { # $1 = claude | codex. 전역 설치 대신 사용자 폴더(tools)에 깐다
  local pkg='@openai/codex'
  [ "$1" = claude ] && pkg='@anthropic-ai/claude-code'
  mkdir -p "$TOOLS_DIR" || return 1
  npm install --prefix "$TOOLS_DIR" --no-audit --no-fund "$pkg"
}

# 로그인 — 출력은 기록으로 보내고, 주소를 찾으면 브라우저를 한 번 더 연다. 3초마다 확인하고 5분이 지나면 끝낸다
connect_account() {
  local name="$1" n="$2" label out pid url opened=0 connected=0 start next
  label="$(account_label "$name")"
  step_begin 4 "$label 계정 로그인"
  say "[$n/$TOTAL] 브라우저에서 $label 계정으로 로그인해 주세요. 마치면 저절로 다음으로 넘어갑니다."
  out="$(mktemp "${TMPDIR:-/tmp}/wiki-hub-login.XXXXXX")"
  if [ "$name" = claude ]; then
    log "> claude auth login --claudeai"
    claude auth login --claudeai >"$out" 2>&1 &
  else
    log "> codex login"
    codex login >"$out" 2>&1 &
  fi
  pid=$!
  CHILD_PID=$pid
  start=$SECONDS
  next=60
  while [ $((SECONDS - start)) -lt "$LOGIN_LIMIT" ]; do
    sleep 3
    if [ "$opened" = 0 ]; then
      url="$(grep -Eo 'https://[^[:space:]]+' "$out" 2>/dev/null | head -n 1)"
      if [ -n "$url" ]; then open_url "$url"; opened=1; fi
    fi
    if logged_in "$name"; then connected=1; break; fi
    if ! kill -0 "$pid" 2>/dev/null; then
      logged_in "$name" && connected=1
      break
    fi
    if [ $((SECONDS - start)) -ge "$next" ]; then
      say "로그인을 기다리는 중이에요. 브라우저 창을 확인해 주세요."
      next=$((next + 60))
    fi
  done
  stop_tree "$pid"
  wait "$pid" 2>/dev/null
  CHILD_PID=""
  mask <"$out" >>"$LOG_FILE" 2>/dev/null
  rm -f "$out"
  if [ "$connected" = 1 ]; then
    step_end 4 0
    ok "[$n/$TOTAL] $label 계정이 연결됐어요."
    return 0
  fi
  step_end 4 1
  if [ "$opened" = 0 ] && [ $((SECONDS - start)) -lt "$LOGIN_LIMIT" ]; then
    warn "$label 로그인 화면을 열지 못했어요. 허브는 그대로 엽니다."
    warn "나중에 허브 화면의 [로그인] 버튼으로 다시 할 수 있어요. (기록 파일: $LOG_FILE)"
  else
    warn "$label 로그인이 아직 끝나지 않았어요. 허브는 그대로 엽니다."
    warn "나중에 허브 화면의 [로그인] 버튼으로 다시 할 수 있어요."
  fi
  return 1
}

make_icon() {
  # macOS에는 .lnk가 없어 심볼릭 링크를 만든다. 내려받은 ZIP의 루트 실행기가 HUB_LAUNCHER 로 자기 경로를 넘기면 그걸 가리킨다 (격리 승인을 받은 파일과 같게)
  local target="${HUB_LAUNCHER:-$ROOT/start-hub.command}"
  [ -f "$target" ] || target="$ROOT/start-hub.command"
  [ -L "$SHORTCUT" ] && rm -f "$SHORTCUT" # 폴더를 옮겨 깨진 바로가기는 새로 만든다
  ln -s "$target" "$SHORTCUT"
}

# ---------- --check (담당자용) ----------
if [ "$CHECK" = 1 ]; then
  node_ok || { [ -x "$NODE_DIR/bin/node" ] && export PATH="$NODE_DIR/bin:$PATH"; }
  read_accounts
  echo "[확인] 계정 선택: ${SETUP_STATE} ${ACCOUNTS[*]}"
  if ! node_ok; then echo "[확인] Node.js 없음 (휴대용 설치 필요: $NODE_DIR)"; exit 1; fi
  echo "[확인] Node.js $(node --version) ($(command -v node))"
  files_ready || echo "[확인] 패키지 설치 필요"
  for name in claude codex; do
    installed=false; logged=false
    if has "$name"; then installed=true; logged_in "$name" && logged=true; fi
    echo "[확인] $name: 설치=$installed 로그인=$logged ($(command -v "$name"))"
  done
  if [ -e "$SHORTCUT" ]; then echo "[확인] 바탕화면 바로가기: true"; else echo "[확인] 바탕화면 바로가기: false"; fi
  echo "[확인] 허브(5173): $(hub_state)"
  exit 0
fi

# ---------- 이미 켜져 있으면 브라우저만 ----------
if [ "$(hub_state)" = hub ]; then
  open_url "$HUB_URL"
  say "허브가 이미 켜져 있어요. 브라우저에서 엽니다."
  say "이 창은 왼쪽 위 빨간 단추로 닫아 주세요."
  exit 0
fi

# ---------- 기록 파일 ----------
mkdir -p "$LOG_DIR" 2>/dev/null
VERSION="$(sed -n 's/.*버전(담당자용): *\([^ ]*\).*/\1/p' "$ROOT/../읽어주세요.txt" 2>/dev/null | tr -d '\r' | head -n 1)"
[ -n "$VERSION" ] || VERSION="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '알 수 없음')"
OS_LABEL="$(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null)"
[ -n "${OS_LABEL// /}" ] || OS_LABEL="$(uname -sr)"

# ---------- 무엇이 남았는지 ----------
FIRST_RUN=0
files_ready || FIRST_RUN=1
read_accounts
log "===== 플랫폼 담당 지식 허브 실행 $(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S') KST · $OS_LABEL · 버전 $VERSION · 계정 선택 $([ "$SETUP_STATE" = file ] && echo "${ACCOUNTS[*]:-unknown}" || echo "$SETUP_STATE") ====="

NEED_NODE=0
if ! node_ok; then
  if [ -x "$NODE_DIR/bin/node" ]; then export PATH="$NODE_DIR/bin:$PATH"; fi
  node_ok || NEED_NODE=1
fi
log "node: $(command -v node || echo 없음) $(node --version 2>/dev/null)"

# ---------- 시작 안내 · 계정 질문 ----------
if [ "$FIRST_RUN" = 1 ] || [ "$SETUP_STATE" != file ]; then say "플랫폼 담당 지식 허브를 준비합니다."; fi
if [ "$SETUP_STATE" = broken ]; then warn "저장된 계정 선택을 읽지 못했어요. 한 번만 다시 여쭤볼게요."; fi
if [ "$SETUP_STATE" != file ]; then ask_accounts; fi

if [ "${#ACCOUNTS[@]}" -gt 0 ]; then TOTAL=5; else TOTAL=3; fi
case "${ACCOUNTS[*]}" in
  'claude codex') LABELS='Claude와 ChatGPT' ;;
  claude) LABELS='Claude' ;;
  codex) LABELS='ChatGPT' ;;
  *) LABELS='' ;;
esac

NEED_CLI=()
for name in "${ACCOUNTS[@]}"; do has "$name" || NEED_CLI+=("$name"); done
NEED_ICON=0
icon_ready || NEED_ICON=1

if [ "$FIRST_RUN" = 1 ]; then
  if [ "$TOTAL" = 5 ]; then
    say "처음에는 5~10분쯤 걸려요. 키보드는 누르지 않아도 됩니다. 중간에 브라우저가 열리면 $LABELS 계정으로 로그인만 해 주세요."
  else
    say "처음에는 3~5분쯤 걸려요. 키보드는 누르지 않아도 됩니다."
  fi
elif [ "$NEED_NODE" = 1 ] || [ "${#NEED_CLI[@]}" -gt 0 ] || [ "$NEED_ICON" = 1 ]; then
  say "남은 준비를 마저 합니다."
else
  say "준비가 이미 끝나 있어요. 허브를 켭니다."
fi
DID_WORK=0

# 1. 허브 실행 준비물 (휴대용 node — 묻지 않고 내 폴더에 설치)
if [ "$NEED_NODE" = 1 ]; then
  DID_WORK=1
  step_begin 1 "허브 실행 준비물(휴대용 node)"
  say "[1/$TOTAL] 허브 실행 준비물을 내려받는 중… (1~3분)"
  run_tool install_node
  code=$?
  step_end 1 "$code"
  [ -x "$NODE_DIR/bin/node" ] && export PATH="$NODE_DIR/bin:$PATH"
  hash -r
  if [ "$code" != 0 ] || ! node_ok; then
    stop_step "허브 실행 준비물을 설치하지 못했어요." "start-hub 를 다시 더블클릭해 보고, 같은 화면이 나오면 기록 파일을 허브 담당자에게 보내 주세요."
  fi
  ok "[1/$TOTAL] 허브 실행 준비물 설치를 마쳤어요."
fi

# 2. 허브 프로그램 파일 (npm install — 조용히 1회 재시도)
if ! files_ready; then
  DID_WORK=1
  step_begin 2 "허브 프로그램 파일(npm install)"
  say "[2/$TOTAL] 허브 프로그램 파일을 준비하는 중… (1~3분)"
  run_tool npm install --no-audit --no-fund
  code=$?
  if [ "$code" != 0 ] || ! files_ready; then
    say "한 번 더 시도하는 중…"
    run_tool npm install --no-audit --no-fund
    code=$?
  fi
  step_end 2 "$code"
  if [ "$code" != 0 ] || ! files_ready; then
    stop_step "허브 프로그램 파일을 준비하지 못했어요." "start-hub 를 다시 더블클릭해 보고, 같은 화면이 나오면 기록 파일을 허브 담당자에게 보내 주세요."
  fi
  ok "[2/$TOTAL] 허브 프로그램 파일을 준비했어요."
fi

# 3. 챗봇 연결 프로그램 (실패해도 허브는 연다)
INSTALLED_NOW=0
for name in "${NEED_CLI[@]}"; do
  DID_WORK=1
  label="$(account_label "$name")"
  step_begin 3 "$label 연결 프로그램($name)"
  say "[3/$TOTAL] $label 연결 프로그램을 설치하는 중… (1분쯤)"
  run_tool install_cli "$name" || run_tool install_cli "$name"
  code=$?
  hash -r
  step_end 3 "$code"
  if has "$name"; then
    INSTALLED_NOW=1
    ok "[3/$TOTAL] $label 연결 프로그램을 설치했어요."
  else
    warn "$label 연결 프로그램을 설치하지 못했어요. 허브는 그대로 엽니다."
    warn "나중에 허브 화면의 [연결하기] 버튼으로 다시 할 수 있어요. (기록 파일: $LOG_FILE)"
  fi
done

# 4. 내 계정 로그인 — 준비를 하는 실행(첫 실행·방금 설치)에서만 기다린다. 다음 실행부터는 허브 화면의 [로그인]으로 안내한다
NOT_CONNECTED=() # 이번 실행에서 안내하지 않은 미연결 계정 (설치·로그인 실패는 그 자리에서 이미 안내했다)
for name in "${ACCOUNTS[@]}"; do
  has "$name" || continue
  logged_in "$name" && continue
  if [ "$FIRST_RUN" = 1 ] || [ "$INSTALLED_NOW" = 1 ]; then
    DID_WORK=1
    connect_account "$name" 4
  else
    NOT_CONNECTED+=("$name")
  fi
done

# 5. 바탕화면 아이콘 (실패해도 계속)
if [ "$NEED_ICON" = 1 ]; then
  DID_WORK=1
  step_begin 5 "바탕화면 아이콘"
  if make_icon >>"$LOG_FILE" 2>&1; then
    step_end 5 0
    ok "[$TOTAL/$TOTAL] 바탕화면에 '플랫폼 담당 지식 허브' 아이콘을 만들었어요. 다음부터는 이걸 더블클릭하세요."
  else
    step_end 5 1
    warn "바탕화면 아이콘을 만들지 못했어요."
    warn "다음에도 wiki-hub 폴더의 start-hub 를 더블클릭하면 돼요."
  fi
fi

if [ "$DID_WORK" = 1 ]; then
  echo
  ok "준비가 모두 끝났어요."
fi
for name in "${NOT_CONNECTED[@]}"; do
  warn "$(account_label "$name") 계정은 아직 연결되지 않았어요. 허브는 그대로 열립니다. 나중에 허브 화면의 [로그인] 버튼으로 다시 할 수 있어요."
done

# ---------- 허브 켜기 (5173 고정) ----------
case "$(hub_state)" in
  hub)
    open_url "$HUB_URL"
    say "허브가 이미 켜져 있어요. 브라우저에서 엽니다."
    exit 0
    ;;
  other)
    log "[멈춤] 5173 을 다른 프로그램이 쓰고 있음"
    stop_with_help "다른 프로그램 때문에 허브를 켤 수 없어요." "PC를 다시 시작한 뒤 바탕화면의 플랫폼 담당 지식 허브를 더블클릭해 주세요."
    ;;
esac

say "허브를 켜는 중이에요…"
log "[허브 시작] node node_modules/vite/bin/vite.js --port $HUB_PORT --strictPort"
node "$ROOT/node_modules/vite/bin/vite.js" --port "$HUB_PORT" --strictPort >>"$LOG_FILE" 2>&1 </dev/null &
VITE_PID=$!
CHILD_PID=$VITE_PID
ready=0
for _ in $(seq 1 90); do
  sleep 1
  kill -0 "$VITE_PID" 2>/dev/null || break
  if [ "$(hub_state)" = hub ]; then ready=1; break; fi
done
if [ "$ready" != 1 ]; then
  stop_tree "$VITE_PID"
  if tail -n 30 "$LOG_FILE" 2>/dev/null | grep -qi 'already in use'; then
    stop_with_help "다른 프로그램 때문에 허브를 켤 수 없어요." "PC를 다시 시작한 뒤 바탕화면의 플랫폼 담당 지식 허브를 더블클릭해 주세요."
  fi
  stop_with_help "허브가 켜지지 않았어요." "이 창을 닫고 바탕화면의 플랫폼 담당 지식 허브를 다시 더블클릭해 주세요. 같은 화면이 나오면 기록 파일을 허브 담당자에게 보내 주세요."
fi
open_url "$HUB_URL"
ok "허브가 켜졌어요. 브라우저에서 허브가 열립니다."
say "이 창은 노란 단추로 내려 두세요. 창을 닫으면 허브가 꺼집니다."
wait "$VITE_PID"
code=$?
CHILD_PID=""
log "[허브 종료] 종료 코드 $code"
if [ "$code" != 0 ]; then
  stop_with_help "허브가 켜지지 않았어요." "이 창을 닫고 바탕화면의 플랫폼 담당 지식 허브를 다시 더블클릭해 주세요. 같은 화면이 나오면 기록 파일을 허브 담당자에게 보내 주세요."
fi
echo
say "허브가 꺼졌어요. 다시 쓰려면 바탕화면의 플랫폼 담당 지식 허브를 더블클릭하세요."
pause_exit 0
