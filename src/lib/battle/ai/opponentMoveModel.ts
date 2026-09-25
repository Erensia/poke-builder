import { type Move } from "@/types/move";
import { type PokemonType } from "@/types/pokemon-type";
import { type HazardState } from "@/types/battle";
import { getMove } from "@/lib/data";
import { resolveEffectiveDefenderAbility } from "@/lib/abilityModifiers";
import { isOpponentTargetingMove } from "@/lib/fieldEffects";
import { hasVolatile } from "@/lib/volatileConditions";
import { abilityOf, type BattleFighterState, type BattleSide, type BattleState } from "../state";
import { estimateMoveHits, type MoveHitEstimate } from "./moveDamage";
import { turnsToKo } from "./turnRates";
import { isUsageBlocked } from "./usageConditions";
import { effectKindOf } from "./statusMoveEffects";
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
export function allowedByVolatiles(fighter: BattleFighterState, moves: Move[]): Move[] {
  const { taunt, disable, encore } = fighter.volatile.active;
  return moves.filter((m) => {
    if (taunt && m.category === "status") return false;
    if (disable && disable.moveId === m.id) return false;
    if (encore?.moveId && encore.moveId !== m.id) return false;
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
      return hasVolatile(target.volatile, "confusion");
    case "attract":
      return hasVolatile(target.volatile, "attract") || target.gender === null || user.gender === null || target.gender === user.gender;
    case "leechSeed":
      return hasVolatile(target.volatile, "leechSeed");
    case "yawn":
      return !!target.status.condition || hasVolatile(target.volatile, "drowsy");
    case "regen":
      return hasVolatile(user.volatile, move.setsRegenVolatile!);
    case "haze":
      return Object.values(user.stages).every((v) => v <= 0) && Object.values(target.stages).every((v) => v >= 0);
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
}

/** v1 원안(비교용) */
export const V1_THREAT_MODEL: ThreatModelParams = { statusWeight: W_STATUS, sharpness: 1, strictWaste: false };
/**
 * 기본값(§2-2 튜닝, 2026-09-24): v1 대비 그리디 247→253승, AI끼리 197:196 — 승률 차이는 오차 안이지만 쓸모없는
 * 변화기 제외는 논리적으로 맞고 상대 피해를 덜 과소평가한다. DEFAULT_DECISION_PARAMS도 이 값을 쓴다.
 */
export const DEFAULT_THREAT_MODEL: ThreatModelParams = { statusWeight: 0.08, sharpness: 3, strictWaste: true };
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
  const candidates = allowedByVolatiles(opponent, usableMoves(opponent)).filter((m) => !isUsageBlocked(state, opponent, m, target));
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

  return {
    hitsToBeKilled: {
      expected: turnsToKo(expectedRate, opponent, target, targetHp),
      worstCase: best?.estimate.worstCase ?? { count: 3, certainty: "random", probability: 0 },
    },
    riskFlag,
    defensiveMatchup,
    bestMove: best?.move,
    bestHitFraction: best ? Math.min(1, best.rate) * (targetHp / target.maxHp) : 0,
    expectedRate,
    moveWeights: [
      ...meaningfulStatus.map((move) => ({ move, weight: Math.min(threatModel.statusWeight, 1 / meaningfulStatus.length) })),
      ...attacks.map((a, i) => ({ move: a.move, weight: totalShare > 0 ? (shares[i] / totalShare) * remainingWeight : 0 })),
    ],
  };
}
