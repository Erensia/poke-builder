import { type FighterKey } from "@/types/battle";
import { NEUTRAL_ACCURACY_STAGES, NEUTRAL_CRIT_STAGE, NEUTRAL_STAGES } from "@/types/battleStats";
import { isImmuneToStatus, inflictStatus } from "@/lib/statusConditions";
import { isStatusBlockedByField } from "@/lib/fieldEffects";
import {
  abilityOf,
  isFainted,
  opponentKey,
  sideOf,
  statusImmunitiesOf,
  type BattleFighterState,
  type BattleSide,
  type BattleState,
} from "../state";
import { calcEntryHazardDamage } from "../entryCost";
import { isTrappedFromSwitching } from "../switching";
import { blendTurns } from "./statusMoveEffects";
import { isGrounded } from "../grounding";
import { estimateMoveHits } from "./moveDamage";
import { evaluateOpponentThreat, usableMoves } from "./opponentMoveModel";
import { isOneShotMove, isUsageBlocked } from "./usageConditions";
import { firstProbability } from "./speed";
import { turnsToKo } from "./turnRates";

/**
 * 파티 단위 평가(decision-layer §4-5, ver.1.8): 지금 대면이 끝난 뒤에도 남은 포켓몬끼리 대면이 이어진다고 보고
 * 최종 판세를 셈한다.
 *
 * - 대면표: 내 포켓몬 i × 상대 포켓몬 j마다 "턴당 최대 HP 대비 피해 비율"(서로)·선공 확률을 한 번씩 계산한다
 *   (쓸 때만 계산, 결정 1회 동안 캐시). HP가 깎인 상태의 처치 턴은 남은 HP ÷ 턴당 비율로 다시 낸다.
 * - 이어지는 대면: 한쪽이 쓰러지면 그 편이 다음 포켓몬을 고른다. 양쪽 다 최선을 고른다고 본다(미니맥스 — 나는 최대,
 *   상대는 최소). 이긴 쪽은 남은 HP로 계속 싸우고, 새로 나오는 쪽은 설치물 등장 비용을 치른다.
 * - 상대의 자발적 교체(로드맵 3, oppSwitch): 대면이 시작될 때마다 상대는 "그대로 / 대기 j로 교체" 중 자기에게 나은
 *   쪽을 고른다(여유 마진 + 계산 안 교체 횟수 제한). 들어오는 쪽은 내 공격 한 번 + 등장 비용, 물러난 쪽은 랭크·효과가
 *   초기화된 채 그 HP로 대기. 교체 봉쇄(검은눈빛 등)에 걸린 상대는 내 원래 포켓몬이 나와 있는 동안 교체하지 못한다.
 *   내 쪽 자발적 교체는 없다(사용자 결정 — 측정 뒤 판단).
 * - 멸망 카운트: 카운트가 끝나는 턴까지 대면이 이어지면, 교체할 수 있는 쪽은 물러나고(그 턴 상대에게 한 대) 못 하는
 *   쪽(교체 봉쇄·대기 없음)은 쓰러진다.
 * - 판세 값 F = Σ 내 남은 HP 비율 − Σ 상대 남은 HP 비율 + λ × (내 남은 마릿수 − 상대 남은 마릿수).
 *
 * 랭크: 지금 나와 있는 두 마리는 물러나지 않는 한 현재 랭크·휘발 상태를 유지한다. 한 번 물러났다 다시 나오거나 대기
 * 중이던 포켓몬은 랭크 0·휘발 상태 없음.
 */

/** 대면표 한 칸: 내 포켓몬 i vs 상대 포켓몬 j */
export interface PartyPair {
  /** 내가 턴당 깎는 상대 HP(상대 최대 HP 대비, 명중률 포함) */
  myRate: number;
  /** 상대가 턴당 깎는 내 HP(내 최대 HP 대비, 상대 기술 사용 확률 모델 기준) */
  oppRate: number;
  /** 내 선공 확률 */
  firstProbability: number;
  me: BattleFighterState;
  opponent: BattleFighterState;
}

