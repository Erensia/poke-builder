# Poke-Builder

Pokémon Champions 파티 빌더 — 6슬롯 파티를 구성하고 타입 상성을 확인하며, 결정력·내구력 매치업까지 판정하는 웹 앱.

## 주요 기능 (Phase 1 ~ 1.5)

- **6슬롯 파티 편성**: 포켓몬 선택 → 기술 4개 / 특성 1개 / 도구 1개 배치
- **메가진화 자동 전환**: 메가스톤을 도구로 장착하면 아바타·타입·스탯이 즉시 해당 메가폼 기준으로 바뀜 (메가X/Y처럼 폼이 2개인 경우도 지원)
- **타입 상성 요약**: 파티 전체가 18타입 공격에 얼마나 약한지/버티는지 한눈에 보여주고, 타입 칸을 클릭하면 어떤 포켓몬이 해당되는지 드릴다운
- **성격·능력포인트 편집**: 챔피언스 전용 실수치 공식(레벨/개체값 없음)으로 계산, 스탯당 최대 32/합산 66 포인트 배분
- **결정력 & 내구력 매치업**: 내 포켓몬과 상대 포켓몬·기술을 고르면 확정 1타 ~ 3타 이상까지 5단계로 판정. 랭크 상태·날씨·특성 배율·다단히트 기술(×1/×2/×3)까지 반영
- **대전 로그(다중 턴 시뮬레이션)**: 양쪽 포켓몬을 편성하고 매 턴 기술을 직접 골라가며 여러 턴짜리 가상 대전을 진행. 우선도·실효 스피드(동속 랜덤, 트릭룸이면 역전) 기반 턴 순서, 레벨 50 기준 실제 데미지·%HP, 명중/회피율(반짝가루·광각렌즈·포커스렌즈 배율 포함)·급소율, 화상·독·맹독·마비·잠듦·얼음 상태이상(정확한 해제 확률·타입 면역까지 전수 검증)과 풀죽음·반동·혼란·졸음 같은 행동방해 효과, 반동(recoil) 데미지·다단히트·2턴 차지 기술(공중날기 등)·상태이상 치료·불꽃타입 해동, 잠자기·광합성·뿌리박기·씨뿌리기·희망사항 등 HP/PP 회복 엔진, 날씨(5턴 카운트다운·배율·배경색·특성 자동 발동·연장 바위)와 필드(그래스/미스트/사이코/일렉트릭)·리플렉터/빛의장막 스크린, 지닌 도구 위력 보정(타입 강화·생명의구슬·달인의띠·메트로놈·나무열매 등 41종)까지 반영해 턴별 로그로 보여줌
- **로컬 자동 저장**: 편성 내용이 브라우저에 자동 저장되고 새로고침해도 복원됨

## 데이터 규모

- 포켓몬 23종 (메가진화 12종, 그중 리자몽은 메가X/Y 2폼)
- 기술 335개 (우선도·랭크 변화·다단히트 정보 포함)
- 특성 45개 (전부 효과 설명 포함, 그중 7개는 결정력/내구력 계산용 배율로 구조화)
- 도구 86종 (메가스톤 13 + 지닌 도구 73, 전부 효과 설명 포함. 그중 41개는 데미지 위력 보정 배율로 구조화)
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
├─ types/        Pokemon, Move, Ability, Item, Party, Nature, Matchup, BattleStats, Status 등 도메인 타입
├─ data/         pokemon.json, moves.json, abilities.json, items.json, natures.json, typeChart.json
├─ lib/          데이터 조회, 타입 상성 계산, 메가폼 계산, 파티 상성 집계, 실수치/결정력/내구력/상세 데미지 계산,
│                특성 배율(moveContext로 통합), 랭크 상태, 명중/회피/급소 계산, 턴 순서, 상태이상/행동방해,
│                다중 턴 배틀 시뮬레이터(battleSimulator), 로컬 저장
├─ hooks/        useParty.ts(파티 상태), useMatchup.ts(매치업 화면 상태), useBattleSetup.ts(대전 로그 셋업 상태)
└─ components/   Sidebar, PartyBoard, PartySlotCard, TypeCoverageSummary, MatchupPage,
                 MatchupSlotCard, VerdictBadge, WeatherPicker, BattleLogPage, BattleSetupCard,
                 *PickerModal, PointsEditorModal, StageEditorModal 등
