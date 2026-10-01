# Start local Transitix stack on this PC (DB only — OCR is Mistral cloud).
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

Write-Host '== Docker: Postgres (:5434) ==' -ForegroundColor Cyan
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db

Write-Host ''
Write-Host '== Status ==' -ForegroundColor Cyan
docker ps --filter name=transitix --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

Write-Host ''
Write-Host 'Next:' -ForegroundColor Green
Write-Host '  Set MISTRAL_API_KEY in server env (OCR cloud).'
Write-Host '  Manual BE:  cd server; $env:PORT=''3001''; npm run dev'
Write-Host '  Manual FE:  $env:API_PORT=''3001''; npm run dev   # http://127.0.0.1:5173'
Write-Host '  Companion:  npm run dev:companion  # :5174 + API :3002'
Write-Host ''
Write-Host 'Stop later:'
Write-Host '  docker compose -f docker-compose.yml -f docker-compose.dev.yml stop db'
