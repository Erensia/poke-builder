import type { AiOption } from "./evaluator";

/**
 * decision-layer §9 파라미터(튜닝 대상) + extension §2-2 w_survival.
 * scoring:
 *  - "spec": 문서 원안 — 교체 템포 페널티 상수(switchTempoPenalty), 회복·랭크업은 연장분 × w_survival
 *  - "tempo": 공격하지 않는 모든 행동(교체·회복·랭크업)을 "이번 턴 공격 기회를 잃음 = 처치 턴 +1"로
 *    exchange_advantage와 같은 단위에서 계산한다.
 */
export interface DecisionParams {
  /**
   * "trade": HP 교환 채점 — 모든 옵션을 "상대 HP 제거 비율 − 내 HP 손실 비율"(최대 HP 대비)로 비교한다.
   *   포켓몬마다 몸이 달라 서로 비교할 수 없는 "여유 턴 수"(d − c) 대신 같은 단위를 쓴다.
   */
  scoring: "spec" | "tempo" | "trade";
  /** trade 채점의 랭크업기 보유 상대 경계 페널티(HP 비율 단위) */
  tradeRiskPenaltyBase: number;
  entryCostWeight: number;
  switchTempoPenalty: number;
  riskFlagPenaltyBase: number;
  tieThreshold: number;
  wSurvival: number;
  /** "tempo" 채점에서 교체 옵션에 추가로 빼는 값("처치 턴 +1"에 더해) */
  switchExtraPenalty: number;
  /** trade 채점에서 유턴류를 "공격 + 교체"로 평가할지. false면 교체 효과를 무시한 일반 공격기로 본다(비교용) */
  pivotAware: boolean;
  /**
   * trade 채점에서 v1 때 막아 둔 변화기(상태이상 부여·상대 랭크다운·벽·설치기·배턴터치·날씨 회복기·잠자기)를
   * "적용 후 재평가"로 점수 매길지. false면 이전처럼 고르지 않는다(비교용) — decision-layer §4-1.
   */
  statusAware: boolean;
  /** 대면이 끝난 뒤에도 남는 이득(설치기·벽 이월 항)에 곱하는 가중치 */
  wCarry: number;
}

/**
 * 기본값은 "trade" — 그리디 봇(교체 없이 가장 빨리 처치하는 기술만 사용) 상대 파티 좌우 교대 300판 시뮬레이션에서
 * spec 108승(36%) · tempo 137승 · trade 169승(56%)으로 가장 좋았다(2026-09-24). spec은 교체를 28%나 골라
 * "이미 이기는 대면에서도 튼튼한 후보로 갈아타는" 결함이 있었다 — decision-layer.md §11 참고.
 */
export const DEFAULT_DECISION_PARAMS: DecisionParams = {
  scoring: "trade",
  entryCostWeight: 1.5,
  switchTempoPenalty: 0.3,
  switchExtraPenalty: 0,
  tradeRiskPenaltyBase: 0.1,
  pivotAware: true,
  statusAware: true,
  wCarry: 1.0,
  riskFlagPenaltyBase: 0.4,
  tieThreshold: 0.1,
  wSurvival: 1.0,
};

export interface ScoredOption {
  option: AiOption;
  score: number;
  /** 점수 계산 결과가 NaN이라 −∞로 바꿨음(계산 결함 신호 — sim:ai ai 모드가 센다) */
  nan?: boolean;
}

/** 선공 +0.5 / 동속 0 / 후공 −0.5 — 선제공격손톱 확률까지 선형으로 섞인다(extension §3-4) */
function speedAdjustment(option: AiOption): number {
  return option.firstProbability - 0.5;
}

/** decision-layer §6 + extension §7-3: 확실한 선공 + 확정 1타 + 필중일 때만 */
export function isHardOverride(option: AiOption): boolean {
  return (
    option.optionType === "move" &&
    option.firstProbability === 1 &&
    option.hitsToKill.worstCase.count === 1 &&
    option.hitsToKill.worstCase.certainty === "guaranteed" &&
    option.accuracy === 1
  );
}

/** a − b. 둘 다 무한대면(서로 못 쓰러뜨림) 0, NaN은 −Infinity */
function diff(a: number, b: number): number {
  if (a === Infinity && b === Infinity) return 0;
  const d = a - b;
  return Number.isNaN(d) ? -Infinity : d;
}

/**
 * HP 교환 대면 값: 내가 killTurns(이번 턴 행동 손실분 포함) 동안 공격하고 상대는 survivalTurns 만큼 맞으면 나를
 * 쓰러뜨릴 때, 이 대면을 끝까지 이어갔을 때의 "상대 HP 제거 비율 − 내 HP 손실 비율"(각자 최대 HP 대비).
 * lostTurns: 이번 턴 공격하지 않는 행동(교체·회복·랭크업)이면 1 — 상대만 한 번 더 때린다.
 */
