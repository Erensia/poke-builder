import type { PokemonType } from "../types/pokemon-type";

/** 타입 배지에 쓰는 색상. 라이트/다크 공용으로 쓸 수 있게 채도를 중간값으로 맞췄다. */
export const TYPE_COLORS: Record<PokemonType, string> = {
  노말: "#949495",
  불꽃: "#e56c3e",
  물: "#5185c5",
  풀: "#66a945",
  전기: "#fbb917",
  얼음: "#6dc8eb",
  격투: "#e09c40",
  독: "#735198",
  땅: "#9c7743",
  비행: "#a2c3e7",
  에스퍼: "#dd6b7b",
  벌레: "#9fa244",
  바위: "#bfb889",
  고스트: "#684870",
  드래곤: "#535ca8",
  악: "#4c4948",
  강철: "#69a9c7",
  페어리: "#dab4d4",
};

/** TYPE_COLORS의 hex 값을 낮은 불투명도로 바꿔서 배경 틴트 등에 쓸 수 있게 한다 */
export function typeColorRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
