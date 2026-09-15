param([switch]$Check)
# 플랫폼 담당 지식 허브 첫 실행 세팅 — start-hub.bat 이 매번 호출한다. 이미 갖춰진 항목은 조용히 건너뛴다.
# -Check: 아무것도 설치·생성하지 않고 상태만 출력한다.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Ask($question) {
  if ($Check) { return $false }
  return ((Read-Host "$question (Y/N)") -match '^[Yy]')
}
function Update-SessionPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

$cli = [ordered]@{ claude = '@anthropic-ai/claude-code'; codex = '@openai/codex' }

function Test-LoggedIn($name) {
  if ($name -eq 'claude') {
    try { return ((claude auth status 2>$null | Out-String | ConvertFrom-Json).loggedIn -eq $true) } catch { return $false }
  }
  $out = codex login status 2>&1 | Out-String
  return ($LASTEXITCODE -eq 0 -and $out -match 'logged in' -and $out -notmatch 'not logged in')
}

# 1. Node.js
if (-not (Has node)) {
  Write-Host '[필요] Node.js가 설치되어 있지 않습니다.' -ForegroundColor Yellow
  if ((Has winget) -and (Ask 'Node.js LTS를 지금 설치할까요?')) {
    winget install -e --id OpenJS.NodeJS.LTS
    Update-SessionPath
  }
  if (-not (Has node)) {
    Write-Host 'Node.js를 설치한 뒤 다시 실행해 주세요: https://nodejs.org' -ForegroundColor Yellow
    exit 1
  }
}

# 2. 챗봇용 CLI 설치
foreach ($name in $cli.Keys) {
  if ((Has $name) -or $Check) { continue }
  Write-Host "[안내] $name CLI가 없습니다. 없어도 허브는 쓸 수 있고, 챗봇은 다른 CLI나 규칙 기반으로 답합니다." -ForegroundColor Yellow
  if (Ask "$name CLI를 설치할까요?") {
    npm i -g $cli[$name]
    Update-SessionPath
  }
}

# 3. CLI 로그인
foreach ($name in $cli.Keys) {
  if ($Check -or -not (Has $name) -or (Test-LoggedIn $name)) { continue }
  Write-Host "[안내] $name CLI 로그인이 필요합니다." -ForegroundColor Yellow
  if (Ask "지금 $name 에 로그인할까요? (브라우저가 열립니다)") {
    if ($name -eq 'claude') { claude auth login } else { codex login }
  }
}

# 4. 바탕화면 바로가기
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) '플랫폼 담당 지식 허브.lnk'
if (-not $Check -and -not (Test-Path $shortcut)) {
  $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
  $link.TargetPath = Join-Path $root 'start-hub.bat'
  $link.WorkingDirectory = $root
  $link.Save()
  Write-Host "[완료] 바탕화면에 '플랫폼 담당 지식 허브' 바로가기를 만들었습니다. 다음부터는 그걸 더블클릭하세요." -ForegroundColor Green
}

# 5. 패키지
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  if ($Check) {
    Write-Host '[확인] 패키지 설치 필요'
  } else {
    Write-Host '처음 실행이라 필요한 패키지를 설치합니다. 1~2분 걸릴 수 있어요...'
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Host '[오류] 패키지 설치에 실패했습니다.' -ForegroundColor Red; exit 1 }
  }
}

if ($Check) {
  Write-Host ("[확인] Node.js {0}" -f (node --version))
  foreach ($name in $cli.Keys) {
    $installed = Has $name
    Write-Host ("[확인] {0}: 설치={1} 로그인={2}" -f $name, $installed, ($installed -and (Test-LoggedIn $name)))
  }
  Write-Host ("[확인] 바탕화면 바로가기: {0}" -f (Test-Path $shortcut))
}
exit 0
