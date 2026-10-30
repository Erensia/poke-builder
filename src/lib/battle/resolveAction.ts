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
import { GRAVITY_DURATION, MAGIC_ROOM_DURATION, MAGNET_RISE_DURATION, SCREEN_DURATION, TAILWIND_DURATION, TRICK_ROOM_DURATION, WONDER_ROOM_DURATION, WEATHER_DURATION, activeWeather, applyForecastForm, consumeItem, contraryDelta, hasLivingReserve, isFainted, isForcedSwitchBlocked, sideOf, type BattleState } from "./state";
import { isTrappedFromSwitching } from "./switching";
import { resolvePreHitEffects } from "./preHitEffects";
import { resolveHitAndApplyDamage } from "./hitResolution";
import { resolveMirroredMoveEffects } from "./mirroredEffects";
import { type Ability } from "@/types/ability";
import { type AccuracyEvasionKey, type BattleStatKey } from "@/types/battleStats";
import { type BattleFighterState } from "@/lib/battle/state";
import { type FlingEffectResult, type HitAbilityEvent } from "@/types/battle";
import { type Item } from "@/types/item";
import { type StatusCondition, type VolatileCondition } from "@/types/status";
import { type WeatherKind } from "@/types/weather";
import { type eatBerryNow } from "@/lib/battle/fling";

/** resolveAction의 단계 사이에서 공유되는 값 — 한 단계 안에서만 쓰는 변수는 각 단계 함수의 지역 변수다 */
interface ActionCtx {
  state: BattleState;
  actorKey: FighterKey;
  move: Move;
  random: () => number;
  movesSecond: boolean;
  defenderMove: Move;
  pre: Extract<ReturnType<typeof resolvePreHitEffects>, { chargeStatRises: unknown }>;
  defenderKey: FighterKey;
  attacker: BattleFighterState;
  defender: BattleFighterState;
  defenderHpAtActionStart: number;
  actorPokemonId: string;
  defenderPokemonId: string;
  attackerAbility: Ability | undefined;
  defenderAbility: Ability | undefined;
  attackerBerriesBlocked: boolean;
  defenderBerriesBlocked: boolean;
  attackerItemIdBeforeAction: string | null;
  defenderItemIdBeforeAction: string | null;
  leppaRestoredPpItemName: string | undefined;
  pressureExtraPpAbilityName: string | undefined;
  selfCuredStatus: StatusCondition | null | undefined;
  sleepTalkCalledMoveName: string | undefined;
  copycatCalledMoveName: string | undefined;
  ohkoBlockedByAbilityName: string | undefined;
  ohkoImmune: boolean;
  flungItemId: string | undefined;
  attackerItem: Item | undefined;
  defenderItem: Item | undefined;
  blockedByGoodAsGold: boolean;
  blockedBySubstitute: boolean;
  blockedByPowderImmunity: boolean;
  blockedByProtect: boolean;
  blockedByProtectMoveName: string | undefined;
  soundproofBlockedByAbilityName: string | undefined;
  bulletproofBlockedByAbilityName: string | undefined;
  opponentEffectsBlocked: boolean;
  bouncedByMagicMirror: boolean;
  shellSideArmCategory: "physical" | "special" | undefined;
  typeEffectiveness: number;
  effectiveMove: Move;
  sheerForceAbilityName: string | undefined;
  fickleBeamEmpowered: boolean;
  electromorphosisEmpoweredAbilityName: string | undefined;
  changedOwnTypeTo: "노말" | "불꽃" | "물" | "풀" | "전기" | "얼음" | "격투" | "독" | "땅" | "비행" | "에스퍼" | "벌레" | "바위" | "고스트" | "드래곤" | "악" | "강철" | "페어리" | undefined;
  changedOwnTypeAbilityName: string | undefined;
  lostTypeAfterUse: "노말" | "불꽃" | "물" | "풀" | "전기" | "얼음" | "격투" | "독" | "땅" | "비행" | "에스퍼" | "벌레" | "바위" | "고스트" | "드래곤" | "악" | "강철" | "페어리" | undefined;
  ateGemItemName: string | undefined;
  hit: boolean;
  selfDamageOnUse: number;
  abilityAbsorbedMoveType: "노말" | "불꽃" | "물" | "풀" | "전기" | "얼음" | "격투" | "독" | "땅" | "비행" | "에스퍼" | "벌레" | "바위" | "고스트" | "드래곤" | "악" | "강철" | "페어리" | undefined;
  abilityAbsorbAbilityName: string | undefined;
  abilityAbsorbHealAmount: number;
  protectContactPenaltyMoveName: string | undefined;
  protectContactDamage: number;
  protectContactInflictedStatus: StatusCondition | null | undefined;
  abilityDamageAbilityName: string | undefined;
  abilityDamageToAttacker: number;
  abilityDisableAbilityName: string | undefined;
  abilityDisabledMoveName: string | undefined;
  abilityInflictedStatusAbilityName: string | undefined;
  abilityInflictedStatusOnAttacker: StatusCondition | null | undefined;
  abilityInflictedVolatileAbilityName: string | undefined;
  abilityInflictedVolatileOnAttacker: VolatileCondition | undefined;
  abilityLoweredAttackerStats: { stat: BattleStatKey; delta: number; }[];
  abilityLoweredAttackerStatsAbilityName: string | undefined;
  abilityLoweredDefenderStats: { stat: BattleStatKey; delta: number; }[];
  abilityRaisedDefenderStats: { stat: BattleStatKey; delta: number; }[];
  abilityRaisedDefenderStatsAbilityName: string | undefined;
  angerPointAbilityName: string | undefined;
  angerPointMaxedAbilityName: string | undefined;
  angerPointRaisedSpa: boolean;
  berryReducedDamageItemName: string | undefined;
  canceledTargetChargeMoveName: string | undefined;
  cheekPouchHeal: number;
  counterDamage: number;
  counterFailed: boolean;
  crashDamage: number;
  damage: number;
  damagePercent: number;
  destinyBondTriggered: boolean;
  disguiseRecoilDamage: number | undefined;
  drainHealAmount: number;
  endeavorDamage: number;
  enduredAbilityName: string | undefined;
  enduredItemName: string | undefined;
  enduredProtectMoveName: string | undefined;
  followUpHitDamage: number;
  hitCount: number | undefined;
  hitNegatedByAbilityName: string | undefined;
  hitSubstitute: boolean;
  illusionBrokenSpeciesId: string | undefined;
  isCritical: boolean;
  isDamaging: boolean;
  itemRecoilDamage: number;
  itemRecoilItemName: string | undefined;
  liquidOozeAbilityName: string | undefined;
  liquidOozeDamage: number;
  mummifiedAttackerAbilityName: string | undefined;
  perHitLog: { damage: number; damagePercent: number; critical: boolean; abilityEvent?: HitAbilityEvent; }[] | undefined;
  pickpocketAbilityName: string | undefined;
  pickpocketStolenItemName: string | undefined;
  recoilDamage: number;
  rockyHelmetDamage: number;
  rockyHelmetItemName: string | undefined;
  sandSpitWeather: WeatherKind | undefined;
  seedSowerField: FieldKind | undefined;
  selfDamage: number;
  shellBellHealAmount: number;
  statusCureBerryItemName: string | undefined;
  stolenItemName: string | undefined;
  substituteBroke: boolean;
  terrainSeedMessages: string[];
  toxicDebrisAbilityName: string | undefined;
  wanderingSpiritSwapped: boolean;
  mentalMoveBlockedByAbilityName: string | undefined;
  bouncedMoveName: string | undefined;
  bouncedByAbilityName: string | undefined;
  secondaryBlockedByAbilityName: string | undefined;
  berryEatFailed: boolean;
  stuffCheeksBerryHeal: number;
  stuffCheeksBerryName: string | undefined;
  costHpFailed: boolean;
  soulBeatHpCost: number;
  selfStatRises: { stat: BattleStatKey | AccuracyEvasionKey; delta: number; }[];
  selfStatsAtMax: BattleStatKey[];
  selfStatDrops: { stat: BattleStatKey | AccuracyEvasionKey; delta: number; }[];
  reflectedStatDropAbilityName: string | undefined;
  reflectedStatDrops: { stat: BattleStatKey; delta: number; }[];
  restoredStatsSelfItemName: string | undefined;
  restoredStatsOpponentItemName: string | undefined;
  opportunistCopiedStats: { stat: BattleStatKey; delta: number; }[] | undefined;
  opportunistAbilityName: string | undefined;
  opponentStatDrops: { stat: BattleStatKey | AccuracyEvasionKey; delta: number; }[];
  invertedTargetStages: boolean;
  addedTypeToTarget: "노말" | "불꽃" | "물" | "풀" | "전기" | "얼음" | "격투" | "독" | "땅" | "비행" | "에스퍼" | "벌레" | "바위" | "고스트" | "드래곤" | "악" | "강철" | "페어리" | undefined;
  overwroteTargetType: "노말" | "불꽃" | "물" | "풀" | "전기" | "얼음" | "격투" | "독" | "땅" | "비행" | "에스퍼" | "벌레" | "바위" | "고스트" | "드래곤" | "악" | "강철" | "페어리" | undefined;
  targetMoveTypeOverride: "노말" | "불꽃" | "물" | "풀" | "전기" | "얼음" | "격투" | "독" | "땅" | "비행" | "에스퍼" | "벌레" | "바위" | "고스트" | "드래곤" | "악" | "강철" | "페어리" | undefined;
  inflictedStatus: StatusCondition | null | undefined;
  statusInflictFailed: boolean;
  beakBlastBurnedAttacker: boolean;
  curedStatus: StatusCondition | null | undefined;
  curedStatusTarget: "self" | "opponent" | undefined;
  inflictedVolatile: VolatileCondition | undefined;
  tidyUpDone: boolean;
  courtChangeDone: boolean;
  defogFieldCleared: boolean;
  revivedPartyName: string | undefined;
  reviveFailed: boolean;
  saltCureApplied: boolean;
  balloonPoppedItemName: string | undefined;
  octolockApplied: boolean;
  jawLockApplied: boolean;
  selfWokeBeforeMove: StatusCondition | null | undefined;
  restSlept: boolean;
  healedAmount: number;
  healedTarget: "self" | "opponent" | undefined;
  averagedDefensesMoveName: string | undefined;
  swappedSpeedMoveName: string | undefined;
  transformedIntoName: string | undefined;
  transformFailed: boolean;
  regenSetFailed: boolean;
  leechSeedSetFailed: boolean;
  leechSeedBlockedByGrass: boolean;
  curseHpCost: number;
  curseSetFailed: boolean;
  abilitySwappedTargetToName: string | undefined;
  abilitySwapFailed: boolean;
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
  swappedItems: { userGotName?: string; targetGotName?: string; } | undefined;
  itemSwapFailed: boolean;
  painSplitHp: number | undefined;
  stockpileHealFailed: boolean;
  recycledItemName: string | undefined;
  recycleFailed: boolean;
  copiedStagesFromName: string | undefined;
  averagedAttacksMoveName: string | undefined;
  spitePp: { moveName: string; amount: number; } | undefined;
  spiteFailed: boolean;
  acupressureRaised: { stat: BattleStatKey | AccuracyEvasionKey; delta: number; } | undefined;
  acupressureFailed: boolean;
  volatileBlockedByAbility: { abilityName: string; volatile: VolatileCondition; self: boolean; } | undefined;
  abilityChange: { kind: "swap" | "give" | "copy" | "suppress"; abilityName?: string; } | undefined;
  abilityChangeFailed: boolean;
  copiedTypes: ("노말" | "불꽃" | "물" | "풀" | "전기" | "얼음" | "격투" | "독" | "땅" | "비행" | "에스퍼" | "벌레" | "바위" | "고스트" | "드래곤" | "악" | "강철" | "페어리")[] | undefined;
  smackedDownTarget: boolean;
  meltedItemName: string | undefined;
  meltFailed: boolean;
  magneticFluxFailed: boolean;
  partyStatusCuredCount: number;
  teaTime: { self?: ReturnType<typeof eatBerryNow>; opponent?: ReturnType<typeof eatBerryNow>; } | undefined;
  teaTimeFailed: boolean;
  flungItem: Item | undefined;
  flingEffect: FlingEffectResult | undefined;
  perishSongStarted: boolean;
  perishSongFailed: boolean;
  destroyedField: FieldKind | undefined;
  trickRoomSetFailed: false;
  trickRoomEnded: boolean;
  roomChange: { room: "wonderRoom" | "magicRoom"; on: boolean } | undefined;
  gravitySet: boolean;
  gravitySetFailed: boolean;
  fairyLockSet: boolean;
  fairyLockFailed: boolean;
  healingWishSet: boolean;
  healingWishFailed: boolean;
  magnetRiseSet: boolean;
  magnetRiseFailed: boolean;
  weatherSetFailed: boolean;
  screenSetFailed: boolean;
  safeguardSetFailed: boolean;
  tailwindSetFailed: boolean;
  tailwindSet: boolean;
  attackerBerryHealAmount: number;
  attackerBerryHealItemName: string | undefined;
  defenderBerryHealAmount: number;
  defenderBerryHealItemName: string | undefined;
  brokeScreens: ("reflect" | "lightScreen" | "auroraVeil")[] | undefined;
  unburdenSelfAbilityName: string | undefined;
  unburdenOpponentAbilityName: string | undefined;
  blockedBySubstituteMoveName: string | undefined;
  powderBlockedMoveName: string | undefined;
  origDefenderAbility: Ability | undefined;
  triggersDefenderEmergencyExit: boolean;
}

