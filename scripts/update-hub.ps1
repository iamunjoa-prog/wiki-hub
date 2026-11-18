# 켤 때 스스로 최신으로 바꾸는 단계 — setup.ps1 이 점 소싱해 Update-Hub 를 부른다. 기록은 setup.ps1 의 Write-Log 를 쓴다.
# 최신 커밋은 공개 저장소의 git 광고(info/refs — API 호출 한도에 걸리지 않는다)로, 파일은 codeload 압축으로 받는다. 토큰·배포 주소가 필요 없다.
# 바꾸는 것은 새 버전에 든 최상위 항목뿐이다. node_modules·hub-setup.json·.env 계열·새 버전에 없는 항목은 그대로 둔다.
# 바꾸기 전 항목은 ..\.hub-backup 으로 옮겨 두고, 중간에 실패하면 되돌린다. 창이 닫혀 끊겼으면 다음 실행 때 되돌린다.
# Windows PowerShell 5.1 에서 돌아야 한다. 파일은 UTF-8 BOM 을 유지한다.

$HubVersionName = '.hub-version'
# 확인 때문에 켜지는 시간이 늘지 않게 짧게. 받기는 1MB 안팎이라 넉넉히
$UpdateCheckTimeoutMs = 4000
$UpdateDownloadTimeoutSec = 60
# 새 버전에 들어 있어도 건드리지 않는 이름 — 내 PC에서 생긴 것들
$UpdateKeepNames = @('node_modules', 'hub-setup.json', '.git')
# 업데이트 단계 결과: updated · latest · skipped · offline(확인 실패) · failed(받기·바꾸기 실패, 되돌림)
$script:hubUpdateTo = ''

function Test-KeepName([string]$name) {
  if ($UpdateKeepNames -contains $name) { return $true }
  # .env.example 은 저장소 파일이라 바꾸고, 그 밖의 .env 계열(.env · .env.local 등)은 내 설정이라 둔다
  return ($name -like '.env*' -and $name -ne '.env.example')
}

function Read-HubVersion([string]$root) {
  $file = Join-Path $root $HubVersionName
  if (-not (Test-Path $file)) { return $null }
  try { $json = [IO.File]::ReadAllText($file) | ConvertFrom-Json } catch { return $null }
  if ($null -eq $json) { return $null }
  $version = [string]$json.version
  $repo = [string]$json.repo
  if ($version -notmatch '^[0-9a-f]{7,40}$' -or $repo -notmatch '^[\w.-]+/[\w.-]+$') { return $null }
  return @{ version = $version; repo = $repo }
}

# 기본 브랜치 끝 커밋(40자리) — HEAD 줄을 읽는다
function Get-LatestCommit([string]$repo) {
  $req = [Net.HttpWebRequest]::Create("https://github.com/$repo.git/info/refs?service=git-upload-pack")
  $req.Timeout = $UpdateCheckTimeoutMs
  $req.ReadWriteTimeout = $UpdateCheckTimeoutMs
  $req.UserAgent = 'wiki-hub-update'
  # Timeout 은 연결이 응답 없이 매달릴 때(방화벽이 패킷을 버리는 회사망) 지켜지지 않아 직접 기다리다 끊는다
  $pending = $req.BeginGetResponse($null, $null)
  if (-not $pending.AsyncWaitHandle.WaitOne($UpdateCheckTimeoutMs)) {
    $req.Abort()
    throw "no response in $UpdateCheckTimeoutMs ms"
  }
  $res = $req.EndGetResponse($pending)
  $text = ''
  try {
    $reader = New-Object IO.StreamReader($res.GetResponseStream(), [Text.Encoding]::ASCII)
    # HEAD 는 맨 앞 줄에 온다 — 끝까지 읽지 않는다
    $buffer = New-Object char[] 1024
    while ($text.Length -lt 4096 -and $text -notmatch '[0-9a-f]{40} HEAD') {
      $n = $reader.Read($buffer, 0, $buffer.Length)
      if ($n -le 0) { break }
      $text += New-Object string($buffer, 0, $n)
    }
  } finally { $res.Close() }
  $m = [regex]::Match($text, '([0-9a-f]{40}) HEAD')
  if (-not $m.Success) { throw 'HEAD not found in info/refs' }
  return $m.Groups[1].Value
}

