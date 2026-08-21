import type { Move } from "../types/move";
import type { WeatherKind } from "../types/weather";
import type { PokemonType } from "../types/pokemon-type";
import {
  NEUTRAL_ACCURACY_STAGES,
  NEUTRAL_CRIT_STAGE,
  NEUTRAL_STAGES,
  type AccuracyEvasionStages,
  type CritStage,
  type StatStages,
} from "../types/battleStats";
import {
  NO_STATUS_CONDITION,
  NO_VOLATILE_CONDITIONS,
  type StatusConditionState,
  type VolatileCondition,
  type VolatileConditionState,
} from "../types/status";
import { getPokemon, getAbility } from "./data";
import { getEffectiveForm } from "./pokemonForm";
import { computeRealStats } from "./statCalculator";
import { applyMoveStatChanges } from "./statStages";
import {
  applyMoveAccuracyEvasionChanges,
  applyMoveCritStageChanges,
  computeHitChance,
  critChance,
} from "./accuracyCrit";
import {
  advanceStatusTurn,
  checkStatusActionBlock,
  computeStatusAttackMultiplier,
  computeStatusEndOfTurnDamage,
  computeStatusSpeedMultiplier,
  ignoresBurnAttackPenalty,
  inflictStatus,
  isImmuneToStatus,
} from "./statusConditions";
import {
  CONFUSION_SELF_HIT_CHANCE,
  CONFUSION_SELF_HIT_POWER,
  consumeVolatileTurn,
  hasVolatile,
  inflictVolatile,
} from "./volatileConditions";
import { resolveMoveContext } from "./moveContext";
import { computeDamage } from "./battlePower";
import { compareTurnOrder } from "./turnOrder";
import type { BaseStats } from "../types/stats";
import type { EvaluatorSlot } from "./matchupEvaluator";

/** 데미지 난수 하한. computeDamage의 randomRoll에 매턴 0.85~1.00 사이 값을 뽑아 넘길 때 쓴다 */
const MIN_DAMAGE_ROLL = 0.85;

/** 혼란 자멸 데미지 계산용 가짜 기술. 타입 없음(자속 안 붙음)·물리·위력 40으로 자기 자신을 타격한다 */
const CONFUSION_SELF_HIT_MOVE: Move = {
  id: "__confusion_self_hit__",
  name: "혼란 자멸",
  type: null,
  category: "physical",
  power: CONFUSION_SELF_HIT_POWER,
  accuracy: null,
  pp: 0,
  priority: 0,
  effect: "혼란 상태에서 스스로에게 가하는 데미지",
};

/**
 * 발버둥. 4개 기술 PP가 전부 0이 되면 자동으로 나가는 비상 기술이라 moves.json에는 없다(사용자 확인).
 * ???타입(=type null → resolveMoveContext/computeDamage가 이미 null-safe해서 자속·상성 없이 항상 등배로 처리됨)·
 * 물리·위력 50·필중(accuracy null). pp는 실제로 소모 관리하지 않으므로(remainingPp에 키가 없어 자동으로
 * 스킵됨) 의미상 최댓값만 채워둔 값 — 임의로 1로 정하지 않아도 된다는 요청 그대로 반영.
 */
export const STRUGGLE_MOVE: Move = {
  id: "__struggle__",
  name: "발버둥",
  type: null,
  category: "physical",
  power: 50,
  accuracy: null,
  pp: 1,
  priority: 0,
  effect: "사용할 수 있는 기술이 없을 때 자동으로 사용된다. 필중이며, 사용자는 최대 HP의 1/4만큼 반동 데미지를 입는다.",
};

/** 시뮬레이터 안에서 한 포켓몬이 갖는 전체 상태. 파티 슬롯(정적 정보) + 배틀 중 바뀌는 값들 */
export interface BattleFighterState {
  slot: EvaluatorSlot;
  types: PokemonType[];
  realStats: BaseStats;
  currentHp: number;
  maxHp: number;
  stages: StatStages;
  accuracyStages: AccuracyEvasionStages;
  critStage: CritStage;
  /** 주 상태이상(화상/독/맹독/마비/잠듦/얼음). 한 번에 하나만 */
  status: StatusConditionState;
  /** 행동방해류(풀죽음/반동/혼란). 주 상태이상과 별도 축이라 여러 개 동시에 걸릴 수 있다 */
  volatile: VolatileConditionState;
  /** move id → 남은 PP */
  remainingPp: Record<string, number>;
}

