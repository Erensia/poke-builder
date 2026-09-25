import { type FighterKey } from "@/types/battle";
import { type Move } from "@/types/move";
import { type StatusCondition } from "@/types/status";
import { applyMoveStatChanges } from "@/lib/statStages";
import { resolveEffectiveDefenderAbility } from "@/lib/abilityModifiers";
import { isConfusionBlockedByField, isOpponentTargetingMove, isStatusBlockedByField } from "@/lib/fieldEffects";
import { inflictStatus, isImmuneToStatus } from "@/lib/statusConditions";
import { FIELD_DURATION } from "@/lib/fieldEffects";
import { hasVolatile, inflictVolatile } from "@/lib/volatileConditions";
import { getConfusionCureBerryResult, getMentalHerbCureResult } from "@/lib/itemEffects";
import { NEUTRAL_ACCURACY_STAGES, NEUTRAL_STAGES } from "@/types/battleStats";
import {
  SCREEN_DURATION,
  TRICK_ROOM_DURATION,
  WEATHER_DURATION,
  abilityOf,
  activeWeather,
  contraryMoveFor,
  isFainted,
  opponentKey,
  sideOf,
  statDropBlockStatsOf,
  statusImmunitiesOf,
  type BattleFighterState,
  type BattleSide,
  type BattleState,
} from "../state";
import { calcEntryHazardDamage, isGroundedForHazards } from "../entryCost";
import { effectiveHeldItem } from "../turnOrderInputs";

/**
 * decision-layer §4-1 "적용 후 재평가"로 점수를 매기는 변화기 종류.
 *  - status: 상태이상 부여(inflictsStatus) / debuff: 상대 랭크다운(statChanges → opponent)
 *  - screen: 벽(setsScreen) / hazard: 설치기(setsHazard)
 */
export type EffectMoveKind =
  | "status"
  | "debuff"
  | "screen"
  | "hazard"
  // §4-3(3단계): 날씨·필드·트릭룸(양쪽 모두에 영향), 도발·앙코르·사슬묶기(상대 기술 제한)
  | "weather"
  | "field"
  | "trickRoom"
  | "taunt"
  | "encore"
  | "disable"
  // AI-A1(ver.1.8): 흑안개·신비의부적·아쿠아링/뿌리박기·씨뿌리기·혼란·헤롱헤롱·하품
  | "haze"
  | "safeguard"
  | "regen"
  | "leechSeed"
  | "confuse"
  | "attract"
  | "yawn";

/** AI-A1(ver.1.8) 효과 — decision의 a1Aware로 따로 끌 수 있다(비교용) */
export const A1_EFFECT_KINDS: ReadonlySet<EffectMoveKind> = new Set(["haze", "safeguard", "regen", "leechSeed", "confuse", "attract", "yawn"]);

/** 3단계(§4-3) 효과 — decision의 phase3Aware로 따로 끌 수 있다 */
export const PHASE3_EFFECT_KINDS: ReadonlySet<EffectMoveKind> = new Set(["weather", "field", "trickRoom", "taunt", "encore", "disable"]);

/** 신비의부적 지속 턴(finishTurn이 5에서 센다) */
export const SAFEGUARD_DURATION = 5;
/** 혼란 지속 턴 기대값(1~4턴 균등 — rollConfusionDuration) */
export const EXPECTED_CONFUSION_TURNS = 2.5;

/** 독압정으로 걸린 독이 상대 대기 포켓몬에게 몇 턴 동안 데미지를 준다고 볼지(이월 항 근사) */
export const HAZARD_POISON_TURNS = 3;
/** 끈적끈적네트: 접지한 상대 대기 포켓몬 1마리당 이월 가치(스피드 −1의 고정 근사, HP 비율 단위) */
export const STICKY_WEB_VALUE_PER_TARGET = 0.1;

