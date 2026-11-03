/** 로컬 CLI 중계(cliBridge)가 쓰는 "Jira 스케줄 확인" 답변 형식 — Jira MCP로 BTVEVT 프로젝트를 조회해 정리한다 */

export interface JiraScheduleItem {
  key: string
  title: string
  requestDate: string
  dueDate: string
  airPeriod: string
  target: string
  assignee: string
  status: string
  url: string
}

export interface JiraScheduleReply {
  items: JiraScheduleItem[]
  note: string
}

export const JIRA_SCHEDULE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          requestDate: { type: 'string' },
          dueDate: { type: 'string' },
          airPeriod: { type: 'string' },
          target: { type: 'string' },
          assignee: { type: 'string' },
          status: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['key', 'title', 'requestDate', 'dueDate', 'airPeriod', 'target', 'assignee', 'status', 'url'],
        additionalProperties: false,
      },
    },
    note: { type: 'string' },
  },
  required: ['items', 'note'],
  additionalProperties: false,
}

/**
 * 이미지제작 요청/완료일·편성 기간·프로모션 대상은 Jira 커스텀 필드가 아니라
 * 이슈 설명(description) 안의 표에 들어 있다 (예: BTVEVT-7093) — 그래서 구조화 API 필드 조회가 아니라
 * CLI가 표를 읽고 해석하는 방식으로 뽑는다.
 *
 * baseUrl·projectKey는 회사 내부 값이라 호출하는 쪽(cliBridge)이 .env.local에서 읽어 넘긴다.
 */
export function buildJiraScheduleRequest(baseUrl: string, projectKey: string): string {
  return [
    `Jira 프로젝트 ${projectKey}에서 진행 중인 "이미지 제작 요청" 이슈를 조회해 스케줄로 정리하라.`,
    '연결된 Jira MCP 도구로 해결되지 않은(미해결) 이슈를 검색하라. 너무 오래된 이슈까지 다 가져올 필요는 없고, 최근 것 위주로 확인한다.',
    '각 이슈의 설명(description)에는 보통 다음과 같은 표가 들어 있다: 프로모션명 / 이미지제작 요청일 / 이미지제작 완료일(희망) / 편성 기간 / 프로모션 대상.',
    '이 표에서 값을 읽어 각 필드에 채운다. 표가 없거나 특정 값이 없으면 그 필드는 빈 문자열로 둔다. 지어내지 않는다.',
    'title에는 표의 프로모션명을 쓰고, 프로모션명이 없으면 이슈 제목을 그대로 쓴다.',
    `url은 ${baseUrl}/browse/<이슈키> 형식으로 만든다.`,
    'assignee에는 담당자(또는 담당자가 비어 있으면 보고자) 이름을, status에는 이슈 상태를 넣는다.',
    '결과는 이미지제작 요청일이 이른 순으로 정렬한다. 날짜를 알 수 없는 항목은 뒤로 보낸다.',
    'note에는 조회 범위를 한 줄로 요약해 적는다 (예: 검색한 이슈 개수, JQL 조건).',
  ].join('\n')
}
