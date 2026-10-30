import { type ChargeHideType, type Move } from "@/types/move";
import { isFixedAbility } from "./abilityChange";
import { isGrounded } from "./grounding";
import { type WeatherKind } from "@/types/weather";
import { type FieldKind } from "@/types/field";
import { type FighterKey, type HitAbilityEvent } from "@/types/battle";
import { NEUTRAL_STAGES, type BattleStatKey } from "@/types/battleStats";
import { type StatusConditionState, type VolatileCondition } from "@/types/status";
import { type Ability } from "@/types/ability";
import { type Item } from "@/types/item";
import { getItem, getMove } from "@/lib/data";
import { applyStageDelta } from "@/lib/statStages";
import { hitTriggerMatchesMove } from "@/lib/abilityHitTriggers";
import { critChance } from "@/lib/accuracyCrit";
import { burnDamageMultiplier, ignoresBurnAttackPenalty, statusedAttackBoost, inflictStatus, isImmuneToStatus } from "@/lib/statusConditions";
import { hasVolatile, inflictVolatile } from "@/lib/volatileConditions";
import { DAMAGE_ROLL_MIN_PERCENT, DAMAGE_ROLL_STEP_COUNT } from "@/lib/damageFormula";
import { computeDamage, hustleDamageMultiplier, screenMultiplierFromFlags, supremeOverlordMultiplier } from "@/lib/battlePower";
import { getWeatherDamageMultiplier, getWeatherDefenseMultiplier } from "@/lib/weatherEffects";
import { FIELD_DURATION, getFieldDamageMultiplier } from "@/lib/fieldEffects";
import { getBerryDefenseResult, getDrainHealMultiplier, getEnduranceResult, getItemCritStageBonus, getItemBasePowerMultiplier, getItemFinalMultiplier, getMentalHerbCureResult } from "@/lib/itemEffects";
import { STRUGGLE_MOVE, WEATHER_DURATION, activeWeather, applyMimicryForm, consumeItem, contraryDelta, isFainted, rollMultiHitCount, sideOf, statDropBlockStatsOf, statusImmunitiesOf, type BattleFighterState, type BattleState } from "./state";
import { triggerTerrainSeeds } from "./switching";

interface HitResolutionInput {
  state: BattleState;
  defenderKey: FighterKey;
  move: Move;
  effectiveMove: Move;
  random: () => number;
  attacker: BattleFighterState;
  defender: BattleFighterState;
  attackerAbility: Ability | undefined;
  defenderAbility: Ability | undefined;
  attackerItem: Item | undefined;
  defenderItem: Item | undefined;
  typeEffectiveness: number;
  blockedByProtect: boolean;
  blockedBySubstitute: boolean;
  unseenFistPiercing: boolean;
  hitChance: number | null;
  evadedByCharge: boolean;
  defenderHideType: ChargeHideType | undefined;
  gemMultiplier: number;
  ownMoveTypeBoostMultiplier: number;
  rivalryMultiplier: number;
  sheerForceAbilityName: string | undefined;
  defenderBerriesBlocked: boolean;
  abilityOffenseMultiplier: number;
  /** abilityOffenseMultiplier 중 공격 스탯 단계 몫(맹화류·선파워) — moveContext 참고 */
  statOffenseMultiplier: number;
  abilityDefenseMultiplier: number;
  /** abilityDefenseMultiplier 중 최종 보정 단계 몫(하드록·필터) — moveContext 참고 */
  finalDefenseMultiplier: number;
  stabMultiplier: number;
}

/** resolveHitAndApplyDamage의 단계 사이에서 공유되는 값 — 한 단계 안에서만 쓰는 변수는 각 단계 함수의 지역 변수다 */
interface HitCtx {
  state: BattleState;
  defenderKey: FighterKey;
  move: Move;
  effectiveMove: Move;
  random: () => number;
  attacker: BattleFighterState;
  defender: BattleFighterState;
  attackerAbility: Ability | undefined;
  defenderAbility: Ability | undefined;
  attackerItem: Item | undefined;
  defenderItem: Item | undefined;
  typeEffectiveness: number;
  blockedByProtect: boolean;
  blockedBySubstitute: boolean;
  unseenFistPiercing: boolean;
  hitChance: number | null;
  gemMultiplier: number;
  ownMoveTypeBoostMultiplier: number;
  rivalryMultiplier: number;
  sheerForceAbilityName: string | undefined;
  defenderBerriesBlocked: boolean;
  abilityOffenseMultiplier: number;
  statOffenseMultiplier: number;
  abilityDefenseMultiplier: number;
  finalDefenseMultiplier: number;
  stabMultiplier: number;
  isDamaging: boolean;
  berryReducedDamageItemName: string | undefined;
  damage: number;
  damagePercent: number;
  actualDamageDealt: number;
  isCritical: boolean;
  hitCount: number | undefined;
  perHitLog: | { damage: number; damagePercent: number; critical: boolean; abilityEvent?: HitAbilityEvent }[]
    | undefined;
  abilityInflictedStatusOnAttacker: StatusConditionState["condition"] | undefined;
  abilityInflictedStatusAbilityName: string | undefined;
  abilityInflictedVolatileOnAttacker: VolatileCondition | undefined;
  abilityInflictedVolatileAbilityName: string | undefined;
  abilityDamageToAttacker: number;
  abilityDamageAbilityName: string | undefined;
  rockyHelmetDamage: number;
  rockyHelmetItemName: string | undefined;
  defenderHpBeforeLastHit: number;
  abilityDisabledMoveName: string | undefined;
  abilityDisableAbilityName: string | undefined;
  pickpocketStolenItemName: string | undefined;
  pickpocketAbilityName: string | undefined;
  mummifiedAttackerAbilityName: string | undefined;
  abilityRaisedDefenderStatsAbilityName: string | undefined;
  abilityRaisedDefenderStats: { stat: BattleStatKey; delta: number }[];
  abilityLoweredDefenderStats: { stat: BattleStatKey; delta: number }[];
  abilityLoweredAttackerStatsAbilityName: string | undefined;
  abilityLoweredAttackerStats: { stat: BattleStatKey; delta: number }[];
  cheekPouchHeal: number;
  angerPointRaisedSpa: boolean;
  angerPointAbilityName: string | undefined;
  angerPointMaxedAbilityName: string | undefined;
  toxicDebrisAbilityName: string | undefined;
  wanderingSpiritSwapped: boolean;
  sandSpitWeather: WeatherKind | undefined;
  seedSowerField: FieldKind | undefined;
  terrainSeedMessages: string[];
  hidingBypassMultiplier: number;
  resolveHit: (hitMove: Move) => { damage: number; isCritical: boolean; };
  enduredItemName: string | undefined;
  enduredAbilityName: string | undefined;
  enduredProtectMoveName: string | undefined;
  applyEndurance: (preHp: number) => void;
  substituteBroke: boolean;
  hitSubstitute: boolean;
  statusCureBerryItemName: string | undefined;
  hitNegatedByAbilityName: string | undefined;
  disguiseRecoilDamage: number | undefined;
  illusionBrokenSpeciesId: string | undefined;
  destinyBondTriggered: boolean;
  applyDamageToDefender: (amount: number) => void;
  checkDestinyBond: () => void;
  applyContactItemRecoil: (hitDamage: number) => void;
  applyAngerPoint: (critical: boolean) => void;
  triggerAbilityHitEffect: (hitDamage: number) => HitAbilityEvent | undefined;
  endeavorDamage: number;
  crashDamage: number;
  canceledTargetChargeMoveName: string | undefined;
  counterDamage: number;
  counterFailed: boolean;
  followUpHitDamage: number;
  selfDamage: number;
  recoilDamage: number;
  itemRecoilDamage: number;
  itemRecoilItemName: string | undefined;
  drainHealAmount: number;
  liquidOozeDamage: number;
  liquidOozeAbilityName: string | undefined;
  shellBellHealAmount: number;
  stolenItemName: string | undefined;
}

