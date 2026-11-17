---
title: User damage cases cannot tell 4096 chain from decimal products because no case stacks two multipliers
author: Erensia
date: 2026-11-17
branch: dev
cost: { minutes: 5, tokens: 103158 }
id: l-5f7030f9
scope: repo
status: active
src: agent
touches:
  - docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-fix6-데미지체인설계.md
  - docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-E2-검수.md
  - scripts/damage-formula-check.mjs
  - src/lib/damageFormula.ts
---

## Decided
Both formulas pass all 40 cases in `scripts/damage-formula-check.mjs`, so by the user's rule the engine moves to the 4096 chain (design in `8.3-D3-fix6-데미지체인설계.md`).

## Tried and ruled out
Using the 40 cases as proof that 4096 is more accurate: each case has at most one multiplier per stage, where both formulas are identical.

## Watch out
In the code: `integerHitDamage` in `src/lib/damageFormula.ts`; the evaluator's `firstHitFinalMultiplier` (e.g. multiscale 0.5) must be included in any re-check or multiscale fails. A discriminating case needs two final-stage factors (attacker life orb 1.3 plus defender hard rock 0.75).
