# Jira 연동 설정 (개인별) — "Jira 스케줄 확인" 메뉴

위키허브의 **Jira 스케줄 확인** 메뉴는 로컬(`npm run dev`)에서만 동작합니다. 배포본(Vercel)은 사내망 Jira에
접근할 수 없고, 개인 Jira 계정 토큰을 공개 서버에 저장하지도 않기 때문입니다. 대신 **각자 자기 PC에 로그인된
Claude CLI**가 자기 권한으로 Jira를 조회합니다.

## 왜 이런 구조인가

- 회사 Jira(`jira.skbroadband.com`)는 Cloud가 아니라 Server/Data Center라 사내망 안에서만 열립니다.
- 위키허브는 public 저장소이므로, 회사 내부 주소나 개인 토큰을 코드에 넣으면 안 됩니다.
- 그래서 Jira 접속 정보는 전부 **개인 PC의 `.env.local`** 또는 **Claude CLI 자체의 로컬 설정**에만 두고,
  깃에는 올라가지 않습니다.

## 1) Jira Personal Access Token 발급

1. `https://jira.skbroadband.com` 로그인
2. 우측 상단 프로필 → **Personal Access Tokens** (계정 설정 메뉴 이름은 Jira 버전에 따라 다를 수 있습니다)
3. 토큰 생성 → 이름은 알아보기 쉽게 (예: `wiki-hub-mcp`) → 만료일 설정
4. 발급된 토큰 값을 복사해 둡니다 (다시 보여주지 않으니 안전한 곳에 잠깐 저장)

## 2) Claude CLI에 Jira MCP 서버 연결

Claude Code CLI에 Jira MCP 서버를 등록합니다. 정확한 실행 명령은 사내에서 승인된 Jira MCP 서버가 무엇인지에
따라 달라질 수 있으니, 아래는 예시입니다 (커뮤니티에서 널리 쓰이는 `mcp-atlassian` 기준):

```bash
claude mcp add jira --scope user \
  --env JIRA_URL=https://jira.skbroadband.com \
  --env JIRA_PERSONAL_TOKEN=발급받은토큰 \
  -- uvx mcp-atlassian
```

- `--scope user`로 등록하면 이 PC의 어느 프로젝트 디렉터리에서 `claude`를 실행하든 Jira 도구를 쓸 수 있습니다.
- 서버 이름은 반드시 `jira`로 등록해 주세요 (코드가 `mcp__jira` 도구만 허용하도록 되어 있습니다 — [cliBridge.ts](../server/cliBridge.ts)).
- `uvx`가 없다면 `pip install mcp-atlassian` 후 다른 실행 방식을 쓰거나, 사내에서 안내하는 다른 Jira MCP 서버 명령으로 바꿔주세요.
- 정확한 옵션은 `claude mcp add --help`로 확인하는 걸 추천합니다.

등록 후 확인:

```bash
claude mcp list
```

`jira`가 목록에 뜨고 연결 상태가 정상이면 됩니다.

## 3) 이 리포에 개인별 `.env.local` 만들기

허브 루트(`D:\마케팅 자동화 챗봇`)에 `.env.local` 파일을 만들고 아래 두 줄을 추가합니다 (토큰은 여기 넣지
않습니다 — 토큰은 위 2단계에서 Claude CLI 설정에만 저장됩니다):

```
JIRA_BASE_URL=https://jira.skbroadband.com
JIRA_PROJECT_KEY=BTVEVT
```

`.env.local`은 `.gitignore`에 이미 포함되어 있어 커밋되지 않습니다.

## 4) 확인

1. `claude auth status`로 로그인 상태 확인 (미로그인이면 `claude auth login`)
2. 허브 실행: `npm run dev`
3. 사이드바 **Jira 스케줄 확인** 메뉴 클릭 → BTVEVT 프로젝트의 이미지 제작 요청 이슈가 요청일 순으로 정리되어
   보이면 성공입니다.

## 문제가 생기면

- **"claude CLI가 설치되어 있지 않습니다"** — `claude` 명령이 PATH에 있는지 확인
- **"JIRA_BASE_URL / JIRA_PROJECT_KEY가 설정되지 않았습니다"** — 3단계의 `.env.local`을 확인
- **조회는 되는데 결과가 비어 있음** — Jira 쪽 검색 권한(해당 프로젝트 조회 권한)이 있는지 확인
- **타임아웃/에러** — `claude mcp list`로 `jira` 서버가 정상 연결 상태인지 다시 확인
