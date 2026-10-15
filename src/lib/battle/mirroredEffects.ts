import { type Move } from "@/types/move";
import { type PokemonType } from "@/types/pokemon-type";
import { type FighterKey } from "@/types/battle";
import { BATTLE_STAT_KEYS, NEUTRAL_ACCURACY_STAGES, NEUTRAL_STAGES, isBattleStatKey, type AccuracyEvasionKey, type BattleStatKey, type StatStages } from "@/types/battleStats";
import { NO_STATUS_CONDITION, type StatusCondition, type StatusConditionState, type VolatileCondition } from "@/types/status";
import { type Ability } from "@/types/ability";
import { type Item } from "@/types/item";
import { getAbility, getItem, getMove, getPokemon } from "@/lib/data";
import { applyMoveStatChanges, applyStageDelta, clampStagesToNonNegative } from "@/lib/statStages";
import { applyMoveAccuracyEvasionChanges, applyMoveCritStageChanges } from "@/lib/accuracyCrit";
import { inflictRestSleep, inflictStatus, isImmuneToStatus } from "@/lib/statusConditions";
import { hasVolatile, inflictVolatile } from "@/lib/volatileConditions";
import { rankStageMultiplier } from "@/lib/battlePower";
import { computeWeatherHealFraction } from "@/lib/weatherEffects";
import { FIELD_DURATION, isConfusionBlockedByField, isOpponentTargetingMove, isStatusBlockedByField } from "@/lib/fieldEffects";
import { getConfusionCureBerryResult, getExtraFlinchTriggered, getMentalHerbCureResult, getStatusCureBerryResult, shouldTriggerWhiteHerb } from "@/lib/itemEffects";
import { isGrounded } from "./grounding";
import { eatBerryNow } from "./fling";
import { cureConditionsBlockedByAbility, isFixedAbility, isUncopyableAbility } from "./abilityChange";
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
/** resolveMirroredMoveEffects의 단계 사이에서 공유되는 값 — 한 단계 안에서만 쓰는 변수는 각 단계 함수의 지역 변수다 */
interface MirroredCtx {
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
  bounceActive: boolean;
  bouncedMoveName: string | undefined;
  bouncedByAbilityName: string | undefined;
  secondaryEffectsBlockedByAbility: boolean;
  secondaryBlockedByAbilityName: string | undefined;
  berryEatFailed: boolean;
  stuffCheeksBerryHeal: number;
  stuffCheeksBerryName: string | undefined;
  teaTime: { self?: ReturnType<typeof eatBerryNow>; opponent?: ReturnType<typeof eatBerryNow> } | undefined;
  teaTimeFailed: boolean;
  costHpFailed: boolean;
  soulBeatHpCost: number;
  attackerStagesBeforeMoveChange: StatStages;
  defenderStagesBeforeMoveChange: StatStages;
  rolledStatChanges: Move["statChanges"];
  selfStatRises: { stat: BattleStatKey | AccuracyEvasionKey; delta: number }[];
  selfStatsAtMax: BattleStatKey[];
  selfStatDrops: { stat: BattleStatKey | AccuracyEvasionKey; delta: number }[];
  reflectedStatDropAbilityName: string | undefined;
  reflectedStatDrops: { stat: BattleStatKey; delta: number }[];
  restoredStatsSelfItemName: string | undefined;
  restoredStatsOpponentItemName: string | undefined;
  opportunistCopiedStats: { stat: BattleStatKey; delta: number; }[] | undefined;
  opportunistAbilityName: string | undefined;
  opponentStatDrops: { stat: BattleStatKey | AccuracyEvasionKey; delta: number }[];
  invertedTargetStages: boolean;
  addedTypeToTarget: PokemonType | undefined;
  overwroteTargetType: PokemonType | undefined;
  targetMoveTypeOverride: PokemonType | undefined;
  inflictedStatus: StatusConditionState["condition"] | undefined;
  statusInflictFailed: boolean;
  beakBlastBurnedAttacker: boolean;
  curedStatus: StatusConditionState["condition"] | undefined;
  curedStatusTarget: "self" | "opponent" | undefined;
  noteCure: (condition: StatusConditionState["condition"] | undefined, target: "self" | "opponent") => void;
  inflictedVolatile: VolatileCondition | undefined;
  volatileBlockedByAbility: { abilityName: string; volatile: VolatileCondition; self: boolean } | undefined;
  tidyUpDone: boolean;
  defogFieldCleared: boolean;
  courtChangeDone: boolean;
  revivedPartyName: string | undefined;
  reviveFailed: boolean;
  saltCureApplied: boolean;
  balloonPoppedItemName: string | undefined;
  octolockApplied: boolean;
  jawLockApplied: boolean;
  partyStatusCuredCount: number;
  selfWokeBeforeMove: StatusCondition | null | undefined;
  restSlept: boolean;
  healedAmount: number;
  healedTarget: "self" | "opponent" | undefined;
  stockpileHealFailed: boolean;
  averagedDefensesMoveName: string | undefined;
  swappedSpeedMoveName: string | undefined;
  swappedItems: { userGotName?: string; targetGotName?: string } | undefined;
  itemSwapFailed: boolean;
  painSplitHp: number | undefined;
  recycledItemName: string | undefined;
  recycleFailed: boolean;
  copiedStagesFromName: string | undefined;
  averagedAttacksMoveName: string | undefined;
  spitePp: { moveName: string; amount: number } | undefined;
  spiteFailed: boolean;
  acupressureRaised: { stat: BattleStatKey | AccuracyEvasionKey; delta: number } | undefined;
  acupressureFailed: boolean;
  meltedItemName: string | undefined;
  meltFailed: boolean;
  magneticFluxFailed: boolean;
  transformedIntoName: string | undefined;
  transformFailed: boolean;
  regenSetFailed: boolean;
  leechSeedSetFailed: boolean;
  leechSeedBlockedByGrass: boolean;
  smackedDownTarget: boolean;
  abilitySwappedTargetToName: string | undefined;
  abilitySwapFailed: boolean;
  abilityChange: { kind: "swap" | "give" | "copy" | "suppress"; abilityName?: string } | undefined;
  abilityChangeFailed: boolean;
  copiedTypes: PokemonType[] | undefined;
  substituteSetFailed: boolean;
  shedTailFailed: boolean;
  shedTailSucceeded: boolean;
  setDisabledMoveName: string | undefined;
  disableSetFailed: boolean;
  setEncoreMoveName: string | undefined;
  encoreSetFailed: boolean;
  swappedStatsMoveName: string | undefined;
  swappedStagesMoveName: string | undefined;
  protectSucceeded: boolean;
  protectFailed: boolean;
  protectStanceEntered: boolean;
  fieldSetFailed: boolean;
  stealthRockSetForSide: FighterKey | undefined;
  spikesSetForSide: FighterKey | undefined;
  toxicSpikesSetForSide: FighterKey | undefined;
  stickyWebSetForSide: FighterKey | undefined;
  hazardSetFailed: boolean;
}

/** 볼가득넣기·다과회·소울비트: 열매를 먹거나 HP를 소비하는 시작 효과 */
function eatBerriesAndPayHp(c: MirroredCtx) {

  // 볼가득넣기(eatsHeldBerry): 지닌 나무열매(이름이 "열매"로 끝나는 도구)를 먹는다 — 없으면 실패.
  // HP 회복 나무열매(자뭉·오랭)면 즉시 그만큼 회복(HP 조건 무시). 방어 +2는 아래 statChanges로 적용.
  c.berryEatFailed = false;
  c.stuffCheeksBerryHeal = 0;

  if (c.effectiveMove.eatsHeldBerry) {
    const berry = c.attackerItem && c.attackerItem.name.endsWith("열매") ? c.attackerItem : undefined;
    if (!berry) {
      c.berryEatFailed = true;
    } else {
      c.stuffCheeksBerryName = berry.name;
      const ripenMult = c.attackerAbility?.doublesBerryEffect ? 2 : 1; // 숙성
      const rawHeal =
        (berry.healsBelowHalfHpDenominator
          ? Math.floor(c.attacker.maxHp / berry.healsBelowHalfHpDenominator)
          : (berry.healsBelowHalfHpFlat ?? 0)) * ripenMult;
      c.stuffCheeksBerryHeal = Math.min(c.attacker.maxHp - c.attacker.currentHp, rawHeal);
      c.attacker.currentHp += c.stuffCheeksBerryHeal;
      consumeItem(c.attacker);
    }
  }

  // 다과회(allEatBerries, Tier 2): 장에 있는 양쪽 모두 지닌 나무열매를 바로 먹는다(서투름·매직룸이면 못 먹음). 아무도 못 먹으면 실패.

  c.teaTimeFailed = false;
  if (c.effectiveMove.allEatBerries) {
    const eat = (f: BattleFighterState, item: Item | undefined) => {
      if (!item || !item.name.endsWith("열매") || isFainted(f)) return undefined;
      const result = eatBerryNow(f, item);
      consumeItem(f);
      return result;
    };
    c.teaTime = { self: eat(c.attacker, c.attackerItem), opponent: eat(c.defender, c.defenderItem) };
    if (!c.teaTime.self && !c.teaTime.opponent) {
      c.teaTime = undefined;
      c.teaTimeFailed = true;
    }
  }

  // 소울비트(costsHpFraction): 사용 시 최대 HP의 이 비율을 소비한다. 현재 HP가 소비량 이하면
  // (=쓰면 기절) 실패해서 랭크업도 없다. 성공하면 statChanges(5스탯 +1) 적용 직전에 HP를 깎는다.
  c.costHpFailed = false;
  c.soulBeatHpCost = 0;
  if (c.effectiveMove.costsHpFraction !== undefined) {
    c.soulBeatHpCost = Math.floor(c.attacker.maxHp * c.effectiveMove.costsHpFraction);
    if (c.attacker.currentHp <= c.soulBeatHpCost) {
      c.costHpFailed = true;
      c.soulBeatHpCost = 0;
    } else {
      c.attacker.currentHp -= c.soulBeatHpCost;
    }
  }
}

/** 기술 자신의 랭크·명중회피·급소 변화(칼춤 등)와 확률부 변화 굴림, 심술꾸러기 */
function applyStatChanges(c: MirroredCtx) {

  // 기술 자신의 랭크/명중회피/급소 변화 적용 (칼춤, 그림자분신, 기충전 등).
  // attacker/defender는 state.a/state.b를 그대로 참조하고 있어 여기서 바꾼 값이 state에도 반영된다.
  c.attackerStagesBeforeMoveChange = c.attacker.stages;
  c.defenderStagesBeforeMoveChange = c.defender.stages;
  // 확률부(chance) statChanges는 여기서 굴려서 통과한 항목만 남긴다(확정은 그대로). 인분이면
  // 상대 대상 항목은 굴림 없이 통째로 제거한다. 예전엔 applyMoveStatChanges가 chance를 굴리지
  // 않고 100%로 적용하던 버그가 있었다(불꽃춤 자기 특공↑ 50%·브레이크클로 상대 방어↓ 50%).
  // 공격기(데미지 기술)의 랭크 변화는 기술이 실제로 맞았을 때만 일어난다 — 오버히트·인파이트의 자기 랭크 하락,
  // 니트로차지의 스피드 상승, 브레이크클로의 상대 방어 하락 모두. 빗나감·방어로 막힘·상성 무효(데미지 0)면 없고,
  // 대타에 맞았으면 있다(본가 규칙, 사용자 확인 2026-09-24). 변화기(칼춤 등)는 이 조건과 무관하다.
  // (isDamaging은 가변 위력 기술을 빼므로 여기선 분류로 판단한다)
  const damagingMoveLanded =
    c.effectiveMove.category === "status" || (c.hit && !c.blockedByProtect && (c.damage > 0 || !!c.hitSubstitute));
  c.rolledStatChanges = c.berryEatFailed || c.costHpFailed || !damagingMoveLanded
    ? []
    : c.effectiveMove.statChanges?.filter((sc) => {
        if (c.secondaryEffectsBlockedByAbility && sc.target === "opponent") {
          // 방어/대타/황금몸으로 이미 통째로 막힌 경우엔 "인분" 문구를 따로 낼 필요가 없다.
          if (!c.opponentEffectsBlocked) c.secondaryBlockedByAbilityName = c.defenderAbility!.name;
          return false;
        }
        return sc.chance === undefined || c.random() * 100 < sc.chance;
      });
  const statChangeMove: Move = { ...c.effectiveMove, statChanges: c.rolledStatChanges };
  // 심술꾸러기: 랭크 변화를 받는 쪽이 Contrary면 delta 부호를 뒤집은 기술로 적용한다(자기 랭크변화·상대가 건 랭크변화 모두).
  // weather: 성장(쾌청이면 +1 추가로 얹어 총 +2)처럼 날씨 조건부 statChanges 항목 판정용.
  const statChangeWeather = activeWeather(c.state);
  c.attacker.stages = applyMoveStatChanges(c.attacker.stages, contraryMoveFor(statChangeMove, c.attacker), "self", {
    userTypes: c.attacker.types,
    weather: statChangeWeather,
  });
  c.defender.stages = c.opponentEffectsBlocked
    ? c.defender.stages
    : applyMoveStatChanges(c.defender.stages, contraryMoveFor(statChangeMove, c.defender), "opponent", {
        userTypes: c.attacker.types,
        weather: statChangeWeather,
      });

  // 랭크업 결과 문구용(Phase 6.5 §6-2 ⑥⑦, §6-3): 이 기술이 사용자 자신의 랭크를 실제로 올린 것과,
  // 올리려 했으나 이미 +6이라 막힌 것을 각각 모은다. 확정 랭크업만 대상 — 확률 부가효과(chance)와
  // 자기 랭크다운 디메리트(delta ≤ 0)는 제외. 명중률/회피율은 축이 달라(.accuracyStages) 이 루프
  // 뒤쪽에서 따로 채운다(2.3 B3). 승기·하양허브 등 뒤 후처리 전에 측정.
  c.selfStatRises = [];
  c.selfStatsAtMax = [];
  // §4-6: selfStatRises와 대칭 — 골드러시·오버히트·용성군처럼 자기 대상 확정 랭크 하락
  // 부가효과가 실제로 적용된 것을 모은다. delta는 내려간 칸 수(양수)로 opponentStatDrops와
  // 같은 포맷을 쓴다. 엔진 계산(attacker.stages)은 이미 정상 동작하고 있었고, 이 결과를
  // 담을 로그 필드가 없던 게 §4-6의 원인이었다.
  c.selfStatDrops = [];
  for (const sc of c.effectiveMove.statChanges ?? []) {
    if (sc.target !== "self" || sc.chance !== undefined) continue;
    if (!isBattleStatKey(sc.stat) || (sc.delta ?? 0) === 0) continue;
    const before = c.attackerStagesBeforeMoveChange[sc.stat];
    const after = c.attacker.stages[sc.stat];
    if ((sc.delta ?? 0) > 0) {
      if (after > before) c.selfStatRises.push({ stat: sc.stat, delta: after - before });
      else if (before >= 6) c.selfStatsAtMax.push(sc.stat);
    } else if (after < before) {
      c.selfStatDrops.push({ stat: sc.stat, delta: before - after });
    }
  }
}

