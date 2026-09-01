# Phase 7.5 기획 — 선행 UI 정리 + 배틀타워 리뉴얼

> 이어서 읽기: [Phase 7 기획](phase7-plan.md)
> Phase 7을 진행하며 "현행 1대1 대면 엔진에는 구조적으로 발동 계기가 없어서" 미룬 항목(2026-08-28)에, 그동안 쌓인 UI 손볼 것을 더해 모은다. 2026-08-31 작업량·의존성 기준으로 재정렬.

## 0. 이 문서의 성격과 작업 순서

`battleSimulator`는 지금 `state.a` / `state.b`가 각각 **포켓몬 1마리**다. 파티 배열도, 활성 슬롯 개념도, 교체 액션도 없다. "교체로 포켓몬이 들어오는 순간"이나 "아군 슬롯"이 있어야 의미가 생기는 항목(설치기·등장 특성·1대1 우회 복원 등)은 전부 그 인프라가 선행돼야 하며, 그 인프라 자체가 **배틀타워 리뉴얼**이다.

배틀타워 리뉴얼은 이 페이즈에서 가장 크고(엔진 재설계) 가장 버그가 많이 날 작업이라, **페이즈의 가장 마지막 단일 작업으로 몰아서** 진행한다. 리뉴얼에 딸린 부수 작업(설치기 6종, 플라워베일·공생, 1대1 우회 복원)도 인프라 없이는 의미가 없으므로 전부 그 마지막 단계 안에 함께 둔다.

그 앞에는 리뉴얼과 무관하게 독립적으로 끝낼 수 있는 정리 3건(소규모 UI 2건 + 데미지 공식 특수 로직 감사 1건)을 먼저 처리해, 리뉴얼 착수 전에 릴리스 가능한 상태를 만들어 둔다.

### 작업 순서 (작업량·의존성 순)

| 단계 | 항목 | 규모 | 의존성 | 리스크 |
|---|---|---|---|---|
| **1** | 기술표(MoveDexPage) 헤더/데이터 열 정렬 수정 | XS — CSS + 마크업 소폭 | 없음 | 낮음 |
| **2** | 결정력·내구력 페이지 난수 격파 확률(%) 표기 | S — 순수 함수 1개 + 배지 UI | 없음 | 낮음 |
| **3** | 특수 데미지 로직 기술 감사·수정 (바디프레스·속임수·사이코쇼크류 등) | M — `computeDamage`/`computeOffensePower`/`computeBulkPower` + `battleSimulator` + 매치업 UI | 없음 (교체 인프라와 무관) | 중간 — 데미지 계산 전반 회귀 |
| **4** | **배틀타워 리뉴얼** — 파티 선출(3마리)·교체 인프라 + 딸린 설치기·특성·1대1 우회 복원 | XL — 배틀 엔진 재설계 | 1~3과 무관, 단 페이즈 내 최후 | **높음** — 회귀 버그 다발 예상 |

1 → 2 → 3 을 먼저 끝내고, 4 는 별도 결재 후 페이즈 전체의 마지막 작업으로 착수한다.

---

## 1. [1단계] 기술표(MoveDexPage) — 헤더/데이터 열 어긋남 수정

### 1-1. 증상

기술표에서 맨 위 헤더 행(`기술 / 타입 / 분류 / 접촉 / 우선도 / 위력 / 명중률 / PP`)과 그 아래 실제 데이터 행에 세로선을 그어보면 **데이터 쪽 열이 헤더보다 오른쪽 스크롤바 폭만큼(약 12~16px) 밀려** 있다. 오른쪽 고정폭 열(위력·명중률·PP)로 갈수록 어긋남이 눈에 띈다.

### 1-2. 원인

`MoveDexPage.css` / `MoveDexPage.tsx` 구조상:

1. **스크롤바 폭 차이**: 헤더 행 `.movedex-head-row`는 `.movedex-table`의 직계 자식이고, 데이터 행 `.movedex-row`는 `overflow-y: auto; max-height: 640px`가 걸린 `<ul class="movedex-list">` **안**에 있다. 목록이 넘쳐 세로 스크롤바가 뜨면 `<li>` 행의 콘텐츠 폭만 스크롤바 폭만큼 줄고, 헤더 행은 안 줄어든다. 두 행이 같은 `grid-template-columns`(`1fr 5em 3.4em 4.4em 3.6em 3em 3.8em 2.8em`)를 쓰는데도 `1fr` 열이 그 차이를 흡수하면서 이후 고정폭 열이 통째로 밀린다.
2. **sticky 헤더가 실제로는 안 붙음**: `.movedex-head-row`에 `position: sticky; top: 0`이 있지만 스크롤 컨테이너는 `.movedex-list`인데 헤더는 그 바깥(`.movedex-table`, `overflow: hidden`)에 있어서 목록을 스크롤해도 헤더가 따라 고정되지 않는다.
3. **숫자 열 정렬 불일치**: 데이터의 `우선도·위력·명중률·PP` 셀은 `.movedex-cell-num`으로 `text-align: right`인데, 대응 헤더 `.movedex-th`는 `text-align: left` + `display: flex`(기본 좌측)라 헤더 글자와 값이 서로 반대쪽에 붙는다.
4. **`접촉` 헤더만 다른 서체**: 정렬 불가라 `<span class="movedex-cell">`(0.82rem)로 찍혀서, 다른 헤더 `.movedex-th`(0.74rem·대문자·자간)와 크기·스타일이 다르다.

### 1-3. 수정

- **스크롤바는 본문에만, 헤더엔 거터만 예약**(2026-08-31 사용자 요청 — 스크롤바가 헤더 우측까지 침범해 보기 안 좋다):
  - `.movedex-list`(`<ul>`)가 스크롤 컨테이너 유지(`max-height` + `overflow-y: auto`) + `scrollbar-gutter: stable` — 스크롤 여부와 무관하게 우측 거터를 항상 예약.
  - `.movedex-head-row`에 `overflow: hidden` + `scrollbar-gutter: stable` — `overflow:hidden`이면 헤더도 스크롤 컨테이너로 취급돼 `scrollbar-gutter`가 먹는다. 스크롤바는 안 그려지고 **우측 여백만 본문과 같은 폭으로 예약**돼서 열이 계속 정렬된다.
  - `.movedex-table`은 다시 `overflow: hidden`(둥근 모서리 클리핑 전용, 스크롤 안 함). 헤더는 스크롤 영역 밖에 그대로 얹혀 항상 보인다.
  - 짧은(스크롤 없는) 목록에서도 `stable` 덕에 헤더·본문 거터 폭이 같아 열이 안 흔들린다. (`scrollbar-gutter` 미지원 구형 브라우저에서만 예전처럼 약간 어긋남 — 허용.)