export interface PartyModel {
  /** 결정 시점 내 파티 각 슬롯 HP 비율(기절 0) */
  myHp: number[];
  oppHp: number[];
  /** 슬롯별 설치물 등장 비용(HP 비율) */
  myEntry: number[];
  oppEntry: number[];
  myActive: number;
  oppActive: number;
  /** 지금 나와 있는 상대가 교체 봉쇄에 걸려 있음(내 지금 포켓몬이 나와 있는 동안 — 페어리록은 한 턴이라 제외) */
  oppTrapped: boolean;
  myTrapped: boolean;
  /** 지금 나와 있는 포켓몬의 멸망 카운트(없으면 Infinity) — 이번 턴을 포함해 남은 턴 수 */
  myPerish: number;
  oppPerish: number;
  /** oppStaged: 상대가 지금 나와 있는 포켓몬 그대로(랭크·휘발 상태 유지)인지 — 기본 true */
  pair(myIndex: number, myStaged: boolean, oppIndex: number, oppStaged?: boolean): PartyPair;
  /** 이어지는 대면 계산 캐시(λ 포함 키) — 이 대면표만 쓰는 계산용 */
  memo: Map<string, number>;
  /** 이 대면표를 지속 턴 효과로 얹은 계산의 캐시 — 원래 대면표마다 따로(같은 키라도 값이 다르다) */
  layeredMemo: WeakMap<PartyModel, Map<string, number>>;
}

/**
 * 지속 턴이 있는 효과(벽·날씨·필드·트릭룸·도발·앙코르·사슬묶기, §4-5 ②): 효과를 적용한 state로 만든 대면표와,
 * 지금부터 효과가 남은 턴 수. 이어지는 대면은 남은 턴까지는 이 대면표, 그 뒤는 원래 대면표로 섞어 계산한다.
 */
export interface PartyEffect {
  model: PartyModel;
  turns: number;
  /** 교체 봉쇄·멸망 카운트처럼 이어지는 대면에서만 가치가 생기는 효과 — partyEffects가 꺼져 있어도 쓴다(oppSwitchAware) */
  always?: boolean;
}

/**
 * 한 옵션의 "첫 대면"이 누구끼리인지. 상대 쪽은 항상 지금 나와 있는 포켓몬이다.
 * myStaged: 내 쪽이 지금 나와 있는 포켓몬이 그대로 싸우는 것(랭크 유지)이면 true, 교체로 들어온 포켓몬이면 false.
 * effect: 지속 턴이 있는 효과를 건 옵션의 명중 갈래. (계속 남는 효과 — 상태이상·랭크 변화 — 는 model 자체를
 * 효과 적용 state로 만든 것으로 바꿔 넣는다.)
 */
export interface PartyDuel {
  model: PartyModel;
  myIndex: number;
  myStaged: boolean;
  effect?: PartyEffect;
}

/** 물러났다 다시 나오는 포켓몬: 랭크·휘발 상태(도발·씨뿌리기·교체 봉쇄 등)·대타·멸망 카운트가 사라진다 */
function unstaged(fighter: BattleFighterState): BattleFighterState {
  return {
    ...fighter,
    stages: { ...NEUTRAL_STAGES },
    accuracyStages: { ...NEUTRAL_ACCURACY_STAGES },
    critStage: NEUTRAL_CRIT_STAGE,
    volatile: { active: {} },
    substituteHp: undefined,
    perishCount: undefined,
  };
}

/**
 * 독압정: 대기 포켓몬이 이 편 독압정 위로 등장하면 독(2층 맹독)에 걸린 상태로 대면한다고 본다(접지·타입/특성
 * 면역·이미 상태이상·필드 차단 제외). 맹독 카운터는 대면 기간 평균 근사로 2(applyEffectMove와 같은 방식).
 */
function withEntryPoison(state: BattleState, fighter: BattleFighterState, side: BattleSide): BattleFighterState {
  const layers = side.hazards.toxicSpikesLayers;
  if (layers <= 0 || fighter.status.condition || fighter.types.includes("독")) return fighter;
  const ability = abilityOf(fighter);
  if (!isGrounded(state, fighter, ability)) return fighter;
  const status = layers >= 2 ? "badly-poisoned" : "poison";
  if (isImmuneToStatus(status, fighter.types, statusImmunitiesOf(fighter, ability)) || isStatusBlockedByField(state.field, status, true)) {
    return fighter;
  }
  const inflicted = inflictStatus(fighter.status, status);
  return { ...fighter, status: status === "badly-poisoned" ? { ...inflicted, turnsElapsed: 2 } : inflicted };
}

function entryFraction(state: BattleState, fighter: BattleFighterState, side: BattleSide): number {
  if (fighter.maxHp <= 0) return 0;
  return calcEntryHazardDamage(fighter.maxHp, fighter.types, abilityOf(fighter), side.hazards, isGrounded(state, fighter)) / fighter.maxHp;
}

