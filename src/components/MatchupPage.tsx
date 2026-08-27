import { useMemo, useState } from "react";
import { MatchupSlotCard } from "./MatchupSlotCard";
import { VerdictBadge } from "./VerdictBadge";
import { WeatherPicker } from "./WeatherPicker";
import { PokemonPickerModal } from "./PokemonPickerModal";
import { MovePickerModal } from "./MovePickerModal";
import { AbilityPickerModal } from "./AbilityPickerModal";
import { ItemPickerModal } from "./ItemPickerModal";
import { NaturePickerModal } from "./NaturePickerModal";
import { PointsEditorModal } from "./PointsEditorModal";
import { StageEditorModal } from "./StageEditorModal";
import { SlotPresetsModal } from "./SlotPresetsModal";
import { useMatchup } from "../hooks/useMatchup";
import { useSlotPresets } from "../hooks/useSlotPresets";
import { getPokemon, getMove } from "../lib/data";
import { getEffectiveForm } from "../lib/pokemonForm";
import { computeRealStats } from "../lib/statCalculator";
import { computeBulkPower } from "../lib/battlePower";
import { evaluateSlotMatchup, evaluateSpeedMatchup } from "../lib/matchupEvaluator";
import "./MatchupPage.css";

type Side = "attacker" | "defender";
type PickerState =
  | { kind: "pokemon"; side: Side }
  | { kind: "ability"; side: Side }
  | { kind: "item"; side: Side }
  | { kind: "nature"; side: Side }
  | { kind: "points"; side: Side }
  | { kind: "stages"; side: Side }
  | { kind: "move" }
  | { kind: "slotPresets"; side: Side }
  | null;