- **열 정렬 헤더-데이터 일치**: `SortableHeader`에 `align?: "left" | "right" | "center"` prop 추가 (2026-08-31 사용자 요청 반영).
  - `우선도·위력·PP` → `align="center"` (`.movedex-th-center`), 데이터 셀도 `.movedex-cell-num` → `.movedex-cell-center`(`text-align: center`). 값이 짧아 가운데가 읽기 좋다.
  - `명중률`만 `align="right"` 유지 (`.movedex-th-num` = `justify-content: flex-end; text-align: right`), 데이터는 `.movedex-cell-num` 유지 — `xx%` 형태라 우측이 낫다.
- **`접촉` 헤더 서체 통일**: 정렬 불가 헤더도 `.movedex-th`와 같은 타이포(0.74rem·대문자·자간·`--text-muted`)를 쓰는 `<span class="movedex-cell movedex-th movedex-th-static">`로 바꾸고, hover 색 변화는 `button.movedex-th:hover`로 좁혀 정적 헤더엔 안 걸리게.
- 수정 후 헤더·1행·마지막 행에 임시로 `outline`을 넣어 열 경계가 픽셀 단위로 맞는지 눈으로 확인(커밋 전 제거).

### 1-4. 스코프 밖

- 열 폭 자체 재배분(현재 `3em`대 고정폭이 긴 값에서 빠듯한 문제)은 이번 수정 범위 아님 — 어긋남만 잡는다.
- 모바일(`max-width: 760px`, 가로 스크롤 `min-width: 640px`) 레이아웃은 그대로 둔다.

### 1-5. [추가 · 2026-08-31 완료] 기술 설명문·태그·우선도 전건 반영

사용자가 기술 데이터 401건을 전수조사한 파일(`기술 설명문 + 태그 추가.txt`)을 받아 `moves.json` 전건에 반영했다. 1단계(열 정렬)와는 독립적인 별도 요청이며 이미 반영·검증(tsc/lint/build/브라우저) 완료.

- **effect(설명)**: 388건 갱신. 본문에 섞여 있던 `(우선도 ±N)` 괄호 표기는 전부 제거하고 우선도 필드로 분리.
- **priority**: 설명 속 우선도 값을 필드로 옮기며 3건 정정 — 눈사태 `0 → -4`, 트릭룸 `0 → -7`, 메탈버스트 `-3 → 0`. 그래스슬라이더의 `(우선도 +1)`은 그래스필드 조건부라 base는 `0` 유지(`priorityBoostInField`가 처리).
- **표시 태그(신설 `Move.tags`)**: 파일의 57종 태그를 표시 전용 `tags: string[]` 필드에 그대로 넣고 `MoveDexPage`가 이 필드를 출력. 태그란이 비어 있던 유틸기 22건은 `tags` 생략. 다단히트 라벨(`연속 N~M회`)이 붙는 기술은 밋밋한 `연속`/`연타` 태그를 라벨로 대체(중복 방지).
- **힘껏펀치 복합 우선도**: `priority: -3`(실제 발동값 — 정렬·엔진 판정 기준) 유지 + `priorityDisplay: "+5 / -3"` 신설 필드로 기술표 우선도 칸에만 복합 표기. 우선도 열 폭 `3.6em → 4.4em`, `.movedex-cell-center`에 `white-space: nowrap`.

#### 엔진 참조 태그 vs 표시 태그 — 분리 결정과 폴백 방침

- **`Move.classification`** (기존, 9종 union): 배틀 엔진 로직이 참조하는 엄선 태그. 현재 실제로 읽히는 값은 **`파동`**(메가런처), **`소리`**(촉촉보이스·방음·대타 관통), **`펀치`**(철주먹), **`가루`**(풀타입 가루 면역) 4종뿐 — `abilityModifiers.ts` / `battleSimulator.ts`. **이번 작업에서 건드리지 않았다.**
- **`Move.tags`** (신설): 기술표 화면 표시 전용. 접촉/비접촉·선공/후공·랭크·회복·반동처럼 안내용 문구까지 포함하는 자유 문자열 배열.
- **표기 충돌**: 전수조사 파일은 `구슬/폭탄 → 폭탄`, `물기 → 턱` 등 명칭이 다르다. 단, 위 4종(`파동·소리·펀치·가루`)은 파일과 이름이 같아 실제 충돌 지점은 **현재 없다**. 이름이 갈리는 `폭탄`·`턱`·`베기`·`춤`·`바람`은 아직 어떤 엔진 코드도 읽지 않는다. 그래도 안전하게 `tags`에만 파일 표기를 쓰고 `classification`은 원래대로 뒀다.
- **폴백 방침 (사용자 지시, 2026-08-31)**: 두 필드를 계속 분리 유지하다가 **엔진이 참조하는 `classification` 값이 꼬이면**(누락·불일치로 특성 배율/대타/가루 면역이 틀리게 나오면) 분리를 포기하고 **두 태그를 통합**한다 —
  1. `classification`을 `string[]`(자유 문자열)로 완화하고 `tags`를 흡수(단일 필드화),
  2. `abilityModifiers.ts` / `battleSimulator.ts`의 비교 문자열을 전수조사 파일 표기로 통일(`구슬/폭탄→폭탄`, `물기→턱` 등 — 지금 읽는 4종은 그대로),
  3. 통합 후 엔진 회귀(특성 배율·대타 관통·가루 면역) 재확인.

---

## 2. [2단계] 결정력·내구력 페이지 — 난수 격파 확률(%) 표기

### 2-1. 문제

현재 매치업 페이지는 `evaluateMatchup`이 낸 5단계 라벨(`확정 1타 / 난수 1타 / 확정 2타 / 난수 2타 / 3타 이상 필요`)만 `VerdictBadge`로 보여준다. "난수 1타"·"난수 2타"가 **몇 % 짜리 난수인지**가 안 나와서, 6.25% 난수 1타와 93.75% 난수 1타가 화면상 완전히 똑같이 보인다. 선출·리드 판단에서 실제로 중요한 건 이 확률이라, 라벨 옆에 격파 확률과 그 근거(난수 롤 개수)를 같이 띄운다.

### 2-2. 계산 근거

데미지 난수는 레벨 50 공식상 `0.85 ~ 1.00`을 `0.01` 간격으로 끊은 **16개 값**, 각 `1/16` 균등으로 근사한다(기존 `GUARANTEED_OHKO_DIVISOR` 등 상수가 이미 난수를 연속값으로 전제해 유도돼 있으므로 정합적이다. 매 타 `computeDamage`의 정수 floor는 이 근사에서 무시).

`evaluateMatchup`이 쓰는 비율을 그대로 재사용한다. 한 방 데미지가 상대 현재 HP를 정확히 채우는 **최소 격파 난수**는

