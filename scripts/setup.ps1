﻿param([switch]$Check)
# 플랫폼 담당 지식 허브 준비·실행 — start-hub.bat 이 매번 부른다. 이미 갖춘 단계는 줄을 내지 않고 건너뛴다.
# 순서: 실행 준비물(휴대용 node) → 프로그램 파일 → 연결 프로그램 → 로그인 → 아이콘 → 허브 켜기(5173 고정) → 브라우저.
# 창에는 docs/ux/2026-11-12-local-hub-beginner-copy.md 의 한국어 줄만 낸다. 외부 도구 출력은 기록 파일로만 보낸다.
# Windows PowerShell 5.1 에서 돌아야 한다 — 삼항 연산자·?? 를 쓰지 않는다. 파일은 UTF-8 BOM 을 유지한다.
# -Check: 아무것도 설치·생성하지 않고 상태만 출력한다(담당자용).

$ErrorActionPreference = 'Continue'
# 5.1 진행 표시줄은 창에 영어를 내고 내려받기도 크게 늦춘다
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
try { $Host.UI.RawUI.WindowTitle = '플랫폼 담당 지식 허브' } catch { }
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$HubUrl = 'http://localhost:5173/'
$HubPort = 5173
$NodeMinMajor = 18
$LoginLimit = 300
# 휴대용 실행 준비물·연결 프로그램 자리 (server/env.ts readHubHomeDir 와 같다). 관리자 권한 없이 쓸 수 있는 LOCALAPPDATA 아래
$hubHome = Join-Path $env:LOCALAPPDATA 'wiki-hub'
$nodeDir = Join-Path $hubHome 'node'
$toolsDir = Join-Path $hubHome 'tools'
$toolsBin = Join-Path $toolsDir 'node_modules\.bin'
$logDir = Join-Path $env:USERPROFILE 'wiki-hub-기록'
$logFile = Join-Path $logDir '설치기록.txt'
$setupFile = Join-Path $root 'hub-setup.json'
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) '플랫폼 담당 지식 허브.lnk'
$labels = @{ claude = 'Claude'; codex = 'ChatGPT' }
$packages = @{ claude = '@anthropic-ai/claude-code'; codex = '@openai/codex' }

$env:Path = $toolsBin + ';' + $env:Path

