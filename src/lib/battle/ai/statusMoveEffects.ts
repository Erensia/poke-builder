import { type FighterKey } from "@/types/battle";
import { type Move } from "@/types/move";
import { type StatusCondition } from "@/types/status";
import { applyMoveStatChanges } from "@/lib/statStages";
import { resolveEffectiveDefenderAbility } from "@/lib/abilityModifiers";
import { isOpponentTargetingMove, isStatusBlockedByField } from "@/lib/fieldEffects";
import { inflictStatus, isImmuneToStatus } from "@/lib/statusConditions";
import {
  SCREEN_DURATION,
  abilityOf,
  activeWeather,
  contraryMoveFor,
  isFainted,
  opponentKey,
  sideOf,
  statDropBlockStatsOf,
  statusImmunitiesOf,
  type BattleFighterState,
  type BattleState,
} from "../state";
import { calcEntryHazardDamage, isGroundedForHazards } from "../entryCost";
import { effectiveHeldItem } from "../turnOrderInputs";

/**
 * decision-layer §4-1 "적용 후 재평가"로 점수를 매기는 변화기 종류.
 *  - status: 상태이상 부여(inflictsStatus) / debuff: 상대 랭크다운(statChanges → opponent)
 *  - screen: 벽(setsScreen) / hazard: 설치기(setsHazard)
 */
export type EffectMoveKind = "status" | "debuff" | "screen" | "hazard";

/** 독압정으로 걸린 독이 상대 대기 포켓몬에게 몇 턴 동안 데미지를 준다고 볼지(이월 항 근사) */
export const HAZARD_POISON_TURNS = 3;
/** 끈적끈적네트: 접지한 상대 대기 포켓몬 1마리당 이월 가치(스피드 −1의 고정 근사, HP 비율 단위) */
export const STICKY_WEB_VALUE_PER_TARGET = 0.1;

export function effectKindOf(move: Move): EffectMoveKind | undefined {
  if (move.category !== "status") return undefined;
  if (move.setsScreen) return "screen";
  if (move.setsHazard) return "hazard";
  if (move.inflictsStatus?.length) return "status";
  const debuff =
    move.statChanges?.some((s) => s.target === "opponent") &&
    !move.statChanges.some((s) => s.target === "self" && (s.delta ?? 0) > 0) &&
    !(move.tags ?? []).includes("자기희생");
  return debuff ? "debuff" : undefined;
}

/** 배턴터치(꼬리자르기는 대타·HP 비용이 있어 제외) */
export function isBatonPass(move: Move): boolean {
  return move.category === "status" && !!move.passesStatsOnSelfSwitch && !move.shedTail;
}

/** AI가 점수를 매길 수 있는 변화기(회복·랭크업 제외) — 시뮬레이션 파티 생성(STATUS=1)용 */
export function isDesignedStatusMove(move: Move): boolean {
  return !!effectKindOf(move) || isBatonPass(move) || !!move.healsWeatherDependent || !!move.restSleep;
}

/** inflictsStatus 중 이번에 실제로 걸릴 상태이상(엔진 mirroredEffects와 같은 판정 순서). 없으면 undefined */
function statusToInflict(state: BattleState, key: FighterKey, move: Move): StatusCondition | undefined {
  const oppKey = opponentKey(key);
  const target = state[oppKey];
  if (target.status.condition) return undefined;
  if (sideOf(state, oppKey).safeguardTurnsRemaining !== undefined) return undefined;
  const userAbility = abilityOf(state[key]);
  const targetAbility = resolveEffectiveDefenderAbility(userAbility, abilityOf(target));
  for (const effect of move.inflictsStatus ?? []) {
    if (isImmuneToStatus(effect.status, target.types, statusImmunitiesOf(target, targetAbility), userAbility?.bypassesPoisonTypeImmunity)) continue;
    if (isStatusBlockedByField(state.field, effect.status)) continue;
    if (effect.status === "freeze" && activeWeather(state) === "쾌청") continue;
    return effect.status;
  }
  return undefined;
}

/**
 * 이 변화기가 지금 실패하거나 아무 효과도 없는지 — 실전 엔진(preHitEffects·mirroredEffects·resolveAction)의
 * 실패 조건을 그대로 옮겼다. 같은 변화기를 매 턴 반복해서 고르지 않게 하는 핵심 장치.
 */
export function effectMoveFails(state: BattleState, key: FighterKey, move: Move): boolean {
  const me = state[key];
  const oppKey = opponentKey(key);
  const target = state[oppKey];
  if (move.requiresWeather && activeWeather(state) !== move.requiresWeather) return true;
  if (move.setsScreen) return sideOf(state, key).screens[move.setsScreen] !== undefined;

  const userAbility = abilityOf(me);
  const targetAbility = resolveEffectiveDefenderAbility(userAbility, abilityOf(target));
  const targetsOpponent = isOpponentTargetingMove(move);
  if (targetAbility?.reflectsOpponentStatusMoves && !move.notReflectable && (targetsOpponent || !!move.setsHazard)) return true;

  if (move.setsHazard) {
    const hz = sideOf(state, oppKey).hazards;
    switch (move.setsHazard) {
      case "stealthRock":
        return hz.stealthRock;
      case "stickyWeb":
        return hz.stickyWeb;
      case "spikes":
        return hz.spikesLayers >= 3;
      case "toxicSpikes":
        return hz.toxicSpikesLayers >= 2;
    }
  }

  if (!targetsOpponent) return false;
  const classification = move.classification ?? [];
  if (targetAbility?.blocksOpponentStatusMoveEffects) return true;
  if (target.substituteHp !== undefined && !classification.includes("소리") && !userAbility?.bypassesScreensAndSubstitute) return true;
  if (classification.includes("가루") && target.types.includes("풀")) return true;
  if (targetAbility?.blocksSound && classification.includes("소리")) return true;
  if (move.inflictsStatus?.length && !statusToInflict(state, key, move)) return true;
  return false;
}

