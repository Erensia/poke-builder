import { type Move } from "@/types/move";
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
import { WEIGHT_MOVE_FALLBACK_POWER, absoluteWeightPowerValue, computeDamage, positiveStagesPowerValue, reversalPowerFromHp, rivalryDamageMultiplier, weightRatioPowerValue } from "@/lib/battlePower";
import { applyWeatherBall } from "@/lib/weatherEffects";
import { applyFieldPulse, getFieldPowerMultiplier, isOpponentTargetingMove, isPriorityMoveBlockedByField, isStatusBlockedByField } from "@/lib/fieldEffects";
import { computeBattleHitChance } from "./hitChance";
import { CONFUSION_SELF_HIT_MOVE, MIN_DAMAGE_ROLL, STRUGGLE_MOVE, abilityOf, activeWeather, consumeItem, contraryDelta, gyroBallPowerValue, hasSheerForceSecondaryEffect, isFainted, opponentKey, sideOf, statusImmunitiesOf, type BattleFighterState, type BattleState } from "./state";

export function resolvePreHitEffects(
  state: BattleState,
  actorKey: FighterKey,
  move: Move,
  random: () => number,
  movesSecond: boolean,
  defenderMove: Move,
) {
  const defenderKey = opponentKey(actorKey);
  // 매직미러 반사 구간에서만 이 바인딩들을 통째로 맞바꾼다(let). 그 외에는 사실상 const처럼 쓰인다.
  let attacker = state[actorKey];
  let defender = state[defenderKey];
  // 위기회피(Emergency Exit): 이번 행동이 방어측 HP를 절반 초과→절반 이하로 넘겼는지 판정하려면
  // 행동 시작 시점의 방어측 HP가 필요하다(매직미러 스왑 전 값 — EE는 원래 방어측 것).
  const defenderHpAtActionStart = defender.currentHp;
  // 로그 이름용 — 행동/피격 시점의 활성 종 id(일루전 위장 반영). 아래 모든 return에 싣는다.
  const actorPokemonId = attacker.illusionAs ?? attacker.slot.pokemonId;
  const defenderPokemonId = defender.illusionAs ?? defender.slot.pokemonId;

  // 길동무: "다음 자신의 턴이 오면(행동불능인 턴 포함) 예약이 사라진다"는 본가 규칙 — 이 공격자의
  // 이번 턴 처리가 막 시작된 시점에 지난 턴 걸어둔 예약을 무조건 지운다. 이번 턴 다시 길동무를
  // 걸면(아래 protectEffect 판정 성공 시) 새로 켠다.
  attacker.destinyBondArmed = false;

  // 대검돌격: "다음 자기 행동 개시 전까지" 유지되는 피격 약점이라, 이 공격자가 다시 행동을
  // 개시하는 이 시점에 지운다(길동무와 같은 패턴). 같은 턴에 다시 대검돌격을 쓰면 아래에서
  // 새로 켜진다. 행동이 마비·풀죽음으로 막혀도 resolveAction엔 들어오므로 정상적으로 소진된다.
  attacker.glaiveRushVulnerable = undefined;

  // 차지 기술 2턴째: 준비 턴에 저장해둔 기술을 이번 턴 실제로 고른 기술과 무관하게 강제로
  // 재실행한다(본가 규칙 — UI에서도 이 경우 선택을 요구하지 않는다). PP는 준비 턴에 이미
  // 소모했으니 여기선 다시 깎지 않는다.
  const releasingCharge = attacker.chargingMoveId !== undefined;
  if (releasingCharge) {
    const storedMove = getMove(attacker.chargingMoveId!);
    if (storedMove) move = storedMove;
    attacker.chargingMoveId = undefined;
  }

  // 송전: 지난(같은 턴 먼저 움직인) 상대가 송전을 성공시켰으면 이번 공격의 타입이 전기로 강제된다.
  // 자속·상성 전부 새 타입 기준으로 계산되도록 여기서 move 자체를 갈아끼운다(변화기는 제외).
  if (attacker.moveTypeOverrideThisTurn && move.category !== "status" && move.type !== null) {
    move = { ...move, type: attacker.moveTypeOverrideThisTurn };
  }

  // 오라휠(모르페코): 꼬르륵스위치 모양에 따라 타입을 전기/악으로 바꾼다(모양 없으면 full=전기).
  if (move.hungerSwitchType) {
    move = {
      ...move,
      type: attacker.hungerMode === "hangry" ? move.hungerSwitchType.hangry : move.hungerSwitchType.full,
    };
  }

  // 일찍기상(잠듦 해제 확률 스케줄에 필요)·습기(자폭기 차단, 아래 0번)는 상태이상 판정보다도
  // 먼저 필요해서, attackerAbility/defenderAbility 전체를 원래보다 앞당겨 여기서 구해둔다.
  const attackerHasEarlyBird = attacker.effectiveAbilityId === "일찍기상";
  // attackerAbility/defenderAbility도 매직미러 반사 구간에서 attacker/defender와 함께 맞바뀐다(let).
  let attackerAbility = attacker.effectiveAbilityId ? getAbility(attacker.effectiveAbilityId) : undefined;
  const rawDefenderAbility = defender.effectiveAbilityId ? getAbility(defender.effectiveAbilityId) : undefined;
  // 틀깨기: 공격측이 이 특성이면 예외 목록에 없는 한 방어측 특성 전체를 무효화한다 — 이 지점에서
  // 한 번만 치환해두면 modifiers·absorbsType·hitTrigger·blocksOpponentStatDropsForStats 등
  // defenderAbility를 참조하는 아래 코드 전부가 자동으로 반영된다. (매직미러도 이 예외 목록에서
  // 빠져 있어, 공격측이 틀깨기면 여기서 defenderAbility가 undefined가 되고 반사도 자연히 무산된다.)
  let defenderAbility = resolveEffectiveDefenderAbility(attackerAbility, rawDefenderAbility);

  // 원격(Long Reach): 공격측이 이 특성이면 이번 기술의 접촉 판정을 통째로 없앤다. 이후 아래
  // 모든 접촉 조건(hitTrigger·록키헬멧·단단한발톱·킹실드 접촉 페널티·부리캐논 화상 등)이
  // effectiveMove/move의 makesContact를 보므로, 여기서 move를 갈아끼우면 전부 자동 반영된다.
  if (attackerAbility?.movesIgnoreContact && move.makesContact) {
    move = { ...move, makesContact: false };
  }

  // 긴장감: "이 특성을 가진 쪽의 상대"가 나무열매를 못 쓴다 — 방향이 헷갈리기 쉬운데, 내(공격측)
  // 나무열매가 막히는 건 상대(방어측)가 긴장감을 가졌을 때고, 상대(방어측) 나무열매가 막히는 건
  // 내(공격측)가 긴장감을 가졌을 때다. defenderAbility는 이미 틀깨기가 반영된 값이라(긴장감은
  // 틀깨기 예외 목록에 없음), 틀깨기 소유자가 공격하면 상대의 긴장감도 자연히 무시된다.
  const attackerBerriesBlocked = !!defenderAbility?.preventsOpponentBerries;
  const defenderBerriesBlocked = !!attackerAbility?.preventsOpponentBerries;

  // 곡예: "도구를 잃은 순간" 발동 여부를 판정하려면 이번 행동 시작 시점의 currentItemId를
  // 미리 기억해둬야 한다(행동 도중 나무열매 소모나 매지션 강탈로 값이 바뀔 수 있어서).
  const attackerItemIdBeforeAction = attacker.currentItemId;
  const defenderItemIdBeforeAction = defender.currentItemId;

  // PP 소모는 행동 여부와 무관하게 발생(단, 차지 기술 2턴째는 위에서 이미 스킵 처리)
  let leppaRestoredPpItemName: string | undefined;
  if (!releasingCharge && attacker.remainingPp[move.id] !== undefined) {
    const ppBefore = attacker.remainingPp[move.id];
    attacker.remainingPp[move.id] = Math.max(0, ppBefore - 1);
    // 과사열매: 이번 사용으로 PP가 정확히 0이 됐을 때(원래 0이던 걸 또 쓴 게 아니라)만 발동한다.
    if (
      ppBefore > 0 &&
      attacker.remainingPp[move.id] === 0 &&
      !attacker.itemConsumed &&
      !attackerAbility?.disablesOwnItemEffects &&
      !defenderBerriesBlocked
    ) {
      const itemForPp = attacker.currentItemId ? getItem(attacker.currentItemId) : undefined;
      // 과사열매도 나무열매라 긴장감에 막힌다(위 조건에서 이미 확인) — restoresPpOnZero 자체가
      // 나무열매 전용 필드라 별도 태그 없이도 이 게이트 하나로 충분하다.
      if (itemForPp?.restoresPpOnZero) {
        attacker.remainingPp[move.id] = Math.min(move.pp, itemForPp.restoresPpOnZero);
        consumeItem(attacker);
        leppaRestoredPpItemName = itemForPp.name;
      }
    }
  }

  // 프레셔: 상대(defender)가 이 특성이면, 자신을 향한 기술이든 자기 자신에게 쓰는 변화기든
  // 가리지 않고(본가 규칙 — 프레셔는 "이 포켓몬이 필드에 있는 동안 상대가 쓰는 모든 기술"에
  // 적용된다) PP를 추가로 더 소모시킨다. 과사열매 재판정 없이 단순 차감만 한다.
  let pressureExtraPpAbilityName: string | undefined;
  if (defenderAbility?.extraPpCostWhenTargeted && !releasingCharge && attacker.remainingPp[move.id] !== undefined) {
    const before = attacker.remainingPp[move.id];
    attacker.remainingPp[move.id] = Math.max(0, before - defenderAbility.extraPpCostWhenTargeted);
    if (attacker.remainingPp[move.id] !== before) pressureExtraPpAbilityName = defenderAbility.name;
  }

  const blocked = (
    reason: ActionBlockReason,
    selfDamage = 0,
    extra?: Partial<ActionLogEntry>,
  ): ActionLogEntry => ({
    actor: actorKey,
    actorPokemonId,
    defenderPokemonId,
    move,
    blockedReason: reason,
    hit: false,
    critical: false,
    damage: 0,
    damagePercent: 0,
    typeEffectiveness: 1,
    defenderRemainingHp: defender.currentHp,
    selfDamage,
    attackerRemainingHp: attacker.currentHp,
    fainted: false,
    selfFainted: isFainted(attacker),
    recoilDamage: 0,
    leppaRestoredPpItemName,
    pressureExtraPpAbilityName,
    ...extra,
  });

  // 0) 사용 조건이 있는 기술(코골기=잠든 상태 전용, 속이기=첫 턴 전용). 상태이상/행동방해
  // 판정보다 먼저 확인한다 — 조건 자체를 못 채우면 애초에 시도조차 안 한 것으로 취급.
  // 속이기: 이 포켓몬이 등장한 뒤 처음 행동을 개시하는 턴에만 성공한다(리드의 1턴, 교체·유턴
  // 으로 나온 뒤 첫 행동 턴 등). 배틀 전체의 턴 번호가 아니라 파이터별 등장 후 행동 여부로 본다.
  if (move.usageCondition === "first-turn-only" && attacker.hasActedSinceSwitchIn) {
    return blocked("usageCondition");
  }
  // resolveAction이 이 파이터에 대해 돌았다는 건 이번 턴에 자기 행동을 개시했다는 뜻 —
  // 이후 usageCondition 실패로 막히거나 마비·풀죽음으로 못 움직여도 속이기 창은 소진된 것.
  attacker.hasActedSinceSwitchIn = true;
  // 아이언롤러: 활성화된 필드가 하나도 없으면 실패한다(본가 규칙)
  if (move.usageCondition === "field-required" && !state.field) {
    return blocked("usageCondition");
  }
  // 오로라베일: 지정된 날씨(눈)가 아니면 실패한다
  if (move.usageCondition === "weather-required" && activeWeather(state) !== move.requiresWeather) {
    return blocked("usageCondition");
  }
  // 비장의무기: 자신의 다른 기술(remainingPp에 등록된 id들)을 전부 한 번씩 사용하기 전까지는 실패.
  if (move.usageCondition === "all-other-moves-used") {
    const otherMoveIds = Object.keys(attacker.remainingPp).filter((id) => id !== move.id);
    const allUsed = otherMoveIds.every((id) => attacker.usedMoveIds?.[id]);
    if (!allUsed) return blocked("usageCondition");
  }
  // 토해내기: 비축 스택이 0이면 쓸 수 없다.
  if (move.spitUpPower && (attacker.stockpileCount ?? 0) === 0) {
    return blocked("usageCondition");
  }
  // 비축하기: 이미 3스택이면 더 비축할 수 없다(본가 규칙 — 실패 처리).
  if (move.addsStockpile && (attacker.stockpileCount ?? 0) >= 3) {
    return blocked("usageCondition");
  }
  // 거대해머: 직전 턴에 이 기술로 행동을 개시했으면(=consecutiveLock 기록의 턴 번호가 이번 턴과
  // 정확히 일치) 이번 턴엔 쓸 수 없다. 잠금은 "사용한 턴 + 1" 한 턴만 유효해 그 다음 턴부턴 다시 쓸 수 있다.
  if (
    move.cannotUseConsecutively &&
    attacker.consecutiveLockMoveId === move.id &&
    attacker.consecutiveLockUntilTurn === state.turnNumber
  ) {
    return blocked("usageCondition");
  }
  // 기습: 상대보다 먼저 움직이지 않으면(movesSecond) 실패, 상대가 이번 턴 고른 기술이
  // 데미지 기술(물리/특수)이 아니면(=변화기를 냈거나, 자기 자신의 usageCondition 미충족 등으로
  // 어차피 데미지를 안 낼 예정이면) 실패한다. 본가 규칙과 동일하게 defenderMove의 category만
  // 보고 판정 — 상대가 상태이상으로 실제 행동에 실패할지 여부까지는 반영하지 않는다(동시 비공개
  // 선택 방식이라 이 시뮬레이터 구조상 그 정보까지 반영하려면 판정 순서 자체를 바꿔야 함).
  if (
    move.usageCondition === "opponent-damaging-move-only" &&
    (movesSecond || (defenderMove.category !== "physical" && defenderMove.category !== "special"))
  ) {
    return blocked("usageCondition");
  }
  // 습기: 자신이든 상대든 이 특성이 있으면 자폭류 기술(대폭발 등) 자체를 쓸 수 없다.
  if (move.selfFaints && (attackerAbility?.preventsSelfFaintMoves || defenderAbility?.preventsSelfFaintMoves)) {
    return blocked("usageCondition");
  }

  // 1) 주 상태이상(잠듦/얼음/마비)으로 행동 자체가 막히는지. 잠듦/얼음은 이 판정 안에서
  // 자체 해제 카운터가 갱신되므로 결과를 attacker.status에 반드시 반영해야 한다.
  // 코골기처럼 "잠든 상태에서만" 쓸 수 있는 기술은 본가에서 잠듦이 행동을 막는 예외라,
  // 일반 잠듦 차단을 건너뛰고 별도로 처리한다 — 해제 판정/카운터 자체는 그대로 진행시킨다.
  const preActionStatus = attacker.status.condition;
  let selfCuredStatus: StatusConditionState["condition"] | undefined;

  // 1-1) 불사르기·열사의대지·플레어드라이브 등 "사용 직전 사용자의 얼음 상태를 치유한다" 기술은
  // 매턴 해제 확률 판정 없이 무조건 먼저 해동된 뒤 기술이 정상적으로 나간다.
  if (attacker.status.condition === "freeze" && move.thawsUserOnUse) {
    attacker.status = { ...NO_STATUS_CONDITION };
    selfCuredStatus = "freeze";
  } else if (move.usageCondition === "sleep-only") {
    if (attacker.status.condition !== "sleep") return blocked("usageCondition");
    const wakeCheck = checkStatusActionBlock(attacker.status, random, attackerHasEarlyBird);
    attacker.status = wakeCheck.nextState;
    // 이 판정으로 잠에서 깼다면 이번 턴은 이미 깬 상태이므로 사용 조건이 깨진 것으로 처리한다.
    if (attacker.status.condition !== "sleep") return blocked("usageCondition");
  } else {
    const statusCheck = checkStatusActionBlock(attacker.status, random, attackerHasEarlyBird);
    attacker.status = statusCheck.nextState;
    if (statusCheck.blocked) return blocked("status", 0, { blockedByStatus: preActionStatus ?? undefined });
    // 잠듦/얼음이 이번 판정에서 자연 해제됐으면(매턴 확률 스케줄) 로그에 남긴다 — 물거품아리아 같은
    // 명시적 치료(curesStatus)와는 다른 경로라 여기서 별도로 잡아야 한다.
    if ((preActionStatus === "sleep" || preActionStatus === "freeze") && !attacker.status.condition) {
      selfCuredStatus = preActionStatus;
    }
  }

  // 2) 풀죽음/반동: 1턴짜리 행동방해. 걸려있으면 이번 턴 소모하고 못 움직인다
  if (hasVolatile(attacker.volatile, "flinch")) {
    attacker.volatile = consumeVolatileTurn(attacker.volatile, "flinch");
    return blocked("flinch");
  }
  if (hasVolatile(attacker.volatile, "recharge")) {
    attacker.volatile = consumeVolatileTurn(attacker.volatile, "recharge");
    return blocked("recharge");
  }

  // 2-0) 도발/사슬묶기/앙코르: 이번 턴 고른 기술이 제약을 어기면 실패한다. 차지 기술 2턴째
  // (releasingCharge)는 지난 턴에 이미 확정된 선택이라 이 판정에서 제외한다. 지속 턴수는
  // 막혔는지 여부와 무관하게 전부 이 시점에 1씩 줄어든다(자기 차례마다 한 번씩만 판정되므로
  // 자연히 턴당 1회 소모) — 여러 제약이 동시에 걸려있어도 전부 소모시킨 뒤 첫 번째로 걸린
  // 이유(도발 > 사슬묶기 > 앙코르 순)만 대표로 보고한다.
  if (!releasingCharge) {
    let restrictionBlockedKind: "taunt" | "disable" | "encore" | undefined;
    if (hasVolatile(attacker.volatile, "taunt")) {
      if (move.category === "status") restrictionBlockedKind = "taunt";
      attacker.volatile = consumeVolatileTurn(attacker.volatile, "taunt");
    }
    const disableEntry = attacker.volatile.active.disable;
    if (disableEntry) {
      if (disableEntry.moveId === move.id) restrictionBlockedKind ??= "disable";
      attacker.volatile = consumeVolatileTurn(attacker.volatile, "disable");
    }
    const encoreEntry = attacker.volatile.active.encore;
    if (encoreEntry) {
      if (encoreEntry.moveId !== move.id) restrictionBlockedKind ??= "encore";
      attacker.volatile = consumeVolatileTurn(attacker.volatile, "encore");
    }
    // 발버둥은 이 제약들을 전부 무시하고 나간다(본가 규칙): 앙코르로 변화기가 강제됐는데 도발로
    // 그 변화기를 못 쓰는 등, 고를 수 있는 기술이 하나도 없을 때의 폴백. 지속 턴수는 위에서 이미
    // 소모시켰으므로 앙코르·도발·사슬묶기 카운트다운은 정상 진행된다(백로그 §7-5).
    if (restrictionBlockedKind && move.id !== STRUGGLE_MOVE.id) {
      return blocked("moveRestricted", 0, { moveRestrictionKind: restrictionBlockedKind });
    }
  }

  // 2-1) 사이코필드: 우선도 +1 이상인 기술이 "상대를 겨냥"하면 그 기술 자체가 실패한다.
  // 짓궂은마음으로 변화기 우선도가 올라간 경우도 반영해야 해서 원본 우선도가 아니라 특성
  // 보정을 더한 실제 우선도로 판정한다 — 단, 순풍·리플렉터·빛의장막처럼 상대를 겨냥하지 않는
  // 변화기는 우선도가 올라가 있어도 막히지 않는다(isOpponentTargetingMove가 그 축을 가른다).
  const effectivePriorityForBlock =
    move.priority + getAbilityPriorityBoost(move, attackerAbility, attacker.currentHp === attacker.maxHp);
  if (isPriorityMoveBlockedByField(state.field, effectivePriorityForBlock, move)) {
    return blocked("psychicFieldPriority");
  }
  // 여왕의위엄: 방어측이 이 특성이면 상대의 우선도 +1↑ 공격 기술이 자신을 겨냥할 때 실패한다.
  // 사이코필드 차단과 같은 축(isOpponentTargetingMove) — 순풍·방어 같은 자기/필드 기술은 제외.
  if (
    defenderAbility?.blocksOpponentPriorityMoves &&
    effectivePriorityForBlock >= 1 &&
    isOpponentTargetingMove(move)
  ) {
    return blocked("queenlyMajesty");
  }

  // 3) 혼란: 매 행동 판정마다 지속 턴수를 소모하고, 1/3 확률로 자멸(물리 40위력 자가타격)한다.
  // 자멸하면 이번 턴은 그걸로 끝 — 원래 쓰려던 기술은 실행되지 않는다.
  if (hasVolatile(attacker.volatile, "confusion")) {
    attacker.volatile = consumeVolatileTurn(attacker.volatile, "confusion");
    if (random() < CONFUSION_SELF_HIT_CHANCE) {
      const selfHit = computeDamage(attacker.realStats, attacker.realStats, attacker.types, CONFUSION_SELF_HIT_MOVE, {
        randomRoll: MIN_DAMAGE_ROLL + random() * (1 - MIN_DAMAGE_ROLL),
      });
      const selfDamage = selfHit?.damage ?? 0;
      attacker.currentHp = Math.max(0, attacker.currentHp - selfDamage);
      return blocked("confusion", selfDamage);
    }
  }

  // 3-1) 헤롱헤롱(매혹): ingrain/leechSeed와 같은 "배틀 끝까지 유지"형이라 턴수를 소모하지 않는다
  // (consumeVolatileTurn 호출 없음 — 교체가 없는 1v1이라 해제될 계기가 없음). 걸려있는 동안 매
  // 행동 판정마다 50% 확률로 그 턴 행동을 통째로 못 한다.
  if (hasVolatile(attacker.volatile, "attract") && random() < ATTRACT_ACTION_BLOCK_CHANCE) {
    return blocked("attract");
  }

  // 4) 차지 기술 1턴째(공중날기 등): 준비만 하고 이번 턴엔 데미지를 주지 않는다. 맑음 날씨의
  // 솔라빔처럼 chargeSkipWeather가 현재 날씨와 일치하면 준비 없이 곧장 2턴째처럼 실행한다.
  // releasingCharge면 이미 2턴째(위에서 move를 저장된 기술로 바꿔치기했음)라 여기 안 들어온다.
  if (move.chargeTurn && !releasingCharge) {
    // 메테오빔·일렉트로빔: 능력치 상승은 "이 기술을 쓴 턴"(=1턴째, 준비 선언 시점) 기준이라
    // chargeSkipWeather로 준비 턴 자체가 생략되는 경우(비 오는 일렉트로빔)에도 여기서 적용한다.
    // move.statChanges(2턴째 공격 판정에서 쓰는 필드)와 겹치지 않게 별도 필드로 받는다.
    if (move.chargeStatChanges) {
      attacker.stages = applyMoveStatChanges(
        attacker.stages,
        { ...move, statChanges: move.chargeStatChanges },
        "self",
        { userTypes: attacker.types },
      );
    }
    // 메가솔라: 쾌청 조건 차지 스킵기(솔라빔)를 날씨와 무관하게 준비 턴 없이 발동시킨다.
    const skipsCharge =
      move.chargeSkipWeather !== undefined &&
      (activeWeather(state) === move.chargeSkipWeather ||
        (move.chargeSkipWeather === "쾌청" && attackerAbility?.treatsOwnWeatherAsSun));
    if (!skipsCharge) {
      attacker.chargingMoveId = move.id;
      return {
        actor: actorKey,
        actorPokemonId,
        defenderPokemonId,
        move,
        hit: true,
        critical: false,
        damage: 0,
        damagePercent: 0,
        typeEffectiveness: 1,
        defenderRemainingHp: defender.currentHp,
        selfDamage: 0,
        attackerRemainingHp: attacker.currentHp,
        fainted: false,
        selfFainted: false,
        recoilDamage: 0,
        charging: true,
        leppaRestoredPpItemName,
      };
    }
  }

  // 잠꼬대: 여기까지 왔다는 건 잠든 채로 이 기술을 실제로 선택했다는 뜻(usageCondition 게이트를
  // 이미 통과) — 이 시점부터는 잠꼬대 자신 대신 자신이 배운 다른 기술 중 하나를 무작위로 대신
  // 발동시킨다. PP는 잠꼬대 자신만 이미 위에서 소모했고, 대신 나가는 기술의 PP는 건드리지 않는다
  // (본가와 동일). 이 아래로는 move가 그 대신 나간 기술을 가리키므로, 특성 배율/자속/타입상성/
  // 우선도 등 이후의 모든 판정이 자동으로 그 기술 기준으로 이뤄진다.
  let sleepTalkCalledMoveName: string | undefined;
  if (move.callsRandomLearnedMove) {
    const candidates = Object.keys(attacker.remainingPp)
      .map((id) => getMove(id))
      .filter(
        (m): m is Move =>
          !!m && m.id !== move.id && !m.chargeTurn && !m.usageCondition && !m.excludedFromSleepTalk,
      );
    if (candidates.length === 0) {
      // 배운 기술이 잠꼬대 하나뿐이거나 전부 제외 대상이면 대신 낼 기술이 없어 실패한다.
      return blocked("usageCondition");
    }
    const chosen = candidates[Math.floor(random() * candidates.length)];
    sleepTalkCalledMoveName = chosen.name;
    move = chosen;
  }

  // 서투름: 자기 자신의 도구 전투 효과가 무효화된다 — 실제로 지녔는지와 무관하게 이 시점부터는
  // 아예 안 지닌 것처럼 취급한다(메가스톤에 의한 폼 변화는 pokemonForm.ts의 별도 축이라 영향 없음).
  // attackerItem/defenderItem도 매직미러 반사 구간에서 함께 맞바뀐다(let).
  let attackerItem = attackerAbility?.disablesOwnItemEffects
    ? undefined
    : attacker.currentItemId
      ? getItem(attacker.currentItemId)
      : undefined;
  let defenderItem = defenderAbility?.disablesOwnItemEffects
    ? undefined
    : defender.currentItemId
      ? getItem(defender.currentItemId)
      : undefined;

  // 황금몸: 상대(공격측)가 변화기(카테고리 status)를 쓸 때, 그 기술이 "자신(=defender)을 직접
  // 겨냥하는" 효과(상태이상 부여·행동방해·랭크/명중회피/급소 하락)만 전부 무산시킨다. 필드
  // 전역 효과(날씨·필드·트릭룸)나 공격측 자신을 향한 효과(자기 스탯 상승, 자기 스크린 설치)는
  // "이 포켓몬을 겨냥한" 게 아니라서 그대로 적용된다 — 아래 각 opponent 방향 적용 지점에서만
  // 이 플래그로 건너뛴다.
  const blockedByGoodAsGold = move.category === "status" && !!defenderAbility?.blocksOpponentStatusMoveEffects;

  // 대타출동: 방어측이 대타를 세운 상태면, 소리 계열(돌림노래 등 classification "소리") 기술을
  // 제외한 모든 기술의 "opponent 방향" 부가효과(상태이상·랭크/명중회피/급소 하락·행동방해)가
  // 카테고리 무관(데미지기든 변화기든)으로 전부 무산된다 — 황금몸과 달리 status 기술로 한정하지
  // 않는다. 데미지 자체는 무산이 아니라 대타 HP로 흡수(아래 resolveHit 계열에서 별도 처리).
  // 틈새포착: 공격측이 이 특성이면 대타출동도 소리 계열과 마찬가지로 무시하고 본체에 직접 적중한다.
  const blockedBySubstitute =
    defender.substituteHp !== undefined &&
    !(move.classification ?? []).includes("소리") &&
    !attackerAbility?.bypassesScreensAndSubstitute;

  // 가루/포자 기술(수면가루·저리가루·독가루·목화포자·분노가루)은 풀타입 포켓몬에게 통하지 않는다
  // (본가 규칙 — 타입 면역과 같은 축). 방진 특성·방진고글 도구도 막지만 포챔스 로스터엔 없어 생략.
  const blockedByPowderImmunity =
    (move.classification ?? []).includes("가루") && defender.types.includes("풀");

  // 방어/판별/킹실드(protectEffect: "block"): 이번 턴 상대의 공격을 카테고리 무관으로 완전히
  // 무효화한다 — 대타와 달리 데미지를 어디로도 흡수하지 않고 그냥 0으로 만든다(아래 canDealDamage).
  // 버티기(protectEffect: "endure")는 막는 게 아니라 applyEndurance에서 별도로 처리하므로 여기
  // 포함하지 않는다.
  // 고스트다이브: "방어를 무시" = 방어류(protectEffect) 차단 자체를 뚫는다는 뜻(사용자 확인) — 실제
  // 방어 실수치와는 무관해서 여기서 판정 자체를 건너뛴다(틈새포착이 스크린/대타를 뚫는 것과 같은 결).
  // 패스트가드(protectEffect: "blockPriority"): "block"과 같지만 상대 기술의 priority가 0보다
  // 클 때만 막는다 — 일반 기술은 그냥 통과.
  const activeProtectBlocks =
    defender.activeProtect?.effect === "block" ||
    (defender.activeProtect?.effect === "blockPriority" && move.priority > 0);
  // 보이지않는주먹: 접촉기가 방어류를 뚫고 명중한다(데미지는 아래 resolveHit에서 1/4로 줄고, 방어류의
  // 접촉 성공 부가효과는 그대로 발동). 뚫는 경우엔 blockedByProtect를 false로 둬서 기술이 정상 진행된다.
  const unseenFistPiercing = !!(
    attackerAbility?.contactBypassesProtectAtQuarterDamage &&
    (move.makesContact ?? false) &&
    !move.bypassesProtect &&
    activeProtectBlocks
  );
  const blockedByProtect = !move.bypassesProtect && !unseenFistPiercing && activeProtectBlocks;
  // "방어로 막혔다!" 문구는 실제로 상대를 겨냥한 기술이 막혔을 때만 — 칼춤·나쁜음모처럼 자기
  // 대상 랭크업/자기 회복기는 방어와 무관하게 그대로 발동하므로 "막혔다"가 아니다(Phase 6.5 §6-2 ⑦).
  const blockedByProtectMoveName =
    blockedByProtect && isOpponentTargetingMove(move) ? defender.activeProtect?.moveName : undefined;
  // 방음: 방어측이 이 특성이면 소리 기술(classification "소리")이 데미지기·변화기 모두 완전히
  // 무효화된다. resolveMoveContext도 같은 판정으로 typeEffectiveness를 0으로 만든다.
  const blockedBySoundproof = !!(
    defenderAbility?.blocksSound && (move.classification ?? []).includes("소리")
  );
  // 방탄: 방어측이 이 특성이면 구슬·폭탄 기술(tags "구슬"/"폭탄")이 데미지기·변화기 모두 완전히
  // 무효화된다. 방음과 같은 처리 — resolveMoveContext도 같은 판정으로 typeEffectiveness를 0으로 만든다.
  const blockedByBulletproof = !!(
    defenderAbility?.blocksBallBomb && (move.tags ?? []).some((t) => t === "구슬" || t === "폭탄")
  );
  const soundproofBlockedByAbilityName = blockedBySoundproof ? defenderAbility?.name : undefined;
  const bulletproofBlockedByAbilityName = blockedByBulletproof ? defenderAbility?.name : undefined;
  const opponentEffectsBlocked =
    blockedByGoodAsGold ||
    blockedBySubstitute ||
    blockedByProtect ||
    blockedByPowderImmunity ||
    blockedBySoundproof ||
    blockedByBulletproof;

  // 매직미러: 방어측이 이 특성을 지녔고(틀깨기면 위에서 defenderAbility가 이미 undefined), 이번
  // 기술이 방어측을 겨냥하는 status 변화기이며 반사 제외(notReflectable — 고스트 저주·추억의선물·
  // 멸망의노래·흔들흔들댄스)가 아니면, 이 기술을 시전자에게 되돌린다. setsHazard(스텔스록)는
  // isOpponentTargetingMove가 잡지 않아 따로 OR로 포함한다. 되돌린 기술은 빗나가지 않고(아래 hit
  // 강제), "방어측 방향 효과" 블록 진입 직전에 공격/방어 바인딩을 통째로 맞바꿔 원래 시전자에게
  // 효과가 그대로 꽂히게 한다.
  const bouncedByMagicMirror =
    !opponentEffectsBlocked &&
    move.category === "status" &&
    !move.notReflectable &&
    !!defenderAbility?.reflectsOpponentStatusMoves &&
    (isOpponentTargetingMove(move) || !!move.setsHazard);

  // 레이징불: 이 기술을 쓰는 켄타로스의 종(팔데아 3품종)에 따라 실제 타입이 바뀐다. 웨더볼/
  // fieldPulse보다 먼저 반영해야 이후 resolveMoveContext의 상성·자속 계산이 전부 새 타입으로 돈다.
  const speciesTypedType = move.typeByUserSpecies?.[attacker.slot.pokemonId];
  const speciesTypedMove: Move = speciesTypedType ? { ...move, type: speciesTypedType } : move;

  // 셸암즈(dynamicCategoryByHigherDamage) — 가라르야도란 전용기. 물리(공격 vs 상대 방어)와
  // 특수(특공 vs 상대 특방)로 각각 데미지를 계산해 큰 쪽 판정으로 공격한다. 물리면 접촉기,
  // 특수면 비접촉기. 두 값이 같으면 무작위. 도구·특성·날씨 배율은 여기 비교에 넣지 않고(사용자
  // 확정 — "물리/특수 여부를 먼저 판단한 뒤 적용"), 순수 실능·랭크만으로 비교한다.
  let shellSideArmCategory: "physical" | "special" | undefined;
  let categoryResolvedMove: Move = speciesTypedMove;
  if (speciesTypedMove.dynamicCategoryByHigherDamage) {
    const dmgOpts = { attackerStages: attacker.stages, defenderStages: defender.stages };
    const physDmg =
      computeDamage(attacker.realStats, defender.realStats, attacker.types, { ...speciesTypedMove, category: "physical" }, dmgOpts)?.damage ?? 0;
    const specDmg =
      computeDamage(attacker.realStats, defender.realStats, attacker.types, { ...speciesTypedMove, category: "special" }, dmgOpts)?.damage ?? 0;
    shellSideArmCategory = physDmg > specDmg ? "physical" : specDmg > physDmg ? "special" : random() < 0.5 ? "physical" : "special";
    categoryResolvedMove = {
      ...speciesTypedMove,
      category: shellSideArmCategory,
      makesContact: shellSideArmCategory === "physical",
    };
  }

  // 웨더볼(날씨판 대지의파동): 날씨로 타입·위력이 바뀐다. 웨더볼과 fieldPulse를 동시에 갖는
  // 기술은 없어 순차 적용해도 안전하다. 메가솔라 보유자는 날씨와 무관하게 쾌청으로 취급한다.
  const weatherForOwnMoves = attackerAbility?.treatsOwnWeatherAsSun ? "쾌청" : activeWeather(state);
  const weatherBall = applyWeatherBall(categoryResolvedMove, weatherForOwnMoves);
  const moveAfterWeatherBall: Move = { ...categoryResolvedMove, type: weatherBall.type, power: weatherBall.power };

  // 필드 조건부 타입/위력 변경(대지의파동=fieldPulse, 미스트버스트·와이드포스·라이징볼트=
  // powerMultiplierInField)을 특성 배율 계산보다 먼저 반영한다 — 타입이 바뀐 상태여야
  // resolveMoveContext 안의 상성 계산(getEffectiveness)에도 바뀐 타입이 들어간다. 둘 중
  // 한 기술이 두 속성을 동시에 갖는 경우는 없어서(대지의파동만 fieldPulse, 나머지 셋만
  // powerMultiplierInField) 순서·중복 곱셈 걱정 없이 그냥 합쳐도 안전하다.
  const fieldPulse = applyFieldPulse(moveAfterWeatherBall, state.field);
  const fieldPowerMultiplier = getFieldPowerMultiplier(moveAfterWeatherBall, state.field);
  const fieldAdjustedMove: Move = {
    ...moveAfterWeatherBall,
    type: fieldPulse.type,
    power: fieldPulse.power === null ? null : Math.round(fieldPulse.power * fieldPowerMultiplier),
  };

  // evaluateSlotMatchup(1턴 스냅샷 판정)과 같은 로직을 공유 — 특성 배율/타입 변경/자속/상대 상성
  const {
    effectiveMove: contextEffectiveMove,
    abilityOffenseMultiplier,
    abilityDefenseMultiplier,
    stabMultiplier,
    typeEffectiveness,
    absorbedByDefenderAbility,
  } = resolveMoveContext(attackerAbility, fieldAdjustedMove, defender.types, defenderAbility, {
    weather: activeWeather(state),
    defenderItem,
    attackerHpFraction: attacker.currentHp / attacker.maxHp,
    defenderHpIsFull: defender.currentHp === defender.maxHp,
    defenderHasStatusCondition: defender.status.condition !== null,
    field: state.field,
  });

  // 우격다짐: 데미지 기술에 "상대에게 해로운"(상태이상/행동방해/랭크다운) 또는 "자신에게 이로운"
  // (자기 랭크업) 부가 효과가 있으면 그 효과를 전부 없애는 대신 위력에 배수를 곱한다. 반동
  // (recoilFraction)·자기 디메리트(자기 랭크다운·행동불능 예약 등)는 "부가 효과"가 아니라서
  // 손대지 않는다 — 플레어드라이브가 반동은 그대로 받으면서 화상만 사라지고 위력이 오르는 것과
  // 같은 축(사용자 확인). 급소율(highCritRatio)도 버프/디버프가 아니라 대상이 아니다.
  let effectiveMove = contextEffectiveMove;
  let sheerForceAbilityName: string | undefined;
  if (attackerAbility?.tradesSecondaryEffectForPower && hasSheerForceSecondaryEffect(effectiveMove)) {
    effectiveMove = {
      ...effectiveMove,
      power:
        effectiveMove.power !== null
          ? Math.round(effectiveMove.power * attackerAbility.tradesSecondaryEffectForPower)
          : effectiveMove.power,
      inflictsStatus: undefined,
      // target: "self"인 항목(반동성 자기 예약 등)은 그대로 두고, 상대를 향한 것만 제거한다.
      inflictsVolatile: effectiveMove.inflictsVolatile?.filter((v) => v.target !== "opponent"),
      // 상대 랭크다운(target: opponent)과 자기 랭크업(target: self, delta > 0)만 제거 — 자기
      // 랭크다운(디메리트)은 "부가 효과"가 아니라서 그대로 유지된다.
      statChanges: effectiveMove.statChanges?.filter(
        (s) => !(s.target === "opponent" || (s.target === "self" && (s.delta ?? 0) > 0)),
      ),
    };
    sheerForceAbilityName = attackerAbility.name;
  }

  // 기사회생(Reversal)·바둥바둥(Flail, F-2): power가 null인 채로 오고, 사용자의 현재 HP 비율에 따라 위력이 정해진다.
  if (effectiveMove.reversalPower) {
    effectiveMove = { ...effectiveMove, power: reversalPowerFromHp(attacker.currentHp, attacker.maxHp) };
  }
  // 자이로볼(§3-1a): 상대가 느릴수록 강하다. 자신·상대의 실효 스피드로 위력을 정한다.
  if (effectiveMove.gyroBallPower) {
    effectiveMove = {
      ...effectiveMove,
      power: gyroBallPowerValue(attacker, defender, attackerItem, defenderItem),
    };
  }
  // 기어오르기·어시스트파워(§3-1a): 자신의 양수 랭크 합계로 위력이 오른다.
  if (effectiveMove.powerFromPositiveStages) {
    const { base, perStage } = effectiveMove.powerFromPositiveStages;
    effectiveMove = { ...effectiveMove, power: positiveStagesPowerValue(attacker.stages, base, perStage) };
  }
  // 토해내기(§3 증분 B-3): 위력 = 비축 스택 × 100. 스택·랭크 소비는 아래 usedMoveIds 기록 지점에서.
  if (effectiveMove.spitUpPower) {
    effectiveMove = { ...effectiveMove, power: (attacker.stockpileCount ?? 0) * 100 };
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
  if (effectiveMove.weightRatioPower) {
    const userKg = weightOf(attacker);
    const targetKg = weightOf(defender);
    effectiveMove = {
      ...effectiveMove,
      power:
        userKg !== undefined && targetKg !== undefined
          ? weightRatioPowerValue(userKg, targetKg)
          : WEIGHT_MOVE_FALLBACK_POWER,
    };
  }
  if (effectiveMove.targetAbsoluteWeightPower) {
    const targetKg = weightOf(defender);
    effectiveMove = {
      ...effectiveMove,
      power: targetKg !== undefined ? absoluteWeightPowerValue(targetKg) : WEIGHT_MOVE_FALLBACK_POWER,
    };
  }
  // 눈사태·보복·애크러뱃(§3 증분 C): 조건 충족 시 위력 2배.
  // 분풀이("user-stat-lowered-this-turn")·분함의발구르기("user-move-failed-last-turn")는 이번 턴/직전
  // 턴 이력 상태가 엔진에 없어 여기선 항상 미충족(기본 위력)으로 둔다 — 매치업 페이지에서만 충족
  // 상정(§3 증분 B-3, 사용자 지시).
  if (effectiveMove.conditionalDoublePower && effectiveMove.power !== null) {
    const condition = effectiveMove.conditionalDoublePower;
    const met =
      condition === "took-damage-this-turn"
        ? (attacker.damageTakenThisTurn?.physical ?? 0) + (attacker.damageTakenThisTurn?.special ?? 0) > 0
        : condition === "moves-after-target"
          ? movesSecond
          : condition === "user-has-no-item"
            ? !attacker.currentItemId
            : condition === "user-status-burn-poison-paralysis"
              ? attacker.status.condition === "burn" ||
                attacker.status.condition === "poison" ||
                attacker.status.condition === "badly-poisoned" ||
                attacker.status.condition === "paralysis"
              : condition === "target-status-poisoned"
                ? defender.status.condition === "poison" || defender.status.condition === "badly-poisoned"
                : false; // user-stat-lowered-this-turn / user-move-failed-last-turn → 엔진 미추적
    if (met) effectiveMove = { ...effectiveMove, power: effectiveMove.power * 2 };
  }

  // 솔라빔(§1-10): chargeSkipWeather(쾌청)가 아닌 날씨에서는 위력 절반. 메가솔라(치지직 등)로
  // 자신의 기술을 항상 쾌청 취급하면 여기서도 그 취급을 존중한다(§1-6의 준비 턴 스킵 판정과 동일 축).
  if (
    effectiveMove.halvesPowerOutsideChargeSkipWeather &&
    effectiveMove.power !== null &&
    effectiveMove.chargeSkipWeather !== undefined
  ) {
    const weatherMatchesSkipCondition =
      activeWeather(state) === effectiveMove.chargeSkipWeather ||
      (effectiveMove.chargeSkipWeather === "쾌청" && attackerAbility?.treatsOwnWeatherAsSun);
    if (!weatherMatchesSkipCondition) {
      effectiveMove = { ...effectiveMove, power: Math.floor(effectiveMove.power / 2) };
    }
  }

  // 플라잉프레스: 상대가 이번 배틀에서 작아지기를 쓴 적이 있으면 위력 2배(필중은 아래 hitChance에서).
  if (effectiveMove.bonusVsMinimize && effectiveMove.power !== null && defender.usedMoveIds?.["작아지기"]) {
    effectiveMove = { ...effectiveMove, power: effectiveMove.power * 2 };
  }

  // 분노의주먹(Rage Fist): 위력 = min(350, 50 + 50 × 이번 배틀에서 기술로 데미지를 받은 횟수).
  if (effectiveMove.rageFistPower && effectiveMove.power !== null) {
    effectiveMove = {
      ...effectiveMove,
      power: Math.min(350, 50 + 50 * (attacker.timesHitByMoves ?? 0)),
    };
  }

  // 변덕레이저(Fickle Beam): randomDoublePower% 확률로 위력 2배 + "전력을 다하기 시작했다!" 안내.
  let fickleBeamEmpowered = false;
  if (
    effectiveMove.randomDoublePower !== undefined &&
    effectiveMove.power !== null &&
    random() * 100 < effectiveMove.randomDoublePower
  ) {
    effectiveMove = { ...effectiveMove, power: effectiveMove.power * 2 };
    fickleBeamEmpowered = true;
  }

  // 전기로바꾸기(Electromorphosis): 충전 상태에서 쓰는 전기타입 기술은 위력 2배(1회 소모).
  let electromorphosisEmpoweredAbilityName: string | undefined;
  if (
    attacker.electroChargedForElectric &&
    effectiveMove.type === "전기" &&
    effectiveMove.power !== null
  ) {
    effectiveMove = { ...effectiveMove, power: effectiveMove.power * 2 };
    attacker.electroChargedForElectric = false;
    electromorphosisEmpoweredAbilityName = attackerAbility?.name;
  }

  // 타오르는불꽃 발동 이후로 자신(=현재 공격자)이 쓰는 그 타입 기술의 위력이 올라있으면 반영.
  // 절대 타입이 null인 기술(발버둥 등)은 boosts 조회 자체를 건너뛴다.
  const ownMoveTypeBoostMultiplier =
    (effectiveMove.type ? attacker.ownMoveTypeBoosts[effectiveMove.type] : undefined) ?? 1;

  // 투쟁심: 상대와 성별이 같으면 ×1.25, 다르면 ×0.75, 어느 한쪽이라도 성별 불명이면 ×1.0.
  const rivalryMultiplier = rivalryDamageMultiplier(attackerAbility, attacker.gender, defender.gender);

  // 메트로놈(연속 같은 기술 위력 증가)용 스트릭 갱신 — 여기까지 왔다는 건 앞의 모든 행동방해
  // 판정(상태이상/풀죽음/반동/혼란/차지 등)을 통과해서 실제로 이 기술을 쓴다는 뜻이라, 명중 여부와
  // 무관하게 여기서 갱신한다(본가 규칙 — 빗나가도 스트릭은 유지되고, 다른 기술을 쓰면 끊긴다).
  attacker.lastMoveStreak = attacker.lastMoveId === effectiveMove.id ? (attacker.lastMoveStreak ?? 1) + 1 : 1;
  attacker.lastMoveId = effectiveMove.id;
  // 구애류: 지금 지닌 도구가 구애류면 이 기술로 잠긴다(이미 잠겼으면 그대로). 발버둥은 잠그지 않는다.
  if (attackerItem?.locksFirstMoveUsed && !attacker.choiceLockedMoveId && effectiveMove.id !== STRUGGLE_MOVE.id) {
    attacker.choiceLockedMoveId = effectiveMove.id;
  }

  // 거대해머(cannotUseConsecutively): 실제로 이 기술로 행동을 개시했으니 "다음 턴엔 잠금" 예약.
  // usageCondition 게이트(섹션 0)는 이 기록과 현재 턴 번호가 정확히 일치할 때만 실패시킨다.
  if (effectiveMove.cannotUseConsecutively) {
    attacker.consecutiveLockMoveId = effectiveMove.id;
    attacker.consecutiveLockUntilTurn = state.turnNumber + 1;
  }

  // 비장의무기 사용 조건용 — "이 기술로 행동을 개시했다"를 여기서 기록(명중 여부 무관).
  (attacker.usedMoveIds ??= {})[effectiveMove.id] = true;

  // 비축하기: 스택 +1 (3스택 초과는 위 usageCondition 게이트에서 이미 실패). 방어·특방 랭크업은
  // 데이터의 statChanges로 처리된다.
  if (effectiveMove.addsStockpile) {
    attacker.stockpileCount = Math.min(3, (attacker.stockpileCount ?? 0) + 1);
  }
  // 토해내기: 사용 즉시 비축 스택을 0으로 되돌리고, 비축하기로 올렸던 방어·특방 랭크도 그만큼 내린다.
  // (위에서 이미 스택 수로 위력을 확정한 뒤라 여기서 소비해도 안전.)
  if (effectiveMove.spitUpPower) {
    const spent = attacker.stockpileCount ?? 0;
    attacker.stockpileCount = 0;
    if (spent > 0) {
      attacker.stages = applyStageDelta(applyStageDelta(attacker.stages, "def", -spent), "spd", -spent);
    }
  }

  // 배틀스위치(킬가르도): 여기까지 왔다는 건 이번 기술을 실제로 사용한다는 뜻이라(위 lastMoveStreak
  // 주석과 동일한 근거), 명중 여부와 무관하게 폼이 바뀐다 — 데미지 기술이면 블레이드폼(공격/특공↑),
  // 킹실드(revertMoveId)를 쓰면 실드폼으로 되돌아간다. 그 외 변화기는 폼을 유지한다(본가 규칙 —
  // 킹실드만 실드폼 복귀 트리거고 다른 변화기는 폼에 영향 없음). 이 스탯 재계산은 데미지 계산보다
  // 먼저 일어나야 이번 공격 자체에 새 폼의 실수치가 반영된다.
  if (attacker.stanceChangeForms) {
    const forms = attacker.stanceChangeForms;
    const nextForm: "shield" | "blade" =
      effectiveMove.id === forms.revertMoveId
        ? "shield"
        : effectiveMove.category !== "status"
          ? "blade"
          : (attacker.currentStanceForm ?? "shield");
    if (nextForm !== attacker.currentStanceForm) {
      const nextBaseStats = nextForm === "blade" ? forms.bladeBaseStats : forms.shieldBaseStats;
      attacker.realStats = computeRealStats(nextBaseStats, attacker.slot.points, attacker.slot.nature);
      attacker.currentStanceForm = nextForm;
    }
  }

  // 변환자재/리베로: 여기까지 왔다는 건 상태이상·행동방해를 뚫고 실제로 이 기술을 쓴다는 뜻이라,
  // 명중 여부와 무관하게 자신의 타입이 이 기술의 타입으로 바뀐다(사용자 확인 — 실제로 타입이
  // 바뀌어서 이후 턴 방어에도 반영된다). **발동은 이번 등장 스탠스에서 1회뿐(본가 9세대)** —
  // 첫 기술 이후엔 다른 타입 기술을 써도 안 바뀌고, 교체로 물러났다 다시 나오면 다시 1회 가능.
  // attacker.types를 그 자리에서 통째로 갈아치우는 것뿐이라 이후 이 값을 읽는 모든 곳(이번 턴의
  // 자속 판정은 물론, 다음 턴 이 포켓몬이 방어측이 될 때 defender.types로 쓰이는 것까지)에 자동
  // 반영된다. 발버둥처럼 타입이 없는(null) 기술은 바뀌지 않는다(본가와 동일).
  let changedOwnTypeTo: PokemonType | undefined;
  let changedOwnTypeAbilityName: string | undefined;
  if (
    attackerAbility?.changesUserTypeToMoveType &&
    effectiveMove.type &&
    !attacker.proteanActivatedSinceSwitchIn
  ) {
    attacker.types = [effectiveMove.type];
    attacker.proteanActivatedSinceSwitchIn = true;
    changedOwnTypeTo = effectiveMove.type;
    changedOwnTypeAbilityName = attackerAbility.name;
  }

  // 전광쌍격(Move.losesTypeAfterUse): 변환자재와 같은 시점 — 실제로 이 기술을 쓰면(명중·빗나감
  // 무관) 사용자의 타입 목록에서 지정 타입(전기)이 빠진다. 이미 그 타입이 아니면 아무 일도
  // 없다. 두 타입이면 나머지 하나만, 단일 타입이면 빈 배열(무타입)이 된다 — getEffectiveness가
  // 빈 배열에 등배(1)를 돌려줘서 상성·자속이 전부 사라지는 형태로 안전하게 처리된다. 교체해도
  // 돌아오지 않는다(changedOwnTypeTo와 같은 취급).
  let lostTypeAfterUse: PokemonType | undefined;
  if (effectiveMove.losesTypeAfterUse && attacker.types.includes(effectiveMove.losesTypeAfterUse)) {
    attacker.types = attacker.types.filter((t) => t !== effectiveMove.losesTypeAfterUse);
    lostTypeAfterUse = effectiveMove.losesTypeAfterUse;
  }

  // 대검돌격(Move.glaiveRush): 실제로 이 기술을 쓰면(명중·빗나감 무관) "다음 자기 행동 전까지"
  // 피격 필중·피해 2배 상태가 된다. 위 resolveAction 최상단에서 이 공격자가 다시 행동을
  // 개시할 때 해제된다.
  if (effectiveMove.glaiveRush) attacker.glaiveRushVulnerable = true;

  // 노말주얼 등 타입 젬(Item.oneTimeGemMultiplier): 대전 중 처음 이 타입의 데미지 기술을 쓰면
  // 위력이 오르고 그 즉시 소모된다 — 소모 자체는 "사용하는 순간" 일어나 명중·빗나감과 무관하다
  // (변환자재와 같은 시점). 다단히트 타마다 재판정하면 안 되므로 여기서 한 번만 판정해
  // gemMultiplier에 담고, resolveHit이 매 타 이 배율을 곱한다.
  const isDamagingMove =
    effectiveMove.category !== "status" &&
    (effectiveMove.power !== null || effectiveMove.fixedDamage !== undefined);
  let gemMultiplier = 1;
  let ateGemItemName: string | undefined;
  if (
    isDamagingMove &&
    effectiveMove.type &&
    attackerItem?.oneTimeGemMultiplier?.type === effectiveMove.type &&
    !attacker.itemConsumed
  ) {
    gemMultiplier = attackerItem.oneTimeGemMultiplier.multiplier;
    ateGemItemName = attackerItem.name;
    consumeItem(attacker);
  }

  // 명중 확률(배율·회피율 예외·필중 조건)은 배틀 AI와 공유하는 computeBattleHitChance에서 계산한다.
  const hitChance = computeBattleHitChance({
    state,
    attacker,
    defender,
    move: effectiveMove,
    hustleCategory: move.category,
    attackerAbility,
    defenderAbility,
    attackerItem,
    defenderItem,
    attackerMovesSecond: movesSecond,
  });

  // 상대가 차지 기술 준비 턴(공중날기 등)으로 무적인 동안엔, bypassesHiding에 이 무적 종류가
  // 포함된 기술이 아닌 이상 조건 없이 빗나간다 — 명중률 굴림 자체를 건너뛴다.
  // 단, 상대를 겨냥하지 않는 기술(칼춤·방어·광합성 등 자기 대상)은 애초에 "빗나갈" 대상이 아니라서
  // 무적과 무관하게 정상 발동한다(§1 E-1 버그 수정).
  const defenderHideType = defender.chargingMoveId ? getMove(defender.chargingMoveId)?.chargeHideType : undefined;
  const evadedByCharge =
    !!defenderHideType &&
    !(effectiveMove.bypassesHiding ?? []).includes(defenderHideType) &&
    isOpponentTargetingMove(effectiveMove);

  // 대검돌격: 방어측이 이 상태면(직전에 대검돌격을 쓴 뒤 아직 다음 행동 전) 그를 겨냥한
  // 기술의 명중 굴림을 건너뛴다(반드시 명중). 무적(evadedByCharge)은 그대로 존중한다.
  const glaiveRushGuaranteesHit = defender.glaiveRushVulnerable && isOpponentTargetingMove(effectiveMove);
  // 매직미러로 되돌릴 기술은 명중 굴림을 건너뛴다(반사는 빗나가지 않는다).
  const hit = bouncedByMagicMirror
    ? true
    : evadedByCharge
      ? false
      : hitChance === null
        ? true
        : glaiveRushGuaranteesHit
          ? true
          : random() < hitChance;

  // 철제광선: "사용하는 순간" 명중·빗나감과 무관하게 사용자가 최대 HP의 절반을 잃는다(E-3).
  let selfDamageOnUse = 0;
  if (effectiveMove.selfDamageFractionOnUse !== undefined) {
    selfDamageOnUse = Math.floor(attacker.maxHp * effectiveMove.selfDamageFractionOnUse);
    attacker.currentHp = Math.max(0, attacker.currentHp - selfDamageOnUse);
  }

  if (!hit) {
    // 자폭류(대폭발 등)는 빗나가도 사용자가 반드시 기절한다 (본가 규칙). 데미지가 아예 없는
    // 경로라 승자 판정에 영향을 줄 순서 문제도 없다 — 그냥 여기서 바로 처리해도 된다.
    if (effectiveMove.selfFaints) {
      attacker.currentHp = 0;
    }
    // 무릎차기: 빗나가면 사용자가 최대 HP 절반을 잃는다(E-2). "의욕이 넘쳐 땅에 부딪혔다!"
    let crashDamage = 0;
    if (effectiveMove.crashFraction !== undefined) {
      crashDamage = Math.floor(attacker.maxHp * effectiveMove.crashFraction);
      attacker.currentHp = Math.max(0, attacker.currentHp - crashDamage);
    }
    return {
      actor: actorKey,
      actorPokemonId,
      defenderPokemonId,
      move,
      hit,
      critical: false,
      damage: 0,
      damagePercent: 0,
      typeEffectiveness,
      defenderRemainingHp: defender.currentHp,
      selfDamage: 0,
      attackerRemainingHp: attacker.currentHp,
      fainted: false,
      selfFainted: isFainted(attacker),
      recoilDamage: 0,
      evadedByCharge,
      crashDamage: crashDamage || undefined,
      selfDamageOnUse: selfDamageOnUse || undefined,
      leppaRestoredPpItemName,
      // 변환자재/리베로는 명중 굴림 전에 이미 발동했다 — 빗나가도 타입은 바뀌고 로그 문구도 나와야 한다.
      changedOwnTypeTo,
      changedOwnTypeAbilityName,
      // 전광쌍격 타입 소실·대검돌격 약점도 명중 굴림 전에 확정된다(빗나가도 적용).
      lostTypeAfterUse,
      glaiveRushArmed: effectiveMove.glaiveRush || undefined,
      // 타입 젬도 명중 굴림 전에 이미 소모됐다(빗나가도 소모된 채로 남는다).
      ateGemItemName,
    };
  }

  // 타오르는불꽃/피뢰침: 명중한 시점에 카테고리 무관(상태이상 기술도 포함)으로 발동한다 — 위에서
  // 이미 typeEffectiveness를 0으로 덮어써놨으니 데미지 계산 쪽은 자연히 0이 되고, 여기서는
  // 그 즉시 랭크 변화 + (있다면) 자기 타입 기술 위력 상승 플래그만 별도로 적용하면 된다.
  let abilityAbsorbedMoveType: PokemonType | undefined;
  let abilityAbsorbAbilityName: string | undefined;
  let abilityAbsorbHealAmount = 0;
  if (absorbedByDefenderAbility && defenderAbility?.absorbsType) {
    const absorb = defenderAbility.absorbsType;
    abilityAbsorbedMoveType = absorb.type;
    abilityAbsorbAbilityName = defenderAbility.name;
    if (absorb.selfStatChanges) {
      for (const change of absorb.selfStatChanges) {
        defender.stages = applyStageDelta(defender.stages, change.stat, contraryDelta(defender, change.delta));
      }
    }
    if (absorb.boostsOwnMoveTypeMultiplier) {
      defender.ownMoveTypeBoosts = { ...defender.ownMoveTypeBoosts, [absorb.type]: absorb.boostsOwnMoveTypeMultiplier };
    }
    // 저수: 랭크업 대신 무효화한 그 즉시 최대 HP 비율만큼 회복한다.
    if (absorb.healsFraction) {
      abilityAbsorbHealAmount = Math.min(
        defender.maxHp - defender.currentHp,
        Math.floor(defender.maxHp * absorb.healsFraction),
      );
      defender.currentHp += abilityAbsorbHealAmount;
    }
  }

  // 킹실드/니들가드: 접촉기를 막아냈을 때만 공격측에게 반동을 건다 — 킹실드는 랭크변화(공격 -1),
  // 니들가드는 최대 HP 1/8 데미지. 막지 못했거나(blockedByProtect === false) 접촉기가 아니면 없다.
  let protectContactPenaltyMoveName: string | undefined;
  let protectContactDamage = 0;
  let protectContactInflictedStatus: StatusConditionState["condition"] | undefined;
  // 보이지않는주먹으로 뚫고 들어간 경우(unseenFistPiercing)도 방어류의 접촉 성공 부가효과는 발동한다.
  if ((blockedByProtect || unseenFistPiercing) && defender.activeProtect && (effectiveMove.makesContact ?? false)) {
    const ap = defender.activeProtect;
    if (ap.contactPenalty) {
      attacker.stages = applyStageDelta(attacker.stages, ap.contactPenalty.stat, contraryDelta(attacker, ap.contactPenalty.delta));
      protectContactPenaltyMoveName = ap.moveName;
    }
    // 니들가드 접촉 데미지 — 공격측이 매직가드면 무효(까칠한피부·록키헬멧과 같은 축).
    if (ap.contactDamageFraction && !attackerAbility?.negatesIndirectDamage) {
      const amount = Math.floor(attacker.maxHp * ap.contactDamageFraction);
      attacker.currentHp = Math.max(0, attacker.currentHp - amount);
      protectContactDamage = amount;
      protectContactPenaltyMoveName = ap.moveName;
    }
    // 토치카: 접촉기를 막으면 공격자를 독 상태로 만든다(타입/특성 면역·필드 존중).
    if (
      ap.contactStatus &&
      !isImmuneToStatus(ap.contactStatus, attacker.types, statusImmunitiesOf(attacker, attackerAbility)) &&
      !isStatusBlockedByField(state.field, ap.contactStatus) &&
      sideOf(state, actorKey).safeguardTurnsRemaining === undefined
    ) {
      const before = attacker.status.condition;
      attacker.status = inflictStatus(attacker.status, ap.contactStatus);
      if (attacker.status.condition !== before) {
        protectContactInflictedStatus = attacker.status.condition;
        protectContactPenaltyMoveName = ap.moveName;
      }
    }
  }
  return {
    move, defenderKey, attacker, defender, defenderHpAtActionStart, actorPokemonId, defenderPokemonId, attackerAbility, defenderAbility, attackerBerriesBlocked, defenderBerriesBlocked, attackerItemIdBeforeAction, defenderItemIdBeforeAction, leppaRestoredPpItemName, pressureExtraPpAbilityName, selfCuredStatus, sleepTalkCalledMoveName, attackerItem, defenderItem, blockedByGoodAsGold, blockedBySubstitute, blockedByPowderImmunity, unseenFistPiercing, blockedByProtect, blockedByProtectMoveName, soundproofBlockedByAbilityName, bulletproofBlockedByAbilityName, opponentEffectsBlocked, bouncedByMagicMirror, shellSideArmCategory, abilityOffenseMultiplier, abilityDefenseMultiplier, stabMultiplier, typeEffectiveness, effectiveMove, sheerForceAbilityName, fickleBeamEmpowered, electromorphosisEmpoweredAbilityName, ownMoveTypeBoostMultiplier, rivalryMultiplier, changedOwnTypeTo, changedOwnTypeAbilityName, lostTypeAfterUse, gemMultiplier, ateGemItemName, hitChance, defenderHideType, evadedByCharge, hit, selfDamageOnUse, abilityAbsorbedMoveType, abilityAbsorbAbilityName, abilityAbsorbHealAmount, protectContactPenaltyMoveName, protectContactDamage, protectContactInflictedStatus,
  };
}

