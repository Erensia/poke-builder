# 포켓몬 배틀 AI — 엔진 확장 명세서 (v1.1)

> `battle-ai-common-engine.md`(v1.0/1.1) 및 `battle-ai-decision-layer.md`의 후속 문서다. 공통 엔진이 "완전 정보 가정"으로 남겨둔 4개 확장 항목(상태이상·회복기·특성/도구·날씨/필드)을 다룬다. 다섯 번째 항목인 "불완전 정보 추정"은 방법론이 달라 별도 문서에서 다룬다.
>
> 데이터 기준: 포켓몬 챔피언스(9세대 기반), `abilities.json`(216개)·`items.json`(held-item 85개, 메가스톤 제외)·`moves.json` 등 실제 엔진 코드 grep 확인 결과. 아래 필드명·조건·수치는 전부 코드 대조를 거쳤다.

## 0. 공통 엔진 문서(v1.1)에 반영해야 할 전제 변경

이 확장 작업 도중 `battle-ai-common-engine.md`의 기존 전제 2가지가 깨지는 것이 확인되었다. 공통 엔진 문서를 v1.1로 갱신할 때 함께 반영해야 한다.

| 항목 | 기존 전제 | 깨지는 조건 | 필요한 수정 |
|---|---|---|---|
| c/d 출력 형식 | 이산 분류 `{count, certainty, probability}` | 의사결정 레이어 설계 과정에서 확률 가중 기대값 방식으로 전환 | `{expected, worst_case}` 형식으로 변경 (상세는 `battle-ai-decision-layer.md` 0절 참고) |
| a-defensive 공통값 가정 | "4개 기술 옵션 모두 방어 상성은 동일(현재 포켓몬 기준)하므로 공통 계산" | `changesUserTypeToMoveType`(변환자재·리베로) 보유 시, 어떤 기술을 쓰느냐에 따라 그 즉시 본인 타입이 바뀌어 기술마다 a-defensive가 달라짐 | 이 필드 보유 시에만 4개 기술 각각에 대해 a-defensive를 개별 계산하도록 예외 분기 추가 (본 문서 3-1-3 참고) |

## 1. 상태이상

### 1-1. 포켓몬 챔피언스 확정 수치

챔피언스는 밸런스 조정을 위해 마비·냉동·수면 3종의 확률/지속 메커니즘을 본가(9세대)와 다르게 변경했다. 화상·독·맹독은 변경 목록에 없어 본가와 동일하다.

| 상태 | 잔여 데미지 | 행동 가능 확률 | 스탯 변화 |
|---|---|---|---|
| 마비 | 없음 | **12.5%로 완전마비** (P(행동가능)=0.875, 턴 무관 flat) | 속도 ×0.5 |
| 화상 | 최대체력 1/16 (매 턴) | 없음 | 물리 공격력 ×0.5 |
| 독 | 최대체력 1/8 (매 턴) | 없음 | 없음 |
| 맹독 | 1/16 × 경과턴수 (누적) | 없음 | 없음 |
| 수면 | 없음 | 턴별 조회 테이블 (아래) | 없음 |
| 냉동 | 없음 | 턴별 조회 테이블 (아래) | 없음 |

```
SLEEP_WAKE_TABLE  = { 1: 0.0,  2: 0.333, 3: 1.0 }   # 1턴째 무조건 잠듦 / 2턴째 33.3% 기상 / 3턴째 확정 기상
FREEZE_THAW_TABLE = { 1: 0.25, 2: 0.25,  3: 1.0 }   # 1·2턴째 매번 25% 해동 시도 / 3턴째 확정 해동
```

### 1-2. 공식 반영

```
E[damage_per_turn] = P(행동가능) × (Σ(weight_i × damage_i) + residual_damage_per_turn)
```

- 마비: `P(행동가능) = 0.875` (고정)
- 수면: `P(행동가능) = SLEEP_WAKE_TABLE[sleep_turn_count]`
- 냉동: `P(행동가능) = FREEZE_THAW_TABLE[frozen_turn_count]`
- 화상/독: `residual_damage_per_turn`에 가산, 화상은 물리 `damage_i` 계산 시 별도로 ×0.5
- 맹독: `residual_damage_per_turn = max_hp × (1/16) × toxic_turn_count`

### 1-3. 예외 — 포이즌힐

`healsFromPoisonEachTurnDenominator` 보유 시 독/맹독 DOT의 부호가 반전되어 회복으로 작동한다. 독 DOT 계산 시 부호만 반전하면 되는 단순 예외.

### 1-4. 상태 추적 필드

| 필드명 | 초기화 | 리셋 시점 |
|---|---|---|
| `toxic_turn_count` | 맹독 걸릴 때 1 | 매 턴 +1. **교체 시 1로 리셋**(상태 자체는 유지, 카운터만 리셋 — 9세대 이후 본가 규칙과 동일) |
| `sleep_turn_count` | 수면 걸릴 때 1 | 매 턴 +1, 기상 시 제거 |
| `frozen_turn_count` | 냉동 걸릴 때 1 | 매 턴 +1, 해동 시 제거 |

### 1-5. 범위 외

기술로 상태이상을 "부여"하는 것 자체는 상대 기술 가중치 모델(`w_status`)로 이미 처리됨. 다만 "상태이상을 걸면 다음 턴부터 유리해진다"는 이득은 다턴 예측(lookahead)이 필요해 범위 외.

## 2. 회복기

### 2-1. 상대가 회복기를 쓰는 경우 — 기존 확률 모델 확장

회복기는 이미 상대 기술 가중치 모델의 변화기(`w_status`) 버킷에 포함되어 있으므로, 회복량만 추가로 곱해 순 데미지를 재계산한다.

