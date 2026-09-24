import { type Move } from "@/types/move";
import { type ActionLogEntry, type FighterKey, type SwitchLogEntry, type TurnAction, type TurnResult } from "@/types/battle";
import { getAbility, getItem, getPokemon } from "@/lib/data";
import { eunNeun } from "@/lib/josa";
import { hasVolatile } from "@/lib/volatileConditions";
import { getQuickClawTriggered } from "@/lib/itemEffects";
import { compareTurnOrder } from "@/lib/turnOrder";
import { buildTurnOrderActor, effectiveHeldItem } from "./turnOrderInputs";
import { STRUGGLE_MOVE, activeWeather, applyForecastForm, applyMimicryForm, cloneSide, consumeItem, hasLivingReserve, isFainted, isForcedSwitchBlocked, opponentKey, sideOf, type BattleState } from "./state";
import { applyMegaEvolution, isTrappedFromSwitching, performSwitch } from "./switching";
import { resolveAction } from "./resolveAction";
import { finishTurn } from "./finishTurn";

export interface RunTurnOutcome {
  /** 이번 턴 결과가 반영된 새 BattleState. prevState는 변형하지 않는다 */
  nextState: BattleState;
  result: TurnResult;
  /**
   * 턴 종료 시 활성 슬롯이 기절해 있어 다음 runTurn 전에 교체가 필요한 편(Phase 8 §3).
   * 호출부는 applySwitch로 교체를 확정한 뒤 다음 턴을 진행해야 한다. 남은 슬롯이 없으면 그
   * 편은 이미 패배(result.winner)라 여기 안 실린다. 파티 길이 1이면 항상 undefined.
   */
  forcedSwitch?: { a?: boolean; b?: boolean };
}

/**
 * runTurn / resumeTurn이 유턴류 자체 교체(§7-2) 앞에서 멈췄을 때 돌려주는 결과. 호출부는
 * partialResult(사용측 기술 데미지까지)를 로그·보드에 반영하고, 교체 슬롯을 고르게 한 뒤
 * resumeTurn(_ctx, toIndex)로 이어간다 — 그래야 상대 행동·턴 종료가 새로 나온 포켓몬 기준으로
 * 처리된다. _ctx는 불투명 컨텍스트(직렬화하지 말 것 — random·Move 객체를 물고 있다).
 */
export interface RunTurnPaused {
  awaitingSelfSwitch: {
    side: FighterKey;
    passBaton: boolean;
    emergencyExit?: boolean;
    /** 탈출버튼처럼 도구가 강제 교체를 일으켰으면 그 도구 이름(UI 패널 문구용) */
    ejectItemName?: string;
  };
  nextState: BattleState;
  partialResult: TurnResult;
  _ctx: RunTurnContext;
}

/** runActionPhase ↔ resumeTurn ↔ finishTurn이 나눠 쓰는 턴 처리 상태. runTurn 밖에서 만들지 말 것. */
export interface RunTurnContext {
  state: BattleState;
  order: [FighterKey, FighterKey];
  moves: Record<FighterKey, Move>;
  random: () => number;
  speedA: number;
  speedB: number;
  didSwitch: Record<FighterKey, boolean>;
  turnStartAnnouncements: string[];
  actions: ActionLogEntry[];
  switches: SwitchLogEntry[];
  /** 다음에 처리할 order 인덱스(pause 후 resume 시작점) */
  actionIdx: number;
  selfDestructComboKey: FighterKey | undefined;
  /** passSubstitute: 꼬리자르기 — 세운 대타만 새로 나온 포켓몬에게 인계(랭크 등은 인계 안 함) */
  pendingPivot:
    | { side: FighterKey; passBaton: boolean; passSubstitute?: boolean; returnsToTrainer?: boolean }
    | undefined;
}

/**
 * 한 턴을 진행시킨다. prevState는 변형하지 않고, 복사본에 적용한 새 상태를 nextState로 돌려준다.
 * 각 편의 액션은 기술(move) 또는 교체(switch) — 교체는 항상 그 턴 기술보다 먼저 처리한다.
 * 우선도 → 실효 스피드(마비 0.5배 포함) → 동속 랜덤 순으로 순서를 정하고,
 * 먼저 움직인 쪽이 상대를 쓰러뜨리면 나중 쪽은 행동하지 않는다.
 * 마지막에 양쪽 다 살아있으면 상태이상 매턴 데미지를 적용한다.
 */
