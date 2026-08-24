import type { PokemonType } from "../types/pokemon-type";
import type { WeatherKind } from "../types/weather";

/**
 * UI에서 날씨를 시각적으로 표시할 때 쓰는 "이 날씨가 강화하는 타입". TYPE_COLORS와 조합해
 * 배틀 보드 배경색을 그 타입 색으로 물들이는 데 쓴다(비=물색, 모래바람=바위색, 눈=얼음색, 쾌청=불꽃색).
 */
export const WEATHER_ACCENT_TYPE: Record<WeatherKind, PokemonType> = {
  비: "물",
  모래바람: "바위",
  눈: "얼음",
  쾌청: "불꽃",
};

/**
 * 날씨가 기술 데미지에 주는 기본 배율. 본가 기준 그대로 적용한다(챔피언스도 동일하다고 가정 —
 * Phase 3 문서 3절 "확인 필요" 항목, 실측으로 다르다고 확인되면 이 표만 고치면 된다).
 * 비=물타입 1.5배/불타입 0.5배, 쾌청=불타입 1.5배/물타입 0.5배. 모래바람/눈은 데미지 배율 없음
 * (모래바람의 바위 특방 1.5배는 방어 쪽 계산이라 여기서 다루지 않는다).
 */
export function getWeatherDamageMultiplier(
  weather: WeatherKind | undefined,
  moveType: PokemonType | null,
): number {
  if (!weather || !moveType) return 1;
  if (weather === "비") {
    if (moveType === "물") return 1.5;
    if (moveType === "불꽃") return 0.5;
  }
  if (weather === "쾌청") {
    if (moveType === "불꽃") return 1.5;
    if (moveType === "물") return 0.5;
  }
  return 1;
}

/**
 * 광합성·달빛(Move.healsWeatherDependent) 전용 회복 비율. 본가 공식 그대로: 쾌청 2/3,
 * 날씨 없음 1/2, 그 외 날씨(비/모래바람/눈)는 1/4 — 전부 최대 HP 기준.
 */
export function computeWeatherHealFraction(weather: WeatherKind | undefined): number {
  if (weather === "쾌청") return 2 / 3;
  if (!weather) return 1 / 2;
  return 1 / 4;
}
