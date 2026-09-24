import { type FighterKey } from "@/types/battle";
import { NEUTRAL_ACCURACY_STAGES, NEUTRAL_CRIT_STAGE, NEUTRAL_STAGES, type BattleStatKey } from "@/types/battleStats";
import { NO_STATUS_CONDITION, type StatusCondition, type VolatileCondition, type VolatileConditionState } from "@/types/status";
import { getAbility, getItem, getPokemon } from "@/lib/data";
import { eulReul, eunNeun, roEuro } from "@/lib/josa";
import { megaFormFullName } from "@/lib/pokemonForm";
import { computeRealStats } from "@/lib/statCalculator";
import { applyStageDelta } from "@/lib/statStages";
import { inflictStatus, isImmuneToStatus } from "@/lib/statusConditions";
import { hasVolatile } from "@/lib/volatileConditions";
import { calcSpikesDamage, calcStealthRockDamage, isGroundedForHazards } from "./entryCost";
import { FIELD_DURATION, FIELD_ENTRY_ANNOUNCEMENT, isStatusBlockedByField } from "@/lib/fieldEffects";
import { WEATHER_DURATION, abilityOf, activeWeather, applyForecastForm, applyMimicryForm, applyTransform, balloonEntryAnnouncement, cloneSide, consumeItem, contraryDelta, isFainted, opponentKey, sideOf, statusImmunitiesOf, weatherRockBonus, type BattleFighterState, type BattleState } from "./state";

export function isTrappedFromSwitching(fighter: BattleFighterState): boolean {
  if (isFainted(fighter)) return false;
  if (fighter.types.includes("고스트")) return false;
  return hasVolatile(fighter.volatile, "octolock") || hasVolatile(fighter.volatile, "jawLock");
}

/**
 * 위협(lowersOpponentStatOnEntry)을 opponent에게 적용하되, opponent의 특성 반응까지 처리한다.
 *  - 파수견(guardsAgainstIntimidate): 하락을 무시하고 공격이 1랭크 오른다.
 *  - 주눅(raisesStatWhenIntimidated): 공격은 정상적으로 떨어지고, 스피드도 1랭크 오른다.
 *  - 그 외: 정상 하락.
 * 로그 문구를 log 배열에 push한다(등장 안내 텍스트 전용 흐름이라 문구는 고정형).
 */
export function applyIntimidateWithReaction(
  opponent: BattleFighterState,
  intimidate: { stat: BattleStatKey; delta: number },
  intimidaterName: string,
  intimidateAbilityName: string,
  opponentName: string,
  log: string[],
): void {
  const oppAbility = opponent.effectiveAbilityId ? getAbility(opponent.effectiveAbilityId) : undefined;
  if (oppAbility?.guardsAgainstIntimidate) {
    const before = opponent.stages[intimidate.stat];
    opponent.stages = applyStageDelta(opponent.stages, intimidate.stat, contraryDelta(opponent, 1));
    if (opponent.stages[intimidate.stat] !== before) {
      log.push(`${opponentName}의 ${oppAbility.name}! 위협에 아랑곳 않고 공격이 올라갔다!`);
    }
    return;
  }
  const before = opponent.stages[intimidate.stat];
  opponent.stages = applyStageDelta(opponent.stages, intimidate.stat, contraryDelta(opponent, intimidate.delta));
  if (opponent.stages[intimidate.stat] !== before) {
    log.push(`${intimidaterName}의 ${intimidateAbilityName}! 상대의 공격이 떨어졌다!`);
  }
  // 주눅은 스피드만 올리므로 문구를 고정한다.
  if (oppAbility?.raisesStatWhenIntimidated) {
    const { stat, delta } = oppAbility.raisesStatWhenIntimidated;
    const b2 = opponent.stages[stat];
    opponent.stages = applyStageDelta(opponent.stages, stat, contraryDelta(opponent, delta));
    if (opponent.stages[stat] !== b2) {
      log.push(`${opponentName}의 ${oppAbility.name}! 겁을 먹어 스피드가 올라갔다!`);
    }
  }
}

