import { useMemo, useState } from "react";
import { MatchupSlotCard } from "./MatchupSlotCard";
import { VerdictBadge } from "./VerdictBadge";
import { DamageRollBlock } from "./DamageRollBlock";
import { WeatherPicker } from "./WeatherPicker";
import { FieldPicker } from "./FieldPicker";
import { DefenseInferencePanel } from "./DefenseInferencePanel";
import { PokemonPickerModal } from "./PokemonPickerModal";
import { MovePickerModal } from "./MovePickerModal";
import { AbilityPickerModal } from "./AbilityPickerModal";
import { ItemPickerModal } from "./ItemPickerModal";
import { NaturePickerModal } from "./NaturePickerModal";
import { PointsEditorModal } from "./PointsEditorModal";
import { faintedAllyPowerValue } from "../lib/battlePower";
import { StageEditorModal } from "./StageEditorModal";
import { CosmeticFormPickerModal } from "./CosmeticFormPickerModal";
import { SlotPresetsModal } from "./SlotPresetsModal";
import { useMatchup } from "../hooks/useMatchup";
import { useSlotPresets } from "../hooks/useSlotPresets";
import { saveMatchupDraft } from "../lib/storage";
import { getPokemon, getMove, getAbility } from "../lib/data";
import { getEffectiveForm } from "../lib/pokemonForm";
import { computeRealStats } from "../lib/statCalculator";
import { computeBulkPower } from "../lib/battlePower";
import { environmentTintBackground } from "../lib/environmentBackground";
import { evaluateSlotMatchup, evaluateSpeedMatchup, computeSoloOffensePower } from "../lib/matchupEvaluator";
import { burnDamageMultiplier, ignoresBurnAttackPenalty, statusedAttackBoost } from "../lib/statusConditions";
import { BATTLE_STAT_KEYS } from "../types/battleStats";
import "./MatchupPage.css";

type Side = "attacker" | "defender";
type PickerState =
  | { kind: "pokemon"; side: Side }
  | { kind: "ability"; side: Side }
  | { kind: "item"; side: Side }
  | { kind: "nature"; side: Side }
  | { kind: "points"; side: Side }
  | { kind: "stages"; side: Side }
  | { kind: "cosmeticForm"; side: Side }
  | { kind: "move" }
  | { kind: "slotPresets"; side: Side }
  | null;

