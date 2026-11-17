---
title: "Accuracy modifiers use Showdown's own 4096 numerators, not the damage chain's rounding"
author: Erensia
date: 2026-11-17
branch: dev
cost: { minutes: 1, tokens: 21636 }
id: l-2eb072eb
scope: repo
status: active
src: agent
touches:
  - src/lib/battle/hitChance.ts
---

## Decided
Accuracy uses a small numerator table (compound eyes 5325/4096, wide lens 4505, bright powder 3686) instead of quantizing decimals, per `8.3-D3-fix8-명중정수설계.md`; Showdown truncates accuracy to an integer percent after the rank step.

## Tried and ruled out
Reusing the damage `q()` quantizer for accuracy: it turns 1.3 into 5324 (life orb in damage) but compound eyes is 5325 in Showdown, so one function cannot match both.

## Watch out
In the code: `computeBattleHitChance` in `src/lib/battle/hitChance.ts` is shared by the AI evaluator and `moveDamage.ts`. Triple Axel hits after the first use unrounded floats in champions, so they need a non-integer mode. fix-8 starts only after fix-6 merges so hash changes stay separable.
