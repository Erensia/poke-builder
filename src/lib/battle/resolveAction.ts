import { type Move } from "@/types/move";
import { type FieldKind } from "@/types/field";
import { type ActionLogEntry, type FighterKey } from "@/types/battle";
import { BATTLE_STAT_KEYS } from "@/types/battleStats";
import { getAbility, getItem, getMove } from "@/lib/data";
import { effectiveHeldItem } from "./turnOrderInputs";
import { applyFlingEffect } from "./fling";
import { applyStageDelta } from "@/lib/statStages";
import { isOpponentTargetingMove } from "@/lib/fieldEffects";
import { getHpThresholdBerryHeal } from "@/lib/itemEffects";
import { GRAVITY_DURATION, MAGIC_ROOM_DURATION, MAGNET_RISE_DURATION, SCREEN_DURATION, TAILWIND_DURATION, TRICK_ROOM_DURATION, WONDER_ROOM_DURATION, WEATHER_DURATION, activeWeather, applyForecastForm, consumeItem, contraryDelta, hasLivingReserve, isFainted, sideOf, type BattleState } from "./state";
import { resolvePreHitEffects } from "./preHitEffects";
import { resolveHitAndApplyDamage } from "./hitResolution";
import { resolveMirroredMoveEffects } from "./mirroredEffects";

