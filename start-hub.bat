@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 본부 지식 허브

rem 더블클릭으로 로컬 허브를 켠다: 필요 시 패키지 설치 -> 개발 서버 실행 -> 브라우저 자동 열기

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js가 없습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

where claude >nul 2>nul
if errorlevel 1 (echo [안내] Claude CLI 미설치 - 챗봇은 Codex 또는 규칙 기반으로 답합니다.)
where codex >nul 2>nul
if errorlevel 1 (echo [안내] Codex CLI 미설치 - 챗봇은 Claude 또는 규칙 기반으로 답합니다.)

if "%~1"=="--check" (
  echo [확인] 실행 준비 완료
  exit /b 0
)

if not exist node_modules (
  echo 처음 실행이라 필요한 패키지를 설치합니다. 1~2분 걸릴 수 있어요...
  call npm install
  if errorlevel 1 (
    echo [오류] 패키지 설치에 실패했습니다.
    pause
    exit /b 1
  )
)

echo.
echo 허브를 시작합니다. 잠시 후 브라우저가 자동으로 열립니다.
echo 로그인은 대시보드의 [챗봇 CLI 연결] - [연결 설정]에서 할 수 있어요.
echo ** 이 창을 닫으면 허브가 꺼집니다 **
echo.
call npm run dev -- --open
pause
