import { computeTurnOrderSpeed, effectiveHeldItem, itemsSuppressedByRoom } from "./turnOrderInputs";
import { isGrounded } from "./grounding";
import { type EndOfTurnLogEntry, type FighterKey } from "@/types/battle";
import { BATTLE_STAT_KEYS, type BattleStatKey } from "@/types/battleStats";
import { NO_STATUS_CONDITION } from "@/types/status";
import { type Ability } from "@/types/ability";
import { type Item } from "@/types/item";
import { getAbility, getItem, getMove } from "@/lib/data";
import { applyStageDelta } from "@/lib/statStages";
import { advanceStatusTurn, computeStatusEndOfTurnDamage, inflictStatus } from "@/lib/statusConditions";
import { consumeVolatileTurn, hasVolatile } from "@/lib/volatileConditions";
import { rivalryDamageMultiplier } from "@/lib/battlePower";
import { resolveMoveContext } from "@/lib/moveContext";
import { computeFieldEndOfTurnHeal } from "@/lib/fieldEffects";
import { calmRampageIfAsleep } from "./rampage";
import { getHpThresholdBerryHeal, healWithBigRoot } from "@/lib/itemEffects";
import { NO_STATUS_SELF_CURE_ABILITY_NAMES, SANDSTORM_IMMUNE_ABILITY_NAMES, abilityOf, activeWeather, applyForecastForm, consumeItem, contraryDelta, hasLivingReserve, isFainted, isForcedSwitchBlocked, isSideWiped, opponentKey, sideOf, statDropBlockStatsOf, type BattleFighterState, type BattleState, applyOwnStatDropReaction, countLoweredStats } from "./state";
import { statusBlockReason } from "./statusBlock";
import { type RunTurnContext, type RunTurnOutcome } from "./runTurn";
import { actionFailed } from "./moveFailure";
import { computeBattleHitChance } from "./hitChance";
import { resolveHitAndApplyDamage } from "./hitResolution";
import { forceRandomSwitch } from "./switching";
import { type ActionLogEntry, type MegaEvolutionLogEntry, type SwitchLogEntry } from "@/types/battle";

interface EndOfTurnFighterContext {
  state: BattleState;
  key: FighterKey;
  fighter: BattleFighterState;
  fighterAbility: Ability | undefined;
  fighterItem: Item | undefined;
  fighterBerriesBlocked: boolean;
  random: () => number;
  endOfTurn: EndOfTurnLogEntry[];
  /** 이번 턴에 상대 활성이 쓰러져 자리가 비었는지 — 상대에게 매인 효과(씨뿌리기 흡수·조이기·문어굳히기)는 발동하지 않는다 */
  opponentFainted: boolean;
  /** 미래예지 적중 반응(위기회피·레드카드) 기록 — 교체는 턴 종료 효과가 끝난 뒤 settleFutureSightReactions가 한다 */
  pending: PendingReactions;
}

/** 미래예지 적중으로 발동한 방어측(대상) 반응. 키 = 대상 쪽. exit: 위기회피가 발동했다 / redCard: 소모한 레드카드 이름(사용자 = 상대 편을 끌어낸다) */
interface PendingReactions {
  exit: Partial<Record<FighterKey, true>>;
  redCard: Partial<Record<FighterKey, string>>;
}

/**
 * 멸망의노래 카운트(F-4): 매 턴 종료 시 현재 카운트를 로그로 찍고 1 줄인다. 0에서 다음
 * 감소 시점에 HP가 0이 된다("3턴 후 기절" = 건 턴 포함 4번째 턴 종료). 쓰러진 포켓몬은 나머지 효과를 건너뛰고(실행기가 처리),
 * 전멸 판정은 order 24 그룹이 끝난 뒤 한 번이다(`deferWipe`).
 */
function applyPerishSongCountdown(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, endOfTurn } = ctx;
  if (fighter.perishCount === undefined || isFainted(fighter)) return;
  if (fighter.perishCount <= 0) {
    fighter.currentHp = 0;
    endOfTurn.push({ actor: key, damage: 0, remainingHp: 0, fainted: true, perishFainted: true });
    return;
  }
  endOfTurn.push({
    actor: key,
    damage: 0,
    remainingHp: fighter.currentHp,
    fainted: false,
    perishCount: fighter.perishCount,
  });
  fighter.perishCount -= 1;
}

/** 그래스필드: 매 턴 종료 시 최대 HP 1/16 회복 */
function applyFieldEndOfTurnHeal(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, endOfTurn } = ctx;
  // 트랙 M4: 그래스필드 회복은 땅에 있는 포켓몬만
  const fieldHeal = isGrounded(state, fighter) && !hasVolatile(fighter.volatile, "healBlock") ? computeFieldEndOfTurnHeal(state.field, fighter.maxHp) : 0;
  if (fieldHeal > 0) {
    fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + fieldHeal);
    endOfTurn.push({ actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, fieldHeal });
  }
}

/** 먹다남은음식: 턴 종료 시 항상(생존해 있으면) 최대 HP의 1/6 회복 */
function applyLeftoversHeal(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterItem, endOfTurn } = ctx;
  if (!fighterItem?.endOfTurnHealDenominator || hasVolatile(fighter.volatile, "healBlock")) return;
  const itemHeal = Math.min(
    fighter.maxHp - fighter.currentHp,
    Math.floor(fighter.maxHp / fighterItem.endOfTurnHealDenominator),
  );
  if (itemHeal > 0) {
    fighter.currentHp += itemHeal;
    endOfTurn.push({
      actor: key,
      damage: 0,
      remainingHp: fighter.currentHp,
      fainted: false,
      itemHeal,
      itemHealItemName: fighterItem.name,
    });
  }
}

/**
 * 젖은접시: 이 특성을 지닌 쪽은 날씨가 조건과 일치하는 동안 매 턴 종료 시 최대 HP의
 * 1/denominator 회복. 먹다남은음식과 별개 축이라 같은 턴에 둘 다 발동할 수 있다.
 */
function applyWeatherHealAbility(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, fighterAbility, endOfTurn } = ctx;
  const weatherHealBoost = fighterAbility?.weatherEndOfTurnHealDenominator;
  if (!weatherHealBoost || weatherHealBoost.weather !== activeWeather(state) || hasVolatile(fighter.volatile, "healBlock")) return;
  const abilityWeatherHeal = Math.min(
    fighter.maxHp - fighter.currentHp,
    Math.floor(fighter.maxHp / weatherHealBoost.denominator),
  );
  if (abilityWeatherHeal > 0) {
    fighter.currentHp += abilityWeatherHeal;
    endOfTurn.push({
      actor: key,
      damage: 0,
      remainingHp: fighter.currentHp,
      fainted: false,
      abilityWeatherHeal,
      abilityWeatherHealAbilityName: fighterAbility!.name,
    });
  }
}

/**
 * 건조피부: 쾌청(강한 햇살)일 때 매 턴 종료 시 최대 HP의 1/8 피해. weatherEndOfTurnHealDenominator
 * (비 회복)와 반대 축이며, 한 특성이 날씨에 따라 회복/피해를 나눠 갖는다.
 */
function applyWeatherDamageAbility(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, fighterAbility, endOfTurn } = ctx;
  const weatherDamageBoost = fighterAbility?.weatherEndOfTurnDamageDenominator;
  if (
    !weatherDamageBoost ||
    weatherDamageBoost.weather !== activeWeather(state) ||
    isFainted(fighter) ||
    fighterAbility?.negatesIndirectDamage
  ) {
    return;
  }
  const dmg = Math.min(fighter.currentHp, Math.floor(fighter.maxHp / weatherDamageBoost.denominator));
  if (dmg > 0) {
    fighter.currentHp -= dmg;
    endOfTurn.push({
      actor: key,
      damage: dmg,
      remainingHp: fighter.currentHp,
      fainted: isFainted(fighter),
      abilityWeatherDamage: dmg,
      abilityWeatherDamageAbilityName: fighterAbility!.name,
    });
  }
}

/**
 * 아쿠아링(order 6)·뿌리박기(order 7): 걸려 있는 동안 각각 매 턴 종료 시 최대 HP 1/16 회복 — 둘 다 걸려 있으면 두 번(8.3 D3-fix-32, Showdown).
 * 큰뿌리는 각 회복에 `healWithBigRoot`로 적용한다. order가 달라(6·7) 핸들러 둘로 나눈다(8.3 D3-fix-34).
 */
function applyRegenHeal(ctx: EndOfTurnFighterContext, regenSource: "aquaRing" | "ingrain"): void {
  const { key, fighter, fighterItem, endOfTurn } = ctx;
  if (!hasVolatile(fighter.volatile, regenSource) || hasVolatile(fighter.volatile, "healBlock")) return;
  const regenHeal = Math.min(fighter.maxHp - fighter.currentHp, healWithBigRoot(fighter.maxHp / 16, fighterItem));
  if (regenHeal > 0) {
    fighter.currentHp += regenHeal;
    endOfTurn.push({ actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, regenHeal, regenSource });
  }
}
const applyAquaRingHeal = (ctx: EndOfTurnFighterContext): void => applyRegenHeal(ctx, "aquaRing");
const applyIngrainHeal = (ctx: EndOfTurnFighterContext): void => applyRegenHeal(ctx, "ingrain");

/**
 * 씨뿌리기: 걸린 쪽은 매 턴 종료 시 최대 HP 1/8을 잃고, 상대가 그만큼(+상대의 큰뿌리 배율)
 * 회복한다. 상대가 이미 기절해 있으면(동시에 둘 다 씨앗이 걸린 극단적 경우 등) 회복은 스킵.
 * 매직가드: 걸린 쪽이 매직가드면 HP를 잃지 않고, 따라서 상대 회복도 없다(본가 규칙).
 */
