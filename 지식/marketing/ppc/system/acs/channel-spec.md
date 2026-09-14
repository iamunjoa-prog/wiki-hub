---
title: ACS 접점 채널별 연동 규격
code: PPC-ACS-03
category: marketing
version: 1
updatedBy: 구*화
updatedAt: 2026-09-10
ownerId: ppc-team
scope: 공통
systems: [ACS]
parent: PPC-ACS-01
order: 3
status: 정리완료
source: "원문 §3-2) 2.2 접점 채널별 필수 설정 변수 및 연동 규격"
---

> 적용대상 **공통** · 관련 시스템 ACS · 상위 [ACS 개요](PPC-ACS-01)

| 채널 | 핵심 연동 필드 | 설정 규칙·주의 |
| --- | --- | --- |
| **TV 팝업 / OAP** | 팝업 ID / 편성 명칭 / 메일 기안 폼 | 상용 편성된 TV팝업 중 타겟팅할 팝업을 매핑. 하단 **메일 기안 UI** 로 편성 채널 담당자에게 연동 협조 메일을 즉시 상신 |
| **타겟배너(빅배너) / 타겟메뉴(블럭)** | GNB 유형 / 콘텐츠 ID / 노출 종료일 | 단말 버전 그룹(v4.0 / v5.0)에 맞춰 배너 이미지 경로와 GNB 편성 영역(예: TV다시보기)을 매핑하고 노출 기간 제어 |
| **v5.0 토스트 팝업** | 바로가기 유형 (텍스트, 시놉바로가기, 장르홈, APP 등) | 클릭 시 랜딩 목적지 제어. **시놉바로가기**: 타겟 VOD 상세 ID. **장르홈**: 랜딩할 GNB 메뉴. **APP**: 인앱 서비스의 Service ID, Item ID, VAS ID |
| **Push Message (모바일 B tv)** | 메시지 형태 / Notice No / Content ID | 아래 참고 |

## Push Message 작성 규칙

- **VOD 상세보기 이동**: Content ID 필드에 **중괄호를 포함한 코드** 를 적는다 (예: `{D28F151D-...}`). **SER_NO 필드는 반드시 빈칸**.
- **Web 이동**: 메시지 길이 제한 때문에 원본 URL을 **단축 URL** 로 줄여 등록한다. 이미지 URL도 동일.

> 원문은 단축 URL 도구로 goo.gl을 안내하지만, goo.gl은 신규 생성이 중단된 서비스다. *(보완 필요: 현재 사용하는 단축 URL 도구 확인)*

## 관련 정책

- [TV팝업 운영 기준](PPC-P-42) — 버튼별 UI 버전, 피로도 제외
- [배너 유형별 편성 기준](PPC-P-41)
- 단축 URL 미적용 시 증상 → [ACS 예외처리](PPC-ACS-08)
