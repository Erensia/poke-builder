import { itemsSuppressedByRoom } from "./turnOrderInputs";
import { isGrounded } from "./grounding";
import { type EndOfTurnLogEntry, type FighterKey } from "@/types/battle";
import { BATTLE_STAT_KEYS } from "@/types/battleStats";
import { NO_STATUS_CONDITION } from "@/types/status";
import { type Ability } from "@/types/ability";
import { type Item } from "@/types/item";
import { getAbility, getItem } from "@/lib/data";
import { applyStageDelta } from "@/lib/statStages";
import { advanceStatusTurn, computeStatusEndOfTurnDamage, inflictStatus, isImmuneToStatus } from "@/lib/statusConditions";
import { consumeVolatileTurn, hasVolatile } from "@/lib/volatileConditions";
import { rankStageMultiplier } from "@/lib/battlePower";
import { computeFieldEndOfTurnHeal, isStatusBlockedByField } from "@/lib/fieldEffects";
import { getDrainHealMultiplier, getHpThresholdBerryHeal } from "@/lib/itemEffects";
import { SANDSTORM_IMMUNE_ABILITY_NAMES, activeWeather, applyForecastForm, consumeItem, contraryDelta, hasLivingReserve, isFainted, opponentKey, sideOf, statDropBlockStatsOf, statusImmunitiesOf, type BattleFighterState, type BattleState } from "./state";
import { type RunTurnContext, type RunTurnOutcome } from "./runTurn";

interface EndOfTurnFighterContext {
  state: BattleState;
  key: FighterKey;
  fighter: BattleFighterState;
  fighterAbility: Ability | undefined;
  fighterItem: Item | undefined;
  fighterBerriesBlocked: boolean;
  random: () => number;
  endOfTurn: EndOfTurnLogEntry[];
}

/**
 * 멸망의노래 카운트(F-4): 매 턴 종료 시 현재 카운트를 로그로 찍고 1 줄인다. 0에서 다음
 * 감소 시점에 HP가 0이 된다("3턴 후 기절" = 건 턴 포함 4번째 턴 종료). true를 돌려주면
 * 호출부가 perishFaintedKeys에 추가하고 이 편의 나머지 턴 종료 처리를 건너뛴다(continue).
 */
function applyPerishSongCountdown(ctx: EndOfTurnFighterContext): boolean {
  const { key, fighter, endOfTurn } = ctx;
  if (fighter.perishCount === undefined || isFainted(fighter)) return false;
  if (fighter.perishCount <= 0) {
    fighter.currentHp = 0;
    endOfTurn.push({ actor: key, damage: 0, remainingHp: 0, fainted: true, perishFainted: true });
    return true;
  }
  endOfTurn.push({
    actor: key,
    damage: 0,
    remainingHp: fighter.currentHp,
    fainted: false,
    perishCount: fighter.perishCount,
  });
  fighter.perishCount -= 1;
  return false;
}

/** 그래스필드: 매 턴 종료 시 최대 HP 1/16 회복 */
function applyFieldEndOfTurnHeal(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, endOfTurn } = ctx;
  // 트랙 M4: 그래스필드 회복은 땅에 있는 포켓몬만
  const fieldHeal = isGrounded(state, fighter) ? computeFieldEndOfTurnHeal(state.field, fighter.maxHp) : 0;
  if (fieldHeal > 0) {
    fighter.currentHp = Math.min(fighter.maxHp, fighter.currentHp + fieldHeal);
    endOfTurn.push({ actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, fieldHeal });
  }
}

/** 먹다남은음식: 턴 종료 시 항상(생존해 있으면) 최대 HP의 1/6 회복 */
function applyLeftoversHeal(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterItem, endOfTurn } = ctx;
  if (!fighterItem?.endOfTurnHealDenominator) return;
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
  if (!weatherHealBoost || weatherHealBoost.weather !== activeWeather(state)) return;
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