```
rho_star = bulkPower × BULK_BASELINE_DIVISOR / (GUARANTEED_SURVIVE_2HIT_DIVISOR × offensePower)
         = bulkPower × 0.411 / (0.44 × offensePower)
```

- **난수 1타 확률**: `0.85 ~ 1.00` 16개 롤 중 `rho >= rho_star`인 개수 / 16.
  `killingRolls = clamp(floor((1.00 - rho_star) / 0.01 + 1e-9) + 1, 0, 16)`, 확률 `= killingRolls / 16`.
- **난수 2타 확률**: 독립 두 롤 `(rho1, rho2)` 조합 **256개** 중 `rho1 + rho2 >= rho_star`인 개수 / 256 (한 방 = HP의 `rho / rho_star` 비율이라 두 방 합이 `rho_star` 이상이면 격파). 1타 불가 구간이라 "1방 버티고 2방째 격파" 시나리오와 동일.
- **확정 1타 / 확정 2타**: 100% (확률 표기 생략, 라벨만).
- **3타 이상 필요**: 2타 격파 확률 0% — "2타 0%" 또는 표기 생략.
- **타입 무효(offensePower = 0)**: 판정이 `needs-3hit-plus`로 떨어지고 확률 0.

### 2-3. 배선

- `battlePower.ts`에 순수 함수 추가:
  ```ts
  export interface MatchupChance {
    verdict: MatchupVerdict;
    /** 해당 판정의 타수로 격파할 확률(0~1). 확정 판정이면 1, 3타 이상 필요면 null */
    koChance: number | null;
    /** 난수 1타일 때만: [격파하는 롤 수, 16] */
    killingRolls?: readonly [number, number];
  }
  export function evaluateMatchupChance(offensePower: number, bulkPower: number): MatchupChance;
  ```
  `evaluateMatchup`을 내부에서 호출해 판정을 얻고, `random-1hit` / `random-2hit`일 때만 위 식으로 확률을 채운다. 기존 `evaluateMatchup`은 시그니처 유지(다른 호출부 영향 없음).
- `SlotMatchupResult`에 `koChance: number | null`, `killingRolls?: [number, number]` 추가하고 `evaluateSlotMatchup` 반환부에서 `evaluateMatchupChance(offensePower, bulkPower)` 결과를 펼쳐 넣는다.
- `MatchupPage`는 `fullResult`에서 그대로 내려주기만 한다.

### 2-4. UI (VerdictBadge)

- 라벨(`<strong>`) 아래에 확률 줄을 추가한다. verdict별 색 클래스(`verdict-danger` 등)는 그대로.
  - 난수 1타: `43.8% · 16난수 중 7개 격파`
  - 난수 2타: `61.7%` (2타 기준)
  - 확정 1타 / 확정 2타: 확률 줄 없음
  - 3타 이상 필요: `2타 격파 0%` (회색)
- `%`는 소수 첫째 자리 반올림. `killingRolls`가 있으면 괄호로 근거를 같이 보여줘 "왜 이 확률인지"를 드러낸다.
- `verdict`가 `null`(입력 미완성)이면 기존 pending 문구 유지.

### 2-5. 스코프 밖(이번에 안 함)

- 급소·날씨 변동·연속 턴 누적은 매치업 페이지가 애초에 1턴 스냅샷이라 미반영(기존 스코프와 동일).
- 다단히트(트리플악셀·록블라스트류)는 이미 `multiHitCount`로 합산 위력이 `offensePower`에 들어가 있어, 그 합산값 기준 난수 확률이 그대로 나온다 — 타별 개별 난수 분포까지는 안 쪼갠다.

---

## 3. [3단계] 특수 데미지 로직 기술 감사·수정

### 3-1. 문제

데미지·결정력 계산은 지금 **오로지 `move.category`만 보고** 능력치를 고른다:

- `computeOffensePower` / `computeDamage` — `category === "physical" ? atk : spa` (`battlePower.ts`)
- `computeBulkPower` — `category === "physical" ? def : spd`
- `battleSimulator` 급소 무시 랭크·스크린 선택도 같은 `category` 분기(`contactDefenseStat` 등)

그런데 본가에는 이 분기를 벗어나는 기술이 있다. 현재 로스터에서 **미구현으로 확인된 것**:

| 기술 | 본가 규칙 | 현재 구현 | 데이터 상태 |
|---|---|---|---|
| **바디프레스** | 공격 대신 **자신의 방어** 실능·랭크로 데미지 계산 (분류는 물리 그대로 → 상대 *방어*에 부딪힘) | 공격 실능으로 계산 (틀림) | `moves.json`에 `effect` 텍스트만, 플래그 없음 |
| **속임수(Foul Play)** | **상대의 공격** 실능·랭크로 계산 (자신 공격 랭크 무시). 분류 물리 → 상대 방어에 부딪힘 | 자신 공격 실능으로 계산 (틀림) | `effect` 비어 있음 |
| **사이코쇼크** | 분류는 특수(자신 특공으로 계산)지만 데미지는 **상대의 방어**로 받음 (특방 아님) | 상대 특방으로 계산 (틀림) | `effect` 텍스트만 |

### 3-1a. 가변 위력 기술 — 로스터 전수조사 + 계산식 (2026-08-31 사용자 확정)

엔진은 move-id 문자열이 아니라 **데이터 플래그**로만 특수 처리를 한다. 플래그 없으면 `power`(JSON 리터럴, 다수가 `null`)로 방치된다. 사용자가 준 계산식은 이 프로젝트 기준 확정값이므로 본가와 달라도 이걸 따른다.

**(1) 즉시 배선 가능 — 몸무게 불필요**

| 기술 | 계산식 | 현재 `power` | 비고 |
|---|---|---|---|
| **자이로볼** | `min(150, 25 × (상대 스피드 / 자신 스피드 + 1))` | `null` | 스피드 랭크 반영 후 실효 스피드로 |
| **바둥바둥(Flail)** | **기사회생과 동일** — `reversalPowerFromHp` 그대로 재사용 | `null` | `reversalPower` 플래그만 붙이면 끝 |
| **토해내기(Spit Up)** | `비축 스택 × 100` (최대 3스택 → 300) | `null` | 비축하기 스택 카운터 필요 (삼키기는 로스터에 없음) |
| **기어오르기** | `20 + 20 × (자신의 모든 랭크 상승 합계)` | `20` | effect엔 적혀 있으나 엔진 미반영 |
| **어시스트파워(Stored Power)** | `20 × (자신의 모든 랭크 상승 합계 + 1)` = 기어오르기와 동일식 | `20` | effect 비어 있음 — **3-1 초안에서 누락, 추가** |
| **비장의무기(Trump Card)** | 남은 PP 적을수록 강함 (표는 별도 확인 필요) | `140` | 엔진이 `remainingPp` 추적 중 → 배선만 |
| **눈사태(Avalanche)** | 이번 턴 먼저 피격 시 ×2 | `60` | `damageTakenThisTurn` 이미 있음 → 배선만 |
| **보복(Payback)** | 상대가 나보다 나중에 행동 시 ×2 | `50` | 행동 순서 판정 필요 |
| **돌림노래 / 분풀이 / 분함의발구르기 / 질투의불꽃 / 애크러뱃** | 각 조건부 ×2 (아군선행 / 아군사망 / 직전 실패 / 상대 능력상승 / 도구없음) | 리터럴 | 조건 플래그 각각 |
| **웨더볼(Weather Ball)** | 날씨로 **타입 + 위력 ×2** 동시 변동 | `50` | 타입 변경까지 (`fieldPulse`의 날씨판) |

