@echo off
REM Vercel FE + API pe acest PC + Cloudflare tunnel
REM Dublu-click: scripts\start-vercel-pc.bat
REM Nu porneste Vite local — frontend-ul e pe Vercel.
setlocal
cd /d "%~dp0.."
set "ROOT=%CD%"

echo.
echo === Transitix: backend pentru Vercel ===
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-vercel-pc.ps1"
if errorlevel 1 (
  echo.
  echo [!] start-vercel-pc.ps1 a esuat.
  pause
  exit /b 1
)

echo.
echo === Pornesc API + tunnel in ferestre noi ===
echo.

start "Transitix API :3001" /D "%ROOT%\server" cmd /k "set PORT=3001&& npm run dev"

REM Prefer cloudflared from PATH; else the usual Windows install location
set "CF=cloudflared"
if exist "%LOCALAPPDATA%\cloudflared\cloudflared.exe" set "CF=%LOCALAPPDATA%\cloudflared\cloudflared.exe"

REM Named tunnel if CLOUDFLARED_TUNNEL is set in the environment or vercel-pc.env
set "TUNNEL_NAME="
if exist "%~dp0vercel-pc.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0vercel-pc.env") do (
    if /I "%%A"=="CLOUDFLARED_TUNNEL" set "TUNNEL_NAME=%%B"
  )
)
if defined CLOUDFLARED_TUNNEL set "TUNNEL_NAME=%CLOUDFLARED_TUNNEL%"

if defined TUNNEL_NAME (
  echo Named tunnel: %TUNNEL_NAME%
  start "Transitix cloudflared [%TUNNEL_NAME%]" cmd /k ""%CF%" tunnel run %TUNNEL_NAME%"
) else (
  echo Quick tunnel → http://127.0.0.1:3001  ^(copiaza URL-ul din fereastra^)
  start "Transitix cloudflared [quick]" cmd /k ""%CF%" tunnel --url http://127.0.0.1:3001"
)

echo.
echo FE:  aplicatia de pe Vercel
echo API: http://127.0.0.1:3001  (+ tunnel public)
echo.
echo Daca folosesti quick tunnel: pune URL-ul in Vercel VITE_API_ORIGIN si redeploy.
echo Named tunnel: hostname-ul ramane acelasi — nu mai schimba Vercel la fiecare boot.
echo.
endlocal
