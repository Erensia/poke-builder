import { type Move } from "@/types/move";
import { type PokemonType } from "@/types/pokemon-type";
import { getPokemon } from "@/lib/data";
import { getEffectiveForm } from "@/lib/pokemonForm";
import { resolveEffectiveDefenderAbility } from "@/lib/abilityModifiers";
import { evaluateSlotMatchup, type RuntimeCombatant } from "@/lib/matchupEvaluator";
import { resolveMoveContext } from "@/lib/moveContext";
import { isOpponentTargetingMove, isPriorityMoveBlockedByField } from "@/lib/fieldEffects";
import { computeStatusAttackMultiplier, ignoresBurnAttackPenalty } from "@/lib/statusConditions";
import { faintedAllyPowerValue, supremeOverlordMultiplier } from "@/lib/battlePower";
import { abilityOf, activeWeather, isFainted, type BattleFighterState, type BattleSide, type BattleState } from "../state";
import { computeBattleHitChance } from "../hitChance";
import { computeTurnOrderPriority, effectiveHeldItem } from "../turnOrderInputs";
import { isGrounded } from "../grounding";
import { estimateHits, meanDamageFraction } from "./hitsToKill";
import { applySurvivalGuard } from "./survivalGuard";
import type { HitsEstimate } from "./types";

/** 한 기술로 상대를 쓰러뜨리는 데 걸리는 턴 수 추정. accuracy·typeEffectiveness는 결정 레이어가 따로 참조한다. */
export interface MoveHitEstimate extends HitsEstimate {
  /** 명중률 반영 전 기대 타수 */
  rawHits: number;
  accuracy: number;
  typeEffectiveness: number;
  /** 한 번 쓸 때 기대 데미지(방어측 최대 HP 대비, 명중률 포함) — 현재 HP와 무관한 절대량(대타 계산용) */
  damageFraction: number;
}

export interface MoveHitContext {
  state: BattleState;
  attacker: BattleFighterState;
  defender: BattleFighterState;
  /** 방어측 편(스크린 판정용) */
  defenderSide: BattleSide;
  attackerMovesSecond: boolean;
  /** 변환자재 등으로 이번 턴 바뀔 타입을 가정할 때 */
  attackerTypes?: PokemonType[];
  defenderTypes?: PokemonType[];
  /** 교체 후보처럼 진입 비용을 뺀 HP로 평가할 때 */
  defenderHp?: number;
}

/** 실전 파이터의 현재 값을 evaluateSlotMatchup 런타임 입력으로 옮긴다. */
export function runtimeOf(fighter: BattleFighterState, types?: PokemonType[], state?: BattleState): RuntimeCombatant {
  const pokemon = getPokemon(fighter.slot.pokemonId);
  // 슬롯에 메가스톤이 있으면 getEffectiveForm이 메가폼으로 계산하므로, 아직 메가진화 전이면 무시한다.
  const weightKg = pokemon ? getEffectiveForm(pokemon, fighter.slot, { ignoreMega: !fighter.hasMegaEvolved }).weightKg : undefined;
  const stats = fighter.realStats;
  return {
    types: types ?? fighter.types,
    // 원더룸(트랙 M4): 방어·특방 실능을 맞바꾼 채로 계산
    realStats: state?.wonderRoomTurnsRemaining !== undefined ? { ...stats, def: stats.spd, spd: stats.def } : stats,
    abilityId: fighter.effectiveAbilityId,
    itemId: effectiveHeldItem(fighter, state)?.id ?? null,
    weightKg,
    grounded: state ? isGrounded(state, types ? { ...fighter, types } : fighter) : undefined,
  };
}

/** 파티 상태로 위력이 정해지는 기술: 성묘(트랙 L)·집단구타(트랙 M6 — AI는 평균 위력 × 타수로 본다). 엔진과 같은 계산 */
function withBeatUpPower(state: BattleState, attacker: BattleFighterState, move: Move): Move {
  const party = (state.sideA.party.includes(attacker) ? state.sideA : state.sideB).party;
  // 성묘(트랙 L): 엔진과 같은 위력(쓰러진 같은 편 수)
  if (move.powerPerFaintedAlly && move.power !== null) {
    const fainted = party.filter((f) => f !== attacker && isFainted(f)).length;
    return { ...move, power: faintedAllyPowerValue(move.power, move.powerPerFaintedAlly, fainted) };
  }
  if (!move.beatUpPower) return move;
  const hitters = party.filter((f) => f === attacker || (!isFainted(f) && !f.status.condition));
  const powers = hitters.map((f) => 5 + Math.floor((getPokemon(f.slot.pokemonId)?.baseStats.atk ?? 0) / 10));
  const average = Math.round(powers.reduce((a, b) => a + b, 0) / powers.length);
  return { ...move, power: average, minHits: powers.length, maxHits: powers.length };
}

