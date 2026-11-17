---
title: "Check damage rounding by re-implementing Showdown's 4096 chain, not by building Showdown"
author: Erensia
date: 2026-11-17
branch: dev
cost: { minutes: 1, tokens: 0 }
id: l-a6cb5236
scope: repo
status: active
src: agent
touches:
  - src/lib/damageFormula.ts
  - src/lib/battle/hitResolution.ts
---

## Decided
Showdown source is read-only reference; rounding differences in `src/lib/damageFormula.ts` `integerHitDamage` were measured by re-implementing Showdown's chain/modify in a throwaway node script.

## Tried and ruled out
Fetching the pinned Showdown commit by short hash fails ("couldn't find remote ref"); the full 40-char hash with a depth-1 fetch works.

## Watch out
In the code: Showdown copy is outside the repo at C:\Users\fnrld\showdown-ref (965a535). `integerHitDamage`/`resolveHit` in `src/lib/battle/hitResolution.ts` multiply decimals (1.3) while Showdown quantizes to 4096ths: one multiplier matches, 2+ combined differ by 1 HP in 2-5% of values. Sniper (`critDamageMultiplier` 2.25) is a final-chain x1.5 in Showdown. Tinted Lens is not legal in the dump. Details: docs 8.3-D3-E1-검수.md.
