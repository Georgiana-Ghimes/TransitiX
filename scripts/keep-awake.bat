@echo off
REM Tine PC-ul treaz (fara sleep) cat timp ruleaza aceasta fereastra.
REM Lock screen (Win+L) e OK. Sleep/hibernate NU.
REM Inchide fereastra cand nu mai ai nevoie de API/tunnel.
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0keep-awake.ps1"