**(2) 데이터 정정 (내 이전 인식과 다른 점 — 사용자 지적)**

| 기술 | 내 이전 분류 | 실제 (사용자 확정) | 조치 |
|---|---|---|---|
| **로킥** | 몸무게 기반 위력 | **몸무게 무관.** 단순 "상대 스피드 1랭크 하락" 기술, 위력 65 고정 | `effect` 텍스트 교체 + `statChanges: [{opponent, spe, -1}]`, `power: 65` 유지. 몸무게 그룹에서 제외 |
| **앙갚음** | "상대가 나중에 행동 시 ×2" (턴순서) | **메탈버스트 클론.** "직전에 받은 기술 데미지를 1.5배로 되돌림" (물리·특수 무관) | `메탈버스트`와 같은 로직으로 통일 — `counters`(2배·동일카테고리·타입면역) 말고 **1.5배·전 카테고리·면역 없음**용 새 플래그 필요. 우선도는 앙갚음 0 / 메탈버스트 −3 유지 |

**(3) 이미 플래그로 처리됨 — 감사 = 데이터 정확성만 확인**

- 성스러운칼 `ignoresDefenderStatStagesInDamage` · 기사회생 `reversalPower` · 나이트헤드/지구던지기 `fixedDamage:50` · 미러코트/카운터 `counters` · 죽기살기 `setsTargetHpToUserHp` · 프리즈드라이 `overridesTypeEffectivenessFor` · 대지의파동 `fieldPulse` · 와이드포스/미스트버스트/라이징볼트 `powerMultiplierInField` · 트리플악셀/스케일샷/록블라스트/고드름침/더블어택 `multiHitPowers`·`minHits` · 지진/파도타기/번개 `bypassesHiding`+`hidingBypassMultiplier`

**(4) → 3-6 참조**: 몸무게 기반(헤비봄버·풀묶기·안다리걸기·히트스탬프)은 스키마·로직·실데이터 입력 완료(2026-08-31).

### 3-2. 접근

> **[증분 A · 2026-08-31 완료]** 아래 플래그 3종을 `move.ts`에 추가하고 `battlePower.ts`에 `resolveAttackStat` / `resolveDefenseStat` 헬퍼를 넣어 `computeOffensePower`·`computeDamage`·`computeBulkPower`의 스탯 선택을 전부 그 헬퍼로 통일. `matchupEvaluator`는 방어자 실능·랭크(`defenderRealStats`/`defenderStages`)와 `defensiveStatOverride`를 넘기도록 확장. `battleSimulator`는 `computeDamage` 호출이 이미 방어자 실능을 넘기고 있어 자동 반영 + 관통드릴용 `contactDefenseStat`이 `hitsDefensiveStat` 축을 따르도록 수정. 데이터: 바디프레스 `offensiveStatOverride:"def"`, 속임수 `usesTargetAttackStat:true`, 사이코쇼크 `hitsDefensiveStat:"def"`. 손계산 픽스처 8종 PASS(결정력·데미지·내구력 + 일반기 회귀), tsc/lint/build 통과.
>
> **미해결 엣지(허용)**: 천진(Unaware) × 속임수 상호작용은 근사 — 공격측이 천진이면 방어자 atk 랭크를 무시(현행 `ignoresOpponentStatStagesInDamage` 경로 재사용), 방어측이 천진인 경우는 `usesTargetAttackStat`가 `defenderStages`를 직접 읽어 영향 없음. 본가 정밀 규칙과 다를 수 있으나 로스터에 천진 보유자가 드물어 후속으로 미룸.

`Move` 타입에 계산축 오버라이드 플래그 3종을 추가하고, 스탯 선택 지점을 전부 그 플래그를 보도록 고친다.

```ts
/** 바디프레스: 공격 대신 자신의 이 스탯 실능·랭크로 결정력을 낸다 (분류는 그대로) */
offensiveStatOverride?: "def" | "spd" | "spe";
/** 속임수: 자신이 아니라 방어자의 공격 스탯·랭크로 결정력을 낸다 */
usesTargetAttackStat?: boolean;
/** 사이코쇼크류: 특수기지만 데미지는 방어자의 물리 방어로 받는다 (분류·자신측 스탯은 특수 그대로) */
hitsDefensiveStat?: "def" | "spd";
```

- **`computeOffensePower` / `computeDamage`**: 공격 스탯을 고르는 한 곳을 `resolveAttackStat(move, attacker, defender, stages)`로 빼서 — 기본은 카테고리 분기, `offensiveStatOverride` 있으면 자신의 해당 스탯 + 해당 랭크, `usesTargetAttackStat`면 방어자의 공격 실능 + 방어자 공격 랭크(자신 공격 랭크 무시).
- **방어 스탯**: `computeDamage`의 `defenseStat`와 `computeBulkPower`가 `hitsDefensiveStat`(있으면 그 스탯) → 없으면 카테고리 분기. 랭크도 같은 스탯 걸로.
- **`battleSimulator`**: `contactDefenseStat`(스크린 종류 판정용)·급소 시 무시 랭크 계산이 방어 스탯 기준을 공유하도록 같은 헬퍼를 태운다. 스크린 자체는 **분류 기준**(사이코쇼크는 특수기라 빛의장막에 막힘)이라 분리 주의 — 스크린은 `category`, 데미지 방어 스탯은 `hitsDefensiveStat`.
- **랭크 상호작용 주의**: 바디프레스는 자신의 *방어* 랭크가 오르면 위력이 오른다(껍질깨기로 방어 내려가면 약해짐). 속임수는 상대가 칼춤 쓰면 더 아프고, 상대 공격이 내려가 있으면 약해진다. 급소 시 "공격측에 불리한 랭크 무시"가 이 대체 스탯에도 적용돼야 한다.

### 3-3. 매치업(결정력·내구력) 페이지 연동

`evaluateSlotMatchup`은 `computeOffensePower` / `computeBulkPower`를 그대로 부르므로 위 수정이 자동 반영된다. 다만:

- 방어자 슬롯이 없으면 **속임수·사이코쇼크는 결정력을 확정할 수 없다**(상대 공격/방어 실능이 있어야 함) — 방어자 미선택 시 배지에 "상대 능력치 기준 기술 — 상대를 골라야 계산됩니다" 안내.
- 2단계에서 만든 난수 확률(§2)도 이 대체 스탯 기준 `offensePower`로 그대로 계산되면 된다.
- `MatchupSlotCard`가 "결정력 = 공격 × …"로 라벨링돼 있으면 바디프레스일 때 "방어 기준", 속임수일 때 "상대 공격 기준"으로 문구를 바꾼다(선택).

### 3-4. 검증

- 계산축 3종(바디프레스·속임수·사이코쇼크) + 자이로볼·바둥바둥·토해내기·기어오르기/어시스트파워는 손계산 케이스 1개씩(레벨 50) 픽스처로 박아 회귀 방지.
- 기존 일반 기술의 데미지 수치가 헬퍼 리팩터 후에도 안 바뀌는지 `battleSimulator` 스냅샷/플레이테스트(Phase 7 §1-H)로 확인.
- `moves.json` 데이터 채우기:
  - 계산축: 바디프레스 `offensiveStatOverride:"def"`, 속임수 `usesTargetAttackStat:true`, 사이코쇼크 `hitsDefensiveStat:"def"`.
  - 3-1a (1): 각 기술에 해당 플래그(신설 포함) 부여 + `power` 정리.
  - 3-1a (2): 로킥·앙갚음 데이터 정정.
- 3-1a (3)의 기존 플래그 기술은 데이터가 맞게 붙어 있는지만 훑고 "현행 유지" 기록.

### 3-5. 스코프 밖

- 테라버스트(테라스탈 미모델링), 은혜갚기/화풀이(친밀도 미모델링), 회심의일격류(이미 `alwaysCrit`) 등 현재 로스터에 없거나 별도 시스템이 필요한 것은 이번 감사에서 목록만 남기고 미구현.
- 삼키기(Swallow)는 로스터에 아예 없음 — 토해내기만 처리하고 삼키기는 데이터 보강 시점에.

### 3-6. 몸무게(weight) 스키마 — 스키마·로직 완료, **실데이터 입력 완료 (2026-08-31)**

- **대상 기술**: 헤비봄버 · 히트스탬프(`weightRatioPower` — 상대/자신 비율), 풀묶기 · 안다리걸기(`targetAbsoluteWeightPower` — 상대 절대값).
- **한 것**:
  - `Pokemon` 타입에 `weightKg?: number` 추가(선택 필드). `MegaEvolution` 타입에도 `weightKg?: number` 추가.
  - `battlePower.ts`에 순수 위력표 헬퍼 `weightRatioPowerValue(userKg, targetKg)` / `absoluteWeightPowerValue(targetKg)` + `WEIGHT_MOVE_FALLBACK_POWER = 60`.
  - `battleSimulator`·`matchupEvaluator` 둘 다: 양쪽(또는 상대) `weightKg`가 있으면 표대로, 하나라도 `undefined`면 폴백 60.
  - 데이터: 4기술에 플래그 부여(`power`는 `null` 유지).
  - **실데이터 입력(2026-08-31)**: 기본 종 49마리 전부 `weightKg` 입력(PokéAPI 기준). 메가폼 28개 중 공식 17개는 PokéAPI값, 비공식 11개(라이츄·망나뇽·마폭시·곤율거니·몰드류·개굴닌자·플라엣테·픽시 메가, 한카리아스·루카리오 메가Z)는 사용자 지정값. 참고: `곤율거니 = Scrafty` 30.0kg(Ferrothorn 아님).
  - **메가폼 몸무게 배선(2026-08-31)**: `EffectiveForm.weightKg` 신설(`getEffectiveForm`이 `mega.weightKg ?? pokemon.weightKg`로 채움). `battleSimulator`(`weightOf(fighter)` = `getEffectiveForm(pk, fighter.slot).weightKg`)·`matchupEvaluator`(`attackerForm.weightKg`/`defenderForm.weightKg`) 둘 다 메가 상태면 그 폼 몸무게로 계산. 검증: 메가캥카(100kg) 안다리걸기 = 캥카(80kg)의 정확히 1.25배.
- **계산식 (사용자 확정)**:
  - **헤비봄버 / 히트스탬프**: `≤1/5→120` · `≤1/4→100` · `≤1/3→80` · `≤1/2→60` · `>1/2→40`
  - **풀묶기 / 안다리걸기**: `<10→20` · `<25→40` · `<50→60` · `<100→80` · `<200→100` · `≥200→120`
- **후속 데이터 작업 시 결정할 것**: 부유·경량화(라이트메탈)·헤비메탈 특성 상호작용(현재 미반영) — 몸무게 4종은 이걸로 완료.

---

## 4. [4단계 · 페이즈 최후] 배틀타워 리뉴얼 — 파티 선출·교체 인프라

> 이 페이즈에서 가장 크고 가장 버그가 많이 날 작업. **1~3단계 완료 후**, 별도 결재를 받고 착수한다.
> 리뉴얼의 본체(4-1~4-5)와 그 위에 얹히는 딸린 작업(4-6~4-8)을 전부 이 단계 안에서 처리한다 — 인프라 없이는 나머지가 의미가 없으므로 분리하지 않는다.
> Phase 7 §2·§3-2, Phase 6.5·7의 "1대1·교체 없음" 우회분이 전부 여기로 수렴한다.

### 4-1. `BattleState` 재설계

- `a` / `b`를 `{ party: BattleFighterState[]; activeIndex: number }` 형태로. 기절·상태이상·랭크·도구 소모·연속기 카운터는 전부 슬롯별로 유지.
- 배틀타워 대전은 편측 **3마리**(선출된 팀). `party`는 그 3슬롯을 담고, 향후 다른 포맷을 위해 배열 길이는 고정하지 않는다.
- `createBattleState` 시그니처: 편측 3슬롯 + 선봉 인덱스를 받도록.
- 설치물(`state.stealthRock` 등 현재 `{a,b}` 스칼라)은 **진영별 설치 상태**로 유지 — 슬롯이 아니라 편(side)에 붙는다. 압정뿌리기 스택 등 다층 설치를 담을 수 있게 `{ a: HazardState; b: HazardState }`로 확장.

### 4-2. 선출 단계 — 6마리 풀에서 3마리 선택

- `useBattleSetup`을 6슬롯 빌더로 확장(현재 편측 1슬롯). 각 슬롯은 지금의 `BattleSetupCard` 입력(포켓몬·기술·특성·도구·성격·개성·성별) 그대로.
- 빌드 완료 후 **선출 화면**: 양측이 자기 6마리 중 3마리를 고르고 **순서**까지 정한다. 첫 슬롯이 리드.
  - ⚠️ 선출 방식(6빌드→3선출 vs 3만 빌드) 자체는 **미확정** — 4단계 개별 결재 때 정한다(2026-08-31 보류).
