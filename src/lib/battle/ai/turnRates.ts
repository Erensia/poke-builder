import {
  PARALYSIS_ACTION_FAIL_CHANCE,
  computeStatusEndOfTurnDamage,
  expectedStatusBlockedTurns,
} from "@/lib/statusConditions";
import { computeDamage } from "@/lib/battlePower";
import { ATTRACT_ACTION_BLOCK_CHANCE, CONFUSION_SELF_HIT_CHANCE, hasVolatile } from "@/lib/volatileConditions";
import { getHpThresholdBerryHeal } from "@/lib/itemEffects";
import { computeFieldEndOfTurnHeal } from "@/lib/fieldEffects";
import {
  CONFUSION_SELF_HIT_MOVE,
  SANDSTORM_IMMUNE_ABILITY_NAMES,
  abilityOf,
  activeWeather,
  type BattleFighterState,
  type BattleState,
} from "../state";
import { isGrounded } from "../grounding";
import { effectiveHeldItem } from "../turnOrderInputs";

/** 아쿠아링·뿌리박기: 매 턴 종료 최대 HP 1/16 회복(finishTurn과 같은 규칙) */
const REGEN_DENOMINATOR = 16;
/** 씨뿌리기: 걸린 쪽이 매 턴 종료 최대 HP 1/8을 잃고 상대가 그만큼 회복 */
const LEECH_SEED_DENOMINATOR = 8;

/**
 * 턴 종료 효과(ver.1.8, 사용자 합의 2026-09-26): 켜져 있으면 turnsToKo가 도구·필드·날씨·속박·소금절이의 매 턴 HP 변화와
 * 자뭉열매·오랭열매의 한 번 회복을 센다. 평가 함수가 여러 겹이라 withThreatModel처럼 감싸서 바꾼다(비교용 토글).
 */
let endOfTurnAware = true;

export function withEndOfTurnModel<T>(enabled: boolean, fn: () => T): T {
  const previous = endOfTurnAware;
  endOfTurnAware = enabled;
  try {
    return fn();
  } finally {
    endOfTurnAware = previous;
  }
}

/** 매 턴 종료 HP 변화(HP 절대량, 양수 = 피해·음수 = 회복). timed는 남은 턴이 있는 효과(날씨·필드·속박) */
interface EnvironmentResidual {
  permanent: number;
  timed: { amount: number; turns: number }[];
}

/**
 * finishTurn과 같은 규칙: 먹다남은음식(회복), 그래스필드(땅에 있으면 회복), 모래바람(바위·땅·강철·면제 특성·매직가드 제외
 * 1/16), 날씨 특성(젖은접시·아이스바디·건조피부), 속박(1/8, 조임밴드 1/6), 소금절이(1/16, 강철·물 1/8).
 */
function environmentResidual(state: BattleState, fighter: BattleFighterState, opponent: BattleFighterState | undefined): EnvironmentResidual {
  const result: EnvironmentResidual = { permanent: 0, timed: [] };
  const { maxHp } = fighter;
  const ability = abilityOf(fighter);
  const magicGuard = !!ability?.negatesIndirectDamage;
  const item = effectiveHeldItem(fighter, state);
  if (item?.endOfTurnHealDenominator) result.permanent -= Math.floor(maxHp / item.endOfTurnHealDenominator);
  if (hasVolatile(fighter.volatile, "saltCure") && !magicGuard) {
    const heavy = fighter.types.some((t) => t === "강철" || t === "물");
    result.permanent += Math.floor(maxHp / (heavy ? 8 : 16));
  }
  const fieldHeal = state.field && isGrounded(state, fighter, ability) ? computeFieldEndOfTurnHeal(state.field, maxHp) : 0;
  if (fieldHeal > 0) result.timed.push({ amount: -fieldHeal, turns: state.fieldTurnsRemaining ?? Infinity });
  const weather = activeWeather(state);
  if (weather) {
    const turns = state.weatherTurnsRemaining ?? Infinity;
    let amount = 0;
    if (
      weather === "모래바람" &&
      !fighter.types.some((t) => t === "바위" || t === "땅" || t === "강철") &&
      !magicGuard &&
      !SANDSTORM_IMMUNE_ABILITY_NAMES.has(ability?.name ?? "")
    ) {
      amount += Math.floor(maxHp / 16);
    }
    const heal = ability?.weatherEndOfTurnHealDenominator;
    if (heal?.weather === weather) amount -= Math.floor(maxHp / heal.denominator);
    const damage = ability?.weatherEndOfTurnDamageDenominator;
    if (damage?.weather === weather && !magicGuard) amount += Math.floor(maxHp / damage.denominator);
    if (amount !== 0) result.timed.push({ amount, turns });
  }
  if (hasVolatile(fighter.volatile, "bound") && !magicGuard) {
    const binderItem = opponent ? effectiveHeldItem(opponent, state) : undefined;
    const amount = Math.floor(maxHp / (binderItem?.bindDamageDenominator ?? 8));
    result.timed.push({ amount, turns: fighter.volatile.active.bound!.turnsRemaining ?? Infinity });
  }
  return result;
}

