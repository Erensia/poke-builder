import { type Move } from "@/types/move";
import { type PokemonType } from "@/types/pokemon-type";
import { type FighterKey } from "@/types/battle";
import { BATTLE_STAT_KEYS, NEUTRAL_ACCURACY_STAGES, NEUTRAL_STAGES, isBattleStatKey, type BattleStatKey, type StatStages } from "@/types/battleStats";
import { NO_STATUS_CONDITION, type StatusCondition, type StatusConditionState, type VolatileCondition } from "@/types/status";
import { type Ability } from "@/types/ability";
import { type Item } from "@/types/item";
import { getAbility, getMove, getPokemon } from "@/lib/data";
import { applyMoveStatChanges, applyStageDelta, clampStagesToNonNegative } from "@/lib/statStages";
import { applyMoveAccuracyEvasionChanges, applyMoveCritStageChanges } from "@/lib/accuracyCrit";
import { inflictRestSleep, inflictStatus, isImmuneToStatus } from "@/lib/statusConditions";
import { hasVolatile, inflictVolatile } from "@/lib/volatileConditions";
import { rankStageMultiplier } from "@/lib/battlePower";
import { computeWeatherHealFraction } from "@/lib/weatherEffects";
import { FIELD_DURATION, isConfusionBlockedByField, isOpponentTargetingMove, isStatusBlockedByField } from "@/lib/fieldEffects";
import { getConfusionCureBerryResult, getExtraFlinchTriggered, getMentalHerbCureResult, getStatusCureBerryResult, shouldTriggerWhiteHerb } from "@/lib/itemEffects";
import { activeWeather, applyTransform, consumeItem, contraryDelta, contraryMoveFor, emptyHazardState, hasLivingReserve, isFainted, sideOf, statDropBlockStatsOf, statusImmunitiesOf, type BattleFighterState, type BattleState } from "./state";
import { triggerTerrainSeeds } from "./switching";