```
E[opponent_heal_per_turn] = w_status × heal_amount        # heal_amount 초기값: 최대체력의 0.5 고정
E[opponent_net_hp_loss_per_turn] = E[my_damage_per_turn] − E[opponent_heal_per_turn]
hits_to_kill.expected = opponent_remaining_hp / E[opponent_net_hp_loss_per_turn]

# 예외: 분모 ≤ 0이면 (내 화력보다 상대 회복량이 크거나 같음)
if E[opponent_net_hp_loss_per_turn] <= 0:
    hits_to_kill.expected = INFINITE
```

### 2-2. 내가 회복기를 옵션으로 고르는 경우 — 구조적 결함과 전용 점수식

회복기는 `damage_i = 0`이라 `hits_to_kill.expected = INFINITE`가 되고, 기존 `exchange_advantage = hits_to_be_killed.expected − hits_to_kill.expected` 공식에 대입하면 `−∞`가 되어 **회복기가 항상 최하위 점수를 받아 절대 선택되지 않는 구조적 결함**이 있었다. `hits_to_kill.expected == INFINITE`인 옵션(회복기, 데미지 없는 자기강화기 전반)은 exchange_advantage 대신 전용 점수식을 쓴다.

```
if hits_to_kill.expected == INFINITE:
    d_before = 현재 체력 기준 hits_to_be_killed.expected
    d_after  = (현재체력 + heal_amount, 최대체력 상한) 기준으로 재계산한 hits_to_be_killed.expected

    score = (d_after − d_before) × w_survival + speed_adjustment
    # entry_cost, switch tempo penalty는 해당 없음 (기술 사용 옵션이므로)
```

| 파라미터 | 초기값 | 비고 |
|---|---|---|
| `w_survival` | 1.0 | "생존 연장 1턴 = 타수차이 1"과 동일 무게로 취급, 시뮬레이션 튜닝 대상 |

### 2-3. 범위 외

이 방식은 "이번 턴 회복하면 다음 한 턴만큼 더 버틴다"는 근시안적 계산이며, 회복을 반복하는 소모전의 승패까지 내다보는 다턴 예측은 아니다. 같은 패턴(`hits_to_kill.expected == INFINITE`일 때 생존/화력 연장분 기준 재계산)을 데미지 없는 자기강화기(칼춤 등)에도 동일 적용 가능.

## 3. 특성/도구

전체 216개 특성·85개 도구를 "a~e 중 어디에 꽂히는지" 기준 6개 카테고리로 분류했다(도구는 메가스톤 제외).

### 3-0. 생존 보장 (하드 오버라이드와 직결 — 최우선 처리)

| 구분 | 대상 | 조건 | 생존 방식 | 소모성 |
|---|---|---|---|---|
| 확정형 | 옹골참(특성) | 풀피일 때만 | 100% 생존(1HP) | 아니오 — 풀피마다 재발동 |
| 확정형 | 기합의띠(도구) | 풀피일 때만 | 100% 생존(1HP) | **예 — 1회 소모** |
| 확률형 | 기합의머리띠(도구) | 체력 무관 | **10%** 확률로 생존(1HP) | 아니오 |

hits_to_kill/hits_to_be_killed 계산 파이프라인의 **후처리 단계**로 넣는다 — 하드 오버라이드나 점수식은 수정하지 않고, 여기서 보정된 값을 그대로 신뢰하고 쓴다.

```
def apply_survival_guarantee(hits_calc, target):
    # 확정형
    if target.current_hp == target.max_hp:
        if target.ability == "옹골참" or (target.item == "기합의띠" and not target.item_consumed):
            if hits_calc.worst_case.count == 1:
                hits_calc.worst_case.count = 2
                hits_calc.worst_case.certainty = "guaranteed"
                hits_calc.expected = max(hits_calc.expected, 2)
            return hits_calc

    # 확률형
    if target.item == "기합의머리띠" and hits_calc.worst_case.count == 1:
        p_survive = 0.10
        hits_calc.expected = 1 * (1 - p_survive) + 2 * p_survive   # = 1.1
        hits_calc.worst_case.certainty = "random"
        hits_calc.worst_case.probability = 1 - p_survive            # 0.9 = "1타에 죽을" 확률

    return hits_calc
```

이 후처리 한 번으로, 지난번 발견됐던 "확정 즉사 오버라이드가 실제로는 생존하는 상대에게 잘못 발동하는" 결함이 자동 해결된다 — `worst_case.count`가 이미 2로 바뀌어 있어 오버라이드 조건(`hits_to_kill.expected <= 1`)에 애초에 안 걸린다.

### 3-1. 상성 무효화/변경 (특성 20 + 도구 2 = 22)

**계산 순서 고정 (반드시 이 순서):**
```
1. 기본 상성 배율 계산
2. grantsImmunityToTypes / absorbsType 등으로 0 처리 (방어측)
3. bypassesImmunityForTypes / groundsHolder가 상대(공격측)에게 있으면 → 2번에서 0 처리한 걸 원래 배율로 복원
```

#### 3-1-1. 흡수형 (absorbsType, 8개)

| 특성 | 흡수 타입 | onAbsorbEffect | 세부값 |
|---|---|---|---|
| 저수 | 물 | heal | 0.25 |
| 축전 | 전기 | heal | 0.25 |
| 흙먹기 | 땅 | heal | 0.25 |
| 건조피부 | 물 | heal | 0.25 (불꽃 데미지 1.25배 증가는 별도 debuff) |
| 피뢰침 | 전기 | statBoost | 특공 +1단계 |
| 초식 | 풀 | statBoost | 공격 +1단계 |
| 전기엔진 | 전기 | statBoost | 스피드 +1단계 |
| 타오르는불꽃 | 불꽃 | **powerBoost** | 흡수한 타입 기술 위력 배율 **1.5**(확정, `boostsOwnMoveTypeMultiplier`) — 별도 상태 필드 불필요, 실전 엔진의 `ownMoveTypeBoosts` 딕셔너리를 그 자리에서 조회 |

