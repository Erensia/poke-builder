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
import { calcEntryHazardDamage, isGroundedForHazards } from "../entryCost";
import { blendTurns } from "./statusMoveEffects";
import { estimateMoveHits } from "./moveDamage";
import { evaluateOpponentThreat, usableMoves } from "./opponentMoveModel";
import { isOneShotMove, isUsageBlocked } from "./usageConditions";
import { firstProbability } from "./speed";
import { actionFactor, blockedTurns, residualDamageFraction } from "./turnRates";

/**
 * 파티 단위 평가(decision-layer §4-5, ver.1.8): 지금 대면이 끝난 뒤에도 남은 포켓몬끼리 대면이 이어진다고 보고
 * 최종 판세를 셈한다.
 *
 * - 대면표: 내 포켓몬 i × 상대 포켓몬 j마다 "턴당 최대 HP 대비 피해 비율"(서로)·선공 확률을 한 번씩 계산한다
 *   (쓸 때만 계산, 결정 1회 동안 캐시). HP가 깎인 상태의 처치 턴은 남은 HP ÷ 턴당 비율로 다시 낸다.
 * - 이어지는 대면: 한쪽이 쓰러지면 그 편이 다음 포켓몬을 고른다. 양쪽 다 최선을 고른다고 본다(미니맥스 — 나는 최대,
 *   상대는 최소). 이긴 쪽은 남은 HP로 계속 싸우고, 새로 나오는 쪽은 설치물 등장 비용을 치른다. 자발적 교체는 없다.
 * - 판세 값 F = Σ 내 남은 HP 비율 − Σ 상대 남은 HP 비율 + λ × (내 남은 마릿수 − 상대 남은 마릿수).
 *
 * 랭크: 지금 나와 있는 두 마리는 물러나지 않는 한 현재 랭크를 유지한다(상대는 자발적 교체가 없으니 활성 포켓몬은
 * 계속 유지). 한 번 물러났다 다시 나오거나 대기 중이던 포켓몬은 랭크 0.
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
  pair(myIndex: number, myStaged: boolean, oppIndex: number): PartyPair;
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

function unstaged(fighter: BattleFighterState): BattleFighterState {
  return {
    ...fighter,
    stages: { ...NEUTRAL_STAGES },
    accuracyStages: { ...NEUTRAL_ACCURACY_STAGES },
    critStage: NEUTRAL_CRIT_STAGE,
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
  if (!isGroundedForHazards(fighter.types, ability)) return fighter;
  const status = layers >= 2 ? "badly-poisoned" : "poison";
  if (isImmuneToStatus(status, fighter.types, statusImmunitiesOf(fighter, ability)) || isStatusBlockedByField(state.field, status)) {
    return fighter;
  }
  const inflicted = inflictStatus(fighter.status, status);
  return { ...fighter, status: status === "badly-poisoned" ? { ...inflicted, turnsElapsed: 2 } : inflicted };
}

function entryFraction(fighter: BattleFighterState, side: BattleSide): number {
  if (fighter.maxHp <= 0) return 0;
  return calcEntryHazardDamage(fighter.maxHp, fighter.types, abilityOf(fighter), side.hazards) / fighter.maxHp;
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
  const cache = new Map<string, PartyPair>();
  const model: PartyModel = {
    myHp: mySide.party.map(hpOf),
    oppHp: oppSide.party.map(hpOf),
    myEntry: mySide.party.map((f) => entryFraction(f, mySide)),
    oppEntry: oppSide.party.map((f) => entryFraction(f, oppSide)),
    myActive: mySide.activeIndex,
    oppActive: oppSide.activeIndex,
    memo: new Map(),
    layeredMemo: new WeakMap(),
    pair(myIndex, myStaged, oppIndex) {
      const staged = myStaged && myIndex === mySide.activeIndex;
      const cacheKey = `${myIndex}:${staged ? 1 : 0}:${oppIndex}`;
      let pair = cache.get(cacheKey);
      if (!pair) {
        const me = staged ? mySide.party[myIndex] : withEntryPoison(state, unstaged(mySide.party[myIndex]), mySide);
        const opp =
          oppIndex === oppSide.activeIndex
            ? oppSide.party[oppIndex]
            : withEntryPoison(state, unstaged(oppSide.party[oppIndex]), oppSide);
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
  const total = rate * actionFactor(attacker) + residualDamageFraction(target, target.maxHp);
  if (total <= 0) return Infinity;
  return Math.max(1, blockedTurns(attacker) + hp / total);
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
  /** 지속 턴 효과가 남은 턴 수(효과 없으면 0) */
  effectLeft: number;
}

