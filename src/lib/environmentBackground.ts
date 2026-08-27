import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import { TYPE_COLORS, typeColorRgba } from "./typeColors";
import { WEATHER_ACCENT_TYPE } from "./weatherEffects";
import { FIELD_DISPLAY_TYPE } from "./fieldEffects";

/**
 * 날씨/필드가 적용 중인지 배경색으로 알 수 있게 하는 틴트. 날씨는 강화하는 타입 색(비=물,
 * 모래바람=바위, 눈=얼음, 쾌청=불꽃), 필드는 필드 자신의 타입 색(그래스=풀 등)을 낮은 불투명도로 섞는다.
 * 둘 다 있으면 좌우 그라데이션, 하나만 있으면 단색 틴트, 둘 다 없으면 undefined(기본 투명 배경).
 * 대전 로그 페이지(battle-board)와 매치업 페이지(matchup-board)가 공유한다.
 */
export function environmentTintBackground(
  weather: WeatherKind | null | undefined,
  field: FieldKind | null | undefined,
): string | undefined {
  const weatherColor = weather ? TYPE_COLORS[WEATHER_ACCENT_TYPE[weather]] : undefined;
  const fieldColor = field ? TYPE_COLORS[FIELD_DISPLAY_TYPE[field]] : undefined;

  if (weatherColor && fieldColor) {
    return `linear-gradient(135deg, ${typeColorRgba(weatherColor, 0.16)}, ${typeColorRgba(fieldColor, 0.16)})`;
  }
  if (weatherColor) return typeColorRgba(weatherColor, 0.14);
  if (fieldColor) return typeColorRgba(fieldColor, 0.14);
  return undefined;
}
