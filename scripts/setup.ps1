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
  $tried = Ask 'Node.js LTS를 지금 설치할까요?'
  if ($tried) {
    if (Has winget) {
      Write-Host 'winget으로 Node.js를 설치합니다...'
      # 원본을 winget으로 고정한다. Microsoft Store 원본 확인(SSL·인증서 폐기 확인)에 실패해도 winget 원본으로 설치되게 한다
      winget install -e --id OpenJS.NodeJS.LTS --source winget --accept-source-agreements --accept-package-agreements
      Update-SessionPath
      if (-not (Has node)) { Write-Host '[실패] winget 설치가 끝나지 않았습니다. 설치 파일을 직접 받아 봅니다.' -ForegroundColor Yellow }
    }
    if (-not (Has node)) {
      $msi = $null
      try {
        # Windows PowerShell 5.1 기본값으로는 TLS 1.2를 쓰지 않아 nodejs.org 접속이 막힌다
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Write-Host '최신 LTS 버전을 확인하는 중...'
        # 5.1은 JSON 배열을 한 덩어리로 넘기므로 변수에 담은 뒤 펼친다
        $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
        $lts = $index | Where-Object { $_.lts -and $_.files -contains 'win-x64-msi' } | Select-Object -First 1
        if (-not $lts) { throw 'LTS 버전을 찾지 못했습니다' }
        $msi = Join-Path $env:TEMP "node-$($lts.version)-x64.msi"
        Write-Host "Node.js $($lts.version) 설치 파일을 받는 중... 1~2분 걸릴 수 있어요"
        # 5.1의 진행 표시줄은 내려받기를 크게 늦춰서 끄고, 단계 안내로 대신한다
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest "https://nodejs.org/dist/$($lts.version)/node-$($lts.version)-x64.msi" -OutFile $msi -UseBasicParsing
        $ProgressPreference = 'Continue'
        Write-Host '설치 중입니다. 관리자 권한 창이 뜨면 [예]를 눌러 주세요...'
        $proc = Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/passive', '/norestart' -Wait -PassThru
        # 3010 = 설치는 됐고 재부팅만 권장
        if ($proc.ExitCode -eq 1602) { throw '설치를 취소했습니다' }
        if ($proc.ExitCode -notin 0, 3010) { throw "설치 프로그램이 오류 코드 $($proc.ExitCode)로 끝났습니다" }
        # MSI는 PATH를 Machine에 넣는다. 이 창에 바로 반영되도록 다시 읽는다
        Update-SessionPath
      } catch {
        $ProgressPreference = 'Continue'
        Write-Host ('[실패] Node.js 자동 설치: ' + ($_.Exception.Message -replace '\s+', ' ')) -ForegroundColor Yellow
      } finally {
        if ($msi) { Remove-Item $msi -ErrorAction SilentlyContinue }
      }
    }
  }
  if (-not (Has node)) {
    if ($tried) {
      Write-Host '브라우저에서 Node.js 내려받기 페이지를 엽니다.' -ForegroundColor Yellow
      try { Start-Process 'https://nodejs.org/ko/download' } catch { }
    }
    Write-Host 'LTS 설치 파일(.msi)을 받아 설치한 뒤, 이 창을 닫고 다시 실행해 주세요: https://nodejs.org/ko/download' -ForegroundColor Yellow
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
  # 내려받은 ZIP의 루트 실행기가 HUB_LAUNCHER 로 자기 경로를 넘기면 그걸 가리킨다 (실무자가 직접 누른 파일과 같게)
  $launcher = if ($env:HUB_LAUNCHER -and (Test-Path $env:HUB_LAUNCHER)) { $env:HUB_LAUNCHER } else { Join-Path $root 'start-hub.bat' }
  $link.TargetPath = $launcher
  $link.WorkingDirectory = Split-Path -Parent $launcher
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