/** 2~5회 기술의 기대 타격 수(rollMultiHitCount 분포 그대로: 2·3회 35%, 4·5회 15%). 그 외는 균등. */
function expectedMultiHitCount(minHits: number, maxHits: number): number {
  if (minHits === maxHits) return minHits;
  if (minHits === 2 && maxHits === 5) return 2 * 0.35 + 3 * 0.35 + 4 * 0.15 + 5 * 0.15;
  return (minHits + maxHits) / 2;
}

function screenFor(side: BattleSide, category: Move["category"]): "reflect" | "lightScreen" | "auroraVeil" | undefined {
  if (side.screens.auroraVeil !== undefined) return "auroraVeil";
  if (category === "physical" && side.screens.reflect !== undefined) return "reflect";
  if (category === "special" && side.screens.lightScreen !== undefined) return "lightScreen";
  return undefined;
}

const NO_DAMAGE: Omit<MoveHitEstimate, "typeEffectiveness" | "accuracy"> = {
  expected: Infinity,
  rawHits: Infinity,
  worstCase: { count: 3, certainty: "random", probability: 0 },
  damageFraction: 0,
};

/**
 * 공격측이 이 기술을 계속 쓸 때 방어측을 쓰러뜨리기까지의 기대 턴 수(명중률·생존 보장 반영).
 * 데미지를 주지 않는 변화기는 null. 판정 불가한 기술(가변 위력 미지원 등)도 null.
 */
/**
 * 총대장 수: 나와 있는 포켓몬(state.a/b 그 자체)이면 엔진이 등장 때 센 값. 그 외(대기 포켓몬, AI가 랭크를 지운 복제본
 * 포함 — slot으로 파티에서 찾는다)는 지금 나온다고 할 때의 같은 편 기절 수.
 */
function supremeOverlordCountFor(state: BattleState, attacker: BattleFighterState): number | undefined {
  if (!abilityOf(attacker)?.powerBoostPerFaintedAlly) return undefined;
  if (attacker === state.a || attacker === state.b) return attacker.supremeOverlordCount;
  const party = [state.sideA.party, state.sideB.party].find((p) => p.some((m) => m.slot === attacker.slot));
  if (!party) return attacker.supremeOverlordCount;
  return party.filter((m) => m.slot !== attacker.slot && isFainted(m)).length;
}

