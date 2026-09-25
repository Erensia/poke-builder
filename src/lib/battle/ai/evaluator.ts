import { type FighterKey } from "@/types/battle";
import { type Move } from "@/types/move";
import { type PokemonType } from "@/types/pokemon-type";
import { NEUTRAL_ACCURACY_STAGES, NEUTRAL_STAGES, type StatStages } from "@/types/battleStats";
import { applyMoveStatChanges } from "@/lib/statStages";
import { applyMoveAccuracyEvasionChanges } from "@/lib/accuracyCrit";
import { resolveEffectiveDefenderAbility } from "@/lib/abilityModifiers";
import { inflictRestSleep } from "@/lib/statusConditions";
import { computeWeatherHealFraction } from "@/lib/weatherEffects";
import {
  abilityOf,
  activeWeather,
  contraryMoveFor,
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
import { effectiveHeldItem } from "../turnOrderInputs";
import { computeBattleHitChance } from "../hitChance";
import { isCopyableMove } from "../preHitEffects";
import { getMove } from "@/lib/data";
import {
  acupressureOptions,
  applyAcupressure,
  applyEffectMove,
  blendTurns,
  effectDuration,
  effectKindOf,
  effectMoveFails,
  hazardCarry,
  hazardsAfter,
  sleepTalkCandidates,
  isBatonPass,
  type EffectMoveKind,
} from "./statusMoveEffects";
import { isOneShotMove, isUsageBlocked } from "./usageConditions";
import {
  hasPriorityThreat,
  opponentActionMix,
  protectGroupOf,
  protectSuccessChance,
  simulateProtectTurn,
  type ProtectGroup,
} from "./protectMoves";
import { estimateMoveHits, type MoveHitEstimate } from "./moveDamage";
import { firstProbability } from "./speed";
import { createPartyModel, type PartyDuel, type PartyEffect, type PartyModel } from "./partyEval";
import { allowedByVolatiles, evaluateOpponentThreat, usableMoves, type OpponentThreat } from "./opponentMoveModel";
import { blockedTurns, turnsToKo } from "./turnRates";
import type { HitsEstimate } from "./types";

export type { SpeedOrder } from "./speed";
import type { SpeedOrder } from "./speed";

/**
 * 데미지 없는 변화기 옵션의 종류(extension §2-2, decision-layer §4-1).
 * effect = 상태이상 부여·상대 랭크다운·벽·설치기 — "효과를 적용한 state로 대면을 다시 평가"해서 점수를 매긴다.
 */
export type SupportKind = "heal" | "setup" | "effect" | "protect" | "other";

/** 방어류 시뮬레이션 한 갈래(상대 행동 1개): 그 턴이 끝난 뒤 양쪽 HP 비율과, 둘 다 살아 있으면 이어지는 대면 */
export interface ProtectOutcome {
  weight: number;
  myAfter: number;
  oppAfter: number;
  race?: RaceInputs;
  /** 파티 단위 평가(§4-5 ②): 그 한 턴을 돌린 뒤 state의 대면표 — 이어지는 대면·쓰러진 뒤·길동무 동반 기절 계산용 */
  partyModel?: PartyModel;
}

/** 방어류 평가(decision-layer §4-4) */
export interface ProtectEvaluation {
  group: ProtectGroup;
  /** 연속 사용 성공 확률 (1/3)^연속 횟수 */
  successChance: number;
  outcomes: ProtectOutcome[];
  /** 실패했을 때(연속 사용) = 아무것도 안 하고 맞는 대면 */
  base: RaceInputs;
  /** 묶음별 판정으로 쓸 이유가 없음(패스트가드: 막을 선공기 없음, 버티기: 이번 턴 쓰러질 일 없음) */
  pointless?: boolean;
}

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
  /** 이 기술을 쓰느라 내가 치르는 HP 비율(소울비트류 costsHpFraction) */
  selfCost?: number;
  /** 효과 종류(랭크업기는 없음) — phase3Aware 등 종류별 토글용 */
  kind?: EffectMoveKind;
  /**
   * 파티 단위 평가(§4-5 ②): 효과를 적용한 state의 대면표 + 효과가 남는 턴 수(상태이상·랭크 변화·설치기는
   * Infinity). 명중 갈래의 이어지는 대면이 이걸로 계산된다.
   */
  party?: PartyEffect;
  /** 파티 모드에서 carry 대신 쓰는 이월 항 — 벽·설치기는 이어지는 대면이 직접 세므로 0, 끈적끈적네트만 고정 근사 */
  partyCarry?: number;
  /** 아픔나누기(트랙 M1): 효과가 걸린 뒤 두 포켓몬의 HP 비율(첫 대면이 여기서 시작) */
  hpAfter?: { my: number; opp: number };
  /** 울부짖기·날려버리기(AI-A2): 상대 대기 포켓몬마다 끌려 나온 뒤의 대면 */
  phaze?: PhazeEvaluation;
  /** 경혈찌르기(트랙 M2): 무작위로 오를 능력마다의 대면(가중치 합 1) — 있으면 hit·party 대신 이걸 평균낸다 */
  branches?: { weight: number; hit: RaceInputs; party: PartyEffect }[];
  /** 추억의선물(AI-A2): 자신 기절 + 상대 랭크다운 뒤 state(성공)·먼저 쓰러진 state(실패)의 대면표 */
  sacrifice?: { success: number; afterModel: PartyModel; failModel: PartyModel };
}