/** 타 하나의 명중·급소·데미지 판정(다단히트 타마다 호출) */
function defineResolveHit(c: HitCtx) {

  /**
   * 한 번의 "타격"에 대한 급소 판정 + 데미지 계산. 다단히트 기술은 이걸 타수만큼 반복 호출해서
   * 급소를 타수마다 따로 굴린다(사용자 확인) — highCritRatio/alwaysCrit는 항상 원본 기술
   * (effectiveMove) 기준으로 판정하고, hitMove는 트리플악셀처럼 타수별 위력만 다를 때 쓴다.
   */
  c.resolveHit = function resolveHit(hitMove: Move): { damage: number; isCritical: boolean } {
    // 대운: 급소율 카운터가 상시 +raisesCritStageBy(1). 조가비갑옷/전투무장: 방어측이면 급소 자체가 안 뜬다(alwaysCrit 포함).
    const critStageForHit =
      c.attacker.critStage +
      getItemCritStageBonus(c.attackerItem, c.attacker.slot.pokemonId) +
      (c.attackerAbility?.raisesCritStageBy ?? 0);
    // 무도한행동: 방어측이 독/맹독이면 항상 급소(조가비갑옷/전투무장 등 방어측 급소 방지는 존중).
    const mercilessCrit =
      !!c.attackerAbility?.alwaysCritsVsPoisonedTarget &&
      (c.defender.status.condition === "poison" || c.defender.status.condition === "badly-poisoned");
    const critical =
      !c.defenderAbility?.preventsCritsAgainstSelf &&
      (c.effectiveMove.alwaysCrit ||
        mercilessCrit ||
        c.random() < critChance(critStageForHit, c.effectiveMove.highCritRatio));
    const ignoreBurnPenalty = ignoresBurnAttackPenalty(c.attackerAbility?.id, c.effectiveMove.id);
    const statusAttackMultiplier = statusedAttackBoost(
      c.attacker.status.condition,
      c.effectiveMove.category,
      c.attackerAbility?.physicalAttackMultiplierWhenStatused,
    );
    const burnMultiplier = burnDamageMultiplier(c.attacker.status.condition, c.effectiveMove.category, ignoreBurnPenalty);
    // 의욕(Hustle): 물리 기술 위력 ×1.5 (명중률 ×0.8은 위 accuracyExtraMultiplier에서 반영).
    const hustleMultiplier = hustleDamageMultiplier(c.effectiveMove.category, c.attackerAbility);
    // 총대장: 등장 시 센 쓰러진 같은 편 수만큼 위력 ×(1 + 0.1 × 수).
    const overlordMultiplier = supremeOverlordMultiplier(c.attackerAbility, c.attacker.supremeOverlordCount);
    // 메가솔라: 자신이 쓰는 기술의 날씨 배율을 항상 쾌청 기준으로(불꽃 ×1.5·물 ×0.5) 계산한다.
    const weatherMultiplier = getWeatherDamageMultiplier(
      c.attackerAbility?.treatsOwnWeatherAsSun ? "쾌청" : activeWeather(c.state),
      c.effectiveMove.type,
    );
    // 트랙 M4: 필드 타입 강화는 공격측이, 미스트필드 드래곤 반감은 방어측이 땅에 있을 때만
    const fieldMultiplier = getFieldDamageMultiplier(
      c.state.field,
      c.effectiveMove.type,
      isGrounded(c.state, c.attacker, c.attackerAbility),
      isGrounded(c.state, c.defender, c.defenderAbility),
    );
    const itemMultiplier = getItemBasePowerMultiplier(c.attackerItem, c.effectiveMove);
    const itemFinalMultiplier = getItemFinalMultiplier(c.attackerItem, c.typeEffectiveness, c.attacker.lastMoveStreak ?? 1);
    // 나무열매(카리열매 등): 이 피격이 조건(타입 일치 + 효과가 굉장함)을 채우면 데미지를
    // 절반으로 줄이고 대전 중 1회만 발동하도록 소모 처리한다. 다단히트면 첫 타에서만 소모되고,
    // 이후 타수는 이미 소모된 상태라 다시 발동하지 않는다.
    const berryResult = getBerryDefenseResult(
      c.defenderBerriesBlocked ? undefined : c.defenderItem,
      c.effectiveMove.type,
      c.typeEffectiveness,
      c.defender.itemConsumed ?? false,
      !!c.defenderAbility?.doublesBerryEffect, // 숙성
    );
    if (berryResult.consumed) {
      consumeItem(c.defender);
      c.berryReducedDamageItemName = c.defenderItem?.name;
    }

    // 리플렉터(물리)/빛의장막(특수)/오로라베일(물리·특수 둘 다): 방어측 편(side)에 스크린이
    // 걸려있으면 데미지 반감(§6-3 — 편 단위라 교체해도 유지). 급소는 스크린을 무시한다(본가 규칙)
    // — bulkMultiplier는 나눗셈이라 2를 곱하면 절반이 된다. 틈새포착이면 스크린 자체를 아예
    // 무시한다(급소 판정과 별개로 항상 1배). 오로라베일은 카테고리 전용 스크린과 별개 축이라
    // 둘 다 걸려있으면 곱으로 중첩된다. (여기까지 매직미러 반사 스왑 전이라 defenderKey가 정확.)
    const defenderScreens = sideOf(c.state, c.defenderKey).screens;
    const screenType = c.effectiveMove.category === "physical" ? "reflect" : "lightScreen";
    const screenBypassed = !!c.attackerAbility?.bypassesScreensAndSubstitute || critical;
    const categoryScreenActive = !screenBypassed && defenderScreens[screenType] !== undefined;
    const auroraVeilActive = !screenBypassed && defenderScreens.auroraVeil !== undefined;
    const screenMultiplier = screenMultiplierFromFlags(categoryScreenActive, auroraVeilActive);

    // 관통드릴: 접촉기일 때만 상대 방어/특방 랭크의 "상승분"을 무시한다(날카로운눈의 회피율
    // 처리와 같은 패턴 — 마이너스 랭크는 그대로 페널티로 받는다). 천진(전부 무시)과 겹치면
    // 천진 쪽이 이미 NEUTRAL_STAGES라 이 클램프는 자연히 아무 효과가 없다.
    // 사이코쇼크류(hitsDefensiveStat)는 실제 데미지에 쓰는 방어 스탯이 분류 기본값과 다르므로
    // 그 축(=computeDamage가 실제로 읽는 축)에 클램프를 맞춘다.
    const contactDefenseStat: BattleStatKey =
      c.effectiveMove.hitsDefensiveStat ?? (c.effectiveMove.category === "physical" ? "def" : "spd");
    const contactIgnoresDefenseBoost =
      (c.effectiveMove.makesContact ?? false) &&
      c.attackerAbility?.contactIgnoresDefenseBoostAndGuaranteesMinDamageFraction !== undefined;
    // 성스러운칼: 천진(특성)과 정확히 같은 축이지만 기술 단위 효과라 여기서 같이 확인한다.
    const baseDefenderStages =
      c.attackerAbility?.ignoresOpponentStatStagesInDamage || c.effectiveMove.ignoresDefenderStatStagesInDamage
        ? NEUTRAL_STAGES
        : c.defender.stages;
    const defenderStagesForDamage =
      contactIgnoresDefenseBoost && baseDefenderStages[contactDefenseStat] > 0
        ? { ...baseDefenderStages, [contactDefenseStat]: 0 }
        : baseDefenderStages;

    // 원더룸(트랙 M4): 방어·특방 실능을 맞바꿔 받는다(랭크는 그대로)
    const defenderStatsForDamage =
      c.state.wonderRoomTurnsRemaining !== undefined
        ? { ...c.defender.realStats, def: c.defender.realStats.spd, spd: c.defender.realStats.def }
        : c.defender.realStats;
    const result = computeDamage(c.attacker.realStats, defenderStatsForDamage, c.attacker.types, hitMove, {
      typeEffectiveness: c.typeEffectiveness,
      abilityMultiplier:
        (c.abilityOffenseMultiplier / c.statOffenseMultiplier) *
        statusAttackMultiplier *
        c.hidingBypassMultiplier *
        c.ownMoveTypeBoostMultiplier *
        c.rivalryMultiplier *
        hustleMultiplier *
        overlordMultiplier,
      attackStatMultiplier: c.statOffenseMultiplier,
      weatherMultiplier,
      fieldMultiplier,
      itemMultiplier: itemMultiplier * c.gemMultiplier,
      stabMultiplier: c.stabMultiplier,
      // 천진: 자신이 이 특성이면 상대 쪽 랭크(공격측이면 상대 방어/특방, 방어측이면 상대
      // 공격/특공)를 전부 무시(0랭크 취급) — computeDamage는 카테고리에 맞는 스탯 하나만
      // 읽으므로 NEUTRAL_STAGES를 통째로 넘겨도 안전하다. 자신의 랭크는 그대로 반영된다.
      attackerStages: c.defenderAbility?.ignoresOpponentStatStagesInDamage ? NEUTRAL_STAGES : c.attacker.stages,
      defenderStages: defenderStagesForDamage,
      // 방어 스탯 단계 배율(두꺼운지방 등). 하드록·필터는 최종 단계라 뺀다(2.4 B3).
      bulkMultiplier:
        (c.abilityDefenseMultiplier / c.finalDefenseMultiplier) *
        // 모래바람 바위 특방·눈 얼음 방어 1.5배(날씨 무효 특성이면 activeWeather가 없음)
        getWeatherDefenseMultiplier(activeWeather(c.state), c.defender.types, contactDefenseStat),
      // 최종 보정 단계(상성 뒤): 도구(생명의구슬·달인의띠)·화상 ×데미지, 하드록·반감 열매·벽·대검돌격(방어측 약점 상태면 받는 데미지 2배)은
      // 내구력 배율 형태라 역수로 곱한다.
      finalMultiplier:
        (itemFinalMultiplier * burnMultiplier) /
        (c.finalDefenseMultiplier * berryResult.bulkMultiplier * screenMultiplier * (c.defender.glaiveRushVulnerable ? 0.5 : 1)),
      isCritical: critical,
      // 스나이퍼: 급소 데미지 배율을 2.25로 올린다(기본 1.5).
      critDamageMultiplier: c.attackerAbility?.critDamageMultiplier,
      // 난수는 본가처럼 85~100% 정수 16단계
      randomRoll: (DAMAGE_ROLL_MIN_PERCENT + Math.floor(c.random() * DAMAGE_ROLL_STEP_COUNT)) / 100,
    });
    let hitDamage = result?.damage ?? 0;
    // 관통드릴: 접촉기가 명중(면역 제외)했는데 데미지가 상대 최대 HP의 지정 비율보다 낮으면
    // 그 비율만큼으로 끌어올린다(최소 데미지 보장).
    if (contactIgnoresDefenseBoost && c.typeEffectiveness !== 0) {
      const minDamage = Math.floor(
        c.defender.maxHp * c.attackerAbility!.contactIgnoresDefenseBoostAndGuaranteesMinDamageFraction!,
      );
      if (hitDamage < minDamage) hitDamage = minDamage;
    }
    // 보이지않는주먹: 방어류를 뚫고 들어간 접촉기는 데미지가 1/4로 줄어든다.
    if (c.unseenFistPiercing) hitDamage = Math.floor(hitDamage * 0.25);
    return { damage: hitDamage, isCritical: critical };
  };
}