/** 뿌리박기/아쿠아링: 걸려있는 동안 매 턴 종료 시 최대 HP 1/16 회복(큰뿌리 소지 시 1.3배) */
function applyIngrainAquaRingHeal(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterItem, endOfTurn } = ctx;
  const regenSource = hasVolatile(fighter.volatile, "ingrain")
    ? "ingrain"
    : hasVolatile(fighter.volatile, "aquaRing")
      ? "aquaRing"
      : undefined;
  if (!regenSource) return;
  const regenHeal = Math.min(
    fighter.maxHp - fighter.currentHp,
    Math.floor((fighter.maxHp / 16) * getDrainHealMultiplier(fighterItem)),
  );
  if (regenHeal > 0) {
    fighter.currentHp += regenHeal;
    endOfTurn.push({ actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, regenHeal, regenSource });
  }
}

/**
 * 씨뿌리기: 걸린 쪽은 매 턴 종료 시 최대 HP 1/8을 잃고, 상대가 그만큼(+상대의 큰뿌리 배율)
 * 회복한다. 상대가 이미 기절해 있으면(동시에 둘 다 씨앗이 걸린 극단적 경우 등) 회복은 스킵.
 * 매직가드: 걸린 쪽이 매직가드면 HP를 잃지 않고, 따라서 상대 회복도 없다(본가 규칙).
 */