/**
 * 울부짖기·날려버리기(AI-A2): 우선도 −6이라 상대가 먼저 한 번 때리고(hitLoss), 상대 예비 중 무작위 하나가 끌려 나와
 * 설치물 등장 비용(entry)을 치른다. 원래 상대의 랭크 변화는 사라진다(물러남). branches = 예비마다 그 뒤의 대면.
 */
export interface PhazeEvaluation {
  hitLoss: number;
  branches: {
    race: RaceInputs;
    /** 끌려 나온 뒤 내 HP 비율(한 대 맞은 뒤) / 끌려 나온 상대 HP 비율(등장 비용 뒤) */
    my: number;
    opp: number;
    entry: number;
    /** 등장 비용으로 쓰러졌는지 */
    fainted: boolean;
    model: PartyModel;
  }[];
}

/**
 * 랭크업기 → 다음 턴 배턴터치(decision-layer §4-2). hitLoss = 랭크업 후 상대 공격 한 번에 잃는 HP 비율,
 * candidates = 올린 랭크를 이어받은 교대 후보, firstProbability = 다음 턴 배턴터치 시 내가 먼저 움직일 확률.
 */
export interface BatonFollowUp {
  candidates: AiOption[];
  hitLoss: number;
  firstProbability: number;
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
    /** 방어류: 엔진 한 턴 시뮬레이션 결과(§4-4) */
    protect?: ProtectEvaluation;
    /** 랭크업기: 올린 뒤 다음 턴 배턴터치로 넘기는 선택지(배턴터치 보유 + 교대 가능할 때만) */
    batonFollowUp?: BatonFollowUp;
    /** 랭크업기: 이미 +6·HP 부족 등으로 실패 — statusAware일 때 고르지 않는다 */
    setupFailed?: boolean;
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
  /** 흉내쟁이(트랙 M2): 따라 쓸 기술 갈래(가중치 합 1). option이 없으면 따라 쓸 수 없어 실패하는 갈래 */
  copycat?: { branches: { weight: number; option?: AiOption }[] };
  /** 파티 단위 평가(§4-5): 이 옵션의 첫 대면이 누구끼리인지 + 대면표. 결정 레이어가 이어지는 대면을 계산한다 */
  party?: PartyDuel;
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

/**
 * 사람이 고를 수 있는 기술과 같은 기준(PP > 0, 도발 중 변화기·사슬묶기·앵콜 제외) + 이번 턴 사용 조건 때문에
 * 반드시 실패하는 기술 제외(첫 턴 전용·필드/날씨 필요·비장의무기 등, usageConditions.ts).
 */
export function selectableMoves(
  state: BattleState,
  fighter: BattleFighterState,
  opponent: BattleFighterState,
  legalMoveIds?: string[],
): Move[] {
  const moves = usableMoves(fighter).filter((m) => !isUsageBlocked(state, fighter, m, opponent));
  if (legalMoveIds) return moves.filter((m) => legalMoveIds.includes(m.id));
  return allowedByVolatiles(fighter, moves, opponent);
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
  return {
    expected: turnsToKo(1 / estimate.expected, attacker, defender, defenderHp, estimate.damageFraction),
    worstCase: estimate.worstCase,
  };
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
    // 교체 후 대면을 끝까지 이어가는 계산이라 1회용(첫 턴 전용) 기술은 뺀다.
    moves: usableMoves(candidate).filter((m) => !isOneShotMove(m) && !isUsageBlocked(state, candidate, m, opponent)),
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

/**
 * 배턴터치 교대 후보: from이 넘겨줄 것(랭크·명중/회피 랭크·급소 랭크 — 엔진 performSwitch의 baton 인계)을
 * 입힌 상태로 평가한다.
 */
function batonCandidates(state: BattleState, key: FighterKey, bench: number[], from: BattleFighterState): AiOption[] {
  const passed = cloneBattleState(state);
  const side = sideOf(passed, key);
  return bench.map((index) => {
    const candidate = side.party[index];
    candidate.stages = { ...from.stages };
    candidate.accuracyStages = { ...from.accuracyStages };
    candidate.critStage = from.critStage;
    return evaluateSwitchCandidate(passed, key, index);
  });
}

interface SetupContext {
  state: BattleState;
  key: FighterKey;
  move: Move;
  raceMoves: Move[];
  /** 배턴터치로 넘길 수 있으면 교대 후보 슬롯, 아니면 빈 배열 */
  batonBench: number[];
}

/**
 * 랭크업기 "적용 후 재평가"(decision-layer §4-2): 복제한 state에 자기 랭크 변화(심술꾸러기·명중/회피 포함)와
 * HP 비용을 적용하고 대면의 c·d·p를 모두 다시 계산한다 — 스피드 랭크업은 선공(p), 방어 랭크업은 버티는 턴(d)으로
 * 값이 생긴다. 배턴터치를 가졌으면 "올린 뒤 다음 턴 넘기기"도 함께 계산한다. 아무 변화가 없으면(+6 등) failed.
 */
function evaluateSetupMove(ctx: SetupContext): { effect?: EffectEvaluation; batonFollowUp?: BatonFollowUp; failed?: boolean } {
  const { state, key, move, raceMoves } = ctx;
  const clone = cloneBattleState(state);
  const self = clone[key];
  const selfMove = contraryMoveFor(move, self);
  let selfCost = 0;
  if (move.costsHpFraction !== undefined) {
    const cost = Math.floor(self.maxHp * move.costsHpFraction);
    if (self.currentHp <= cost) return { failed: true };
    self.currentHp -= cost;
    selfCost = cost / self.maxHp;
  }
  const beforeStages = self.stages;
  const beforeAccuracy = self.accuracyStages;
  self.stages = applyMoveStatChanges(self.stages, selfMove, "self", { userTypes: self.types, weather: activeWeather(clone) });
  self.accuracyStages = applyMoveAccuracyEvasionChanges(self.accuracyStages, selfMove, "self", { userTypes: self.types });
  const changed =
    (Object.keys(beforeStages) as (keyof typeof beforeStages)[]).some((s) => self.stages[s] !== beforeStages[s]) ||
    (Object.keys(beforeAccuracy) as (keyof typeof beforeAccuracy)[]).some((s) => self.accuracyStages[s] !== beforeAccuracy[s]);
  if (!changed) return { failed: true };

  const base = currentRace(state, key, raceMoves);
  const hit = currentRace(clone, key, raceMoves);
  const effect: EffectEvaluation = {
    hit,
    base,
    hitChance: 1,
    carry: 0,
    selfCost,
    // 올린 랭크는 물러나기 전까지 남는다 — 이어지는 대면도 랭크업한 state의 대면표로
    party: { model: createPartyModel(clone, key), turns: Infinity },
  };
  if (ctx.batonBench.length === 0) return { effect };

  const myAfter = self.currentHp / self.maxHp;
  const hitLoss = hit.survivalTurns > 0 && Number.isFinite(hit.survivalTurns) ? Math.min(myAfter, myAfter / hit.survivalTurns) : 0;
  return {
    effect,
    batonFollowUp: { candidates: batonCandidates(clone, key, ctx.batonBench, self), hitLoss, firstProbability: hit.firstProbability },
  };
}

interface ProtectContext {
  /** 메가진화 전 원래 state — 시뮬레이션은 mega 플래그로 엔진이 직접 메가진화시킨다 */
  state: BattleState;
  /** 평가 기준 state(메가진화 반영) — 실패 시 대면 계산용 */
  moveState: BattleState;
  key: FighterKey;
  move: Move;
  mega: boolean | undefined;
  raceMoves: Move[];
  threat: OpponentThreat;
}

/**
 * 방어류 "엔진 한 턴 시뮬레이션 + 재평가"(decision-layer §4-4): 상대 행동 후보(사용 확률 모델)마다 실제 runTurn을
 * 한 번 돌려, 턴 종료 효과·접촉 페널티·버티기·길동무까지 엔진이 처리한 결과 state에서 대면을 다시 계산한다.
 */
function evaluateProtectMove(ctx: ProtectContext): ProtectEvaluation {
  const { state, key, move } = ctx;
  const group = protectGroupOf(move)!;
  const oppKey = opponentKey(key);
  const base = currentRace(ctx.moveState, key, ctx.raceMoves);
  const successChance = protectSuccessChance(state[key].protectStreak);
  const mix = opponentActionMix(ctx.threat.moveWeights);
  if (mix.length === 0 || (group === "priorityGuard" && !hasPriorityThreat(mix))) {
    return { group, successChance, outcomes: [], base, pointless: true };
  }
  const myIndex = sideOf(state, key).activeIndex;
  const oppIndex = sideOf(state, oppKey).activeIndex;
  let endured = false;
  const outcomes = mix.map(({ move: opponentMove, weight }): ProtectOutcome => {
    const after = simulateProtectTurn(state, key, move, opponentMove, ctx.mega);
    const me = sideOf(after, key).party[myIndex];
    const opponent = sideOf(after, oppKey).party[oppIndex];
    if (me.currentHp === 1 && state[key].currentHp > 1) endured = true;
    const myAfter = me.currentHp / me.maxHp;
    const oppAfter = opponent.currentHp / opponent.maxHp;
    // 양쪽 다 살아 있고 그대로 대면 중일 때만 이어지는 대면을 계산한다(강제 교체 등으로 바뀌었으면 HP 변화만 센다)
    const sameMatchup = sideOf(after, key).activeIndex === myIndex && sideOf(after, oppKey).activeIndex === oppIndex;
    const race = myAfter > 0 && oppAfter > 0 && sameMatchup ? currentRace(after, key, ctx.raceMoves) : undefined;
    return { weight, myAfter, oppAfter, race, partyModel: createPartyModel(after, key) };
  });
  // 버티기: 어느 상대 행동에서도 HP 1로 버틸 일이 없으면(이번 턴 안 쓰러짐) 쓸 이유가 없다
  const pointless = group === "endure" && !endured;
  return { group, successChance, outcomes, base, pointless };
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
  if (move.healsWeatherDependent || move.restSleep || isWish(move) || move.healsByStockpile) return "heal";
  // 배북처럼 랭크를 +n이 아니라 특정 값으로 "설정"(setTo)하는 것도 랭크업기다.
  if (move.statChanges?.some((s) => s.target === "self" && ((s.delta ?? 0) > 0 || (s.setTo ?? 0) > 0))) return "setup";
  if (effectKindOf(move)) return "effect";
  return "other";
}

/** 희망사항: 다음 턴 종료에 그 자리의 포켓몬이 시전자 최대 HP 절반을 회복 */
function isWish(move: Move): boolean {
  return !!move.inflictsVolatile?.some((v) => v.volatile === "wish");
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
  /** 대면을 이어갈 때 쓰는 내 기술(1회용 기술 제외) */
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
  if (kind === "phaze") return evaluatePhaze(ctx, base);
  if (kind === "acupressure") return evaluateAcupressure(ctx, base);
  const clone = cloneBattleState(state);
  const toxicTurns = Math.min(6, Number.isFinite(base.killTurns) ? base.killTurns : 6);
  if (!applyEffectMove(clone, key, move, { toxicTurns })) return undefined;
  if (kind === "torment") return evaluateTorment(ctx, base, clone);
  if (kind === "memento") {
    // 먼저 맞아 쓰러지면(후공인데 이번 턴에 쓰러지는 대면) 랭크다운 없이 기절만
    const success = ctx.moveFirstProbability + (1 - ctx.moveFirstProbability) * (base.survivalTurns > 1 ? 1 : 0);
    const failed = cloneBattleState(state);
    failed[key].currentHp = 0;
    return {
      hit: base,
      base,
      hitChance: 1,
      carry: 0,
      kind,
      sacrifice: { success, afterModel: createPartyModel(clone, key), failModel: createPartyModel(failed, key) },
    };
  }

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

  if (kind === "hazard") {
    // 파티 모드: 설치를 적용한 state로 상대 등장 비용·독압정 독을 계산하고, 끈적끈적네트(스피드 −1)만 고정 근사로 남긴다.
    const oppSide = sideOf(clone, opponentKey(key));
    oppSide.hazards = hazardsAfter(oppSide.hazards, move) ?? oppSide.hazards;
    return {
      hit: base,
      base,
      hitChance,
      carry: hazardCarry(state, key, move),
      kind,
      party: { model: createPartyModel(clone, key), turns: Infinity },
      partyCarry: move.setsHazard === "stickyWeb" ? hazardCarry(state, key, move) : 0,
    };
  }
  let after = currentRace(clone, key, myMoves);
  // 하품: 상대는 이번 턴·다음 턴에 행동한 뒤 잠든다 — 그 두 번 안에 나를 쓰러뜨리는 대면이면 잠듦은 의미 없다.
  if (kind === "yawn" && base.survivalTurns <= 2) after = { ...after, survivalTurns: base.survivalTurns };
  const duration = effectDuration(state, key, move);
  const partyModel = createPartyModel(clone, key);
  if (duration === undefined) {
    // 대타출동: 최대 HP 1/4을 쓰고 대면은 깎인 HP에서 시작(selfCost — 랭크업기의 HP 비용과 같은 처리)
    const selfCost = kind === "substitute" ? Math.floor(me.maxHp / 4) / me.maxHp : undefined;
    // 아픔나누기: 두 포켓몬 HP가 바뀐 채로 대면을 시작한다
    const oppAfterFighter = clone[opponentKey(key)];
    const hpAfter =
      kind === "painSplit"
        ? { my: clone[key].currentHp / clone[key].maxHp, opp: oppAfterFighter.currentHp / oppAfterFighter.maxHp }
        : undefined;
    return { hit: after, base, hitChance, carry: 0, kind, party: { model: partyModel, turns: Infinity }, partyCarry: 0, selfCost, hpAfter };
  }

  // 지속 턴이 있는 효과(벽·날씨·필드·트릭룸·도발·앙코르·사슬묶기): 이번 턴(내가 먼저 움직이면 이번 턴 상대
  // 행동부터) + 남은 턴 동안만 효과가 있다 — c·d는 그 구간만 효과 적용 속도, p는 그 구간 비율만큼 섞는다.
  // 파티 모드에서는 대면이 끝난 뒤 남은 턴도 이어지는 대면이 효과 대면표로 센다(벽 이월 항 불필요).
  const covered = duration - 1 + ctx.moveFirstProbability;
  const hit = blendRace(after, base, covered);
  const party: PartyEffect = { model: partyModel, turns: covered };
  if (kind !== "screen") return { hit, base, hitChance, carry: 0, kind, party, partyCarry: 0 };
  const survivalTurns = hit.survivalTurns;
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
  return { hit, base, hitChance, carry: leftover > 0 ? leftover * savedRatio * averageLoss : 0, kind, party, partyCarry: 0 };
}

/** 효과가 covered 턴 동안만 유지될 때의 대면 값(decision-layer §4-1 3단계를 c·d·p 전부로 일반화) */
/**
 * 잠꼬대 처치 턴: 남은 잠듦 턴 b 동안은 무작위 기술의 평균 피해율(변화기 0)로, 그 뒤는 깬 상태의 최선 처치 턴으로.
 * awakeKillTurns는 잠듦 턴을 포함한 기존 계산(turnsToKo가 앞에 b를 더함). 나갈 기술이 없으면 undefined(실패).
 */
function sleepTalkKillTurns(
  state: BattleState,
  key: FighterKey,
  move: Move,
  awakeKillTurns: number,
  attackerMovesSecond: boolean,
): { killTurns: number; bestTypeEffectiveness: number } | undefined {
  const me = state[key];
  const oppKey = opponentKey(key);
  const candidates = sleepTalkCandidates(me, move);
  if (candidates.length === 0) return undefined;
  let bestTypeEffectiveness = 0;
  const rates = candidates.map((m) => {
    if (m.category === "status") return 0;
    const estimate = estimateMoveHits({ state, attacker: me, defender: state[oppKey], defenderSide: sideOf(state, oppKey), attackerMovesSecond }, m);
    if (!estimate || !Number.isFinite(estimate.rawHits) || estimate.rawHits <= 0) return 0;
    bestTypeEffectiveness = Math.max(bestTypeEffectiveness, estimate.typeEffectiveness);
    return 1 / estimate.rawHits;
  });
  const rate = rates.reduce((a, b) => a + b, 0) / rates.length;
  const asleep = blockedTurns(me);
  if (rate > 0 && asleep * rate >= 1) return { killTurns: Math.max(1, 1 / rate), bestTypeEffectiveness };
  const afterWaking = Number.isFinite(awakeKillTurns) ? Math.max(0, awakeKillTurns - asleep) : Infinity;
  return { killTurns: asleep + afterWaking * (1 - asleep * rate), bestTypeEffectiveness };
}

/**
 * 울부짖기·날려버리기(AI-A2): 상대 예비마다 "상대가 먼저 한 번 때린 뒤, 그 예비가 설치물을 밟고 나와 원래 상대는
 * 랭크 변화를 잃고 물러난" state를 만들어 대면을 다시 계산한다(무작위라 결정 레이어가 평균낸다). 이번 턴 안에 내가
 * 쓰러지는 대면이면(우선도 −6이라 상대가 먼저 움직임) 쓸 수 없다.
 */
function evaluatePhaze(ctx: EffectContext, base: RaceInputs): EffectEvaluation | undefined {
  const { state, key, myMoves } = ctx;
  const oppKey = opponentKey(key);
  const me = state[key];
  if (base.survivalTurns <= 1) return undefined;
  const hitLossHp = Number.isFinite(base.survivalTurns) ? Math.floor(me.currentHp / base.survivalTurns) : 0;
  const reserves = benchIndices(sideOf(state, oppKey));
  const branches: PhazeEvaluation["branches"] = reserves.map((j) => {
    const clone = cloneBattleState(state);
    const side = sideOf(clone, oppKey);
    const outgoing = side.party[side.activeIndex];
    outgoing.stages = { ...NEUTRAL_STAGES };
    outgoing.accuracyStages = { ...NEUTRAL_ACCURACY_STAGES };
    side.activeIndex = j;
    const incoming = side.party[j];
    clone[oppKey] = incoming;
    const entryHp = Math.min(incoming.currentHp, calcEntryHazardDamage(incoming.maxHp, incoming.types, abilityOf(incoming), side.hazards));
    incoming.currentHp -= entryHp;
    clone[key].currentHp = Math.max(1, clone[key].currentHp - hitLossHp);
    const fainted = incoming.currentHp <= 0;
    return {
      race: fainted ? base : currentRace(clone, key, myMoves),
      my: clone[key].currentHp / clone[key].maxHp,
      opp: incoming.currentHp / incoming.maxHp,
      entry: entryHp / incoming.maxHp,
      fainted,
      model: createPartyModel(clone, key),
    };
  });
  return {
    hit: base,
    base,
    hitChance: 1,
    carry: 0,
    kind: "phaze",
    phaze: { hitLoss: hitLossHp / me.maxHp, branches },
  };
}

/**
 * 경혈찌르기(트랙 M2): 올릴 수 있는 능력마다 +2를 적용한 대면을 다시 계산한다 — 무작위(균등)라 결정 레이어가 평균낸다.
 * 올린 랭크는 물러나기 전까지 남는다(랭크업기와 같은 처리).
 */
function evaluateAcupressure(ctx: EffectContext, base: RaceInputs): EffectEvaluation | undefined {
  const { state, key, move, myMoves } = ctx;
  const stats = acupressureOptions(state[key]);
  if (stats.length === 0) return undefined;
  const branches = stats.map((stat) => {
    const clone = cloneBattleState(state);
    applyAcupressure(clone[key], stat, move.raisesRandomStat!);
    return { weight: 1 / stats.length, hit: currentRace(clone, key, myMoves), party: { model: createPartyModel(clone, key), turns: Infinity } };
  });
  return { hit: branches[0].hit, base, hitChance: 1, carry: 0, kind: "acupressure", branches };
}

/**
 * 트집(트랙 M2): 상대는 같은 기술을 연속으로 못 써 최선 공격기를 한 턴 걸러 쓰게 된다 — 최선 공격기를 막은 대면을
 * 대면 길이의 절반만큼 섞는다(교대로 쓰는 근사). 아직 기술을 안 쓴 상대도 최선 공격기부터 쓴다고 보고 그 기술을 막는다.
 */
function evaluateTorment(ctx: EffectContext, base: RaceInputs, clone: BattleState): EffectEvaluation {
  const { state, key, myMoves } = ctx;
  const oppKey = opponentKey(key);
  // 최선 공격기는 트집을 걸기 전 state 기준(건 뒤엔 직전 기술이 이미 빠진다)
  const probe = evaluateOpponentThreat({ state, opponent: state[oppKey], target: state[key], targetSide: sideOf(state, key), opponentMovesSecond: false });
  if (probe.bestMove) clone[oppKey].lastMoveId = probe.bestMove.id;
  const after = currentRace(clone, key, myMoves);
  const raceLength = Math.min(base.killTurns, base.survivalTurns);
  const covered = Number.isFinite(raceLength) ? raceLength / 2 : Infinity;
  return {
    hit: blendRace(after, base, covered),
    base,
    hitChance: 1,
    carry: 0,
    kind: "torment",
    party: { model: createPartyModel(clone, key), turns: covered },
    partyCarry: 0,
  };
}

function blendRace(after: RaceInputs, base: RaceInputs, covered: number): RaceInputs {
  const raceLength = Math.min(after.killTurns, after.survivalTurns);
  const share = raceLength <= covered ? 1 : covered / raceLength;
  return {
    killTurns: blendTurns(after.killTurns, base.killTurns, covered),
    survivalTurns: blendTurns(after.survivalTurns, base.survivalTurns, covered),
    firstProbability: share * after.firstProbability + (1 - share) * base.firstProbability,
  };
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
  const myMoves = selectableMoves(moveState, me, opponent, options.legalMoveIds);
  // 대면을 끝까지 이어가는 계산(c)에 쓰는 기술 — 1회용(첫 턴 전용) 기술은 반복해서 쓸 수 없으니 뺀다.
  const raceMoves = myMoves.filter((m) => !isOneShotMove(m));

  const baseThreat = evaluateOpponentThreat({ state: moveState, opponent, target: me, targetSide: myMoveSide, opponentMovesSecond: false });
  const myBest = bestAttack({ state: moveState, attacker: me, defender: opponent, defenderSide: oppMoveSide, moves: raceMoves, attackerMovesSecond: false });
  const bench = benchIndices(mySide);
  let benchCache: AiOption[] | undefined;
  const benchOptions = () => (benchCache ??= bench.map((index) => evaluateSwitchCandidate(state, key, index)));

  // speedMove: 흉내쟁이(트랙 M2)처럼 다른 기술로 나가도 행동 순서는 원래 고른 기술(speedMove)의 우선도로 정해진다
  const buildMoveOption = (move: Move, speedMove: Move = move): AiOption => {
    const speed = firstProbability(moveState, me, speedMove, opponent, baseThreat.bestMove);
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

    // 1회용(첫 턴 전용) 기술: 이번 턴 한 번 맞히고, 그 뒤는 나머지 기술 중 최선으로 대면을 이어간다.
    if (isOneShotMove(move) && estimate && Number.isFinite(estimate.rawHits) && estimate.rawHits > 1) {
      const opponentHpAfter = Math.max(1, Math.round(opponent.currentHp * (1 - 1 / estimate.rawHits)));
      const follow = (hp?: number) =>
        turnsFor(
          bestAttack({ state: moveState, attacker: me, defender: opponent, defenderSide: oppMoveSide, moves: raceMoves, attackerMovesSecond: iMoveSecond, defenderHp: hp })?.estimate,
          me,
          opponent,
          hp,
        ).expected;
      const acc = estimate.accuracy;
      // 가중치 0인 항은 빼야 0 × ∞ = NaN이 안 생긴다(나머지 공격기가 없으면 후속 처치 턴이 ∞).
      const afterHit = acc > 0 ? acc * follow(opponentHpAfter) : 0;
      const afterMiss = acc < 1 ? (1 - acc) * follow() : 0;
      option.hitsToKill = { ...option.hitsToKill, expected: 1 + afterHit + afterMiss };
    }

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

    // 잠꼬대(AI-A2): 잠든 동안(사용 조건은 selectableMoves가 이미 거름) 배운 다른 기술 중 무작위 하나가 나간다 —
    // 잠든 턴 동안은 그 기대 피해로, 깬 뒤에는 최선 공격기로 대면을 이어간다.
    if (move.callsRandomLearnedMove) {
      const sleepTalk = sleepTalkKillTurns(moveState, key, move, turnsFor(myBest?.estimate, me, opponent).expected, iMoveSecond);
      if (sleepTalk) {
        option.hitsToKill = { expected: sleepTalk.killTurns, worstCase: { count: 3, certainty: "random", probability: 0 } };
        option.typeMatchup = { ...option.typeMatchup, offensive: sleepTalk.bestTypeEffectiveness };
        option.accuracy = 1;
      } else {
        option.support = { kind: "other", before: 0, after: 0, bestKillTurns: turnsFor(myBest?.estimate, me, opponent).expected };
      }
      return option;
    }

    if (move.category === "status") {
      const kind = classifySupport(move);
      const bestKillTurns = turnsFor(myBest?.estimate, me, opponent).expected;
      if (protectGroupOf(move)) {
        option.support = {
          kind: "protect",
          before: 0,
          after: 0,
          bestKillTurns,
          protect: evaluateProtectMove({ state, moveState, key, move, mega: option.mega, raceMoves, threat }),
          extended: true,
        };
      } else if (kind === "heal" && move.restSleep) {
        // 잠자기: HP·상태이상 완전 회복 + 2턴 잠듦 — 잠든 상태로 대면을 다시 평가한다(잠든 턴은 turnsToKo가 더함).
        const rested = cloneBattleState(moveState);
        rested[key].currentHp = me.maxHp;
        rested[key].status = inflictRestSleep();
        const race = currentRace(rested, key, raceMoves);
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
        let healedHp = Math.min(me.maxHp, me.currentHp + Math.floor(me.maxHp * fraction));
        // 희망사항(AI-A1): 회복은 다음 턴 종료 — 그 사이 한 번 더 맞은 뒤 최대 HP 절반을 받는다. 이미 예약돼 있으면
        // 실패(엔진 mirroredEffects), 받기 전에 쓰러지면(이번 턴 + 다음 턴에 쓰러짐) 회복 없음 → 순이득 ≤ 0.
        let wishFails = false;
        // 꿀꺽(트랙 M1): 비축 1/2/3 → 1/4·1/2·전부. 비축이 없으면 실패(비축 랭크를 되돌리는 손해는 아직 안 셈)
        if (move.healsByStockpile) {
          const spent = me.stockpileCount ?? 0;
          const stockFraction = spent >= 3 ? 1 : spent === 2 ? 0.5 : spent === 1 ? 0.25 : 0;
          healedHp = Math.min(me.maxHp, me.currentHp + Math.floor(me.maxHp * stockFraction));
          wishFails = spent === 0;
        }
        if (isWish(move)) {
          const perTurnLoss = threat.hitsToBeKilled.expected > 0 ? me.currentHp / threat.hitsToBeKilled.expected : me.currentHp;
          const hpBeforeHeal = me.currentHp - perTurnLoss;
          wishFails = !!myMoveSide.wish || me.currentHp - 2 * perTurnLoss <= 0;
          healedHp = Math.max(0, Math.min(me.maxHp, hpBeforeHeal + Math.floor(me.maxHp / 2)));
        }
        const after = evaluateOpponentThreat({ state: moveState, opponent, target: me, targetSide: myMoveSide, opponentMovesSecond: !iMoveSecond, targetHp: healedHp });
        option.support = {
          kind,
          before: threat.hitsToBeKilled.expected,
          after: after.hitsToBeKilled.expected,
          bestKillTurns,
          healedHpFraction: healedHp / me.maxHp,
          healNetGain: wishFails ? -1 : healNetGain(me.currentHp / me.maxHp, healedHp / me.maxHp, after.bestHitFraction, 1),
          extended: move.healsWeatherDependent || isWish(move) || move.healsByStockpile || undefined,
        };
      } else if (kind === "effect") {
        const effect = evaluateEffectMove({
          state: moveState,
          key,
          move,
          myMoves: raceMoves,
          moveFirstProbability: speed.probability,
          benchOptions: () => benchOptions(),
        });
        option.support = { kind: effect ? "effect" : "other", before: 0, after: 0, bestKillTurns, effect, extended: true };
      } else if (isBatonPass(move) && bench.length > 0) {
        // 배턴터치: 유턴류와 같은 "교체" 평가 — 데미지는 0, 후보는 내 랭크 변화를 이어받은 상태로 평가한다.
        const d = threat.hitsToBeKilled.expected;
        option.pivot = {
          hitRate: 0,
          hitChance: 1,
          activeHitLoss: (me.currentHp / me.maxHp) * Math.min(1, d > 0 ? 1 / d : 1),
          candidates: batonCandidates(state, key, bench, state[key]),
        };
        option.support = { kind: "other", before: 0, after: 0, bestKillTurns, extended: true };
      } else if (kind === "setup") {
        const boosted = applyMoveStatChanges(me.stages, move, "self", { userTypes: me.types });
        const after = bestAttack({
          state: moveState,
          attacker: me,
          defender: opponent,
          defenderSide: oppMoveSide,
          moves: raceMoves,
          attackerMovesSecond: iMoveSecond,
          stagesOverride: boosted,
        });
        const setup = evaluateSetupMove({
          state: moveState,
          key,
          move,
          raceMoves,
          batonBench: myMoves.some(isBatonPass) ? bench : [],
        });
        option.support = {
          kind,
          before: bestKillTurns,
          after: turnsFor(after?.estimate, me, opponent).expected,
          bestKillTurns,
          effect: setup.effect,
          batonFollowUp: setup.batonFollowUp,
          setupFailed: setup.failed,
        };
      } else {
        option.support = { kind, before: 0, after: 0, bestKillTurns };
      }
    }
    return option;
  };

  /**
   * 흉내쟁이(트랙 M2): 선공이면 배틀에서 직전에 나온 기술, 후공이면 이번 턴 상대가 낼 기술(사용 확률 모델)을
   * 따라 쓴다 — 갈래마다 그 기술을 내 기술로 쓴 옵션을 만들고 결정 레이어가 가중 평균한다. 따라 쓸 수 없으면 한 턴 날림.
   */
  const buildCopycatOption = (move: Move): AiOption => {
    const option = buildMoveOption(move);
    const p = option.firstProbability;
    const branch = (copied: Move | undefined, weight: number) => ({
      weight,
      option: copied && isCopyableMove(copied) ? buildMoveOption(copied, move) : undefined,
    });
    const last = moveState.lastMoveUsedId ? getMove(moveState.lastMoveUsedId) : undefined;
    const threat = evaluateOpponentThreat({ state: moveState, opponent, target: me, targetSide: myMoveSide, opponentMovesSecond: p >= 0.5 });
    const total = threat.moveWeights.reduce((a, w) => a + w.weight, 0);
    const branches = [
      ...(p > 0 ? [branch(last, p)] : []),
      ...(p < 1 && total > 0 ? threat.moveWeights.map((w) => branch(w.move, ((1 - p) * w.weight) / total)) : []),
    ];
    option.copycat = { branches };
    return option;
  };

  for (const move of myMoves) result.push(move.callsLastMoveInBattle ? buildCopycatOption(move) : buildMoveOption(move));

  // ── 교체 옵션 ── (교체 턴에는 메가진화 없음 → 원래 state 기준)
  if (!isTrappedFromSwitching(state[key])) {
    for (const index of benchIndices(mySide)) result.push(evaluateSwitchCandidate(state, key, index));
  }

  attachParty(result, createPartyModel(moveState, key));
  return result;
}

/**
 * 파티 단위 평가(§4-5)용 첫 대면 정보를 옵션마다 붙인다. 기술 옵션은 지금 나와 있는 포켓몬(랭크 유지), 교체·유턴류·
 * 배턴터치 후보는 들어오는 포켓몬(이후 대면은 랭크 0 — 배턴터치로 받은 랭크는 첫 대면에만 반영되는 근사).
 */
function attachParty(options: AiOption[], model: PartyModel): void {
  const candidateParty = (candidates: AiOption[] | undefined) => {
    for (const c of candidates ?? []) {
      if (c.toIndex !== undefined) c.party = { model, myIndex: c.toIndex, myStaged: false };
    }
  };
  for (const option of options) {
    option.party =
      option.optionType === "switch"
        ? { model, myIndex: option.toIndex!, myStaged: false }
        : { model, myIndex: model.myActive, myStaged: true };
    candidateParty(option.pivot?.candidates);
    candidateParty(option.support?.batonFollowUp?.candidates);
    const copied = option.copycat?.branches.flatMap((b) => (b.option ? [b.option] : []));
    if (copied?.length) attachParty(copied, model);
  }
}