/**
 * 시드류(일렉트릭시드·그래스시드→방어 +1 / 사이코시드·미스트시드→특방 +1, Item.terrainSeedBoost):
 * 지닌 포켓몬이 필드에 있는 동안 그 필드가 활성화되면(이미 나와 있는데 필드가 깔리거나, 필드가
 * 이미 있는데 등장) 1회 발동하고 소모된다. 양쪽 다 확인 — 필드는 장 전체 효과라 어느 쪽이
 * 깔아도 상대 시드도 반응한다. 호출부가 반환된 문구를 알맞은 로그(등장 안내·ActionLogEntry)에 얹는다.
 */
export function triggerTerrainSeeds(state: BattleState): string[] {
  const lines: string[] = [];
  if (!state.field) return lines;
  for (const key of ["a", "b"] as const) {
    const fighter = state[key];
    if (isFainted(fighter) || fighter.itemConsumed) continue;
    const ability = fighter.effectiveAbilityId ? getAbility(fighter.effectiveAbilityId) : undefined;
    const item = ability?.disablesOwnItemEffects
      ? undefined
      : fighter.currentItemId
        ? getItem(fighter.currentItemId)
        : undefined;
    const seed = item?.terrainSeedBoost;
    if (!seed || seed.field !== state.field) continue;
    fighter.stages = applyStageDelta(fighter.stages, seed.stat, contraryDelta(fighter, 1));
    consumeItem(fighter);
    const name = getPokemon(fighter.slot.pokemonId)?.name ?? "포켓몬";
    const statText = seed.stat === "def" ? "방어가" : "특수방어가";
    lines.push(`${name}의 ${item!.name}! ${statText} 올랐다!`);
    // 곡예: resolveAction의 행동 단위 전후비교(§attackerItemIdBeforeAction)는 "하나의 행동" 범위
    // 밖에서 일어나는 이 시드 소모(배틀 시작/교체 등장/메가진화 시 등장 특성 처리 중)를 못 잡는다
    // — 이 자리에서 직접 판정해야 한다(ver.1.7 §1-2에서 확인된 버그).
    if (ability?.doublesSpeedOnItemLoss && !fighter.unburdenActive) {
      fighter.unburdenActive = true;
      lines.push(`${name}의 ${ability.name}! 스피드가 2배로 올랐다!`);
    }
  }
  return lines;
}

/**
 * 일루전(§6-1): selfIndex 슬롯의 조로아크가 위장할 대상 종 id. 파티 뒤에서부터 스캔해
 * "자신 아님 + 안 쓰러짐"인 첫 슬롯의 종을 쓴다(본가: 마지막 포켓몬 모습). 없으면 undefined(위장 안 함).
 */
export function computeIllusionTarget(party: BattleFighterState[], selfIndex: number): string | undefined {
  for (let i = party.length - 1; i >= 0; i--) {
    if (i === selfIndex || isFainted(party[i])) continue;
    return party[i].slot.pokemonId;
  }
  return undefined;
}

/**
 * 교체로 나온 포켓몬이 상대 진영 설치물을 밟을 때의 처리(Phase 8 §6). performSwitch에서
 * 등장 특성보다 먼저 호출한다. 순서:
 *  1. 독타입이면 독압정을 흡수해 제거
 *  2. 스텔스록 등장 데미지(바위 상성 배율, 매직가드가 막음)
 *  3. 접지 상태면: 압정뿌리기 데미지(매직가드가 막음) → 독압정 중독 → 끈적끈적네트 스피드 -1
 */