function applyLeechSeedDamage(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, fighterAbility, endOfTurn } = ctx;
  // 씨를 뿌린 자리가 비었으면(이번 턴 기절, 교대 전) 흡수할 대상이 없어 발동하지 않는다
  if (!hasVolatile(fighter.volatile, "leechSeed") || fighterAbility?.negatesIndirectDamage || ctx.opponentFainted) return;
  const seedDamage = Math.min(fighter.currentHp, Math.floor(fighter.maxHp / 8));
  fighter.currentHp -= seedDamage;
  endOfTurn.push({
    actor: key,
    damage: 0,
    remainingHp: fighter.currentHp,
    fainted: isFainted(fighter),
    leechSeedDamage: seedDamage,
  });
  const healer = state[opponentKey(key)];
  if (seedDamage > 0 && !isFainted(healer) && !hasVolatile(healer.volatile, "healBlock")) {
    if (fighterAbility?.reverseDrainHealsToDamage) {
      // 해감액: 씨뿌리기로 빨아들이려던 상대가 회복 대신 같은 양의 데미지를 입는다.
      const oozeDmg = Math.min(healer.currentHp, seedDamage);
      healer.currentHp -= oozeDmg;
      endOfTurn.push({
        actor: opponentKey(key),
        damage: oozeDmg,
        remainingHp: healer.currentHp,
        fainted: isFainted(healer),
        liquidOozeDamage: true,
      });
    } else {
      const healerAbilityForItem = healer.effectiveAbilityId ? getAbility(healer.effectiveAbilityId) : undefined;
      const healerItem = healerAbilityForItem?.disablesOwnItemEffects || itemsSuppressedByRoom(state)
        ? undefined
        : healer.currentItemId
          ? getItem(healer.currentItemId)
          : undefined;
      const leechSeedHealAmount = Math.min(
        healer.maxHp - healer.currentHp,
        healWithBigRoot(seedDamage, healerItem),
      );
      if (leechSeedHealAmount > 0) {
        healer.currentHp += leechSeedHealAmount;
        endOfTurn.push({
          actor: opponentKey(key),
          damage: 0,
          remainingHp: healer.currentHp,
          fainted: false,
          leechSeedHealAmount,
        });
      }
    }
  }
}

/**
 * 미래예지(8.3 A4, Showdown futuremove): 예약 카운터가 0이 되는 턴 종료에 이 자리의 활성 포켓몬을 정상 피격 파이프라인으로 때린다.
 * 사용자는 상대 편 party[sourceIndex] — 필드에 없거나 기절했으면 특성·도구는 적용하지 않고(능력치·타입은 그 포켓몬의 현재 값, 랭크는 교체로 초기화),
 * 방어는 무시하지만(blockedByProtect=false) 버티기는 그대로 적용된다. 명중·무적 은신 판정, 급소, 대타 흡수를 일반 공격처럼 거친다.
 * delayedHit로 사용자 측 후 효과(반동·흡수·조개껍질방울·길동무·저주받은바디)는 끄고, 생명의구슬 반동·자기과신류는 여기서 직접 처리한다.
 */
function applyFutureSight(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, random, endOfTurn } = ctx;
  const side = sideOf(state, key);
  const queued = side.futureSight;
  if (!queued) return;
  queued.turnsRemaining -= 1;
  if (queued.turnsRemaining > 0) return;
  side.futureSight = undefined;
  if (isFainted(fighter)) return;
  const srcKey = opponentKey(key);
  const srcSide = sideOf(state, srcKey);
  const src = srcSide.party[queued.sourceIndex];
  const onField = srcSide.activeIndex === queued.sourceIndex && !isFainted(src); // 교체됐다가 적중 전에 다시 나왔으면 필드에 있음
  const move = queued.move;
  const attackerAbility = onField ? abilityOf(src) : undefined;
  const attackerItem = onField ? effectiveHeldItem(src, state) : undefined;
  const defenderAbility = abilityOf(fighter); // 틀깨기 미적용: useMove를 거치지 않아 ModifyMove가 돌지 않는다
  const defenderItem = effectiveHeldItem(fighter, state);
  const hpBefore = fighter.currentHp;
  let landedOnBody = false; // 적중이 본체에 닿았는가(빗나감·무효·대타 적중 제외) — 레드카드 판정
  let draggedOut = false; // 레드카드가 사용자를 끌어낼 예정이면 생명의구슬 반동이 없다(Showdown lifeorb `!source.forceSwitchFlag`)
  // ponytail: 에스퍼 전용이라 흡수 특성(마중물류) 판정은 생략 — 타입이 다른 지연 공격기가 생기면 preHitEffects의 흡수 판정을 뽑아 재사용
  // ponytail: 노멀스킨은 보유 종이 없어 생략(미래예지 26종 중 0종) — 생기면 onEnd처럼 type만 노말로 바꾼다(×1.2 없음)
  const mc = resolveMoveContext(attackerAbility, move, fighter.types, defenderAbility, {
    weather: activeWeather(state),
    defenderItem,
    defenderGrounded: isGrounded(state, fighter, defenderAbility),
    attackerHpFraction: src.currentHp / src.maxHp,
    defenderHpIsFull: fighter.currentHp === fighter.maxHp,
    defenderHasStatusCondition: fighter.status.condition !== null,
    field: state.field,
  });
  // rollHit(preHitEffects)과 같은 판정: 무적 은신(공중날기 등) 중이면 빗나가고, 아니면 명중·회피 랭크로 굴린다
  const hideType = fighter.chargingMoveId ? getMove(fighter.chargingMoveId)?.chargeHideType : undefined;
  const hitChance = computeBattleHitChance({
    state, attacker: src, defender: fighter, move: mc.effectiveMove, hustleCategory: move.category,
    attackerAbility, defenderAbility, attackerItem, defenderItem, attackerMovesSecond: false,
  });
  const missed = !!hideType || (hitChance !== null && random() >= hitChance);
  const entry: EndOfTurnLogEntry = { actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, futureSightMoveName: move.name };
  endOfTurn.push(entry);
  if (missed) entry.futureSightMiss = true;
  else if (mc.typeEffectiveness === 0) entry.futureSightImmune = true;
  else {
    const res = resolveHitAndApplyDamage({
      state, defenderKey: key, move, effectiveMove: mc.effectiveMove, random, attacker: src, defender: fighter,
      attackerAbility, defenderAbility, attackerItem, defenderItem, typeEffectiveness: mc.typeEffectiveness,
      blockedByProtect: false, // 방어류는 이 플래그로 무시된다(activeProtect는 비우지 않는다 — 버티기는 그대로 발동)
      blockedBySubstitute: fighter.substituteHp !== undefined && !attackerAbility?.bypassesScreensAndSubstitute,
      unseenFistPiercing: false, hitChance, perHitChance: hitChance, evadedByCharge: false, defenderHideType: undefined,
      gemMultiplier: 1,
      ownMoveTypeBoostMultiplier: (mc.effectiveMove.type ? src.ownMoveTypeBoosts[mc.effectiveMove.type] : undefined) ?? 1,
      rivalryMultiplier: rivalryDamageMultiplier(attackerAbility, src.gender, fighter.gender),
      sheerForceAbilityName: undefined,
      defenderBerriesBlocked: !!attackerAbility?.preventsOpponentBerries,
      abilityOffenseMultiplier: mc.abilityOffenseMultiplier,
      statOffenseMultiplier: mc.statOffenseMultiplier,
      abilityDefenseMultiplier: mc.abilityDefenseMultiplier,
      finalDefenseMultiplier: mc.finalDefenseMultiplier,
      stabMultiplier: mc.stabMultiplier,
      delayedHit: true,
    });
    entry.damage = hpBefore - fighter.currentHp; // 본체가 실제로 잃은 HP (대타가 맞으면 0)
    entry.remainingHp = fighter.currentHp;
    entry.fainted = isFainted(fighter);
    if (res.isCritical) entry.futureSightCritical = true;
    if (res.hitSubstitute) entry.futureSightSubstitute = res.substituteBroke ? "broke" : "hit";
    landedOnBody = !res.hitSubstitute;
    // 위기회피(8.3 A4-b): 정상 공격(resolveAction)과 같은 조건 — HP가 절반 초과 → 이하(0 초과). 대타가 맞으면 본체 HP가 안 변해 미발동.
    // 교체 요구는 턴 종료 효과가 끝난 뒤 settleFutureSightReactions가 확정한다(도망봉인·뿌리박기여도 발동, HP는 다시 보지 않는다).
    if (defenderAbility?.exitsFieldAtHalfHp && hasLivingReserve(sideOf(state, key)) && fighter.currentHp > 0 && hpBefore * 2 > fighter.maxHp && fighter.currentHp * 2 <= fighter.maxHp) {
      ctx.pending.exit[key] = true;
      entry.futureSightExitAbilityName = defenderAbility.name;
    }
    // 쓰러뜨린 뒤 발동하는 특성(onSourceAfterFaint)은 필드에 있을 때 유지된다 — resolveAction.applyKnockoutAbilities와 같은 규칙
    if (onField && res.damage > 0 && entry.fainted) {
      if (attackerAbility?.boostsStatOnKo) src.stages = applyStageDelta(src.stages, attackerAbility.boostsStatOnKo.stat, contraryDelta(src, attackerAbility.boostsStatOnKo.delta));
      if (attackerAbility?.boostsHighestStatOnKo) {
        const highest = BATTLE_STAT_KEYS.reduce((a, b) => (src.realStats[b] > src.realStats[a] ? b : a));
        src.stages = applyStageDelta(src.stages, highest, contraryDelta(src, 1));
      }
    }
  }
  // 레드카드(8.3 A4-b): 사용자가 필드에 있고 적중이 본체에 닿았으면(빗나감·무효·대타 적중 제외 — 위 분기를 지난 경우만, 탈이 벗겨지는 적중 포함)
  // 맞는 순간 카드를 소모한다. 사용자 편에 살아 있는 예비가 없으면 소모하지 않는다. 교체는 settleFutureSightReactions에서(뿌리박기·흡반이면 카드만 소모).
  if (onField && landedOnBody && !isFainted(fighter) && defenderItem?.forcesAttackerSwitchOnHit && hasLivingReserve(srcSide)) {
    ctx.pending.redCard[key] = defenderItem.name;
    entry.futureSightRedCardItemName = defenderItem.name;
    consumeItem(fighter);
    draggedOut = !isForcedSwitchBlocked(src);
  }
  // 생명의구슬 반동: onEnd가 결과를 보지 않고 부르므로 빗나감·무효·대타 적중에도 생긴다(대상이 적중 전에 기절했으면 위에서 이미 반환).
  // 단 레드카드로 끌려 나갈 예정이면 없다 — 뿌리박기·흡반으로 교체가 막히면 카드는 소모되고 반동은 받는다.
  if (onField && !draggedOut && attackerItem?.selfRecoilFractionOfMaxHp && !attackerAbility?.negatesIndirectDamage) {
    const recoil = Math.min(src.currentHp, Math.floor(src.maxHp * attackerItem.selfRecoilFractionOfMaxHp));
    src.currentHp -= recoil;
    endOfTurn.push({ actor: srcKey, damage: recoil, remainingHp: src.currentHp, fainted: isFainted(src), itemRecoilItemName: attackerItem.name });
  }
}