function raceValue(
  killTurns: number,
  survivalTurns: number,
  firstProbability: number,
  myFraction: number,
  opponentFraction: number,
  lostTurns: number,
): number {
  if (killTurns === Infinity && survivalTurns === Infinity) return 0;
  if (myFraction <= 0) return 0;
  // 상대가 나를 때리는 횟수: 내가 쓰러뜨릴 때까지(선공이면 마지막 한 번은 못 때림)
  const opponentHitsUntilKo = killTurns + lostTurns - firstProbability;
  if (opponentHitsUntilKo < survivalTurns) {
    return opponentFraction - myFraction * Math.max(0, opponentHitsUntilKo) / survivalTurns;
  }
  // 지는 대면: 쓰러지기 전까지 내가 때리는 횟수
  const myHitsBeforeFaint = Math.max(0, survivalTurns - (1 - firstProbability) - lostTurns);
  const dealt = killTurns === Infinity ? 0 : Math.min(1, myHitsBeforeFaint / killTurns);
  return opponentFraction * dealt - myFraction;
}

/** 교체 후보로 대면을 이어갔을 때의 값(진입 비용 차감). lost=1이면 들어온 포켓몬이 이번 턴 한 대를 맞는다. */
function switchInValue(candidate: AiOption, lost: number): number {
  const entry = candidate.maxHp > 0 ? candidate.entryCost / candidate.maxHp : 0;
  return (
    raceValue(
      candidate.hitsToKill.expected,
      candidate.hitsToBeKilled.expected,
      candidate.firstProbability,
      candidate.hpFraction,
      candidate.opponentHpFraction,
      lost,
    ) - entry
  );
}

/**
 * 유턴류(맞히면 교체): 명중 시 = 이번 턴 데미지 + 최선 후보로 교체한 값.
 *   선공이면 들어온 후보가 그 턴 상대 공격을 맞고(lost=1), 후공이면 지금 포켓몬이 먼저 맞은 뒤 후보가
 *   안전하게 들어온다(lost=0, 대신 지금 포켓몬 손실). 선공 확률로 섞는다.
 * 빗나감(명중률) 시 = 교체 없이 한 대 맞고 끝.
 */
function pivotValue(option: AiOption): number {
  const pivot = option.pivot!;
  const p = option.firstProbability;
  const chip = option.opponentHpFraction * pivot.hitRate;
  const bestSwitch = Math.max(
    ...pivot.candidates.map((c) => p * switchInValue(c, 1) + (1 - p) * (switchInValue(c, 0) - pivot.activeHitLoss)),
  );
  const hitChance = pivot.hitChance ?? option.accuracy;
  return hitChance * (chip + bestSwitch) + (1 - hitChance) * -pivot.activeHitLoss;
}

/**
 * 효과 변화기(decision-layer §4-1): 이번 턴은 공격하지 않고(lost=1), 효과가 걸리면 효과가 적용된 대면,
 * 빗나가면 지금 그대로의 대면을 끝까지 이어간다 + 대면 뒤에도 남는 이득(설치기·벽) × w_carry.
 */
function effectValue(option: AiOption, params: DecisionParams): number {
  const { hit, base, hitChance, carry } = option.support!.effect!;
  const my = option.hpFraction;
  const opp = option.opponentHpFraction;
  const onHit = raceValue(hit.killTurns, hit.survivalTurns, hit.firstProbability, my, opp, 1);
  const onMiss = raceValue(base.killTurns, base.survivalTurns, base.firstProbability, my, opp, 1);
  return hitChance * onHit + (1 - hitChance) * onMiss + params.wCarry * carry;
}

function tradeScore(option: AiOption, riskAversion: number, params: DecisionParams): number {
  const riskPenalty = option.riskFlag ? params.tradeRiskPenaltyBase * riskAversion : 0;
  const p = option.firstProbability;
  const opp = option.opponentHpFraction;
  if (option.support?.extended && !params.statusAware) return -Infinity;
  if (params.pivotAware && option.pivot && option.pivot.candidates.length > 0) return pivotValue(option) - riskPenalty;
  if (option.support) {
    const { kind, after, bestKillTurns, healedHpFraction } = option.support;
    if (kind === "other") return -Infinity;
    if (kind === "effect") return effectValue(option, params) - riskPenalty;
    if (kind === "heal") {
      if (params.statusAware && (option.support.healNetGain ?? 1) <= 0) return -Infinity;
      const healed = healedHpFraction ?? option.hpFraction;
      return raceValue(bestKillTurns, after, p, healed, opp, 1) + (healed - option.hpFraction) - riskPenalty;
    }
    return raceValue(after, option.hitsToBeKilled.expected, p, option.hpFraction, opp, 1) - riskPenalty;
  }
  const lost = option.optionType === "switch" ? 1 : 0;
  const entry = option.maxHp > 0 ? option.entryCost / option.maxHp : 0;
  return raceValue(option.hitsToKill.expected, option.hitsToBeKilled.expected, p, option.hpFraction, opp, lost) - entry - riskPenalty;
}

