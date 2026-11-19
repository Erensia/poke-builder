---
title: "8.3 D3-fix-13 자이로볼 식 정정: 사본 grep 결과·시험 구성·테크니션 확인"
author: Erensia
date: 2026-11-19
branch: feature/8.3-d3-fix13-gyro-formula
cost: { minutes: 4, tokens: 145440 }
touches:
  - scripts/battle-ai-scenarios/44-ver83-d3fix13.mjs
  - src/lib/battlePower.ts
  - scripts/battle-ai-scenarios.mjs
  - scripts/battle-ai-scenarios/43-ver83-d3fix12.mjs
---

## Decided
- 자이로볼 식의 사본은 `src/lib/battlePower.ts` `gyroBallPowerFromSpeeds` 한 곳뿐이다(계산기 화면·툴팁·도움말에 인라인 사본 없음). 엔진·매치업·AI·역산이 전부 이 함수를 거치므로 식 한 줄(`Math.min(150, Math.floor((25 * t) / p) + 1)`, 곱 먼저, 내 스피드 0 이하면 1)과 번복 이력 주석만 고쳤다.
- 테크니션(`movePowerAtMost`)은 `move.power`를 보는데, 엔진은 `effectiveMove`, 매치업은 위력이 채워진 `variablePowerMove`를 특성 배율에 넘기므로 계산된 최종 위력이 임계값 판정에 들어간다. 코드 수정 불필요.
- 시험 `scripts/battle-ai-scenarios/44-ver83-d3fix13.mjs`: AI 경로(시험 6)는 위력 26·51 고정 가짜 기술(`{...자이로볼, gyroBallPower:false, power:N}`)과 `estimateMoveHits().damageFraction`을 비교해 읽는다. 시험 9(식 사본 없음)는 src를 fs로 훑어 `floor(25*` 꼴이 battlePower.ts 밖에 없는지 확인한다.
- 시험 8(04·14번 역산 왕복의 위력 고정 리터럴)은 확인 결과 리터럴이 없어 별도 시험 없이 verify.sh가 맡는다(`50`은 HP 값이라 무관).

## Tried and ruled out
- 시험 5(매치업 ↔ 엔진 위력 일치)는 현행 코드에서도 통과한다: 둘 다 같은 함수를 부르는 일치 시험이라 식과 무관하다. 설계서의 "현행 예상: 실패"는 틀렸고, 실패해야 하는 시험은 1·2·3·4·6이다.

## Watch out
- 시험 러너(`scripts/battle-ai-scenarios.mjs`)는 파일 필터가 없고 전체를 돌린다(약 20초). `grep "실패"`는 시험 이름의 "실패"까지 걸리므로 `D3-fix13`·` false `로 거른다.
- 곱 먼저 순서 가드: (상대 161, 나 35)에서 옛 식은 140, 새 식은 116이어야 한다.