/**
 * 도발·앙코르·사슬묶기·회복봉인·지옥찌르기: 턴 종료마다 카운터가 줄어 0에서 해제된다(걸린 턴·못 움직인 턴도 1턴으로 센다).
 * 도발·앙코르·사슬묶기는 8.3 D3-fix-20부터 행동 시가 아니라 여기서 줄인다(Showdown residual 15·16·17 — 회복봉인 20·지옥찌르기 22보다 앞).
 * 이 턴 종료 회복 판정 뒤에 부른다
 */
function tickBlockVolatiles(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, endOfTurn } = ctx;
  const healBlockWasActive = hasVolatile(fighter.volatile, "healBlock");
  for (const v of ["taunt", "encore", "disable", "healBlock", "throatChop"] as const) {
    if (hasVolatile(fighter.volatile, v)) fighter.volatile = consumeVolatileTurn(fighter.volatile, v);
  }
  // 회복봉인이 풀렸으면 줄을 남긴다(8.3 A3). 지옥찌르기는 Showdown도 시작·해제 모두 표시가 없어 남기지 않는다.
  if (healBlockWasActive && !hasVolatile(fighter.volatile, "healBlock")) {
    endOfTurn.push({ actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, volatileEnded: "healBlock" });
  }
}

/** 저주(curse): 걸린 쪽은 매 턴 종료 시 최대 HP 1/4을 잃는다. 매직가드면 면제(leechSeed 패턴). */
function applyCurseDamage(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterAbility, endOfTurn } = ctx;
  if (!hasVolatile(fighter.volatile, "curse") || fighterAbility?.negatesIndirectDamage) return;
  const curseDamage = Math.min(fighter.currentHp, Math.floor(fighter.maxHp / 4));
  fighter.currentHp -= curseDamage;
  endOfTurn.push({ actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: isFainted(fighter), curseDamage });
}

/**
 * 속박(bound): 조이기·엉겨붙기·집게덫류에 걸린 쪽은 매 턴 종료 시 최대 HP 1/8을 잃는다.
 * Showdown 순서(8.3 D3-fix-21): 턴 종료마다 카운터를 먼저 1 줄이고, 0이 되면 피해 없이 해제 — 지속 N이면 피해·가둠 N−1번.
 * 매직가드면 데미지 면제(카운터는 진행).
 */
function applyBoundDamage(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, fighterAbility, endOfTurn } = ctx;
  if (!hasVolatile(fighter.volatile, "bound")) return;
  // 조인 쪽이 쓰러지면 조이기가 풀린다(데미지 없음)
  if (ctx.opponentFainted) {
    const { bound: _released, ...rest } = fighter.volatile.active;
    fighter.volatile = { ...fighter.volatile, active: rest };
    return;
  }
  fighter.volatile = consumeVolatileTurn(fighter.volatile, "bound");
  if (!hasVolatile(fighter.volatile, "bound")) return; // 마지막 틱: 피해 없이 해제
  if (!fighterAbility?.negatesIndirectDamage) {
    // 조임밴드: 속박을 건 쪽(상대)이 이 도구를 지녔으면 1/8 대신 1/6로 데미지가 늘어난다.
    const binder = state[opponentKey(key)];
    const binderAbility = binder.effectiveAbilityId ? getAbility(binder.effectiveAbilityId) : undefined;
    const binderItem = binderAbility?.disablesOwnItemEffects || itemsSuppressedByRoom(state)
      ? undefined
      : binder.currentItemId
        ? getItem(binder.currentItemId)
        : undefined;
    const bindDenom = binderItem?.bindDamageDenominator ?? 8;
    const bindDamage = Math.min(fighter.currentHp, Math.floor(fighter.maxHp / bindDenom));
    fighter.currentHp -= bindDamage;
    if (bindDamage > 0) {
      endOfTurn.push({
        actor: key,
        damage: bindDamage,
        remainingHp: fighter.currentHp,
        fainted: isFainted(fighter),
        boundDamage: true,
      });
    }
  }
}

/**
 * 소금절이(saltCure): 걸린 쪽은 매 턴 종료 시 최대 HP 1/16(강철/물 타입이면 1/8)을 잃는다.
 * 턴 카운터 없이 배틀 끝까지 유지된다(leechSeed 패턴). 매직가드면 데미지 면제.
 */
function applySaltCureDamage(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterAbility, endOfTurn } = ctx;
  if (!hasVolatile(fighter.volatile, "saltCure") || fighterAbility?.negatesIndirectDamage) return;
  const heavy = fighter.types.some((t) => t === "강철" || t === "물");
  const saltDamage = Math.min(fighter.currentHp, Math.floor(fighter.maxHp / (heavy ? 8 : 16)));
  if (saltDamage > 0) {
    fighter.currentHp -= saltDamage;
    endOfTurn.push({
      actor: key,
      damage: saltDamage,
      remainingHp: fighter.currentHp,
      fainted: isFainted(fighter),
      saltCureDamage: true,
      saltCureHeavy: heavy || undefined,
    });
  }
}

/**
 * 물엿범벅(syrupCoat, 시럽봄): 걸린 쪽은 매 턴 종료 시 스피드 1랭크 감소(심술꾸러기·클리어바디류
 * 존중). 3턴 카운터로 소모되고 0에서 자동 해제된다.
 */
function applySyrupCoatDrop(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterAbility, endOfTurn } = ctx;
  if (!hasVolatile(fighter.volatile, "syrupCoat") || isFainted(fighter)) return;
  const before = fighter.stages.spe;
  const stagesBefore = fighter.stages;
  // 물엿범벅은 상대(시럽봄 사용자)가 거는 하락 — 클리어바디류/하얀연기가 spe를 막으면 무산.
  if (!statDropBlockStatsOf(fighter, fighterAbility)?.includes("spe")) {
    fighter.stages = applyStageDelta(fighter.stages, "spe", contraryDelta(fighter, -1));
  }
  // 오기·승기(8.3 D3-fix-52): 턴 끝 지속 하락도 상대가 낸 하락이다(Showdown `boost(…, source)`) — 랭크만 올리고 문구는 내지 않는다(기술 경로도 문구가 없어 일관, E8-48 별도).
  applyOwnStatDropReaction(fighter, fighterAbility, countLoweredStats(stagesBefore, fighter.stages));
  if (fighter.stages.spe !== before) {
    endOfTurn.push({ actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, syrupCoatDrop: true });
  }
  fighter.volatile = consumeVolatileTurn(fighter.volatile, "syrupCoat");
}

/**
 * 문어굳히기(octolock): 걸린 쪽은 매 턴 종료 시 방어·특수방어가 1랭크씩 떨어진다(클리어바디류
 * 존중). 턴 카운터 없이 배틀 끝까지 유지 — 해제는 문어굳히기를 건 쪽이 자리를 비울 때만
 * (performSwitch). syrupCoat와 달리 소모 호출 없음.
 */
function applyOctolockDrop(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterAbility, endOfTurn } = ctx;
  // 문어굳히기를 건 쪽이 쓰러졌으면 발동하지 않는다(교대 시 풀림 — switching.ts)
  if (!hasVolatile(fighter.volatile, "octolock") || isFainted(fighter) || ctx.opponentFainted) return;
  const blockedStats = statDropBlockStatsOf(fighter, fighterAbility);
  let octolockDropped = false;
  const stagesBefore = fighter.stages;
  for (const stat of ["def", "spd"] as const) {
    if (blockedStats?.includes(stat)) continue;
    const before = fighter.stages[stat];
    fighter.stages = applyStageDelta(fighter.stages, stat, contraryDelta(fighter, -1));
    if (fighter.stages[stat] !== before) octolockDropped = true;
  }
  // 오기·승기(8.3 D3-fix-52): 능력치마다 1회 — 방어·특수방어가 둘 다 내려가면 2회(문구는 내지 않음, 위 시럽봄과 같다)
  applyOwnStatDropReaction(fighter, fighterAbility, countLoweredStats(stagesBefore, fighter.stages));
  if (octolockDropped) {
    endOfTurn.push({ actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, octolockDrop: true });
  }
}