/** 대면표 한 칸을 계산한다(evaluateSwitchCandidate와 같은 재료 — 최선 공격기·상대 기술 모델·선공 확률) */
function computePair(state: BattleState, key: FighterKey, me: BattleFighterState, opponent: BattleFighterState): PartyPair {
  const mySide = sideOf(state, key);
  const oppSide = sideOf(state, opponentKey(key));
  let best: { move: NonNullable<ReturnType<typeof usableMoves>[number]>; expected: number } | undefined;
  for (const move of usableMoves(me)) {
    if (isOneShotMove(move) || isUsageBlocked(state, me, move, opponent)) continue;
    const estimate = estimateMoveHits(
      { state, attacker: me, defender: opponent, defenderSide: oppSide, attackerMovesSecond: false, defenderHp: opponent.maxHp },
      move,
    );
    if (!estimate || !Number.isFinite(estimate.expected) || estimate.expected <= 0) continue;
    if (!best || estimate.expected < best.expected) best = { move, expected: estimate.expected };
  }
  const probe = evaluateOpponentThreat({ state, opponent, target: me, targetSide: mySide, opponentMovesSecond: false, targetHp: me.maxHp });
  const speed = best ? firstProbability(state, me, best.move, opponent, probe.bestMove).probability : 0;
  const threat =
    speed >= 0.5
      ? evaluateOpponentThreat({ state, opponent, target: me, targetSide: mySide, opponentMovesSecond: true, targetHp: me.maxHp })
      : probe;
  return {
    myRate: best ? 1 / best.expected : 0,
    oppRate: threat.expectedRate,
    firstProbability: speed,
    me,
    opponent,
  };
}

/** key 편 기준 파티 모델. 대면표는 쓸 때만 계산한다. */
export function createPartyModel(state: BattleState, key: FighterKey): PartyModel {
  const mySide = sideOf(state, key);
  const oppSide = sideOf(state, opponentKey(key));
  const hpOf = (f: BattleFighterState) => (isFainted(f) || f.maxHp <= 0 ? 0 : f.currentHp / f.maxHp);
  const myActive = mySide.party[mySide.activeIndex];
  const oppActive = oppSide.party[oppSide.activeIndex];
  const cache = new Map<string, PartyPair>();
  const model: PartyModel = {
    myHp: mySide.party.map(hpOf),
    oppHp: oppSide.party.map(hpOf),
    myEntry: mySide.party.map((f) => entryFraction(state, f, mySide)),
    oppEntry: oppSide.party.map((f) => entryFraction(state, f, oppSide)),
    myActive: mySide.activeIndex,
    oppActive: oppSide.activeIndex,
    oppTrapped: isTrappedFromSwitching(oppActive),
    myTrapped: isTrappedFromSwitching(myActive),
    myPerish: isFainted(myActive) ? Infinity : (myActive.perishCount ?? Infinity),
    oppPerish: isFainted(oppActive) ? Infinity : (oppActive.perishCount ?? Infinity),
    memo: new Map(),
    layeredMemo: new WeakMap(),
    pair(myIndex, myStaged, oppIndex, oppStaged = true) {
      const staged = myStaged && myIndex === mySide.activeIndex;
      const oppIsStaged = oppStaged && oppIndex === oppSide.activeIndex;
      const cacheKey = `${myIndex}:${staged ? 1 : 0}:${oppIndex}:${oppIsStaged ? 1 : 0}`;
      let pair = cache.get(cacheKey);
      if (!pair) {
        const me = staged ? mySide.party[myIndex] : withEntryPoison(state, unstaged(mySide.party[myIndex]), mySide);
        const opp = oppIsStaged ? oppSide.party[oppIndex] : withEntryPoison(state, unstaged(oppSide.party[oppIndex]), oppSide);
        pair = computePair(state, key, me, opp);
        cache.set(cacheKey, pair);
      }
      return pair;
    },
  };
  return model;
}

/**
 * attacker가 target(남은 HP 비율 hp)을 쓰러뜨리는 기대 턴 수 — turnsToKo와 같은 규칙(마비 행동 확률·잠듦 막힘·
 * 상태이상 지속 데미지)을 "최대 HP 대비" 단위로 쓴다.
 */
function turnsAt(rate: number, attacker: BattleFighterState, target: BattleFighterState, hp: number): number {
  if (hp <= 0) return 0;
  // turnsToKo는 "현재 HP 대비" 비율을 받는다 — 최대 HP 대비 rate를 남은 HP 비율로 나눠 넘긴다(같은 식).
  return turnsToKo(rate / hp, attacker, target, hp * target.maxHp, rate);
}