/** 반사·열매·랭크·상태이상 등 이어지는 효과(mirroredEffects)를 풀고 던진 도구 효과 처리 */
function resolveMirroredPhase(c: ActionCtx) {

  const mirrorResult = resolveMirroredMoveEffects({
    bouncedByMagicMirror: c.bouncedByMagicMirror, move: c.move, effectiveMove: c.effectiveMove, opponentEffectsBlocked: c.opponentEffectsBlocked, random: c.random, state: c.state, hit: c.hit, movesSecond: c.movesSecond, defenderKey: c.defenderKey, damage: c.damage, hitSubstitute: c.hitSubstitute, defenderMove: c.defenderMove, actorKey: c.actorKey, defenderBerriesBlocked: c.defenderBerriesBlocked, attackerBerriesBlocked: c.attackerBerriesBlocked, blockedByProtect: c.blockedByProtect, sheerForceAbilityName: c.sheerForceAbilityName, isDamaging: c.isDamaging, selfCuredStatus: c.selfCuredStatus, terrainSeedMessages: c.terrainSeedMessages, defenderAbility: c.defenderAbility, attacker: c.attacker, defender: c.defender, attackerAbility: c.attackerAbility, attackerItem: c.attackerItem, defenderItem: c.defenderItem, abilityInflictedStatusOnAttacker: c.abilityInflictedStatusOnAttacker, abilityInflictedStatusAbilityName: c.abilityInflictedStatusAbilityName, statusCureBerryItemName: c.statusCureBerryItemName, mentalMoveBlockedByAbilityName: c.mentalMoveBlockedByAbilityName,
  });
  c.bouncedMoveName = mirrorResult.bouncedMoveName;
  c.bouncedByAbilityName = mirrorResult.bouncedByAbilityName;
  c.secondaryBlockedByAbilityName = mirrorResult.secondaryBlockedByAbilityName;
  c.berryEatFailed = mirrorResult.berryEatFailed;
  c.stuffCheeksBerryHeal = mirrorResult.stuffCheeksBerryHeal;
  c.stuffCheeksBerryName = mirrorResult.stuffCheeksBerryName;
  c.costHpFailed = mirrorResult.costHpFailed;
  c.soulBeatHpCost = mirrorResult.soulBeatHpCost;
  c.selfStatRises = mirrorResult.selfStatRises;
  c.selfStatsAtMax = mirrorResult.selfStatsAtMax;
  c.selfStatDrops = mirrorResult.selfStatDrops;
  c.reflectedStatDropAbilityName = mirrorResult.reflectedStatDropAbilityName;
  c.reflectedStatDrops = mirrorResult.reflectedStatDrops;
  c.restoredStatsSelfItemName = mirrorResult.restoredStatsSelfItemName;
  c.restoredStatsOpponentItemName = mirrorResult.restoredStatsOpponentItemName;
  c.opportunistCopiedStats = mirrorResult.opportunistCopiedStats;
  c.opportunistAbilityName = mirrorResult.opportunistAbilityName;
  c.opponentStatDrops = mirrorResult.opponentStatDrops;
  c.invertedTargetStages = mirrorResult.invertedTargetStages;
  c.addedTypeToTarget = mirrorResult.addedTypeToTarget;
  c.overwroteTargetType = mirrorResult.overwroteTargetType;
  c.targetMoveTypeOverride = mirrorResult.targetMoveTypeOverride;
  c.inflictedStatus = mirrorResult.inflictedStatus;
  c.statusInflictFailed = mirrorResult.statusInflictFailed;
  c.beakBlastBurnedAttacker = mirrorResult.beakBlastBurnedAttacker;
  c.curedStatus = mirrorResult.curedStatus;
  c.curedStatusTarget = mirrorResult.curedStatusTarget;
  c.inflictedVolatile = mirrorResult.inflictedVolatile;
  c.tidyUpDone = mirrorResult.tidyUpDone;
  c.courtChangeDone = mirrorResult.courtChangeDone;
  c.defogFieldCleared = mirrorResult.defogFieldCleared;
  c.revivedPartyName = mirrorResult.revivedPartyName;
  c.reviveFailed = mirrorResult.reviveFailed;
  c.saltCureApplied = mirrorResult.saltCureApplied;
  c.balloonPoppedItemName = mirrorResult.balloonPoppedItemName;
  c.octolockApplied = mirrorResult.octolockApplied;
  c.jawLockApplied = mirrorResult.jawLockApplied;
  c.selfWokeBeforeMove = mirrorResult.selfWokeBeforeMove;
  c.restSlept = mirrorResult.restSlept;
  c.healedAmount = mirrorResult.healedAmount;
  c.healedTarget = mirrorResult.healedTarget;
  c.averagedDefensesMoveName = mirrorResult.averagedDefensesMoveName;
  c.swappedSpeedMoveName = mirrorResult.swappedSpeedMoveName;
  c.transformedIntoName = mirrorResult.transformedIntoName;
  c.transformFailed = mirrorResult.transformFailed;
  c.regenSetFailed = mirrorResult.regenSetFailed;
  c.leechSeedSetFailed = mirrorResult.leechSeedSetFailed;
  c.leechSeedBlockedByGrass = mirrorResult.leechSeedBlockedByGrass;
  c.curseHpCost = mirrorResult.curseHpCost;
  c.curseSetFailed = mirrorResult.curseSetFailed;
  c.abilitySwappedTargetToName = mirrorResult.abilitySwappedTargetToName;
  c.abilitySwapFailed = mirrorResult.abilitySwapFailed;
  c.substituteSetFailed = mirrorResult.substituteSetFailed;
  c.shedTailFailed = mirrorResult.shedTailFailed;
  c.shedTailSucceeded = mirrorResult.shedTailSucceeded;
  c.setDisabledMoveName = mirrorResult.setDisabledMoveName;
  c.disableSetFailed = mirrorResult.disableSetFailed;
  c.setEncoreMoveName = mirrorResult.setEncoreMoveName;
  c.encoreSetFailed = mirrorResult.encoreSetFailed;
  c.swappedStatsMoveName = mirrorResult.swappedStatsMoveName;
  c.swappedStagesMoveName = mirrorResult.swappedStagesMoveName;
  c.protectSucceeded = mirrorResult.protectSucceeded;
  c.protectFailed = mirrorResult.protectFailed;
  c.protectStanceEntered = mirrorResult.protectStanceEntered;
  c.fieldSetFailed = mirrorResult.fieldSetFailed;
  c.stealthRockSetForSide = mirrorResult.stealthRockSetForSide;
  c.spikesSetForSide = mirrorResult.spikesSetForSide;
  c.toxicSpikesSetForSide = mirrorResult.toxicSpikesSetForSide;
  c.stickyWebSetForSide = mirrorResult.stickyWebSetForSide;
  c.hazardSetFailed = mirrorResult.hazardSetFailed;
  c.swappedItems = mirrorResult.swappedItems;
  c.itemSwapFailed = mirrorResult.itemSwapFailed;
  c.painSplitHp = mirrorResult.painSplitHp;
  c.stockpileHealFailed = mirrorResult.stockpileHealFailed;
  c.recycledItemName = mirrorResult.recycledItemName;
  c.recycleFailed = mirrorResult.recycleFailed;
  c.copiedStagesFromName = mirrorResult.copiedStagesFromName;
  c.averagedAttacksMoveName = mirrorResult.averagedAttacksMoveName;
  c.spitePp = mirrorResult.spitePp;
  c.spiteFailed = mirrorResult.spiteFailed;
  c.acupressureRaised = mirrorResult.acupressureRaised;
  c.acupressureFailed = mirrorResult.acupressureFailed;
  c.volatileBlockedByAbility = mirrorResult.volatileBlockedByAbility;
  c.abilityChange = mirrorResult.abilityChange;
  c.abilityChangeFailed = mirrorResult.abilityChangeFailed;
  c.copiedTypes = mirrorResult.copiedTypes;
  c.smackedDownTarget = mirrorResult.smackedDownTarget;
  c.meltedItemName = mirrorResult.meltedItemName;
  c.meltFailed = mirrorResult.meltFailed;
  c.magneticFluxFailed = mirrorResult.magneticFluxFailed;
  c.partyStatusCuredCount = mirrorResult.partyStatusCuredCount;
  c.teaTime = mirrorResult.teaTime;
  c.teaTimeFailed = mirrorResult.teaTimeFailed;
  ({ defenderAbility: c.defenderAbility, attacker: c.attacker, defender: c.defender, attackerAbility: c.attackerAbility, attackerItem: c.attackerItem, defenderItem: c.defenderItem, abilityInflictedStatusOnAttacker: c.abilityInflictedStatusOnAttacker, abilityInflictedStatusAbilityName: c.abilityInflictedStatusAbilityName, statusCureBerryItemName: c.statusCureBerryItemName, mentalMoveBlockedByAbilityName: c.mentalMoveBlockedByAbilityName } = mirrorResult);

  // 내던지기(트랙 M5): 던진 도구의 효과를 맞은 상대에게 — 데미지를 주고 대타가 아니며 상대가 버텼을 때만
  c.flungItem = c.flungItemId ? getItem(c.flungItemId) : undefined;
  c.flingEffect = c.flungItem && c.hit && c.damage > 0 && !c.hitSubstitute && !isFainted(c.defender)
      ? applyFlingEffect(c.state, c.actorKey, c.defender, c.defenderAbility, c.flungItem, !c.movesSecond)
      : undefined;
}

