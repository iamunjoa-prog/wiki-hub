---
title: PPV(단건) 프로모션 정책
code: PPC-P-30
category: marketing
version: 1
updatedBy: 구*화
updatedAt: 2026-09-10
ownerId: ppc-team
scope: PPV
systems: [CBS, ACS]
parent: PPC-P-00
order: 30
status: 초안
source: "원문 §2 CBS 적용요금제·적용대상, §3 ACS 캠페인 분류 중 PPV 해당 항목"
---

> 적용대상 **PPV 전용** · 관련 시스템 CBS, ACS · 상위 [프로모션 정책·업무](PPC-P-00)
>
> **초안** — 현재 원문은 PPM 중심이다. PPV 정책은 시스템 설정 기준만 옮겨 두었고, 정책·스킴은 추가 정리가 필요하다.

## 요약

PPV는 VOD **단건** 구매 상품이다. 쿠폰은 **건 단위(PPV 쿠폰)** 로 만들고, 적용 범위를 컨텐츠·CP·카테고리·시리즈·메타유형 등 **컨텐츠 단위** 로 좁힐 수 있다는 점이 PPM과 다르다. 다크패턴·전환동의·약정은 PPV에 해당하지 않는다.

## 하위 문서

| 문서 | 상태 |
| --- | --- |
| [PPV 쿠폰 스킴 설계 기준](PPC-P-31) | 초안 |
| [PPV 컨텐츠 단위 매핑 기준](PPC-P-32) | 초안 |
| [PPV 마케팅](PPC-P-33) | 빈 페이지 |

## 현재 확인된 PPV 기준

| 항목 | 기준 | 근거 |
| --- | --- | --- |
| CBS 적용 요금제 | 건단위 — PPV 쿠폰 | [CBS 핵심 필드](PPC-CBS-02) |
| CBS 매핑대상 '전체' | 모든 PPV 컨텐츠 적용 (PPM 상품에는 미적용) | [CBS 적용대상](PPC-CBS-03) |
| CBS 매핑대상 '컨텐츠' | 단건 쿠폰만 가능 | [CBS 적용대상](PPC-CBS-03) |
| ACS 캠페인 분류 | 'PPV 매출증대' 선택 시 단건 PPV VOD만 선택 가능 | [ACS 캠페인 변수](PPC-ACS-02) |
| 시놉시스 배너 | 특정 VOD 시놉시스 배너·쿠폰 다운로드 활용 | [배너 편성 기준](PPC-P-41) |

## 보완 필요

- PPV 프로모션 스킴 유형과 운영 정책
- PPV 캠페인 협의 부서 (PPM은 월정액**팀)