/** 대면 한 갈래: 확률 weight로 두 포켓몬이 이 HP 비율로 끝난다 */
export interface DuelBranch {
  weight: number;
  my: number;
  opp: number;
}

/** 근소한 차이로 "뒤집혀 이긴" 갈래에서 이긴 쪽에 남기는 최소 HP(원래 HP 대비) */
const MIN_LEFT_ON_UPSET = 0.05;

/**
 * 대면 결과를 "이긴다/진다" 두 갈래로 나눈다 — decision.ts raceValue와 같은 식으로 각 갈래의 남은 HP를 내고,
 * 이길 확률은 여유 턴(d − 상대가 때리는 횟수)을 시그모이드에 넣어 정한다(σ = noise × max(1, 평균 턴 수)).
 * 결정적으로 나누면(noise 0) 여유가 0.02턴이어도 파티 전체의 판세가 통째로 뒤집혀서, 난수·급소·모델 오차 수준의
 * 차이가 옵션 점수를 크게 흔든다(교체 왕복의 원인). noise 0이면 raceValue와 정확히 같다(시나리오 테스트).
 * 서로 못 쓰러뜨리면(교착) 둘 다 그대로 한 갈래.
 */
export function duelBranches(
  inputs: readonly [killTurns: number, survivalTurns: number, firstProbability: number, my: number, opp: number, lost: number],
  noise: number,
): DuelBranch[] {
  const [killTurns, survivalTurns, firstProb, my, opp, lostTurns] = inputs;
  if (my <= 0) return [{ weight: 1, my: 0, opp }];
  if (killTurns === Infinity && survivalTurns === Infinity) return [{ weight: 1, my, opp }];
  const opponentHits = killTurns + lostTurns - firstProb;
  const margin = survivalTurns - opponentHits;
  let winChance: number;
  if (survivalTurns === Infinity) winChance = 1;
  else if (killTurns === Infinity) winChance = 0;
  else if (noise <= 0) winChance = margin > 0 ? 1 : 0;
  else winChance = 1 / (1 + Math.exp(-margin / (noise * Math.max(1, (opponentHits + survivalTurns) / 2))));

  const branches: DuelBranch[] = [];
  if (winChance > 1e-4) {
    const left = survivalTurns === Infinity ? 1 : 1 - Math.max(0, opponentHits) / survivalTurns;
    branches.push({ weight: winChance, my: my * (margin > 0 ? left : Math.max(MIN_LEFT_ON_UPSET, left)), opp: 0 });
  }
  if (winChance < 1 - 1e-4) {
    const myHitsBeforeFaint = Math.max(0, survivalTurns - (1 - firstProb) - lostTurns);
    const dealt = killTurns === Infinity ? 0 : Math.min(1, myHitsBeforeFaint / killTurns);
    const left = 1 - dealt;
    branches.push({ weight: 1 - winChance, my: 0, opp: opp * (margin > 0 ? Math.max(MIN_LEFT_ON_UPSET, left) : left) });
  }
  const total = branches.reduce((sum, b) => sum + b.weight, 0);
  return branches.map((b) => ({ ...b, weight: b.weight / total }));
}

function standing(my: number[], opp: number[], lambda: number): number {
  let value = 0;
  for (const hp of my) if (hp > 0) value += hp + lambda;
  for (const hp of opp) if (hp > 0) value -= hp + lambda;
  return value;
}

const round = (x: number) => Math.round(x * 1000);


/** 이어지는 대면 계산의 한 시점: 내·상대 파티 HP와 방금(또는 지금) 대면 중인 두 슬롯 */
interface ChainPosition {
  my: number[];
  opp: number[];
  mi: number;
  oi: number;
  /** 내 쪽 mi가 결정 시점부터 계속 나와 있던 포켓몬(랭크 유지)인지 */
  myStaged: boolean;
  /** 상대 쪽 oi가 결정 시점부터 계속 나와 있던 포켓몬인지(한 번 교체하면 false) */
  oppStaged: boolean;
  /** 지속 턴 효과가 남은 턴 수(효과 없으면 0) */
  effectLeft: number;
  /** 이 계산 안에서 상대가 자발적으로 교체한 횟수 */
  oppSwitches: number;
  /** 나와 있는 포켓몬의 남은 멸망 카운트(없으면 Infinity) */
  myPerish: number;
  oppPerish: number;
}

/** 상대 자발적 교체(로드맵 3): 교체 쪽이 margin 이상 나을 때만, 한 계산 안에서 limit번까지 */
export interface OppSwitchParams {
  margin: number;
  limit: number;
}

