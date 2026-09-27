import { type Move } from "@/types/move";
import { type PokemonType } from "@/types/pokemon-type";
import { type HazardState } from "@/types/battle";
import { getMove } from "@/lib/data";
import { rankStageMultiplier } from "@/lib/battlePower";
import { resolveEffectiveDefenderAbility } from "@/lib/abilityModifiers";
import { isOpponentTargetingMove } from "@/lib/fieldEffects";
import { hasVolatile } from "@/lib/volatileConditions";
import { abilityOf, choiceLockedMoveOf, type BattleFighterState, type BattleSide, type BattleState } from "../state";
import { estimateMoveHits, type MoveHitEstimate } from "./moveDamage";
import { blockedTurns, turnsToKo } from "./turnRates";
import { isUsageBlocked } from "./usageConditions";
import { acupressureOptions, effectKindOf, imprisonedMoveIds, sleepTalkCandidates } from "./statusMoveEffects";
import type { HitsEstimate } from "./types";

/** 변화기 1개당 사용 확률(decision-layer §2·§9 초기값) */
export const W_STATUS = 0.15;

export interface OpponentThreat {
  /** 상대 기술 4개 사용 확률 모델로 낸 "내가 쓰러지기까지 기대 턴 수" + 상대 최선 기술 기준 worst_case */
  hitsToBeKilled: HitsEstimate;
  /** 상대가 공격 관련 랭크업 변화기를 보유(decision-layer §2-1) */
  riskFlag: boolean;
  /** 상대 공격기 중 나에게 가장 잘 먹히는 상성 배율(a-defensive, 동률 처리 3순위용) */
  defensiveMatchup: number;
  /** 상대의 최선 공격기(가장 빨리 나를 쓰러뜨리는 기술) — 턴 순서 예측에 쓴다 */
  bestMove?: Move;
  /** 상대가 최선 공격기만 쓸 때 한 턴에 깎이는 내 HP(최대 HP 대비, 명중률 포함) — 회복 루프 판정용 보수적 값 */
  bestHitFraction: number;
  /** 사용 확률 모델 기준 한 턴에 깎이는 내 HP(targetHp 대비 비율, 명중률 포함) — 파티 단위 평가 대면표용 */
  expectedRate: number;
  /** 기술별 사용 확률(의미 있는 변화기 + 공격기, 합 ≤ 1) — 방어류 시뮬레이션에서 상대 행동을 섞을 때 쓴다(§4-4) */
  moveWeights: { move: Move; weight: number }[];
}

/** 상대가 지금 고를 수 있는 기술(남은 PP > 0) */
export function usableMoves(fighter: BattleFighterState): Move[] {
  return Object.entries(fighter.remainingPp)
    .filter(([, pp]) => pp > 0)
    .map(([id]) => getMove(id))
    .filter((m): m is Move => !!m);
}

/**
 * 행동방해 volatile로 막힌 기술을 거른다 — 도발 중이면 변화기 불가, 사슬묶기면 그 기술 불가, 앙코르면 그 기술만.
 * AI 자신의 선택지(selectableMoves)와 상대 기술 사용 확률 모델이 같은 규칙을 쓴다(decision-layer §4-3).
 */
export function allowedByVolatiles(fighter: BattleFighterState, moves: Move[], opponent?: BattleFighterState): Move[] {
  const { taunt, disable, encore, torment } = fighter.volatile.active;
  // 봉인(트랙 M2): 상대가 봉인을 썼으면 상대도 배운 기술은 못 쓴다
  const imprisoner = opponent?.volatile.active.imprison ? opponent : undefined;
  // 구애류 잠금(엔진 state — 트랙 M1)도 같은 축의 제한으로 본다
  const choiceLocked = choiceLockedMoveOf(fighter);
  return moves.filter((m) => {
    if (choiceLocked && m.id !== choiceLocked) return false;
    if (taunt && m.category === "status") return false;
    if (disable && disable.moveId === m.id) return false;
    if (encore?.moveId && encore.moveId !== m.id) return false;
    // 트집(트랙 M2): 직전에 쓴 기술은 이번 턴에 못 쓴다
    if (torment && fighter.lastMoveId === m.id) return false;
    if (imprisoner && imprisoner.remainingPp[m.id] !== undefined) return false;
    return true;
  });
}

