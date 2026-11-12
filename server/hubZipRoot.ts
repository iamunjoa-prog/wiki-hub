/**
 * "로컬 허브 내려받기" ZIP 루트에 두는 얇은 실행기 2개와 안내 txt.
 * 저장소 파일로 두면 Vercel includeFiles 가 필요하고 줄바꿈이 .gitattributes 에 묶여서, 줄바꿈까지 문자열로 고정한다.
 */

/** 앱 전체가 들어가는 하위 폴더 — 얇은 bat 경로에 한글이 없어야 chcp 전에도 안전하다 */
export const HUB_DIR = 'hub'

// Windows 실행기는 ASCII + CRLF (chcp 65001 전에 한글을 파싱하지 않게)
export const ROOT_BAT = [
  '@echo off',
  `rem Platform knowledge hub launcher. The real launcher is ${HUB_DIR}\\start-hub.bat`,
  'set "HUB_LAUNCHER=%~f0"',
  `call "%~dp0${HUB_DIR}\\start-hub.bat" %*`,
  'exit /b %errorlevel%',
  '',
].join('\r\n')

// Mac 실행기는 ASCII + LF. 바탕화면 심볼릭 링크로도 불리므로 원본처럼 링크를 끝까지 따라간다
export const ROOT_COMMAND = [
  '#!/bin/bash',
  `# Platform knowledge hub launcher. The real launcher is ${HUB_DIR}/start-hub.command`,
  'SELF="$0"',
  'while [ -L "$SELF" ]; do',
  '  LINK="$(readlink "$SELF")"',
  '  case "$LINK" in /*) SELF="$LINK" ;; *) SELF="$(dirname "$SELF")/$LINK" ;; esac',
  'done',
  'DIR="$(cd "$(dirname "$SELF")" && pwd)"',
  `HUB_LAUNCHER="$DIR/start-hub.command" exec /bin/bash "$DIR/${HUB_DIR}/start-hub.command" "$@"`,
  '',
].join('\n')

export const README_NAME = '읽어주세요.txt'

/** 받은 날짜(KST)와 커밋 7자리를 채운 안내문. 메모장이 깨지지 않게 UTF-8 BOM + CRLF */
export function readmeText(now: Date, version: string): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const lines = [
    '플랫폼 담당 지식 허브 — 내 PC에서 실행하기',
    '',
    'Windows : start-hub (종류: Windows 배치 파일) 를 더블클릭하세요.',
    'Mac     : start-hub.command 를 우클릭 → 열기 하세요.',
    '',
    '묻는 대로 Y를 누르면 세팅이 끝나고 브라우저가 열립니다.',
    '다음부터는 바탕화면의 "플랫폼 담당 지식 허브" 를 더블클릭하면 됩니다.',
    '창을 닫으면 허브가 꺼집니다.',
    '',
    `${HUB_DIR} 폴더는 허브 프로그램 파일입니다. 옮기거나 지우지 마세요.`,
    '',
    `받은 날짜: ${kst} (KST)   버전: ${version}`,
    '',
  ]
  return '﻿' + lines.join('\r\n')
}
