---
title: "해동 코드에는 대타·빗나감 가드가 안 보여 열사의대지 수정이 범위가 커질 수 있다"
author: Erensia
date: 2026-11-19
branch: dev
cost: { minutes: 2, tokens: 31122 }
id: l-21f0c6ed
scope: repo
status: active
src: agent
touches:
  - docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-fix14-맹독설계.md
  - docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-fix15-열사의대지해동설계.md
  - src/lib/battle/mirroredEffects.ts
  - docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-fix14-맹독설계-검수.md
---

## Decided
fix-14 맹독은 검수 반영으로 확정: 하한 1은 곱하기 전에 건다(max(1, floor(HP/16)) × 단계), 초기화는 나갈 때 상태를 다시 읽어 맹독일 때만 덮어쓴다(자연회복이 먼저 지운 상태를 되살리지 않도록). 식과 카운터는 따로 측정한다.

## Tried and ruled out
설계서 시험 4의 HP 100·3틱 36은 현행 엔진도 36이라 먼저 실패를 확인할 수 없다. 실패 확인용 시험은 현행과 새 식의 값이 갈리는 HP(예: 155 → 현행 57, 새 54)로 골라야 한다.

## Watch out
Showdown은 대타에 맞으면 얼음 상대를 해동하지 않는다. 엔진 해동 두 갈래(curesStatus·불꽃 타입)에는 대타·명중 가드가 보이지 않는다. 파이프라인 앞에서 걸러지는지 구현 첫 단계에서 시험으로 확인하고, 아니면 열탕·불꽃 해동까지 같은 가드가 필요해 fix-15가 코드 변경으로 커진다.

In the code:
- src/lib/battle/mirroredEffects.ts healAndThaw(약 1106행), hitSubstitute 가드는 다른 부가효과(615·645·673행)에만 있음
- docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-fix14-맹독설계.md §7, 8.3-D3-fix15-열사의대지해동설계.md §6·7
