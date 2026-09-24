# 포켓몬 배틀 AI — 의사결정 레이어 명세서 (v2)

> **v2(2026-09-24)**: 핵심 점수식(§4)을 HP 교환식으로 교체 — 구현 후 시뮬레이션에서 v1 원안의 결함이 확인됨(§11).
> §6 하드 오버라이드에 필중 조건 추가, §8 의사코드·§9 파라미터를 새 식 기준으로 개정, 검증 스크립트(§12) 추가.

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

## 4. 핵심 점수 공식 — HP 교환식 (v2, 2026-09-24 채택)

> v1 원안(`exchange_advantage = d − c` + 속도 보정 ±0.5 + 교체 템포 −0.3)은 시뮬레이션에서 결함이 확인되어
> 이 식으로 교체했다. 경위와 수치는 §11 참고. 원안은 코드에 `scoring: "spec"`으로 남아 있다.

**원칙**: 모든 옵션을 같은 단위 — **각자 최대 HP 대비 비율** — 로 비교한다. "처치 후 남는 여유 턴 수"(d − c)는
포켓몬마다 HP·내구가 달라서 옵션끼리(특히 기술 사용 vs 교체) 비교할 수 없기 때문이다.

옵션을 고른 뒤 그 대면을 끝까지 이어간다고 보고, 결과를 "상대 HP 제거 비율 − 내 HP 손실 비율"로 매긴다.

```
c = hits_to_kill.expected      # 내가 상대를 쓰러뜨리는 기대 턴 수
d = hits_to_be_killed.expected # 상대가 나를 쓰러뜨리는 기대 턴 수
p = 선공 확률(0~1)              # 선공 1 / 동속 0.5 / 후공 0 — 선제공격손톱 확률까지 섞인 값
my  = 대면 시작 시 내 HP / 내 최대 HP       # 교체는 진입 비용을 뺀 뒤
opp = 상대 현재 HP / 상대 최대 HP
lost = 이번 턴 공격하지 않으면 1(교체·회복·랭크업), 공격하면 0

def race_value(c, d, p, my, opp, lost):
    if c == ∞ and d == ∞: return 0                 # 서로 못 쓰러뜨림
    opp_hits = c + lost − p                          # 내가 처치할 때까지 상대가 때리는 횟수
    if opp_hits < d:                                 # 이기는 대면
        return opp − my × max(0, opp_hits) / d       #   상대 전부 제거 − 그동안 내가 잃는 HP
    my_hits = max(0, d − (1 − p) − lost)             # 지는 대면: 쓰러지기 전까지 내가 때리는 횟수
    return opp × min(1, my_hits / c) − my            #   깎은 만큼 − 내 남은 HP 전부
```

| 옵션 | 점수 |
|---|---|
| 공격기 사용 | `race_value(c, d, p, my, opp, 0)` |
| 교체 | `race_value(c, d, p, my, opp, 1) − entry_cost / max_hp` (c·d·p는 교체 후 다음 턴 기준) |
| 유턴류(맞히면 교체, 교대 가능 포켓몬 있을 때) | 아래 `pivot_value` — 교대 포켓몬이 없거나 한 방에 쓰러뜨리면 일반 공격기로 평가 |
| 회복기 | `race_value(내 최선 공격의 c, 회복 후 d, p, 회복 후 my, opp, 1) + (회복 후 my − 지금 my)` |
| 랭크업기 | `race_value(랭크업 후 최선 공격의 c, d, p, my, opp, 1)` |
| 그 외 변화기(설치기·상태이상 부여 등) | 이득이 다음 턴부터라 다턴 예측 범위 — 선택하지 않음(`−∞`) |

모든 옵션에서 공통으로 `risk_flag`면 `trade_risk_penalty_base(0.1) × risk_aversion`을 뺀다.

**유턴류(유턴·볼트체인지·퀵턴 등, `selfSwitchAfterDamage`)** — 맞히면 엔진이 교체를 강제하므로 "남아서 계속
쓰는" 계산 대신 공격 + 교체로 평가한다(2026-09-24 추가).