export function effectKindOf(move: Move): EffectMoveKind | undefined {
  if (move.category !== "status") return undefined;
  if (move.setsScreen) return "screen";
  if (move.setsHazard) return "hazard";
  if (move.inflictsStatus?.length) return "status";
  // 썰렁개그(날씨 + 사용 후 교체)는 교체 평가가 따로 필요해 아직 대상 아님
  if (move.setsWeather && !move.selfSwitchAfterUse) return "weather";
  if (move.setsField) return "field";
  if (move.setsTrickRoom) return "trickRoom";
  if (move.setsEncore) return "encore";
  if (move.setsDisable) return "disable";
  if (move.inflictsVolatile?.some((v) => v.volatile === "taunt" && v.target !== "self")) return "taunt";
  if (move.resetsAllStages) return "haze";
  if (move.setsSafeguard) return "safeguard";
  if (move.setsRegenVolatile) return "regen";
  if (move.setsLeechSeed) return "leechSeed";
  const opponentVolatile = (volatile: string) => move.inflictsVolatile?.some((v) => v.volatile === volatile && v.target === "opponent");
  if (opponentVolatile("confusion")) return "confuse";
  if (opponentVolatile("attract")) return "attract";
  if (opponentVolatile("drowsy")) return "yawn";
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
  // 같은 날씨·같은 필드·이미 걸린 트릭룸 → 실패(resolveAction·mirroredEffects와 같은 규칙)
  if (move.setsWeather) return state.weather === move.setsWeather;
  if (move.setsField) return state.field === move.setsField;
  if (move.setsTrickRoom) return state.trickRoomTurnsRemaining !== undefined;

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

  const kind = effectKindOf(move);
  if (kind === "haze") {
    const neutral = (f: BattleFighterState) =>
      Object.values(f.stages).every((v) => v === 0) && Object.values(f.accuracyStages).every((v) => v === 0);
    return neutral(me) && neutral(target);
  }
  if (kind === "safeguard") return sideOf(state, key).safeguardTurnsRemaining !== undefined;
  if (kind === "regen") return hasVolatile(me.volatile, move.setsRegenVolatile!);

  if (!targetsOpponent) return false;
  const classification = move.classification ?? [];
  if (targetAbility?.blocksOpponentStatusMoveEffects) return true;
  if (target.substituteHp !== undefined && !classification.includes("소리") && !userAbility?.bypassesScreensAndSubstitute) return true;
  if (classification.includes("가루") && target.types.includes("풀")) return true;
  if (targetAbility?.blocksSound && classification.includes("소리")) return true;
  if (move.inflictsStatus?.length && !statusToInflict(state, key, move)) return true;
  if (kind === "leechSeed" || kind === "confuse" || kind === "attract" || kind === "yawn") {
    return volatileEffectFails(state, key, kind);
  }
  // 도발·앙코르·사슬묶기: 아로마베일(마음을 옭아매는 기술 차단)·이미 걸림·상대가 아직 기술을 안 씀(앙코르·사슬묶기)
  if (kind === "taunt" || kind === "encore" || kind === "disable") {
    if (targetAbility?.blocksMentalMoves) return true;
    const volatile = target.volatile.active;
    if (kind === "taunt") return volatile.taunt !== undefined;
    if (!target.lastMoveId) return true;
    return kind === "encore" ? volatile.encore !== undefined : volatile.disable !== undefined;
  }
  return false;
}

/**
 * 씨뿌리기·혼란·헤롱헤롱·하품이 지금 실패하거나 효과가 없는지 — 엔진 mirroredEffects·finishTurn과 같은 조건.
 * (대타·매직미러·황금몸·방음 등 공통 차단은 effectMoveFails가 먼저 본다.)
 */
function volatileEffectFails(state: BattleState, key: FighterKey, kind: "leechSeed" | "confuse" | "attract" | "yawn"): boolean {
  const user = state[key];
  const oppKey = opponentKey(key);
  const target = state[oppKey];
  const targetAbility = resolveEffectiveDefenderAbility(abilityOf(user), abilityOf(target));
  switch (kind) {
    case "leechSeed":
      return target.types.includes("풀") || hasVolatile(target.volatile, "leechSeed") || !!abilityOf(target)?.negatesIndirectDamage;
    case "confuse":
      return hasVolatile(target.volatile, "confusion") || isConfusionBlockedByField(state.field) || confusionCuredOnInflict(target);
    case "attract":
      return (
        hasVolatile(target.volatile, "attract") ||
        target.gender === null ||
        user.gender === null ||
        target.gender === user.gender ||
        !!targetAbility?.blocksMentalMoves ||
        getMentalHerbCureResult(effectiveHeldItem(target), target.itemConsumed ?? false)
      );
    case "yawn":
      // 이미 상태이상·졸음이면 실패, 잠듦 면역(타입·특성·필드)·신비의부적이면 2턴 뒤에 무산된다(finishTurn).
      return (
        !!target.status.condition ||
        hasVolatile(target.volatile, "drowsy") ||
        isImmuneToStatus("sleep", target.types, statusImmunitiesOf(target, targetAbility)) ||
        isStatusBlockedByField(state.field, "sleep") ||
        sideOf(state, oppKey).safeguardTurnsRemaining !== undefined
      );
  }
}

/** 시몬열매: 혼란에 걸리는 순간 치료·소모(엔진 mirroredEffects) — AI에겐 실패와 같다 */
function confusionCuredOnInflict(target: BattleFighterState): boolean {
  return getConfusionCureBerryResult(effectiveHeldItem(target), target.itemConsumed ?? false);
}

/**
 * 이 효과가 유지되는 턴 수(적용 후 재평가에서 효과 구간을 자를 때 쓴다). 영구·대상에 붙는 효과(상태이상·
 * 랭크다운)와 현재 대면과 무관한 설치기는 undefined.
 */
