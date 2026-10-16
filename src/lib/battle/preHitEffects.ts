import { itemsSuppressedByRoom } from "./turnOrderInputs";
import { isGrounded } from "./grounding";
import { type ChargeHideType, type Move } from "@/types/move";
import { type Ability } from "@/types/ability";
import { type Item } from "@/types/item";
import { type BattleStatKey } from "@/types/battleStats";
import { type PokemonType } from "@/types/pokemon-type";
import { type ActionBlockReason, type ActionLogEntry, type FighterKey } from "@/types/battle";
import { NO_STATUS_CONDITION, type StatusConditionState } from "@/types/status";
import { getAbility, getItem, getMove, getPokemon } from "@/lib/data";
import { getEffectiveForm } from "@/lib/pokemonForm";
import { computeRealStats } from "@/lib/statCalculator";
import { applyMoveStatChanges, applyStageDelta } from "@/lib/statStages";
import { getAbilityPriorityBoost, resolveEffectiveDefenderAbility } from "@/lib/abilityModifiers";
import { checkStatusActionBlock, inflictStatus, isImmuneToStatus } from "@/lib/statusConditions";
import { ATTRACT_ACTION_BLOCK_CHANCE, CONFUSION_SELF_HIT_CHANCE, consumeVolatileTurn, hasVolatile } from "@/lib/volatileConditions";
import { resolveMoveContext } from "@/lib/moveContext";
import { WEIGHT_MOVE_FALLBACK_POWER, absoluteWeightPowerValue, computeDamage, positiveStagesPowerValue, reversalPowerFromHp, targetHpRatioPowerValue, userHpScaledPowerValue, faintedAllyPowerValue, rivalryDamageMultiplier, weightRatioPowerValue } from "@/lib/battlePower";
import { applyWeatherBall } from "@/lib/weatherEffects";
import { applyFieldPulse, getFieldPowerMultiplier, isOpponentTargetingMove, isPriorityMoveBlockedByField, isStatusBlockedByField } from "@/lib/fieldEffects";
import { computeBattleHitChance } from "./hitChance";
import { CONFUSION_SELF_HIT_MOVE, MIN_DAMAGE_ROLL, STRUGGLE_MOVE, abilityOf, activeWeather, consumeItem, contraryDelta, electroBallPowerValue, gyroBallPowerValue, hasSheerForceSecondaryEffect, isFainted, opponentKey, sideOf, statusImmunitiesOf, type BattleFighterState, type BattleState } from "./state";

/** resolvePreHitEffects의 단계 사이에서 공유되는 값 — 한 단계 안에서만 쓰는 변수는 각 단계 함수의 지역 변수다 */
interface PreHitCtx {
  state: BattleState;
  actorKey: FighterKey;
  move: Move;
  random: () => number;
  movesSecond: boolean;
  defenderMove: Move;
  defenderKey: FighterKey;
  attacker: BattleFighterState;
  defender: BattleFighterState;
  defenderHpAtActionStart: number;
  actorPokemonId: string;
  defenderPokemonId: string;
  releasingCharge: boolean;
  attackerHasEarlyBird: boolean;
  attackerAbility: Ability | undefined;
  defenderAbility: Ability | undefined;
  attackerBerriesBlocked: boolean;
  defenderBerriesBlocked: boolean;
  attackerItemIdBeforeAction: string | null;
  defenderItemIdBeforeAction: string | null;
  leppaRestoredPpItemName: string | undefined;
  recharging: boolean;
  pressureExtraPpAbilityName: string | undefined;
  blocked: (reason: ActionBlockReason, selfDamage?: number, extra?: Partial<ActionLogEntry>) => ActionLogEntry;
  selfCuredStatus: StatusConditionState["condition"] | undefined;
  chargeStatRises: { stat: BattleStatKey; delta: number }[];
  sleepTalkCalledMoveName: string | undefined;
  copycatCalledMoveName: string | undefined;
  attackerItem: Item | undefined;
  defenderItem: Item | undefined;
  blockedByGoodAsGold: boolean;
  blockedBySubstitute: boolean;
  blockedByPowderImmunity: boolean;
  unseenFistPiercing: boolean;
  blockedByProtect: boolean;
  blockedByProtectMoveName: string | undefined;
  soundproofBlockedByAbilityName: string | undefined;
  bulletproofBlockedByAbilityName: string | undefined;
  opponentEffectsBlocked: boolean;
  bouncedByMagicMirror: boolean;
  shellSideArmCategory: "physical" | "special" | undefined;
  contextEffectiveMove: Move;
  abilityOffenseMultiplier: number;
  statOffenseMultiplier: number;
  abilityDefenseMultiplier: number;
  finalDefenseMultiplier: number;
  stabMultiplier: number;
  typeEffectiveness: number;
  absorbedByDefenderAbility: boolean;
  effectiveMove: Move;
  sheerForceAbilityName: string | undefined;
  flungItemId: string | undefined;
  ohkoBlockedByAbilityName: string | undefined;
  ohkoImmune: boolean;
  fickleBeamEmpowered: boolean;
  electromorphosisEmpoweredAbilityName: string | undefined;
  ownMoveTypeBoostMultiplier: number;
  rivalryMultiplier: number;
  changedOwnTypeTo: PokemonType | undefined;
  changedOwnTypeAbilityName: string | undefined;
  lostTypeAfterUse: PokemonType | undefined;
  gemMultiplier: number;
  ateGemItemName: string | undefined;
  hitChance: number | null;
  defenderHideType: ChargeHideType | undefined;
  evadedByCharge: boolean;
  hit: boolean;
  selfDamageOnUse: number;
  abilityAbsorbedMoveType: PokemonType | undefined;
  abilityAbsorbAbilityName: string | undefined;
  abilityAbsorbHealAmount: number;
  protectContactPenaltyMoveName: string | undefined;
  protectContactDamage: number;
  protectContactInflictedStatus: StatusConditionState["condition"] | undefined;
}

/** 송전·오라휠 타입, 틀깨기·원격·긴장감·곡예 등 이번 행동에 쓸 특성 바인딩 준비 */
function setupAbilityBindings(c: PreHitCtx) {

  // 송전: 지난(같은 턴 먼저 움직인) 상대가 송전을 성공시켰으면 이번 공격의 타입이 전기로 강제된다.
  // 자속·상성 전부 새 타입 기준으로 계산되도록 여기서 move 자체를 갈아끼운다(변화기는 제외).
  if (c.attacker.moveTypeOverrideThisTurn && c.move.category !== "status" && c.move.type !== null) {
    c.move = { ...c.move, type: c.attacker.moveTypeOverrideThisTurn };
  }

  // 오라휠(모르페코): 꼬르륵스위치 모양에 따라 타입을 전기/악으로 바꾼다(모양 없으면 full=전기).
  if (c.move.hungerSwitchType) {
    c.move = {
      ...c.move,
      type: c.attacker.hungerMode === "hangry" ? c.move.hungerSwitchType.hangry : c.move.hungerSwitchType.full,
    };
  }

  // 일찍기상(잠듦 해제 확률 스케줄에 필요)·습기(자폭기 차단, 아래 0번)는 상태이상 판정보다도
  // 먼저 필요해서, attackerAbility/defenderAbility 전체를 원래보다 앞당겨 여기서 구해둔다.
  c.attackerHasEarlyBird = c.attacker.effectiveAbilityId === "일찍기상";
  // attackerAbility/defenderAbility도 매직미러 반사 구간에서 attacker/defender와 함께 맞바뀐다(let).
  c.attackerAbility = c.attacker.effectiveAbilityId ? getAbility(c.attacker.effectiveAbilityId) : undefined;
  const rawDefenderAbility = c.defender.effectiveAbilityId ? getAbility(c.defender.effectiveAbilityId) : undefined;
  // 틀깨기: 공격측이 이 특성이면 예외 목록에 없는 한 방어측 특성 전체를 무효화한다 — 이 지점에서
  // 한 번만 치환해두면 modifiers·absorbsType·hitTrigger·blocksOpponentStatDropsForStats 등
  // defenderAbility를 참조하는 아래 코드 전부가 자동으로 반영된다. (매직미러도 이 예외 목록에서
  // 빠져 있어, 공격측이 틀깨기면 여기서 defenderAbility가 undefined가 되고 반사도 자연히 무산된다.)
  c.defenderAbility = resolveEffectiveDefenderAbility(c.attackerAbility, rawDefenderAbility);

  // 원격(Long Reach): 공격측이 이 특성이면 이번 기술의 접촉 판정을 통째로 없앤다. 이후 아래
  // 모든 접촉 조건(hitTrigger·록키헬멧·단단한발톱·킹실드 접촉 페널티·부리캐논 화상 등)이
  // effectiveMove/move의 makesContact를 보므로, 여기서 move를 갈아끼우면 전부 자동 반영된다.
  if (c.attackerAbility?.movesIgnoreContact && c.move.makesContact) {
    c.move = { ...c.move, makesContact: false };
  }

  // 긴장감: "이 특성을 가진 쪽의 상대"가 나무열매를 못 쓴다 — 방향이 헷갈리기 쉬운데, 내(공격측)
  // 나무열매가 막히는 건 상대(방어측)가 긴장감을 가졌을 때고, 상대(방어측) 나무열매가 막히는 건
  // 내(공격측)가 긴장감을 가졌을 때다. defenderAbility는 이미 틀깨기가 반영된 값이라(긴장감은
  // 틀깨기 예외 목록에 없음), 틀깨기 소유자가 공격하면 상대의 긴장감도 자연히 무시된다.
  c.attackerBerriesBlocked = !!c.defenderAbility?.preventsOpponentBerries;
  c.defenderBerriesBlocked = !!c.attackerAbility?.preventsOpponentBerries;

  // 곡예: "도구를 잃은 순간" 발동 여부를 판정하려면 이번 행동 시작 시점의 currentItemId를
  // 미리 기억해둬야 한다(행동 도중 나무열매 소모나 매지션 강탈로 값이 바뀔 수 있어서).
  c.attackerItemIdBeforeAction = c.attacker.currentItemId;
  c.defenderItemIdBeforeAction = c.defender.currentItemId;
}

