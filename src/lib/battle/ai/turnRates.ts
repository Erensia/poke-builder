import {
  PARALYSIS_ACTION_FAIL_CHANCE,
  computeStatusEndOfTurnDamage,
  expectedStatusBlockedTurns,
} from "@/lib/statusConditions";
import { computeDamage } from "@/lib/battlePower";
import { ATTRACT_ACTION_BLOCK_CHANCE, CONFUSION_SELF_HIT_CHANCE, hasVolatile } from "@/lib/volatileConditions";
import { CONFUSION_SELF_HIT_MOVE, abilityOf, type BattleFighterState } from "../state";

/** 아쿠아링·뿌리박기: 매 턴 종료 최대 HP 1/16 회복(finishTurn과 같은 규칙) */
const REGEN_DENOMINATOR = 16;
/** 씨뿌리기: 걸린 쪽이 매 턴 종료 최대 HP 1/8을 잃고 상대가 그만큼 회복 */
const LEECH_SEED_DENOMINATOR = 8;

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
export function turnsToKo(attackRate: number, attacker: BattleFighterState, target: BattleFighterState, targetHp?: number): number {
  const hp = targetHp ?? target.currentHp;
  // 혼란(대상): 남은 혼란 턴 동안 행동할 때마다 1/3 확률로 자멸 — 그만큼 HP가 먼저 줄어든 것으로 본다.
  const targetConfusion = confusionTurns(target);
  const selfHit = targetConfusion > 0 ? CONFUSION_SELF_HIT_CHANCE * confusionSelfHitFraction(target) * target.maxHp : 0;
  const base = attackRate * actionFactor(attacker) + residualDamageFraction(target, hp, attacker);
  if (base <= 0) return Infinity;
  let turns = 1 / base;
  if (selfHit > 0) {
    const selfLoss = Math.min(hp, selfHit * Math.min(targetConfusion, turns));
    turns = hp - selfLoss <= 0 ? 1 : (hp - selfLoss) / hp / base;
  }
  // 혼란(공격측): 혼란인 동안 행동의 1/3을 자멸로 날린다 — 남은 혼란 턴 t 안에서 잃는 턴 = min(t/3, 필요 턴/2).
  const attackerConfusion = confusionTurns(attacker);
  if (attackerConfusion > 0) turns += Math.min(attackerConfusion * CONFUSION_SELF_HIT_CHANCE, turns / 2);
  return Math.max(1, blockedTurns(attacker) + turns);
}