/** 두 포켓몬(a/b)을 마주 세운 배틀 상태 */
export interface BattleState {
  a: BattleFighterState;
  b: BattleFighterState;
  weather?: WeatherKind;
  turnNumber: number;
}

export type FighterKey = "a" | "b";

/** 상대 키를 구한다 */
export function opponentKey(key: FighterKey): FighterKey {
  return key === "a" ? "b" : "a";
}

/**
 * 파티 슬롯과 보유 기술 목록으로 초기 배틀 상태를 만든다. HP는 만HP로 시작하고,
 * 랭크·명중/회피/급소 카운터·상태이상은 전부 중립, PP는 각 기술의 최대치로 채운다.
 */
export function createFighterState(slot: EvaluatorSlot, moves: Move[]): BattleFighterState {
  const pokemon = getPokemon(slot.pokemonId);
  if (!pokemon) throw new Error(`알 수 없는 포켓몬: ${slot.pokemonId}`);

  const form = getEffectiveForm(pokemon, slot);
  const realStats = computeRealStats(form.baseStats, slot.points, slot.nature);

  return {
    slot,
    types: form.types,
    realStats,
    currentHp: realStats.hp,
    maxHp: realStats.hp,
    stages: { ...NEUTRAL_STAGES },
    accuracyStages: { ...NEUTRAL_ACCURACY_STAGES },
    critStage: NEUTRAL_CRIT_STAGE,
    status: { ...NO_STATUS_CONDITION },
    volatile: { active: { ...NO_VOLATILE_CONDITIONS.active } },
    remainingPp: Object.fromEntries(moves.map((m) => [m.id, m.pp])),
  };
}

export function createBattleState(
  a: EvaluatorSlot,
  aMoves: Move[],
  b: EvaluatorSlot,
  bMoves: Move[],
  weather?: WeatherKind,
): BattleState {
  return {
    a: createFighterState(a, aMoves),
    b: createFighterState(b, bMoves),
    weather,
    turnNumber: 0,
  };
}

/**
 * 지닌 기술 중 PP가 남은 게 하나라도 있는지. 전부 0이면(또는 애초에 기술이 없으면) 발버둥을
 * 자동으로 써야 한다는 뜻이라, UI(BattleLogPage)가 기술 선택을 요구하지 않고 곧장 STRUGGLE_MOVE로
 * 진행하도록 이 함수로 판단한다.
 */
export function hasUsableMove(fighter: BattleFighterState): boolean {
  return Object.values(fighter.remainingPp).some((pp) => pp > 0);
}

/** 이번 턴 행동이 왜 못 나갔는지. 있으면 hit/damage 등은 의미 없다 */
export type ActionBlockReason = "status" | "flinch" | "recharge" | "confusion";

/** 한 번의 기술 사용 결과 로그 */
export interface ActionLogEntry {
  actor: FighterKey;
  move: Move;
  /** 주 상태이상(잠듦/얼음/마비)이나 행동방해(풀죽음/반동/혼란 자멸)로 기술을 못 썼으면 채워진다 */
  blockedReason?: ActionBlockReason;
  /** 회피/빗나감 여부. 필중기는 항상 true. blockedReason이 있으면 의미 없음 */
  hit: boolean;
  critical: boolean;
  damage: number;
  damagePercent: number;
  defenderRemainingHp: number;
  /** 스스로 입은 데미지. 혼란 자멸(blockedReason === "confusion") 또는 발버둥 반동(move.id === STRUGGLE_MOVE.id)일 때만 0보다 크다 */
  selfDamage: number;
  attackerRemainingHp: number;
  inflictedStatus?: StatusConditionState["condition"];
  inflictedVolatile?: VolatileCondition;
  /** 이 행동으로 defender가 쓰러졌으면 true */
  fainted: boolean;
  /** 혼란 자멸로 스스로 쓰러졌으면 true */
  selfFainted: boolean;
}

