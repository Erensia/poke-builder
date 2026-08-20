# Poke-Builder

Pokémon Champions 파티 빌더 — 6슬롯 파티를 구성하고 타입 상성을 확인하며, 결정력·내구력 매치업까지 판정하는 웹 앱.

## 주요 기능 (Phase 1 ~ 1.5)

- **6슬롯 파티 편성**: 포켓몬 선택 → 기술 4개 / 특성 1개 / 도구 1개 배치
- **메가진화 자동 전환**: 메가스톤을 도구로 장착하면 아바타·타입·스탯이 즉시 해당 메가폼 기준으로 바뀜 (메가X/Y처럼 폼이 2개인 경우도 지원)
- **타입 상성 요약**: 파티 전체가 18타입 공격에 얼마나 약한지/버티는지 한눈에 보여주고, 타입 칸을 클릭하면 어떤 포켓몬이 해당되는지 드릴다운
- **성격·능력포인트 편집**: 챔피언스 전용 실수치 공식(레벨/개체값 없음)으로 계산, 스탯당 최대 32/합산 66 포인트 배분
- **결정력 & 내구력 매치업**: 내 포켓몬과 상대 포켓몬·기술을 고르면 확정 1타 ~ 3타 이상까지 5단계로 판정. 랭크 상태·날씨·특성 배율·다단히트 기술(×1/×2/×3)까지 반영
- **로컬 자동 저장**: 편성 내용이 브라우저에 자동 저장되고 새로고침해도 복원됨

## 데이터 규모

- 포켓몬 21종 (메가진화 12종, 그중 리자몽은 메가X/Y 2폼)
- 기술 335개 (우선도·랭크 변화·다단히트 정보 포함)
- 특성 45개 (전부 효과 설명 포함, 그중 7개는 결정력/내구력 계산용 배율로 구조화)
- 도구 86종 (메가스톤 13 + 지닌 도구 73, 전부 효과 설명 포함)
- 성격 21종

## 기술 스택

React + TypeScript + Vite, 별도 백엔드 없이 로컬 JSON 데이터 + `localStorage`로 동작.

## 시작하기

```bash
npm install
npm run dev
```

5173 포트가 다른 프로젝트와 겹칠 수 있어 `vite.config.ts`에서 5174로 고정했다 — `http://localhost:5174`로 접속한다.

## 폴더 구조

```
src/
├─ types/        Pokemon, Move, Ability, Item, Party, Nature, Matchup, BattleStats 등 도메인 타입
├─ data/         pokemon.json, moves.json, abilities.json, items.json, natures.json, typeChart.json
├─ lib/          데이터 조회, 타입 상성 계산, 메가폼 계산, 파티 상성 집계, 실수치/결정력/내구력 계산,
│                특성 배율, 랭크 상태, 로컬 저장
├─ hooks/        useParty.ts(파티 상태), useMatchup.ts(매치업 화면 상태)
└─ components/   Sidebar, PartyBoard, PartySlotCard, TypeCoverageSummary, MatchupPage,
                 MatchupSlotCard, VerdictBadge, WeatherPicker, *PickerModal, PointsEditorModal,
                 StageEditorModal 등
```

## 문서

- [docs/phase1-review.md](docs/phase1-review.md) — Phase 1 회고: 목표 대비 결과, 데이터 소스 변화, 확정된 아키텍처 결정, 알려진 갭, Phase 2 제안
- [docs/phase1.5-review.md](docs/phase1.5-review.md) — Phase 1.5 회고: 데이터 완성(우선도·랭크변화·다단히트 등), 챔피언스 전용 능력치·결정력·내구력 계산 엔진, 매치업 UI, 사이드바 리디자인

## 로드맵

- ✅ Phase 1: 파티 빌더 MVP
- ✅ Phase 1.5: 데이터 완성 + 결정력·내구력 계산 엔진 & 매치업 화면
- ⏳ Phase 2: 전투 시뮬레이터 (턴 순서 계산, 다중 턴 대전 로그)
