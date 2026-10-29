import type { PowerConditionKey } from "../types/matchup";
import type { Move } from "../types/move";
import { useSlotSwapDnd } from "../hooks/useSlotSwapDnd";
import { getPokemon, getMove, getAbility } from "../lib/data";
import { getEffectiveForm, megaBadgeLabel } from "../lib/pokemonForm";
import { computeRealStats } from "../lib/statCalculator";
import { totalAbilityPoints } from "../lib/statCalculator";
import { TypeBadge } from "./TypeBadge";
import { PokemonAvatarWithItem } from "./PokemonAvatarWithItem";
import { MatchupStatRow, MatchupMetaRow, MatchupAssumeBasics, MatchupMoveSection, MatchupAssumeMove, MatchupBulkRow, type MatchupSlotCardProps } from "./MatchupSlotSections";
import "./MatchupSlotCard.css";

/**
 * ver.1.9 조건부 위력 가정 토글 — 기술의 2배 조건마다 하나(고른 기술에 해당하는 것만 보인다). 엔진은 실제 전투 이력으로 판정한다.
 */
const POWER_CONDITION_TOGGLES: { key: PowerConditionKey; label: string; relevant: (move: Move) => boolean }[] = [
  { key: "movesLastAssumed", label: "상대보다 늦게 행동 가정", relevant: (m) => m.conditionalDoublePower === "moves-after-target" },
  { key: "tookDamageAssumed", label: "이번 턴 상대 기술로 데미지를 입음 가정", relevant: (m) => m.conditionalDoublePower === "took-damage-this-turn" },
  { key: "moveFailedAssumed", label: "직전 턴 기술이 빗나감·실패 가정", relevant: (m) => m.conditionalDoublePower === "user-move-failed-last-turn" },
  { key: "statLoweredAssumed", label: "이번 턴 자신의 능력이 떨어짐 가정", relevant: (m) => m.conditionalDoublePower === "user-stat-lowered-this-turn" },
  { key: "targetDamagedAssumed", label: "이번 턴 상대가 이미 데미지를 입음 가정", relevant: (m) => m.conditionalDoublePower === "target-damaged-this-turn" },
  { key: "targetMinimizedAssumed", label: "상대가 작아지기를 사용 가정", relevant: (m) => !!m.bonusVsMinimize },
];

export function MatchupSlotCard(props: MatchupSlotCardProps) {
  const { role, onSwapDrop, swapRole, label, slot, onPickPokemon, onClearPokemon, hasSamples, onOpenSamplePicker, selectedMove, selectedMoves } = props;
  const { dropProps, dragProps, dragOverClass } = useSlotSwapDnd(swapRole ?? role, onSwapDrop);
  const pokemon = slot.pokemonId ? getPokemon(slot.pokemonId) : undefined;
  // ver.1.9 가정 토글 — 관련 기술·특성을 골랐을 때만 보인다
  const ability = slot.ability ? getAbility(slot.ability) : undefined;
  const relevantMoves = selectedMoves ?? (selectedMove ? [selectedMove] : []);
  const powerConditions = POWER_CONDITION_TOGGLES.filter((t) => relevantMoves.some(t.relevant));
  const pinchRelevant = !!ability?.modifiers?.some((m) => m.condition?.attackerHpAtMostFraction !== undefined);
  const fullHpRelevant = !!ability?.modifiers?.some((m) => m.condition?.defenderHpIsFull === true);
  const hpPowerRelevant = relevantMoves.some((m) => !!m.reversalPower || !!m.userHpScaledPower);

  if (!pokemon) {
    return (
      <div className={`matchup-slot matchup-slot-empty${dragOverClass}`} {...dropProps}>
        <span className="matchup-slot-label">{label}</span>
        <button type="button" className="matchup-slot-empty-main" onClick={onPickPokemon}>
          <span className="matchup-slot-plus" aria-hidden="true">
            +
          </span>
          <span className="matchup-slot-empty-text">포켓몬 선택</span>
        </button>
        {hasSamples && (
          <button type="button" className="matchup-slot-sample-link tap-target" onClick={onOpenSamplePicker}>
            저장된 샘플에서 불러오기
          </button>
        )}
      </div>
    );
  }

  const form = getEffectiveForm(pokemon, slot);
  const realStats = computeRealStats(form.baseStats, slot.points, slot.nature);
  const move = slot.moveId ? getMove(slot.moveId) : undefined;
  const usedPoints = totalAbilityPoints(slot.points);
  const activeStageCount = Object.values(slot.stages).filter((v) => v !== 0).length;
  const derived = { pokemon, form, realStats, move, usedPoints, activeStageCount, ability, relevantMoves, powerConditions, pinchRelevant, fullHpRelevant, hpPowerRelevant };

  return (
    <div className={`matchup-slot matchup-slot-filled${dragOverClass}`} {...dropProps}>
      <span className="matchup-slot-label">{label}</span>
      <button type="button" className="matchup-slot-clear" onClick={onClearPokemon} aria-label="슬롯 비우기">
        ✕
      </button>

      <button
        type="button"
        className="matchup-slot-main"
        onClick={onPickPokemon}
        {...dragProps}
      >
        <PokemonAvatarWithItem
          pokemon={pokemon}
          size={42}
          radius={11}
          gradientTypes={form.types}
          avatarClassName="matchup-slot-avatar"
          itemId={slot.item}
          form={{
            // 매치업 슬롯엔 성별 선택이 없다 — genderedSprite 종은 기본(수컷) 스프라이트.
            cosmeticForm: slot.cosmeticForm,
            formVariant: slot.formVariant,
            sizeForm: slot.sizeForm,
            activeMegaForm: slot.activeMegaForm,
            item: slot.item,
          }}
        />
        <span className="matchup-slot-info">
          <span className="matchup-slot-name">
            {pokemon.name}
            {form.mega && <span className="matchup-slot-mega-tag">{megaBadgeLabel(form.mega)}</span>}
          </span>
          <span className="matchup-slot-types">
            {form.types.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
          </span>
        </span>
      </button>

      <MatchupStatRow {...props} {...derived} />
      <MatchupMetaRow {...props} {...derived} />
      <MatchupAssumeBasics {...props} {...derived} />
      <MatchupMoveSection {...props} {...derived} />
      <MatchupAssumeMove {...props} {...derived} />
      <MatchupBulkRow {...props} {...derived} />
    </div>
  );
}
