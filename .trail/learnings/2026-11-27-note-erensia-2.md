---
title: "변덕쟁이는 후보를 거른 뒤 뽑아야 해서 후보가 비면 난수를 부르지 않는다"
author: Erensia
date: 2026-11-27
branch: feature/8.3-d3-fix54-moody
cost: { minutes: 30, tokens: 75082 }
id: l-769de2ab
scope: repo
status: active
src: agent
touches:
  - scripts/battle-ai-scenarios/84-ver83-d3fix53.mjs
  - scripts/verify-kit/baseline/regress20000.out
  - src/components/turnLog/ActionEffectLines.tsx
  - src/components/turnLog/abilityLines.tsx
  - src/lib/battle/mirroredEffects.ts
  - src/lib/battle/resolveAction.ts
  - src/lib/battle/synchronize.ts
---

## Decided
fix-54: 올릴 후보(랭크 < +6)와 내릴 후보(랭크 > −6, 올린 것 제외)를 먼저 거른 뒤 뽑는다. 후보가 비면 난수를 안 부르므로 해시는 턴 수까지 바뀐다(20000판 중 발동 1414회, 그중 +6 보유 119·−6 보유 8).

## Tried and ruled out
반전(Contrary) 시험·문구는 특성 하나만 가질 수 있어 도달 불가라 삭제했다. 기절한 보유자 시험은 HP 0 상태 설정이 턴 실행과 맞지 않아 뺐다.

## Watch out
In the code: finishTurn.ts applyMoodyRandomStages, 시험 85-ver83-d3fix54.mjs(난수 호출 수는 변덕쟁이/대조 특성 두 번 돌려 차이로 센다). .trail은 gitignore라 git add -f 필요.