```
onAbsorbEffect: "heal" | "statBoost" | "powerBoost" | "none"
onAbsorbHealFraction: float
onAbsorbStatBoost: { stat, stages }
onAbsorbPowerMultiplier: float

def apply_absorb_effect(pokemon, ability):
    if ability.onAbsorbEffect == "heal":
        pokemon.hp = min(pokemon.max_hp, pokemon.hp + pokemon.max_hp * ability.onAbsorbHealFraction)
    elif ability.onAbsorbEffect == "statBoost":
        pokemon.apply_stat_stage(ability.onAbsorbStatBoost.stat, ability.onAbsorbStatBoost.stages)
    elif ability.onAbsorbEffect == "powerBoost":
        pokemon.ownMoveTypeBoosts[ability.absorbType] = ability.onAbsorbPowerMultiplier   # 신규 필드 불필요 — 실전 엔진 필드 그대로 재사용
```

**더블배틀 확장 지점(미구현)**: 피뢰침 등 일부 흡수형은 원래 다른 대상을 노린 기술도 자신에게 끌어오는 유도 효과가 있음. 현재 싱글배틀 한정 설계라 반영 안 함 — 더블배틀 지원 시 `redirectsMoveOnAbsorb` 필드 추가 필요.

#### 3-1-2. 순수 면역 (2개)

| 특성 | 필드 | 값 | 비고 |
|---|---|---|---|
| 부유 | `grantsImmunityToTypes` | `["땅"]` | a-defensive = 0 |
| 천정부지 | `grantsImmunityToTypes` | `["땅"]` | 면역 자체는 동일 + `boostsHighestStatOnKo`(킬 트리거 랭크업) → **다턴 예측 필요, 범위 외로 이월** |

#### 3-1-3. 타입변신형 (2개) — 공통 엔진 전제 변경 필요

| 특성 | 필드 |
|---|---|
| 변환자재 | `changesUserTypeToMoveType: true` |
| 리베로 | `changesUserTypeToMoveType: true` |

```
if 자신.ability.changesUserTypeToMoveType == true:
    for move in self.current.moves:   # 4개 기술 각각 개별 계산 (공통값 재사용 불가)
        temp_type = move.type
        defensive_matchup_for_this_move = calc_type_matchup(opponent.moves, [temp_type])
```

#### 3-1-4. 스킨형 (5개) — a-offensive 계산에 반영

| 특성 | 조건(triggerBy/Value) | newType | powerMultiplier |
|---|---|---|---|
| 페어리스킨 | moveType: 노말 | 페어리 | 1.2 |
| 프리즈스킨 | moveType: 노말 | 얼음 | 1.2 |
| 스카이스킨 | moveType: 노말 | 비행 | 1.2 |
| 드래곤스킨 | moveType: 노말 | 드래곤 | 1.2 |
| 촉촉보이스 | moveCategory: 소리 | 물 | **1.0 (위력 변화 없음)** |

```
overrideMoveType: { triggerBy: "moveType" | "moveCategory", triggerValue, newType, powerMultiplier }
```

본인이 쓰는 기술 타입을 바꾸는 것이므로 **a-offensive** 계산에 적용(a-defensive 아님). 위력 배율은 카테고리 2(데미지 배율)와 연동.

#### 3-1-5. 공격측 예외 (1개) — 기존 3단계 파이프라인에 데이터만 대입

| 특성 | 필드 | 값 |
|---|---|---|
| 배짱 | `bypassesImmunityForTypes` | `["노말","격투"]` |

새 로직 불필요 — 3-1절 서두의 3단계 계산 순서에 이미 자리가 있음. 부식(상태이상 버전, 3-6-4절)과 같은 "공격측 방향 반전" 패턴.

#### 3-1-6. 날씨/필드 폼변화 (2개) — 4절로 이월

| 특성 | 필드 |
|---|---|
| 기분파 | `weatherFormChange: true` |
| 의태 | `terrainTypeChange: true` |

#### 3-1-7. 도구 2개

| 도구 | 필드 | 처리 |
|---|---|---|
| 검은철구 | `groundsHolder` | 3-1-5와 동일 "공격측 반전" 패턴 |
| 풍선 | `grantsGroundImmunity` | 1회성 → `item_consumed` 재사용. 소모 조건은 **데미지를 주는 기술 피격 시 전부**(`damage > 0`) — 땅타입 기술은 애초에 면역이라 damage=0이 되어 터질 일이 없을 뿐, 조건 자체는 타입 무관 |

### 3-2. 데미지 배율 변경

#### 3-2-1. 고정배율형 (최종 확정)

```
final_damage = base_damage
             × attacker_flat_multipliers        # powerMultiplier, moveCategoryMultiplier, moveTypeMultiplier, oneTimeGemMultiplier
             × defender_flat_reduction           # reducesSuperEffectiveDamageMultiplier / resistsSuperEffectiveType (효과굴일 때만)
```

| 그룹 | 소유자 | 배율 | 소모성 |
|---|---|---|---|
| 효과굴 반감(특성) | 필터, 하드록 | 0.75 (효과굴 단계 무관 고정) | 아니오 |
| 효과굴 반감(도구, 18타입) | 반감 열매 18종 | 0.5, **`defender_has_ability("숙성")`이면 0.25** | 예 |
| 카테고리 배율 | 힘의머리띠(물리)·박식안경(특수) | 1.1 | 아니오 |
| 타입 강화(18타입) | 목탄류 도구 전부 | 1.2 (예외 없음) | 아니오 |
| 생명의구슬 | 생명의구슬 | 1.3 (반동 10%는 범위 외) | 아니오 |
| 주얼 | 노말주얼 | 1.3 | 예 |
| 효과굴 강화 | 달인의띠 | 1.2 | 아니오 |

숙성 판정은 별도 상태 추적 없이 그 자리에서 특성을 정적 조회하면 된다(`ripen_active` 같은 상태 필드 불필요).

