# Backend for the Vercel frontend: Docker + API :3001 + Cloudflare tunnel.
# FE stays on Vercel (VITE_API_ORIGIN -> tunnel URL). Do not start local Vite.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/start-vercel-pc.ps1
#   or double-click scripts\start-vercel-pc.bat
#
# Optional env (set before run, or in scripts/vercel-pc.env - see example):
#   CLOUDFLARED_TUNNEL   named tunnel (stable hostname) - preferred for the team
#   If unset -> quick tunnel (*.trycloudflare.com), URL changes every restart

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envFile = Join-Path $PSScriptRoot 'vercel-pc.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $i = $line.IndexOf('=')
    if ($i -lt 1) { return }
    $name = $line.Substring(0, $i).Trim()
    $val = $line.Substring($i + 1).Trim().Trim('"').Trim("'")
    Set-Item -Path "Env:$name" -Value $val
  }
}

# Reuse Docker bring-up (DB + OCR + VL)
& (Join-Path $PSScriptRoot 'start-local-pc.ps1')

$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'cloudflared\cloudflared.exe'),
    (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe'),
    (Join-Path $env:USERPROFILE 'cloudflared\cloudflared.exe')
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) {
      $cf = @{ Source = $c }
      break
    }
  }
}
if (-not $cf) {
  Write-Host ''
  Write-Host '[!] cloudflared nu e in PATH. Instaleaza Cloudflare Tunnel, apoi reincearca.' -ForegroundColor Red
  Write-Host '    https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/'
  Write-Host '    Pe PC-ul tau exista de obicei: %LOCALAPPDATA%\cloudflared\cloudflared.exe' -ForegroundColor DarkYellow
  Write-Host '    Adauga acel folder in PATH, sau ruleaza cu calea completa.' -ForegroundColor DarkYellow
  Write-Host ''
  Write-Host 'Pana atunci poti porni doar API-ul local; Vercel nu are unde sa bata.' -ForegroundColor Yellow
  exit 0
}

$cloudflaredExe = if ($cf.Source) { $cf.Source } else { 'cloudflared' }
$env:TRANSITIX_CLOUDFLARED = $cloudflaredExe

$tunnelName = [string]$env:CLOUDFLARED_TUNNEL
Write-Host ''
Write-Host '== Cloudflare tunnel ==' -ForegroundColor Cyan
Write-Host ("cloudflared: {0}" -f $cloudflaredExe) -ForegroundColor DarkGray
if ($tunnelName) {
  Write-Host ("Named tunnel: {0} (hostname stabil - VITE_API_ORIGIN pe Vercel trebuie sa potriveasca)" -f $tunnelName) -ForegroundColor Green
} else {
  Write-Host 'Quick tunnel: URL nou la fiecare restart. Dupa pornire, copiaza https://....trycloudflare.com' -ForegroundColor Yellow
  Write-Host '  -> Vercel Project -> Settings -> Environment Variables -> VITE_API_ORIGIN' -ForegroundColor Yellow
  Write-Host '  -> Redeploy FE (VITE_* e bake-uit la build).' -ForegroundColor Yellow
  Write-Host 'Pentru echipa: seteaza CLOUDFLARED_TUNNEL=... in scripts/vercel-pc.env (named tunnel).' -ForegroundColor DarkYellow
}

Write-Host ''
Write-Host 'In server/.env pentru Vercel + tunnel:' -ForegroundColor Green
Write-Host '  PORT=3001'
Write-Host '  TRUST_PROXY=1'
Write-Host '  CLIENT_ORIGIN=https://www.transitix.site   (plus localhost daca mai testezi local)'
Write-Host ''