interface ChainParams {
  lambda: number;
  noise: number;
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

/** pos의 두 포켓몬이 방금 대면을 마친 상태 → 쓰러진 쪽이 다음 포켓몬을 고르며 끝까지. 최종 판세 값 F를 돌려준다. */
function afterDuel(ctx: ChainContext, pos: ChainPosition): number {
  const { lambda, base } = ctx;
  const { my, opp, mi, oi, myStaged } = pos;
  const myDown = my[mi] <= 0;
  const oppDown = opp[oi] <= 0;
  if (!myDown && !oppDown) return standing(my, opp, lambda); // 교착 — 더 진행하지 않는다
  const myChoices = myDown ? my.map((hp, i) => (hp > 0 ? i : -1)).filter((i) => i >= 0) : [mi];
  const oppChoices = oppDown ? opp.map((hp, j) => (hp > 0 ? j : -1)).filter((j) => j >= 0) : [oi];
  if (myChoices.length === 0 || oppChoices.length === 0) return standing(my, opp, lambda);

  const left = pos.effectLeft === Infinity ? "inf" : Math.round(pos.effectLeft * 100);
  const memoKey = `${lambda}:${ctx.noise}:${left}|${mi},${oi},${myStaged ? 1 : 0}|${my.map(round).join(",")}|${opp.map(round).join(",")}`;
  const memo = memoOf(ctx);
  const cached = memo.get(memoKey);
  if (cached !== undefined) return cached;

  let best = -Infinity;
  for (const i of myChoices) {
    let worst = Infinity;
    for (const j of oppChoices) {
      const next: ChainPosition = { ...pos, my: [...my], opp: [...opp], mi: i, oi: j, myStaged: myDown ? false : myStaged };
      // 등장 비용은 효과가 남아 있으면 효과 대면표 기준(설치기를 깐 옵션 등)
      const entry = ctx.effect && pos.effectLeft > 0 ? ctx.effect : base;
      if (myDown) next.my[i] = Math.max(0, next.my[i] - entry.myEntry[i]);
      if (oppDown) next.opp[j] = Math.max(0, next.opp[j] - entry.oppEntry[j]);
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
  const { my, opp, mi, oi, myStaged } = pos;
  const rates = (model: PartyModel) => {
    const pair = model.pair(mi, myStaged, oi);
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

/** 대면 갈래 하나가 걸린 턴 수만큼 남은 효과 턴을 줄인다(이긴 갈래 = 내 처치 턴, 진 갈래 = 내가 버틴 턴) */
function remainingEffect(effectLeft: number, branch: DuelBranch, killTurns: number, survivalTurns: number): number {
  if (effectLeft <= 0 || effectLeft === Infinity) return effectLeft;
  const elapsed = branch.opp <= 0 ? killTurns : survivalTurns;
  return Number.isFinite(elapsed) ? Math.max(0, effectLeft - elapsed) : 0;
}

/** 대면표로 pos의 두 포켓몬이 대면을 끝까지 치른 뒤 이어서 계산(이긴다/진다 갈래의 확률 가중 평균) */
function duel(ctx: ChainContext, pos: ChainPosition): number {
  const { my, opp, mi, oi } = pos;
  const { c, d, p } = chainRace(ctx, pos);
  let value = 0;
  for (const branch of duelBranches([c, d, p, my[mi], opp[oi], 0], ctx.noise)) {
    const next: ChainPosition = { ...pos, my: [...my], opp: [...opp], effectLeft: remainingEffect(pos.effectLeft, branch, c, d) };
    next.my[mi] = branch.my;
    next.opp[oi] = branch.opp;
    value += branch.weight * afterDuel(ctx, next);
  }
  return value;
}

/**
 * 파티 단위 평가의 옵션 값(decision.ts가 raceValue 대신 쓴다): 첫 대면(옵션 자체의 c·d·p — 이긴다/진다 갈래)의
 * HP 교환 + 첫 대면에서 쓰러진 마릿수 × λ + 그 뒤 이어지는 대면들로 바뀌는 판세의 확률 가중 평균.
 * 쓰러진 마릿수는 결정 시점 HP(model) 기준으로 센다 — 교체로 들어오다 설치물에 쓰러지는 경우도 한 마리로 센다.
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
  const { lambda } = params;
  const [killTurns, survivalTurns, , myStart, oppStart] = inputs;
  const base = [...model.myHp];
  if (myOverrides) for (const [i, hp] of Object.entries(myOverrides)) base[Number(i)] = Math.max(0, hp);
  let value = 0;
  for (const branch of duelBranches(inputs, params.noise)) {
    const my = [...base];
    const opp = [...model.oppHp];
    my[myIndex] = branch.my;
    opp[model.oppActive] = branch.opp;
    const exchange = oppStart - branch.opp - (myStart - branch.my);
    const faints =
      (model.oppHp[model.oppActive] > 0 && branch.opp <= 0 ? lambda : 0) - (model.myHp[myIndex] > 0 && branch.my <= 0 ? lambda : 0);
    const effectLeft = effect ? remainingEffect(effect.turns, branch, killTurns, survivalTurns) : 0;
    const position: ChainPosition = { my, opp, mi: myIndex, oi: model.oppActive, myStaged, effectLeft };
    const rest = afterDuel(ctx, position) - standing(my, opp, lambda);
    value += branch.weight * (exchange + faints + rest);
  }
  return value;
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
    effectLeft: 0,
  };
  let faints = 0;
  before.oppHp.forEach((hp, j) => (faints += hp > 0 && after.oppHp[j] <= 0 ? lambda : 0));
  before.myHp.forEach((hp, i) => (faints -= hp > 0 && after.myHp[i] <= 0 ? lambda : 0));
  const bothUp = position.my[position.mi] > 0 && position.opp[position.oi] > 0;
  const end = bothUp ? duel(ctx, position) : afterDuel(ctx, position);
  return faints + end - standing(position.my, position.opp, lambda);
}