interface MirroredMoveEffectsInput {
  bouncedByMagicMirror: boolean;
  move: Move;
  effectiveMove: Move;
  opponentEffectsBlocked: boolean;
  random: () => number;
  state: BattleState;
  hit: boolean;
  movesSecond: boolean;
  defenderKey: FighterKey;
  damage: number;
  hitSubstitute: boolean;
  defenderMove: Move;
  actorKey: FighterKey;
  defenderBerriesBlocked: boolean;
  attackerBerriesBlocked: boolean;
  blockedByProtect: boolean;
  sheerForceAbilityName: string | undefined;
  isDamaging: boolean;
  selfCuredStatus: StatusCondition | null | undefined;
  terrainSeedMessages: string[];
  defenderAbility: Ability | undefined;
  attacker: BattleFighterState;
  defender: BattleFighterState;
  attackerAbility: Ability | undefined;
  attackerItem: Item | undefined;
  defenderItem: Item | undefined;
  abilityInflictedStatusOnAttacker: StatusCondition | null | undefined;
  abilityInflictedStatusAbilityName: string | undefined;
  statusCureBerryItemName: string | undefined;
  mentalMoveBlockedByAbilityName: string | undefined;
}
export function resolveMirroredMoveEffects(input: MirroredMoveEffectsInput) {
  let {
    bouncedByMagicMirror, move, effectiveMove, opponentEffectsBlocked, random, state, hit, movesSecond, defenderKey, damage, hitSubstitute, defenderMove, actorKey, defenderBerriesBlocked, attackerBerriesBlocked, blockedByProtect, sheerForceAbilityName, isDamaging, selfCuredStatus, terrainSeedMessages, defenderAbility, attacker, defender, attackerAbility, attackerItem, defenderItem, abilityInflictedStatusOnAttacker, abilityInflictedStatusAbilityName, statusCureBerryItemName, mentalMoveBlockedByAbilityName,
  } = input;
  // ── 매직미러 반사 구간 시작 ──
  // 여기서부터 스텔스록 설치까지의 "방어측 방향" 효과 블록에 한해 공격/방어 바인딩을 맞바꾼다.
  // 되돌린 기술은 원래 시전자(이제 defender) 기준으로 상태이상 면역·조사·도구·승기까지 전부
  // 재평가된다. 블록이 끝나면 곧바로 원위치하며, 로그·후처리는 원래 방향 기준으로 돌아간다.
  // status 카테고리라 데미지 경로(resolveHit 등)는 이 지점 이전에 이미 no-op으로 끝나 있다.
  let bounceActive = false;
  let bouncedMoveName: string | undefined;
  let bouncedByAbilityName: string | undefined;
  if (bouncedByMagicMirror) {
    bounceActive = true;
    bouncedMoveName = move.name;
    bouncedByAbilityName = defenderAbility!.name;
    [attacker, defender] = [defender, attacker];
    [attackerAbility, defenderAbility] = [defenderAbility, attackerAbility];
    [attackerItem, defenderItem] = [defenderItem, attackerItem];
  }

  // 인분(Shield Dust): 방어측이 이 특성이면, 데미지 기술이 방어측에게 딸려 거는 추가효과
  // (상태이상·행동방해·랭크변화 — chance 유무 무관)를 전부 무산시킨다. 변화기 주효과와 자기 대상
  // 효과는 대상이 아니다. hasSheerForceSecondaryEffect(우격다짐)와 같은 "추가효과" 정의를 공유.
  const secondaryEffectsBlockedByAbility =
    effectiveMove.category !== "status" && !!defenderAbility?.blocksSecondaryEffects;
  let secondaryBlockedByAbilityName: string | undefined;

  // 볼가득넣기(eatsHeldBerry): 지닌 나무열매(이름이 "열매"로 끝나는 도구)를 먹는다 — 없으면 실패.
  // HP 회복 나무열매(자뭉·오랭)면 즉시 그만큼 회복(HP 조건 무시). 방어 +2는 아래 statChanges로 적용.
  let berryEatFailed = false;
  let stuffCheeksBerryHeal = 0;
  let stuffCheeksBerryName: string | undefined;
  if (effectiveMove.eatsHeldBerry) {
    const berry = attackerItem && attackerItem.name.endsWith("열매") ? attackerItem : undefined;
    if (!berry) {
      berryEatFailed = true;
    } else {
      stuffCheeksBerryName = berry.name;
      const ripenMult = attackerAbility?.doublesBerryEffect ? 2 : 1; // 숙성
      const rawHeal =
        (berry.healsBelowHalfHpDenominator
          ? Math.floor(attacker.maxHp / berry.healsBelowHalfHpDenominator)
          : (berry.healsBelowHalfHpFlat ?? 0)) * ripenMult;
      stuffCheeksBerryHeal = Math.min(attacker.maxHp - attacker.currentHp, rawHeal);
      attacker.currentHp += stuffCheeksBerryHeal;
      consumeItem(attacker);
    }
  }

  // 소울비트(costsHpFraction): 사용 시 최대 HP의 이 비율을 소비한다. 현재 HP가 소비량 이하면
  // (=쓰면 기절) 실패해서 랭크업도 없다. 성공하면 statChanges(5스탯 +1) 적용 직전에 HP를 깎는다.
  let costHpFailed = false;
  let soulBeatHpCost = 0;
  if (effectiveMove.costsHpFraction !== undefined) {
    soulBeatHpCost = Math.floor(attacker.maxHp * effectiveMove.costsHpFraction);
    if (attacker.currentHp <= soulBeatHpCost) {
      costHpFailed = true;
      soulBeatHpCost = 0;
    } else {
      attacker.currentHp -= soulBeatHpCost;
    }
  }

  // 기술 자신의 랭크/명중회피/급소 변화 적용 (칼춤, 그림자분신, 기충전 등).
  // attacker/defender는 state.a/state.b를 그대로 참조하고 있어 여기서 바꾼 값이 state에도 반영된다.
  const attackerStagesBeforeMoveChange = attacker.stages;
  const defenderStagesBeforeMoveChange = defender.stages;
  // 확률부(chance) statChanges는 여기서 굴려서 통과한 항목만 남긴다(확정은 그대로). 인분이면
  // 상대 대상 항목은 굴림 없이 통째로 제거한다. 예전엔 applyMoveStatChanges가 chance를 굴리지
  // 않고 100%로 적용하던 버그가 있었다(불꽃춤 자기 특공↑ 50%·브레이크클로 상대 방어↓ 50%).
  const rolledStatChanges = berryEatFailed || costHpFailed
    ? []
    : effectiveMove.statChanges?.filter((sc) => {
        if (secondaryEffectsBlockedByAbility && sc.target === "opponent") {
          // 방어/대타/황금몸으로 이미 통째로 막힌 경우엔 "인분" 문구를 따로 낼 필요가 없다.
          if (!opponentEffectsBlocked) secondaryBlockedByAbilityName = defenderAbility!.name;
          return false;
        }
        return sc.chance === undefined || random() * 100 < sc.chance;
      });
  const statChangeMove: Move = { ...effectiveMove, statChanges: rolledStatChanges };
  // 심술꾸러기: 랭크 변화를 받는 쪽이 Contrary면 delta 부호를 뒤집은 기술로 적용한다(자기 랭크변화·상대가 건 랭크변화 모두).
  // weather: 성장(쾌청이면 +1 추가로 얹어 총 +2)처럼 날씨 조건부 statChanges 항목 판정용.
  const statChangeWeather = activeWeather(state);
  attacker.stages = applyMoveStatChanges(attacker.stages, contraryMoveFor(statChangeMove, attacker), "self", {
    userTypes: attacker.types,
    weather: statChangeWeather,
  });
  defender.stages = opponentEffectsBlocked
    ? defender.stages
    : applyMoveStatChanges(defender.stages, contraryMoveFor(statChangeMove, defender), "opponent", {
        userTypes: attacker.types,
        weather: statChangeWeather,
      });

  // 랭크업 결과 문구용(Phase 6.5 §6-2 ⑥⑦, §6-3): 이 기술이 사용자 자신의 랭크를 실제로 올린 것과,
  // 올리려 했으나 이미 +6이라 막힌 것을 각각 모은다. 확정 랭크업만 대상 — 확률 부가효과(chance)와
  // 자기 랭크다운 디메리트(delta ≤ 0), 명중/회피/급소는 제외. 승기·하양허브 등 뒤 후처리 전에 측정.
  const selfStatRises: { stat: BattleStatKey; delta: number }[] = [];
  const selfStatsAtMax: BattleStatKey[] = [];
  // §4-6: selfStatRises와 대칭 — 골드러시·오버히트·용성군처럼 자기 대상 확정 랭크 하락
  // 부가효과가 실제로 적용된 것을 모은다. delta는 내려간 칸 수(양수)로 opponentStatDrops와
  // 같은 포맷을 쓴다. 엔진 계산(attacker.stages)은 이미 정상 동작하고 있었고, 이 결과를
  // 담을 로그 필드가 없던 게 §4-6의 원인이었다.
  const selfStatDrops: { stat: BattleStatKey; delta: number }[] = [];
  for (const sc of effectiveMove.statChanges ?? []) {
    if (sc.target !== "self" || sc.chance !== undefined) continue;
    if (!isBattleStatKey(sc.stat) || (sc.delta ?? 0) === 0) continue;
    const before = attackerStagesBeforeMoveChange[sc.stat];
    const after = attacker.stages[sc.stat];
    if ((sc.delta ?? 0) > 0) {
      if (after > before) selfStatRises.push({ stat: sc.stat, delta: after - before });
      else if (before >= 6) selfStatsAtMax.push(sc.stat);
    } else if (after < before) {
      selfStatDrops.push({ stat: sc.stat, delta: before - after });
    }
  }

  // 클리어바디(전체)·괴력집게(공격만)·미러아머(반사): 방금 적용된 opponent 랭크변화 중 실제로
  // 내려간 스탯만(-6 클램프로 변화가 없었던 건 자연히 제외) 골라서, 막을 스탯이면 원래 값으로
  // 되돌리고, 반사 특성이면 원래 값으로 되돌린 뒤 그만큼을 공격측에게 대신 적용한다. "상대의
  // 기술로" 내려간 것만 대상이라 방금 위에서 적용한 opponent 방향 변화만 비교하면 충분하다.
  const blockedStats = statDropBlockStatsOf(defender, defenderAbility);
  const reflects = defenderAbility?.reflectsOpponentStatDrops;
  // 미러아머 반사 문구용(E-4): 실제로 시전자(attacker)에게 되돌아간 랭크다운을 모은다. 특성/변화기
  // 랭크다운뿐 아니라 데미지 기술의 부가 랭크다운(브레이크클로 등)도 rolledStatChanges에 반영돼
  // 있어 여기서 같은 방식으로 잡힌다.
  let reflectedStatDropAbilityName: string | undefined;
  const reflectedStatDrops: { stat: BattleStatKey; delta: number }[] = [];
  if (blockedStats || reflects) {
    for (const stat of Object.keys(defender.stages) as BattleStatKey[]) {
      const dropAmount = defenderStagesBeforeMoveChange[stat] - defender.stages[stat];
      if (dropAmount <= 0) continue;
      if (reflects) {
        defender.stages = { ...defender.stages, [stat]: defenderStagesBeforeMoveChange[stat] };
        const attackerBefore = attacker.stages[stat];
        attacker.stages = applyStageDelta(attacker.stages, stat, -dropAmount);
        const applied = attackerBefore - attacker.stages[stat];
        if (applied > 0) {
          reflectedStatDropAbilityName = defenderAbility!.name;
          reflectedStatDrops.push({ stat, delta: applied });
        }
      } else if (blockedStats?.includes(stat)) {
        defender.stages = { ...defender.stages, [stat]: defenderStagesBeforeMoveChange[stat] };
      }
    }
  }

  // 승기: 자신의 능력치가 실제로 하락했으면(이미 -6으로 클램프돼 변화가 없었던 건 제외) 그
  // 즉시 지정된 랭크가 오른다. 자기 기술로 자기 스탯을 내렸든(공격측), 상대 기술로 스탯이
  // 내려갔든(방어측) 둘 다 같은 방식으로 판정한다 — 각자 자기 자신의 stages before/after만 비교.
  function applyCompetitiveBoost(
    fighter: BattleFighterState,
    ability: Ability | undefined,
    before: StatStages,
  ): void {
    const boost = ability?.boostsStatOnOwnStatDrop;
    if (!boost) return;
    const dropped = (Object.keys(fighter.stages) as BattleStatKey[]).some((stat) => fighter.stages[stat] < before[stat]);
    if (dropped) fighter.stages = applyStageDelta(fighter.stages, boost.stat, boost.delta);
  }
  applyCompetitiveBoost(attacker, attackerAbility, attackerStagesBeforeMoveChange);
  applyCompetitiveBoost(defender, defenderAbility, defenderStagesBeforeMoveChange);

  // 하양허브: 방금 반영된 랭크 중 마이너스가 하나라도 있으면(자신이 스스로 내렸든, 상대 기술로
  // 내려갔든) 그 즉시 마이너스 랭크만 전부 0으로 되돌리고 소모된다. 양쪽 다 이 도구를 지녔고
  // 같은 턴에 둘 다 마이너스가 됐으면(드문 경우) 둘 다 독립적으로 발동한다.
  let restoredStatsSelfItemName: string | undefined;
  let restoredStatsOpponentItemName: string | undefined;
  if (shouldTriggerWhiteHerb(attackerItem, attacker.stages, attacker.itemConsumed ?? false)) {
    attacker.stages = clampStagesToNonNegative(attacker.stages);
    consumeItem(attacker);
    restoredStatsSelfItemName = attackerItem?.name;
  }
  if (shouldTriggerWhiteHerb(defenderItem, defender.stages, defender.itemConsumed ?? false)) {
    defender.stages = clampStagesToNonNegative(defender.stages);
    consumeItem(defender);
    restoredStatsOpponentItemName = defenderItem?.name;
  }

  // 편승(Opportunist): 이번 기술로 한쪽이 자신의 랭크를 올렸으면(위 statChanges·competitive·하양허브
  // 후처리까지 전부 반영된 최종값 기준), 상대 쪽에 편승 특성이 있으면 그 상승분을 그대로 복사한다.
  // 자기 자신의 상승은 복사 대상이 아니고, 복사 적용 시엔 복사자 쪽 심술꾸러기/클리어바디류를 존중한다.
  function applyOpportunistCopy(
    copier: BattleFighterState,
    copierAbility: Ability | undefined,
    riser: BattleFighterState,
    riserBefore: StatStages,
  ): { stat: BattleStatKey; delta: number }[] {
    if (!copierAbility?.copiesOpponentStatBoosts) return [];
    const copied: { stat: BattleStatKey; delta: number }[] = [];
    for (const stat of Object.keys(riser.stages) as BattleStatKey[]) {
      const gain = riser.stages[stat] - riserBefore[stat];
      if (gain <= 0) continue;
      const before = copier.stages[stat];
      copier.stages = applyStageDelta(copier.stages, stat, contraryDelta(copier, gain));
      const applied = copier.stages[stat] - before;
      if (applied !== 0) copied.push({ stat, delta: applied });
    }
    return copied;
  }
  const opportunistCopiedByDefender = applyOpportunistCopy(
    defender,
    defenderAbility,
    attacker,
    attackerStagesBeforeMoveChange,
  );
  const opportunistCopiedByAttacker = applyOpportunistCopy(
    attacker,
    attackerAbility,
    defender,
    defenderStagesBeforeMoveChange,
  );
  const opportunistCopiedStats =
    opportunistCopiedByDefender.length > 0
      ? opportunistCopiedByDefender
      : opportunistCopiedByAttacker.length > 0
        ? opportunistCopiedByAttacker
        : undefined;
  const opportunistAbilityName = opportunistCopiedStats
    ? (opportunistCopiedByDefender.length > 0 ? defenderAbility : attackerAbility)?.name
    : undefined;

  // 상대 랭크다운 결과 문구용(§1 C-6): 이 기술이 실제로 상대 랭크를 내린 것만 모은다. 최종
  // defender.stages 기준이라 클리어바디로 막혔거나 미러아머로 반사됐거나 하양허브로 되돌아간
  // 경우엔 net 변화가 0이라 자연히 제외된다. selfStatRises와 대칭 — 확정 하락만(확률 부가효과는
  // rolledStatChanges 단계에서 이미 굴려져 통과한 것만 남아 있고, 실제 하락분으로 판정).
  const opponentStatDrops: { stat: BattleStatKey; delta: number }[] = [];
  if (!opponentEffectsBlocked) {
    const seen = new Set<BattleStatKey>();
    for (const sc of rolledStatChanges ?? []) {
      if (sc.target !== "opponent" || !isBattleStatKey(sc.stat) || seen.has(sc.stat)) continue;
      seen.add(sc.stat);
      const drop = defenderStagesBeforeMoveChange[sc.stat] - defender.stages[sc.stat];
      if (drop > 0) opponentStatDrops.push({ stat: sc.stat, delta: drop });
    }
  }

  attacker.accuracyStages = applyMoveAccuracyEvasionChanges(
    attacker.accuracyStages,
    contraryMoveFor(effectiveMove, attacker),
    "self",
    { userTypes: attacker.types },
  );
  const defenderAccuracyBeforeChange = defender.accuracyStages.accuracy;
  defender.accuracyStages = opponentEffectsBlocked
    ? defender.accuracyStages
    : applyMoveAccuracyEvasionChanges(defender.accuracyStages, contraryMoveFor(effectiveMove, defender), "opponent", {
        userTypes: attacker.types,
      });
  // 날카로운눈: 상대(공격측)의 기술로 자신의 명중률이 떨어지는 걸 막는다. 회피율 변화는 이
  // 축과 무관해서(원문이 "명중률을 떨어뜨릴 수 없다"까지만) 건드리지 않는다.
  if (defenderAbility?.blocksOpponentAccuracyDrops && defender.accuracyStages.accuracy < defenderAccuracyBeforeChange) {
    defender.accuracyStages = { ...defender.accuracyStages, accuracy: defenderAccuracyBeforeChange };
  }
  attacker.critStage = applyMoveCritStageChanges(attacker.critStage, effectiveMove, "self", {
    userTypes: attacker.types,
  });
  defender.critStage = opponentEffectsBlocked
    ? defender.critStage
    : applyMoveCritStageChanges(defender.critStage, effectiveMove, "opponent", {
        userTypes: attacker.types,
      });

  // 흑안개: 명중하면 양쪽의 5스탯 랭크 + 명중률/회피율 랭크를 전부 초기화한다. 급소율(critStage)은
  // 본가에서 별개 축이라 건드리지 않는다. 자신/상대 구분이 의미 없는(둘 다 리셋되는) 유일한
  // statChanges류 효과라 별도 필드로 분리했다.
  if (effectiveMove.resetsAllStages) {
    attacker.stages = { ...NEUTRAL_STAGES };
    defender.stages = { ...NEUTRAL_STAGES };
    attacker.accuracyStages = { ...NEUTRAL_ACCURACY_STAGES };
    defender.accuracyStages = { ...NEUTRAL_ACCURACY_STAGES };
  }

  // 뒤집어엎기(invertsTargetStatStages): 명중 시 상대에게 현재 걸려 있는 5스탯 + 명중률/회피율
  // 랭크의 부호를 전부 뒤집는다(+2 → -2). 급소율은 흑안개와 같은 이유로 건드리지 않는다.
  let invertedTargetStages = false;
  if (effectiveMove.invertsTargetStatStages && hit && !opponentEffectsBlocked && !isFainted(defender)) {
    defender.stages = Object.fromEntries(
      Object.entries(defender.stages).map(([k, v]) => [k, -v]),
    ) as typeof defender.stages;
    defender.accuracyStages = {
      accuracy: -defender.accuracyStages.accuracy,
      evasion: -defender.accuracyStages.evasion,
    };
    invertedTargetStages = true;
  }

  // 숲의저주(풀)·핼러윈(고스트): 명중 시 상대의 타입 목록에 그 타입을 추가한다(배틀 끝까지 유지).
  // addedType에도 기록해 두어 의태/기분파가 타입을 재계산해도 이 추가 타입이 다시 붙게 한다.
  let addedTypeToTarget: PokemonType | undefined;
  if (
    effectiveMove.addsTypeToTarget &&
    hit &&
    !opponentEffectsBlocked &&
    !isFainted(defender) &&
    !defender.types.includes(effectiveMove.addsTypeToTarget)
  ) {
    defender.addedType = effectiveMove.addsTypeToTarget;
    defender.types = [...defender.types, effectiveMove.addsTypeToTarget];
    addedTypeToTarget = effectiveMove.addsTypeToTarget;
  }

  // 마법가루(setsTargetType): 명중 시 상대의 타입을 이 타입 하나로 통째로 덮어쓴다(치환, 배틀 끝까지).
  let overwroteTargetType: PokemonType | undefined;
  if (
    effectiveMove.setsTargetType &&
    hit &&
    !opponentEffectsBlocked &&
    !isFainted(defender) &&
    !(defender.types.length === 1 && defender.types[0] === effectiveMove.setsTargetType)
  ) {
    defender.types = [effectiveMove.setsTargetType];
    defender.addedType = undefined;
    overwroteTargetType = effectiveMove.setsTargetType;
  }

  // 송전(changesTargetMoveTypeThisTurn): 명중 시, 공격측이 이번 턴 먼저 움직였을 때만(=상대가
  // 아직 행동 안 함) 상대가 이번 턴 쓰는 기술의 타입을 전기로 바꾼다. 턴 종료 시 runTurn이 해제한다.
  let targetMoveTypeOverride: PokemonType | undefined;
  if (
    effectiveMove.changesTargetMoveTypeThisTurn &&
    hit &&
    !opponentEffectsBlocked &&
    !isFainted(defender) &&
    !movesSecond
  ) {
    defender.moveTypeOverrideThisTurn = effectiveMove.changesTargetMoveTypeThisTurn;
    targetMoveTypeOverride = effectiveMove.changesTargetMoveTypeThisTurn;
  }

  let inflictedStatus: StatusConditionState["condition"] | undefined;
  // 이미 걸린 상태이상 때문에 상태이상 전용 변화기(맹독·도깨비불 등)가 아무 변화도 못 냈으면 true.
  // C-8: "블래키의 맹독 - 그러나 실패했다!". 데미지 기술의 부가 상태이상은 그냥 안 걸린 것뿐이라 대상 아님.
  let statusInflictFailed = false;
  if (secondaryEffectsBlockedByAbility && effectiveMove.inflictsStatus && !opponentEffectsBlocked) {
    // 인분: 데미지 기술이 거는 상태이상(화염방사 화상·연옥 100% 화상·볼부비부비 마비 등)은
    // 전부 추가효과라 무산된다. 변화기(도깨비불 등)의 상태이상은 secondaryEffectsBlockedByAbility가
    // false라 이 분기에 오지 않는다.
    secondaryBlockedByAbilityName = defenderAbility!.name;
  } else if (!opponentEffectsBlocked && effectiveMove.inflictsStatus) {
    for (const effect of effectiveMove.inflictsStatus) {
      if (
        isImmuneToStatus(
          effect.status,
          defender.types,
          statusImmunitiesOf(defender, defenderAbility),
          attackerAbility?.bypassesPoisonTypeImmunity,
        )
      )
        continue;
      if (isStatusBlockedByField(state.field, effect.status)) continue;
      if (sideOf(state, defenderKey).safeguardTurnsRemaining !== undefined) continue;
      // 쾌청(강한 햇살) 날씨에서는 얼음 상태에 걸리지 않는다 — 타입 면역과는 다른 축이라 별도 확인
      if (effect.status === "freeze" && activeWeather(state) === "쾌청") continue;
      const chance = effect.chance !== undefined ? effect.chance / 100 : 1;
      if (random() < chance) {
        const before = defender.status.condition;
        defender.status = inflictStatus(defender.status, effect.status);
        if (defender.status.condition !== before) inflictedStatus = defender.status.condition;
        else if (effectiveMove.category === "status" && effect.chance === undefined) statusInflictFailed = true;
        break; // 주 상태이상은 한 번에 하나만 걸린다 (중첩 없음)
      }
    }
  }

  // 페이탈클로(inflictsRandomStatus): 데미지를 준 뒤 이 확률로 statuses 중 하나를 무작위로 걸어본다.
  // 인분(추가효과 차단)·황금몸·대타·이미 상태이상 규칙은 통상 부가 상태이상과 동일하게 존중한다.
  if (
    effectiveMove.inflictsRandomStatus &&
    hit &&
    damage > 0 &&
    !hitSubstitute &&
    !opponentEffectsBlocked &&
    !inflictedStatus
  ) {
    if (secondaryEffectsBlockedByAbility) {
      secondaryBlockedByAbilityName = defenderAbility!.name;
    } else if (random() * 100 < effectiveMove.inflictsRandomStatus.chance) {
      const pool = effectiveMove.inflictsRandomStatus.statuses;
      const picked = pool[Math.floor(random() * pool.length)];
      if (
        picked &&
        !isImmuneToStatus(picked, defender.types, statusImmunitiesOf(defender, defenderAbility)) &&
        !isStatusBlockedByField(state.field, picked) &&
        sideOf(state, defenderKey).safeguardTurnsRemaining === undefined &&
        !(picked === "freeze" && activeWeather(state) === "쾌청")
      ) {
        const before = defender.status.condition;
        defender.status = inflictStatus(defender.status, picked);
        if (defender.status.condition !== before) inflictedStatus = defender.status.condition;
      }
    }
  }

  // 질투의불꽃(burnsTargetIfStatRoseThisTurn): 명중해서 데미지를 줬고, 이번 턴에 방어자의 랭크가
  // 하나라도 올랐으면(턴 시작 스냅샷 대비) 화상을 건다(확정). 대타를 맞혔으면 본체엔 안 건다.
  // 통상 화상 면역(불꽃 타입·특성·이미 상태이상·미스트필드)·인분·황금몸 규칙은 그대로 존중한다.
  if (
    effectiveMove.burnsTargetIfStatRoseThisTurn &&
    hit &&
    damage > 0 &&
    !hitSubstitute &&
    !opponentEffectsBlocked &&
    !secondaryEffectsBlockedByAbility &&
    !inflictedStatus
  ) {
    const rose = BATTLE_STAT_KEYS.some(
      (stat) => defender.stages[stat] > (defender.statStagesAtTurnStart?.[stat] ?? 0),
    );
    if (
      rose &&
      !isImmuneToStatus("burn", defender.types, statusImmunitiesOf(defender, defenderAbility)) &&
      !isStatusBlockedByField(state.field, "burn") &&
      sideOf(state, defenderKey).safeguardTurnsRemaining === undefined
    ) {
      const before = defender.status.condition;
      defender.status = inflictStatus(defender.status, "burn");
      if (defender.status.condition !== before) inflictedStatus = defender.status.condition;
    }
  }

  // 독수(Poison Touch): 접촉기로 데미지를 준 직후 이 확률로 상대를 독 상태로 만든다(독가시
  // hitTrigger의 공격측 버전). 타입/특성 상태이상 면역·필드는 그대로 존중. 대타를 맞혔으면 본체엔
  // 안 건다. 이미 다른 부가 상태이상이 걸린 경우는 중첩하지 않는다.
  if (
    attackerAbility?.poisonTouchChance !== undefined &&
    (effectiveMove.makesContact ?? false) &&
    hit &&
    damage > 0 &&
    !hitSubstitute &&
    !inflictedStatus &&
    !isImmuneToStatus("poison", defender.types, statusImmunitiesOf(defender, defenderAbility), attackerAbility?.bypassesPoisonTypeImmunity) &&
    !isStatusBlockedByField(state.field, "poison") &&
    sideOf(state, defenderKey).safeguardTurnsRemaining === undefined &&
    random() * 100 < attackerAbility.poisonTouchChance
  ) {
    const before = defender.status.condition;
    defender.status = inflictStatus(defender.status, "poison");
    if (defender.status.condition !== before) inflictedStatus = defender.status.condition;
  }

  // 부리캐논(Beak Blast): 방어측이 이번 턴 부리캐논을 골랐고 아직 발동 전(=공격측이 이번 턴 먼저
  // 움직임)인데 공격측이 접촉기로 때리면, 가열된 부리에 데어 공격측이 화상을 입는다. 원격이면
  // move.makesContact가 이미 false라 자연히 제외된다. 대타 피격은 접촉이 아니라 제외.
  let beakBlastBurnedAttacker = false;
  if (
    defenderMove.burnsContactAttackerBeforeResolve &&
    !movesSecond &&
    (move.makesContact ?? false) &&
    hit &&
    !hitSubstitute &&
    !isFainted(attacker) &&
    !isImmuneToStatus("burn", attacker.types, statusImmunitiesOf(attacker, attackerAbility)) &&
    !isStatusBlockedByField(state.field, "burn") &&
    sideOf(state, actorKey).safeguardTurnsRemaining === undefined
  ) {
    const before = attacker.status.condition;
    attacker.status = inflictStatus(attacker.status, "burn");
    if (attacker.status.condition !== before) beakBlastBurnedAttacker = true;
  }

  // 싱크로: 이번 행동으로 방어측이 지정된 상태이상에 걸렸으면(원인은 이 블록 — 상대 기술) 그
  // 즉시 공격측에게도 같은 상태이상을 건다. abilityInflictedStatusOnAttacker는 정전기/불꽃몸
  // hitTrigger와 같은 필드를 재사용한다 — "방어측 특성이 공격측에게 상태이상을 걸었다"는 점에서
  // 의미가 동일하고, 한 포켓몬이 두 특성을 동시에 가질 수 없어 충돌하지 않는다.
  if (
    inflictedStatus &&
    defenderAbility?.reflectsStatusToOpponent?.includes(inflictedStatus) &&
    !isImmuneToStatus(inflictedStatus, attacker.types, statusImmunitiesOf(attacker, attackerAbility)) &&
    !isStatusBlockedByField(state.field, inflictedStatus) &&
    sideOf(state, actorKey).safeguardTurnsRemaining === undefined &&
    !(inflictedStatus === "freeze" && activeWeather(state) === "쾌청")
  ) {
    const beforeAttackerStatus = attacker.status.condition;
    attacker.status = inflictStatus(attacker.status, inflictedStatus);
    if (attacker.status.condition !== beforeAttackerStatus) {
      abilityInflictedStatusOnAttacker = attacker.status.condition;
      abilityInflictedStatusAbilityName = defenderAbility.name;
    }
  }

  // 상태이상 치료 관련 상태(물거품아리아 등 치료 기술, 불꽃 피격 해동, 잠듦/얼음 자연 해제,
  // 잠자기, 상태이상 즉시치료 나무열매)를 전부 여기 한 변수에 모은다 — 아래에서 순서대로 채워진다.
  let curedStatus: StatusConditionState["condition"] | undefined;
  let curedStatusTarget: "self" | "opponent" | undefined;

  // 상태이상 즉시치료 나무열매(리샘·버치·유루·복슝·복분·배리): 걸리는 "그 순간" 치료하고 소모된다.
  // itemConsumed는 나무열매 18종(타입내성)과 같은 축을 공유하므로(도구 1개=1회용), 이미 다른
  // 나무열매 효과가 이번 배틀에서 소모됐으면 발동하지 않는다.
  if (
    inflictedStatus &&
    !defenderBerriesBlocked &&
    getStatusCureBerryResult(defenderItem, inflictedStatus, defender.itemConsumed ?? false)
  ) {
    defender.status = { ...NO_STATUS_CONDITION };
    consumeItem(defender);
    statusCureBerryItemName = defenderItem!.name;
    curedStatus = inflictedStatus;
    curedStatusTarget = "opponent";
  }

  let inflictedVolatile: VolatileCondition | undefined;
  if (effectiveMove.inflictsVolatile) {
    for (const effect of effectiveMove.inflictsVolatile) {
      if (effect.volatile === "confusion" && isConfusionBlockedByField(state.field)) continue;
      // 정신력: 풀죽음 자체에 면역이라 발동 시도 자체가 무산된다(본가 규칙 — 확률 판정까지 가지 않음)
      if (effect.volatile === "flinch" && effect.target !== "self" && defenderAbility?.immuneToFlinch) continue;
      // 아로마베일: 방어측이 이 특성이면 헤롱헤롱·도발이 걸리지 않는다(마음을 옭아매는 기술 차단).
      if (
        effect.target !== "self" &&
        defenderAbility?.blocksMentalMoves &&
        (effect.volatile === "attract" || effect.volatile === "taunt")
      ) {
        mentalMoveBlockedByAbilityName = defenderAbility.name;
        continue;
      }
      // 황금몸: 상대(공격측)를 향한 변화기 효과만 막는다 — target이 "self"(공격측 자신에게
      // 거는 것, 예: 반동/하품 예약)면 이 포켓몬을 겨냥한 게 아니라서 그대로 진행된다.
      if (effect.target !== "self" && opponentEffectsBlocked) continue;
      // 인분: 데미지 기술이 상대에게 거는 행동방해(아이언헤드 풀죽음·물의파동 혼란 등)도 추가효과.
      if (effect.target !== "self" && secondaryEffectsBlockedByAbility) {
        secondaryBlockedByAbilityName = defenderAbility!.name;
        continue;
      }
      const target = effect.target === "self" ? attacker : defender;
      // 하품(졸음): 대상이 이미 다른 주 상태이상이거나 이미 졸음 상태면 실패한다(본가 규칙) —
      // 실제 잠듦 여부(타입/필드 면역)는 2턴 뒤 트리거 시점에 따로 확인한다.
      if (effect.volatile === "drowsy" && (target.status.condition || hasVolatile(target.volatile, "drowsy"))) {
        continue;
      }
      // 희망사항(§6-2): fighter volatile이 아니라 편(BattleSide.wish)에 큐로 건다 — 2턴 뒤
      // 그 자리(활성)의 포켓몬이 회복받으므로 교체와 무관하게 유지돼야 한다. 회복량은 시전 시점
      // 시전자 최대 HP의 절반(고정). 이미 이 편에 예약돼 있으면 재사용 실패(본가 규칙).
      // (wish는 자기 편 겨냥이라 매직미러 반사 대상이 아니다 — actorKey가 곧 시전자 편.)
      if (effect.volatile === "wish") {
        const wisherSide = sideOf(state, actorKey);
        if (wisherSide.wish) continue;
        const wishChance = effect.chance !== undefined ? effect.chance / 100 : 1;
        if (random() >= wishChance) continue;
        wisherSide.wish = { turnsRemaining: 2, healAmount: Math.floor(state[actorKey].maxHp / 2) };
        inflictedVolatile = "wish"; // 시전 로그("· 희망사항!")용 마커
        continue;
      }
      // 헤롱헤롱: 이미 헤롱헤롱 상태거나(재사용 실패, drowsy/wish와 같은 패턴), 대상 또는
      // 거는 쪽이 무성별이거나 둘이 동성이면(getEffectiveGender 기준) 조용히 무산된다 — 본가에서도
      // 이 경우 "But it failed!"로 아무 효과 없이 끝난다.
      if (effect.volatile === "attract") {
        const inflicter = effect.target === "self" ? defender : attacker;
        if (
          hasVolatile(target.volatile, "attract") ||
          target.gender === null ||
          inflicter.gender === null ||
          target.gender === inflicter.gender
        ) {
          continue;
        }
      }
      // 도발: 이미 도발 상태면 재시전은 실패한다(턴수 리셋 없이 조용히 무산 — 본가 "그러나
      // 실패했다!"). statusInflictFailed는 위 inflictsStatus 루프와 같은 변수를 공유한다 —
      // "이 행동으로 뭔가 걸려던 게 무산됐다"는 의미가 같아서 렌더 문구도 그대로 재사용된다.
      if (effect.volatile === "taunt" && hasVolatile(target.volatile, "taunt")) {
        statusInflictFailed = true;
        continue;
      }
      const chance = effect.chance !== undefined ? effect.chance / 100 : 1;
      if (random() >= chance) continue;
      if (effect.target === "self") {
        attacker.volatile = inflictVolatile(attacker.volatile, effect.volatile, random);
      } else {
        defender.volatile = inflictVolatile(defender.volatile, effect.volatile, random);
      }
      inflictedVolatile = effect.volatile;

      // 시몬열매: 혼란에 걸리는 순간 치료하고 소모된다
      if (effect.volatile === "confusion") {
        const targetBerriesBlocked = effect.target === "self" ? attackerBerriesBlocked : defenderBerriesBlocked;
        const targetItem = targetBerriesBlocked ? undefined : effect.target === "self" ? attackerItem : defenderItem;
        if (getConfusionCureBerryResult(targetItem, target.itemConsumed ?? false)) {
          target.volatile = { active: { ...target.volatile.active } };
          delete target.volatile.active.confusion;
          consumeItem(target);
          statusCureBerryItemName = targetItem!.name;
          inflictedVolatile = undefined;
        }
      }

      // 멘탈허브: 헤롱헤롱/도발이 걸리는 순간 치료하고 소모된다. 나무열매가 아니라 긴장감
      // (berriesBlocked)의 영향을 받지 않는다.
      if (effect.volatile === "attract" || effect.volatile === "taunt") {
        const targetItem = effect.target === "self" ? attackerItem : defenderItem;
        if (getMentalHerbCureResult(targetItem, target.itemConsumed ?? false)) {
          target.volatile = { active: { ...target.volatile.active } };
          delete target.volatile.active[effect.volatile];
          consumeItem(target);
          statusCureBerryItemName = targetItem!.name;
          inflictedVolatile = undefined;
        }
      }
    }
  }

  // 정리정돈·고속스핀(Move.hazardClear): 명중 시 설치물·대타를 정리한다. 본가 규칙(방어류는
  // "자신/아군 대상"·"모든 포켓몬 대상" 기술을 막지 못한다 — Bulbapedia Protect 문서)상
  // 정리정돈(자신+상대 양쪽 대상, status)은 방어류에 안 막히지만, 고속스핀은 상대 1마리를
  // 겨냥하는 데미지 기술이라 막히면 부가효과(설치물 정리)도 함께 무산된다(§1.4 버그 수정 —
  // 이전엔 둘 다 blockedByProtect로 묶여 있어 정리정돈까지 잘못 막혔었다).
  let tidyUpDone = false;
  if (effectiveMove.hazardClear === "tidy" && hit) {
    state.sideA.hazards = emptyHazardState();
    state.sideB.hazards = emptyHazardState();
    attacker.substituteHp = undefined;
    defender.substituteHp = undefined;
    tidyUpDone = true;
  } else if (effectiveMove.hazardClear === "spin" && hit && !blockedByProtect) {
    // 사용자 쪽 설치물 + 사용자에게 걸린 속박·씨뿌리기만 정리한다(본가 고속스핀).
    sideOf(state, actorKey).hazards = emptyHazardState();
    const nextActive = { ...attacker.volatile.active };
    delete nextActive.bound;
    delete nextActive.leechSeed;
    attacker.volatile = { active: nextActive };
  }

  // 코트체인지(Move.swapsSideEffects): 명중 시 양쪽 진영의 설치물(hazards)·스크린(screens)을
  // 통째로 맞바꾼다. 필드·날씨·트릭룸은 장 전체 효과라 대상이 아니다(본가와 동일). 양쪽 편
  // 전체가 대상이라 방어류에 막히지 않는다(본가 규칙 — 정리정돈과 같은 축. §1.4 버그 수정 전엔
  // blockedByProtect로 잘못 막혔었다).
  let courtChangeDone = false;
  if (effectiveMove.swapsSideEffects && hit) {
    const swapHazards = state.sideA.hazards;
    state.sideA.hazards = state.sideB.hazards;
    state.sideB.hazards = swapHazards;
    const swapScreens = state.sideA.screens;
    state.sideA.screens = state.sideB.screens;
    state.sideB.screens = swapScreens;
    courtChangeDone = true;
  }

  // 회생의기도(Move.revivesFaintedAlly): 명중 시 기절한 교대 포켓몬 1마리(가장 앞 슬롯)를 최대
  // HP의 절반으로 부활시킨다. 벤치 부활이라 교체(pendingPivot)는 일어나지 않는다. 부활 대상이
  // 없으면 실패("그러나 실패했다!"). 아군 대상 기술이라 방어류에 막히지 않는다(본가 규칙 —
  // §1.4 버그 수정 전엔 blockedByProtect로 잘못 막혔었다).
  let revivedPartyName: string | undefined;
  let reviveFailed = false;
  if (effectiveMove.revivesFaintedAlly && hit) {
    const mySide = sideOf(state, actorKey);
    const target = mySide.party.find((f, i) => i !== mySide.activeIndex && isFainted(f));
    if (target) {
      target.currentHp = Math.max(1, Math.floor(target.maxHp / 2));
      revivedPartyName = getPokemon(target.slot.pokemonId)?.name ?? target.slot.pokemonId;
    } else {
      reviveFailed = true;
    }
  }

  // 시럽봄(Move.setsSyrupCoat): 명중 시 상대를 물엿범벅(syrupCoat, 3턴) 상태로 만든다. 데미지 기술의
  // 부가효과라 인분·우격다짐엔 발동하지 않고, 황금몸(opponentEffectsBlocked)에도 막힌다.
  if (
    effectiveMove.setsSyrupCoat &&
    hit &&
    !blockedByProtect &&
    !opponentEffectsBlocked &&
    !secondaryEffectsBlockedByAbility &&
    !sheerForceAbilityName &&
    !isFainted(defender) &&
    !hasVolatile(defender.volatile, "syrupCoat")
  ) {
    defender.volatile = inflictVolatile(defender.volatile, "syrupCoat", random);
  }

  // 소금절이(Move.setsSaltCure): 명중해서 데미지를 준 뒤 상대를 소금절이(saltCure, 영구) 상태로 만든다.
  // 인분·우격다짐엔 발동하지 않는다(공격 데미지만). 황금몸에도 막힌다.
  let saltCureApplied = false;
  if (
    effectiveMove.setsSaltCure &&
    hit &&
    !blockedByProtect &&
    damage > 0 &&
    !opponentEffectsBlocked &&
    !secondaryEffectsBlockedByAbility &&
    !sheerForceAbilityName &&
    !isFainted(defender) &&
    !hasVolatile(defender.volatile, "saltCure")
  ) {
    defender.volatile = inflictVolatile(defender.volatile, "saltCure", random);
    saltCureApplied = true;
  }

  // 풍선(Item.grantsGroundImmunity): 데미지를 주는 기술에 맞으면(땅타입은 애초에 면역이라
  // damage가 0 — 안 터짐) 그 즉시 터져서 소모된다. 이후 판정부터는 다시 땅타입에 노출된다.
  let balloonPoppedItemName: string | undefined;
  if (damage > 0 && defenderItem?.grantsGroundImmunity && !defender.itemConsumed) {
    balloonPoppedItemName = defenderItem.name;
    consumeItem(defender);
  }

  // 문어굳히기(Move.octolock): 변화기. 명중 시 상대를 octolock 상태로 만든다 — 교체 봉인 +
  // 매 턴 종료 시 방어·특수방어 -1. 부가효과 취급이라 인분·우격다짐·황금몸에 막힌다.
  let octolockApplied = false;
  if (
    effectiveMove.octolock &&
    hit &&
    !blockedByProtect &&
    !opponentEffectsBlocked &&
    !secondaryEffectsBlockedByAbility &&
    !sheerForceAbilityName &&
    !isFainted(defender) &&
    !hasVolatile(defender.volatile, "octolock")
  ) {
    defender.volatile = inflictVolatile(defender.volatile, "octolock", random);
    octolockApplied = true;
  }

  // 물고버티기(Move.jawLock): 데미지 기술. 명중 시 사용자와 대상 양쪽을 jawLock 상태로 만든다
  // (양쪽 교체 봉인). 이미 어느 쪽이든 걸려 있으면 재적용 안 함. 지속 데미지·랭크 변화 없음.
  let jawLockApplied = false;
  if (
    effectiveMove.jawLock &&
    hit &&
    !blockedByProtect &&
    damage > 0 &&
    !opponentEffectsBlocked &&
    !isFainted(defender) &&
    !isFainted(attacker) &&
    !hasVolatile(defender.volatile, "jawLock") &&
    !hasVolatile(attacker.volatile, "jawLock")
  ) {
    defender.volatile = inflictVolatile(defender.volatile, "jawLock", random);
    attacker.volatile = inflictVolatile(attacker.volatile, "jawLock", random);
    jawLockApplied = true;
  }

  // 왕의징표석: 데미지를 주는 데 성공하면 이 확률로 상대에게 추가 풀죽음을 건다. 기술 자체의
  // 풀죽음 확률(있다면)과는 완전히 별개 판정이라, 기술이 이미 풀죽음을 걸었으면 중복으로 다시
  // 걸 필요가 없다(로그에 "풀죽음!"이 두 번 찍히는 것만 방지 — 결과 자체는 어차피 동일).
  // 악취: 왕의징표석과 같은 축의 특성 버전 — 공격측이 이 특성이면 이 확률로 추가 풀죽음.
  const stenchFlinchTriggered =
    attackerAbility?.flinchChanceOnHit !== undefined && random() * 100 < attackerAbility.flinchChanceOnHit;
  if (
    isDamaging &&
    damage > 0 &&
    inflictedVolatile !== "flinch" &&
    !isFainted(defender) &&
    !defenderAbility?.immuneToFlinch &&
    (getExtraFlinchTriggered(attackerItem, random) || stenchFlinchTriggered)
  ) {
    if (defenderAbility?.blocksSecondaryEffects) {
      // 인분: 왕의징표석·악취가 얹는 추가 풀죽음도 추가효과라 무산된다(굴림은 이미 소비 — 결과만 버린다).
      secondaryBlockedByAbilityName = defenderAbility.name;
    } else {
      defender.volatile = inflictVolatile(defender.volatile, "flinch", random);
      inflictedVolatile = "flinch";
    }
  }

  // 불굴의마음: 이번 행동에서 풀죽음이 걸렸으면(기술 자체든 왕의징표석이든, 둘 다 위에서
  // 이미 defender.volatile에 반영됨) 그 즉시 지정된 랭크가 오른다.
  if (inflictedVolatile === "flinch" && defenderAbility?.boostsStatOnFlinch) {
    const boost = defenderAbility.boostsStatOnFlinch;
    defender.stages = applyStageDelta(defender.stages, boost.stat, contraryDelta(defender, boost.delta));
  }

  // 상태이상 치료: 물거품아리아처럼 명중 시 대상의 주 상태이상을 없앤다(inflictsStatus의 반대 방향).
  // status가 지정돼 있으면(물거품아리아=화상) 그 상태일 때만 치료 — 다른 상태이상은 안 지운다.
  if (effectiveMove.curesStatus) {
    const { target: cureTarget, status: cureStatus } = effectiveMove.curesStatus;
    const target = cureTarget === "self" ? attacker : defender;
    if (target.status.condition && (!cureStatus || target.status.condition === cureStatus)) {
      curedStatus = target.status.condition;
      curedStatusTarget = cureTarget;
      target.status = { ...NO_STATUS_CONDITION };
    }
  }

  // 얼음 상태의 상대가 불꽃타입 "데미지" 기술(물리/특수)에 맞으면 해제 확률(매턴 25%)과 무관하게
  // 즉시 해동된다 — 본가 규칙. 도깨비불처럼 변화기(status)는 타입이 불꽃이어도 해동시키지 않는다
  // (사용자 확인). curesStatus처럼 특정 기술만 태깅하는 게 아니라 "불꽃타입 데미지 기술이면 전부"
  // 적용되는 일반 규칙이라 별도로 둔다.
  if (
    effectiveMove.type === "불꽃" &&
    effectiveMove.category !== "status" &&
    defender.status.condition === "freeze"
  ) {
    curedStatus = "freeze";
    curedStatusTarget = "opponent";
    defender.status = { ...NO_STATUS_CONDITION };
  }

  // 이번 행동 시작 시점에 자신의 잠듦/얼음이 자연 해제(또는 thawsUserOnUse 강제 해동)됐으면
  // 별도 필드로 넘긴다 — 로그에서 기술 줄보다 먼저 렌더해야 하므로 curedStatus(행동 이후에
  // 일어나는 것들)와 섞지 않는다.
  const selfWokeBeforeMove = selfCuredStatus;

  // 잠자기: 명중(항상 필중)하면 기존 상태이상이 뭐든 지우고 체력을 완전히 회복한 뒤 정확히 2턴간
  // 무조건 재운다 — curesStatus/inflictsStatus의 일반 규칙(이미 상태이상이 있으면 못 걺)과는
  // 다른 별도 경로라 여기서 직접 덮어쓴다. curedStatus 로그는 재우기 전 상태이상이 있었을 때만 채운다.
  let restSlept = false;
  if (effectiveMove.restSleep) {
    if (attacker.status.condition) {
      curedStatus = attacker.status.condition;
      curedStatusTarget = "self";
    }
    attacker.currentHp = attacker.maxHp;
    attacker.status = inflictRestSleep();
    restSlept = true;

    // 리샘열매/유루열매 등을 지닌 채로 잠자기를 쓰면, 회복은 이미 끝난 채로 그 즉시 잠듦만
    // 치료된다(본가 실제 상호작용 — 잠자기 자체가 낭비되지만 회복은 유효하다).
    if (!attackerBerriesBlocked && getStatusCureBerryResult(attackerItem, "sleep", attacker.itemConsumed ?? false)) {
      attacker.status = { ...NO_STATUS_CONDITION };
      consumeItem(attacker);
      statusCureBerryItemName = attackerItem!.name;
      curedStatus = "sleep";
      curedStatusTarget = "self";
      restSlept = false;
    }
  }

  // 즉시 회복형 변화기: 광합성/달빛(날씨 의존)·날개쉬기/게으름피우기(고정 50%)·치유파동(상대 50%).
  // 잠자기는 위에서 이미 별도 처리했으니 여기선 건드리지 않는다.
  let healedAmount = 0;
  let healedTarget: "self" | "opponent" | undefined;
  if (!effectiveMove.restSleep && (effectiveMove.healsFraction !== undefined || effectiveMove.healsWeatherDependent)) {
    healedTarget = effectiveMove.healsTarget ?? "self";
    const healTarget = healedTarget === "self" ? attacker : defender;
    // 메가솔라: 자신이 쓰는 광합성·달빛류(자기 회복)의 회복량이 항상 쾌청 기준(2/3)이 된다.
    const healWeather =
      healedTarget === "self" && attackerAbility?.treatsOwnWeatherAsSun ? "쾌청" : activeWeather(state);
    const fraction = effectiveMove.healsWeatherDependent
      ? computeWeatherHealFraction(healWeather)
      : effectiveMove.healsFraction!;
    healedAmount = Math.min(
      healTarget.maxHp - healTarget.currentHp,
      Math.floor(healTarget.maxHp * fraction),
    );
    healTarget.currentHp += healedAmount;
  }

  // 힘흡수(drainsFromTargetAttackStat): 상대의 공격 실능(랭크 반영, -1 적용 전 값)만큼 자신을 회복.
  // 상대 공격 -1은 데이터의 statChanges로 위에서 이미 적용됐지만, 회복량은 랭크 변화 전 실능
  // 기준이라 defenderStagesBeforeMoveChange를 쓴다(본가 규칙).
  if (effectiveMove.drainsFromTargetAttackStat) {
    const targetAtk = Math.floor(
      defender.realStats.atk * rankStageMultiplier(defenderStagesBeforeMoveChange.atk),
    );
    const gain = Math.min(attacker.maxHp - attacker.currentHp, targetAtk);
    attacker.currentHp += gain;
    healedAmount = gain;
    healedTarget = "self";
  }

  // 가드셰어(averagesDefensesWithTarget): 자신·상대의 방어·특방 실능을 각각 더해 반씩 배정(내림).
  // 파워트릭(swapsOwnStats)처럼 realStats를 직접 고쳐 재계산이 필요 없다.
  let averagedDefensesMoveName: string | undefined;
  if (effectiveMove.averagesDefensesWithTarget) {
    const avgDef = Math.floor((attacker.realStats.def + defender.realStats.def) / 2);
    const avgSpd = Math.floor((attacker.realStats.spd + defender.realStats.spd) / 2);
    attacker.realStats = { ...attacker.realStats, def: avgDef, spd: avgSpd };
    defender.realStats = { ...defender.realStats, def: avgDef, spd: avgSpd };
    averagedDefensesMoveName = effectiveMove.name;
  }

  // 스피드스왑(swapsSpeedWithTarget): 자신·상대의 스피드 실능을 서로 맞바꾼다.
  let swappedSpeedMoveName: string | undefined;
  if (effectiveMove.swapsSpeedWithTarget) {
    const aSpe = attacker.realStats.spe;
    attacker.realStats = { ...attacker.realStats, spe: defender.realStats.spe };
    defender.realStats = { ...defender.realStats, spe: aSpe };
    swappedSpeedMoveName = effectiveMove.name;
  }

  // 변신(transformsIntoTarget): 상대로 변신한다. 이미 변신 상태면 실패(1v1이라 배틀 끝까지 유지).
  let transformedIntoName: string | undefined;
  let transformFailed = false;
  if (effectiveMove.transformsIntoTarget) {
    if (attacker.transformed) {
      transformFailed = true;
    } else {
      applyTransform(attacker, defender);
      transformedIntoName = getPokemon(defender.slot.pokemonId)?.name ?? "상대";
    }
  }

  // 뿌리박기/아쿠아링: 이미 걸려있으면 재사용 실패(지속 효과 중복 방지, 필드/트릭룸과 같은 패턴).
  let regenSetFailed = false;
  if (effectiveMove.setsRegenVolatile) {
    if (hasVolatile(attacker.volatile, effectiveMove.setsRegenVolatile)) {
      regenSetFailed = true;
    } else {
      attacker.volatile = inflictVolatile(attacker.volatile, effectiveMove.setsRegenVolatile, random);
    }
  }

  // 씨뿌리기: 풀타입 상대에겐 통하지 않는다(본가 규칙 — 가루 기술과 같은 축의 면역). 그 외에는
  // 상대가 이미 씨앗이 박혀있으면 실패.
  let leechSeedSetFailed = false;
  let leechSeedBlockedByGrass = false;
  if (effectiveMove.setsLeechSeed) {
    if (defender.types.includes("풀")) {
      leechSeedBlockedByGrass = true;
    } else if (hasVolatile(defender.volatile, "leechSeed")) {
      leechSeedSetFailed = true;
    } else {
      defender.volatile = inflictVolatile(defender.volatile, "leechSeed", random);
    }
  }

  // 조이기·엉겨붙기·집게덫 등(bindsTarget): 데미지를 준 뒤 상대를 4~5턴 속박한다(volatile "bound").
  // 대타를 맞혔거나 이미 속박 중이면 갱신하지 않는다.
  if (
    effectiveMove.bindsTarget &&
    damage > 0 &&
    !hitSubstitute &&
    !isFainted(defender) &&
    !hasVolatile(defender.volatile, "bound")
  ) {
    defender.volatile = inflictVolatile(defender.volatile, "bound", random);
  }

  // 심플빔("단순")·바뀌어라 등(setsTargetAbilityId): 명중 시 상대 특성을 지정 id로 바꾼다.
  // 방어/대타/황금몸/매직미러로 상대 방향 효과가 막혔으면 무발동. 이미 그 특성이면 실패 표기.
  let abilitySwappedTargetToName: string | undefined;
  let abilitySwapFailed = false;
  if (effectiveMove.setsTargetAbilityId && hit && !opponentEffectsBlocked && !isFainted(defender)) {
    if (defender.effectiveAbilityId === effectiveMove.setsTargetAbilityId) {
      abilitySwapFailed = true;
    } else {
      defender.effectiveAbilityId = effectiveMove.setsTargetAbilityId;
      abilitySwappedTargetToName = getAbility(effectiveMove.setsTargetAbilityId)?.name ?? effectiveMove.setsTargetAbilityId;
    }
  }

  // 대타출동: 이미 대타가 있거나, 최대 HP 1/4보다 현재 HP가 많지 않으면(=쓰면 자신이 기절하거나
  // 대타 HP가 0 이하가 되는 경우) 실패한다. 성공하면 그 즉시 HP를 깎고 같은 양만큼의 대타를 세운다.
  let substituteSetFailed = false;
  if (effectiveMove.setsSubstitute) {
    const substituteCost = Math.floor(attacker.maxHp / 4);
    if (attacker.substituteHp !== undefined || attacker.currentHp <= substituteCost) {
      substituteSetFailed = true;
    } else {
      attacker.currentHp -= substituteCost;
      attacker.substituteHp = substituteCost;
    }
  }

  // 꼬리자르기: 최대 HP 1/2을 깎아 그만큼의 대타를 세운 뒤 교대 포켓몬과 교체한다(교체·대타 인계는
  // runActionPhase에서 처리). HP가 절반 이하이거나, 이미 대타가 있거나, 교대할 살아있는 예비가
  // 없으면 실패한다 — 대타도 안 세우고 교체도 안 한다.
  let shedTailFailed = false;
  let shedTailSucceeded = false;
  if (effectiveMove.shedTail) {
    const shedCost = Math.floor(attacker.maxHp / 2);
    if (
      attacker.substituteHp !== undefined ||
      attacker.currentHp <= shedCost ||
      !hasLivingReserve(sideOf(state, actorKey))
    ) {
      shedTailFailed = true;
    } else {
      attacker.currentHp -= shedCost;
      attacker.substituteHp = shedCost;
      shedTailSucceeded = true;
    }
  }

  // 사슬묶기: 상대가 "바로 직전에 쓴 기술"(defender.lastMoveId) 하나를 4턴간 봉인한다.
  // 상대가 아직 아무 기술도 안 썼거나(등장 직후) 이미 disable이 걸려있으면 실패한다.
  let setDisabledMoveName: string | undefined;
  let disableSetFailed = false;
  if (effectiveMove.setsDisable) {
    if (defenderAbility?.blocksMentalMoves) {
      mentalMoveBlockedByAbilityName = defenderAbility.name;
      disableSetFailed = true;
    } else if (!defender.lastMoveId || hasVolatile(defender.volatile, "disable")) {
      disableSetFailed = true;
    } else {
      defender.volatile = inflictVolatile(defender.volatile, "disable", random, defender.lastMoveId);
      setDisabledMoveName = getMove(defender.lastMoveId)?.name;
      // 멘탈허브: 사슬묶기가 걸리는 순간 치료하고 소모된다.
      if (getMentalHerbCureResult(defenderItem, defender.itemConsumed ?? false)) {
        defender.volatile = { active: { ...defender.volatile.active } };
        delete defender.volatile.active.disable;
        consumeItem(defender);
        statusCureBerryItemName = defenderItem!.name;
        setDisabledMoveName = undefined;
      }
    }
  }

  // 앙코르: 상대가 "바로 직전에 쓴 기술"만 3턴간 강제로 반복하게 만든다(사슬묶기의 반대 방향).
  // 마찬가지로 상대가 아직 아무 기술도 안 썼거나 이미 encore가 걸려있으면 실패한다.
  let setEncoreMoveName: string | undefined;
  let encoreSetFailed = false;
  if (effectiveMove.setsEncore) {
    if (defenderAbility?.blocksMentalMoves) {
      mentalMoveBlockedByAbilityName = defenderAbility.name;
      encoreSetFailed = true;
    } else if (!defender.lastMoveId || hasVolatile(defender.volatile, "encore")) {
      encoreSetFailed = true;
    } else {
      defender.volatile = inflictVolatile(defender.volatile, "encore", random, defender.lastMoveId);
      setEncoreMoveName = getMove(defender.lastMoveId)?.name;
      // 멘탈허브: 앙코르가 걸리는 순간 치료하고 소모된다.
      if (getMentalHerbCureResult(defenderItem, defender.itemConsumed ?? false)) {
        defender.volatile = { active: { ...defender.volatile.active } };
        delete defender.volatile.active.encore;
        consumeItem(defender);
        statusCureBerryItemName = defenderItem!.name;
        setEncoreMoveName = undefined;
      }
    }
  }

  // 파워트릭: 명중 시(항상 자기 자신 대상) 두 실수치를 그 자리에서 맞바꾼다. 킬가르도
  // 배틀스위치가 폼 전환 시 realStats를 직접 교체하는 것과 같은 패턴이라 재계산이 필요 없다.
  let swappedStatsMoveName: string | undefined;
  if (effectiveMove.swapsOwnStats) {
    const [statA, statB] = effectiveMove.swapsOwnStats;
    const valueA = attacker.realStats[statA];
    attacker.realStats = { ...attacker.realStats, [statA]: attacker.realStats[statB], [statB]: valueA };
    swappedStatsMoveName = effectiveMove.name;
  }

  // 가드스왑·파워스왑: 명중 시 지정된 스탯들의 랭크 변화를 자신과 상대가 서로 맞바꾼다.
  // 파워트릭(swapsOwnStats)과 달리 실수치는 그대로 두고 stages만 교환 — 이미 -6~+6 범위라
  // 교환해도 클램프가 필요 없다.
  let swappedStagesMoveName: string | undefined;
  if (effectiveMove.swapsStagesWithTarget) {
    const nextAttackerStages = { ...attacker.stages };
    const nextDefenderStages = { ...defender.stages };
    for (const stat of effectiveMove.swapsStagesWithTarget) {
      nextAttackerStages[stat] = defender.stages[stat];
      nextDefenderStages[stat] = attacker.stages[stat];
    }
    attacker.stages = nextAttackerStages;
    defender.stages = nextDefenderStages;
    swappedStagesMoveName = effectiveMove.name;
  }

  // 방어류(방어/판별/버티기/킹실드): 연속 사용 횟수(protectStreak)에 따라 이번 턴 실제로 발동할
  // 확률이 (1/3)^streak로 줄어든다. 직전에 실패했거나 이력이 없으면(streak 0) 확률 1 = 무조건 발동.
  //
  // §1 G (2차 지시 반영): 굴림에 성공하면 무조건 "방어태세에 들어갔다!"(protectStanceEntered)를 낸다.
  // 그 뒤 상대가 이번 턴 낸 기술이 "이 포켓몬을 겨냥"했으면 실제로 막은 것 → "몸을 지켜냈다!"
  // (protectSucceeded), 자기 대상 기술(칼춤·철벽 등)이라 막을 게 없었으면 → "방어는 실패했다!"
  // (protectFailed). 굴림에 실패하면(연속 사용) 태세 진입 없이 바로 "방어는 실패했다!"만.
  // 버티기(endure)·길동무(destinyBond)는 별도 문구 축이라 protectStanceEntered에서 제외.
  let protectSucceeded = false;
  let protectFailed = false;
  let protectStanceEntered = false;
  // 매직미러 반사 중이면(bounceActive) attacker/defender가 맞바뀐 상태라 이 방어류 블록을 통째로
  // 건너뛴다 — 되돌린 기술은 반사한 쪽(현재 attacker)의 방어 행동이 아니므로 protectStreak도
  // 건드리면 안 된다.
  if (effectiveMove.protectEffect && !bounceActive) {
    const streak = attacker.protectStreak ?? 0;
    const successChance = Math.pow(1 / 3, streak);
    const rollPassed = random() < successChance;
    // 패스트가드는 상대 기술이 자신을 겨냥했어도 priority가 0 이하면 애초에 막을 게 없다 —
    // "몸을 지켜냈다!"를 잘못 띄우지 않게 targetedSelf 판정에도 그 조건을 같이 건다.
    const targetedSelf =
      effectiveMove.protectEffect === "destinyBond"
        ? true
        : effectiveMove.protectEffect === "blockPriority"
          ? isOpponentTargetingMove(defenderMove) && defenderMove.priority > 0
          : isOpponentTargetingMove(defenderMove);
    if (!rollPassed) {
      // 연속 사용 굴림 실패 — 태세 진입도 없이 그대로 실패.
      attacker.protectStreak = 0;
      protectFailed = true;
    } else {
      attacker.protectStreak = streak + 1;
      protectStanceEntered =
        effectiveMove.protectEffect === "block" || effectiveMove.protectEffect === "blockPriority";
      // 길동무는 activeProtect(매 턴 시작 시 초기화)가 아니라 destinyBondArmed(자신의 다음
      // 행동 전까지 유지)로 별도 추적한다 — 이번 턴 상대 공격을 막는 게 아니기 때문.
      if (effectiveMove.protectEffect === "destinyBond") {
        attacker.destinyBondArmed = true;
        protectSucceeded = true;
      } else {
        attacker.activeProtect = {
          effect: effectiveMove.protectEffect,
          moveName: effectiveMove.name,
          contactPenalty: effectiveMove.protectContactPenalty,
          contactDamageFraction: effectiveMove.protectContactDamageFraction,
          contactStatus: effectiveMove.protectContactStatus,
        };
        // 태세엔 들어갔지만 상대가 자기 대상 기술만 냈으면 "막을 게 없어" 실패로 표기.
        if (targetedSelf) protectSucceeded = true;
        else protectFailed = true;
      }
    }
  } else if (!bounceActive) {
    attacker.protectStreak = 0;
  }

  // 필드 설치: 이미 다른(또는 같은) 필드가 깔려있으면 실패한다 — 필드를 쓸 때마다 지속 턴수가
  // 갱신되던 버그 수정. 기존 필드가 다 사라지기 전까지는 필드 기술 자체가 실패해야 한다.
  let fieldSetFailed = false;
  if (effectiveMove.setsField) {
    if (state.field) {
      fieldSetFailed = true;
    } else {
      state.field = effectiveMove.setsField;
      // 그라운드코트: 필드를 깐 쪽이 이 도구를 지녔으면 지속시간이 늘어난다(기본 5턴 + 3 = 8턴).
      state.fieldTurnsRemaining = FIELD_DURATION + (attackerItem?.fieldDurationBonus ?? 0);
      terrainSeedMessages.push(...triggerTerrainSeeds(state));
    }
  }

  // 설치물(스텔스록·압정뿌리기·독압정·끈적끈적네트): 상대 진영에 설치한다(Phase 8 §6).
  // 스텔스록·끈적끈적네트는 1장 고정, 압정뿌리기는 최대 3층, 독압정은 최대 2층 스택.
  // 매직미러 반사 중이면 설치 대상 진영은 defenderKey가 아니라 원래 시전자 쪽(actorKey)이다.
  let stealthRockSetForSide: FighterKey | undefined;
  let spikesSetForSide: FighterKey | undefined;
  let toxicSpikesSetForSide: FighterKey | undefined;
  let stickyWebSetForSide: FighterKey | undefined;
  let hazardSetFailed = false;
  if (effectiveMove.setsHazard !== undefined) {
    const hazardSide = bounceActive ? actorKey : defenderKey;
    const hz = sideOf(state, hazardSide).hazards;
    let didSet = false;
    switch (effectiveMove.setsHazard) {
      case "stealthRock":
        if (!hz.stealthRock) { hz.stealthRock = true; didSet = true; stealthRockSetForSide = hazardSide; }
        break;
      case "spikes":
        if (hz.spikesLayers < 3) { hz.spikesLayers += 1; didSet = true; spikesSetForSide = hazardSide; }
        break;
      case "toxicSpikes":
        if (hz.toxicSpikesLayers < 2) { hz.toxicSpikesLayers += 1; didSet = true; toxicSpikesSetForSide = hazardSide; }
        break;
      case "stickyWeb":
        if (!hz.stickyWeb) { hz.stickyWeb = true; didSet = true; stickyWebSetForSide = hazardSide; }
        break;
    }
    // 비검천중파·암석액스처럼 명중 부가효과로 까는 데미지기는 "이미 최대"여도 공격 자체는 성공이라
    // 실패 플래그를 세우지 않는다 — 변화기만 실패로 표시한다.
    if (!didSet && effectiveMove.category === "status") hazardSetFailed = true;
  }

  // ── 매직미러 반사 구간 끝 ── 바인딩을 원위치한다. 이후 로그·나무열매·매지션·폼 전환 등
  // 후처리는 전부 원래 공격/방어 방향 기준으로 돌아간다.
  if (bounceActive) {
    [attacker, defender] = [defender, attacker];
    [attackerAbility, defenderAbility] = [defenderAbility, attackerAbility];
    [attackerItem, defenderItem] = [defenderItem, attackerItem];
  }
  return {
    defenderAbility, attacker, defender, attackerAbility, attackerItem, defenderItem, abilityInflictedStatusOnAttacker, abilityInflictedStatusAbilityName, statusCureBerryItemName, mentalMoveBlockedByAbilityName, bouncedMoveName, bouncedByAbilityName, secondaryBlockedByAbilityName, berryEatFailed, stuffCheeksBerryHeal, stuffCheeksBerryName, costHpFailed, soulBeatHpCost, selfStatRises, selfStatsAtMax, selfStatDrops, reflectedStatDropAbilityName, reflectedStatDrops, restoredStatsSelfItemName, restoredStatsOpponentItemName, opportunistCopiedStats, opportunistAbilityName, opponentStatDrops, invertedTargetStages, addedTypeToTarget, overwroteTargetType, targetMoveTypeOverride, inflictedStatus, statusInflictFailed, beakBlastBurnedAttacker, curedStatus, curedStatusTarget, inflictedVolatile, tidyUpDone, courtChangeDone, revivedPartyName, reviveFailed, saltCureApplied, balloonPoppedItemName, octolockApplied, jawLockApplied, selfWokeBeforeMove, restSlept, healedAmount, healedTarget, averagedDefensesMoveName, swappedSpeedMoveName, transformedIntoName, transformFailed, regenSetFailed, leechSeedSetFailed, leechSeedBlockedByGrass, abilitySwappedTargetToName, abilitySwapFailed, substituteSetFailed, shedTailFailed, shedTailSucceeded, setDisabledMoveName, disableSetFailed, setEncoreMoveName, encoreSetFailed, swappedStatsMoveName, swappedStagesMoveName, protectSucceeded, protectFailed, protectStanceEntered, fieldSetFailed, stealthRockSetForSide, spikesSetForSide, toxicSpikesSetForSide, stickyWebSetForSide, hazardSetFailed,
  };
}

