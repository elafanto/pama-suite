# Pama Business Suite — auto-start Vite dev server + open app window
param(
  [int]$Port = 5180,
  [switch]$NoAppWindow,
  [switch]$ServerOnly
)

$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Url = "http://localhost:$Port/"

function Test-ServerUp([int]$p) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$p/" -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Find-LivePort {
  param([int]$StartPort)
  for ($p = $StartPort; $p -le ($StartPort + 10); $p++) {
    if (Test-ServerUp $p) { return $p }
  }
  return $null
}

function Find-Node {
  foreach ($cmd in @('node', 'node.exe')) {
    $c = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
  }
  return $null
}

function Start-DevServer {
  $live = Find-LivePort -StartPort $Port
  if ($live) { return $live }

  if (-not (Find-Node)) {
    Write-Host 'ERROR: Node.js not found. Install from https://nodejs.org or: winget install OpenJS.NodeJS.LTS' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
  }

  if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
    Write-Host 'First run — installing dependencies (npm install)...' -ForegroundColor Yellow
    Push-Location $Root
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) {
      Pop-Location
      Write-Host 'ERROR: npm install failed' -ForegroundColor Red
      Read-Host 'Press Enter to exit'
      exit 1
    }
    Pop-Location
  }

  $log = Join-Path $Root '.dev-server.log'
  Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'npm.cmd run dev > .dev-server.log 2>&1' `
    -WorkingDirectory $Root `
    -WindowStyle Minimized

  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Milliseconds 500
    $live = Find-LivePort -StartPort $Port
    if ($live) { return $live }
  }

  Write-Host "ERROR: Dev server did not start (expected port $Port or next free port)." -ForegroundColor Red
  Write-Host "Check $log for details." -ForegroundColor Yellow
  Read-Host 'Press Enter to exit'
  exit 1
}

function Find-Chrome {
  @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

$livePort = Start-DevServer
$openUrl = "http://localhost:$livePort/"

if ($ServerOnly) {
  Write-Host "Pama Suite running: $openUrl"
  exit 0
}

$chrome = Find-Chrome
$chromeArgs = if ($NoAppWindow) { @($openUrl) } else { @("--app=$openUrl") }

if ($chrome) {
  Start-Process -FilePath $chrome -ArgumentList $chromeArgs
  Write-Host "Opened Pama Business Suite: $openUrl"
} else {
  Start-Process $openUrl
  Write-Host "Chrome not found — opened in default browser: $openUrl"
}