function applyEntryHazardsOnSwitchIn(state: BattleState, key: FighterKey, log: string[]): void {
  const self = state[key];
  if (isFainted(self)) return;
  const hz = sideOf(state, key).hazards;
  const selfName = getPokemon(self.slot.pokemonId)?.name ?? "포켓몬";
  const selfAbility = abilityOf(self);

  // 1. 독타입 등장 → 독압정 흡수
  if (hz.toxicSpikesLayers > 0 && self.types.includes("독")) {
    hz.toxicSpikesLayers = 0;
    log.push(`${selfName}${eunNeun(selfName)} 독압정을 흡수했다!`);
  }

  // 2. 스텔스록 (접지 무관, 바위 상성)
  const stealthRockDamage = calcStealthRockDamage(self.maxHp, self.types, selfAbility, hz);
  if (stealthRockDamage > 0) {
    self.currentHp = Math.max(0, self.currentHp - stealthRockDamage);
    log.push(`뾰족한 바위가 ${selfName}${eulReul(selfName)} 덮쳤다! (${stealthRockDamage} 데미지)`);
  }
  if (isFainted(self)) return;

  // 3. 접지 대상만: 압정뿌리기 · 독압정 · 끈적끈적네트
  if (isGroundedForHazards(self.types, selfAbility)) {
    const spikesDamage = calcSpikesDamage(self.maxHp, self.types, selfAbility, hz);
    if (spikesDamage > 0) {
      self.currentHp = Math.max(0, self.currentHp - spikesDamage);
      log.push(`${selfName}${eunNeun(selfName)} 압정에 상처를 입었다! (${spikesDamage} 데미지)`);
    }
    if (isFainted(self)) return;

    if (
      hz.toxicSpikesLayers > 0 &&
      !self.status.condition &&
      !isImmuneToStatus(hz.toxicSpikesLayers >= 2 ? "badly-poisoned" : "poison", self.types, statusImmunitiesOf(self, selfAbility)) &&
      !isStatusBlockedByField(state.field, "poison") &&
      sideOf(state, key).safeguardTurnsRemaining === undefined
    ) {
      const cond: StatusCondition = hz.toxicSpikesLayers >= 2 ? "badly-poisoned" : "poison";
      self.status = inflictStatus(self.status, cond);
      log.push(
        cond === "badly-poisoned"
          ? `${selfName}의 몸에 맹독이 퍼졌다!`
          : `${selfName}의 몸에 독이 퍼졌다!`,
      );
    }

    if (hz.stickyWeb) {
      const before = self.stages.spe;
      self.stages = applyStageDelta(self.stages, "spe", contraryDelta(self, -1));
      if (self.stages.spe !== before) {
        log.push(`${selfName}${eunNeun(selfName)} 끈적끈적네트에 걸려 스피드가 떨어졌다!`);
      }
    }
  }
}

/**
 * 교체로 나온 포켓몬 하나에 대해 "등장 시 특성"을 적용한다(Phase 8 §4 골격).
 * createBattleState의 resolveEntryAbilityEffects는 양쪽을 스피드 순으로 동시에 처리하는
 * 배틀 시작 전용이라, 한 마리만 등장하는 교체용으로 이 단일 버전을 따로 둔다.
 * 처리: 위협(상대 랭크 하락) · 가뭄류(날씨) · 일렉트릭메이커류(필드) · 트레이스(상대 특성 복사) ·
 * 배리어프리(양쪽 편 스크린 제거, §6-3). (다운로드·기분파 등은 로스터에 없거나 다른 훅에서 처리.)
 */