function Get-FileSha([string]$path) {
  if (-not (Test-Path $path)) { return '' }
  return (Get-FileHash $path -Algorithm SHA256).Hash
}

# 한 항목을 이름 바꾸기로만 옮긴다. Move-Item 은 폴더 이름 바꾸기가 막히면 파일을 하나씩 옮기다 멈춰 반쯤 옮긴 채로 남는다
function Move-Entry([string]$from, [string]$to) {
  if ([IO.Directory]::Exists($from)) { [IO.Directory]::Move($from, $to) } else { [IO.File]::Move($from, $to) }
}

# 끊긴 바꾸기를 되돌린다 — 표시 파일이 남아 있으면 백업 항목을 제자리로 옮긴다
function Restore-Interrupted([string]$root, [string]$backup) {
  $mark = Join-Path $backup '.hub-swap'
  if (-not (Test-Path $mark)) { return }
  Write-Log '[업데이트] 지난번 바꾸기가 끊겨 이전 버전으로 되돌림'
  foreach ($item in @(Get-ChildItem -LiteralPath $backup -Force | Where-Object { $_.Name -ne '.hub-swap' })) {
    $target = Join-Path $root $item.Name
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    Move-Entry $item.FullName $target
  }
  Remove-Item -LiteralPath $mark -Force
}

# 새 버전 폴더($incoming)의 최상위 항목을 하나씩 $root 로 바꿔 넣는다. 실패하면 거꾸로 되돌리고 예외를 다시 던진다
function Switch-HubFiles([string]$root, [string]$incoming, [string]$backup) {
  if (Test-Path $backup) { Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction Stop }
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  try { (Get-Item -LiteralPath $backup -Force).Attributes = 'Hidden, Directory' } catch { }
  $mark = Join-Path $backup '.hub-swap'
  [IO.File]::WriteAllText($mark, 'swapping')
  $done = New-Object System.Collections.ArrayList
  try {
    foreach ($item in @(Get-ChildItem -LiteralPath $incoming -Force)) {
      $name = $item.Name
      if (Test-KeepName $name) { continue }
      $target = Join-Path $root $name
      $entry = @{ name = $name; backedUp = $false; placed = $false }
      [void]$done.Add($entry)
      if (Test-Path -LiteralPath $target) {
        Move-Entry $target (Join-Path $backup $name)
        $entry.backedUp = $true
      }
      Move-Entry $item.FullName $target
      $entry.placed = $true
    }
  } catch {
    $reason = $_.Exception.Message
    Write-Log "[업데이트] 바꾸기 실패, 되돌림: $reason"
    for ($i = $done.Count - 1; $i -ge 0; $i--) {
      $entry = $done[$i]
      $target = Join-Path $root $entry.name
      try {
        # 넣은 새 항목은 받은 폴더로 되돌려 보낸다 (지우다 멈추는 일이 없게 이름 바꾸기로)
        if ($entry.placed) { Move-Entry $target (Join-Path $incoming $entry.name) }
        if ($entry.backedUp) { Move-Entry (Join-Path $backup $entry.name) $target }
      } catch { Write-Log "[업데이트] 되돌리기 실패 $($entry.name): $($_.Exception.Message)" }
    }
    Remove-Item -LiteralPath $mark -Force -ErrorAction SilentlyContinue
    throw $reason
  }
  Remove-Item -LiteralPath $mark -Force
}