export function runTurn(
  prevState: BattleState,
  actionA: TurnAction,
  actionB: TurnAction,
  random: () => number = Math.random,
): RunTurnOutcome | RunTurnPaused {
  const sideA = cloneSide(prevState.sideA);
  const sideB = cloneSide(prevState.sideB);
  const state: BattleState = {
    // a/b는 각 편의 활성 파이터를 가리키는 포인터 — cloneSide가 만든 새 배열의 요소를 물린다.
    a: sideA.party[sideA.activeIndex],
    b: sideB.party[sideB.activeIndex],
    sideA,
    sideB,
    weather: prevState.weather,
    weatherTurnsRemaining: prevState.weatherTurnsRemaining,
    field: prevState.field,
    fieldTurnsRemaining: prevState.fieldTurnsRemaining,
    trickRoomTurnsRemaining: prevState.trickRoomTurnsRemaining,
    turnNumber: prevState.turnNumber + 1,
    entryAnnouncements: prevState.entryAnnouncements,
  };

  // 가속 억제 플래그(§8)는 "이번 턴에 자발적 교체로 나왔나"라 매 턴 시작 시 전 슬롯에서 지운다.
  // 아래 교체 선처리에서 자발적 교체한 슬롯에만 다시 세워지고, 그 턴 EOT 가속 판정이 이걸 읽는다.
  for (const s of [state.sideA, state.sideB]) for (const f of s.party) f.switchedInThisTurn = undefined;

  // ── 교체 액션 선처리(Phase 8 §3): 항상 그 턴 기술보다 먼저 ──
  // 양쪽 다 교체면 스피드 빠른 쪽부터(순수 교체라 결과엔 영향 없지만 로그 순서 일관성).
  const switches: SwitchLogEntry[] = [];
  const didSwitch: Record<FighterKey, boolean> = { a: false, b: false };
  const switchOrder: FighterKey[] =
    prevState.a.realStats.spe >= prevState.b.realStats.spe ? ["a", "b"] : ["b", "a"];
  for (const key of switchOrder) {
    const action = key === "a" ? actionA : actionB;
    if (action.kind !== "switch") continue;
    const side = sideOf(state, key);
    const fromIndex = side.activeIndex;
    const outgoing = side.party[fromIndex];
    // 문어굳히기/물고버티기에 걸린 채로 자발적 교체가 넘어오면(UI가 막지만 방어적으로) 무시한다.
    if (isTrappedFromSwitching(outgoing)) continue;
    const entryMessages: string[] = [];
    performSwitch(state, key, action.toIndex, entryMessages);
    if (side.activeIndex !== fromIndex) {
      didSwitch[key] = true;
      const inFighter = side.party[action.toIndex];
      switches.push({
        side: key,
        fromIndex,
        toIndex: action.toIndex,
        outPokemonId: outgoing.slot.pokemonId,
        inPokemonId: inFighter.illusionAs ?? inFighter.slot.pokemonId, // 일루전 위장 반영(§6-1)
        entryMessages,
      });
    }
  }

  // 교체한 쪽은 이번 턴 행동하지 않는다. 아래 로직은 전부 Move 객체를 전제하므로, 교체 액션은
  // 절대 실행되지 않는 무해한 센티넬로 대체한다(순서 계산의 우선도만 0으로 참여).
  const SWITCH_PASS_MOVE: Move = { ...STRUGGLE_MOVE, id: "__switch_pass__", name: "교체", category: "status", power: null };
  const moveA: Move = actionA.kind === "move" ? actionA.move : SWITCH_PASS_MOVE;
  const moveB: Move = actionB.kind === "move" ? actionB.move : SWITCH_PASS_MOVE;

  // 방어류(방어/판별/버티기/킹실드)는 "이번 턴 한정" 효과라 매 턴 시작 시 항상 지운다 —
  // 지난 턴에 세운 게 이번 턴까지 남아있으면 안 된다. 연속 성공 스트릭(protectStreak)은
  // 반대로 배틀 끝까지 유지되는 값이라 여기서 건드리지 않는다.
  state.a.activeProtect = undefined;
  state.b.activeProtect = undefined;
  // 풀죽음(flinch)도 "이번 턴 한정" 효과라 매 턴 시작 시 항상 지운다. 원래는 걸린 포켓몬이
  // 자기 행동을 개시할 때(resolveAction) consumeVolatileTurn으로 소모되는데, 그 턴에 교체로
  // 나왔거나(§8 — didSwitch면 resolveAction 자체를 안 탐) 이미 행동을 마친 뒤 뒤늦게 걸리면
  // (풀죽음을 건 쪽이 상대보다 느려서) 소모 경로를 안 타 다음 턴까지 남는 버그가 있었다
  // (§4-4, 2026-09-10 발견). 여기서 무조건 지우면 정상 소모된 경우는 이미 없는 값 재확인이라
  // 안전하고, 위 누락 케이스만 실제로 고쳐진다. recharge는 원래 다음 턴까지 지속돼야 하는
  // 효과라 여기서 건드리지 않는다.
  for (const f of [state.a, state.b]) {
    if (hasVolatile(f.volatile, "flinch")) {
      const active = { ...f.volatile.active };
      delete active.flinch;
      f.volatile = { active };
    }
  }
  // 송전: "이번 턴 한정" 타입 강제도 매 턴 시작 시 지운다(지난 턴 송전이 이번 턴까지 남으면 안 됨).
  state.a.moveTypeOverrideThisTurn = undefined;
  state.b.moveTypeOverrideThisTurn = undefined;
  // 미러코트/카운터/앙갚음/메탈버스트용 — 이번 턴 받은 카테고리별 데미지 누적기를 0으로 초기화한다(F-1).
  state.a.damageTakenThisTurn = { physical: 0, special: 0 };
  state.b.damageTakenThisTurn = { physical: 0, special: 0 };
  // 질투의불꽃용 — 이번 턴이 시작된 시점의 랭크를 스냅샷해 둔다(턴 중 랭크가 올랐는지 판정).
  state.a.statStagesAtTurnStart = { ...state.a.stages };
  state.b.statStagesAtTurnStart = { ...state.b.stages };

  // 기분파(캐스퐁): 턴 시작 시점의 유효 날씨(날씨부정 반영)에 맞춰 타입을 다시 맞춘다.
  applyForecastForm(state.a, activeWeather(state));
  applyForecastForm(state.b, activeWeather(state));

  // 의태(메더): 턴 시작 시점의 필드에 맞춰 타입을 다시 맞춘다. 필드 타입으로 바뀌면 안내한다.
  const turnStartAnnouncements: string[] = [];
  for (const key of ["a", "b"] as const) {
    const changedTo = applyMimicryForm(state[key], state.field);
    if (changedTo) {
      const nm = getPokemon(state[key].slot.pokemonId)?.name ?? "포켓몬";
      turnStartAnnouncements.push(`${nm}${eunNeun(nm)} ${changedTo} 타입이 되었다!`);
    }
  }

  // 메가진화 선언(§4): 턴 순서를 계산하기 전에 처리한다 — 메가폼의 스피드가 이번 턴 행동
  // 순서에 반영된다(본가 규칙). 교체한 쪽은 이번 턴 행동을 안 하므로 메가진화도 없다.
  // 로그 순서만을 위해 프리스테이트 기본 스피드가 빠른 쪽부터 시도한다.
  for (const key of prevState.a.realStats.spe >= prevState.b.realStats.spe ? (["a", "b"] as const) : (["b", "a"] as const)) {
    const action = key === "a" ? actionA : actionB;
    if (action.kind === "move" && action.mega && !didSwitch[key]) {
      applyMegaEvolution(state, key, turnStartAnnouncements);
    }
  }

  // 부리캐논(정신 집중류): 이 기술을 고른 턴 시작 시 "…은(는) 부리를 가열시켰다!"를 알린다.
  for (const [key, mv] of [["a", moveA], ["b", moveB]] as const) {
    if (mv.turnStartUserAnnouncement && !isFainted(state[key]) && !didSwitch[key]) {
      const nm = getPokemon(state[key].slot.pokemonId)?.name ?? "포켓몬";
      turnStartAnnouncements.push(`${nm}${eunNeun(nm)} ${mv.turnStartUserAnnouncement}`);
    }
  }

  // 스피드(마비·구애스카프/검은철구·엽록소류·곡예)와 우선도(그래스슬라이더류·짓궂은마음·질풍날개)는
  // 배틀 AI의 speed_order 예측과 공유하는 turnOrderInputs에서 조립한다(턴 시작 시점 기준).
  const actorA = buildTurnOrderActor(state, state.a, moveA);
  const actorB = buildTurnOrderActor(state, state.b, moveB);
  const speedA = actorA.realSpeed;
  const speedB = actorB.realSpeed;

  // 트릭룸 판정은 이번 턴이 시작된 시점(=아직 이번 턴 행동을 하나도 반영하지 않은 상태)의 값을
  // 쓴다 — 이번 턴에 트릭룸을 새로 걸어도 그 즉시 같은 턴의 순서 계산에는 영향을 주지 않는다
  // (본가 규칙: 순서는 행동 전에 이미 정해짐).
  const trickRoomActive = state.trickRoomTurnsRemaining !== undefined;

  // 선제공격손톱: 실제 우선도가 같을 때만 끼어든다(더 높은 우선도는 이 효과와 무관하게 항상 이김).
  // 양쪽 다 발동하면(둘 다 이 도구를 지녔고 둘 다 확률에 성공) 서로 상쇄되어 정상적인 스피드
  // 비교로 넘어간다 — 어느 한쪽만 발동했을 때만 그쪽이 확정으로 먼저 움직인다.
  const priorityTied = actorA.move.priority === actorB.move.priority;
  const aQuickClaw = priorityTied && getQuickClawTriggered(effectiveHeldItem(state.a), random);
  const bQuickClaw = priorityTied && getQuickClawTriggered(effectiveHeldItem(state.b), random);
  const quickClawWinner: FighterKey | undefined =
    aQuickClaw && !bQuickClaw ? "a" : bQuickClaw && !aQuickClaw ? "b" : undefined;

  const firstIsA = quickClawWinner
    ? quickClawWinner === "a"
    : compareTurnOrder(actorA, actorB, random, trickRoomActive) === 0;

  const order: [FighterKey, FighterKey] = firstIsA ? ["a", "b"] : ["b", "a"];
  const moves: Record<FighterKey, Move> = { a: moveA, b: moveB };

  // 이번 턴 처리 컨텍스트. 유턴류 자체 교체(§7-2)로 턴 중간에 멈췄다가 resumeTurn으로 이어갈 때
  // 그대로 넘겨받는다. 직렬화하지 않고 JS 메모리에만 들고 다닌다(random·Move 객체 포함).
  const ctx: RunTurnContext = {
    state,
    order,
    moves,
    random,
    speedA,
    speedB,
    didSwitch,
    turnStartAnnouncements,
    actions: [],
    switches,
    actionIdx: 0,
    selfDestructComboKey: undefined,
    pendingPivot: undefined,
  };
  return runActionPhase(ctx);
}