#### 3-2-2. 조건부/복합형 — 범용 "조건부 배율 엔진"

개별 if문 대신, 조건-배율 쌍을 데이터 테이블로 두고 하나의 루프가 순회하는 구조로 전부 커버한다.

```
modifier_table = [
  {ability: "맹화",       scope: "offense", multiplier: 1.5,  condition: {moveTypeIn:["불꽃"], attackerHpAtMostFraction: 0.333}},
  {ability: "급류",       scope: "offense", multiplier: 1.5,  condition: {moveTypeIn:["물"],   attackerHpAtMostFraction: 0.333}},
  {ability: "심록",       scope: "offense", multiplier: 1.5,  condition: {moveTypeIn:["풀"],   attackerHpAtMostFraction: 0.333}},
  {ability: "벌레의알림", scope: "offense", multiplier: 1.5,  condition: {moveTypeIn:["벌레"], attackerHpAtMostFraction: 0.333}},

  {ability: "단단한발톱", scope: "offense", multiplier: 1.3,  condition: {makesContact: true}},
  {ability: "파동의방호", scope: "defense", multiplier: 2.0,  condition: {makesContact: true}},
  {ability: "복슬복슬",   scope: "defense", multiplier: 2.0,  condition: {makesContact: true}},
  {ability: "복슬복슬",   scope: "defense", multiplier: 0.5,  condition: {moveTypeIn:["불꽃"]}},   # 위와 동시 매칭 시 2×0.5=1로 상쇄됨(의도된 누적곱)

  {ability: "메가런처",   scope: "offense", multiplier: 1.5,  condition: {moveClassificationIn:["파동"]}},
  {ability: "철주먹",     scope: "offense", multiplier: 1.2,  condition: {moveClassificationIn:["펀치"]}},
  {ability: "예리함",     scope: "offense", multiplier: 1.5,  condition: {moveClassificationIn:["베기"]}},
  {ability: "옹골찬턱",   scope: "offense", multiplier: 1.5,  condition: {moveClassificationIn:["물기"]}},
  {ability: "펑크록",     scope: "offense", multiplier: 1.3,  condition: {moveClassificationIn:["소리"]}},
  {ability: "펑크록",     scope: "defense", multiplier: 2.0,  condition: {moveClassificationIn:["소리"]}},

  {ability: "두꺼운지방", scope: "defense", multiplier: 2.0,  condition: {moveTypeIn:["불꽃","얼음"]}},
  {ability: "내열",       scope: "defense", multiplier: 2.0,  condition: {moveTypeIn:["불꽃"]}},   # + halvesBurnDamage 별도 반영
  {ability: "수포",       scope: "defense", multiplier: 2.0,  condition: {moveTypeIn:["불꽃"]}},   # + immuneToStatuses:["화상"] 별도
  {ability: "수포",       scope: "offense", multiplier: 2.0,  condition: {moveTypeIn:["물"]}},

  {ability: "순수한힘",   scope: "offense", multiplier: 2.0,  condition: {moveCategoryIn:["physical"]}},
  {ability: "천하장사",   scope: "offense", multiplier: 2.0,  condition: {moveCategoryIn:["physical"]}},   # 순수한힘과 별개 특성, 필드 동일
  {ability: "퍼코트",     scope: "defense", multiplier: 2.0,  condition: {moveCategoryIn:["physical"]}},
  {ability: "의욕",       scope: "offense", multiplier: 1.5,  condition: {moveCategoryIn:["physical"]}},   # + 명중률 0.8은 accuracy 공식 완성 후 자동 흡수 (범위 외)

  {ability: "선파워",     scope: "offense", multiplier: 1.5,  condition: {moveCategoryIn:["special"], weatherIs: "쾌청"}},
  {ability: "모래의힘",   scope: "offense", multiplier: 1.3,  condition: {moveTypeIn:["땅","바위","강철"], weatherIs: "모래바람"}},
  {ability: "풀모피",     scope: "defense", multiplier: 1.5,  condition: {moveCategoryIn:["physical"], fieldIs: "그래스필드"}},

  {ability: "멀티스케일", scope: "defense", multiplier: 2.0,  condition: {defenderHpIsFull: true}},
  {ability: "테크니션",   scope: "offense", multiplier: 1.5,  condition: {movePowerAtMost: 60}},
  {ability: "이상한비늘", scope: "defense", multiplier: 1.5,  condition: {moveCategoryIn:["physical"], defenderHasStatusCondition: true}},
  {ability: "이판사판",   scope: "offense", multiplier: 1.2,  condition: {moveHasRecoilDamage: true}},
]

def apply_conditional_modifiers(move, attacker, defender):
    multiplier = 1.0
    for mod in modifier_table:
        side = attacker if mod.scope == "offense" else defender
        if side.ability != mod.ability:
            continue
        if condition_matches(mod.condition, move, attacker, defender):
            multiplier *= mod.multiplier   # 같은 특성의 여러 modifier는 누적곱 (복슬복슬 상쇄가 자동 반영됨)
    return multiplier
```

`condition_matches`가 판정해야 하는 술어: `moveTypeIn` / `attackerHpAtMostFraction` / `makesContact` / `moveClassificationIn` / `moveCategoryIn` / `weatherIs` / `fieldIs` / `defenderHpIsFull` / `movePowerAtMost` / `defenderHasStatusCondition` / `moveHasRecoilDamage`.

**투쟁심 — 계산형 술어 (테이블 행이 아닌 별도 함수):**

```
def rivalry_multiplier(attacker, defender):
    if attacker.ability != "투쟁심": return 1.0
    if attacker.gender is None or defender.gender is None: return 1.0
    return 1.25 if attacker.gender == defender.gender else 0.75
```

**전용 필드형 (modifiers[] 아닌 별도 필드, 조건 없어 사실상 고정형과 동급):**

