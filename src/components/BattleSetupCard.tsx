import type { PartySlot } from "../types/party";
import { getPokemon, getMove, getAbility, getItem, getNature } from "../lib/data";
import { getEffectiveForm, getEffectiveAbilityId, megaBadgeLabel } from "../lib/pokemonForm";
import { computeRealStats, totalAbilityPoints } from "../lib/statCalculator";
import { computeBulkPower } from "../lib/battlePower";
import { TypeBadge } from "./TypeBadge";
import { TYPE_COLORS } from "../lib/typeColors";
import "./PartySlotCard.css";

interface BattleSetupCardProps {
  label: string;
  slot: PartySlot | null;
  onPickPokemon: () => void;
  onClearPokemon: () => void;
  onPickMove: (moveIndex: 0 | 1 | 2 | 3) => void;
  onPickAbility: () => void;
  onPickItem: () => void;
  onPickNature: () => void;
  onPickPoints: () => void;
}

/**
 * 대전 로그 화면의 셋업 카드. PartySlotCard와 거의 같은 구조(포켓몬 + 기술 4개 + 특성/도구/성격/포인트)라
 * 같은 CSS(PartySlotCard.css)를 그대로 재사용한다 — 인덱스 번호 대신 "내 포켓몬"/"상대 포켓몬" 라벨을 쓰는 것만 다르다.
 */
export function BattleSetupCard({
  label,
  slot,
  onPickPokemon,
  onClearPokemon,
  onPickMove,
  onPickAbility,
  onPickItem,
  onPickNature,
  onPickPoints,
}: BattleSetupCardProps) {
  const pokemon = slot ? getPokemon(slot.pokemonId) : undefined;

  if (!pokemon) {
    return (
      <button type="button" className="party-slot party-slot-empty" onClick={onPickPokemon}>
        <span className="party-slot-num">{label}</span>
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
  const realStats = computeRealStats(form.baseStats, slot!.points, slot!.nature);
  const bulkPhysical = computeBulkPower(realStats, "physical");
  const bulkSpecial = computeBulkPower(realStats, "special");

  return (
    <div className="party-slot party-slot-filled">
      <span className="party-slot-num">{label}</span>
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
            {form.mega && <span className="party-slot-mega-tag">{megaBadgeLabel(form.mega)}</span>}
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
            {(() => {
              const effectiveAbilityId = getEffectiveAbilityId(form, slot!.ability);
              return effectiveAbilityId ? getAbility(effectiveAbilityId)?.name : "미지정";
            })()}
          </span>
        </button>
        <button type="button" className="party-meta-pip" onClick={onPickItem}>
          <span className="party-meta-label">도구</span>
          <span className="party-meta-value">{slot!.item ? getItem(slot!.item)?.name : "미지정"}</span>
        </button>
        <button type="button" className="party-meta-pip" onClick={onPickNature}>
          <span className="party-meta-label">성격</span>
          <span className="party-meta-value">{slot!.nature ? getNature(slot!.nature)?.name : "미지정"}</span>
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