/**
 * 희망사항(§6-2): 편(BattleSide.wish) 큐를 카운트다운한다 — 쓴 다음 턴 종료에, 그 시점에
 * "그 자리에 있는 포켓몬"(=현재 활성 fighter)이 시전자 최대 HP 절반만큼 회복한다. 시전 후
 * 교체했으면 새로 나온 포켓몬이 받는다.
 */
function applyWishHeal(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, endOfTurn } = ctx;
  const wishQueue = sideOf(state, key).wish;
  if (!wishQueue) return;
  const triggersNow = wishQueue.turnsRemaining <= 1;
  wishQueue.turnsRemaining -= 1;
  if (triggersNow) {
    if (!isFainted(fighter)) {
      const wishHeal = hasVolatile(fighter.volatile, "healBlock") ? 0 : Math.min(fighter.maxHp - fighter.currentHp, wishQueue.healAmount);
      fighter.currentHp += wishHeal;
      // 회복이 0(HP 가득·회복봉인)이어도 줄을 남긴다(사용자 확정 2026-11-10) — 쓰러진 자리는 남기지 않는다
      endOfTurn.push(
        wishHeal > 0
          ? { actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, wishHeal }
          : { actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, wishNoHeal: true },
      );
    }
    sideOf(state, key).wish = undefined;
  }
}

/**
 * 하품(졸음): 2턴 카운터가 1(=이번이 마지막 소모)이면 이번 턴 종료에 실제로 잠듦을 시도한다.
 * 그 사이 다른 상태이상이 걸렸거나 타입/필드로 잠듦 면역이 생겼으면 조용히 무산된다(본가 규칙).
 */
function applyDrowsySleepOnset(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, fighterAbility, endOfTurn } = ctx;
  const drowsyEntry = fighter.volatile.active.drowsy;
  if (!drowsyEntry) return;
  const triggersNow = drowsyEntry.turnsRemaining <= 1;
  fighter.volatile = consumeVolatileTurn(fighter.volatile, "drowsy");
  // 신비의부적은 하품 사용 시에만 막는다 — 하품을 건 뒤 설치해도 잠든다(Showdown `safeguard`가 `yawn`이면 통과, 8.3 D3-fix-46 R3). 면역·필드·소란은 여기서 조용히 무산시킨다.
  if (triggersNow && !fighter.status.condition && !statusBlockReason(state, key, fighter, fighterAbility, "sleep", { skipSafeguard: true })) {
    fighter.status = inflictStatus(fighter.status, "sleep");
    endOfTurn.push({
      actor: key,
      damage: 0,
      remainingHp: fighter.currentHp,
      fainted: false,
      inflictedDelayedStatus: "sleep",
    });
  }
}

/**
 * 모래바람 틱 데미지(§1 F-3): 바위/땅/강철 타입이 아니면 매 턴 종료 시 최대 HP 1/16.
 * 매직가드·모래 관련 특성(모래숨기/모래의힘/모래헤치기)·방진 보유 시 면제(`SANDSTORM_IMMUNE_ABILITY_NAMES`, 모래날림은 면역이 아니다 — 8.3 D3-fix-27).
 * (방진고글 도구는 포챔스에 없어 제외. 싸라기눈 틱도 없음.)
 */
function applySandstormDamage(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, fighterAbility, endOfTurn } = ctx;
  if (
    activeWeather(state) !== "모래바람" ||
    isFainted(fighter) ||
    fighter.types.some((t) => t === "바위" || t === "땅" || t === "강철") ||
    fighterAbility?.negatesIndirectDamage ||
    SANDSTORM_IMMUNE_ABILITY_NAMES.has(fighterAbility?.name ?? "")
  ) {
    return;
  }
  const sandDamage = Math.min(fighter.currentHp, Math.floor(fighter.maxHp / 16));
  fighter.currentHp -= sandDamage;
  if (sandDamage > 0) {
    endOfTurn.push({
      actor: key,
      damage: sandDamage,
      remainingHp: fighter.currentHp,
      fainted: isFainted(fighter),
      sandstormDamage: true,
    });
  }
}

/**
 * 상태이상 매턴 데미지/포이즌힐. 포이즌힐: 독·맹독 상태면 지속 데미지 대신 최대 HP의
 * 1/denominator를 회복한다(맹독 카운터는 그대로 누적). 그 외엔 매직가드로 독/맹독/화상
 * 데미지만 0으로 막고(상태 자체·맹독 카운터는 그대로 진행), 내열이면 화상 데미지 절반(내림).
 */
function applyStatusEndOfTurnTick(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterAbility, endOfTurn } = ctx;
  if (!fighter.status.condition) return;
  const statusCondition = fighter.status.condition;
  const poisonHealDenom = fighterAbility?.healsFromPoisonEachTurnDenominator;
  if (
    poisonHealDenom &&
    (statusCondition === "poison" || statusCondition === "badly-poisoned") &&
    !isFainted(fighter)
  ) {
    const heal = hasVolatile(fighter.volatile, "healBlock") ? 0 : Math.min(fighter.maxHp - fighter.currentHp, Math.floor(fighter.maxHp / poisonHealDenom));
    fighter.currentHp += heal;
    fighter.status = advanceStatusTurn(fighter.status);
    if (heal > 0) {
      endOfTurn.push({
        actor: key,
        damage: 0,
        remainingHp: fighter.currentHp,
        fainted: false,
        poisonHealAmount: heal,
        poisonHealAbilityName: fighterAbility!.name,
      });
    }
  } else {
    const rawStatusDamage = computeStatusEndOfTurnDamage(fighter.status, fighter.maxHp);
    const damage = fighterAbility?.negatesIndirectDamage
      ? 0
      : statusCondition === "burn" && fighterAbility?.halvesBurnDamage
        ? Math.floor(rawStatusDamage / 2)
        : rawStatusDamage;
    fighter.currentHp = Math.max(0, fighter.currentHp - damage);
    fighter.status = advanceStatusTurn(fighter.status);
    // 잠듦/얼음/마비는 매턴 데미지가 없다(항상 0) — "상태이상 데미지 0"만 찍는 무의미한 줄을
    // 막기 위해 실제로 데미지가 있을 때만 로그에 남긴다.
    if (damage > 0) {
      endOfTurn.push({
        actor: key,
        damage,
        remainingHp: fighter.currentHp,
        fainted: isFainted(fighter),
        statusCondition,
      });
    }
  }
}

/**
 * 탈피: 턴 종료 시점(=위 상태이상 데미지 틱까지 끝난 뒤)에 이 확률로 자신의 주 상태이상을
 * 치료한다. 이미 기절했으면 발동할 이유가 없다.
 */
function applyShedSkinCure(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, fighterAbility, random, endOfTurn } = ctx;
  // 촉촉바디(ver.1.9 A5): 지정 날씨면 확률 없이 치료
  const hydration = !!fighterAbility?.curesStatusInWeather && fighterAbility.curesStatusInWeather === activeWeather(state);
  if (!fighter.status.condition || (!fighterAbility?.curesOwnStatusChance && !hydration) || isFainted(fighter)) return;
  if (hydration || random() * 100 < fighterAbility!.curesOwnStatusChance!) {
    const abilityCuredStatus = fighter.status.condition;
    fighter.status = { ...NO_STATUS_CONDITION };
    endOfTurn.push({
      actor: key,
      damage: 0,
      remainingHp: fighter.currentHp,
      fainted: false,
      abilityCuredStatus,
      abilityCuredStatusAbilityName: fighterAbility.name,
    });
  }
}

/** 틀깨기 공격으로 걸린 상태이상을 턴 끝에 스스로 치료하는 특성에서 뺄 것 — 면역은 치료 없이 걸린 채 남는다(사용자 정리 2026-09-29) */
const NO_TURN_END_SELF_CURE_ABILITY_NAMES: ReadonlySet<string> = new Set(["면역"]);

/**
 * 상태이상 면역 특성의 자기 치료(ver.2.0 틀깨기 목록 수정, 사용자 정리): 틀깨기 공격측은 불면·유연·마그마의무장·수포·의기양양·
 * 열교환 등을 무시하고 상태이상을 걸 수 있지만, 걸린 턴이 끝나는 순간 특성이 발동해 치료한다. 마이페이스(혼란)·둔감(헤롱헤롱·
 * 도발)도 같은 축. 턴 종료 처리의 맨 앞 — 치료된 상태이상의 턴 끝 데미지는 받지 않는다. 면역은 치료 없음.
 */
