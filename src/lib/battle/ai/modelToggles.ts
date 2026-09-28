import { type DecisionParams } from "./decision";
import { withTrapModel } from "./evaluator";
import { withCritModel } from "./moveDamage";
import { withChanceEffectsModel, withEndOfTurnModel } from "./turnRates";

/**
 * 평가(대면 턴 수·기대 데미지)와 점수 계산(이어지는 대면) 전체에 걸리는 모델 토글을 한 번에 적용한다 — 턴 종료 효과(ver.1.8),
 * 급소(ver.1.9 6-2)·교체 봉쇄(6-3)·확률 턴 종료 효과(6-4). 모두 비교용이며 기본 켬.
 */
export function withModelToggles<T>(params: DecisionParams, fn: () => T): T {
  return withEndOfTurnModel(params.endOfTurnAware, () =>
    withChanceEffectsModel(params.chanceEffectsAware, () =>
      withCritModel(params.critAware, () => withTrapModel(params.trapMoveAware, fn)),
    ),
  );
}
