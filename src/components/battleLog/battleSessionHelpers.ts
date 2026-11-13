import { getMove, getPokemon } from "../../lib/data";
import { applySwitch, hazardField } from "../../lib/battle/switching";
import { createBattleState, STRUGGLE_MOVE, type BattleState } from "../../lib/battle/state";
import { forcedLockedAction } from "../../lib/battle/lockedAction";
import type { FighterKey, TurnAction, TurnResult } from "../../types/battle";
import type { PartySlot } from "../../types/party";
import { SLOT_INDICES, type MegaDeclaredState, type SelectedState, type Side, type SlotIndex } from "./shared";

/**
 * useBattleLogSession에서 뺀 순수 함수(7.0 R-2) — 훅 상태를 값으로 받아 계산만 한다.
 * 훅 호출 순서·상태·반환값은 그대로고, 같은 코드가 두 곳에 있던 것(전투 상태 조립)은 하나로 합쳤다.
 */

/** 편·빌드 슬롯 번호로 슬롯을 돌려주는 함수 — 훅이 setup 컨트롤러에서 만들어 넘긴다 */
export type SlotAt = (side: Side, i: SlotIndex) => PartySlot | null;

/** 슬롯이 가진 기술(null 칸 제외)을 데이터 기술 객체로 */
const movesOf = (s: PartySlot) => s.moves.filter((id): id is string => id !== null).map((id) => getMove(id)!);

/** 양쪽 파티(이미 선출·압축된 슬롯 목록)로 배틀 상태를 만든다 — 대전 시작과 AI 선출 계산이 같이 쓴다 */
export function createStateFromParties(a: PartySlot[], b: PartySlot[]): BattleState {
  return createBattleState({
    a: { slots: a, movesList: a.map(movesOf) },
    b: { slots: b, movesList: b.map(movesOf) },
  });
}

/** 이 편에서 포켓몬이 있고 기술이 1개 이상인 빌드 슬롯 인덱스(빌드 순서). 이게 곧 "선출 가능" 후보. */
export const buildableIndicesOf = (slotAt: SlotAt, side: Side): SlotIndex[] =>
  SLOT_INDICES.filter((i) => {
    const s = slotAt(side, i);
    return s !== null && s.moves.some((m) => m !== null);
  });

/**
 * 포켓몬은 골랐는데 기술을 하나도 안 배정한 슬롯(§4-2). buildableIndices가 이런 슬롯을
 * "선출 가능" 후보에서 조용히 빼버려서, 배턴터치·유턴처럼 자체 교체를 하려는 기술이 예비가
 * 없는 것처럼 취급돼 아무 안내 없이 무산되는 문제로 이어졌다 — 대전 시작 시점에 미리 막아서
 * 애초에 그 상태로 대전에 들어가지 못하게 한다.
 */
export const movelessIndicesOf = (slotAt: SlotAt, side: Side): SlotIndex[] =>
  SLOT_INDICES.filter((i) => {
    const s = slotAt(side, i);
    return s !== null && s.moves.every((m) => m === null);
  });

/**
 * movelessIndices가 하나라도 있으면 그 편 소속 포켓몬 이름만 모아 그 편 전용 경고 문구를
 * 만든다(양쪽을 한 줄로 합치지 않음 — 각자 파티 상단에 표시하려면 편별로 갈라져 있어야 함).
 */
export function movelessWarningOf(slotAt: SlotAt, side: Side): string | null {
  const names = movelessIndicesOf(slotAt, side).map((i) => {
    const s = slotAt(side, i);
    return s ? (getPokemon(s.pokemonId)?.name ?? "포켓몬") : "포켓몬";
  });
  if (names.length === 0) return null;
  return `${names.join(", ")}에게 기술을 최소 1개 배정해야 대전을 시작할 수 있습니다.`;
}

/**
 * 이번 턴 양쪽의 행동. 한쪽이라도 정해지지 않으면 null. AI 편은 aiAction을 쓰고, 사람 편은 고른 값(교체·기술)을,
 * 발버둥·차지 2턴째·난동 턴은 선택과 무관하게 자동 행동을 쓴다. 메가진화는 기술 행동에만 실린다.
 */
export function buildTurnActions(p: {
  battleState: BattleState;
  selected: SelectedState;
  megaDeclared: MegaDeclaredState;
  struggling: Record<Side, boolean>;
  charging: Record<Side, boolean>;
  aiSide: Side | null;
  aiAction: TurnAction | null;
}): { a: TurnAction; b: TurnAction } | null {
  const { battleState, selected, megaDeclared, struggling, charging, aiSide, aiAction } = p;
  const actionFor = (side: Side): TurnAction | null => {
    if (side === aiSide && aiAction) return aiAction;
    const sel = selected[side];
    if (sel?.kind === "switch") return { kind: "switch", toIndex: sel.toIndex };
    const mega = megaDeclared[side] || undefined; // 메가진화는 기술 행동에만 실린다
    if (struggling[side]) return { kind: "move", move: STRUGGLE_MOVE, mega };
    if (charging[side]) {
      const forced = forcedLockedAction(battleState[side]);
      return forced?.kind === "move" ? { ...forced, mega } : null;
    }
    const m = sel?.kind === "move" ? getMove(sel.moveId) : undefined;
    if (!m) return null;
    return { kind: "move", move: m, ...(mega ? { mega } : {}) };
  };
  const a = actionFor("a");
  const b = actionFor("b");
  return a && b ? { a, b } : null;
}

/**
 * 강제 교체는 턴 밖 조작이라 별도 로그 카드로 남긴다(등장 파이프라인 문구까지 함께).
 * after.inFainted: 새로 나온 포켓몬이 스텔스록·압정 등장 데미지로(§6) 그 자리에서 또 쓰러졌는지, after.hasReserve: 남은 슬롯이 있는지.
 */
export function forcedSwitchLogEntry(
  nextState: BattleState,
  side: Side,
  toIndex: number,
  applied: Pick<ReturnType<typeof applySwitch>, "entryMessages" | "hazardTriggers" | "outPokemonId" | "inPokemonId">,
  { inFainted, hasReserve, outgoingAlive = false }: {
    inFainted: boolean;
    hasReserve: boolean;
    /** 물러나는 포켓몬이 살아 있다(미래예지 적중 위기회피, 8.3 A4-b) — 연출이 나가는 모션을 보인다. 카드 묶기 판별은 fromIndex -1을 그대로 쓴다 */
    outgoingAlive?: boolean;
  },
): TurnResult {
  return {
    turnNumber: nextState.turnNumber,
    order: ["a", "b"],
    activePokemonIds: { a: nextState.a.slot.pokemonId, b: nextState.b.slot.pokemonId },
    actions: [],
    endOfTurn: [],
    winner: inFainted && !hasReserve ? (side === "a" ? "b" : "a") : undefined,
    expiredScreens: [],
    expiredSafeguard: [],
    turnStartAnnouncements: [],
    switches: [
      {
        side: side as FighterKey,
        fromIndex: -1,
        toIndex,
        outPokemonId: applied.outPokemonId,
        inPokemonId: applied.inPokemonId,
        entryMessages: applied.entryMessages,
        ...hazardField(applied.hazardTriggers),
        ...(outgoingAlive ? { outgoingAlive: true as const } : {}),
      },
    ],
  };
}