/** 기합의띠·버티기 등 버티는 효과와 이번 행동의 상태 기록 변수 */
function defineEnduranceHelpers(c: HitCtx) {

  // 기합의띠(최대 HP 상태에서만, 1회)·기합의머리띠(조건 없이 매번 확률): 이번 데미지로 정확히
  // 기절했을 때만(currentHp가 0이 됐을 때만) 판정 대상이 된다. preHp는 이번 데미지를 받기
  // 직전 HP — 기합의띠의 "최대 HP 상태" 조건과 애초에 죽어있던 게 아니었는지 확인에 쓴다.
  // 다단히트 루프 안에서 타수마다 호출되므로, 한 타에서 버텨도 다음 타에서 다시 죽을 수 있고
  // (기합의머리띠는 매번 재판정, 기합의띠는 이미 소모돼 두 번은 못 버팀) 그건 본가와 동일하다.



  c.applyEndurance = function applyEndurance(preHp: number): void {
    if (c.defender.currentHp > 0 || preHp <= 0) return;
    const result = getEnduranceResult(c.defenderItem, preHp, c.defender.maxHp, c.defender.itemConsumed ?? false, c.random);
    if (result.survives) {
      c.defender.currentHp = 1;
      c.enduredItemName = c.defenderItem?.name;
      if (result.consumes) consumeItem(c.defender);
      return;
    }
    // 옹골참: 기합의띠와 조건은 같지만(최대 HP 상태) 소모되지 않아 매번 다시 판정한다.
    if (c.defenderAbility?.survivesLethalAtFullHp && preHp === c.defender.maxHp) {
      c.defender.currentHp = 1;
      c.enduredAbilityName = c.defenderAbility.name;
      return;
    }
    // 버티기(protectEffect: "endure"): 기합의띠·옹골참과 달리 풀피 조건 없이 이번 턴엔
    // 무조건 버틴다 — 방어류 공용 성공 확률(protectStreak)로 이미 발동 여부가 갈렸으니
    // 여기 도달했다는 건 이번 턴 발동에 성공했다는 뜻이다.
    if (c.defender.activeProtect?.effect === "endure") {
      c.defender.currentHp = 1;
      c.enduredProtectMoveName = c.defender.activeProtect.moveName;
    }
  };

  // 대타출동: blockedBySubstitute(=대타가 있고 소리 계열이 아님)면 데미지를 실제 HP가 아니라
  // 대타 HP에서 깎는다. 대타 HP를 넘는 초과분은 그냥 사라진다(본가 규칙 — 실제 HP로 안 넘어옴).
  // 대타가 이번 타격으로 다 깎였으면 그 즉시 사라지고, 다단히트 루프는 이 시점에서 멈춰야 한다
  // (기절과 같은 축 — substituteBroke를 그 판정에 같이 쓴다).
  c.substituteBroke = false;
  c.hitSubstitute = false;
  // 도구 발동 시 UI에 표시할 이름(상태이상/혼란/헤롱헤롱/도발/사슬묶기/앙코르 즉시치료 나무열매·
  // 멘탈허브 등) — triggerAbilityHitEffect(헤롱헤롱바디)가 이 변수를 참조하므로 그 정의보다
  // 앞에 선언해야 한다(TDZ 회피).

  // 탈(Disguise): 배틀 중 처음 데미지를 입는 순간에만 발동(disguiseBroken이 아직 false일 때).


  // 일루전(§6-1): 이번 행동으로 방어측 조로아크의 위장이 풀렸으면 그 조로아크의 진짜 종 id.

  // 길동무: 데미지 적용 직후 판정하지만, 기합의띠/옹골참/버티기(applyEndurance)로 HP 1로 버텨낸
  // 경우는 애초에 안 쓰러진 것이므로 발동하면 안 된다 — applyEndurance까지 다 끝난 뒤에 판정해야
  // 한다(checkDestinyBond를 별도 호출로 분리한 이유). 다단히트 도중 이미 발동했으면 재판정 안 함.
  c.destinyBondTriggered = false;
}

/** 방어측에 데미지 적용·길동무·울퉁불퉁멧 반동·분노의경혈 */
function defineDamageHelpers(c: HitCtx) {
  c.applyDamageToDefender = function applyDamageToDefender(amount: number): void {
    if (c.blockedBySubstitute && c.defender.substituteHp !== undefined) {
      c.hitSubstitute = true;
      const substituteHpBefore = c.defender.substituteHp;
      c.defender.substituteHp = Math.max(0, c.defender.substituteHp - amount);
      c.actualDamageDealt += substituteHpBefore - c.defender.substituteHp;
      if (c.defender.substituteHp <= 0) {
        c.defender.substituteHp = undefined;
        c.substituteBroke = true;
      }
      return;
    }
    // 탈: 대타를 맞힌 게 아니라 실제로 HP를 깎으려는 순간에만 판정한다(대타가 있는 동안은
    // 애초에 위 분기에서 return하므로 여기 안 옴). 다단히트는 첫 타에서만 발동하고, 벗겨진
    // 뒤의 나머지 타수는 이 블록을 건너뛰어 정상적으로 실제 HP를 깎는다(disguiseBroken=true).
    if (amount > 0 && c.defenderAbility?.negatesFirstHitThenRecoils && !c.defender.disguiseBroken) {
      c.defender.disguiseBroken = true;
      c.hitNegatedByAbilityName = c.defenderAbility.name;
      c.disguiseRecoilDamage = Math.floor(c.defender.maxHp * c.defenderAbility.negatesFirstHitThenRecoils.recoilFraction);
      c.defender.currentHp = Math.max(0, c.defender.currentHp - c.disguiseRecoilDamage);
      return;
    }
    const hpBeforeThisHit = c.defender.currentHp;
    c.defenderHpBeforeLastHit = hpBeforeThisHit;
    c.defender.currentHp = Math.max(0, c.defender.currentHp - amount);
    c.actualDamageDealt += hpBeforeThisHit - c.defender.currentHp;
    // 미러코트/카운터용: 실제 HP로 받은 데미지를 카테고리별로 누적(대타 흡수분은 위에서 이미
    // return되어 제외). effectiveMove가 아니라 hitMove로 넘어와도 카테고리는 동일하다.
    if (amount > 0 && (c.effectiveMove.category === "physical" || c.effectiveMove.category === "special") && c.defender.damageTakenThisTurn) {
      c.defender.damageTakenThisTurn[c.effectiveMove.category] += amount;
    }
    // 분노의주먹(Move.rageFistPower)용: 이 포켓몬이 기술로 데미지를 받은 누적 횟수(다단히트는 타수만큼).
    if (amount > 0) {
      c.defender.timesHitByMoves = (c.defender.timesHitByMoves ?? 0) + 1;
    }
    // 일루전(§6-1): 기술 데미지를 실제로 받는 순간 위장이 풀린다. 다단히트면 첫 타에서만 로그를 낸다.
    if (amount > 0 && c.defender.illusionAs && c.defenderAbility?.illusion) {
      c.defender.illusionAs = undefined;
      c.illusionBrokenSpeciesId = c.defender.slot.pokemonId;
    }
    // 전기로바꾸기(Electromorphosis): 기술 데미지를 받으면 충전 상태가 된다(다음 전기 기술 위력 2배).
    if (amount > 0 && c.defenderAbility?.chargesOnDamageTaken && !isFainted(c.defender)) {
      c.defender.electroChargedForElectric = true;
    }
    // 발끈(포챔스판): 상대 기술 데미지로 HP가 처음으로 절반 이하가 되는 그 순간 특수공격 +1.
    // 여기(applyDamageToDefender)는 기술 데미지 경로 전용이라 모래바람·독·설치물은 자연히 제외된다.
    if (
      amount > 0 &&
      c.defenderAbility?.raisesSpaWhenHalvedByMoveDamage &&
      !isFainted(c.defender) &&
      hpBeforeThisHit * 2 > c.defender.maxHp &&
      c.defender.currentHp * 2 <= c.defender.maxHp
    ) {
      const before = c.defender.stages.spa;
      c.defender.stages = applyStageDelta(c.defender.stages, "spa", contraryDelta(c.defender, 1));
      if (c.defender.stages.spa !== before) {
        c.angerPointRaisedSpa = true;
        c.angerPointAbilityName = c.defenderAbility.name;
      }
    }
  };

  /**
   * 길동무: applyDamageToDefender + applyEndurance까지 끝난 뒤(=기합의띠·옹골참·버티기로도 못
   * 버티고 실제로 쓰러졌는지가 확정된 뒤) 호출한다. 상대(defender)가 길동무 예약 상태였는데
   * 이번 공격으로 실제 기절했으면, 공격자(attacker)도 그 자리에서 같이 기절시킨다 — 간접
   * 데미지(상태이상·씨뿌리기 등)는 이 함수를 거치는 데미지 경로 자체가 아니라서 자연히 대상이
   * 아니다(본가 규칙과 일치).
   */
  c.checkDestinyBond = function checkDestinyBond(): void {
    if (c.destinyBondTriggered || c.defender.currentHp > 0 || !c.defender.destinyBondArmed) return;
    c.attacker.currentHp = 0;
    c.defender.destinyBondArmed = false;
    c.destinyBondTriggered = true;
  };

  /**
   * 방어측 hitTrigger 특성 한 번의 "타격"에 대한 판정. 다단히트 기술은 타수마다 이 함수를
   * 다시 호출해서 확률(chance)을 매번 새로 굴린다 — 정전기/불꽃몸이 트리플악셀 3타에 각각
   * 별도로 마비/화상을 노릴 수 있고, 까칠한피부/저주받은바디도 타수만큼 반복 발동한다.
   * hitDamage가 0(면역 등)이면 애초에 판정하지 않는다. 공격자가 이미 기절했으면(예: 앞선
   * 타에서 까칠한피부 반동으로 죽었으면) 더 이상 판정하지 않는다. 대타를 맞혔을 때도 발동하지
   * 않는다 — 본가 규칙: 접촉은 대타(인형)에 닿은 것이라 실제 상대에게 닿은 게 아니다.
   */
  /**
   * 울퉁불퉁멧(Item.contactAttackerDamageDenominator): 방어측이 이 도구를 지녔고 이번 타가
   * 접촉기면 공격자가 최대 HP를 이 값으로 나눈 만큼 데미지를 입는다. 까칠한피부와 같은 축이지만
   * 특성이 아니라 도구라 triggerAbilityHitEffect(hitTrigger 전용)와 분리했다 — 그 함수와 같은
   * 지점마다 나란히 호출된다. 매직가드 공격자·대타로 흡수된 타는 무효.
   */
  c.applyContactItemRecoil = function applyContactItemRecoil(hitDamage: number): void {
    if (hitDamage <= 0 || isFainted(c.attacker) || c.blockedBySubstitute) return;
    const denom = c.defenderItem?.contactAttackerDamageDenominator;
    if (!denom || !(c.effectiveMove.makesContact ?? false) || c.attackerAbility?.negatesIndirectDamage) return;
    const amount = Math.floor(c.attacker.maxHp / denom);
    if (amount <= 0) return;
    c.attacker.currentHp = Math.max(0, c.attacker.currentHp - amount);
    c.rockyHelmetDamage += amount;
    c.rockyHelmetItemName = c.defenderItem!.name;
  };

  /** 분노의경혈(ver.1.9 A5): 급소에 맞았고 쓰러지지 않았으면(대타가 아닐 때) 공격 +6 */
  c.applyAngerPoint = function applyAngerPoint(critical: boolean): void {
    if (!critical || c.hitSubstitute || isFainted(c.defender) || !c.defenderAbility?.maxesAttackOnCrit || c.defender.stages.atk >= 6) return;
    c.defender.stages = { ...c.defender.stages, atk: 6 };
    c.angerPointMaxedAbilityName = c.defenderAbility.name;
  };
}

