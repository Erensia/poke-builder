# Phase 7.5 기획 — 포켓몬 로스터 확장 (포챔스 입국몬 전체)

> 이어서 읽기: [Phase 7 기획](phase7-plan.md) · [Phase 8 기획 — 배틀타워 리뉴얼](phase8-plan.md)

## 0. 이 문서의 성격과 작업 순서

### 2026-09-01 작업 페이즈 재편

원래 이 문서는 "선행 UI 정리 3건(§1~§3) + 배틀타워 리뉴얼(§4)"이었다. §1~§3이 전부 완료(2026-08-31)되고 나서, 남은 배틀타워 리뉴얼을 **Phase 8로 분리**하고([phase8-plan.md](phase8-plan.md)), Phase 7.5의 스코프를 **포켓몬 로스터 확장 하나로 좁혔다.**

| 구 항목 | 상태 |
|---|---|
| §1 기술표 열 정렬 + 설명문·태그·우선도 전건 반영 | ✅ 완료 (2026-08-31) — 기록 보존 |
| §2 난수 격파 확률(%) 표기 | ✅ 완료 (2026-08-31) — 기록 보존 |
| §3 특수 데미지 로직 감사 (+ 몸무게 스키마·실데이터, 질투의불꽃, 앙갚음·메탈버스트) | ✅ 완료 (2026-08-31) — 기록 보존 |
| §4 배틀타워 리뉴얼 | → **[Phase 8](phase8-plan.md)로 분리** |
| §6 포챔스 입국몬 전종 데이터 추가 | 🔲 **← Phase 7.5의 현재 스코프** |

### 현재 스코프 — §6. 포켓몬 로스터 확장

포켓몬 챔피언스에서 사용 가능한 포켓몬(입국몬)을 전종 데이터로 추가해, 로스터를 "챔피언스 한정 소규모 로스터(52종)"에서 "챔피언스 입국몬 전체"로 확장한다. 사용자가 세대별로 포켓몬 데이터 JSON을 작성 중이며, 한 세대분이 완성될 때마다 그 세대 포켓몬을 `pokemon.json`에 병합한다. 현재 로스터 52종은 제외. 상세는 §6 참조.

**작업 브랜치**: `phase-7.5` (신규). 배틀타워 리뉴얼(Phase 8)은 별도 브랜치.

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

## 4. 배틀타워 리뉴얼 → **Phase 8로 분리 (2026-09-01)**

파티 선출·교체 인프라(엔진 재설계)는 [**Phase 8 기획**](phase8-plan.md)으로 옮겼다. 상대 진영 설치 기술 6종, 플라워베일·공생, 1대1 우회 복원(가속·곡예·씨뿌리기 등)도 전부 그쪽에 함께 있다. Phase 7.5는 로스터 확장(§6)만 담당한다.

---

## 5. 결재 현황

- [x] **문서 구조**: `1 → 2 → 3 → 4(배틀타워 리뉴얼 최후)` 순서로 확정 (2026-08-31).
- [x] **[2026-09-01 재편]** §1~§3 완료 확인 → 배틀타워 리뉴얼(§4) [Phase 8](phase8-plan.md)로 분리. Phase 7.5 스코프 = §6 로스터 확장으로 축소, 신규 브랜치 `phase-7.5`.
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
- [x] **[추가] 로스터 3종 + 특성 배선**(2026-09-01) — 잠만보(노말)·오롱털(악/페어리)·드래펄트(드래곤/고스트) + 신규 기술 7종(막말내뱉기·소울크래시·드래곤애로·썬더다이브 배선, 리사이클·위액·록온 스텁). 특성:
  - **면역**: `immuneToStatuses:["poison","badly-poisoned"]`(독·맹독 면역).
  - **먹보**: **무배선 스텁**. 본가 먹보는 "1/4 이하에서 먹는 나무열매를 1/2 이하에서 먹게" 하는데, 이 게임의 회복 나무열매(자뭉·오랭열매)는 이미 전부 1/2 이하 발동이 baseline이라 먹보가 바꿀 게 없음(사용자 확인 2026-09-01). `getHpThresholdBerryHeal` 문턱은 1/2 고정 유지.
  - **통찰**: `Ability.revealsOpponentItemOnEntry` 신설. `resolveEntryAbilityEffects`(위협·트레이스와 같은 훅)에서 첫 턴 시작과 동시에 `entryAnnouncements`로 2줄("…의 통찰!" / "…은 상대도구를 통찰했다!"). 상대 무도구면 무출력. 배틀 수치 영향 없음.
  - **나쁜손버릇**: `AbilityHitTrigger.stealsAttackerItem` 신설(`hitTrigger:{on:"contact",...}`). 접촉기(물리·특수 무관)로 피격당하고 자신이 무도구면 공격자 도구를 강탈, 로그 `pickpocketStolenItemName`. 대타·면역 피격·자신 도구 보유 시 무발동(매지션과 방향만 반대). 검증: `createBattleState`/`runTurn` 스모크 — 통찰 2줄·나쁜손버릇 물리·특수 접촉 강탈 PASS. tsc/lint/build 통과.