```
hit_rate   = 한 번 맞혔을 때 깎는 상대 현재 HP 비율
chip       = opp × hit_rate
after_hit  = 교체 후보들을 "hit_rate만큼 HP가 줄어든 상대" 기준으로 다시 평가한 교체 옵션
active_hit = 지금 포켓몬이 상대 공격을 한 번 맞을 때 잃는 HP 비율

switch_in(후보, lost) = race_value(후보 c, 후보 d, 후보 p, 후보 my, 후보 opp, lost) − 후보 진입 비용 비율
best = max over 후보 [ p × switch_in(후보, 1)                       # 선공: 들어온 후보가 이번 턴 한 대 맞음
                     + (1 − p) × (switch_in(후보, 0) − active_hit) ] # 후공: 지금 포켓몬이 맞고 후보는 안전하게 등장
pivot_value = accuracy × (chip + best) + (1 − accuracy) × (−active_hit)   # 빗나가면 교체 없이 한 대 맞음
```

| 항목 | 설명 |
|---|---|
| 선공 처리 | 별도 ±0.5 보정 대신 경기 계산 안에서 "선공이면 상대가 마지막 한 번을 못 때림"(`− p`)으로 반영 |
| 교체·회복·랭크업 | 이번 턴 공격을 안 하므로 "상대가 한 번 더 때린다"(`+ lost`). 원안의 고정 템포 페널티(−0.3)를 대체 |
| 진입 비용 | 교체 시 설치물로 잃는 HP 비율을 그대로 뺀다(원안의 ×1.5 가중치는 단위가 HP 비율이 되어 불필요) |
| risk_flag | 랭크업기 보유 상대 경계. HP 비율 단위라 원안(0.4)보다 작은 0.1 |

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
if 선공 확률 == 1 AND worst_case.count == 1 AND worst_case.certainty == "guaranteed" AND accuracy == 1.0:
    해당 옵션 즉시 채택, 점수 계산 생략
```

- `accuracy == 1.0`(필중)은 engine-extension §7-3에서 추가 — 명중률 100% 미만 원턴킬 기술이 "확정 처치"로 오인되는 걸 막는다.
- 기합의띠·옹골참·탈은 생존 보장 후처리(engine-extension §3-0)가 worst_case를 먼저 2타로 바꾸므로 여기 걸리지 않는다.
- 선공 판정에는 여왕의위엄·테일아머·사이코필드의 우선도 차단이 이미 반영돼 있다(차단되면 c = ∞).

이 조건 외의 모든 경우는 옵션 전부 동일한 점수식으로 비교한다 (예외 규칙 추가 금지 — 필요성이 생기면 이 문서를 개정하여 검토).

## 7. 동률 처리 (타이브레이커)

`score` 차이가 임계값(±0.1, HP 비율 단위) 이내일 때 적용.

1. `worst_case.count == 1`인 옵션을 우선 배제 (근소한 우위보다 즉사 리스크 회피 우선)
2. `entry_cost`가 더 낮은 쪽
3. 방어 상성 배율이 더 낮은(안 맞는) 쪽
4. 그래도 같으면 공격 유지 옵션 우선 (교체보다)

## 8. 최종 의사코드

```
options = common_engine.evaluate()   # 6개 옵션, battle-ai-common-engine.md v1.1 출력

# 0단계 — 하드 오버라이드 (§6)
for option in options:
    if option.option_type == "move"
       and option.first_probability == 1
       and option.hits_to_kill.worst_case.count == 1
       and option.hits_to_kill.worst_case.certainty == "guaranteed"
       and option.accuracy == 1.0:
        return option

# risk_aversion: 배틀 시작 시 1회만 샘플링해 재사용 (매 턴 재추첨 금지)
risk_aversion = battle_state.risk_aversion

# 1단계 — 점수 계산 (§4 HP 교환식)
for option in options:
    c, d, p = option.hits_to_kill.expected, option.hits_to_be_killed.expected, option.first_probability
    my, opp = option.hp_fraction, option.opponent_hp_fraction
    if option.support == "other":
        score = -inf
    elif option.support == "heal":
        score = race_value(option.best_kill_turns, option.d_after_heal, p, option.healed_fraction, opp, 1) \
                + (option.healed_fraction - my)
    elif option.support == "setup":
        score = race_value(option.c_after_setup, d, p, my, opp, 1)
    elif option.option_type == "switch":
        score = race_value(c, d, p, my, opp, 1) - option.entry_cost / option.max_hp
    else:
        score = race_value(c, d, p, my, opp, 0)
    if option.risk_flag:
        score -= 0.1 * risk_aversion
    option.score = score

# 2단계 — 최고점 선택 + 동률 처리
best = max(options, key=score)
if best.score == -inf: return options[0]                 # 전부 선택 불가면 첫 옵션
candidates = [o for o in options if o.score == best.score or best.score - o.score < 0.1]

