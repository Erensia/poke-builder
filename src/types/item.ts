import type { PokemonType } from "./pokemon-type";
import type { MoveCategory } from "./move";

export type ItemCategory = "mega-stone" | "held-item";

export interface Item {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  /** 실크스카프 등 타입 강화 도구 18종 — 이 타입 기술의 위력 배율 */
  moveTypeMultiplier?: { type: PokemonType; multiplier: number };
  /** 힘의머리띠(물리)·박식안경(특수) — 기술 분류 한정 위력 배율 */
  moveCategoryMultiplier?: { category: MoveCategory; multiplier: number };
  /** 생명의구슬처럼 타입·분류 무관하게 걸리는 전체 위력 배율 */
  powerMultiplier?: number;
  /** 생명의구슬: 공격이 명중해 데미지를 준 뒤 최대 HP의 이 비율만큼 자신도 반동 데미지 */
  selfRecoilFractionOfMaxHp?: number;
  /** 달인의띠: 상대 타입 상성이 2배 이상("효과가 굉장했다")일 때 걸리는 위력 배율 */
  superEffectiveMultiplier?: number;
  /** 메트로놈: 같은 기술을 연속 사용할 때마다 perStreak만큼 배율이 오르고 max에서 멈춘다 */
  consecutiveSameMoveMultiplier?: { perStreak: number; max: number };
  /**
   * 나무열매 18종 — 자신이 이 타입 기술에 "효과가 굉장하게"(2배 이상) 맞으면 그 데미지를
   * 반감시키고 소모된다(대전 중 1회용). 방어측 아이템이라 offense가 아니라 defense multiplier로 적용.
   */
  resistsSuperEffectiveType?: PokemonType;
  /** 광각렌즈: 자신이 사용하는 기술의 명중률에 항상 곱하는 배율(1.1) */
  accuracyMultiplier?: number;
  /** 반짝가루: 상대가 자신에게 사용하는 기술의 명중률에 곱하는 배율(0.9) — 방어측 아이템 */
  opponentAccuracyMultiplier?: number;
  /** 포커스렌즈: 상대보다 행동 순서가 늦게 움직인 턴에 한해 자신이 사용하는 기술의 명중률에 곱하는 배율(1.2) */
  accuracyMultiplierWhenMovingSecond?: number;
}
