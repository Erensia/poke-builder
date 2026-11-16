---
title: "Compare engine move data against Showdown, not against its own description text"
author: Erensia
date: 2026-11-16
branch: dev
cost: { minutes: 7, tokens: 175777 }
id: l-ca792a13
scope: repo
status: active
src: agent
touches:
  - docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-E0-검수.md
  - docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-세션인계.md
  - docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-엔진배선전수검수설계.md
  - docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-엔진배선전수검수설계-검수.md
---

## Decided
Data-layer review maps engine names to Showdown ids through PokeAPI Korean names (spaces stripped), then diffs fields against the champions dump.

## Tried and ruled out
The earlier effect-text vs field check (B3) cannot catch records where text and fields agree but describe the wrong move (two such records found).

## Watch out
Engine pp is the real max PP, so compare against maxPP, not pp. Revival Blessing is noPPBoosts, so 1 is correct. Auto-diff has false positives for handler-based effects (stat boosts, multihit accuracy).

In the code:
docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/D3-검수자료/zz-d3-data-diff.mjs.txt (copy to scripts/zz-*.mjs, never commit)
