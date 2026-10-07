import { type Move } from "@/types/move";
import type { DamageParts } from "@/lib/damageFormula";
import { type PokemonType } from "@/types/pokemon-type";
import { getPokemon } from "@/lib/data";
import { getEffectiveForm } from "@/lib/pokemonForm";
import { resolveEffectiveDefenderAbility } from "@/lib/abilityModifiers";
import { evaluateSlotMatchup, type RuntimeCombatant, type SlotMatchupOptions } from "@/lib/matchupEvaluator";
import { critChance } from "@/lib/accuracyCrit";
import { getDrainHealMultiplier, getItemCritStageBonus } from "@/lib/itemEffects";
import { hitTriggerMatchesMove } from "@/lib/abilityHitTriggers";
import { type Ability } from "@/types/ability";
import { type Item } from "@/types/item";
import { resolveMoveContext } from "@/lib/moveContext";
import { isOpponentTargetingMove, isPriorityMoveBlockedByField } from "@/lib/fieldEffects";
import { computeStatusAttackMultiplier, ignoresBurnAttackPenalty } from "@/lib/statusConditions";
import { faintedAllyPowerValue, supremeOverlordMultiplier } from "@/lib/battlePower";
import { abilityOf, activeWeather, hasSheerForceSecondaryEffect, isFainted, type BattleFighterState, type BattleSide, type BattleState } from "../state";
import { computeBattleHitChance } from "../hitChance";
import { computeTurnOrderPriority, effectiveHeldItem } from "../turnOrderInputs";
import { isGrounded } from "../grounding";
import { estimateKills, hitCountDistribution, meanUseDamage, type KillModel } from "./hitsToKill";
import { attackChanceOf, requiresTargetAttack } from "./opponentMoveModel";
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
  /**
   * 한 번 쓸 때 공격측 자신의 HP 변화 기대값(공격측 최대 HP 대비, + 손실 / − 회복) — 반동기·생명의구슬·철제광선·무릎차기 빗나감·
   * 접촉 페널티(울퉁불퉁멧·까칠한피부류), 흡수기·조개껍질방울(ver.1.9 한계점 A2). 없으면 0.
   */
  selfHpRate?: number;
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
  /**
   * 방어측이 이번 턴 공격기를 고를 확률 — 기습류 성공 확률·눈사태 2배 확률(ver.1.9 6-1). 생략하면 방어측 기술로 낸
   * 상대 기술 사용 확률 모델 값(attackChanceOf).
   */
  targetAttackChance?: number;
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

let critAware = true;

/**
 * fn 실행 동안만 급소 기대 데미지(ver.1.9 6-2)를 켜고 끈다 — 비교용 토글(DecisionParams.critAware). withEndOfTurnModel과 같은 방식.
 */
export function withCritModel<T>(enabled: boolean, fn: () => T): T {
  const previous = critAware;
  critAware = enabled;
  try {
    return fn();
  } finally {
    critAware = previous;
  }
}

/** 이 공격이 급소에 맞을 확률 — 엔진 hitResolution.resolveHit과 같은 규칙(급소 랭크·도구·대운·급소율 높은 기술·반드시 급소·무도한행동·조가비갑옷류) */
function critChanceOf(
  attacker: BattleFighterState,
  defender: BattleFighterState,
  move: Move,
  attackerAbility: Ability | undefined,
  defenderAbility: Ability | undefined,
  attackerItem: Item | undefined,
): number {
  if (defenderAbility?.preventsCritsAgainstSelf) return 0;
  const poisoned = defender.status.condition === "poison" || defender.status.condition === "badly-poisoned";
  if (move.alwaysCrit || (attackerAbility?.alwaysCritsVsPoisonedTarget && poisoned)) return 1;
  const stage = attacker.critStage + getItemCritStageBonus(attackerItem, attacker.slot.pokemonId) + (attackerAbility?.raisesCritStageBy ?? 0);
  return critChance(stage, move.highCritRatio);
}

export function estimateMoveHits(ctx: MoveHitContext, baseMove: Move): MoveHitEstimate | null {
  const estimate = estimateMoveHitsCore(ctx, baseMove);
  if (!estimate) return estimate;
  estimate.selfHpRate = selfHpRateOf(ctx, baseMove, estimate);
  return withTurnCost(ctx, baseMove, estimate);
}

/** 모으기 기술의 준비 턴이 날씨로 생략되는가(솔라빔+쾌청 등, 메가솔라는 항상 쾌청 취급) — preHitEffects와 같은 규칙 */
function skipsChargeTurn(state: BattleState, attacker: BattleFighterState, move: Move): boolean {
  if (move.chargeSkipWeather === undefined) return false;
  return activeWeather(state) === move.chargeSkipWeather || (move.chargeSkipWeather === "쾌청" && !!abilityOf(attacker)?.treatsOwnWeatherAsSun);
}