- [→] **배틀타워 리뉴얼** — [Phase 8](phase8-plan.md)로 분리(2026-09-01). 선출 방식·상대 편성·내부 진행 순서 등 미확정 사항은 Phase 8 착수 결재 때 정한다.
- [ ] **포챔스 입국몬 전종 데이터 추가**(§6) — **Phase 7.5의 현재 스코프.** 사용자가 세대별 JSON 작성 중, 한 세대분 완성될 때마다 반영. 현재 로스터(52종)는 제외. 신규 브랜치 `phase-7.5`에서 진행.

---

## 6. [상시] 포챔스 입국몬 전종 데이터 추가

### 6-1. 목표

포켓몬 챔피언스에서 **사용 가능한 포켓몬(입국몬) 전종**을 `pokemon.json`에 데이터로 채워, 로스터를 "챔피언스 한정 소규모 로스터"에서 "챔피언스 입국몬 전체"로 확장한다. 팀빌더·매치업·배틀타워가 전종을 대상으로 돌아가게 하는 것이 최종 상태.

### 6-2. 방식 — 세대별 순차 반영

- 사용자가 **세대별로 포켓몬 데이터 JSON을 별도 작성 중**이다. 한 세대분 JSON이 완성될 때마다 그 세대 포켓몬을 `pokemon.json`에 병합한다(1세대 → 2세대 → … 순).
- **현재 로스터에 이미 들어있는 종(52종)은 제외** — 중복 추가 금지. 병합 스크립트는 기존 `id` 목록과 대조해 신규만 추가한다.
- 세대 하나 반영 = 커밋 하나. 코드 페이즈(1~4단계)와 독립적으로 진행한다.

### 6-3. 스키마

기존 `Pokemon` 타입(`src/types/pokemon.ts`)을 그대로 쓴다 — 새 필드 없음:
`id` · `name` · `types` · `baseStats{hp,atk,def,spa,spd,spe}` · `abilities[]` · `hiddenAbility?` · `megaEvolutions?[]` · `stanceChangeForms?` · `genderCategory` · `weightKg?` · `learnset[]`.

- `weightKg`는 PokéAPI 기준으로 처음부터 채워 넣는다(로스터 49종처럼 나중에 별도 조사하지 않는다).
- `learnset`은 **챔피언스에서 실제 배울 수 있는 기술** 기준(본가 풀 learnset이 아님). 기술명은 `moves.json`의 `id`(= 한글 기술명)와 정확히 일치해야 한다.
- `genderCategory`는 본가 성비 기준(`both` / `male-only` / `female-only` / `genderless`).

### 6-4. 딸린 작업 (세대별로 같이 처리)

- **신규 특성**: 그 세대에서 처음 등장하는 특성은 `abilities.json`에 추가. 엔진 배선이 필요 없거나(정보 표시·교체 전제 등) 기존 필드로 표현 불가한 것은 **설명문 스텁**으로 두고, 로스터 3종 추가(2026-09-01) 때처럼 배선 여부를 개별 판단한다.
- **신규 기술**: `learnset`이 참조하는데 `moves.json`에 없는 기술은 추가(챔피언스 수치). 가변 위력·특수 로직 기술은 §3 감사 결과의 플래그 체계를 재사용, 없으면 스텁.
- **메가스톤 등 도구**: 메가진화가 있는 종을 추가하면 대응 메가스톤을 `items.json`에도 같이 추가.

### 6-5. 검증 (세대별 반영 때마다)

1. **참조 무결성**: 신규 종의 `abilities`/`hiddenAbility`가 전부 `abilities.json`에 존재, `learnset` 전 항목이 `moves.json`에 존재, `megaEvolutions[].megaStone`이 `items.json`에 존재.
2. **중복 없음**: `pokemon.json`·`moves.json`·`abilities.json`·`items.json` 각각 `id` 유일.
3. **종족값 합** 스팟체크(입력 오타 탐지).
4. `npx tsc -p tsconfig.app.json --noEmit` · `npm run lint` · `npm run build` 통과.

### 6-6. 아직 안 정한 것

- [ ] 데이터에 **세대 구분 필드**(`generation?: number`)를 남길지, 아니면 그냥 통합만 할지.
- [ ] 팀빌더 UI에서 "입국몬 전체"를 그대로 노출할지, 필터(세대·타입·이름 검색)를 먼저 붙일지 — 종 수가 수백이 되면 현재 드롭다운/그리드로는 부담.
- [ ] 배틀타워(§4) 상대 풀을 전종에서 뽑을지, 별도 큐레이션 풀을 둘지.
- [ ] 전종 추가 시점에 `learnset` 전수조사(챔피언스 기준)를 어느 정밀도로 할지.