/** 방어측 접촉/피격 트리거 특성(정전기·불꽃몸·까칠한피부 등)의 반응 */
function defineAbilityHitEffect(c: HitCtx) {

  c.triggerAbilityHitEffect = function triggerAbilityHitEffect(hitDamage: number): HitAbilityEvent | undefined {
    if (hitDamage <= 0 || isFainted(c.attacker) || c.blockedBySubstitute) return undefined;
    const trigger = c.defenderAbility?.hitTrigger;
    if (!trigger) return undefined;
    const chance = trigger.chance !== undefined ? trigger.chance / 100 : 1;
    if (!hitTriggerMatchesMove(trigger, c.effectiveMove) || c.random() >= chance) return undefined;

    // 이번 호출(=이 한 타)에서 방어측 특성이 한 일 — 다단히트 로그를 타별로 찍는 데 쓴다.
    // 기존 집계 변수(abilityRaisedDefenderStats 등)는 그대로 두고 여기에 병렬로 담기만 한다.
    const ev: HitAbilityEvent = { abilityName: c.defenderAbility!.name };
    let evAny = false;

    if (
      trigger.inflictsStatusOnAttacker &&
      !isImmuneToStatus(trigger.inflictsStatusOnAttacker, c.attacker.types, statusImmunitiesOf(c.attacker, c.attackerAbility))
    ) {
      const before = c.attacker.status.condition;
      c.attacker.status = inflictStatus(c.attacker.status, trigger.inflictsStatusOnAttacker);
      if (c.attacker.status.condition !== before) {
        c.abilityInflictedStatusOnAttacker = c.attacker.status.condition;
        c.abilityInflictedStatusAbilityName = c.defenderAbility!.name;
        ev.statusOnAttacker = c.attacker.status.condition;
        evAny = true;
      }
    }
    // 포자(ver.1.9 A5): 독·마비·잠듦 중 무작위 하나 — 풀 타입(가루 면역)은 무효
    const randomStatuses = trigger.inflictsRandomStatusOnAttacker;
    if (randomStatuses?.length && !c.attacker.types.includes("풀")) {
      const pick = randomStatuses[Math.min(randomStatuses.length - 1, Math.floor(c.random() * randomStatuses.length))];
      if (!isImmuneToStatus(pick, c.attacker.types, statusImmunitiesOf(c.attacker, c.attackerAbility))) {
        const before = c.attacker.status.condition;
        c.attacker.status = inflictStatus(c.attacker.status, pick);
        if (c.attacker.status.condition !== before) {
          c.abilityInflictedStatusOnAttacker = c.attacker.status.condition;
          c.abilityInflictedStatusAbilityName = c.defenderAbility!.name;
          ev.statusOnAttacker = c.attacker.status.condition;
          evAny = true;
        }
      }
    }
    // 독치장(ver.1.9 A5): 공격자 편에 독압정 한 층(최대 2층)
    if (trigger.setsToxicSpikesOnAttackerSide) {
      const attackerSide = sideOf(c.state, c.defenderKey === "a" ? "b" : "a");
      if (attackerSide.hazards.toxicSpikesLayers < 2) {
        attackerSide.hazards = { ...attackerSide.hazards, toxicSpikesLayers: attackerSide.hazards.toxicSpikesLayers + 1 };
        c.toxicDebrisAbilityName = c.defenderAbility!.name;
        evAny = true;
      }
    }
    // 헤롱헤롱바디: 접촉해 온 공격자와 이성 관계일 때만(무성별이거나 동성이면 조용히 무산) 공격자에게
    // 헤롱헤롱을 건다. 이미 헤롱헤롱 상태면 본가처럼 재발동하지 않는다.
    if (
      trigger.inflictsVolatileOnAttacker &&
      !(trigger.requiresOppositeGender && (c.attacker.gender === null || c.defender.gender === null || c.attacker.gender === c.defender.gender)) &&
      !hasVolatile(c.attacker.volatile, trigger.inflictsVolatileOnAttacker) &&
      // 아로마베일: 접촉기를 쓴 공격자가 이 특성이면 헤롱헤롱바디의 헤롱헤롱이 걸리지 않는다.
      !(
        (trigger.inflictsVolatileOnAttacker === "attract" || trigger.inflictsVolatileOnAttacker === "taunt") &&
        (c.attackerAbility?.blocksMentalMoves || c.attackerAbility?.immuneToAttractAndTaunt)
      )
    ) {
      c.attacker.volatile = inflictVolatile(c.attacker.volatile, trigger.inflictsVolatileOnAttacker, c.random);
      c.abilityInflictedVolatileOnAttacker = trigger.inflictsVolatileOnAttacker;
      c.abilityInflictedVolatileAbilityName = c.defenderAbility!.name;
      ev.volatileOnAttacker = trigger.inflictsVolatileOnAttacker;
      evAny = true;
      // 멘탈허브: 헤롱헤롱바디로 걸린 헤롱헤롱도 걸리는 순간 치료하고 소모된다.
      if (getMentalHerbCureResult(c.attackerItem, c.attacker.itemConsumed ?? false)) {
        c.attacker.volatile = { active: { ...c.attacker.volatile.active } };
        delete c.attacker.volatile.active[trigger.inflictsVolatileOnAttacker];
        consumeItem(c.attacker);
        c.statusCureBerryItemName = c.attackerItem!.name;
        c.abilityInflictedVolatileOnAttacker = undefined;
        c.abilityInflictedVolatileAbilityName = undefined;
        ev.volatileOnAttacker = undefined;
      }
    }
    // 매직가드: 까칠한피부·유폭류가 공격자에게 되돌리는 접촉 반사 데미지는 "공격기 데미지"가
    // 아니라서 무효화된다(공격자가 매직가드일 때).
    if (trigger.damagesAttackerFraction && !c.attackerAbility?.negatesIndirectDamage) {
      const amount = Math.floor(c.attacker.maxHp * trigger.damagesAttackerFraction);
      c.attacker.currentHp = Math.max(0, c.attacker.currentHp - amount);
      c.abilityDamageToAttacker += amount;
      c.abilityDamageAbilityName = c.defenderAbility!.name;
      ev.damageToAttacker = (ev.damageToAttacker ?? 0) + amount;
      evAny = true;
    }
    if (trigger.selfStatChanges) {
      for (const change of trigger.selfStatChanges) {
        const before = c.defender.stages[change.stat];
        c.defender.stages = applyStageDelta(c.defender.stages, change.stat, contraryDelta(c.defender, change.delta));
        const after = c.defender.stages[change.stat];
        // 실제로 변한 것만 로그에 남긴다(이미 상·하한이라 그대로면 조용히 무산). 다단히트면 폭 누적.
        // 깨어진갑옷은 한 번 발동에 방어 -1 / 스피드 +2가 같이 오므로 오름·내림을 각자 담는다.
        if (after !== before) {
          c.abilityRaisedDefenderStatsAbilityName = c.defenderAbility!.name;
          const bucket = after > before ? c.abilityRaisedDefenderStats : c.abilityLoweredDefenderStats;
          const magnitude = Math.abs(after - before);
          const existing = bucket.find((s) => s.stat === change.stat);
          if (existing) existing.delta += magnitude;
          else bucket.push({ stat: change.stat, delta: magnitude });
          const evBucket =
            after > before
              ? (ev.raisedDefenderStats ??= [])
              : (ev.loweredDefenderStats ??= []);
          evBucket.push({ stat: change.stat, delta: magnitude });
          evAny = true;
        }
      }
    }
    // 넘치는씨(setsFieldOnHit): 데미지를 주는 기술로 피격당하면 필드를 그래스필드로 바꾼다(5턴).
    // 이미 같은 필드면 아무 일도 안 하고, 다른 필드면 덮어쓴다(본가).
    if (trigger.setsFieldOnHit && c.state.field !== trigger.setsFieldOnHit) {
      c.state.field = trigger.setsFieldOnHit;
      c.state.fieldTurnsRemaining = FIELD_DURATION;
      applyMimicryForm(c.attacker, c.state.field);
      applyMimicryForm(c.defender, c.state.field);
      c.seedSowerField = trigger.setsFieldOnHit;
      ev.setFieldOnHit = trigger.setsFieldOnHit;
      evAny = true;
      c.terrainSeedMessages.push(...triggerTerrainSeeds(c.state));
    }
    // 미끈미끈·점착(attackerStatChanges): 접촉해 온 공격자의 랭크를 내린다. 공격자의 클리어바디류
    // (blocksOpponentStatDropsForStats)·심술꾸러기(contraryDelta)는 그대로 존중한다. 미러아머 반사는
    // 이 로스터에 대상 조합이 없어 생략(공격자가 미러아머면 그냥 정상 하락).
    if (trigger.attackerStatChanges) {
      const blocked = statDropBlockStatsOf(c.attacker, c.attackerAbility);
      for (const change of trigger.attackerStatChanges) {
        if (blocked?.includes(change.stat)) continue;
        const before = c.attacker.stages[change.stat];
        c.attacker.stages = applyStageDelta(c.attacker.stages, change.stat, contraryDelta(c.attacker, change.delta));
        const after = c.attacker.stages[change.stat];
        if (after !== before) {
          c.abilityLoweredAttackerStatsAbilityName = c.defenderAbility!.name;
          const magnitude = Math.abs(after - before);
          const existing = c.abilityLoweredAttackerStats.find((s) => s.stat === change.stat);
          if (existing) existing.delta += magnitude;
          else c.abilityLoweredAttackerStats.push({ stat: change.stat, delta: magnitude });
          (ev.loweredAttackerStats ??= []).push({ stat: change.stat, delta: magnitude });
          evAny = true;
        }
      }
    }
    if (trigger.disablesAttackerMove && c.attacker.remainingPp[c.move.id] !== undefined) {
      c.attacker.remainingPp[c.move.id] = 0;
      c.abilityDisabledMoveName = c.move.name;
      c.abilityDisableAbilityName = c.defenderAbility!.name;
      ev.disabledMoveName = c.move.name;
      evAny = true;
    }
    // 나쁜손버릇: 피격측(defender)이 무도구이고 공격자(attacker)가 도구를 지녔으면 그 자리에서 강탈한다.
    // 매지션과 방향만 반대고 규칙은 동일 — 대타에 맞았을 때는 함수 진입부 가드(blockedBySubstitute)에서
    // 이미 걸러진다. 다단히트여도 첫 타에 도구를 얻는 순간 !defender.currentItemId가 깨져 재발동하지 않는다.
    // 점착: 공격자가 이 특성이면 나쁜손버릇에 도구를 빼앗기지 않는다.
    if (
      trigger.stealsAttackerItem &&
      !c.defender.currentItemId &&
      c.attacker.currentItemId &&
      !c.attackerAbility?.preventsItemLoss
    ) {
      const stolen = getItem(c.attacker.currentItemId);
      c.pickpocketStolenItemName = stolen?.name;
      c.pickpocketAbilityName = c.defenderAbility!.name;
      c.defender.currentItemId = c.attacker.currentItemId;
      c.defender.itemConsumed = false; // 새로 얻은 도구라 이전 소모 이력과 무관하게 쓸 수 있다
      c.attacker.currentItemId = null;
      ev.pickpocketStolenItemName = stolen?.name;
      evAny = true;
    }
    // 미라(Mummy): 접촉기로 피격당하면 공격자의 특성을 미라로 바꾼다. 이미 그 특성이면 무발동.
    if (
      trigger.setsAttackerAbilityId &&
      c.attacker.effectiveAbilityId !== trigger.setsAttackerAbilityId &&
      !isFixedAbility(c.attacker.effectiveAbilityId)
    ) {
      c.attacker.effectiveAbilityId = trigger.setsAttackerAbilityId;
      c.mummifiedAttackerAbilityName = c.defenderAbility!.name;
      ev.mummifiedAttackerAbilityName = c.defenderAbility!.name;
      evAny = true;
    }
    // 떠도는영혼(Wandering Spirit): 접촉기로 피격당하면 공격자와 특성을 맞바꾼다.
    if (
      trigger.swapsAbilityWithAttacker &&
      c.attacker.effectiveAbilityId !== c.defender.effectiveAbilityId &&
      !isFixedAbility(c.attacker.effectiveAbilityId)
    ) {
      const tmp = c.attacker.effectiveAbilityId;
      c.attacker.effectiveAbilityId = c.defender.effectiveAbilityId;
      c.defender.effectiveAbilityId = tmp;
      c.wanderingSpiritSwapped = true;
      ev.wanderingSpiritSwapped = true;
      evAny = true;
    }
    // 모래뿜기(Sand Spit): 데미지를 주는 기술로 피격당하면 날씨를 5턴짜리로 바꾼다(맞을 때마다).
    if (trigger.setsWeather && c.state.weather !== trigger.setsWeather) {
      c.state.weather = trigger.setsWeather;
      c.state.weatherTurnsRemaining = WEATHER_DURATION;
      c.sandSpitWeather = trigger.setsWeather;
      ev.sandSpitWeather = trigger.setsWeather;
      evAny = true;
    }
    // 유폭(Aftermath): 접촉기로 이 포켓몬이 쓰러진 그 순간 공격자에게 공격자 최대 HP 비율만큼 데미지.
    if (
      trigger.damagesContactAttackerFractionOnFaint &&
      isFainted(c.defender) &&
      !c.attackerAbility?.negatesIndirectDamage
    ) {
      const amount = Math.floor(c.attacker.maxHp * trigger.damagesContactAttackerFractionOnFaint);
      c.attacker.currentHp = Math.max(0, c.attacker.currentHp - amount);
      c.abilityDamageToAttacker += amount;
      c.abilityDamageAbilityName = c.defenderAbility!.name;
      ev.damageToAttacker = (ev.damageToAttacker ?? 0) + amount;
      evAny = true;
    }
    // 내용물분출: 기술로 쓰러진 순간, 그 마지막 타를 맞기 직전 남아 있던 HP만큼을 공격자에게 되돌린다.
    if (
      trigger.damagesAttackerByRemainingHpOnFaint &&
      isFainted(c.defender) &&
      !c.attackerAbility?.negatesIndirectDamage
    ) {
      const amount = Math.min(c.attacker.currentHp, c.defenderHpBeforeLastHit);
      if (amount > 0) {
        c.attacker.currentHp = Math.max(0, c.attacker.currentHp - amount);
        c.abilityDamageToAttacker += amount;
        c.abilityDamageAbilityName = c.defenderAbility!.name;
        ev.damageToAttacker = (ev.damageToAttacker ?? 0) + amount;
        evAny = true;
      }
    }

    return evAny ? ev : undefined;
  };
}