/** 턴 종료 시 상태이상 데미지 로그 */
export interface EndOfTurnLogEntry {
  actor: FighterKey;
  damage: number;
  remainingHp: number;
  fainted: boolean;
}

export interface TurnResult {
  turnNumber: number;
  /** 이번 턴 실제로 먼저 행동한 쪽 */
  order: [FighterKey, FighterKey];
  actions: ActionLogEntry[];
  endOfTurn: EndOfTurnLogEntry[];
  /**
   * 어느 한쪽(또는 양쪽) HP가 0 이하가 되면 채워짐. 자폭류(selfFaints)로 상대를 쓰러뜨리면서
   * 자신도 같이 기절하거나, 턴 종료 상태이상 데미지로 양쪽이 동시에 0이 되면 "draw".
   */
  winner?: FighterKey | "draw";
}

function isFainted(fighter: BattleFighterState): boolean {
  return fighter.currentHp <= 0;
}

function cloneFighter(fighter: BattleFighterState): BattleFighterState {
  return {
    ...fighter,
    stages: { ...fighter.stages },
    accuracyStages: { ...fighter.accuracyStages },
    status: { ...fighter.status },
    volatile: { active: { ...fighter.volatile.active } },
    remainingPp: { ...fighter.remainingPp },
  };
}

/**
 * 공격자 하나가 기술 하나를 쓰는 걸 처리한다. 명중 판정 → 급소 판정 → 데미지 계산(computeDamage 재사용)
 * → HP 차감 → 기술 자신의 랭크/명중회피/급소 변화 적용 → 상태이상 부여까지 한 번에 끝낸다.
 * evaluateSlotMatchup과 같은 하위 재료(특성 배율/자속/타입상성)를 그대로 재사용한다.
 */