export function MatchupPage() {
  const { attacker, defender, weather, setWeather, field, setField, trickRoom, setTrickRoom } =
    useMatchup();
  const slotPresets = useSlotPresets();
  const [picker, setPicker] = useState<PickerState>(null);
  // 2.1 C — 결정력 계산 / 상대 실능치 역산 탭. 두 탭이 같은 내 포켓몬·상대 종·날씨·필드 상태를 공유한다
  const [tab, setTab] = useState<"calc" | "inference">("calc");
  // 역산 입력 지우기 — 키가 바뀌면 패널이 저장본 없이 새로 뜬다(3.2 V2)
  const [inferenceResetKey, setInferenceResetKey] = useState(0);

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
    return { physical, special, maxHp: realStats.hp };
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
        attackerMove?.powerPerFaintedAlly && attackerMove.power !== null && attacker.slot.graveVisitFaintedAllies
          ? {
              ...attackerMove,
              power: faintedAllyPowerValue(attackerMove.power, attackerMove.powerPerFaintedAlly, attacker.slot.graveVisitFaintedAllies),
            }
          : attackerMove,
    };
  }, [attacker.slot, defender.slot, attackerMove]);

  // ver.1.9 가정 토글 → 계산 옵션. 화상 물리 반감(근성·객기 예외)은 배틀 AI처럼 추가 공격 배율로 넘긴다.
  const assumeOptions = useMemo(() => {
    const status = attacker.slot.statusAssumed ?? null;
    return {
      attackerStatus: status,
      defenderStatus: defender.slot.statusAssumed ?? null,
      defenderHasStatusCondition: !!defender.slot.statusAssumed,
      attackerHpFraction: (attacker.slot.hpPercent ?? 100) / 100,
      abilityHpFraction: attacker.slot.pinchAssumed ? 1 / 3 : 1,
      attackerMovesLast: !!attacker.slot.movesLastAssumed,
      attackerTookDamageThisTurn: !!attacker.slot.tookDamageAssumed,
      attackerMoveFailedLastTurn: !!attacker.slot.moveFailedAssumed,
      attackerStatLoweredThisTurn: !!attacker.slot.statLoweredAssumed,
      defenderDamagedThisTurn: !!attacker.slot.targetDamagedAssumed,
      defenderMinimized: !!attacker.slot.targetMinimizedAssumed,
      critical: !!attacker.slot.critAssumed,
      attackerTypeToMoveType: !!attacker.slot.typeShiftAssumed,
      defenderHpIsFull: defender.slot.fullHpAssumed ?? true,
      // 근성류 상승은 위력 단계, 화상 ×0.5는 최종 단계로 따로 넘긴다(2.4 B3 — 정수 데미지 공식의 단계 구분)
      extraOffenseMultiplier: effMove
        ? statusedAttackBoost(
            status,
            effMove.category,
            attacker.slot.ability ? getAbility(attacker.slot.ability)?.physicalAttackMultiplierWhenStatused : undefined,
          )
        : 1,
      finalOffenseMultiplier: effMove
        ? burnDamageMultiplier(status, effMove.category, ignoresBurnAttackPenalty(attacker.slot.ability ?? undefined, effMove.id))
        : 1,
    };
  }, [attacker.slot, defender.slot, effMove]);

  // 양쪽 다 준비되고 기술까지 골랐을 때: 정확한 결정력/내구력/판정
  const fullResult = useMemo(() => {
    if (!attackerPokemon || !defenderPokemon || !effMove) return null;
    return evaluateSlotMatchup(
      { ...effAttackerSlot, pokemonId: attackerPokemon.id },
      effMove,
      { ...effDefenderSlot, pokemonId: defenderPokemon.id },
      {
        weather: weather ?? undefined,
        field: field ?? undefined,
        multiHitCount: attacker.slot.multiHitCount,
        stockpileCount: attacker.slot.stockpileCount,
        attackerStages: attacker.slot.stages,
        defenderStages: defender.slot.stages,
        screen: defender.slot.screen,
        ...assumeOptions,
      },
    );
  }, [attackerPokemon, defenderPokemon, effAttackerSlot, effDefenderSlot, effMove, attacker.slot, defender.slot, weather, field, assumeOptions]);

  // ver.1.3 §4 — 상대를 아직 안 골랐을 때도(fullResult는 defenderPokemon이 있어야 나옴) 공격측
  // 정보만으로 계산 가능한 결정력은 보여준다. 상대가 이미 있으면 fullResult 쪽이 더 정확하니
  // 이 값은 안 쓴다(카드에도 defenderPokemon 없을 때만 넘긴다).
  const soloOffensePower = useMemo(() => {
    if (!attackerPokemon || !effMove) return null;
    return computeSoloOffensePower(
      { ...effAttackerSlot, pokemonId: attackerPokemon.id },
      effMove,
      {
        weather: weather ?? undefined,
        field: field ?? undefined,
        multiHitCount: attacker.slot.multiHitCount,
        stockpileCount: attacker.slot.stockpileCount,
        attackerStages: attacker.slot.stages,
        attackerHpFraction: assumeOptions.attackerHpFraction,
        abilityHpFraction: assumeOptions.abilityHpFraction,
        attackerStatus: assumeOptions.attackerStatus,
        attackerMovesLast: assumeOptions.attackerMovesLast,
        attackerTookDamageThisTurn: assumeOptions.attackerTookDamageThisTurn,
        attackerMoveFailedLastTurn: assumeOptions.attackerMoveFailedLastTurn,
        attackerStatLoweredThisTurn: assumeOptions.attackerStatLoweredThisTurn,
        critical: assumeOptions.critical,
        attackerTypeToMoveType: assumeOptions.attackerTypeToMoveType,
        extraOffenseMultiplier: assumeOptions.extraOffenseMultiplier,
        finalOffenseMultiplier: assumeOptions.finalOffenseMultiplier,
      },
    );
  }, [attackerPokemon, effAttackerSlot, effMove, attacker.slot, weather, field, assumeOptions]);

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
        attackerStatus: attacker.slot.statusAssumed,
        defenderStatus: defender.slot.statusAssumed,
        trickRoom,
        attackerStages: attacker.slot.stages,
        defenderStages: defender.slot.stages,
      },
    );
  }, [attackerPokemon, defenderPokemon, effAttackerSlot, effDefenderSlot, attacker.slot, defender.slot, weather, trickRoom]);

  return (
    <section className="matchup-page">
      <header className="matchup-page-header">
        <div>
          <h2>결정력 &amp; 내구력</h2>
          <p>
            {tab === "calc"
              ? "내 포켓몬과 상대 포켓몬을 고르고, 기술을 선택하면 타수 판정을 확인할 수 있습니다."
              : "내가 입힌 데미지(상대 HP %)로 상대의 HP·방어 능력 포인트와 성격이 될 수 있는 범위를 추정합니다."}
          </p>
        </div>
        <div className="matchup-tabs" role="tablist" aria-label="계산기 종류">
          <button type="button" role="tab" aria-selected={tab === "calc"} className={tab === "calc" ? "is-active" : undefined} onClick={() => setTab("calc")}>
            결정력 계산
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "inference"}
            className={tab === "inference" ? "is-active" : undefined}
            onClick={() => setTab("inference")}
          >
            상대 실능치 역산
          </button>
        </div>
        <div className="matchup-env-pickers">
          <WeatherPicker weather={weather} onChange={setWeather} />
          <FieldPicker field={field} onChange={setField} />
        </div>
      </header>

      {tab === "calc" && (
        <>
      <div className="matchup-board" style={{ background: environmentTintBackground(weather, field) }}>
        <MatchupSlotCard
          role="attacker"
          label="내 포켓몬"
          slot={attacker.slot}
          offensePower={fullResult?.offensePower}
          rawOffensePower={fullResult?.rawOffensePower}
          soloOffensePower={!defenderPokemon ? soloOffensePower : undefined}
          multiHitCount={attacker.slot.multiHitCount}
          onSetMultiHitCount={attacker.setMultiHitCount}
          onPickPokemon={() => setPicker({ kind: "pokemon", side: "attacker" })}
          onClearPokemon={attacker.clearPokemon}
          onPickAbility={() => setPicker({ kind: "ability", side: "attacker" })}
          onPickItem={() => setPicker({ kind: "item", side: "attacker" })}
          onPickNature={() => setPicker({ kind: "nature", side: "attacker" })}
          onPickPoints={() => setPicker({ kind: "points", side: "attacker" })}
          onPickStages={() => setPicker({ kind: "stages", side: "attacker" })}
          onCycleSizeForm={attacker.cycleSizeForm}
          onCycleFormVariant={attacker.cycleFormVariant}
          onCycleCosmeticForm={attacker.cycleCosmeticForm}
          onPickCosmeticForm={() => setPicker({ kind: "cosmeticForm", side: "attacker" })}
          onPickMove={() => setPicker({ kind: "move" })}
          hasSamples={slotPresets.presets.length > 0}
          onOpenSamplePicker={() => setPicker({ kind: "slotPresets", side: "attacker" })}
          onToggleItemStolen={attacker.setItemStolen}
          onToggleUnburden={attacker.setUnburdenAssumed}
          onSetStatus={attacker.setStatusAssumed}
          selectedMove={attackerMove ?? undefined}
          onSetPowerCondition={attacker.setPowerCondition}
          onToggleCrit={attacker.setCritAssumed}
          onToggleTypeShift={attacker.setTypeShiftAssumed}
          critBlocked={!!fullResult?.criticalBlocked}
          onTogglePinch={attacker.setPinchAssumed}
          onSetHpPercent={attacker.setHpPercent}
          moveIsGraveVisit={!!attackerMove?.powerPerFaintedAlly}
          onSetGraveVisit={attacker.setGraveVisitFaintedAllies}
          moveIsSpitUp={!!attackerMove?.spitUpPower}
          stockpileCount={attacker.slot.stockpileCount}
          onSetStockpileCount={attacker.setStockpileCount}
        />

        <div className="matchup-verdict-row">
          <VerdictBadge
            verdict={fullResult?.verdict ?? null}
            koChance={fullResult?.koChance}
            killingRolls={fullResult?.killingRolls}
          />
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
          onCycleSizeForm={defender.cycleSizeForm}
          onCycleFormVariant={defender.cycleFormVariant}
          onCycleCosmeticForm={defender.cycleCosmeticForm}
          onPickCosmeticForm={() => setPicker({ kind: "cosmeticForm", side: "defender" })}
          hasSamples={slotPresets.presets.length > 0}
          onOpenSamplePicker={() => setPicker({ kind: "slotPresets", side: "defender" })}
          onToggleItemStolen={defender.setItemStolen}
          onToggleUnburden={defender.setUnburdenAssumed}
          onSetStatus={defender.setStatusAssumed}
          onToggleFullHp={defender.setFullHpAssumed}
          onSetScreen={defender.setScreen}
        />
      </div>

      {fullResult?.damageParts && baseBulk && (
        <DamageRollBlock parts={fullResult.damageParts} defenseStat={fullResult.defenseStat} defenderMaxHp={baseBulk.maxHp} />
      )}

      {speedResult && (
        <div className="matchup-speed-block">
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
              {speedResult.trickRoom && speedResult.firstMover !== "tie" && (
                <span className="matchup-speed-note"> (트릭룸)</span>
              )}
            </span>
            <span className="matchup-speed-side">
              상대 <strong>{Math.round(speedResult.defenderSpeed).toLocaleString()}</strong>
            </span>
          </div>
          <label className="matchup-assume-toggle matchup-speed-trickroom">
            <input
              type="checkbox"
              checked={trickRoom}
              onChange={(e) => setTrickRoom(e.target.checked)}
            />
            <span>트릭룸 가정 (느린 쪽이 먼저)</span>
          </label>
        </div>
      )}
        </>
      )}

      {tab === "inference" && (
        <DefenseInferencePanel
          key={inferenceResetKey}
          onReset={() => {
            saveMatchupDraft({ inference: undefined });
            setInferenceResetKey((k) => k + 1);
          }}
          attacker={attacker.slot}
          defender={defender.slot}
          weather={weather}
          field={field}
          defenderActions={{
            onPickPokemon: () => setPicker({ kind: "pokemon", side: "defender" }),
            onClear: defender.clearPokemon,
            onCycleFormVariant: defender.cycleFormVariant,
            onCycleSizeForm: defender.cycleSizeForm,
          }}
          attackerCard={
            <MatchupSlotCard
              role="attacker"
              label="내 포켓몬"
              slot={attacker.slot}
              hideMoveSlot
              hideTurnAssumptions
              onPickPokemon={() => setPicker({ kind: "pokemon", side: "attacker" })}
              onClearPokemon={attacker.clearPokemon}
              onPickAbility={() => setPicker({ kind: "ability", side: "attacker" })}
              onPickItem={() => setPicker({ kind: "item", side: "attacker" })}
              onPickNature={() => setPicker({ kind: "nature", side: "attacker" })}
              onPickPoints={() => setPicker({ kind: "points", side: "attacker" })}
              onPickStages={() => setPicker({ kind: "stages", side: "attacker" })}
              onCycleSizeForm={attacker.cycleSizeForm}
              onCycleFormVariant={attacker.cycleFormVariant}
              onCycleCosmeticForm={attacker.cycleCosmeticForm}
              onPickCosmeticForm={() => setPicker({ kind: "cosmeticForm", side: "attacker" })}
              hasSamples={slotPresets.presets.length > 0}
              onOpenSamplePicker={() => setPicker({ kind: "slotPresets", side: "attacker" })}
              onToggleItemStolen={attacker.setItemStolen}
              onToggleUnburden={attacker.setUnburdenAssumed}
              onSetStatus={attacker.setStatusAssumed}
            />
          }
        />
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
              includeMegaAbilityOption
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
                BATTLE_STAT_KEYS.forEach((stat) => slotState.setStageValue(stat, 0));
              }}
              onClose={() => setPicker(null)}
            />
          );
        })()}

      {picker?.kind === "cosmeticForm" &&
        (() => {
          const side = picker.side;
          const pokemon = side === "attacker" ? attackerPokemon : defenderPokemon;
          if (!pokemon?.cosmeticForms) return null;
          const slotState = sideOf(side);
          return (
            <CosmeticFormPickerModal
              pokemonName={pokemon.name}
              forms={pokemon.cosmeticForms}
              currentFormId={slotState.slot.cosmeticForm ?? null}
              onClose={() => setPicker(null)}
              onSelect={(formId) => {
                slotState.setCosmeticForm(formId);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "move" &&
        attackerPokemon &&
        (() => (
          <MovePickerModal
            pokemon={attackerPokemon}
            formVariant={attacker.slot.formVariant}
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
