import { getPokemon } from "../../lib/data";
import { environmentTintBackground } from "../../lib/environmentBackground";
import { type BattleState, type FighterKey, type RunTurnContext } from "../../lib/battleSimulator";

export type Side = "a" | "b";

export type SlotIndex = 0 | 1 | 2 | 3 | 4 | 5;

export type PickerState =
  | { kind: "pokemon"; side: Side; slotIndex: SlotIndex }
  | { kind: "ability"; side: Side; slotIndex: SlotIndex }
  | { kind: "item"; side: Side; slotIndex: SlotIndex }
  | { kind: "nature"; side: Side; slotIndex: SlotIndex }
  | { kind: "points"; side: Side; slotIndex: SlotIndex }
  | { kind: "cosmeticForm"; side: Side; slotIndex: SlotIndex }
  | { kind: "move"; side: Side; slotIndex: SlotIndex; moveIndex: 0 | 1 | 2 | 3 }
  | { kind: "slotPresets"; side: Side; slotIndex: SlotIndex }
  | { kind: "loadParty"; side: Side }
  | { kind: "sampleParty"; side: Side }
  | null;

/** 이번 턴 한 편의 선택 — 기술 또는 교체(교대 슬롯 인덱스) */
type TurnChoice = { kind: "move"; moveId: string } | { kind: "switch"; toIndex: number };

/** 편별 이번 턴 선택 상태 */
export type SelectedState = { a: TurnChoice | null; b: TurnChoice | null };

/** 편별 턴 입력 모드 — "기술" 또는 "교체" */
export type InputModeState = { a: "move" | "switch"; b: "move" | "switch" };

/** 편별 이번 턴 메가진화 선언 여부(§4) */
export type MegaDeclaredState = { a: boolean; b: boolean };

/** 이번 턴 처리 결과 활성 슬롯이 기절해 강제 교체가 필요한 편. 해소되면 null */
export type PendingForcedSwitchState = { a?: boolean; b?: boolean } | null;

/**
 * 유턴·볼트체인지·배턴터치(§7-2): 사용측 기술 데미지까지 처리하고 턴이 "멈춘" 상태. 이 편이
 * 교대할 포켓몬을 골라야 나머지 턴(상대 행동·턴 종료)이 새 포켓몬 기준으로 이어진다.
 */
export type PendingPivotState = {
  ctx: RunTurnContext;
  side: Side;
  passBaton: boolean;
  /** 위기회피로 인한 강제 퇴장이면 true (유턴류와 안내 문구가 다르다) */
  emergencyExit?: boolean;
  /** 교체로 나온 포켓몬이 등장 설치물에 쓰러져 행동 전에 대체를 고르는 경우 */
  faintReplacement?: boolean;
  /** 탈출버튼처럼 도구로 인한 강제 퇴장이면 그 도구 이름 */
  ejectItemName?: string;
} | null;

export const SLOT_INDICES: SlotIndex[] = [0, 1, 2, 3, 4, 5];

/** 날씨/필드 배경 틴트 — 매치업 페이지와 공유하는 environmentTintBackground에 위임한다. */
export function battleBoardBackground(state: BattleState): string | undefined {
  return environmentTintBackground(state.weather, state.field);
}

export function fighterLabel(state: BattleState, key: FighterKey): string {
  const pokemon = getPokemon(state[key].slot.pokemonId);
  return pokemon?.name ?? key;
}