function resolveAction(
  state: BattleState,
  actorKey: FighterKey,
  move: Move,
  random: () => number,
): ActionLogEntry {
  const defenderKey = opponentKey(actorKey);
  const attacker = state[actorKey];
  const defender = state[defenderKey];

  // PP 소모는 행동 여부와 무관하게 발생
  if (attacker.remainingPp[move.id] !== undefined) {
    attacker.remainingPp[move.id] = Math.max(0, attacker.remainingPp[move.id] - 1);
  }

  const blocked = (reason: ActionBlockReason, selfDamage = 0): ActionLogEntry => ({
    actor: actorKey,
    move,
    blockedReason: reason,
    hit: false,
    critical: false,
    damage: 0,
    damagePercent: 0,
    defenderRemainingHp: defender.currentHp,
    selfDamage,
    attackerRemainingHp: attacker.currentHp,
    fainted: false,
    selfFainted: isFainted(attacker),
  });

  // 1) 주 상태이상(잠듦/얼음/마비)으로 행동 자체가 막히는지. 잠듦/얼음은 이 판정 안에서
  // 자체 해제 카운터가 갱신되므로 결과를 attacker.status에 반드시 반영해야 한다.
  const statusCheck = checkStatusActionBlock(attacker.status, random);
  attacker.status = statusCheck.nextState;
  if (statusCheck.blocked) return blocked("status");

  // 2) 풀죽음/반동: 1턴짜리 행동방해. 걸려있으면 이번 턴 소모하고 못 움직인다
  if (hasVolatile(attacker.volatile, "flinch")) {
    attacker.volatile = consumeVolatileTurn(attacker.volatile, "flinch");
    return blocked("flinch");
  }
  if (hasVolatile(attacker.volatile, "recharge")) {
    attacker.volatile = consumeVolatileTurn(attacker.volatile, "recharge");
    return blocked("recharge");
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

  const attackerAbility = attacker.slot.ability ? getAbility(attacker.slot.ability) : undefined;
  const defenderAbility = defender.slot.ability ? getAbility(defender.slot.ability) : undefined;

  // evaluateSlotMatchup(1턴 스냅샷 판정)과 같은 로직을 공유 — 특성 배율/타입 변경/자속/상대 상성
  const { effectiveMove, abilityOffenseMultiplier, abilityDefenseMultiplier, stabMultiplier, typeEffectiveness } =
    resolveMoveContext(attackerAbility, move, defender.types, defenderAbility, state.weather);

  // 반짝가루/모래숨기 같은 명중률 전용 특성·도구 배율은 아직 데이터 구조가 없어 1로 고정 (TODO: 데이터 보강)
  const accuracyExtraMultiplier = 1;
  const hitChance = computeHitChance(
    effectiveMove.accuracy,
    attacker.accuracyStages.accuracy,
    defender.accuracyStages.evasion,
    accuracyExtraMultiplier,
  );
  const hit = hitChance === null ? true : random() < hitChance;

  if (!hit) {
    // 자폭류(대폭발 등)는 빗나가도 사용자가 반드시 기절한다 (본가 규칙). 데미지가 아예 없는
    // 경로라 승자 판정에 영향을 줄 순서 문제도 없다 — 그냥 여기서 바로 처리해도 된다.
    if (effectiveMove.selfFaints) {
      attacker.currentHp = 0;
    }
    return {
      actor: actorKey,
      move,
      hit,
      critical: false,
      damage: 0,
      damagePercent: 0,
      defenderRemainingHp: defender.currentHp,
      selfDamage: 0,
      attackerRemainingHp: attacker.currentHp,
      fainted: false,
      selfFainted: isFainted(attacker),
    };
  }

  // status 기술(도깨비불·최면술 등 위력 없는 변화기)은 데미지 계산을 건너뛴다.
  // 예전엔 여기서 바로 return 해버려서 이런 기술들의 랭크변화/상태이상 부여가 전혀 발동하지 않는
  // 버그가 있었다 — 명중만 하면 데미지 유무와 무관하게 아래 효과 적용까지 항상 도달해야 한다.
  // 나이트헤드처럼 fixedDamage 기술은 power가 null(가변형과 동일한 "수치 없음" 표기)이라
  // power !== null 조건만으로는 걸러진다 — fixedDamage가 있으면 power 유무와 무관하게 데미지 기술로 취급한다.
  const isDamaging =
    effectiveMove.category !== "status" &&
    (effectiveMove.power !== null || effectiveMove.fixedDamage !== undefined);
  let damage = 0;
  let damagePercent = 0;
  let isCritical = false;

  if (isDamaging && effectiveMove.fixedDamage !== undefined) {
    // 나이트헤드류: 방어/랭크/특성/도구/급소를 전부 무시하고 고정 수치만 깎는다.
    // 타입 상성 면역(0배)만은 그대로 존중 — 반감/2배는 적용하지 않는다.
    damage = typeEffectiveness === 0 ? 0 : effectiveMove.fixedDamage;
    damagePercent = damage / defender.realStats.hp;
    defender.currentHp = Math.max(0, defender.currentHp - damage);
  } else if (isDamaging) {
    isCritical = random() < critChance(attacker.critStage);
    const ignoreBurnPenalty = ignoresBurnAttackPenalty(attackerAbility?.id, effectiveMove.id);
    const statusAttackMultiplier = computeStatusAttackMultiplier(
      attacker.status.condition,
      effectiveMove.category,
      ignoreBurnPenalty,
    );

    const result = computeDamage(attacker.realStats, defender.realStats, attacker.types, effectiveMove, {
      typeEffectiveness,
      abilityMultiplier: abilityOffenseMultiplier * statusAttackMultiplier,
      stabMultiplier,
      attackerStages: attacker.stages,
      defenderStages: defender.stages,
      bulkMultiplier: abilityDefenseMultiplier,
      isCritical,
      randomRoll: MIN_DAMAGE_ROLL + random() * (1 - MIN_DAMAGE_ROLL),
    });

    damage = result?.damage ?? 0;
    damagePercent = result?.damagePercent ?? 0;
    defender.currentHp = Math.max(0, defender.currentHp - damage);
  }

  // 발버둥 반동: 필중이라 항상 이 지점까지 오고, 명중/기절 여부와 무관하게 사용자가
  // 최대 HP의 1/4만큼 반동 데미지를 입는다 (상대 데미지와는 별개 계산).
  let selfDamage = 0;
  if (move.id === STRUGGLE_MOVE.id) {
    selfDamage = Math.floor(attacker.maxHp / 4);
    attacker.currentHp = Math.max(0, attacker.currentHp - selfDamage);
  }

  // 자폭류(대폭발 등): 명중했으면 반드시 데미지를 먼저 입힌 "다음" 사용자가 기절한다.
  // 순서가 중요하다 — 이 데미지로 상대가 이미 쓰러졌다면, 실제 게임처럼 "상대를 먼저 쓰러뜨린 뒤
  // 반동으로 자신도 쓰러진 것"으로 취급되어야 승자 판정(runTurn)이 이 행동의 주체를 승자로 잡는다.
  if (effectiveMove.selfFaints) {
    attacker.currentHp = 0;
  }

  // 기술 자신의 랭크/명중회피/급소 변화 적용 (칼춤, 그림자분신, 기충전 등).
  // attacker/defender는 state.a/state.b를 그대로 참조하고 있어 여기서 바꾼 값이 state에도 반영된다.
  attacker.stages = applyMoveStatChanges(attacker.stages, effectiveMove, "self", { userTypes: attacker.types });
  defender.stages = applyMoveStatChanges(defender.stages, effectiveMove, "opponent", { userTypes: attacker.types });

  attacker.accuracyStages = applyMoveAccuracyEvasionChanges(attacker.accuracyStages, effectiveMove, "self", {
    userTypes: attacker.types,
  });
  defender.accuracyStages = applyMoveAccuracyEvasionChanges(defender.accuracyStages, effectiveMove, "opponent", {
    userTypes: attacker.types,
  });
  attacker.critStage = applyMoveCritStageChanges(attacker.critStage, effectiveMove, "self", {
    userTypes: attacker.types,
  });
  defender.critStage = applyMoveCritStageChanges(defender.critStage, effectiveMove, "opponent", {
    userTypes: attacker.types,
  });

  let inflictedStatus: StatusConditionState["condition"] | undefined;
  if (effectiveMove.inflictsStatus) {
    for (const effect of effectiveMove.inflictsStatus) {
      if (isImmuneToStatus(effect.status, defender.types)) continue;
      const chance = effect.chance !== undefined ? effect.chance / 100 : 1;
      if (random() < chance) {
        const before = defender.status.condition;
        defender.status = inflictStatus(defender.status, effect.status);
        if (defender.status.condition !== before) inflictedStatus = defender.status.condition;
        break; // 주 상태이상은 한 번에 하나만 걸린다 (중첩 없음)
      }
    }
  }

  let inflictedVolatile: VolatileCondition | undefined;
  if (effectiveMove.inflictsVolatile) {
    for (const effect of effectiveMove.inflictsVolatile) {
      const chance = effect.chance !== undefined ? effect.chance / 100 : 1;
      if (random() >= chance) continue;
      if (effect.target === "self") {
        attacker.volatile = inflictVolatile(attacker.volatile, effect.volatile, random);
      } else {
        defender.volatile = inflictVolatile(defender.volatile, effect.volatile, random);
      }
      inflictedVolatile = effect.volatile;
    }
  }

  return {
    actor: actorKey,
    move,
    hit: true,
    critical: isCritical,
    damage,
    damagePercent,
    defenderRemainingHp: defender.currentHp,
    selfDamage,
    attackerRemainingHp: attacker.currentHp,
    inflictedStatus,
    inflictedVolatile,
    fainted: isFainted(defender),
    selfFainted: isFainted(attacker),
  };
}

export interface RunTurnOutcome {
  /** 이번 턴 결과가 반영된 새 BattleState. prevState는 변형하지 않는다 */
  nextState: BattleState;
  result: TurnResult;
}

/**
 * 한 턴을 진행시킨다. prevState는 변형하지 않고, 복사본에 적용한 새 상태를 nextState로 돌려준다.
 * 우선도 → 실효 스피드(마비 0.5배 포함) → 동속 랜덤 순으로 순서를 정하고,
 * 먼저 움직인 쪽이 상대를 쓰러뜨리면 나중 쪽은 행동하지 않는다.
 * 마지막에 양쪽 다 살아있으면 상태이상 매턴 데미지를 적용한다.
 */
export function runTurn(
  prevState: BattleState,
  moveA: Move,
  moveB: Move,
  random: () => number = Math.random,
): RunTurnOutcome {
  const state: BattleState = {
    a: cloneFighter(prevState.a),
    b: cloneFighter(prevState.b),
    weather: prevState.weather,
    turnNumber: prevState.turnNumber + 1,
  };

  const speedA = state.a.realStats.spe * computeStatusSpeedMultiplier(state.a.status.condition);
  const speedB = state.b.realStats.spe * computeStatusSpeedMultiplier(state.b.status.condition);

  const firstIsA =
    compareTurnOrder(
      { realSpeed: speedA, move: moveA, stages: state.a.stages },
      { realSpeed: speedB, move: moveB, stages: state.b.stages },
      random,
    ) === 0;

  const order: [FighterKey, FighterKey] = firstIsA ? ["a", "b"] : ["b", "a"];
  const moves: Record<FighterKey, Move> = { a: moveA, b: moveB };

  const actions: ActionLogEntry[] = [];
  let winner: FighterKey | "draw" | undefined;

  for (const key of order) {
    if (isFainted(state[key])) continue; // 이미 쓰러진 쪽은 행동 못 함
    if (isFainted(state[opponentKey(key)])) break; // 상대가 이미 쓰러졌으면 더 진행할 필요 없음
    const action = resolveAction(state, key, moves[key], random);
    actions.push(action);

    // 발버둥 반동이나 자폭류로 "상대를 쓰러뜨리면서 자신도 같이 쓰러지는" 행동 하나 안에서는
    // resolveAction이 항상 상대 데미지를 먼저 적용한 뒤에 반동/자멸을 적용하도록 순서를 지킨다
    // (위 코드 참고) — 즉 상대가 이 행동으로 먼저 쓰러진 뒤에 자신이 쓰러진 것이므로, 실제
    // 게임처럼 이 행동을 한 쪽이 승자가 된다. 무승부가 아니다.
    if (action.fainted && action.selfFainted) {
      winner = key;
      break;
    }
  }

  const endOfTurn: EndOfTurnLogEntry[] = [];

  // winner가 이미 액션 중 자폭 콤보로 정해졌으면, 배틀이 그 시점에 끝난 것이니
  // 턴 종료 상태이상 데미지는 더 진행하지 않는다(실제 게임에서도 배틀이 이미 끝났다).
  if (!winner && !isFainted(state.a) && !isFainted(state.b)) {
    for (const key of (["a", "b"] as const)) {
      const fighter = state[key];
      if (!fighter.status.condition) continue;
      const damage = computeStatusEndOfTurnDamage(fighter.status, fighter.maxHp);
      fighter.currentHp = Math.max(0, fighter.currentHp - damage);
      fighter.status = advanceStatusTurn(fighter.status);
      endOfTurn.push({ actor: key, damage, remainingHp: fighter.currentHp, fainted: isFainted(fighter) });
    }
  }

  // 턴 종료 상태이상 데미지로 양쪽이 동시에 0이 되는 경우만 진짜 무승부로 남는다 — 이건 어느 한
  // 쪽이 상대를 쓰러뜨린 게 아니라 각자 자기 상태이상으로 따로 쓰러진 것이라 인과관계가 없다.
  if (!winner) {
    if (isFainted(state.a) && isFainted(state.b)) winner = "draw";
    else if (isFainted(state.a)) winner = "b";
    else if (isFainted(state.b)) winner = "a";
  }

  return { nextState: state, result: { turnNumber: state.turnNumber, order, actions, endOfTurn, winner } };
}