export interface ChainParams {
  lambda: number;
  noise: number;
  oppSwitch?: OppSwitchParams;
}

/** 이어지는 대면 계산 한 번의 문맥: 원래 대면표 + (지속 턴 효과가 있으면) 효과 대면표 */
interface ChainContext extends ChainParams {
  base: PartyModel;
  effect?: PartyModel;
}

/**
 * 캐시: 효과 대면표가 없으면 원래 대면표의 memo, 있으면 (원래, 효과) 쌍마다 따로. 효과 대면표가 다른 계산에서
 * "원래 대면표"로도 쓰이므로(계속 남는 효과) 한 memo를 나눠 쓰면 남은 턴 0인 값이 섞인다.
 */
function memoOf(ctx: ChainContext): Map<string, number> {
  if (!ctx.effect) return ctx.base.memo;
  let memo = ctx.effect.layeredMemo.get(ctx.base);
  if (!memo) {
    memo = new Map();
    ctx.effect.layeredMemo.set(ctx.base, memo);
  }
  return memo;
}

function positionKey(ctx: ChainContext, pos: ChainPosition): string {
  const turns = (x: number) => (x === Infinity ? "i" : Math.round(x * 100));
  const sw = ctx.oppSwitch ? `${ctx.oppSwitch.margin}/${ctx.oppSwitch.limit}` : "-";
  return (
    `${ctx.lambda}:${ctx.noise}:${sw}:${turns(pos.effectLeft)}|${pos.mi},${pos.oi},${pos.myStaged ? 1 : 0}${pos.oppStaged ? 1 : 0},` +
    `${pos.oppSwitches}|${turns(pos.myPerish)},${turns(pos.oppPerish)}|${pos.my.map(round).join(",")}|${pos.opp.map(round).join(",")}`
  );
}

/** 지금 쓰는 대면표(지속 턴 효과가 남았으면 효과 대면표 — 등장 비용 등) */
function activeModel(ctx: ChainContext, pos: ChainPosition): PartyModel {
  return ctx.effect && pos.effectLeft > 0 ? ctx.effect : ctx.base;
}

/** 교체 봉쇄는 결정 시점의 두 포켓몬이 그대로 나와 있는 동안만(건 쪽이 물러나면 풀린다) */
function oppLocked(ctx: ChainContext, pos: ChainPosition): boolean {
  return ctx.base.oppTrapped && pos.oppStaged && pos.myStaged;
}

function myLocked(ctx: ChainContext, pos: ChainPosition): boolean {
  return ctx.base.myTrapped && pos.myStaged && pos.oppStaged;
}

function tick(turns: number, elapsed: number): number {
  if (turns <= 0 || turns === Infinity) return turns;
  return Number.isFinite(elapsed) ? Math.max(0, turns - elapsed) : 0;
}

function aliveExcept(hp: number[], except: number): number[] {
  return hp.map((h, i) => (h > 0 && i !== except ? i : -1)).filter((i) => i >= 0);
}

/**
 * pos의 두 포켓몬이 방금 대면을 마친 상태 → 쓰러진(또는 멸망 카운트로 물러나는, leaving) 쪽이 다음 포켓몬을 고르며
 * 끝까지. 최종 판세 값 F를 돌려준다.
 */