function applyEntryAbilityOnSwitchIn(state: BattleState, key: FighterKey, log: string[]): void {
  const self = state[key];
  const oppKey = opponentKey(key);
  const opponent = state[oppKey];
  const ability = self.effectiveAbilityId ? getAbility(self.effectiveAbilityId) : undefined;
  if (!ability || isFainted(self)) return;
  const selfName = getPokemon(self.slot.pokemonId)?.name ?? "포켓몬";

  // 배리어프리(Screen Cleaner): 등장 시 양쪽 편의 스크린을 전부 없앤다(§6-3).
  if (ability.clearsAllScreensOnEntry) {
    const hadAny =
      Object.keys(state.sideA.screens).length > 0 || Object.keys(state.sideB.screens).length > 0;
    state.sideA.screens = {};
    state.sideB.screens = {};
    if (hadAny) {
      log.push(`${selfName}의 ${ability.name}! 양쪽의 빛의장막과 리플렉터가 사라졌다!`);
    }
  }

  // 일루전(§6-1): 등장 시 파티 마지막 슬롯 모습으로 위장한다(별도 로그 없음 — 상대는 눈치채지 못한다).
  if (ability.illusion) {
    const s = sideOf(state, key);
    self.illusionAs = computeIllusionTarget(s.party, s.activeIndex);
  }

  // 위협류 (파수견·주눅 반응 포함)
  if (ability.lowersOpponentStatOnEntry && !isFainted(opponent)) {
    const opponentName = getPokemon(opponent.slot.pokemonId)?.name ?? "상대";
    applyIntimidateWithReaction(
      opponent,
      ability.lowersOpponentStatOnEntry,
      selfName,
      ability.name,
      opponentName,
      log,
    );
  }
  // 가뭄·잔비·모래날림·눈퍼뜨리기: 다른 날씨가 있어도 덮어쓴다(기술 setsWeather와 동일)
  if (ability.setsWeather) {
    const weather = ability.setsWeather;
    state.weather = weather;
    state.weatherTurnsRemaining =
      WEATHER_DURATION + weatherRockBonus(weather, state.a.slot, state.b.slot);
    log.push(`${selfName}의 ${ability.name}! 날씨가 ${weather}${roEuro(weather)} 바뀌었다!`);
    applyForecastForm(state.a, activeWeather(state));
    applyForecastForm(state.b, activeWeather(state));
  }
  // 일렉트릭메이커류: 같은 필드가 이미 있으면 실패, 다른 필드가 있으면 날씨처럼 덮어쓴다.
  if (ability.setsFieldOnEntry) {
    if (state.field === ability.setsFieldOnEntry) {
      log.push(`${selfName}의 ${ability.name}! 하지만 이미 같은 필드가 있어 실패했다!`);
    } else {
      state.field = ability.setsFieldOnEntry;
      // 그라운드코트: 필드를 편 쪽이 이 도구를 지녔으면 지속시간이 늘어난다(기본 5턴 + 3 = 8턴).
      const selfItem = self.currentItemId ? getItem(self.currentItemId) : undefined;
      state.fieldTurnsRemaining = FIELD_DURATION + (selfItem?.fieldDurationBonus ?? 0);
      log.push(`${selfName}의 ${ability.name}! ${FIELD_ENTRY_ANNOUNCEMENT[state.field]}`);
      applyMimicryForm(self, state.field);
    }
  }
  // 트레이스: 상대의 현재 특성을 복사
  if (ability.copiesOpponentAbilityOnEntry && opponent.effectiveAbilityId && !isFainted(opponent)) {
    const copied = getAbility(opponent.effectiveAbilityId);
    self.effectiveAbilityId = opponent.effectiveAbilityId;
    const opponentName = getPokemon(opponent.slot.pokemonId)?.name ?? "상대";
    const copiedName = copied?.name ?? "특성";
    log.push(`${selfName}의 ${ability.name}! ${opponentName}의 ${copiedName}${eulReul(copiedName)} 복사했다!`);
  }
  // 괴짜(Imposter): 등장하자마자 상대로 변신한다(변신 기술과 같은 처리, state.ts의 배틀 시작
  // 버전과 동일 — 여태 배틀 시작(리드)에만 있고 교체 등장엔 빠져 있던 처리를 여기 추가).
  if (ability.transformsIntoOpponentOnEntry && !self.transformed && !isFainted(opponent)) {
    applyTransform(self, opponent);
    const opponentName = getPokemon(opponent.slot.pokemonId)?.name ?? "상대";
    log.push(`${selfName}의 ${ability.name}! ${selfName}${eunNeun(selfName)} ${opponentName}${roEuro(opponentName)} 변신했다!`);
  }
}

/**
 * 메가진화 선언을 처리한다(백로그 §4). 스톤을 든 활성 포켓몬을 그 자리에서 메가폼으로 바꾼다 —
 * 타입·특성·실능치를 메가폼 기준으로 교체하고 편의 megaUsed·파이터의 hasMegaEvolved를 세운다.
 * 조건(스톤 없음·이미 메가·편이 이미 씀·기절)에 안 맞으면 아무것도 안 하고 false를 돌려준다.
 *
 * 메가폼의 특성이 등장 특성(가뭄·모래날림·일렉트릭메이커·위협·트레이스 등)이면, 본가처럼
 * 메가진화 시점에 그 효과가 발동한다 — applyEntryAbilityOnSwitchIn을 그대로 재사용한다(§4 후속).
 */