function hazardAlreadyMaxed(hazards: HazardState, kind: NonNullable<Move["setsHazard"]>): boolean {
  switch (kind) {
    case "stealthRock":
      return hazards.stealthRock;
    case "stickyWeb":
      return hazards.stickyWeb;
    case "spikes":
      return hazards.spikesLayers >= 3;
    case "toxicSpikes":
      return hazards.toxicSpikesLayers >= 2;
  }
}

/**
 * 변화기가 이번 판에서 "의미 없는 기술"이라 가중치 0인지(decision-layer §2 중복 함정 + extension §3-5).
 *  - 이미 최대로 깔린 설치기
 *  - 황금몸/매직미러 상대에게 쓰는 상대 대상 변화기
 *  - 독·강철 타입에게 쓰는 독 부여 변화기(공격측이 부식이면 예외)
 */
function isWastedStatusMove(
  move: Move,
  user: BattleFighterState,
  target: BattleFighterState,
  targetTypes: PokemonType[],
  targetSide: BattleSide,
): boolean {
  if (move.setsHazard && hazardAlreadyMaxed(targetSide.hazards, move.setsHazard)) return true;
  const userAbility = abilityOf(user);
  const targetAbility = resolveEffectiveDefenderAbility(userAbility, abilityOf(target));
  if (
    isOpponentTargetingMove(move) &&
    (targetAbility?.blocksOpponentStatusMoveEffects || targetAbility?.reflectsOpponentStatusMoves)
  ) {
    return true;
  }
  const poisonsOnly =
    !!move.inflictsStatus?.length &&
    move.inflictsStatus.every((s) => s.status === "poison" || s.status === "badly-poisoned");
  if (poisonsOnly && (targetTypes.includes("독") || targetTypes.includes("강철")) && !userAbility?.bypassesPoisonTypeImmunity) {
    return true;
  }
  // 신비의부적이 깔린 편에는 상태이상 부여·하품이 통하지 않는다(AI-A1)
  if (targetSide.safeguardTurnsRemaining !== undefined && (move.inflictsStatus?.length || effectKindOf(move) === "yawn")) return true;
  if (move.setsLeechSeed && targetTypes.includes("풀")) return true;
  // 대타(AI-A2): 대상이 대타를 세웠으면 상대 대상 변화기는 막힌다(소리 기술·틈새포착 제외 — effectMoveFails와 같은 축)
  if (
    target.substituteHp !== undefined &&
    isOpponentTargetingMove(move) &&
    !(move.classification ?? []).includes("소리") &&
    !userAbility?.bypassesScreensAndSubstitute
  ) {
    return true;
  }
  return false;
}

/**
 * 지금 써 봐야 효과가 없는 변화기(threatStrictWaste, decision-layer §2-2): HP가 가득인데 회복기, 올릴 스탯이 전부 +6인
 * 랭크업기, 이미 자기 편에 깔린 벽, 이미 상태이상인 대상에게 거는 상태이상기. 상대가 합리적이면 이런 기술에
 * 턴을 쓰지 않으니 사용 확률을 공격기로 돌린다.
 */
