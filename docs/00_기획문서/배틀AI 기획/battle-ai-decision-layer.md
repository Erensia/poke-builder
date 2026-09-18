# 포켓몬 배틀 AI — 의사결정 레이어 명세서

> 본 문서는 `battle-ai-common-engine.md`(공통 평가 엔진)의 후속 문서다. 공통 엔진이 산출한 6개 옵션의 값을 입력받아, 그중 하나를 최종 선택하는 로직만 다룬다. 엔진 자체의 계산 방식은 다루지 않는다.

## 0. 공통 엔진 문서 대비 변경 사항 (중요)

이 레이어를 설계하는 과정에서 공통 엔진의 출력 형식 일부가 함께 수정되었다. `battle-ai-common-engine.md`를 v1.1로 갱신할 때 아래 내용을 반영해야 한다.

| 필드 | 기존(v1.0) | 변경(v1.1) | 사유 |
|---|---|---|---|
| `hits_to_kill` | `{ count, certainty, probability }` (이산 분류) | `{ expected, worst_case }` | 데미지 롤 편차를 확률 가중 기대값으로 반영 |
| `hits_to_be_killed` | `{ count, certainty, probability }` (이산 분류) | `{ expected, worst_case }` | 상대 보유 기술 4개의 사용 확률을 반영한 기대값으로 전환 |

`worst_case`는 기존 이산 분류(`{ count, certainty, probability }`) 형식을 그대로 유지한다.

## 1. 파티 성향 처리 방침

파티 성향(대면/사이클/전개) 자동 분류(구 B안)는 채택하지 않는다.

| 단계 | 방식 | 상태 |
|---|---|---|
| 1단계 | 성향 구분 없는 범용 가중치 세트 하나로 전체 판단 | **본 문서의 범위 (지금 여기)** |
| 2단계 | 사용자가 파티/포켓몬에 직접 태그 지정 → 태그별 가중치 오버레이 | 범위 외 (다음 단계) |
| 3단계 | 파티 구성 자동 분석 후 성향 추론 | 장기 검토, 현재 미채택 |

## 2. 상대 기술 사용 확률 모델 (`hits_to_be_killed.expected` 산출용)

상대의 보유 기술 4개를 분류하여 사용 확률(가중치)을 부여한다.

| 분류 | 조건 | 가중치 처리 |
|---|---|---|
| 제외 | 상성 배율 0 (무효) | `weight = 0` |
| 중복 함정 | 이미 필드에 설치된 효과와 동일한 설치기 (예: 이미 깔린 스텔스록) | `weight = 0` (강제) |
| 변화기 전반 (설치기·랭크업기 등, 직접 데미지 없음) | 위 두 경우 제외한 나머지 변화기 | 고정 `w_status = 0.15` (기술 1개당, 여러 개면 균등 분배) |
| 공격기 | 유효 데미지 존재 | 데미지 비례 분배 (아래 수식) |

```
남은_가중치 = 1.0 − (변화기_개수 × w_status)
weight_i = (damage_i / Σ damage_j) × 남은_가중치     # j는 모든 공격기
```

```
E[damage_per_turn] = Σ (weight_i × damage_i)
hits_to_be_killed.expected = 잔여체력 / E[damage_per_turn]
```

### 2-1. 랭크업기 리스크 별도 처리

랭크업기(칼춤·용의춤 등)는 가중치 조정 대상이 아니다. 이번 턴 기대 데미지에는 기여하지 않으므로 위 계산에서는 flat 변화기와 동일하게 취급한다. 대신 **미래 리스크**로 별도 플래그를 둔다.

```
risk_flag = true   if 상대가 보유한 변화기 중 랭크업(공격 관련 스탯 상승) 효과가 하나라도 있음
```

## 3. 자신의 기대 타수 (`hits_to_kill.expected`)

데미지 롤(85~100%) 편차로 인해 "몇 타에 끝나는지"가 확률적으로 갈리는 경우, 확률 가중 평균으로 계산한다.

```
예) 난수2타 62% (나머지는 3타)
hits_to_kill.expected = (2 × 0.62) + (3 × 0.38) = 2.38
```

확1타/확2타처럼 확정적인 경우는 `expected = count` 그대로 사용한다.

## 4. 핵심 점수 공식

```
exchange_advantage = hits_to_be_killed.expected − hits_to_kill.expected

score = exchange_advantage
      + speed_adjustment
      − (entry_cost / max_hp) × 1.5
      − (0.3 if option_type == "switch" else 0)
      − (risk_flag_penalty_base × risk_aversion   if risk_flag else 0)
```

| 항목 | 값 | 설명 |
|---|---|---|
| `speed_adjustment` | 선공 +0.5 / 동속 0 / 후공 −0.5 | 타수 차이가 근소할 때만 실질적으로 작동하는 타이브레이커성 상수. 타수 차이가 1 이상 벌어지면 결과를 뒤집지 못함 |
| `entry_cost 페널티` | `−(entry_cost / max_hp) × 1.5` | 교체 옵션에만 발생. 헤저드 1회(~12.5%)는 미미, 중첩 시 유의미해지도록 설계 |
| `switch tempo penalty` | 교체 옵션 한정 `−0.3` | 이번 턴 공격 기회를 포기하는 데 대한 기본 페널티. 동률 시 "공격 유지"가 기본값이 되도록 함 |
| `risk_flag penalty` | `risk_flag_penalty_base(0.4) × risk_aversion` | 랭크업기 보유 상대에 대한 경계 페널티. 크기는 AI의 위험 회피 성향에 비례 |

## 5. 위험 회피 성향 (`risk_aversion`)