/** 멸망의노래·아이언롤러·트릭룸·원더룸·중력·페어리록·치유소원·전자부유 */
function applyFieldMoves(c: ActionCtx) {

  // 멸망의노래(setsPerishSong, F-4): 장에 있는 양쪽에게 멸망 카운트 3을 건다. 방어·대타·황금몸을
  // 무시하므로 opponentEffectsBlocked로 게이팅하지 않는다. 방음(blocksSound) 특성이나 발동 시점에
  // 차징(공중날기·구멍파기 등)으로 다른 장소 취급인 포켓몬에겐 카운트가 시작되지 않는다.
  // 양쪽 다 이미 카운트 중이면 재사용 실패.
  c.perishSongStarted = false;
  c.perishSongFailed = false;
  if (c.effectiveMove.setsPerishSong) {
    const attackerEligible = c.attacker.perishCount === undefined && !c.attackerAbility?.blocksSound;
    const defenderEligible =
      c.defender.perishCount === undefined && !c.defenderAbility?.blocksSound && c.defender.chargingMoveId === undefined;
    if (!attackerEligible && !defenderEligible) {
      c.perishSongFailed = true;
    } else {
      if (attackerEligible) c.attacker.perishCount = 3;
      if (defenderEligible) c.defender.perishCount = 3;
      c.perishSongStarted = true;
    }
  }

  // 아이언롤러: 명중하면 활성 필드를 제거한다. usageCondition: "field-required"로 필드가 없으면
  // 애초에 이 지점까지 오지 못하니(맨 위에서 이미 실패 처리), 여기선 있는 필드를 지우기만 하면 된다.

  if (c.effectiveMove.destroysField && c.state.field) {
    c.destroyedField = c.state.field;
    c.state.field = undefined;
    c.state.fieldTurnsRemaining = undefined;
  }

  // 트릭룸: 이미 걸려 있으면 다시 쓸 때 해제된다(본가 — 트랙 M4에서 "재사용 실패"였던 규칙을 사용자 결정으로 변경).
  c.trickRoomSetFailed = false;
  c.trickRoomEnded = false;
  if (c.effectiveMove.setsTrickRoom) {
    if (c.state.trickRoomTurnsRemaining !== undefined) {
      c.state.trickRoomTurnsRemaining = undefined;
      c.trickRoomEnded = true;
    } else {
      c.state.trickRoomTurnsRemaining = TRICK_ROOM_DURATION;
    }
  }

  // 원더룸·매직룸(트랙 M4): 트릭룸과 같은 규칙 — 5턴, 다시 쓰면 해제.

  if (c.effectiveMove.setsRoom === "wonderRoom") {
    const on = c.state.wonderRoomTurnsRemaining === undefined;
    c.state.wonderRoomTurnsRemaining = on ? WONDER_ROOM_DURATION : undefined;
    c.roomChange = { room: "wonderRoom", on };
  } else if (c.effectiveMove.setsRoom === "magicRoom") {
    const on = c.state.magicRoomTurnsRemaining === undefined;
    c.state.magicRoomTurnsRemaining = on ? MAGIC_ROOM_DURATION : undefined;
    c.roomChange = { room: "magicRoom", on };
  }

  // 중력(트랙 M4): 5턴, 이미 있으면 실패. 걸리는 순간 공중에 있던 포켓몬이 떨어진다 — 공중날기·뛰어오르기 모으기가
  // 풀리고 전자부유가 끝난다.
  c.gravitySet = false;
  c.gravitySetFailed = false;
  if (c.effectiveMove.setsGravity) {
    if (c.state.gravityTurnsRemaining !== undefined) {
      c.gravitySetFailed = true;
    } else {
      c.state.gravityTurnsRemaining = GRAVITY_DURATION;
      c.gravitySet = true;
      for (const f of [c.state.a, c.state.b]) {
        f.magnetRiseTurnsRemaining = undefined;
        if (f.chargingMoveId && getMove(f.chargingMoveId)?.chargeHideType === "sky") f.chargingMoveId = undefined;
      }
    }
  }

  // 페어리록(트랙 M6): 다음 턴 양쪽 모두 교체 불가(2로 걸어 이번 턴 끝에 1 — 그 턴이 봉쇄 턴). 이미 걸려 있으면 실패.
  c.fairyLockSet = false;
  c.fairyLockFailed = false;
  if (c.effectiveMove.setsFairyLock) {
    if (c.state.fairyLockTurnsRemaining !== undefined) {
      c.fairyLockFailed = true;
    } else {
      c.state.fairyLockTurnsRemaining = 2;
      c.fairyLockSet = true;
    }
  }

  // 치유소원(트랙 M6): 교대할 포켓몬이 있으면 자신은 기절하고, 다음에 이 편에 나오는 포켓몬이 전부 회복(switching)
  c.healingWishSet = false;
  c.healingWishFailed = false;
  if (c.effectiveMove.setsHealingWish) {
    const mySide = sideOf(c.state, c.actorKey);
    if (!hasLivingReserve(mySide)) {
      c.healingWishFailed = true;
    } else {
      mySide.healingWishPending = true;
      c.attacker.currentHp = 0;
      c.healingWishSet = true;
    }
  }

  // 전자부유(트랙 M4): 5턴 동안 떠오른다. 중력·떨어뜨리기·검은철구(땅에 붙잡힘)·이미 떠 있으면 실패.
  c.magnetRiseSet = false;
  c.magnetRiseFailed = false;
  if (c.effectiveMove.setsMagnetRise) {
    if (
      c.state.gravityTurnsRemaining !== undefined ||
      c.attacker.smackedDown ||
      effectiveHeldItem(c.attacker, c.state)?.groundsHolder ||
      (c.attacker.magnetRiseTurnsRemaining ?? 0) > 0
    ) {
      c.magnetRiseFailed = true;
    } else {
      c.attacker.magnetRiseTurnsRemaining = MAGNET_RISE_DURATION;
      c.magnetRiseSet = true;
    }
  }
}

