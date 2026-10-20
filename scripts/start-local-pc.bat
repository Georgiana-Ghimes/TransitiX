@echo off
REM Zi de zi pe PC — Docker (DB + OCR) + BE :3001 + FE :5173
REM Dublu-click sau din repo: scripts\start-local-pc.bat
setlocal
cd /d "%~dp0.."
set "ROOT=%CD%"

echo.
echo === Transitix local PC ===
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local-pc.ps1"
if errorlevel 1 (
  echo.
  echo [!] start-local-pc.ps1 a esuat. Verifica Docker Desktop.
  pause
  exit /b 1
)

echo.
echo === Pornesc BE + FE in ferestre noi ===
echo.

start "Transitix BE :3001" /D "%ROOT%\server" cmd /k "set PORT=3001&& npm run dev"
start "Transitix FE :5173" /D "%ROOT%" cmd /k "set API_PORT=3001&& npm run dev"

echo.
echo Deschis:
echo   BE  http://127.0.0.1:3001
echo   FE  http://127.0.0.1:5173
echo.
echo Opreste ferestrele BE/FE cu Ctrl+C.
echo Docker DB/OCR raman up pana la stop (vezi mesajul din ps1).
echo.
endlocal
