import { type Move } from "@/types/move";
import { type PokemonType } from "@/types/pokemon-type";
import { type HazardState } from "@/types/battle";
import { getMove } from "@/lib/data";
import { resolveEffectiveDefenderAbility } from "@/lib/abilityModifiers";
import { isOpponentTargetingMove } from "@/lib/fieldEffects";
import { abilityOf, type BattleFighterState, type BattleSide, type BattleState } from "../state";
import { estimateMoveHits, type MoveHitEstimate } from "./moveDamage";
import { turnsToKo } from "./turnRates";
import { isUsageBlocked } from "./usageConditions";
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
}

/** 상대가 지금 고를 수 있는 기술(남은 PP > 0) */
export function usableMoves(fighter: BattleFighterState): Move[] {
  return Object.entries(fighter.remainingPp)
    .filter(([, pp]) => pp > 0)
    .map(([id]) => getMove(id))
    .filter((m): m is Move => !!m);
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
  return false;
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
 *   변화기(의미 있는 것) 1개당 W_STATUS, 남은 가중치를 공격기에 데미지 비례 분배,
 *   E[턴당 데미지] = Σ weight_i × damage_i (damage_i = 그 기술로 턴당 깎는 현재 HP 비율, 명중률 포함).
 */
export function evaluateOpponentThreat(ctx: ThreatContext): OpponentThreat {
  const { state, opponent, target, targetSide, opponentMovesSecond } = ctx;
  const targetTypes = ctx.targetTypes ?? target.types;
  const targetHp = ctx.targetHp ?? target.currentHp;

  let statusCount = 0;
  let riskFlag = false;
  const attacks: { move: Move; estimate: MoveHitEstimate; rate: number }[] = [];
  let defensiveMatchup = 0;

  // 이번 턴 사용 조건 때문에 반드시 실패하는 기술(첫 턴이 지난 속이기·만나자마자 등)은 위협에서 뺀다.
  for (const move of usableMoves(opponent).filter((m) => !isUsageBlocked(state, opponent, m, target))) {
    if (move.category === "status") {
      if (isOffensiveSetupMove(move)) riskFlag = true;
      if (!isWastedStatusMove(move, opponent, target, targetTypes, targetSide)) statusCount++;
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

  const remainingWeight = Math.max(0, 1 - statusCount * W_STATUS);
  const totalRate = attacks.reduce((sum, a) => sum + a.rate, 0);
  const expectedRate = totalRate > 0 ? attacks.reduce((sum, a) => sum + (a.rate / totalRate) * remainingWeight * a.rate, 0) : 0;

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
  };
}
