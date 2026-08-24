import type { PokemonType } from "./pokemon-type";
import type { MoveClassification } from "./move";
import type { WeatherKind } from "./weather";

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
}

export interface AbilityModifier {
  scope: "offense" | "defense";
  /** 조건을 만족하면 곱해지는 배율 */
  multiplier: number;
  condition?: AbilityModifierCondition;
  /** offense 전용. 조건을 만족하면 기술의 실제 타입을 이걸로 바꿔서 자속/상성을 계산 (페어리스킨) */
  overrideMoveType?: PokemonType;
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
}