/** decision-layer §4 점수식. 데미지 없는 변화기는 extension §2-2 전용 점수식. */
export function scoreOption(option: AiOption, riskAversion: number, params: DecisionParams = DEFAULT_DECISION_PARAMS): number {
  if (params.scoring === "trade") return tradeScore(option, riskAversion, params);
  const riskPenalty = option.riskFlag ? params.riskFlagPenaltyBase * riskAversion : 0;
  const speedAdj = speedAdjustment(option);
  const tempo = params.scoring === "tempo";

  if (option.support) {
    const { kind, before, after, bestKillTurns } = option.support;
    // 그 외 변화기(설치기·상태이상 부여 등)는 원안 채점식에서는 고르지 않는다(trade 채점 전용 §4-1).
    if (kind === "other" || kind === "effect" || option.support.extended) return -Infinity;
    let value: number;
    if (tempo) {
      // 회복: 늘어난 생존 턴 − (이번 턴을 쓴 만큼 늦어진 처치 턴) / 랭크업: 지금 생존 턴 − (1 + 강화 후 처치 턴)
      value =
        kind === "heal"
          ? diff(after, bestKillTurns + 1)
          : diff(option.hitsToBeKilled.expected, after + 1);
    } else {
      const gain = kind === "heal" ? diff(after, before) : diff(before, after);
      value = gain * params.wSurvival;
    }
    return value + speedAdj - riskPenalty;
  }

  const killTurns = option.hitsToKill.expected + (tempo && option.optionType === "switch" ? 1 : 0);
  const exchangeAdvantage = diff(option.hitsToBeKilled.expected, killTurns);
  const entryPenalty = option.maxHp > 0 ? (option.entryCost / option.maxHp) * params.entryCostWeight : 0;
  const tempoPenalty =
    option.optionType === "switch" ? (tempo ? params.switchExtraPenalty : params.switchTempoPenalty) : 0;
  return exchangeAdvantage + speedAdj - entryPenalty - tempoPenalty - riskPenalty;
}

function compareBy<T>(key: (item: T) => number): (a: T, b: T) => number {
  return (a, b) => key(a) - key(b);
}

/**
 * 의사결정 레이어(decision-layer §8): 하드 오버라이드 → 점수 최고점 → ±0.1 이내면 동률 처리.
 * 동률 처리: 즉사(worst_case 1타) 위험 배제 → 진입 비용 낮은 쪽 → 방어 상성 낮은 쪽 → 공격 유지 우선.
 */
export function decide(
  options: AiOption[],
  riskAversion: number,
  params: DecisionParams = DEFAULT_DECISION_PARAMS,
): { chosen: AiOption; scored: ScoredOption[] } | null {
  if (options.length === 0) return null;
  // NaN 점수는 비교가 전부 false라 후보가 하나도 안 남는다 — 계산 결함이 있어도 배틀이 멈추지 않게 선택 불가로 본다.
  const scored = options.map((option) => {
    const score = scoreOption(option, riskAversion, params);
    return Number.isNaN(score) ? { option, score: -Infinity, nan: true } : { option, score };
  });

  const override = options.find(isHardOverride);
  if (override) return { chosen: override, scored };

  const bestScore = Math.max(...scored.map((s) => s.score));
  if (bestScore === -Infinity) return { chosen: options[0], scored };

  // 상대가 나에게 데미지를 줄 수단이 없으면 점수가 +Infinity — Infinity − Infinity(NaN) 비교를 피한다.
  let candidates = scored.filter((s) => s.score === bestScore || bestScore - s.score < params.tieThreshold);
  if (candidates.length > 1) {
    const safe = candidates.filter((s) => s.option.hitsToBeKilled.worstCase.count !== 1);
    if (safe.length > 0) candidates = safe;
    candidates = [...candidates].sort(
      (a, b) =>
        compareBy<ScoredOption>((s) => s.option.entryCost)(a, b) ||
        compareBy<ScoredOption>((s) => s.option.typeMatchup.defensive)(a, b) ||
        compareBy<ScoredOption>((s) => (s.option.optionType === "move" ? 0 : 1))(a, b) ||
        b.score - a.score,
    );
  }
  return { chosen: candidates[0].option, scored };
}