function Say($text, $color) {
  if ($color) { Write-Host $text -ForegroundColor $color } else { Write-Host $text }
}
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# 기록 파일에 한 줄 붙인다. cmd 리디렉션이 같은 파일을 쥐고 있어도 쓸 수 있게 공유 모드로 연다
function Write-Log([string]$text) {
  if ($Check) { return }
  try {
    $fs = New-Object IO.FileStream($logFile, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($text + "`r`n")
    $fs.Write($bytes, 0, $bytes.Length)
    $fs.Close()
  } catch { }
}
function Read-Shared([string]$path) {
  try {
    $fs = New-Object IO.FileStream($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $reader = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    $reader.Close()
    return $text
  } catch { return '' }
}
# 기록에 로그인 주소의 쿼리(일회용 코드)·토큰을 남기지 않는다
function Hide-Secret([string]$text) {
  $text = $text -replace '(https?://[^\s?]+)\?\S+', '$1?***'
  return ($text -replace '(?i)((token|code|password|secret)[=:]\s*)\S+', '$1***')
}
function New-TempFile { Join-Path $env:TEMP ('wiki-hub-' + [guid]::NewGuid().ToString('N') + '.txt') }

$script:failKind = ''
# 외부 도구 출력·예외 문구에서 원인을 가른다 — 회사망 인증서 · 인터넷 없음 · 저장 공간 부족
function Set-FailKind([string]$text) {
  if ($text -match '(?i)SELF_SIGNED_CERT|UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY_LEAF|CERT_HAS_EXPIRED|certificate|SSL|TLS|trust relationship|인증서|신뢰 관계') { $script:failKind = 'cert' }
  elseif ($text -match '(?i)ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|remote name could not be resolved|Unable to connect|timed out|원격 이름을 확인할 수 없습니다|연결할 수 없습니다|시간이 초과') { $script:failKind = 'net' }
  elseif ($text -match '(?i)ENOSPC|not enough space|디스크 공간') { $script:failKind = 'space' }
  else { $script:failKind = '' }
}

# 외부 도구를 창에 아무것도 내지 않고 실행한다. 출력은 임시 파일 → 가려서 기록에 붙이고, 2분을 넘으면 1분마다 안내한다
function Invoke-Tool([string]$cmdline) {
  $out = New-TempFile
  Write-Log "> $cmdline"
  $p = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /s /c `"$cmdline >`"$out`" 2>&1 <nul`"" -WorkingDirectory $root -NoNewWindow -PassThru
  # 5.1 은 Handle 을 먼저 잡아 두지 않으면 끝난 뒤 ExitCode 가 비어 있다
  $null = $p.Handle
  $started = Get-Date
  $notice = 120
  while (-not $p.WaitForExit(1000)) {
    if (((Get-Date) - $started).TotalSeconds -ge $notice) { Say '아직 진행 중이에요. 창을 닫지 마세요.'; $notice += 60 }
  }
  $text = Read-Shared $out
  Remove-Item $out -ErrorAction SilentlyContinue
  Set-FailKind $text
  Write-Log (Hide-Secret $text)
  return $p.ExitCode
}

$script:stepStarted = Get-Date
function Step-Begin($n, $name) { $script:stepStarted = Get-Date; Write-Log "[단계 $n 시작] $name" }
function Step-End($n, $code) { Write-Log ("[단계 $n 끝] 종료 코드 $code · {0:N0}초" -f ((Get-Date) - $script:stepStarted).TotalSeconds) }

function Close-Window($code) {
  Write-Host ''
  Say '아무 키나 누르면 창이 닫힙니다.'
  cmd /c 'pause >nul'
  exit $code
}
# 멈추는 실패 — 문제 한 줄 · 지금 할 일 · 기록 위치를 보이고 기록 폴더를 연다
function Stop-WithHelp($problem, $todo) {
  Write-Log "[멈춤] $problem"
  Write-Host ''
  Say $problem Red
  Say "지금 할 일: $todo"
  Say "기록 파일: $logFile"
  try { Start-Process explorer.exe "/select,`"$logFile`"" } catch { }
  Say '기록 파일이 있는 폴더를 열어 두었어요.'
  Close-Window 1
}
function Stop-Step($problem, $todo) {
  switch ($script:failKind) {
    'cert' { Stop-WithHelp '회사 네트워크 보안 때문에 내려받기가 막혔어요.' '기록 파일을 허브 담당자에게 보내 주세요.' }
    'net' { Stop-WithHelp '인터넷에 연결되지 않아 내려받지 못했어요.' '인터넷 연결을 확인한 뒤 start-hub 를 다시 더블클릭해 주세요.' }
    'space' { Stop-WithHelp 'PC 저장 공간이 부족해요.' '필요 없는 파일을 지워 공간을 비운 뒤 start-hub 를 다시 더블클릭해 주세요.' }
    default { Stop-WithHelp $problem $todo }
  }
}

# ---------- 상태 확인 ----------
function Get-NodeMajor {
  try {
    $v = (& node --version 2>$null | Out-String).Trim()
    if ($v -match '^v(\d+)\.') { return [int]$Matches[1] }
  } catch { }
  return 0
}
function Test-NodeOk { (Has node) -and ((Get-NodeMajor) -ge $NodeMinMajor) }
function Use-PortableNode {
  if (Test-Path (Join-Path $nodeDir 'node.exe')) { $env:Path = $nodeDir + ';' + $env:Path }
}

function Test-LoggedIn($name) {
  if ($name -eq 'claude') {
    try { return ((claude auth status 2>$null | Out-String | ConvertFrom-Json).loggedIn -eq $true) } catch { return $false }
  }
  # codex 는 "Logged in using ChatGPT" / "Not logged in" 을 stderr 로 낸다. -match 는 대소문자를 가리지 않는다
  $out = codex login status 2>&1 | Out-String
  return ($LASTEXITCODE -eq 0 -and $out -match 'logged in' -and $out -notmatch 'not logged in')
}

function Test-FilesReady {
  (Test-Path (Join-Path $root 'node_modules\vite\bin\vite.js')) -and (Test-Path (Join-Path $root 'node_modules\.package-lock.json'))
}
function Test-IconReady {
  if (-not (Test-Path $shortcut)) { return $false }
  # 폴더를 옮겨 깨진 바로가기는 새로 만든다
  try { return (Test-Path ((New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath)) } catch { return $true }
}

# hub = 이 허브가 응답 · other = 다른 프로그램이 5173 을 씀 · none = 비어 있음
function Get-HubState {
  try {
    $req = [Net.HttpWebRequest]::Create($HubUrl)
    # 회사 PC 프록시 설정이 내 PC 주소 확인을 가로채지 않게 프록시를 끈다
    $req.Proxy = $null
    $req.Timeout = 3000
    $res = $req.GetResponse()
    $reader = New-Object IO.StreamReader($res.GetResponseStream(), [Text.Encoding]::UTF8)
    $html = $reader.ReadToEnd()
    $reader.Close()
    $res.Close()
    if ($html -match '<title>플랫폼 담당 지식 허브</title>') { return 'hub' }
    return 'other'
  } catch [Net.WebException] {
    if ($_.Exception.Response) { return 'other' }
    return 'none'
  } catch { return 'none' }
}

# ---------- 계정 선택 ----------
$script:accounts = @()
$script:setupState = 'missing'
function Read-Accounts {
  $script:accounts = @()
  $script:setupState = 'missing'
  if (-not (Test-Path $setupFile)) { return }
  try { $json = [IO.File]::ReadAllText($setupFile) | ConvertFrom-Json } catch { $json = $null }
  if ($null -eq $json -or $null -eq $json.PSObject.Properties['accounts']) { $script:setupState = 'broken'; return }
  $script:setupState = 'file'
  foreach ($name in 'claude', 'codex') { if (@($json.accounts) -contains $name) { $script:accounts += $name } }
}

function Request-Accounts {
  Say '처음 한 번만 여쭤볼게요. 어떤 AI 계정을 쓰고 계신가요?'
  Say '번호 키를 하나 눌러 주세요.'
  Say '  1  Claude'
  Say '  2  ChatGPT (Codex)'
  Say '  3  둘 다'
  Say '  4  잘 모르겠어요 (설치 없이 허브만 엽니다)'
  $choices = @{
    '1' = @('Claude', @('claude'))
    '2' = @('ChatGPT (Codex)', @('codex'))
    '3' = @('둘 다', @('claude', 'codex'))
    '4' = @('잘 모르겠어요', @())
  }
  while ($true) {
    # 입력을 받을 수 없으면(창 없이 실행) 설치 없이 허브만 연다
    try { $key = [string][Console]::ReadKey($true).KeyChar } catch { $key = '4' }
    if ($choices.ContainsKey($key)) { break }
    Say '1, 2, 3, 4 중 하나를 눌러 주세요.'
  }
  $script:accounts = @($choices[$key][1])
  $list = ($script:accounts | ForEach-Object { '"' + $_ + '"' }) -join ','
  try { [IO.File]::WriteAllText($setupFile, '{"accounts":[' + $list + ']}' + "`n", (New-Object Text.UTF8Encoding($false))) } catch { }
  Say ("'{0}'로 진행할게요. 다음부터는 묻지 않아요." -f $choices[$key][0])
  Write-Log ("계정 선택(창에서): " + ($script:accounts -join ' '))
}

# ---------- 단계 ----------
function Install-PortableNode {
  # Windows PowerShell 5.1 기본값으로는 TLS 1.2를 쓰지 않아 nodejs.org 접속이 막힌다
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $arch = 'x64'
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
  # 5.1은 JSON 배열을 한 덩어리로 넘기므로 변수에 담은 뒤 펼친다
  $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $lts = $index | Where-Object { $_.lts -and $_.files -contains "win-$arch-zip" } | Select-Object -First 1
  if (-not $lts) { throw "LTS with win-$arch-zip not found" }
  $name = "node-$($lts.version)-win-$arch"
  $base = "https://nodejs.org/dist/$($lts.version)"
  $zip = Join-Path $env:TEMP "$name.zip"
  $unpack = Join-Path $hubHome 'node-new'
  try {
    Write-Log "내려받기 $base/$name.zip"
    Invoke-WebRequest "$base/$name.zip" -OutFile $zip -UseBasicParsing
    $sums = [string](Invoke-RestMethod "$base/SHASUMS256.txt" -UseBasicParsing)
    $line = ($sums -split "`n") | Where-Object { $_ -match ('\s' + [regex]::Escape("$name.zip") + '\s*$') } | Select-Object -First 1
    if (-not $line) { throw "checksum for $name.zip not found" }
    $expected = ($line -split '\s+')[0]
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash
    if ($actual -ne $expected) { throw "checksum mismatch $expected / $actual" }
    if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $unpack | Out-Null
    # Expand-Archive 보다 빠르다 (5.1 의 Expand-Archive 는 수 분 걸린다)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $unpack)
    if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
    Move-Item (Join-Path $unpack $name) $nodeDir
    Write-Log "설치 $nodeDir ($($lts.version))"
  } finally {
    Remove-Item $zip -ErrorAction SilentlyContinue
    if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

# 로그인 — 출력은 기록으로 보내고, 주소를 찾으면 브라우저를 한 번 더 연다. 3초마다 확인하고 5분이 지나면 끝낸다
function Connect-Account($name, $n, $total) {
  $label = $labels[$name]
  Step-Begin 4 "$label 계정 로그인"
  Say "[$n/$total] 브라우저에서 $label 계정으로 로그인해 주세요. 마치면 저절로 다음으로 넘어갑니다."
  $cmd = 'codex login'
  if ($name -eq 'claude') { $cmd = 'claude auth login --claudeai' }
  $out = New-TempFile
  Write-Log "> $cmd"
  $p = $null
  try {
    # 입력은 그대로 둔다(로그인 프로그램이 드물게 붙여 넣기를 기다린다). 같은 창에 붙여 Ctrl+C·창 닫기 때 함께 끝나게 한다
    $p = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /s /c `"$cmd >`"$out`" 2>&1`"" -WorkingDirectory $root -NoNewWindow -PassThru
    $null = $p.Handle
  } catch { Write-Log $_.Exception.Message }
  $started = Get-Date
  $opened = $false
  $connected = $false
  $notice = 60
  while ($p -and ((Get-Date) - $started).TotalSeconds -lt $LoginLimit) {
    Start-Sleep -Seconds 3
    if (-not $opened) {
      $m = [regex]::Match((Read-Shared $out), 'https://\S+')
      if ($m.Success) { try { Start-Process $m.Value } catch { }; $opened = $true }
    }
    if (Test-LoggedIn $name) { $connected = $true; break }
    if ($p.HasExited) { $connected = (Test-LoggedIn $name); break }
    if (((Get-Date) - $started).TotalSeconds -ge $notice) { Say '로그인을 기다리는 중이에요. 브라우저 창을 확인해 주세요.'; $notice += 60 }
  }
  # 남겨 두면 codex 가 1455 포트를 쥔 채 남아 다음 로그인이 실패한다
  if ($p -and -not $p.HasExited) { & taskkill.exe /T /F /PID $p.Id *> $null }
  Write-Log (Hide-Secret (Read-Shared $out))
  Remove-Item $out -ErrorAction SilentlyContinue
  if ($connected) {
    Step-End 4 0
    Say "[$n/$total] $label 계정이 연결됐어요." Green
    return
  }
  Step-End 4 1
  if (-not $opened -and ((Get-Date) - $started).TotalSeconds -lt $LoginLimit) {
    Say "$label 로그인 화면을 열지 못했어요. 허브는 그대로 엽니다." Yellow
    Say "나중에 허브 화면의 [로그인] 버튼으로 다시 할 수 있어요. (기록 파일: $logFile)" Yellow
  } else {
    Say "$label 로그인이 아직 끝나지 않았어요. 허브는 그대로 엽니다." Yellow
    Say '나중에 허브 화면의 [로그인] 버튼으로 다시 할 수 있어요.' Yellow
  }
}

# ---------- -Check (담당자용) ----------
if ($Check) {
  if (-not (Test-NodeOk)) { Use-PortableNode }
  Read-Accounts
  Write-Host ("[확인] 계정 선택: {0} {1}" -f $script:setupState, ($script:accounts -join ' '))
  if (-not (Test-NodeOk)) { Write-Host "[확인] Node.js 없음 (휴대용 설치 필요: $nodeDir)"; exit 1 }
  Write-Host ("[확인] Node.js {0} ({1})" -f (node --version), (Get-Command node).Source)
  if (-not (Test-FilesReady)) { Write-Host '[확인] 패키지 설치 필요' }
  foreach ($name in 'claude', 'codex') {
    $installed = Has $name
    Write-Host ("[확인] {0}: 설치={1} 로그인={2}" -f $name, $installed, ($installed -and (Test-LoggedIn $name)))
  }
  Write-Host ("[확인] 바탕화면 바로가기: {0}" -f (Test-Path $shortcut))
  Write-Host ("[확인] 허브(5173): {0}" -f (Get-HubState))
  exit 0
}

# ---------- 이미 켜져 있으면 브라우저만 ----------
if ((Get-HubState) -eq 'hub') {
  try { Start-Process $HubUrl } catch { }
  Say '허브가 이미 켜져 있어요. 브라우저에서 엽니다.'
  Say '이 창은 5초 뒤 저절로 닫혀요.'
  Start-Sleep -Seconds 5
  exit 0
}

# ---------- 기록 파일 ----------
New-Item -ItemType Directory -Force -Path $logDir -ErrorAction SilentlyContinue | Out-Null
$version = '알 수 없음'
try {
  $readme = [IO.File]::ReadAllText((Join-Path (Split-Path -Parent $root) '읽어주세요.txt'))
  if ($readme -match '버전\(담당자용\):\s*(\S+)') { $version = $Matches[1] }
} catch { }

# ---------- 무엇이 남았는지 ----------
$firstRun = -not (Test-FilesReady)
Read-Accounts
$choiceLog = $script:setupState
if ($script:setupState -eq 'file') { $choiceLog = 'unknown'; if ($script:accounts.Count) { $choiceLog = $script:accounts -join ' ' } }
Write-Log ("===== 플랫폼 담당 지식 허브 실행 {0} KST · {1} · 버전 {2} · 계정 선택 {3} =====" -f [DateTime]::UtcNow.AddHours(9).ToString('yyyy-MM-dd HH:mm:ss'), [Environment]::OSVersion.VersionString, $version, $choiceLog)

$needNode = $false
if (-not (Test-NodeOk)) {
  Use-PortableNode
  $needNode = -not (Test-NodeOk)
}
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) { Write-Log ("node: {0} {1}" -f $nodeCmd.Source, (node --version)) } else { Write-Log 'node: 없음' }

# ---------- 시작 안내 · 계정 질문 ----------
if ($firstRun -or $script:setupState -ne 'file') { Say '플랫폼 담당 지식 허브를 준비합니다.' }
if ($script:setupState -eq 'broken') { Say '저장된 계정 선택을 읽지 못했어요. 한 번만 다시 여쭤볼게요.' Yellow }
if ($script:setupState -ne 'file') { Request-Accounts }

$total = 3
if ($script:accounts.Count) { $total = 5 }
$accountsLabel = (($script:accounts | ForEach-Object { $labels[$_] }) -join '와 ')
$needCli = @($script:accounts | Where-Object { -not (Has $_) })
$needIcon = -not (Test-IconReady)

if ($firstRun) {
  if ($total -eq 5) { Say "처음에는 5~10분쯤 걸려요. 키보드는 누르지 않아도 됩니다. 중간에 브라우저가 열리면 $accountsLabel 계정으로 로그인만 해 주세요." }
  else { Say '처음에는 3~5분쯤 걸려요. 키보드는 누르지 않아도 됩니다.' }
} elseif ($needNode -or $needCli.Count -or $needIcon) {
  Say '남은 준비를 마저 합니다.'
} else {
  Say '준비가 이미 끝나 있어요. 허브를 켭니다.'
}
$didWork = $false

# 1. 허브 실행 준비물 (휴대용 node — 묻지 않고 내 폴더에 설치)
if ($needNode) {
  $didWork = $true
  Step-Begin 1 '허브 실행 준비물(휴대용 node)'
  Say "[1/$total] 허브 실행 준비물을 내려받는 중… (1~3분)"
  $code = 0
  try { Install-PortableNode } catch {
    $code = 1
    $message = $_.Exception.Message
    Write-Log $message
    Set-FailKind $message
  }
  Use-PortableNode
  Step-End 1 $code
  if ($code -ne 0 -or -not (Test-NodeOk)) {
    Stop-Step '허브 실행 준비물을 설치하지 못했어요.' 'start-hub 를 다시 더블클릭해 보고, 같은 화면이 나오면 기록 파일을 허브 담당자에게 보내 주세요.'
  }
  Say "[1/$total] 허브 실행 준비물 설치를 마쳤어요." Green
}

# 2. 허브 프로그램 파일 (npm install — 조용히 1회 재시도)
if (-not (Test-FilesReady)) {
  $didWork = $true
  Step-Begin 2 '허브 프로그램 파일(npm install)'
  Say "[2/$total] 허브 프로그램 파일을 준비하는 중… (1~3분)"
  $code = Invoke-Tool 'npm install --no-audit --no-fund'
  if ($code -ne 0 -or -not (Test-FilesReady)) {
    Say '한 번 더 시도하는 중…'
    $code = Invoke-Tool 'npm install --no-audit --no-fund'
  }
  Step-End 2 $code
  if ($code -ne 0 -or -not (Test-FilesReady)) {
    Stop-Step '허브 프로그램 파일을 준비하지 못했어요.' 'start-hub 를 다시 더블클릭해 보고, 같은 화면이 나오면 기록 파일을 허브 담당자에게 보내 주세요.'
  }
  Say "[2/$total] 허브 프로그램 파일을 준비했어요." Green
}

# 3. 챗봇 연결 프로그램 — 전역 설치 대신 사용자 폴더(tools)에 깐다. 실패해도 허브는 연다
$installedNow = $false
foreach ($name in $needCli) {
  $didWork = $true
  $label = $labels[$name]
  Step-Begin 3 "$label 연결 프로그램($name)"
  Say "[3/$total] $label 연결 프로그램을 설치하는 중… (1분쯤)"
  New-Item -ItemType Directory -Force -Path $toolsDir -ErrorAction SilentlyContinue | Out-Null
  $cmdline = "npm install --prefix `"$toolsDir`" --no-audit --no-fund $($packages[$name])"
  $code = Invoke-Tool $cmdline
  if ($code -ne 0) { $code = Invoke-Tool $cmdline }
  Step-End 3 $code
  if (Has $name) {
    $installedNow = $true
    Say "[3/$total] $label 연결 프로그램을 설치했어요." Green
  } else {
    Say "$label 연결 프로그램을 설치하지 못했어요. 허브는 그대로 엽니다." Yellow
    Say "나중에 허브 화면의 [연결하기] 버튼으로 다시 할 수 있어요. (기록 파일: $logFile)" Yellow
  }
}

# 4. 내 계정 로그인 — 준비를 하는 실행(첫 실행·방금 설치)에서만 기다린다. 다음 실행부터는 허브 화면의 [로그인]으로 안내한다
$notConnected = @()
foreach ($name in $script:accounts) {
  if (-not (Has $name)) { continue } # 설치 실패는 3단계에서 이미 안내했다
  if (Test-LoggedIn $name) { continue }
  if ($firstRun -or $installedNow) {
    $didWork = $true
    Connect-Account $name 4 $total
  } else {
    $notConnected += $name
  }
}

# 5. 바탕화면 아이콘 (실패해도 계속)
if ($needIcon) {
  $didWork = $true
  Step-Begin 5 '바탕화면 아이콘'
  try {
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
    # 내려받은 ZIP의 루트 실행기가 HUB_LAUNCHER 로 자기 경로를 넘기면 그걸 가리킨다 (실무자가 직접 누른 파일과 같게)
    $launcher = Join-Path $root 'start-hub.bat'
    if ($env:HUB_LAUNCHER -and (Test-Path $env:HUB_LAUNCHER)) { $launcher = $env:HUB_LAUNCHER }
    $link.TargetPath = $launcher
    $link.WorkingDirectory = Split-Path -Parent $launcher
    $link.Save()
    Step-End 5 0
    Say "[$total/$total] 바탕화면에 '플랫폼 담당 지식 허브' 아이콘을 만들었어요. 다음부터는 이걸 더블클릭하세요." Green
  } catch {
    Write-Log $_.Exception.Message
    Step-End 5 1
    Say '바탕화면 아이콘을 만들지 못했어요.' Yellow
    Say '다음에도 wiki-hub 폴더의 start-hub 를 더블클릭하면 돼요.' Yellow
  }
}

if ($didWork) {
  Write-Host ''
  Say '준비가 모두 끝났어요.' Green
}
foreach ($name in $notConnected) {
  Say "$($labels[$name]) 계정은 아직 연결되지 않았어요. 허브는 그대로 열립니다. 나중에 허브 화면의 [로그인] 버튼으로 다시 할 수 있어요." Yellow
}

# ---------- 허브 켜기 (5173 고정) ----------
$state = Get-HubState
if ($state -eq 'hub') {
  try { Start-Process $HubUrl } catch { }
  Say '허브가 이미 켜져 있어요. 브라우저에서 엽니다.'
  Say '이 창은 5초 뒤 저절로 닫혀요.'
  Start-Sleep -Seconds 5
  exit 0
}
if ($state -eq 'other') {
  Write-Log '5173 을 다른 프로그램이 쓰고 있음'
  Stop-WithHelp '다른 프로그램 때문에 허브를 켤 수 없어요.' 'PC를 다시 시작한 뒤 바탕화면의 플랫폼 담당 지식 허브를 더블클릭해 주세요.'
}

Say '허브를 켜는 중이에요…'
$vite = Join-Path $root 'node_modules\vite\bin\vite.js'
Write-Log "[허브 시작] node vite.js --port $HubPort --strictPort"
# 배치 파일이 아닌 node 를 바로 띄워 Ctrl+C 때 "일괄 작업을 끝내시겠습니까" 질문이 나오지 않게 한다. 출력은 기록 파일로만
$hub = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /s /c `"node `"$vite`" --port $HubPort --strictPort >>`"$logFile`" 2>&1 <nul`"" -WorkingDirectory $root -NoNewWindow -PassThru
$null = $hub.Handle
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 1
  if ($hub.HasExited) { break }
  if ((Get-HubState) -eq 'hub') { $ready = $true; break }
}
if (-not $ready) {
  if (-not $hub.HasExited) { & taskkill.exe /T /F /PID $hub.Id *> $null }
  $tail = (Read-Shared $logFile) -split "`n" | Select-Object -Last 30
  if (($tail -join "`n") -match '(?i)already in use') {
    Stop-WithHelp '다른 프로그램 때문에 허브를 켤 수 없어요.' 'PC를 다시 시작한 뒤 바탕화면의 플랫폼 담당 지식 허브를 더블클릭해 주세요.'
  }
  Stop-WithHelp '허브가 켜지지 않았어요.' '이 창을 닫고 바탕화면의 플랫폼 담당 지식 허브를 다시 더블클릭해 주세요. 같은 화면이 나오면 기록 파일을 허브 담당자에게 보내 주세요.'
}
try { Start-Process $HubUrl } catch { }
Say '허브가 켜졌어요. 브라우저에서 허브가 열립니다.' Green
Say '이 창은 최소화해 두세요. 창을 닫으면 허브가 꺼집니다.'
$hub.WaitForExit()
Write-Log "[허브 종료] 종료 코드 $($hub.ExitCode)"
if ($hub.ExitCode -ne 0) {
  Stop-WithHelp '허브가 켜지지 않았어요.' '이 창을 닫고 바탕화면의 플랫폼 담당 지식 허브를 다시 더블클릭해 주세요. 같은 화면이 나오면 기록 파일을 허브 담당자에게 보내 주세요.'
}
Write-Host ''
Say '허브가 꺼졌어요. 다시 쓰려면 바탕화면의 플랫폼 담당 지식 허브를 더블클릭하세요.'
Close-Window 0
