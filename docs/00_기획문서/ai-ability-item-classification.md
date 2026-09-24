# 특성·도구 영향 대상별 분류 (배틀 AI 엔진 확장용)

## 0. 이 문서의 성격

배틀타워 AI 엔진 확장 명세서 작성을 위해, 현재 데이터(`src/data/abilities.json`
216개, `src/data/items.json`의 held-item 85개 — **메가스톤 81개는 제외**)를
아래 6개 기준으로 전수 분류한 결과다. 분류는 각 특성/도구의 구조화된 효과
필드(설명 텍스트가 아니라 실제 엔진 로직에 쓰이는 필드)를 기준으로 했다 —
필드명·해당 특성/도구 목록은 2026-09-19 시점 데이터 기준.

하나의 특성/도구가 여러 기준에 걸치면 전부 표기했다(예: 페어리스킨은 자기 타입을
바꾸므로 "1. 상성"과, 위력도 붙으므로 "2. 데미지 배율" 양쪽에 다 들어감).

## 1. 상성 무효화/변경

**특성(20)**: 건조피부, 기분파, 드래곤스킨, 리베로, 배짱, 변환자재, 부유, 스카이
스킨, 의태, 저수, 전기엔진, 천정부지, 초식, 촉촉보이스, 축전, 타오르는불꽃, 페어리
스킨, 프리즈스킨, 피뢰침, 흙먹기

**도구(2)**: 검은철구(비행/부유도 접지 취급), 풍선(땅타입 무효)

## 2. 데미지 배율 변경

**특성(48)**: 건조피부, 관통드릴, 급류, 내열, 단단한발톱, 두꺼운지방, 드래곤스킨,
라이트메탈, 맹화, 멀티스케일, 메가런처, 모래의힘, 벌레의알림, 보이지않는주먹,
복슬복슬, 부자유친, 불꽃의갈기, 선파워, 수포, 순수한힘, 스나이퍼, 스카이스킨,
심록, 예리함, 옹골찬턱, 우격다짐, 의욕, 이상한비늘, 이판사판, 적응력, 정화의소금,
천진, 천하장사, 철주먹, 촉촉보이스, 탈, 테크니션, 투쟁심, 파동의방호, 퍼코트,
펑크록, 페어리스킨, 페어리오라, 풀모피, 프리즈스킨, 필터, 하드록, 헤비메탈

**도구(42)**: 검은띠, 검은안경, 금속코트, 기적의씨, 꼬시개열매, 노말주얼, 녹지않는
얼음, 달인의띠, 독바늘, 딱딱한돌, 로셀열매, 로플열매, 루미열매, 리체열매, 린드열매,
마코열매, 메트로놈, 목탄, 바리비열매, 바코열매, 박식안경, 부드러운모래, 생명의구슬,
수불열매, 슈캐열매, 신비의물방울, 실크스카프, 야파열매, 예리한부리, 오카열매,
요정의깃털, 용의이빨, 으름열매, 은빛가루, 자석, 저주의부적, 초나열매, 카리열매,
플카열매, 하반열매, 휘어진스푼, 힘의머리띠

## 3. 스피드 변경

**특성(6)**: 가속, 곡예, 눈치우기, 모래헤치기, 쓱쓱, 엽록소

**도구(2)**: 검은철구(0.5배), 구애스카프(1.5배)

## 4. 우선도 변경

**특성(5)**: 시간벌기, 여왕의위엄, 질풍날개, 짓궂은마음, 테일아머

**도구(1)**: 선제공격손톱

## 5. 생존 보장(즉사 방지)

**특성(1)**: 옹골참

**도구(2)**: 기합의띠, 기합의머리띠

## 6. 상태이상 확률/면역

**특성(19)**: 내열, 독수, 마그마의무장, 매직미러, 면역, 부식, 불면, 수포, 스위트
베일, 싱크로, 열교환, 유연, 의기양양, 자연회복, 정화의소금, 탈피, 포이즌힐,
플라워베일, 황금몸

**도구(8)**: 리샘열매, 멘탈허브, 배리열매, 버치열매, 복분열매, 복슝열매, 시몬열매,
유루열매

## 7. 경계 사례 메모 (분류 시 참고)

