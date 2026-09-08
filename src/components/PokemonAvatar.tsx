import { useState } from "react";
import type { Pokemon } from "../types/pokemon";
import type { PokemonType } from "../types/pokemon-type";
import { TYPE_COLORS } from "../lib/typeColors";
import { resolvePokemonSpriteUrl, type SpriteFormOptions } from "../lib/sprites";
import "./PokemonAvatar.css";

interface PokemonAvatarProps {
  pokemon: Pokemon;
  /** 폼(성별·모습·크기·메가) 옵션 — 스프라이트 파일 선택에 쓴다. 도감처럼 폼이 없으면 생략. */
  form?: SpriteFormOptions;
  /** 정사각 한 변(px). 26~64 범위를 상정. */
  size: number;
  /** 모서리. 숫자(px) 또는 "circle". 기본 10px. */
  radius?: number | "circle";
  /** 그라디언트에 쓸 타입(폼 반영). 생략하면 pokemon.types. */
  gradientTypes?: PokemonType[];
  className?: string;
}

/**
 * 포켓몬 아바타 — `public/sprites/` 스프라이트(있으면) + 항상 뒤에 깔리는 타입색 그라디언트.
 * 스프라이트가 없거나 로드 실패하면 이름 첫 글자로 폴백한다(기존 이니셜 뱃지와 동일한 모양).
 * 파티/배틀셋업/매치업 슬롯 카드와 도감 리스트·상세 5곳이 공유한다(백로그 §1).
 */
export function PokemonAvatar({
  pokemon,
  form,
  size,
  radius = 10,
  gradientTypes,
  className,
}: PokemonAvatarProps) {
  const url = resolvePokemonSpriteUrl(pokemon, form ?? {});
  // 실패한 URL 자체를 기억한다 — 카드에 다른 포켓몬/폼이 들어와 url 이 바뀌면 자동으로 다시 시도.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const types = gradientTypes ?? pokemon.types;
  const gradient = `linear-gradient(135deg, ${TYPE_COLORS[types[0]]}, ${
    TYPE_COLORS[types[1] ?? types[0]]
  })`;
  const showImg = !!url && failedUrl !== url;

  return (
    <span
      className={`pokemon-avatar${className ? ` ${className}` : ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius === "circle" ? "50%" : radius,
        background: gradient,
        fontSize: Math.round(size * 0.42),
      }}
      aria-hidden="true"
    >
      {showImg ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailedUrl(url)}
        />
      ) : (
        pokemon.name.at(0)
      )}
    </span>
  );
}
