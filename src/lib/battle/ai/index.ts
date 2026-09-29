import { type FighterKey, type TurnAction } from "@/types/battle";
import { STRUGGLE_MOVE, type BattleState } from "../state";
import { forcedLockedAction } from "../lockedAction";
import { decide, scoreOption, type DecisionParams, type ScoredOption } from "./decision";
import { evaluateOptions, type AiOption, type EvaluateOptions } from "./evaluator";
import { withThreatModel, type ThreatModelParams } from "./opponentMoveModel";
import { withModelToggles } from "./modelToggles";
import { paramsFor } from "./decision";
import { DEFAULT_SEARCH_PARAMS, searchDecide, type SearchPolicy, type SearchResult } from "./search";

export { chooseAiSelection } from "./teamSelect";

export type { AiOption } from "./evaluator";
export type { DecisionParams, ScoredOption } from "./decision";

/** decision-layer §5: 배틀 시작 시 1회 U(0,1)에서 뽑아 그 배틀 동안 계속 쓴다(매 턴 재추첨 금지) */
export function sampleRiskAversion(random: () => number = Math.random): number {
  return random();
}

/** 결정 파라미터 중 상대 기술 모델 튜닝값(§2-2) */
function threatModelOf(params: DecisionParams): ThreatModelParams {
  return {
    statusWeight: params.threatStatusWeight,
    sharpness: params.threatSharpness,
    strictWaste: params.threatStrictWaste,
    statusThreat: params.threatStatusThreat,
  };
}

export interface AiDecision {
  action: TurnAction;
  chosen?: AiOption;
  /** 디버그·튜닝용 — 모든 옵션의 평가값과 점수 */
  scored: ScoredOption[];
  /** 탐색 오라클(params.search)일 때: 평가식만으로 골랐을 선택과 롤아웃한 후보별 값 */
  baseChosen?: AiOption;
  searchValues?: { option: AiOption; value: number }[];
}

export interface ChooseAiOptions extends EvaluateOptions {
  decisionParams?: Partial<DecisionParams>;
}

/**
 * 배틀 AI(완전 정보): key 편의 이번 턴 행동을 고른다.
 * riskAversion은 sampleRiskAversion()으로 배틀 시작 시 한 번 뽑아 둔 값을 넘긴다.
 */
export function chooseAiAction(
  state: BattleState,
  key: FighterKey,
  riskAversion: number,
  options: ChooseAiOptions = {},
): AiDecision {
  // 난동·모으기 2턴째·반동 턴(ver.1.9 A1): 엔진이 정해진 행동으로 바꿔 쓰므로 고를 것이 없다
  const forced = forcedLockedAction(state[key]);
  if (forced) return { action: forced, scored: [] };
  const params = paramsFor(options.decisionParams);
  // 모델 토글(턴 종료 효과 등)은 평가(대면 턴 수)와 점수 계산(이어지는 대면)에 모두 걸린다
  const decision = withModelToggles(params, (): (Partial<SearchResult> & { chosen: AiOption; scored: ScoredOption[] }) | null => {
    // 점수 계산(파티 대면표는 이때 계산됨)도 같은 상대 기술 모델로
    return withThreatModel(threatModelOf(params), () => {
      const evaluated = evaluateOptions(state, key, options);
      if (!params.search) return decide(evaluated, riskAversion, params);
      const { search: _search, ...plainParams } = params;
      const search = { ...DEFAULT_SEARCH_PARAMS, ...params.search };
      return searchDecide({ state, key, riskAversion, params: plainParams, search, policy: searchPolicy(riskAversion, plainParams) }, evaluated);
    });
  });
  if (!decision) return { action: { kind: "move", move: STRUGGLE_MOVE }, scored: [] };
  const { chosen, scored } = decision;
  const action: TurnAction =
    chosen.optionType === "switch"
      ? { kind: "switch", toIndex: chosen.toIndex! }
      : { kind: "move", move: chosen.move!, mega: chosen.mega };
  return decision.baseChosen ? { action, chosen, scored, baseChosen: decision.baseChosen, searchValues: decision.values } : { action, chosen, scored };
}

/** 탐색 오라클이 롤아웃 안에서 쓰는 지금 AI(탐색 없음) — 기절·유턴류 교체와 depth 2의 두 번째 턴 행동 */
function searchPolicy(riskAversion: number, decisionParams: DecisionParams): SearchPolicy {
  return {
    forcedSwitch: (st, k) => chooseAiForcedSwitch(st, k, riskAversion, decisionParams),
    action: (st, k) => chooseAiAction(st, k, riskAversion, { decisionParams }).action,
  };
}

/**
 * 기절 후 강제 교체: 교체 후보만 비교한다. 이번 턴 교체 템포 손실이 없으므로 템포 페널티를 뺀 점수로 고른다.
 * 후보가 없으면 undefined.
 */
export function chooseAiForcedSwitch(
  state: BattleState,
  key: FighterKey,
  riskAversion: number,
  decisionParams?: Partial<DecisionParams>,
): number | undefined {
  const params = paramsFor(decisionParams);
  return withModelToggles(params, () => {
    return withThreatModel(threatModelOf(params), () => {
      const switches = evaluateOptions(state, key).filter((o) => o.optionType === "switch");
      if (switches.length === 0) return undefined;
      const best = switches
        .map((option) => ({ option, score: scoreOption({ ...option, optionType: "move" }, riskAversion, params) }))
        .reduce((a, b) => (b.score > a.score ? b : a));
      return best.option.toIndex;
    });
  });
}