/**
 * 한 편이 이번 턴에 하는 행동을 스피드 순서대로 처리하는 루프. 유턴·볼트체인지·배턴터치가
 * 명중해서 효과를 줬고 사용측에 교대 슬롯이 있으면, 그 자리에서 멈추고 RunTurnPaused를 돌려준다
 * (호출부가 교체 슬롯을 고른 뒤 resumeTurn으로 이어간다 — 그래야 상대 행동·턴 종료 처리가 새로
 * 나온 포켓몬 기준으로 이뤄진다). 그 외에는 루프를 끝까지 돌리고 finishTurn을 호출한다.
 */
function runActionPhase(ctx: RunTurnContext): RunTurnOutcome | RunTurnPaused {
  const { state, order, moves, random, switches, actions } = ctx;
  for (let i = ctx.actionIdx; i < order.length; i++) {
    const key = order[i];
    ctx.actionIdx = i + 1;
    if (ctx.didSwitch[key]) continue; // 이번 턴 교체한 쪽은 행동하지 않는다(교체가 곧 그 턴 행동)
    if (isFainted(state[key])) continue; // 이미 쓰러진 쪽은 행동 못 함
    if (isFainted(state[opponentKey(key)])) break; // 상대가 이미 쓰러졌으면 더 진행할 필요 없음
    // 포커스렌즈 판정용 — 이번 턴 order 기준으로 상대보다 늦게 움직이는 쪽인지
    const movesSecond = order[1] === key;
    const action = resolveAction(state, key, moves[key], random, movesSecond, moves[opponentKey(key)]);
    actions.push(action);

    // 유턴·볼트체인지·배턴터치(§7-2): 명중해서 효과를 줬고(빗나감·행동불능·완전 무효·방어류
    // 차단·특성 흡수 제외) 사용측이 살아 있고 교대 슬롯이 있으면 — 여기서 멈춘다. 상대 행동·턴
    // 종료 처리는 교체가 확정된 뒤에(resumeTurn) 새 포켓몬 기준으로 이어진다.
    const mv = action.move;
    if (
      (mv.selfSwitchAfterDamage || mv.passesStatsOnSelfSwitch) &&
      !action.blockedReason &&
      action.hit &&
      action.typeEffectiveness !== 0 &&
      !action.blockedByProtectMoveName &&
      !action.hitNegatedByAbilityName &&
      !action.abilityAbsorbAbilityName &&
      !isFainted(state[key]) &&
      hasLivingReserve(sideOf(state, key))
    ) {
      ctx.pendingPivot = { side: key, passBaton: !!mv.passesStatsOnSelfSwitch };
      return {
        awaitingSelfSwitch: { side: key, passBaton: !!mv.passesStatsOnSelfSwitch },
        nextState: state,
        partialResult: {
          turnNumber: state.turnNumber,
          order,
          actions: [...actions],
          endOfTurn: [],
          winner: undefined,
          expiredScreens: [],
          expiredSafeguard: [],
          turnStartAnnouncements: ctx.turnStartAnnouncements,
          switches: [...switches],
          activePokemonIds: { a: state.a.slot.pokemonId, b: state.b.slot.pokemonId },
        },
        _ctx: ctx,
      };
    }

    // 썰렁개그(Move.selfSwitchAfterUse): 기술을 쓰기만 했으면(행동불능 등으로 못 쓴 경우 제외) 날씨 설정
    // 성공 여부와 무관하게 교체한다 — 이미 눈이라 실패해도 교체(사용자 확인). 유턴류와 달리 효과 실패가
    // 교체를 막지 않는다.
    if (mv.selfSwitchAfterUse && !action.blockedReason && !isFainted(state[key]) && hasLivingReserve(sideOf(state, key))) {
      ctx.pendingPivot = { side: key, passBaton: false, returnsToTrainer: true };
      return {
        awaitingSelfSwitch: { side: key, passBaton: false },
        nextState: state,
        partialResult: {
          turnNumber: state.turnNumber,
          order,
          actions: [...actions],
          endOfTurn: [],
          winner: undefined,
          expiredScreens: [],
          expiredSafeguard: [],
          turnStartAnnouncements: ctx.turnStartAnnouncements,
          switches: [...switches],
          activePokemonIds: { a: state.a.slot.pokemonId, b: state.b.slot.pokemonId },
        },
        _ctx: ctx,
      };
    }

    // 꼬리자르기(§4-1): 대타 세팅이 성공했으면(HP·대타·예비 조건 통과) 유턴류처럼 여기서 멈추고
    // 교체 슬롯을 받는다. 세운 대타는 새로 나온 포켓몬이 이어받는다(passSubstitute). 실패했으면
    // action.shedTailSucceeded가 false라 이 블록은 건너뛴다.
    if (
      action.shedTailSucceeded &&
      !isFainted(state[key]) &&
      hasLivingReserve(sideOf(state, key))
    ) {
      ctx.pendingPivot = { side: key, passBaton: false, passSubstitute: true };
      return {
        awaitingSelfSwitch: { side: key, passBaton: false },
        nextState: state,
        partialResult: {
          turnNumber: state.turnNumber,
          order,
          actions: [...actions],
          endOfTurn: [],
          winner: undefined,
          expiredScreens: [],
          expiredSafeguard: [],
          turnStartAnnouncements: ctx.turnStartAnnouncements,
          switches: [...switches],
          activePokemonIds: { a: state.a.slot.pokemonId, b: state.b.slot.pokemonId },
        },
        _ctx: ctx,
      };
    }

    const oppKey = opponentKey(key);

    // 레드카드(Item.forcesAttackerSwitchOnHit): 데미지를 받은 방어측(홀더)이 이 도구를 지녔으면
    // 공격자(key)를 무작위 예비 포켓몬으로 강제 교체시키고 카드를 소모한다. 드래곤테일과 같은
    // 방향(무작위·pause 없음)이지만 대상이 반대다 — 여기선 "공격자"가 밀려난다. 홀더가 이 피격으로
    // 기절했으면(카드를 쓸 수 없어) 발동하지 않는다. 도구는 "데미지를 받는 순간" 발동하는
    // 효과라 드래곤테일 등 기술 자체의 강제 교체(아래 블록)보다 먼저 판정한다.
    {
      const holder = state[oppKey];
      const holderAbility = holder.effectiveAbilityId ? getAbility(holder.effectiveAbilityId) : undefined;
      const holderItem = holderAbility?.disablesOwnItemEffects
        ? undefined
        : holder.currentItemId
          ? getItem(holder.currentItemId)
          : undefined;
      if (
        holderItem?.forcesAttackerSwitchOnHit &&
        action.hit &&
        action.damage > 0 &&
        !action.blockedByProtectMoveName &&
        !action.blockedBySubstituteMoveName &&
        !action.hitNegatedByAbilityName &&
        !action.abilityAbsorbAbilityName &&
        !isFainted(holder) &&
        !isFainted(state[key]) &&
        !ctx.didSwitch[key] &&
        hasLivingReserve(sideOf(state, key)) &&
        !isForcedSwitchBlocked(state[key])
      ) {
        const attackerSide = sideOf(state, key);
        const fromIndex = attackerSide.activeIndex;
        const reserveIdxs = attackerSide.party
          .map((_f, idx) => idx)
          .filter((idx) => idx !== fromIndex && !isFainted(attackerSide.party[idx]));
        const toIndex = reserveIdxs[Math.floor(random() * reserveIdxs.length)];
        const outgoing = attackerSide.party[fromIndex];
        const entryMessages: string[] = [];
        performSwitch(state, key, toIndex, entryMessages, false, false);
        const inFighter = attackerSide.party[toIndex];
        switches.push({
          side: key,
          fromIndex,
          toIndex,
          outPokemonId: outgoing.illusionAs ?? outgoing.slot.pokemonId,
          inPokemonId: inFighter.illusionAs ?? inFighter.slot.pokemonId,
          entryMessages,
          afterMove: true,
          forced: true,
          redCardItemName: holderItem.name,
        });
        ctx.didSwitch[key] = true;
        consumeItem(holder);
      }
    }

    // 드래곤테일·배대뒤치기·울부짖기·날려버리기: 명중해서(빗나감·행동불능·방어·대타·방음·매직미러·
    // 특성 무효 제외) 상대에게 살아있는 예비가 있고 흡반·뿌리박기로 저항하지 않으면 — 상대를 무작위
    // 예비 포켓몬으로 강제 교체한다. 데미지 기술은 데미지를 이미 준 뒤이고 타입 면역(0배)이면 발동
    // 안 한다. 유저 선택이 없는 엔진 내부 처리라 pendingPivot 같은 일시정지 없이 여기서 즉시 끝낸다.
    // 레드카드로 이미 이번 피격에 교체가 확정됐으면(didSwitch[oppKey]는 없지만 방향이 반대라
    // 무관 — 레드카드는 key를, 이 블록은 oppKey를 움직인다) 그대로 진행해도 안전하다.
    if (
      mv.forcesTargetSwitch &&
      !action.blockedReason &&
      action.hit &&
      action.typeEffectiveness !== 0 &&
      !action.fainted &&
      !action.blockedByProtectMoveName &&
      !action.blockedBySubstituteMoveName &&
      !action.hitNegatedByAbilityName &&
      !action.abilityAbsorbAbilityName &&
      !action.soundproofBlockedByAbilityName &&
      !action.bouncedMoveName &&
      !isFainted(state[oppKey]) &&
      hasLivingReserve(sideOf(state, oppKey)) &&
      !isForcedSwitchBlocked(state[oppKey])
    ) {
      const oppSide = sideOf(state, oppKey);
      const fromIndex = oppSide.activeIndex;
      const reserveIdxs = oppSide.party
        .map((_f, idx) => idx)
        .filter((idx) => idx !== fromIndex && !isFainted(oppSide.party[idx]));
      const toIndex = reserveIdxs[Math.floor(random() * reserveIdxs.length)];
      const outgoing = oppSide.party[fromIndex];
      const entryMessages: string[] = [];
      // voluntary=false — 기절 후 강제 교체와 같은 취급(가속 발동, 등장 파이프라인은 그대로 탐).
      performSwitch(state, oppKey, toIndex, entryMessages, false, false);
      const inFighter = oppSide.party[toIndex];
      switches.push({
        side: oppKey,
        fromIndex,
        toIndex,
        outPokemonId: outgoing.illusionAs ?? outgoing.slot.pokemonId,
        inPokemonId: inFighter.illusionAs ?? inFighter.slot.pokemonId,
        entryMessages,
        afterMove: true,
        forced: true,
      });
      // 아직 안 움직였다면 이번 턴 행동을 못 하게 막는다(끌려나온 포켓몬). 우선도 -6이라 대개
      // 상대는 이미 움직인 뒤라 이 플래그는 무해하게 무시된다.
      ctx.didSwitch[oppKey] = true;
    }

    // 위기회피(Emergency Exit): 이번 공격으로 방어측 HP가 절반 이하로 떨어졌고 방어측에 살아있는
    // 예비가 있으며 도망봉인·뿌리박기가 아니면 — 유턴류와 같은 pause 흐름으로 방어측을 물러나게
    // 한다(유저가 나올 포켓몬을 고른다). 드래곤테일 등으로 이미 이번 턴 교체됐으면(didSwitch) 스킵.
    if (
      action.triggersDefenderEmergencyExit &&
      !isFainted(state[oppKey]) &&
      !ctx.didSwitch[oppKey] &&
      hasLivingReserve(sideOf(state, oppKey)) &&
      !isForcedSwitchBlocked(state[oppKey]) &&
      !isTrappedFromSwitching(state[oppKey])
    ) {
      ctx.didSwitch[oppKey] = true;
      ctx.pendingPivot = { side: oppKey, passBaton: false };
      return {
        awaitingSelfSwitch: { side: oppKey, passBaton: false, emergencyExit: true },
        nextState: state,
        partialResult: {
          turnNumber: state.turnNumber,
          order,
          actions: [...actions],
          endOfTurn: [],
          winner: undefined,
          expiredScreens: [],
          expiredSafeguard: [],
          turnStartAnnouncements: ctx.turnStartAnnouncements,
          switches: [...switches],
          activePokemonIds: { a: state.a.slot.pokemonId, b: state.b.slot.pokemonId },
        },
        _ctx: ctx,
      };
    }

    // 탈출버튼(Item.exitsFieldOnHit): 데미지를 받은 방어측(홀더)이 이 도구를 지녔으면 HP 문턱
    // 없이(위기회피와 달리) 곧바로 물러난다 — 유턴류·위기회피와 같은 pause 흐름. 이미 다른
    // 강제 교체가 확정됐으면(드래곤테일·위기회피) didSwitch로 걸러진다.
    {
      const holder = state[oppKey];
      const holderAbility = holder.effectiveAbilityId ? getAbility(holder.effectiveAbilityId) : undefined;
      const holderItem = holderAbility?.disablesOwnItemEffects
        ? undefined
        : holder.currentItemId
          ? getItem(holder.currentItemId)
          : undefined;
      if (
        holderItem?.exitsFieldOnHit &&
        action.hit &&
        action.damage > 0 &&
        !action.blockedByProtectMoveName &&
        !action.blockedBySubstituteMoveName &&
        !action.hitNegatedByAbilityName &&
        !action.abilityAbsorbAbilityName &&
        !isFainted(holder) &&
        !ctx.didSwitch[oppKey] &&
        hasLivingReserve(sideOf(state, oppKey)) &&
        !isForcedSwitchBlocked(holder) &&
        !isTrappedFromSwitching(holder)
      ) {
        ctx.didSwitch[oppKey] = true;
        ctx.pendingPivot = { side: oppKey, passBaton: false };
        consumeItem(holder);
        return {
          awaitingSelfSwitch: { side: oppKey, passBaton: false, ejectItemName: holderItem.name },
          nextState: state,
          partialResult: {
            turnNumber: state.turnNumber,
            order,
            actions: [...actions],
            endOfTurn: [],
            winner: undefined,
            expiredScreens: [],
            expiredSafeguard: [],
            turnStartAnnouncements: ctx.turnStartAnnouncements,
            switches: [...switches],
            activePokemonIds: { a: state.a.slot.pokemonId, b: state.b.slot.pokemonId },
          },
          _ctx: ctx,
        };
      }
    }

    // 발버둥 반동이나 자폭류로 "상대를 쓰러뜨리면서 자신도 같이 쓰러지는" 행동 하나 안에서는
    // resolveAction이 항상 상대 데미지를 먼저 적용한 뒤에 반동/자멸을 적용하도록 순서를 지킨다
    // (위 코드 참고) — 즉 상대가 이 행동으로 먼저 쓰러진 뒤에 자신이 쓰러진 것이라 인과가 있다.
    // 예비 슬롯이 남았으면 배틀을 끝내지 않고 강제 교체로 넘겨야 하므로(§7-1), 여기선 행동
    // 루프만 끊고 승패 판정은 hasLivingReserve를 계산한 뒤 아래에서 처리한다.
    if (action.fainted && action.selfFainted) {
      ctx.selfDestructComboKey = key;
      break;
    }
  }
  return finishTurn(ctx);
}