export function applyMegaEvolution(state: BattleState, key: FighterKey, log: string[]): boolean {
  const side = sideOf(state, key);
  const fighter = state[key];
  if (side.megaUsed || fighter.hasMegaEvolved || !fighter.megaStone || isFainted(fighter)) return false;
  const pokemon = getPokemon(fighter.slot.pokemonId);
  const mega = pokemon?.megaEvolutions?.find((m) => m.megaStone === fighter.megaStone);
  if (!mega) return false;

  const newStats = computeRealStats(mega.baseStats, fighter.slot.points, fighter.slot.nature);
  const hpDelta = newStats.hp - fighter.maxHp; // 공식 메가폼은 HP 불변이지만 비공식 폼 대비 안전하게
  fighter.types = [...mega.types];
  fighter.effectiveAbilityId = mega.ability;
  fighter.realStats = newStats;
  fighter.maxHp = newStats.hp;
  fighter.currentHp = Math.min(newStats.hp, Math.max(1, fighter.currentHp + Math.max(0, hpDelta)));
  fighter.hasMegaEvolved = true;
  side.megaUsed = true;

  const nm = pokemon?.name ?? "포켓몬";
  // 폼 이름은 "이어롭-메가"지만 로그엔 정식 명칭 "메가이어롭"으로. 조사도 바뀐 이름 기준으로.
  const megaName = megaFormFullName(mega);
  log.push(`${nm}${eunNeun(nm)} ${megaName}${roEuro(megaName)} 메가진화했다!`);

  // 메가폼의 등장 특성 발동(가뭄·위협·트레이스 등). 교체 등장이 아니라 그 자리에서의 발동이지만
  // 처리 내용은 동일하다 — 날씨/필드 덮어쓰기, 상대 랭크 하락, 상대 특성 복사 등.
  applyEntryAbilityOnSwitchIn(state, key, log);
  log.push(...triggerTerrainSeeds(state));
  return true;
}

/**
 * 편(side)의 활성 슬롯을 toIndex로 바꾼다(Phase 8 §3). 물러나는 포켓몬의 "슬롯에 종속된"
 * 휘발 상태(랭크·행동방해·차지·비축·연속기 잠금 등)를 본가 규칙대로 초기화하고, 나가는 쪽에
 * 재생력·자연회복을, 새로 나온 쪽에 폼(기분파·의태)·스탠스·등장 특성(위협·날씨 등)을 적용한다.
 * state.a/state.b 포인터도 다시 문다. 발생한 안내 문구는 log 배열에 push한다.
 *
 * 설치물 발동(스텔스록 등장 데미지 등)은 §5에서 이 함수의 "등장 파이프라인" 지점에 붙는다.
 * toIndex가 현재 활성이거나 범위를 벗어나면 아무것도 안 한다.
 */