| 특성 | 필드 | 값 |
|---|---|---|
| 관통드릴 | `contactIgnoresDefenseBoostAndGuaranteesMinDamageFraction` | 0.25 |
| 부자유친 | `followUpHitPowerMultiplier` | 0.25 |
| 스나이퍼 | `critDamageMultiplier` | 2.25 |
| 적응력 | `stabOverride` | 2.0 (자속 1.5→2.0 대체) |
| 우격다짐 | `tradesSecondaryEffectForPower` | 1.3 (부가효과 삭제 트레이드) |

**웨이트류 (별도 처리 — modifier_table에 안 넣음):**

무게 기반 기술은 실존하며 이미 위력 계산 함수가 구현되어 있다(`battlePower.ts:102~126`).

```
weightRatioPowerValue(userKg, targetKg)     # 체중 비율 기반(헤비봄버류): ≤1/5→120, ≤1/4→100, ≤1/3→80, ≤1/2→60, 그 외 40
absoluteWeightPowerValue(targetKg)          # 상대 절대 체중 기반(풀묵기류): <10→20, <25→40, <50→60, <100→80, <200→100, 그 이상 120
WEIGHT_MOVE_FALLBACK_POWER = 60             # weightKg 데이터 미기재 시 임시값
```

| 특성 | 필드 | 값 | 반영 방식 |
|---|---|---|---|
| 라이트메탈 | `weightMultiplier` | 0.5 | 위 두 함수의 입력값(`userKg`/`targetKg`)에 곱해서 반영 |
| 헤비메탈 | `weightMultiplier` | 2.0 | 위와 동일 |

**필드 전역형 (attacker/defender 개별 조회 아님):**

| 특성 | 필드 | 값 |
|---|---|---|
| 페어리오라 | `auraMoveTypeMultiplier` | `{페어리, 1.33}` — 소유자 기준 아닌 필드 전체 적용 |

```
field_state.fairy_aura_active = (attacker.ability == "페어리오라") or (defender.ability == "페어리오라")
if field_state.fairy_aura_active and move.type == "페어리":
    multiplier *= 1.33
```

**탈 — 신규 상태 필드 필요:**

```
disguise_active: bool   # 기본값 true, 첫 피격 시 false + 반동(최대체력 1/8)
                         # 교체해도 유지, 배틀 끝날 때까지 복구 안 됨 (곡예와 정반대 패턴)
```

### 3-3. 스피드 변경

**고정배율형 (6개) — 3-2-1과 동일 패턴, 날씨 조건만 다름:**

```
speed_multiplier = 1.0
if 현재날씨 == pokemon.ability.weatherSpeedTrigger:   # 엽록소(쾌청)·쓱쓱(비)·모래헤치기(모래바람)·눈치우기(눈), 전부 ×2
    speed_multiplier *= 2
if pokemon.item.speedMultiplier:   # 구애스카프 1.5 / 검은철구 0.5
    speed_multiplier *= pokemon.item.speedMultiplier
```

**상태 추적형 (1개):**

| 특성 | 필드 | 처리 |
|---|---|---|
| 곡예 | `doublesSpeedOnItemLoss` | `unburden_active` 상태 추적. 도구를 잃는 **사건**(소모/떨어트리기/날리기) 발생 시 true. **교체로 필드를 벗어나면 false로 리셋** |

**AI 설계 불필요 (제외):**

| 특성 | 이유 |
|---|---|
| 가속 (`boostsSpeedEachTurnEnd`) | 매 턴 자동 랭크업이라 배틀 엔진의 턴 종료 처리에서 이미 반영되어 있어야 함. AI의 speed_order 계산은 "그 시점의 실효 스피드"를 그대로 읽어오면 되므로 별도 로직 불필요 |

### 3-4. 우선도 변경 (특성 5 + 도구 1)

```
def resolve_effective_priority(move, attacker, defender):
    priority = move.base_priority

    if attacker.ability == "짓궂은마음" and move.is_status_move:
        priority += 1
    if attacker.ability == "질풍날개" and move.type == "비행" and attacker.hp == attacker.max_hp:
        priority += 1

    if attacker.ability == "시간벌기":
        return ALWAYS_LAST

    if (defender.ability in ["여왕의위엄", "테일아머"]
        and priority >= 1
        and move.targets_opponent):     # 필수 — 방어·순풍 같은 자기/필드 대상 기술은 제외
        return MOVE_FAILS

    return priority
```

| 특성/도구 | 필드 | 효과 |
|---|---|---|
| 짓궂은마음 | `statusMovePriorityBoost` | 변화기 우선도 +1 |
| 질풍날개 | `flyingMovePriorityBoostAtFullHp` | 비행 타입 + 풀피 시 우선도 +1 |
| 시간벌기 | `movesLastInPriorityBracket` | 항상 최후순위 |
| 여왕의위엄 / 테일아머 | `blocksOpponentPriorityMoves` | 우선도≥1 **AND 상대를 직접 겨냥하는 기술**만 무효화(자기/필드 대상 기술은 안 막힘). 필드까지 완전히 동일한 별개 특성(순수한힘/천하장사와 같은 패턴) |
| 선제공격손톱(도구) | `quickClawChance` | 20% 확률로 순서 역전 |

**선제공격손톱 — 확률적 순서 역전:**

```
if attacker.item == "선제공격손톱":
    p_trigger = 0.20
    speed_adjustment = p_trigger * (+0.5) + (1 - p_trigger) * normal_speed_adjustment(attacker, opponent)
```

**하드 오버라이드 제외 로직에도 동일 필터 반영 필요:**

```
if (상대.ability in ["여왕의위엄", "테일아머"]
    and 이기술.priority >= 1
    and 이기술.targets_opponent):
    선공_확정_불가   # 오버라이드 후보에서 제외
```

### 3-5. 상태이상 확률/면역 (특성 19 + 도구 8)