```

## 문서

- [docs/phase1-review.md](docs/phase1-review.md) — Phase 1 회고: 목표 대비 결과, 데이터 소스 변화, 확정된 아키텍처 결정, 알려진 갭, Phase 2 제안
- [docs/phase1.5-review.md](docs/phase1.5-review.md) — Phase 1.5 회고: 데이터 완성(우선도·랭크변화·다단히트 등), 챔피언스 전용 능력치·결정력·내구력 계산 엔진, 매치업 UI, 사이드바 리디자인
- [docs/phase2-plan.md](docs/phase2-plan.md) — Phase 2 기획: 턴 순서 계산, 회피율/급소율·상세 데미지 공식 등 스키마 갭, 다중 턴 시뮬레이션 엔진, 대전 로그 UI
- [docs/phase2.5-plan.md](docs/phase2.5-plan.md) — Phase 2.5 기획: 페이지 폭 불일치·대전 로그 메가진화 표시 버그 수정, 회피율/급소율/풀죽음/반동 데이터 태깅
- [docs/phase3-plan.md](docs/phase3-plan.md) — Phase 3 기획: 반동 데미지·다단히트·2턴 차지기·날씨/필드/상태이상 6종 전수 재검증·도구 위력 보정률 등 신규 스키마 전체 기록
- [docs/phase3-status.md](docs/phase3-status.md) — Phase 3 진행 현황 요약 (여러 PC에서 이어 작업하기 위한 빠른 참조)
- [docs/phase4-plan.md](docs/phase4-plan.md) — Phase 4 기획: HP/PP 회복 엔진, 명중률 배율 배선, 트릭룸, 날씨/필드 지속시간 시스템 등 후속 백로그
- [docs/phase4.5-plan.md](docs/phase4.5-plan.md) — Phase 4.5 기획: 포켓몬 로스터 확장, 사이드 메뉴(포켓몬 도감·기술표) 활성화, Phase 4 이월 백로그

## 로드맵

- ✅ Phase 1: 파티 빌더 MVP
- ✅ Phase 1.5: 데이터 완성 + 결정력·내구력 계산 엔진 & 매치업 화면
- ✅ Phase 2: 전투 시뮬레이터 — 턴 순서, 상세 데미지 공식, 명중/회피/급소, 상태이상·행동방해, 다중 턴 대전 로그 화면
- ✅ Phase 2.5: UI 폭 통일, 대전 로그 메가진화 표시 버그, 회피율/급소율/풀죽음/반동 데이터 태깅
- ✅ Phase 3: 반동·급소 특수기술·2턴 차지기·다단히트·상태이상 치료/지연형·배짱 면역 무시 등 신규 스키마, 날씨·필드 시스템, 상태이상 6종 전수 재검증, 지닌 도구 위력 보정률 41종
- ✅ Phase 4: 명중률 전용 도구 배율, 트릭룸, HP/PP 회복 엔진(잠자기·회복형 변화기·회복 도구·나무열매), 날씨 5턴 카운트다운 + 스크린(리플렉터/빛의장막) 신규 구현, 메가진화 고정 특성 UI 정합성 ([docs/phase4-plan.md](docs/phase4-plan.md))
- 🔲 Phase 4.5: 포켓몬 로스터 확장(일렉트릭필드 학습 포켓몬 포함), 사이드 메뉴(포켓몬 도감·기술표) 활성화, 필드 개별 기술 상호작용 등 후속 보강 (자세한 목록: [docs/phase4.5-plan.md](docs/phase4.5-plan.md))