function applyAbilityImmunityCure(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterAbility, endOfTurn } = ctx;
  if (!fighterAbility || isFainted(fighter) || NO_TURN_END_SELF_CURE_ABILITY_NAMES.has(fighterAbility.name) || NO_STATUS_SELF_CURE_ABILITY_NAMES.has(fighterAbility.name)) return;
  const condition = fighter.status.condition;
  const curedStatus = condition && fighterAbility.immuneToStatuses?.includes(condition) ? condition : undefined;
  if (curedStatus) fighter.status = { ...NO_STATUS_CONDITION };
  const active = { ...fighter.volatile.active };
  const curedVolatiles: ("confusion" | "attract" | "taunt")[] = [];
  if (fighterAbility.immuneToConfusion && active.confusion) {
    delete active.confusion;
    curedVolatiles.push("confusion");
  }
  if (fighterAbility.immuneToAttractAndTaunt) {
    for (const v of ["attract", "taunt"] as const) {
      if (active[v]) {
        delete active[v];
        curedVolatiles.push(v);
      }
    }
  }
  if (curedVolatiles.length > 0) fighter.volatile = { ...fighter.volatile, active };
  if (!curedStatus && curedVolatiles.length === 0) return;
  endOfTurn.push({
    actor: key,
    damage: 0,
    remainingHp: fighter.currentHp,
    fainted: false,
    abilityCuredStatus: curedStatus,
    abilityCuredStatusAbilityName: fighterAbility.name,
    abilityCuredVolatiles: curedVolatiles.length > 0 ? curedVolatiles : undefined,
  });
}

/**
 * 가속(Speed Boost): 매 턴 종료 시 스피드 1랭크 상승. 이번 턴 도중에 등장한 포켓몬(자발 교체·유턴류·
 * 강제 교체(드래곤테일·레드카드 등)·행동 전 기절 대체 포함)은 그 턴엔 발동하지 않는다 — Showdown
 * `activeTurns`가 등장 때 0이고 턴 시작에 +1이라 `onResidual`이 0이면 건너뛰는 것과 같다(8.3 D3-fix-51 E8-41).
 * enteredThisTurn은 performSwitch가 모든 등장에 세우고 runTurn이 턴 시작에 지운다. 턴과 턴 사이의 기절
 * 교체(applySwitch)는 다음 턴 시작에 지워지므로 다음 턴 끝부터 발동한다. 이번 턴 데미지로 방금
 * 쓰러졌으면(isFainted) 발동하지 않는다.
 */
function applySpeedBoostAbility(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterAbility, endOfTurn } = ctx;
  if (!fighterAbility?.boostsSpeedEachTurnEnd || isFainted(fighter) || fighter.enteredThisTurn) return;
  const speBefore = fighter.stages.spe;
  fighter.stages = applyStageDelta(fighter.stages, "spe", contraryDelta(fighter, 1));
  endOfTurn.push({
    actor: key,
    damage: 0,
    remainingHp: fighter.currentHp,
    fainted: false,
    speedBoostAbilityName: fighterAbility.name,
    speedBoostAtCap: fighter.stages.spe === speBefore || undefined,
  });
}

/** 꼬르륵스위치(모르페코): 매 턴 종료 시 배부른모양↔배고픈모양 토글(오라휠 타입에만 영향). */
function applyHungerSwitchToggle(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterAbility, endOfTurn } = ctx;
  if (!fighterAbility?.hungerSwitch || isFainted(fighter)) return;
  fighter.hungerMode = fighter.hungerMode === "hangry" ? "full" : "hangry";
  endOfTurn.push({
    actor: key,
    damage: 0,
    remainingHp: fighter.currentHp,
    fainted: false,
    hungerModeChangedTo: fighter.hungerMode,
  });
}

/**
 * 변덕쟁이(Moody): 매 턴 종료 시 랭크 < +6인 능력치 하나를 +2, 그와 다른 랭크 > −6인 능력치 하나를 −1(8.3 D3-fix-54 E8-45 — Showdown은 후보를 먼저 거른 뒤 뽑는다).
 * 후보가 비면 난수를 부르지 않는다. 올릴 후보가 비면 5종이 전부 +6이라 내릴 후보는 5종이므로 "둘 다 없음"은 도달 불가(방어 코드).
 */
function applyMoodyRandomStages(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterAbility, random, endOfTurn } = ctx;
  if (!fighterAbility?.moodyRandomStages || isFainted(fighter)) return;
  const pick = (pool: BattleStatKey[]) => (pool.length ? pool[Math.floor(random() * pool.length)] : undefined);
  const raised = pick(BATTLE_STAT_KEYS.filter((s) => fighter.stages[s] < 6));
  const lowered = pick(BATTLE_STAT_KEYS.filter((s) => s !== raised && fighter.stages[s] > -6));
  if (!raised && !lowered) return;
  if (raised) fighter.stages = applyStageDelta(fighter.stages, raised, contraryDelta(fighter, 2));
  if (lowered) fighter.stages = applyStageDelta(fighter.stages, lowered, contraryDelta(fighter, -1));
  endOfTurn.push({
    actor: key,
    damage: 0,
    remainingHp: fighter.currentHp,
    fainted: false,
    moodyRaisedStat: raised,
    moodyLoweredStat: lowered,
    moodyAbilityName: fighterAbility.name,
  });
}

/**
 * 자뭉열매/오랭열매: 턴 종료 시점까지의 모든 HP 변화(필드 회복/먹다남은음식/씨뿌리기/상태이상
 * 데미지 등)가 끝난 뒤에도 다시 한번 확인한다 — 액션 중엔 안 걸렸다가 턴 종료 데미지로
 * 뒤늦게 1/2 이하가 되는 경우를 놓치지 않기 위해서다.
 * 볼주머니: 위 나무열매를 턴 종료 시 먹었으면 consumeItem이 pendingCheekPouchHeal을 쌓아둔다.
 */
function applyBerryHpThresholdHeal(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterAbility, fighterItem, fighterBerriesBlocked, endOfTurn } = ctx;
  if (!isFainted(fighter) && !fighterBerriesBlocked && !hasVolatile(fighter.volatile, "healBlock")) { // 봉인 중이면 열매 보존(8.3 A3)
    const berryHeal = getHpThresholdBerryHeal(
      fighterItem,
      fighter.currentHp,
      fighter.maxHp,
      fighter.itemConsumed ?? false,
      !!fighterAbility?.doublesBerryEffect, // 숙성
    );
    if (berryHeal > 0) {
      fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + berryHeal);
      consumeItem(fighter);
      endOfTurn.push({
        actor: key,
        damage: 0,
        remainingHp: fighter.currentHp,
        fainted: false,
        berryHeal,
        berryHealItemName: fighterItem!.name,
      });
    }
  }
  if (fighter.pendingCheekPouchHeal) {
    endOfTurn.push({
      actor: key,
      damage: 0,
      remainingHp: fighter.currentHp,
      fainted: false,
      cheekPouchHeal: fighter.pendingCheekPouchHeal,
    });
    fighter.pendingCheekPouchHeal = undefined;
  }
}

/**
 * 수확(Harvest): 턴 종료 시, 소비한 나무열매가 있고 지금 무도구면 확률로 그 열매를 되돌린다.
 * 쾌청(큰햇살)이면 sunChance(수확=100), 그 외 chance(50). 날씨부정이면 쾌청 취급하지 않는다.
 */
function applyHarvestRestore(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, fighterAbility, random, endOfTurn } = ctx;
  if (
    isFainted(fighter) ||
    !fighterAbility?.restoresBerryEndOfTurn ||
    !fighter.consumedBerryId ||
    fighter.currentItemId
  ) {
    return;
  }
  const { chance, sunChance } = fighterAbility.restoresBerryEndOfTurn;
  const inSun = activeWeather(state) === "쾌청";
  if (random() * 100 < (inSun ? sunChance : chance)) {
    fighter.currentItemId = fighter.consumedBerryId;
    fighter.itemConsumed = false;
    endOfTurn.push({
      actor: key,
      damage: 0,
      remainingHp: fighter.currentHp,
      fainted: false,
      harvestRestoredBerryName: getItem(fighter.consumedBerryId)?.name ?? fighter.consumedBerryId,
    });
  }
}

/**
 * 되새김질(ver.1.9 A5): 나무열매를 먹은 턴의 다음 턴 끝에 그 열매를 한 번 더 먹는다(consumeItem이 2로 세팅 — 먹은 턴 끝 1, 다음 턴 끝 0).
 * HP 회복 열매는 HP 조건 없이 회복, 상태이상·혼란 치료 열매는 걸려 있으면 치료, 그 외(반감·과사)는 효과 없음. 긴장감이면 못 먹는다.
 */
function applyCudChew(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterAbility, fighterBerriesBlocked, endOfTurn } = ctx;
  if (!fighter.cudChewBerryId || fighter.cudChewTurnsLeft === undefined) return;
  fighter.cudChewTurnsLeft -= 1;
  if (fighter.cudChewTurnsLeft > 0) return;
  const berryId = fighter.cudChewBerryId;
  fighter.cudChewBerryId = undefined;
  fighter.cudChewTurnsLeft = undefined;
  const item = getItem(berryId);
  if (!item || isFainted(fighter) || fighterBerriesBlocked) return;
  const ripen = fighterAbility?.doublesBerryEffect ? 2 : 1;
  const healBase = item.healsBelowHalfHpDenominator ? Math.floor(fighter.maxHp / item.healsBelowHalfHpDenominator) : (item.healsBelowHalfHpFlat ?? 0);
  // 봉인 중이면 발동은 하되 회복 0(대기는 위에서 이미 소멸) — 해제 턴에는 ④에서 봉인이 먼저 풀려 회복한다(8.3 A3)
  const heal = hasVolatile(fighter.volatile, "healBlock") ? 0 : Math.min(fighter.maxHp - fighter.currentHp, healBase * ripen);
  if (heal > 0) fighter.currentHp += heal;
  const curedStatus = fighter.status.condition && item.curesStatusOnInflict?.includes(fighter.status.condition) ? fighter.status.condition : undefined;
  if (curedStatus) fighter.status = { ...NO_STATUS_CONDITION };
  const curedConfusion = !!item.curesConfusionOnInflict && hasVolatile(fighter.volatile, "confusion");
  if (curedConfusion) {
    const { confusion: _cured, ...rest } = fighter.volatile.active;
    fighter.volatile = { active: rest };
  }
  endOfTurn.push({
    actor: key,
    damage: 0,
    remainingHp: fighter.currentHp,
    fainted: false,
    cudChewBerryName: item.name,
    berryHeal: heal > 0 ? heal : undefined,
    abilityCuredStatus: curedStatus ?? undefined,
  });
}

