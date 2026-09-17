import { type ChargeHideType, type Move } from "@/types/move";
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
import { computeStatusAttackMultiplier, ignoresBurnAttackPenalty, inflictStatus, isImmuneToStatus } from "@/lib/statusConditions";
import { hasVolatile, inflictVolatile } from "@/lib/volatileConditions";
import { computeDamage, hustleDamageMultiplier, screenMultiplierFromFlags } from "@/lib/battlePower";
import { getWeatherDamageMultiplier } from "@/lib/weatherEffects";
import { FIELD_DURATION, getFieldDamageMultiplier } from "@/lib/fieldEffects";
import { getBerryDefenseResult, getDrainHealMultiplier, getEnduranceResult, getItemCritStageBonus, getItemOffenseMultiplier, getMentalHerbCureResult } from "@/lib/itemEffects";
import { MIN_DAMAGE_ROLL, STRUGGLE_MOVE, WEATHER_DURATION, activeWeather, applyMimicryForm, consumeItem, contraryDelta, isFainted, rollMultiHitCount, sideOf, statDropBlockStatsOf, statusImmunitiesOf, type BattleFighterState, type BattleState } from "./state";
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
  abilityDefenseMultiplier: number;
  stabMultiplier: number;
}

export function resolveHitAndApplyDamage(input: HitResolutionInput) {
  const { state, defenderKey, move, effectiveMove, random, attacker, defender, attackerAbility, defenderAbility, attackerItem, defenderItem, typeEffectiveness, blockedByProtect, blockedBySubstitute, unseenFistPiercing, hitChance, evadedByCharge, defenderHideType, gemMultiplier, ownMoveTypeBoostMultiplier, rivalryMultiplier, sheerForceAbilityName, defenderBerriesBlocked, abilityOffenseMultiplier, abilityDefenseMultiplier, stabMultiplier } = input;
  // status 기술(도깨비불·최면술 등 위력 없는 변화기)은 데미지 계산을 건너뛴다.
  // 예전엔 여기서 바로 return 해버려서 이런 기술들의 랭크변화/상태이상 부여가 전혀 발동하지 않는
  // 버그가 있었다 — 명중만 하면 데미지 유무와 무관하게 아래 효과 적용까지 항상 도달해야 한다.
  // 나이트헤드처럼 fixedDamage 기술은 power가 null(가변형과 동일한 "수치 없음" 표기)이라
  // power !== null 조건만으로는 걸러진다 — fixedDamage가 있으면 power 유무와 무관하게 데미지 기술로 취급한다.
  const isDamaging =
    effectiveMove.category !== "status" &&
    (effectiveMove.power !== null || effectiveMove.fixedDamage !== undefined);
  // 나무열매(카리열매 등)가 이번 행동 중 발동했으면 그 나무열매 이름 — resolveHit 클로저 안에서 채운다
  let berryReducedDamageItemName: string | undefined;
  let damage = 0;
  let damagePercent = 0;
  // 반동(recoilFraction)·흡수기(drainFraction)·해감액·조개껍질방울은 본가에서 상대 HP를
  // 넘는 "이론상 데미지"가 아니라, 그 히트로 실제로 깎인 HP(상대 최대/잔여 HP에 잘린 값)를
  // 기준으로 계산된다 — damage는 오버킬이어도 그대로 누적되는 값이라 여기 쓰면 안 된다.
  // applyDamageToDefender(대타 포함)와 카운터류처럼 defender.currentHp를 직접 건드리는
  // 모든 지점에서 이 값을 같이 채운다.
  let actualDamageDealt = 0;
  let isCritical = false;
  // 트리플악셀처럼 여러 타로 나뉘는 기술만 채운다 — 실제로 명중해서 데미지를 낸 타수.
  let hitCount: number | undefined;
  // 다단히트 타별 내역(로그용). 명중한 타수만큼 순서대로 push.
  let perHitLog:
    | { damage: number; damagePercent: number; critical: boolean; abilityEvent?: HitAbilityEvent }[]
    | undefined;

  // 방어측 접촉/피격 트리거 특성(정전기·불꽃몸·까칠한피부·깨어진갑옷·저주받은바디 — Phase 5 §1).
  // 트리플악셀·록블라스트 같은 다단히트 기술은 타수마다 별도로 판정해야 한다(본가 규칙 — 록키헬멧
  // 등 동일 축의 도구도 다단히트 매 타마다 발동) — 그래서 총합 damage가 아니라 아래 triggerAbilityHitEffect를
  // 각 히트 직후(fixedDamage/단일타는 1회, 다단히트는 루프 안에서 타수만큼) 호출해서 채운다.
  let abilityInflictedStatusOnAttacker: StatusConditionState["condition"] | undefined;
  let abilityInflictedStatusAbilityName: string | undefined;
  let abilityInflictedVolatileOnAttacker: VolatileCondition | undefined;
  let abilityInflictedVolatileAbilityName: string | undefined;
  let abilityDamageToAttacker = 0;
  let abilityDamageAbilityName: string | undefined;
  // 울퉁불퉁멧(도구): 접촉기로 공격해 온 공격자가 입은 데미지 합(다단히트면 타수만큼 누적).
  let rockyHelmetDamage = 0;
  let rockyHelmetItemName: string | undefined;
  // 내용물분출: applyDamageToDefender가 "이번 타를 맞기 직전" 방어측 HP를 여기에 담아둔다.
  let defenderHpBeforeLastHit = 0;
  let abilityDisabledMoveName: string | undefined;
  let abilityDisableAbilityName: string | undefined;
  // 나쁜손버릇: 접촉기로 피격당한 방어측이 공격자의 도구를 빼앗았을 때 그 도구 이름과 특성 이름.
  let pickpocketStolenItemName: string | undefined;
  let pickpocketAbilityName: string | undefined;
  // 미라: 접촉기로 피격당한 방어측이 공격자의 특성을 미라로 바꿨을 때 그 특성(=미라) 이름.
  let mummifiedAttackerAbilityName: string | undefined;
  // 지구력·깨어진갑옷처럼 방어측 특성이 피격 시 자기 랭크를 바꿨을 때(Phase 6.5 §6-2 ③ / §6-1).
  // 다단히트면 타수만큼 누적. 오른 스탯과 내려간 스탯을 나눠 담아 로그도 별도 줄로 낸다.
  let abilityRaisedDefenderStatsAbilityName: string | undefined;
  const abilityRaisedDefenderStats: { stat: BattleStatKey; delta: number }[] = [];
  const abilityLoweredDefenderStats: { stat: BattleStatKey; delta: number }[] = [];
  // 미끈미끈·점착: 방어측 특성이 접촉한 공격자의 랭크를 내렸을 때(다단히트면 타수만큼 누적).
  let abilityLoweredAttackerStatsAbilityName: string | undefined;
  const abilityLoweredAttackerStats: { stat: BattleStatKey; delta: number }[] = [];
  // 볼주머니: 이번 행동에서 나무열매를 먹어 발동한 추가 회복량 누적.
  let cheekPouchHeal = 0;
  // 발끈: 상대 기술 데미지로 HP가 절반 이하가 되어 방어측 특수공격이 올랐을 때.
  let angerPointRaisedSpa = false;
  let angerPointAbilityName: string | undefined;
  // 떠도는영혼: 접촉 피격으로 공격자와 특성을 맞바꿨을 때.
  let wanderingSpiritSwapped = false;
  // 모래뿜기: 피격으로 날씨를 바꿨을 때 그 날씨.
  let sandSpitWeather: WeatherKind | undefined;
  // 넘치는씨: 피격으로 필드를 바꿨을 때 그 필드.
  let seedSowerField: FieldKind | undefined;
  // 시드류: 이번 행동 중 필드가 새로 깔려 발동한 시드 문구(넘치는씨 히트·기술 둘 다 여기 담는다).
  const terrainSeedMessages: string[] = [];

  // 지진이 땅속의 구멍파기를, 파도타기가 물속의 다이빙을 실제로 맞혔을 때의 위력 배가.
  // evadedByCharge가 false인데 defenderHideType이 있다는 건 bypassesHiding 예외로 명중했다는 뜻.
  const hidingBypassMultiplier =
    defenderHideType && !evadedByCharge ? (effectiveMove.hidingBypassMultiplier ?? 1) : 1;

  /**
   * 한 번의 "타격"에 대한 급소 판정 + 데미지 계산. 다단히트 기술은 이걸 타수만큼 반복 호출해서
   * 급소를 타수마다 따로 굴린다(사용자 확인) — highCritRatio/alwaysCrit는 항상 원본 기술
   * (effectiveMove) 기준으로 판정하고, hitMove는 트리플악셀처럼 타수별 위력만 다를 때 쓴다.
   */
  function resolveHit(hitMove: Move): { damage: number; isCritical: boolean } {
    // 대운: 급소율 카운터가 상시 +raisesCritStageBy(1). 조가비갑옷/전투무장: 방어측이면 급소 자체가 안 뜬다(alwaysCrit 포함).
    const critStageForHit =
      attacker.critStage +
      getItemCritStageBonus(attackerItem, attacker.slot.pokemonId) +
      (attackerAbility?.raisesCritStageBy ?? 0);
    // 무도한행동: 방어측이 독/맹독이면 항상 급소(조가비갑옷/전투무장 등 방어측 급소 방지는 존중).
    const mercilessCrit =
      !!attackerAbility?.alwaysCritsVsPoisonedTarget &&
      (defender.status.condition === "poison" || defender.status.condition === "badly-poisoned");
    const critical =
      !defenderAbility?.preventsCritsAgainstSelf &&
      (effectiveMove.alwaysCrit ||
        mercilessCrit ||
        random() < critChance(critStageForHit, effectiveMove.highCritRatio));
    const ignoreBurnPenalty = ignoresBurnAttackPenalty(attackerAbility?.id, effectiveMove.id);
    const statusAttackMultiplier = computeStatusAttackMultiplier(
      attacker.status.condition,
      effectiveMove.category,
      ignoreBurnPenalty,
    );
    // 의욕(Hustle): 물리 기술 위력 ×1.5 (명중률 ×0.8은 위 accuracyExtraMultiplier에서 반영).
    const hustleMultiplier = hustleDamageMultiplier(effectiveMove.category, attackerAbility);
    // 메가솔라: 자신이 쓰는 기술의 날씨 배율을 항상 쾌청 기준으로(불꽃 ×1.5·물 ×0.5) 계산한다.
    const weatherMultiplier = getWeatherDamageMultiplier(
      attackerAbility?.treatsOwnWeatherAsSun ? "쾌청" : activeWeather(state),
      effectiveMove.type,
    );
    const fieldMultiplier = getFieldDamageMultiplier(state.field, effectiveMove.type);
    const itemMultiplier = getItemOffenseMultiplier(
      attackerItem,
      effectiveMove,
      typeEffectiveness,
      attacker.lastMoveStreak ?? 1,
    );
    // 나무열매(카리열매 등): 이 피격이 조건(타입 일치 + 효과가 굉장함)을 채우면 데미지를
    // 절반으로 줄이고 대전 중 1회만 발동하도록 소모 처리한다. 다단히트면 첫 타에서만 소모되고,
    // 이후 타수는 이미 소모된 상태라 다시 발동하지 않는다.
    const berryResult = getBerryDefenseResult(
      defenderBerriesBlocked ? undefined : defenderItem,
      effectiveMove.type,
      typeEffectiveness,
      defender.itemConsumed ?? false,
      !!defenderAbility?.doublesBerryEffect, // 숙성
    );
    if (berryResult.consumed) {
      consumeItem(defender);
      berryReducedDamageItemName = defenderItem?.name;
    }

    // 리플렉터(물리)/빛의장막(특수)/오로라베일(물리·특수 둘 다): 방어측 편(side)에 스크린이
    // 걸려있으면 데미지 반감(§6-3 — 편 단위라 교체해도 유지). 급소는 스크린을 무시한다(본가 규칙)
    // — bulkMultiplier는 나눗셈이라 2를 곱하면 절반이 된다. 틈새포착이면 스크린 자체를 아예
    // 무시한다(급소 판정과 별개로 항상 1배). 오로라베일은 카테고리 전용 스크린과 별개 축이라
    // 둘 다 걸려있으면 곱으로 중첩된다. (여기까지 매직미러 반사 스왑 전이라 defenderKey가 정확.)
    const defenderScreens = sideOf(state, defenderKey).screens;
    const screenType = effectiveMove.category === "physical" ? "reflect" : "lightScreen";
    const screenBypassed = !!attackerAbility?.bypassesScreensAndSubstitute || critical;
    const categoryScreenActive = !screenBypassed && defenderScreens[screenType] !== undefined;
    const auroraVeilActive = !screenBypassed && defenderScreens.auroraVeil !== undefined;
    const screenMultiplier = screenMultiplierFromFlags(categoryScreenActive, auroraVeilActive);

    // 관통드릴: 접촉기일 때만 상대 방어/특방 랭크의 "상승분"을 무시한다(날카로운눈의 회피율
    // 처리와 같은 패턴 — 마이너스 랭크는 그대로 페널티로 받는다). 천진(전부 무시)과 겹치면
    // 천진 쪽이 이미 NEUTRAL_STAGES라 이 클램프는 자연히 아무 효과가 없다.
    // 사이코쇼크류(hitsDefensiveStat)는 실제 데미지에 쓰는 방어 스탯이 분류 기본값과 다르므로
    // 그 축(=computeDamage가 실제로 읽는 축)에 클램프를 맞춘다.
    const contactDefenseStat: BattleStatKey =
      effectiveMove.hitsDefensiveStat ?? (effectiveMove.category === "physical" ? "def" : "spd");
    const contactIgnoresDefenseBoost =
      (effectiveMove.makesContact ?? false) &&
      attackerAbility?.contactIgnoresDefenseBoostAndGuaranteesMinDamageFraction !== undefined;
    // 성스러운칼: 천진(특성)과 정확히 같은 축이지만 기술 단위 효과라 여기서 같이 확인한다.
    const baseDefenderStages =
      attackerAbility?.ignoresOpponentStatStagesInDamage || effectiveMove.ignoresDefenderStatStagesInDamage
        ? NEUTRAL_STAGES
        : defender.stages;
    const defenderStagesForDamage =
      contactIgnoresDefenseBoost && baseDefenderStages[contactDefenseStat] > 0
        ? { ...baseDefenderStages, [contactDefenseStat]: 0 }
        : baseDefenderStages;

    const result = computeDamage(attacker.realStats, defender.realStats, attacker.types, hitMove, {
      typeEffectiveness,
      abilityMultiplier:
        abilityOffenseMultiplier *
        statusAttackMultiplier *
        hidingBypassMultiplier *
        ownMoveTypeBoostMultiplier *
        rivalryMultiplier *
        hustleMultiplier,
      weatherMultiplier,
      fieldMultiplier,
      itemMultiplier: itemMultiplier * gemMultiplier,
      stabMultiplier,
      // 천진: 자신이 이 특성이면 상대 쪽 랭크(공격측이면 상대 방어/특방, 방어측이면 상대
      // 공격/특공)를 전부 무시(0랭크 취급) — computeDamage는 카테고리에 맞는 스탯 하나만
      // 읽으므로 NEUTRAL_STAGES를 통째로 넘겨도 안전하다. 자신의 랭크는 그대로 반영된다.
      attackerStages: defenderAbility?.ignoresOpponentStatStagesInDamage ? NEUTRAL_STAGES : attacker.stages,
      defenderStages: defenderStagesForDamage,
      // 대검돌격: 방어측이 피격 약점 상태면 받는 데미지 2배(bulkMultiplier는 나눗셈이라 0.5).
      bulkMultiplier:
        abilityDefenseMultiplier *
        berryResult.bulkMultiplier *
        screenMultiplier *
        (defender.glaiveRushVulnerable ? 0.5 : 1),
      isCritical: critical,
      // 스나이퍼: 급소 데미지 배율을 2.25로 올린다(기본 1.5).
      critDamageMultiplier: attackerAbility?.critDamageMultiplier,
      randomRoll: MIN_DAMAGE_ROLL + random() * (1 - MIN_DAMAGE_ROLL),
    });
    let hitDamage = result?.damage ?? 0;
    // 관통드릴: 접촉기가 명중(면역 제외)했는데 데미지가 상대 최대 HP의 지정 비율보다 낮으면
    // 그 비율만큼으로 끌어올린다(최소 데미지 보장).
    if (contactIgnoresDefenseBoost && typeEffectiveness !== 0) {
      const minDamage = Math.floor(
        defender.maxHp * attackerAbility!.contactIgnoresDefenseBoostAndGuaranteesMinDamageFraction!,
      );
      if (hitDamage < minDamage) hitDamage = minDamage;
    }
    // 보이지않는주먹: 방어류를 뚫고 들어간 접촉기는 데미지가 1/4로 줄어든다.
    if (unseenFistPiercing) hitDamage = Math.floor(hitDamage * 0.25);
    return { damage: hitDamage, isCritical: critical };
  }

  // 기합의띠(최대 HP 상태에서만, 1회)·기합의머리띠(조건 없이 매번 확률): 이번 데미지로 정확히
  // 기절했을 때만(currentHp가 0이 됐을 때만) 판정 대상이 된다. preHp는 이번 데미지를 받기
  // 직전 HP — 기합의띠의 "최대 HP 상태" 조건과 애초에 죽어있던 게 아니었는지 확인에 쓴다.
  // 다단히트 루프 안에서 타수마다 호출되므로, 한 타에서 버텨도 다음 타에서 다시 죽을 수 있고
  // (기합의머리띠는 매번 재판정, 기합의띠는 이미 소모돼 두 번은 못 버팀) 그건 본가와 동일하다.
  let enduredItemName: string | undefined;
  let enduredAbilityName: string | undefined;
  let enduredProtectMoveName: string | undefined;
  function applyEndurance(preHp: number): void {
    if (defender.currentHp > 0 || preHp <= 0) return;
    const result = getEnduranceResult(defenderItem, preHp, defender.maxHp, defender.itemConsumed ?? false, random);
    if (result.survives) {
      defender.currentHp = 1;
      enduredItemName = defenderItem?.name;
      if (result.consumes) consumeItem(defender);
      return;
    }
    // 옹골참: 기합의띠와 조건은 같지만(최대 HP 상태) 소모되지 않아 매번 다시 판정한다.
    if (defenderAbility?.survivesLethalAtFullHp && preHp === defender.maxHp) {
      defender.currentHp = 1;
      enduredAbilityName = defenderAbility.name;
      return;
    }
    // 버티기(protectEffect: "endure"): 기합의띠·옹골참과 달리 풀피 조건 없이 이번 턴엔
    // 무조건 버틴다 — 방어류 공용 성공 확률(protectStreak)로 이미 발동 여부가 갈렸으니
    // 여기 도달했다는 건 이번 턴 발동에 성공했다는 뜻이다.
    if (defender.activeProtect?.effect === "endure") {
      defender.currentHp = 1;
      enduredProtectMoveName = defender.activeProtect.moveName;
    }
  }

  // 대타출동: blockedBySubstitute(=대타가 있고 소리 계열이 아님)면 데미지를 실제 HP가 아니라
  // 대타 HP에서 깎는다. 대타 HP를 넘는 초과분은 그냥 사라진다(본가 규칙 — 실제 HP로 안 넘어옴).
  // 대타가 이번 타격으로 다 깎였으면 그 즉시 사라지고, 다단히트 루프는 이 시점에서 멈춰야 한다
  // (기절과 같은 축 — substituteBroke를 그 판정에 같이 쓴다).
  let substituteBroke = false;
  let hitSubstitute = false;
  // 도구 발동 시 UI에 표시할 이름(상태이상/혼란/헤롱헤롱/도발/사슬묶기/앙코르 즉시치료 나무열매·
  // 멘탈허브 등) — triggerAbilityHitEffect(헤롱헤롱바디)가 이 변수를 참조하므로 그 정의보다
  // 앞에 선언해야 한다(TDZ 회피).
  let statusCureBerryItemName: string | undefined;
  // 탈(Disguise): 배틀 중 처음 데미지를 입는 순간에만 발동(disguiseBroken이 아직 false일 때).
  let hitNegatedByAbilityName: string | undefined;
  let disguiseRecoilDamage: number | undefined;
  // 일루전(§6-1): 이번 행동으로 방어측 조로아크의 위장이 풀렸으면 그 조로아크의 진짜 종 id.
  let illusionBrokenSpeciesId: string | undefined;
  // 길동무: 데미지 적용 직후 판정하지만, 기합의띠/옹골참/버티기(applyEndurance)로 HP 1로 버텨낸
  // 경우는 애초에 안 쓰러진 것이므로 발동하면 안 된다 — applyEndurance까지 다 끝난 뒤에 판정해야
  // 한다(checkDestinyBond를 별도 호출로 분리한 이유). 다단히트 도중 이미 발동했으면 재판정 안 함.
  let destinyBondTriggered = false;
  function applyDamageToDefender(amount: number): void {
    if (blockedBySubstitute && defender.substituteHp !== undefined) {
      hitSubstitute = true;
      const substituteHpBefore = defender.substituteHp;
      defender.substituteHp = Math.max(0, defender.substituteHp - amount);
      actualDamageDealt += substituteHpBefore - defender.substituteHp;
      if (defender.substituteHp <= 0) {
        defender.substituteHp = undefined;
        substituteBroke = true;
      }
      return;
    }
    // 탈: 대타를 맞힌 게 아니라 실제로 HP를 깎으려는 순간에만 판정한다(대타가 있는 동안은
    // 애초에 위 분기에서 return하므로 여기 안 옴). 다단히트는 첫 타에서만 발동하고, 벗겨진
    // 뒤의 나머지 타수는 이 블록을 건너뛰어 정상적으로 실제 HP를 깎는다(disguiseBroken=true).
    if (amount > 0 && defenderAbility?.negatesFirstHitThenRecoils && !defender.disguiseBroken) {
      defender.disguiseBroken = true;
      hitNegatedByAbilityName = defenderAbility.name;
      disguiseRecoilDamage = Math.floor(defender.maxHp * defenderAbility.negatesFirstHitThenRecoils.recoilFraction);
      defender.currentHp = Math.max(0, defender.currentHp - disguiseRecoilDamage);
      return;
    }
    const hpBeforeThisHit = defender.currentHp;
    defenderHpBeforeLastHit = hpBeforeThisHit;
    defender.currentHp = Math.max(0, defender.currentHp - amount);
    actualDamageDealt += hpBeforeThisHit - defender.currentHp;
    // 미러코트/카운터용: 실제 HP로 받은 데미지를 카테고리별로 누적(대타 흡수분은 위에서 이미
    // return되어 제외). effectiveMove가 아니라 hitMove로 넘어와도 카테고리는 동일하다.
    if (amount > 0 && (effectiveMove.category === "physical" || effectiveMove.category === "special") && defender.damageTakenThisTurn) {
      defender.damageTakenThisTurn[effectiveMove.category] += amount;
    }
    // 분노의주먹(Move.rageFistPower)용: 이 포켓몬이 기술로 데미지를 받은 누적 횟수(다단히트는 타수만큼).
    if (amount > 0) {
      defender.timesHitByMoves = (defender.timesHitByMoves ?? 0) + 1;
    }
    // 일루전(§6-1): 기술 데미지를 실제로 받는 순간 위장이 풀린다. 다단히트면 첫 타에서만 로그를 낸다.
    if (amount > 0 && defender.illusionAs && defenderAbility?.illusion) {
      defender.illusionAs = undefined;
      illusionBrokenSpeciesId = defender.slot.pokemonId;
    }
    // 전기로바꾸기(Electromorphosis): 기술 데미지를 받으면 충전 상태가 된다(다음 전기 기술 위력 2배).
    if (amount > 0 && defenderAbility?.chargesOnDamageTaken && !isFainted(defender)) {
      defender.electroChargedForElectric = true;
    }
    // 발끈(포챔스판): 상대 기술 데미지로 HP가 처음으로 절반 이하가 되는 그 순간 특수공격 +1.
    // 여기(applyDamageToDefender)는 기술 데미지 경로 전용이라 모래바람·독·설치물은 자연히 제외된다.
    if (
      amount > 0 &&
      defenderAbility?.raisesSpaWhenHalvedByMoveDamage &&
      !isFainted(defender) &&
      hpBeforeThisHit * 2 > defender.maxHp &&
      defender.currentHp * 2 <= defender.maxHp
    ) {
      const before = defender.stages.spa;
      defender.stages = applyStageDelta(defender.stages, "spa", contraryDelta(defender, 1));
      if (defender.stages.spa !== before) {
        angerPointRaisedSpa = true;
        angerPointAbilityName = defenderAbility.name;
      }
    }
  }

  /**
   * 길동무: applyDamageToDefender + applyEndurance까지 끝난 뒤(=기합의띠·옹골참·버티기로도 못
   * 버티고 실제로 쓰러졌는지가 확정된 뒤) 호출한다. 상대(defender)가 길동무 예약 상태였는데
   * 이번 공격으로 실제 기절했으면, 공격자(attacker)도 그 자리에서 같이 기절시킨다 — 간접
   * 데미지(상태이상·씨뿌리기 등)는 이 함수를 거치는 데미지 경로 자체가 아니라서 자연히 대상이
   * 아니다(본가 규칙과 일치).
   */
  function checkDestinyBond(): void {
    if (destinyBondTriggered || defender.currentHp > 0 || !defender.destinyBondArmed) return;
    attacker.currentHp = 0;
    defender.destinyBondArmed = false;
    destinyBondTriggered = true;
  }

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
  function applyContactItemRecoil(hitDamage: number): void {
    if (hitDamage <= 0 || isFainted(attacker) || blockedBySubstitute) return;
    const denom = defenderItem?.contactAttackerDamageDenominator;
    if (!denom || !(effectiveMove.makesContact ?? false) || attackerAbility?.negatesIndirectDamage) return;
    const amount = Math.floor(attacker.maxHp / denom);
    if (amount <= 0) return;
    attacker.currentHp = Math.max(0, attacker.currentHp - amount);
    rockyHelmetDamage += amount;
    rockyHelmetItemName = defenderItem!.name;
  }

  function triggerAbilityHitEffect(hitDamage: number): HitAbilityEvent | undefined {
    if (hitDamage <= 0 || isFainted(attacker) || blockedBySubstitute) return undefined;
    const trigger = defenderAbility?.hitTrigger;
    if (!trigger) return undefined;
    const chance = trigger.chance !== undefined ? trigger.chance / 100 : 1;
    if (!hitTriggerMatchesMove(trigger, effectiveMove) || random() >= chance) return undefined;

    // 이번 호출(=이 한 타)에서 방어측 특성이 한 일 — 다단히트 로그를 타별로 찍는 데 쓴다.
    // 기존 집계 변수(abilityRaisedDefenderStats 등)는 그대로 두고 여기에 병렬로 담기만 한다.
    const ev: HitAbilityEvent = { abilityName: defenderAbility!.name };
    let evAny = false;

    if (
      trigger.inflictsStatusOnAttacker &&
      !isImmuneToStatus(trigger.inflictsStatusOnAttacker, attacker.types, statusImmunitiesOf(attacker, attackerAbility))
    ) {
      const before = attacker.status.condition;
      attacker.status = inflictStatus(attacker.status, trigger.inflictsStatusOnAttacker);
      if (attacker.status.condition !== before) {
        abilityInflictedStatusOnAttacker = attacker.status.condition;
        abilityInflictedStatusAbilityName = defenderAbility!.name;
        ev.statusOnAttacker = attacker.status.condition;
        evAny = true;
      }
    }
    // 헤롱헤롱바디: 접촉해 온 공격자와 이성 관계일 때만(무성별이거나 동성이면 조용히 무산) 공격자에게
    // 헤롱헤롱을 건다. 이미 헤롱헤롱 상태면 본가처럼 재발동하지 않는다.
    if (
      trigger.inflictsVolatileOnAttacker &&
      !(trigger.requiresOppositeGender && (attacker.gender === null || defender.gender === null || attacker.gender === defender.gender)) &&
      !hasVolatile(attacker.volatile, trigger.inflictsVolatileOnAttacker) &&
      // 아로마베일: 접촉기를 쓴 공격자가 이 특성이면 헤롱헤롱바디의 헤롱헤롱이 걸리지 않는다.
      !(
        (trigger.inflictsVolatileOnAttacker === "attract" || trigger.inflictsVolatileOnAttacker === "taunt") &&
        attackerAbility?.blocksMentalMoves
      )
    ) {
      attacker.volatile = inflictVolatile(attacker.volatile, trigger.inflictsVolatileOnAttacker, random);
      abilityInflictedVolatileOnAttacker = trigger.inflictsVolatileOnAttacker;
      abilityInflictedVolatileAbilityName = defenderAbility!.name;
      ev.volatileOnAttacker = trigger.inflictsVolatileOnAttacker;
      evAny = true;
      // 멘탈허브: 헤롱헤롱바디로 걸린 헤롱헤롱도 걸리는 순간 치료하고 소모된다.
      if (getMentalHerbCureResult(attackerItem, attacker.itemConsumed ?? false)) {
        attacker.volatile = { active: { ...attacker.volatile.active } };
        delete attacker.volatile.active[trigger.inflictsVolatileOnAttacker];
        consumeItem(attacker);
        statusCureBerryItemName = attackerItem!.name;
        abilityInflictedVolatileOnAttacker = undefined;
        abilityInflictedVolatileAbilityName = undefined;
        ev.volatileOnAttacker = undefined;
      }
    }
    // 매직가드: 까칠한피부·유폭류가 공격자에게 되돌리는 접촉 반사 데미지는 "공격기 데미지"가
    // 아니라서 무효화된다(공격자가 매직가드일 때).
    if (trigger.damagesAttackerFraction && !attackerAbility?.negatesIndirectDamage) {
      const amount = Math.floor(attacker.maxHp * trigger.damagesAttackerFraction);
      attacker.currentHp = Math.max(0, attacker.currentHp - amount);
      abilityDamageToAttacker += amount;
      abilityDamageAbilityName = defenderAbility!.name;
      ev.damageToAttacker = (ev.damageToAttacker ?? 0) + amount;
      evAny = true;
    }
    if (trigger.selfStatChanges) {
      for (const change of trigger.selfStatChanges) {
        const before = defender.stages[change.stat];
        defender.stages = applyStageDelta(defender.stages, change.stat, contraryDelta(defender, change.delta));
        const after = defender.stages[change.stat];
        // 실제로 변한 것만 로그에 남긴다(이미 상·하한이라 그대로면 조용히 무산). 다단히트면 폭 누적.
        // 깨어진갑옷은 한 번 발동에 방어 -1 / 스피드 +2가 같이 오므로 오름·내림을 각자 담는다.
        if (after !== before) {
          abilityRaisedDefenderStatsAbilityName = defenderAbility!.name;
          const bucket = after > before ? abilityRaisedDefenderStats : abilityLoweredDefenderStats;
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
    if (trigger.setsFieldOnHit && state.field !== trigger.setsFieldOnHit) {
      state.field = trigger.setsFieldOnHit;
      state.fieldTurnsRemaining = FIELD_DURATION;
      applyMimicryForm(attacker, state.field);
      applyMimicryForm(defender, state.field);
      seedSowerField = trigger.setsFieldOnHit;
      ev.setFieldOnHit = trigger.setsFieldOnHit;
      evAny = true;
      terrainSeedMessages.push(...triggerTerrainSeeds(state));
    }
    // 미끈미끈·점착(attackerStatChanges): 접촉해 온 공격자의 랭크를 내린다. 공격자의 클리어바디류
    // (blocksOpponentStatDropsForStats)·심술꾸러기(contraryDelta)는 그대로 존중한다. 미러아머 반사는
    // 이 로스터에 대상 조합이 없어 생략(공격자가 미러아머면 그냥 정상 하락).
    if (trigger.attackerStatChanges) {
      const blocked = statDropBlockStatsOf(attacker, attackerAbility);
      for (const change of trigger.attackerStatChanges) {
        if (blocked?.includes(change.stat)) continue;
        const before = attacker.stages[change.stat];
        attacker.stages = applyStageDelta(attacker.stages, change.stat, contraryDelta(attacker, change.delta));
        const after = attacker.stages[change.stat];
        if (after !== before) {
          abilityLoweredAttackerStatsAbilityName = defenderAbility!.name;
          const magnitude = Math.abs(after - before);
          const existing = abilityLoweredAttackerStats.find((s) => s.stat === change.stat);
          if (existing) existing.delta += magnitude;
          else abilityLoweredAttackerStats.push({ stat: change.stat, delta: magnitude });
          (ev.loweredAttackerStats ??= []).push({ stat: change.stat, delta: magnitude });
          evAny = true;
        }
      }
    }
    if (trigger.disablesAttackerMove && attacker.remainingPp[move.id] !== undefined) {
      attacker.remainingPp[move.id] = 0;
      abilityDisabledMoveName = move.name;
      abilityDisableAbilityName = defenderAbility!.name;
      ev.disabledMoveName = move.name;
      evAny = true;
    }
    // 나쁜손버릇: 피격측(defender)이 무도구이고 공격자(attacker)가 도구를 지녔으면 그 자리에서 강탈한다.
    // 매지션과 방향만 반대고 규칙은 동일 — 대타에 맞았을 때는 함수 진입부 가드(blockedBySubstitute)에서
    // 이미 걸러진다. 다단히트여도 첫 타에 도구를 얻는 순간 !defender.currentItemId가 깨져 재발동하지 않는다.
    // 점착: 공격자가 이 특성이면 나쁜손버릇에 도구를 빼앗기지 않는다.
    if (
      trigger.stealsAttackerItem &&
      !defender.currentItemId &&
      attacker.currentItemId &&
      !attackerAbility?.preventsItemLoss
    ) {
      const stolen = getItem(attacker.currentItemId);
      pickpocketStolenItemName = stolen?.name;
      pickpocketAbilityName = defenderAbility!.name;
      defender.currentItemId = attacker.currentItemId;
      defender.itemConsumed = false; // 새로 얻은 도구라 이전 소모 이력과 무관하게 쓸 수 있다
      attacker.currentItemId = null;
      ev.pickpocketStolenItemName = stolen?.name;
      evAny = true;
    }
    // 미라(Mummy): 접촉기로 피격당하면 공격자의 특성을 미라로 바꾼다. 이미 그 특성이면 무발동.
    if (
      trigger.setsAttackerAbilityId &&
      attacker.effectiveAbilityId !== trigger.setsAttackerAbilityId
    ) {
      attacker.effectiveAbilityId = trigger.setsAttackerAbilityId;
      mummifiedAttackerAbilityName = defenderAbility!.name;
      ev.mummifiedAttackerAbilityName = defenderAbility!.name;
      evAny = true;
    }
    // 떠도는영혼(Wandering Spirit): 접촉기로 피격당하면 공격자와 특성을 맞바꾼다.
    if (trigger.swapsAbilityWithAttacker && attacker.effectiveAbilityId !== defender.effectiveAbilityId) {
      const tmp = attacker.effectiveAbilityId;
      attacker.effectiveAbilityId = defender.effectiveAbilityId;
      defender.effectiveAbilityId = tmp;
      wanderingSpiritSwapped = true;
      ev.wanderingSpiritSwapped = true;
      evAny = true;
    }
    // 모래뿜기(Sand Spit): 데미지를 주는 기술로 피격당하면 날씨를 5턴짜리로 바꾼다(맞을 때마다).
    if (trigger.setsWeather && state.weather !== trigger.setsWeather) {
      state.weather = trigger.setsWeather;
      state.weatherTurnsRemaining = WEATHER_DURATION;
      sandSpitWeather = trigger.setsWeather;
      ev.sandSpitWeather = trigger.setsWeather;
      evAny = true;
    }
    // 유폭(Aftermath): 접촉기로 이 포켓몬이 쓰러진 그 순간 공격자에게 공격자 최대 HP 비율만큼 데미지.
    if (
      trigger.damagesContactAttackerFractionOnFaint &&
      isFainted(defender) &&
      !attackerAbility?.negatesIndirectDamage
    ) {
      const amount = Math.floor(attacker.maxHp * trigger.damagesContactAttackerFractionOnFaint);
      attacker.currentHp = Math.max(0, attacker.currentHp - amount);
      abilityDamageToAttacker += amount;
      abilityDamageAbilityName = defenderAbility!.name;
      ev.damageToAttacker = (ev.damageToAttacker ?? 0) + amount;
      evAny = true;
    }
    // 내용물분출: 기술로 쓰러진 순간, 그 마지막 타를 맞기 직전 남아 있던 HP만큼을 공격자에게 되돌린다.
    if (
      trigger.damagesAttackerByRemainingHpOnFaint &&
      isFainted(defender) &&
      !attackerAbility?.negatesIndirectDamage
    ) {
      const amount = Math.min(attacker.currentHp, defenderHpBeforeLastHit);
      if (amount > 0) {
        attacker.currentHp = Math.max(0, attacker.currentHp - amount);
        abilityDamageToAttacker += amount;
        abilityDamageAbilityName = defenderAbility!.name;
        ev.damageToAttacker = (ev.damageToAttacker ?? 0) + amount;
        evAny = true;
      }
    }

    return evAny ? ev : undefined;
  }

  // 방어/판별/킹실드가 성공했으면 데미지 계산 자체를 건너뛴다(대타처럼 흡수하는 게 아니라
  // 그냥 0으로 만든다) — 아래 세 분기 전부 이 가드로 묶는다.
  if (isDamaging && !blockedByProtect && effectiveMove.fixedDamage !== undefined) {
    // 나이트헤드류: 방어/랭크/특성/도구/급소를 전부 무시하고 고정 수치만 깎는다.
    // 타입 상성 면역(0배)만은 그대로 존중 — 반감/2배는 적용하지 않는다.
    damage = typeEffectiveness === 0 ? 0 : effectiveMove.fixedDamage;
    damagePercent = damage / defender.realStats.hp;
    {
      const preHp = defender.currentHp;
      applyDamageToDefender(damage);
      applyEndurance(preHp);
      triggerAbilityHitEffect(damage);
      applyContactItemRecoil(damage);
    }
  } else if (isDamaging && !blockedByProtect && effectiveMove.minHits !== undefined && effectiveMove.maxHits !== undefined) {
    // 다단히트: 명중 판정은 이미 위(첫 타 기준)에서 끝났으니 여기부턴 최소 1타는 맞은 상태로
    // 시작한다. 록블라스트류(multiHitPowers 없음)는 첫 타만 명중 판정하고 나머지는 자동 명중,
    // 트리플악셀(multiHitPowers 있음)은 타수마다 따로 명중을 판정해서 빗나가면 그 시점에서
    // 중단된다 — moves.json의 effect 텍스트에 이미 명시된 구분(사용자 확인). 급소는 다단히트
    // 종류와 무관하게 항상 타수마다 따로 판정한다(사용자 확인).
    const perHitAccuracyCheck = effectiveMove.multiHitPowers !== undefined;
    // 스킬링크: 2~5회 연속기를 항상 최대 횟수로 고정한다.
    const totalHits =
      perHitAccuracyCheck || attackerAbility?.multiHitAlwaysMax
        ? effectiveMove.maxHits
        : rollMultiHitCount(effectiveMove.minHits, effectiveMove.maxHits, random);

    let landed = 0;
    perHitLog = [];
    for (let i = 0; i < totalHits; i++) {
      if (i > 0 && perHitAccuracyCheck) {
        const stillHits = hitChance === null ? true : random() < hitChance;
        if (!stillHits) break;
      }
      const hitPower = effectiveMove.multiHitPowers?.[i] ?? effectiveMove.power;
      if (hitPower === null || hitPower === undefined) break;
      const hitMove = effectiveMove.multiHitPowers ? { ...effectiveMove, power: hitPower } : effectiveMove;
      const hitResult = resolveHit(hitMove);
      damage += hitResult.damage;
      if (hitResult.isCritical) isCritical = true;
      landed += 1;
      perHitLog.push({
        damage: hitResult.damage,
        damagePercent: hitResult.damage / defender.realStats.hp,
        critical: hitResult.isCritical,
      });
      const preHp = defender.currentHp;
      applyDamageToDefender(hitResult.damage);
      applyEndurance(preHp);
      // 이 타에서 방어측 on-hit 특성이 한 일을 그 타 레코드에 붙인다(로그를 타별로 찍기 위함).
      perHitLog[perHitLog.length - 1].abilityEvent = triggerAbilityHitEffect(hitResult.damage);
      applyContactItemRecoil(hitResult.damage);
      if (isFainted(defender) || substituteBroke) break; // 상대가 쓰러지거나 대타가 깨지면 남은 타수는 진행하지 않는다
    }
    damagePercent = damage / defender.realStats.hp;
    hitCount = landed;
  } else if (isDamaging && !blockedByProtect) {
    const hitResult = resolveHit(effectiveMove);
    damage = hitResult.damage;
    isCritical = hitResult.isCritical;
    damagePercent = damage / defender.realStats.hp;
    const preHp = defender.currentHp;
    applyDamageToDefender(damage);
    applyEndurance(preHp);
    triggerAbilityHitEffect(damage);
    applyContactItemRecoil(damage);
  }

  // 죽기살기(Endeavor, E-5): 데미지 계산이 없는(power null) 기술이라 위 분기에 안 걸린다.
  // 상대 HP를 사용자의 현재 HP와 같게 깎는다 — 상대가 더 많을 때만, 대타가 있으면 무효(단순화),
  // 노말→고스트 면역이면 typeEffectiveness가 0이라 스킵.
  let endeavorDamage = 0;
  if (
    effectiveMove.setsTargetHpToUserHp &&
    !blockedByProtect &&
    typeEffectiveness !== 0 &&
    defender.substituteHp === undefined &&
    defender.currentHp > attacker.currentHp
  ) {
    endeavorDamage = defender.currentHp - attacker.currentHp;
    defender.currentHp = attacker.currentHp;
    damage = endeavorDamage;
    actualDamageDealt = endeavorDamage;
    damagePercent = endeavorDamage / defender.maxHp;
  }

  // 무릎차기(crashFraction, E-2): 명중은 했지만 방어류에 막혔거나 타입 면역(격투→고스트)으로
  // 무효화됐으면 사용자가 최대 HP의 절반을 잃는다. 대타에 흡수된 경우는 "맞은" 것이라 제외.
  let crashDamage = 0;
  if (
    effectiveMove.crashFraction !== undefined &&
    !hitSubstitute &&
    (blockedByProtect || typeEffectiveness === 0)
  ) {
    crashDamage = Math.floor(attacker.maxHp * effectiveMove.crashFraction);
    attacker.currentHp = Math.max(0, attacker.currentHp - crashDamage);
  }

  // 떨어뜨리기(cancelsTargetCharge, E-1): 공중날기 등으로 무적인 상대에게 명중하면 그 차징을 캔슬.
  let canceledTargetChargeMoveName: string | undefined;
  if (effectiveMove.cancelsTargetCharge && defender.chargingMoveId && damage > 0) {
    canceledTargetChargeMoveName = getMove(defender.chargingMoveId)?.name;
    defender.chargingMoveId = undefined;
  }

  // 미러코트/카운터(counters, F-1): 이번 턴 사용자가 받은 해당 카테고리 데미지의 2배를 상대에게
  // 그대로 되돌린다. 우선도 -5라 보통 이 시점엔 상대가 이미 공격을 마친 뒤다. 타입 상성·자속·랭크
  // 전부 무시. 받은 데미지가 없거나(0) 상대가 면역 타입(특수 카운터=악, 물리 카운터=고스트)이면 실패.
  let counterDamage = 0;
  let counterFailed = false;
  if (effectiveMove.counters) {
    const taken = attacker.damageTakenThisTurn?.[effectiveMove.counters] ?? 0;
    const immuneType = effectiveMove.counters === "special" ? "악" : "고스트";
    if (taken <= 0 || defender.types.includes(immuneType)) {
      counterFailed = true;
    } else {
      counterDamage = Math.min(defender.currentHp, taken * 2);
      defender.currentHp -= counterDamage;
      damage = counterDamage;
      actualDamageDealt = counterDamage;
      damagePercent = counterDamage / defender.maxHp;
    }
  }

  // 앙갚음/메탈버스트(countersAllCategories): 이번 턴 받은 (물리+특수) 데미지 합의 multiplier배(1.5)를
  // 카테고리·타입·랭크 무시하고 되돌린다. counters와 달리 면역 타입이 없다. 받은 데미지가 0이면 실패.
  if (effectiveMove.countersAllCategories) {
    const taken =
      (attacker.damageTakenThisTurn?.physical ?? 0) + (attacker.damageTakenThisTurn?.special ?? 0);
    if (taken <= 0) {
      counterFailed = true;
    } else {
      counterDamage = Math.min(
        defender.currentHp,
        Math.floor(taken * effectiveMove.countersAllCategories.multiplier),
      );
      defender.currentHp -= counterDamage;
      damage = counterDamage;
      actualDamageDealt = counterDamage;
      damagePercent = counterDamage / defender.maxHp;
    }
  }

  // 부자유친: 단일타 기술이 실제로 데미지를 준 뒤(다단히트/고정데미지는 제외 — 본가에서도 이미
  // 여러 번 때리는 기술과는 안 겹침), 같은 컨텍스트로 위력만 배율만큼 줄인 추가타를 한 번 더
  // 날린다. 첫 타로 이미 상대가 쓰러졌으면 추가타는 나가지 않는다.
  let followUpHitDamage = 0;
  if (
    isDamaging &&
    !blockedByProtect &&
    damage > 0 &&
    !isFainted(defender) &&
    effectiveMove.fixedDamage === undefined &&
    effectiveMove.minHits === undefined &&
    effectiveMove.power !== null &&
    attackerAbility?.followUpHitPowerMultiplier
  ) {
    const followUpMove = { ...effectiveMove, power: Math.round(effectiveMove.power * attackerAbility.followUpHitPowerMultiplier) };
    const followUpResult = resolveHit(followUpMove);
    followUpHitDamage = followUpResult.damage;
    damage += followUpHitDamage;
    damagePercent = damage / defender.realStats.hp;
    if (followUpResult.isCritical) isCritical = true;
    const preHp = defender.currentHp;
    applyDamageToDefender(followUpHitDamage);
    applyEndurance(preHp);
    triggerAbilityHitEffect(followUpHitDamage);
    applyContactItemRecoil(followUpHitDamage);
  }

  // 발버둥 반동: 필중이라 항상 이 지점까지 오고, 명중/기절 여부와 무관하게 사용자가
  // 최대 HP의 1/4만큼 반동 데미지를 입는다 (상대 데미지와는 별개 계산).
  let selfDamage = 0;
  if (move.id === STRUGGLE_MOVE.id) {
    selfDamage = Math.floor(attacker.maxHp / 4);
    attacker.currentHp = Math.max(0, attacker.currentHp - selfDamage);
  }

  // 반동(recoil): 플레어드라이브·웨이브태클·브레이브버드·양날박치기. 상대에게 "실제로 깎인"
  // HP(actualDamageDealt)의 일정 비율만큼 사용자도 입는다 — 오버킬로 이론상 데미지가 상대
  // 잔여 HP보다 커도, 반동은 실제로 들어간 HP만큼만 기준으로 계산해야 한다(본가 규칙).
  // damage(이론상 수치)를 쓰면 반동이 부풀려지는 버그가 된다. actualDamageDealt가 0(면역 등)
  // 이면 반동도 자연히 0이 된다. 매직가드: 반동기(recoilFraction)의 반동은 "공격기 데미지"가
  // 아니라서 무효화된다.
  let recoilDamage = 0;
  if (effectiveMove.recoilFraction !== undefined && actualDamageDealt > 0 && !attackerAbility?.negatesIndirectDamage) {
    recoilDamage = Math.floor(actualDamageDealt * effectiveMove.recoilFraction);
    attacker.currentHp = Math.max(0, attacker.currentHp - recoilDamage);
  }

  // 생명의구슬: 데미지를 실제로 준 공격이 성공할 때마다 최대 HP의 1/10만큼 자신도 반동을
  // 입는다 — 다단히트도 타수 수와 무관하게 이번 행동에 한 번만 적용(본가 규칙). 이쪽은 데미지
  // 양과 무관한 고정 비율(공격자 최대 HP 기준)이라 오버킬 버그와는 무관하지만, "데미지가 실제로
  // 들어갔는지" 게이트는 다른 항목들과 일관되게 actualDamageDealt로 맞춘다.
  // 단, 이번 기술에서 우격다짐(sheerForceAbilityName)이 실제로 발동했다면 생명의구슬 반동은
  // 면제된다 — 본가에서 확인된 특수 상호작용(Bulbapedia: Sheer Force negates Life Orb recoil).
  // 위력 상승·아이템 데미지 보너스는 그대로 받으면서 반동만 사라진다.
  let itemRecoilDamage = 0;
  let itemRecoilItemName: string | undefined;
  // 매직가드: 생명의구슬 반동도 무효화한다(위력·데미지 보너스는 그대로 — 우격다짐과 같은 결).
  if (
    isDamaging &&
    actualDamageDealt > 0 &&
    attackerItem?.selfRecoilFractionOfMaxHp &&
    !sheerForceAbilityName &&
    !attackerAbility?.negatesIndirectDamage
  ) {
    itemRecoilDamage = Math.floor(attacker.maxHp * attackerItem.selfRecoilFractionOfMaxHp);
    attacker.currentHp = Math.max(0, attacker.currentHp - itemRecoilDamage);
    itemRecoilItemName = attackerItem.name;
  }

  // 흡수기(기가드레인·드레인펀치·드레인키스·원념의칼): 실제로 깎인 HP(actualDamageDealt)의
  // 일정 비율만큼 회복 — recoil과 같은 이유로 이론상 데미지(damage)가 아니라 실제 HP 감소분을
  // 기준으로 써야 오버킬 시 회복량이 부풀려지지 않는다. 큰뿌리를 지녔으면 회복량이 1.3배.
  // recoil의 정반대 축이라 recoilDamage와 별도로 관리한다.
  let drainHealAmount = 0;
  // 해감액: 방어측이 이 특성이면 흡수분만큼 공격측이 회복 대신 데미지를 입는다.
  let liquidOozeDamage = 0;
  let liquidOozeAbilityName: string | undefined;
  if (isDamaging && actualDamageDealt > 0 && effectiveMove.drainFraction !== undefined) {
    const rawDrain = Math.floor(
      actualDamageDealt * effectiveMove.drainFraction * getDrainHealMultiplier(attackerItem),
    );
    if (defenderAbility?.reverseDrainHealsToDamage) {
      liquidOozeDamage = Math.min(attacker.currentHp, rawDrain);
      attacker.currentHp -= liquidOozeDamage;
      liquidOozeAbilityName = defenderAbility.name;
    } else {
      drainHealAmount = rawDrain;
      attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + drainHealAmount);
    }
  }

  // 조개껍질방울: 실제로 깎인 HP(actualDamageDealt)의 1/8만큼 회복(오버킬 시 부풀려지지 않게).
  // 흡수기와는 별개 축이라 같은 행동에서 동시에 발동할 수 있다.
  let shellBellHealAmount = 0;
  if (isDamaging && actualDamageDealt > 0 && attackerItem?.damageDealtHealDenominator) {
    shellBellHealAmount = Math.floor(actualDamageDealt / attackerItem.damageDealtHealDenominator);
    attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + shellBellHealAmount);
  }

  // 매지션: 실제로 HP를 깎은(actualDamageDealt > 0) 공격이 명중했고, 자신이 무도구 상태
  // (currentItemId 없음)면 그 자리에서 상대가 지닌 도구를 빼앗는다. damage(이론상 수치)를
  // 쓰면 탈(Disguise)처럼 데미지가 전부 무효화된 히트도 "명중"으로 잘못 취급된다. 자신이
  // 이미 도구를 지녔으면 발동하지 않고(본가 규칙), 상대도 무도구면 훔칠 게 없어 조용히 아무
  // 일도 안 일어난다. 대타가 대신 맞았을 때는 상대의 "실제 소지품"과 무관한 인형에 닿은
  // 것이므로 훔치지 않는다.
  let stolenItemName: string | undefined;
  if (
    isDamaging &&
    actualDamageDealt > 0 &&
    !hitSubstitute &&
    attackerAbility?.stealsItemOnDamagingHit &&
    !attacker.currentItemId &&
    defender.currentItemId &&
    !defenderAbility?.preventsItemLoss // 점착: 이 특성이면 매지션에게 도구를 빼앗기지 않는다
  ) {
    const stolenItem = getItem(defender.currentItemId);
    stolenItemName = stolenItem?.name;
    attacker.currentItemId = defender.currentItemId;
    attacker.itemConsumed = false; // 새로 얻은 도구라 이전 소모 이력과 무관하게 다시 쓸 수 있다
    defender.currentItemId = null;
  }

  // 자폭류(대폭발 등): 명중했으면 반드시 데미지를 먼저 입힌 "다음" 사용자가 기절한다.
  // 순서가 중요하다 — 이 데미지로 상대가 이미 쓰러졌다면, 실제 게임처럼 "상대를 먼저 쓰러뜨린 뒤
  // 반동으로 자신도 쓰러진 것"으로 취급되어야 승자 판정(runTurn)이 이 행동의 주체를 승자로 잡는다.
  if (effectiveMove.selfFaints) {
    attacker.currentHp = 0;
  }

  // 길동무: 생명의구슬 반동/흡수기 회복/조개껍질방울 등 공격측 HP에 영향을 주는 후처리가 전부
  // 끝난 뒤에 마지막으로 판정한다 — 상대를 쓰러뜨리며 동시에 흡수기로 회복했더라도, 길동무는
  // "HP를 깎는" 효과가 아니라 그 자리에서 확정적으로 기절시키는 효과라 이후 회복을 무시해야
  // 한다(=먼저 판정하면 나중 회복이 되살리는 버그가 생김). 다단히트/부자유친 추가타 중 어느 타가
  // 상대를 쓰러뜨렸든 이 시점의 defender.currentHp/destinyBondArmed만 보면 되므로 한 번으로 충분.
  checkDestinyBond();
  return { abilityDamageAbilityName, abilityDamageToAttacker, abilityDisableAbilityName, abilityDisabledMoveName, abilityInflictedStatusAbilityName, abilityInflictedStatusOnAttacker, abilityInflictedVolatileAbilityName, abilityInflictedVolatileOnAttacker, abilityLoweredAttackerStats, abilityLoweredAttackerStatsAbilityName, abilityLoweredDefenderStats, abilityRaisedDefenderStats, abilityRaisedDefenderStatsAbilityName, angerPointAbilityName, angerPointRaisedSpa, berryReducedDamageItemName, canceledTargetChargeMoveName, cheekPouchHeal, counterDamage, counterFailed, crashDamage, damage, damagePercent, destinyBondTriggered, disguiseRecoilDamage, drainHealAmount, endeavorDamage, enduredAbilityName, enduredItemName, enduredProtectMoveName, followUpHitDamage, hitCount, hitNegatedByAbilityName, hitSubstitute, illusionBrokenSpeciesId, isCritical, isDamaging, itemRecoilDamage, itemRecoilItemName, liquidOozeAbilityName, liquidOozeDamage, mummifiedAttackerAbilityName, perHitLog, pickpocketAbilityName, pickpocketStolenItemName, recoilDamage, rockyHelmetDamage, rockyHelmetItemName, sandSpitWeather, seedSowerField, selfDamage, shellBellHealAmount, statusCureBerryItemName, stolenItemName, substituteBroke, terrainSeedMessages, wanderingSpiritSwapped };
}

