# Poke-Builder

Pokémon Champions 파티 빌더 — 6슬롯 파티를 구성하고 타입 상성을 한눈에 확인하는 웹 앱.

## 주요 기능 (Phase 1 ~ 1.5)

- **6슬롯 파티 편성**: 포켓몬 선택 → 기술 4개 / 특성 1개 / 도구 1개 배치
- **메가진화 자동 전환**: 메가스톤을 도구로 장착하면 아바타·타입·스탯이 즉시 해당 메가폼 기준으로 바뀜 (메가X/Y처럼 폼이 2개인 경우도 지원)
- **타입 상성 요약**: 파티 전체가 18타입 공격에 얼마나 약한지/버티는지 한눈에 보여주고, 타입 칸을 클릭하면 어떤 포켓몬이 해당되는지 드릴다운
- **로컬 자동 저장**: 편성 내용이 브라우저에 자동 저장되고 새로고침해도 복원됨

## 데이터 규모

- 포켓몬 19종 (메가진화 12종, 그중 리자몽은 메가X/Y 2폼)
- 기술 330개
- 특성 43개 (전부 효과 설명 포함)
- 도구 86종 (메가스톤 13 + 지닌 도구 73, 전부 효과 설명 포함)

## 기술 스택

React + TypeScript + Vite, 별도 백엔드 없이 로컬 JSON 데이터 + `localStorage`로 동작.

## 시작하기

```bash
npm install
npm run dev
```

## 폴더 구조

```
src/
├─ types/        Pokemon, Move, Ability, Item, Party, PokemonType 등 도메인 타입
├─ data/         pokemon.json, moves.json, abilities.json, items.json, typeChart.json
├─ lib/          데이터 조회, 타입 상성 계산, 메가폼 계산, 파티 상성 집계, 로컬 저장
├─ hooks/        useParty.ts (파티 상태 + 자동 저장 + 메가폼 자동 전환)
└─ components/   Sidebar, PartyBoard, PartySlotCard, TypeCoverageSummary, *PickerModal 등
```

## 문서

- [docs/phase1-review.md](docs/phase1-review.md) — Phase 1 회고: 목표 대비 결과, 데이터 소스 변화, 확정된 아키텍처 결정, 알려진 갭, Phase 2 제안

## 로드맵

- ✅ Phase 1: 파티 빌더 MVP
- ✅ Phase 1.5: 데이터 보강 (특성/도구 설명, 도구 목록 확장)
- ⏳ Phase 2: 전투 시뮬레이터 (데미지 계산, 턴 순서, 대전 로그)