/** PP 소모(난동·반동 턴 예외)와 프레셔 */
function payMovePp(c: PreHitCtx) {

  // PP 소모는 행동 여부와 무관하게 발생(단, 차지 기술 2턴째는 위에서 이미 스킵 처리)

  // 난동(ver.1.9): 이어 쓰는 턴은 PP를 쓰지 않는다(첫 턴만). 반동 턴(ver.1.9 A1)도 움직이지 않으니 PP 없음
  const continuingRampage = c.attacker.volatile.active.rampage?.moveId === c.move.id;
  c.recharging = hasVolatile(c.attacker.volatile, "recharge");
  if (!c.releasingCharge && !continuingRampage && !c.recharging && c.attacker.remainingPp[c.move.id] !== undefined) {
    const ppBefore = c.attacker.remainingPp[c.move.id];
    c.attacker.remainingPp[c.move.id] = Math.max(0, ppBefore - 1);
    // 과사열매: 이번 사용으로 PP가 정확히 0이 됐을 때(원래 0이던 걸 또 쓴 게 아니라)만 발동한다.
    if (
      ppBefore > 0 &&
      c.attacker.remainingPp[c.move.id] === 0 &&
      !c.attacker.itemConsumed &&
      !c.attackerAbility?.disablesOwnItemEffects &&
      !itemsSuppressedByRoom(c.state) &&
      !c.defenderBerriesBlocked
    ) {
      const itemForPp = c.attacker.currentItemId ? getItem(c.attacker.currentItemId) : undefined;
      // 과사열매도 나무열매라 긴장감에 막힌다(위 조건에서 이미 확인) — restoresPpOnZero 자체가
      // 나무열매 전용 필드라 별도 태그 없이도 이 게이트 하나로 충분하다.
      if (itemForPp?.restoresPpOnZero) {
        c.attacker.remainingPp[c.move.id] = Math.min(c.move.pp, itemForPp.restoresPpOnZero);
        consumeItem(c.attacker);
        c.leppaRestoredPpItemName = itemForPp.name;
      }
    }
  }

  // 프레셔: 상대(defender)가 이 특성이면, 자신을 향한 기술이든 자기 자신에게 쓰는 변화기든
  // 가리지 않고(본가 규칙 — 프레셔는 "이 포켓몬이 필드에 있는 동안 상대가 쓰는 모든 기술"에
  // 적용된다) PP를 추가로 더 소모시킨다. 과사열매 재판정 없이 단순 차감만 한다.

  if (c.defenderAbility?.extraPpCostWhenTargeted && !c.releasingCharge && !continuingRampage && !c.recharging && c.attacker.remainingPp[c.move.id] !== undefined) {
    const before = c.attacker.remainingPp[c.move.id];
    c.attacker.remainingPp[c.move.id] = Math.max(0, before - c.defenderAbility.extraPpCostWhenTargeted);
    if (c.attacker.remainingPp[c.move.id] !== before) c.pressureExtraPpAbilityName = c.defenderAbility.name;
  }

  c.blocked = (
    reason: ActionBlockReason,
    selfDamage = 0,
    extra?: Partial<ActionLogEntry>,
  ): ActionLogEntry => ({
    actor: c.actorKey,
    actorPokemonId: c.actorPokemonId,
    defenderPokemonId: c.defenderPokemonId,
    move: c.move,
    blockedReason: reason,
    hit: false,
    critical: false,
    damage: 0,
    damagePercent: 0,
    typeEffectiveness: 1,
    defenderRemainingHp: c.defender.currentHp,
    selfDamage,
    attackerRemainingHp: c.attacker.currentHp,
    fainted: false,
    selfFainted: isFainted(c.attacker),
    recoilDamage: 0,
    leppaRestoredPpItemName: c.leppaRestoredPpItemName,
    pressureExtraPpAbilityName: c.pressureExtraPpAbilityName,
    ...extra,
  });
}

/** 반동 턴·사용 조건·필드/날씨/중복 사용 제약 — 걸리면 실패로 끝난다 */
function checkUsageGates(c: PreHitCtx) {

  // 반동 턴(ver.1.9 A1): 무엇보다 먼저 — 상태이상 판정(잠듦 카운터 등)·사용 조건보다 앞서 막고 반동을 소모한다. 이전엔 상태이상
  // 판정 뒤라 마비로 못 움직이면 반동이 다음 턴까지 남았다.
  if (c.recharging) {
    c.attacker.volatile = consumeVolatileTurn(c.attacker.volatile, "recharge");
    return { value: c.blocked("recharge") };
  }

  // 0) 사용 조건이 있는 기술(코골기=잠든 상태 전용, 속이기=첫 턴 전용). 상태이상/행동방해
  // 판정보다 먼저 확인한다 — 조건 자체를 못 채우면 애초에 시도조차 안 한 것으로 취급.
  // 속이기: 이 포켓몬이 등장한 뒤 처음 행동을 개시하는 턴에만 성공한다(리드의 1턴, 교체·유턴
  // 으로 나온 뒤 첫 행동 턴 등). 배틀 전체의 턴 번호가 아니라 파이터별 등장 후 행동 여부로 본다.
  if (c.move.usageCondition === "first-turn-only" && c.attacker.hasActedSinceSwitchIn) {
    return { value: c.blocked("usageCondition") };
  }
  // resolveAction이 이 파이터에 대해 돌았다는 건 이번 턴에 자기 행동을 개시했다는 뜻 —
  // 이후 usageCondition 실패로 막히거나 마비·풀죽음으로 못 움직여도 속이기 창은 소진된 것.
  c.attacker.hasActedSinceSwitchIn = true;
  // 아이언롤러: 활성화된 필드가 하나도 없으면 실패한다(본가 규칙)
  if (c.move.usageCondition === "field-required" && !c.state.field) {
    return { value: c.blocked("usageCondition") };
  }
  // 오로라베일: 지정된 날씨(눈)가 아니면 실패한다
  if (c.move.usageCondition === "weather-required" && activeWeather(c.state) !== c.move.requiresWeather) {
    return { value: c.blocked("usageCondition") };
  }
  // 비장의무기: 자신의 다른 기술(remainingPp에 등록된 id들)을 전부 한 번씩 사용하기 전까지는 실패.
  if (c.move.usageCondition === "all-other-moves-used") {
    const otherMoveIds = Object.keys(c.attacker.remainingPp).filter((id) => id !== c.move.id);
    const allUsed = otherMoveIds.every((id) => c.attacker.usedMoveIds?.[id]);
    if (!allUsed) return { value: c.blocked("usageCondition") };
  }
  // 소란피기(ver.1.9): 소란 중에는 잠자기가 실패한다(잠들 수 없음)
  if (c.move.restSleep && c.attacker.sleepBlockedByUproar) {
    return { value: c.blocked("usageCondition") };
  }
  // 배수의진(ver.1.9): 이미 배수의진 상태면 실패(본가 규칙)
  if (c.move.usageCondition === "not-no-retreat" && hasVolatile(c.attacker.volatile, "noRetreat")) {
    return { value: c.blocked("usageCondition") };
  }
  // 토해내기: 비축 스택이 0이면 쓸 수 없다.
  if (c.move.spitUpPower && (c.attacker.stockpileCount ?? 0) === 0) {
    return { value: c.blocked("usageCondition") };
  }
  // 비축하기: 이미 3스택이면 더 비축할 수 없다(본가 규칙 — 실패 처리).
  if (c.move.addsStockpile && (c.attacker.stockpileCount ?? 0) >= 3) {
    return { value: c.blocked("usageCondition") };
  }
  // 거대해머: 직전 턴에 이 기술로 행동을 개시했으면(=consecutiveLock 기록의 턴 번호가 이번 턴과
  // 정확히 일치) 이번 턴엔 쓸 수 없다. 잠금은 "사용한 턴 + 1" 한 턴만 유효해 그 다음 턴부턴 다시 쓸 수 있다.
  if (
    c.move.cannotUseConsecutively &&
    c.attacker.consecutiveLockMoveId === c.move.id &&
    c.attacker.consecutiveLockUntilTurn === c.state.turnNumber
  ) {
    return { value: c.blocked("usageCondition") };
  }
  // 기습: 상대보다 먼저 움직이지 않으면(movesSecond) 실패, 상대가 이번 턴 고른 기술이
  // 데미지 기술(물리/특수)이 아니면(=변화기를 냈거나, 자기 자신의 usageCondition 미충족 등으로
  // 어차피 데미지를 안 낼 예정이면) 실패한다. 본가 규칙과 동일하게 defenderMove의 category만
  // 보고 판정 — 상대가 상태이상으로 실제 행동에 실패할지 여부까지는 반영하지 않는다(동시 비공개
  // 선택 방식이라 이 시뮬레이터 구조상 그 정보까지 반영하려면 판정 순서 자체를 바꿔야 함).
  if (
    c.move.usageCondition === "opponent-damaging-move-only" &&
    (c.movesSecond || (c.defenderMove.category !== "physical" && c.defenderMove.category !== "special"))
  ) {
    return { value: c.blocked("usageCondition") };
  }
  // 습기: 자신이든 상대든 이 특성이 있으면 자폭류 기술(대폭발 등) 자체를 쓸 수 없다.
  if (c.move.selfFaints && (c.attackerAbility?.preventsSelfFaintMoves || c.defenderAbility?.preventsSelfFaintMoves)) {
    return { value: c.blocked("usageCondition") };
  }
}