export function performSwitch(
  state: BattleState,
  key: FighterKey,
  toIndex: number,
  log: string[] = [],
  /** 자기 의지로 교체했으면 true(runTurn 교체 액션). 기절 후 강제 교체(applySwitch)면 false — 가속 발동. */
  voluntary = true,
  /** 배턴터치: 물러나는 포켓몬의 랭크·급소랭크·대타·멸망카운트·일부 volatile을 새로 나온 포켓몬이 이어받는다. */
  passBaton = false,
  /** 꼬리자르기: 물러나는 포켓몬이 세운 대타만 새로 나온 포켓몬에게 넘긴다(랭크 등은 안 넘김). */
  passSubstituteOnly = false,
): void {
  const side = sideOf(state, key);
  if (toIndex === side.activeIndex || toIndex < 0 || toIndex >= side.party.length) return;
  const outgoing = side.party[side.activeIndex];

  // 꼬리자르기: 리셋으로 outgoing.substituteHp가 지워지기 전에 인계값을 잡아둔다(배턴터치는 아래 baton 스냅샷에서 별도 처리).
  const carriedSubstituteHp = passSubstituteOnly ? outgoing.substituteHp : undefined;

  // ── 배턴터치: 아래에서 outgoing 상태를 초기화하기 전에 인계할 값을 미리 스냅샷 ──
  const BATON_VOLATILE_KEYS: VolatileCondition[] = [
    "confusion",
    "ingrain",
    "aquaRing",
    "leechSeed",
    "syrupCoat",
  ];
  const baton = passBaton
    ? {
        stages: { ...outgoing.stages },
        accuracyStages: { ...outgoing.accuracyStages },
        critStage: outgoing.critStage,
        substituteHp: outgoing.substituteHp,
        perishCount: outgoing.perishCount,
        volatiles: BATON_VOLATILE_KEYS.reduce<VolatileConditionState["active"]>((acc, k) => {
          const entry = outgoing.volatile.active[k];
          if (entry) acc[k] = entry;
          return acc;
        }, {}),
      }
    : undefined;

  // ── 물러나는 포켓몬: 재생력·자연회복(살아서 물러날 때만) ──
  // 별도 로그 문구는 내지 않는다(사용자 결정 2026-09-03) — 파티 트래커의 HP 바 회복·상태이상
  // 마크 소멸로만 보여준다.
  if (!isFainted(outgoing)) {
    const outAbility = outgoing.effectiveAbilityId ? getAbility(outgoing.effectiveAbilityId) : undefined;
    if (outAbility?.healsFractionOnSwitchOut && outgoing.currentHp < outgoing.maxHp) {
      const heal = Math.min(
        outgoing.maxHp - outgoing.currentHp,
        Math.max(1, Math.floor(outgoing.maxHp * outAbility.healsFractionOnSwitchOut)),
      );
      outgoing.currentHp += heal;
    }
    if (outAbility?.curesStatusOnSwitchOut && outgoing.status.condition) {
      outgoing.status = { ...NO_STATUS_CONDITION };
    }
  }

  // ── 물러나는 포켓몬: 슬롯 종속 상태 초기화 ──
  outgoing.stages = { ...NEUTRAL_STAGES };
  outgoing.accuracyStages = { ...NEUTRAL_ACCURACY_STAGES };
  outgoing.critStage = NEUTRAL_CRIT_STAGE;
  outgoing.statStagesAtTurnStart = undefined;
  // 행동방해류(혼란·도발·앙코르·사슬묶기·씨뿌리기·헤롱헤롱·뿌리박기·아쿠아링 등) 전부 해제.
  // 단 소금절이(saltCure)는 교체로 풀리지 않는다(본가) — 그것만 남긴다.
  {
    const kept = outgoing.volatile.active.saltCure;
    outgoing.volatile = { active: kept ? { saltCure: kept } : {} };
  }
  outgoing.chargingMoveId = undefined;
  outgoing.lastMoveId = undefined;
  outgoing.lastMoveStreak = undefined;
  outgoing.stockpileCount = undefined;
  outgoing.perishCount = undefined;
  outgoing.destinyBondArmed = undefined;
  outgoing.glaiveRushVulnerable = undefined;
  outgoing.substituteHp = undefined;
  outgoing.activeProtect = undefined;
  outgoing.protectStreak = undefined;
  outgoing.moveTypeOverrideThisTurn = undefined;
  outgoing.electroChargedForElectric = undefined;
  outgoing.damageTakenThisTurn = { physical: 0, special: 0 };
  outgoing.consecutiveLockMoveId = undefined;
  outgoing.consecutiveLockUntilTurn = undefined;
  // 곡예(Unburden): 본가는 "도구를 잃은 뒤 교체하기 전까지"만 2배 유지 — 교체로 물러나면 해제(§8).
  outgoing.unburdenActive = undefined;
  // 일루전(§6-1): 물러나면 위장 해제 — 다시 나올 때 파티 상태에 맞춰 재계산된다.
  outgoing.illusionAs = undefined;
  // 유지: currentHp · status(주 상태이상) · remainingPp · itemConsumed · currentItemId ·
  //       consumedBerryId · addedType · timesHitByMoves(교체 초기화 미도입) · ownMoveTypeBoosts ·
  //       disguiseBroken · hungerMode.
  //   스크린(§6-3)·희망사항(§6-2)은 편(BattleSide.screens / .wish)에 있어 교체해도 유지된다.
  //   후속: transformed(변신 원복 — 메타몽 전용이라 미도입).

  // 문어굳히기/물고버티기: 이 편이 자리를 비우면(교체·기절 후 교체 모두 이 함수를 지난다),
  // 자리를 비운 쪽이 상대에게 걸어놨던 도망봉인이 풀린다. 물고버티기는 서로 걸어서 상대 쪽
  // 것도 여기서 함께 풀린다(물러나는 쪽 것은 아래 volatile 초기화에서 지워진다).
  {
    const opp = state[opponentKey(key)];
    if (hasVolatile(opp.volatile, "octolock") || hasVolatile(opp.volatile, "jawLock")) {
      const next = { ...opp.volatile.active };
      delete next.octolock;
      delete next.jawLock;
      opp.volatile = { active: next };
    }
  }

  // ── 활성 슬롯 전환 ──
  side.activeIndex = toIndex;
  if (key === "a") state.a = side.party[toIndex];
  else state.b = side.party[toIndex];
  const incoming = side.party[toIndex];

  // 가속 억제(§8): 자발적 교체로 나온 턴엔 가속이 발동하지 않는다. 강제 교체(voluntary=false)면 세우지 않음.
  incoming.switchedInThisTurn = voluntary || undefined;
  // 등장당 1회 판정(속이기·변환자재)은 새로 나온 포켓몬 기준으로 리셋한다.
  incoming.hasActedSinceSwitchIn = undefined;
  incoming.proteanActivatedSinceSwitchIn = undefined;

  // ── 배턴터치: 스냅샷해둔 랭크·대타·volatile을 새로 나온 포켓몬에게 인계 ──
  // 등장 파이프라인(위협·설치물)보다 먼저 얹어야 위협이 인계된 공격 랭크 위에 정상 적용된다.
  if (baton) {
    incoming.stages = baton.stages;
    incoming.accuracyStages = baton.accuracyStages;
    incoming.critStage = baton.critStage;
    if (baton.substituteHp !== undefined) incoming.substituteHp = baton.substituteHp;
    if (baton.perishCount !== undefined) incoming.perishCount = baton.perishCount;
    incoming.volatile = { active: { ...incoming.volatile.active, ...baton.volatiles } };
  }

  // ── 꼬리자르기: 세운 대타만 인계 ──
  if (carriedSubstituteHp !== undefined) incoming.substituteHp = carriedSubstituteHp;

  // 킬가르도: 등장 시 항상 실드폼으로 복귀
  if (incoming.stanceChangeForms) incoming.currentStanceForm = "shield";
  // 기분파·의태: 등장 시점의 날씨/필드에 맞춰 타입 정렬
  applyForecastForm(incoming, activeWeather(state));
  applyMimicryForm(incoming, state.field);

  // ── 등장 파이프라인 (Phase 8 §4·§6) ──
  // 1. 설치물 발동 — 스텔스록 등장 데미지, 압정뿌리기 스택, 독압정 중독, 끈적끈적네트 스피드 다운,
  //    독타입이면 독압정 흡수. 스텔스록·압정 데미지는 매직가드가 막는다(ability.ts:307 주석 참조 —
  //    인분은 "기술의 추가효과"만 막아 설치물엔 무관).
  applyEntryHazardsOnSwitchIn(state, key, log);
  // 2. 등장 특성 — 위협·가뭄류·필드·트레이스. 설치물로 이미 기절했으면 스킵된다(내부에서 isFainted 가드).
  applyEntryAbilityOnSwitchIn(state, key, log);
  // 3. 시드류 — 이미 필드가 있으면(방금 등장 특성으로 깔린 경우 포함) 발동.
  log.push(...triggerTerrainSeeds(state));
  // 4. 풍선 — 지니고 등장하면 공중에 떠있다는 안내를 낸다.
  const balloonMsg = balloonEntryAnnouncement(incoming);
  if (balloonMsg) log.push(balloonMsg);

  // TODO(§8): 추격(Pursuit)은 로스터에 없어 미구현 — 교체 대상을 위력 2배로 선타하는 예외.
}

