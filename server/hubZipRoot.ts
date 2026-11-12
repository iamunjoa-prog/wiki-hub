/**
 * "로컬 허브 내려받기" ZIP 루트에 두는 얇은 실행기 2개와 안내 txt.
 * 저장소 파일로 두면 Vercel includeFiles 가 필요하고 줄바꿈이 .gitattributes 에 묶여서, 줄바꿈까지 문자열로 고정한다.
 */

/** 앱 전체가 들어가는 하위 폴더 — 얇은 bat 경로에 한글이 없어야 chcp 전에도 안전하다 */
export const HUB_DIR = 'hub'

// 루트 실행기 이름에 OS를 넣는다 — 확장자가 숨겨진 탐색기에서도 어느 쪽을 누를지 이름만 보고 고른다 (hub/ 안의 원래 이름은 그대로)
export const ROOT_BAT_NAME = 'start-hub-windows.bat'
export const ROOT_COMMAND_NAME = 'start-hub-mac.command'

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
  `HUB_LAUNCHER="$DIR/${ROOT_COMMAND_NAME}" exec /bin/bash "$DIR/${HUB_DIR}/start-hub.command" "$@"`,
  '',
].join('\n')

export const README_NAME = '읽어주세요.txt'

/**
 * 받은 날짜(KST)와 커밋 7자리를 채운 안내문. 메모장이 깨지지 않게 UTF-8 BOM + CRLF.
 * 문구는 docs/ux/2026-11-12-local-hub-beginner-copy.md 5장 전문. 실행기 이름만 ROOT_BAT_NAME·ROOT_COMMAND_NAME 에 맞췄다.
 * 실행 스크립트가 "버전(담당자용): " 뒤 값을 기록 파일 머리에 옮겨 적는다
 */
export function readmeText(now: Date, version: string): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const win = ROOT_BAT_NAME.replace(/\.bat$/, '') // 탐색기는 .bat 을 숨겨서 보이는 이름으로 적는다
  const mac = ROOT_COMMAND_NAME
  const lines = [
    '플랫폼 담당 지식 허브 — 내 PC에서 쓰기',
    '',
    '할 일은 세 가지뿐이에요.',
    '  1. 압축 풀기',
    '  2. start-hub 더블클릭 (보안 경고가 뜨면 아래대로 통과)',
    '  3. 브라우저가 열리면 내 계정으로 로그인',
    '그 밖에는 창이 알아서 합니다. 키보드는 누르지 않아도 돼요.',
    '',
    '',
    '■ Windows',
    '',
    '  1. 받은 wiki-hub.zip 을 우클릭 → [모두 압축 풀기] → [압축 풀기]',
    '     이 글이 압축 파일 안에서 열려 있다면, 이 창을 닫고 압축부터 풀어 주세요.',
    `  2. 풀린 wiki-hub 폴더에서 톱니바퀴 그림이 있는 ${win} 를 더블클릭`,
    '  3. 파란 "Windows의 PC 보호" 창이 뜨면 [추가 정보] → [실행]',
    '     "보안 경고" 창이 뜨면 [실행]',
    '  4. 검은 창이 혼자 준비합니다. 처음에는 5~10분쯤 걸려요.',
    '     브라우저에 로그인 화면이 뜨면 고른 계정으로 로그인하세요.',
    '  5. 허브가 브라우저에 열리면 끝입니다.',
    '     검은 창은 닫지 말고 최소화해 두세요. 닫으면 허브가 꺼집니다.',
    '',
    '',
    '■ Mac',
    '',
    '  1. 받은 wiki-hub.zip 을 더블클릭해 압축을 풀어요. (Safari로 받았다면 이미 풀려 있어요)',
    `  2. 풀린 wiki-hub 폴더에서 ${mac} 를`,
    '     우클릭(또는 control+클릭) → [열기] → 다시 뜨는 창에서 [열기]',
    '  3. [열기] 없이 [완료]만 보이면:',
    '     [완료] → 화면 왼쪽 위 Apple 메뉴 → 시스템 설정 → 개인정보 보호 및 보안',
    `     → 아래로 내려 "${mac}" 옆 [그래도 열기]`,
    '     → 다시 뜨는 창에서 [그래도 열기] → Mac 암호 입력',
    '     [휴지통으로 이동]은 누르지 마세요.',
    '  4. "터미널이 … 폴더에 접근하려고 합니다" 창이 뜨면 [허용]',
    '  5. 터미널 창이 혼자 준비합니다. 처음에는 5~10분쯤 걸려요.',
    '     브라우저에 로그인 화면이 뜨면 고른 계정으로 로그인하세요.',
    '  6. 허브가 브라우저에 열리면 끝입니다.',
    '     터미널 창은 닫지 말고 노란 단추로 내려 두세요. 닫으면 허브가 꺼집니다.',
    '',
    '',
    '■ 다음부터',
    '',
    '  바탕화면의 "플랫폼 담당 지식 허브" 를 더블클릭하세요.',
    '  이미 켜져 있으면 브라우저만 열려요.',
    '',
    '',
    '■ 안 될 때',
    '',
    '  창에 나온 "지금 할 일" 을 따라 해 주세요.',
    '  그래도 안 되면 아래 기록 파일을 허브 담당자에게 보내 주세요.',
    '    Windows : C:\\Users\\(내 이름)\\wiki-hub-기록\\설치기록.txt',
    '    Mac     : 내 홈 폴더 > wiki-hub-기록 > 설치기록.txt',
    '',
    '',
    `${HUB_DIR} 폴더는 허브 프로그램 파일이에요. 열거나 옮기거나 지우지 마세요.`,
    '',
    `받은 날짜: ${kst} (KST)   버전(담당자용): ${version}`,
    '',
  ]
  return '\uFEFF' + lines.join('\r\n')
}
