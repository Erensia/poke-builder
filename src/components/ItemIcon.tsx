import { resolveItemSpriteUrl } from "../lib/sprites";
import "./ItemIcon.css";

interface ItemIconProps {
  /** 도구 id(= 도구명). */
  itemId: string;
  /** 정사각 한 변(px). 기본 16. */
  size?: number;
  className?: string;
}

/**
 * 지닌 도구/메가스톤 아이콘(§1-2). 매니페스트에 스프라이트가 없으면 아무것도 렌더하지 않는다
 * (폴백 아이콘 없음). 슬롯 카드에서 <PokemonAvatar> 위에 겹치는 뱃지로 쓰인다.
 */
export function ItemIcon({ itemId, size = 16, className }: ItemIconProps) {
  const url = resolveItemSpriteUrl(itemId);
  if (!url) return null;
  return (
    <img
      className={`item-icon${className ? ` ${className}` : ""}`}
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
    />
  );
}