/** finishTurn의 단계 사이에서 공유되는 값 — 한 단계 안에서만 쓰는 변수는 각 단계 함수의 지역 변수다 */
interface FinishCtx {
  state: BattleState;
  order: [FighterKey, FighterKey];
  actions: ActionLogEntry[];
  switches: SwitchLogEntry[];
  turnStartAnnouncements: string[];
  megaEvolutions: MegaEvolutionLogEntry[];
  selfDestructComboKey: FighterKey | undefined;
  random: () => number;
  winner: FighterKey | "draw" | undefined;
  endOfTurn: EndOfTurnLogEntry[];
  forcedSwitch: { a?: boolean; b?: boolean } | undefined;
  /** 미래예지 적중 반응 기록과, 턴 종료 뒤 확정된 위기회피 교체 요구(8.3 A4-b) */
  pending: PendingReactions;
  exitSwitch: Partial<Record<FighterKey, true>>;
  fieldExpired: boolean;
  trickRoomExpired: boolean;
  expiredFieldEffects: ("wonderRoom" | "magicRoom" | "gravity")[];
  expiredMagnetRise: FighterKey[];
  weatherExpired: boolean;
  expiredScreens: { actor: FighterKey; screen: "reflect" | "lightScreen" | "auroraVeil" }[];
  expiredSafeguard: FighterKey[];
  expiredTailwind: FighterKey[];
}

/** 포켓몬 하나의 턴 종료 처리 컨텍스트 — 핸들러마다 새로 만들어 앞 핸들러에서 바뀐 도구·HP·상대 기절 여부를 읽는다(8.3 D3-fix-34 Q3) */
function makeEotCtx(c: FinishCtx, key: FighterKey): EndOfTurnFighterContext {
  const fighter = c.state[key];
  const opponent = c.state[opponentKey(key)];
  const fighterAbility = fighter.effectiveAbilityId ? getAbility(fighter.effectiveAbilityId) : undefined;
  const fighterItem = fighterAbility?.disablesOwnItemEffects || itemsSuppressedByRoom(c.state)
    ? undefined
    : fighter.currentItemId
      ? getItem(fighter.currentItemId)
      : undefined;
  // 긴장감: 상대가 이 특성이면 이 포켓몬의 나무열매(자뭉열매/오랭열매 등)가 막힌다 —
  // 먹다남은음식은 나무열매가 아니라서 이 플래그와 무관하게 그대로 발동한다.
  const opponentAbility = opponent.effectiveAbilityId ? getAbility(opponent.effectiveAbilityId) : undefined;
  const opponentFainted = isFainted(opponent);
  return {
    state: c.state,
    key,
    fighter,
    fighterAbility,
    fighterItem,
    fighterBerriesBlocked: !opponentFainted && !!opponentAbility?.preventsOpponentBerries,
    random: c.random,
    endOfTurn: c.endOfTurn,
    opponentFainted,
    pending: c.pending,
  };
}

/**
 * 전멸 판정(8.3 D3-fix-33, E6-02·03 — Showdown `resolveFaints` → `checkWin`): 활성이 쓰러졌고 살아 있는 예비가 없는 편이 있으면 배틀이 그 자리에서 끝난다.
 * c.winner를 정하고 true를 돌려주며, 호출부는 이후 효과를 처리하지 않는다. 한 편만 전멸이면 상대 승리, 둘 다 전멸이면 무승부가 아니라
 * **마지막에 쓰러진 포켓몬의 편**이 이긴다(gen5+ — lastFainted). lastFainted를 모르는 동시 전멸은 도달 불가지만 무승부로 안전하게 둔다.
 */
function endIfWiped(c: FinishCtx, lastFainted: FighterKey | undefined): boolean {
  if (c.winner) return true;
  const aOut = isSideWiped(c.state, "a");
  const bOut = isSideWiped(c.state, "b");
  if (!aOut && !bOut) return false;
  c.winner = aOut && bOut ? (lastFainted ?? "draw") : aOut ? "b" : "a";
  return true;
}

/**
 * 턴 종료 효과 한 건 = Showdown residual 핸들러 한 건(8.3 D3-fix-34, E6-01 — 설계 8.3-D3-fix34-턴종료정렬설계.md §3).
 * 두 포켓몬의 핸들러를 한 목록으로 모아 `order → 스피드 → sub` 순으로 처리한다.
 *  · order/sub는 Showdown `onResidualOrder`·`onResidualSubOrder` 값(`data/*.ts`). 4.5(면역 해제)·30(열매 재확인)은 소스 값이 아니라 A1이 정한 엔진 배치를 숫자로 옮긴 것이다(Showdown은 `onUpdate`).
 *  · `slot`: 기절한 자리 주인도 처리(미래예지·희망사항). 정렬은 일반 효과와 같다(자리 주인 스피드).
 *  · `deferWipe`: 같은 order 그룹이 모두 끝난 뒤 한 번 전멸을 판정(날씨 1·멸망의노래 24 — Showdown은 날씨가 핸들러 1개, 멸망의노래는 `resolveFaints` 없는 지속 종료형).
 *  · `orderOf`: 목록을 만들 때 상태로 order가 갈리는 것(독·맹독 9 / 화상 10).
 */
interface EotHandler {
  order: number;
  sub?: number;
  slot?: true;
  deferWipe?: true;
  orderOf?: (fighter: BattleFighterState) => number;
  run: (ctx: EndOfTurnFighterContext) => void;
}

/** 순서는 같은 (order, sub) 안에서의 표 위치 순서이기도 하다(Q2: 같은 포켓몬의 같은 order·sub 효과는 이 순서로 고정) */
const EOT_HANDLERS: readonly EotHandler[] = [
  // 날씨(order 1, 필드 핸들러 1개 안에서 포켓몬별 eachEvent('Weather'): 날씨 sub 5 → 특성 sub 7)
  { order: 1, sub: 5, deferWipe: true, run: applySandstormDamage },
  { order: 1, sub: 7, deferWipe: true, run: applyWeatherHealAbility },
  { order: 1, sub: 7, deferWipe: true, run: applyWeatherDamageAbility },
  // 자리(편) 효과 — 자리 주인의 스피드로 정렬, 주인이 기절해도 처리
  { order: 3, sub: 3, slot: true, run: applyFutureSight },
  { order: 4, sub: 3, slot: true, run: applyWishHeal },
  { order: 4.5, run: applyAbilityImmunityCure },
  { order: 5, sub: 2, run: applyFieldEndOfTurnHeal },
  { order: 5, sub: 3, run: applyShedSkinCure },
  { order: 5, sub: 4, run: applyLeftoversHeal },
  { order: 6, run: applyAquaRingHeal },
  { order: 7, run: applyIngrainHeal },
  { order: 8, run: applyLeechSeedDamage },
  { order: 9, orderOf: (f) => (f.status.condition === "burn" ? 10 : 9), run: applyStatusEndOfTurnTick },
  { order: 12, run: applyCurseDamage },
  { order: 13, run: applyBoundDamage },
  { order: 13, run: applySaltCureDamage },
  { order: 14, run: applySyrupCoatDrop },
  { order: 14, run: applyOctolockDrop },
  { order: 15, run: tickBlockVolatiles }, // 도발 15·앙코르 16·사슬묶기 17·회복봉인 20·지옥찌르기 22를 한 함수가 같이 줄인다 — 15~22 사이에 HP·상태를 바꾸는 효과가 없어 일괄
  {
    order: 23,
    run: (ctx) => {
      applyDrowsySleepOnset(ctx);
      // 난동(8.3 D3-fix-10): 명중한 턴 안에서 잠들었으면(느린 상대의 수면 기술·위 하품) 혼란 없이 조용히 푼다 — 반드시 수면 부여(하품) 뒤.
      calmRampageIfAsleep(ctx.fighter);
    },
  },
  { order: 24, deferWipe: true, run: applyPerishSongCountdown },
  { order: 28, sub: 2, run: applySpeedBoostAbility },
  { order: 28, sub: 2, run: applyMoodyRandomStages },
  { order: 28, sub: 2, run: applyHarvestRestore },
  { order: 28, sub: 2, run: applyCudChew },
  { order: 29, run: applyHungerSwitchToggle },
  { order: 30, run: applyBerryHpThresholdHeal },
];

interface EotEntry {
  h: EotHandler;
  key: FighterKey;
  order: number;
  sub: number;
  pos: number;
  speed: number;
}

/**
 * 턴 종료 효과 전체를 한 목록으로 정렬해 처리한다. 스피드는 residual 직전의 값(`computeTurnOrderSpeed` — 랭크·마비·스카프·순풍·날씨 특성만 쓰는 순수 스피드,
 * 선제공격손톱 등 행동 순서 전용 보정은 없다), 트릭룸이면 느린 쪽이 먼저. 스피드가 정확히 같으면 (order, sub) 묶음마다 동전 한 번(Q1 (가')) — 같은 포켓몬끼리는 표 위치 순서로 고정.
 * 핸들러마다 컨텍스트를 새로 만들고 전멸을 확인한다(`deferWipe` 핸들러는 같은 order 그룹이 끝난 뒤 한 번). 전멸하면 이후 효과를 처리하지 않는다.
 */
