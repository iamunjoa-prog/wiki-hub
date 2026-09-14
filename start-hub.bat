@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 본부 지식 허브

rem 더블클릭 실행기: 세팅 점검(scripts\setup.ps1) -> 허브 실행(5173 고정) -> 브라우저 자동 열기
rem   start-hub.bat --check : 설치·생성 없이 상태만 확인
rem   배포 허브의 [로컬 허브 실행] 버튼(wikihub://)도 이 파일을 실행한다

if "%~1"=="--check" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" -Check
  exit /b %errorlevel%
)

netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul
if not errorlevel 1 (
  echo 허브가 이미 켜져 있어 브라우저만 엽니다.
  start "" http://localhost:5173/
  exit /b 0
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
