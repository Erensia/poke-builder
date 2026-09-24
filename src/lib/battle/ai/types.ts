/** 공통 평가 엔진의 c/d 출력. worstCase는 기존 5단계 판정을, expected는 확률 가중 기대 타수(명중률 반영)를 담는다. */
export interface WorstCase {
  /** 확1타/난수1타=1, 확2타/난수2타=2, 3타 이상=3 */
  count: number;
  certainty: "guaranteed" | "random";
  /** count 타 안에 끝낼 확률(0~1). 3타 이상 판정이면 0 */
  probability: number;
}

export interface HitsEstimate {
  /** 기대 "턴 수"(명중률 반영). 결정력 0(무효)이면 Infinity */
  expected: number;
  worstCase: WorstCase;
}