- 상대(B) 측 선출은 우선 수동(플레이어가 상대 팀도 구성)으로 두고, 자동 선출 로직은 이 단계 범위 밖.
- 샘플 프리셋(`slotPresets`)은 팀 단위 저장까지는 안 하고 슬롯 단위 유지.

### 4-3. 교체 액션 / `runTurn`

- `runTurn`이 편측당 `move | switch` 액션을 받도록. 액션 타입: `{ kind: "move"; moveId }` | `{ kind: "switch"; toIndex }`.
- **교체 우선도**: 항상 그 턴 기술보다 먼저 처리. 예외 — 상대가 추격(추격 특수 처리: 교체 나가는 포켓몬을 위력 2배로 때리고 교체는 그 뒤 성립).
- 한쪽만 교체한 턴: 교체 측은 공격 안 하고 상대만 1회 공격.
- 양쪽 교체: 둘 다 공격 없이 등장 처리만.
- 기절 후 강제 교체: 턴 종료 시 활성 슬롯이 기절해 있으면 다음 액션 전에 교체를 요구(남은 슬롯 없으면 그 편 패배).
- 구애 도구 잠금·앙코르·도발 등 기존 제약은 **교체하면 해제**(슬롯을 벗어나므로) — `choiceLockedMoveId` 등이 슬롯별 상태를 읽도록 이전.

### 4-4. 등장 시 처리 파이프라인

교체(또는 리드 등장)로 포켓몬이 나오는 순간, 순서 고정:

1. **설치물 발동** (4-6) — 스텔스록 등장 데미지, 압정뿌리기 스택별 데미지, 끈적끈적네트 스피드 다운, 독압정 중독. 부유·비행·에어벌룬 등 비접지는 스텔스록 외 무시. 독타입이 나오면 독압정 해제.
2. **등장 특성** — 위협, 가뭄·잔비·모래날림·눈퍼뜨리기(눈설White), 기분파, 프리즈스킨류, 트레이스, 다운로드 등.
3. **재생력**(교체 아웃 시 최대 HP 1/3 회복), **자연회복**(교체 아웃 시 상태이상 치유) — 나가는 포켓몬 쪽 처리.

- 스텔스록 등장 데미지 훅에 **매직가드**(Phase 7 §3-1)·**인분**의 게이팅을 함께 물린다(타입 주석에 이미 명시).

### 4-5. BattleLogPage UI

- 선출 화면(6마리 빌드 → 3마리 + 순서 선택).
- 대전 중 턴마다 "기술 / 교체" 선택 토글. 교체 선택 시 남은 슬롯 목록(기절 제외).
- 파티 3마리 HP·상태이상·기절 트래커(양측).
- 교체 로그 문구(`~를 뒤로 물렸다 / ~를 내보냈다`), 설치물 발동 문구, 등장 특성 문구.
- 진영별 설치물 환경 태그(현재 스텔스록만 있는 `battle-environment-tags`를 압정뿌리기 스택·독압정·끈적끈적네트까지 확장).

### 4-6. 상대 진영 설치 기술 6종 (Phase 7 §2에서 이월)

Phase 7 §2 본문을 그대로 승계. 스텔스록은 7에서 "설치 상태 + 환경 UI + 설치/실패 문구"까지 선반영돼 있으니, 이 페이즈에서는 **등장 시 데미지 + 스택 + 제거(고속스핀·안개제거) + 독타입 교체 독압정 해제**만 얹으면 된다.

- 해당 기술: 끈적끈적네트 · 독압정 · 비검천중파 · 스텔스록 · 암석액스 · 압정뿌리기
- 스택: 독압정 1→독 / 2→맹독, 압정뿌리기 1→1/16 · 2→1/8 · 3→1/4, 나머지는 1장 고정(재사용 실패)
- 부유·비행·에어벌룬 등 비접지 대상은 압정뿌리기·끈적끈적네트·독압정 무시(스텔스록은 맞음)
- 스텔스록 등장 데미지가 생기면 **매직가드(Phase 7 §3-1)**·**인분**의 게이팅 지점도 그 훅에 함께 물린다 — 타입 주석에 이미 명시해 둠.

### 4-7. 딸린 특성 — 플라워베일·공생 (Phase 7 §3-2에서 이월)

- **플라워베일** (플라엣테) — 자기 편 **풀타입** 포켓몬의 랭크다운·주 상태이상을 막는다. 보유자 자신은 **풀타입일 때만** 보호 대상 — 플라엣테는 페어리라 자기 자신엔 무효고, 아군에 풀타입이 있을 때만 의미가 생긴다. 현재 스텁(설명 텍스트)만 등록돼 있다.
- **공생** (플라엣테 숨특) — 아군이 지닌 도구를 소모하면 자신의 도구를 그 아군에게 넘겨준다. 아군 슬롯이 있어야 트리거 자체가 성립. 현재 스텁만.

둘 다 `abilities.json`에 설명만 있고 로직 미배선. 더블 배틀이 아니라 3v3 싱글 교체만 도입돼도 플라워베일(아군 풀타입 보호)은 대상이 생긴다. 공생은 "같은 편 다른 슬롯"이 교체로만 존재하므로 실제 발동은 드물지만, 파이프라인은 걸어 둔다.

### 4-8. 교체 도입 시 복원할 것 (Phase 6.5·7의 1대1 우회)

- **가속(Speed Boost)**: "교체로 나온 턴엔 미발동" 예외 (6.5 §6-2 ①에서 `state.turnNumber > 1` 가드를 제거해 뒀음).
- **곡예(Unburden)**: "도구를 잃은 뒤 교체하기 전까지"가 본가인데 지금은 "배틀 끝까지"로 취급 중.
- **씨뿌리기 · 헤롱헤롱 · 뿌리박기 · 아쿠아링**: 교체로 해제되는데 지금은 배틀 끝까지 유지(턴 카운터 없음).
- **일루전**(조로아크) — 파티 마지막 슬롯 조건. 등장 특성이라 인프라 선행.
- **미러코트/카운터·희망사항** 등 "그 자리에 있는 포켓몬" 가정이 깨지는 것들 재점검.

### 4-9. 4단계 내부 권장 진행 순서

1. **4-1** 상태 구조부터(슬롯별 상태 분리). 여기서 기존 1대1 배틀이 "1마리짜리 파티"로 그대로 돌아가는지 회귀부터 맞춘다.
2. **4-3** 순수 교체만(설치물·등장 특성 없이). 교체 우선도·강제 교체·추격만.
3. **4-5** UI 최소 배선(교체 버튼 + 파티 트래커) — 여기까지가 "교체 되는 배틀타워" MVP.
4. **4-2** 6마리 빌드 + 3마리 선출.
5. **4-4** 등장 파이프라인 골격.
6. **4-6** 설치기 6종을 파이프라인에 → **4-7** 특성 → **4-8** 우회 복원.