export function estimateMoveHits(ctx: MoveHitContext, baseMove: Move): MoveHitEstimate | null {
  const { state, attacker, defender, defenderSide, attackerMovesSecond } = ctx;
  if (baseMove.category === "status" || baseMove.category === null) return null;
  const move = withBeatUpPower(state, attacker, baseMove);

  const attackerAbility = abilityOf(attacker);
  const defenderAbility = resolveEffectiveDefenderAbility(attackerAbility, abilityOf(defender));
  const attackerItem = effectiveHeldItem(attacker, state);
  const defenderItem = effectiveHeldItem(defender, state);
  const defenderTypes = ctx.defenderTypes ?? defender.types;
  const defenderHp = ctx.defenderHp ?? defender.currentHp;
  if (defenderHp <= 0) return { ...NO_DAMAGE, expected: 0, rawHits: 0, accuracy: 1, typeEffectiveness: 1 };

  const moveContext = resolveMoveContext(attackerAbility, move, defenderTypes, defenderAbility, {
    weather: activeWeather(state),
    defenderItem,
    // 타입을 가정으로 바꿔 넣은 경우(변환자재 등)는 그 타입 기준으로 접지를 본다
    defenderGrounded: isGrounded(state, ctx.defenderTypes ? { ...defender, types: defenderTypes } : defender, defenderAbility),
  });
  const typeEffectiveness = moveContext.typeEffectiveness;

  // 여왕의위엄/테일아머·사이코필드: 우선도 1 이상인 상대 대상 기술은 실패한다.
  const priority = computeTurnOrderPriority(state, attacker, move);
  const priorityBlocked =
    (defenderAbility?.blocksOpponentPriorityMoves && priority >= 1 && isOpponentTargetingMove(move)) ||
    isPriorityMoveBlockedByField(state.field, priority, move);
  if (priorityBlocked || typeEffectiveness === 0) return { ...NO_DAMAGE, accuracy: 0, typeEffectiveness };

  const accuracy =
    computeBattleHitChance({
      state,
      attacker,
      defender,
      move: moveContext.effectiveMove,
      hustleCategory: move.category,
      attackerAbility,
      defenderAbility,
      attackerItem,
      defenderItem,
      attackerMovesSecond,
    }) ?? 1;

  // 일격기(트랙 M5): 맞으면 한 번에 쓰러뜨린다(옹골참·면역 타입이면 안 통함). 기합의띠류는 applySurvivalGuard가 본다.
  if (move.oneHitKo) {
    if (defenderAbility?.immuneToOhko || (move.oneHitKo.immuneType && defenderTypes.includes(move.oneHitKo.immuneType))) {
      return { ...NO_DAMAGE, accuracy: 0, typeEffectiveness: 0 };
    }
    const estimate: HitsEstimate = {
      expected: 1 / Math.max(accuracy, 1e-9),
      worstCase: { count: 1, certainty: "random", probability: accuracy },
    };
    const damageFraction = defender.maxHp > 0 ? (defenderHp / defender.maxHp) * accuracy : 0;
    return applySurvivalGuard({ ...estimate, rawHits: 1, accuracy, typeEffectiveness, damageFraction }, defender, defenderAbility, defenderItem, defenderHp);
  }

  // 분노의앞니(상대 HP 절반 — 혼자서는 못 쓰러뜨림)·목숨걸기(내 HP만큼)도 고정 데미지(트랙 M5)
  const fixedDamage = move.halvesTargetHp
    ? Math.max(1, Math.floor(defenderHp / 2))
    : move.damageEqualsUserHp
      ? attacker.currentHp
      : move.fixedDamage;
  if (move.halvesTargetHp) {
    const damageFraction = defender.maxHp > 0 ? ((fixedDamage ?? 0) / defender.maxHp) * accuracy : 0;
    const estimate: HitsEstimate = { expected: defenderHp <= 1 ? 1 / Math.max(accuracy, 1e-9) : Infinity, worstCase: { count: 3, certainty: "random", probability: 0 } };
    return { ...estimate, rawHits: defenderHp <= 1 ? 1 : Infinity, accuracy, typeEffectiveness, damageFraction };
  }

  // 지구던지기류: 상성 면역만 존중하는 고정 데미지
  if (fixedDamage !== undefined) {
    const hits = Math.ceil(defenderHp / fixedDamage);
    const estimate: HitsEstimate = {
      expected: hits / Math.max(accuracy, 1e-9),
      worstCase: { count: Math.min(hits, 3), certainty: "guaranteed", probability: hits <= 2 ? 1 : 0 },
    };
    const damageFraction = defender.maxHp > 0 ? (fixedDamage / defender.maxHp) * accuracy : 0;
    return applySurvivalGuard({ ...estimate, rawHits: hits, accuracy, typeEffectiveness, damageFraction }, defender, defenderAbility, defenderItem, defenderHp);
  }

  const alwaysMaxHits = !!attackerAbility?.multiHitAlwaysMax;
  let multiHitCount: number | undefined;
  let hitCountScale = 1;
  if (move.multiHitPowers) {
    multiHitCount = move.multiHitPowers.length;
  } else if (move.minHits !== undefined && move.maxHits !== undefined) {
    if (alwaysMaxHits) multiHitCount = move.maxHits;
    else hitCountScale = expectedMultiHitCount(move.minHits, move.maxHits);
  }

  const ownTypeBoost = move.type ? (attacker.ownMoveTypeBoosts[move.type] ?? 1) : 1;
  const electroBoost = attacker.electroChargedForElectric && move.type === "전기" ? 2 : 1;
  const burnMultiplier = computeStatusAttackMultiplier(
    attacker.status.condition,
    move.category,
    ignoresBurnAttackPenalty(attackerAbility?.id, move.id),
  );
  // 총대장: 엔진(hitResolution)과 같은 배율. 나와 있는 포켓몬은 등장 때 센 값, 대기 포켓몬(교체 후보·파티 대면표)은
  // "지금 나온다면" 셀 값 — 같은 편 기절 수 — 으로 본다.
  const overlordMultiplier = supremeOverlordMultiplier(attackerAbility, supremeOverlordCountFor(state, attacker));

  const result = evaluateSlotMatchup(attacker.slot, move, defender.slot, {
    attackerStages: attacker.stages,
    defenderStages: defender.stages,
    applyMoveOwnStatChanges: false,
    weather: state.weather,
    field: state.field,
    screen: attackerAbility?.bypassesScreensAndSubstitute ? undefined : screenFor(defenderSide, move.category),
    multiHitCount,
    stockpileCount: attacker.stockpileCount ?? 0,
    attackerHpFraction: attacker.currentHp / attacker.maxHp,
    defenderHpIsFull: defenderHp === defender.maxHp,
    defenderHpFraction: defender.maxHp > 0 ? defenderHp / defender.maxHp : 1,
    defenderHasStatusCondition: !!defender.status.condition,
    defenderItemConsumed: !!defender.itemConsumed,
    attackerRuntime: runtimeOf(attacker, ctx.attackerTypes, state),
    defenderRuntime: runtimeOf(defender, defenderTypes, state),
    extraOffenseMultiplier: ownTypeBoost * electroBoost * burnMultiplier * overlordMultiplier,
  });
  if (!result) return null;

  const estimate = estimateHits(result.offensePower * hitCountScale, result.bulkPower, {
    hpFraction: defenderHp / defender.maxHp,
    accuracy,
  });
  const rawHits = accuracy > 0 ? estimate.expected * accuracy : Infinity;
  const damageFraction = meanDamageFraction(result.offensePower * hitCountScale, result.bulkPower) * accuracy;
  return applySurvivalGuard({ ...estimate, rawHits, accuracy, typeEffectiveness, damageFraction }, defender, defenderAbility, defenderItem, defenderHp);
}
