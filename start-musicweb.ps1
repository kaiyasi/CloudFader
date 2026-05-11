$ErrorActionPreference = "Stop"

$Root        = Split-Path -Parent $MyInvocation.MyCommand.Path
$Tools       = Join-Path $Root "tools"
$Logs        = Join-Path $Root "logs"
$Node        = Join-Path $Tools "node.exe"
$Cloudflared = Join-Path $Tools "cloudflared.exe"
$TryPorts    = @(4173, 4174, 4175, 4176)

New-Item -ItemType Directory -Force -Path $Tools, $Logs | Out-Null

# ═══════════════════════════════════════════════════════════════
#  Display helpers
# ═══════════════════════════════════════════════════════════════

$W = 54  # box width (inner)

function HR($Char = "─") {
  Write-Host ("  " + ($Char * $W)) -ForegroundColor DarkCyan
}

function Banner {
  $title  = "MusicWeb  ·  畢業典禮播音同步系統"
  $inner  = " " * 2 + $title
  $padded = $inner.PadRight($W)
  Write-Host ""
  HR "═"
  Write-Host ("  ║ " + $padded + " ║") -ForegroundColor Cyan
  HR "═"
  Write-Host ""
}

function Section($Text) {
  Write-Host ""
  Write-Host ("  ── " + $Text + " ") -NoNewline -ForegroundColor Cyan
  $remain = $W - 4 - $Text.Length - 1
  if ($remain -gt 0) { Write-Host ("─" * $remain) -ForegroundColor DarkCyan }
  else { Write-Host "" }
}

function Row($Label, $Value, $ValueColor = "White") {
  Write-Host ("  " + $Label.PadRight(14)) -NoNewline -ForegroundColor DarkGray
  Write-Host $Value -ForegroundColor $ValueColor
}

function Ok($Text)   { Write-Host "  [OK] $Text" -ForegroundColor Green   }
function Inf($Text)  { Write-Host "  [..] $Text" -ForegroundColor DarkGray }
function Warn($Text) { Write-Host "  [!!] $Text" -ForegroundColor Yellow   }
function Err($Text)  { Write-Host "  [XX] $Text" -ForegroundColor Red      }

function Show-LocalAddresses($Port) {
  Write-Host ""
  Row "本機控制台"  "http://localhost:$Port/"
  foreach ($url in (Get-LanUrls $Port)) {
    $ip = $url -replace "/$", ""
    Row "LAN 控制台" "$ip/"
  }
  Row "本機播放端"  "http://localhost:$Port/player.html"
  Write-Host ""
}

function Show-PublicUrl($Name, $Url) {
  $urlLine = "  ║  $Url"
  $urlPad  = $urlLine.PadRight($W + 4) + " ║"
  Write-Host ""
  HR "═"
  Write-Host ("  ║  公開網址 (" + $Name + ")").PadRight($W + 3) -NoNewline -ForegroundColor Green
  Write-Host " ║" -ForegroundColor DarkCyan
  HR "─"
  Write-Host $urlPad -ForegroundColor Cyan
  HR "═"
  Write-Host ""
  try {
    Set-Clipboard -Value $Url
    Write-Host "  已複製到剪貼簿。" -ForegroundColor DarkGray
  } catch {}
  Write-Host ""
}

function Show-LanFallback($Port) {
  Write-Host ""
  Warn "Cloudflare 全部失敗。同一 Wi-Fi 可用以下 LAN 網址："
  Write-Host ""
  foreach ($url in (Get-LanUrls $Port)) {
    $ip = $url -replace "/$", ""
    Row "LAN" "$ip/"
  }
  Write-Host ""
}

function Show-Footer {
  Write-Host ""
  HR "─"
  Write-Host "  保持此視窗開啟。按 Enter 關閉 MusicWeb。" -ForegroundColor DarkGray
  HR "─"
  Write-Host ""
}

# ═══════════════════════════════════════════════════════════════
#  Functional helpers
# ═══════════════════════════════════════════════════════════════