/** 상태이상·풀죽음·도발/사슬묶기/앙코르·사이코필드·여왕의위엄·혼란·헤롱헤롱으로 행동이 막히는지 */
function checkActionBlockers(c: PreHitCtx) {

  // 1) 주 상태이상(잠듦/얼음/마비)으로 행동 자체가 막히는지. 잠듦/얼음은 이 판정 안에서
  // 자체 해제 카운터가 갱신되므로 결과를 attacker.status에 반드시 반영해야 한다.
  // 코골기처럼 "잠든 상태에서만" 쓸 수 있는 기술은 본가에서 잠듦이 행동을 막는 예외라,
  // 일반 잠듦 차단을 건너뛰고 별도로 처리한다 — 해제 판정/카운터 자체는 그대로 진행시킨다.
  const preActionStatus = c.attacker.status.condition;


  // 1-1) 불사르기·열사의대지·플레어드라이브 등 "사용 직전 사용자의 얼음 상태를 치유한다" 기술은
  // 매턴 해제 확률 판정 없이 무조건 먼저 해동된 뒤 기술이 정상적으로 나간다.
  if (c.attacker.status.condition === "freeze" && c.move.thawsUserOnUse) {
    c.attacker.status = { ...NO_STATUS_CONDITION };
    c.selfCuredStatus = "freeze";
  } else if (c.move.usageCondition === "sleep-only") {
    if (c.attacker.status.condition !== "sleep") return { value: c.blocked("usageCondition") };
    const wakeCheck = checkStatusActionBlock(c.attacker.status, c.random, c.attackerHasEarlyBird);
    c.attacker.status = wakeCheck.nextState;
    // 이 판정으로 잠에서 깼다면 이번 턴은 이미 깬 상태이므로 사용 조건이 깨진 것으로 처리한다.
    if (c.attacker.status.condition !== "sleep") return { value: c.blocked("usageCondition") };
  } else {
    const statusCheck = checkStatusActionBlock(c.attacker.status, c.random, c.attackerHasEarlyBird);
    c.attacker.status = statusCheck.nextState;
    if (statusCheck.blocked) return { value: c.blocked("status", 0, { blockedByStatus: preActionStatus ?? undefined }) };
    // 잠듦/얼음이 이번 판정에서 자연 해제됐으면(매턴 확률 스케줄) 로그에 남긴다 — 물거품아리아 같은
    // 명시적 치료(curesStatus)와는 다른 경로라 여기서 별도로 잡아야 한다.
    if ((preActionStatus === "sleep" || preActionStatus === "freeze") && !c.attacker.status.condition) {
      c.selfCuredStatus = preActionStatus;
    }
  }

  // 2) 풀죽음: 1턴짜리 행동방해. 걸려있으면 이번 턴 소모하고 못 움직인다(반동은 위에서 먼저)
  if (hasVolatile(c.attacker.volatile, "flinch")) {
    c.attacker.volatile = consumeVolatileTurn(c.attacker.volatile, "flinch");
    return { value: c.blocked("flinch") };
  }

  // 2-0) 도발/사슬묶기/앙코르: 이번 턴 고른 기술이 제약을 어기면 실패한다. 차지 기술 2턴째
  // (releasingCharge)는 지난 턴에 이미 확정된 선택이라 이 판정에서 제외한다. 지속 턴수는
  // 막혔는지 여부와 무관하게 전부 이 시점에 1씩 줄어든다(자기 차례마다 한 번씩만 판정되므로
  // 자연히 턴당 1회 소모) — 여러 제약이 동시에 걸려있어도 전부 소모시킨 뒤 첫 번째로 걸린
  // 이유(도발 > 사슬묶기 > 앙코르 순)만 대표로 보고한다.
  if (!c.releasingCharge) {
    let restrictionBlockedKind: "taunt" | "disable" | "encore" | "torment" | "imprison" | "gravity" | undefined;
    if (hasVolatile(c.attacker.volatile, "taunt")) {
      if (c.move.category === "status") restrictionBlockedKind = "taunt";
      c.attacker.volatile = consumeVolatileTurn(c.attacker.volatile, "taunt");
    }
    const disableEntry = c.attacker.volatile.active.disable;
    if (disableEntry) {
      if (disableEntry.moveId === c.move.id) restrictionBlockedKind ??= "disable";
      c.attacker.volatile = consumeVolatileTurn(c.attacker.volatile, "disable");
    }
    const encoreEntry = c.attacker.volatile.active.encore;
    if (encoreEntry) {
      if (encoreEntry.moveId !== c.move.id) restrictionBlockedKind ??= "encore";
      c.attacker.volatile = consumeVolatileTurn(c.attacker.volatile, "encore");
    }
    // 트집(트랙 M2): 직전에 쓴 기술을 다시 못 쓴다. 봉인(트랙 M2): 봉인을 쓴 상대가 배운 기술은 못 쓴다.
    // 둘 다 물러나기 전까지 이어져 턴 소모가 없다.
    if (hasVolatile(c.attacker.volatile, "torment") && c.attacker.lastMoveId === c.move.id) restrictionBlockedKind ??= "torment";
    if (hasVolatile(c.defender.volatile, "imprison") && c.defender.remainingPp[c.move.id] !== undefined) {
      restrictionBlockedKind ??= "imprison";
    }
    // 중력(트랙 M4): 공중으로 뛰어오르는 기술은 못 쓴다
    if (c.state.gravityTurnsRemaining !== undefined && c.move.blockedByGravity) restrictionBlockedKind ??= "gravity";
    // 발버둥은 이 제약들을 전부 무시하고 나간다(본가 규칙): 앙코르로 변화기가 강제됐는데 도발로
    // 그 변화기를 못 쓰는 등, 고를 수 있는 기술이 하나도 없을 때의 폴백. 지속 턴수는 위에서 이미
    // 소모시켰으므로 앙코르·도발·사슬묶기 카운트다운은 정상 진행된다(백로그 §7-5).
    if (restrictionBlockedKind && c.move.id !== STRUGGLE_MOVE.id) {
      return { value: c.blocked("moveRestricted", 0, { moveRestrictionKind: restrictionBlockedKind }) };
    }
  }

  // 2-1) 사이코필드: 우선도 +1 이상인 기술이 "상대를 겨냥"하면 그 기술 자체가 실패한다.
  // 짓궂은마음으로 변화기 우선도가 올라간 경우도 반영해야 해서 원본 우선도가 아니라 특성
  // 보정을 더한 실제 우선도로 판정한다 — 단, 순풍·리플렉터·빛의장막처럼 상대를 겨냥하지 않는
  // 변화기는 우선도가 올라가 있어도 막히지 않는다(isOpponentTargetingMove가 그 축을 가른다).
  const effectivePriorityForBlock =
    c.move.priority + getAbilityPriorityBoost(c.move, c.attackerAbility, c.attacker.currentHp === c.attacker.maxHp);
  if (isPriorityMoveBlockedByField(c.state.field, effectivePriorityForBlock, c.move, isGrounded(c.state, c.defender, c.defenderAbility))) {
    return { value: c.blocked("psychicFieldPriority") };
  }
  // 여왕의위엄: 방어측이 이 특성이면 상대의 우선도 +1↑ 공격 기술이 자신을 겨냥할 때 실패한다.
  // 사이코필드 차단과 같은 축(isOpponentTargetingMove) — 순풍·방어 같은 자기/필드 기술은 제외.
  if (
    c.defenderAbility?.blocksOpponentPriorityMoves &&
    effectivePriorityForBlock >= 1 &&
    isOpponentTargetingMove(c.move)
  ) {
    return { value: c.blocked("queenlyMajesty") };
  }

  // 3) 혼란: 매 행동 판정마다 지속 턴수를 소모하고, 1/3 확률로 자멸(물리 40위력 자가타격)한다.
  // 자멸하면 이번 턴은 그걸로 끝 — 원래 쓰려던 기술은 실행되지 않는다.
  if (hasVolatile(c.attacker.volatile, "confusion")) {
    c.attacker.volatile = consumeVolatileTurn(c.attacker.volatile, "confusion");
    if (c.random() < CONFUSION_SELF_HIT_CHANCE) {
      const selfHit = computeDamage(c.attacker.realStats, c.attacker.realStats, c.attacker.types, CONFUSION_SELF_HIT_MOVE, {
        randomRoll: MIN_DAMAGE_ROLL + c.random() * (1 - MIN_DAMAGE_ROLL),
      });
      const selfDamage = selfHit?.damage ?? 0;
      c.attacker.currentHp = Math.max(0, c.attacker.currentHp - selfDamage);
      return { value: c.blocked("confusion", selfDamage) };
    }
  }

  // 3-1) 헤롱헤롱(매혹): ingrain/leechSeed와 같은 "배틀 끝까지 유지"형이라 턴수를 소모하지 않는다
  // (consumeVolatileTurn 호출 없음 — 교체가 없는 1v1이라 해제될 계기가 없음). 걸려있는 동안 매
  // 행동 판정마다 50% 확률로 그 턴 행동을 통째로 못 한다.
  if (hasVolatile(c.attacker.volatile, "attract") && c.random() < ATTRACT_ACTION_BLOCK_CHANCE) {
    return { value: c.blocked("attract") };
  }
}

/** 차지 1턴째·잠꼬대·흉내쟁이·서투름 도구 무효 */
function handleChargeAndCopyMoves(c: PreHitCtx) {

  // 4) 차지 기술 1턴째(공중날기 등): 준비만 하고 이번 턴엔 데미지를 주지 않는다. 맑음 날씨의
  // 솔라빔처럼 chargeSkipWeather가 현재 날씨와 일치하면 준비 없이 곧장 2턴째처럼 실행한다.
  // releasingCharge면 이미 2턴째(위에서 move를 저장된 기술로 바꿔치기했음)라 여기 안 들어온다.
  // 로그용: 차지 1턴째 상승분. 비 오는 일렉트로빔처럼 준비 없이 바로 발사하면 resolveAction이 결과의 selfStatRises에 합친다
  c.chargeStatRises = [];
  if (c.move.chargeTurn && !c.releasingCharge) {
    // 메테오빔·일렉트로빔: 능력치 상승은 "이 기술을 쓴 턴"(=1턴째, 준비 선언 시점) 기준이라
    // chargeSkipWeather로 준비 턴 자체가 생략되는 경우(비 오는 일렉트로빔)에도 여기서 적용한다.
    // move.statChanges(2턴째 공격 판정에서 쓰는 필드)와 겹치지 않게 별도 필드로 받는다.
    if (c.move.chargeStatChanges) {
      const stagesBefore = c.attacker.stages;
      c.attacker.stages = applyMoveStatChanges(
        c.attacker.stages,
        { ...c.move, statChanges: c.move.chargeStatChanges },
        "self",
        { userTypes: c.attacker.types },
      );
      for (const sc of c.move.chargeStatChanges) {
        const stat = sc.stat as BattleStatKey;
        const delta = c.attacker.stages[stat] - stagesBefore[stat];
        if (delta > 0) c.chargeStatRises.push({ stat, delta });
      }
    }
    // 메가솔라: 쾌청 조건 차지 스킵기(솔라빔)를 날씨와 무관하게 준비 턴 없이 발동시킨다.
    const skipsCharge =
      c.move.chargeSkipWeather !== undefined &&
      (activeWeather(c.state) === c.move.chargeSkipWeather ||
        (c.move.chargeSkipWeather === "쾌청" && c.attackerAbility?.treatsOwnWeatherAsSun));
    if (!skipsCharge) {
      c.attacker.chargingMoveId = c.move.id;
      return { value: {
        actor: c.actorKey,
        actorPokemonId: c.actorPokemonId,
        defenderPokemonId: c.defenderPokemonId,
        move: c.move,
        hit: true,
        critical: false,
        damage: 0,
        damagePercent: 0,
        typeEffectiveness: 1,
        defenderRemainingHp: c.defender.currentHp,
        selfDamage: 0,
        attackerRemainingHp: c.attacker.currentHp,
        fainted: false,
        selfFainted: false,
        recoilDamage: 0,
        charging: true,
        selfStatRises: c.chargeStatRises.length ? c.chargeStatRises : undefined,
        leppaRestoredPpItemName: c.leppaRestoredPpItemName,
      } };
    }
  }

  // 잠꼬대: 여기까지 왔다는 건 잠든 채로 이 기술을 실제로 선택했다는 뜻(usageCondition 게이트를
  // 이미 통과) — 이 시점부터는 잠꼬대 자신 대신 자신이 배운 다른 기술 중 하나를 무작위로 대신
  // 발동시킨다. PP는 잠꼬대 자신만 이미 위에서 소모했고, 대신 나가는 기술의 PP는 건드리지 않는다
  // (본가와 동일). 이 아래로는 move가 그 대신 나간 기술을 가리키므로, 특성 배율/자속/타입상성/
  // 우선도 등 이후의 모든 판정이 자동으로 그 기술 기준으로 이뤄진다.

  if (c.move.callsRandomLearnedMove) {
    const candidates = Object.keys(c.attacker.remainingPp)
      .map((id) => getMove(id))
      .filter(
        (m): m is Move =>
          !!m && m.id !== c.move.id && !m.chargeTurn && !m.usageCondition && !m.excludedFromSleepTalk,
      );
    if (candidates.length === 0) {
      // 배운 기술이 잠꼬대 하나뿐이거나 전부 제외 대상이면 대신 낼 기술이 없어 실패한다.
      return { value: c.blocked("usageCondition") };
    }
    const chosen = candidates[Math.floor(c.random() * candidates.length)];
    c.sleepTalkCalledMoveName = chosen.name;
    c.move = chosen;
  }

  // 흉내쟁이(트랙 M2): 배틀에서 직전에 나온 기술(누가 썼든 — 이번 턴 상대가 먼저 썼으면 그 기술)을
  // 대신 쓴다. 나온 기술이 없거나 따라 쓸 수 없는 기술이면 실패. 잠꼬대처럼 PP는 흉내쟁이 것만 쓴다.
  // 모으기 기술·사용 조건 기술은 그 판정이 이미 지나간 뒤라 잠꼬대와 같이 실패로 근사한다.

  if (c.move.callsLastMoveInBattle) {
    const copied = c.state.lastMoveUsedId ? getMove(c.state.lastMoveUsedId) : undefined;
    if (!copied || !isCopyableMove(copied)) return { value: c.blocked("usageCondition") };
    c.copycatCalledMoveName = copied.name;
    c.move = copied;
  }

  // 서투름: 자기 자신의 도구 전투 효과가 무효화된다 — 실제로 지녔는지와 무관하게 이 시점부터는
  // 아예 안 지닌 것처럼 취급한다(메가스톤에 의한 폼 변화는 pokemonForm.ts의 별도 축이라 영향 없음).
  // attackerItem/defenderItem도 매직미러 반사 구간에서 함께 맞바뀐다(let).
  c.attackerItem = c.attackerAbility?.disablesOwnItemEffects || itemsSuppressedByRoom(c.state)
    ? undefined
    : c.attacker.currentItemId
      ? getItem(c.attacker.currentItemId)
      : undefined;
  c.defenderItem = c.defenderAbility?.disablesOwnItemEffects || itemsSuppressedByRoom(c.state)
    ? undefined
    : c.defender.currentItemId
      ? getItem(c.defender.currentItemId)
      : undefined;
}

