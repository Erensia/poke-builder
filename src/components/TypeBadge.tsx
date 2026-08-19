import type { PokemonType } from "../types/pokemon-type";
import { TYPE_COLORS } from "../lib/typeColors";
import "./TypeBadge.css";

export function TypeBadge({ type }: { type: PokemonType }) {
  return (
    <span className="type-badge" style={{ background: TYPE_COLORS[type] }}>
      {type}
    </span>
  );
}