/** 방어류·대타 등으로 막히면 건너뛰고, 아니면 타를 굴려 데미지 적용. 죽기살기·무릎차기 포함 */
function resolveMainHit(c: HitCtx) {

  // 방어/판별/킹실드가 성공했으면 데미지 계산 자체를 건너뛴다(대타처럼 흡수하는 게 아니라
  // 그냥 0으로 만든다) — 아래 세 분기 전부 이 가드로 묶는다.
  if (c.isDamaging && !c.blockedByProtect && c.effectiveMove.fixedDamage !== undefined) {
    // 나이트헤드류: 방어/랭크/특성/도구/급소를 전부 무시하고 고정 수치만 깎는다.
    // 타입 상성 면역(0배)만은 그대로 존중 — 반감/2배는 적용하지 않는다.
    c.damage = c.typeEffectiveness === 0 ? 0 : c.effectiveMove.fixedDamage;
    c.damagePercent = c.damage / c.defender.realStats.hp;
    {
      const preHp = c.defender.currentHp;
      c.applyDamageToDefender(c.damage);
      c.applyEndurance(preHp);
      c.triggerAbilityHitEffect(c.damage);
      c.applyContactItemRecoil(c.damage);
    }
  } else if (c.isDamaging && !c.blockedByProtect && c.effectiveMove.minHits !== undefined && c.effectiveMove.maxHits !== undefined) {
    // 다단히트: 명중 판정은 이미 위(첫 타 기준)에서 끝났으니 여기부턴 최소 1타는 맞은 상태로
    // 시작한다. 록블라스트류(multiHitPowers 없음)는 첫 타만 명중 판정하고 나머지는 자동 명중,
    // 트리플악셀(multiHitPowers 있음)은 타수마다 따로 명중을 판정해서 빗나가면 그 시점에서
    // 중단된다 — moves.json의 effect 텍스트에 이미 명시된 구분(사용자 확인). 급소는 다단히트
    // 종류와 무관하게 항상 타수마다 따로 판정한다(사용자 확인).
    const perHitAccuracyCheck = c.effectiveMove.multiHitPowers !== undefined;
    // 스킬링크: 2~5회 연속기를 항상 최대 횟수로 고정한다.
    const totalHits =
      perHitAccuracyCheck || c.attackerAbility?.multiHitAlwaysMax
        ? c.effectiveMove.maxHits
        : rollMultiHitCount(c.effectiveMove.minHits, c.effectiveMove.maxHits, c.random);

    let landed = 0;
    c.perHitLog = [];
    for (let i = 0; i < totalHits; i++) {
      if (i > 0 && perHitAccuracyCheck) {
        const stillHits = c.hitChance === null ? true : c.random() < c.hitChance;
        if (!stillHits) break;
      }
      const hitPower = c.effectiveMove.multiHitPowers?.[i] ?? c.effectiveMove.power;
      if (hitPower === null || hitPower === undefined) break;
      const hitMove = c.effectiveMove.multiHitPowers ? { ...c.effectiveMove, power: hitPower } : c.effectiveMove;
      const hitResult = c.resolveHit(hitMove);
      c.damage += hitResult.damage;
      if (hitResult.isCritical) c.isCritical = true;
      landed += 1;
      c.perHitLog.push({
        damage: hitResult.damage,
        damagePercent: hitResult.damage / c.defender.realStats.hp,
        critical: hitResult.isCritical,
      });
      const preHp = c.defender.currentHp;
      c.applyDamageToDefender(hitResult.damage);
      c.applyEndurance(preHp);
      c.applyAngerPoint(hitResult.isCritical);
      // 이 타에서 방어측 on-hit 특성이 한 일을 그 타 레코드에 붙인다(로그를 타별로 찍기 위함).
      c.perHitLog[c.perHitLog.length - 1].abilityEvent = c.triggerAbilityHitEffect(hitResult.damage);
      c.applyContactItemRecoil(hitResult.damage);
      if (isFainted(c.defender) || c.substituteBroke) break; // 상대가 쓰러지거나 대타가 깨지면 남은 타수는 진행하지 않는다
    }
    c.damagePercent = c.damage / c.defender.realStats.hp;
    c.hitCount = landed;
  } else if (c.isDamaging && !c.blockedByProtect) {
    const hitResult = c.resolveHit(c.effectiveMove);
    c.damage = hitResult.damage;
    c.isCritical = hitResult.isCritical;
    c.damagePercent = c.damage / c.defender.realStats.hp;
    const preHp = c.defender.currentHp;
    c.applyDamageToDefender(c.damage);
    c.applyEndurance(preHp);
    c.applyAngerPoint(c.isCritical);
    c.triggerAbilityHitEffect(c.damage);
    c.applyContactItemRecoil(c.damage);
  }

  // 죽기살기(Endeavor, E-5): 데미지 계산이 없는(power null) 기술이라 위 분기에 안 걸린다.
  // 상대 HP를 사용자의 현재 HP와 같게 깎는다 — 상대가 더 많을 때만, 대타가 있으면 무효(단순화),
  // 노말→고스트 면역이면 typeEffectiveness가 0이라 스킵.
  c.endeavorDamage = 0;
  if (
    c.effectiveMove.setsTargetHpToUserHp &&
    !c.blockedByProtect &&
    c.typeEffectiveness !== 0 &&
    c.defender.substituteHp === undefined &&
    c.defender.currentHp > c.attacker.currentHp
  ) {
    c.endeavorDamage = c.defender.currentHp - c.attacker.currentHp;
    c.defender.currentHp = c.attacker.currentHp;
    c.damage = c.endeavorDamage;
    c.actualDamageDealt = c.endeavorDamage;
    c.damagePercent = c.endeavorDamage / c.defender.maxHp;
  }

  // 무릎차기(crashFraction, E-2): 명중은 했지만 방어류에 막혔거나 타입 면역(격투→고스트)으로
  // 무효화됐으면 사용자가 최대 HP의 절반을 잃는다. 대타에 흡수된 경우는 "맞은" 것이라 제외.
  c.crashDamage = 0;
  if (
    c.effectiveMove.crashFraction !== undefined &&
    !c.attackerAbility?.negatesIndirectDamage && // 매직가드(ver.1.9 A5)
    !c.hitSubstitute &&
    (c.blockedByProtect || c.typeEffectiveness === 0)
  ) {
    c.crashDamage = Math.floor(c.attacker.maxHp * c.effectiveMove.crashFraction);
    c.attacker.currentHp = Math.max(0, c.attacker.currentHp - c.crashDamage);
  }
}

