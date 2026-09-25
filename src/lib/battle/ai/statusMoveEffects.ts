import { type FighterKey } from "@/types/battle";
import { type Move } from "@/types/move";
import { getItem, getMove } from "@/lib/data";
import { type StatusCondition } from "@/types/status";
import { applyMoveStatChanges, applyStageDelta } from "@/lib/statStages";
import { resolveEffectiveDefenderAbility } from "@/lib/abilityModifiers";
import { isConfusionBlockedByField, isOpponentTargetingMove, isStatusBlockedByField } from "@/lib/fieldEffects";
import { inflictStatus, isImmuneToStatus } from "@/lib/statusConditions";
import { FIELD_DURATION } from "@/lib/fieldEffects";
import { hasVolatile, inflictVolatile } from "@/lib/volatileConditions";
import { getConfusionCureBerryResult, getMentalHerbCureResult } from "@/lib/itemEffects";
import { BATTLE_STAT_KEYS, NEUTRAL_ACCURACY_STAGES, NEUTRAL_STAGES, type AccuracyEvasionKey, type BattleStatKey } from "@/types/battleStats";
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
  hasLivingReserve,
  isForcedSwitchBlocked,
  TAILWIND_DURATION,
  WONDER_ROOM_DURATION,
  MAGIC_ROOM_DURATION,
  GRAVITY_DURATION,
  MAGNET_RISE_DURATION,
  type BattleFighterState,
  type BattleSide,
  type BattleState,
} from "../state";
import { cureConditionsBlockedByAbility, isFixedAbility, isUncopyableAbility } from "../abilityChange";
import { calcEntryHazardDamage } from "../entryCost";
import { isGrounded } from "../grounding";
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
  | "yawn"
  // AI-A2(ver.1.8): 대타출동·울부짖기/날려버리기·추억의선물
  | "substitute"
  | "phaze"
  | "memento"
  // 트랙 M1(ver.1.8): 엔진에 새로 구현한 변화기 — 트릭/바꿔치기·아픔나누기·순풍·리사이클
  | "itemSwap"
  | "painSplit"
  | "tailwind"
  | "recycle"
  // 트랙 M2(ver.1.8): 자기암시·파워셰어·원한·트집·봉인·경혈찌르기
  | "copyStages"
  | "powerSplit"
  | "spite"
  | "torment"
  | "imprison"
  | "acupressure"
  // 트랙 M3(ver.1.8): 특성·타입 바꾸기 — 스킬스왑·동료만들기·역할·위액·고민씨/심플빔·물붓기/마법가루·숲의저주/핼러윈·미러타입
  | "abilitySwap"
  | "abilityGive"
  | "abilityCopy"
  | "abilitySuppress"
  | "abilitySet"
  | "typeSet"
  | "typeAdd"
  | "typeCopy"
  // 트랙 M4(ver.1.8): 원더룸·매직룸(다시 쓰면 해제)·중력·전자부유
  | "wonderRoom"
  | "magicRoom"
  | "gravity"
  | "magnetRise"
  // 트랙 M5: 목숨걸기(데미지 기술이지만 자신이 기절 — 추억의선물과 같은 희생 평가)
  | "finalGambit"
  // 트랙 M5: 대폭발·자폭·미스트버스트(쓰면 자신이 기절하는 데미지 기술) — 같은 희생 평가(사용자 결정)
  | "selfDestruct"
  // 트랙 M6: 부식가스·록온·자기장조작·치유소원(검은눈빛·블록·페어리록은 교체 모델링 때 — 사용자 결정)
  | "itemRemove"
  | "lockOn"
  | "magneticFlux"
  | "healingWish";

/** AI-A1(ver.1.8) 효과 — decision의 a1Aware로 따로 끌 수 있다(비교용) */
export const A1_EFFECT_KINDS: ReadonlySet<EffectMoveKind> = new Set(["haze", "safeguard", "regen", "leechSeed", "confuse", "attract", "yawn"]);

