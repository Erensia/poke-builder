import { type FighterKey } from "@/types/battle";
import { type Move } from "@/types/move";
import { type PokemonType } from "@/types/pokemon-type";
import { type StatStages } from "@/types/battleStats";
import { applyMoveStatChanges } from "@/lib/statStages";
import { compareTurnOrder } from "@/lib/turnOrder";
import { resolveEffectiveDefenderAbility } from "@/lib/abilityModifiers";
import { inflictRestSleep } from "@/lib/statusConditions";
import { computeWeatherHealFraction } from "@/lib/weatherEffects";
import {
  abilityOf,
  activeWeather,
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
import { computeBattleHitChance } from "../hitChance";
import {
  applyEffectMove,
  blendTurns,
  effectKindOf,
  effectMoveFails,
  hazardCarry,
  isBatonPass,
  screenDuration,
} from "./statusMoveEffects";
import { estimateMoveHits, type MoveHitEstimate } from "./moveDamage";
import { evaluateOpponentThreat, usableMoves, type OpponentThreat } from "./opponentMoveModel";
import { blockedTurns, turnsToKo } from "./turnRates";
import type { HitsEstimate } from "./types";

export type SpeedOrder = "first" | "second" | "speed_tie";

/**
 * 데미지 없는 변화기 옵션의 종류(extension §2-2, decision-layer §4-1).
 * effect = 상태이상 부여·상대 랭크다운·벽·설치기 — "효과를 적용한 state로 대면을 다시 평가"해서 점수를 매긴다.
 */
export type SupportKind = "heal" | "setup" | "effect" | "other";

/** 현재 대면을 끝까지 이어갈 때의 c(처치 턴)·d(피처치 턴)·p(선공 확률) — 내 최선 공격기 기준 */
export interface RaceInputs {
  killTurns: number;
  survivalTurns: number;
  firstProbability: number;
}

/** effect 변화기의 평가값(decision-layer §4-1) */
export interface EffectEvaluation {
  /** 효과가 걸린 뒤의 대면(지속 턴으로 자른 값) */
  hit: RaceInputs;
  /** 빗나갔을 때 = 지금 그대로의 대면 */
  base: RaceInputs;
  /** 효과가 걸릴 확률(명중률) */
  hitChance: number;
  /** 대면이 끝난 뒤에도 남는 이득(설치기·벽) — HP 비율 단위, 결정 레이어가 w_carry를 곱한다 */
  carry: number;
}

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
  support?: {
    kind: SupportKind;
    before: number;
    after: number;
    bestKillTurns: number;
    healedHpFraction?: number;
    /** 회복기: 회복량 − 회복에 쓴 턴 동안 맞는 양(HP 비율). 0 이하면 회복 루프 — statusAware일 때 고르지 않는다 */
    healNetGain?: number;
    effect?: EffectEvaluation;
    /** v1에서 "그 외 변화기"로 막혀 있던 기술(효과 변화기·날씨 회복기·잠자기·배턴터치) — statusAware: false면 다시 막는다 */
    extended?: boolean;
  };
  /**
   * 유턴·볼트체인지·퀵턴처럼 맞히면 교체되는 기술(selfSwitchAfterDamage)이고 교대할 포켓몬이 있을 때만.
   * hitRate = 한 번 맞혔을 때 깎는 상대 현재 HP 비율(0~1), activeHitLoss = 지금 포켓몬이 상대 공격을 한 번
   * 맞을 때 잃는 HP 비율(최대 HP 대비), candidates = 그 데미지를 받은 상대 기준으로 다시 평가한 교체 후보들.
   * 배턴터치도 같은 구조(hitRate 0, 후보는 내 랭크를 이어받은 상태로 평가, hitChance 1).
   */
  pivot?: { hitRate: number; activeHitLoss: number; candidates: AiOption[]; hitChance?: number };
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
  if (move.healsWeatherDependent || move.restSleep) return "heal";
  if (move.statChanges?.some((s) => s.target === "self" && (s.delta ?? 0) > 0)) return "setup";
  if (effectKindOf(move)) return "effect";
  return "other";
}