export interface ApplySwitchOutcome {
  nextState: BattleState;
  /** 이 교체로 처리된 등장/퇴장 안내(재생력·자연회복·위협·날씨 등). 없으면 빈 배열 */
  entryMessages: string[];
  /** 물러난/새로 나온 포켓몬 종 id. 강제 교체 로그 문구용 */
  outPokemonId: string;
  inPokemonId: string;
}

/**
 * 강제 교체(기절 후) 또는 UI 교체 확정을 적용한 새 상태를 돌려준다. runTurn 밖에서 호출하며
 * prevState는 변형하지 않는다. turnNumber는 그대로 둔다(교체는 턴을 소비하지 않는 별도 조작).
 *
 * opts.voluntary: 유턴·볼트체인지·배턴터치 같은 자체 교체면 true(가속 억제). 기절 후 강제 교체면
 *   생략(false) — 새로 나온 포켓몬의 가속이 정상 발동한다.
 * opts.passBaton: 배턴터치면 true — 물러나는 포켓몬의 랭크·대타·일부 volatile을 인계한다.
 */
export function applySwitch(
  prevState: BattleState,
  key: FighterKey,
  toIndex: number,
  opts: { voluntary?: boolean; passBaton?: boolean } = {},
): ApplySwitchOutcome {
  const sideA = cloneSide(prevState.sideA);
  const sideB = cloneSide(prevState.sideB);
  const state: BattleState = {
    a: sideA.party[sideA.activeIndex],
    b: sideB.party[sideB.activeIndex],
    sideA,
    sideB,
    weather: prevState.weather,
    weatherTurnsRemaining: prevState.weatherTurnsRemaining,
    field: prevState.field,
    fieldTurnsRemaining: prevState.fieldTurnsRemaining,
    trickRoomTurnsRemaining: prevState.trickRoomTurnsRemaining,
    turnNumber: prevState.turnNumber,
    entryAnnouncements: prevState.entryAnnouncements,
  };
  const targetSide = sideOf(state, key);
  const outPokemonId = targetSide.party[targetSide.activeIndex].slot.pokemonId;
  const entryMessages: string[] = [];
  performSwitch(state, key, toIndex, entryMessages, opts.voluntary ?? false, opts.passBaton ?? false);
  const inFighter = sideOf(state, key).party[sideOf(state, key).activeIndex];
  // 일루전(§6-1): 위장 중이면 로그에도 위장 대상 이름이 나가야 상대가 안 눈치챈다.
  const inPokemonId = inFighter.illusionAs ?? inFighter.slot.pokemonId;
  return { nextState: state, entryMessages, outPokemonId, inPokemonId };
}

/**
 * 공격자 하나가 기술 하나를 쓰는 걸 처리한다. 명중 판정 → 급소 판정 → 데미지 계산(computeDamage 재사용)
 * → HP 차감 → 기술 자신의 랭크/명중회피/급소 변화 적용 → 상태이상 부여까지 한 번에 끝낸다.
 * evaluateSlotMatchup과 같은 하위 재료(특성 배율/자속/타입상성)를 그대로 재사용한다.
 */
/**
 * resolveAction의 "히트 판정 + 데미지 적용 + 그 직접 결과" 구간을 통째로 뺐다(ver.1.5 §7,
 * resolveHit·applyEndurance·applyDamageToDefender·checkDestinyBond·applyContactItemRecoil·
 * triggerAbilityHitEffect가 서로 얽혀 있는 단일 클러스터 — 원문 그대로 옮기고 입력/출력만
 * 명시적으로 뺐다. 내부 로직은 한 글자도 안 바꿈(순서·조건·계산식 전부 원본과 동일).
 */