/** AI-A2(ver.1.8) 효과 — decision의 a2Aware로 따로 끌 수 있다(비교용) */
export const A2_EFFECT_KINDS: ReadonlySet<EffectMoveKind> = new Set(["substitute", "phaze", "memento"]);

/** 트랙 M(ver.1.8) 효과 — decision의 trackMAware로 따로 끌 수 있다(비교용) */
export const TRACK_M_EFFECT_KINDS: ReadonlySet<EffectMoveKind> = new Set([
  "itemSwap",
  "painSplit",
  "tailwind",
  "recycle",
  "copyStages",
  "powerSplit",
  "spite",
  "torment",
  "imprison",
  "acupressure",
  "abilitySwap",
  "abilityGive",
  "abilityCopy",
  "abilitySuppress",
  "abilitySet",
  "typeSet",
  "typeAdd",
  "typeCopy",
  "wonderRoom",
  "magicRoom",
  "gravity",
  "magnetRise",
  "finalGambit",
  "selfDestruct",
  "itemRemove",
  "lockOn",
  "magneticFlux",
  "healingWish",
]);

/** 경혈찌르기(트랙 M2)가 올릴 수 있는 능력 — 엔진 mirroredEffects와 같은 후보(+6 제외) */
export function acupressureOptions(fighter: BattleFighterState): (BattleStatKey | AccuracyEvasionKey)[] {
  return [
    ...BATTLE_STAT_KEYS.filter((s) => fighter.stages[s] < 6),
    ...(["accuracy", "evasion"] as const).filter((s) => fighter.accuracyStages[s] < 6),
  ];
}

/** 경혈찌르기(트랙 M2): fighter의 stat을 amount만큼 올린다(+6까지) */
export function applyAcupressure(fighter: BattleFighterState, stat: BattleStatKey | AccuracyEvasionKey, amount: number): void {
  if (stat === "accuracy" || stat === "evasion") {
    fighter.accuracyStages = { ...fighter.accuracyStages, [stat]: Math.min(6, fighter.accuracyStages[stat] + amount) };
  } else {
    fighter.stages = { ...fighter.stages, [stat]: Math.min(6, fighter.stages[stat] + amount) };
  }
}