if len(candidates) > 1:
    candidates = [o for o in candidates if o.hits_to_be_killed.worst_case.count != 1] or candidates
    candidates.sort(key=lambda o: o.entry_cost)
    candidates.sort(key=lambda o: o.type_matchup.defensive)
    candidates.sort(key=lambda o: o.option_type != "move")  # move 우선
    return candidates[0]

return best
```

## 9. 파라미터 테이블 (튜닝 대상, 전부 초기 추정치)

코드: `src/lib/battle/ai/decision.ts`의 `DEFAULT_DECISION_PARAMS`.

| 파라미터 | 현재값 | 근거 |
|---|---|---|
| `w_status` | 0.15 | 변화기 1개당 사용 확률 (§2) |
| `trade_risk_penalty_base` | 0.1 | risk_flag 페널티. HP 비율 단위 |
| `risk_aversion 분포` | 균등분포 U(0,1) | 극단 편중 없이 배틀마다 고르게 분산. 특정 성향 강화 시 베타분포로 교체 가능 |
| 동률 처리 임계값 | ±0.1 | HP 비율 단위. 0.03으로 줄여도 승률 차이 없음(166 vs 169승, 오차 범위) |

**튜닝 방법**: `npm run sim:ai -- greedy 150 '{"파라미터":값}'`로 값을 바꿔 가며 그리디 봇 상대 승률을 비교하고,
`npm run sim:ai -- diag`로 "사람이라면 하지 않을 선택"이 나오는지 사례를 확인한다(§12).

원안(`scoring: "spec"`) 전용 파라미터 — 교체 템포 페널티 0.3, 진입 비용 가중치 ×1.5, risk_flag 0.4,
speed_adjustment ±0.5 — 는 HP 교환식에서는 쓰이지 않는다(각각 `+ lost`, HP 비율 그대로, 0.1, `− p`로 대체).

## 10. 범위 외 사항 (다음 단계)

- **A안 (파티 성향 태그 오버레이)**: 사용자가 파티/포켓몬 단위로 대면·사이클·전개 태그를 지정하면 위 파라미터 테이블에 가중치를 곱하는 오버레이 레이어 설계
- **회복기 반영**: 회복기는 `hits_to_be_killed`가 아닌 `hits_to_kill` 계산(공통 엔진 쪽)에 영향을 주므로, 공통 엔진 문서 쪽에서 별도로 다룸
- **트릭룸/도발 등 저빈도 게임체인저**: 1차 버전 범위 밖, 시뮬레이션에서 문제가 드러나면 추가 검토
- **B안 (파티 성향 자동 추론)**: 장기 검토 대상, 현재 미채택

## 11. v1 구현 후 시뮬레이션 검증 결과 (2026-09-24) — HP 교환식 채택 경위

구현: `src/lib/battle/ai/`. 검증은 시드 고정 무작위 파티(3마리) 배틀을 CLI에서 돌려서 했다(Vite
`ssrLoadModule`). 비교 상대는 **그리디 봇**(교체 없이 매 턴 가장 빨리 처치하는 기술만 쓰는 봇) — 같은 시드로
파티를 좌우 바꿔 한 번 더 돌려 파티 운을 상쇄했다(300판, 표준오차 ≈ ±9승).

| 채점식 | AI 승 / 300 | AI 행동 중 교체 비율 |
|---|---|---|
| spec — v1 원안(`d − c` + 속도 ±0.5 + 교체 템포 −0.3, 회복은 extension §2-2 연장분) | 108 (36%) | 28% |
| tempo — 공격 안 하는 행동을 "처치 턴 +1"로 통일 | 137 | 22% |
| tempo + 교체 추가비용 2 | 162 | 12% |
| 교체 금지(기술 선택만) | 157 | 1% |
| **trade — HP 교환 채점(아래)** | **169 (56%)** | 12% |

AI 대 랜덤 행동 봇: trade 기준 170승 30패(85%). 턴당 판단 평균 5ms·최대 약 90ms.

**원안의 결함**: `exchange_advantage = d − c`는 "처치 후 남는 여유 턴 수"인데, 여유 턴 수는 포켓몬마다 몸
(HP·내구)이 달라 옵션끼리 비교가 안 된다. 그래서 **이미 이기는 대면에서도 체력이 가득 찬 튼튼한 후보로 갈아타는**
선택이 반복됐다(예: 상대 HP 17/182라 이번 턴에 잡을 수 있는데 d가 더 큰 후보로 교체). 템포 페널티를 키워도
완화될 뿐 근본 해결이 안 된다(교체 금지와 비슷한 수준에서 멈춤).

**결정(사용자 확인, 2026-09-24)**: trade(HP 교환식)를 정식 채택하고 §4·§6·§8·§9를 이 기준으로 개정했다. 교체 비율이
높은 것 자체가 문제가 아니라, 교체를 **틀린 상황에서 고르는 것**이 문제였고 그 원인이 비교 단위였다는 게 채택 근거다.
원안(`spec`)과 `tempo`는 비교·회귀용으로 `DecisionParams.scoring`에 남겨 뒀다.

**유턴류 반영 결과(2026-09-24)**: 유턴류를 배울 수 있는 포켓몬은 기술 하나를 유턴류로 바꾼 파티(`PIVOT=1`)로
그리디 봇과 800판씩 비교했다. 행동은 의도대로 바뀌었지만(일반 교체 1,359 → 1,129회, 유턴류 635 → 720회) 승률은
**430승 vs 429승으로 차이가 없었다**(`pivotAware: false`가 이전 동작). 이 환경에서는 교체 판단 자체가 승패에 주는
영향이 작고(교체 금지 AI와 전체 AI의 승률이 비슷), 이기는 대면에서도 유턴으로 빠져 나머지를 후보에게 맡기는 선택이
추가 데미지 이득과 상쇄되는 것으로 보인다. 승률을 해치지 않고 실전에서 더 자연스러운 수라 기본값은 켜 둔다.

### 11-1. v1 알려진 한계 (다음 단계 후보)

- **설치기·상태이상 부여·방어·날씨/필드·트릭룸 등 "그 외 변화기"는 고르지 않는다**(공격 옵션이 하나라도 있으면) — 이득이 다음 턴부터라 다턴 예측 범위.
- **급소**는 기대 데미지에 반영 안 함. **반감 열매**는 다단히트에서도 매 타 적용되는 것으로 계산(실제로는 첫 타만) — 매치업 페이지 계산기와 같은 근사.
- 턴 순서 예측 시 상대 기술은 "상대의 최선 공격기"로 가정.
- **구애 고정**은 엔진이 아니라 UI가 로그로 판정하므로, UI가 `legalMoveIds`로 선택 가능 기술을 넘겨줘야 한다(안 넘기면 PP·도발·사슬묶기·앵콜만 거름).
- 배틀타워 화면 연결은 아직 안 함.

## 12. 검증 스크립트

리포 `scripts/`에 있다. 브라우저 없이 Vite `ssrLoadModule`로 `src/`의 실제 엔진을 불러와 돌린다.

| 명령 | 내용 |
|---|---|
| `npm run test:ai` | 규칙 시나리오 11건(부유·여왕의위엄·기합의띠·하드 오버라이드·명중률·메가진화·유턴류 등). 실패 시 종료 코드 1 |
| `npm run sim:ai -- regress [판수]` | 무작위 행동끼리 배틀 후 전체 로그 해시 출력. **엔진 수정 전후 해시가 같으면 엔진 동작 무변경** (2026-09-24 기준 300판 해시 `bb34b4b0…`) |
| `npm run sim:ai -- ai [판수]` | AI 대 무작위 봇·AI 대 AI 승률, 턴당 판단 시간, NaN 점수 수 |
| `npm run sim:ai -- greedy [판수] [파라미터 JSON]` | AI 대 그리디 봇(파티 좌우 교대). 파라미터 튜닝의 기준 지표 |
| `npm run sim:ai -- diag [판수] [파라미터 JSON]` | AI가 교체를 고른 순간의 옵션별 점수·c·d 덤프 |

파라미터 JSON 예: `'{"scoring":"spec"}'`, `'{"tieThreshold":0.03}'`, `'{"pivotAware":false}'` (PowerShell은 `'{\"scoring\":\"spec\"}'`).
환경변수 `PIVOT=1`이면 유턴류를 배울 수 있는 포켓몬의 기술 하나를 유턴류로 바꿔 파티를 만들고, diag 모드에
`DIAG=pivot`을 주면 교체 대신 유턴류를 고른 순간을 덤프한다.
regress 해시는 파티 생성 방식·데이터 파일이 바뀌면 달라지므로, 엔진 리팩토링 검증 시에는 **같은 커밋의 데이터로
수정 전/후를 둘 다 돌려 비교**한다(수정할 파일만 `git stash`로 되돌려 실행).