이 문서 1절(상태이상)에서 다룬 포이즌힐 외에, 상대 기술 가중치 모델(변화기 분류 단계)에 직접 영향을 주는 항목만 정리한다.

#### 3-5-1. 부식 — 데미지가 아닌 상태이상 면역 무시 (공격측 예외)

```
{"id": "부식", "bypassesPoisonTypeImmunity": true}
```

**중요**: 부식이 무시하는 건 "독타입 데미지기가 강철/독타입에게 안 먹히는 데미지 면역"이 **아니라**, "독가루·맹독처럼 상태이상을 거는 변화기가 강철/독타입에게 안 먹히는 상태이상 면역"이다. 독타입 데미지기는 부식이 있어도 강철 타입 상대로는 여전히 0배다.

```
def classify_move_weight(move, attacker, defender):
    # 데미지 면역은 부식과 무관
    if move.deals_damage and move.type in TYPE_IMMUNITY[defender.types]:
        return 0

    # 상태이상 부여 변화기 — 여기에만 부식 예외 적용
    if move.inflicts_status == "독" and defender.types intersects ["독", "강철"]:
        if not attacker.ability == "부식":
            return 0
        # 부식 있으면 배제하지 않고 아래 일반 변화기 분류로 진행

    if move.is_status_move:
        return w_status
    else:
        return damage_proportional_weight(move)
```

**스모크테스트 대상**: 킬라플로르(hiddenAbility: 부식)·염뉴트(기본 특성: 부식) — 검증 포인트는 "독 상태이상 변화기가 실제로 먹히는지"(독타입 데미지기 계산이 아님).

#### 3-5-2. 황금몸 · 매직미러 — 변화기 전체 무효 (상태이상보다 범위 넓음)

```
def classify_move_weight(move, attacker, defender):
    if move.is_status_move and defender.ability in ["황금몸", "매직미러"]:
        return 0
    ...
```

황금몸은 모든 변화기가 무효, 매직미러는 원래 "무효화+반사"이지만 반사 결과(상대에게 어떤 영향을 주는지)는 다턴 예측이 필요해 범위 외 — **"나에게는 무효"까지만 반영**한다.

## 4. 날씨/필드

### 4-1. 상태 모델 (날씨/필드 분리 — 규칙이 다름)

```
weather_state = {
    type: "쾌청" | "비" | "모래바람" | "눈" | None,
    turns_remaining: int,   # 기본 5, 연장석 보유 시 8
}

field_state = {
    type: "그래스필드" | "사이코필드" | "일렉트릭필드" | None,   # 미스트필드는 로스터에 없어 제외
    turns_remaining: int,   # 기본 5, 그라운드코트 보유 시 8
}
```

연장 도구: 뜨거운바위(쾌청+3)·차가운바위(눈+3)·보송보송바위(모래바람+3)·축축한바위(비+3) / 필드는 그라운드코트 하나가 4필드 공통 +3.

### 4-2. 덮어쓰기 규칙 — 날씨와 필드가 다름 (핵심 비대칭)

```
def apply_weather(new_type, setter_has_extender):
    weather_state.type = new_type   # 같은 날씨여도 무조건 갱신 (카운트다운 리셋)
    weather_state.turns_remaining = 8 if setter_has_extender else 5

def apply_field(new_type, setter_has_extender):
    if field_state.type == new_type:
        return FAILED   # 동일 필드 재설치는 실패, 상태 변경 없음
    field_state.type = new_type
    field_state.turns_remaining = 8 if setter_has_extender else 5
```

| | 날씨 | 필드 |
|---|---|---|
| 동일 종류 재설치 | **항상 성공, 카운트다운 리셋** | **항상 실패, 상태 변화 없음** |
| 다른 종류 설치 | 항상 덮어씀 | 덮어씀 |

### 4-3. 동시 등장 처리

양쪽 다 스피드 내림차순으로 순차 발동하며, **나중에(느린 쪽이) 발동하는 게 최종 상태로 남는다.** 날씨·필드 모두 같은 함수 패턴(실효 스피드 정렬 → 순회) 공유 확인됨.

```
def resolve_simultaneous_weather_setters(pokemon_list):
    for p in sorted(pokemon_list, key=lambda x: effective_speed(x), reverse=True):
        if p.ability in WEATHER_SETTING_ABILITIES:
            apply_weather(WEATHER_SETTING_ABILITIES[p.ability], p.has_extender_rock)
```

필드는 서로 다른 필드 특성 2마리 동시 등장 시 위와 동일하게 "나중 실행이 최종값"이며, 동일 필드 특성 2마리 동시 등장(사실상 파티 구성상 무의미) 시 두 번째 시도가 실패해 첫 번째가 유지된다.

### 4-4. 발동 특성/기술

| 구분 | 날씨 | 필드 |
|---|---|---|
| 발동 특성 | 가뭄(쾌청)·잔비(비)·모래날림(모래바람)·눈퍼뜨리기(눈) — 등장 즉시. 모래뿜기는 **피격 시** 발동(트리거 다름) | 그래스메이커·사이코메이커·일렉트릭메이커 — 등장 시 5턴 고정. 미스트필드 대응 특성은 로스터에 없음 |
| 발동 기술 | 4종 전부 `setsWeather` 필드로 존재 | 4종 전부 `setsField` 필드로 존재 |

### 4-5. 이월된 6개 항목 최종 계산식

