---
title: "맹독 카운터는 나갈 때 초기화해도 Showdown과 결과가 같고, 열탕은 이미 상대 해동이 된다"
author: Erensia
date: 2026-11-19
branch: dev
cost: { minutes: 1, tokens: 2471 }
id: l-07ef76ee
scope: repo
status: active
src: agent
touches:
  - src/data/moves.json
  - src/lib/battle/switching.ts
---

## Decided
맹독 카운터 초기화는 Showdown처럼 들어올 때가 아니라 교체로 나갈 때 한다. 관측 결과가 같고, 대기 포켓몬이 이미 1로 저장돼 AI 교체 후보 평가가 별도 코드 없이 맞는 값을 본다. 모든 교체가 performSwitch를 지난다.

## Tried and ruled out
1차 검수 문서의 "열탕도 상대 해동이 빠졌다"는 틀렸다. 열탕은 데이터에 curesStatus(상대, 얼음)가 있어 이미 해동한다. 빠진 것은 열사의대지뿐이라 코드 없이 데이터 한 줄로 고친다. 검수 때 코드 분기만 보지 말고 기술 데이터의 curesStatus까지 확인할 것.

## Watch out
Showdown의 thawsTarget 기술은 덤프에 scald·scorchingsands·matchagotcha 3개이고 엔진에는 앞의 둘만 있다. 대타를 맞췄을 때의 해동은 소스 해석이 필요해 열탕과 같은 동작으로 맞추기로 했다.

In the code:
- src/data/moves.json 열탕의 curesStatus, 열사의대지에는 없음
- src/lib/battle/switching.ts performSwitch 물러나는 포켓몬 초기화 블록
- docs/00_기획문서/02_backlog/08_ver.8.0/03_ver.8.3/8.3-D3-fix14-맹독설계.md, 8.3-D3-fix15-열사의대지해동설계.md
