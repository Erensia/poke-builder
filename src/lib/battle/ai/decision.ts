import type { AiOption } from "./evaluator";
import { DEFAULT_THREAT_MODEL } from "./opponentMoveModel";
import { A1_EFFECT_KINDS, A2_EFFECT_KINDS, PHASE3_EFFECT_KINDS, TRACK_M_EFFECT_KINDS, TIER2_EFFECT_KINDS } from "./statusMoveEffects";
import { ALL_PROTECT_GROUPS, type ProtectGroup } from "./protectMoves";
import { partyRaceValue, partyValueAfterTurn, type ChainParams, type PartyDuel, type PartyEffect } from "./partyEval";

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
  /**
   * 랭크업기를 "적용 후 재평가"(c·d·p 전부 — 스피드·방어 랭크업 반영)와 "올린 뒤 배턴터치"로 평가할지(§4-2).
   * false면 v1 방식(랭크업 후 c만 재계산). statusAware가 false면 이것도 꺼진다.
   */
  setupAware: boolean;
  /** 3단계 효과 변화기(날씨·필드·트릭룸·도발·앙코르·사슬묶기, §4-3)를 평가할지. false면 고르지 않는다(비교용) */
  phase3Aware: boolean;
  /** 평가할 방어류 묶음(§4-4) — 빼면 그 묶음은 고르지 않는다(묶음별 비교용) */
  protectGroups: readonly ProtectGroup[];
  /** 동률 처리 4순위를 "이번 턴 처치 가능한 공격기 > 그 외 기술 > 교체"로(§7). false면 이전 "기술 > 교체" */
  tieAttackFirst: boolean;
  /** 상대 기술 모델(§2-2): 의미 있는 변화기 1개당 사용 확률 */
  threatStatusWeight: number;
  /** 상대 기술 모델: 공격기 사용 확률 ∝ 데미지^k (1 = v1 데미지 비례) */
  threatSharpness: number;
  /** 상대 기술 모델: 지금 효과 없는 변화기(가득 찬 HP 회복·+6 랭크업·이미 깔린 벽·이미 상태이상)도 확률 0 */
  threatStrictWaste: boolean;
  /**
   * 파티 단위 평가(§4-5): 옵션의 첫 대면이 끝난 뒤 남은 포켓몬끼리의 대면을 미니맥스로 이어서 계산해 점수에 더한다.
   * false면 지금 대면만 보는 이전 동작(비교용). trade 채점 전용.
   */
  partyAware: boolean;
  /** 파티 단위 평가의 판세 값에서 남은 마릿수 1마리의 가치(λ, HP 비율 단위) */
  partyCountWeight: number;
  /** 파티 단위 평가에서 대면 승패를 확률로 나눌 때의 폭(여유 턴 σ = 이 값 × 평균 턴 수). 0이면 결정적 */
  partyDuelNoise: number;
  /**
   * §4-5 ②: 변화기·랭크업·방어류의 효과를 이어지는 대면(대면표)에도 남긴다 — 지속 턴 효과는 남은 턴만큼,
   * 설치기는 실제 등장 비용으로, 방어류는 한 턴 뒤 state에서(쓰러짐·길동무 동반 기절 포함). false면 ① 동작(비교용).
   */
  partyEffects: boolean;
  /**
   * AI-A1(ver.1.8) 변화기 — 흑안개·신비의부적·아쿠아링/뿌리박기·씨뿌리기·혼란·헤롱헤롱·하품(효과), 희망사항(지연 회복),
   * 배북(랭크 설정형 랭크업)을 평가할지. false면 이전처럼 고르지 않는다(비교용).
   */
  a1Aware: boolean;
  /**
   * AI-A2(ver.1.8) — 대타출동·울부짖기/날려버리기·추억의선물(효과), 잠꼬대(잠든 동안 무작위 기술 기대값)를 평가할지.
   * false면 이전처럼 고르지 않는다(비교용). 추억의선물은 파티 단위 평가가 꺼져 있으면 평가할 수 없어 고르지 않는다.
   */
  a2Aware: boolean;
  /** 트랙 M(ver.1.8) — 엔진에 새로 구현한 변화기(트릭·아픔나누기·순풍·리사이클·꿀꺽 등)를 평가할지(비교용) */
  trackMAware: boolean;
  /** 변화기 판단 Tier 2(ver.1.8) — 파워스왑·가드셰어·변신·코트체인지 등을 평가할지(비교용) */
  tier2Aware: boolean;
  /**
   * 로드맵 3 — 이어지는 대면에서 상대의 자발적 교체를 모델링한다(대면 시작마다 "그대로 / 교체" 중 상대에게 나은 쪽).
   * 교체 봉쇄 기술(검은눈빛·블록)의 가치도 이걸로 생긴다. false면 이전 동작(비교용).
   */
  oppSwitchAware: boolean;
  /** 상대가 교체하려면 교체 쪽이 이만큼(판세 값 단위) 나아야 한다 — 왕복·근소한 차이의 교체 억제 */
  oppSwitchMargin: number;
  /** 이어지는 대면 한 번의 계산 안에서 상대가 자발적으로 교체하는 최대 횟수 */
  oppSwitchLimit: number;
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
  setupAware: true,
  tieAttackFirst: true,
  phase3Aware: true,
  protectGroups: ALL_PROTECT_GROUPS,
  // §2-2 튜닝값 — 근거는 DEFAULT_THREAT_MODEL 주석
  threatStatusWeight: DEFAULT_THREAT_MODEL.statusWeight,
  threatSharpness: DEFAULT_THREAT_MODEL.sharpness,
  threatStrictWaste: DEFAULT_THREAT_MODEL.strictWaste,
  riskFlagPenaltyBase: 0.4,
  tieThreshold: 0.1,
  wSurvival: 1.0,
  partyAware: true,
  partyCountWeight: 0.5,
  partyDuelNoise: 0.5,
  partyEffects: false,
  a1Aware: true,
  a2Aware: true,
  trackMAware: true,
  tier2Aware: true,
  oppSwitchAware: true,
  oppSwitchMargin: 0.1,
  oppSwitchLimit: 1,
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
export function raceValue(
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

/**
 * raceValue, 또는 파티 단위 평가(§4-5, partyAware): 첫 대면(이 인자들)을 이긴다/진다 갈래로 나누고 각 갈래 뒤로 남은
 * 포켓몬끼리 이어지는 대면까지 계산한 값. myOverrides = 첫 대면에 안 나오는 내 포켓몬의 HP를 바꿔 볼 때(유턴류 후공 등).
 */
function race(
  params: DecisionParams,
  party: PartyDuel | undefined,
  inputs: [killTurns: number, survivalTurns: number, firstProbability: number, my: number, opp: number, lost: number],
  myOverrides?: Record<number, number>,
): number {
  if (!params.partyAware || !party) return raceValue(...inputs);
  return partyRaceValue(party, inputs, chainParams(params), myOverrides);
}

/** 이어지는 대면 계산 파라미터(λ·대면 폭·상대 자발적 교체) */
function chainParams(params: DecisionParams): ChainParams {
  return {
    lambda: params.partyCountWeight,
    noise: params.partyDuelNoise,
    oppSwitch: params.oppSwitchAware ? { margin: params.oppSwitchMargin, limit: params.oppSwitchLimit } : undefined,
  };
}

/** 교체 후보로 대면을 이어갔을 때의 값(진입 비용 차감). lost=1이면 들어온 포켓몬이 이번 턴 한 대를 맞는다. */
function switchInValue(candidate: AiOption, lost: number, params: DecisionParams, myOverrides?: Record<number, number>): number {
  const entry = candidate.maxHp > 0 ? candidate.entryCost / candidate.maxHp : 0;
  return (
    race(
      params,
      candidate.party,
      [
        candidate.hitsToKill.expected,
        candidate.hitsToBeKilled.expected,
        candidate.firstProbability,
        candidate.hpFraction,
        candidate.opponentHpFraction,
        lost,
      ],
      myOverrides,
    ) - entry
  );
}

/**
 * 효과가 걸린 갈래의 첫 대면 정보: 계속 남는 효과(turns = ∞)면 대면표 자체를 효과 적용 state 것으로 바꾸고,
 * 지속 턴 효과면 원래 대면표 + 효과 대면표·남은 턴을 함께 넘긴다(§4-5 ②).
 */
function withEffect(party: PartyDuel | undefined, effect: PartyEffect | undefined, params: DecisionParams): PartyDuel | undefined {
  if (!party || !effect || (!params.partyEffects && !effect.always)) return party;
  return effect.turns === Infinity ? { ...party, model: effect.model } : { ...party, effect };
}

/** 교체로 물러나는 지금 포켓몬의 HP를 hp로 본다(파티 단위 평가용 덮어쓰기) */
function activeHpOverride(option: AiOption, hp: number): Record<number, number> | undefined {
  return option.party ? { [option.party.model.myActive]: hp } : undefined;
}

/**
 * 유턴류(맞히면 교체): 명중 시 = 이번 턴 데미지 + 최선 후보로 교체한 값.
 *   선공이면 들어온 후보가 그 턴 상대 공격을 맞고(lost=1), 후공이면 지금 포켓몬이 먼저 맞은 뒤 후보가
 *   안전하게 들어온다(lost=0, 대신 지금 포켓몬 손실). 선공 확률로 섞는다.
 * 빗나감(명중률) 시 = 교체 없이 한 대 맞고 끝.
 */
function pivotValue(option: AiOption, params: DecisionParams): number {
  const pivot = option.pivot!;
  const p = option.firstProbability;
  const chip = option.opponentHpFraction * pivot.hitRate;
  const my = option.hpFraction;
  // 꼬리자르기(Tier 2-C): 교체 전에 치르는 HP — 물러난 포켓몬은 그만큼 깎인 채로 이어지는 대면에 남는다
  const cost = pivot.selfCost ?? 0;
  const bestSwitch =
    Math.max(
      ...pivot.candidates.map(
        (c) =>
          p * switchInValue(c, 1, params, activeHpOverride(option, my - cost)) +
          (1 - p) * (switchInValue(c, 0, params, activeHpOverride(option, my - pivot.activeHitLoss - cost)) - pivot.activeHitLoss),
      ),
    ) - cost;
  const hitChance = pivot.hitChance ?? option.accuracy;
  // 빗나감: 교체 없이 한 대 맞음. 파티 단위 평가에서는 "이번 턴을 날린 채 대면을 이어감"(lost=1)으로 본다 —
  // 다른 갈래가 이어지는 대면의 가치를 포함하므로 같은 기준으로 맞춘다.
  const onMiss =
    params.partyAware && option.party
      ? race(params, option.party, [option.hitsToKill.expected, option.hitsToBeKilled.expected, p, my, option.opponentHpFraction, 1])
      : -pivot.activeHitLoss;
  return hitChance * (chip + bestSwitch) + (1 - hitChance) * onMiss;
}

/**
 * 효과 변화기(decision-layer §4-1): 이번 턴은 공격하지 않고(lost=1), 효과가 걸리면 효과가 적용된 대면,
 * 빗나가면 지금 그대로의 대면을 끝까지 이어간다 + 대면 뒤에도 남는 이득(설치기·벽) × w_carry.
 */
function effectValue(option: AiOption, params: DecisionParams): number {
  const effect = option.support!.effect!;
  if (effect.phaze) return phazeValue(option, params);
  if (effect.sacrifice) return sacrificeValue(option, params);
  if (effect.partyShift) return partyShiftValue(option, params);
  const { hit, base, hitChance, selfCost = 0 } = effect;
  const my = option.hpFraction;
  const opp = option.opponentHpFraction;
  const hitParty = withEffect(option.party, effect.party, params);
  // HP 비용(소울비트류)은 치른 만큼 손실로 빼고, 대면은 깎인 HP에서 시작한다. 아픔나누기는 두 HP가 바뀐 채로 시작하고
  // 그 변화(상대 손실 − 내 손실)를 더한다.
  // 경혈찌르기(트랙 M2): 오를 능력마다의 대면을 평균
  if (effect.branches) {
    const onBranches = effect.branches.reduce(
      (sum, b) =>
        sum + b.weight * race(params, withEffect(option.party, b.party, params), [b.hit.killTurns, b.hit.survivalTurns, b.hit.firstProbability, my, opp, 1]),
      0,
    );
    return onBranches + params.wCarry * effect.carry;
  }
  const onHit = effect.hpAfter
    ? opp - effect.hpAfter.opp - (my - effect.hpAfter.my) +
      race(params, hitParty, [hit.killTurns, hit.survivalTurns, hit.firstProbability, effect.hpAfter.my, effect.hpAfter.opp, 1])
    : race(params, hitParty, [hit.killTurns, hit.survivalTurns, hit.firstProbability, my - selfCost, opp, 1]) - selfCost;
  const onMiss = race(params, option.party, [base.killTurns, base.survivalTurns, base.firstProbability, my, opp, 1]);
  // 파티 모드에서는 벽·설치기의 뒤쪽 이득을 이어지는 대면이 직접 세므로 이월 항은 partyCarry(끈적끈적네트 근사)만.
  const carry =
    params.partyAware && params.partyEffects && option.party && effect.partyCarry !== undefined ? effect.partyCarry : effect.carry;
  return hitChance * onHit + (1 - hitChance) * onMiss + params.wCarry * carry;
}

/**
 * 울부짖기·날려버리기(AI-A2): 이번 턴 상대에게 한 대 맞고(hitLoss), 상대 예비 중 무작위 하나(균등)가 설치물을 밟고
 * 끌려 나온 대면을 이어간다. 끌려 나온 쪽이 등장 비용으로 쓰러지면 파티 모드에선 그 state에서 이어지는 판세.
 * 원래 상대의 랭크 변화가 사라지는 이득은 파티 모드의 이어지는 대면(원래 상대가 다시 나올 때)에 반영된다.
 */
function phazeValue(option: AiOption, params: DecisionParams): number {
  const { hitLoss, branches } = option.support!.effect!.phaze!;
  if (branches.length === 0) return -Infinity;
  const partyMode = params.partyAware && !!option.party;
  const chain = chainParams(params);
  const total = branches.reduce((sum, b) => {
    const duel = partyMode ? { model: b.model, myIndex: option.party!.myIndex, myStaged: true } : undefined;
    const rest = b.fainted
      ? partyMode
        ? partyValueAfterTurn(b.model, option.party!.model, chain)
        : 0
      : race(params, duel, [b.race.killTurns, b.race.survivalTurns, b.race.firstProbability, b.my, b.opp, 0]);
    return sum + b.entry + rest;
  }, 0);
  return -hitLoss + total / branches.length;
}

/**
 * 추억의선물(AI-A2): 내가 기절하는 대신 상대 공격·특공 −2 — 내 남은 HP 전부를 잃고, 그 state에서 이어지는 판세(내가
 * 다음 포켓몬을 고른다). 후공인데 이번 턴에 쓰러지면 랭크다운 없이 기절만(failModel). 파티 단위 평가 없이는 뒤의
 * 가치를 셀 수 없어 고르지 않는다.
 */
function sacrificeValue(option: AiOption, params: DecisionParams): number {
  if (!params.partyAware || !option.party) return -Infinity;
  const { success, afterModel, failModel } = option.support!.effect!.sacrifice!;
  const chain = chainParams(params);
  const before = option.party.model;
  const onSuccess = partyValueAfterTurn(afterModel, before, chain);
  const onFail = partyValueAfterTurn(failModel, before, chain);
  return -option.hpFraction + success * onSuccess + (1 - success) * onFail;
}

/**
 * 회생의기도·멸망의노래(Tier 2-B): 이번 턴의 HP 비율 변화 + 늘어난 포켓몬 수 × λ + 그 뒤 state에서 이어지는 판세.
 * 파티 단위 평가 없이는 뒤의 가치를 셀 수 없어 고르지 않는다.
 */
function partyShiftValue(option: AiOption, params: DecisionParams): number {
  if (!params.partyAware || !option.party) return -Infinity;
  const { hpDelta, extraCount, afterModel } = option.support!.effect!.partyShift!;
  const chain = chainParams(params);
  return hpDelta + extraCount * params.partyCountWeight + partyValueAfterTurn(afterModel, option.party.model, chain);
}

/**
 * 랭크업 → 다음 턴 배턴터치(decision-layer §4-2): 이번 턴 랭크업하며 한 대 맞고, 다음 턴 배턴터치로 올린 랭크를
 * 교대 후보에게 넘긴다. 넘기는 턴의 처리는 유턴류·배턴터치 pivot_value와 같다(선공이면 후보가 맞고, 후공이면
 * 지금 포켓몬이 한 대 더 맞은 뒤 후보가 안전하게 등장). 넘기기 전에 쓰러지면 선택 불가.
 */
function batonFollowUpValue(option: AiOption, params: DecisionParams): number {
  const support = option.support!;
  const follow = support.batonFollowUp!;
  const selfCost = support.effect?.selfCost ?? 0;
  const hpAtPass = option.hpFraction - selfCost - follow.hitLoss;
  if (hpAtPass <= 0 || follow.candidates.length === 0) return -Infinity;
  const p = follow.firstProbability;
  const nextHit = Math.min(hpAtPass, follow.hitLoss);
  const best = Math.max(
    ...follow.candidates.map(
      (c) =>
        p * switchInValue(c, 1, params, activeHpOverride(option, hpAtPass)) +
        (1 - p) * (switchInValue(c, 0, params, activeHpOverride(option, hpAtPass - nextHit)) - nextHit),
    ),
  );
  return -selfCost - follow.hitLoss + best;
}

/**
 * 방어류(decision-layer §4-4): 성공하면 상대 행동별 엔진 시뮬레이션 결과를 확률로 섞고 — 그 턴의 HP 변화(턴 종료
 * 효과·접촉 페널티·버티기·길동무) + 둘 다 살아 있으면 이어지는 대면(이번 턴은 양쪽 다 행동을 쓴 셈이라 lost=0).
 * 연속 사용으로 실패하면 아무것도 안 하고 맞는 대면(lost=1).
 */
function protectValue(option: AiOption, params: DecisionParams): number {
  const protect = option.support!.protect!;
  if (protect.pointless || protect.outcomes.length === 0) return -Infinity;
  const my = option.hpFraction;
  const opp = option.opponentHpFraction;
  const partyMode = params.partyAware && params.partyEffects && !!option.party;
  const success = protect.outcomes.reduce((sum, o) => {
    // 둘 다 살아 있고 같은 대면: 그 턴 뒤 state의 대면표로 대면을 이어간다. 그 외(쓰러짐·길동무 동반 기절·강제
    // 교체로 대면이 바뀜): 파티 모드면 그 state에서 이어지는 판세(§4-5 ②), 아니면 그 턴의 HP 변화만.
    const turnParty = partyMode && o.partyModel ? { ...option.party!, model: o.partyModel } : option.party;
    const rest = o.race
      ? race(params, turnParty, [o.race.killTurns, o.race.survivalTurns, o.race.firstProbability, o.myAfter, o.oppAfter, 0])
      : partyMode && o.partyModel
        ? partyValueAfterTurn(o.partyModel, option.party!.model, chainParams(params))
        : 0;
    return sum + o.weight * (opp - o.oppAfter - (my - o.myAfter) + rest);
  }, 0);
  const { base } = protect;
  const fail = race(params, option.party, [base.killTurns, base.survivalTurns, base.firstProbability, my, opp, 1]);
  return protect.successChance * success + (1 - protect.successChance) * fail;
}

/** 랭크업기: 올린 뒤 직접 싸우는 값과 올린 뒤 배턴터치로 넘기는 값 중 큰 쪽 */
function setupValue(option: AiOption, params: DecisionParams): number {
  const self = effectValue(option, params);
  return option.support!.batonFollowUp ? Math.max(self, batonFollowUpValue(option, params)) : self;
}

/** AI-A1의 회복·랭크업 쪽 대상: 희망사항(지연 회복)·배북(랭크 설정형) */
function isA1SupportMove(option: AiOption): boolean {
  const move = option.move;
  return (
    !!move?.inflictsVolatile?.some((v) => v.volatile === "wish") ||
    !!move?.statChanges?.some((s) => s.target === "self" && s.setTo !== undefined)
  );
}

/**
 * 흉내쟁이(트랙 M2): 따라 쓸 기술 갈래마다 그 기술을 내가 쓴 점수를 가중 평균한다. 따라 쓸 수 없거나 점수를 못 매기는
 * 갈래는 한 턴을 날린 채 대면을 이어가는 값. 어느 갈래로도 제대로 나가지 않으면 고르지 않는다.
 */
function copycatValue(option: AiOption, riskAversion: number, params: DecisionParams): number {
  const bestKillTurns = option.support?.bestKillTurns ?? option.hitsToKill.expected;
  const wasted = race(params, option.party, [
    bestKillTurns,
    option.hitsToBeKilled.expected,
    option.firstProbability,
    option.hpFraction,
    option.opponentHpFraction,
    1,
  ]);
  let value = 0;
  let succeeded = 0;
  for (const branch of option.copycat!.branches) {
    const score = branch.option ? tradeScore(branch.option, riskAversion, params) : -Infinity;
    if (Number.isFinite(score)) {
      value += branch.weight * score;
      succeeded += branch.weight;
    } else {
      value += branch.weight * wasted;
    }
  }
  return succeeded > 0 ? value : -Infinity;
}

function tradeScore(option: AiOption, riskAversion: number, params: DecisionParams): number {
  const riskPenalty = option.riskFlag ? params.tradeRiskPenaltyBase * riskAversion : 0;
  const p = option.firstProbability;
  const opp = option.opponentHpFraction;
  if (option.support?.extended && !params.statusAware) return -Infinity;
  if (option.copycat) return params.statusAware && params.trackMAware ? copycatValue(option, riskAversion, params) : -Infinity;
  if (option.pivot?.tier2 && !params.tier2Aware) return -Infinity;
  if (params.pivotAware && option.pivot && option.pivot.candidates.length > 0) return pivotValue(option, params) - riskPenalty;
  if (option.support) {
    const { kind, after, bestKillTurns, healedHpFraction } = option.support;
    if (kind === "other") return -Infinity;
    if (kind === "protect") {
      const group = option.support.protect?.group;
      if (!group || !params.protectGroups.includes(group)) return -Infinity;
      return protectValue(option, params) - riskPenalty;
    }
    if (kind === "effect") {
      const effectKind = option.support.effect?.kind;
      if (!params.phase3Aware && effectKind && PHASE3_EFFECT_KINDS.has(effectKind)) return -Infinity;
      if (!params.a1Aware && effectKind && A1_EFFECT_KINDS.has(effectKind)) return -Infinity;
      if (!params.a2Aware && effectKind && A2_EFFECT_KINDS.has(effectKind)) return -Infinity;
      if (!params.trackMAware && effectKind && TRACK_M_EFFECT_KINDS.has(effectKind)) return -Infinity;
      if (!params.tier2Aware && effectKind && TIER2_EFFECT_KINDS.has(effectKind)) return -Infinity;
      // 교체 봉쇄의 가치는 상대 교체 모델링에서만 생긴다
      if (effectKind === "trap" && !(params.oppSwitchAware && params.partyAware)) return -Infinity;
      return effectValue(option, params) - riskPenalty;
    }
    if (!params.a1Aware && isA1SupportMove(option)) return -Infinity;
    if (!params.trackMAware && option.move?.healsByStockpile) return -Infinity;
    if (kind === "setup" && params.statusAware && params.setupAware) {
      if (option.support.setupFailed) return -Infinity;
      if (option.support.effect) return setupValue(option, params) - riskPenalty;
    }
    if (kind === "heal") {
      if (params.statusAware && (option.support.healNetGain ?? 1) <= 0) return -Infinity;
      const healed = healedHpFraction ?? option.hpFraction;
      return race(params, option.party, [bestKillTurns, after, p, healed, opp, 1]) + (healed - option.hpFraction) - riskPenalty;
    }
    return race(params, option.party, [after, option.hitsToBeKilled.expected, p, option.hpFraction, opp, 1]) - riskPenalty;
  }
  // 잠꼬대(AI-A2)는 공격기처럼 평가된다(무작위 기술 기대 피해) — a2Aware가 꺼지면 이전처럼 고르지 않는다.
  if (option.move?.callsRandomLearnedMove && !params.a2Aware) return -Infinity;
  const lost = option.optionType === "switch" ? 1 : 0;
  const entry = option.maxHp > 0 ? option.entryCost / option.maxHp : 0;
  return (
    race(params, option.party, [option.hitsToKill.expected, option.hitsToBeKilled.expected, p, option.hpFraction, opp, lost]) -
    entry -
    riskPenalty
  );
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

/**
 * 동률 처리 4순위: 이번 턴 잡을 수 있는 공격기 → 그 외 기술 → 교체. HP 교환식은 "결국 이기는 대면이면 몇 턴
 * 걸리든" 같은 점수를 줘서, 지금 잡을 수 있는데 철벽을 쓰는 선택이 동률에서 뽑혔다(§7). 공격기 전체를 변화기보다
 * 앞세우면 800판 기준 21승 손해라(동률 변화기는 대부분 실제로 이득), 처치 가능한 공격기로만 좁혔다.
 */
function actionTempoRank(option: AiOption, attackFirst: boolean): number {
  if (option.optionType === "switch") return 2;
  // 방어류는 동률이면 다른 기술보다 뒤 — 턴 종료 효과 등 뚜렷한 이득이 없으면 "둘 다 한 턴 쉼"이라 공격과 점수가
  // 같아지는데, 그럴 때 방어를 고르면 의미 없는 방어가 반복된다(§4-4).
  if (option.support?.kind === "protect") return 1.5;
  const killsNow = option.move?.category !== "status" && option.hitsToKill.expected <= 1;
  return attackFirst && !killsNow ? 1 : 0;
}

function compareBy<T>(key: (item: T) => number): (a: T, b: T) => number {
  return (a, b) => key(a) - key(b);
}

/**
 * 의사결정 레이어(decision-layer §8): 하드 오버라이드 → 점수 최고점 → ±0.1 이내면 동률 처리.
 * 동률 처리: 즉사(worst_case 1타) 위험 배제 → 진입 비용 낮은 쪽 → 방어 상성 낮은 쪽 → 처치 가능 공격기 > 기술 > 교체.
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
        compareBy<ScoredOption>((s) => actionTempoRank(s.option, params.tieAttackFirst))(a, b) ||
        b.score - a.score,
    );
  }
  return { chosen: candidates[0].option, scored };
}