/** 날씨 변화 기술과 리플렉터·신비의부적·순풍 같은 편 단위 설치 */
function applyWeatherAndSideMoves(c: ActionCtx) {

  // 날씨 변화 기술(비바라기 등): 다른 날씨는 덮어쓰지만, 이미 같은 날씨면 실패한다 — 남은 턴도
  // 다시 채우지 않는다(본가 규칙, 사용자 확인 — 필드/트릭룸과 같은 규칙). 날씨부정으로 효과가 꺼져
  // 있어도 날씨 자체는 있으므로 state.weather(원래 값)로 비교한다. 지속시간은 특성/수동 선택으로
  // 걸렸을 때와 마찬가지로 WEATHER_DURATION(+바위 보너스).
  c.weatherSetFailed = false;
  if (c.effectiveMove.setsWeather && c.state.weather === c.effectiveMove.setsWeather) {
    c.weatherSetFailed = true;
  } else if (c.effectiveMove.setsWeather) {
    c.state.weather = c.effectiveMove.setsWeather;
    const rockBonus =
      c.attackerItem?.weatherDurationBonus?.weather === c.effectiveMove.setsWeather
        ? c.attackerItem.weatherDurationBonus.bonus
        : 0;
    c.state.weatherTurnsRemaining = WEATHER_DURATION + rockBonus;
    // 기분파(캐스퐁): 날씨가 바뀌면 그 자리에서 타입을 다시 맞춘다.
    applyForecastForm(c.state.a, activeWeather(c.state));
    applyForecastForm(c.state.b, activeWeather(c.state));
  }

  // 리플렉터/빛의장막/오로라베일: 자기 편(side)에 이미 같은 스크린이 걸려있으면 실패(필드/트릭룸과
  // 같은 패턴). 빛의점토를 지녔으면 지속시간이 늘어난다. 스크린은 사용자 자신을 겨냥하는 기술이라
  // 매직미러 반사 대상이 아니다 — actorKey가 곧 사용자 편(§6-3).
  c.screenSetFailed = false;
  if (c.effectiveMove.setsScreen) {
    const attackerScreens = sideOf(c.state, c.actorKey).screens;
    if (attackerScreens[c.effectiveMove.setsScreen] !== undefined) {
      c.screenSetFailed = true;
    } else {
      const screenBonus = c.attackerItem?.screenDurationBonus ?? 0;
      sideOf(c.state, c.actorKey).screens = {
        ...attackerScreens,
        [c.effectiveMove.setsScreen]: SCREEN_DURATION + screenBonus,
      };
    }
  }

  // 신비의부적(세이프가드): 스크린과 같은 패턴 — 자기 편에 이미 걸려있으면 실패, 사용자 자신
  // 겨냥이라 매직미러 반사 대상이 아니다. 빛의점토는 스크린 전용(본가 규칙)이라 지속시간 보너스 없음.
  c.safeguardSetFailed = false;
  if (c.effectiveMove.setsSafeguard) {
    const attackerSide = sideOf(c.state, c.actorKey);
    if (attackerSide.safeguardTurnsRemaining !== undefined) {
      c.safeguardSetFailed = true;
    } else {
      attackerSide.safeguardTurnsRemaining = SCREEN_DURATION;
    }
  }

  // 순풍(트랙 M1): 신비의부적과 같은 편 단위 — 이미 불고 있으면 실패. 쓴 턴 포함 4턴.
  c.tailwindSetFailed = false;
  c.tailwindSet = false;
  if (c.effectiveMove.setsTailwind) {
    const attackerSide = sideOf(c.state, c.actorKey);
    if ((attackerSide.tailwindTurnsRemaining ?? 0) > 0) {
      c.tailwindSetFailed = true;
    } else {
      attackerSide.tailwindTurnsRemaining = TAILWIND_DURATION;
      c.tailwindSet = true;
    }
  }
}

