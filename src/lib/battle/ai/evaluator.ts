import { type FighterKey } from "@/types/battle";
import { type Move } from "@/types/move";
import { type PokemonType } from "@/types/pokemon-type";
import { type StatStages } from "@/types/battleStats";
import { applyMoveStatChanges } from "@/lib/statStages";
import { compareTurnOrder } from "@/lib/turnOrder";
import {
  abilityOf,
  cloneSide,
  isFainted,
  opponentKey,
  sideOf,
  type BattleFighterState,
  type BattleSide,
  type BattleState,
} from "../state";
import { applyMegaEvolution, isTrappedFromSwitching } from "../switching";
import { calcEntryHazardDamage } from "../entryCost";
import { buildTurnOrderActor, effectiveHeldItem } from "../turnOrderInputs";
import { estimateMoveHits, type MoveHitEstimate } from "./moveDamage";
import { evaluateOpponentThreat, usableMoves, type OpponentThreat } from "./opponentMoveModel";
import { turnsToKo } from "./turnRates";
import type { HitsEstimate } from "./types";

export type SpeedOrder = "first" | "second" | "speed_tie";

/** 데미지 없는 변화기 옵션의 종류(extension §2-2) */
export type SupportKind = "heal" | "setup" | "other";

/** 공통 평가 엔진 출력(common-engine §5 v1.1 + extension 반영). 6개 옵션이 모두 이 구조다. */
export interface AiOption {
  optionType: "move" | "switch";
  /** 기술 id 또는 교체할 파티 인덱스 */
  move?: Move;
  toIndex?: number;
  /** 이 기술을 쓸 때 메가진화를 같이 선언하는지 */
  mega?: boolean;
  typeMatchup: { offensive: number; defensive: number };
  speedOrder: SpeedOrder;
  /** 선공 확률(0~1). speed_adjustment = firstProbability − 0.5 로 쓴다 — 선제공격손톱까지 반영 */
  firstProbability: number;
  hitsToKill: HitsEstimate;
  hitsToBeKilled: HitsEstimate;
  entryCost: number;
  maxHp: number;
  /** 대면 시작 시점 내 HP / 최대 HP (교체는 진입 비용 차감 후) — trade 채점용 */
  hpFraction: number;
  /** 상대 현재 HP / 최대 HP — trade 채점용 */
  opponentHpFraction: number;
  riskFlag: boolean;
  /** 이 기술(교체면 그 포켓몬의 최선 기술)의 명중률 — 하드 오버라이드 필중 게이트용 */
  accuracy: number;
  /**
   * 데미지 없는 변화기일 때만. before/after = 회복이면 hits_to_be_killed(회복 전/후), 랭크업이면
   * 내 최선 공격의 hits_to_kill(랭크업 전/후). bestKillTurns = 이 턴 공격 안 하면 쓰게 될 내 최선 공격의 처치 턴 수.
   */
  support?: { kind: SupportKind; before: number; after: number; bestKillTurns: number; healedHpFraction?: number };
  /**
   * 유턴·볼트체인지·퀵턴처럼 맞히면 교체되는 기술(selfSwitchAfterDamage)이고 교대할 포켓몬이 있을 때만.
   * hitRate = 한 번 맞혔을 때 깎는 상대 현재 HP 비율(0~1), activeHitLoss = 지금 포켓몬이 상대 공격을 한 번
   * 맞을 때 잃는 HP 비율(최대 HP 대비), candidates = 그 데미지를 받은 상대 기준으로 다시 평가한 교체 후보들.
   */
  pivot?: { hitRate: number; activeHitLoss: number; candidates: AiOption[] };
}

export interface EvaluateOptions {
  /** 이번 턴 고를 수 있는 기술 id(구애 고정 등 UI 판정 반영). 생략하면 PP·도발·사슬묶기·앵콜만으로 거른다 */
  legalMoveIds?: string[];
}

function cloneBattleState(state: BattleState): BattleState {
  const sideA = cloneSide(state.sideA);
  const sideB = cloneSide(state.sideB);
  return {
    ...state,
    a: sideA.party[sideA.activeIndex],
    b: sideB.party[sideB.activeIndex],
    sideA,
    sideB,
    entryAnnouncements: [],
  };
}

