---
title: "8.3 D3-fix-10 난동 구현: 수면 calming 필수·원인 분리·머지 후 ff 함정"
author: Erensia
date: 2026-11-19
branch: dev
cost: { minutes: 33, tokens: 652891 }
touches:
  - scripts/battle-ai-scenarios/11-ver19-limits.mjs
  - scripts/battle-ai-scenarios/41-ver83-d3fix10.mjs
  - scripts/verify-kit/baseline/greedy120.out
  - scripts/verify-kit/baseline/regress20000.out
  - scripts/verify-kit/verify.sh
  - src/lib/battle/finishTurn.ts
  - src/lib/battle/rampage.ts
  - "\"docs/00_\\352\\270\\260\\355\\232\\215\\353\\254\\270\\354\\204\\234/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-fix9-\\352\\263\\241\\354\\230\\210\\354\\204\\244\\352\\263\\204.md\""
  - "\"docs/00_\\352\\270\\260\\355\\232\\215\\353\\254\\270\\354\\204\\234/02_backlog/08_ver.8.0/03_ver.8.3/8.3-backlog.md\""
  - "\"docs/00_\\352\\270\\260\\355\\232\\215\\353\\254\\270\\354\\204\\234/02_backlog/08_ver.8.0/03_ver.8.3/8.3-\\354\\204\\270\\354\\205\\230\\354\\235\\270\\352\\263\\204.md\""
---

## Decided
- 난동은 예정 마지막 턴(`entry.turnsRemaining === 1`) 끊김에 혼란을 걸고(`confuseAfterRampage`, 정상 종료와 공용·미스트필드 검사 포함), 턴 종료 `applyDrowsySleepOnset` 바로 뒤에 `calmRampageIfAsleep`을 둔다(PR #510 `a36741a`). 새 로그 필드 없이 기존 `rampageConfused` 재사용. 1.9 결정 D는 사용자 인게임 확인으로 번복.
- 새 기준값: `regress 200` `ab5f585e…`(끊김 혼란만으로 바뀜 — 수면 해제·미스트필드를 꺼도 같음), `regress 20000` `af303f53…`.

## Tried and ruled out
- `turnsRemaining === 1`만 적용: 명중한 턴 안에서 잠든 경우(느린 상대 수면 기술·하품)에 혼란이 잘못 걸린다(시험 14로 확인). 수면 해제 한 줄이 필수.
- 해시 원인 분리를 4개 전체 측정으로: `regress 200`(약 5초)만 변형별로 재면 충분하고 20000은 필요한 변형 하나만.

## Watch out
- 기존 시험 `11-ver19-limits.mjs`가 1.9 결정(마지막 턴 방어 → 혼란 없음)을 고정하고 있었다 — 규칙 번복 때는 `test:ai` 전체에서 그 결정을 쓴 시험을 찾아 고친다.
- 머지 직후 `git merge --ff-only origin/dev`는 머지 전에 받은 ref라 "Already up to date"가 나온다. 다시 `git fetch` 먼저.