/** 황금몸·대타·가루 면역·방어류·방음·방탄·매직미러 — 방어측이 기술을 막거나 되돌리는지 */
function checkDefenderImmunities(c: PreHitCtx) {

  // 황금몸: 상대(공격측)가 변화기(카테고리 status)를 쓸 때, 그 기술이 "자신(=defender)을 직접
  // 겨냥하는" 효과(상태이상 부여·행동방해·랭크/명중회피/급소 하락)만 전부 무산시킨다. 필드
  // 전역 효과(날씨·필드·트릭룸)나 공격측 자신을 향한 효과(자기 스탯 상승, 자기 스크린 설치)는
  // "이 포켓몬을 겨냥한" 게 아니라서 그대로 적용된다 — 아래 각 opponent 방향 적용 지점에서만
  // 이 플래그로 건너뛴다.
  c.blockedByGoodAsGold = c.move.category === "status" && !!c.defenderAbility?.blocksOpponentStatusMoveEffects;

  // 대타출동: 방어측이 대타를 세운 상태면, 소리 계열(돌림노래 등 classification "소리") 기술을
  // 제외한 모든 기술의 "opponent 방향" 부가효과(상태이상·랭크/명중회피/급소 하락·행동방해)가
  // 카테고리 무관(데미지기든 변화기든)으로 전부 무산된다 — 황금몸과 달리 status 기술로 한정하지
  // 않는다. 데미지 자체는 무산이 아니라 대타 HP로 흡수(아래 resolveHit 계열에서 별도 처리).
  // 틈새포착: 공격측이 이 특성이면 대타출동도 소리 계열과 마찬가지로 무시하고 본체에 직접 적중한다.
  c.blockedBySubstitute = c.defender.substituteHp !== undefined &&
    !(c.move.classification ?? []).includes("소리") &&
    !c.attackerAbility?.bypassesScreensAndSubstitute;

  // 가루/포자 기술(수면가루·저리가루·독가루·목화포자·분노가루)은 풀타입 포켓몬에게 통하지 않는다
  // (본가 규칙 — 타입 면역과 같은 축). 방진 특성·방진고글 도구도 막지만 포챔스 로스터엔 없어 생략.
  c.blockedByPowderImmunity = (c.move.classification ?? []).includes("가루") && c.defender.types.includes("풀");

  // 방어/판별/킹실드(protectEffect: "block"): 이번 턴 상대의 공격을 카테고리 무관으로 완전히
  // 무효화한다 — 대타와 달리 데미지를 어디로도 흡수하지 않고 그냥 0으로 만든다(아래 canDealDamage).
  // 버티기(protectEffect: "endure")는 막는 게 아니라 applyEndurance에서 별도로 처리하므로 여기
  // 포함하지 않는다.
  // 고스트다이브: "방어를 무시" = 방어류(protectEffect) 차단 자체를 뚫는다는 뜻(사용자 확인) — 실제
  // 방어 실수치와는 무관해서 여기서 판정 자체를 건너뛴다(틈새포착이 스크린/대타를 뚫는 것과 같은 결).
  // 패스트가드(protectEffect: "blockPriority"): "block"과 같지만 상대 기술의 priority가 0보다
  // 클 때만 막는다 — 일반 기술은 그냥 통과.
  const activeProtectBlocks =
    c.defender.activeProtect?.effect === "block" ||
    (c.defender.activeProtect?.effect === "blockPriority" && c.move.priority > 0);
  // 보이지않는주먹: 접촉기가 방어류를 뚫고 명중한다(데미지는 아래 resolveHit에서 1/4로 줄고, 방어류의
  // 접촉 성공 부가효과는 그대로 발동). 뚫는 경우엔 blockedByProtect를 false로 둬서 기술이 정상 진행된다.
  c.unseenFistPiercing = !!(
    c.attackerAbility?.contactBypassesProtectAtQuarterDamage &&
    (c.move.makesContact ?? false) &&
    !c.move.bypassesProtect &&
    activeProtectBlocks
  );
  c.blockedByProtect = !c.move.bypassesProtect && !c.unseenFistPiercing && activeProtectBlocks;
  // "방어로 막혔다!" 문구는 실제로 상대를 겨냥한 기술이 막혔을 때만 — 칼춤·나쁜음모처럼 자기
  // 대상 랭크업/자기 회복기는 방어와 무관하게 그대로 발동하므로 "막혔다"가 아니다(Phase 6.5 §6-2 ⑦).
  c.blockedByProtectMoveName = c.blockedByProtect && isOpponentTargetingMove(c.move) ? c.defender.activeProtect?.moveName : undefined;
  // 방음: 방어측이 이 특성이면 소리 기술(classification "소리")이 데미지기·변화기 모두 완전히
  // 무효화된다. resolveMoveContext도 같은 판정으로 typeEffectiveness를 0으로 만든다.
  const blockedBySoundproof = !!(
    c.defenderAbility?.blocksSound && (c.move.classification ?? []).includes("소리")
  );
  // 방탄: 방어측이 이 특성이면 구슬·폭탄 기술(tags "구슬"/"폭탄")이 데미지기·변화기 모두 완전히
  // 무효화된다. 방음과 같은 처리 — resolveMoveContext도 같은 판정으로 typeEffectiveness를 0으로 만든다.
  const blockedByBulletproof = !!(
    c.defenderAbility?.blocksBallBomb && (c.move.tags ?? []).some((t) => t === "구슬" || t === "폭탄")
  );
  c.soundproofBlockedByAbilityName = blockedBySoundproof ? c.defenderAbility?.name : undefined;
  c.bulletproofBlockedByAbilityName = blockedByBulletproof ? c.defenderAbility?.name : undefined;
  c.opponentEffectsBlocked = c.blockedByGoodAsGold ||
    c.blockedBySubstitute ||
    c.blockedByProtect ||
    c.blockedByPowderImmunity ||
    blockedBySoundproof ||
    blockedByBulletproof;

  // 매직미러: 방어측이 이 특성을 지녔고(틀깨기면 위에서 defenderAbility가 이미 undefined), 이번
  // 기술이 방어측을 겨냥하는 status 변화기이며 반사 제외(notReflectable — 고스트 저주·추억의선물·
  // 멸망의노래·흔들흔들댄스)가 아니면, 이 기술을 시전자에게 되돌린다. setsHazard(스텔스록)는
  // isOpponentTargetingMove가 잡지 않아 따로 OR로 포함한다. 되돌린 기술은 빗나가지 않고(아래 hit
  // 강제), "방어측 방향 효과" 블록 진입 직전에 공격/방어 바인딩을 통째로 맞바꿔 원래 시전자에게
  // 효과가 그대로 꽂히게 한다.
  c.bouncedByMagicMirror = !c.opponentEffectsBlocked &&
    c.move.category === "status" &&
    !c.move.notReflectable &&
    !!c.defenderAbility?.reflectsOpponentStatusMoves &&
    (isOpponentTargetingMove(c.move) || !!c.move.setsHazard);
}

/** 레이징불·셸암즈·웨더볼·필드 조건부 타입/위력, 변화한 타입 반영 */
function resolveDynamicMoveType(c: PreHitCtx) {

  // 레이징불: 이 기술을 쓰는 켄타로스의 종(팔데아 3품종)에 따라 실제 타입이 바뀐다. 웨더볼/
  // fieldPulse보다 먼저 반영해야 이후 resolveMoveContext의 상성·자속 계산이 전부 새 타입으로 돈다.
  const speciesTypedType = c.move.typeByUserSpecies?.[c.attacker.slot.pokemonId];
  const speciesTypedMove: Move = speciesTypedType ? { ...c.move, type: speciesTypedType } : c.move;

  // 셸암즈(dynamicCategoryByHigherDamage) — 가라르야도란 전용기. 물리(공격 vs 상대 방어)와
  // 특수(특공 vs 상대 특방)로 각각 데미지를 계산해 큰 쪽 판정으로 공격한다. 물리면 접촉기,
  // 특수면 비접촉기. 두 값이 같으면 무작위. 도구·특성·날씨 배율은 여기 비교에 넣지 않고(사용자
  // 확정 — "물리/특수 여부를 먼저 판단한 뒤 적용"), 순수 실능·랭크만으로 비교한다.

  let categoryResolvedMove: Move = speciesTypedMove;
  if (speciesTypedMove.dynamicCategoryByHigherDamage) {
    const dmgOpts = { attackerStages: c.attacker.stages, defenderStages: c.defender.stages };
    const physDmg =
      computeDamage(c.attacker.realStats, c.defender.realStats, c.attacker.types, { ...speciesTypedMove, category: "physical" }, dmgOpts)?.damage ?? 0;
    const specDmg =
      computeDamage(c.attacker.realStats, c.defender.realStats, c.attacker.types, { ...speciesTypedMove, category: "special" }, dmgOpts)?.damage ?? 0;
    c.shellSideArmCategory = physDmg > specDmg ? "physical" : specDmg > physDmg ? "special" : c.random() < 0.5 ? "physical" : "special";
    categoryResolvedMove = {
      ...speciesTypedMove,
      category: c.shellSideArmCategory,
      makesContact: c.shellSideArmCategory === "physical",
    };
  }

  // 웨더볼(날씨판 대지의파동): 날씨로 타입·위력이 바뀐다. 웨더볼과 fieldPulse를 동시에 갖는
  // 기술은 없어 순차 적용해도 안전하다. 메가솔라 보유자는 날씨와 무관하게 쾌청으로 취급한다.
  const weatherForOwnMoves = c.attackerAbility?.treatsOwnWeatherAsSun ? "쾌청" : activeWeather(c.state);
  const weatherBall = applyWeatherBall(categoryResolvedMove, weatherForOwnMoves);
  const moveAfterWeatherBall: Move = { ...categoryResolvedMove, type: weatherBall.type, power: weatherBall.power };

  // 필드 조건부 타입/위력 변경(대지의파동=fieldPulse, 미스트버스트·와이드포스·라이징볼트=
  // powerMultiplierInField)을 특성 배율 계산보다 먼저 반영한다 — 타입이 바뀐 상태여야
  // resolveMoveContext 안의 상성 계산(getEffectiveness)에도 바뀐 타입이 들어간다. 둘 중
  // 한 기술이 두 속성을 동시에 갖는 경우는 없어서(대지의파동만 fieldPulse, 나머지 셋만
  // powerMultiplierInField) 순서·중복 곱셈 걱정 없이 그냥 합쳐도 안전하다.
  // 필드 효과라 접지 조건(ver.1.8): 대지의파동·미스트버스트·와이드포스는 사용자, 라이징볼트는 상대가 땅에 있을 때만
  const attackerGrounded = isGrounded(c.state, c.attacker, c.attackerAbility);
  const fieldPulse = applyFieldPulse(moveAfterWeatherBall, c.state.field, attackerGrounded);
  const fieldPowerMultiplier = getFieldPowerMultiplier(
    moveAfterWeatherBall,
    c.state.field,
    attackerGrounded,
    isGrounded(c.state, c.defender, c.defenderAbility),
  );
  // 애널라이즈(대상보다 늦게 행동)·잠복(이번 턴 교체해 들어온 대상) — ver.1.9 A5
  const analyticMultiplier = c.movesSecond ? (c.attackerAbility?.powerMultiplierWhenMovingLast ?? 1) : 1;
  const stakeoutMultiplier = c.defender.enteredThisTurn ? (c.attackerAbility?.powerMultiplierVsSwitchedIn ?? 1) : 1;
  const fieldAdjustedMove: Move = {
    ...moveAfterWeatherBall,
    type: fieldPulse.type,
    power:
      fieldPulse.power === null ? null : Math.round(fieldPulse.power * fieldPowerMultiplier * analyticMultiplier * stakeoutMultiplier),
  };

  // evaluateSlotMatchup(1턴 스냅샷 판정)과 같은 로직을 공유 — 특성 배율/타입 변경/자속/상대 상성
  const _d0 = resolveMoveContext(c.attackerAbility, fieldAdjustedMove, c.defender.types, c.defenderAbility, {
    weather: activeWeather(c.state),
    defenderItem: c.defenderItem,
    defenderGrounded: isGrounded(c.state, c.defender, c.defenderAbility),
    attackerHpFraction: c.attacker.currentHp / c.attacker.maxHp,
    defenderHpIsFull: c.defender.currentHp === c.defender.maxHp,
    defenderHasStatusCondition: c.defender.status.condition !== null,
    field: c.state.field,
  });
  c.contextEffectiveMove = _d0.effectiveMove;
  c.abilityOffenseMultiplier = _d0.abilityOffenseMultiplier;
  c.statOffenseMultiplier = _d0.statOffenseMultiplier;
  c.abilityDefenseMultiplier = _d0.abilityDefenseMultiplier;
  c.finalDefenseMultiplier = _d0.finalDefenseMultiplier;
  c.stabMultiplier = _d0.stabMultiplier;
  c.typeEffectiveness = _d0.typeEffectiveness;
  c.absorbedByDefenderAbility = _d0.absorbedByDefenderAbility;
}

