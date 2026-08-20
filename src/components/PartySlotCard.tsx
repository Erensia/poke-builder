import type { PartySlot } from "../types/party";
import { getPokemon, getMove, getAbility, getItem, getNature } from "../lib/data";
import { getEffectiveForm } from "../lib/pokemonForm";
import { computeRealStats, totalAbilityPoints } from "../lib/statCalculator";
import { computeBulkPower } from "../lib/battlePower";
import { TypeBadge } from "./TypeBadge";
import { TYPE_COLORS } from "../lib/typeColors";
import "./PartySlotCard.css";

interface PartySlotCardProps {
  index: number;
  slot: PartySlot | null;
  onPickPokemon: () => void;
  onClearPokemon: () => void;
  onPickMove: (moveIndex: 0 | 1 | 2 | 3) => void;
  onPickAbility: () => void;
  onPickItem: () => void;
  onPickNature: () => void;
  onPickPoints: () => void;
}

export function PartySlotCard({
  index,
  slot,
  onPickPokemon,
  onClearPokemon,
  onPickMove,
  onPickAbility,
  onPickItem,
  onPickNature,
  onPickPoints,
}: PartySlotCardProps) {
  const pokemon = slot ? getPokemon(slot.pokemonId) : undefined;

  if (!pokemon) {
    return (
      <button type="button" className="party-slot party-slot-empty" onClick={onPickPokemon}>
        <span className="party-slot-num">{index + 1}</span>
        <span className="party-slot-plus" aria-hidden="true">
          +
        </span>
        <span className="party-slot-empty-label">포켓몬 선택</span>
      </button>
    );
  }

  const form = getEffectiveForm(pokemon, slot!);
  const avatarGradient = `linear-gradient(135deg, ${TYPE_COLORS[form.types[0]]}, ${
    TYPE_COLORS[form.types[1] ?? form.types[0]]
  })`;
  // 파티 빌더는 랭크 개념이 없으니 0랭크 기준 내구력만 참고용으로 보여준다
  const realStats = computeRealStats(form.baseStats, slot!.points, slot!.nature);
  const bulkPhysical = computeBulkPower(realStats, "physical");
  const bulkSpecial = computeBulkPower(realStats, "special");

  return (
    <div className="party-slot party-slot-filled">
      <span className="party-slot-num">{index + 1}</span>
      <button type="button" className="party-slot-clear" onClick={onClearPokemon} aria-label="슬롯 비우기">
        ✕
      </button>

      <button type="button" className="party-slot-main" onClick={onPickPokemon}>
        <span className="party-slot-avatar" style={{ background: avatarGradient }}>
          {pokemon.name.at(0)}
        </span>
        <span className="party-slot-info">
          <span className="party-slot-name">
            {pokemon.name}
            {form.mega && <span className="party-slot-mega-tag">메가</span>}
          </span>
          <span className="party-slot-types">
            {form.types.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
          </span>
        </span>
      </button>

      <div className="party-slot-moves">
        {slot!.moves.map((moveId, i) => {
          const move = moveId ? getMove(moveId) : undefined;
          const moveColor = move?.type ? TYPE_COLORS[move.type] : undefined;
          return (
            <button
              key={i}
              type="button"
              className={`party-move-pip${move ? " has-type" : " is-empty"}`}
              style={moveColor ? { background: moveColor } : undefined}
              onClick={() => onPickMove(i as 0 | 1 | 2 | 3)}
            >
              {move ? move.name : "＋"}
            </button>
          );
        })}
      </div>

      <div className="party-slot-meta">
        <button type="button" className="party-meta-pip" onClick={onPickAbility}>
          <span className="party-meta-label">특성</span>
          <span className="party-meta-value">
            {slot!.ability ? getAbility(slot!.ability)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="party-meta-pip" onClick={onPickItem}>
          <span className="party-meta-label">도구</span>
          <span className="party-meta-value">
            {slot!.item ? getItem(slot!.item)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="party-meta-pip" onClick={onPickNature}>
          <span className="party-meta-label">성격</span>
          <span className="party-meta-value">
            {slot!.nature ? getNature(slot!.nature)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="party-meta-pip" onClick={onPickPoints}>
          <span className="party-meta-label">포인트</span>
          <span className="party-meta-value">{totalAbilityPoints(slot!.points)} / 66</span>
        </button>
      </div>

      <div className="party-slot-bulk">
        <div className="party-bulk-item">
          <span className="party-bulk-label">물리내구</span>
          <span className="party-bulk-value">{Math.round(bulkPhysical).toLocaleString()}</span>
        </div>
        <div className="party-bulk-item">
          <span className="party-bulk-label">특수내구</span>
          <span className="party-bulk-value">{Math.round(bulkSpecial).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