/** 자뭉열매·오랭열매: HP 절반 이하에서 한 번 회복(숙성 2배) — 버티는 HP에 더한다. 긴장감(상대)이면 못 먹는다 */
function thresholdBerryHp(state: BattleState, fighter: BattleFighterState, opponent: BattleFighterState | undefined): number {
  if (fighter.itemConsumed || (opponent && abilityOf(opponent)?.preventsOpponentBerries)) return 0;
  const item = effectiveHeldItem(fighter, state);
  if (!item?.healsBelowHalfHpDenominator && !item?.healsBelowHalfHpFlat) return 0;
  return getHpThresholdBerryHeal(item, 1, fighter.maxHp, false, !!abilityOf(fighter)?.doublesBerryEffect);
}

/**
 * 상태이상 지속 데미지가 매 턴 현재 HP의 몇 비율을 깎는지(engine-extension §1-2, finishTurn과 같은 규칙).
 * 포이즌힐이면 음수(회복), 매직가드면 0, 내열이면 화상 데미지 절반.
 */
export function residualDamageFraction(fighter: BattleFighterState, hp = fighter.currentHp, opponent?: BattleFighterState): number {
  if (hp <= 0) return 0;
  return statusResidualFraction(fighter, hp) + volatileResidualFraction(fighter, hp, opponent);
}

/**
 * 행동방해류 지속 피해/회복(현재 HP 대비, 음수 = 회복) — finishTurn 규칙:
 *  - 씨뿌리기가 걸려 있으면 최대 HP 1/8 손실(매직가드 제외).
 *  - 아쿠아링·뿌리박기면 최대 HP 1/16 회복.
 *  - opponent(맞은편)가 씨뿌리기에 걸려 있으면 그만큼(맞은편 최대 HP 1/8) 회복 — 해감액이면 반대로 피해.
 */
function volatileResidualFraction(fighter: BattleFighterState, hp: number, opponent: BattleFighterState | undefined): number {
  const ability = abilityOf(fighter);
  let damage = 0;
  if (hasVolatile(fighter.volatile, "leechSeed") && !ability?.negatesIndirectDamage) {
    damage += Math.floor(fighter.maxHp / LEECH_SEED_DENOMINATOR);
  }
  if (hasVolatile(fighter.volatile, "aquaRing") || hasVolatile(fighter.volatile, "ingrain")) {
    damage -= Math.floor(fighter.maxHp / REGEN_DENOMINATOR);
  }
  if (opponent && hasVolatile(opponent.volatile, "leechSeed")) {
    const opponentAbility = abilityOf(opponent);
    if (!opponentAbility?.negatesIndirectDamage) {
      const drained = Math.floor(opponent.maxHp / LEECH_SEED_DENOMINATOR);
      damage += opponentAbility?.reverseDrainHealsToDamage ? drained : -drained;
    }
  }
  return damage / hp;
}

function statusResidualFraction(fighter: BattleFighterState, hp: number): number {
  const condition = fighter.status.condition;
  if (!condition) return 0;
  const ability = abilityOf(fighter);
  const poisoned = condition === "poison" || condition === "badly-poisoned";
  if (poisoned && ability?.healsFromPoisonEachTurnDenominator) {
    return -Math.floor(fighter.maxHp / ability.healsFromPoisonEachTurnDenominator) / hp;
  }
  if (ability?.negatesIndirectDamage) return 0;
  const raw = computeStatusEndOfTurnDamage(fighter.status, fighter.maxHp);
  const damage = condition === "burn" && ability?.halvesBurnDamage ? Math.floor(raw / 2) : raw;
  return damage / hp;
}

/**
 * 매 턴 행동할 확률(잠듦·얼음은 blockedTurns로, 혼란은 남은 턴이 있어 turnsToKo에서 따로 셈):
 * 마비(행동불능 25%) × 헤롱헤롱(50%, 교체 전까지 유지).
 */
export function actionFactor(fighter: BattleFighterState): number {
  const paralysis = fighter.status.condition === "paralysis" ? 1 - PARALYSIS_ACTION_FAIL_CHANCE : 1;
  const attract = hasVolatile(fighter.volatile, "attract") ? 1 - ATTRACT_ACTION_BLOCK_CHANCE : 1;
  return paralysis * attract;
}

/** 혼란 남은 턴(없으면 0) */
function confusionTurns(fighter: BattleFighterState): number {
  return hasVolatile(fighter.volatile, "confusion") ? fighter.volatile.active.confusion!.turnsRemaining : 0;
}

/**
 * 혼란 자멸 1회 데미지(최대 HP 대비) — preHitEffects와 같은 식(자기 실능끼리 위력 40 물리, 난수 중간값).
 */