function isPointlessNow(state: BattleState, move: Move, user: BattleFighterState, target: BattleFighterState): boolean {
  const heals = (move.healsFraction && move.healsTarget !== "opponent") || move.healsWeatherDependent || move.restSleep;
  if (heals && user.currentHp >= user.maxHp && !(move.restSleep && user.status.condition)) return true;
  const raises =
    move.statChanges?.filter((s) => s.target === "self" && ((s.delta ?? 0) > 0 || (s.setTo ?? 0) > 0) && s.stat in user.stages) ?? [];
  if (raises.length > 0 && raises.every((s) => user.stages[s.stat as keyof typeof user.stages] >= 6)) return true;
  // AI-A1 변화기: 이미 걸려 있음·효과 없음(effectMoveFails와 같은 축의 빠른 판정 — 대상이 대기 포켓몬일 수도 있어 직접 본다)
  switch (effectKindOf(move)) {
    case "confuse":
      return hasVolatile(target.volatile, "confusion") || !!abilityOf(target)?.immuneToConfusion;
    case "attract":
      return (
        hasVolatile(target.volatile, "attract") ||
        target.gender === null ||
        user.gender === null ||
        target.gender === user.gender ||
        !!abilityOf(target)?.immuneToAttractAndTaunt
      );
    case "leechSeed":
      return hasVolatile(target.volatile, "leechSeed");
    case "yawn":
      return !!target.status.condition || hasVolatile(target.volatile, "drowsy");
    case "regen":
      return hasVolatile(user.volatile, move.setsRegenVolatile!);
    case "haze":
      return Object.values(user.stages).every((v) => v <= 0) && Object.values(target.stages).every((v) => v >= 0);
    // AI-A2
    case "substitute":
      return user.substituteHp !== undefined || user.currentHp <= Math.floor(user.maxHp / 4);
    // 트랙 M1
    case "tailwind": {
      const userSide = state.sideA.party.includes(user) ? state.sideA : state.sideB;
      return (userSide.tailwindTurnsRemaining ?? 0) > 0;
    }
    case "recycle":
      return !!user.currentItemId || !user.lastConsumedItemId;
    case "itemSwap":
      return !user.currentItemId && !target.currentItemId;
    case "phaze": {
      const targetSide = state.sideA.party.includes(target) ? state.sideA : state.sideB;
      return !targetSide.party.some((f) => f !== target && f.currentHp > 0);
    }
    // 트랙 M2
    case "torment":
      return hasVolatile(target.volatile, "torment");
    case "imprison":
      return hasVolatile(user.volatile, "imprison") || imprisonedMoveIds(user, target).length === 0;
    case "spite": {
      const remaining = target.lastMoveId ? target.remainingPp[target.lastMoveId] : undefined;
      return remaining === undefined || remaining <= 0;
    }
    case "acupressure":
      return acupressureOptions(user).length === 0;
    // 트랙 M4
    case "gravity":
      return state.gravityTurnsRemaining !== undefined;
    case "magnetRise":
      return state.gravityTurnsRemaining !== undefined || !!user.smackedDown || (user.magnetRiseTurnsRemaining ?? 0) > 0;
  }
  if (move.setsScreen) {
    const userSide = state.sideA.party.includes(user) ? state.sideA : state.sideB;
    if (userSide.screens[move.setsScreen] !== undefined) return true;
  }
  if (move.inflictsStatus?.length && !move.statChanges?.length && target.status.condition) return true;
  return false;
}

/** 상대 기술 사용 확률 모델의 튜닝값(decision-layer §2-2) */
export interface ThreatModelParams {
  /** 의미 있는 변화기 1개당 사용 확률 */
  statusWeight: number;
  /** 공격기 분배 날카로움: 데미지^k 비례. 1 = 데미지 비례(v1), 클수록 최선기에 몰린다 */
  sharpness: number;
  /** isPointlessNow 변화기도 사용 확률 0으로 */
  strictWaste: boolean;
  /**
   * 상대 변화기의 위협 환산(ver.1.8 한계점 정리 ③): 의미 있는 변화기가 앞으로 대면에 미칠 해(랭크업·상태이상 → 내가 버티는
   * 턴, 회복·벽·나에게 거는 상태이상·랭크다운 → 내가 쓰러뜨리는 턴)를 센다. false면 "그 턴 공격 안 함"으로만(이전 동작)
   */
  statusThreat?: boolean;
}

/** v1 원안(비교용) */
export const V1_THREAT_MODEL: ThreatModelParams = { statusWeight: W_STATUS, sharpness: 1, strictWaste: false };
/**
 * 기본값(§2-2 튜닝, 2026-09-24): v1 대비 그리디 247→253승, AI끼리 197:196 — 승률 차이는 오차 안이지만 쓸모없는
 * 변화기 제외는 논리적으로 맞고 상대 피해를 덜 과소평가한다. DEFAULT_DECISION_PARAMS도 이 값을 쓴다.
 */
export const DEFAULT_THREAT_MODEL: ThreatModelParams = { statusWeight: 0.08, sharpness: 3, strictWaste: true, statusThreat: true };
let threatModel: ThreatModelParams = DEFAULT_THREAT_MODEL;

/**
 * fn 실행 동안만 상대 기술 모델 튜닝값을 바꾼다. 평가 함수가 여러 겹이라 인자로 끝까지 내리는 대신 이렇게 감싼다 —
 * 동기 실행이라 AI끼리 다른 값으로 붙이는 시뮬레이션에서도 서로 섞이지 않는다.
 */