/** 우격다짐·기사회생·분화·자이로볼·내던지기·성묘·집단구타·일격기 등 가변 위력 */
function resolveVariablePower(c: PreHitCtx) {

  // 우격다짐: 데미지 기술에 "상대에게 해로운"(상태이상/행동방해/랭크다운) 또는 "자신에게 이로운"
  // (자기 랭크업) 부가 효과가 있으면 그 효과를 전부 없애는 대신 위력에 배수를 곱한다. 반동
  // (recoilFraction)·자기 디메리트(자기 랭크다운·행동불능 예약 등)는 "부가 효과"가 아니라서
  // 손대지 않는다 — 플레어드라이브가 반동은 그대로 받으면서 화상만 사라지고 위력이 오르는 것과
  // 같은 축(사용자 확인). 급소율(highCritRatio)도 버프/디버프가 아니라 대상이 아니다.
  c.effectiveMove = c.contextEffectiveMove;

  if (c.attackerAbility?.tradesSecondaryEffectForPower && hasSheerForceSecondaryEffect(c.effectiveMove)) {
    c.effectiveMove = {
      ...c.effectiveMove,
      power:
        c.effectiveMove.power !== null
          ? Math.round(c.effectiveMove.power * c.attackerAbility.tradesSecondaryEffectForPower)
          : c.effectiveMove.power,
      inflictsStatus: undefined,
      // target: "self"인 항목(반동성 자기 예약 등)은 그대로 두고, 상대를 향한 것만 제거한다.
      inflictsVolatile: c.effectiveMove.inflictsVolatile?.filter((v) => v.target !== "opponent"),
      // 상대 랭크다운(target: opponent)과 자기 랭크업(target: self, delta > 0)만 제거 — 자기
      // 랭크다운(디메리트)은 "부가 효과"가 아니라서 그대로 유지된다.
      statChanges: c.effectiveMove.statChanges?.filter(
        (s) => !(s.target === "opponent" || (s.target === "self" && (s.delta ?? 0) > 0)),
      ),
    };
    c.sheerForceAbilityName = c.attackerAbility.name;
  }

  // 기사회생(Reversal)·바둥바둥(Flail, F-2): power가 null인 채로 오고, 사용자의 현재 HP 비율에 따라 위력이 정해진다.
  if (c.effectiveMove.reversalPower) {
    c.effectiveMove = { ...c.effectiveMove, power: reversalPowerFromHp(c.attacker.currentHp, c.attacker.maxHp) };
  }
  // 분화·해수스파우팅(ver.1.9): 위력 = max(1, ⌊최대 위력 × 현재 HP ÷ 최대 HP⌋)
  if (c.effectiveMove.userHpScaledPower) {
    c.effectiveMove = { ...c.effectiveMove, power: userHpScaledPowerValue(c.effectiveMove.userHpScaledPower, c.attacker.currentHp / c.attacker.maxHp) };
  }
  // 자이로볼(§3-1a): 상대가 느릴수록 강하다. 자신·상대의 실효 스피드로 위력을 정한다.
  if (c.effectiveMove.gyroBallPower) {
    c.effectiveMove = {
      ...c.effectiveMove,
      power: gyroBallPowerValue(c.attacker, c.defender, c.attackerItem, c.defenderItem),
    };
  }
  // 내던지기(트랙 M5): 지닌 도구(서투름·매직룸이면 없음)를 던진다 — 위력은 도구의 flingPower, 도구는 이 시점에 소모.
  // 던질 도구가 없으면 실패. 던진 도구의 효과(상태이상·열매 등)는 resolveAction이 맞은 뒤에 적용한다.

  if (c.effectiveMove.flingsHeldItem) {
    const thrown = c.attackerItem;
    if (!thrown?.flingPower) return { value: c.blocked("usageCondition") };
    c.flungItemId = thrown.id;
    c.effectiveMove = { ...c.effectiveMove, power: thrown.flingPower };
    consumeItem(c.attacker);
    c.attackerItem = undefined;
  }

  // 성묘(트랙 L): 쓰러진 같은 편 수만큼 위력이 오른다(사용 시점, 자신 제외)
  if (c.effectiveMove.powerPerFaintedAlly && c.effectiveMove.power !== null) {
    const fainted = sideOf(c.state, c.actorKey).party.filter((f) => f !== c.attacker && isFainted(f)).length;
    c.effectiveMove = { ...c.effectiveMove, power: faintedAllyPowerValue(c.effectiveMove.power, c.effectiveMove.powerPerFaintedAlly, fainted) };
  }

  // 집단구타(트랙 M6): 파티원마다 1타(위력 5 + 종족값 공격/10)
  if (c.effectiveMove.beatUpPower) {
    const party = sideOf(c.state, c.actorKey).party;
    const hitters = party.filter((f) => f === c.attacker || (!isFainted(f) && !f.status.condition));
    const powers = hitters.map((f) => 5 + Math.floor((getPokemon(f.slot.pokemonId)?.baseStats.atk ?? 0) / 10));
    c.effectiveMove = { ...c.effectiveMove, power: powers[0], multiHitPowers: powers, minHits: powers.length, maxHits: powers.length };
  }

  // 트랙 M5: 일렉트릭볼(스피드 비율)·하드프레스(상대 남은 HP) 위력, 분노의앞니(상대 HP 절반)·목숨걸기(내 HP) 고정 데미지
  if (c.effectiveMove.electroBallPower) {
    c.effectiveMove = { ...c.effectiveMove, power: electroBallPowerValue(c.attacker, c.defender, c.attackerItem, c.defenderItem) };
  }
  if (c.effectiveMove.targetHpRatioPower) {
    c.effectiveMove = {
      ...c.effectiveMove,
      power: targetHpRatioPowerValue(c.effectiveMove.targetHpRatioPower, c.defender.currentHp, c.defender.maxHp),
    };
  }
  if (c.effectiveMove.halvesTargetHp) {
    c.effectiveMove = { ...c.effectiveMove, fixedDamage: Math.max(1, Math.floor(c.defender.currentHp / 2)) };
  }
  if (c.effectiveMove.damageEqualsUserHp) {
    c.effectiveMove = { ...c.effectiveMove, fixedDamage: c.attacker.currentHp };
  }
  // 일격기(트랙 M5): 상대 현재 HP만큼. 옹골참·면역 타입(절대영도 → 얼음)이면 아무 일도 없다.

  c.ohkoImmune = false;
  if (c.effectiveMove.oneHitKo) {
    if (c.defenderAbility?.immuneToOhko) {
      c.ohkoBlockedByAbilityName = c.defenderAbility.name;
    } else if (c.effectiveMove.oneHitKo.immuneType && c.defender.types.includes(c.effectiveMove.oneHitKo.immuneType)) {
      c.ohkoImmune = true;
    } else {
      c.effectiveMove = { ...c.effectiveMove, fixedDamage: c.defender.currentHp };
    }
  }
}