function runEndOfTurnHandlers(c: FinishCtx): void {
  const trickRoom = c.state.trickRoomTurnsRemaining !== undefined;
  const speeds: Record<FighterKey, number> = { a: computeTurnOrderSpeed(c.state, c.state.a), b: computeTurnOrderSpeed(c.state, c.state.b) };
  const entries: EotEntry[] = [];
  for (const key of ["a", "b"] as const) {
    EOT_HANDLERS.forEach((h, pos) => entries.push({ h, key, order: h.orderOf ? h.orderOf(c.state[key]) : h.order, sub: h.sub ?? 0, pos, speed: speeds[key] }));
  }
  // 동속 동전: 스피드가 정확히 같고 두 포켓몬이 모두 살아 있을 때만, (order, sub) 오름차순으로 한 묶음에 한 번씩 뽑는다(표 전체를 뽑아 효과 유무와 무관)
  const coin = new Map<string, boolean>(); // 묶음 → a가 먼저인가
  if (speeds.a === speeds.b && !isFainted(c.state.a) && !isFainted(c.state.b)) {
    const groups = [...new Set(entries.map((e) => `${e.order}/${e.sub}`))].sort((x, y) => {
      const [xo, xs] = x.split("/").map(Number);
      const [yo, ys] = y.split("/").map(Number);
      return xo - yo || xs - ys;
    });
    for (const g of groups) coin.set(g, c.random() < 0.5);
  }
  const keyRank = (e: EotEntry) => (e.key === "a" ? 0 : 1) ^ (coin.get(`${e.order}/${e.sub}`) === false ? 1 : 0);
  const sorted = [...entries].sort((x, y) => {
    const speedDiff = x.speed === y.speed ? 0 : trickRoom ? x.speed - y.speed : y.speed - x.speed;
    return x.order - y.order || speedDiff || x.sub - y.sub || keyRank(x) - keyRank(y) || x.pos - y.pos;
  });

  let groupLast: FighterKey | undefined; // deferWipe 그룹에서 마지막으로 쓰러진 포켓몬
  for (let i = 0; i < sorted.length; i++) {
    const { h, key, order } = sorted[i];
    // 기절한 보유자의 핸들러는 건너뛴다(Showdown fieldEvent) — 자리 효과는 예외
    if (h.slot || !isFainted(c.state[key])) {
      const aBefore = isFainted(c.state.a);
      const bBefore = isFainted(c.state.b);
      h.run(makeEotCtx(c, key));
      // 마지막으로 쓰러진 쪽 기록 — 한 핸들러가 둘 다 쓰러뜨리면 보유자 → 상대 순(상대가 마지막)
      const newly = (["a", "b"] as const).filter((k) => isFainted(c.state[k]) && !(k === "a" ? aBefore : bBefore));
      if (newly.length === 2) groupLast = opponentKey(key);
      else if (newly.length === 1) groupLast = newly[0];
    }
    const next = sorted[i + 1];
    if (h.deferWipe && next?.h.deferWipe && next.order === order) continue; // 같은 order 그룹이 끝날 때까지 판정을 미룬다
    // 동시 전멸은 마지막에 쓰러진 쪽이 이긴다 — 그룹은 groupLast, 일반 핸들러는 보유자 다음에 쓰러지는 상대
    if (endIfWiped(c, h.deferWipe ? groupLast : opponentKey(key))) return;
    groupLast = undefined;
  }
}

/**
 * 턴 종료 효과(endOfTurn)와 멸망의노래로 쓰러진 쪽 처리 — 8.3 A1(단계)·D3-fix-34(한 목록 정렬).
 * ① 날씨 종료(expireWeather, 호출부) 뒤 `EOT_HANDLERS`를 order → 스피드 → sub 순으로 처리한다. 이번 턴 쓰러진 쪽의 핸들러는 건너뛰고(자리 효과 제외),
 * 살아 있는 쪽은 상대가 쓰러졌어도 턴 종료 처리를 받는다(ver.2.0 버그 수정 — 상대에게 매인 효과는 opponentFainted로 각 효과가 거른다).
 */
function resolveEndOfTurnAndPerish(c: FinishCtx) {
  c.endOfTurn = [];
  c.pending = { exit: {}, redCard: {} };
  c.exitSwitch = {};
  if (c.winner) return;
  runEndOfTurnHandlers(c);
}

/**
 * 미래예지 적중 반응 정산(8.3 A4-b, Showdown: 교체는 잔류 처리 전체가 끝난 뒤·기절 처리 앞) — 필드·스크린 만료까지 끝난 뒤에 부른다.
 * 레드카드: 대상(홀더)이 맞는 순간 카드를 소모했고(applyFutureSight), 여기서 사용자(상대 편)가 살아 있고 끌려 나올 수 있으면(뿌리박기·흡반이 아니면) 무작위 예비로 끌어낸다.
 * 위기회피: 대상이 살아 있고 살아 있는 예비가 있으면 교체 요구를 확정한다 — 도망봉인·뿌리박기·흡반은 보지 않고 HP도 다시 보지 않는다(Showdown canSwitch만).
 * 레드카드가 먼저다(같은 포켓몬이 둘 다 지니면 사용자가 먼저 끌려 나오고 그다음 대상에게 교체 요구). 끌려 들어온 포켓몬이 쓰러지면 decideWinnerAndForcedSwitch가 처리한다.
 */
function settleFutureSightReactions(c: FinishCtx) {
  for (const holder of ["a", "b"] as const) {
    const cardName = c.pending.redCard[holder];
    const user = opponentKey(holder);
    if (cardName && !isFainted(c.state[user]) && !isForcedSwitchBlocked(c.state[user]) && hasLivingReserve(sideOf(c.state, user))) {
      forceRandomSwitch(c.state, c.random, c.switches, user, { redCardItemName: cardName, endOfTurn: true });
    }
  }
  for (const key of ["a", "b"] as const) {
    if (c.pending.exit[key] && !isFainted(c.state[key]) && hasLivingReserve(sideOf(c.state, key))) c.exitSwitch[key] = true;
  }
}

/** 활성 슬롯이 기절했을 때의 승패·무승부·강제 교체 대상 결정 */
function decideWinnerAndForcedSwitch(c: FinishCtx) {

  // 활성 슬롯이 기절해도 파티에 아직 안 쓰러진 슬롯이 있으면 그 편의 패배가 아니라 강제 교체다.
  // (파티 길이 1이면 hasLivingReserve가 항상 false라 아래 로직은 기존 1v1과 완전히 동일하게 동작.)
  const aHasReserve = hasLivingReserve(c.state.sideA);
  const bHasReserve = hasLivingReserve(c.state.sideB);

  // 자폭 콤보(§7-1)·행동 구간·턴 종료 효과 중 전멸은 이제 endIfWiped가 그 자리에서 정한다(8.3 D3-fix-33). 콤보에서 둘 다 예비가 있으면 winner 미정이라 아래 forcedSwitch가 양쪽 교체를 요구한다.

  // 멸망의노래로 양쪽이 동시에 쓰러지면 빠른 쪽이 먼저 쓰러져 느린 쪽이 이긴다(F-4) — 이제 order 24 `deferWipe` 그룹의 정렬 순서와 endIfWiped가 정한다(8.3 D3-fix-34).
  // 어느 한쪽이라도 교대할 슬롯이 남아 있으면 배틀은 안 끝나고 강제 교체로 넘어간다(§3).

  // 턴 종료 시점에 활성이 기절해 있고 교대할 슬롯도 없으면 그 편이 진다. 양쪽 다면 무승부 —
  // 어느 한 쪽이 상대를 쓰러뜨린 게 아니라 각자 자기 상태이상 등으로 따로 쓰러진 것이라 인과가 없다.
  if (!c.winner) {
    const aOut = isFainted(c.state.a) && !aHasReserve;
    const bOut = isFainted(c.state.b) && !bHasReserve;
    if (aOut && bOut) c.winner = "draw";
    else if (aOut) c.winner = "b";
    else if (bOut) c.winner = "a";
  }

  // 배틀이 안 끝났는데 활성이 기절해 있으면(=교대할 슬롯이 남음) 다음 턴 전에 강제 교체를 요구한다.
  // 활성이 기절했거나, 미래예지 적중 위기회피로 살아 있는 활성이 물러나야 하는 편(8.3 A4-b — 이미 기절했으면 기절 교체가 대신하므로 한 번만 요구된다)
  const needA = aHasReserve && (isFainted(c.state.a) || !!c.exitSwitch.a);
  const needB = bHasReserve && (isFainted(c.state.b) || !!c.exitSwitch.b);
  c.forcedSwitch = !c.winner && (needA || needB) ? { a: needA ? true : undefined, b: needB ? true : undefined } : undefined;
}