function Wait-Http($Url, $Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try { Invoke-RestMethod -Uri $Url -TimeoutSec 2 | Out-Null; return $true } catch {}
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Stop-ByPort($Port) {
  $lines = netstat -ano | Select-String ":$Port\s"
  foreach ($line in $lines) {
    if ($line.Line -match "LISTENING\s+(\d+)$") {
      $procId = [int]$Matches[1]
      try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
      try { & taskkill.exe /F /T /PID $procId | Out-Null } catch {}
    }
  }
}

function Wait-PortFree($Port, $Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $busy = netstat -ano | Select-String ":$Port\s"
    if (!$busy) { return $true }
    foreach ($line in $busy) {
      if ($line.Line -match "LISTENING\s+(\d+)$") {
        $procId = [int]$Matches[1]
        try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
        try { & taskkill.exe /F /T /PID $procId | Out-Null } catch {}
      }
    }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Wait-PortListening($Port, $Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (netstat -ano | Select-String ":$Port\s") { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Find-PublicUrl($Paths, $Seconds, $Pattern) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    foreach ($path in $Paths) {
      if (!(Test-Path $path)) { continue }
      $text = Get-Content -Path $path -Raw -ErrorAction SilentlyContinue
      if ($text -match $Pattern) { return $Matches[0].TrimEnd(".", ",", ";", ")") }
    }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

function Get-LanUrls($Port) {
  $items = @()
  foreach ($line in (ipconfig)) {
    if ($line -match "IPv4.*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)") {
      $ip = $Matches[1]
      if ($ip -notlike "127.*" -and $ip -notlike "169.254.*") {
        $items += "http://$ip`:$Port/"
      }
    }
  }
  return $items | Select-Object -Unique
}

function Get-Cloudflared {
  if (Test-Path $Cloudflared) { return $true }
  Inf "cloudflared.exe 未找到，下載中..."
  $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    (New-Object System.Net.WebClient).DownloadFile($url, $Cloudflared)
    Ok "cloudflared.exe 下載完成。"
    return $true
  } catch {
    Warn "cloudflared.exe 下載失敗：$_"
    return $false
  }
}

function Test-TunnelAlive($Url, $Attempts = 4, $WaitSec = 7) {
  for ($i = 1; $i -le $Attempts; $i++) {
    if ($i -gt 1) {
      Inf "尚未連通，重試 ($i/$Attempts)..."
      Start-Sleep -Seconds $WaitSec
    }
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
      if ($resp.StatusCode -lt 500) { return $true }
    } catch {}
  }
  return $false
}

# ═══════════════════════════════════════════════════════════════
#  Pre-flight
# ═══════════════════════════════════════════════════════════════

Banner

if (!(Test-Path $Node)) {
  $pathNode = Get-Command node -ErrorAction SilentlyContinue
  if ($pathNode) { $Node = $pathNode.Source } else { Err "找不到 node.exe。請安裝 Node.js 18+ 或將 node.exe 放入 tools\。"; Read-Host; exit 1 }
}

if (!(Test-Path (Join-Path $Root "audio"))) {
  Err "找不到 audio/ 資料夾。請建立並放入音樂檔後重新啟動。"
  Read-Host
  exit 1
}

try { $nodeVer = (& $Node --version 2>$null).Trim() } catch { $nodeVer = "未知" }
Row "Node"  $nodeVer
Row "Port"  ($TryPorts -join " → ")
Row "音訊"  (Join-Path $Root "audio")
Write-Host ""

$hasCf      = Get-Cloudflared
$publicUrl  = $null
$tunnel     = $null
$server     = $null
$activePort = $null
$prevPort   = $env:PORT

# ═══════════════════════════════════════════════════════════════
#  Port rotation loop
# ═══════════════════════════════════════════════════════════════

foreach ($tryPort in $TryPorts) {

  Section "本機服務 (port $tryPort)"

  Stop-ByPort $tryPort
  if (!(Wait-PortFree $tryPort 6)) {
    Warn "Port $tryPort 仍被佔用，跳過。"
    continue
  }

  $ServerLog = Join-Path $Logs "server.log"
  $ServerErr = Join-Path $Logs "server.err.log"
  Remove-Item -Path $ServerLog, $ServerErr -ErrorAction SilentlyContinue

  $env:PORT = "$tryPort"
  $server = Start-Process -FilePath $Node -ArgumentList "`"$Root\server.js`"" `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $ServerLog -RedirectStandardError $ServerErr `
    -WindowStyle Hidden -PassThru

  Inf "等待伺服器啟動..."
  $serverOk = Wait-Http "http://localhost:$tryPort/api/state" 12
  if (!$serverOk) {
    if (!(Wait-PortListening $tryPort 4)) {
      Err "Port $tryPort 啟動失敗。請查閱 logs\server.err.log"
      try { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue } catch {}
      $server = $null
      continue
    }
    Warn "HTTP 探測逾時，但 port $tryPort 已監聽。繼續..."
  }

  Ok "伺服器已啟動 (port $tryPort)"
  $activePort = $tryPort
  Show-LocalAddresses $tryPort

  if (!$hasCf) {
    Warn "cloudflared.exe 不可用，僅限 LAN 模式。"
    break
  }

  Section "Cloudflare Tunnel (port $tryPort)"
  $cfLog = Join-Path $Logs "cloudflare.log"
  $cfErr = Join-Path $Logs "cloudflare.err.log"
  Remove-Item -Path $cfLog, $cfErr -ErrorAction SilentlyContinue

  $tunnel = Start-Process -FilePath $Cloudflared `
    -ArgumentList "tunnel --no-autoupdate --protocol http2 --url http://localhost:$tryPort" `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $cfLog -RedirectStandardError $cfErr `
    -WindowStyle Hidden -PassThru

  Inf "等待 Cloudflare URL（最多 25 秒）..."
  $cfUrl = Find-PublicUrl @($cfLog, $cfErr) 25 'https://[-a-zA-Z0-9.]+\.trycloudflare\.com(?:/[^\s"]*)?'

  if ($cfUrl) {
    Ok "URL 已取得，等待隧道穩定（10 秒）..."
    Start-Sleep -Seconds 10
    Inf "驗證連線中..."

    if (Test-TunnelAlive ($cfUrl.TrimEnd("/") + "/api/state")) {
      Ok "連線驗證通過。"
      $publicUrl = $cfUrl.TrimEnd("/") + "/"
      Show-PublicUrl "Cloudflare" $publicUrl
      break
    }

    if ($tunnel.HasExited) {
      Err "cloudflared 意外結束。最後錯誤訊息："
    } else {
      Warn "重試後仍無法連通。最後錯誤訊息："
    }
    try {
      $errLines = Get-Content $cfErr -Tail 5 -ErrorAction SilentlyContinue
      if ($errLines) { $errLines | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray } }
    } catch {}
  } else {
    Warn "25 秒內未出現 Cloudflare URL（port $tryPort）。"
  }

  try { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue } catch {}
  try { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue } catch {}
  $tunnel     = $null
  $server     = $null
  $activePort = $null
  Inf "嘗試下一個 port..."
}

# ═══════════════════════════════════════════════════════════════
#  Post-loop
# ═══════════════════════════════════════════════════════════════

if (!$server) {
  Err "所有 port 均無法啟動伺服器（$($TryPorts -join ', ')）。"
  $env:PORT = $prevPort
  Read-Host "按 Enter 離開"
  exit 1
}

if (!$publicUrl) {
  Show-LanFallback $activePort
}

Start-Process "http://localhost:$activePort/player.html"

Show-Footer
Read-Host

$env:PORT = $prevPort
if ($tunnel) { try { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue } catch {} }
if ($server) { try { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue } catch {} }