function afterDuel(ctx: ChainContext, pos: ChainPosition, leaving?: { my: boolean; opp: boolean }): number {
  const { lambda } = ctx;
  const { my, opp, mi, oi } = pos;
  const myOut = my[mi] <= 0 || !!leaving?.my;
  const oppOut = opp[oi] <= 0 || !!leaving?.opp;
  if (!myOut && !oppOut) return standing(my, opp, lambda); // 교착 — 더 진행하지 않는다
  const myChoices = myOut ? aliveExcept(my, mi) : [mi];
  const oppChoices = oppOut ? aliveExcept(opp, oi) : [oi];
  if (myChoices.length === 0 || oppChoices.length === 0) return standing(my, opp, lambda);

  const memoKey = `A${leaving?.my ? 1 : 0}${leaving?.opp ? 1 : 0}|${positionKey(ctx, pos)}`;
  const memo = memoOf(ctx);
  const cached = memo.get(memoKey);
  if (cached !== undefined) return cached;

  // 등장 비용은 효과가 남아 있으면 효과 대면표 기준(설치기를 깐 옵션 등)
  const model = activeModel(ctx, pos);
  let best = -Infinity;
  for (const i of myChoices) {
    let worst = Infinity;
    for (const j of oppChoices) {
      const next: ChainPosition = {
        ...pos,
        my: [...my],
        opp: [...opp],
        mi: i,
        oi: j,
        myStaged: myOut ? false : pos.myStaged,
        oppStaged: oppOut ? false : pos.oppStaged,
        myPerish: myOut ? Infinity : pos.myPerish,
        oppPerish: oppOut ? Infinity : pos.oppPerish,
      };
      if (myOut) next.my[i] = Math.max(0, next.my[i] - model.myEntry[i]);
      if (oppOut) next.opp[j] = Math.max(0, next.opp[j] - model.oppEntry[j]);
      // 멸망 카운트로 물러나는 교체는 그 턴 상대에게 한 대 맞는다(상대도 새로 나오면 없음)
      if (leaving?.my && !oppOut) next.my[i] = Math.max(0, next.my[i] - model.pair(i, false, j, next.oppStaged).oppRate);
      if (leaving?.opp && !myOut) next.opp[j] = Math.max(0, next.opp[j] - model.pair(i, next.myStaged, j, false).myRate);
      // 등장 비용으로 쓰러지면 대면 없이 다시 고른다
      const value = next.my[i] <= 0 || next.opp[j] <= 0 ? afterDuel(ctx, next) : duel(ctx, next);
      worst = Math.min(worst, value);
    }
    best = Math.max(best, worst);
  }
  memo.set(memoKey, best);
  return best;
}

/** 대면표 한 칸으로 pos의 대면 c·d·p — 지속 턴 효과가 남았으면 그 턴까지는 효과 대면표로 섞는다(blendRace와 같은 식) */
function chainRace(ctx: ChainContext, pos: ChainPosition): { c: number; d: number; p: number } {
  const { my, opp, mi, oi, myStaged, oppStaged } = pos;
  const rates = (model: PartyModel) => {
    const pair = model.pair(mi, myStaged, oi, oppStaged);
    return {
      c: turnsAt(pair.myRate, pair.me, pair.opponent, opp[oi]),
      d: turnsAt(pair.oppRate, pair.opponent, pair.me, my[mi]),
      p: pair.firstProbability,
    };
  };
  const base = rates(ctx.base);
  if (!ctx.effect || pos.effectLeft <= 0) return base;
  const withEffect = rates(ctx.effect);
  if (pos.effectLeft === Infinity) return withEffect;
  const covered = pos.effectLeft;
  const raceLength = Math.min(withEffect.c, withEffect.d);
  const share = raceLength <= covered ? 1 : covered / raceLength;
  return {
    c: blendTurns(withEffect.c, base.c, covered),
    d: blendTurns(withEffect.d, base.d, covered),
    p: share * withEffect.p + (1 - share) * base.p,
  };
}

/** 대면 갈래 하나가 걸린 턴 수(이긴 갈래 = 내 처치 턴, 진 갈래 = 내가 버틴 턴) */
function elapsedOf(branch: DuelBranch, killTurns: number, survivalTurns: number): number {
  return branch.opp <= 0 ? killTurns : survivalTurns;
}

/**
 * 멸망 카운트가 대면보다 먼저 끝난다(k턴): k턴 동안 서로 깎은 뒤, 카운트가 끝난 쪽은 교체할 수 있으면 물러나고
 * (교체 봉쇄·대기 없음이면) 쓰러진다.
 */
function perishExpire(ctx: ChainContext, pos: ChainPosition, c: number, d: number, k: number): number {
  const elapsed = Math.max(0, k);
  const next: ChainPosition = {
    ...pos,
    my: [...pos.my],
    opp: [...pos.opp],
    effectLeft: tick(pos.effectLeft, elapsed),
    myPerish: pos.myPerish - elapsed,
    oppPerish: pos.oppPerish - elapsed,
  };
  if (Number.isFinite(d)) next.my[pos.mi] = pos.my[pos.mi] * Math.max(0, 1 - elapsed / d);
  if (Number.isFinite(c)) next.opp[pos.oi] = pos.opp[pos.oi] * Math.max(0, 1 - elapsed / c);
  const leaving = { my: false, opp: false };
  if (next.myPerish <= 0) {
    if (aliveExcept(next.my, pos.mi).length > 0 && !myLocked(ctx, pos)) leaving.my = true;
    else next.my[pos.mi] = 0;
  }
  if (next.oppPerish <= 0) {
    if (aliveExcept(next.opp, pos.oi).length > 0 && !oppLocked(ctx, pos)) leaving.opp = true;
    else next.opp[pos.oi] = 0;
  }
  return afterDuel(ctx, next, leaving);
}