export function withThreatModel<T>(model: ThreatModelParams, fn: () => T): T {
  const previous = threatModel;
  threatModel = model;
  try {
    return fn();
  } finally {
    threatModel = previous;
  }
}

/** 공격 관련 스탯(공격·특공)을 올리는 자기 대상 변화기 */
export function isOffensiveSetupMove(move: Move): boolean {
  return (
    move.category === "status" &&
    !!move.statChanges?.some((s) => s.target === "self" && (s.stat === "atk" || s.stat === "spa") && (s.delta ?? 0) > 0)
  );
}

export interface ThreatContext {
  state: BattleState;
  opponent: BattleFighterState;
  /** 공격받는 쪽(내 활성 포켓몬 또는 교체 후보) */
  target: BattleFighterState;
  targetSide: BattleSide;
  opponentMovesSecond: boolean;
  /** 변환자재 등으로 이번 턴 바뀔 내 타입 */
  targetTypes?: PokemonType[];
  /** 교체 후보의 진입 비용 차감 후 HP */
  targetHp?: number;
}

/**
 * 상대 기술 사용 확률 모델(decision-layer §2 + extension §7-2 명중률).
 *   변화기(의미 있는 것) 1개당 statusWeight, 남은 가중치를 공격기에 데미지^sharpness 비례 분배(§2-2 튜닝값),
 *   E[턴당 데미지] = Σ weight_i × damage_i (damage_i = 그 기술로 턴당 깎는 현재 HP 비율, 명중률 포함).
 */
/** 상대(user)가 target에게 이번 판에 쓸 만한(헛수고가 아닌) 변화기 — 위협 모델과 위협 환산이 함께 쓴다 */
function meaningfulStatusMoves(
  state: BattleState,
  user: BattleFighterState,
  target: BattleFighterState,
  targetTypes: PokemonType[],
  targetSide: BattleSide,
): Move[] {
  return allowedByVolatiles(user, usableMoves(user), target)
    .filter((m) => !isUsageBlocked(state, user, m, target))
    .filter(
      (move) =>
        move.category === "status" &&
        !isWastedStatusMove(move, user, target, targetTypes, targetSide) &&
        !(threatModel.strictWaste && isPointlessNow(state, move, user, target)),
    );
}

/** 변화기가 효과를 내는 기간 비율(대면 길이의 절반쯤부터 효과 — 1~3배) */
function statusHorizon(turns: number): number {
  return Number.isFinite(turns) ? Math.min(3, Math.max(1, turns / 2)) : 3;
}

/** 자기 대상 랭크 상승 중 stats에 해당하는 최대 배율(없으면 1) */
function selfBoostMultiplier(move: Move, user: BattleFighterState, stats: readonly string[]): number {
  let best = 1;
  for (const s of move.statChanges ?? []) {
    if (s.target !== "self" || !stats.includes(s.stat)) continue;
    const current = user.stages[s.stat as keyof typeof user.stages] ?? 0;
    const next = s.setTo !== undefined ? s.setTo : Math.min(6, current + (s.delta ?? 0));
    if (next > current) best = Math.max(best, rankStageMultiplier(next) / rankStageMultiplier(current));
  }
  return best;
}

/** 대상 상태이상 부여 기술이 거는 주 상태이상(첫 번째, 확률 100%인 변화기만) */
function inflictedStatusOf(move: Move): string | undefined {
  const effect = move.inflictsStatus?.find((s) => s.chance === undefined || s.chance >= 100);
  return effect?.status;
}

/**
 * 위협 환산 — 내가 버티는 쪽(d): 상대 랭크업기(공격·특공 상승)는 이후 상대 공격이 세지는 몫, 나에게 거는 독·화상은 매 턴
 * 피해. 반환: 상대 공격 속도 배율 증가분(dRateBonus)과 내 최대 HP 대비 매 턴 추가 피해(dResidual).
 */
