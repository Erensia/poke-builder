---
title: "공격측 싱크로 복사는 모든 출처가 끝난 뒤 한 곳에서 처리한다"
author: Erensia
date: 2026-11-27
branch: feature/8.3-d3-fix53-synchronize
cost: { minutes: 11, tokens: 253971 }
id: l-4db36235
scope: repo
status: active
src: agent
touches:
  - scripts/battle-ai-scenarios/83-ver83-d3fix52.mjs
  - scripts/verify-kit/baseline/regress20000.out
  - scripts/verify-kit/baseline/status60.out
  - scripts/verify-kit/verify.sh
  - src/data/abilities.json
---

## Decided
fix-53 구현: 복사는 한 함수로 합치고, 공격측 보유자 방향(접촉 반응·부리캐논·토치카)은 mirrored 단계 뒤 resolveAction 한 곳에서 처리해 컨텍스트 전달 경로를 늘리지 않았다. 로그는 객체 필드 하나로 둔다(설계서의 평면 필드 4개에서 변경).

## Tried and ruled out
부리캐논 시험에 아이언헤드를 쓰면 풀죽음으로 상대가 행동 못 해 위력 비교가 무의미하다 — 풀죽음 없는 접촉기(전광석화)를 쓴다.

## Watch out
In the code: src/lib/battle/synchronize.ts, resolveAction.ts applySynchronizeReflections, 시험 84-ver83-d3fix53.mjs. 대상 기절 검사는 기존 방향에도 새로 들어가 해시가 바뀔 수 있다. 측정은 verify.sh 진행 중이라 src 수정 금지.