/** 봉인(트랙 M2): 상대가 배운 기술 중 시전자도 배운 것(봉인되면 못 쓰는 기술) */
export function imprisonedMoveIds(user: BattleFighterState, target: BattleFighterState): string[] {
  return Object.keys(target.remainingPp).filter((id) => user.remainingPp[id] !== undefined);
}

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
  if (move.swapsItemsWithTarget) return "itemSwap";
  if (move.sharesHpWithTarget) return "painSplit";
  if (move.setsTailwind) return "tailwind";
  if (move.recyclesItem) return "recycle";
  if (move.copiesTargetStages) return "copyStages";
  if (move.averagesAttacksWithTarget) return "powerSplit";
  if (move.reducesTargetLastMovePp) return "spite";
  if (move.raisesRandomStat) return "acupressure";
  if (move.setsRoom) return move.setsRoom;
  if (move.removesTargetItem) return "itemRemove";
  if (move.boostsDefensesIfPlusMinus) return "magneticFlux";
  if (move.setsHealingWish) return "healingWish";
  if (move.inflictsVolatile?.some((v) => v.volatile === "lockOn" && v.target === "self")) return "lockOn";
  if (move.setsGravity) return "gravity";
  if (move.setsMagnetRise) return "magnetRise";
  if (move.swapsAbilityWithTarget) return "abilitySwap";
  if (move.givesAbilityToTarget) return "abilityGive";
  if (move.copiesTargetAbility) return "abilityCopy";
  if (move.suppressesTargetAbility) return "abilitySuppress";
  if (move.setsTargetAbilityId) return "abilitySet";
  if (move.setsTargetType) return "typeSet";
  if (move.addsTypeToTarget) return "typeAdd";
  if (move.copiesTargetTypes) return "typeCopy";
  if (move.inflictsVolatile?.some((v) => v.volatile === "torment" && v.target === "opponent")) return "torment";
  if (move.inflictsVolatile?.some((v) => v.volatile === "imprison" && v.target === "self")) return "imprison";
  if (move.setsSubstitute) return "substitute";
  if (move.forcesTargetSwitch) return "phaze";
  if (move.selfFaints && move.statChanges?.some((s) => s.target === "opponent")) return "memento";
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
  return !!effectKindOf(move) || isBatonPass(move) || !!move.healsWeatherDependent || !!move.restSleep || !!move.callsLastMoveInBattle;
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
    if (isStatusBlockedByField(state.field, effect.status, isGrounded(state, target, targetAbility))) continue;
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
  // 트랙 M1: 순풍 이미 불고 있음·리사이클 되찾을 도구 없음(엔진 resolveAction·mirroredEffects와 같은 조건)
  if (kind === "tailwind") return (sideOf(state, key).tailwindTurnsRemaining ?? 0) > 0;
  if (kind === "recycle") return !!me.currentItemId || !me.lastConsumedItemId;
  // 트랙 M2: 효과가 없으면(같은 랭크·같은 공격/특공·전부 +6·이미 봉인·겹치는 기술 없음) 쓰지 않는다
  if (kind === "copyStages") {
    const same = <T extends object>(a: T, b: T) => (Object.keys(a) as (keyof T)[]).every((s) => a[s] === b[s]);
    return same(me.stages, target.stages) && same(me.accuracyStages, target.accuracyStages) && me.critStage === target.critStage;
  }
  if (kind === "powerSplit") return me.realStats.atk === target.realStats.atk && me.realStats.spa === target.realStats.spa;
  if (kind === "acupressure") return acupressureOptions(me).length === 0;
  if (kind === "imprison") return hasVolatile(me.volatile, "imprison") || imprisonedMoveIds(me, target).length === 0;
  // 트랙 M6: 록온 이미 있음 · 자기장조작(플러스·마이너스가 아니거나 둘 다 +6) · 치유소원(교대할 포켓몬 없음)
  if (kind === "lockOn") return hasVolatile(me.volatile, "lockOn");
  if (kind === "magneticFlux") {
    return (me.effectiveAbilityId !== "플러스" && me.effectiveAbilityId !== "마이너스") || (me.stages.def >= 6 && me.stages.spd >= 6);
  }
  if (kind === "healingWish") return !hasLivingReserve(sideOf(state, key));
  // 트랙 M4: 중력 이미 있음 · 전자부유 못 뜸(엔진 resolveAction과 같은 조건). 룸은 다시 쓰면 해제라 실패가 없다.
  if (kind === "gravity") return state.gravityTurnsRemaining !== undefined;
  if (kind === "magnetRise") {
    return (
      state.gravityTurnsRemaining !== undefined ||
      !!me.smackedDown ||
      !!effectiveHeldItem(me, state)?.groundsHolder ||
      (me.magnetRiseTurnsRemaining ?? 0) > 0
    );
  }
  // 트랙 M3: 역할(복사할 수 없는 특성·이미 같음)·미러타입(이미 같은 타입) — 엔진 mirroredEffects와 같은 조건
  if (kind === "abilityCopy") {
    const theirs = target.effectiveAbilityId;
    return !theirs || isUncopyableAbility(theirs) || isFixedAbility(me.effectiveAbilityId) || me.effectiveAbilityId === theirs;
  }
  if (kind === "typeCopy") return me.types.length === target.types.length && me.types.every((t) => target.types.includes(t));
  // 대타출동: 이미 대타가 있거나 HP가 최대 HP 1/4 이하면 실패(엔진 mirroredEffects)
  if (kind === "substitute") return me.substituteHp !== undefined || me.currentHp <= Math.floor(me.maxHp / 4);

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
  // 트릭·바꿔치기: 둘 다 무도구·어느 쪽이든 메가스톤·상대 점착이면 실패. 아픔나누기는 공통 차단(대타 등)만.
  if (kind === "itemSwap") {
    const isMegaStone = (id: string | null) => !!id && getItem(id)?.category === "mega-stone";
    return (!me.currentItemId && !target.currentItemId) || isMegaStone(me.currentItemId) || isMegaStone(target.currentItemId) || !!targetAbility?.preventsItemLoss;
  }
  // 원한(트랙 M2): 상대 직전 기술의 PP를 0으로 만들 때만 의미가 있다(그 외엔 PP 소모전이 아닌 한 무의미 — 사용자 결정)
  if (kind === "spite") {
    const remaining = target.lastMoveId ? target.remainingPp[target.lastMoveId] : undefined;
    return remaining === undefined || remaining <= 0 || remaining > move.reducesTargetLastMovePp!;
  }
  // 부식가스(트랙 M6): 도구 없음·메가스톤·점착
  if (kind === "itemRemove") {
    return !target.currentItemId || getItem(target.currentItemId)?.category === "mega-stone" || !!targetAbility?.preventsItemLoss;
  }
  // 트랙 M3: 특성·타입 바꾸기(엔진 mirroredEffects와 같은 조건)
  if (kind === "abilitySwap") {
    const mine = me.effectiveAbilityId;
    const theirs = target.effectiveAbilityId;
    return isFixedAbility(mine) || isFixedAbility(theirs) || (!mine && !theirs) || mine === theirs;
  }
  if (kind === "abilityGive") {
    const mine = me.effectiveAbilityId;
    return !mine || isUncopyableAbility(mine) || isFixedAbility(target.effectiveAbilityId) || target.effectiveAbilityId === mine;
  }
  if (kind === "abilitySuppress") return !!target.abilitySuppressed || !target.effectiveAbilityId || isFixedAbility(target.effectiveAbilityId);
  if (kind === "abilitySet") return target.effectiveAbilityId === move.setsTargetAbilityId || isFixedAbility(target.effectiveAbilityId);
  if (kind === "typeSet") return target.types.length === 1 && target.types[0] === move.setsTargetType;
  if (kind === "typeAdd") return target.types.includes(move.addsTypeToTarget!);
  // 트집(트랙 M2): 이미 걸림·아로마베일·멘탈허브(걸리는 순간 풀림)
  if (kind === "torment") {
    return (
      hasVolatile(target.volatile, "torment") ||
      !!targetAbility?.blocksMentalMoves ||
      getMentalHerbCureResult(effectiveHeldItem(target), target.itemConsumed ?? false)
    );
  }
  // 울부짖기·날려버리기: 상대에게 살아있는 예비가 없거나 흡반·뿌리박기면 강제 교체가 안 된다(엔진 runTurn)
  if (kind === "phaze") return !hasLivingReserve(sideOf(state, oppKey)) || isForcedSwitchBlocked(target);
  // 도발·앙코르·사슬묶기: 아로마베일(마음을 옭아매는 기술 차단)·이미 걸림·상대가 아직 기술을 안 씀(앙코르·사슬묶기)
  if (kind === "taunt" || kind === "encore" || kind === "disable") {
    if (targetAbility?.blocksMentalMoves) return true;
    if (kind === "taunt" && targetAbility?.immuneToAttractAndTaunt) return true;
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
      return (
        hasVolatile(target.volatile, "confusion") ||
        isConfusionBlockedByField(state.field, isGrounded(state, target, targetAbility)) ||
        confusionCuredOnInflict(target) ||
        !!targetAbility?.immuneToConfusion
      );
    case "attract":
      return (
        hasVolatile(target.volatile, "attract") ||
        target.gender === null ||
        user.gender === null ||
        target.gender === user.gender ||
        !!targetAbility?.blocksMentalMoves ||
        !!targetAbility?.immuneToAttractAndTaunt ||
        getMentalHerbCureResult(effectiveHeldItem(target), target.itemConsumed ?? false)
      );
    case "yawn":
      // 이미 상태이상·졸음이면 실패, 잠듦 면역(타입·특성·필드)·신비의부적이면 2턴 뒤에 무산된다(finishTurn).
      return (
        !!target.status.condition ||
        hasVolatile(target.volatile, "drowsy") ||
        isImmuneToStatus("sleep", target.types, statusImmunitiesOf(target, targetAbility)) ||
        isStatusBlockedByField(state.field, "sleep", isGrounded(state, target, targetAbility)) ||
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
    case "tailwind":
      return TAILWIND_DURATION;
    // 트랙 M4: 룸은 걸려 있으면 다시 쓸 때 해제 — 그때는 "없어진 상태"가 남은 턴만큼 이어진다
    case "wonderRoom":
      return state.wonderRoomTurnsRemaining ?? WONDER_ROOM_DURATION;
    case "magicRoom":
      return state.magicRoomTurnsRemaining ?? MAGIC_ROOM_DURATION;
    case "gravity":
      return GRAVITY_DURATION;
    case "magnetRise":
      return MAGNET_RISE_DURATION;
    // 록온: 다음 행동 한 번만 필중
    case "lockOn":
      return 1;
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
    case "itemSwap": {
      const mine = me.currentItemId;
      me.currentItemId = target.currentItemId;
      target.currentItemId = mine;
      me.itemConsumed = false;
      target.itemConsumed = false;
      me.choiceLockedMoveId = undefined;
      target.choiceLockedMoveId = undefined;
      return true;
    }
    case "painSplit": {
      const shared = Math.floor((me.currentHp + target.currentHp) / 2);
      me.currentHp = Math.min(me.maxHp, shared);
      target.currentHp = Math.min(target.maxHp, shared);
      return true;
    }
    case "tailwind":
      sideOf(clone, key).tailwindTurnsRemaining = TAILWIND_DURATION;
      return true;
    case "recycle":
      me.currentItemId = me.lastConsumedItemId ?? null;
      me.itemConsumed = false;
      me.lastConsumedItemId = undefined;
      return true;
    case "substitute": {
      const cost = Math.floor(me.maxHp / 4);
      me.currentHp -= cost;
      me.substituteHp = cost;
      return true;
    }
    case "memento": {
      // 상대 랭크다운은 debuff와 같은 처리, 자신은 기절. 내릴 스탯이 없으면(−6·클리어바디 등) 기절만 하므로 실패로 본다.
      const changed = applyDebuff(clone, key, move);
      me.currentHp = 0;
      return changed;
    }
    case "yawn":
      // 다음 턴 종료에 잠든다 — 잠듦을 바로 걸고, 평가 쪽(evaluateEffectMove)에서 "그 전에 끝나는 대면"을 보정한다.
      target.status = inflictStatus(target.status, "sleep");
      return true;
    case "encore":
    case "disable":
      target.volatile = inflictVolatile(target.volatile, kind, () => 0, target.lastMoveId);
      return true;
    case "debuff":
      return applyDebuff(clone, key, move);
    // 트랙 M2
    case "copyStages":
      me.stages = { ...target.stages };
      me.accuracyStages = { ...target.accuracyStages };
      me.critStage = target.critStage;
      return true;
    case "powerSplit": {
      const atk = Math.floor((me.realStats.atk + target.realStats.atk) / 2);
      const spa = Math.floor((me.realStats.spa + target.realStats.spa) / 2);
      me.realStats = { ...me.realStats, atk, spa };
      target.realStats = { ...target.realStats, atk, spa };
      return true;
    }
    case "spite": {
      const lastId = target.lastMoveId!;
      target.remainingPp = { ...target.remainingPp, [lastId]: Math.max(0, target.remainingPp[lastId] - move.reducesTargetLastMovePp!) };
      return true;
    }
    case "torment":
      target.volatile = inflictVolatile(target.volatile, "torment");
      return true;
    // 트랙 M6
    case "itemRemove":
      target.currentItemId = null;
      target.choiceLockedMoveId = undefined;
      return true;
    case "lockOn":
      me.volatile = inflictVolatile(me.volatile, "lockOn");
      return true;
    case "magneticFlux":
      me.stages = applyStageDelta(applyStageDelta(me.stages, "def", 1), "spd", 1);
      return true;
    // 트랙 M4
    case "wonderRoom":
      clone.wonderRoomTurnsRemaining = clone.wonderRoomTurnsRemaining === undefined ? WONDER_ROOM_DURATION : undefined;
      return true;
    case "magicRoom":
      clone.magicRoomTurnsRemaining = clone.magicRoomTurnsRemaining === undefined ? MAGIC_ROOM_DURATION : undefined;
      return true;
    case "gravity":
      clone.gravityTurnsRemaining = GRAVITY_DURATION;
      me.magnetRiseTurnsRemaining = undefined;
      target.magnetRiseTurnsRemaining = undefined;
      return true;
    case "magnetRise":
      me.magnetRiseTurnsRemaining = MAGNET_RISE_DURATION;
      return true;
    // 트랙 M3: 특성·타입을 바꾼 state로 재평가(새 특성이 면역인 상태는 엔진처럼 바로 풀린다)
    case "abilitySwap": {
      const mine = me.effectiveAbilityId;
      me.effectiveAbilityId = target.effectiveAbilityId;
      target.effectiveAbilityId = mine;
      cureConditionsBlockedByAbility(me);
      cureConditionsBlockedByAbility(target);
      return true;
    }
    case "abilityGive":
      target.effectiveAbilityId = me.effectiveAbilityId;
      cureConditionsBlockedByAbility(target);
      return true;
    case "abilityCopy":
      me.effectiveAbilityId = target.effectiveAbilityId;
      cureConditionsBlockedByAbility(me);
      return true;
    case "abilitySuppress":
      target.effectiveAbilityId = null;
      target.abilitySuppressed = true;
      return true;
    case "abilitySet":
      target.effectiveAbilityId = move.setsTargetAbilityId!;
      cureConditionsBlockedByAbility(target);
      return true;
    case "typeSet":
      target.types = [move.setsTargetType!];
      target.addedType = undefined;
      return true;
    case "typeAdd":
      target.types = [...target.types, move.addsTypeToTarget!];
      target.addedType = move.addsTypeToTarget;
      return true;
    case "typeCopy":
      me.types = [...target.types];
      me.addedType = undefined;
      return true;
    case "imprison":
      me.volatile = inflictVolatile(me.volatile, "imprison");
      return true;
    default:
      return false;
  }
}

/** 상대 랭크다운 적용(심술꾸러기·클리어바디류·미러아머 반영). 실제로 바뀐 스탯이 있으면 true */
function applyDebuff(clone: BattleState, key: FighterKey, move: Move): boolean {
  const me = clone[key];
  const target = clone[opponentKey(key)];
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
    const grounded = isGrounded(state, f, ability);
    const extra =
      calcEntryHazardDamage(f.maxHp, f.types, ability, after, grounded) - calcEntryHazardDamage(f.maxHp, f.types, ability, before, grounded);
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

/**
 * 잠꼬대로 나갈 수 있는 기술(엔진 preHitEffects와 같은 조건 — 배운 기술 중 자신·2턴 기술·사용 조건 기술·제외 기술 빼고).
 */
export function sleepTalkCandidates(fighter: BattleFighterState, sleepTalk: Move): Move[] {
  return Object.keys(fighter.remainingPp)
    .map((id) => getMove(id))
    .filter((m): m is Move => !!m && m.id !== sleepTalk.id && !m.chargeTurn && !m.usageCondition && !m.excludedFromSleepTalk);
}
