# Start local Transitix stack on this PC (DB + OCR). FE/API are separate npm processes.
# Usage (from repo root):  powershell -ExecutionPolicy Bypass -File scripts/start-local-pc.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '== Docker: Postgres (:5434) + Paddle OCR (:8100) ==' -ForegroundColor Cyan
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
docker compose -f docker-compose.paddle-ocr.yml up -d

Write-Host ''
Write-Host '== Status ==' -ForegroundColor Cyan
docker ps --filter name=transitix --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" 2>$null

Write-Host ''
Write-Host 'Next (two terminals):' -ForegroundColor Green
Write-Host '  BE:  cd server; PORT=3001 npm run dev     # Windows PowerShell: $env:PORT=3001; npm run dev'
Write-Host '  FE:  $env:API_PORT=\"3001\"; npm run dev   # http://127.0.0.1:5173  (multitenant full)'
Write-Host '  or:  $env:API_PORT=\"3001\"; npm run dev:companion  # :5174 documents'
Write-Host ''
Write-Host 'Stop OCR/DB later:  docker compose -f docker-compose.paddle-ocr.yml stop'
Write-Host '                     docker compose -f docker-compose.yml -f docker-compose.dev.yml stop db'
