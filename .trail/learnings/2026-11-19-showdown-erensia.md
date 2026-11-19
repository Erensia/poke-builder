---
title: Showdown 맹독 피해는 나눗셈을 먼저 내림하고 단계를 곱한다 — 엔진은 곱한 뒤 내림이라 어긋난다
author: Erensia
date: 2026-11-19
branch: dev
cost: { minutes: 5, tokens: 94117 }
id: l-6f742f38
scope: repo
status: active
src: agent
touches:
  - docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-E4a-검수.md
  - src/lib/statusConditions.ts
  - src/lib/battle/mirroredEffects.ts
  - docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-세션인계.md
  - docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-엔진배선전수검수설계.md
---

## Decided
E4를 주 상태이상(E4-a)과 휘발성 상태(E4-b)로 나눠 검수한다. E4-a 결과: 수정필요 3(열탕·열사의대지 상대 해동, 맹독 피해식, 맹독 카운터 교체 시 초기화), 결정필요 1(마비 판정 순서, E4-b 뒤에 한꺼번에).

## Tried and ruled out
수면·얼음·마비 확률 스케줄은 일찍기상·잠자기까지 손계산으로 일치 확인 — 더 볼 필요 없다. 화상·독은 내림·최소 1 보정이 도달 불가(최소 기본 HP 35)라 문제없음.

## Watch out
Showdown `clampIntRange`는 내림이라 맹독은 `floor(HP/16)*단계`다. 엔진 `floor(HP*n/16)`과 HP 100~400 조합의 75%가 다르다. 열탕 해동은 Showdown `thawsTarget`(덤프에 scald·scorchingsands·matchagotcha)이며 엔진에 해당 필드가 없다. 구현 시 regress·greedy120·status60 해시가 바뀔 수 있다.

In the code:
- 엔진: src/lib/statusConditions.ts computeStatusEndOfTurnDamage, src/lib/battle/mirroredEffects.ts 해동 분기(약 1129행), src/lib/battle/switching.ts(교체 시 turnsElapsed 미초기화)
- Showdown: ~/showdown-ref/data/conditions.ts tox, data/moves.ts thawsTarget
- 문서: docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-E4a-검수.md
