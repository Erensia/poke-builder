import type { PokemonType } from "./pokemon-type";
import type { MoveClassification } from "./move";
import type { WeatherKind } from "./weather";
import type { BattleStatKey } from "./battleStats";
import type { StatusCondition } from "./status";

export interface AbilityModifierCondition {
  /** 이 위력 이하인 기술만 (테크니션: 60) */
  movePowerAtMost?: number;
  /** 기술 자신의 타입이 이 목록에 있을 때만 (모래의힘: 땅/바위/강철) */
  moveTypeIn?: PokemonType[];
  /** 기술 분류 태그가 이 목록과 하나라도 겹칠 때만 (메가런처: 파동) */
  moveClassificationIn?: MoveClassification[];
  /** 이 날씨일 때만 (모래의힘: 모래바람) */
  weatherIs?: WeatherKind;
  /** 접촉기일 때만 (단단한발톱) */
  makesContact?: boolean;
  /**
   * 공격측 현재 HP가 최대 HP의 이 비율 이하일 때만(맹화·급류·심록·벌레의알림: 1/3). 매치업
   * 페이지(evaluateSlotMatchup)는 "현재 HP" 개념이 없는 1턴 스냅샷이라 항상 풀피로 간주해서
   * 이 조건이 있는 특성은 거기서는 발동하지 않는다 — 배틀 시뮬레이터(battleSimulator.ts)에서만
   * attacker.currentHp/maxHp를 실제로 넘겨준다.
   */
  attackerHpAtMostFraction?: number;
}

export interface AbilityModifier {
  scope: "offense" | "defense";
  /** 조건을 만족하면 곱해지는 배율 */
  multiplier: number;
  condition?: AbilityModifierCondition;
  /** offense 전용. 조건을 만족하면 기술의 실제 타입을 이걸로 바꿔서 자속/상성을 계산 (페어리스킨) */
  overrideMoveType?: PokemonType;
}

/**
 * 방어측이 기술에 맞았을 때(주로 접촉) 발동하는 특성 하나를 기술한다(정전기·불꽃몸·까칠한피부·
 * 깨어진갑옷·저주받은바디 공용 훅 — Phase 5 §1). 데미지를 실제로 준(damage > 0) 피격에만 판정하고,
 * 효과는 전부 "이 특성을 가진 쪽"이 방어측일 때만 적용된다.
 */
export interface AbilityHitTrigger {
  /**
   * 발동 조건 — 각 특성의 설명 텍스트를 그대로 축으로 나눴다:
   *  - "physicalContact": 물리 접촉기만 (정전기·불꽃몸 = "물리 접촉을 받으면")
   *  - "contact": 카테고리 무관 접촉기 전체 (까칠한피부 = "접촉기로 공격해 온")
   *  - "physical": 물리기 전체, 접촉 여부 무관 (깨어진갑옷 = "물리 공격을 받으면")
   *  - "damaging": 데미지를 준 모든 기술 (저주받은바디 = "공격을 받으면")
   */
  on: "physicalContact" | "contact" | "physical" | "damaging";
  /** 기술 자신의 타입이 이 목록에 있을 때만(정의의마음: 악타입) — 생략하면 타입 무관 */
  moveTypeIn?: PokemonType[];
  /** 발동 확률(%). 생략하면 100% 확정(까칠한피부·깨어진갑옷) */
  chance?: number;
  /** 공격자에게 이 주 상태이상을 건다(정전기=마비, 불꽃몸=화상). 타입 면역·중첩 규칙은 기존 inflictStatus/isImmuneToStatus를 그대로 재사용 */
  inflictsStatusOnAttacker?: StatusCondition;
  /** 공격자에게 자신(방어측)의 최대 HP 이 비율만큼 고정 데미지를 준다(까칠한피부: 1/8 = 0.125) */
  damagesAttackerFraction?: number;
  /** 자신(방어측)의 랭크를 이 목록만큼 바꾼다(깨어진갑옷: 방어 -1, 스피드 +2) */
  selfStatChanges?: { stat: BattleStatKey; delta: number }[];
  /** 공격자가 방금 사용한 기술의 남은 PP를 0으로 만든다(저주받은바디 — "사슬묶기" 텍스트를 PP 0 봉인으로 구현) */
  disablesAttackerMove?: boolean;
}

/**
 * 타오르는불꽃·피뢰침처럼 "이 타입 기술에 맞으면 데미지를 완전히 무효화하고 대신 이득을 본다"는
 * 특성 하나를 기술한다 — bypassesImmunityForTypes(공격측이 상대 면역을 무시)의 정반대 방향으로,
 * 방어측이 원래 없던 면역을 스스로 얻는다. moveContext.ts에서 typeEffectiveness를 무조건 0으로
 * 덮어쓰고, battleSimulator.ts가 명중한 시점(카테고리 무관 — 상태이상 기술도 흡수한다)에 아래
 * 효과를 적용한다. 정전기 등 hitTrigger와 달리 damage > 0을 요구하지 않는다(애초에 데미지가 없다).
 */
export interface AbilityTypeAbsorb {
  /** 이 타입의 기술을 완전히 무효화한다 */
  type: PokemonType;
  /** 무효화한 그 즉시 자신의 랭크를 이 목록만큼 바꾼다(피뢰침: 특공 +1) */
  selfStatChanges?: { stat: BattleStatKey; delta: number }[];
  /**
   * 타오르는불꽃처럼, 무효화한 이후로 배틀이 끝날 때까지(1v1이라 교체로 초기화될 일이 없음) 자신이
   * 쓰는 이 타입(=absorbsType.type과 동일) 기술의 위력을 이 배수로 올린다. 실제 활성화 여부는
   * BattleFighterState.ownMoveTypeBoosts 런타임 플래그로 추적한다 — 정적 데이터만 다루는
   * AbilityModifier로는 "배틀 중 발동한 적 있는지"를 표현할 수 없어 별도 필드로 분리했다.
   */
  boostsOwnMoveTypeMultiplier?: number;
}

export interface Ability {
  id: string;
  name: string;
  description: string;
  /** 결정력/내구력 계산에 자동으로 반영할 수 있는 배율들. 없으면 생략 */
  modifiers?: AbilityModifier[];
  /** 자속보정 배율 자체를 바꾸는 특성 전용 (적응력: 1.5 → 2.0) */
  stabOverride?: number;
  /** 가뭄/잔비/모래날림처럼 등장하면 날씨를 바꾸는 특성만 채운다 */
  setsWeather?: WeatherKind;
  /**
   * 배짱처럼 "이 타입 목록에 있는 자신의 기술은 상대의 타입 면역(0배)을 무시하고 등배로 맞힌다"는
   * 특성만 채운다(배짱=[노말, 격투] → 고스트타입 상대에게도 명중). 면역만 없앨 뿐 반감/2배 관계는
   * 그대로 존중한다 — moveContext.ts에서 typeEffectiveness가 정확히 0일 때만 1로 덮어쓴다.
   */
  bypassesImmunityForTypes?: PokemonType[];
  /** 방어측으로 피격당했을 때 발동하는 특성만 채운다(정전기·불꽃몸·까칠한피부·깨어진갑옷·저주받은바디) */
  hitTrigger?: AbilityHitTrigger;
  /** 특정 타입 기술을 완전히 무효화하는 특성만 채운다(타오르는불꽃·피뢰침) */
  absorbsType?: AbilityTypeAbsorb;
}