/** c·d·p로 대면을 끝까지 치른 뒤 이어서 계산(이긴다/진다 갈래의 확률 가중 평균) — 멸망 카운트가 먼저 끝나면 그쪽 */
function fight(ctx: ChainContext, pos: ChainPosition, inputs: readonly [number, number, number, number, number, number]): number {
  const [c, d] = inputs;
  const k = Math.min(pos.myPerish, pos.oppPerish);
  if (k < Infinity && Math.min(c, d) > k) return perishExpire(ctx, pos, c, d, k);
  let value = 0;
  for (const branch of duelBranches(inputs, ctx.noise)) {
    const elapsed = elapsedOf(branch, c, d);
    const next: ChainPosition = {
      ...pos,
      my: [...pos.my],
      opp: [...pos.opp],
      effectLeft: tick(pos.effectLeft, elapsed),
      myPerish: tick(pos.myPerish, elapsed),
      oppPerish: tick(pos.oppPerish, elapsed),
    };
    next.my[pos.mi] = branch.my;
    next.opp[pos.oi] = branch.opp;
    value += branch.weight * afterDuel(ctx, next);
  }
  return value;
}

/**
 * 상대가 oi 대신 대기 j로 교체하는 턴: j는 등장 비용 + 내 공격 한 번을 받고, 물러난 oi는 그 HP로 대기(다시 나오면
 * 랭크·휘발 상태 없음). 그 뒤 j와 대면을 이어간다.
 */
function oppSwitchValue(ctx: ChainContext, pos: ChainPosition, j: number): number {
  const model = activeModel(ctx, pos);
  const next: ChainPosition = {
    ...pos,
    opp: [...pos.opp],
    oi: j,
    oppStaged: false,
    oppSwitches: pos.oppSwitches + 1,
    oppPerish: Infinity,
    myPerish: pos.myPerish - 1,
    effectLeft: tick(pos.effectLeft, 1),
  };
  const pair = model.pair(pos.mi, pos.myStaged, j, false);
  next.opp[j] = Math.max(0, next.opp[j] - model.oppEntry[j] - pair.myRate);
  return next.opp[j] <= 0 ? afterDuel(ctx, next) : duel(ctx, next);
}

/** stay(그대로 싸운 값)와 상대가 대기 포켓몬으로 교체한 값들 중 상대에게 나은 쪽 — 교체는 margin 이상 나을 때만 */
function withOppSwitch(ctx: ChainContext, pos: ChainPosition, stay: number, switchFrom: ChainPosition): number {
  const sw = ctx.oppSwitch;
  if (!sw || pos.oppSwitches >= sw.limit || oppLocked(ctx, pos)) return stay;
  let best = stay;
  for (const j of aliveExcept(switchFrom.opp, switchFrom.oi)) {
    const value = oppSwitchValue(ctx, switchFrom, j);
    if (value < stay - sw.margin && value < best) best = value;
  }
  return best;
}

/** 대면표로 pos의 두 포켓몬이 대면을 치른 뒤 이어서 계산 — 대면이 시작될 때 상대는 교체할 수 있다 */
function duel(ctx: ChainContext, pos: ChainPosition): number {
  const memoKey = `D|${positionKey(ctx, pos)}`;
  const memo = memoOf(ctx);
  const cached = memo.get(memoKey);
  if (cached !== undefined) return cached;
  const { c, d, p } = chainRace(ctx, pos);
  const stay = fight(ctx, pos, [c, d, p, pos.my[pos.mi], pos.opp[pos.oi], 0]);
  const value = withOppSwitch(ctx, pos, stay, pos);
  memo.set(memoKey, value);
  return value;
}

/** 첫 대면에 쓰는 기준 판세 — 첫 대면에서 쓰러지는 쪽은 결정 시점(model)에 살아 있었으면 한 마리로 센다 */
function startStanding(model: PartyModel, pos: ChainPosition, lambda: number): number {
  let value = standing(pos.my, pos.opp, lambda);
  if (pos.my[pos.mi] <= 0 && model.myHp[pos.mi] > 0) value += lambda;
  if (pos.opp[pos.oi] <= 0 && model.oppHp[pos.oi] > 0) value -= lambda;
  return value;
}

