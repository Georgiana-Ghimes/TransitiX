# Start local Transitix stack on this PC (DB + OCR sidecars).
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File scripts/start-local-pc.ps1
#   or double-click scripts\start-local-pc.bat  (also opens BE + FE terminals)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Assert-Docker {
  try {
    docker info 1>$null 2>$null
  } catch {
    throw 'Docker Desktop nu raspunde. Porneste-l si reincearca.'
  }
}

Assert-Docker

Write-Host '== Docker: Postgres (:5434) + Paddle OCR (:8100) ==' -ForegroundColor Cyan
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
docker compose -f docker-compose.paddle-ocr.yml up -d

# Optional VL sidecar — skip quietly if the compose file / image is missing.
if (Test-Path (Join-Path $root 'docker-compose.paddle-ocr-vl.yml')) {
  Write-Host '== Docker: PaddleOCR-VL (:8101) ==' -ForegroundColor Cyan
  try {
    docker compose -f docker-compose.paddle-ocr-vl.yml up -d
  } catch {
    Write-Host "[!] PaddleOCR-VL nu a pornit: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host '== Health (scurt) ==' -ForegroundColor Cyan
foreach ($url in @(
  'http://127.0.0.1:8100/health',
  'http://127.0.0.1:8101/health'
)) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
    Write-Host ("  OK  {0}  {1}" -f $url, $r.StatusCode) -ForegroundColor Green
  } catch {
    Write-Host ("  --  {0}  (inca se incalzeste sau oprit)" -f $url) -ForegroundColor DarkYellow
  }
}

Write-Host ''
Write-Host '== Status ==' -ForegroundColor Cyan
docker ps --filter name=transitix --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" 2>$null

Write-Host ''
Write-Host 'Next:' -ForegroundColor Green
Write-Host '  Local FE:   scripts\start-local-pc.bat     → BE + Vite :5173'
Write-Host '  Vercel FE:  scripts\start-vercel-pc.bat    → BE + cloudflared (fara Vite)'
Write-Host '  Manual BE:  cd server; $env:PORT=''3001''; npm run dev'
Write-Host '  Manual FE:  $env:API_PORT=''3001''; npm run dev   # http://127.0.0.1:5173'
Write-Host '  Companion:  $env:API_PORT=''3001''; npm run dev:companion  # :5174'
Write-Host ''
Write-Host 'Stop later:'
Write-Host '  docker compose -f docker-compose.paddle-ocr.yml stop'
Write-Host '  docker compose -f docker-compose.paddle-ocr-vl.yml stop'
Write-Host '  docker compose -f docker-compose.yml -f docker-compose.dev.yml stop db'
