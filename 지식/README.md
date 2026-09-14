# 지식 문서 드롭 폴더

컨플루언스에서 가져온 지식 문서를 여기에 마크다운으로 넣어 주세요.

## 폴더 구조

| 폴더 | 카테고리 | 문서 코드 접두 |
|---|---|---|
| `insight/` | 장르별 편성 인사이트 | `INS-G-nn` |
| `marketing/` | 마케팅 정책 | `MKT-P-nn` |
| `programming/` | 편성 정책 | `PRG-P-nn` |
| `marketing/ppc/` | 마케팅 정책 › PPC 프로모션 (하위 트리) | `PPC-*` (아래 참고) |

### PPC 프로모션 하위 트리 (`marketing/ppc/`)

문서가 많아 하위 폴더로 트리를 구성합니다. 루트 인덱스는 `marketing/ppc/index.md` (`PPC-00`).

| 폴더 | 내용 | 문서 코드 |
|---|---|---|
| `promotion/` | 프로모션 정책·업무 (공통 / PPM / PPV / 홍보물) | `PPC-P-nn` |
| `system/cbs/` · `acs/` · `swing/` | 시스템 매뉴얼 | `PPC-CBS-nn` · `PPC-ACS-nn` · `PPC-SWG-nn` |
| `reference/` | UI 버전표, 담당자, 용어, FAQ | `PPC-R-nn` |
| `docs/` | 원본·첨부, 커뮤니케이션 가이드라인 | `PPC-D-nn` |
| `performance/` | 실적 | `PPC-K-nn` |

PPC 문서는 기본 프론트매터에 아래 필드를 추가로 씁니다.

```yaml
scope: PPM          # PPM | PPV | 공통 — 챗봇이 상품 유형으로 근거 문서를 거를 때 사용
systems: [CBS, ACS] # 관련 시스템
parent: PPC-P-20    # 트리 상위 문서 코드 (루트는 null)
order: 21           # 같은 부모 아래 정렬 순서
status: 정리완료     # 정리완료 | 초안 | 빈 페이지
source: "원문 위치"
```

본문 첫 줄에는 사람이 보는 메타 줄을 둡니다: `> 적용대상 **PPM 전용** · 관련 시스템 CBS · 상위 [문서명](코드)`

## 파일 형식

파일 하나 = 문서 하나. 파일명은 영문 소문자 + 하이픈 (`variety.md`, `new-user-campaign.md`).
맨 위에 아래 프론트매터를 넣고, 그 아래에 본문(마크다운)을 씁니다.

```markdown
---
title: 예능 편성 인사이트
code: INS-G-01
category: insight
version: 14
updatedBy: 김OO
updatedAt: 2026-09-02
ownerId: kim
---

## 요약

본문 내용...
```

- `code` 는 챗봇이 답변에 근거 문서로 표시할 때 쓰는 식별자입니다. 문서 간 상호 참조는 본문에 `[신규 유입 캠페인 기준](MKT-P-03)` 처럼 코드로 링크합니다.
- 표, 목록, 인용(`>`), 코드블록 모두 그대로 렌더링됩니다.
- 프론트매터를 못 채워도 괜찮습니다. 본문만 넣어 주면 나머지는 채워 드립니다.

## 컨플루언스에서 옮기는 법

1. 문서 → `...` → **Export** → Markdown (또는 Word/HTML) 로 내보내기
2. 내보낸 파일을 그대로 이 폴더에 넣기 — 마크다운 정리는 이쪽에서 처리합니다
3. 마크다운 내보내기가 막혀 있으면, 페이지 본문을 복사해 `.md` 로 저장해도 됩니다

## 사내 정보 주의

실제 사내 문서를 넣기 전에, 외부 반출이 가능한 범위인지 확인해 주세요.
