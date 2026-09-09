import type { PokemonType } from "../types/pokemon-type";
import "./TypeBadge.css";

/**
 * 타입 표기(§1-6). `public/sprites/타입/{타입명}.svg`(색이 들어간 원형 아이콘)를 그대로 <img>로
 * 렌더한다 — 아이콘만, 텍스트는 접근성용으로 alt/title에만 남긴다. 스프라이트 18종이 항상
 * 존재하므로 폴백은 두지 않는다.
 */
export function TypeBadge({ type }: { type: PokemonType }) {
  return (
    <img
      className="type-badge"
      src={`/sprites/타입/${type}.svg`}
      alt={type}
      title={type}
      loading="lazy"
      draggable={false}
    />
  );
}