function Update-Hub([string]$root) {
  $script:hubUpdateTo = ''
  $parent = Split-Path -Parent $root
  $backup = Join-Path $parent '.hub-backup'
  # 개발 저장소에서는 git 이 버전을 맡는다
  if (Test-Path (Join-Path $root '.git')) { Write-Log '[업데이트] git 체크아웃이라 건너뜀'; return 'skipped' }
  try { Restore-Interrupted $root $backup } catch { Write-Log "[업데이트] 되돌리기 실패: $($_.Exception.Message)" }
  $current = Read-HubVersion $root
  if (-not $current) { Write-Log "[업데이트] $HubVersionName 이 없거나 읽지 못해 건너뜀"; return 'skipped' }

  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  try { $latest = Get-LatestCommit $current.repo } catch {
    Write-Log "[업데이트] 최신 버전 확인 실패: $($_.Exception.Message)"
    return 'offline'
  }
  if ($latest.StartsWith($current.version)) { Write-Log "[업데이트] 최신 버전 ($($current.version))"; return 'latest' }
  $short = $latest.Substring(0, 7)
  Write-Log "[업데이트] 새 버전 $($current.version) -> $short"

  # 두 창이 함께 바꾸지 않게 잠근다 — 잠기지 않으면 이번에는 건너뛴다
  $lockPath = Join-Path $parent '.hub-update.lock'
  try { $lock = New-Object IO.FileStream($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) } catch {
    Write-Log '[업데이트] 다른 창이 바꾸는 중이라 건너뜀'
    return 'skipped'
  }
  $zip = Join-Path $env:TEMP ('wiki-hub-update-' + [guid]::NewGuid().ToString('N') + '.zip')
  $stage = Join-Path $parent '.hub-update'
  try {
    try {
      Invoke-WebRequest "https://codeload.github.com/$($current.repo)/zip/$latest" -OutFile $zip -UseBasicParsing -TimeoutSec $UpdateDownloadTimeoutSec -ErrorAction Stop
      if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
      New-Item -ItemType Directory -Force -Path $stage | Out-Null
      try { (Get-Item -LiteralPath $stage -Force).Attributes = 'Hidden, Directory' } catch { }
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      [IO.Compression.ZipFile]::ExtractToDirectory($zip, $stage)
      # codeload 압축은 최상위 폴더(repo-커밋) 하나 아래에 파일이 있다
      $tops = @(Get-ChildItem -LiteralPath $stage -Force)
      if ($tops.Count -ne 1 -or -not $tops[0].PSIsContainer) { throw 'unexpected archive layout' }
      $incoming = $tops[0].FullName
      foreach ($must in 'package.json', 'scripts\setup.ps1', 'start-hub.bat') {
        if (-not (Test-Path (Join-Path $incoming $must))) { throw "archive missing $must" }
      }
      [IO.File]::WriteAllText((Join-Path $incoming $HubVersionName), ([ordered]@{ version = $short; repo = $current.repo } | ConvertTo-Json -Compress) + "`n", (New-Object Text.UTF8Encoding($false)))
    } catch {
      Write-Log "[업데이트] 새 버전 받기 실패: $($_.Exception.Message)"
      return 'failed'
    }

    $lockChanged = (Get-FileSha (Join-Path $root 'package-lock.json')) -ne (Get-FileSha (Join-Path $incoming 'package-lock.json'))
    try { Switch-HubFiles $root $incoming $backup } catch {
      return 'failed'
    }
    # 패키지 목록이 바뀌었을 때만 다시 설치한다 — setup.ps1 2단계가 이 표시를 보고 npm install 을 돌린다
    $modules = Join-Path $root 'node_modules'
    if ($lockChanged -and (Test-Path $modules)) {
      try { [IO.File]::WriteAllText((Join-Path $modules '.hub-reinstall'), $short) } catch { }
    }
    Write-Log "[업데이트] 바꿈 $($current.version) -> $short · 패키지 목록 바뀜 $lockChanged · 백업 $backup"
    $script:hubUpdateTo = $short
    return 'updated'
  } finally {
    Remove-Item -LiteralPath $zip -ErrorAction SilentlyContinue
    if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    $lock.Close()
    Remove-Item -LiteralPath $lockPath -ErrorAction SilentlyContinue
  }
}