/** 자뭉열매·오랭열매 — 행동으로 생긴 모든 HP 변화가 끝난 뒤의 자동 발동(위기회피와의 상호작용 포함) */
function triggerBerryHeals(c: ActionCtx) {

  // 자뭉열매/오랭열매: 이번 행동으로 생긴 모든 HP 변화(피격/반동/회복 등)가 끝난 뒤, 체력이 최대
  // HP 1/2 이하인 쪽(공격자든 방어자든)이 있으면 자동 발동한다. attacker를 먼저 확인하는 순서는
  // 임의지만, 도구는 각자 한 개씩만 지니므로 서로 간섭하지 않는다.
  c.attackerBerryHealAmount = 0;

  if (!isFainted(c.attacker) && !c.attackerBerriesBlocked) {
    c.attackerBerryHealAmount = getHpThresholdBerryHeal(
      c.attackerItem,
      c.attacker.currentHp,
      c.attacker.maxHp,
      c.attacker.itemConsumed ?? false,
      !!c.attackerAbility?.doublesBerryEffect, // 숙성
    );
    if (c.attackerBerryHealAmount > 0) {
      c.attacker.currentHp = Math.min(c.attacker.maxHp, c.attacker.currentHp + c.attackerBerryHealAmount);
      consumeItem(c.attacker);
      c.attackerBerryHealItemName = c.attackerItem!.name;
    }
  }
  // 위기회피가 실제로 발동할 피격(절반 초과→이하, 나갈 예비 있음·봉인 아님)이면 HP 회복 열매는
  // 먹지 않는다(포챔스 확인) — 열매는 그대로 남고 포켓몬은 물러난다. 나갈 수 없으면 열매가 정상 발동.
  const origDefender0 = c.state[c.defenderKey];
  const defenderExitsAtHalf =
    c.defender === origDefender0 &&
    !!c.defenderAbility?.exitsFieldAtHalfHp &&
    c.defenderHpAtActionStart * 2 > c.defender.maxHp &&
    c.defender.currentHp > 0 &&
    c.defender.currentHp * 2 <= c.defender.maxHp &&
    hasLivingReserve(sideOf(c.state, c.defenderKey)) &&
    !isForcedSwitchBlocked(c.defender) &&
    !isTrappedFromSwitching(c.defender);
  c.defenderBerryHealAmount = 0;

  if (!isFainted(c.defender) && !c.defenderBerriesBlocked && !defenderExitsAtHalf) {
    c.defenderBerryHealAmount = getHpThresholdBerryHeal(
      c.defenderItem,
      c.defender.currentHp,
      c.defender.maxHp,
      c.defender.itemConsumed ?? false,
      !!c.defenderAbility?.doublesBerryEffect, // 숙성
    );
    if (c.defenderBerryHealAmount > 0) {
      c.defender.currentHp = Math.min(c.defender.maxHp, c.defender.currentHp + c.defenderBerryHealAmount);
      consumeItem(c.defender);
      c.defenderBerryHealItemName = c.defenderItem!.name;
    }
  }
}

/** 자기과신·천정부지·마지막일침·스크린 부수기·곡예 — 쓰러뜨린 뒤/도구를 잃은 뒤의 발동 */
function applyKnockoutAbilities(c: ActionCtx) {

  // 자기과신: 자신의 데미지로 상대를 실제로 쓰러뜨렸을 때만 발동. resolveAction은 상대가 이미
  // 쓰러진 상태로는 호출되지 않으므로(runTurn의 break), 여기서 isFainted(defender)가 true라면
  // 이번 행동 중에 쓰러진 것이다 — 데미지를 준 경우로 한정해 상태이상/씨뿌리기 등 무관한 원인은 제외.
  if (c.isDamaging && c.damage > 0 && isFainted(c.defender) && c.attackerAbility?.boostsStatOnKo) {
    const boost = c.attackerAbility.boostsStatOnKo;
    c.attacker.stages = applyStageDelta(c.attacker.stages, boost.stat, contraryDelta(c.attacker, boost.delta));
  }

  // 천정부지(포챔스판): 자신의 데미지로 상대를 쓰러뜨리면 realStats가 가장 높은 능력이 1랭크 오른다.
  if (c.isDamaging && c.damage > 0 && isFainted(c.defender) && c.attackerAbility?.boostsHighestStatOnKo) {
    const highest = BATTLE_STAT_KEYS.reduce((a, b) => (c.attacker.realStats[b] > c.attacker.realStats[a] ? b : a));
    c.attacker.stages = applyStageDelta(c.attacker.stages, highest, contraryDelta(c.attacker, 1));
  }

  // 마지막일침(포챔스판): 이 기술의 데미지로 상대를 실제로 쓰러뜨리면 사용자 스탯이 오른다.
  // 자기과신(위)과 완전히 같은 축 — 특성이 아니라 기술 단위라는 점만 다르다.
  if (c.isDamaging && c.damage > 0 && isFainted(c.defender) && c.effectiveMove.boostsUserStatOnKo) {
    const boost = c.effectiveMove.boostsUserStatOnKo;
    c.attacker.stages = applyStageDelta(c.attacker.stages, boost.stat, contraryDelta(c.attacker, boost.delta));
  }

  // 레이징불·깨트리기(breaksScreensOnHit): 명중하면 상대 편(side) 스크린을 전부 제거한다. 위
  // 데미지 계산은 스크린이 살아있는 상태로 이미 끝났으니(그 턴엔 아직 경감), 여기서 제거만 한다.

  if (c.effectiveMove.breaksScreensOnHit) {
    const defenderScreens = sideOf(c.state, c.defenderKey).screens;
    const present = (Object.keys(defenderScreens) as ("reflect" | "lightScreen" | "auroraVeil")[]).filter(
      (s) => defenderScreens[s] !== undefined,
    );
    if (present.length > 0) {
      sideOf(c.state, c.defenderKey).screens = {};
      c.brokeScreens = present;
    }
  }

  // 곡예: 이번 행동 도중 도구가 있었다가(전) 없어졌으면(후 — 나무열매 소모든 매지션에게
  // 강탈당했든 원인 무관) 그 즉시 한 번만 발동해서 배틀 끝까지 스피드 2배를 유지한다. 이미
  // 발동했으면(unburdenActive) 다시 판정하지 않는다.

  if (
    c.attackerAbility?.doublesSpeedOnItemLoss &&
    !c.attacker.unburdenActive &&
    c.attackerItemIdBeforeAction !== null &&
    c.attacker.currentItemId === null
  ) {
    c.attacker.unburdenActive = true;
    c.unburdenSelfAbilityName = c.attackerAbility.name;
  }

  if (
    c.defenderAbility?.doublesSpeedOnItemLoss &&
    !c.defender.unburdenActive &&
    c.defenderItemIdBeforeAction !== null &&
    c.defender.currentItemId === null
  ) {
    c.defender.unburdenActive = true;
    c.unburdenOpponentAbilityName = c.defenderAbility.name;
  }
}

/** 대타에 막힘·볼주머니 정산·위기회피 발동 판정 */
function finalizeAction(c: ActionCtx) {

  // 대타에 통째로 막힘: 상대를 겨냥한 기술인데 대타를 실제로 깎지도(hitSubstitute) 못했으면
  // (= 변화기이거나 데미지 0), 본체엔 아무 일도 안 일어난 것이라 "실패" 문구를 낸다.
  c.blockedBySubstituteMoveName = c.blockedBySubstitute && !c.hitSubstitute && isOpponentTargetingMove(c.effectiveMove) ? c.effectiveMove.name : undefined;
  c.powderBlockedMoveName = c.blockedByPowderImmunity ? c.effectiveMove.name : undefined;

  // 볼주머니: 이번 행동 중 consumeItem이 나무열매 소비로 쌓아둔 추가 회복량을 로그로 옮기고 지운다.
  c.cheekPouchHeal += (c.attacker.pendingCheekPouchHeal ?? 0) + (c.defender.pendingCheekPouchHeal ?? 0);
  c.attacker.pendingCheekPouchHeal = undefined;
  c.defender.pendingCheekPouchHeal = undefined;

  // 위기회피(Emergency Exit): 이번 행동으로 방어측(매직미러 스왑 전 원래 방어측) HP가 절반
  // 초과 → 절반 이하(단 0 초과)로 넘어갔고 이 특성을 가졌으면, runActionPhase가 유턴류와 같은
  // pause 흐름으로 방어측을 물러나게 하도록 플래그만 세운다. 실제 교체·예비 유무·봉인 판정은
  // runActionPhase에서 한다.
  const origDefender = c.state[c.defenderKey];
  c.origDefenderAbility = origDefender.effectiveAbilityId ? getAbility(origDefender.effectiveAbilityId) : undefined;
  c.triggersDefenderEmergencyExit = !!c.origDefenderAbility?.exitsFieldAtHalfHp &&
    origDefender.currentHp > 0 &&
    c.defenderHpAtActionStart * 2 > origDefender.maxHp &&
    origDefender.currentHp * 2 <= origDefender.maxHp;
}