/**
 * 회복 순이득: 회복한 HP − 회복에 쓴 턴(잠자기면 잠든 턴 포함) 동안 맞는 HP. 0 이하면 회복을 반복해도 제자리라
 * "회복 후 계속 공격한다"는 점수식의 가정이 다음 턴의 자신에 의해 깨진다(회복 루프) — decision-layer §4-1.
 * 맞는 양은 상대가 최선 공격기만 쓴다고 보는 보수적 값(사용 확률 모델은 변화기에 가중치를 나눠 피해를 낮게 본다).
 */
function healNetGain(current: number, healed: number, bestHitFraction: number, idleTurns: number): number {
  return healed - current - idleTurns * bestHitFraction;
}

/** st의 현재 대면(key 편 활성 vs 상대 활성)을 내 최선 공격기로 끝까지 이어갈 때의 c·d·p */
function currentRace(st: BattleState, key: FighterKey, moves: Move[]): RaceInputs {
  const oppKey = opponentKey(key);
  const me = st[key];
  const opponent = st[oppKey];
  const mySide = sideOf(st, key);
  const probe = evaluateOpponentThreat({ state: st, opponent, target: me, targetSide: mySide, opponentMovesSecond: false });
  const best = bestAttack({ state: st, attacker: me, defender: opponent, defenderSide: sideOf(st, oppKey), moves, attackerMovesSecond: false });
  const speed = best ? firstProbability(st, me, best.move, opponent, probe.bestMove) : { probability: 0 };
  const threat = evaluateOpponentThreat({ state: st, opponent, target: me, targetSide: mySide, opponentMovesSecond: speed.probability >= 0.5 });
  return {
    killTurns: turnsFor(best?.estimate, me, opponent).expected,
    survivalTurns: threat.hitsToBeKilled.expected,
    firstProbability: speed.probability,
  };
}

interface EffectContext {
  state: BattleState;
  key: FighterKey;
  move: Move;
  myMoves: Move[];
  /** 이 변화기 자체의 선공 확률 — 벽이 이번 턴 상대 공격부터 막는지 */
  moveFirstProbability: number;
  /** 벽 이월 항용: 교체 후보들을 지금 상대 기준으로 평가한 값(필요할 때만 계산) */
  benchOptions: () => AiOption[];
}

/**
 * decision-layer §4-1 "적용 후 재평가": state를 복제해 변화기의 지속 효과만 적용하고, 같은 평가 함수로 대면을
 * 다시 계산한다. 실패하거나 아무 효과가 없으면 undefined(= 고르지 않음).
 */
