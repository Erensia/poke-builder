---
title: "교체 직후 설치물로 쓰러진 포켓몬의 대체는 행동 전이 아니라 턴 끝에 내보낸다"
author: Erensia
date: 2026-11-27
branch: feature/8.3-d3-fix55-faint-replacement-timing
cost: { minutes: 1, tokens: 1379 }
id: l-a8b3d35d
scope: repo
status: active
src: agent
---

## Decided
Showdown gen 9는 checkFainted를 큐가 빌 때(잔류 처리까지 끝난 뒤)에만 부르므로, 교체 직후 설치물로 쓰러져도 상대 행동은 그대로 진행(쓰러진 대상을 노리는 기술은 실패)하고 대체는 턴 끝에 들어온다. 행동 전 대체 장치(faintReplacement)를 걷어냈다. "대상 없음" 판정의 Showdown 차이(고스트 저주·록온·미래예지·대폭발·판정 순서)는 원래 있던 것이라 fix-55에 섞지 않고 별도 fix(E8-51)로 뺐다.
## Tried and ruled out
전멸 가드 추가: 사전 쓰러짐은 그 턴 자발 교체한 포켓몬뿐이고 교체로 나간 포켓몬이 살아 있어 예비가 항상 있어 도달 불가.
## Watch out
옛 규칙을 고정한 시험은 12-ver2x 2.1과 82-ver83-d3fix51 4뿐(후자는 도우미가 forcedSwitch를 처리하지 않아 깨짐). In the code: runTurn.ts runActionPhase, 시험 86-ver83-d3fix55.mjs. 해시는 regress만 변함(20000: 542408→542481턴, b 9958→9957, 시간초과 115→116).
