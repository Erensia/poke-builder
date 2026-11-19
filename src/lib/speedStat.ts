import type { Ability } from "../types/ability";
import type { Item } from "../types/item";
import type { StatusCondition } from "../types/status";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import { computeSpeedStat } from "./battlePower";
import { getItemSpeedMultiplier } from "./itemEffects";
import { speedStatusParts } from "./statusConditions";

/** computeSpeedWithEffects의 입력 — 호출하는 쪽(엔진 파이터·매치업 슬롯)이 각자 값을 모아 넘긴다 */
export interface SpeedEffectInput {
  /** 실능 스피드(랭크 미반영) */
  realSpe: number;
  /** 스피드 랭크(−6~+6) */
  stage: number;
  /** 지금 유효한 특성(억제·위액이면 undefined) */
  ability: Ability | undefined;
  /** **유효한** 도구(서투름·매직룸이면 undefined) — 구애스카프·검은철구 판정용 */
  item: Item | undefined;
  /** 주 상태이상(마비·속보 판정) */
  status: StatusCondition | null;
  /** **날씨부정이 이미 반영된** 유효 날씨 */
  weather: WeatherKind | undefined;
  field: FieldKind | undefined;
  /**
   * 곡예 활성 — 호출 쪽이 계산한다(곡예 상태 ∧ **실제 보유 도구 없음** ∧ 특성 유효). 곡예는 Showdown에서 `!pokemon.item`(보유 여부)이라
   * 서투름·매직룸 반영값인 `item`과 구분해야 한다(8.3 D3-fix-12 검수 §2-2).
   */
  unburdenActive: boolean;
  /** 이 포켓몬이 속한 편에 순풍이 불고 있는가 */
  tailwind: boolean;
}

/**
 * 스피드 효과 전체를 반영한 실효 스피드(최종 정수) — Showdown `getStat('spe')`(8.3 D3-fix-11·12).
 * 랭크 floor → 구애스카프·검은철구·날씨 특성·서핑테일·곡예·순풍·속보를 4096 체인 → 마비는 체인 뒤 floor.
 * 엔진(computeTurnOrderSpeed)·매치업(evaluateSpeedMatchup·가변 위력 입력)이 이 함수 하나로 배율 목록을 조립한다.
 * 챔피언스 M-C에서 Past인 고대활성·쿼크차지·Slow Start·풀의서약·파워 계열·Quick Powder·우산·Embargo는 구현 범위 밖이다.
 */
export function computeSpeedWithEffects(i: SpeedEffectInput): number {
  const ability = i.ability;
  const weatherBoost = ability?.weatherSpeedMultiplier;
  const weatherMultiplier = weatherBoost && weatherBoost.weather === i.weather ? weatherBoost.multiplier : 1;
  // 서핑테일(ver.1.9 A5): 지정 필드면 배율 — 접지 조건 없음(Showdown `isTerrain`)
  const fieldBoost = ability?.fieldSpeedMultiplier;
  const fieldMultiplier = fieldBoost && fieldBoost.field === i.field ? fieldBoost.multiplier : 1;
  const status = speedStatusParts(i.status, ability?.speedMultiplierWhenStatused);
  return computeSpeedStat({
    baseSpe: i.realSpe,
    stage: i.stage,
    multipliers: [status.multiplier, fieldMultiplier, getItemSpeedMultiplier(i.item), weatherMultiplier, i.unburdenActive ? 2 : 1, i.tailwind ? 2 : 1],
    halvedByParalysis: status.halved,
  });
}