function canMegaEvolve(state: BattleState, key: FighterKey): boolean {
  const fighter = state[key];
  return !sideOf(state, key).megaUsed && !fighter.hasMegaEvolved && !!fighter.megaStone && !isFainted(fighter);
}

/** 사람이 고를 수 있는 기술과 같은 기준(PP > 0, 도발 중 변화기·사슬묶기·앵콜 제외) */
export function selectableMoves(fighter: BattleFighterState, legalMoveIds?: string[]): Move[] {
  const moves = usableMoves(fighter);
  if (legalMoveIds) return moves.filter((m) => legalMoveIds.includes(m.id));
  const { taunt, disable, encore } = fighter.volatile.active;
  return moves.filter((m) => {
    if (taunt && m.category === "status") return false;
    if (disable && disable.moveId === m.id) return false;
    if (encore?.moveId && encore.moveId !== m.id) return false;
    return true;
  });
}

/**
 * me가 move를, opponent가 opponentMove를 쓸 때 me가 먼저 움직일 확률.
 * 우선도·스피드·트릭룸은 compareTurnOrder(실전과 동일), 선제공격손톱은 우선도가 같을 때만 확률로 끼어든다.
 */
function firstProbability(
  state: BattleState,
  me: BattleFighterState,
  move: Move,
  opponent: BattleFighterState,
  opponentMove: Move | undefined,
): { probability: number; order: SpeedOrder } {
  if (!opponentMove) return { probability: 1, order: "first" };
  const mine = buildTurnOrderActor(state, me, move);
  const theirs = buildTurnOrderActor(state, opponent, opponentMove);
  const trickRoom = state.trickRoomTurnsRemaining !== undefined;
  const lowRoll = compareTurnOrder(mine, theirs, () => 0, trickRoom);
  const highRoll = compareTurnOrder(mine, theirs, () => 0.99, trickRoom);
  const base = lowRoll !== highRoll ? 0.5 : lowRoll === 0 ? 1 : 0;
  const order: SpeedOrder = lowRoll !== highRoll ? "speed_tie" : lowRoll === 0 ? "first" : "second";
  if (mine.move.priority !== theirs.move.priority) return { probability: base, order };
  const qMe = (effectiveHeldItem(me)?.quickClawChance ?? 0) / 100;
  const qThem = (effectiveHeldItem(opponent)?.quickClawChance ?? 0) / 100;
  const onlyMe = qMe * (1 - qThem);
  const neitherOrBoth = (1 - qMe) * (1 - qThem) + qMe * qThem;
  return { probability: onlyMe + neitherOrBoth * base, order };
}

interface AttackPick {
  move: Move;
  estimate: MoveHitEstimate;
}

interface BestAttackInput {
  state: BattleState;
  attacker: BattleFighterState;
  defender: BattleFighterState;
  defenderSide: BattleSide;
  moves: Move[];
  attackerMovesSecond: boolean;
  stagesOverride?: StatStages;
  defenderHp?: number;
}

/** attacker가 가진 공격기 중 defender를 가장 빨리 쓰러뜨리는 것 */
function bestAttack(input: BestAttackInput): AttackPick | undefined {
  const { state, attacker, defender, defenderSide, moves, attackerMovesSecond, stagesOverride, defenderHp } = input;
  const actor = stagesOverride ? { ...attacker, stages: stagesOverride } : attacker;
  let best: AttackPick | undefined;
  for (const move of moves) {
    const estimate = estimateMoveHits({ state, attacker: actor, defender, defenderSide, attackerMovesSecond, defenderHp }, move);
    if (!estimate || !Number.isFinite(estimate.expected)) continue;
    if (!best || estimate.expected < best.estimate.expected) best = { move, estimate };
  }
  return best;
}

function turnsFor(
  estimate: MoveHitEstimate | undefined,
  attacker: BattleFighterState,
  defender: BattleFighterState,
  defenderHp?: number,
): HitsEstimate {
  if (!estimate || !Number.isFinite(estimate.expected)) {
    return { expected: Infinity, worstCase: { count: 3, certainty: "random", probability: 0 } };
  }
  return { expected: turnsToKo(1 / estimate.expected, attacker, defender, defenderHp), worstCase: estimate.worstCase };
}