/** 행동 로그 항목을 모아 돌려준다 */
function collectResult(c: ActionCtx) {

  return {
    actor: c.actorKey,
    actorPokemonId: c.actorPokemonId,
    defenderPokemonId: c.defenderPokemonId,
    move: c.move,
    hit: true,
    critical: c.isCritical,
    damage: c.damage,
    damagePercent: c.damagePercent,
    typeEffectiveness: c.typeEffectiveness,
    defenderRemainingHp: c.defender.currentHp,
    selfDamage: c.selfDamage,
    attackerRemainingHp: c.attacker.currentHp,
    inflictedStatus: c.inflictedStatus,
    inflictedVolatile: c.inflictedVolatile,
    opponentStatDrops: c.opponentStatDrops.length > 0 ? c.opponentStatDrops : undefined,
    statusInflictFailed: c.statusInflictFailed || undefined,
    protectStanceEntered: c.protectStanceEntered || undefined,
    reflectedStatDropAbilityName: c.reflectedStatDropAbilityName,
    reflectedStatDrops: c.reflectedStatDrops.length > 0 ? c.reflectedStatDrops : undefined,
    crashDamage: c.crashDamage || undefined,
    selfDamageOnUse: c.selfDamageOnUse || undefined,
    canceledTargetChargeMoveName: c.canceledTargetChargeMoveName,
    endeavorDamage: c.endeavorDamage || undefined,
    counterDamage: c.counterDamage || undefined,
    counterFailed: c.counterFailed || undefined,
    perishSongStarted: c.perishSongStarted || undefined,
    perishSongFailed: c.perishSongFailed || undefined,
    curedStatus: c.curedStatus,
    curedStatusTarget: c.curedStatusTarget,
    selfWokeBeforeMove: c.selfWokeBeforeMove,
    blockedBySubstituteMoveName: c.blockedBySubstituteMoveName,
    powderBlockedMoveName: c.powderBlockedMoveName,
    setField: c.fieldSetFailed ? undefined : c.effectiveMove.setsField,
    terrainSeedMessages: c.terrainSeedMessages.length ? c.terrainSeedMessages : undefined,
    fieldSetFailed: c.fieldSetFailed,
    stealthRockSetForSide: c.stealthRockSetForSide,
    spikesSetForSide: c.spikesSetForSide,
    toxicSpikesSetForSide: c.toxicSpikesSetForSide,
    stickyWebSetForSide: c.stickyWebSetForSide,
    hazardSetFailed: c.hazardSetFailed,
    abilitySwappedTargetToName: c.abilitySwappedTargetToName,
    abilitySwapFailed: c.abilitySwapFailed || undefined,
    ateBerryName: c.stuffCheeksBerryName,
    ateBerryHeal: c.stuffCheeksBerryHeal || undefined,
    berryEatFailed: c.berryEatFailed || undefined,
    bouncedMoveName: c.bouncedMoveName,
    bouncedByAbilityName: c.bouncedByAbilityName,
    secondaryBlockedByAbilityName: c.secondaryBlockedByAbilityName,
    destroyedField: c.destroyedField,
    setTrickRoom: c.trickRoomSetFailed || c.trickRoomEnded ? undefined : c.effectiveMove.setsTrickRoom,
    trickRoomSetFailed: c.trickRoomSetFailed,
    setWeather: c.weatherSetFailed ? undefined : c.effectiveMove.setsWeather,
    weatherSetFailed: c.weatherSetFailed || undefined,
    setScreen: c.screenSetFailed ? undefined : c.effectiveMove.setsScreen,
    screenSetFailed: c.screenSetFailed,
    setSafeguard: c.safeguardSetFailed ? undefined : (c.effectiveMove.setsSafeguard || undefined),
    trickRoomEnded: c.trickRoomEnded || undefined,
    roomChange: c.roomChange,
    gravitySet: c.gravitySet || undefined,
    gravitySetFailed: c.gravitySetFailed || undefined,
    magnetRiseSet: c.magnetRiseSet || undefined,
    magnetRiseFailed: c.magnetRiseFailed || undefined,
    tailwindSet: c.tailwindSet || undefined,
    tailwindSetFailed: c.tailwindSetFailed || undefined,
    safeguardSetFailed: c.safeguardSetFailed || undefined,
    brokeScreens: c.brokeScreens,
    fainted: isFainted(c.defender),
    selfFainted: isFainted(c.attacker),
    recoilDamage: c.recoilDamage,
    enduredItemName: c.enduredItemName,
    enduredAbilityName: c.enduredAbilityName,
    restoredStatsSelfItemName: c.restoredStatsSelfItemName,
    restoredStatsOpponentItemName: c.restoredStatsOpponentItemName,
    hitCount: c.hitCount,
    hits: c.perHitLog && c.perHitLog.length > 0 ? c.perHitLog : undefined,
    itemRecoilDamage: c.itemRecoilDamage || undefined,
    itemRecoilItemName: c.itemRecoilItemName,
    berryReducedDamageItemName: c.berryReducedDamageItemName,
    leppaRestoredPpItemName: c.leppaRestoredPpItemName,
    drainHealAmount: c.drainHealAmount || undefined,
    liquidOozeDamage: c.liquidOozeDamage || undefined,
    liquidOozeAbilityName: c.liquidOozeAbilityName,
    shellBellHealAmount: c.shellBellHealAmount || undefined,
    healedAmount: c.healedAmount || undefined,
    healedTarget: c.healedTarget,
    restSlept: c.restSlept,
    setRegenVolatile: c.regenSetFailed ? undefined : c.effectiveMove.setsRegenVolatile,
    regenSetFailed: c.regenSetFailed,
    setLeechSeed: c.leechSeedSetFailed || c.leechSeedBlockedByGrass ? undefined : c.effectiveMove.setsLeechSeed,
    leechSeedSetFailed: c.leechSeedSetFailed,
    leechSeedBlockedByGrass: c.leechSeedBlockedByGrass || undefined,
    curseHpCost: c.curseHpCost || undefined,
    curseSetFailed: c.curseSetFailed || undefined,
    setSubstitute: c.substituteSetFailed ? undefined : c.effectiveMove.setsSubstitute,
    substituteSetFailed: c.substituteSetFailed,
    shedTailSucceeded: c.shedTailSucceeded || undefined,
    shedTailFailed: c.shedTailFailed || undefined,
    setDisabledMoveName: c.setDisabledMoveName,
    disableSetFailed: c.disableSetFailed,
    setEncoreMoveName: c.setEncoreMoveName,
    encoreSetFailed: c.encoreSetFailed,
    swappedStatsMoveName: c.swappedStatsMoveName,
    swappedStagesMoveName: c.swappedStagesMoveName,
    averagedDefensesMoveName: c.averagedDefensesMoveName,
    swappedSpeedMoveName: c.swappedSpeedMoveName,
    swappedItems: c.swappedItems,
    itemSwapFailed: c.itemSwapFailed || undefined,
    painSplitHp: c.painSplitHp,
    stockpileHealFailed: c.stockpileHealFailed || undefined,
    recycledItemName: c.recycledItemName,
    recycleFailed: c.recycleFailed || undefined,
    copiedStagesFromName: c.copiedStagesFromName,
    averagedAttacksMoveName: c.averagedAttacksMoveName,
    spitePp: c.spitePp,
    spiteFailed: c.spiteFailed || undefined,
    acupressureRaised: c.acupressureRaised,
    acupressureFailed: c.acupressureFailed || undefined,
    volatileBlockedByAbility: c.volatileBlockedByAbility,
    abilityChange: c.abilityChange,
    abilityChangeFailed: c.abilityChangeFailed || undefined,
    copiedTypes: c.copiedTypes,
    smackedDownTarget: c.smackedDownTarget || undefined,
    meltedItemName: c.meltedItemName,
    partyStatusCuredCount: c.partyStatusCuredCount || undefined,
    teaTime: c.teaTime,
    teaTimeFailed: c.teaTimeFailed || undefined,
    meltFailed: c.meltFailed || undefined,
    magneticFluxFailed: c.magneticFluxFailed || undefined,
    fairyLockSet: c.fairyLockSet || undefined,
    fairyLockFailed: c.fairyLockFailed || undefined,
    healingWishSet: c.healingWishSet || undefined,
    healingWishFailed: c.healingWishFailed || undefined,
    shellSideArmCategory: c.shellSideArmCategory,
    transformedIntoName: c.transformedIntoName,
    transformFailed: c.transformFailed || undefined,
    sheerForceAbilityName: c.sheerForceAbilityName,
    substituteBroke: c.substituteBroke,
    hitSubstitute: c.hitSubstitute,
    hitNegatedByAbilityName: c.hitNegatedByAbilityName,
    disguiseRecoilDamage: c.disguiseRecoilDamage,
    illusionBrokenSpeciesId: c.illusionBrokenSpeciesId,
    triggeredDestinyBond: c.destinyBondTriggered || undefined,
    protectSucceeded: c.protectSucceeded,
    protectFailed: c.protectFailed,
    selfStatRises: c.selfStatRises.length || c.pre.chargeStatRises.length ? [...c.pre.chargeStatRises, ...c.selfStatRises] : undefined,
    selfStatsAtMax: c.selfStatsAtMax.length ? c.selfStatsAtMax : undefined,
    selfStatDrops: c.selfStatDrops.length ? c.selfStatDrops : undefined,
    blockedByProtectMoveName: c.blockedByProtectMoveName,
    enduredProtectMoveName: c.enduredProtectMoveName,
    protectContactPenaltyMoveName: c.protectContactPenaltyMoveName,
    protectContactDamage: c.protectContactDamage || undefined,
    followUpHitDamage: c.followUpHitDamage || undefined,
    pressureExtraPpAbilityName: c.pressureExtraPpAbilityName,
    statusCureBerryItemName: c.statusCureBerryItemName,
    attackerBerryHealAmount: c.attackerBerryHealAmount || undefined,
    attackerBerryHealItemName: c.attackerBerryHealItemName,
    defenderBerryHealAmount: c.defenderBerryHealAmount || undefined,
    defenderBerryHealItemName: c.defenderBerryHealItemName,
    abilityInflictedStatusOnAttacker: c.abilityInflictedStatusOnAttacker,
    abilityInflictedStatusAbilityName: c.abilityInflictedStatusAbilityName,
    abilityInflictedVolatileOnAttacker: c.abilityInflictedVolatileOnAttacker,
    abilityInflictedVolatileAbilityName: c.abilityInflictedVolatileAbilityName,
    abilityDamageToAttacker: c.abilityDamageToAttacker || undefined,
    abilityDamageAbilityName: c.abilityDamageAbilityName,
    rockyHelmetDamage: c.rockyHelmetDamage || undefined,
    rockyHelmetItemName: c.rockyHelmetItemName,
    abilityDisabledMoveName: c.abilityDisabledMoveName,
    abilityDisableAbilityName: c.abilityDisableAbilityName,
    pickpocketStolenItemName: c.pickpocketStolenItemName,
    pickpocketAbilityName: c.pickpocketAbilityName,
    mummifiedAttackerAbilityName: c.mummifiedAttackerAbilityName,
    abilityRaisedDefenderStatsAbilityName: c.abilityRaisedDefenderStatsAbilityName,
    abilityRaisedDefenderStats: c.abilityRaisedDefenderStats.length ? c.abilityRaisedDefenderStats : undefined,
    abilityLoweredDefenderStats: c.abilityLoweredDefenderStats.length ? c.abilityLoweredDefenderStats : undefined,
    abilityAbsorbedMoveType: c.abilityAbsorbedMoveType,
    abilityAbsorbAbilityName: c.abilityAbsorbAbilityName,
    soundproofBlockedByAbilityName: c.soundproofBlockedByAbilityName,
    bulletproofBlockedByAbilityName: c.bulletproofBlockedByAbilityName,
    mentalMoveBlockedByAbilityName: c.mentalMoveBlockedByAbilityName,
    // 황금몸은 명중 굴림과 무관하게 판정되므로, 실제로 빗나간 경우(§4-5)와 구분하려면
    // 여기서 hit까지 확인해야 한다 — 그래야 "빗나갔다"와 "막혔다"가 서로 다른 로그로 나뉜다.
    goodAsGoldBlockedByAbilityName: c.blockedByGoodAsGold && c.hit ? c.defenderAbility?.name : undefined,
    invertedTargetStages: c.invertedTargetStages || undefined,
    addedTypeToTarget: c.addedTypeToTarget,
    targetMoveTypeOverride: c.targetMoveTypeOverride,
    abilityLoweredAttackerStatsAbilityName: c.abilityLoweredAttackerStatsAbilityName,
    abilityLoweredAttackerStats: c.abilityLoweredAttackerStats.length ? c.abilityLoweredAttackerStats : undefined,
    cheekPouchHeal: c.cheekPouchHeal || undefined,
    beakBlastBurnedAttacker: c.beakBlastBurnedAttacker || undefined,
    protectContactInflictedStatus: c.protectContactInflictedStatus,
    angerPointRaisedSpa: c.angerPointRaisedSpa || undefined,
    angerPointAbilityName: c.angerPointAbilityName,
    angerPointMaxedAbilityName: c.angerPointMaxedAbilityName,
    toxicDebrisAbilityName: c.toxicDebrisAbilityName,
    soulBeatHpCost: c.soulBeatHpCost || undefined,
    soulBeatFailed: c.costHpFailed || undefined,
    wanderingSpiritSwapped: c.wanderingSpiritSwapped || undefined,
    sandSpitWeather: c.sandSpitWeather,
    seedSowerField: c.seedSowerField,
    overwroteTargetType: c.overwroteTargetType,
    abilityAbsorbHealAmount: c.abilityAbsorbHealAmount || undefined,
    resetAllStages: c.effectiveMove.resetsAllStages || undefined,
    stolenItemName: c.stolenItemName,
    unburdenSelfAbilityName: c.unburdenSelfAbilityName,
    unburdenOpponentAbilityName: c.unburdenOpponentAbilityName,
    sleepTalkCalledMoveName: c.sleepTalkCalledMoveName,
    copycatCalledMoveName: c.copycatCalledMoveName,
    ohkoBlockedByAbilityName: c.ohkoBlockedByAbilityName,
    flungItemName: c.flungItem?.name,
    flingEffect: c.flingEffect,
    ohkoImmune: c.ohkoImmune || undefined,
    changedOwnTypeTo: c.changedOwnTypeTo,
    changedOwnTypeAbilityName: c.changedOwnTypeAbilityName,
    ateGemItemName: c.ateGemItemName,
    balloonPoppedItemName: c.balloonPoppedItemName,
    opportunistCopiedStats: c.opportunistCopiedStats,
    opportunistAbilityName: c.opportunistAbilityName,
    electromorphosisEmpoweredAbilityName: c.electromorphosisEmpoweredAbilityName,
    fickleBeamEmpowered: c.fickleBeamEmpowered || undefined,
    tidyUpDone: c.tidyUpDone || undefined,
    saltCureApplied: c.saltCureApplied || undefined,
    lostTypeAfterUse: c.lostTypeAfterUse,
    glaiveRushArmed: c.effectiveMove.glaiveRush || undefined,
    courtChangeDone: c.courtChangeDone || undefined,
    defogFieldCleared: c.defogFieldCleared || undefined,
    revivedPartyName: c.revivedPartyName,
    reviveFailed: c.reviveFailed || undefined,
    octolockApplied: c.octolockApplied || undefined,
    jawLockApplied: c.jawLockApplied || undefined,
    triggersDefenderEmergencyExit: c.triggersDefenderEmergencyExit || undefined,
    emergencyExitAbilityName: c.triggersDefenderEmergencyExit ? c.origDefenderAbility!.name : undefined,
  };
}