각 스텝마다 Phase 7 §1-H 3차 플레이테스트 항목으로 회귀를 돌린다(교체 없는 기존 시나리오가 안 깨졌는지).

---

## 5. 결재 현황 (2026-08-31)

- [x] **문서 구조**: `1 → 2 → 3 → 4(배틀타워 리뉴얼 최후)` 순서로 확정.
- [x] **1단계**(기술표 열 정렬) 완료 — 헤더/데이터 열 정렬 + 우선도·위력·PP 중앙 정렬, 스크롤바 본문 한정까지 반영.
- [x] **2단계**(난수 격파 확률 표기) 완료 — `evaluateMatchupChance` + `SlotMatchupResult` 필드 + `VerdictBadge` 확률 줄. 배지 문구: 난수 1타 `50.0%` / `16난수 중 8개`, 난수 2타 `46.9% · 2타`, 3타 이상 필요 `2타 격파 0%`(회색), 확정 1·2타는 줄 없음. 브라우저 5개 판정 전부 확인.
- [x] **[추가] 기술 설명문·태그·우선도 전건 반영**(1-5) 완료 — 401건 effect/tags/priority 반영, `Move.tags`·`Move.priorityDisplay` 신설. 엔진 참조 태그(`classification`)와 표시 태그(`tags`) 분리 유지, 엔진 값이 꼬이면 두 태그 통합하는 폴백 방침 1-5에 기록.
- [x] **3단계**(특수 데미지 로직 감사) — **배틀타워 리뉴얼(§4) 앞 전 항목 완료**(2026-08-31). 증분 A·B·C·B-2·B-3, 토해내기·비장의무기, 몸무게 스키마·로직·실데이터(49종+28메가폼)·메가폼 배선, 질투의불꽃 조건부 화상, 앙갚음·메탈버스트(+카운터 버그픽스)까지. §3 잔여 없음.
  - [x] **증분 A** — 계산축 오버라이드(바디프레스·속임수·사이코쇼크). `offensiveStatOverride`/`usesTargetAttackStat`/`hitsDefensiveStat` 3종 + `resolveAttackStat`/`resolveDefenseStat` 헬퍼. 픽스처 8종 PASS. (§3-2 상단 참조)
  - [x] **증분 B** — 플래그만으로 되는 가변 위력 (배틀 엔진 + 데이터, 2026-08-31 완료):
    - `move.ts` 플래그 신설: `gyroBallPower`, `powerFromPositiveStages: { base, perStage }`. `reversalPower` 주석에 바둥바둥 추가.
    - `battleSimulator.ts`: `gyroBallPowerValue`(실효 스피드 = 실능 × 스피드 랭크 × 마비 × 도구 배율, `min(150, floor(25 × (상대/자신 + 1)))`)·`positiveStagesPowerValue`(`base + perStage × Σmax(0,5스탯 랭크)`) 헬퍼 + `resolveAction`의 `reversalPower` 블록 옆에 배선.
    - 데이터: 자이로볼 `gyroBallPower:true`, 바둥바둥 `reversalPower:true`, 기어오르기·어시스트파워 `powerFromPositiveStages:{base:20,perStage:20}`, 로킥 `statChanges:[{opponent,spe,-1}]`(위력 65 고정 유지).
    - 검증: 헬퍼 픽스처 8종(스피드 랭크·마비·상한 150·음수 랭크 무시 포함) + `runTurn` 통합 스모크 3종(자이로볼·기어오르기·바둥바둥이 blockedReason 없이 실데미지) PASS. tsc/lint/build 통과.
    - **엔진만 반영, 매치업 페이지는 미반영** — 자이로볼·바둥바둥은 `power:null`이라 `evaluateSlotMatchup`이 early-return(기존 기사회생·토해내기도 동일). 결정력·내구력 페이지 가변 위력 지원은 별도 증분 B-2로 뺀다(§3-3).
  - [x] **증분 C** — 조건부 ×2 + 웨더볼 (2026-08-31 완료):
    - `move.ts`: `conditionalDoublePower?: "took-damage-this-turn" | "moves-after-target" | "user-has-no-item"`, `weatherBall?: boolean`.
    - `weatherEffects.ts`: `applyWeatherBall`(WEATHER_ACCENT_TYPE 재사용 — 비=물·쾌청=불꽃·모래바람=바위·눈=얼음, 위력 ×2). `battleSimulator`/`matchupEvaluator` 둘 다 `applyFieldPulse` 직전에 배선.
    - `battleSimulator`: `resolveAction`의 위력 확정 구간에 `conditionalDoublePower` 판정(`damageTakenThisTurn` 합 > 0 / `movesSecond` / `!currentItemId`).
    - 데이터: 눈사태 `took-damage-this-turn`, 보복 `moves-after-target`, 애크러뱃 `user-has-no-item`, 웨더볼 `weatherBall`.
    - 검증: `runTurn` — 보복 후공 시 ×2(2.00x), 눈사태 피격 시 ×2(1.93x, 나머지는 floor 오차), 애크러뱃 무도구 ×2(2.00x), 웨더볼 비→물타입(typeEff 0.5→2)·모래바람→바위(x1)·데미지 14→168→56. tsc/lint/build 통과.
    - **증분 B-3(2026-08-31 완료)** — 사용자 지시대로 처리:
      - 분풀이 `conditionalDoublePower: "user-stat-lowered-this-turn"`, 분함의발구르기 `"user-move-failed-last-turn"` 신설.
      - **엔진(battleSimulator)**: 이번 턴/직전 턴 이력 상태가 없어 두 조건은 **항상 미충족(기본 위력)**. (`met` 판정에서 두 조건은 `false`로 명시.)
      - **매치업(matchupEvaluator)**: 두 조건 **항상 충족 상정(×2)**. 애크러뱃(도구 앎)은 실제 판정 유지.
      - **질투의불꽃**(2026-08-31 완료): `Move.burnsTargetIfStatRoseThisTurn` + `BattleFighterState.statStagesAtTurnStart`(runTurn이 턴 시작 시 스냅샷). 명중·데미지 있고 방어자의 5스탯 랭크가 스냅샷 대비 하나라도 올랐으면 화상 확정(불꽃 타입·이미 상태이상·미스트필드·인분·황금몸·대타 규칙 존중). 매치업은 상태이상 미모델링이라 엔진 전용. 검증 2종 PASS.
      - **돌림노래**: 아군 ×2는 1v1 엔진에서 영구 무발동 → 데이터 문구만, 엔진/매치업 배선 없음(사용자 지시).
  - [x] **앙갚음 / 메탈버스트**(2026-08-31 완료): `Move.countersAllCategories: { multiplier }`(둘 다 1.5). `counters`(카테고리별 2배)와 달리 물리·특수 합(`damageTakenThisTurn` 합)의 1.5배를 타입·면역 무시하고 반사, 안 맞았으면 실패(`counterFailed`). counters 블록 바로 옆에 배선. **매치업은 배선 안 함**(직전 받은 데미지를 알 수 없음, 사용자 확인). 검증: 앙갚음 19→28, 메탈버스트(특수 피격) 16→24, 선공 시 실패. 겸사겸사 **카운터**(`counters` 필드 누락된 기존 버그) `counters:"physical"` 채움 — 검증 19→38.
  - [x] **증분 B-2** — 매치업(결정력·내구력) 페이지 가변 위력 지원 (2026-08-31 완료):
    - 순수 위력 헬퍼를 `battlePower.ts`로 이동·통일: `reversalPowerFromHp`, `gyroBallPowerFromSpeeds`(실효 스피드 2개 → 위력), `positiveStagesPowerValue`. `battleSimulator`는 이걸 import(로컬 중복 제거), `gyroBallPowerValue`는 실효 스피드만 산출 후 위임.
    - `matchupEvaluator`: `move.power === null` early-return을 category만 보게 완화하고, `computeOffensePower` 전에 `reversalPower`(스냅샷=풀피→위력 20)·`gyroBallPower`(양측 실능 × 스피드 랭크 × 도구, 마비는 매치업에 상태 없어 미반영)·`powerFromPositiveStages`(`attackerStages` 기준)·`conditionalDoublePower:"user-has-no-item"`(애크러뱃, 도구 앎)·`weatherBall`을 해결. 기존 미지원이던 기사회생·자이로볼·기어오르기·어시스트파워가 이제 매치업 화면에서 평가됨.
    - 눈사태·보복(`took-damage-this-turn`/`moves-after-target`)은 배틀 문맥이 필요해 매치업에선 기본 위력 유지.
    - 검증: `evaluateSlotMatchup` — 자이로볼/바둥바둥/기어오르기(랭크 반영)/웨더볼(비 결정력↑)/애크러뱃(무도구 ×2 = rawOffensePower 2.00x) 전부 통과.
  - [x] **토해내기 / 비축하기**(2026-08-31 완료): `Move.addsStockpile`·`spitUpPower`, `BattleFighterState.stockpileCount`. 비축하기=스택+1(최대 3, 3이면 실패)+데이터 statChanges로 방어/특방+1. 토해내기=위력 `스택×100`(0이면 실패), 사용 시 스택 0으로·그만큼 방어/특방 랭크 되돌림. 매치업은 `SlotMatchupOptions.stockpileCount`(기본 3) + MatchupSlotCard에 ×1/×2/×3 선택 UI. `runTurn` 검증 7종 PASS. 꿀꺽·삼키기는 로스터에 없어 미처리.
  - [x] **비장의무기**(2026-08-31 완료, 사용자 재정의): PP 위력표 폐기. `usageCondition: "all-other-moves-used"` 신설 — `BattleFighterState.usedMoveIds`로 "그 기술로 행동 개시"를 기록하고, 자신의 나머지 기술(remainingPp 키)을 전부 한 번씩 쓰기 전까지 실패. 위력은 리터럴 140 유지. 검증 2종 PASS.
  - 앙갚음·메탈버스트는 `damageTakenThisTurn`의 물리+특수 합을 그대로 써서 배선 완료(위 항목 참조). 1v1 싱글에선 "턴 누적합 = 그 턴 유일하게 맞은 공격"이라 문제없다.
