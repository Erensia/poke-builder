import { type FighterKey, type TurnAction } from "@/types/battle";
import { isFainted, opponentKey, sideOf, type BattleState } from "../state";
import { resumeTurn, runTurn, type RunTurnOutcome } from "../runTurn";
import { applySwitch } from "../switching";
import { forcedLockedAction } from "../lockedAction";
import { canMegaEvolve, evaluateOptions, type AiOption } from "./evaluator";
import { evaluateOpponentThreat } from "./opponentMoveModel";
import { createPartyModel, partyValueAfterTurn } from "./partyEval";
import { chainParams, decide, isHardOverride, type DecisionParams, type ScoredOption } from "./decision";

/**
 * 탐색 오라클(ver.2.0 0단계, `2.0-backlog.md`): 후보 행동마다 실제 엔진(runTurn)으로 한 턴(또는 두 턴)을 돌리고, 결과 state를
 * 지금의 평가식으로 채점한다. §4-4 방어류 한 턴 시뮬레이션을 모든 선택지로 넓힌 것 — 급소·추가효과·명중 분포, 상대 선공기,
 * 다단히트 vs 띠, 반동 뒤 쉬는 턴 등 엔진이 처리하는 규칙이 자동으로 들어간다. 시뮬레이터 측정용(기본 끔).
 *
 *   값(o) = Σ_상대 행동 w × 평균_시드 [ 그 턴(들)의 판세 변화 ΔF + 잎 평가 ]
 *   판세 F = Σ 내 HP 비율 − Σ 상대 HP 비율 + λ × (내 남은 마릿수 − 상대 남은 마릿수)   (§4-5와 같은 단위)
 *   잎 평가 = "precise": 그 state에서 AI 쪽 최선 옵션 점수(평가식 그대로 — 점수는 그 state부터의 판세 변화 기대값)
 *            "fast": 파티 대면표만으로 이어지는 판세(partyValueAfterTurn)
 */
export interface SearchParams {
  /** 롤아웃 턴 수(1 = 후보 행동 한 턴, 2 = 이어서 양쪽 모두 지금 AI 정책으로 한 턴 더) */
  depth: 1 | 2;
  /** 상대 행동·후보마다 같은 시드 묶음(공통 난수)으로 돌릴 횟수 */
  seeds: number;
  leaf: "precise" | "fast";
  /** 상대 행동 후보 최대 개수(기술 — 확률 5% 미만 제외) */
  maxOpponentMoves: number;
  /** 상대가 자기 평가로 교체를 고르면 그 교체를 이 비중으로 섞는다(§4-10 oppSwitchWeight와 같은 뜻). 0이면 교체 없음 */
  opponentSwitchWeight: number;
  /** 점수(평가식) 상위 K개만 롤아웃(0 = 전부) */
  topK: number;
}

export const DEFAULT_SEARCH_PARAMS: SearchParams = {
  depth: 1,
  seeds: 4,
  leaf: "precise",
  maxOpponentMoves: 4,
  opponentSwitchWeight: 0.5,
  topK: 0,
};

/** 오라클이 부르는 지금 AI(탐색 없음) — index.ts가 넘긴다(순환 import 방지) */
export interface SearchPolicy {
  /** 기절·유턴류 교체 선택 */
  forcedSwitch: (state: BattleState, key: FighterKey) => number | undefined;
  /** depth 2의 두 번째 턴 행동 */
  action: (state: BattleState, key: FighterKey) => TurnAction;
}