export function effectDuration(state: BattleState, key: FighterKey, move: Move): number | undefined {
  const user = state[key];
  const item = effectiveHeldItem(user);
  switch (effectKindOf(move)) {
    case "screen":
      return screenDuration(user);
    case "weather":
      return WEATHER_DURATION + (item?.weatherDurationBonus?.weather === move.setsWeather ? item!.weatherDurationBonus!.bonus : 0);
    case "field":
      return FIELD_DURATION + (item?.fieldDurationBonus ?? 0);
    case "trickRoom":
      return TRICK_ROOM_DURATION;
    case "taunt":
    case "encore":
    case "disable":
      return volatileDuration(effectKindOf(move) as "taunt" | "encore" | "disable");
    case "safeguard":
      return SAFEGUARD_DURATION;
    default:
      return undefined;
  }
}

function volatileDuration(volatile: "taunt" | "encore" | "disable"): number {
  return inflictVolatile({ active: {} }, volatile, () => 0).active[volatile]!.turnsRemaining;
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
    case "weather":
      clone.weather = move.setsWeather;
      clone.weatherTurnsRemaining = effectDuration(clone, key, move);
      return true;
    case "field":
      clone.field = move.setsField;
      clone.fieldTurnsRemaining = effectDuration(clone, key, move);
      return true;
    case "trickRoom":
      clone.trickRoomTurnsRemaining = TRICK_ROOM_DURATION;
      return true;
    case "taunt":
      target.volatile = inflictVolatile(target.volatile, "taunt", () => 0);
      return true;
    case "haze":
      for (const f of [me, target]) {
        f.stages = { ...NEUTRAL_STAGES };
        f.accuracyStages = { ...NEUTRAL_ACCURACY_STAGES };
      }
      return true;
    case "safeguard":
      sideOf(clone, key).safeguardTurnsRemaining = SAFEGUARD_DURATION;
      return true;
    case "regen":
      me.volatile = inflictVolatile(me.volatile, move.setsRegenVolatile!, () => 0);
      return true;
    case "leechSeed":
      target.volatile = inflictVolatile(target.volatile, "leechSeed", () => 0);
      return true;
    case "confuse": {
      // 혼란 턴은 기대값(2.5)으로 — turnsToKo가 남은 턴만큼만 행동 손실·자멸을 센다.
      const confuse = (f: BattleFighterState) => {
        f.volatile = { active: { ...f.volatile.active, confusion: { turnsRemaining: EXPECTED_CONFUSION_TURNS } } };
      };
      confuse(target);
      // 흔들흔들댄스: 자신도 혼란(이미 혼란이면 그대로)
      if (move.inflictsVolatile?.some((v) => v.volatile === "confusion" && v.target === "self") && !hasVolatile(me.volatile, "confusion")) {
        confuse(me);
      }
      return true;
    }
    case "attract":
      target.volatile = inflictVolatile(target.volatile, "attract", () => 0);
      return true;
    case "yawn":
      // 다음 턴 종료에 잠든다 — 잠듦을 바로 걸고, 평가 쪽(evaluateEffectMove)에서 "그 전에 끝나는 대면"을 보정한다.
      target.status = inflictStatus(target.status, "sleep");
      return true;
    case "encore":
    case "disable":
      target.volatile = inflictVolatile(target.volatile, kind, () => 0, target.lastMoveId);
      return true;
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

/** 설치기를 한 번 더 깐 뒤의 상대 편 설치물 상태. 설치기가 아니면 undefined */
export function hazardsAfter(before: BattleSide["hazards"], move: Move): BattleSide["hazards"] | undefined {
  switch (move.setsHazard) {
    case "stealthRock":
      return { ...before, stealthRock: true };
    case "spikes":
      return { ...before, spikesLayers: Math.min(3, before.spikesLayers + 1) };
    case "toxicSpikes":
      return { ...before, toxicSpikesLayers: Math.min(2, before.toxicSpikesLayers + 1) };
    case "stickyWeb":
      return { ...before, stickyWeb: true };
    default:
      return undefined;
  }
}

/**
 * 설치기 이월 항: 상대 대기 포켓몬이 한 번씩 등장할 때 받는 손해 합(각자 최대 HP 대비 비율).
 * 스텔스록·압정뿌리기는 등장 데미지 증가분, 독압정은 독 지속 데미지 HAZARD_POISON_TURNS 턴분,
 * 끈적끈적네트는 접지 대상 1마리당 고정값.
 */
export function hazardCarry(state: BattleState, key: FighterKey, move: Move): number {
  const oppSide = sideOf(state, opponentKey(key));
  const before = oppSide.hazards;
  const after = hazardsAfter(before, move);
  if (!after) return 0;
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