/**
 * 모으기·반동(ver.1.9 한계점 A1): 한 번 쓰는 데 드는 턴을 처치 턴에 넣는다 — 모으기는 2턴(날씨로 생략되면 1턴, 이미 모으는 중이면
 * 이번 한 번은 1턴), 반동은 맞힌 번마다 다음 턴을 쉰다(처치한 마지막 번 뒤의 쉼은 이 대면 밖 — 다음 상대에게 한 턴을 주는 비용은
 * 보지 않음). 턴당 데미지·자기 HP 변화도 그만큼 나눈다. 모으기로 한 방 처치는 상대가 한 번 더 움직이므로 worst_case도 한 타 늘린다.
 */
function withTurnCost(ctx: MoveHitContext, move: Move, e: MoveHitEstimate): MoveHitEstimate {
  if (!Number.isFinite(e.expected) || e.expected <= 0) return e;
  const { state, attacker } = ctx;
  const alreadyCharging = attacker.chargingMoveId === move.id;
  const charge = !!move.chargeTurn && !skipsChargeTurn(state, attacker, move);
  const recharge = !!move.inflictsVolatile?.some((v) => v.volatile === "recharge" && v.target === "self");
  if (!charge && !recharge) return e;
  const uses = e.expected;
  const turns = charge ? 2 * uses - (alreadyCharging ? 1 : 0) : uses + Math.max(0, uses * e.accuracy - 1);
  const scale = uses / turns;
  const worstCase =
    charge && !alreadyCharging
      ? { ...e.worstCase, count: Math.min(3, e.worstCase.count + 1), probability: e.worstCase.count + 1 > 3 ? 0 : e.worstCase.probability }
      : e.worstCase;
  return { ...e, expected: turns, worstCase, damageFraction: e.damageFraction * scale, selfHpRate: (e.selfHpRate ?? 0) * scale };
}

/** 한 번 쓸 때의 타격 수(다단히트 기대 타수, 스킬링크류는 최대) */
function hitsPerUse(move: Move, attackerAbility: Ability | undefined): number {
  if (move.multiHitPowers) return move.multiHitPowers.length;
  if (move.minHits !== undefined && move.maxHits !== undefined) {
    return attackerAbility?.multiHitAlwaysMax ? move.maxHits : expectedMultiHitCount(move.minHits, move.maxHits);
  }
  return 1;
}

/**
 * 공격 한 번에 공격측이 잃는(+)·얻는(−) HP의 기대값(공격측 최대 HP 대비) — 엔진 hitResolution·preHitEffects와 같은 규칙
 * (ver.1.9 한계점 A2). 반동·흡수·조개껍질방울은 실제로 깎은 HP 기준이라, 대면 전체로 보면 상대 HP를 처치 턴 수에 나눈 값으로
 * 자른다(오버킬 제외). 대타가 맞는 경우·해감액 외 드문 상호작용은 보지 않는다.
 */
function selfHpRateOf(ctx: MoveHitContext, move: Move, estimate: MoveHitEstimate): number {
  const { state, attacker, defender } = ctx;
  if (attacker.maxHp <= 0 || estimate.typeEffectiveness === 0 || estimate.accuracy <= 0) return 0;
  const attackerAbility = abilityOf(attacker);
  const defenderAbility = resolveEffectiveDefenderAbility(attackerAbility, abilityOf(defender));
  const attackerItem = effectiveHeldItem(attacker, state);
  const defenderItem = effectiveHeldItem(defender, state);
  const magicGuard = !!attackerAbility?.negatesIndirectDamage;
  const hit = estimate.accuracy;
  const defenderHp = ctx.defenderHp ?? defender.currentHp;
  const perUse = Number.isFinite(estimate.expected) ? defenderHp / Math.max(1, estimate.expected) : defenderHp;
  const dealt = Math.min(estimate.damageFraction * defender.maxHp, perUse);
  const maxHp = attacker.maxHp;
  let loss = 0;
  // 반동기(돌머리면 없음 — ver.1.9 A5), 철제광선(쓰는 순간)·무릎차기류(빗나가면) — 셋 다 매직가드면 없음
  if (move.recoilFraction !== undefined && !magicGuard && !attackerAbility?.negatesRecoil) loss += dealt * move.recoilFraction;
  if (move.selfDamageFractionOnUse !== undefined && !magicGuard) loss += maxHp * move.selfDamageFractionOnUse;
  if (move.crashFraction !== undefined && !magicGuard) loss += (1 - hit) * maxHp * move.crashFraction;
  const lifeOrb = attackerItem?.selfRecoilFractionOfMaxHp;
  const sheerForce = !!attackerAbility?.tradesSecondaryEffectForPower && hasSheerForceSecondaryEffect(move);
  if (lifeOrb && !magicGuard && !sheerForce) loss += hit * maxHp * lifeOrb;
  if ((move.makesContact ?? false) && !magicGuard) {
    let perHit = 0;
    if (defenderItem?.contactAttackerDamageDenominator) perHit += maxHp / defenderItem.contactAttackerDamageDenominator;
    const trigger = defenderAbility?.hitTrigger;
    if (trigger?.damagesAttackerFraction && hitTriggerMatchesMove(trigger, move)) {
      perHit += maxHp * trigger.damagesAttackerFraction * (trigger.chance !== undefined ? trigger.chance / 100 : 1);
    }
    loss += hit * hitsPerUse(move, attackerAbility) * perHit;
  }
  if (move.drainFraction !== undefined) {
    const drained = dealt * move.drainFraction * getDrainHealMultiplier(attackerItem);
    loss += defenderAbility?.reverseDrainHealsToDamage ? drained : -drained;
  }
  if (attackerItem?.damageDealtHealDenominator) loss -= dealt / attackerItem.damageDealtHealDenominator;
  return loss / maxHp;
}