function evaluateEffectMove(ctx: EffectContext): EffectEvaluation | undefined {
  const { state, key, move, myMoves } = ctx;
  const kind = effectKindOf(move);
  if (!kind || effectMoveFails(state, key, move)) return undefined;
  const base = currentRace(state, key, myMoves);
  const clone = cloneBattleState(state);
  const toxicTurns = Math.min(6, Number.isFinite(base.killTurns) ? base.killTurns : 6);
  if (!applyEffectMove(clone, key, move, { toxicTurns })) return undefined;

  const me = state[key];
  const opponent = state[opponentKey(key)];
  const hitChance =
    computeBattleHitChance({
      state,
      attacker: me,
      defender: opponent,
      move,
      attackerAbility: abilityOf(me),
      defenderAbility: resolveEffectiveDefenderAbility(abilityOf(me), abilityOf(opponent)),
      attackerItem: effectiveHeldItem(me),
      defenderItem: effectiveHeldItem(opponent),
      attackerMovesSecond: ctx.moveFirstProbability < 0.5,
    }) ?? 1;

  if (kind === "hazard") return { hit: base, base, hitChance, carry: hazardCarry(state, key, move) };
  const after = currentRace(clone, key, myMoves);
  if (kind !== "screen") return { hit: after, base, hitChance, carry: 0 };

  // 벽: 이번 턴(내가 먼저 움직이면 이번 턴 상대 공격부터) + 남은 턴 동안만 상대 공격을 줄인다.
  const covered = screenDuration(me) - 1 + ctx.moveFirstProbability;
  const survivalTurns = blendTurns(after.survivalTurns, base.survivalTurns, covered);
  const hit = { ...after, survivalTurns };
  // 대면이 끝난 뒤 남는 벽 턴: 이기는 대면이면 지금 포켓몬이, 지는 대면이면 다음 포켓몬이 덜 맞는다.
  const opponentHits = base.killTurns + 1 - hit.firstProbability;
  const winning = opponentHits < survivalTurns;
  const leftover = Math.max(0, covered - (winning ? Math.max(0, opponentHits) : survivalTurns));
  const savedRatio =
    Number.isFinite(base.survivalTurns) && after.survivalTurns > 0 ? Math.max(0, 1 - base.survivalTurns / after.survivalTurns) : 0;
  const perHitLoss = (fraction: number, turns: number) => (turns > 0 && Number.isFinite(turns) ? Math.min(fraction, fraction / turns) : 0);
  const pool = winning
    ? [perHitLoss(me.currentHp / me.maxHp, base.survivalTurns)]
    : ctx.benchOptions().map((o) => perHitLoss(o.hpFraction, o.hitsToBeKilled.expected));
  const averageLoss = pool.length > 0 ? pool.reduce((a, b) => a + b, 0) / pool.length : 0;
  return { hit, base, hitChance, carry: leftover > 0 ? leftover * savedRatio * averageLoss : 0 };
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
  let benchCache: AiOption[] | undefined;
  const benchOptions = () => (benchCache ??= bench.map((index) => evaluateSwitchCandidate(state, key, index)));

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
      if (kind === "heal" && move.restSleep) {
        // 잠자기: HP·상태이상 완전 회복 + 2턴 잠듦 — 잠든 상태로 대면을 다시 평가한다(잠든 턴은 turnsToKo가 더함).
        const rested = cloneBattleState(moveState);
        rested[key].currentHp = me.maxHp;
        rested[key].status = inflictRestSleep();
        const race = currentRace(rested, key, myMoves);
        option.support = {
          kind,
          before: threat.hitsToBeKilled.expected,
          after: race.survivalTurns,
          bestKillTurns: race.killTurns,
          healedHpFraction: 1,
          healNetGain: healNetGain(
            me.currentHp / me.maxHp,
            1,
            evaluateOpponentThreat({ state: rested, opponent, target: rested[key], targetSide: sideOf(rested, key), opponentMovesSecond: !iMoveSecond }).bestHitFraction,
            1 + blockedTurns(rested[key]),
          ),
          extended: true,
        };
      } else if (kind === "heal") {
        const healWeather = abilityOf(me)?.treatsOwnWeatherAsSun ? "쾌청" : activeWeather(moveState);
        const fraction = move.healsWeatherDependent ? computeWeatherHealFraction(healWeather) : (move.healsFraction ?? 0);
        const healedHp = Math.min(me.maxHp, me.currentHp + Math.floor(me.maxHp * fraction));
        const after = evaluateOpponentThreat({ state: moveState, opponent, target: me, targetSide: myMoveSide, opponentMovesSecond: !iMoveSecond, targetHp: healedHp });
        option.support = {
          kind,
          before: threat.hitsToBeKilled.expected,
          after: after.hitsToBeKilled.expected,
          bestKillTurns,
          healedHpFraction: healedHp / me.maxHp,
          healNetGain: healNetGain(me.currentHp / me.maxHp, healedHp / me.maxHp, after.bestHitFraction, 1),
          extended: move.healsWeatherDependent || undefined,
        };
      } else if (kind === "effect") {
        const effect = evaluateEffectMove({
          state: moveState,
          key,
          move,
          myMoves,
          moveFirstProbability: speed.probability,
          benchOptions: () => benchOptions(),
        });
        option.support = { kind: effect ? "effect" : "other", before: 0, after: 0, bestKillTurns, effect, extended: true };
      } else if (isBatonPass(move) && bench.length > 0) {
        // 배턴터치: 유턴류와 같은 "교체" 평가 — 데미지는 0, 후보는 내 랭크 변화를 이어받은 상태로 평가한다.
        const passed = cloneBattleState(state);
        const passedSide = sideOf(passed, key);
        const d = threat.hitsToBeKilled.expected;
        option.pivot = {
          hitRate: 0,
          hitChance: 1,
          activeHitLoss: (me.currentHp / me.maxHp) * Math.min(1, d > 0 ? 1 / d : 1),
          candidates: bench.map((index) => {
            passedSide.party[index].stages = { ...state[key].stages };
            return evaluateSwitchCandidate(passed, key, index);
          }),
        };
        option.support = { kind: "other", before: 0, after: 0, bestKillTurns, extended: true };
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