/**
 * 유턴류 자체 교체 선택이 끝난 뒤 이어서 호출한다(§7-2). 사용측을 toIndex 슬롯으로 교체하고
 * (등장 파이프라인 포함), 아직 안 움직인 상대가 있으면 그 상대는 새로 나온 포켓몬을 상대하게
 * runActionPhase를 이어 돌린다. toIndex가 유효한 슬롯이 아니면 교체 없이 이어간다.
 */
export function resumeTurn(ctx: RunTurnContext, toIndex: number): RunTurnOutcome | RunTurnPaused {
  const pivot = ctx.pendingPivot;
  ctx.pendingPivot = undefined;
  if (pivot) {
    const side = sideOf(ctx.state, pivot.side);
    if (
      toIndex >= 0 &&
      toIndex < side.party.length &&
      toIndex !== side.activeIndex &&
      !isFainted(side.party[toIndex])
    ) {
      const fromIndex = side.activeIndex;
      const outgoing = side.party[fromIndex];
      const entryMessages: string[] = [];
      performSwitch(ctx.state, pivot.side, toIndex, entryMessages, true, pivot.passBaton, pivot.passSubstitute);
      const inFighter = side.party[toIndex];
      ctx.switches.push({
        side: pivot.side,
        fromIndex,
        toIndex,
        outPokemonId: outgoing.slot.pokemonId,
        inPokemonId: inFighter.illusionAs ?? inFighter.slot.pokemonId, // §6-1
        entryMessages,
        afterMove: true,
        shedTail: pivot.passSubstitute || undefined,
        returnsToTrainer: pivot.returnsToTrainer || undefined,
      });
    }
  }
  return runActionPhase(ctx);
}

/**
 * finishTurn의 편(key) 1개 턴 종료 처리 1항목이 공유하는 컨텍스트(ver.1.5 §6).
 * fighterAbility/fighterItem/fighterBerriesBlocked는 매 편(key) 반복마다 한 번만 계산해서
 * 아래 apply* 함수들에 그대로 넘긴다 — 원래 finishTurn 안에서도 반복당 한 번씩만 계산되던 값이라
 * 함수로 쪼개도 계산 횟수·순서는 그대로다.
 */