function statusThreatOnSurvival(
  statusMoves: Move[],
  user: BattleFighterState,
  target: BattleFighterState,
  horizon: number,
): { dRateBonus: number; dResidual: number } {
  const w = threatModel.statusWeight;
  let dRateBonus = 0;
  let dResidual = 0;
  for (const move of statusMoves) {
    const boost = selfBoostMultiplier(move, user, ["atk", "spa"]);
    if (boost > 1) dRateBonus += w * horizon * (boost - 1);
    if (target.status.condition) continue;
    const status = inflictedStatusOf(move);
    if (status === "burn") dResidual += w * horizon * (1 / 16);
    else if (status === "poison") dResidual += w * horizon * (1 / 8);
    else if (status === "badly-poisoned") dResidual += w * horizon * (2 / 16);
  }
  return { dRateBonus, dResidual };
}

/**
 * 위협 환산 — 내가 쓰러뜨리는 쪽(c, ver.1.8 한계점 정리 ③): user(상대)의 의미 있는 변화기가 attacker(나)의 공격 효율을 깎는 몫.
 * 회복기(매 턴 기대 회복 = 사용 확률 × 회복량), 벽(내 데미지 절반), 나에게 거는 화상·마비·수면, 내 공격·특공 랭크다운,
 * 상대 자신의 방어·특방 상승. 반환: 내 공격 속도 배율(rateMult ≤ 1)과 상대 최대 HP 대비 매 턴 기대 회복(heal).
 */
export function opponentStatusDrag(
  state: BattleState,
  user: BattleFighterState,
  attacker: BattleFighterState,
  attackerSide: BattleSide,
  horizonTurns: number,
): { rateMult: number; heal: number } {
  if (!threatModel.statusThreat) return { rateMult: 1, heal: 0 };
  const statusMoves = meaningfulStatusMoves(state, user, attacker, attacker.types, attackerSide);
  if (statusMoves.length === 0) return { rateMult: 1, heal: 0 };
  const w = threatModel.statusWeight;
  const horizon = statusHorizon(horizonTurns);
  let rateMult = 1;
  let heal = 0;
  for (const move of statusMoves) {
    if (move.healsFraction && move.healsTarget !== "opponent") heal += w * move.healsFraction;
    else if (move.healsWeatherDependent) heal += w * 0.5;
    if (move.setsScreen) rateMult *= 1 - Math.min(0.5, w * horizon * 0.5);
    const defense = selfBoostMultiplier(move, user, ["def", "spd"]);
    if (defense > 1) rateMult *= 1 / (1 + w * horizon * (defense - 1));
    if (!attacker.status.condition) {
      const status = inflictedStatusOf(move);
      if (status === "burn") rateMult *= 1 - w * horizon * 0.5;
      else if (status === "paralysis") rateMult *= 1 - w * horizon * 0.25;
      else if (status === "sleep") rateMult *= 1 - w * horizon * 0.5;
    }
    for (const s of move.statChanges ?? []) {
      if (s.target === "opponent" && (s.stat === "atk" || s.stat === "spa") && (s.delta ?? 0) < 0) {
        rateMult *= 1 - w * horizon * (1 - rankStageMultiplier(s.delta ?? 0));
        break;
      }
    }
  }
  return { rateMult: Math.max(0.2, rateMult), heal };
}

