# 포켓몬 배틀 AI — 공통 평가 엔진 명세서

## 1. 개요

이 문서는 배틀 시뮬레이터의 컴퓨터(AI) 행동 결정 로직 중 **공통 평가 엔진**을 정의한다.
공통 평가 엔진은 "이번 턴에 선택 가능한 모든 옵션"에 대해 동일한 기준(a~e)으로 수치를 산출하는 역할만 담당하며, 산출된 값을 바탕으로 실제 행동을 고르는 **의사결정 레이어(우선순위 트리, 파티 성향별 가중치 등)는 이 문서의 범위 밖**이다. 두 레이어를 분리함으로써 의사결정 로직이 바뀌어도 엔진 코드는 그대로 재사용할 수 있도록 한다.

## 2. 평가 대상 (옵션 목록)

기존의 "기술 사용 vs 교체"를 먼저 정하는 2단계 구조 대신, 이번 턴에 선택 가능한 모든 옵션을 하나의 목록으로 두고 동일한 항목으로 평가한다.

| 옵션 구분 | 개수 | 비고 |
|---|---|---|
| 현재 포켓몬 유지 (기술 사용) | 4 | 보유 기술 수만큼 |
| 교체 후보 | 2 | 남은 파티 포켓몬 수만큼 |
| **합계** | **6** | 매 턴 이 6개를 모두 평가 |

## 3. 평가 항목 정의

### a. 상성 배율 (type_matchup)

- **공격 상성 (offensive)**: 이 옵션의 기술 타입 → 상대 타입. 배율 값: `0 / 0.25 / 0.5 / 1 / 2 / 4`
- **방어 상성 (defensive)**: 상대의 보유 기술 타입 → 이 옵션(포켓몬)의 타입. 동일한 배율 값 사용
- 특성으로 인한 상성 무효화/변경을 예외 테이블로 별도 관리 (예: 부유 → 지면 무효, 이상한비늘 → 노말 무효 등)
- 데이터 타입: `float` (배율 그대로 저장)

### b. 선공/후공 여부 (speed_order)

- 기본은 스피드 실측치(랭크 보정 포함) 비교
- 우선도(priority) 값이 있는 기술은 스피드보다 우선 적용 — 우선도가 다르면 스피드 비교 없이 즉시 순서 결정
- 결과값: `FIRST` / `SECOND` / `SPEED_TIE`
- 교체 옵션에는 이 값이 "이번 턴"에는 의미가 없음(교체는 공격보다 먼저 처리되는 것이 일반 규칙) — 교체 옵션에서는 **"교체 후 다음 턴 기준 선공 여부"**로 재정의해서 사용

### c. 내가 상대를 잡는 데 필요한 타수 (hits_to_kill)

- 이 옵션(기술 또는 교체 후 포켓몬의 최선 기술) 기준으로 상대를 쓰러뜨리는 데 필요한 타수
- 분류: `확1타 / 난수1타 / 확2타 / 난수2타 / 확3타이상`
- "난수" 구간은 데미지 롤 폭(85~100%)에 따라 갈리는 경우이므로 확률(%)도 함께 저장 권장
- 교체 옵션은 이번 턴에 공격이 불가능하므로 **다음 턴 기준**으로 계산

### d. 상대가 나를 잡는 데 필요한 타수 (hits_to_be_killed)

- 상대의 최선 기술 기준, 이 옵션(포켓몬)이 쓰러지는 데 필요한 타수
- 분류는 c와 동일
- 교체 옵션의 경우 e(진입 비용)를 먼저 차감한 잔여 체력을 기준으로 계산

### e. 진입 비용 (entry_cost)

- 필드에 깔린 설치기(스텔스록, 스파이크, 독압정, 압정뿌리기)로 인해 교체 시 즉시 발생하는 데미지
- 타입/특성에 의한 무효화 반영 (비행/부유는 스파이크·독압정 무효, 마그마아머는 얼음 스파이크 무효 등)
- 기술 사용 옵션은 항상 `0`으로 고정

## 4. 옵션별 값 산출 방식