/** 기어오르기·토해내기·몸무게 위력·눈사태/보복·솔라빔·투쟁심 등 조건부 위력과 배율 */
function applyConditionalPower(c: PreHitCtx) {
  // 기어오르기·어시스트파워(§3-1a): 자신의 양수 랭크 합계로 위력이 오른다.
  if (c.effectiveMove.powerFromPositiveStages) {
    const { base, perStage } = c.effectiveMove.powerFromPositiveStages;
    c.effectiveMove = { ...c.effectiveMove, power: positiveStagesPowerValue(c.attacker.stages, base, perStage) };
  }
  // 토해내기(§3 증분 B-3): 위력 = 비축 스택 × 100. 스택·랭크 소비는 아래 usedMoveIds 기록 지점에서.
  if (c.effectiveMove.spitUpPower) {
    c.effectiveMove = { ...c.effectiveMove, power: (c.attacker.stockpileCount ?? 0) * 100 };
  }
  // 헤비봄버·히트스탬프 / 풀묶기·안다리걸기(§3-6): 몸무게 기반 위력. 실제로 메가진화한 상태일
  // 때만(§4) 그 폼의 몸무게를 쓴다 — 스톤만 들고 선언 전이면 기본 폼 몸무게. weightKg 미입력이면 폴백.
  const weightOf = (fighter: BattleFighterState): number | undefined => {
    const pk = getPokemon(fighter.slot.pokemonId);
    const baseKg = pk
      ? getEffectiveForm(pk, fighter.slot, { ignoreMega: !fighter.hasMegaEvolved }).weightKg
      : undefined;
    if (baseKg === undefined) return undefined;
    // 헤비메탈(2)·라이트메탈(0.5): 자신의 몸무게에 배율을 곱한다.
    const mult = abilityOf(fighter)?.weightMultiplier ?? 1;
    return baseKg * mult;
  };
  if (c.effectiveMove.weightRatioPower) {
    const userKg = weightOf(c.attacker);
    const targetKg = weightOf(c.defender);
    c.effectiveMove = {
      ...c.effectiveMove,
      power:
        userKg !== undefined && targetKg !== undefined
          ? weightRatioPowerValue(userKg, targetKg)
          : WEIGHT_MOVE_FALLBACK_POWER,
    };
  }
  if (c.effectiveMove.targetAbsoluteWeightPower) {
    const targetKg = weightOf(c.defender);
    c.effectiveMove = {
      ...c.effectiveMove,
      power: targetKg !== undefined ? absoluteWeightPowerValue(targetKg) : WEIGHT_MOVE_FALLBACK_POWER,
    };
  }
  // 눈사태·보복·애크러뱃(§3 증분 C): 조건 충족 시 위력 2배.
  // 분함의발구르기·열불내기("user-move-failed-last-turn", ver.1.9): 직전 턴 자기 행동이 실패였으면(lastTurnMoveFailed).
  // 분풀이("user-stat-lowered-this-turn", ver.1.9): 턴 시작 랭크(statStagesAtTurnStart)보다 떨어진 능력이 있으면.
  // 승부굳히기("target-damaged-this-turn", ver.1.9): 대상 HP가 이번 턴 시작(hpAtTurnStart)보다 줄었으면.
  if (c.effectiveMove.conditionalDoublePower && c.effectiveMove.power !== null) {
    const condition = c.effectiveMove.conditionalDoublePower;
    const met =
      condition === "took-damage-this-turn"
        ? (c.attacker.damageTakenThisTurn?.physical ?? 0) + (c.attacker.damageTakenThisTurn?.special ?? 0) > 0
        : condition === "moves-after-target"
          ? c.movesSecond
          : condition === "user-has-no-item"
            ? !c.attacker.currentItemId
            : condition === "user-status-burn-poison-paralysis"
              ? c.attacker.status.condition === "burn" ||
                c.attacker.status.condition === "poison" ||
                c.attacker.status.condition === "badly-poisoned" ||
                c.attacker.status.condition === "paralysis"
              : condition === "target-status-poisoned"
                ? c.defender.status.condition === "poison" || c.defender.status.condition === "badly-poisoned"
                : condition === "target-has-status"
                  ? !!c.defender.status.condition
                  : condition === "user-move-failed-last-turn"
                    ? !!c.attacker.lastTurnMoveFailed
                    : condition === "user-stat-lowered-this-turn"
                      ? statLoweredThisTurn(c.attacker)
                      : condition === "target-damaged-this-turn"
                        ? c.defender.hpAtTurnStart !== undefined && c.defender.currentHp < c.defender.hpAtTurnStart
                        : false;
    if (met) c.effectiveMove = { ...c.effectiveMove, power: c.effectiveMove.power * 2 };
  }

  // 솔라빔(§1-10): chargeSkipWeather(쾌청)가 아닌 날씨에서는 위력 절반. 메가솔라(치지직 등)로
  // 자신의 기술을 항상 쾌청 취급하면 여기서도 그 취급을 존중한다(§1-6의 준비 턴 스킵 판정과 동일 축).
  if (
    c.effectiveMove.halvesPowerOutsideChargeSkipWeather &&
    c.effectiveMove.power !== null &&
    c.effectiveMove.chargeSkipWeather !== undefined
  ) {
    const weatherMatchesSkipCondition =
      activeWeather(c.state) === c.effectiveMove.chargeSkipWeather ||
      (c.effectiveMove.chargeSkipWeather === "쾌청" && c.attackerAbility?.treatsOwnWeatherAsSun);
    if (!weatherMatchesSkipCondition) {
      c.effectiveMove = { ...c.effectiveMove, power: Math.floor(c.effectiveMove.power / 2) };
    }
  }

  // 플라잉프레스: 상대가 이번 배틀에서 작아지기를 쓴 적이 있으면 위력 2배(필중은 아래 hitChance에서).
  if (c.effectiveMove.bonusVsMinimize && c.effectiveMove.power !== null && c.defender.usedMoveIds?.["작아지기"]) {
    c.effectiveMove = { ...c.effectiveMove, power: c.effectiveMove.power * 2 };
  }

  // 분노의주먹(Rage Fist): 위력 = min(350, 50 + 50 × 이번 배틀에서 기술로 데미지를 받은 횟수).
  if (c.effectiveMove.rageFistPower && c.effectiveMove.power !== null) {
    c.effectiveMove = {
      ...c.effectiveMove,
      power: Math.min(350, 50 + 50 * (c.attacker.timesHitByMoves ?? 0)),
    };
  }

  // 변덕레이저(Fickle Beam): randomDoublePower% 확률로 위력 2배 + "전력을 다하기 시작했다!" 안내.
  c.fickleBeamEmpowered = false;
  if (
    c.effectiveMove.randomDoublePower !== undefined &&
    c.effectiveMove.power !== null &&
    c.random() * 100 < c.effectiveMove.randomDoublePower
  ) {
    c.effectiveMove = { ...c.effectiveMove, power: c.effectiveMove.power * 2 };
    c.fickleBeamEmpowered = true;
  }

  // G의힘(트랙 M4): 중력 중이면 위력 ×1.5
  if (c.effectiveMove.powerMultiplierInGravity && c.state.gravityTurnsRemaining !== undefined && c.effectiveMove.power !== null) {
    c.effectiveMove = { ...c.effectiveMove, power: Math.floor(c.effectiveMove.power * c.effectiveMove.powerMultiplierInGravity) };
  }

  // 전기로바꾸기(Electromorphosis): 충전 상태에서 쓰는 전기타입 기술은 위력 2배(1회 소모).

  if (
    c.attacker.electroChargedForElectric &&
    c.effectiveMove.type === "전기" &&
    c.effectiveMove.power !== null
  ) {
    c.effectiveMove = { ...c.effectiveMove, power: c.effectiveMove.power * 2 };
    c.attacker.electroChargedForElectric = false;
    c.electromorphosisEmpoweredAbilityName = c.attackerAbility?.name;
  }

  // 타오르는불꽃 발동 이후로 자신(=현재 공격자)이 쓰는 그 타입 기술의 위력이 올라있으면 반영.
  // 절대 타입이 null인 기술(발버둥 등)은 boosts 조회 자체를 건너뛴다.
  c.ownMoveTypeBoostMultiplier = (c.effectiveMove.type ? c.attacker.ownMoveTypeBoosts[c.effectiveMove.type] : undefined) ?? 1;

  // 투쟁심: 상대와 성별이 같으면 ×1.25, 다르면 ×0.75, 어느 한쪽이라도 성별 불명이면 ×1.0.
  c.rivalryMultiplier = rivalryDamageMultiplier(c.attackerAbility, c.attacker.gender, c.defender.gender);
}