function applyLeechSeedDamage(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, fighterAbility, endOfTurn } = ctx;
  if (!hasVolatile(fighter.volatile, "leechSeed") || fighterAbility?.negatesIndirectDamage) return;
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
  if (seedDamage > 0 && !isFainted(healer)) {
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
        Math.floor(seedDamage * getDrainHealMultiplier(healerItem)),
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
 * 속박(bound): 조이기·엉겨붙기·집게덫류에 걸린 쪽은 매 턴 종료 시 최대 HP 1/8을 잃고,
 * 턴 종료마다 카운터가 1씩 줄어 0에서 자동 해제된다. 매직가드면 데미지 면제(카운터는 진행).
 */
function applyBoundDamage(ctx: EndOfTurnFighterContext): void {
  const { state, key, fighter, fighterAbility, endOfTurn } = ctx;
  if (!hasVolatile(fighter.volatile, "bound")) return;
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
  fighter.volatile = consumeVolatileTurn(fighter.volatile, "bound");
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
  // 물엿범벅은 상대(시럽봄 사용자)가 거는 하락 — 클리어바디류/하얀연기가 spe를 막으면 무산.
  if (!statDropBlockStatsOf(fighter, fighterAbility)?.includes("spe")) {
    fighter.stages = applyStageDelta(fighter.stages, "spe", contraryDelta(fighter, -1));
  }
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
  if (!hasVolatile(fighter.volatile, "octolock") || isFainted(fighter)) return;
  const blockedStats = statDropBlockStatsOf(fighter, fighterAbility);
  let octolockDropped = false;
  for (const stat of ["def", "spd"] as const) {
    if (blockedStats?.includes(stat)) continue;
    const before = fighter.stages[stat];
    fighter.stages = applyStageDelta(fighter.stages, stat, contraryDelta(fighter, -1));
    if (fighter.stages[stat] !== before) octolockDropped = true;
  }
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
      const wishHeal = Math.min(fighter.maxHp - fighter.currentHp, wishQueue.healAmount);
      if (wishHeal > 0) {
        fighter.currentHp += wishHeal;
        endOfTurn.push({ actor: key, damage: 0, remainingHp: fighter.currentHp, fainted: false, wishHeal });
      }
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
  if (
    triggersNow &&
    !fighter.status.condition &&
    !isImmuneToStatus("sleep", fighter.types, statusImmunitiesOf(fighter, fighterAbility)) &&
    !isStatusBlockedByField(state.field, "sleep", isGrounded(state, fighter, fighterAbility)) &&
    sideOf(state, key).safeguardTurnsRemaining === undefined
  ) {
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
 * 매직가드·모래 관련 특성(모래숨기/모래의힘/모래날림/모래헤치기) 보유 시 면제.
 * (본가의 방진 특성·방진고글 도구는 포챔스에 없어 제외. 싸라기눈 틱도 없음.)
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
    const heal = Math.min(fighter.maxHp - fighter.currentHp, Math.floor(fighter.maxHp / poisonHealDenom));
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
  const { key, fighter, fighterAbility, random, endOfTurn } = ctx;
  if (!fighter.status.condition || !fighterAbility?.curesOwnStatusChance || isFainted(fighter)) return;
  if (random() * 100 < fighterAbility.curesOwnStatusChance) {
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

/**
 * 가속(Speed Boost): 매 턴 종료 시 스피드 1랭크 상승. 본가 예외 — "자기 의지로 교체해서
 * 나온 턴"엔 발동하지 않는다(Phase 8 §8에서 복원). 단 기절 후 강제 교체로 나온 경우는
 * 발동한다(특성 설명 명시). switchedInThisTurn은 runTurn 교체 선처리에서 자발적 교체에만
 * 세워지고 턴 시작 시 지워진다. 이 턴 데미지로 방금 쓰러졌으면(isFainted) 발동하지 않는다.
 */
function applySpeedBoostAbility(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterAbility, endOfTurn } = ctx;
  if (!fighterAbility?.boostsSpeedEachTurnEnd || isFainted(fighter) || fighter.switchedInThisTurn) return;
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

/** 변덕쟁이(Moody): 매 턴 종료 시 5스탯 중 하나를 랜덤으로 +2, 그와 다른 하나를 -1. */
function applyMoodyRandomStages(ctx: EndOfTurnFighterContext): void {
  const { key, fighter, fighterAbility, random, endOfTurn } = ctx;
  if (!fighterAbility?.moodyRandomStages || isFainted(fighter)) return;
  const raised = BATTLE_STAT_KEYS[Math.floor(random() * BATTLE_STAT_KEYS.length)];
  const lowerPool = BATTLE_STAT_KEYS.filter((s) => s !== raised);
  const lowered = lowerPool[Math.floor(random() * lowerPool.length)];
  fighter.stages = applyStageDelta(fighter.stages, raised, contraryDelta(fighter, 2));
  fighter.stages = applyStageDelta(fighter.stages, lowered, contraryDelta(fighter, -1));
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
  if (!isFainted(fighter) && !fighterBerriesBlocked) {
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

export function finishTurn(ctx: RunTurnContext): RunTurnOutcome {
  const { state, order, actions, switches, turnStartAnnouncements, selfDestructComboKey, speedA, speedB, random } = ctx;
  let winner: FighterKey | "draw" | undefined;

  const endOfTurn: EndOfTurnLogEntry[] = [];
  // 멸망의노래로 이번 턴 종료에 쓰러진 쪽(F-4) — 양쪽 다면 스피드 느린 쪽이 승리한다.
  const perishFaintedKeys = new Set<FighterKey>();

  // 자폭 콤보로 활성끼리 동반 기절했으면(selfDestructComboKey) 두 활성이 모두 isFainted라
  // 이 블록은 건너뛴다 — 둘 다 쓰러진 시점의 턴 종료 회복/상태이상 데미지는 의미가 없다.
  if (!winner && !isFainted(state.a) && !isFainted(state.b)) {
    for (const key of (["a", "b"] as const)) {
      const fighter = state[key];
      const fighterAbility = fighter.effectiveAbilityId ? getAbility(fighter.effectiveAbilityId) : undefined;
      const fighterItem = fighterAbility?.disablesOwnItemEffects || itemsSuppressedByRoom(state)
        ? undefined
        : fighter.currentItemId
          ? getItem(fighter.currentItemId)
          : undefined;
      // 긴장감: 상대가 이 특성이면 이 포켓몬의 나무열매(자뭉열매/오랭열매 등)가 막힌다 —
      // 먹다남은음식은 나무열매가 아니라서 이 플래그와 무관하게 그대로 발동한다.
      const opponentAbilityForItem = state[opponentKey(key)].effectiveAbilityId
        ? getAbility(state[opponentKey(key)].effectiveAbilityId!)
        : undefined;
      const fighterBerriesBlocked = !!opponentAbilityForItem?.preventsOpponentBerries;
      const eotCtx: EndOfTurnFighterContext = {
        state,
        key,
        fighter,
        fighterAbility,
        fighterItem,
        fighterBerriesBlocked,
        random,
        endOfTurn,
      };

      if (applyPerishSongCountdown(eotCtx)) {
        perishFaintedKeys.add(key);
        continue; // 이미 쓰러졌으니 이 포켓몬의 나머지 턴 종료 처리(회복 등)는 건너뛴다
      }
      applyFieldEndOfTurnHeal(eotCtx);
      applyLeftoversHeal(eotCtx);
      applyWeatherHealAbility(eotCtx);
      applyWeatherDamageAbility(eotCtx);
      applyIngrainAquaRingHeal(eotCtx);
      applyLeechSeedDamage(eotCtx);
      applyBoundDamage(eotCtx);
      applySaltCureDamage(eotCtx);
      applySyrupCoatDrop(eotCtx);
      applyOctolockDrop(eotCtx);
      applyWishHeal(eotCtx);
      applyDrowsySleepOnset(eotCtx);
      applySandstormDamage(eotCtx);
      applyStatusEndOfTurnTick(eotCtx);
      applyShedSkinCure(eotCtx);
      applySpeedBoostAbility(eotCtx);
      applyHungerSwitchToggle(eotCtx);
      applyMoodyRandomStages(eotCtx);
      applyBerryHpThresholdHeal(eotCtx);
      applyHarvestRestore(eotCtx);
    }
  }

  // 활성 슬롯이 기절해도 파티에 아직 안 쓰러진 슬롯이 있으면 그 편의 패배가 아니라 강제 교체다.
  // (파티 길이 1이면 hasLivingReserve가 항상 false라 아래 로직은 기존 1v1과 완전히 동일하게 동작.)
  const aHasReserve = hasLivingReserve(state.sideA);
  const bHasReserve = hasLivingReserve(state.sideB);

  // 자폭 콤보로 활성끼리 동반 기절한 경우(§7-1). 아래 generic 무승부 블록은 "각자 따로
  // 쓰러진 것이라 인과가 없다"는 전제라 여기에 흘리면 예비 슬롯이 남아도 배틀이 끝나버린다.
  // 콤보를 실행한 쪽이 상대를 먼저 쓰러뜨렸다는 인과를 살려, 예비 슬롯을 보고 여기서 가른다.
  if (!winner && selfDestructComboKey) {
    const comboKey = selfDestructComboKey;
    const foeKey = opponentKey(comboKey);
    const comboHasReserve = comboKey === "a" ? aHasReserve : bHasReserve;
    const foeHasReserve = foeKey === "a" ? aHasReserve : bHasReserve;
    if (!comboHasReserve && !foeHasReserve) {
      winner = comboKey; // 양쪽 다 예비 없음 → 상대를 먼저 쓰러뜨린 콤보 실행 쪽 승리
    } else if (!comboHasReserve) {
      winner = foeKey; // 콤보 실행 쪽만 전멸
    } else if (!foeHasReserve) {
      winner = comboKey; // 상대만 전멸
    }
    // 둘 다 예비 있음 → winner 미정: 아래 forcedSwitch가 양쪽 강제 교체를 요구한다
  }

  // 멸망의노래로 양쪽이 동시에 쓰러졌으면 무승부가 아니라 스피드가 느린 쪽이 승리한다(F-4) —
  // 빠른 쪽이 먼저 쓰러지는 것으로 취급. 랭크 반영 실효 스피드로 비교(트릭룸은 무관).
  // 단 어느 한쪽이라도 교대할 슬롯이 남아 있으면 배틀은 안 끝나고 강제 교체로 넘어간다(§3).
  if (!winner && perishFaintedKeys.size === 2 && !aHasReserve && !bHasReserve) {
    const effSpeedA = speedA * rankStageMultiplier(state.a.stages.spe);
    const effSpeedB = speedB * rankStageMultiplier(state.b.stages.spe);
    winner = effSpeedA <= effSpeedB ? "a" : "b";
  }

  // 턴 종료 시점에 활성이 기절해 있고 교대할 슬롯도 없으면 그 편이 진다. 양쪽 다면 무승부 —
  // 어느 한 쪽이 상대를 쓰러뜨린 게 아니라 각자 자기 상태이상 등으로 따로 쓰러진 것이라 인과가 없다.
  if (!winner) {
    const aOut = isFainted(state.a) && !aHasReserve;
    const bOut = isFainted(state.b) && !bHasReserve;
    if (aOut && bOut) winner = "draw";
    else if (aOut) winner = "b";
    else if (bOut) winner = "a";
  }

  // 배틀이 안 끝났는데 활성이 기절해 있으면(=교대할 슬롯이 남음) 다음 턴 전에 강제 교체를 요구한다.
  const forcedSwitch: { a?: boolean; b?: boolean } | undefined =
    !winner && ((isFainted(state.a) && aHasReserve) || (isFainted(state.b) && bHasReserve))
      ? {
          a: isFainted(state.a) && aHasReserve ? true : undefined,
          b: isFainted(state.b) && bHasReserve ? true : undefined,
        }
      : undefined;

  // (유턴류 자체 교체(§7-2)는 runActionPhase에서 턴 중간에 멈춰 resumeTurn으로 이미 처리된다.)

  // 필드 지속 턴 카운트다운. 0이 되면 이번 턴을 끝으로 필드가 사라진다.
  let fieldExpired = false;
  if (state.field && state.fieldTurnsRemaining !== undefined) {
    state.fieldTurnsRemaining -= 1;
    if (state.fieldTurnsRemaining <= 0) {
      state.field = undefined;
      state.fieldTurnsRemaining = undefined;
      fieldExpired = true;
    }
  }

  // 트릭룸도 같은 방식으로 카운트다운한다.
  let trickRoomExpired = false;
  if (state.trickRoomTurnsRemaining !== undefined) {
    state.trickRoomTurnsRemaining -= 1;
    if (state.trickRoomTurnsRemaining <= 0) {
      state.trickRoomTurnsRemaining = undefined;
      trickRoomExpired = true;
    }
  }

  // 트랙 M4: 원더룸·매직룸·중력(장 전체)과 전자부유(활성 포켓몬별)도 같은 방식으로 카운트다운한다.
  const expiredFieldEffects: ("wonderRoom" | "magicRoom" | "gravity")[] = [];
  const countDown = (key: "wonderRoomTurnsRemaining" | "magicRoomTurnsRemaining" | "gravityTurnsRemaining", name: "wonderRoom" | "magicRoom" | "gravity") => {
    const left = state[key];
    if (left === undefined) return;
    if (left - 1 <= 0) {
      state[key] = undefined;
      expiredFieldEffects.push(name);
    } else {
      state[key] = left - 1;
    }
  };
  countDown("wonderRoomTurnsRemaining", "wonderRoom");
  countDown("magicRoomTurnsRemaining", "magicRoom");
  countDown("gravityTurnsRemaining", "gravity");
  const expiredMagnetRise: FighterKey[] = [];
  for (const key of ["a", "b"] as const) {
    const f = state[key];
    if (f.magnetRiseTurnsRemaining === undefined) continue;
    f.magnetRiseTurnsRemaining -= 1;
    if (f.magnetRiseTurnsRemaining <= 0) {
      f.magnetRiseTurnsRemaining = undefined;
      if (!isFainted(f)) expiredMagnetRise.push(key);
    }
  }

  // 날씨도 같은 방식으로 카운트다운한다. weatherTurnsRemaining은 날씨가 아예 없을 때만
  // undefined이고, 특성/수동/기술 어느 경로로 걸렸든 항상 유한 턴수를 갖는다(챔피언스 규칙).
  let weatherExpired = false;
  if (state.weatherTurnsRemaining !== undefined) {
    state.weatherTurnsRemaining -= 1;
    if (state.weatherTurnsRemaining <= 0) {
      state.weather = undefined;
      state.weatherTurnsRemaining = undefined;
      weatherExpired = true;
      // 기분파(캐스퐁): 날씨가 사라지면 노말로 되돌린다.
      applyForecastForm(state.a, activeWeather(state));
      applyForecastForm(state.b, activeWeather(state));
    }
  }

  // 리플렉터/빛의장막/오로라베일은 필드/날씨와 달리 "양쪽 편이 따로" 걸릴 수 있어 각자
  // 카운트다운한다. 편(side) 단위 상태라 이번 턴 교체가 있었어도 그대로 이어서 줄어든다(§6-3).
  const expiredScreens: { actor: FighterKey; screen: "reflect" | "lightScreen" | "auroraVeil" }[] = [];
  for (const key of (["a", "b"] as const)) {
    const side = sideOf(state, key);
    for (const screenType of ["reflect", "lightScreen", "auroraVeil"] as const) {
      const remaining = side.screens[screenType];
      if (remaining === undefined) continue;
      const next = remaining - 1;
      if (next <= 0) {
        side.screens = { ...side.screens, [screenType]: undefined };
        expiredScreens.push({ actor: key, screen: screenType });
      } else {
        side.screens = { ...side.screens, [screenType]: next };
      }
    }
  }

  // 신비의부적(세이프가드)도 스크린과 같은 편 단위 카운트다운 — 종류가 하나뿐이라 배열은
  // "어느 편에서 사라졌는지"만 담는다.
  const expiredSafeguard: FighterKey[] = [];
  for (const key of (["a", "b"] as const)) {
    const side = sideOf(state, key);
    if (side.safeguardTurnsRemaining === undefined) continue;
    const next = side.safeguardTurnsRemaining - 1;
    if (next <= 0) {
      side.safeguardTurnsRemaining = undefined;
      expiredSafeguard.push(key);
    } else {
      side.safeguardTurnsRemaining = next;
    }
  }

  // 순풍(트랙 M1)도 같은 편 단위 카운트다운
  const expiredTailwind: FighterKey[] = [];
  for (const key of (["a", "b"] as const)) {
    const side = sideOf(state, key);
    if (side.tailwindTurnsRemaining === undefined) continue;
    const next = side.tailwindTurnsRemaining - 1;
    if (next <= 0) {
      side.tailwindTurnsRemaining = undefined;
      expiredTailwind.push(key);
    } else {
      side.tailwindTurnsRemaining = next;
    }
  }

  return {
    nextState: state,
    result: {
      turnNumber: state.turnNumber,
      order,
      actions,
      endOfTurn,
      winner,
      field: state.field,
      fieldTurnsRemaining: state.fieldTurnsRemaining,
      fieldExpired,
      trickRoomTurnsRemaining: state.trickRoomTurnsRemaining,
      trickRoomExpired,
      weatherTurnsRemaining: state.weatherTurnsRemaining,
      weatherExpired,
      expiredScreens,
      expiredSafeguard,
      expiredTailwind: expiredTailwind.length > 0 ? expiredTailwind : undefined,
      expiredFieldEffects: expiredFieldEffects.length > 0 ? expiredFieldEffects : undefined,
      expiredMagnetRise: expiredMagnetRise.length > 0 ? expiredMagnetRise : undefined,
      turnStartAnnouncements,
      switches,
      activePokemonIds: { a: state.a.slot.pokemonId, b: state.b.slot.pokemonId },
    },
    forcedSwitch,
  };
}
