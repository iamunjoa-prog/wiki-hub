@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 본부 지식 허브

rem 더블클릭 실행기: 세팅 점검(scripts\setup.ps1) -> 허브 실행 -> 브라우저 자동 열기
rem   start-hub.bat --check : 설치·생성 없이 상태만 확인

if "%~1"=="--check" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" -Check
  exit /b %errorlevel%
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo 허브를 시작합니다. 잠시 후 브라우저가 자동으로 열립니다.
echo ** 이 창을 닫으면 허브가 꺼집니다 **
echo.
call npm run dev -- --open
pause