/** 필드·트릭룸·원더룸·매직룸·중력·페어리록·전자부유의 지속 턴 카운트다운(날씨는 턴 종료 효과 앞의 expireWeather) */
function expireFieldAndWeather(c: FinishCtx) {

  // (유턴류 자체 교체(§7-2)는 runActionPhase에서 턴 중간에 멈춰 resumeTurn으로 이미 처리된다.)

  // 필드 지속 턴 카운트다운. 0이 되면 이번 턴을 끝으로 필드가 사라진다.
  c.fieldExpired = false;
  if (c.state.field && c.state.fieldTurnsRemaining !== undefined) {
    c.state.fieldTurnsRemaining -= 1;
    if (c.state.fieldTurnsRemaining <= 0) {
      c.state.field = undefined;
      c.state.fieldTurnsRemaining = undefined;
      c.fieldExpired = true;
    }
  }

  // 트릭룸도 같은 방식으로 카운트다운한다.
  c.trickRoomExpired = false;
  if (c.state.trickRoomTurnsRemaining !== undefined) {
    c.state.trickRoomTurnsRemaining -= 1;
    if (c.state.trickRoomTurnsRemaining <= 0) {
      c.state.trickRoomTurnsRemaining = undefined;
      c.trickRoomExpired = true;
    }
  }

  // 트랙 M4: 원더룸·매직룸·중력(장 전체)과 전자부유(활성 포켓몬별)도 같은 방식으로 카운트다운한다.
  c.expiredFieldEffects = [];
  const countDown = (key: "wonderRoomTurnsRemaining" | "magicRoomTurnsRemaining" | "gravityTurnsRemaining", name: "wonderRoom" | "magicRoom" | "gravity") => {
    const left = c.state[key];
    if (left === undefined) return;
    if (left - 1 <= 0) {
      c.state[key] = undefined;
      c.expiredFieldEffects.push(name);
    } else {
      c.state[key] = left - 1;
    }
  };
  countDown("wonderRoomTurnsRemaining", "wonderRoom");
  countDown("magicRoomTurnsRemaining", "magicRoom");
  countDown("gravityTurnsRemaining", "gravity");
  // 페어리록(트랙 M6): 걸린 턴 끝에 2 → 1(다음 턴이 봉쇄 턴), 그 턴 끝에 해제 — 해제 로그는 따로 내지 않는다
  if (c.state.fairyLockTurnsRemaining !== undefined) {
    c.state.fairyLockTurnsRemaining -= 1;
    if (c.state.fairyLockTurnsRemaining <= 0) c.state.fairyLockTurnsRemaining = undefined;
  }
  c.expiredMagnetRise = [];
  for (const key of ["a", "b"] as const) {
    const f = c.state[key];
    if (f.magnetRiseTurnsRemaining === undefined) continue;
    f.magnetRiseTurnsRemaining -= 1;
    if (f.magnetRiseTurnsRemaining <= 0) {
      f.magnetRiseTurnsRemaining = undefined;
      if (!isFainted(f)) c.expiredMagnetRise.push(key);
    }
  }
}

/**
 * 날씨 지속 턴 카운트다운(8.3 A1 ① — 턴 종료 효과보다 먼저, 그래서 마지막 턴에는 모래바람 피해·젖은접시 등이 없다).
 * weatherTurnsRemaining은 날씨가 아예 없을 때만 undefined이고, 특성/수동/기술 어느 경로로 걸렸든 항상 유한 턴수를 갖는다(챔피언스 규칙).
 */
function expireWeather(c: FinishCtx) {
  c.weatherExpired = false;
  if (c.state.weatherTurnsRemaining !== undefined) {
    c.state.weatherTurnsRemaining -= 1;
    if (c.state.weatherTurnsRemaining <= 0) {
      c.state.weather = undefined;
      c.state.weatherTurnsRemaining = undefined;
      c.weatherExpired = true;
      // 기분파(캐스퐁): 날씨가 사라지면 노말로 되돌린다.
      applyForecastForm(c.state.a, activeWeather(c.state));
      applyForecastForm(c.state.b, activeWeather(c.state));
    }
  }
}

/** 리플렉터·빛의장막·오로라베일·신비의부적·순풍의 편 단위 카운트다운 */
function expireSideEffects(c: FinishCtx) {

  // 리플렉터/빛의장막/오로라베일은 필드/날씨와 달리 "양쪽 편이 따로" 걸릴 수 있어 각자
  // 카운트다운한다. 편(side) 단위 상태라 이번 턴 교체가 있었어도 그대로 이어서 줄어든다(§6-3).
  c.expiredScreens = [];
  for (const key of (["a", "b"] as const)) {
    const side = sideOf(c.state, key);
    for (const screenType of ["reflect", "lightScreen", "auroraVeil"] as const) {
      const remaining = side.screens[screenType];
      if (remaining === undefined) continue;
      const next = remaining - 1;
      if (next <= 0) {
        side.screens = { ...side.screens, [screenType]: undefined };
        c.expiredScreens.push({ actor: key, screen: screenType });
      } else {
        side.screens = { ...side.screens, [screenType]: next };
      }
    }
  }

  // 신비의부적(세이프가드)도 스크린과 같은 편 단위 카운트다운 — 종류가 하나뿐이라 배열은
  // "어느 편에서 사라졌는지"만 담는다.
  c.expiredSafeguard = [];
  for (const key of (["a", "b"] as const)) {
    const side = sideOf(c.state, key);
    if (side.safeguardTurnsRemaining === undefined) continue;
    const next = side.safeguardTurnsRemaining - 1;
    if (next <= 0) {
      side.safeguardTurnsRemaining = undefined;
      c.expiredSafeguard.push(key);
    } else {
      side.safeguardTurnsRemaining = next;
    }
  }

  // 순풍(트랙 M1)도 같은 편 단위 카운트다운
  c.expiredTailwind = [];
  for (const key of (["a", "b"] as const)) {
    const side = sideOf(c.state, key);
    if (side.tailwindTurnsRemaining === undefined) continue;
    const next = side.tailwindTurnsRemaining - 1;
    if (next <= 0) {
      side.tailwindTurnsRemaining = undefined;
      c.expiredTailwind.push(key);
    } else {
      side.tailwindTurnsRemaining = next;
    }
  }
}

/** 턴 결과를 모아 돌려준다 */
function collectResult(c: FinishCtx) {

  return {
    nextState: c.state,
    result: {
      turnNumber: c.state.turnNumber,
      order: c.order,
      actions: c.actions,
      endOfTurn: c.endOfTurn,
      winner: c.winner,
      field: c.state.field,
      fieldTurnsRemaining: c.state.fieldTurnsRemaining,
      fieldExpired: c.fieldExpired,
      trickRoomTurnsRemaining: c.state.trickRoomTurnsRemaining,
      trickRoomExpired: c.trickRoomExpired,
      weatherTurnsRemaining: c.state.weatherTurnsRemaining,
      weatherExpired: c.weatherExpired,
      expiredScreens: c.expiredScreens,
      expiredSafeguard: c.expiredSafeguard,
      expiredTailwind: c.expiredTailwind.length > 0 ? c.expiredTailwind : undefined,
      expiredFieldEffects: c.expiredFieldEffects.length > 0 ? c.expiredFieldEffects : undefined,
      expiredMagnetRise: c.expiredMagnetRise.length > 0 ? c.expiredMagnetRise : undefined,
      turnStartAnnouncements: c.turnStartAnnouncements,
      megaEvolutions: c.megaEvolutions.length > 0 ? c.megaEvolutions : undefined,
      switches: c.switches,
      activePokemonIds: { a: c.state.a.slot.pokemonId, b: c.state.b.slot.pokemonId },
    },
    forcedSwitch: c.forcedSwitch,
  };
}

export function finishTurn(ctx: RunTurnContext): RunTurnOutcome {
  const c = {} as FinishCtx;

  c.state = ctx.state;
  c.order = ctx.order;
  c.actions = ctx.actions;
  c.switches = ctx.switches;
  c.turnStartAnnouncements = ctx.turnStartAnnouncements;
  c.megaEvolutions = ctx.megaEvolutions;
  c.selfDestructComboKey = ctx.selfDestructComboKey;
  c.random = ctx.random;


  // 분함의발구르기·열불내기(ver.1.9): 이번 턴 자기 행동이 실패였는지 기록 — 다음 턴 위력 2배 판정. 이번 턴 행동하지 않았으면
  // (교체로 나옴·쓰러짐 등) 실패 아님. 턴 중 유턴류로 바뀐 경우 행동한 포켓몬이 아니므로 종 id로 맞춘다.
  for (const key of ["a", "b"] as const) {
    const fighter = c.state[key];
    const own = c.actions.find((a) => a.actor === key && a.actorPokemonId === fighter.slot.pokemonId);
    fighter.lastTurnMoveFailed = own && actionFailed(own) ? true : undefined;
  }
  // 8.3 D3-fix-33: 행동 구간에서 한쪽이 전멸했으면 턴 종료 단계 전체를 건너뛴다(자폭 콤보는 콤보 실행 쪽이 마지막에 쓰러진 것). 건너뛴 단계의 결과 필드는 빈 값으로 둔다.
  c.endOfTurn = [];
  c.pending = { exit: {}, redCard: {} };
  c.exitSwitch = {};
  c.fieldExpired = c.trickRoomExpired = c.weatherExpired = false;
  c.expiredFieldEffects = []; c.expiredMagnetRise = []; c.expiredScreens = []; c.expiredSafeguard = []; c.expiredTailwind = [];
  if (!endIfWiped(c, c.selfDestructComboKey)) {
    expireWeather(c);
    resolveEndOfTurnAndPerish(c);
    // 턴 종료 효과 중 전멸했으면 이후 단계(필드·방 지속·벽·미래예지 반응)는 처리하지 않는다
    if (!c.winner) {
      expireFieldAndWeather(c);
      expireSideEffects(c);
      settleFutureSightReactions(c);
    }
  }
  // 8.3 A4-b: 승패·강제 교체 판정은 필드·스크린 만료 뒤(Showdown은 교체 요청이 잔류 전체 뒤) — 만료 함수는 winner·forcedSwitch를 읽지 않는다
  decideWinnerAndForcedSwitch(c);
  return collectResult(c);
}