/** 떨어뜨리기·미러코트/카운터·앙갚음·부자유친 같은 후속 데미지 */
function resolveCountersAndFollowUp(c: HitCtx) {

  // 떨어뜨리기(cancelsTargetCharge, E-1): 공중날기 등으로 무적인 상대에게 명중하면 그 차징을 캔슬.

  if (c.effectiveMove.cancelsTargetCharge && c.defender.chargingMoveId && c.damage > 0) {
    c.canceledTargetChargeMoveName = getMove(c.defender.chargingMoveId)?.name;
    c.defender.chargingMoveId = undefined;
  }

  // 미러코트/카운터(counters, F-1): 이번 턴 사용자가 받은 해당 카테고리 데미지의 2배를 상대에게
  // 그대로 되돌린다. 우선도 -5라 보통 이 시점엔 상대가 이미 공격을 마친 뒤다. 타입 상성·자속·랭크
  // 전부 무시. 받은 데미지가 없거나(0) 상대가 면역 타입(특수 카운터=악, 물리 카운터=고스트)이면 실패.
  c.counterDamage = 0;
  c.counterFailed = false;
  if (c.effectiveMove.counters) {
    const taken = c.attacker.damageTakenThisTurn?.[c.effectiveMove.counters] ?? 0;
    const immuneType = c.effectiveMove.counters === "special" ? "악" : "고스트";
    if (taken <= 0 || c.defender.types.includes(immuneType)) {
      c.counterFailed = true;
    } else {
      c.counterDamage = Math.min(c.defender.currentHp, taken * 2);
      c.defender.currentHp -= c.counterDamage;
      c.damage = c.counterDamage;
      c.actualDamageDealt = c.counterDamage;
      c.damagePercent = c.counterDamage / c.defender.maxHp;
    }
  }

  // 앙갚음/메탈버스트(countersAllCategories): 이번 턴 받은 (물리+특수) 데미지 합의 multiplier배(1.5)를
  // 카테고리·타입·랭크 무시하고 되돌린다. counters와 달리 면역 타입이 없다. 받은 데미지가 0이면 실패.
  if (c.effectiveMove.countersAllCategories) {
    const taken =
      (c.attacker.damageTakenThisTurn?.physical ?? 0) + (c.attacker.damageTakenThisTurn?.special ?? 0);
    if (taken <= 0) {
      c.counterFailed = true;
    } else {
      c.counterDamage = Math.min(
        c.defender.currentHp,
        Math.floor(taken * c.effectiveMove.countersAllCategories.multiplier),
      );
      c.defender.currentHp -= c.counterDamage;
      c.damage = c.counterDamage;
      c.actualDamageDealt = c.counterDamage;
      c.damagePercent = c.counterDamage / c.defender.maxHp;
    }
  }

  // 부자유친: 단일타 기술이 실제로 데미지를 준 뒤(다단히트/고정데미지는 제외 — 본가에서도 이미
  // 여러 번 때리는 기술과는 안 겹침), 같은 컨텍스트로 위력만 배율만큼 줄인 추가타를 한 번 더
  // 날린다. 첫 타로 이미 상대가 쓰러졌으면 추가타는 나가지 않는다.
  c.followUpHitDamage = 0;
  if (
    c.isDamaging &&
    !c.blockedByProtect &&
    c.damage > 0 &&
    !isFainted(c.defender) &&
    c.effectiveMove.fixedDamage === undefined &&
    c.effectiveMove.minHits === undefined &&
    c.effectiveMove.power !== null &&
    c.attackerAbility?.followUpHitPowerMultiplier
  ) {
    const followUpMove = { ...c.effectiveMove, power: Math.round(c.effectiveMove.power * c.attackerAbility.followUpHitPowerMultiplier) };
    const followUpResult = c.resolveHit(followUpMove);
    c.followUpHitDamage = followUpResult.damage;
    c.damage += c.followUpHitDamage;
    c.damagePercent = c.damage / c.defender.realStats.hp;
    if (followUpResult.isCritical) c.isCritical = true;
    const preHp = c.defender.currentHp;
    c.applyDamageToDefender(c.followUpHitDamage);
    c.applyEndurance(preHp);
    c.triggerAbilityHitEffect(c.followUpHitDamage);
    c.applyContactItemRecoil(c.followUpHitDamage);
  }
}

