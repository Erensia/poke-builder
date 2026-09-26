import { type FighterKey, type TurnAction } from "@/types/battle";
import { STRUGGLE_MOVE, type BattleState } from "../state";
import { DEFAULT_DECISION_PARAMS, decide, scoreOption, type DecisionParams, type ScoredOption } from "./decision";
import { evaluateOptions, type AiOption, type EvaluateOptions } from "./evaluator";
import { withThreatModel, type ThreatModelParams } from "./opponentMoveModel";
import { withEndOfTurnModel } from "./turnRates";

export type { AiOption } from "./evaluator";
export type { DecisionParams, ScoredOption } from "./decision";

/** decision-layer §5: 배틀 시작 시 1회 U(0,1)에서 뽑아 그 배틀 동안 계속 쓴다(매 턴 재추첨 금지) */
export function sampleRiskAversion(random: () => number = Math.random): number {
  return random();
}

/** 결정 파라미터 중 상대 기술 모델 튜닝값(§2-2) */
function threatModelOf(params: DecisionParams): ThreatModelParams {
  return { statusWeight: params.threatStatusWeight, sharpness: params.threatSharpness, strictWaste: params.threatStrictWaste };
}

export interface AiDecision {
  action: TurnAction;
  chosen?: AiOption;
  /** 디버그·튜닝용 — 모든 옵션의 평가값과 점수 */
  scored: ScoredOption[];
}

/** AI 난이도(ver.1.8): 어려움 = 기본값, 쉬움 = 어려움에서 평가 일부를 끄고 점수 소프트맥스로 가끔 차선(A안) */
export type AiDifficulty = "hard" | "easy";

/**
 * 난이도 프리셋 — DEFAULT_DECISION_PARAMS 위에 덮어쓴다. 쉬움은 기여가 큰 파티 단위 평가·상대 교체·턴 종료 효과와 변화기
 * 확장(A2·트랙 M·Tier 2)을 끄고 선택에 무작위성을 준다. 목표: 쉬움 대 어려움 25~35%, 무작위 상대 80% 이상(결정 레이어 §4-12).
 */
export const DIFFICULTY_PRESETS: Record<AiDifficulty, Partial<DecisionParams>> = {
  hard: {},
  easy: {
    partyAware: false,
    oppSwitchAware: false,
    endOfTurnAware: false,
    a2Aware: false,
    trackMAware: false,
    tier2Aware: false,
    choiceTemperature: 0.15,
  },
};

export interface ChooseAiOptions extends EvaluateOptions {
  decisionParams?: Partial<DecisionParams>;
  /** 기본 hard. decisionParams가 프리셋 위에 덮어쓴다 */
  difficulty?: AiDifficulty;
  /** 쉬움의 소프트맥스 선택용 난수(기본 Math.random — 시뮬레이터는 시드 고정 난수를 넘긴다) */
  random?: () => number;
}

function paramsFor(difficulty: AiDifficulty | undefined, decisionParams: Partial<DecisionParams> | undefined): DecisionParams {
  return { ...DEFAULT_DECISION_PARAMS, ...DIFFICULTY_PRESETS[difficulty ?? "hard"], ...decisionParams };
}

/**
 * 배틀 AI(완전 정보 — 난이도는 options.difficulty, 기본 어려움): key 편의 이번 턴 행동을 고른다.
 * riskAversion은 sampleRiskAversion()으로 배틀 시작 시 한 번 뽑아 둔 값을 넘긴다.
 */
export function chooseAiAction(
  state: BattleState,
  key: FighterKey,
  riskAversion: number,
  options: ChooseAiOptions = {},
): AiDecision {
  const params = paramsFor(options.difficulty, options.decisionParams);
  // 턴 종료 효과 토글은 평가(대면 턴 수)와 점수 계산(이어지는 대면)에 모두 걸린다
  const decision = withEndOfTurnModel(params.endOfTurnAware, () => {
    const evaluated = withThreatModel(threatModelOf(params), () => evaluateOptions(state, key, options));
    return decide(evaluated, riskAversion, params, options.random);
  });
  if (!decision) return { action: { kind: "move", move: STRUGGLE_MOVE }, scored: [] };
  const { chosen, scored } = decision;
  const action: TurnAction =
    chosen.optionType === "switch"
      ? { kind: "switch", toIndex: chosen.toIndex! }
      : { kind: "move", move: chosen.move!, mega: chosen.mega };
  return { action, chosen, scored };
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
  difficulty?: AiDifficulty,
): number | undefined {
  const params = paramsFor(difficulty, decisionParams);
  return withEndOfTurnModel(params.endOfTurnAware, () => {
    const switches = withThreatModel(threatModelOf(params), () => evaluateOptions(state, key)).filter(
      (o) => o.optionType === "switch",
    );
    if (switches.length === 0) return undefined;
    const best = switches
      .map((option) => ({ option, score: scoreOption({ ...option, optionType: "move" }, riskAversion, params) }))
      .reduce((a, b) => (b.score > a.score ? b : a));
    return best.option.toIndex;
  });
}