export function confusionSelfHitFraction(fighter: BattleFighterState): number {
  if (fighter.maxHp <= 0) return 0;
  const hit = computeDamage(fighter.realStats, fighter.realStats, fighter.types, CONFUSION_SELF_HIT_MOVE, { randomRoll: 0.925 });
  return (hit?.damage ?? 0) / fighter.maxHp;
}

/** 잠듦·얼음으로 앞으로 막힐 기대 턴 수 */
export function blockedTurns(fighter: BattleFighterState): number {
  return expectedStatusBlockedTurns(fighter.status, fighter.effectiveAbilityId === "일찍기상");
}

/**
 * "공격측이 매 턴 target 현재 HP의 attackRate 비율을 깎는다" + target 자신의 지속 데미지 → 기대 처치 턴 수.
 * 잠듦/얼음으로 막히는 턴은 앞에 더한다(그 동안의 지속 데미지는 무시하는 근사).
 */
export function turnsToKo(
  attackRate: number,
  attacker: BattleFighterState,
  target: BattleFighterState,
  targetHp?: number,
  /** 턴당 기대 데미지의 절대량(대상 최대 HP 대비) — 대타를 깨는 턴 계산용. 없으면 attackRate로 근사 */
  absoluteRate?: number,
  /** 턴 종료 효과(도구·필드·날씨·속박·소금절이·HP 열매)를 셀 state — 없으면 세지 않는다 */
  state?: BattleState,
): number {
  const hp = targetHp ?? target.currentHp;
  // 혼란(대상): 남은 혼란 턴 동안 행동할 때마다 1/3 확률로 자멸 — 그만큼 HP가 먼저 줄어든 것으로 본다.
  const targetConfusion = confusionTurns(target);
  const selfHit = targetConfusion > 0 ? CONFUSION_SELF_HIT_CHANCE * confusionSelfHitFraction(target) * target.maxHp : 0;
  let base = attackRate * actionFactor(attacker) + residualDamageFraction(target, hp, attacker);
  let berryHp = 0;
  if (endOfTurnAware && state && hp > 0) {
    // 남은 턴이 있는 효과는 대면이 그보다 길면 그 비율만큼만 섞는다(전부 넣은 속도로 대면 길이를 어림)
    const env = environmentResidual(state, target, attacker);
    const all = base + (env.permanent + env.timed.reduce((sum, t) => sum + t.amount, 0)) / hp;
    const estimate = all > 0 ? 1 / all : Infinity;
    // HP가 가득 찬 채 시작하면 첫 턴의 회복은 버려진다(최대 HP 상한, ver.1.8 한계점 정리) — 회복분을 (1 − 1/대면 길이)만큼만
    const healScale = hp >= target.maxHp && Number.isFinite(estimate) ? Math.max(0, 1 - 1 / estimate) : 1;
    const scaled = (amount: number) => (amount < 0 ? amount * healScale : amount);
    base += scaled(env.permanent) / hp;
    for (const t of env.timed) {
      const share = Number.isFinite(estimate) ? Math.min(1, t.turns / estimate) : t.turns === Infinity ? 1 : 0;
      base += (scaled(t.amount) / hp) * share;
    }
    berryHp = thresholdBerryHp(state, target, attacker);
  }
  if (base <= 0) return Infinity;
  // 자뭉열매·오랭열매: 버티는 HP가 그만큼 늘어난다
  // (HP 0이면 berryHp도 0 — 0/0 NaN을 피한다)
  let turns = (1 + (hp > 0 ? berryHp / hp : 0)) / base;
  if (selfHit > 0) {
    const selfLoss = Math.min(hp, selfHit * Math.min(targetConfusion, turns));
    turns = hp - selfLoss <= 0 ? 1 : (hp - selfLoss + berryHp) / hp / base;
  }
  // 대타(대상): 대타 HP를 깨는 동안의 공격은 본체에 안 들어간다(넘친 데미지도 사라짐) — 그 턴 수만큼 더 걸린다.
  // 틈새포착(대타 무시)이면 없음. 소리 기술의 대타 무시는 기술별이라 여기선 보지 않는다.
  const substitute = target.substituteHp ?? 0;
  // attackRate는 "현재 HP 대비"라 HP가 낮으면 한 방 데미지가 현재 HP로 잘린다 — 대타는 절대량(absoluteRate)으로 본다.
  const perTurn = absoluteRate !== undefined ? absoluteRate * target.maxHp : attackRate * hp;
  if (substitute > 0 && perTurn > 0 && !abilityOf(attacker)?.bypassesScreensAndSubstitute) {
    turns += Math.max(1, substitute / perTurn) / Math.max(actionFactor(attacker), 1e-9);
  }
  // 혼란(공격측): 혼란인 동안 행동의 1/3을 자멸로 날린다 — 남은 혼란 턴 t 안에서 잃는 턴 = min(t/3, 필요 턴/2).
  const attackerConfusion = confusionTurns(attacker);
  if (attackerConfusion > 0) turns += Math.min(attackerConfusion * CONFUSION_SELF_HIT_CHANCE, turns / 2);
  return Math.max(1, blockedTurns(attacker) + turns);
}
