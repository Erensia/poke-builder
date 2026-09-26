import { DEFAULT_DECISION_PARAMS, type DecisionParams } from "./decision";

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
    choiceTemperature: 0.2,
  },
};

/** 난이도 프리셋 위에 decisionParams를 덮어쓴 최종 파라미터 */
export function paramsFor(difficulty: AiDifficulty | undefined, decisionParams: Partial<DecisionParams> | undefined): DecisionParams {
  return { ...DEFAULT_DECISION_PARAMS, ...DIFFICULTY_PRESETS[difficulty ?? "hard"], ...decisionParams };
}