export function MatchupPage() {
  const { attacker, defender, weather, setWeather } = useMatchup();
  const slotPresets = useSlotPresets();
  const [picker, setPicker] = useState<PickerState>(null);

  const sideOf = (side: Side) => (side === "attacker" ? attacker : defender);

  const attackerPokemon = attacker.slot.pokemonId ? getPokemon(attacker.slot.pokemonId) : undefined;
  const defenderPokemon = defender.slot.pokemonId ? getPokemon(defender.slot.pokemonId) : undefined;
  const attackerMove = attacker.slot.moveId ? getMove(attacker.slot.moveId) : undefined;

  // 방어측: 즉각 피드백용 물리/특수 기본 내구력 (기술/특성 보정 없이, 랭크만 반영)
  const baseBulk = useMemo(() => {
    if (!defenderPokemon) return null;
    const form = getEffectiveForm(defenderPokemon, defender.slot);
    const realStats = computeRealStats(form.baseStats, defender.slot.points, defender.slot.nature);
    const physical = computeBulkPower(realStats, "physical", { defenderStages: defender.slot.stages });
    const special = computeBulkPower(realStats, "special", { defenderStages: defender.slot.stages });
    return { physical, special };
  }, [defenderPokemon, defender.slot]);

  // Phase 6.5 §1 — "이전 턴 가정" 토글 반영. 도구 강탈 토글이 켜진 슬롯은 상대 도구를 장착한
  // 것으로, 상대 슬롯은 무도구로 계산한다(양쪽 다 켜졌으면 공격 슬롯 우선). 성묘 배율은 위력만 바꾼다.
  const { effAttackerSlot, effDefenderSlot, effMove } = useMemo(() => {
    const stealBy = attacker.slot.itemStolenFromOpponent
      ? "attacker"
      : defender.slot.itemStolenFromOpponent
        ? "defender"
        : null;
    return {
      effAttackerSlot:
        stealBy === "attacker"
          ? { ...attacker.slot, item: defender.slot.item }
          : stealBy === "defender"
            ? { ...attacker.slot, item: null }
            : attacker.slot,
      effDefenderSlot:
        stealBy === "defender"
          ? { ...defender.slot, item: attacker.slot.item }
          : stealBy === "attacker"
            ? { ...defender.slot, item: null }
            : defender.slot,
      effMove:
        attackerMove && attackerMove.id === "성묘" && attacker.slot.graveVisitFaintedAllies
          ? { ...attackerMove, power: 50 + 50 * attacker.slot.graveVisitFaintedAllies }
          : attackerMove,
    };
  }, [attacker.slot, defender.slot, attackerMove]);

  // 양쪽 다 준비되고 기술까지 골랐을 때: 정확한 결정력/내구력/판정
  const fullResult = useMemo(() => {
    if (!attackerPokemon || !defenderPokemon || !effMove) return null;
    return evaluateSlotMatchup(
      { ...effAttackerSlot, pokemonId: attackerPokemon.id },
      effMove,
      { ...effDefenderSlot, pokemonId: defenderPokemon.id },
      {
        weather: weather ?? undefined,
        multiHitCount: attacker.slot.multiHitCount,
        attackerStages: attacker.slot.stages,
        defenderStages: defender.slot.stages,
      },
    );
  }, [attackerPokemon, defenderPokemon, effAttackerSlot, effDefenderSlot, effMove, attacker.slot, defender.slot, weather]);

  // 스피드 비교(Phase 6.5 §2) — 포켓몬 둘 다 골랐으면 기술 선택과 무관하게 계산
  const speedResult = useMemo(() => {
    if (!attackerPokemon || !defenderPokemon) return null;
    return evaluateSpeedMatchup(
      { ...effAttackerSlot, pokemonId: attackerPokemon.id },
      { ...effDefenderSlot, pokemonId: defenderPokemon.id },
      {
        weather: weather ?? undefined,
        attackerUnburden: attacker.slot.unburdenAssumed,
        defenderUnburden: defender.slot.unburdenAssumed,
        attackerStages: attacker.slot.stages,
        defenderStages: defender.slot.stages,
      },
    );
  }, [attackerPokemon, defenderPokemon, effAttackerSlot, effDefenderSlot, attacker.slot, defender.slot, weather]);

  return (
    <section className="matchup-page">
      <header className="matchup-page-header">
        <div>
          <h2>결정력 &amp; 내구력</h2>
          <p>내 포켓몬과 상대 포켓몬을 고르고, 기술을 선택하면 타수 판정을 확인할 수 있습니다.</p>
        </div>
        <WeatherPicker weather={weather} onChange={setWeather} />
      </header>

      <div className="matchup-board">
        <MatchupSlotCard
          role="attacker"
          label="내 포켓몬"
          slot={attacker.slot}
          offensePower={fullResult?.offensePower}
          rawOffensePower={fullResult?.rawOffensePower}
          multiHitCount={attacker.slot.multiHitCount}
          onSetMultiHitCount={attacker.setMultiHitCount}
          onPickPokemon={() => setPicker({ kind: "pokemon", side: "attacker" })}
          onClearPokemon={attacker.clearPokemon}
          onPickAbility={() => setPicker({ kind: "ability", side: "attacker" })}
          onPickItem={() => setPicker({ kind: "item", side: "attacker" })}
          onPickNature={() => setPicker({ kind: "nature", side: "attacker" })}
          onPickPoints={() => setPicker({ kind: "points", side: "attacker" })}
          onPickStages={() => setPicker({ kind: "stages", side: "attacker" })}
          onPickMove={() => setPicker({ kind: "move" })}
          hasSamples={slotPresets.presets.length > 0}
          onOpenSamplePicker={() => setPicker({ kind: "slotPresets", side: "attacker" })}
          onToggleItemStolen={attacker.setItemStolen}
          onToggleUnburden={attacker.setUnburdenAssumed}
          moveIsGraveVisit={attackerMove?.id === "성묘"}
          onSetGraveVisit={attacker.setGraveVisitFaintedAllies}
        />

        <div className="matchup-verdict-row">
          <VerdictBadge verdict={fullResult?.verdict ?? null} />
        </div>

        <MatchupSlotCard
          role="defender"
          label="상대 포켓몬"
          slot={defender.slot}
          bulkPhysical={baseBulk?.physical}
          bulkSpecial={baseBulk?.special}
          onPickPokemon={() => setPicker({ kind: "pokemon", side: "defender" })}
          onClearPokemon={defender.clearPokemon}
          onPickAbility={() => setPicker({ kind: "ability", side: "defender" })}
          onPickItem={() => setPicker({ kind: "item", side: "defender" })}
          onPickNature={() => setPicker({ kind: "nature", side: "defender" })}
          onPickPoints={() => setPicker({ kind: "points", side: "defender" })}
          onPickStages={() => setPicker({ kind: "stages", side: "defender" })}
          hasSamples={slotPresets.presets.length > 0}
          onOpenSamplePicker={() => setPicker({ kind: "slotPresets", side: "defender" })}
          onToggleItemStolen={defender.setItemStolen}
          onToggleUnburden={defender.setUnburdenAssumed}
        />
      </div>

      {speedResult && (
        <div className="matchup-speed-row">
          <span className="matchup-speed-side">
            내 포켓몬 <strong>{Math.round(speedResult.attackerSpeed).toLocaleString()}</strong>
          </span>
          <span className="matchup-speed-verdict">
            {speedResult.firstMover === "tie"
              ? "동속 — 선공은 랜덤"
              : speedResult.firstMover === "attacker"
                ? "⚡ 내 포켓몬이 먼저 움직여요"
                : "⚡ 상대가 먼저 움직여요"}
          </span>
          <span className="matchup-speed-side">
            상대 <strong>{Math.round(speedResult.defenderSpeed).toLocaleString()}</strong>
          </span>
        </div>
      )}

      {picker?.kind === "pokemon" && (
        <PokemonPickerModal
          onClose={() => setPicker(null)}
          onSelect={(pokemonId) => {
            sideOf(picker.side).setPokemon(pokemonId);
            setPicker(null);
          }}
        />
      )}

      {picker?.kind === "ability" &&
        (() => {
          const pokemon = picker.side === "attacker" ? attackerPokemon : defenderPokemon;
          if (!pokemon) return null;
          return (
            <AbilityPickerModal
              pokemon={pokemon}
              slot={sideOf(picker.side).slot}
              currentAbilityId={sideOf(picker.side).slot.ability}
              onClose={() => setPicker(null)}
              onSelect={(abilityId) => {
                sideOf(picker.side).setAbility(abilityId);
                setPicker(null);
              }}
              onClear={() => {
                sideOf(picker.side).setAbility(null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "item" &&
        (() => {
          const pokemon = picker.side === "attacker" ? attackerPokemon : defenderPokemon;
          if (!pokemon) return null;
          return (
            <ItemPickerModal
              pokemon={pokemon}
              currentItemId={sideOf(picker.side).slot.item}
              onClose={() => setPicker(null)}
              onSelect={(itemId) => {
                sideOf(picker.side).setItem(itemId);
                setPicker(null);
              }}
              onClear={() => {
                sideOf(picker.side).setItem(null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "nature" && (
        <NaturePickerModal
          currentNatureId={sideOf(picker.side).slot.nature}
          onClose={() => setPicker(null)}
          onSelect={(natureId) => {
            sideOf(picker.side).setNature(natureId);
            setPicker(null);
          }}
          onClear={() => {
            sideOf(picker.side).setNature(null);
            setPicker(null);
          }}
        />
      )}

      {picker?.kind === "points" &&
        (() => {
          const side = picker.side;
          const pokemon = side === "attacker" ? attackerPokemon : defenderPokemon;
          if (!pokemon) return null;
          const slotState = sideOf(side);
          const form = getEffectiveForm(pokemon, slotState.slot);
          return (
            <PointsEditorModal
              pokemonName={pokemon.name}
              baseStats={form.baseStats}
              points={slotState.slot.points}
              natureId={slotState.slot.nature}
              onClose={() => setPicker(null)}
              onChange={(stat, value) => slotState.setPoint(stat, value)}
              onStep={(stat, delta) => slotState.stepPoint(stat, delta)}
            />
          );
        })()}

      {picker?.kind === "stages" &&
        (() => {
          const side = picker.side;
          const pokemon = side === "attacker" ? attackerPokemon : defenderPokemon;
          if (!pokemon) return null;
          const slotState = sideOf(side);
          return (
            <StageEditorModal
              pokemonName={pokemon.name}
              stages={slotState.slot.stages}
              onStep={(stat, delta) => slotState.stepStage(stat, delta)}
              onReset={() => {
                (["atk", "def", "spa", "spd", "spe"] as const).forEach((stat) =>
                  slotState.setStageValue(stat, 0),
                );
              }}
              onClose={() => setPicker(null)}
            />
          );
        })()}

      {picker?.kind === "move" &&
        attackerPokemon &&
        (() => (
          <MovePickerModal
            pokemon={attackerPokemon}
            currentMoveIds={[attacker.slot.moveId]}
            onClose={() => setPicker(null)}
            onSelect={(moveId) => {
              attacker.setMove(moveId);
              setPicker(null);
            }}
            onClear={() => {
              attacker.setMove(null);
              setPicker(null);
            }}
          />
        ))()}

      {picker?.kind === "slotPresets" && (
        <SlotPresetsModal
          presets={slotPresets.presets}
          slotIsFilled={sideOf(picker.side).slot.pokemonId !== null}
          onClose={() => setPicker(null)}
          onLoad={(preset) => sideOf(picker.side).loadFromPartySlot(preset.slot)}
          onRename={slotPresets.renamePreset}
          onDelete={slotPresets.deletePreset}
        />
      )}
    </section>
  );
}