function estimateMoveHitsCore(ctx: MoveHitContext, baseMove: Move): MoveHitEstimate | null {
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
  // 사이코필드는 땅에 있는 대상만 지킨다(엔진과 같게 — ver.1.9 6-1에서 접지 인자 누락 수정)
  const defenderGrounded = isGrounded(state, ctx.defenderTypes ? { ...defender, types: defenderTypes } : defender, defenderAbility);
  const priorityBlocked =
    (defenderAbility?.blocksOpponentPriorityMoves && priority >= 1 && isOpponentTargetingMove(move)) ||
    isPriorityMoveBlockedByField(state.field, priority, move, defenderGrounded);
  if (priorityBlocked || typeEffectiveness === 0) return { ...NO_DAMAGE, accuracy: 0, typeEffectiveness };

  // 기습류: 방어측이 이번 턴 공격기를 고를 때만 성공 — 그 확률을 명중률에 곱한다. 선공 +1이라 행동 순서는 먼저로 본다
  // (방어측이 더 높은 우선도 공격기로 먼저 치는 경우는 무시하는 근사).
  const targetAttackChance =
    requiresTargetAttack(move) || move.conditionalDoublePower === "took-damage-this-turn"
      ? (ctx.targetAttackChance ?? attackChanceOf(state, defender, attacker))
      : 1;
  const successChance = requiresTargetAttack(move) ? targetAttackChance : 1;
  const accuracy =
    successChance *
    (computeBattleHitChance({
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
    }) ?? 1);

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

  const ownTypeBoost = move.type ? (attacker.ownMoveTypeBoosts[move.type] ?? 1) : 1;
  const electroBoost = attacker.electroChargedForElectric && move.type === "전기" ? 2 : 1;
  const burnMultiplier = computeStatusAttackMultiplier(
    attacker.status.condition,
    move.category,
    ignoresBurnAttackPenalty(attackerAbility?.id, move.id),
    attackerAbility?.physicalAttackMultiplierWhenStatused,
  );
  // 총대장: 엔진(hitResolution)과 같은 배율. 나와 있는 포켓몬은 등장 때 센 값, 대기 포켓몬(교체 후보·파티 대면표)은
  // "지금 나온다면" 셀 값 — 같은 편 기절 수 — 으로 본다.
  const overlordMultiplier = supremeOverlordMultiplier(attackerAbility, supremeOverlordCountFor(state, attacker));
  // 눈사태(이번 턴 먼저 맞았으면 2배): 후공이면 방어측이 공격기를 고를 확률만큼 2배를 기대 위력으로 섞는다. 보복(상대보다
  // 늦게 행동하면 2배)은 후공 여부 그대로(ver.1.9 6-1 — 이전엔 AI가 항상 기본 위력으로 봤다).
  const avalancheMultiplier =
    move.conditionalDoublePower === "took-damage-this-turn" && attackerMovesSecond ? 1 + targetAttackChance : 1;
  // 애널라이즈(ver.1.9 A5): 후공이면 위력 ×1.3 — 엔진과 같은 판정(대상보다 늦게 행동)
  const analyticMultiplier = attackerMovesSecond ? (attackerAbility?.powerMultiplierWhenMovingLast ?? 1) : 1;

  const matchupOptions: SlotMatchupOptions = {
    attackerStages: attacker.stages,
    defenderStages: defender.stages,
    weather: state.weather,
    field: state.field,
    screen: attackerAbility?.bypassesScreensAndSubstitute ? undefined : screenFor(defenderSide, move.category),
    multiHitCount: move.multiHitPowers ? move.multiHitPowers.length : move.minHits !== undefined && move.maxHits !== undefined ? move.maxHits : undefined,
    stockpileCount: attacker.stockpileCount ?? 0,
    attackerHpFraction: attacker.currentHp / attacker.maxHp,
    defenderHpIsFull: defenderHp === defender.maxHp,
    defenderHpFraction: defender.maxHp > 0 ? defenderHp / defender.maxHp : 1,
    defenderHasStatusCondition: !!defender.status.condition,
    attackerStatus: attacker.status.condition,
    defenderStatus: defender.status.condition,
    attackerMovesLast: move.conditionalDoublePower === "moves-after-target" && attackerMovesSecond,
    // 분풀이(이번 턴 능력 하락)·승부굳히기(이번 턴 대상이 이미 데미지)는 결정 시점(턴 시작 전)엔 알 수 없어 기본 위력으로 본다
    // 누르기 등 작아지기 보너스: 대상이 이번 배틀에서 작아지기를 썼으면(엔진과 같은 기록)
    defenderMinimized: !!defender.usedMoveIds?.["작아지기"],
    defenderItemConsumed: !!defender.itemConsumed,
    attackerRuntime: runtimeOf(attacker, ctx.attackerTypes, state),
    defenderRuntime: runtimeOf(defender, defenderTypes, state),
    extraOffenseMultiplier: ownTypeBoost * electroBoost * burnMultiplier * overlordMultiplier * avalancheMultiplier * analyticMultiplier,
    skipVerdict: true,
  };
  const result = evaluateSlotMatchup(attacker.slot, move, defender.slot, matchupOptions);
  if (!result) return null;

  const parts = result.damageParts;
  if (!parts) return applySurvivalGuard({ ...NO_DAMAGE, accuracy, typeEffectiveness }, defender, defenderAbility, defenderItem, defenderHp);

  // 타수 분포: 랜덤 타수(2~5회 등)는 분포, 스킬링크류·고정 타수는 한 값
  const hitCounts: [number, number][] =
    move.minHits !== undefined && move.maxHits !== undefined && !move.multiHitPowers
      ? attackerAbility?.multiHitAlwaysMax
        ? [[move.maxHits, 1]]
        : hitCountDistribution(move.minHits, move.maxHits)
      : [[parts.hitPowers.length, 1]];

  // 첫 사용만 다른 요소(반감 열매 — 조각의 firstHitFinalMultiplier가 첫 타에 곱해진다 / 분함의발구르기·열불내기: 직전 턴 실패 시 이번 한 번만 위력 2배)
  const failedBonus = move.conditionalDoublePower === "user-move-failed-last-turn" && attacker.lastTurnMoveFailed;
  const variant = (extra: SlotMatchupOptions) => evaluateSlotMatchup(attacker.slot, move, defender.slot, { ...matchupOptions, ...extra })?.damageParts;
  // 급소(ver.1.9 6-2): 엔진 hitResolution과 같은 확률 규칙. 급소 조각은 계산기 급소 가정(랭크·벽 무시·×1.5)
  const critP = critAware ? critChanceOf(attacker, defender, move, attackerAbility, defenderAbility, attackerItem) : 0;
  const critParts = critP > 0 ? variant({ critical: true }) : undefined;
  const bonusParts = failedBonus ? variant({ attackerMoveFailedLastTurn: true }) : undefined;
  const bonusCrit = failedBonus && critParts ? variant({ critical: true, attackerMoveFailedLastTurn: true }) : undefined;
  const afterFirst = (p: DamageParts | undefined) => (p ? { ...p, firstHitFinalMultiplier: undefined } : undefined);
  const model: KillModel = {
    first: bonusParts ?? parts,
    rest: afterFirst(parts)!,
    firstCrit: bonusCrit ?? critParts,
    restCrit: afterFirst(critParts),
    critChance: critParts ? Math.min(1, critP) : 0,
    defenseStat: result.defenseStat,
    hitCounts,
  };
  const estimate = estimateKills(model, defenderHp, accuracy);
  const rawHits = accuracy > 0 ? estimate.expected * accuracy : Infinity;
  // 직전 턴 실패 보너스가 없으면 첫 사용 조각이 같아 estimateKills가 만든 분포를 그대로 쓴다
  const meanModel = failedBonus ? { ...model, first: parts, firstCrit: critParts } : model;
  const damageFraction = defender.maxHp > 0 ? (meanUseDamage(meanModel) / defender.maxHp) * accuracy : 0;
  return applySurvivalGuard({ ...estimate, rawHits, accuracy, typeEffectiveness, damageFraction }, defender, defenderAbility, defenderItem, defenderHp);
}