```
# 스피드 4종 (3-3절 이월)
if pokemon.ability == "엽록소"     and weather_state.type == "쾌청":   speed_multiplier *= 2
if pokemon.ability == "쓱쓱"       and weather_state.type == "비":     speed_multiplier *= 2
if pokemon.ability == "모래헤치기" and weather_state.type == "모래바람": speed_multiplier *= 2
if pokemon.ability == "눈치우기"   and weather_state.type == "눈":     speed_multiplier *= 2

# 선파워, 모래의힘, 풀모피 (3-2-2절 이월) — modifier_table의 weatherIs/fieldIs 조건에 weather_state/field_state 값 그대로 대입

# 기분파, 의태 (3-1-6절 이월) — 트리거가 기술 선택이 아니라 날씨/필드 상태이므로
# 턴 시작 시 1회만 계산하면 되고, 4개 기술 옵션 간 공통값으로 재사용 가능
if pokemon.ability == "기분파": pokemon.current_type = WEATHER_FORM_MAP[weather_state.type]
if pokemon.ability == "의태":   pokemon.current_type = FIELD_FORM_MAP[field_state.type]
```

## 5. 새로 추적하는 상태 — 전체 목록

| 필드명 | 대상 | 초기화 | 리셋/유지 규칙 |
|---|---|---|---|
| `toxic_turn_count` | 맹독 상태 포켓몬 | 1 | 매 턴 +1, **교체 시 1로 리셋** |
| `sleep_turn_count` | 수면 상태 포켓몬 | 1 | 매 턴 +1, 기상 시 제거 |
| `frozen_turn_count` | 냉동 상태 포켓몬 | 1 | 매 턴 +1, 해동 시 제거 |
| `item_consumed` | 기합의띠·풍선·노말주얼·반감열매 18종 | false | 발동/소모 시 true, 영구 유지. **풍선의 정확한 소모 조건 미확인** |
| `unburden_active` | 곡예 보유 포켓몬 | false | 도구 상실 "사건" 시 true, **교체 시 false로 리셋** |
| `disguise_active` | 탈 보유 포켓몬 | true | 첫 피격 시 false, **교체해도 유지, 배틀 끝까지 복구 안 됨** |
| `weather_state` | 필드 전역 | `{None, 0}` | 4-2절 규칙 |
| `field_state` | 필드 전역 | `{None, 0}` | 4-2절 규칙 |
| `field_state.fairy_aura_active` | 필드 전역 | false | 페어리오라 보유 포켓몬이 필드에 있는 동안 true |

## 6. 정정 이력

문서화 과정에서 발생한 정정을 남겨, 향후 유사 항목 조사 시 같은 실수를 반복하지 않기 위해 기록한다.

| 항목 | 최초 추정 | 정정 결과 |
|---|---|---|
| 이상한비늘 | "상성 무효화 필드(reducesSuperEffectiveDamageMultiplier)를 쓸 것" | `modifiers[](scope: defense)`, 조건은 "물리 기술 + 상태이상 보유" (물리 한정 조건 누락됐던 것도 추가 정정) |
| 프리즘아머 | "필터·하드록과 함께 반감 3인방" | 이 로스터에 존재하지 않음(코드 주석에만 언급) |
| 구애머리띠·구애안경 | `moveCategoryMultiplier` 소유로 추정 | 이 필드를 쓰지 않음. 실제 소유자는 힘의머리띠·박식안경(1.1배) |
| 노력의머리띠 | `superEffectiveMultiplier` 소유로 추정 | 이 데이터셋에 존재하지 않는 이름. 실제 소유자는 달인의띠 |
| 무르익음 | ripen 트리거 특성명으로 추정 | 실제 이름은 "숙성"(`doublesBerryEffect`) |
| 부식 | 데미지 배율 파이프라인(독타입 공격기 면역 무시)에 반영 | 상태이상 부여 변화기의 면역 무시로 정정, 상대 기술 가중치 모델로 이동 |
| 여왕의위엄/테일아머 | `priority > 0`이면 무조건 무효화 | `move.targets_opponent` 조건 추가 필요(자기/필드 대상 기술은 안 막힘) |
| 순수한힘/천하장사 | 하나로 착각 가능성 있었음 | 필드가 완전히 동일한 별개 특성(중복 아님) |
| 타오르는불꽃 | `flash_fire_active`라는 신규 상태 필드 필요로 추정 | 실전 엔진은 별도 필드 없이 `ownMoveTypeBoosts` 딕셔너리를 그 자리에서 조회 — 신규 필드 불필요(이상한비늘·숙성과 같은 패턴) |

## 7. 명중률(Accuracy)

의욕 특성(3-2-2절)을 계기로 발견된 구조적 공백(§7 구판에 기록)을 여기서 해소한다. **전부 기존 함수
재사용 — 신규 계산 로직 없음.** 실전 배틀 엔진(`preHitEffects.ts:819`~`854`)과 매치업 페이지가
이미 공유하는 `computeHitChance`(`accuracyCrit.ts`)·`getItemAccuracyMultiplier`(`itemEffects.ts`)를
그대로 호출하면 된다.

### 7-1. 명중률 배율 전체 목록 (코드 확인 완료)

**공격측(자신의 이 기술 명중률에 곱함)**:

| 특성/도구 | 필드 | 값 | 비고 |
|---|---|---|---|
| 복안(특성) | `userAccuracyMultiplier` | 1.3 | |
| 광각렌즈(도구) | `accuracyMultiplier` | 1.1 | |
| 포커스렌즈(도구) | `accuracyMultiplierWhenMovingSecond` | 1.2 | **상대보다 늦게 움직일 때만** — `speed_order != "first"`일 때만 적용 |
| 의욕(특성) | `hustlePhysicalAccuracyMultiplier` | 0.8(페널티) | **물리 기술 한정**(이미 3-2-2절에서 확정) |

**방어측(상대가 나를 맞출 명중률에 곱함)**:

| 특성/도구 | 필드 | 값 | 비고 |
|---|---|---|---|
| 모래숨기(특성) | `weatherOpponentAccuracyMultiplier` | 0.8 | 모래바람일 때만 |
| 눈숨기(특성) | `weatherOpponentAccuracyMultiplier` | 0.8 | 눈일 때만 |
| 반짝가루(도구) | `opponentAccuracyMultiplier` | 0.9 | |