/** 클리어바디·괴력집게·미러아머 — 상대 랭크 하락 차단·반사, 승기·하양허브 */
function blockAndReflectStatDrops(c: MirroredCtx) {

  // 클리어바디(전체)·괴력집게(공격만)·미러아머(반사): 방금 적용된 opponent 랭크변화 중 실제로
  // 내려간 스탯만(-6 클램프로 변화가 없었던 건 자연히 제외) 골라서, 막을 스탯이면 원래 값으로
  // 되돌리고, 반사 특성이면 원래 값으로 되돌린 뒤 그만큼을 공격측에게 대신 적용한다. "상대의
  // 기술로" 내려간 것만 대상이라 방금 위에서 적용한 opponent 방향 변화만 비교하면 충분하다.
  const blockedStats = statDropBlockStatsOf(c.defender, c.defenderAbility);
  const reflects = c.defenderAbility?.reflectsOpponentStatDrops;
  // 미러아머 반사 문구용(E-4): 실제로 시전자(attacker)에게 되돌아간 랭크다운을 모은다. 특성/변화기
  // 랭크다운뿐 아니라 데미지 기술의 부가 랭크다운(브레이크클로 등)도 rolledStatChanges에 반영돼
  // 있어 여기서 같은 방식으로 잡힌다.

  c.reflectedStatDrops = [];
  if (blockedStats || reflects) {
    for (const stat of Object.keys(c.defender.stages) as BattleStatKey[]) {
      const dropAmount = c.defenderStagesBeforeMoveChange[stat] - c.defender.stages[stat];
      if (dropAmount <= 0) continue;
      if (reflects) {
        c.defender.stages = { ...c.defender.stages, [stat]: c.defenderStagesBeforeMoveChange[stat] };
        const attackerBefore = c.attacker.stages[stat];
        c.attacker.stages = applyStageDelta(c.attacker.stages, stat, -dropAmount);
        const applied = attackerBefore - c.attacker.stages[stat];
        if (applied > 0) {
          c.reflectedStatDropAbilityName = c.defenderAbility!.name;
          c.reflectedStatDrops.push({ stat, delta: applied });
        }
      } else if (blockedStats?.includes(stat)) {
        c.defender.stages = { ...c.defender.stages, [stat]: c.defenderStagesBeforeMoveChange[stat] };
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
  applyCompetitiveBoost(c.attacker, c.attackerAbility, c.attackerStagesBeforeMoveChange);
  applyCompetitiveBoost(c.defender, c.defenderAbility, c.defenderStagesBeforeMoveChange);

  // 하양허브: 방금 반영된 랭크 중 마이너스가 하나라도 있으면(자신이 스스로 내렸든, 상대 기술로
  // 내려갔든) 그 즉시 마이너스 랭크만 전부 0으로 되돌리고 소모된다. 양쪽 다 이 도구를 지녔고
  // 같은 턴에 둘 다 마이너스가 됐으면(드문 경우) 둘 다 독립적으로 발동한다.


  if (shouldTriggerWhiteHerb(c.attackerItem, c.attacker.stages, c.attacker.itemConsumed ?? false)) {
    c.attacker.stages = clampStagesToNonNegative(c.attacker.stages);
    consumeItem(c.attacker);
    c.restoredStatsSelfItemName = c.attackerItem?.name;
  }
  if (shouldTriggerWhiteHerb(c.defenderItem, c.defender.stages, c.defender.itemConsumed ?? false)) {
    c.defender.stages = clampStagesToNonNegative(c.defender.stages);
    consumeItem(c.defender);
    c.restoredStatsOpponentItemName = c.defenderItem?.name;
  }
}

/** 편승 복사, 상대 랭크다운 결과 모으기, 명중률·회피율 변화 */
function opportunistAndAccuracyChanges(c: MirroredCtx) {

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
    c.defender,
    c.defenderAbility,
    c.attacker,
    c.attackerStagesBeforeMoveChange,
  );
  const opportunistCopiedByAttacker = applyOpportunistCopy(
    c.attacker,
    c.attackerAbility,
    c.defender,
    c.defenderStagesBeforeMoveChange,
  );
  c.opportunistCopiedStats = opportunistCopiedByDefender.length > 0
      ? opportunistCopiedByDefender
      : opportunistCopiedByAttacker.length > 0
        ? opportunistCopiedByAttacker
        : undefined;
  c.opportunistAbilityName = c.opportunistCopiedStats
    ? (opportunistCopiedByDefender.length > 0 ? c.defenderAbility : c.attackerAbility)?.name
    : undefined;

  // 상대 랭크다운 결과 문구용(§1 C-6): 이 기술이 실제로 상대 랭크를 내린 것만 모은다. 최종
  // defender.stages 기준이라 클리어바디로 막혔거나 미러아머로 반사됐거나 하양허브로 되돌아간
  // 경우엔 net 변화가 0이라 자연히 제외된다. selfStatRises와 대칭 — 확정 하락만(확률 부가효과는
  // rolledStatChanges 단계에서 이미 굴려져 통과한 것만 남아 있고, 실제 하락분으로 판정). 명중률/
  // 회피율(안개제거 등)은 축이 달라(.accuracyStages) 이 변수에 뒤쪽에서 따로 채운다(2.3 B3).
  c.opponentStatDrops = [];
  if (!c.opponentEffectsBlocked) {
    const seen = new Set<BattleStatKey>();
    for (const sc of c.rolledStatChanges ?? []) {
      if (sc.target !== "opponent" || !isBattleStatKey(sc.stat) || seen.has(sc.stat)) continue;
      seen.add(sc.stat);
      const drop = c.defenderStagesBeforeMoveChange[sc.stat] - c.defender.stages[sc.stat];
      if (drop > 0) c.opponentStatDrops.push({ stat: sc.stat, delta: drop });
    }
  }

  const attackerAccuracyStagesBeforeChange = c.attacker.accuracyStages;
  const defenderAccuracyStagesBeforeChange = c.defender.accuracyStages;
  c.attacker.accuracyStages = applyMoveAccuracyEvasionChanges(
    c.attacker.accuracyStages,
    contraryMoveFor(c.effectiveMove, c.attacker),
    "self",
    { userTypes: c.attacker.types },
  );
  const defenderAccuracyBeforeChange = c.defender.accuracyStages.accuracy;
  c.defender.accuracyStages = c.opponentEffectsBlocked
    ? c.defender.accuracyStages
    : applyMoveAccuracyEvasionChanges(c.defender.accuracyStages, contraryMoveFor(c.effectiveMove, c.defender), "opponent", {
        userTypes: c.attacker.types,
      });
  // 날카로운눈: 상대(공격측)의 기술로 자신의 명중률이 떨어지는 걸 막는다. 회피율 변화는 이
  // 축과 무관해서(원문이 "명중률을 떨어뜨릴 수 없다"까지만) 건드리지 않는다.
  if (c.defenderAbility?.blocksOpponentAccuracyDrops && c.defender.accuracyStages.accuracy < defenderAccuracyBeforeChange) {
    c.defender.accuracyStages = { ...c.defender.accuracyStages, accuracy: defenderAccuracyBeforeChange };
  }
  // 명중률/회피율 랭크 변화 결과 문구용(2.3 B3) — selfStatRises/selfStatDrops/opponentStatDrops와
  // 같은 포맷으로 합류시킨다. 안개제거(상대 회피율 −1)를 썼을 때 로그에 아무 문구도 안 뜨던 게
  // 이 수집이 5스탯(.stages)만 보고 .accuracyStages는 안 봐서 생긴 공백이었다. 명중률/회피율을
  // 상대 대상으로 "올리는" 기술은 없어 opponentStatDrops만 대칭시키면 충분하다.
  for (const key of ["accuracy", "evasion"] as const) {
    const selfBefore = attackerAccuracyStagesBeforeChange[key];
    const selfAfter = c.attacker.accuracyStages[key];
    if (selfAfter > selfBefore) c.selfStatRises.push({ stat: key, delta: selfAfter - selfBefore });
    else if (selfAfter < selfBefore) c.selfStatDrops.push({ stat: key, delta: selfBefore - selfAfter });

    if (!c.opponentEffectsBlocked) {
      const oppBefore = defenderAccuracyStagesBeforeChange[key];
      const oppAfter = c.defender.accuracyStages[key];
      if (oppAfter < oppBefore) c.opponentStatDrops.push({ stat: key, delta: oppBefore - oppAfter });
    }
  }
  c.attacker.critStage = applyMoveCritStageChanges(c.attacker.critStage, c.effectiveMove, "self", {
    userTypes: c.attacker.types,
  });
  c.defender.critStage = c.opponentEffectsBlocked
    ? c.defender.critStage
    : applyMoveCritStageChanges(c.defender.critStage, c.effectiveMove, "opponent", {
        userTypes: c.attacker.types,
      });
}

/** 흑안개·뒤집어엎기·숲의저주·마법가루·송전 — 랭크 초기화와 타입·기술 타입 변경 */
function resetAndTypeChanges(c: MirroredCtx) {

  // 흑안개: 명중하면 양쪽의 5스탯 랭크 + 명중률/회피율 랭크를 전부 초기화한다. 급소율(critStage)은
  // 본가에서 별개 축이라 건드리지 않는다. 자신/상대 구분이 의미 없는(둘 다 리셋되는) 유일한
  // statChanges류 효과라 별도 필드로 분리했다.
  if (c.effectiveMove.resetsAllStages) {
    c.attacker.stages = { ...NEUTRAL_STAGES };
    c.defender.stages = { ...NEUTRAL_STAGES };
    c.attacker.accuracyStages = { ...NEUTRAL_ACCURACY_STAGES };
    c.defender.accuracyStages = { ...NEUTRAL_ACCURACY_STAGES };
  }

  // 뒤집어엎기(invertsTargetStatStages): 명중 시 상대에게 현재 걸려 있는 5스탯 + 명중률/회피율
  // 랭크의 부호를 전부 뒤집는다(+2 → -2). 급소율은 흑안개와 같은 이유로 건드리지 않는다.
  c.invertedTargetStages = false;
  if (c.effectiveMove.invertsTargetStatStages && c.hit && !c.opponentEffectsBlocked && !isFainted(c.defender)) {
    c.defender.stages = Object.fromEntries(
      Object.entries(c.defender.stages).map(([k, v]) => [k, -v]),
    ) as typeof c.defender.stages;
    c.defender.accuracyStages = {
      accuracy: -c.defender.accuracyStages.accuracy,
      evasion: -c.defender.accuracyStages.evasion,
    };
    c.invertedTargetStages = true;
  }

  // 숲의저주(풀)·핼러윈(고스트): 명중 시 상대의 타입 목록에 그 타입을 추가한다(배틀 끝까지 유지).
  // addedType에도 기록해 두어 의태/기분파가 타입을 재계산해도 이 추가 타입이 다시 붙게 한다.

  if (
    c.effectiveMove.addsTypeToTarget &&
    c.hit &&
    !c.opponentEffectsBlocked &&
    !isFainted(c.defender) &&
    !c.defender.types.includes(c.effectiveMove.addsTypeToTarget)
  ) {
    c.defender.addedType = c.effectiveMove.addsTypeToTarget;
    c.defender.types = [...c.defender.types, c.effectiveMove.addsTypeToTarget];
    c.addedTypeToTarget = c.effectiveMove.addsTypeToTarget;
  }

  // 마법가루(setsTargetType): 명중 시 상대의 타입을 이 타입 하나로 통째로 덮어쓴다(치환, 배틀 끝까지).

  if (
    c.effectiveMove.setsTargetType &&
    c.hit &&
    !c.opponentEffectsBlocked &&
    !isFainted(c.defender) &&
    !(c.defender.types.length === 1 && c.defender.types[0] === c.effectiveMove.setsTargetType)
  ) {
    c.defender.types = [c.effectiveMove.setsTargetType];
    c.defender.addedType = undefined;
    c.overwroteTargetType = c.effectiveMove.setsTargetType;
  }

  // 송전(changesTargetMoveTypeThisTurn): 명중 시, 공격측이 이번 턴 먼저 움직였을 때만(=상대가
  // 아직 행동 안 함) 상대가 이번 턴 쓰는 기술의 타입을 전기로 바꾼다. 턴 종료 시 runTurn이 해제한다.

  if (
    c.effectiveMove.changesTargetMoveTypeThisTurn &&
    c.hit &&
    !c.opponentEffectsBlocked &&
    !isFainted(c.defender) &&
    !c.movesSecond
  ) {
    c.defender.moveTypeOverrideThisTurn = c.effectiveMove.changesTargetMoveTypeThisTurn;
    c.targetMoveTypeOverride = c.effectiveMove.changesTargetMoveTypeThisTurn;
  }
}

/** 부가 상태이상 부여: 통상·페이탈클로·질투의불꽃·독수·부리캐논·싱크로 */
function inflictStatuses(c: MirroredCtx) {


  // 이미 걸린 상태이상 때문에 상태이상 전용 변화기(맹독·도깨비불 등)가 아무 변화도 못 냈으면 true.
  // C-8: "블래키의 맹독 - 그러나 실패했다!". 데미지 기술의 부가 상태이상은 그냥 안 걸린 것뿐이라 대상 아님.
  c.statusInflictFailed = false;
  if (c.secondaryEffectsBlockedByAbility && c.effectiveMove.inflictsStatus && !c.opponentEffectsBlocked) {
    // 인분: 데미지 기술이 거는 상태이상(화염방사 화상·연옥 100% 화상·볼부비부비 마비 등)은
    // 전부 추가효과라 무산된다. 변화기(도깨비불 등)의 상태이상은 secondaryEffectsBlockedByAbility가
    // false라 이 분기에 오지 않는다.
    c.secondaryBlockedByAbilityName = c.defenderAbility!.name;
  } else if (!c.opponentEffectsBlocked && c.effectiveMove.inflictsStatus) {
    for (const effect of c.effectiveMove.inflictsStatus) {
      if (
        isImmuneToStatus(
          effect.status,
          c.defender.types,
          statusImmunitiesOf(c.defender, c.defenderAbility),
          c.attackerAbility?.bypassesPoisonTypeImmunity,
        )
      )
        continue;
      if (isStatusBlockedByField(c.state.field, effect.status, isGrounded(c.state, c.defender, c.defenderAbility))) continue;
      if (sideOf(c.state, c.defenderKey).safeguardTurnsRemaining !== undefined) continue;
      // 쾌청(강한 햇살) 날씨에서는 얼음 상태에 걸리지 않는다 — 타입 면역과는 다른 축이라 별도 확인
      if (effect.status === "freeze" && activeWeather(c.state) === "쾌청") continue;
      const chance = effect.chance !== undefined ? effect.chance / 100 : 1;
      if (c.random() < chance) {
        const before = c.defender.status.condition;
        c.defender.status = inflictStatus(c.defender.status, effect.status);
        if (c.defender.status.condition !== before) c.inflictedStatus = c.defender.status.condition;
        else if (c.effectiveMove.category === "status" && effect.chance === undefined) c.statusInflictFailed = true;
        break; // 주 상태이상은 한 번에 하나만 걸린다 (중첩 없음)
      }
    }
  }

  // 페이탈클로(inflictsRandomStatus): 데미지를 준 뒤 이 확률로 statuses 중 하나를 무작위로 걸어본다.
  // 인분(추가효과 차단)·황금몸·대타·이미 상태이상 규칙은 통상 부가 상태이상과 동일하게 존중한다.
  if (
    c.effectiveMove.inflictsRandomStatus &&
    c.hit &&
    c.damage > 0 &&
    !c.hitSubstitute &&
    !c.opponentEffectsBlocked &&
    !c.inflictedStatus
  ) {
    if (c.secondaryEffectsBlockedByAbility) {
      c.secondaryBlockedByAbilityName = c.defenderAbility!.name;
    } else if (c.random() * 100 < c.effectiveMove.inflictsRandomStatus.chance) {
      const pool = c.effectiveMove.inflictsRandomStatus.statuses;
      const picked = pool[Math.floor(c.random() * pool.length)];
      if (
        picked &&
        !isImmuneToStatus(picked, c.defender.types, statusImmunitiesOf(c.defender, c.defenderAbility)) &&
        !isStatusBlockedByField(c.state.field, picked, isGrounded(c.state, c.defender, c.defenderAbility)) &&
        sideOf(c.state, c.defenderKey).safeguardTurnsRemaining === undefined &&
        !(picked === "freeze" && activeWeather(c.state) === "쾌청")
      ) {
        const before = c.defender.status.condition;
        c.defender.status = inflictStatus(c.defender.status, picked);
        if (c.defender.status.condition !== before) c.inflictedStatus = c.defender.status.condition;
      }
    }
  }

  // 질투의불꽃(burnsTargetIfStatRoseThisTurn): 명중해서 데미지를 줬고, 이번 턴에 방어자의 랭크가
  // 하나라도 올랐으면(턴 시작 스냅샷 대비) 화상을 건다(확정). 대타를 맞혔으면 본체엔 안 건다.
  // 통상 화상 면역(불꽃 타입·특성·이미 상태이상·미스트필드)·인분·황금몸 규칙은 그대로 존중한다.
  if (
    c.effectiveMove.burnsTargetIfStatRoseThisTurn &&
    c.hit &&
    c.damage > 0 &&
    !c.hitSubstitute &&
    !c.opponentEffectsBlocked &&
    !c.secondaryEffectsBlockedByAbility &&
    !c.inflictedStatus
  ) {
    const rose = BATTLE_STAT_KEYS.some(
      (stat) => c.defender.stages[stat] > (c.defender.statStagesAtTurnStart?.[stat] ?? 0),
    );
    if (
      rose &&
      !isImmuneToStatus("burn", c.defender.types, statusImmunitiesOf(c.defender, c.defenderAbility)) &&
      !isStatusBlockedByField(c.state.field, "burn", isGrounded(c.state, c.defender, c.defenderAbility)) &&
      sideOf(c.state, c.defenderKey).safeguardTurnsRemaining === undefined
    ) {
      const before = c.defender.status.condition;
      c.defender.status = inflictStatus(c.defender.status, "burn");
      if (c.defender.status.condition !== before) c.inflictedStatus = c.defender.status.condition;
    }
  }

  // 독수(Poison Touch): 접촉기로 데미지를 준 직후 이 확률로 상대를 독 상태로 만든다(독가시
  // hitTrigger의 공격측 버전). 타입/특성 상태이상 면역·필드는 그대로 존중. 대타를 맞혔으면 본체엔
  // 안 건다. 이미 다른 부가 상태이상이 걸린 경우는 중첩하지 않는다.
  if (
    c.attackerAbility?.poisonTouchChance !== undefined &&
    (c.effectiveMove.makesContact ?? false) &&
    c.hit &&
    c.damage > 0 &&
    !c.hitSubstitute &&
    !c.inflictedStatus &&
    !isImmuneToStatus("poison", c.defender.types, statusImmunitiesOf(c.defender, c.defenderAbility), c.attackerAbility?.bypassesPoisonTypeImmunity) &&
    !isStatusBlockedByField(c.state.field, "poison", isGrounded(c.state, c.defender, c.defenderAbility)) &&
    sideOf(c.state, c.defenderKey).safeguardTurnsRemaining === undefined &&
    c.random() * 100 < c.attackerAbility.poisonTouchChance
  ) {
    const before = c.defender.status.condition;
    c.defender.status = inflictStatus(c.defender.status, "poison");
    if (c.defender.status.condition !== before) c.inflictedStatus = c.defender.status.condition;
  }

  // 부리캐논(Beak Blast): 방어측이 이번 턴 부리캐논을 골랐고 아직 발동 전(=공격측이 이번 턴 먼저
  // 움직임)인데 공격측이 접촉기로 때리면, 가열된 부리에 데어 공격측이 화상을 입는다. 원격이면
  // move.makesContact가 이미 false라 자연히 제외된다. 대타 피격은 접촉이 아니라 제외.
  c.beakBlastBurnedAttacker = false;
  if (
    c.defenderMove.burnsContactAttackerBeforeResolve &&
    !c.movesSecond &&
    (c.move.makesContact ?? false) &&
    c.hit &&
    !c.hitSubstitute &&
    !isFainted(c.attacker) &&
    !isImmuneToStatus("burn", c.attacker.types, statusImmunitiesOf(c.attacker, c.attackerAbility)) &&
    !isStatusBlockedByField(c.state.field, "burn", isGrounded(c.state, c.attacker, c.attackerAbility)) &&
    sideOf(c.state, c.actorKey).safeguardTurnsRemaining === undefined
  ) {
    const before = c.attacker.status.condition;
    c.attacker.status = inflictStatus(c.attacker.status, "burn");
    if (c.attacker.status.condition !== before) c.beakBlastBurnedAttacker = true;
  }

  // 싱크로: 이번 행동으로 방어측이 지정된 상태이상에 걸렸으면(원인은 이 블록 — 상대 기술) 그
  // 즉시 공격측에게도 같은 상태이상을 건다. abilityInflictedStatusOnAttacker는 정전기/불꽃몸
  // hitTrigger와 같은 필드를 재사용한다 — "방어측 특성이 공격측에게 상태이상을 걸었다"는 점에서
  // 의미가 동일하고, 한 포켓몬이 두 특성을 동시에 가질 수 없어 충돌하지 않는다.
  if (
    c.inflictedStatus &&
    c.defenderAbility?.reflectsStatusToOpponent?.includes(c.inflictedStatus) &&
    !isImmuneToStatus(c.inflictedStatus, c.attacker.types, statusImmunitiesOf(c.attacker, c.attackerAbility)) &&
    !isStatusBlockedByField(c.state.field, c.inflictedStatus, isGrounded(c.state, c.attacker, c.attackerAbility)) &&
    sideOf(c.state, c.actorKey).safeguardTurnsRemaining === undefined &&
    !(c.inflictedStatus === "freeze" && activeWeather(c.state) === "쾌청")
  ) {
    const beforeAttackerStatus = c.attacker.status.condition;
    c.attacker.status = inflictStatus(c.attacker.status, c.inflictedStatus);
    if (c.attacker.status.condition !== beforeAttackerStatus) {
      c.abilityInflictedStatusOnAttacker = c.attacker.status.condition;
      c.abilityInflictedStatusAbilityName = c.defenderAbility.name;
    }
  }
}

/** 상태이상 즉시치료 열매와 행동방해(volatile) 부여 */
function statusCureAndVolatile(c: MirroredCtx) {

  // 상태이상 치료 관련 상태(물거품아리아 등 치료 기술, 불꽃 피격 해동, 잠듦/얼음 자연 해제,
  // 잠자기, 상태이상 즉시치료 나무열매)를 전부 여기 한 변수에 모은다 — 아래에서 순서대로 채워진다.


  // 트랙 M3: 특성이 바뀌어 새 특성이 면역인 상태가 풀렸을 때(고민씨로 불면 → 잠이 깸 등). 이미 다른 치료가 기록됐으면 덮지 않는다.
  c.noteCure = (condition: StatusConditionState["condition"] | undefined, target: "self" | "opponent") => {
    if (condition && !c.curedStatus) {
      c.curedStatus = condition;
      c.curedStatusTarget = target;
    }
  };

  // 상태이상 즉시치료 나무열매(리샘·버치·유루·복슝·복분·배리): 걸리는 "그 순간" 치료하고 소모된다.
  // itemConsumed는 나무열매 18종(타입내성)과 같은 축을 공유하므로(도구 1개=1회용), 이미 다른
  // 나무열매 효과가 이번 배틀에서 소모됐으면 발동하지 않는다.
  if (
    c.inflictedStatus &&
    !c.defenderBerriesBlocked &&
    getStatusCureBerryResult(c.defenderItem, c.inflictedStatus, c.defender.itemConsumed ?? false)
  ) {
    c.defender.status = { ...NO_STATUS_CONDITION };
    consumeItem(c.defender);
    c.statusCureBerryItemName = c.defenderItem!.name;
    c.curedStatus = c.inflictedStatus;
    c.curedStatusTarget = "opponent";
  }



  if (c.effectiveMove.inflictsVolatile) {
    for (const effect of c.effectiveMove.inflictsVolatile) {
      if (
        effect.volatile === "confusion" &&
        isConfusionBlockedByField(c.state.field, effect.target === "self" ? isGrounded(c.state, c.attacker, c.attackerAbility) : isGrounded(c.state, c.defender, c.defenderAbility))
      )
        continue;
      // 정신력: 풀죽음 자체에 면역이라 발동 시도 자체가 무산된다(본가 규칙 — 확률 판정까지 가지 않음)
      if (effect.volatile === "flinch" && effect.target !== "self" && c.defenderAbility?.immuneToFlinch) continue;
      // 아로마베일: 방어측이 이 특성이면 헤롱헤롱·도발이 걸리지 않는다(마음을 옭아매는 기술 차단).
      if (
        effect.target !== "self" &&
        c.defenderAbility?.blocksMentalMoves &&
        (effect.volatile === "attract" || effect.volatile === "taunt" || effect.volatile === "torment")
      ) {
        c.mentalMoveBlockedByAbilityName = c.defenderAbility.name;
        continue;
      }
      // 황금몸: 상대(공격측)를 향한 변화기 효과만 막는다 — target이 "self"(공격측 자신에게
      // 거는 것, 예: 반동/하품 예약)면 이 포켓몬을 겨냥한 게 아니라서 그대로 진행된다.
      if (effect.target !== "self" && c.opponentEffectsBlocked) continue;
      // 인분: 데미지 기술이 상대에게 거는 행동방해(아이언헤드 풀죽음·물의파동 혼란 등)도 추가효과.
      if (effect.target !== "self" && c.secondaryEffectsBlockedByAbility) {
        c.secondaryBlockedByAbilityName = c.defenderAbility!.name;
        continue;
      }
      const target = effect.target === "self" ? c.attacker : c.defender;
      // 마이페이스(혼란)·둔감(헤롱헤롱·도발) — 트랙 M3. 확정 효과(변화기)만 로그로 알리고, 확률 부가효과는 조용히 무산.
      const immunityAbility = effect.target === "self" ? c.attackerAbility : c.defenderAbility;
      if (
        (effect.volatile === "confusion" && immunityAbility?.immuneToConfusion) ||
        ((effect.volatile === "attract" || effect.volatile === "taunt") && immunityAbility?.immuneToAttractAndTaunt)
      ) {
        if (effect.chance === undefined) {
          c.volatileBlockedByAbility = { abilityName: immunityAbility!.name, volatile: effect.volatile, self: effect.target === "self" };
        }
        continue;
      }
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
        const wisherSide = sideOf(c.state, c.actorKey);
        if (wisherSide.wish) continue;
        const wishChance = effect.chance !== undefined ? effect.chance / 100 : 1;
        if (c.random() >= wishChance) continue;
        wisherSide.wish = { turnsRemaining: 2, healAmount: Math.floor(c.state[c.actorKey].maxHp / 2) };
        c.inflictedVolatile = "wish"; // 시전 로그("· 희망사항!")용 마커
        continue;
      }
      // 헤롱헤롱: 이미 헤롱헤롱 상태거나(재사용 실패, drowsy/wish와 같은 패턴), 대상 또는
      // 거는 쪽이 무성별이거나 둘이 동성이면(getEffectiveGender 기준) 조용히 무산된다 — 본가에서도
      // 이 경우 "But it failed!"로 아무 효과 없이 끝난다.
      if (effect.volatile === "attract") {
        const inflicter = effect.target === "self" ? c.defender : c.attacker;
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
      // 트집·봉인(트랙 M2)·검은눈빛/블록·록온(트랙 M6)도 같은 규칙 — 이미 걸려 있으면 실패. 고스트는 교체 봉쇄에 걸리지 않는다.
      if (
        ((effect.volatile === "taunt" ||
          effect.volatile === "torment" ||
          effect.volatile === "imprison" ||
          effect.volatile === "meanLook" ||
          effect.volatile === "lockOn") &&
          hasVolatile(target.volatile, effect.volatile)) ||
        (effect.volatile === "meanLook" && target.types.includes("고스트"))
      ) {
        // 그림자꿰매기(ver.1.9)처럼 데미지 기술의 추가효과면 조용히 무산 — "실패했다"는 변화기만
        if (c.effectiveMove.category === "status") c.statusInflictFailed = true;
        continue;
      }
      // 그림자꿰매기: 상대가 쓰러졌으면 걸지 않는다
      if (effect.volatile === "meanLook" && effect.target !== "self" && isFainted(c.defender)) continue;
      const chance = effect.chance !== undefined ? effect.chance / 100 : 1;
      if (c.random() >= chance) continue;
      if (effect.target === "self") {
        c.attacker.volatile = inflictVolatile(c.attacker.volatile, effect.volatile, c.random);
      } else {
        c.defender.volatile = inflictVolatile(c.defender.volatile, effect.volatile, c.random);
      }
      c.inflictedVolatile = effect.volatile;

      // 시몬열매: 혼란에 걸리는 순간 치료하고 소모된다
      if (effect.volatile === "confusion") {
        const targetBerriesBlocked = effect.target === "self" ? c.attackerBerriesBlocked : c.defenderBerriesBlocked;
        const targetItem = targetBerriesBlocked ? undefined : effect.target === "self" ? c.attackerItem : c.defenderItem;
        if (getConfusionCureBerryResult(targetItem, target.itemConsumed ?? false)) {
          target.volatile = { active: { ...target.volatile.active } };
          delete target.volatile.active.confusion;
          consumeItem(target);
          c.statusCureBerryItemName = targetItem!.name;
          c.inflictedVolatile = undefined;
        }
      }

      // 멘탈허브: 헤롱헤롱/도발/트집이 걸리는 순간 치료하고 소모된다. 나무열매가 아니라 긴장감
      // (berriesBlocked)의 영향을 받지 않는다.
      if (effect.volatile === "attract" || effect.volatile === "taunt" || effect.volatile === "torment") {
        const targetItem = effect.target === "self" ? c.attackerItem : c.defenderItem;
        if (getMentalHerbCureResult(targetItem, target.itemConsumed ?? false)) {
          target.volatile = { active: { ...target.volatile.active } };
          delete target.volatile.active[effect.volatile];
          consumeItem(target);
          c.statusCureBerryItemName = targetItem!.name;
          c.inflictedVolatile = undefined;
        }
      }
    }
  }
}

/** 정리정돈·안개제거·코트체인지·회생의기도·시럽봄·소금절이·풍선 */
function hazardsAndSideEffects(c: MirroredCtx) {

  // 정리정돈·고속스핀(Move.hazardClear): 명중 시 설치물·대타를 정리한다. 본가 규칙(방어류는
  // "자신/아군 대상"·"모든 포켓몬 대상" 기술을 막지 못한다 — Bulbapedia Protect 문서)상
  // 정리정돈(자신+상대 양쪽 대상, status)은 방어류에 안 막히지만, 고속스핀은 상대 1마리를
  // 겨냥하는 데미지 기술이라 막히면 부가효과(설치물 정리)도 함께 무산된다(§1.4 버그 수정 —
  // 이전엔 둘 다 blockedByProtect로 묶여 있어 정리정돈까지 잘못 막혔었다).
  c.tidyUpDone = false;
  if (c.effectiveMove.hazardClear === "tidy" && c.hit) {
    c.state.sideA.hazards = emptyHazardState();
    c.state.sideB.hazards = emptyHazardState();
    c.attacker.substituteHp = undefined;
    c.defender.substituteHp = undefined;
    c.tidyUpDone = true;
  } else if (c.effectiveMove.hazardClear === "spin" && c.hit && !c.blockedByProtect) {
    // 사용자 쪽 설치물 + 사용자에게 걸린 속박·씨뿌리기만 정리한다(본가 고속스핀).
    sideOf(c.state, c.actorKey).hazards = emptyHazardState();
    const nextActive = { ...c.attacker.volatile.active };
    delete nextActive.bound;
    delete nextActive.leechSeed;
    c.attacker.volatile = { active: nextActive };
  }

  // 안개제거(Move.defogsField): 상대 1마리를 겨냥하는 status 기술이라 방어류에 막힌다(고속스핀과
  // 같은 축). 명중 시 양쪽 진영의 설치물·스크린·신비의부적과 필드(terrain)를 전부 없앤다 — 날씨는
  // 대상이 아니다(사용자 확인, 2.3 B3). 아무 효과도 없었으면 로그에 빈 문구가 안 뜨게 변경 여부를 본다.
  c.defogFieldCleared = false;
  if (c.effectiveMove.defogsField && c.hit && !c.blockedByProtect) {
    const hazardsEmpty = (h: typeof c.state.sideA.hazards) =>
      !h.stealthRock && h.spikesLayers === 0 && h.toxicSpikesLayers === 0 && !h.stickyWeb;
    const hadEffect =
      !hazardsEmpty(c.state.sideA.hazards) ||
      !hazardsEmpty(c.state.sideB.hazards) ||
      Object.keys(c.state.sideA.screens).length > 0 ||
      Object.keys(c.state.sideB.screens).length > 0 ||
      c.state.sideA.safeguardTurnsRemaining !== undefined ||
      c.state.sideB.safeguardTurnsRemaining !== undefined ||
      c.state.field !== undefined;
    c.state.sideA.hazards = emptyHazardState();
    c.state.sideB.hazards = emptyHazardState();
    c.state.sideA.screens = {};
    c.state.sideB.screens = {};
    c.state.sideA.safeguardTurnsRemaining = undefined;
    c.state.sideB.safeguardTurnsRemaining = undefined;
    c.state.field = undefined;
    c.state.fieldTurnsRemaining = undefined;
    c.defogFieldCleared = hadEffect;
  }

  // 코트체인지(Move.swapsSideEffects): 명중 시 양쪽 진영의 설치물(hazards)·스크린(screens)을
  // 통째로 맞바꾼다. 필드·날씨·트릭룸은 장 전체 효과라 대상이 아니다(본가와 동일). 양쪽 편
  // 전체가 대상이라 방어류에 막히지 않는다(본가 규칙 — 정리정돈과 같은 축. §1.4 버그 수정 전엔
  // blockedByProtect로 잘못 막혔었다).
  c.courtChangeDone = false;
  if (c.effectiveMove.swapsSideEffects && c.hit) {
    const swapHazards = c.state.sideA.hazards;
    c.state.sideA.hazards = c.state.sideB.hazards;
    c.state.sideB.hazards = swapHazards;
    const swapScreens = c.state.sideA.screens;
    c.state.sideA.screens = c.state.sideB.screens;
    c.state.sideB.screens = swapScreens;
    // 순풍·신비의부적도 편 단위 효과라 함께 맞바꾼다(본가 — Tier 2 작업 중 수정)
    [c.state.sideA.tailwindTurnsRemaining, c.state.sideB.tailwindTurnsRemaining] = [c.state.sideB.tailwindTurnsRemaining, c.state.sideA.tailwindTurnsRemaining];
    [c.state.sideA.safeguardTurnsRemaining, c.state.sideB.safeguardTurnsRemaining] = [c.state.sideB.safeguardTurnsRemaining, c.state.sideA.safeguardTurnsRemaining];
    c.courtChangeDone = true;
  }

  // 회생의기도(Move.revivesFaintedAlly): 명중 시 기절한 교대 포켓몬 1마리(가장 앞 슬롯)를 최대
  // HP의 절반으로 부활시킨다. 벤치 부활이라 교체(pendingPivot)는 일어나지 않는다. 부활 대상이
  // 없으면 실패("그러나 실패했다!"). 아군 대상 기술이라 방어류에 막히지 않는다(본가 규칙 —
  // §1.4 버그 수정 전엔 blockedByProtect로 잘못 막혔었다).

  c.reviveFailed = false;
  if (c.effectiveMove.revivesFaintedAlly && c.hit) {
    const mySide = sideOf(c.state, c.actorKey);
    const target = mySide.party.find((f, i) => i !== mySide.activeIndex && isFainted(f));
    if (target) {
      target.currentHp = Math.max(1, Math.floor(target.maxHp / 2));
      c.revivedPartyName = getPokemon(target.slot.pokemonId)?.name ?? target.slot.pokemonId;
    } else {
      c.reviveFailed = true;
    }
  }

  // 시럽봄(Move.setsSyrupCoat): 명중 시 상대를 물엿범벅(syrupCoat, 3턴) 상태로 만든다. 데미지 기술의
  // 부가효과라 인분·우격다짐엔 발동하지 않고, 황금몸(opponentEffectsBlocked)에도 막힌다.
  if (
    c.effectiveMove.setsSyrupCoat &&
    c.hit &&
    !c.blockedByProtect &&
    !c.opponentEffectsBlocked &&
    !c.secondaryEffectsBlockedByAbility &&
    !c.sheerForceAbilityName &&
    !isFainted(c.defender) &&
    !hasVolatile(c.defender.volatile, "syrupCoat")
  ) {
    c.defender.volatile = inflictVolatile(c.defender.volatile, "syrupCoat", c.random);
  }

  // 소금절이(Move.setsSaltCure): 명중해서 데미지를 준 뒤 상대를 소금절이(saltCure, 영구) 상태로 만든다.
  // 인분·우격다짐엔 발동하지 않는다(공격 데미지만). 황금몸에도 막힌다.
  c.saltCureApplied = false;
  if (
    c.effectiveMove.setsSaltCure &&
    c.hit &&
    !c.blockedByProtect &&
    c.damage > 0 &&
    !c.opponentEffectsBlocked &&
    !c.secondaryEffectsBlockedByAbility &&
    !c.sheerForceAbilityName &&
    !isFainted(c.defender) &&
    !hasVolatile(c.defender.volatile, "saltCure")
  ) {
    c.defender.volatile = inflictVolatile(c.defender.volatile, "saltCure", c.random);
    c.saltCureApplied = true;
  }

  // 풍선(Item.grantsGroundImmunity): 데미지를 주는 기술에 맞으면(땅타입은 애초에 면역이라
  // damage가 0 — 안 터짐) 그 즉시 터져서 소모된다. 이후 판정부터는 다시 땅타입에 노출된다.

  if (c.damage > 0 && c.defenderItem?.grantsGroundImmunity && !c.defender.itemConsumed) {
    c.balloonPoppedItemName = c.defenderItem.name;
    consumeItem(c.defender);
  }
}

/** 문어굳히기·물고버티기·왕의징표석 풀죽음·불굴의마음 */
function bindingAndFlinch(c: MirroredCtx) {

  // 문어굳히기(Move.octolock): 변화기. 명중 시 상대를 octolock 상태로 만든다 — 교체 봉인 +
  // 매 턴 종료 시 방어·특수방어 -1. 부가효과 취급이라 인분·우격다짐·황금몸에 막힌다.
  c.octolockApplied = false;
  if (
    c.effectiveMove.octolock &&
    c.hit &&
    !c.blockedByProtect &&
    !c.opponentEffectsBlocked &&
    !c.secondaryEffectsBlockedByAbility &&
    !c.sheerForceAbilityName &&
    !isFainted(c.defender) &&
    !hasVolatile(c.defender.volatile, "octolock")
  ) {
    c.defender.volatile = inflictVolatile(c.defender.volatile, "octolock", c.random);
    c.octolockApplied = true;
  }

  // 물고버티기(Move.jawLock): 데미지 기술. 명중 시 사용자와 대상 양쪽을 jawLock 상태로 만든다
  // (양쪽 교체 봉인). 이미 어느 쪽이든 걸려 있으면 재적용 안 함. 지속 데미지·랭크 변화 없음.
  c.jawLockApplied = false;
  if (
    c.effectiveMove.jawLock &&
    c.hit &&
    !c.blockedByProtect &&
    c.damage > 0 &&
    !c.opponentEffectsBlocked &&
    !isFainted(c.defender) &&
    !isFainted(c.attacker) &&
    !hasVolatile(c.defender.volatile, "jawLock") &&
    !hasVolatile(c.attacker.volatile, "jawLock")
  ) {
    c.defender.volatile = inflictVolatile(c.defender.volatile, "jawLock", c.random);
    c.attacker.volatile = inflictVolatile(c.attacker.volatile, "jawLock", c.random);
    c.jawLockApplied = true;
  }

  // 왕의징표석: 데미지를 주는 데 성공하면 이 확률로 상대에게 추가 풀죽음을 건다. 기술 자체의
  // 풀죽음 확률(있다면)과는 완전히 별개 판정이라, 기술이 이미 풀죽음을 걸었으면 중복으로 다시
  // 걸 필요가 없다(로그에 "풀죽음!"이 두 번 찍히는 것만 방지 — 결과 자체는 어차피 동일).
  // 악취: 왕의징표석과 같은 축의 특성 버전 — 공격측이 이 특성이면 이 확률로 추가 풀죽음.
  const stenchFlinchTriggered =
    c.attackerAbility?.flinchChanceOnHit !== undefined && c.random() * 100 < c.attackerAbility.flinchChanceOnHit;
  if (
    c.isDamaging &&
    c.damage > 0 &&
    c.inflictedVolatile !== "flinch" &&
    !isFainted(c.defender) &&
    !c.defenderAbility?.immuneToFlinch &&
    (getExtraFlinchTriggered(c.attackerItem, c.random) || stenchFlinchTriggered)
  ) {
    if (c.defenderAbility?.blocksSecondaryEffects) {
      // 인분: 왕의징표석·악취가 얹는 추가 풀죽음도 추가효과라 무산된다(굴림은 이미 소비 — 결과만 버린다).
      c.secondaryBlockedByAbilityName = c.defenderAbility.name;
    } else {
      c.defender.volatile = inflictVolatile(c.defender.volatile, "flinch", c.random);
      c.inflictedVolatile = "flinch";
    }
  }

  // 불굴의마음: 이번 행동에서 풀죽음이 걸렸으면(기술 자체든 왕의징표석이든, 둘 다 위에서
  // 이미 defender.volatile에 반영됨) 그 즉시 지정된 랭크가 오른다.
  if (c.inflictedVolatile === "flinch" && c.defenderAbility?.boostsStatOnFlinch) {
    const boost = c.defenderAbility.boostsStatOnFlinch;
    c.defender.stages = applyStageDelta(c.defender.stages, boost.stat, contraryDelta(c.defender, boost.delta));
  }
}

/** 상태이상 치료·해동·잠자기·즉시 회복형 변화기·꿀꺽 */
function healAndThaw(c: MirroredCtx) {

  // 상태이상 치료: 물거품아리아처럼 명중 시 대상의 주 상태이상을 없앤다(inflictsStatus의 반대 방향).
  // status가 지정돼 있으면(물거품아리아=화상) 그 상태일 때만 치료 — 다른 상태이상은 안 지운다.
  c.partyStatusCuredCount = 0;
  if (c.effectiveMove.curesStatus) {
    const { target: cureTarget, status: cureStatus } = c.effectiveMove.curesStatus;
    const target = cureTarget === "self" ? c.attacker : c.defender;
    if (target.status.condition && (!cureStatus || target.status.condition === cureStatus)) {
      c.curedStatus = target.status.condition;
      c.curedStatusTarget = cureTarget;
      target.status = { ...NO_STATUS_CONDITION };
    }
    // 치료방울(curesParty, Tier 2): 대기 포켓몬의 상태이상도 모두 고친다(본가 — 이전엔 자신만)
    if (c.effectiveMove.curesParty) {
      for (const f of sideOf(c.state, c.actorKey).party) {
        if (f !== c.attacker && !isFainted(f) && f.status.condition) {
          f.status = { ...NO_STATUS_CONDITION };
          c.partyStatusCuredCount++;
        }
      }
    }
  }

  // 얼음 상태의 상대가 불꽃타입 "데미지" 기술(물리/특수)에 맞으면 해제 확률(매턴 25%)과 무관하게
  // 즉시 해동된다 — 본가 규칙. 도깨비불처럼 변화기(status)는 타입이 불꽃이어도 해동시키지 않는다
  // (사용자 확인). curesStatus처럼 특정 기술만 태깅하는 게 아니라 "불꽃타입 데미지 기술이면 전부"
  // 적용되는 일반 규칙이라 별도로 둔다.
  if (
    c.effectiveMove.type === "불꽃" &&
    c.effectiveMove.category !== "status" &&
    c.defender.status.condition === "freeze"
  ) {
    c.curedStatus = "freeze";
    c.curedStatusTarget = "opponent";
    c.defender.status = { ...NO_STATUS_CONDITION };
  }

  // 이번 행동 시작 시점에 자신의 잠듦/얼음이 자연 해제(또는 thawsUserOnUse 강제 해동)됐으면
  // 별도 필드로 넘긴다 — 로그에서 기술 줄보다 먼저 렌더해야 하므로 curedStatus(행동 이후에
  // 일어나는 것들)와 섞지 않는다.
  c.selfWokeBeforeMove = c.selfCuredStatus;

  // 잠자기: 명중(항상 필중)하면 기존 상태이상이 뭐든 지우고 체력을 완전히 회복한 뒤 정확히 2턴간
  // 무조건 재운다 — curesStatus/inflictsStatus의 일반 규칙(이미 상태이상이 있으면 못 걺)과는
  // 다른 별도 경로라 여기서 직접 덮어쓴다. curedStatus 로그는 재우기 전 상태이상이 있었을 때만 채운다.
  c.restSlept = false;
  if (c.effectiveMove.restSleep) {
    if (c.attacker.status.condition) {
      c.curedStatus = c.attacker.status.condition;
      c.curedStatusTarget = "self";
    }
    c.attacker.currentHp = c.attacker.maxHp;
    c.attacker.status = inflictRestSleep();
    c.restSlept = true;

    // 리샘열매/유루열매 등을 지닌 채로 잠자기를 쓰면, 회복은 이미 끝난 채로 그 즉시 잠듦만
    // 치료된다(본가 실제 상호작용 — 잠자기 자체가 낭비되지만 회복은 유효하다).
    if (!c.attackerBerriesBlocked && getStatusCureBerryResult(c.attackerItem, "sleep", c.attacker.itemConsumed ?? false)) {
      c.attacker.status = { ...NO_STATUS_CONDITION };
      consumeItem(c.attacker);
      c.statusCureBerryItemName = c.attackerItem!.name;
      c.curedStatus = "sleep";
      c.curedStatusTarget = "self";
      c.restSlept = false;
    }
  }

  // 즉시 회복형 변화기: 광합성/달빛(날씨 의존)·날개쉬기/게으름피우기(고정 50%)·치유파동(상대 50%).
  // 잠자기는 위에서 이미 별도 처리했으니 여기선 건드리지 않는다.
  c.healedAmount = 0;

  if (!c.effectiveMove.restSleep && (c.effectiveMove.healsFraction !== undefined || c.effectiveMove.healsWeatherDependent)) {
    c.healedTarget = c.effectiveMove.healsTarget ?? "self";
    const healTarget = c.healedTarget === "self" ? c.attacker : c.defender;
    // 메가솔라: 자신이 쓰는 광합성·달빛류(자기 회복)의 회복량이 항상 쾌청 기준(2/3)이 된다.
    const healWeather =
      c.healedTarget === "self" && c.attackerAbility?.treatsOwnWeatherAsSun ? "쾌청" : activeWeather(c.state);
    const fraction = c.effectiveMove.healsWeatherDependent
      ? computeWeatherHealFraction(healWeather)
      : c.effectiveMove.healsFraction!;
    c.healedAmount = Math.min(
      healTarget.maxHp - healTarget.currentHp,
      Math.floor(healTarget.maxHp * fraction),
    );
    healTarget.currentHp += c.healedAmount;
  }

  // 꿀꺽(healsByStockpile, 트랙 M1): 비축 1/2/3이면 최대 HP 1/4·1/2·전부 회복, 스택과 그만큼의 방어·특방 랭크를
  // 되돌린다(토해내기와 같은 소비). 비축이 없으면 실패.
  c.stockpileHealFailed = false;
  if (c.effectiveMove.healsByStockpile) {
    const spent = c.attacker.stockpileCount ?? 0;
    if (spent === 0) {
      c.stockpileHealFailed = true;
    } else {
      const fraction = spent >= 3 ? 1 : spent === 2 ? 0.5 : 0.25;
      c.healedTarget = "self";
      c.healedAmount = Math.min(c.attacker.maxHp - c.attacker.currentHp, Math.floor(c.attacker.maxHp * fraction));
      c.attacker.currentHp += c.healedAmount;
      c.attacker.stockpileCount = 0;
      c.attacker.stages = applyStageDelta(applyStageDelta(c.attacker.stages, "def", -spent), "spd", -spent);
    }
  }
}

/** 힘흡수·가드셰어·스피드스왑·트릭·아픔나누기·리사이클·자기암시·파워셰어·원한 */
function statSwapEffects(c: MirroredCtx) {

  // 힘흡수(drainsFromTargetAttackStat): 상대의 공격 실능(랭크 반영, -1 적용 전 값)만큼 자신을 회복.
  // 상대 공격 -1은 데이터의 statChanges로 위에서 이미 적용됐지만, 회복량은 랭크 변화 전 실능
  // 기준이라 defenderStagesBeforeMoveChange를 쓴다(본가 규칙).
  if (c.effectiveMove.drainsFromTargetAttackStat) {
    const targetAtk = Math.floor(
      c.defender.realStats.atk * rankStageMultiplier(c.defenderStagesBeforeMoveChange.atk),
    );
    const gain = Math.min(c.attacker.maxHp - c.attacker.currentHp, targetAtk);
    c.attacker.currentHp += gain;
    c.healedAmount = gain;
    c.healedTarget = "self";
  }

  // 가드셰어(averagesDefensesWithTarget): 자신·상대의 방어·특방 실능을 각각 더해 반씩 배정(내림).
  // 파워트릭(swapsOwnStats)처럼 realStats를 직접 고쳐 재계산이 필요 없다.

  if (c.effectiveMove.averagesDefensesWithTarget) {
    const avgDef = Math.floor((c.attacker.realStats.def + c.defender.realStats.def) / 2);
    const avgSpd = Math.floor((c.attacker.realStats.spd + c.defender.realStats.spd) / 2);
    c.attacker.realStats = { ...c.attacker.realStats, def: avgDef, spd: avgSpd };
    c.defender.realStats = { ...c.defender.realStats, def: avgDef, spd: avgSpd };
    c.averagedDefensesMoveName = c.effectiveMove.name;
  }

  // 스피드스왑(swapsSpeedWithTarget): 자신·상대의 스피드 실능을 서로 맞바꾼다.

  if (c.effectiveMove.swapsSpeedWithTarget) {
    const aSpe = c.attacker.realStats.spe;
    c.attacker.realStats = { ...c.attacker.realStats, spe: c.defender.realStats.spe };
    c.defender.realStats = { ...c.defender.realStats, spe: aSpe };
    c.swappedSpeedMoveName = c.effectiveMove.name;
  }

  // 트릭·바꿔치기(swapsItemsWithTarget, 트랙 M1): 도구를 맞바꾼다. 둘 다 무도구·어느 쪽이든 메가스톤·상대 점착이면 실패.
  // 새 도구로 다음 기술부터 다시 잠기도록 양쪽 구애류 잠금을 푼다. 곡예는 resolveAction의 도구 전후 비교가 처리한다.

  c.itemSwapFailed = false;
  if (c.effectiveMove.swapsItemsWithTarget) {
    const mine = c.attacker.currentItemId;
    const theirs = c.defender.currentItemId;
    const isMegaStone = (id: string | null) => !!id && getItem(id)?.category === "mega-stone";
    if ((!mine && !theirs) || isMegaStone(mine) || isMegaStone(theirs) || c.defenderAbility?.preventsItemLoss) {
      c.itemSwapFailed = true;
    } else {
      c.attacker.currentItemId = theirs;
      c.defender.currentItemId = mine;
      // 새로 얻은 도구라 이전 소모 이력과 무관하게 다시 쓸 수 있다(매지션 도둑질과 같은 처리)
      c.attacker.itemConsumed = false;
      c.defender.itemConsumed = false;
      c.attacker.choiceLockedMoveId = undefined;
      c.defender.choiceLockedMoveId = undefined;
      c.swappedItems = {
        userGotName: theirs ? getItem(theirs)?.name : undefined,
        targetGotName: mine ? getItem(mine)?.name : undefined,
      };
    }
  }

  // 아픔나누기(sharesHpWithTarget, 트랙 M1): 둘의 현재 HP 합을 반씩(내림) — 각자 최대 HP까지.

  if (c.effectiveMove.sharesHpWithTarget) {
    c.painSplitHp = Math.floor((c.attacker.currentHp + c.defender.currentHp) / 2);
    c.attacker.currentHp = Math.min(c.attacker.maxHp, c.painSplitHp);
    c.defender.currentHp = Math.min(c.defender.maxHp, c.painSplitHp);
  }

  // 리사이클(recyclesItem, 트랙 M1): 지닌 도구가 없고 이번 배틀에서 소모한 도구가 있으면 그 도구를 다시 지닌다.

  c.recycleFailed = false;
  if (c.effectiveMove.recyclesItem) {
    if (c.attacker.currentItemId || !c.attacker.lastConsumedItemId) {
      c.recycleFailed = true;
    } else {
      c.attacker.currentItemId = c.attacker.lastConsumedItemId;
      c.attacker.itemConsumed = false;
      c.attacker.lastConsumedItemId = undefined;
      c.recycledItemName = getItem(c.attacker.currentItemId)?.name;
    }
  }

  // 자기암시(copiesTargetStages, 트랙 M2): 상대의 능력·명중·회피·급소 랭크를 그대로 복사한다(변신과 같은 복사).

  if (c.effectiveMove.copiesTargetStages) {
    c.attacker.stages = { ...c.defender.stages };
    c.attacker.accuracyStages = { ...c.defender.accuracyStages };
    c.attacker.critStage = c.defender.critStage;
    c.copiedStagesFromName = getPokemon(c.defender.slot.pokemonId)?.name ?? "상대";
  }

  // 파워셰어(averagesAttacksWithTarget, 트랙 M2): 가드셰어의 공격판 — 공격·특공 실능을 각각 더해 반씩(내림).

  if (c.effectiveMove.averagesAttacksWithTarget) {
    const avgAtk = Math.floor((c.attacker.realStats.atk + c.defender.realStats.atk) / 2);
    const avgSpa = Math.floor((c.attacker.realStats.spa + c.defender.realStats.spa) / 2);
    c.attacker.realStats = { ...c.attacker.realStats, atk: avgAtk, spa: avgSpa };
    c.defender.realStats = { ...c.defender.realStats, atk: avgAtk, spa: avgSpa };
    c.averagedAttacksMoveName = c.effectiveMove.name;
  }

  // 원한(reducesTargetLastMovePp, 트랙 M2): 상대가 마지막으로 쓴 기술의 PP를 줄인다. 쓴 기술이 없거나
  // (등장 직후) 그 기술 PP가 이미 0이면 실패. 대타·황금몸이면 무산.

  c.spiteFailed = false;
}

/** 섬뜩한주문·경혈찌르기·부식가스·자기장조작·변신·뿌리박기·씨뿌리기·속박·특성 지정 */
function miscMoveEffects(c: MirroredCtx) {
  // 섬뜩한주문(ver.1.9): 데미지 기술의 추가효과 — 상대가 쓰러졌거나 인분이면 무산, 실패 문구 없음.
  const spiteIsSecondary = c.effectiveMove.category !== "status";
  if (
    c.effectiveMove.reducesTargetLastMovePp &&
    c.hit &&
    !c.opponentEffectsBlocked &&
    !(spiteIsSecondary && (isFainted(c.defender) || c.secondaryEffectsBlockedByAbility))
  ) {
    const lastId = c.defender.lastMoveId;
    const remaining = lastId ? c.defender.remainingPp[lastId] : undefined;
    if (!lastId || remaining === undefined || remaining <= 0) {
      c.spiteFailed = !spiteIsSecondary;
    } else {
      const amount = Math.min(remaining, c.effectiveMove.reducesTargetLastMovePp);
      c.defender.remainingPp[lastId] = remaining - amount;
      c.spitePp = { moveName: getMove(lastId)?.name ?? lastId, amount };
    }
  }

  // 경혈찌르기(raisesRandomStat, 트랙 M2): +6이 아닌 능력(명중·회피 포함) 중 하나를 무작위로 올린다. 전부 +6이면 실패.

  c.acupressureFailed = false;
  if (c.effectiveMove.raisesRandomStat) {
    const options: (BattleStatKey | AccuracyEvasionKey)[] = [
      ...BATTLE_STAT_KEYS.filter((s) => c.attacker.stages[s] < 6),
      ...(["accuracy", "evasion"] as const).filter((s) => c.attacker.accuracyStages[s] < 6),
    ];
    if (options.length === 0) {
      c.acupressureFailed = true;
    } else {
      const stat = options[Math.floor(c.random() * options.length)];
      if (stat === "accuracy" || stat === "evasion") {
        const before = c.attacker.accuracyStages[stat];
        const after = Math.min(6, before + c.effectiveMove.raisesRandomStat);
        c.attacker.accuracyStages = { ...c.attacker.accuracyStages, [stat]: after };
        c.acupressureRaised = { stat, delta: after - before };
      } else {
        const before = c.attacker.stages[stat];
        c.attacker.stages = applyStageDelta(c.attacker.stages, stat, c.effectiveMove.raisesRandomStat);
        c.acupressureRaised = { stat, delta: c.attacker.stages[stat] - before };
      }
    }
  }

  // 부식가스(removesTargetItem, 트랙 M6): 상대 도구를 녹여 없앤다 — 리사이클로 되찾을 수 없다(소모 기록을 남기지 않음).

  c.meltFailed = false;
  if (c.effectiveMove.removesTargetItem && c.hit && !c.opponentEffectsBlocked) {
    const itemId = c.defender.currentItemId;
    if (!itemId || getItem(itemId)?.category === "mega-stone" || c.defenderAbility?.preventsItemLoss) {
      c.meltFailed = true;
    } else {
      c.meltedItemName = getItem(itemId)?.name ?? itemId;
      c.defender.currentItemId = null;
      c.defender.choiceLockedMoveId = undefined;
    }
  }

  // 자기장조작(boostsDefensesIfPlusMinus, 트랙 M6): 플러스·마이너스면 방어·특방 +1(자기 랭크업 로그로), 아니면 실패.
  c.magneticFluxFailed = false;
  if (c.effectiveMove.boostsDefensesIfPlusMinus) {
    const abilityId = c.attacker.effectiveAbilityId;
    if (abilityId !== "플러스" && abilityId !== "마이너스") {
      c.magneticFluxFailed = true;
    } else {
      for (const stat of ["def", "spd"] as const) {
        const before = c.attacker.stages[stat];
        c.attacker.stages = applyStageDelta(c.attacker.stages, stat, contraryDelta(c.attacker, 1));
        if (c.attacker.stages[stat] > before) c.selfStatRises.push({ stat, delta: c.attacker.stages[stat] - before });
        else if (before >= 6) c.selfStatsAtMax.push(stat);
      }
    }
  }

  // 변신(transformsIntoTarget): 상대로 변신한다. 이미 변신 상태면 실패(1v1이라 배틀 끝까지 유지).

  c.transformFailed = false;
  if (c.effectiveMove.transformsIntoTarget) {
    if (c.attacker.transformed) {
      c.transformFailed = true;
    } else {
      applyTransform(c.attacker, c.defender);
      c.transformedIntoName = getPokemon(c.defender.slot.pokemonId)?.name ?? "상대";
    }
  }

  // 뿌리박기/아쿠아링: 이미 걸려있으면 재사용 실패(지속 효과 중복 방지, 필드/트릭룸과 같은 패턴).
  c.regenSetFailed = false;
  if (c.effectiveMove.setsRegenVolatile) {
    if (hasVolatile(c.attacker.volatile, c.effectiveMove.setsRegenVolatile)) {
      c.regenSetFailed = true;
    } else {
      c.attacker.volatile = inflictVolatile(c.attacker.volatile, c.effectiveMove.setsRegenVolatile, c.random);
    }
  }

  // 씨뿌리기: 풀타입 상대에겐 통하지 않는다(본가 규칙 — 가루 기술과 같은 축의 면역). 그 외에는
  // 상대가 이미 씨앗이 박혀있으면 실패.
  c.leechSeedSetFailed = false;
  c.leechSeedBlockedByGrass = false;
  if (c.effectiveMove.setsLeechSeed) {
    if (c.defender.types.includes("풀")) {
      c.leechSeedBlockedByGrass = true;
    } else if (hasVolatile(c.defender.volatile, "leechSeed")) {
      c.leechSeedSetFailed = true;
    } else {
      c.defender.volatile = inflictVolatile(c.defender.volatile, "leechSeed", c.random);
    }
  }

  // 조이기·엉겨붙기·집게덫 등(bindsTarget): 데미지를 준 뒤 상대를 4~5턴 속박한다(volatile "bound").
  // 떨어뜨리기(트랙 M4): 데미지를 주면 상대를 물러날 때까지 땅에 떨어뜨린다(전자부유도 끝남). 원래 공중에 있었을 때만 로그.
  c.smackedDownTarget = false;
  if (c.effectiveMove.groundsTarget && c.damage > 0 && !c.hitSubstitute && !isFainted(c.defender) && !c.defender.smackedDown) {
    const wasAirborne = !isGrounded(c.state, c.defender, c.defenderAbility);
    c.defender.smackedDown = true;
    c.defender.magnetRiseTurnsRemaining = undefined;
    c.smackedDownTarget = wasAirborne;
  }

  // 대타를 맞혔거나 이미 속박 중이면 갱신하지 않는다.
  if (
    c.effectiveMove.bindsTarget &&
    c.damage > 0 &&
    !c.hitSubstitute &&
    !isFainted(c.defender) &&
    !hasVolatile(c.defender.volatile, "bound")
  ) {
    c.defender.volatile = inflictVolatile(c.defender.volatile, "bound", c.random);
  }

  // 심플빔("단순")·바뀌어라 등(setsTargetAbilityId): 명중 시 상대 특성을 지정 id로 바꾼다.
  // 방어/대타/황금몸/매직미러로 상대 방향 효과가 막혔으면 무발동. 이미 그 특성이면 실패 표기.

  c.abilitySwapFailed = false;
  if (c.effectiveMove.setsTargetAbilityId && c.hit && !c.opponentEffectsBlocked && !isFainted(c.defender)) {
    // 폼 변화 특성·일루전은 덮어쓸 수 없다(트랙 M3)
    if (c.defender.effectiveAbilityId === c.effectiveMove.setsTargetAbilityId || isFixedAbility(c.defender.effectiveAbilityId)) {
      c.abilitySwapFailed = true;
    } else {
      c.defender.effectiveAbilityId = c.effectiveMove.setsTargetAbilityId;
      c.defender.abilitySuppressed = undefined;
      c.abilitySwappedTargetToName = getAbility(c.effectiveMove.setsTargetAbilityId)?.name ?? c.effectiveMove.setsTargetAbilityId;
      // 고민씨(불면)로 잠든 상대는 바로 깬다
      c.noteCure(cureConditionsBlockedByAbility(c.defender), "opponent");
    }
  }
}

/** 스킬스왑·동료만들기·대타출동·꼬리자르기·사슬묶기·앙코르·파워트릭·가드스왑 */
function abilitySwapAndSubstitute(c: MirroredCtx) {

  // 트랙 M3: 스킬스왑(맞교환)·동료만들기(내 특성을 상대에게)·역할(상대 특성을 나에게)·위액(상대 특성 무효화)·
  // 미러타입(상대 타입을 나에게). 폼 변화 특성·일루전은 바꿀 수 없고, 트레이스·괴짜·리시버는 복사·건네기의 원본이 될 수 없다.

  c.abilityChangeFailed = false;
  const nameOf = (id: string | null) => (id ? getAbility(id)?.name ?? id : undefined);
  if (c.effectiveMove.swapsAbilityWithTarget && c.hit && !c.opponentEffectsBlocked && !isFainted(c.defender)) {
    const mine = c.attacker.effectiveAbilityId;
    const theirs = c.defender.effectiveAbilityId;
    if (isFixedAbility(mine) || isFixedAbility(theirs) || (!mine && !theirs)) {
      c.abilityChangeFailed = true;
    } else {
      c.attacker.effectiveAbilityId = theirs;
      c.defender.effectiveAbilityId = mine;
      c.attacker.abilitySuppressed = undefined;
      c.defender.abilitySuppressed = undefined;
      c.abilityChange = { kind: "swap" };
      c.noteCure(cureConditionsBlockedByAbility(c.attacker), "self");
      c.noteCure(cureConditionsBlockedByAbility(c.defender), "opponent");
    }
  }
  if (c.effectiveMove.givesAbilityToTarget && c.hit && !c.opponentEffectsBlocked && !isFainted(c.defender)) {
    const mine = c.attacker.effectiveAbilityId;
    if (!mine || isUncopyableAbility(mine) || isFixedAbility(c.defender.effectiveAbilityId) || c.defender.effectiveAbilityId === mine) {
      c.abilityChangeFailed = true;
    } else {
      c.defender.effectiveAbilityId = mine;
      c.defender.abilitySuppressed = undefined;
      c.abilityChange = { kind: "give", abilityName: nameOf(mine) };
      c.noteCure(cureConditionsBlockedByAbility(c.defender), "opponent");
    }
  }
  if (c.effectiveMove.copiesTargetAbility && !isFainted(c.defender)) {
    const theirs = c.defender.effectiveAbilityId;
    if (!theirs || isUncopyableAbility(theirs) || isFixedAbility(c.attacker.effectiveAbilityId) || c.attacker.effectiveAbilityId === theirs) {
      c.abilityChangeFailed = true;
    } else {
      c.attacker.effectiveAbilityId = theirs;
      c.attacker.abilitySuppressed = undefined;
      c.abilityChange = { kind: "copy", abilityName: nameOf(theirs) };
      c.noteCure(cureConditionsBlockedByAbility(c.attacker), "self");
    }
  }
  if (c.effectiveMove.suppressesTargetAbility && c.hit && !c.opponentEffectsBlocked && !isFainted(c.defender)) {
    if (c.defender.abilitySuppressed || !c.defender.effectiveAbilityId || isFixedAbility(c.defender.effectiveAbilityId)) {
      c.abilityChangeFailed = true;
    } else {
      c.defender.effectiveAbilityId = null;
      c.defender.abilitySuppressed = true;
      c.abilityChange = { kind: "suppress" };
    }
  }

  if (c.effectiveMove.copiesTargetTypes && !isFainted(c.defender)) {
    c.attacker.types = [...c.defender.types];
    c.attacker.addedType = undefined;
    c.copiedTypes = c.attacker.types;
  }

  // 대타출동: 이미 대타가 있거나, 최대 HP 1/4보다 현재 HP가 많지 않으면(=쓰면 자신이 기절하거나
  // 대타 HP가 0 이하가 되는 경우) 실패한다. 성공하면 그 즉시 HP를 깎고 같은 양만큼의 대타를 세운다.
  c.substituteSetFailed = false;
  if (c.effectiveMove.setsSubstitute) {
    const substituteCost = Math.floor(c.attacker.maxHp / 4);
    if (c.attacker.substituteHp !== undefined || c.attacker.currentHp <= substituteCost) {
      c.substituteSetFailed = true;
    } else {
      c.attacker.currentHp -= substituteCost;
      c.attacker.substituteHp = substituteCost;
    }
  }

  // 꼬리자르기: 최대 HP 1/2을 깎아 그만큼의 대타를 세운 뒤 교대 포켓몬과 교체한다(교체·대타 인계는
  // runActionPhase에서 처리). HP가 절반 이하이거나, 이미 대타가 있거나, 교대할 살아있는 예비가
  // 없으면 실패한다 — 대타도 안 세우고 교체도 안 한다.
  c.shedTailFailed = false;
  c.shedTailSucceeded = false;
  if (c.effectiveMove.shedTail) {
    const shedCost = Math.floor(c.attacker.maxHp / 2);
    if (
      c.attacker.substituteHp !== undefined ||
      c.attacker.currentHp <= shedCost ||
      !hasLivingReserve(sideOf(c.state, c.actorKey))
    ) {
      c.shedTailFailed = true;
    } else {
      c.attacker.currentHp -= shedCost;
      c.attacker.substituteHp = shedCost;
      c.shedTailSucceeded = true;
    }
  }

  // 사슬묶기: 상대가 "바로 직전에 쓴 기술"(defender.lastMoveId) 하나를 4턴간 봉인한다.
  // 상대가 아직 아무 기술도 안 썼거나(등장 직후) 이미 disable이 걸려있으면 실패한다.

  c.disableSetFailed = false;
  if (c.effectiveMove.setsDisable) {
    if (c.defenderAbility?.blocksMentalMoves) {
      c.mentalMoveBlockedByAbilityName = c.defenderAbility.name;
      c.disableSetFailed = true;
    } else if (!c.defender.lastMoveId || hasVolatile(c.defender.volatile, "disable")) {
      c.disableSetFailed = true;
    } else {
      c.defender.volatile = inflictVolatile(c.defender.volatile, "disable", c.random, c.defender.lastMoveId);
      c.setDisabledMoveName = getMove(c.defender.lastMoveId)?.name;
      // 멘탈허브: 사슬묶기가 걸리는 순간 치료하고 소모된다.
      if (getMentalHerbCureResult(c.defenderItem, c.defender.itemConsumed ?? false)) {
        c.defender.volatile = { active: { ...c.defender.volatile.active } };
        delete c.defender.volatile.active.disable;
        consumeItem(c.defender);
        c.statusCureBerryItemName = c.defenderItem!.name;
        c.setDisabledMoveName = undefined;
      }
    }
  }

  // 앙코르: 상대가 "바로 직전에 쓴 기술"만 3턴간 강제로 반복하게 만든다(사슬묶기의 반대 방향).
  // 마찬가지로 상대가 아직 아무 기술도 안 썼거나 이미 encore가 걸려있으면 실패한다.

  c.encoreSetFailed = false;
  if (c.effectiveMove.setsEncore) {
    if (c.defenderAbility?.blocksMentalMoves) {
      c.mentalMoveBlockedByAbilityName = c.defenderAbility.name;
      c.encoreSetFailed = true;
    } else if (!c.defender.lastMoveId || hasVolatile(c.defender.volatile, "encore")) {
      c.encoreSetFailed = true;
    } else {
      c.defender.volatile = inflictVolatile(c.defender.volatile, "encore", c.random, c.defender.lastMoveId);
      c.setEncoreMoveName = getMove(c.defender.lastMoveId)?.name;
      // 멘탈허브: 앙코르가 걸리는 순간 치료하고 소모된다.
      if (getMentalHerbCureResult(c.defenderItem, c.defender.itemConsumed ?? false)) {
        c.defender.volatile = { active: { ...c.defender.volatile.active } };
        delete c.defender.volatile.active.encore;
        consumeItem(c.defender);
        c.statusCureBerryItemName = c.defenderItem!.name;
        c.setEncoreMoveName = undefined;
      }
    }
  }

  // 파워트릭: 명중 시(항상 자기 자신 대상) 두 실수치를 그 자리에서 맞바꾼다. 킬가르도
  // 배틀스위치가 폼 전환 시 realStats를 직접 교체하는 것과 같은 패턴이라 재계산이 필요 없다.

  if (c.effectiveMove.swapsOwnStats) {
    const [statA, statB] = c.effectiveMove.swapsOwnStats;
    const valueA = c.attacker.realStats[statA];
    c.attacker.realStats = { ...c.attacker.realStats, [statA]: c.attacker.realStats[statB], [statB]: valueA };
    c.swappedStatsMoveName = c.effectiveMove.name;
  }

  // 가드스왑·파워스왑: 명중 시 지정된 스탯들의 랭크 변화를 자신과 상대가 서로 맞바꾼다.
  // 파워트릭(swapsOwnStats)과 달리 실수치는 그대로 두고 stages만 교환 — 이미 -6~+6 범위라
  // 교환해도 클램프가 필요 없다.

  if (c.effectiveMove.swapsStagesWithTarget) {
    const nextAttackerStages = { ...c.attacker.stages };
    const nextDefenderStages = { ...c.defender.stages };
    for (const stat of c.effectiveMove.swapsStagesWithTarget) {
      nextAttackerStages[stat] = c.defender.stages[stat];
      nextDefenderStages[stat] = c.attacker.stages[stat];
    }
    c.attacker.stages = nextAttackerStages;
    c.defender.stages = nextDefenderStages;
    c.swappedStagesMoveName = c.effectiveMove.name;
  }
}

/** 방어류 연속 사용, 필드·설치물 설치, 매직미러 구간 끝(바인딩 원위치) */
function protectAndFieldSetup(c: MirroredCtx) {

  // 방어류(방어/판별/버티기/킹실드): 연속 사용 횟수(protectStreak)에 따라 이번 턴 실제로 발동할
  // 확률이 (1/3)^streak로 줄어든다. 직전에 실패했거나 이력이 없으면(streak 0) 확률 1 = 무조건 발동.
  //
  // §1 G (2차 지시 반영): 굴림에 성공하면 무조건 "방어태세에 들어갔다!"(protectStanceEntered)를 낸다.
  // 그 뒤 상대가 이번 턴 낸 기술이 "이 포켓몬을 겨냥"했으면 실제로 막은 것 → "몸을 지켜냈다!"
  // (protectSucceeded), 자기 대상 기술(칼춤·철벽 등)이라 막을 게 없었으면 → "방어는 실패했다!"
  // (protectFailed). 굴림에 실패하면(연속 사용) 태세 진입 없이 바로 "방어는 실패했다!"만.
  // 버티기(endure)·길동무(destinyBond)는 별도 문구 축이라 protectStanceEntered에서 제외.
  c.protectSucceeded = false;
  c.protectFailed = false;
  c.protectStanceEntered = false;
  // 매직미러 반사 중이면(bounceActive) attacker/defender가 맞바뀐 상태라 이 방어류 블록을 통째로
  // 건너뛴다 — 되돌린 기술은 반사한 쪽(현재 attacker)의 방어 행동이 아니므로 protectStreak도
  // 건드리면 안 된다.
  if (c.effectiveMove.protectEffect && !c.bounceActive) {
    const streak = c.attacker.protectStreak ?? 0;
    const successChance = Math.pow(1 / 3, streak);
    const rollPassed = c.random() < successChance;
    // 패스트가드는 상대 기술이 자신을 겨냥했어도 priority가 0 이하면 애초에 막을 게 없다 —
    // "몸을 지켜냈다!"를 잘못 띄우지 않게 targetedSelf 판정에도 그 조건을 같이 건다.
    const targetedSelf =
      c.effectiveMove.protectEffect === "destinyBond"
        ? true
        : c.effectiveMove.protectEffect === "blockPriority"
          ? isOpponentTargetingMove(c.defenderMove) && c.defenderMove.priority > 0
          : isOpponentTargetingMove(c.defenderMove);
    if (!rollPassed) {
      // 연속 사용 굴림 실패 — 태세 진입도 없이 그대로 실패.
      c.attacker.protectStreak = 0;
      c.protectFailed = true;
    } else {
      c.attacker.protectStreak = streak + 1;
      c.protectStanceEntered =
        c.effectiveMove.protectEffect === "block" || c.effectiveMove.protectEffect === "blockPriority";
      // 길동무는 activeProtect(매 턴 시작 시 초기화)가 아니라 destinyBondArmed(자신의 다음
      // 행동 전까지 유지)로 별도 추적한다 — 이번 턴 상대 공격을 막는 게 아니기 때문.
      if (c.effectiveMove.protectEffect === "destinyBond") {
        c.attacker.destinyBondArmed = true;
        c.protectSucceeded = true;
      } else {
        c.attacker.activeProtect = {
          effect: c.effectiveMove.protectEffect,
          moveName: c.effectiveMove.name,
          contactPenalty: c.effectiveMove.protectContactPenalty,
          contactDamageFraction: c.effectiveMove.protectContactDamageFraction,
          contactStatus: c.effectiveMove.protectContactStatus,
        };
        // 태세엔 들어갔지만 상대가 자기 대상 기술만 냈으면 "막을 게 없어" 실패로 표기.
        if (targetedSelf) c.protectSucceeded = true;
        else c.protectFailed = true;
      }
    }
  } else if (!c.bounceActive) {
    c.attacker.protectStreak = 0;
  }

  // 필드 설치: 같은 필드가 이미 깔려있으면 실패한다(재설치 시 턴수가 갱신되던 버그 수정).
  // 날씨처럼 다른 종류의 필드가 깔려있으면 덮어쓴다 — 그래스필드 위에 일렉트릭필드를 깔면
  // 일렉트릭필드로 교체되는 게 본가 동작이다(ver.1.6, 같은 필드만 막던 과거 버그 재수정).
  c.fieldSetFailed = false;
  if (c.effectiveMove.setsField) {
    if (c.state.field === c.effectiveMove.setsField) {
      c.fieldSetFailed = true;
    } else {
      c.state.field = c.effectiveMove.setsField;
      // 그라운드코트: 필드를 깐 쪽이 이 도구를 지녔으면 지속시간이 늘어난다(기본 5턴 + 3 = 8턴).
      c.state.fieldTurnsRemaining = FIELD_DURATION + (c.attackerItem?.fieldDurationBonus ?? 0);
      c.terrainSeedMessages.push(...triggerTerrainSeeds(c.state));
    }
  }

  // 설치물(스텔스록·압정뿌리기·독압정·끈적끈적네트): 상대 진영에 설치한다(Phase 8 §6).
  // 스텔스록·끈적끈적네트는 1장 고정, 압정뿌리기는 최대 3층, 독압정은 최대 2층 스택.
  // 매직미러 반사 중이면 설치 대상 진영은 defenderKey가 아니라 원래 시전자 쪽(actorKey)이다.




  c.hazardSetFailed = false;
  if (c.effectiveMove.setsHazard !== undefined) {
    const hazardSide = c.bounceActive ? c.actorKey : c.defenderKey;
    const hz = sideOf(c.state, hazardSide).hazards;
    let didSet = false;
    switch (c.effectiveMove.setsHazard) {
      case "stealthRock":
        if (!hz.stealthRock) { hz.stealthRock = true; didSet = true; c.stealthRockSetForSide = hazardSide; }
        break;
      case "spikes":
        if (hz.spikesLayers < 3) { hz.spikesLayers += 1; didSet = true; c.spikesSetForSide = hazardSide; }
        break;
      case "toxicSpikes":
        if (hz.toxicSpikesLayers < 2) { hz.toxicSpikesLayers += 1; didSet = true; c.toxicSpikesSetForSide = hazardSide; }
        break;
      case "stickyWeb":
        if (!hz.stickyWeb) { hz.stickyWeb = true; didSet = true; c.stickyWebSetForSide = hazardSide; }
        break;
    }
    // 비검천중파·암석액스처럼 명중 부가효과로 까는 데미지기는 "이미 최대"여도 공격 자체는 성공이라
    // 실패 플래그를 세우지 않는다 — 변화기만 실패로 표시한다.
    if (!didSet && c.effectiveMove.category === "status") c.hazardSetFailed = true;
  }
}

/** 결과를 모아 돌려준다 */
function collectResult(c: MirroredCtx) {

  // ── 매직미러 반사 구간 끝 ── 바인딩을 원위치한다. 이후 로그·나무열매·매지션·폼 전환 등
  // 후처리는 전부 원래 공격/방어 방향 기준으로 돌아간다.
  if (c.bounceActive) {
    [c.attacker, c.defender] = [c.defender, c.attacker];
    [c.attackerAbility, c.defenderAbility] = [c.defenderAbility, c.attackerAbility];
    [c.attackerItem, c.defenderItem] = [c.defenderItem, c.attackerItem];
  }
  return {
    defenderAbility: c.defenderAbility, attacker: c.attacker, defender: c.defender, attackerAbility: c.attackerAbility, attackerItem: c.attackerItem, defenderItem: c.defenderItem, abilityInflictedStatusOnAttacker: c.abilityInflictedStatusOnAttacker, abilityInflictedStatusAbilityName: c.abilityInflictedStatusAbilityName, statusCureBerryItemName: c.statusCureBerryItemName, mentalMoveBlockedByAbilityName: c.mentalMoveBlockedByAbilityName, bouncedMoveName: c.bouncedMoveName, bouncedByAbilityName: c.bouncedByAbilityName, secondaryBlockedByAbilityName: c.secondaryBlockedByAbilityName, berryEatFailed: c.berryEatFailed, stuffCheeksBerryHeal: c.stuffCheeksBerryHeal, stuffCheeksBerryName: c.stuffCheeksBerryName, costHpFailed: c.costHpFailed, soulBeatHpCost: c.soulBeatHpCost, selfStatRises: c.selfStatRises, selfStatsAtMax: c.selfStatsAtMax, selfStatDrops: c.selfStatDrops, reflectedStatDropAbilityName: c.reflectedStatDropAbilityName, reflectedStatDrops: c.reflectedStatDrops, restoredStatsSelfItemName: c.restoredStatsSelfItemName, restoredStatsOpponentItemName: c.restoredStatsOpponentItemName, opportunistCopiedStats: c.opportunistCopiedStats, opportunistAbilityName: c.opportunistAbilityName, opponentStatDrops: c.opponentStatDrops, invertedTargetStages: c.invertedTargetStages, addedTypeToTarget: c.addedTypeToTarget, overwroteTargetType: c.overwroteTargetType, targetMoveTypeOverride: c.targetMoveTypeOverride, inflictedStatus: c.inflictedStatus, statusInflictFailed: c.statusInflictFailed, beakBlastBurnedAttacker: c.beakBlastBurnedAttacker, curedStatus: c.curedStatus, curedStatusTarget: c.curedStatusTarget, inflictedVolatile: c.inflictedVolatile, tidyUpDone: c.tidyUpDone, courtChangeDone: c.courtChangeDone, defogFieldCleared: c.defogFieldCleared, revivedPartyName: c.revivedPartyName, reviveFailed: c.reviveFailed, saltCureApplied: c.saltCureApplied, balloonPoppedItemName: c.balloonPoppedItemName, octolockApplied: c.octolockApplied, jawLockApplied: c.jawLockApplied, selfWokeBeforeMove: c.selfWokeBeforeMove, restSlept: c.restSlept, healedAmount: c.healedAmount, healedTarget: c.healedTarget, averagedDefensesMoveName: c.averagedDefensesMoveName, swappedSpeedMoveName: c.swappedSpeedMoveName, transformedIntoName: c.transformedIntoName, transformFailed: c.transformFailed, regenSetFailed: c.regenSetFailed, leechSeedSetFailed: c.leechSeedSetFailed, leechSeedBlockedByGrass: c.leechSeedBlockedByGrass, abilitySwappedTargetToName: c.abilitySwappedTargetToName, abilitySwapFailed: c.abilitySwapFailed, substituteSetFailed: c.substituteSetFailed, shedTailFailed: c.shedTailFailed, shedTailSucceeded: c.shedTailSucceeded, setDisabledMoveName: c.setDisabledMoveName, disableSetFailed: c.disableSetFailed, setEncoreMoveName: c.setEncoreMoveName, encoreSetFailed: c.encoreSetFailed, swappedStatsMoveName: c.swappedStatsMoveName, swappedStagesMoveName: c.swappedStagesMoveName, protectSucceeded: c.protectSucceeded, protectFailed: c.protectFailed, protectStanceEntered: c.protectStanceEntered, fieldSetFailed: c.fieldSetFailed, stealthRockSetForSide: c.stealthRockSetForSide, spikesSetForSide: c.spikesSetForSide, toxicSpikesSetForSide: c.toxicSpikesSetForSide, stickyWebSetForSide: c.stickyWebSetForSide, hazardSetFailed: c.hazardSetFailed, swappedItems: c.swappedItems, itemSwapFailed: c.itemSwapFailed, painSplitHp: c.painSplitHp, stockpileHealFailed: c.stockpileHealFailed, recycledItemName: c.recycledItemName, recycleFailed: c.recycleFailed, copiedStagesFromName: c.copiedStagesFromName, averagedAttacksMoveName: c.averagedAttacksMoveName, spitePp: c.spitePp, spiteFailed: c.spiteFailed, acupressureRaised: c.acupressureRaised, acupressureFailed: c.acupressureFailed, volatileBlockedByAbility: c.volatileBlockedByAbility, abilityChange: c.abilityChange, abilityChangeFailed: c.abilityChangeFailed, copiedTypes: c.copiedTypes, smackedDownTarget: c.smackedDownTarget, meltedItemName: c.meltedItemName, meltFailed: c.meltFailed, magneticFluxFailed: c.magneticFluxFailed, partyStatusCuredCount: c.partyStatusCuredCount, teaTime: c.teaTime, teaTimeFailed: c.teaTimeFailed,
  };
}

export function resolveMirroredMoveEffects(input: MirroredMoveEffectsInput) {
  const c = {} as MirroredCtx;

  c.move = input.move;
  c.effectiveMove = input.effectiveMove;
  c.opponentEffectsBlocked = input.opponentEffectsBlocked;
  c.random = input.random;
  c.state = input.state;
  c.hit = input.hit;
  c.movesSecond = input.movesSecond;
  c.defenderKey = input.defenderKey;
  c.damage = input.damage;
  c.hitSubstitute = input.hitSubstitute;
  c.defenderMove = input.defenderMove;
  c.actorKey = input.actorKey;
  c.defenderBerriesBlocked = input.defenderBerriesBlocked;
  c.attackerBerriesBlocked = input.attackerBerriesBlocked;
  c.blockedByProtect = input.blockedByProtect;
  c.sheerForceAbilityName = input.sheerForceAbilityName;
  c.isDamaging = input.isDamaging;
  c.selfCuredStatus = input.selfCuredStatus;
  c.terrainSeedMessages = input.terrainSeedMessages;
  c.defenderAbility = input.defenderAbility;
  c.attacker = input.attacker;
  c.defender = input.defender;
  c.attackerAbility = input.attackerAbility;
  c.attackerItem = input.attackerItem;
  c.defenderItem = input.defenderItem;
  c.abilityInflictedStatusOnAttacker = input.abilityInflictedStatusOnAttacker;
  c.abilityInflictedStatusAbilityName = input.abilityInflictedStatusAbilityName;
  c.statusCureBerryItemName = input.statusCureBerryItemName;
  c.mentalMoveBlockedByAbilityName = input.mentalMoveBlockedByAbilityName;
  let { bouncedByMagicMirror } = input;
  // ── 매직미러 반사 구간 시작 ──
  // 여기서부터 스텔스록 설치까지의 "방어측 방향" 효과 블록에 한해 공격/방어 바인딩을 맞바꾼다.
  // 되돌린 기술은 원래 시전자(이제 defender) 기준으로 상태이상 면역·조사·도구·승기까지 전부
  // 재평가된다. 블록이 끝나면 곧바로 원위치하며, 로그·후처리는 원래 방향 기준으로 돌아간다.
  // status 카테고리라 데미지 경로(resolveHit 등)는 이 지점 이전에 이미 no-op으로 끝나 있다.
  c.bounceActive = false;


  if (bouncedByMagicMirror) {
    c.bounceActive = true;
    c.bouncedMoveName = c.move.name;
    c.bouncedByAbilityName = c.defenderAbility!.name;
    [c.attacker, c.defender] = [c.defender, c.attacker];
    [c.attackerAbility, c.defenderAbility] = [c.defenderAbility, c.attackerAbility];
    [c.attackerItem, c.defenderItem] = [c.defenderItem, c.attackerItem];
  }

  // 인분(Shield Dust): 방어측이 이 특성이면, 데미지 기술이 방어측에게 딸려 거는 추가효과
  // (상태이상·행동방해·랭크변화 — chance 유무 무관)를 전부 무산시킨다. 변화기 주효과와 자기 대상
  // 효과는 대상이 아니다. hasSheerForceSecondaryEffect(우격다짐)와 같은 "추가효과" 정의를 공유.
  c.secondaryEffectsBlockedByAbility = c.effectiveMove.category !== "status" && !!c.defenderAbility?.blocksSecondaryEffects;

  eatBerriesAndPayHp(c);
  applyStatChanges(c);
  blockAndReflectStatDrops(c);
  opportunistAndAccuracyChanges(c);
  resetAndTypeChanges(c);
  inflictStatuses(c);
  statusCureAndVolatile(c);
  hazardsAndSideEffects(c);
  bindingAndFlinch(c);
  healAndThaw(c);
  statSwapEffects(c);
  miscMoveEffects(c);
  abilitySwapAndSubstitute(c);
  protectAndFieldSetup(c);
  return collectResult(c);
}