- [x] **몸무게 스키마 + 실데이터 + 메가폼 배선**(3-6, 2026-08-31) — `Pokemon.weightKg?` / `MegaEvolution.weightKg?` / `EffectiveForm.weightKg` 필드 + 위력표 헬퍼 + 엔진/매치업 배선(메가 상태면 그 폼 몸무게) + 4기술 플래그. **실데이터**: 기본 종 49/49, 메가폼 28/28(공식 17 PokéAPI + 비공식 11 사용자값). 몸무게 관련 전부 완료 — 후속은 라이트메탈/헤비메탈 특성 상호작용만(현재 로스터 영향 미미).
- [x] **[추가] 로스터 3종 + 특성 3종 배선**(2026-09-01) — 잠만보(노말)·오롱털(악/페어리)·드래펄트(드래곤/고스트) + 신규 기술 7종(막말내뱉기·소울크래시·드래곤애로·썬더다이브 배선, 리사이클·위액·록온 스텁). 특성:
  - **면역**: `immuneToStatuses:["poison","badly-poisoned"]`(독·맹독 면역).
  - **먹보**: `Ability.hpThresholdBerryDivisor`(=4) 신설. `getHpThresholdBerryHeal`에 `thresholdDivisor` 인자 추가 — HP회복 나무열매(자뭉·오랭) 발동 문턱이 1/2→1/4로 내려간다(사용자 지정, 본가와 반대 방향: 이 게임 baseline이 이미 1/2). 다른 포켓몬은 영향 없음.
  - **통찰**: `Ability.revealsOpponentItemOnEntry` 신설. `resolveEntryAbilityEffects`(위협·트레이스와 같은 훅)에서 첫 턴 시작과 동시에 `entryAnnouncements`로 2줄("…의 통찰!" / "…은 상대도구를 통찰했다!"). 상대 무도구면 무출력. 배틀 수치 영향 없음.
  - **나쁜손버릇**: `AbilityHitTrigger.stealsAttackerItem` 신설(`hitTrigger:{on:"contact",...}`). 접촉기(물리·특수 무관)로 피격당하고 자신이 무도구면 공격자 도구를 강탈, 로그 `pickpocketStolenItemName`. 대타·면역 피격·자신 도구 보유 시 무발동(매지션과 방향만 반대). 검증: `createBattleState`/`runTurn` 스모크 — 통찰 2줄·먹보 문턱(45% 무발동/20% 발동)·나쁜손버릇 물리·특수 접촉 강탈 전부 PASS. tsc/lint/build 통과.
- [ ] **4단계**(배틀타워 리뉴얼) — 1~3 완료 후 다시 개별 결재. 아래는 그때 정한다:
  - [ ] 선출 방식: 6마리 빌드 → 3마리(순서 포함) 선출 → 첫 슬롯 리드 vs 3마리만 빌드 — **보류**.
  - [ ] 상대(B) 팀·선출을 전부 수동 구성으로 두는 것(자동 상대 편성은 범위 밖).
  - [ ] 4-9 내부 진행 순서(교체 MVP 먼저, 설치기·특성·복원은 그 뒤)로 진행.