**필중/회피율 무시 예외**:

| 특성 | 필드 | 효과 |
|---|---|---|
| 노가드 | `alwaysHits` | 자신 또는 상대 중 누구든 보유하면 그 배틀의 이 교전은 무조건 명중(`hitChance = null`과 동치로 취급) |
| 날카로운눈 / 발광 | `ignoresOpponentEvasionBoost` + `blocksOpponentAccuracyDrops` | 상대의 회피율 **상승분만** 무시(마이너스 회피율은 그대로 존중) — 필드까지 동일한 별개 특성(순수한힘/천하장사와 같은 중복 패턴) |
| (참고) 성스러운칼 계열 | `ignoresDefenderStatStagesInDamage` | 회피율을 완전히 0으로 취급(방향 구분 없음) — 날카로운눈과 달리 마이너스 회피율도 무시 |

플라잉프레스가 "작아지기를 쓴 적 있는 상대"에게 필중인 것처럼 **기술 고유의 필중 예외**도 있으나,
이런 케이스는 이미 `effectiveMove.accuracy`/`bonusVsMinimize` 판정에 녹아 있어 AI가 별도로 처리할
필요 없음 — `computeHitChance` 호출 전에 실전 엔진과 동일한 우회 조건만 그대로 확인하면 된다.

### 7-2. c/d 공식에 적용

**hits_to_kill.expected(자신의 기술)**: 옵션으로 검토 중인 기술 하나에 대해 명중률을 구해 기존
데미지 롤 기대값에 곱한다.

```
accuracy_i = 1.0 if (attacker.ability.alwaysHits or defender.ability.alwaysHits or minimize_bonus)
             else compute_hit_chance(move_i.accuracy, attacker.accuracyStages.accuracy,
                                      effective_defender_evasion, accuracy_extra_multiplier)
# accuracy_extra_multiplier = 공격측 배율(복안·광각렌즈·포커스렌즈·의욕) × 방어측 배율(모래숨기·눈숨기·반짝가루)
# 필중기(move_i.accuracy == null)는 compute_hit_chance가 그대로 null → accuracy_i = 1.0

E[damage_per_turn]_i = accuracy_i × (기존 데미지 롤 기대값, 3절 결정 레이어 §3)
hits_to_kill.expected = remaining_hp / E[damage_per_turn]_i
```

**hits_to_be_killed.expected(상대 기술 4개 가중 모델, decision-layer §2)**: 기존 공식의 각 항에
그 기술 고유의 accuracy_i를 곱하기만 하면 된다 — 변화기는 `damage_i = 0`이라 곱해도 영향 없음.

```
E[damage_per_turn] = Σ (weight_i × damage_i × accuracy_i)     # 공격기에만 실질적 영향
```

### 7-3. 하드 오버라이드에 필중 조건 추가 (논리적 구멍 메움 — 중요)

`battle-ai-decision-layer.md` §6의 기존 조건은 **데미지 롤 확정성**(`worst_case.certainty ==
"guaranteed"`)만 체크해서, 명중률이 100% 미만인 원턴킬 기술(예: 스톤에지 80%)도 "확정 처치"로
오인해 오버라이드가 발동할 위험이 있었다. **`accuracy_i == 1.0` 조건을 반드시 추가**한다.

```
if 선공 == true AND hits_to_kill.expected <= 1 AND worst_case.certainty == "guaranteed" AND accuracy_i == 1.0:
    해당 옵션 즉시 채택, 점수 계산 생략
```

`accuracy_i < 1.0`인 원턴킬 후보는 오버라이드 대상에서 제외되고, 이미 accuracy가 곱해진
`hits_to_kill.expected`로 다른 옵션들과 점수식 기준 정상 비교된다 — "확정"이 아니라 "높은 성공률의
도박"으로 정확히 반영되는 자연스러운 결과.

### 7-4. 범위 유지 — 상태이상 부여 변화기의 적중 여부

맹독(90%)처럼 명중률이 100% 미만인 상태이상 부여 변화기가 "실제로 상태이상을 걸었을 때"의 이득은
1-5절과 같은 이유(효과가 다음 턴부터 나타나는 지연 효과)로 여전히 다턴 예측 범위 — 이번 확장은
변화기 버킷(`w_status`)의 가중치 자체를 건드리지 않는다.

### 7-5. 필요한 어댑터

`computeHitChance`/`getItemAccuracyMultiplier`는 이미 `Move`/`AccuracyEvasionStages`/`Item` 순수
타입만 받는 함수라 신규 로직이 필요 없다 — 유일하게 새로 채워야 하는 입력값은 "이 옵션이 상대보다
늦게 움직이는지"(`getItemAccuracyMultiplier`의 `attackerMovesSecond` 인자)뿐이며, 이는 6개 옵션
평가 중 이미 계산되는 `speed_order`에서 바로 뽑아 쓸 수 있다(`speed_order != "first"`).

**대상**: 신규 파일 없음 — AI 평가 엔진 구현부에서 `accuracyCrit.ts`/`itemEffects.ts`를 import해서
그대로 호출.

**상태**: 설계 완료. §8의 "명중률 계산 전체 누락" 항목은 이걸로 해소.

## 8. 범위 외 사항 (다음 단계)

- **불완전 정보 추정** (별도 문서에서 다룸 — 방법론 자체가 다름: "완전 정보 하에 정확히 계산" vs "정보가 없을 때 무엇으로 대체할지")
- **매직미러 반사 결과** — 다턴 예측 필요
- **천정부지 킬 트리거 부가효과**(`boostsHighestStatOnKo`) — 다턴 예측 필요
- **생명의구슬 반동**(최대체력 1/10) — 다턴 예측 필요
- **더블배틀 확장 지점** — `redirectsMoveOnAbsorb`(피뢰침 등 유도 효과) 등, 싱글배틀 AI 검증 후 필요 시 착수