export function evaluateOpponentThreat(ctx: ThreatContext): OpponentThreat {
  const { state, opponent, target, targetSide, opponentMovesSecond } = ctx;
  const targetTypes = ctx.targetTypes ?? target.types;
  const targetHp = ctx.targetHp ?? target.currentHp;

  const meaningfulStatus: Move[] = [];
  let riskFlag = false;
  const attacks: { move: Move; estimate: MoveHitEstimate; rate: number }[] = [];
  let defensiveMatchup = 0;

  // 이번 턴 사용 조건 때문에 반드시 실패하는 기술(첫 턴이 지난 속이기·만나자마자 등)과 도발·앙코르·사슬묶기로
  // 막힌 기술은 위협에서 뺀다.
  const candidates = allowedByVolatiles(opponent, usableMoves(opponent), target).filter((m) => !isUsageBlocked(state, opponent, m, target));
  for (const move of candidates) {
    if (move.category === "status") {
      if (isOffensiveSetupMove(move)) riskFlag = true;
      const wasted =
        isWastedStatusMove(move, opponent, target, targetTypes, targetSide) ||
        (threatModel.strictWaste && isPointlessNow(state, move, opponent, target));
      if (!wasted) meaningfulStatus.push(move);
      continue;
    }
    const estimate = estimateMoveHits(
      { state, attacker: opponent, defender: target, defenderSide: targetSide, attackerMovesSecond: opponentMovesSecond, defenderTypes: targetTypes, defenderHp: targetHp },
      move,
    );
    if (!estimate) continue;
    defensiveMatchup = Math.max(defensiveMatchup, estimate.typeEffectiveness);
    if (!Number.isFinite(estimate.expected) || estimate.expected <= 0) continue;
    attacks.push({ move, estimate, rate: 1 / estimate.expected });
  }

  const remainingWeight = Math.max(0, 1 - meaningfulStatus.length * threatModel.statusWeight);
  // 공격기 사용 확률 ∝ 데미지^k (k = sharpness, 1이면 v1의 데미지 비례)
  const shares = attacks.map((a) => a.rate ** threatModel.sharpness);
  const totalShare = shares.reduce((sum, s) => sum + s, 0);
  const expectedRate =
    totalShare > 0 ? attacks.reduce((sum, a, i) => sum + (shares[i] / totalShare) * remainingWeight * a.rate, 0) : 0;

  const best = attacks.reduce<(typeof attacks)[number] | undefined>(
    (acc, a) => (!acc || a.estimate.expected < acc.estimate.expected ? a : acc),
    undefined,
  );

  // 잠꼬대(AI-A2): 상대가 잠들어 있고 잠꼬대를 쓸 수 있으면, 잠든 턴에도 무작위 기술의 평균 피해를 준다.
  // 대타를 깨는 턴 계산용 절대 데미지(최대 HP 대비) — 사용 확률 가중 평균
  const expectedDamage =
    totalShare > 0 ? attacks.reduce((sum, a, i) => sum + (shares[i] / totalShare) * remainingWeight * a.estimate.damageFraction, 0) : 0;
  // 위협 환산(ver.1.8 한계점 정리 ③): 상대 랭크업기·나에게 거는 독·화상이 앞으로 끼칠 해를 공격 속도에 얹는다
  let threatRate = expectedRate;
  let threatDamage = expectedDamage;
  if (threatModel.statusThreat && meaningfulStatus.length > 0 && targetHp > 0) {
    const horizon = statusHorizon(expectedRate > 0 ? 1 / expectedRate : Infinity);
    const { dRateBonus, dResidual } = statusThreatOnSurvival(meaningfulStatus, opponent, target, horizon);
    threatRate = expectedRate * (1 + dRateBonus) + (dResidual * target.maxHp) / targetHp;
    threatDamage = expectedDamage * (1 + dRateBonus) + dResidual;
  }
  let expectedTurns = turnsToKo(threatRate, opponent, target, targetHp, threatDamage, ctx.state);
  const asleep = blockedTurns(opponent);
  const sleepTalk = asleep > 0 ? candidates.find((m) => m.callsRandomLearnedMove) : undefined;
  if (sleepTalk) {
    const pool = sleepTalkCandidates(opponent, sleepTalk);
    const rates = pool.map((m) => attacks.find((a) => a.move.id === m.id)?.rate ?? 0);
    const rate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
    if (rate > 0) {
      expectedTurns =
        asleep * rate >= 1
          ? Math.max(1, 1 / rate)
          : asleep + (Number.isFinite(expectedTurns) ? Math.max(0, expectedTurns - asleep) : Infinity) * (1 - asleep * rate);
    }
  }

  return {
    hitsToBeKilled: {
      expected: expectedTurns,
      worstCase: best?.estimate.worstCase ?? { count: 3, certainty: "random", probability: 0 },
    },
    riskFlag,
    defensiveMatchup,
    bestMove: best?.move,
    bestHitFraction: best ? Math.min(1, best.rate) * (targetHp / target.maxHp) : 0,
    expectedRate: threatRate,
    moveWeights: [
      ...meaningfulStatus.map((move) => ({ move, weight: Math.min(threatModel.statusWeight, 1 / meaningfulStatus.length) })),
      ...attacks.map((a, i) => ({ move: a.move, weight: totalShare > 0 ? (shares[i] / totalShare) * remainingWeight : 0 })),
    ],
  };
}