export interface SearchResult {
  chosen: AiOption;
  /** 평가식만으로 골랐을 선택(비교·분류용) */
  baseChosen: AiOption;
  /** 후보별 오라클 값(롤아웃한 것만) */
  values: { option: AiOption; value: number }[];
  scored: ScoredOption[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** key 편 관점 판세 F */
function standing(state: BattleState, key: FighterKey, lambda: number): number {
  const sum = (k: FighterKey) =>
    sideOf(state, k).party.reduce(
      (acc, f) => {
        const up = !isFainted(f) && f.maxHp > 0;
        return { hp: acc.hp + (up ? f.currentHp / f.maxHp : 0), alive: acc.alive + (up ? 1 : 0) };
      },
      { hp: 0, alive: 0 },
    );
  const me = sum(key);
  const opp = sum(opponentKey(key));
  return me.hp - opp.hp + lambda * (me.alive - opp.alive);
}

function toAction(option: AiOption): TurnAction {
  return option.optionType === "switch" ? { kind: "switch", toIndex: option.toIndex! } : { kind: "move", move: option.move!, mega: option.mega };
}

function livingBench(state: BattleState, key: FighterKey): number[] {
  const side = sideOf(state, key);
  return side.party.map((_, i) => i).filter((i) => i !== side.activeIndex && !isFainted(side.party[i]));
}

/**
 * 상대 행동 분포: 상대 기술 사용 확률 모델(§2) — 확률 5% 미만 제외, 큰 순 최대 N개 — 에, 상대가 자기 평가(지금 AI)로 교체를
 * 고르면 그 교체를 opponentSwitchWeight만큼 섞는다. 난동·모으기·반동 중이면 정해진 행동 하나.
 */
function opponentActions(state: BattleState, key: FighterKey, riskAversion: number, params: DecisionParams, search: SearchParams) {
  const oppKey = opponentKey(key);
  const locked = forcedLockedAction(state[oppKey]);
  if (locked) return [{ action: locked, weight: 1 }];
  const threat = evaluateOpponentThreat({
    state,
    opponent: state[oppKey],
    target: state[key],
    targetSide: sideOf(state, key),
    opponentMovesSecond: false,
  });
  const mega = canMegaEvolve(state, oppKey) || undefined;
  const picked = [...threat.moveWeights]
    .filter((w) => w.weight >= 0.05)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, search.maxOpponentMoves);
  const total = picked.reduce((sum, w) => sum + w.weight, 0);
  let actions: { action: TurnAction; weight: number }[] =
    total > 0 ? picked.map((w) => ({ action: { kind: "move", move: w.move, mega }, weight: w.weight / total })) : [];
  if (search.opponentSwitchWeight > 0) {
    const own = decide(evaluateOptions(state, oppKey), riskAversion, params);
    if (own?.chosen.optionType === "switch") {
      const w = actions.length > 0 ? search.opponentSwitchWeight : 1;
      actions = actions.map((a) => ({ ...a, weight: a.weight * (1 - w) }));
      actions.push({ action: { kind: "switch", toIndex: own.chosen.toIndex! }, weight: w });
    }
  }
  return actions;
}

/** 한 턴을 끝까지(유턴류 멈춤·기절 교체 포함) 진행한다. 배틀이 끝났으면 ended */
function playTurn(
  state: BattleState,
  key: FighterKey,
  mine: TurnAction,
  theirs: TurnAction,
  random: () => number,
  policy: SearchPolicy,
): { state: BattleState; ended: boolean } {
  const [actionA, actionB] = key === "a" ? [mine, theirs] : [theirs, mine];
  let out = runTurn(state, actionA, actionB, random);
  for (let guard = 0; "awaitingSelfSwitch" in out && guard < 5; guard++) {
    const side = out.awaitingSelfSwitch.side;
    const bench = livingBench(out._ctx.state, side);
    out = resumeTurn(out._ctx, bench.length ? (policy.forcedSwitch(out._ctx.state, side) ?? bench[0]) : -1);
  }
  if ("awaitingSelfSwitch" in out) return { state: out.nextState, ended: true };
  const done = out as RunTurnOutcome;
  let next = done.nextState;
  if (done.result.winner) return { state: next, ended: true };
  for (const side of ["a", "b"] as const) {
    if (!done.forcedSwitch?.[side]) continue;
    const bench = livingBench(next, side);
    if (bench.length === 0) continue;
    next = applySwitch(next, side, policy.forcedSwitch(next, side) ?? bench[0]).nextState;
  }
  return { state: next, ended: false };
}

/** 잎 평가: 롤아웃이 끝난 state에서 앞으로 기대되는 판세 변화 */
function leafValue(
  leaf: BattleState,
  key: FighterKey,
  riskAversion: number,
  params: DecisionParams,
  search: SearchParams,
): number {
  if (search.leaf === "precise" && !forcedLockedAction(leaf[key]) && !isFainted(leaf[key]) && !isFainted(leaf[opponentKey(key)])) {
    const decision = decide(evaluateOptions(leaf, key), riskAversion, params);
    if (decision) {
      const best = Math.max(...decision.scored.map((s) => s.score));
      if (Number.isFinite(best)) return best;
    }
  }
  // fast(또는 precise를 쓸 수 없는 state — 강제 행동 중·점수 전부 −∞): 대면표로 이어지는 판세. 그 턴 쓰러진 마릿수는 ΔF가 이미
  // 셌으므로 partyValueAfterTurn의 마릿수 항(before = 잎 자신이면 0)은 쓰지 않는다.
  const model = createPartyModel(leaf, key);
  return partyValueAfterTurn(model, model, chainParams(params));
}

/**
 * 탐색 오라클 결정. 하드 오버라이드(확정 처치)는 평가식 그대로 먼저, 점수가 −∞인 선택지는 후보에서 뺀다.
 * 후보가 하나뿐이면 롤아웃하지 않는다.
 */
export interface SearchContext {
  state: BattleState;
  key: FighterKey;
  riskAversion: number;
  /** 탐색 없는 결정 파라미터(롤아웃 안의 평가·채점용) */
  params: DecisionParams;
  search: SearchParams;
  policy: SearchPolicy;
}

export function searchDecide(ctx: SearchContext, options: AiOption[]): SearchResult | null {
  const { state, key, riskAversion, params, search, policy } = ctx;
  const base = decide(options, riskAversion, params);
  if (!base) return null;
  const { scored } = base;
  const plain: SearchResult = { chosen: base.chosen, baseChosen: base.chosen, values: [], scored };
  if (scored.some((s) => isHardOverride(s.option))) return plain;
  let candidates = scored.filter((s) => Number.isFinite(s.score) || s.score === Infinity);
  if (search.topK > 0) candidates = [...candidates].sort((a, b) => b.score - a.score).slice(0, search.topK);
  if (candidates.length <= 1) return plain;

  const lambda = params.partyCountWeight;
  const f0 = standing(state, key, lambda);
  const theirs = opponentActions(state, key, riskAversion, params, search);
  if (theirs.length === 0) return plain;
  // 공통 난수: 모든 후보가 (상대 행동, 시드 번호)마다 같은 난수열을 쓴다 — 턴 번호로 배틀 안에서도 매 턴 다르게
  const seedOf = (j: number, s: number) => (state.turnNumber + 1) * 0x9e3779b1 + j * 0x85ebca6b + s * 0xc2b2ae35;

  const values = candidates.map(({ option }) => {
    const mine = toAction(option);
    let value = 0;
    theirs.forEach(({ action, weight }, j) => {
      let sum = 0;
      for (let s = 0; s < search.seeds; s++) {
        const random = mulberry32(seedOf(j, s));
        let turn = playTurn(state, key, mine, action, random, policy);
        if (!turn.ended && search.depth === 2) {
          turn = playTurn(turn.state, key, policy.action(turn.state, key), policy.action(turn.state, opponentKey(key)), random, policy);
        }
        const delta = standing(turn.state, key, lambda) - f0;
        sum += delta + (turn.ended ? 0 : leafValue(turn.state, key, riskAversion, params, search));
      }
      value += weight * (sum / search.seeds);
    });
    return { option, value };
  });
  const best = values.reduce((a, b) => (b.value > a.value ? b : a));
  return { chosen: best.option, baseChosen: base.chosen, values, scored };
}