/**
 * 파티 단위 평가의 옵션 값(decision.ts가 raceValue 대신 쓴다): 첫 대면(옵션 자체의 c·d·p — 이긴다/진다 갈래)부터
 * 이어지는 대면들까지 끝낸 판세 − 지금 판세. (HP 교환 + 첫 대면에서 쓰러진 마릿수 × λ + 그 뒤 바뀌는 판세와 같다.)
 * 쓰러진 마릿수는 결정 시점 HP(model) 기준으로 센다 — 교체로 들어오다 설치물에 쓰러지는 경우도 한 마리로 센다.
 * 상대 자발적 교체: 이번 턴을 치른 뒤(첫 대면이 한 턴 안에 끝나지 않으면) 다음 턴에 교체하는 갈래와 비교한다.
 * myOverrides: 첫 대면에 안 나오는 내 포켓몬의 HP를 바꿔 볼 때(유턴류 후공 = 물러난 포켓몬이 한 대 맞고 빠짐).
 */
export function partyRaceValue(
  duelContext: PartyDuel,
  inputs: readonly [killTurns: number, survivalTurns: number, firstProbability: number, my: number, opp: number, lost: number],
  params: ChainParams,
  myOverrides?: Record<number, number>,
): number {
  const { model, myIndex, myStaged, effect } = duelContext;
  const ctx: ChainContext = { ...params, base: model, effect: effect?.model };
  const [killTurns, survivalTurns, , myStart, oppStart, lost] = inputs;
  const my = [...model.myHp];
  if (myOverrides) for (const [i, hp] of Object.entries(myOverrides)) my[Number(i)] = Math.max(0, hp);
  my[myIndex] = myStart;
  const opp = [...model.oppHp];
  opp[model.oppActive] = oppStart;
  const start: ChainPosition = {
    my,
    opp,
    mi: myIndex,
    oi: model.oppActive,
    myStaged,
    oppStaged: true,
    effectLeft: effect ? effect.turns : 0,
    oppSwitches: 0,
    myPerish: myStaged && myIndex === model.myActive ? model.myPerish : Infinity,
    oppPerish: model.oppPerish,
  };
  const stay = fight(ctx, start, inputs);
  let value = stay;
  if (myStart > 0 && oppStart > 0 && Math.min(killTurns, survivalTurns) > 1) {
    // 이번 턴: 내 공격 (1 − lost)번, 상대 공격 1번 → 다음 턴에 상대가 교체
    const afterTurn: ChainPosition = {
      ...start,
      my: [...my],
      opp: [...opp],
      effectLeft: tick(start.effectLeft, 1),
      myPerish: start.myPerish - 1,
      oppPerish: start.oppPerish - 1,
    };
    if (Number.isFinite(survivalTurns)) afterTurn.my[myIndex] = myStart * (1 - 1 / survivalTurns);
    if (Number.isFinite(killTurns)) afterTurn.opp[model.oppActive] = oppStart * Math.max(0, 1 - (1 - lost) / killTurns);
    value = withOppSwitch(ctx, start, stay, afterTurn);
  }
  return value - startStanding(model, start, params.lambda);
}

/**
 * 방어류 시뮬레이션처럼 한 턴을 실제로 돌린 뒤의 state(after 대면표)에서 이어지는 판세(§4-5 ②). 그 턴의 HP 변화는
 * 부르는 쪽이 세고, 여기서는 그 턴에 쓰러진 마릿수 × λ(before 기준) + 그 뒤 이어지는 대면들로 바뀌는 판세를 돌려준다.
 * 둘 다 살아 있으면 after의 두 포켓몬으로 대면을 이어가고(강제 교체로 대면이 바뀐 경우 포함), 한쪽 또는 둘 다
 * 쓰러졌으면(길동무 동반 기절 포함) 쓰러진 쪽이 다음 포켓몬을 고른다.
 */
export function partyValueAfterTurn(after: PartyModel, before: PartyModel, params: ChainParams): number {
  const { lambda } = params;
  const ctx: ChainContext = { ...params, base: after };
  const position: ChainPosition = {
    my: [...after.myHp],
    opp: [...after.oppHp],
    mi: after.myActive,
    oi: after.oppActive,
    myStaged: true,
    oppStaged: true,
    effectLeft: 0,
    oppSwitches: 0,
    myPerish: after.myPerish,
    oppPerish: after.oppPerish,
  };
  let faints = 0;
  before.oppHp.forEach((hp, j) => (faints += hp > 0 && after.oppHp[j] <= 0 ? lambda : 0));
  before.myHp.forEach((hp, i) => (faints -= hp > 0 && after.myHp[i] <= 0 ? lambda : 0));
  const bothUp = position.my[position.mi] > 0 && position.opp[position.oi] > 0;
  const end = bothUp ? duel(ctx, position) : afterDuel(ctx, position);
  return faints + end - standing(position.my, position.opp, lambda);
}
