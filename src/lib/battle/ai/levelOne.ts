import { type FighterKey } from "@/types/battle";
import { opponentKey, type BattleState } from "../state";
import { applySwitch } from "../switching";
import { forcedLockedAction } from "../lockedAction";
import { evaluateOptions, type AiOption } from "./evaluator";
import { isHardOverride, scoreOption, type DecisionParams, type OpponentModelParams } from "./decision";

/**
 * 상대 모델 ver2(ver.2.0 1-B) — 한 단계 추론. 상대 쪽 선택지를 지금 평가기로 채점하고(상대는 나를 고정 규칙 모델로 본다 — 재귀
 * 한 단계), 확률 ∝ exp(점수 / tau)로 상대 행동 분포를 낸다. 확정 처치(하드 오버라이드)가 있으면 결정 레이어처럼 그 중 점수 최고에 몰고,
 * 점수가 +∞인 선택지(상대가 나에게 피해를 못 받음)가 있으면 그것들에 균등.
 */
export interface LevelOneDistribution {
  /** 상대가 교체하지 않는다는 조건부 기술 사용 확률(기술 id → 확률, 합 1) */
  moveWeights: Map<string, number>;
  /** 상대 교체 확률 합 */
  switchProb: number;
  /** 교체한다는 조건부 교체 대상 분포(합 1) */
  switches: { toIndex: number; weight: number }[];
  /** 기술 id → 메가진화 선언 여부(오라클 상대 응수용) */
  megaOf: Map<string, boolean | undefined>;
}

/** 상대가 고정 성향으로 쓰는 위험 회피값 — 상대의 실제 값은 모르므로 중간값 */
const OPPONENT_RISK_AVERSION = 0.5;

export function levelOneDistribution(
  state: BattleState,
  key: FighterKey,
  params: DecisionParams,
  model: OpponentModelParams,
): LevelOneDistribution | undefined {
  const oppKey = opponentKey(key);
  // 난동·모으기·반동 중이면 행동이 정해져 있다 — 고정 규칙 모델도 그 기술만 남기므로 추론이 필요 없다
  if (forcedLockedAction(state[oppKey])) return undefined;
  const scored = evaluateOptions(state, oppKey)
    .map((option) => ({ option, score: scoreOption(option, OPPONENT_RISK_AVERSION, params) }))
    .filter((s) => !Number.isNaN(s.score) && s.score !== -Infinity);
  if (scored.length === 0) return undefined;

  let probs: number[];
  const overrides = scored.filter((s) => isHardOverride(s.option));
  const infinite = scored.filter((s) => s.score === Infinity);
  if (overrides.length > 0) {
    const best = overrides.reduce((a, b) => (b.score > a.score ? b : a));
    probs = scored.map((s) => (s === best ? 1 : 0));
  } else if (infinite.length > 0) {
    probs = scored.map((s) => (s.score === Infinity ? 1 / infinite.length : 0));
  } else {
    const top = Math.max(...scored.map((s) => s.score));
    const raw = scored.map((s) => Math.exp((s.score - top) / Math.max(1e-6, model.tau)));
    const total = raw.reduce((a, b) => a + b, 0);
    probs = raw.map((r) => r / total);
  }

  const moveWeights = new Map<string, number>();
  const megaOf = new Map<string, boolean | undefined>();
  const switchWeights = new Map<number, number>();
  let moveTotal = 0;
  let switchProb = 0;
  scored.forEach(({ option }, i) => {
    const p = probs[i];
    if (option.optionType === "switch") {
      switchWeights.set(option.toIndex!, (switchWeights.get(option.toIndex!) ?? 0) + p);
      switchProb += p;
    } else if (option.move) {
      moveWeights.set(option.move.id, (moveWeights.get(option.move.id) ?? 0) + p);
      megaOf.set(option.move.id, option.mega);
      moveTotal += p;
    }
  });
  if (moveTotal > 0) for (const [id, w] of moveWeights) moveWeights.set(id, w / moveTotal);
  const switches = [...switchWeights].map(([toIndex, w]) => ({ toIndex, weight: switchProb > 0 ? w / switchProb : 0 }));
  return { moveWeights, switchProb, switches, megaOf };
}

/**
 * 교체 읽기: 상대 교체 확률이 기준 이상이면, 들어올 포켓몬마다 실제 엔진 교체(설치물·등장 효과 반영)를 한 state에서 내 선택지를
 * 다시 평가해 같은 선택지(같은 기술 또는 같은 교체 대상)를 대안으로 붙인다. **모든 선택지에 대칭으로** — 1-B 1차는 공격기에만
 * 붙여, 흐려진 공격 점수 대비 교체·변화기가 상대적으로 올라가 AI 자신의 교체가 2배가 됐다(decision-layer 2.0-backlog 1-B 1차 결과).
 * 확정 처치(하드 오버라이드)는 교체 읽기와 무관하게 먼저 고른다(죽어내밀기가 후속 포켓몬 부담이 적다 — 사용자 확인).
 */
export function attachSwitchRead(
  state: BattleState,
  key: FighterKey,
  options: AiOption[],
  dist: LevelOneDistribution,
  model: OpponentModelParams,
): AiOption[] {
  if (!model.readSwitch || dist.switchProb < model.minSwitchProb || dist.switches.length === 0) return options;
  const oppKey = opponentKey(key);
  const incoming = dist.switches
    .filter((s) => s.weight > 0)
    .map((s) => ({ weight: s.weight, options: evaluateOptions(applySwitch(state, oppKey, s.toIndex, { voluntary: true }).nextState, key) }));
  // 왕복 끊기 ①(1-C): 직전 턴에 양쪽이 모두 자발적으로 교체했으면, 이번 턴 내 교체 선택지에는 교체 읽기를 붙이지 않는다 — 맞교체의 가치가
  // 연속으로 붙어 서로 교체만 주고받다 시간초과가 나는 것을 막는다(공격기의 교체 읽기 — 들어올 포켓몬 노리기 — 는 그대로)
  const swappedLastTurn = !!state.a.switchedInThisTurn && !!state.b.switchedInThisTurn;
  const sameChoice = (a: AiOption, b: AiOption) =>
    a.optionType === b.optionType && (a.optionType === "switch" ? a.toIndex === b.toIndex : a.move?.id === b.move?.id);
  return options.map((option) => {
    if (swappedLastTurn && option.optionType === "switch") return option;
    const alternatives: { weight: number; option: AiOption }[] = [];
    let covered = 0;
    for (const j of incoming) {
      const same = j.options.find((o) => sameChoice(o, option));
      if (!same) continue;
      alternatives.push({ weight: j.weight, option: same });
      covered += j.weight;
    }
    // 대안을 못 찾은 대상(그 state에서 못 쓰는 기술 등)은 빼고 남은 대상끼리 다시 나눈다
    if (covered <= 0) return option;
    return {
      ...option,
      switchRead: { q: dist.switchProb, alternatives: alternatives.map((a) => ({ ...a, weight: a.weight / covered })) },
    };
  });
}