- **다중 소속**: 건조피부·드래곤스킨·스카이스킨·페어리스킨·프리즈스킨·촉촉보이스
  (1+2 — 노말스킨류라 자기 타입 자체가 바뀌면서 위력도 붙음). 수포·내열·정화의소금
  (2+6 — 특정 타입 반감 효과와 그 타입이 유발하는 상태이상 면역을 한 특성이 같이
  가짐).
- **넣긴 했지만 성격이 다소 다른 것들**: 황금몸(모든 변화기 무효라 상태이상보다
  범위가 넓음) · 매직미러(변화기 전체 반사, 상태이상 한정 아님) · 부식(반대
  방향 — "면역을 무시하고 상태이상을 걸 수 있게" 하는 공격측 특성이지 방어측
  면역이 아님).
- **제외했지만 애매했던 것**: "탈"(negatesFirstHitThenRecoils, 첫 피격 데미지
  1회 무효)은 실질적으로 생존기처럼 작동하지만 즉사 여부와 무관하게 무조건
  발동이라 5번이 아니라 2번(데미지 배율 0배)으로 분류. "멘탈허브"(헤롱헤롱/도발
  등 치료)는 엄밀히는 상태이상이 아니라 "특수상태(volatile)"라 6번에 넣을지
  애매했으나 일단 포함.
- **absorbsType 계열 부가효과**: 전기엔진(전기 흡수+스피드 상승)·피뢰침(전기
  흡수+특공 상승)처럼 "1. 상성" 특성 중 일부는 흡수와 동시에 스탯 상승 부가효과가
  있음 — 다만 이건 고정 필드가 아니라 개별 로직이라 "3. 스피드"/그 외 카테고리에
  기계적으로 중복 등록하지는 않았음(필요하면 개별 확인).

## 8. 원자료 — 분류에 쓴 데이터 필드

| 카테고리 | 특성 필드 | 도구 필드 |
|---|---|---|
| 1. 상성 무효화/변경 | `absorbsType`, `grantsImmunityToTypes`, `bypassesImmunityForTypes`, `changesUserTypeToMoveType`, `weatherFormChange`, `terrainTypeChange`, `modifiers[].overrideMoveType` | `grantsGroundImmunity`, `groundsHolder` |
| 2. 데미지 배율 변경 | `modifiers[]`(scope offense/defense), `reducesSuperEffectiveDamageMultiplier`, `critDamageMultiplier`, `hustleAttackMultiplier`, `auraMoveTypeMultiplier`, `followUpHitPowerMultiplier`, `rivalryDamage`, `tradesSecondaryEffectForPower`, `contactIgnoresDefenseBoostAndGuaranteesMinDamageFraction`, `negatesFirstHitThenRecoils`, `stabOverride`, `ignoresOpponentStatStagesInDamage`, `contactBypassesProtectAtQuarterDamage`, `weightMultiplier` | `powerMultiplier`, `moveCategoryMultiplier`, `moveTypeMultiplier`, `oneTimeGemMultiplier`, `consecutiveSameMoveMultiplier`, `superEffectiveMultiplier`, `resistsSuperEffectiveType` |
| 3. 스피드 변경 | `weatherSpeedMultiplier`, `doublesSpeedOnItemLoss`, `boostsSpeedEachTurnEnd` | `speedMultiplier` |
| 4. 우선도 변경 | `flyingMovePriorityBoostAtFullHp`, `statusMovePriorityBoost`, `blocksOpponentPriorityMoves`, `movesLastInPriorityBracket` | `quickClawChance` |
| 5. 생존 보장(즉사 방지) | `survivesLethalAtFullHp` | `survivesLethalAtFullHpOnce`, `survivesLethalChance` |
| 6. 상태이상 확률/면역 | `immuneToStatuses`, `curesOwnStatusChance`, `curesStatusOnSwitchOut`, `poisonTouchChance`, `reflectsStatusToOpponent`, `reflectsOpponentStatusMoves`, `healsFromPoisonEachTurnDenominator`, `bypassesPoisonTypeImmunity`, `grassVeil`, `blocksOpponentStatusMoveEffects`, `halvesBurnDamage` | `curesStatusOnInflict`, `curesConfusionOnInflict`, `curesMentalVolatilesOnInflict` |

집계 시점: 2026-09-19. 데이터 파일이 바뀌면(신규 특성/도구 추가 등) 이 목록도
다시 뽑아야 함 — 재집계는 위 필드 매핑 그대로 스크립트 재실행하면 됨.
