import type { MatchupSlot } from "../types/matchup";
import { getPokemon, getMove, getAbility, getItem, getNature } from "../lib/data";
import { getEffectiveForm } from "../lib/pokemonForm";
import { computeRealStats } from "../lib/statCalculator";
import { totalAbilityPoints } from "../lib/statCalculator";
import { TypeBadge } from "./TypeBadge";
import { STAT_ORDER, STAT_LABELS } from "../lib/statLabels";
import { TYPE_COLORS } from "../lib/typeColors";
import "./MatchupSlotCard.css";

interface MatchupSlotCardProps {
  role: "attacker" | "defender";
  label: string;
  slot: MatchupSlot;
  offensePower?: number | null;
  rawOffensePower?: number | null;
  /** 다단히트 기술(트리플악셀 등)일 때 선택된 적중 타수 */
  multiHitCount?: number;
  onSetMultiHitCount?: (count: number) => void;
  bulkPhysical?: number;
  bulkSpecial?: number;
  onPickPokemon: () => void;
  onClearPokemon: () => void;
  onPickAbility: () => void;
  onPickItem: () => void;
  onPickNature: () => void;
  onPickPoints: () => void;
  onPickStages: () => void;
  onPickMove?: () => void;
}

export function MatchupSlotCard({
  role,
  label,
  slot,
  offensePower,
  rawOffensePower,
  multiHitCount,
  onSetMultiHitCount,
  bulkPhysical,
  bulkSpecial,
  onPickPokemon,
  onClearPokemon,
  onPickAbility,
  onPickItem,
  onPickNature,
  onPickPoints,
  onPickStages,
  onPickMove,
}: MatchupSlotCardProps) {
  const pokemon = slot.pokemonId ? getPokemon(slot.pokemonId) : undefined;

  if (!pokemon) {
    return (
      <button type="button" className="matchup-slot matchup-slot-empty" onClick={onPickPokemon}>
        <span className="matchup-slot-label">{label}</span>
        <span className="matchup-slot-plus" aria-hidden="true">
          +
        </span>
        <span className="matchup-slot-empty-text">포켓몬 선택</span>
      </button>
    );
  }

  const form = getEffectiveForm(pokemon, slot);
  const avatarGradient = `linear-gradient(135deg, ${TYPE_COLORS[form.types[0]]}, ${
    TYPE_COLORS[form.types[1] ?? form.types[0]]
  })`;
  const realStats = computeRealStats(form.baseStats, slot.points, slot.nature);
  const move = slot.moveId ? getMove(slot.moveId) : undefined;
  const usedPoints = totalAbilityPoints(slot.points);
  const activeStageCount = Object.values(slot.stages).filter((v) => v !== 0).length;

  return (
    <div className="matchup-slot matchup-slot-filled">
      <span className="matchup-slot-label">{label}</span>
      <button type="button" className="matchup-slot-clear" onClick={onClearPokemon} aria-label="슬롯 비우기">
        ✕
      </button>

      <button type="button" className="matchup-slot-main" onClick={onPickPokemon}>
        <span className="matchup-slot-avatar" style={{ background: avatarGradient }}>
          {pokemon.name.at(0)}
        </span>
        <span className="matchup-slot-info">
          <span className="matchup-slot-name">
            {pokemon.name}
            {form.mega && <span className="matchup-slot-mega-tag">메가</span>}
          </span>
          <span className="matchup-slot-types">
            {form.types.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
          </span>
        </span>
      </button>

      <div className="matchup-stat-row">
        {STAT_ORDER.map((stat) => (
          <div className="matchup-stat-chip" key={stat}>
            <span className="matchup-stat-label">{STAT_LABELS[stat]}</span>
            <span className="matchup-stat-value">{realStats[stat]}</span>
          </div>
        ))}
      </div>

      <div className="matchup-meta-row">
        <button type="button" className="matchup-meta-pip" onClick={onPickAbility}>
          <span className="matchup-meta-label">특성</span>
          <span className="matchup-meta-value">
            {slot.ability ? getAbility(slot.ability)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="matchup-meta-pip" onClick={onPickItem}>
          <span className="matchup-meta-label">도구</span>
          <span className="matchup-meta-value">
            {slot.item ? getItem(slot.item)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="matchup-meta-pip" onClick={onPickNature}>
          <span className="matchup-meta-label">성격</span>
          <span className="matchup-meta-value">
            {slot.nature ? getNature(slot.nature)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="matchup-meta-pip" onClick={onPickPoints}>
          <span className="matchup-meta-label">포인트</span>
          <span className="matchup-meta-value">{usedPoints} / 66</span>
        </button>
        <button type="button" className="matchup-meta-pip" onClick={onPickStages}>
          <span className="matchup-meta-label">랭크</span>
          <span className="matchup-meta-value">
            {activeStageCount > 0 ? `${activeStageCount}개 변경` : "0랭크"}
          </span>
        </button>
      </div>

      {role === "attacker" && (
        <div className="matchup-move-section">
          <button
            type="button"
            className={`matchup-move-pip${move ? " has-type" : ""}`}
            style={move?.type ? { background: TYPE_COLORS[move.type] } : undefined}
            onClick={onPickMove}
          >
            {move ? move.name : "기술 선택"}
          </button>
          {move?.multiHitPowers && onSetMultiHitCount && (
            <div className="matchup-hitcount-row">
              {move.multiHitPowers.map((_, i) => {
                const hits = i + 1;
                return (
                  <button
                    key={hits}
                    type="button"
                    className={`matchup-hitcount-pip${multiHitCount === hits ? " is-active" : ""}`}
                    onClick={() => onSetMultiHitCount(hits)}
                  >
                    ×{hits}
                  </button>
                );
              })}
            </div>
          )}
          {move && rawOffensePower !== undefined && rawOffensePower !== null && (
            <div className="matchup-power-readout">
              결정력 <span className="matchup-power-caveat">(상대 타입 반영)</span>{" "}
              <strong>{Math.round(rawOffensePower).toLocaleString()}</strong>{" "}
              {offensePower !== undefined && offensePower !== null && (
                <span className="matchup-power-caveat">
                  ({Math.round(offensePower).toLocaleString()})
                </span>
              )}
            </div>
          )}
          {move && (rawOffensePower === null || rawOffensePower === undefined) && (
            <div className="matchup-power-readout is-muted">변화기는 결정력이 없어요</div>
          )}
        </div>
      )}

      {role === "defender" && bulkPhysical !== undefined && bulkSpecial !== undefined && (
        <div className="matchup-move-section">
          <div className="matchup-power-readout">
            물리내구 <strong>{Math.round(bulkPhysical).toLocaleString()}</strong>
          </div>
          <div className="matchup-power-readout">
            특수내구 <strong>{Math.round(bulkSpecial).toLocaleString()}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