export interface ApplyEffectOptions {
  /** 맹독: 대면이 이어지는 동안의 평균 카운터로 쓸 턴 수 — 매 턴 1/16 고정으로 보면 과소평가된다 */
  toxicTurns: number;
}

/**
 * 복제한 state에 변화기의 지속 효과만 직접 적용한다(엔진을 돌리지 않음). 달라진 게 없으면 false.
 * 설치기는 현재 대면에 영향이 없으므로 아무것도 바꾸지 않고 true(이득은 hazardCarry로 따로 센다).
 */
export function applyEffectMove(clone: BattleState, key: FighterKey, move: Move, options: ApplyEffectOptions): boolean {
  const kind = effectKindOf(move);
  const me = clone[key];
  const target = clone[opponentKey(key)];
  switch (kind) {
    case "hazard":
      return true;
    case "screen": {
      const side = sideOf(clone, key);
      side.screens = { ...side.screens, [move.setsScreen!]: screenDuration(me) };
      return true;
    }
    case "status": {
      const status = statusToInflict(clone, key, move);
      if (!status) return false;
      const inflicted = inflictStatus(target.status, status);
      const averageCounter = Math.max(1, Math.round((1 + options.toxicTurns) / 2));
      target.status = status === "badly-poisoned" ? { ...inflicted, turnsElapsed: averageCounter } : inflicted;
      return true;
    }
    case "debuff": {
      const before = target.stages;
      const targetAbility = resolveEffectiveDefenderAbility(abilityOf(me), abilityOf(target));
      let after = applyMoveStatChanges(before, contraryMoveFor(move, target), "opponent", {
        userTypes: me.types,
        weather: activeWeather(clone),
      });
      // 클리어바디류는 내려간 스탯을 되돌리고, 미러아머는 되돌린 뒤 시전자에게 반사한다 — 반사는 이득이 없으니 되돌리기만.
      const blocked = targetAbility?.reflectsOpponentStatDrops ? Object.keys(before) : (statDropBlockStatsOf(target, targetAbility) ?? []);
      for (const stat of blocked as (keyof typeof before)[]) {
        if (after[stat] < before[stat]) after = { ...after, [stat]: before[stat] };
      }
      target.stages = after;
      return (Object.keys(before) as (keyof typeof before)[]).some((s) => after[s] !== before[s]);
    }
    default:
      return false;
  }
}

/** 벽 지속 턴(빛의점토 보너스 포함) */
export function screenDuration(user: BattleFighterState): number {
  return SCREEN_DURATION + (effectiveHeldItem(user)?.screenDurationBonus ?? 0);
}

/**
 * 효과가 covered번의 턴 동안만 유지될 때의 처치 턴 수. 그 안에 끝나면 효과 적용값 그대로, 아니면
 * covered 턴 동안 효과 적용 속도로 깎고 나머지는 원래 속도로 깎는다.
 */
export function blendTurns(withEffect: number, without: number, covered: number): number {
  if (withEffect <= covered) return withEffect;
  if (withEffect === Infinity) return covered + without;
  return covered + (1 - covered / withEffect) * without;
}

/**
 * 설치기 이월 항: 상대 대기 포켓몬이 한 번씩 등장할 때 받는 손해 합(각자 최대 HP 대비 비율).
 * 스텔스록·압정뿌리기는 등장 데미지 증가분, 독압정은 독 지속 데미지 HAZARD_POISON_TURNS 턴분,
 * 끈적끈적네트는 접지 대상 1마리당 고정값.
 */
export function hazardCarry(state: BattleState, key: FighterKey, move: Move): number {
  const oppSide = sideOf(state, opponentKey(key));
  const before = oppSide.hazards;
  const after = { ...before };
  switch (move.setsHazard) {
    case "stealthRock":
      after.stealthRock = true;
      break;
    case "spikes":
      after.spikesLayers = Math.min(3, before.spikesLayers + 1);
      break;
    case "toxicSpikes":
      after.toxicSpikesLayers = Math.min(2, before.toxicSpikesLayers + 1);
      break;
    case "stickyWeb":
      after.stickyWeb = true;
      break;
    default:
      return 0;
  }
  let total = 0;
  oppSide.party.forEach((f, i) => {
    if (i === oppSide.activeIndex || isFainted(f)) return;
    const ability = abilityOf(f);
    const grounded = isGroundedForHazards(f.types, ability);
    const extra =
      calcEntryHazardDamage(f.maxHp, f.types, ability, after) - calcEntryHazardDamage(f.maxHp, f.types, ability, before);
    total += Math.min(f.currentHp, extra) / f.maxHp;
    if (move.setsHazard === "toxicSpikes" && grounded && !f.status.condition && !ability?.negatesIndirectDamage) {
      const status = after.toxicSpikesLayers >= 2 ? "badly-poisoned" : "poison";
      if (!f.types.includes("독") && !isImmuneToStatus(status, f.types, statusImmunitiesOf(f, ability))) {
        const n = HAZARD_POISON_TURNS;
        const poisonValue = (layers: number) => (layers >= 2 ? (n * (n + 1)) / 2 / 16 : layers === 1 ? n / 8 : 0);
        total += Math.max(0, poisonValue(after.toxicSpikesLayers) - poisonValue(before.toxicSpikesLayers));
      }
    }
    if (move.setsHazard === "stickyWeb" && grounded) total += STICKY_WEB_VALUE_PER_TARGET;
  });
  return total;
}
