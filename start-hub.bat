@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 플랫폼 담당 지식 허브

rem 더블클릭 실행기: 준비·허브 켜기는 모두 scripts\setup.ps1 이 한다 (창에는 한국어 진행 줄만)
rem   start-hub.bat --check : 설치·생성 없이 상태만 확인 (담당자용)

if "%~1"=="--check" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" -Check
  rem 괄호 안의 %%errorlevel%% 은 미리 펼쳐져서, 값 없이 끝내 PowerShell 의 종료 코드를 그대로 넘긴다
  exit /b
)

rem 허브는 배치 밖의 PowerShell 창에서 돌린다 - 배치 안에서 돌리면 Ctrl+C 때 "일괄 작업을 끝내시겠습니까" 질문이 나온다
rem 준비 실패·허브 종료 때의 닫기 안내(pause)도 setup.ps1 이 한국어로 한다
start "플랫폼 담당 지식 허브" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
exit /b 0