/** 사용 확정 시점의 기록: 메트로놈·구애류 잠금·비축·배틀스위치·변환자재·젬·대검돌격 */
function recordUsageEffects(c: PreHitCtx) {

  // 메트로놈(연속 같은 기술 위력 증가)용 스트릭 갱신 — 여기까지 왔다는 건 앞의 모든 행동방해
  // 판정(상태이상/풀죽음/반동/혼란/차지 등)을 통과해서 실제로 이 기술을 쓴다는 뜻이라, 명중 여부와
  // 무관하게 여기서 갱신한다(본가 규칙 — 빗나가도 스트릭은 유지되고, 다른 기술을 쓰면 끊긴다).
  c.attacker.lastMoveStreak = c.attacker.lastMoveId === c.effectiveMove.id ? (c.attacker.lastMoveStreak ?? 1) + 1 : 1;
  c.attacker.lastMoveId = c.effectiveMove.id;
  if (c.effectiveMove.id !== STRUGGLE_MOVE.id) c.state.lastMoveUsedId = c.effectiveMove.id;
  // 구애류: 지금 지닌 도구가 구애류면 이 기술로 잠긴다(이미 잠겼으면 그대로). 발버둥은 잠그지 않는다.
  if (c.attackerItem?.locksFirstMoveUsed && !c.attacker.choiceLockedMoveId && c.effectiveMove.id !== STRUGGLE_MOVE.id) {
    c.attacker.choiceLockedMoveId = c.effectiveMove.id;
  }

  // 거대해머(cannotUseConsecutively): 실제로 이 기술로 행동을 개시했으니 "다음 턴엔 잠금" 예약.
  // usageCondition 게이트(섹션 0)는 이 기록과 현재 턴 번호가 정확히 일치할 때만 실패시킨다.
  if (c.effectiveMove.cannotUseConsecutively) {
    c.attacker.consecutiveLockMoveId = c.effectiveMove.id;
    c.attacker.consecutiveLockUntilTurn = c.state.turnNumber + 1;
  }

  // 비장의무기 사용 조건용 — "이 기술로 행동을 개시했다"를 여기서 기록(명중 여부 무관).
  (c.attacker.usedMoveIds ??= {})[c.effectiveMove.id] = true;

  // 비축하기: 스택 +1 (3스택 초과는 위 usageCondition 게이트에서 이미 실패). 방어·특방 랭크업은
  // 데이터의 statChanges로 처리된다.
  if (c.effectiveMove.addsStockpile) {
    c.attacker.stockpileCount = Math.min(3, (c.attacker.stockpileCount ?? 0) + 1);
  }
  // 토해내기: 사용 즉시 비축 스택을 0으로 되돌리고, 비축하기로 올렸던 방어·특방 랭크도 그만큼 내린다.
  // (위에서 이미 스택 수로 위력을 확정한 뒤라 여기서 소비해도 안전.)
  if (c.effectiveMove.spitUpPower) {
    const spent = c.attacker.stockpileCount ?? 0;
    c.attacker.stockpileCount = 0;
    if (spent > 0) {
      c.attacker.stages = applyStageDelta(applyStageDelta(c.attacker.stages, "def", -spent), "spd", -spent);
    }
  }

  // 배틀스위치(킬가르도): 여기까지 왔다는 건 이번 기술을 실제로 사용한다는 뜻이라(위 lastMoveStreak
  // 주석과 동일한 근거), 명중 여부와 무관하게 폼이 바뀐다 — 데미지 기술이면 블레이드폼(공격/특공↑),
  // 킹실드(revertMoveId)를 쓰면 실드폼으로 되돌아간다. 그 외 변화기는 폼을 유지한다(본가 규칙 —
  // 킹실드만 실드폼 복귀 트리거고 다른 변화기는 폼에 영향 없음). 이 스탯 재계산은 데미지 계산보다
  // 먼저 일어나야 이번 공격 자체에 새 폼의 실수치가 반영된다.
  if (c.attacker.stanceChangeForms) {
    const forms = c.attacker.stanceChangeForms;
    const nextForm: "shield" | "blade" =
      c.effectiveMove.id === forms.revertMoveId
        ? "shield"
        : c.effectiveMove.category !== "status"
          ? "blade"
          : (c.attacker.currentStanceForm ?? "shield");
    if (nextForm !== c.attacker.currentStanceForm) {
      const nextBaseStats = nextForm === "blade" ? forms.bladeBaseStats : forms.shieldBaseStats;
      c.attacker.realStats = computeRealStats(nextBaseStats, c.attacker.slot.points, c.attacker.slot.nature);
      c.attacker.currentStanceForm = nextForm;
    }
  }

  // 변환자재/리베로: 여기까지 왔다는 건 상태이상·행동방해를 뚫고 실제로 이 기술을 쓴다는 뜻이라,
  // 명중 여부와 무관하게 자신의 타입이 이 기술의 타입으로 바뀐다(사용자 확인 — 실제로 타입이
  // 바뀌어서 이후 턴 방어에도 반영된다). **발동은 이번 등장 스탠스에서 1회뿐(본가 9세대)** —
  // 첫 기술 이후엔 다른 타입 기술을 써도 안 바뀌고, 교체로 물러났다 다시 나오면 다시 1회 가능.
  // attacker.types를 그 자리에서 통째로 갈아치우는 것뿐이라 이후 이 값을 읽는 모든 곳(이번 턴의
  // 자속 판정은 물론, 다음 턴 이 포켓몬이 방어측이 될 때 defender.types로 쓰이는 것까지)에 자동
  // 반영된다. 발버둥처럼 타입이 없는(null) 기술은 바뀌지 않는다(본가와 동일).


  if (
    c.attackerAbility?.changesUserTypeToMoveType &&
    c.effectiveMove.type &&
    !c.attacker.proteanActivatedSinceSwitchIn
  ) {
    c.attacker.types = [c.effectiveMove.type];
    c.attacker.proteanActivatedSinceSwitchIn = true;
    c.changedOwnTypeTo = c.effectiveMove.type;
    c.changedOwnTypeAbilityName = c.attackerAbility.name;
  }

  // 전광쌍격(Move.losesTypeAfterUse): 변환자재와 같은 시점 — 실제로 이 기술을 쓰면(명중·빗나감
  // 무관) 사용자의 타입 목록에서 지정 타입(전기)이 빠진다. 이미 그 타입이 아니면 아무 일도
  // 없다. 두 타입이면 나머지 하나만, 단일 타입이면 빈 배열(무타입)이 된다 — getEffectiveness가
  // 빈 배열에 등배(1)를 돌려줘서 상성·자속이 전부 사라지는 형태로 안전하게 처리된다. 교체해도
  // 돌아오지 않는다(changedOwnTypeTo와 같은 취급).

  if (c.effectiveMove.losesTypeAfterUse && c.attacker.types.includes(c.effectiveMove.losesTypeAfterUse)) {
    c.attacker.types = c.attacker.types.filter((t) => t !== c.effectiveMove.losesTypeAfterUse);
    c.lostTypeAfterUse = c.effectiveMove.losesTypeAfterUse;
  }

  // 대검돌격(Move.glaiveRush): 실제로 이 기술을 쓰면(명중·빗나감 무관) "다음 자기 행동 전까지"
  // 피격 필중·피해 2배 상태가 된다. 위 resolveAction 최상단에서 이 공격자가 다시 행동을
  // 개시할 때 해제된다.
  if (c.effectiveMove.glaiveRush) c.attacker.glaiveRushVulnerable = true;

  // 노말주얼 등 타입 젬(Item.oneTimeGemMultiplier): 대전 중 처음 이 타입의 데미지 기술을 쓰면
  // 위력이 오르고 그 즉시 소모된다 — 소모 자체는 "사용하는 순간" 일어나 명중·빗나감과 무관하다
  // (변환자재와 같은 시점). 다단히트 타마다 재판정하면 안 되므로 여기서 한 번만 판정해
  // gemMultiplier에 담고, resolveHit이 매 타 이 배율을 곱한다.
  const isDamagingMove =
    c.effectiveMove.category !== "status" &&
    (c.effectiveMove.power !== null || c.effectiveMove.fixedDamage !== undefined);
  c.gemMultiplier = 1;

  if (
    isDamagingMove &&
    c.effectiveMove.type &&
    c.attackerItem?.oneTimeGemMultiplier?.type === c.effectiveMove.type &&
    !c.attacker.itemConsumed
  ) {
    c.gemMultiplier = c.attackerItem.oneTimeGemMultiplier.multiplier;
    c.ateGemItemName = c.attackerItem.name;
    consumeItem(c.attacker);
  }
}

/** 명중 굴림과 빗나감 처리(록온·철제광선·무릎차기) */
function rollHit(c: PreHitCtx) {

  // 명중 확률(배율·회피율 예외·필중 조건)은 배틀 AI와 공유하는 computeBattleHitChance에서 계산한다.
  c.hitChance = computeBattleHitChance({
    state: c.state,
    attacker: c.attacker,
    defender: c.defender,
    move: c.effectiveMove,
    hustleCategory: c.move.category,
    attackerAbility: c.attackerAbility,
    defenderAbility: c.defenderAbility,
    attackerItem: c.attackerItem,
    defenderItem: c.defenderItem,
    attackerMovesSecond: c.movesSecond,
  });

  // 상대가 차지 기술 준비 턴(공중날기 등)으로 무적인 동안엔, bypassesHiding에 이 무적 종류가
  // 포함된 기술이 아닌 이상 조건 없이 빗나간다 — 명중률 굴림 자체를 건너뛴다.
  // 단, 상대를 겨냥하지 않는 기술(칼춤·방어·광합성 등 자기 대상)은 애초에 "빗나갈" 대상이 아니라서
  // 무적과 무관하게 정상 발동한다(§1 E-1 버그 수정).
  c.defenderHideType = c.defender.chargingMoveId ? getMove(c.defender.chargingMoveId)?.chargeHideType : undefined;
  c.evadedByCharge = !!c.defenderHideType &&
    !(c.effectiveMove.bypassesHiding ?? []).includes(c.defenderHideType) &&
    isOpponentTargetingMove(c.effectiveMove);

  // 대검돌격: 방어측이 이 상태면(직전에 대검돌격을 쓴 뒤 아직 다음 행동 전) 그를 겨냥한
  // 기술의 명중 굴림을 건너뛴다(반드시 명중). 무적(evadedByCharge)은 그대로 존중한다.
  const glaiveRushGuaranteesHit = c.defender.glaiveRushVulnerable && isOpponentTargetingMove(c.effectiveMove);
  // 매직미러로 되돌릴 기술은 명중 굴림을 건너뛴다(반사는 빗나가지 않는다).
  c.hit = c.bouncedByMagicMirror
    ? true
    : c.evadedByCharge
      ? false
      : c.hitChance === null
        ? true
        : glaiveRushGuaranteesHit
          ? true
          : c.random() < c.hitChance;
  // 록온(트랙 M6): 걸어둔 다음 행동 한 번으로 소모된다
  if (hasVolatile(c.attacker.volatile, "lockOn") && !c.effectiveMove.inflictsVolatile?.some((v) => v.volatile === "lockOn")) {
    const active = { ...c.attacker.volatile.active };
    delete active.lockOn;
    c.attacker.volatile = { active };
  }

  // 철제광선: "사용하는 순간" 명중·빗나감과 무관하게 사용자가 최대 HP의 절반을 잃는다(E-3).
  c.selfDamageOnUse = 0;
  // 매직가드(ver.1.9 A5): 철제광선의 HP 손실도 막는다(본가)
  if (c.effectiveMove.selfDamageFractionOnUse !== undefined && !c.attackerAbility?.negatesIndirectDamage) {
    c.selfDamageOnUse = Math.floor(c.attacker.maxHp * c.effectiveMove.selfDamageFractionOnUse);
    c.attacker.currentHp = Math.max(0, c.attacker.currentHp - c.selfDamageOnUse);
  }

  if (!c.hit) {
    // 자폭류(대폭발 등)는 빗나가도 사용자가 반드시 기절한다 (본가 규칙). 데미지가 아예 없는
    // 경로라 승자 판정에 영향을 줄 순서 문제도 없다 — 그냥 여기서 바로 처리해도 된다.
    if (c.effectiveMove.selfFaints) {
      c.attacker.currentHp = 0;
    }
    // 무릎차기: 빗나가면 사용자가 최대 HP 절반을 잃는다(E-2). "의욕이 넘쳐 땅에 부딪혔다!"
    let crashDamage = 0;
    // 매직가드(ver.1.9 A5): 무릎차기류 빗나감 손실도 막는다(본가)
    if (c.effectiveMove.crashFraction !== undefined && !c.attackerAbility?.negatesIndirectDamage) {
      crashDamage = Math.floor(c.attacker.maxHp * c.effectiveMove.crashFraction);
      c.attacker.currentHp = Math.max(0, c.attacker.currentHp - crashDamage);
    }
    return { value: {
      actor: c.actorKey,
      actorPokemonId: c.actorPokemonId,
      defenderPokemonId: c.defenderPokemonId,
      move: c.move,
      hit: c.hit,
      critical: false,
      damage: 0,
      damagePercent: 0,
      typeEffectiveness: c.typeEffectiveness,
      defenderRemainingHp: c.defender.currentHp,
      selfDamage: 0,
      attackerRemainingHp: c.attacker.currentHp,
      fainted: false,
      selfFainted: isFainted(c.attacker),
      recoilDamage: 0,
      evadedByCharge: c.evadedByCharge,
      crashDamage: crashDamage || undefined,
      selfDamageOnUse: c.selfDamageOnUse || undefined,
      leppaRestoredPpItemName: c.leppaRestoredPpItemName,
      // 변환자재/리베로는 명중 굴림 전에 이미 발동했다 — 빗나가도 타입은 바뀌고 로그 문구도 나와야 한다.
      changedOwnTypeTo: c.changedOwnTypeTo,
      changedOwnTypeAbilityName: c.changedOwnTypeAbilityName,
      // 전광쌍격 타입 소실·대검돌격 약점도 명중 굴림 전에 확정된다(빗나가도 적용).
      lostTypeAfterUse: c.lostTypeAfterUse,
      glaiveRushArmed: c.effectiveMove.glaiveRush || undefined,
      // 타입 젬도 명중 굴림 전에 이미 소모됐다(빗나가도 소모된 채로 남는다).
      ateGemItemName: c.ateGemItemName,
    } };
  }
}

/** 타오르는불꽃·피뢰침 등 명중 시점의 특성 반응 */
function applyHitReactions(c: PreHitCtx) {

  // 타오르는불꽃/피뢰침: 명중한 시점에 카테고리 무관(상태이상 기술도 포함)으로 발동한다 — 위에서
  // 이미 typeEffectiveness를 0으로 덮어써놨으니 데미지 계산 쪽은 자연히 0이 되고, 여기서는
  // 그 즉시 랭크 변화 + (있다면) 자기 타입 기술 위력 상승 플래그만 별도로 적용하면 된다.


  c.abilityAbsorbHealAmount = 0;
  if (c.absorbedByDefenderAbility && c.defenderAbility?.absorbsType) {
    const absorb = c.defenderAbility.absorbsType;
    c.abilityAbsorbedMoveType = absorb.type;
    c.abilityAbsorbAbilityName = c.defenderAbility.name;
    if (absorb.selfStatChanges) {
      for (const change of absorb.selfStatChanges) {
        c.defender.stages = applyStageDelta(c.defender.stages, change.stat, contraryDelta(c.defender, change.delta));
      }
    }
    if (absorb.boostsOwnMoveTypeMultiplier) {
      c.defender.ownMoveTypeBoosts = { ...c.defender.ownMoveTypeBoosts, [absorb.type]: absorb.boostsOwnMoveTypeMultiplier };
    }
    // 저수: 랭크업 대신 무효화한 그 즉시 최대 HP 비율만큼 회복한다.
    if (absorb.healsFraction) {
      c.abilityAbsorbHealAmount = Math.min(
        c.defender.maxHp - c.defender.currentHp,
        Math.floor(c.defender.maxHp * absorb.healsFraction),
      );
      c.defender.currentHp += c.abilityAbsorbHealAmount;
    }
  }
}