export function resolveAction(
  state: BattleState,
  actorKey: FighterKey,
  move: Move,
  random: () => number,
  movesSecond: boolean,
  defenderMove: Move,
): ActionLogEntry {
  const pre = resolvePreHitEffects(state, actorKey, move, random, movesSecond, defenderMove);
  if (!("defenderKey" in pre)) return pre;
  move = pre.move;
  let {
    defenderKey, attacker, defender, defenderHpAtActionStart, actorPokemonId, defenderPokemonId, attackerAbility, defenderAbility, attackerBerriesBlocked, defenderBerriesBlocked, attackerItemIdBeforeAction, defenderItemIdBeforeAction, leppaRestoredPpItemName, pressureExtraPpAbilityName, selfCuredStatus, sleepTalkCalledMoveName, copycatCalledMoveName, ohkoBlockedByAbilityName, ohkoImmune, flungItemId, attackerItem, defenderItem, blockedByGoodAsGold, blockedBySubstitute, blockedByPowderImmunity, unseenFistPiercing, blockedByProtect, blockedByProtectMoveName, soundproofBlockedByAbilityName, bulletproofBlockedByAbilityName, opponentEffectsBlocked, bouncedByMagicMirror, shellSideArmCategory, abilityOffenseMultiplier, abilityDefenseMultiplier, stabMultiplier, typeEffectiveness, effectiveMove, sheerForceAbilityName, fickleBeamEmpowered, electromorphosisEmpoweredAbilityName, ownMoveTypeBoostMultiplier, rivalryMultiplier, changedOwnTypeTo, changedOwnTypeAbilityName, lostTypeAfterUse, gemMultiplier, ateGemItemName, hitChance, defenderHideType, evadedByCharge, hit, selfDamageOnUse, abilityAbsorbedMoveType, abilityAbsorbAbilityName, abilityAbsorbHealAmount, protectContactPenaltyMoveName, protectContactDamage, protectContactInflictedStatus,
  } = pre;

  let {
    abilityDamageAbilityName, abilityDamageToAttacker, abilityDisableAbilityName, abilityDisabledMoveName, abilityInflictedStatusAbilityName, abilityInflictedStatusOnAttacker, abilityInflictedVolatileAbilityName, abilityInflictedVolatileOnAttacker, abilityLoweredAttackerStats, abilityLoweredAttackerStatsAbilityName, abilityLoweredDefenderStats, abilityRaisedDefenderStats, abilityRaisedDefenderStatsAbilityName, angerPointAbilityName, angerPointRaisedSpa, berryReducedDamageItemName, canceledTargetChargeMoveName, cheekPouchHeal, counterDamage, counterFailed, crashDamage, damage, damagePercent, destinyBondTriggered, disguiseRecoilDamage, drainHealAmount, endeavorDamage, enduredAbilityName, enduredItemName, enduredProtectMoveName, followUpHitDamage, hitCount, hitNegatedByAbilityName, hitSubstitute, illusionBrokenSpeciesId, isCritical, isDamaging, itemRecoilDamage, itemRecoilItemName, liquidOozeAbilityName, liquidOozeDamage, mummifiedAttackerAbilityName, perHitLog, pickpocketAbilityName, pickpocketStolenItemName, recoilDamage, rockyHelmetDamage, rockyHelmetItemName, sandSpitWeather, seedSowerField, selfDamage, shellBellHealAmount, statusCureBerryItemName, stolenItemName, substituteBroke, terrainSeedMessages, wanderingSpiritSwapped
  } = resolveHitAndApplyDamage({
    state, defenderKey, move, effectiveMove, random, attacker, defender, attackerAbility, defenderAbility, attackerItem, defenderItem, typeEffectiveness, blockedByProtect, blockedBySubstitute, unseenFistPiercing, hitChance, evadedByCharge, defenderHideType, gemMultiplier, ownMoveTypeBoostMultiplier, rivalryMultiplier, sheerForceAbilityName, defenderBerriesBlocked, abilityOffenseMultiplier, abilityDefenseMultiplier, stabMultiplier
  });
  // 아로마베일: 방어측이 이 특성이라 마음을 옭아매는 volatile(헤롱헤롱·도발·기술봉인·앙코르)을 막았을 때 그 특성 이름.
  // resolveHitAndApplyDamage 구간(§7)에선 안 쓰이고 아래(변화기 효과 적용부)에서만 채워진다.
  let mentalMoveBlockedByAbilityName: string | undefined;

  const mirrorResult = resolveMirroredMoveEffects({
    bouncedByMagicMirror, move, effectiveMove, opponentEffectsBlocked, random, state, hit, movesSecond, defenderKey, damage, hitSubstitute, defenderMove, actorKey, defenderBerriesBlocked, attackerBerriesBlocked, blockedByProtect, sheerForceAbilityName, isDamaging, selfCuredStatus, terrainSeedMessages, defenderAbility, attacker, defender, attackerAbility, attackerItem, defenderItem, abilityInflictedStatusOnAttacker, abilityInflictedStatusAbilityName, statusCureBerryItemName, mentalMoveBlockedByAbilityName,
  });
  let {
    bouncedMoveName, bouncedByAbilityName, secondaryBlockedByAbilityName, berryEatFailed, stuffCheeksBerryHeal, stuffCheeksBerryName, costHpFailed, soulBeatHpCost, selfStatRises, selfStatsAtMax, selfStatDrops, reflectedStatDropAbilityName, reflectedStatDrops, restoredStatsSelfItemName, restoredStatsOpponentItemName, opportunistCopiedStats, opportunistAbilityName, opponentStatDrops, invertedTargetStages, addedTypeToTarget, overwroteTargetType, targetMoveTypeOverride, inflictedStatus, statusInflictFailed, beakBlastBurnedAttacker, curedStatus, curedStatusTarget, inflictedVolatile, tidyUpDone, courtChangeDone, revivedPartyName, reviveFailed, saltCureApplied, balloonPoppedItemName, octolockApplied, jawLockApplied, selfWokeBeforeMove, restSlept, healedAmount, healedTarget, averagedDefensesMoveName, swappedSpeedMoveName, transformedIntoName, transformFailed, regenSetFailed, leechSeedSetFailed, leechSeedBlockedByGrass, abilitySwappedTargetToName, abilitySwapFailed, substituteSetFailed, shedTailFailed, shedTailSucceeded, setDisabledMoveName, disableSetFailed, setEncoreMoveName, encoreSetFailed, swappedStatsMoveName, swappedStagesMoveName, protectSucceeded, protectFailed, protectStanceEntered, fieldSetFailed, stealthRockSetForSide, spikesSetForSide, toxicSpikesSetForSide, stickyWebSetForSide, hazardSetFailed, swappedItems, itemSwapFailed, painSplitHp, stockpileHealFailed, recycledItemName, recycleFailed, copiedStagesFromName, averagedAttacksMoveName, spitePp, spiteFailed, acupressureRaised, acupressureFailed, volatileBlockedByAbility, abilityChange, abilityChangeFailed, copiedTypes, smackedDownTarget, meltedItemName, meltFailed, magneticFluxFailed, partyStatusCuredCount, teaTime, teaTimeFailed,
  } = mirrorResult;
  ({ defenderAbility, attacker, defender, attackerAbility, attackerItem, defenderItem, abilityInflictedStatusOnAttacker, abilityInflictedStatusAbilityName, statusCureBerryItemName, mentalMoveBlockedByAbilityName } = mirrorResult);

  // 내던지기(트랙 M5): 던진 도구의 효과를 맞은 상대에게 — 데미지를 주고 대타가 아니며 상대가 버텼을 때만
  const flungItem = flungItemId ? getItem(flungItemId) : undefined;
  const flingEffect =
    flungItem && hit && damage > 0 && !hitSubstitute && !isFainted(defender)
      ? applyFlingEffect(state, actorKey, defender, defenderAbility, flungItem, !movesSecond)
      : undefined;

  // 멸망의노래(setsPerishSong, F-4): 장에 있는 양쪽에게 멸망 카운트 3을 건다. 방어·대타·황금몸을
  // 무시하므로 opponentEffectsBlocked로 게이팅하지 않는다. 방음(blocksSound) 특성이나 발동 시점에
  // 차징(공중날기·구멍파기 등)으로 다른 장소 취급인 포켓몬에겐 카운트가 시작되지 않는다.
  // 양쪽 다 이미 카운트 중이면 재사용 실패.
  let perishSongStarted = false;
  let perishSongFailed = false;
  if (effectiveMove.setsPerishSong) {
    const attackerEligible = attacker.perishCount === undefined && !attackerAbility?.blocksSound;
    const defenderEligible =
      defender.perishCount === undefined && !defenderAbility?.blocksSound && defender.chargingMoveId === undefined;
    if (!attackerEligible && !defenderEligible) {
      perishSongFailed = true;
    } else {
      if (attackerEligible) attacker.perishCount = 3;
      if (defenderEligible) defender.perishCount = 3;
      perishSongStarted = true;
    }
  }

  // 아이언롤러: 명중하면 활성 필드를 제거한다. usageCondition: "field-required"로 필드가 없으면
  // 애초에 이 지점까지 오지 못하니(맨 위에서 이미 실패 처리), 여기선 있는 필드를 지우기만 하면 된다.
  let destroyedField: FieldKind | undefined;
  if (effectiveMove.destroysField && state.field) {
    destroyedField = state.field;
    state.field = undefined;
    state.fieldTurnsRemaining = undefined;
  }

  // 트릭룸: 이미 걸려 있으면 다시 쓸 때 해제된다(본가 — 트랙 M4에서 "재사용 실패"였던 규칙을 사용자 결정으로 변경).
  const trickRoomSetFailed = false;
  let trickRoomEnded = false;
  if (effectiveMove.setsTrickRoom) {
    if (state.trickRoomTurnsRemaining !== undefined) {
      state.trickRoomTurnsRemaining = undefined;
      trickRoomEnded = true;
    } else {
      state.trickRoomTurnsRemaining = TRICK_ROOM_DURATION;
    }
  }

  // 원더룸·매직룸(트랙 M4): 트릭룸과 같은 규칙 — 5턴, 다시 쓰면 해제.
  let roomChange: { room: "wonderRoom" | "magicRoom"; on: boolean } | undefined;
  if (effectiveMove.setsRoom === "wonderRoom") {
    const on = state.wonderRoomTurnsRemaining === undefined;
    state.wonderRoomTurnsRemaining = on ? WONDER_ROOM_DURATION : undefined;
    roomChange = { room: "wonderRoom", on };
  } else if (effectiveMove.setsRoom === "magicRoom") {
    const on = state.magicRoomTurnsRemaining === undefined;
    state.magicRoomTurnsRemaining = on ? MAGIC_ROOM_DURATION : undefined;
    roomChange = { room: "magicRoom", on };
  }

  // 중력(트랙 M4): 5턴, 이미 있으면 실패. 걸리는 순간 공중에 있던 포켓몬이 떨어진다 — 공중날기·뛰어오르기 모으기가
  // 풀리고 전자부유가 끝난다.
  let gravitySet = false;
  let gravitySetFailed = false;
  if (effectiveMove.setsGravity) {
    if (state.gravityTurnsRemaining !== undefined) {
      gravitySetFailed = true;
    } else {
      state.gravityTurnsRemaining = GRAVITY_DURATION;
      gravitySet = true;
      for (const f of [state.a, state.b]) {
        f.magnetRiseTurnsRemaining = undefined;
        if (f.chargingMoveId && getMove(f.chargingMoveId)?.chargeHideType === "sky") f.chargingMoveId = undefined;
      }
    }
  }

  // 페어리록(트랙 M6): 다음 턴 양쪽 모두 교체 불가(2로 걸어 이번 턴 끝에 1 — 그 턴이 봉쇄 턴). 이미 걸려 있으면 실패.
  let fairyLockSet = false;
  let fairyLockFailed = false;
  if (effectiveMove.setsFairyLock) {
    if (state.fairyLockTurnsRemaining !== undefined) {
      fairyLockFailed = true;
    } else {
      state.fairyLockTurnsRemaining = 2;
      fairyLockSet = true;
    }
  }

  // 치유소원(트랙 M6): 교대할 포켓몬이 있으면 자신은 기절하고, 다음에 이 편에 나오는 포켓몬이 전부 회복(switching)
  let healingWishSet = false;
  let healingWishFailed = false;
  if (effectiveMove.setsHealingWish) {
    const mySide = sideOf(state, actorKey);
    if (!hasLivingReserve(mySide)) {
      healingWishFailed = true;
    } else {
      mySide.healingWishPending = true;
      attacker.currentHp = 0;
      healingWishSet = true;
    }
  }

  // 전자부유(트랙 M4): 5턴 동안 떠오른다. 중력·떨어뜨리기·검은철구(땅에 붙잡힘)·이미 떠 있으면 실패.
  let magnetRiseSet = false;
  let magnetRiseFailed = false;
  if (effectiveMove.setsMagnetRise) {
    if (
      state.gravityTurnsRemaining !== undefined ||
      attacker.smackedDown ||
      effectiveHeldItem(attacker, state)?.groundsHolder ||
      (attacker.magnetRiseTurnsRemaining ?? 0) > 0
    ) {
      magnetRiseFailed = true;
    } else {
      attacker.magnetRiseTurnsRemaining = MAGNET_RISE_DURATION;
      magnetRiseSet = true;
    }
  }

  // 날씨 변화 기술(비바라기 등): 다른 날씨는 덮어쓰지만, 이미 같은 날씨면 실패한다 — 남은 턴도
  // 다시 채우지 않는다(본가 규칙, 사용자 확인 — 필드/트릭룸과 같은 규칙). 날씨부정으로 효과가 꺼져
  // 있어도 날씨 자체는 있으므로 state.weather(원래 값)로 비교한다. 지속시간은 특성/수동 선택으로
  // 걸렸을 때와 마찬가지로 WEATHER_DURATION(+바위 보너스).
  let weatherSetFailed = false;
  if (effectiveMove.setsWeather && state.weather === effectiveMove.setsWeather) {
    weatherSetFailed = true;
  } else if (effectiveMove.setsWeather) {
    state.weather = effectiveMove.setsWeather;
    const rockBonus =
      attackerItem?.weatherDurationBonus?.weather === effectiveMove.setsWeather
        ? attackerItem.weatherDurationBonus.bonus
        : 0;
    state.weatherTurnsRemaining = WEATHER_DURATION + rockBonus;
    // 기분파(캐스퐁): 날씨가 바뀌면 그 자리에서 타입을 다시 맞춘다.
    applyForecastForm(state.a, activeWeather(state));
    applyForecastForm(state.b, activeWeather(state));
  }

  // 리플렉터/빛의장막/오로라베일: 자기 편(side)에 이미 같은 스크린이 걸려있으면 실패(필드/트릭룸과
  // 같은 패턴). 빛의점토를 지녔으면 지속시간이 늘어난다. 스크린은 사용자 자신을 겨냥하는 기술이라
  // 매직미러 반사 대상이 아니다 — actorKey가 곧 사용자 편(§6-3).
  let screenSetFailed = false;
  if (effectiveMove.setsScreen) {
    const attackerScreens = sideOf(state, actorKey).screens;
    if (attackerScreens[effectiveMove.setsScreen] !== undefined) {
      screenSetFailed = true;
    } else {
      const screenBonus = attackerItem?.screenDurationBonus ?? 0;
      sideOf(state, actorKey).screens = {
        ...attackerScreens,
        [effectiveMove.setsScreen]: SCREEN_DURATION + screenBonus,
      };
    }
  }

  // 신비의부적(세이프가드): 스크린과 같은 패턴 — 자기 편에 이미 걸려있으면 실패, 사용자 자신
  // 겨냥이라 매직미러 반사 대상이 아니다. 빛의점토는 스크린 전용(본가 규칙)이라 지속시간 보너스 없음.
  let safeguardSetFailed = false;
  if (effectiveMove.setsSafeguard) {
    const attackerSide = sideOf(state, actorKey);
    if (attackerSide.safeguardTurnsRemaining !== undefined) {
      safeguardSetFailed = true;
    } else {
      attackerSide.safeguardTurnsRemaining = SCREEN_DURATION;
    }
  }

  // 순풍(트랙 M1): 신비의부적과 같은 편 단위 — 이미 불고 있으면 실패. 쓴 턴 포함 4턴.
  let tailwindSetFailed = false;
  let tailwindSet = false;
  if (effectiveMove.setsTailwind) {
    const attackerSide = sideOf(state, actorKey);
    if ((attackerSide.tailwindTurnsRemaining ?? 0) > 0) {
      tailwindSetFailed = true;
    } else {
      attackerSide.tailwindTurnsRemaining = TAILWIND_DURATION;
      tailwindSet = true;
    }
  }

  // 자뭉열매/오랭열매: 이번 행동으로 생긴 모든 HP 변화(피격/반동/회복 등)가 끝난 뒤, 체력이 최대
  // HP 1/2 이하인 쪽(공격자든 방어자든)이 있으면 자동 발동한다. attacker를 먼저 확인하는 순서는
  // 임의지만, 도구는 각자 한 개씩만 지니므로 서로 간섭하지 않는다.
  let attackerBerryHealAmount = 0;
  let attackerBerryHealItemName: string | undefined;
  if (!isFainted(attacker) && !attackerBerriesBlocked) {
    attackerBerryHealAmount = getHpThresholdBerryHeal(
      attackerItem,
      attacker.currentHp,
      attacker.maxHp,
      attacker.itemConsumed ?? false,
      !!attackerAbility?.doublesBerryEffect, // 숙성
    );
    if (attackerBerryHealAmount > 0) {
      attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + attackerBerryHealAmount);
      consumeItem(attacker);
      attackerBerryHealItemName = attackerItem!.name;
    }
  }
  let defenderBerryHealAmount = 0;
  let defenderBerryHealItemName: string | undefined;
  if (!isFainted(defender) && !defenderBerriesBlocked) {
    defenderBerryHealAmount = getHpThresholdBerryHeal(
      defenderItem,
      defender.currentHp,
      defender.maxHp,
      defender.itemConsumed ?? false,
      !!defenderAbility?.doublesBerryEffect, // 숙성
    );
    if (defenderBerryHealAmount > 0) {
      defender.currentHp = Math.min(defender.maxHp, defender.currentHp + defenderBerryHealAmount);
      consumeItem(defender);
      defenderBerryHealItemName = defenderItem!.name;
    }
  }

  // 자기과신: 자신의 데미지로 상대를 실제로 쓰러뜨렸을 때만 발동. resolveAction은 상대가 이미
  // 쓰러진 상태로는 호출되지 않으므로(runTurn의 break), 여기서 isFainted(defender)가 true라면
  // 이번 행동 중에 쓰러진 것이다 — 데미지를 준 경우로 한정해 상태이상/씨뿌리기 등 무관한 원인은 제외.
  if (isDamaging && damage > 0 && isFainted(defender) && attackerAbility?.boostsStatOnKo) {
    const boost = attackerAbility.boostsStatOnKo;
    attacker.stages = applyStageDelta(attacker.stages, boost.stat, contraryDelta(attacker, boost.delta));
  }

  // 천정부지(포챔스판): 자신의 데미지로 상대를 쓰러뜨리면 realStats가 가장 높은 능력이 1랭크 오른다.
  if (isDamaging && damage > 0 && isFainted(defender) && attackerAbility?.boostsHighestStatOnKo) {
    const highest = BATTLE_STAT_KEYS.reduce((a, b) => (attacker.realStats[b] > attacker.realStats[a] ? b : a));
    attacker.stages = applyStageDelta(attacker.stages, highest, contraryDelta(attacker, 1));
  }

  // 마지막일침(포챔스판): 이 기술의 데미지로 상대를 실제로 쓰러뜨리면 사용자 스탯이 오른다.
  // 자기과신(위)과 완전히 같은 축 — 특성이 아니라 기술 단위라는 점만 다르다.
  if (isDamaging && damage > 0 && isFainted(defender) && effectiveMove.boostsUserStatOnKo) {
    const boost = effectiveMove.boostsUserStatOnKo;
    attacker.stages = applyStageDelta(attacker.stages, boost.stat, contraryDelta(attacker, boost.delta));
  }

  // 레이징불·깨트리기(breaksScreensOnHit): 명중하면 상대 편(side) 스크린을 전부 제거한다. 위
  // 데미지 계산은 스크린이 살아있는 상태로 이미 끝났으니(그 턴엔 아직 경감), 여기서 제거만 한다.
  let brokeScreens: ("reflect" | "lightScreen" | "auroraVeil")[] | undefined;
  if (effectiveMove.breaksScreensOnHit) {
    const defenderScreens = sideOf(state, defenderKey).screens;
    const present = (Object.keys(defenderScreens) as ("reflect" | "lightScreen" | "auroraVeil")[]).filter(
      (s) => defenderScreens[s] !== undefined,
    );
    if (present.length > 0) {
      sideOf(state, defenderKey).screens = {};
      brokeScreens = present;
    }
  }

  // 곡예: 이번 행동 도중 도구가 있었다가(전) 없어졌으면(후 — 나무열매 소모든 매지션에게
  // 강탈당했든 원인 무관) 그 즉시 한 번만 발동해서 배틀 끝까지 스피드 2배를 유지한다. 이미
  // 발동했으면(unburdenActive) 다시 판정하지 않는다.
  let unburdenSelfAbilityName: string | undefined;
  if (
    attackerAbility?.doublesSpeedOnItemLoss &&
    !attacker.unburdenActive &&
    attackerItemIdBeforeAction !== null &&
    attacker.currentItemId === null
  ) {
    attacker.unburdenActive = true;
    unburdenSelfAbilityName = attackerAbility.name;
  }
  let unburdenOpponentAbilityName: string | undefined;
  if (
    defenderAbility?.doublesSpeedOnItemLoss &&
    !defender.unburdenActive &&
    defenderItemIdBeforeAction !== null &&
    defender.currentItemId === null
  ) {
    defender.unburdenActive = true;
    unburdenOpponentAbilityName = defenderAbility.name;
  }

  // 대타에 통째로 막힘: 상대를 겨냥한 기술인데 대타를 실제로 깎지도(hitSubstitute) 못했으면
  // (= 변화기이거나 데미지 0), 본체엔 아무 일도 안 일어난 것이라 "실패" 문구를 낸다.
  const blockedBySubstituteMoveName =
    blockedBySubstitute && !hitSubstitute && isOpponentTargetingMove(effectiveMove) ? effectiveMove.name : undefined;
  const powderBlockedMoveName = blockedByPowderImmunity ? effectiveMove.name : undefined;

  // 볼주머니: 이번 행동 중 consumeItem이 나무열매 소비로 쌓아둔 추가 회복량을 로그로 옮기고 지운다.
  cheekPouchHeal += (attacker.pendingCheekPouchHeal ?? 0) + (defender.pendingCheekPouchHeal ?? 0);
  attacker.pendingCheekPouchHeal = undefined;
  defender.pendingCheekPouchHeal = undefined;

  // 위기회피(Emergency Exit): 이번 행동으로 방어측(매직미러 스왑 전 원래 방어측) HP가 절반
  // 초과 → 절반 이하(단 0 초과)로 넘어갔고 이 특성을 가졌으면, runActionPhase가 유턴류와 같은
  // pause 흐름으로 방어측을 물러나게 하도록 플래그만 세운다. 실제 교체·예비 유무·봉인 판정은
  // runActionPhase에서 한다.
  const origDefender = state[defenderKey];
  const origDefenderAbility = origDefender.effectiveAbilityId ? getAbility(origDefender.effectiveAbilityId) : undefined;
  const triggersDefenderEmergencyExit =
    !!origDefenderAbility?.exitsFieldAtHalfHp &&
    origDefender.currentHp > 0 &&
    defenderHpAtActionStart * 2 > origDefender.maxHp &&
    origDefender.currentHp * 2 <= origDefender.maxHp;

  return {
    actor: actorKey,
    actorPokemonId,
    defenderPokemonId,
    move,
    hit: true,
    critical: isCritical,
    damage,
    damagePercent,
    typeEffectiveness,
    defenderRemainingHp: defender.currentHp,
    selfDamage,
    attackerRemainingHp: attacker.currentHp,
    inflictedStatus,
    inflictedVolatile,
    opponentStatDrops: opponentStatDrops.length > 0 ? opponentStatDrops : undefined,
    statusInflictFailed: statusInflictFailed || undefined,
    protectStanceEntered: protectStanceEntered || undefined,
    reflectedStatDropAbilityName,
    reflectedStatDrops: reflectedStatDrops.length > 0 ? reflectedStatDrops : undefined,
    crashDamage: crashDamage || undefined,
    selfDamageOnUse: selfDamageOnUse || undefined,
    canceledTargetChargeMoveName,
    endeavorDamage: endeavorDamage || undefined,
    counterDamage: counterDamage || undefined,
    counterFailed: counterFailed || undefined,
    perishSongStarted: perishSongStarted || undefined,
    perishSongFailed: perishSongFailed || undefined,
    curedStatus,
    curedStatusTarget,
    selfWokeBeforeMove,
    blockedBySubstituteMoveName,
    powderBlockedMoveName,
    setField: fieldSetFailed ? undefined : effectiveMove.setsField,
    terrainSeedMessages: terrainSeedMessages.length ? terrainSeedMessages : undefined,
    fieldSetFailed,
    stealthRockSetForSide,
    spikesSetForSide,
    toxicSpikesSetForSide,
    stickyWebSetForSide,
    hazardSetFailed,
    abilitySwappedTargetToName,
    abilitySwapFailed: abilitySwapFailed || undefined,
    ateBerryName: stuffCheeksBerryName,
    ateBerryHeal: stuffCheeksBerryHeal || undefined,
    berryEatFailed: berryEatFailed || undefined,
    bouncedMoveName,
    bouncedByAbilityName,
    secondaryBlockedByAbilityName,
    destroyedField,
    setTrickRoom: trickRoomSetFailed || trickRoomEnded ? undefined : effectiveMove.setsTrickRoom,
    trickRoomSetFailed,
    setWeather: weatherSetFailed ? undefined : effectiveMove.setsWeather,
    weatherSetFailed: weatherSetFailed || undefined,
    setScreen: screenSetFailed ? undefined : effectiveMove.setsScreen,
    screenSetFailed,
    setSafeguard: safeguardSetFailed ? undefined : (effectiveMove.setsSafeguard || undefined),
    trickRoomEnded: trickRoomEnded || undefined,
    roomChange,
    gravitySet: gravitySet || undefined,
    gravitySetFailed: gravitySetFailed || undefined,
    magnetRiseSet: magnetRiseSet || undefined,
    magnetRiseFailed: magnetRiseFailed || undefined,
    tailwindSet: tailwindSet || undefined,
    tailwindSetFailed: tailwindSetFailed || undefined,
    safeguardSetFailed: safeguardSetFailed || undefined,
    brokeScreens,
    fainted: isFainted(defender),
    selfFainted: isFainted(attacker),
    recoilDamage,
    enduredItemName,
    enduredAbilityName,
    restoredStatsSelfItemName,
    restoredStatsOpponentItemName,
    hitCount,
    hits: perHitLog && perHitLog.length > 0 ? perHitLog : undefined,
    itemRecoilDamage: itemRecoilDamage || undefined,
    itemRecoilItemName,
    berryReducedDamageItemName,
    leppaRestoredPpItemName,
    drainHealAmount: drainHealAmount || undefined,
    liquidOozeDamage: liquidOozeDamage || undefined,
    liquidOozeAbilityName,
    shellBellHealAmount: shellBellHealAmount || undefined,
    healedAmount: healedAmount || undefined,
    healedTarget,
    restSlept,
    setRegenVolatile: regenSetFailed ? undefined : effectiveMove.setsRegenVolatile,
    regenSetFailed,
    setLeechSeed: leechSeedSetFailed || leechSeedBlockedByGrass ? undefined : effectiveMove.setsLeechSeed,
    leechSeedSetFailed,
    leechSeedBlockedByGrass: leechSeedBlockedByGrass || undefined,
    setSubstitute: substituteSetFailed ? undefined : effectiveMove.setsSubstitute,
    substituteSetFailed,
    shedTailSucceeded: shedTailSucceeded || undefined,
    shedTailFailed: shedTailFailed || undefined,
    setDisabledMoveName,
    disableSetFailed,
    setEncoreMoveName,
    encoreSetFailed,
    swappedStatsMoveName,
    swappedStagesMoveName,
    averagedDefensesMoveName,
    swappedSpeedMoveName,
    swappedItems,
    itemSwapFailed: itemSwapFailed || undefined,
    painSplitHp,
    stockpileHealFailed: stockpileHealFailed || undefined,
    recycledItemName,
    recycleFailed: recycleFailed || undefined,
    copiedStagesFromName,
    averagedAttacksMoveName,
    spitePp,
    spiteFailed: spiteFailed || undefined,
    acupressureRaised,
    acupressureFailed: acupressureFailed || undefined,
    volatileBlockedByAbility,
    abilityChange,
    abilityChangeFailed: abilityChangeFailed || undefined,
    copiedTypes,
    smackedDownTarget: smackedDownTarget || undefined,
    meltedItemName,
    partyStatusCuredCount: partyStatusCuredCount || undefined,
    teaTime,
    teaTimeFailed: teaTimeFailed || undefined,
    meltFailed: meltFailed || undefined,
    magneticFluxFailed: magneticFluxFailed || undefined,
    fairyLockSet: fairyLockSet || undefined,
    fairyLockFailed: fairyLockFailed || undefined,
    healingWishSet: healingWishSet || undefined,
    healingWishFailed: healingWishFailed || undefined,
    shellSideArmCategory,
    transformedIntoName,
    transformFailed: transformFailed || undefined,
    sheerForceAbilityName,
    substituteBroke,
    hitSubstitute,
    hitNegatedByAbilityName,
    disguiseRecoilDamage,
    illusionBrokenSpeciesId,
    triggeredDestinyBond: destinyBondTriggered || undefined,
    protectSucceeded,
    protectFailed,
    selfStatRises: selfStatRises.length ? selfStatRises : undefined,
    selfStatsAtMax: selfStatsAtMax.length ? selfStatsAtMax : undefined,
    selfStatDrops: selfStatDrops.length ? selfStatDrops : undefined,
    blockedByProtectMoveName,
    enduredProtectMoveName,
    protectContactPenaltyMoveName,
    protectContactDamage: protectContactDamage || undefined,
    followUpHitDamage: followUpHitDamage || undefined,
    pressureExtraPpAbilityName,
    statusCureBerryItemName,
    attackerBerryHealAmount: attackerBerryHealAmount || undefined,
    attackerBerryHealItemName,
    defenderBerryHealAmount: defenderBerryHealAmount || undefined,
    defenderBerryHealItemName,
    abilityInflictedStatusOnAttacker,
    abilityInflictedStatusAbilityName,
    abilityInflictedVolatileOnAttacker,
    abilityInflictedVolatileAbilityName,
    abilityDamageToAttacker: abilityDamageToAttacker || undefined,
    abilityDamageAbilityName,
    rockyHelmetDamage: rockyHelmetDamage || undefined,
    rockyHelmetItemName,
    abilityDisabledMoveName,
    abilityDisableAbilityName,
    pickpocketStolenItemName,
    pickpocketAbilityName,
    mummifiedAttackerAbilityName,
    abilityRaisedDefenderStatsAbilityName,
    abilityRaisedDefenderStats: abilityRaisedDefenderStats.length ? abilityRaisedDefenderStats : undefined,
    abilityLoweredDefenderStats: abilityLoweredDefenderStats.length ? abilityLoweredDefenderStats : undefined,
    abilityAbsorbedMoveType,
    abilityAbsorbAbilityName,
    soundproofBlockedByAbilityName,
    bulletproofBlockedByAbilityName,
    mentalMoveBlockedByAbilityName,
    // 황금몸은 명중 굴림과 무관하게 판정되므로, 실제로 빗나간 경우(§4-5)와 구분하려면
    // 여기서 hit까지 확인해야 한다 — 그래야 "빗나갔다"와 "막혔다"가 서로 다른 로그로 나뉜다.
    goodAsGoldBlockedByAbilityName: blockedByGoodAsGold && hit ? defenderAbility?.name : undefined,
    invertedTargetStages: invertedTargetStages || undefined,
    addedTypeToTarget,
    targetMoveTypeOverride,
    abilityLoweredAttackerStatsAbilityName,
    abilityLoweredAttackerStats: abilityLoweredAttackerStats.length ? abilityLoweredAttackerStats : undefined,
    cheekPouchHeal: cheekPouchHeal || undefined,
    beakBlastBurnedAttacker: beakBlastBurnedAttacker || undefined,
    protectContactInflictedStatus,
    angerPointRaisedSpa: angerPointRaisedSpa || undefined,
    angerPointAbilityName,
    soulBeatHpCost: soulBeatHpCost || undefined,
    soulBeatFailed: costHpFailed || undefined,
    wanderingSpiritSwapped: wanderingSpiritSwapped || undefined,
    sandSpitWeather,
    seedSowerField,
    overwroteTargetType,
    abilityAbsorbHealAmount: abilityAbsorbHealAmount || undefined,
    resetAllStages: effectiveMove.resetsAllStages || undefined,
    stolenItemName,
    unburdenSelfAbilityName,
    unburdenOpponentAbilityName,
    sleepTalkCalledMoveName,
    copycatCalledMoveName,
    ohkoBlockedByAbilityName,
    flungItemName: flungItem?.name,
    flingEffect,
    ohkoImmune: ohkoImmune || undefined,
    changedOwnTypeTo,
    changedOwnTypeAbilityName,
    ateGemItemName,
    balloonPoppedItemName,
    opportunistCopiedStats,
    opportunistAbilityName,
    electromorphosisEmpoweredAbilityName,
    fickleBeamEmpowered: fickleBeamEmpowered || undefined,
    tidyUpDone: tidyUpDone || undefined,
    saltCureApplied: saltCureApplied || undefined,
    lostTypeAfterUse,
    glaiveRushArmed: effectiveMove.glaiveRush || undefined,
    courtChangeDone: courtChangeDone || undefined,
    revivedPartyName,
    reviveFailed: reviveFailed || undefined,
    octolockApplied: octolockApplied || undefined,
    jawLockApplied: jawLockApplied || undefined,
    triggersDefenderEmergencyExit: triggersDefenderEmergencyExit || undefined,
    emergencyExitAbilityName: triggersDefenderEmergencyExit ? origDefenderAbility!.name : undefined,
  };
}