/** key 편에서 index 슬롯으로 교체하는 옵션. opponentHp를 주면 상대가 그 HP라고 가정한다(유턴류 평가용). */
function evaluateSwitchCandidate(state: BattleState, key: FighterKey, index: number, opponentHp?: number): AiOption {
  const mySide = sideOf(state, key);
  const oppKey = opponentKey(key);
  const oppSide = sideOf(state, oppKey);
  const candidate = mySide.party[index];
  const opponent = state[oppKey];
  const oppHp = opponentHp ?? opponent.currentHp;
  const entryCost = Math.min(
    candidate.currentHp,
    calcEntryHazardDamage(candidate.maxHp, candidate.types, abilityOf(candidate), mySide.hazards),
  );
  const hpAfterEntry = candidate.currentHp - entryCost;
  const pick = bestAttack({
    state,
    attacker: candidate,
    defender: opponent,
    defenderSide: oppSide,
    moves: usableMoves(candidate),
    attackerMovesSecond: false,
    defenderHp: oppHp,
  });
  const threatProbe = evaluateOpponentThreat({ state, opponent, target: candidate, targetSide: mySide, opponentMovesSecond: false, targetHp: hpAfterEntry });
  const speed = pick
    ? firstProbability(state, candidate, pick.move, opponent, threatProbe.bestMove)
    : { probability: 0, order: "second" as const };
  const threat =
    hpAfterEntry <= 0
      ? { ...threatProbe, hitsToBeKilled: { expected: 0, worstCase: { count: 1, certainty: "guaranteed" as const, probability: 1 } } }
      : evaluateOpponentThreat({ state, opponent, target: candidate, targetSide: mySide, opponentMovesSecond: speed.probability >= 0.5, targetHp: hpAfterEntry });
  return {
    optionType: "switch",
    toIndex: index,
    typeMatchup: { offensive: pick?.estimate.typeEffectiveness ?? 0, defensive: threat.defensiveMatchup },
    speedOrder: speed.order,
    firstProbability: speed.probability,
    hitsToKill: turnsFor(pick?.estimate, candidate, opponent, oppHp),
    hitsToBeKilled: threat.hitsToBeKilled,
    entryCost,
    maxHp: candidate.maxHp,
    hpFraction: Math.max(0, hpAfterEntry) / candidate.maxHp,
    opponentHpFraction: oppHp / opponent.maxHp,
    riskFlag: threat.riskFlag,
    accuracy: pick?.estimate.accuracy ?? 0,
  };
}

/** 지금 교대로 내보낼 수 있는 슬롯(활성 아님 + 안 쓰러짐) */
function benchIndices(side: BattleSide): number[] {
  return side.party.map((_, i) => i).filter((i) => i !== side.activeIndex && !isFainted(side.party[i]));
}

function proteanTypes(me: BattleFighterState, move: Move): PokemonType[] | undefined {
  const ability = abilityOf(me);
  if (!ability?.changesUserTypeToMoveType || me.proteanActivatedSinceSwitchIn || !move.type) return undefined;
  return [move.type];
}

function classifySupport(move: Move): SupportKind {
  if (move.healsFraction && move.healsTarget !== "opponent") return "heal";
  if (move.statChanges?.some((s) => s.target === "self" && (s.delta ?? 0) > 0)) return "setup";
  return "other";
}

/**
 * 공통 평가 엔진: key 편의 이번 턴 옵션(기술 최대 4 + 교체 후보)을 전부 같은 항목(a~e)으로 평가한다.
 * 메가진화가 가능하면 기술 옵션은 메가진화한 상태로 평가하고 mega: true로 표시한다(교체 옵션은 메가 없음).
 */