/** 발버둥·반동·돌머리·생명의구슬·흡수기·해감액·조개껍질방울 */
function applyRecoilAndDrain(c: HitCtx) {

  // 발버둥 반동: 필중이라 항상 이 지점까지 오고, 명중/기절 여부와 무관하게 사용자가
  // 최대 HP의 1/4만큼 반동 데미지를 입는다 (상대 데미지와는 별개 계산).
  c.selfDamage = 0;
  if (c.move.id === STRUGGLE_MOVE.id) {
    c.selfDamage = Math.floor(c.attacker.maxHp / 4);
    c.attacker.currentHp = Math.max(0, c.attacker.currentHp - c.selfDamage);
  }

  // 반동(recoil): 플레어드라이브·웨이브태클·브레이브버드·양날박치기. 상대에게 "실제로 깎인"
  // HP(actualDamageDealt)의 일정 비율만큼 사용자도 입는다 — 오버킬로 이론상 데미지가 상대
  // 잔여 HP보다 커도, 반동은 실제로 들어간 HP만큼만 기준으로 계산해야 한다(본가 규칙).
  // damage(이론상 수치)를 쓰면 반동이 부풀려지는 버그가 된다. actualDamageDealt가 0(면역 등)
  // 이면 반동도 자연히 0이 된다. 매직가드: 반동기(recoilFraction)의 반동은 "공격기 데미지"가
  // 아니라서 무효화된다.
  c.recoilDamage = 0;
  // 돌머리(ver.1.9 A5): 반동기의 반동을 받지 않는다
  if (c.effectiveMove.recoilFraction !== undefined && c.actualDamageDealt > 0 && !c.attackerAbility?.negatesIndirectDamage && !c.attackerAbility?.negatesRecoil) {
    c.recoilDamage = Math.floor(c.actualDamageDealt * c.effectiveMove.recoilFraction);
    c.attacker.currentHp = Math.max(0, c.attacker.currentHp - c.recoilDamage);
  }

  // 생명의구슬: 데미지를 실제로 준 공격이 성공할 때마다 최대 HP의 1/10만큼 자신도 반동을
  // 입는다 — 다단히트도 타수 수와 무관하게 이번 행동에 한 번만 적용(본가 규칙). 이쪽은 데미지
  // 양과 무관한 고정 비율(공격자 최대 HP 기준)이라 오버킬 버그와는 무관하지만, "데미지가 실제로
  // 들어갔는지" 게이트는 다른 항목들과 일관되게 actualDamageDealt로 맞춘다.
  // 단, 이번 기술에서 우격다짐(sheerForceAbilityName)이 실제로 발동했다면 생명의구슬 반동은
  // 면제된다 — 본가에서 확인된 특수 상호작용(Bulbapedia: Sheer Force negates Life Orb recoil).
  // 위력 상승·아이템 데미지 보너스는 그대로 받으면서 반동만 사라진다.
  c.itemRecoilDamage = 0;

  // 매직가드: 생명의구슬 반동도 무효화한다(위력·데미지 보너스는 그대로 — 우격다짐과 같은 결).
  if (
    c.isDamaging &&
    c.actualDamageDealt > 0 &&
    c.attackerItem?.selfRecoilFractionOfMaxHp &&
    !c.sheerForceAbilityName &&
    !c.attackerAbility?.negatesIndirectDamage
  ) {
    c.itemRecoilDamage = Math.floor(c.attacker.maxHp * c.attackerItem.selfRecoilFractionOfMaxHp);
    c.attacker.currentHp = Math.max(0, c.attacker.currentHp - c.itemRecoilDamage);
    c.itemRecoilItemName = c.attackerItem.name;
  }

  // 흡수기(기가드레인·드레인펀치·드레인키스·원념의칼): 실제로 깎인 HP(actualDamageDealt)의
  // 일정 비율만큼 회복 — recoil과 같은 이유로 이론상 데미지(damage)가 아니라 실제 HP 감소분을
  // 기준으로 써야 오버킬 시 회복량이 부풀려지지 않는다. 큰뿌리를 지녔으면 회복량이 1.3배.
  // recoil의 정반대 축이라 recoilDamage와 별도로 관리한다.
  c.drainHealAmount = 0;
  // 해감액: 방어측이 이 특성이면 흡수분만큼 공격측이 회복 대신 데미지를 입는다.
  c.liquidOozeDamage = 0;

  if (c.isDamaging && c.actualDamageDealt > 0 && c.effectiveMove.drainFraction !== undefined) {
    const rawDrain = Math.floor(
      c.actualDamageDealt * c.effectiveMove.drainFraction * getDrainHealMultiplier(c.attackerItem),
    );
    if (c.defenderAbility?.reverseDrainHealsToDamage) {
      c.liquidOozeDamage = Math.min(c.attacker.currentHp, rawDrain);
      c.attacker.currentHp -= c.liquidOozeDamage;
      c.liquidOozeAbilityName = c.defenderAbility.name;
    } else {
      c.drainHealAmount = hasVolatile(c.attacker.volatile, "healBlock") ? 0 : rawDrain;
      c.attacker.currentHp = Math.min(c.attacker.maxHp, c.attacker.currentHp + c.drainHealAmount);
    }
  }

  // 조개껍질방울: 실제로 깎인 HP(actualDamageDealt)의 1/8만큼 회복(오버킬 시 부풀려지지 않게).
  // 흡수기와는 별개 축이라 같은 행동에서 동시에 발동할 수 있다.
  c.shellBellHealAmount = 0;
  if (c.isDamaging && c.actualDamageDealt > 0 && c.attackerItem?.damageDealtHealDenominator) {
    c.shellBellHealAmount = hasVolatile(c.attacker.volatile, "healBlock") ? 0 : Math.floor(c.actualDamageDealt / c.attackerItem.damageDealtHealDenominator);
    c.attacker.currentHp = Math.min(c.attacker.maxHp, c.attacker.currentHp + c.shellBellHealAmount);
  }
}

/** 매지션·자폭류·목숨걸기·길동무 마무리 */
function applyThiefAndSelfDestruct(c: HitCtx) {

  // 매지션: 실제로 HP를 깎은(actualDamageDealt > 0) 공격이 명중했고, 자신이 무도구 상태
  // (currentItemId 없음)면 그 자리에서 상대가 지닌 도구를 빼앗는다. damage(이론상 수치)를
  // 쓰면 탈(Disguise)처럼 데미지가 전부 무효화된 히트도 "명중"으로 잘못 취급된다. 자신이
  // 이미 도구를 지녔으면 발동하지 않고(본가 규칙), 상대도 무도구면 훔칠 게 없어 조용히 아무
  // 일도 안 일어난다. 대타가 대신 맞았을 때는 상대의 "실제 소지품"과 무관한 인형에 닿은
  // 것이므로 훔치지 않는다.

  if (
    c.isDamaging &&
    c.actualDamageDealt > 0 &&
    !c.hitSubstitute &&
    c.attackerAbility?.stealsItemOnDamagingHit &&
    !c.attacker.currentItemId &&
    c.defender.currentItemId &&
    !c.defenderAbility?.preventsItemLoss // 점착: 이 특성이면 매지션에게 도구를 빼앗기지 않는다
  ) {
    const stolenItem = getItem(c.defender.currentItemId);
    c.stolenItemName = stolenItem?.name;
    c.attacker.currentItemId = c.defender.currentItemId;
    c.attacker.itemConsumed = false; // 새로 얻은 도구라 이전 소모 이력과 무관하게 다시 쓸 수 있다
    c.defender.currentItemId = null;
  }

  // 자폭류(대폭발 등): 명중했으면 반드시 데미지를 먼저 입힌 "다음" 사용자가 기절한다.
  // 순서가 중요하다 — 이 데미지로 상대가 이미 쓰러졌다면, 실제 게임처럼 "상대를 먼저 쓰러뜨린 뒤
  // 반동으로 자신도 쓰러진 것"으로 취급되어야 승자 판정(runTurn)이 이 행동의 주체를 승자로 잡는다.
  if (c.effectiveMove.selfFaints) {
    c.attacker.currentHp = 0;
  }
  // 목숨걸기(트랙 M5): 데미지를 줬을 때만 기절(빗나감·면역·방어로 막힘이면 그대로)
  if (c.effectiveMove.damageEqualsUserHp && c.damage > 0) {
    c.attacker.currentHp = 0;
  }

  // 길동무: 생명의구슬 반동/흡수기 회복/조개껍질방울 등 공격측 HP에 영향을 주는 후처리가 전부
  // 끝난 뒤에 마지막으로 판정한다 — 상대를 쓰러뜨리며 동시에 흡수기로 회복했더라도, 길동무는
  // "HP를 깎는" 효과가 아니라 그 자리에서 확정적으로 기절시키는 효과라 이후 회복을 무시해야
  // 한다(=먼저 판정하면 나중 회복이 되살리는 버그가 생김). 다단히트/부자유친 추가타 중 어느 타가
  // 상대를 쓰러뜨렸든 이 시점의 defender.currentHp/destinyBondArmed만 보면 되므로 한 번으로 충분.
  c.checkDestinyBond();
}