전자(타이브레이커에서만 고려)와 후자(항상 페널티 반영)를 이진 선택하지 않고, 하나의 연속값 파라미터로 통합한다.

```
risk_aversion ∈ [0.0, 1.0]
결정 시점: 배틀 시작 시 1회, 균등분포 U(0,1)에서 샘플링 (배틀마다 재추첨)
```

| risk_aversion | 실질 동작 |
|---|---|
| 0에 가까움 | 페널티 거의 0 → 근소한 차이일 때만 영향 |
| 1에 가까움 | 항상 뚜렷한 페널티 |
| 0.3~0.7 | 그 사이 — "적당히 신중한" 성향 |

이 파라미터는 향후 다른 "성향에 따라 흔들려야 하는" 지점에도 재사용 가능하도록 범용으로 설계한다.

## 6. 하드 오버라이드 규칙 (점수 계산 전 선(先)체크)

점수식만으로는 상대에게 반격 기회 자체가 없는 상황(내가 선공으로 확실히 처치)이 다른 옵션에 밀려 역전될 수 있음이 검증 과정에서 발견되었다. 이는 튜닝으로 해결 불가한 논리 구조상의 예외이므로, 점수 비교보다 우선 체크한다.

```
if 선공 == true AND hits_to_kill.expected <= 1 AND worst_case.certainty == "guaranteed":
    해당 옵션 즉시 채택, 점수 계산 생략
```

이 조건 외의 모든 경우는 6개 옵션 전부 동일한 점수식으로 비교한다 (예외 규칙 추가 금지 — 필요성이 생기면 이 문서를 개정하여 검토).

## 7. 동률 처리 (타이브레이커)

`score` 차이가 임계값(예: ±0.1) 이내일 때 적용.

1. `worst_case.count == 1`인 옵션을 우선 배제 (근소한 우위보다 즉사 리스크 회피 우선)
2. `entry_cost`가 더 낮은 쪽
3. 방어 상성 배율이 더 낮은(안 맞는) 쪽
4. 그래도 같으면 공격 유지 옵션 우선 (교체보다)

## 8. 최종 의사코드

```
options = common_engine.evaluate()   # 6개 옵션, battle-ai-common-engine.md v1.1 출력

# 0단계 — 하드 오버라이드
for option in options:
    if option.speed_order == "first"
       and option.hits_to_kill.expected <= 1
       and option.hits_to_kill.worst_case.certainty == "guaranteed":
        return option

# risk_aversion: 배틀 시작 시 1회만 샘플링해 재사용 (매 턴 재추첨 금지)
risk_aversion = battle_state.risk_aversion

# 1단계 — 점수 계산
for option in options:
    exchange_advantage = option.hits_to_be_killed.expected - option.hits_to_kill.expected
    speed_adj = {"first": 0.5, "tie": 0, "second": -0.5}[option.speed_order]
    entry_penalty = (option.entry_cost / option.max_hp) * 1.5
    tempo_penalty = 0.3 if option.option_type == "switch" else 0
    risk_penalty = (0.4 * risk_aversion) if option.risk_flag else 0

    option.score = exchange_advantage + speed_adj - entry_penalty - tempo_penalty - risk_penalty

# 2단계 — 최고점 선택 + 동률 처리
best = max(options, key=score)
candidates = [o for o in options if abs(o.score - best.score) < 0.1]

if len(candidates) > 1:
    candidates = [o for o in candidates if o.hits_to_be_killed.worst_case.count != 1] or candidates
    candidates.sort(key=lambda o: o.entry_cost)
    candidates.sort(key=lambda o: o.type_matchup.defensive)
    candidates.sort(key=lambda o: o.option_type != "move")  # move 우선
    return candidates[0]

return best
```

## 9. 파라미터 테이블 (튜닝 대상, 전부 초기 추정치)

| 파라미터 | 초기값 | 근거 |
|---|---|---|
| `w_status` | 0.15 | 변화기 1개당 사용 확률 |
| `speed_adjustment` | ±0.5 | 타수 1개 차이(±1.0)의 절반 — 근접 승부에서만 작동 |
| `switch tempo penalty` | −0.3 | speed_adjustment보다 약간 작게 |
| `entry_cost 가중치` | ×1.5 | 헤저드 1회 ≈ −0.19, 중첩 시 −0.5 이상 |
| `risk_flag_penalty_base` | 0.4 | switch penalty(0.3)와 speed_adjustment(0.5) 사이 |
| `risk_aversion 분포` | 균등분포 U(0,1) | 극단 편중 없이 배틀마다 고르게 분산. 특정 성향 강화 시 베타분포로 교체 가능 |
| 동률 처리 임계값 | ±0.1 | score 단위 기준 근사치, 시뮬레이션으로 조정 |

확정 값은 시뮬레이션 로그에서 "이 상황에서 사람이라면 하지 않을 선택을 AI가 했는가"를 기준으로 역산하여 조정한다.

## 10. 범위 외 사항 (다음 단계)

- **A안 (파티 성향 태그 오버레이)**: 사용자가 파티/포켓몬 단위로 대면·사이클·전개 태그를 지정하면 위 파라미터 테이블에 가중치를 곱하는 오버레이 레이어 설계
- **회복기 반영**: 회복기는 `hits_to_be_killed`가 아닌 `hits_to_kill` 계산(공통 엔진 쪽)에 영향을 주므로, 공통 엔진 문서 쪽에서 별도로 다룸
- **트릭룸/도발 등 저빈도 게임체인저**: 1차 버전 범위 밖, 시뮬레이션에서 문제가 드러나면 추가 검토
- **B안 (파티 성향 자동 추론)**: 장기 검토 대상, 현재 미채택