/** 킹실드·니들가드·토치카 — 접촉기를 막아냈을 때의 반응 */
function applyProtectReactions(c: PreHitCtx) {

  // 킹실드/니들가드: 접촉기를 막아냈을 때만 공격측에게 반동을 건다 — 킹실드는 랭크변화(공격 -1),
  // 니들가드는 최대 HP 1/8 데미지. 막지 못했거나(blockedByProtect === false) 접촉기가 아니면 없다.

  c.protectContactDamage = 0;

  // 보이지않는주먹으로 뚫고 들어간 경우(unseenFistPiercing)도 방어류의 접촉 성공 부가효과는 발동한다.
  if ((c.blockedByProtect || c.unseenFistPiercing) && c.defender.activeProtect && (c.effectiveMove.makesContact ?? false)) {
    const ap = c.defender.activeProtect;
    if (ap.contactPenalty) {
      c.attacker.stages = applyStageDelta(c.attacker.stages, ap.contactPenalty.stat, contraryDelta(c.attacker, ap.contactPenalty.delta));
      c.protectContactPenaltyMoveName = ap.moveName;
    }
    // 니들가드 접촉 데미지 — 공격측이 매직가드면 무효(까칠한피부·록키헬멧과 같은 축).
    if (ap.contactDamageFraction && !c.attackerAbility?.negatesIndirectDamage) {
      const amount = Math.floor(c.attacker.maxHp * ap.contactDamageFraction);
      c.attacker.currentHp = Math.max(0, c.attacker.currentHp - amount);
      c.protectContactDamage = amount;
      c.protectContactPenaltyMoveName = ap.moveName;
    }
    // 토치카: 접촉기를 막으면 공격자를 독 상태로 만든다(타입/특성 면역·필드 존중).
    if (
      ap.contactStatus &&
      !isImmuneToStatus(ap.contactStatus, c.attacker.types, statusImmunitiesOf(c.attacker, c.attackerAbility)) &&
      !isStatusBlockedByField(c.state.field, ap.contactStatus, isGrounded(c.state, c.attacker, c.attackerAbility)) &&
      sideOf(c.state, c.actorKey).safeguardTurnsRemaining === undefined
    ) {
      const before = c.attacker.status.condition;
      c.attacker.status = inflictStatus(c.attacker.status, ap.contactStatus);
      if (c.attacker.status.condition !== before) {
        c.protectContactInflictedStatus = c.attacker.status.condition;
        c.protectContactPenaltyMoveName = ap.moveName;
      }
    }
  }
}

/** 결과를 모아 돌려준다 */
function collectResult(c: PreHitCtx) {
  return {
    move: c.move, chargeStatRises: c.chargeStatRises, defenderKey: c.defenderKey, attacker: c.attacker, defender: c.defender, defenderHpAtActionStart: c.defenderHpAtActionStart, actorPokemonId: c.actorPokemonId, defenderPokemonId: c.defenderPokemonId, attackerAbility: c.attackerAbility, defenderAbility: c.defenderAbility, attackerBerriesBlocked: c.attackerBerriesBlocked, defenderBerriesBlocked: c.defenderBerriesBlocked, attackerItemIdBeforeAction: c.attackerItemIdBeforeAction, defenderItemIdBeforeAction: c.defenderItemIdBeforeAction, leppaRestoredPpItemName: c.leppaRestoredPpItemName, pressureExtraPpAbilityName: c.pressureExtraPpAbilityName, selfCuredStatus: c.selfCuredStatus, sleepTalkCalledMoveName: c.sleepTalkCalledMoveName, copycatCalledMoveName: c.copycatCalledMoveName, ohkoBlockedByAbilityName: c.ohkoBlockedByAbilityName, ohkoImmune: c.ohkoImmune, flungItemId: c.flungItemId, attackerItem: c.attackerItem, defenderItem: c.defenderItem, blockedByGoodAsGold: c.blockedByGoodAsGold, blockedBySubstitute: c.blockedBySubstitute, blockedByPowderImmunity: c.blockedByPowderImmunity, unseenFistPiercing: c.unseenFistPiercing, blockedByProtect: c.blockedByProtect, blockedByProtectMoveName: c.blockedByProtectMoveName, soundproofBlockedByAbilityName: c.soundproofBlockedByAbilityName, bulletproofBlockedByAbilityName: c.bulletproofBlockedByAbilityName, opponentEffectsBlocked: c.opponentEffectsBlocked, bouncedByMagicMirror: c.bouncedByMagicMirror, shellSideArmCategory: c.shellSideArmCategory, abilityOffenseMultiplier: c.abilityOffenseMultiplier, statOffenseMultiplier: c.statOffenseMultiplier, abilityDefenseMultiplier: c.abilityDefenseMultiplier, finalDefenseMultiplier: c.finalDefenseMultiplier, stabMultiplier: c.stabMultiplier, typeEffectiveness: c.typeEffectiveness, effectiveMove: c.effectiveMove, sheerForceAbilityName: c.sheerForceAbilityName, fickleBeamEmpowered: c.fickleBeamEmpowered, electromorphosisEmpoweredAbilityName: c.electromorphosisEmpoweredAbilityName, ownMoveTypeBoostMultiplier: c.ownMoveTypeBoostMultiplier, rivalryMultiplier: c.rivalryMultiplier, changedOwnTypeTo: c.changedOwnTypeTo, changedOwnTypeAbilityName: c.changedOwnTypeAbilityName, lostTypeAfterUse: c.lostTypeAfterUse, gemMultiplier: c.gemMultiplier, ateGemItemName: c.ateGemItemName, hitChance: c.hitChance, defenderHideType: c.defenderHideType, evadedByCharge: c.evadedByCharge, hit: c.hit, selfDamageOnUse: c.selfDamageOnUse, abilityAbsorbedMoveType: c.abilityAbsorbedMoveType, abilityAbsorbAbilityName: c.abilityAbsorbAbilityName, abilityAbsorbHealAmount: c.abilityAbsorbHealAmount, protectContactPenaltyMoveName: c.protectContactPenaltyMoveName, protectContactDamage: c.protectContactDamage, protectContactInflictedStatus: c.protectContactInflictedStatus,
  };
}

export function resolvePreHitEffects(
  state: BattleState,
  actorKey: FighterKey,
  move: Move,
  random: () => number,
  movesSecond: boolean,
  defenderMove: Move,
) {
  const c = {} as PreHitCtx;
  c.actorKey = actorKey;
  c.state = state;
  c.move = move;
  c.movesSecond = movesSecond;
  c.defenderMove = defenderMove;
  c.random = random;

  c.defenderKey = opponentKey(c.actorKey);
  // 매직미러 반사 구간에서만 이 바인딩들을 통째로 맞바꾼다(let). 그 외에는 사실상 const처럼 쓰인다.
  c.attacker = c.state[c.actorKey];
  c.defender = c.state[c.defenderKey];
  // 위기회피(Emergency Exit): 이번 행동이 방어측 HP를 절반 초과→절반 이하로 넘겼는지 판정하려면
  // 행동 시작 시점의 방어측 HP가 필요하다(매직미러 스왑 전 값 — EE는 원래 방어측 것).
  c.defenderHpAtActionStart = c.defender.currentHp;
  // 로그 이름용 — 행동/피격 시점의 활성 종 id(일루전 위장 반영). 아래 모든 return에 싣는다.
  c.actorPokemonId = c.attacker.illusionAs ?? c.attacker.slot.pokemonId;
  c.defenderPokemonId = c.defender.illusionAs ?? c.defender.slot.pokemonId;

  // 길동무: "다음 자신의 턴이 오면(행동불능인 턴 포함) 예약이 사라진다"는 본가 규칙 — 이 공격자의
  // 이번 턴 처리가 막 시작된 시점에 지난 턴 걸어둔 예약을 무조건 지운다. 이번 턴 다시 길동무를
  // 걸면(아래 protectEffect 판정 성공 시) 새로 켠다.
  c.attacker.destinyBondArmed = false;

  // 대검돌격: "다음 자기 행동 개시 전까지" 유지되는 피격 약점이라, 이 공격자가 다시 행동을
  // 개시하는 이 시점에 지운다(길동무와 같은 패턴). 같은 턴에 다시 대검돌격을 쓰면 아래에서
  // 새로 켜진다. 행동이 마비·풀죽음으로 막혀도 resolveAction엔 들어오므로 정상적으로 소진된다.
  c.attacker.glaiveRushVulnerable = undefined;

  // 차지 기술 2턴째: 준비 턴에 저장해둔 기술을 이번 턴 실제로 고른 기술과 무관하게 강제로
  // 재실행한다(본가 규칙 — UI에서도 이 경우 선택을 요구하지 않는다). PP는 준비 턴에 이미
  // 소모했으니 여기선 다시 깎지 않는다.
  c.releasingCharge = c.attacker.chargingMoveId !== undefined;
  if (c.releasingCharge) {
    const storedMove = getMove(c.attacker.chargingMoveId!);
    if (storedMove) c.move = storedMove;
    c.attacker.chargingMoveId = undefined;
  }
  setupAbilityBindings(c);
  payMovePp(c);
  {
    const r = checkUsageGates(c);
    if (r) return r.value;
  }
  {
    const r = checkActionBlockers(c);
    if (r) return r.value;
  }
  {
    const r = handleChargeAndCopyMoves(c);
    if (r) return r.value;
  }
  checkDefenderImmunities(c);
  resolveDynamicMoveType(c);
  {
    const r = resolveVariablePower(c);
    if (r) return r.value;
  }
  applyConditionalPower(c);
  recordUsageEffects(c);
  {
    const r = rollHit(c);
    if (r) return r.value;
  }
  applyHitReactions(c);
  applyProtectReactions(c);
  return collectResult(c);
}

/** 흉내쟁이(트랙 M2)가 따라 쓸 수 있는 기술인지 — AI(흉내쟁이 평가)도 같은 판정을 쓴다 */
export function isCopyableMove(move: Move): boolean {
  return !move.excludedFromCopycat && !move.callsLastMoveInBattle && !move.chargeTurn && !move.usageCondition;
}

/** 분풀이(ver.1.9): 이번 턴 시작 때보다 떨어진 능력 랭크가 있는지(턴 중 등장이면 기록이 없어 false) */
function statLoweredThisTurn(fighter: BattleFighterState): boolean {
  const before = fighter.statStagesAtTurnStart;
  if (!before) return false;
  return (Object.keys(before) as (keyof typeof before)[]).some((stat) => fighter.stages[stat] < before[stat]);
}
