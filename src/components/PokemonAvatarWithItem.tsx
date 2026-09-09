import type { Pokemon } from "../types/pokemon";
import type { PokemonType } from "../types/pokemon-type";
import type { SpriteFormOptions } from "../lib/sprites";
import { PokemonAvatar } from "./PokemonAvatar";
import { ItemIcon } from "./ItemIcon";
import "./PokemonAvatarWithItem.css";

interface PokemonAvatarWithItemProps {
  pokemon: Pokemon;
  /** 폼(성별·모습·크기·메가) 옵션 — 스프라이트 파일 선택에 쓴다. */
  form?: SpriteFormOptions;
  /** 아바타 정사각 한 변(px). */
  size: number;
  /** 아바타 모서리. 숫자(px) 또는 "circle". */
  radius?: number | "circle";
  /** 아바타 그라디언트에 쓸 타입(폼 반영). */
  gradientTypes?: PokemonType[];
  /** PokemonAvatar에 그대로 넘길 클래스(카드별 아바타 클래스 유지용). */
  avatarClassName?: string;
  /** 장착 도구 id. 있고 스프라이트가 있으면 아바타 우하단에 겹치는 뱃지로 표시(§1-2). */
  itemId?: string | null;
  /** 래퍼 span 클래스. */
  className?: string;
}

/**
 * PokemonAvatar + (도구 장착 시) 우하단 겹침 뱃지(§1-2). 파티·매치업·배틀 셋업 슬롯 카드가
 * 공유한다. 도구 스프라이트가 없으면 뱃지 없이 아바타만 나온다.
 */
export function PokemonAvatarWithItem({
  pokemon,
  form,
  size,
  radius,
  gradientTypes,
  avatarClassName,
  itemId,
  className,
}: PokemonAvatarWithItemProps) {
  const badgeSize = Math.max(14, Math.round(size * 0.46));
  return (
    <span className={`avatar-with-item${className ? ` ${className}` : ""}`}>
      <PokemonAvatar
        pokemon={pokemon}
        form={form}
        size={size}
        radius={radius}
        gradientTypes={gradientTypes}
        className={avatarClassName}
      />
      {itemId && <ItemIcon itemId={itemId} size={badgeSize} className="avatar-with-item-badge" />}
    </span>
  );
}