export function evaluateOptions(state: BattleState, key: FighterKey, options: EvaluateOptions = {}): AiOption[] {
  const oppKey = opponentKey(key);
  const mySide = sideOf(state, key);
  const result: AiOption[] = [];

  // ── 기술 옵션 ──
  const mega = canMegaEvolve(state, key);
  const moveState = mega ? cloneBattleState(state) : state;
  if (mega) applyMegaEvolution(moveState, key, []);
  const me = moveState[key];
  const opponent = moveState[oppKey];
  const myMoveSide = sideOf(moveState, key);
  const oppMoveSide = sideOf(moveState, oppKey);
  const myMoves = selectableMoves(me, options.legalMoveIds);

  const baseThreat = evaluateOpponentThreat({ state: moveState, opponent, target: me, targetSide: myMoveSide, opponentMovesSecond: false });
  const myBest = bestAttack({ state: moveState, attacker: me, defender: opponent, defenderSide: oppMoveSide, moves: myMoves, attackerMovesSecond: false });
  const bench = benchIndices(mySide);

  for (const move of myMoves) {
    const speed = firstProbability(moveState, me, move, opponent, baseThreat.bestMove);
    const iMoveSecond = speed.probability < 0.5;
    const myTypes = proteanTypes(me, move);
    const threat: OpponentThreat = evaluateOpponentThreat({
      state: moveState,
      opponent,
      target: me,
      targetSide: myMoveSide,
      opponentMovesSecond: !iMoveSecond,
      targetTypes: myTypes,
    });
    const estimate = estimateMoveHits(
      { state: moveState, attacker: me, defender: opponent, defenderSide: oppMoveSide, attackerMovesSecond: iMoveSecond, attackerTypes: myTypes },
      move,
    );

    const option: AiOption = {
      optionType: "move",
      move,
      mega: mega || undefined,
      typeMatchup: { offensive: estimate?.typeEffectiveness ?? 0, defensive: threat.defensiveMatchup },
      speedOrder: speed.order,
      firstProbability: speed.probability,
      hitsToKill: turnsFor(estimate ?? undefined, me, opponent),
      hitsToBeKilled: threat.hitsToBeKilled,
      entryCost: 0,
      maxHp: me.maxHp,
      hpFraction: me.currentHp / me.maxHp,
      opponentHpFraction: opponent.currentHp / opponent.maxHp,
      riskFlag: threat.riskFlag,
      accuracy: estimate?.accuracy ?? 0,
    };

    // 유턴류: 맞히면(상대 기절 여부 무관) 교대할 포켓몬이 있는 한 엔진이 교체를 강제한다. 한 방에 쓰러뜨리면
    // 다음 상대를 모르므로 일반 공격기로만 평가한다.
    if (move.selfSwitchAfterDamage && estimate && estimate.rawHits > 1 && Number.isFinite(estimate.rawHits) && bench.length > 0) {
      const hitRate = 1 / estimate.rawHits;
      const opponentHpAfter = Math.max(1, Math.round(opponent.currentHp * (1 - hitRate)));
      const d = threat.hitsToBeKilled.expected;
      option.pivot = {
        hitRate,
        activeHitLoss: (me.currentHp / me.maxHp) * Math.min(1, d > 0 ? 1 / d : 1),
        candidates: bench.map((index) => evaluateSwitchCandidate(state, key, index, opponentHpAfter)),
      };
    }

    if (move.category === "status") {
      const kind = classifySupport(move);
      const bestKillTurns = turnsFor(myBest?.estimate, me, opponent).expected;
      if (kind === "heal") {
        const healedHp = Math.min(me.maxHp, me.currentHp + Math.floor(me.maxHp * (move.healsFraction ?? 0)));
        const after = evaluateOpponentThreat({ state: moveState, opponent, target: me, targetSide: myMoveSide, opponentMovesSecond: !iMoveSecond, targetHp: healedHp });
        option.support = {
          kind,
          before: threat.hitsToBeKilled.expected,
          after: after.hitsToBeKilled.expected,
          bestKillTurns,
          healedHpFraction: healedHp / me.maxHp,
        };
      } else if (kind === "setup") {
        const boosted = applyMoveStatChanges(me.stages, move, "self", { userTypes: me.types });
        const after = bestAttack({
          state: moveState,
          attacker: me,
          defender: opponent,
          defenderSide: oppMoveSide,
          moves: myMoves,
          attackerMovesSecond: iMoveSecond,
          stagesOverride: boosted,
        });
        option.support = { kind, before: bestKillTurns, after: turnsFor(after?.estimate, me, opponent).expected, bestKillTurns };
      } else {
        option.support = { kind, before: 0, after: 0, bestKillTurns };
      }
    }
    result.push(option);
  }

  // ── 교체 옵션 ── (교체 턴에는 메가진화 없음 → 원래 state 기준)
  if (!isTrappedFromSwitching(state[key])) {
    for (const index of benchIndices(mySide)) result.push(evaluateSwitchCandidate(state, key, index));
  }

  return result;
}