**기술 사용 옵션 (4개)**
1. 방어 상성(a-defensive), 선공/후공(b), 상대에게 잡히는 타수(d)는 4개 기술 모두 공통값 (현재 포켓몬 기준이므로 동일)
2. 공격 상성(a-offensive)과 내가 잡는 타수(c)만 기술별로 개별 계산
3. 상성 배율이 0(무효)인 기술은 c 계산에서 제외(사용 불가 취급은 아니고 "타수 무한대"로 처리)

**교체 옵션 (2개, 각각 독립 평가)**
1. 상대 vs 새 포켓몬 기준으로 a(공격/방어 모두), b를 재계산
2. e(진입 비용) 산출 → 새 포켓몬의 잔여 체력 = 최대 체력 − e
3. 잔여 체력을 기준으로 d 계산
4. c는 다음 턴 기준으로 계산 (이번 턴은 교체만 수행하고 공격 없음)

## 5. 출력 데이터 구조 (제안)

```json
{
  "option_type": "move | switch",
  "identifier": "기술명 또는 포켓몬명",
  "type_matchup": {
    "offensive": 2.0,
    "defensive": 0.5
  },
  "speed_order": "first | second | speed_tie",
  "hits_to_kill": {
    "count": 2,
    "certainty": "guaranteed | random",
    "probability": 1.0
  },
  "hits_to_be_killed": {
    "count": 3,
    "certainty": "random",
    "probability": 0.62
  },
  "entry_cost": 0
}
```

6개 옵션 모두 이 구조로 통일해서 출력하면, 이후 의사결정 레이어(우선순위 트리/가중치 로직)는 옵션의 종류(move/switch)를 신경 쓰지 않고 동일한 필드만 보고 비교할 수 있다.

## 6. 계산 순서 (의사코드)

```
options = []

# 기술 사용 옵션
defensive_matchup = calc_type_matchup(opponent.moves, self.current.types)
speed = calc_speed_order(self.current, opponent.active)
hits_to_be_killed = calc_hits(opponent.best_move, self.current.remaining_hp)

for move in self.current.moves:  # 4개
    offensive_matchup = calc_type_matchup(move, opponent.active.types)
    if offensive_matchup == 0:
        hits_to_kill = INFINITE
    else:
        hits_to_kill = calc_hits(move, opponent.active.remaining_hp)
    options.append({
        option_type: "move", identifier: move.name,
        type_matchup: {offensive: offensive_matchup, defensive: defensive_matchup},
        speed_order: speed,
        hits_to_kill: hits_to_kill,
        hits_to_be_killed: hits_to_be_killed,
        entry_cost: 0
    })

# 교체 옵션
for candidate in self.remaining_party:  # 2개
    offensive_matchup = calc_type_matchup(candidate.best_move, opponent.active.types)
    defensive_matchup = calc_type_matchup(opponent.moves, candidate.types)
    speed = calc_speed_order(candidate, opponent.active)  # 다음 턴 기준
    entry_cost = calc_entry_hazard_damage(candidate, self.field_hazards)
    effective_hp = candidate.max_hp - entry_cost
    hits_to_be_killed = calc_hits(opponent.best_move, effective_hp)
    hits_to_kill = calc_hits(candidate.best_move, opponent.active.remaining_hp)  # 다음 턴 기준
    options.append({
        option_type: "switch", identifier: candidate.name,
        type_matchup: {offensive: offensive_matchup, defensive: defensive_matchup},
        speed_order: speed,
        hits_to_kill: hits_to_kill,
        hits_to_be_killed: hits_to_be_killed,
        entry_cost: entry_cost
    })

return options  # 총 6개, 의사결정 레이어로 전달
```

## 7. 범위 외 사항 (다음 단계에서 처리)

- 파티 성향(대면/사이클/전개)별 가중치 및 우선순위 판정 트리
- 상태이상, 특성 부가효과, 지속 도구 효과의 세부 반영
- 상대 정보가 불완전한 경우(특성/도구 미확정)의 추정 로직 — 현재는 완전 정보 가정
- 날씨/필드 등 환경 효과에 따른 상성·화력 보정