export function resolveAction(
  state: BattleState,
  actorKey: FighterKey,
  move: Move,
  random: () => number,
  movesSecond: boolean,
  defenderMove: Move,
): ActionLogEntry {
  const c = {} as ActionCtx;
  c.state = state;
  c.actorKey = actorKey;
  c.move = move;
  c.random = random;
  c.movesSecond = movesSecond;
  c.defenderMove = defenderMove;

  const pre = resolvePreHitEffects(c.state, c.actorKey, c.move, c.random, c.movesSecond, c.defenderMove);
  if (!("defenderKey" in pre)) return pre;
  c.pre = pre;
  c.move = c.pre.move;
  c.defenderKey = c.pre.defenderKey;
  c.attacker = c.pre.attacker;
  c.defender = c.pre.defender;
  c.defenderHpAtActionStart = c.pre.defenderHpAtActionStart;
  c.actorPokemonId = c.pre.actorPokemonId;
  c.defenderPokemonId = c.pre.defenderPokemonId;
  c.attackerAbility = c.pre.attackerAbility;
  c.defenderAbility = c.pre.defenderAbility;
  c.attackerBerriesBlocked = c.pre.attackerBerriesBlocked;
  c.defenderBerriesBlocked = c.pre.defenderBerriesBlocked;
  c.attackerItemIdBeforeAction = c.pre.attackerItemIdBeforeAction;
  c.defenderItemIdBeforeAction = c.pre.defenderItemIdBeforeAction;
  c.leppaRestoredPpItemName = c.pre.leppaRestoredPpItemName;
  c.pressureExtraPpAbilityName = c.pre.pressureExtraPpAbilityName;
  c.selfCuredStatus = c.pre.selfCuredStatus;
  c.sleepTalkCalledMoveName = c.pre.sleepTalkCalledMoveName;
  c.copycatCalledMoveName = c.pre.copycatCalledMoveName;
  c.ohkoBlockedByAbilityName = c.pre.ohkoBlockedByAbilityName;
  c.ohkoImmune = c.pre.ohkoImmune;
  c.flungItemId = c.pre.flungItemId;
  c.attackerItem = c.pre.attackerItem;
  c.defenderItem = c.pre.defenderItem;
  c.blockedByGoodAsGold = c.pre.blockedByGoodAsGold;
  c.blockedBySubstitute = c.pre.blockedBySubstitute;
  c.blockedByPowderImmunity = c.pre.blockedByPowderImmunity;
  c.blockedByProtect = c.pre.blockedByProtect;
  c.blockedByProtectMoveName = c.pre.blockedByProtectMoveName;
  c.soundproofBlockedByAbilityName = c.pre.soundproofBlockedByAbilityName;
  c.bulletproofBlockedByAbilityName = c.pre.bulletproofBlockedByAbilityName;
  c.opponentEffectsBlocked = c.pre.opponentEffectsBlocked;
  c.bouncedByMagicMirror = c.pre.bouncedByMagicMirror;
  c.shellSideArmCategory = c.pre.shellSideArmCategory;
  c.typeEffectiveness = c.pre.typeEffectiveness;
  c.effectiveMove = c.pre.effectiveMove;
  c.sheerForceAbilityName = c.pre.sheerForceAbilityName;
  c.fickleBeamEmpowered = c.pre.fickleBeamEmpowered;
  c.electromorphosisEmpoweredAbilityName = c.pre.electromorphosisEmpoweredAbilityName;
  c.changedOwnTypeTo = c.pre.changedOwnTypeTo;
  c.changedOwnTypeAbilityName = c.pre.changedOwnTypeAbilityName;
  c.lostTypeAfterUse = c.pre.lostTypeAfterUse;
  c.ateGemItemName = c.pre.ateGemItemName;
  c.hit = c.pre.hit;
  c.selfDamageOnUse = c.pre.selfDamageOnUse;
  c.abilityAbsorbedMoveType = c.pre.abilityAbsorbedMoveType;
  c.abilityAbsorbAbilityName = c.pre.abilityAbsorbAbilityName;
  c.abilityAbsorbHealAmount = c.pre.abilityAbsorbHealAmount;
  c.protectContactPenaltyMoveName = c.pre.protectContactPenaltyMoveName;
  c.protectContactDamage = c.pre.protectContactDamage;
  c.protectContactInflictedStatus = c.pre.protectContactInflictedStatus;
  let { unseenFistPiercing, abilityOffenseMultiplier, statOffenseMultiplier, abilityDefenseMultiplier, finalDefenseMultiplier, stabMultiplier, ownMoveTypeBoostMultiplier, rivalryMultiplier, gemMultiplier, hitChance, defenderHideType, evadedByCharge } = c.pre;

  const _d0 = resolveHitAndApplyDamage({
    state: c.state, defenderKey: c.defenderKey, move: c.move, effectiveMove: c.effectiveMove, random: c.random, attacker: c.attacker, defender: c.defender, attackerAbility: c.attackerAbility, defenderAbility: c.defenderAbility, attackerItem: c.attackerItem, defenderItem: c.defenderItem, typeEffectiveness: c.typeEffectiveness, blockedByProtect: c.blockedByProtect, blockedBySubstitute: c.blockedBySubstitute, unseenFistPiercing, hitChance, evadedByCharge, defenderHideType, gemMultiplier, ownMoveTypeBoostMultiplier, rivalryMultiplier, sheerForceAbilityName: c.sheerForceAbilityName, defenderBerriesBlocked: c.defenderBerriesBlocked, abilityOffenseMultiplier, statOffenseMultiplier, abilityDefenseMultiplier, finalDefenseMultiplier, stabMultiplier
  });
  c.abilityDamageAbilityName = _d0.abilityDamageAbilityName;
  c.abilityDamageToAttacker = _d0.abilityDamageToAttacker;
  c.abilityDisableAbilityName = _d0.abilityDisableAbilityName;
  c.abilityDisabledMoveName = _d0.abilityDisabledMoveName;
  c.abilityInflictedStatusAbilityName = _d0.abilityInflictedStatusAbilityName;
  c.abilityInflictedStatusOnAttacker = _d0.abilityInflictedStatusOnAttacker;
  c.abilityInflictedVolatileAbilityName = _d0.abilityInflictedVolatileAbilityName;
  c.abilityInflictedVolatileOnAttacker = _d0.abilityInflictedVolatileOnAttacker;
  c.abilityLoweredAttackerStats = _d0.abilityLoweredAttackerStats;
  c.abilityLoweredAttackerStatsAbilityName = _d0.abilityLoweredAttackerStatsAbilityName;
  c.abilityLoweredDefenderStats = _d0.abilityLoweredDefenderStats;
  c.abilityRaisedDefenderStats = _d0.abilityRaisedDefenderStats;
  c.abilityRaisedDefenderStatsAbilityName = _d0.abilityRaisedDefenderStatsAbilityName;
  c.angerPointAbilityName = _d0.angerPointAbilityName;
  c.angerPointMaxedAbilityName = _d0.angerPointMaxedAbilityName;
  c.angerPointRaisedSpa = _d0.angerPointRaisedSpa;
  c.berryReducedDamageItemName = _d0.berryReducedDamageItemName;
  c.canceledTargetChargeMoveName = _d0.canceledTargetChargeMoveName;
  c.cheekPouchHeal = _d0.cheekPouchHeal;
  c.counterDamage = _d0.counterDamage;
  c.counterFailed = _d0.counterFailed;
  c.crashDamage = _d0.crashDamage;
  c.damage = _d0.damage;
  c.damagePercent = _d0.damagePercent;
  c.destinyBondTriggered = _d0.destinyBondTriggered;
  c.disguiseRecoilDamage = _d0.disguiseRecoilDamage;
  c.drainHealAmount = _d0.drainHealAmount;
  c.endeavorDamage = _d0.endeavorDamage;
  c.enduredAbilityName = _d0.enduredAbilityName;
  c.enduredItemName = _d0.enduredItemName;
  c.enduredProtectMoveName = _d0.enduredProtectMoveName;
  c.followUpHitDamage = _d0.followUpHitDamage;
  c.hitCount = _d0.hitCount;
  c.hitNegatedByAbilityName = _d0.hitNegatedByAbilityName;
  c.hitSubstitute = _d0.hitSubstitute;
  c.illusionBrokenSpeciesId = _d0.illusionBrokenSpeciesId;
  c.isCritical = _d0.isCritical;
  c.isDamaging = _d0.isDamaging;
  c.itemRecoilDamage = _d0.itemRecoilDamage;
  c.itemRecoilItemName = _d0.itemRecoilItemName;
  c.liquidOozeAbilityName = _d0.liquidOozeAbilityName;
  c.liquidOozeDamage = _d0.liquidOozeDamage;
  c.mummifiedAttackerAbilityName = _d0.mummifiedAttackerAbilityName;
  c.perHitLog = _d0.perHitLog;
  c.pickpocketAbilityName = _d0.pickpocketAbilityName;
  c.pickpocketStolenItemName = _d0.pickpocketStolenItemName;
  c.recoilDamage = _d0.recoilDamage;
  c.rockyHelmetDamage = _d0.rockyHelmetDamage;
  c.rockyHelmetItemName = _d0.rockyHelmetItemName;
  c.sandSpitWeather = _d0.sandSpitWeather;
  c.seedSowerField = _d0.seedSowerField;
  c.selfDamage = _d0.selfDamage;
  c.shellBellHealAmount = _d0.shellBellHealAmount;
  c.statusCureBerryItemName = _d0.statusCureBerryItemName;
  c.stolenItemName = _d0.stolenItemName;
  c.substituteBroke = _d0.substituteBroke;
  c.terrainSeedMessages = _d0.terrainSeedMessages;
  c.toxicDebrisAbilityName = _d0.toxicDebrisAbilityName;
  c.wanderingSpiritSwapped = _d0.wanderingSpiritSwapped;
  // 아로마베일: 방어측이 이 특성이라 마음을 옭아매는 volatile(헤롱헤롱·도발·기술봉인·앙코르)을 막았을 때 그 특성 이름.
  // resolveHitAndApplyDamage 구간(§7)에선 안 쓰이고 아래(변화기 효과 적용부)에서만 채워진다.

  resolveMirroredPhase(c);
  applyFieldMoves(c);
  applyWeatherAndSideMoves(c);
  triggerBerryHeals(c);
  applyKnockoutAbilities(c);
  finalizeAction(c);
  return collectResult(c);
}