/** 결과를 모아 돌려준다 */
function collectResult(c: HitCtx) {
  return { abilityDamageAbilityName: c.abilityDamageAbilityName, abilityDamageToAttacker: c.abilityDamageToAttacker, abilityDisableAbilityName: c.abilityDisableAbilityName, abilityDisabledMoveName: c.abilityDisabledMoveName, abilityInflictedStatusAbilityName: c.abilityInflictedStatusAbilityName, abilityInflictedStatusOnAttacker: c.abilityInflictedStatusOnAttacker, abilityInflictedVolatileAbilityName: c.abilityInflictedVolatileAbilityName, abilityInflictedVolatileOnAttacker: c.abilityInflictedVolatileOnAttacker, abilityLoweredAttackerStats: c.abilityLoweredAttackerStats, abilityLoweredAttackerStatsAbilityName: c.abilityLoweredAttackerStatsAbilityName, abilityLoweredDefenderStats: c.abilityLoweredDefenderStats, abilityRaisedDefenderStats: c.abilityRaisedDefenderStats, abilityRaisedDefenderStatsAbilityName: c.abilityRaisedDefenderStatsAbilityName, angerPointAbilityName: c.angerPointAbilityName, angerPointMaxedAbilityName: c.angerPointMaxedAbilityName, angerPointRaisedSpa: c.angerPointRaisedSpa, berryReducedDamageItemName: c.berryReducedDamageItemName, canceledTargetChargeMoveName: c.canceledTargetChargeMoveName, cheekPouchHeal: c.cheekPouchHeal, counterDamage: c.counterDamage, counterFailed: c.counterFailed, crashDamage: c.crashDamage, damage: c.damage, damagePercent: c.damagePercent, destinyBondTriggered: c.destinyBondTriggered, disguiseRecoilDamage: c.disguiseRecoilDamage, drainHealAmount: c.drainHealAmount, endeavorDamage: c.endeavorDamage, enduredAbilityName: c.enduredAbilityName, enduredItemName: c.enduredItemName, enduredProtectMoveName: c.enduredProtectMoveName, followUpHitDamage: c.followUpHitDamage, hitCount: c.hitCount, hitNegatedByAbilityName: c.hitNegatedByAbilityName, hitSubstitute: c.hitSubstitute, illusionBrokenSpeciesId: c.illusionBrokenSpeciesId, isCritical: c.isCritical, isDamaging: c.isDamaging, itemRecoilDamage: c.itemRecoilDamage, itemRecoilItemName: c.itemRecoilItemName, liquidOozeAbilityName: c.liquidOozeAbilityName, liquidOozeDamage: c.liquidOozeDamage, mummifiedAttackerAbilityName: c.mummifiedAttackerAbilityName, perHitLog: c.perHitLog, pickpocketAbilityName: c.pickpocketAbilityName, pickpocketStolenItemName: c.pickpocketStolenItemName, recoilDamage: c.recoilDamage, rockyHelmetDamage: c.rockyHelmetDamage, rockyHelmetItemName: c.rockyHelmetItemName, sandSpitWeather: c.sandSpitWeather, seedSowerField: c.seedSowerField, selfDamage: c.selfDamage, shellBellHealAmount: c.shellBellHealAmount, statusCureBerryItemName: c.statusCureBerryItemName, stolenItemName: c.stolenItemName, substituteBroke: c.substituteBroke, terrainSeedMessages: c.terrainSeedMessages, toxicDebrisAbilityName: c.toxicDebrisAbilityName, wanderingSpiritSwapped: c.wanderingSpiritSwapped };
}

export function resolveHitAndApplyDamage(input: HitResolutionInput) {
  const c = {} as HitCtx;

  c.state = input.state;
  c.defenderKey = input.defenderKey;
  c.move = input.move;
  c.effectiveMove = input.effectiveMove;
  c.random = input.random;
  c.attacker = input.attacker;
  c.defender = input.defender;
  c.attackerAbility = input.attackerAbility;
  c.defenderAbility = input.defenderAbility;
  c.attackerItem = input.attackerItem;
  c.defenderItem = input.defenderItem;
  c.typeEffectiveness = input.typeEffectiveness;
  c.blockedByProtect = input.blockedByProtect;
  c.blockedBySubstitute = input.blockedBySubstitute;
  c.unseenFistPiercing = input.unseenFistPiercing;
  c.hitChance = input.hitChance;
  c.gemMultiplier = input.gemMultiplier;
  c.ownMoveTypeBoostMultiplier = input.ownMoveTypeBoostMultiplier;
  c.rivalryMultiplier = input.rivalryMultiplier;
  c.sheerForceAbilityName = input.sheerForceAbilityName;
  c.defenderBerriesBlocked = input.defenderBerriesBlocked;
  c.abilityOffenseMultiplier = input.abilityOffenseMultiplier;
  c.statOffenseMultiplier = input.statOffenseMultiplier;
  c.abilityDefenseMultiplier = input.abilityDefenseMultiplier;
  c.finalDefenseMultiplier = input.finalDefenseMultiplier;
  c.stabMultiplier = input.stabMultiplier;
  const { evadedByCharge, defenderHideType } = input;
  // status 기술(도깨비불·최면술 등 위력 없는 변화기)은 데미지 계산을 건너뛴다.
  // 예전엔 여기서 바로 return 해버려서 이런 기술들의 랭크변화/상태이상 부여가 전혀 발동하지 않는
  // 버그가 있었다 — 명중만 하면 데미지 유무와 무관하게 아래 효과 적용까지 항상 도달해야 한다.
  // 나이트헤드처럼 fixedDamage 기술은 power가 null(가변형과 동일한 "수치 없음" 표기)이라
  // power !== null 조건만으로는 걸러진다 — fixedDamage가 있으면 power 유무와 무관하게 데미지 기술로 취급한다.
  c.isDamaging = c.effectiveMove.category !== "status" &&
    (c.effectiveMove.power !== null || c.effectiveMove.fixedDamage !== undefined);
  // 나무열매(카리열매 등)가 이번 행동 중 발동했으면 그 나무열매 이름 — resolveHit 클로저 안에서 채운다

  c.damage = 0;
  c.damagePercent = 0;
  // 반동(recoilFraction)·흡수기(drainFraction)·해감액·조개껍질방울은 본가에서 상대 HP를
  // 넘는 "이론상 데미지"가 아니라, 그 히트로 실제로 깎인 HP(상대 최대/잔여 HP에 잘린 값)를
  // 기준으로 계산된다 — damage는 오버킬이어도 그대로 누적되는 값이라 여기 쓰면 안 된다.
  // applyDamageToDefender(대타 포함)와 카운터류처럼 defender.currentHp를 직접 건드리는
  // 모든 지점에서 이 값을 같이 채운다.
  c.actualDamageDealt = 0;
  c.isCritical = false;
  // 트리플악셀처럼 여러 타로 나뉘는 기술만 채운다 — 실제로 명중해서 데미지를 낸 타수.

  // 다단히트 타별 내역(로그용). 명중한 타수만큼 순서대로 push.


  // 방어측 접촉/피격 트리거 특성(정전기·불꽃몸·까칠한피부·깨어진갑옷·저주받은바디 — Phase 5 §1).
  // 트리플악셀·록블라스트 같은 다단히트 기술은 타수마다 별도로 판정해야 한다(본가 규칙 — 록키헬멧
  // 등 동일 축의 도구도 다단히트 매 타마다 발동) — 그래서 총합 damage가 아니라 아래 triggerAbilityHitEffect를
  // 각 히트 직후(fixedDamage/단일타는 1회, 다단히트는 루프 안에서 타수만큼) 호출해서 채운다.




  c.abilityDamageToAttacker = 0;

  // 울퉁불퉁멧(도구): 접촉기로 공격해 온 공격자가 입은 데미지 합(다단히트면 타수만큼 누적).
  c.rockyHelmetDamage = 0;

  // 내용물분출: applyDamageToDefender가 "이번 타를 맞기 직전" 방어측 HP를 여기에 담아둔다.
  c.defenderHpBeforeLastHit = 0;


  // 나쁜손버릇: 접촉기로 피격당한 방어측이 공격자의 도구를 빼앗았을 때 그 도구 이름과 특성 이름.


  // 미라: 접촉기로 피격당한 방어측이 공격자의 특성을 미라로 바꿨을 때 그 특성(=미라) 이름.

  // 지구력·깨어진갑옷처럼 방어측 특성이 피격 시 자기 랭크를 바꿨을 때(Phase 6.5 §6-2 ③ / §6-1).
  // 다단히트면 타수만큼 누적. 오른 스탯과 내려간 스탯을 나눠 담아 로그도 별도 줄로 낸다.

  c.abilityRaisedDefenderStats = [];
  c.abilityLoweredDefenderStats = [];
  // 미끈미끈·점착: 방어측 특성이 접촉한 공격자의 랭크를 내렸을 때(다단히트면 타수만큼 누적).

  c.abilityLoweredAttackerStats = [];
  // 볼주머니: 이번 행동에서 나무열매를 먹어 발동한 추가 회복량 누적.
  c.cheekPouchHeal = 0;
  // 발끈: 상대 기술 데미지로 HP가 절반 이하가 되어 방어측 특수공격이 올랐을 때.
  c.angerPointRaisedSpa = false;

  // 분노의경혈(ver.1.9 A5): 급소에 맞아 방어측 공격이 +6이 됐을 때 그 특성 이름

  // 독치장(ver.1.9 A5): 물리 피격으로 공격자 편에 독압정을 뿌렸을 때 그 특성 이름

  // 떠도는영혼: 접촉 피격으로 공격자와 특성을 맞바꿨을 때.
  c.wanderingSpiritSwapped = false;
  // 모래뿜기: 피격으로 날씨를 바꿨을 때 그 날씨.

  // 넘치는씨: 피격으로 필드를 바꿨을 때 그 필드.

  // 시드류: 이번 행동 중 필드가 새로 깔려 발동한 시드 문구(넘치는씨 히트·기술 둘 다 여기 담는다).
  c.terrainSeedMessages = [];

  // 지진이 땅속의 구멍파기를, 파도타기가 물속의 다이빙을 실제로 맞혔을 때의 위력 배가.
  // evadedByCharge가 false인데 defenderHideType이 있다는 건 bypassesHiding 예외로 명중했다는 뜻.
  c.hidingBypassMultiplier = defenderHideType && !evadedByCharge ? (c.effectiveMove.hidingBypassMultiplier ?? 1) : 1;
  defineResolveHit(c);
  defineEnduranceHelpers(c);
  defineDamageHelpers(c);
  defineAbilityHitEffect(c);
  resolveMainHit(c);
  resolveCountersAndFollowUp(c);
  applyRecoilAndDrain(c);
  applyThiefAndSelfDestruct(c);
  return collectResult(c);
}

