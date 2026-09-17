import { Fragment, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { BattleSetupCard } from "./BattleSetupCard";
import { PokemonPickerModal } from "./PokemonPickerModal";
import { MovePickerModal } from "./MovePickerModal";
import { AbilityPickerModal } from "./AbilityPickerModal";
import { ItemPickerModal } from "./ItemPickerModal";
import { NaturePickerModal } from "./NaturePickerModal";
import { PointsEditorModal } from "./PointsEditorModal";
import { SlotPresetsModal } from "./SlotPresetsModal";
import { PartyPresetsModal } from "./PartyPresetsModal";
import { CosmeticFormPickerModal } from "./CosmeticFormPickerModal";
import { BattleTurnLog } from "./BattleTurnLog";
import { useBattleSetup, BATTLE_SELECT_SIZE } from "../hooks/useBattleSetup";
import { useSlotPresets } from "../hooks/useSlotPresets";
import { usePartyPresets } from "../hooks/usePartyPresets";
import { useBattleVideos } from "../hooks/useBattleVideos";
import type { BattleVideo } from "../types/battleVideo";
import { Modal } from "./Modal";
import { BattleVideoListModal } from "./BattleVideoListModal";
import { getPokemon, getMove, getItem } from "../lib/data";
import { getEffectiveForm, getEffectiveGender, megaBadgeLabel } from "../lib/pokemonForm";
import { MEGA_SYMBOL_SPRITE_URL, type SpriteFormOptions } from "../lib/sprites";
import { PokemonAvatarWithItem } from "./PokemonAvatarWithItem";
import { TYPE_COLORS } from "../lib/typeColors";
import { environmentTintBackground } from "../lib/environmentBackground";
import { rankStageMultiplier } from "../lib/battlePower";
import { VOLATILE_LABELS, SCREEN_LABELS } from "../lib/battleLogLabels";
import { eunNeun } from "../lib/josa";
import {
  applySwitch,
  createBattleState,
  hasUsableMove,
  isTrappedFromSwitching,
  runTurn,
  resumeTurn,
  STRUGGLE_MOVE,
  type BattleSide,
  type BattleState,
  type FighterKey,
  type RunTurnContext,
  type TurnAction,
  type TurnResult,
} from "../lib/battleSimulator";
import type { PartySlot } from "../types/party";
import type { StatusCondition } from "../types/status";
import type { BaseStats } from "../types/stats";
import type { Pokemon } from "../types/pokemon";
import "./BattleLogPage.css";

type Side = "a" | "b";
type SlotIndex = 0 | 1 | 2 | 3 | 4 | 5;
type PickerState =
  | { kind: "pokemon"; side: Side; slotIndex: SlotIndex }
  | { kind: "ability"; side: Side; slotIndex: SlotIndex }
  | { kind: "item"; side: Side; slotIndex: SlotIndex }
  | { kind: "nature"; side: Side; slotIndex: SlotIndex }
  | { kind: "points"; side: Side; slotIndex: SlotIndex }
  | { kind: "cosmeticForm"; side: Side; slotIndex: SlotIndex }
  | { kind: "move"; side: Side; slotIndex: SlotIndex; moveIndex: 0 | 1 | 2 | 3 }
  | { kind: "slotPresets"; side: Side; slotIndex: SlotIndex }
  | { kind: "loadParty"; side: Side }
  | null;

/** 이번 턴 한 편의 선택 — 기술 또는 교체(교대 슬롯 인덱스) */
type TurnChoice = { kind: "move"; moveId: string } | { kind: "switch"; toIndex: number };

/** 편별 이번 턴 선택 상태 */
type SelectedState = { a: TurnChoice | null; b: TurnChoice | null };
/** 편별 턴 입력 모드 — "기술" 또는 "교체" */
type InputModeState = { a: "move" | "switch"; b: "move" | "switch" };
/** 편별 이번 턴 메가진화 선언 여부(§4) */
type MegaDeclaredState = { a: boolean; b: boolean };
/** 이번 턴 처리 결과 활성 슬롯이 기절해 강제 교체가 필요한 편. 해소되면 null */
type PendingForcedSwitchState = { a?: boolean; b?: boolean } | null;
/**
 * 유턴·볼트체인지·배턴터치(§7-2): 사용측 기술 데미지까지 처리하고 턴이 "멈춘" 상태. 이 편이
 * 교대할 포켓몬을 골라야 나머지 턴(상대 행동·턴 종료)이 새 포켓몬 기준으로 이어진다.
 */
type PendingPivotState = {
  ctx: RunTurnContext;
  side: Side;
  passBaton: boolean;
  /** 위기회피로 인한 강제 퇴장이면 true (유턴류와 안내 문구가 다르다) */
  emergencyExit?: boolean;
  /** 탈출버튼처럼 도구로 인한 강제 퇴장이면 그 도구 이름 */
  ejectItemName?: string;
} | null;

const SLOT_INDICES: SlotIndex[] = [0, 1, 2, 3, 4, 5];

const STATUS_LABELS: Record<StatusCondition, string> = {
  burn: "화상",
  poison: "독",
  "badly-poisoned": "맹독",
  paralysis: "마비",
  freeze: "얼음",
  sleep: "잠듦",
};

/** 날씨/필드 배경 틴트 — 매치업 페이지와 공유하는 environmentTintBackground에 위임한다. */
function battleBoardBackground(state: BattleState): string | undefined {
  return environmentTintBackground(state.weather, state.field);
}

function fighterLabel(state: BattleState, key: FighterKey): string {
  const pokemon = getPokemon(state[key].slot.pokemonId);
  return pokemon?.name ?? key;
}

/** 대전 중 실능치 패널에 표시할 6개 스탯을 표 순서(HP·공격·방어·특공·특방·스피드)대로 나열 */
const REAL_STAT_LABELS: { key: keyof BaseStats; label: string }[] = [
  { key: "hp", label: "HP" },
  { key: "atk", label: "공격" },
  { key: "def", label: "방어" },
  { key: "spa", label: "특공" },
  { key: "spd", label: "특방" },
  { key: "spe", label: "스피드" },
];

/**
 * 빌드(6슬롯) 화면 — 양쪽 파티를 편성하는 단계(§16). `BattleLogPage`가 쥔 `setup`(훅
 * 반환값 그대로)과 피커 열기·샘플 저장·다음 단계 진행 콜백만 받는 presentational 컴포넌트.
 */
function BattleSetupScreen({
  setup,
  hasPartyPresets,
  hasSlotPresets,
  movelessWarningFor,
  onSaveSlotAsSample,
  onOpenPicker,
  canProceed,
  proceedLabel,
  hasMovelessSlot,
  onProceed,
}: {
  setup: ReturnType<typeof useBattleSetup>;
  hasPartyPresets: boolean;
  hasSlotPresets: boolean;
  movelessWarningFor: (side: Side) => string | null;
  onSaveSlotAsSample: (side: Side, i: SlotIndex) => void;
  onOpenPicker: (picker: PickerState) => void;
  canProceed: boolean;
  proceedLabel: string;
  hasMovelessSlot: boolean;
  onProceed: () => void;
}) {
  const sideCtls = (side: Side) => (side === "a" ? setup.a : setup.b);
  const slotCtl = (side: Side, i: SlotIndex) => sideCtls(side)[i];

  // 드래그앤드롭으로 슬롯 순서 변경(ver.1.6 §4-2) — PartyBoard와 동일한 패턴. 편(side)이
  // 다르면 맞바꾸지 않는다(내 파티 ↔ 상대 파티 사이 드래그는 의미가 없다).
  const [draggedSlot, setDraggedSlot] = useState<{ side: Side; index: SlotIndex } | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<{ side: Side; index: SlotIndex } | null>(null);

  function handleSlotDragStart(side: Side, index: SlotIndex) {
    setDraggedSlot({ side, index });
  }
  function handleSlotDragOver(side: Side, index: SlotIndex) {
    if (!draggedSlot || draggedSlot.side !== side || draggedSlot.index === index) return;
    setDragOverSlot({ side, index });
  }
  function handleSlotDrop(side: Side, index: SlotIndex) {
    if (draggedSlot && draggedSlot.side === side) setup.reorderSlots(side, draggedSlot.index, index);
    setDraggedSlot(null);
    setDragOverSlot(null);
  }
  function handleSlotDragEnd() {
    setDraggedSlot(null);
    setDragOverSlot(null);
  }

  // 압축 뷰(ver.1.6 §4-3) — 기본은 압축(프로필 사진+이름만), 펼친 슬롯만 이 집합에 담는다.
  const [expandedSlots, setExpandedSlots] = useState<Set<string>>(new Set());
  const slotKey = (side: Side, i: SlotIndex) => `${side}-${i}`;
  function toggleExpanded(side: Side, i: SlotIndex) {
    const key = slotKey(side, i);
    setExpandedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="battle-setup-board">
      {(["a", "b"] as const).map((side) => (
        <Fragment key={side}>
          <div className="battle-setup-column">
            <div className="battle-setup-column-title">
              {hasPartyPresets && (
                <button
                  type="button"
                  className="battle-setup-load-party"
                  onClick={() => onOpenPicker({ kind: "loadParty", side })}
                >
                  저장된 파티 불러오기
                </button>
              )}
              {side === "a" ? "내 파티" : "상대 파티"}{" "}
              <span className="battle-setup-column-hint">6마리까지 빌드 · 4마리 이상이면 3마리 선출</span>
            </div>
            {movelessWarningFor(side) && (
              <p className="battle-lock-warning">{movelessWarningFor(side)}</p>
            )}
            {SLOT_INDICES.map((i) => (
              <BattleSetupCard
                key={i}
                label={`${side === "a" ? "내 포켓몬" : "상대 포켓몬"} ${i + 1}`}
                slot={slotCtl(side, i).slot}
                onPickPokemon={() => onOpenPicker({ kind: "pokemon", side, slotIndex: i })}
                onClearPokemon={slotCtl(side, i).clearPokemon}
                onPickMove={(moveIndex) => onOpenPicker({ kind: "move", side, slotIndex: i, moveIndex })}
                onPickAbility={() => onOpenPicker({ kind: "ability", side, slotIndex: i })}
                onPickItem={() => onOpenPicker({ kind: "item", side, slotIndex: i })}
                onPickNature={() => onOpenPicker({ kind: "nature", side, slotIndex: i })}
                onPickPoints={() => onOpenPicker({ kind: "points", side, slotIndex: i })}
                onToggleGender={slotCtl(side, i).toggleGender}
                onCycleSizeForm={slotCtl(side, i).cycleSizeForm}
                onCycleFormVariant={slotCtl(side, i).cycleFormVariant}
                onCycleCosmeticForm={slotCtl(side, i).cycleCosmeticForm}
                onPickCosmeticForm={() => onOpenPicker({ kind: "cosmeticForm", side, slotIndex: i })}
                hasSamples={hasSlotPresets}
                onSaveAsSample={() => onSaveSlotAsSample(side, i)}
                onOpenSamplePicker={() => onOpenPicker({ kind: "slotPresets", side, slotIndex: i })}
                expanded={expandedSlots.has(slotKey(side, i))}
                onToggleExpand={() => toggleExpanded(side, i)}
                isDragging={draggedSlot?.side === side && draggedSlot.index === i}
                isDragOver={dragOverSlot?.side === side && dragOverSlot.index === i}
                onDragStart={() => handleSlotDragStart(side, i)}
                onDragOverSlot={() => handleSlotDragOver(side, i)}
                onDrop={() => handleSlotDrop(side, i)}
                onDragEnd={handleSlotDragEnd}
              />
            ))}
          </div>
          {side === "a" && (
            <div className="battle-setup-center">
              <button
                type="button"
                className="battle-setup-vs"
                disabled={!canProceed}
                onClick={onProceed}
                aria-label={canProceed ? proceedLabel : hasMovelessSlot ? "기술을 배정하지 않은 포켓몬이 있습니다" : "양쪽 파티를 먼저 완성하세요"}
                title={canProceed ? proceedLabel : hasMovelessSlot ? "기술을 배정하지 않은 포켓몬이 있습니다" : "양쪽 파티를 먼저 완성하세요"}
              >
                VS
              </button>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * 선출(3+순서) 화면 — 6마리 중 4마리 이상 빌드한 편만 여기서 순서까지 고른다(§16). 빌드
 * 화면과 마찬가지로 파생값/콜백만 props로 받는 presentational 컴포넌트.
 */
function BattleSelectScreen({
  selection,
  buildableIndices,
  needsSelection,
  pokemonAt,
  slotAt,
  onToggleSelection,
  onBack,
  selectionComplete,
  onStartBattle,
}: {
  selection: { a: SlotIndex[]; b: SlotIndex[] };
  buildableIndices: (side: Side) => SlotIndex[];
  needsSelection: (side: Side) => boolean;
  pokemonAt: (side: Side, i: SlotIndex) => Pokemon | undefined;
  /** 프로필(+도구) 이미지용 슬롯 원본(ver.1.6 §4-4) — pokemonAt은 종 데이터만 준다 */
  slotAt: (side: Side, i: SlotIndex) => PartySlot | null;
  onToggleSelection: (side: Side, i: SlotIndex) => void;
  onBack: () => void;
  selectionComplete: boolean;
  onStartBattle: () => void;
}) {
  return (
    <div className="battle-select">
      <div className="battle-select-board">
        {(["a", "b"] as const).map((side) => {
          const pool = buildableIndices(side);
          const picks = selection[side];
          const manual = needsSelection(side);
          return (
            <div key={side} className="battle-select-column">
              <div className="battle-setup-column-title">
                {side === "a" ? "내 선출" : "상대 선출"}{" "}
                <span className="battle-setup-column-hint">
                  {manual ? `${picks.length}/${BATTLE_SELECT_SIZE} · 고른 순서가 선출 순서(첫 번째가 리드)` : "빌드 순서대로 선출"}
                </span>
              </div>
              <div className="battle-select-list">
                {pool.map((i) => {
                  const pk = pokemonAt(side, i);
                  const pkSlot = slotAt(side, i);
                  // 수동 선출: 고른 순서대로 번호. 선출 스킵 편: 빌드 순서 그대로 1·2·3 고정.
                  const num = manual
                    ? picks.includes(i)
                      ? picks.indexOf(i) + 1
                      : null
                    : pool.indexOf(i) + 1;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`battle-select-mon${num ? " is-picked" : ""}`}
                      disabled={!manual}
                      onClick={() => onToggleSelection(side, i)}
                    >
                      <span className={`battle-select-num${num ? " is-on" : ""}`}>{num ?? ""}</span>
                      {pk && pkSlot && (
                        <PokemonAvatarWithItem
                          pokemon={pk}
                          size={28}
                          radius={8}
                          gradientTypes={getEffectiveForm(pk, pkSlot).types}
                          itemId={pkSlot.item}
                          form={{
                            gender: getEffectiveGender(pk, pkSlot),
                            cosmeticForm: pkSlot.cosmeticForm,
                            formVariant: pkSlot.formVariant,
                            sizeForm: pkSlot.sizeForm,
                            activeMegaForm: pkSlot.activeMegaForm,
                            item: pkSlot.item,
                          }}
                        />
                      )}
                      <span className="battle-select-name">{pk?.name ?? "포켓몬"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="battle-select-actions">
        <button type="button" className="battle-reset-button" onClick={onBack}>
          뒤로
        </button>
        <button
          type="button"
          className="battle-start-button"
          disabled={!selectionComplete}
          onClick={onStartBattle}
        >
          대전 시작
        </button>
      </div>
    </div>
  );
}

/**
 * 실시간 배틀판 — HP게이지·상태태그·실능치·파티트래커·기술/교체 입력·메가진화 토글·턴
 * 진행 버튼까지(§16). `BattleLogPage`가 쥔 배틀 상태·핸들러를 그대로 넘기는
 * presentational 컴포넌트 — 워낙 많은 값을 필요로 해서(23개) `BattleSetupScreen`처럼
 * 개별 훅 객체 하나로 뭉뚱그릴 수 없어 각자 이름 그대로 prop으로 받는다.
 */
function BattleBoard({
  battleState,
  winner,
  selected,
  setSelected,
  inputMode,
  setInputMode,
  megaDeclared,
  setMegaDeclared,
  pendingForcedSwitch,
  pendingPivot,
  lockWarning,
  setLockWarning,
  log,
  battleBoardBackground,
  fighterLabel,
  activeMoveIds,
  choiceLockedMoveId,
  battleSide,
  switchableIndices,
  resolveForcedSwitch,
  resolvePivot,
  isStruggling,
  moveRestrictionMessage,
  playTurn,
  resetToSetup,
}: {
  battleState: BattleState;
  winner: FighterKey | "draw" | undefined;
  selected: SelectedState;
  setSelected: Dispatch<SetStateAction<SelectedState>>;
  inputMode: InputModeState;
  setInputMode: Dispatch<SetStateAction<InputModeState>>;
  megaDeclared: MegaDeclaredState;
  setMegaDeclared: Dispatch<SetStateAction<MegaDeclaredState>>;
  pendingForcedSwitch: PendingForcedSwitchState;
  pendingPivot: PendingPivotState;
  lockWarning: string | null;
  setLockWarning: Dispatch<SetStateAction<string | null>>;
  log: TurnResult[];
  battleBoardBackground: (state: BattleState) => string | undefined;
  fighterLabel: (state: BattleState, key: FighterKey) => string;
  activeMoveIds: (side: Side) => (string | null)[];
  choiceLockedMoveId: (side: Side) => string | null;
  battleSide: (side: Side) => BattleSide | undefined;
  switchableIndices: (side: Side) => number[];
  resolveForcedSwitch: (side: Side, toIndex: number) => void;
  resolvePivot: (toIndex: number) => void;
  isStruggling: (side: Side) => boolean;
  moveRestrictionMessage: (side: Side, moveId: string) => string | null;
  playTurn: () => void;
  resetToSetup: () => void;
}) {
  return (
    <>
    <div className="battle-board" style={{ background: battleBoardBackground(battleState) }}>
      {(() => {
        const hazardTag = (side: Side): string[] => {
          const hz = side === "a" ? battleState.sideA.hazards : battleState.sideB.hazards;
          const parts: string[] = [];
          if (hz.stealthRock) parts.push("스텔스록");
          if (hz.spikesLayers > 0) parts.push(`압정뿌리기 ${hz.spikesLayers}층`);
          if (hz.toxicSpikesLayers > 0) parts.push(`독압정 ${hz.toxicSpikesLayers}층`);
          if (hz.stickyWeb) parts.push("끈적끈적네트");
          return parts;
        };
        const anyHazard = hazardTag("a").length > 0 || hazardTag("b").length > 0;
        if (!battleState.weather && !battleState.field && battleState.trickRoomTurnsRemaining === undefined && !anyHazard) {
          return null;
        }
        return (
          <div className="battle-environment-tags">
            {battleState.weather && (
              <span className="battle-environment-tag">
                날씨: {battleState.weather} (앞으로 {battleState.weatherTurnsRemaining}턴)
              </span>
            )}
            {battleState.field && (
              <span className="battle-environment-tag">
                필드: {battleState.field} (앞으로 {battleState.fieldTurnsRemaining}턴)
              </span>
            )}
            {battleState.trickRoomTurnsRemaining !== undefined && (
              <span className="battle-environment-tag">
                트릭룸 (앞으로 {battleState.trickRoomTurnsRemaining}턴)
              </span>
            )}
            {(["a", "b"] as const).map((side) =>
              hazardTag(side).length > 0 ? (
                <span key={`hz-${side}`} className="battle-environment-tag">
                  {fighterLabel(battleState, side)} 진영: {hazardTag(side).join(" · ")}
                </span>
              ) : null,
            )}
          </div>
        );
      })()}
      {(["a", "b"] as const).map((side) => {
        const fighter = battleState[side];
        const pokemon = getPokemon(fighter.slot.pokemonId);
        if (!pokemon) return null;
        // 일루전(§6-1): 위장 중이면 화면에는 위장 대상 이름을 보여준다(타입·실능·특성은 조로아크 그대로).
        const displayName = fighter.illusionAs
          ? getPokemon(fighter.illusionAs)?.name ?? pokemon.name
          : pokemon.name;
        // 셋업 카드와 동일하게 메가진화 여부를 반영해서 이름 옆에 배지를 그린다.
        // fighter.slot(EvaluatorSlot)은 FormSource를 만족하므로 getEffectiveForm을 그대로 쓸 수 있다.
        // (메가진화 관련 용도 전용 — 변신 중에도 메타몽 자신의 메가 여부라 원본 종 기준 그대로 둔다.)
        const form = getEffectiveForm(pokemon, fighter.slot);
        const hpPercent = Math.max(0, Math.min(100, (fighter.currentHp / fighter.maxHp) * 100));
        // 변신(§괴짜/변신, ver.1.6): 로그엔 "변신했다!"가 찍히는데 보드 표시가 안 바뀌던 버그 —
        // 이름은 원본 종 그대로 두되(본가 규칙), 스프라이트·타입 배지는 변신 대상 모습으로 보여준다.
        // fighter.types는 applyTransform이 이미 대상 것으로 갈아치워 둔 값이라 그대로 쓴다.
        const transformedPokemon =
          !fighter.illusionAs && fighter.transformedIntoPokemonId
            ? getPokemon(fighter.transformedIntoPokemonId)
            : undefined;
        // §1-4: 대전 화면 아바타. 일루전 중이면 위장 대상 종의 스프라이트를(상대가 안 눈치채도록,
        // 도구 뱃지도 숨김), 변신 중이면 변신 대상 종을(성별·폼 등은 복제 대상이 아니라 기본
        // 모습으로), 아니면 실제 종. 메가스톤을 들어도 실제로 선언(hasMegaEvolved)해야
        // 메가폼 스프라이트로 바뀐다 — 그래서 item은 스프라이트 옵션에 안 넘기고(메가스톤이
        // 스프라이트를 강제로 메가폼으로 만들기 때문) 뱃지로만 표시한다.
        const illusionPokemon = fighter.illusionAs ? getPokemon(fighter.illusionAs) : undefined;
        const avatarPokemon = illusionPokemon ?? transformedPokemon ?? pokemon;
        // 변신 시점에 대상이 메가진화 상태였으면(transformedIntoMegaStone) 그 메가폼 이미지 그대로.
        const transformedMegaForm = transformedPokemon?.megaEvolutions?.find(
          (m) => m.megaStone === fighter.transformedIntoMegaStone,
        )?.form;
        const avatarForm: SpriteFormOptions = illusionPokemon
          ? {}
          : transformedPokemon
            ? { activeMegaForm: transformedMegaForm }
            : {
                gender: getEffectiveGender(pokemon, fighter.slot),
                cosmeticForm: fighter.slot.cosmeticForm,
                formVariant: fighter.slot.formVariant,
                sizeForm: fighter.slot.sizeForm,
                activeMegaForm: fighter.hasMegaEvolved ? form.mega?.form : undefined,
              };
        // battleState 안의 slot은 EvaluatorSlot(moves 필드 없음)이라, 4개 기술 목록은
        // 셋업 단계에서 쓴 PartySlot을 활성 슬롯 인덱스로 되짚어 가져온다 — 배틀 중엔 안 바뀜
        const moveIds: (string | null)[] = activeMoveIds(side);
        const moves = moveIds
          .filter((id): id is string => id !== null)
          .map((id) => getMove(id))
          .filter((m): m is NonNullable<typeof m> => m !== undefined);
        // 구애스카프: 이미 잠긴 기술이 있으면(대전 시작 후 첫 사용 이후) 그 id를 미리 구해둔다
        const lockedMoveId = choiceLockedMoveId(side);

        return (
          <div
            key={side}
            className={`battle-fighter battle-fighter-${side}${winner === side ? " is-winner" : ""}`}
          >
            <div className="battle-fighter-head">
              <div className="battle-fighter-ident">
                <PokemonAvatarWithItem
                  pokemon={avatarPokemon}
                  form={avatarForm}
                  gradientTypes={illusionPokemon ? illusionPokemon.types : fighter.types}
                  size={38}
                  radius={9}
                  itemId={fighter.illusionAs ? undefined : fighter.slot.item}
                />
                <span className="battle-fighter-name">
                  {displayName}
                  {/* §4: 스톤을 들어도 실제로 메가진화를 선언(hasMegaEvolved)해야 배지가 뜬다 */}
                  {!fighter.illusionAs && fighter.hasMegaEvolved && form.mega && (
                    <span className="battle-fighter-mega-tag">{megaBadgeLabel(form.mega)}</span>
                  )}
                  {fighter.currentHp <= 0 && <span className="battle-fighter-fainted"> (기절)</span>}
                </span>
              </div>
              <div className="battle-status-tags">
                {fighter.status.condition && (
                  <span className="battle-status-tag is-major">{STATUS_LABELS[fighter.status.condition]}</span>
                )}
                {(Object.keys(fighter.volatile.active) as (keyof typeof VOLATILE_LABELS)[]).map((v) => {
                  // 사슬묶기/앙코르는 대상 기술 이름까지 같이 보여줘야 어떤 기술이
                  // 막혔는지/강제됐는지 알 수 있다.
                  const entry = fighter.volatile.active[v];
                  const moveName = entry?.moveId ? getMove(entry.moveId)?.name : undefined;
                  // 남은 턴수가 유한한 것(도발·앙코르·사슬묶기·속박·물엿범벅·혼란·졸음)만 " N턴"을
                  // 붙인다(§5-5). 뿌리박기·아쿠아링·씨뿌리기·헤롱헤롱·소금절이는 배틀 끝까지라
                  // 999 센티넬 → 표기 안 함.
                  const turns = entry && entry.turnsRemaining < 900 ? entry.turnsRemaining : undefined;
                  return (
                    <span key={v} className="battle-status-tag is-volatile">
                      {VOLATILE_LABELS[v]}
                      {moveName && `(${moveName})`}
                      {turns !== undefined && ` ${turns}턴`}
                    </span>
                  );
                })}
                {(() => {
                  // 스크린은 편(BattleSide) 단위 상태다(§6-3) — 활성 파이터가 아니라 side에서 읽는다.
                  const screens = battleSide(side)?.screens ?? {};
                  return (Object.keys(screens) as ("reflect" | "lightScreen" | "auroraVeil")[])
                    .filter((s) => screens[s] !== undefined)
                    .map((s) => (
                      <span key={s} className="battle-status-tag is-volatile">
                        {SCREEN_LABELS[s]} {screens[s]}턴
                      </span>
                    ));
                })()}
                {battleSide(side)?.wish && (
                  // 희망사항도 편 단위 큐다(§6-2). turnsRemaining 1 = 이번 턴 종료에 발동.
                  <span className="battle-status-tag is-volatile">희망사항 대기</span>
                )}
                {battleSide(side)?.safeguardTurnsRemaining !== undefined && (
                  // 신비의부적도 스크린과 같은 편 단위 상태다(§1-9).
                  <span className="battle-status-tag is-volatile">
                    신비의부적 {battleSide(side)?.safeguardTurnsRemaining}턴
                  </span>
                )}
                {fighter.perishCount !== undefined && (
                  <span className="battle-status-tag is-major">멸망 {fighter.perishCount}</span>
                )}
                {fighter.substituteHp !== undefined && (
                  <span className="battle-status-tag is-volatile">대타 HP {fighter.substituteHp}</span>
                )}
                {fighter.unburdenActive && (
                  <span className="battle-status-tag is-volatile">곡예(스피드 2배)</span>
                )}
              </div>
            </div>
            <div className="battle-hp-bar">
              <div
                className={`battle-hp-fill${hpPercent <= 20 ? " is-danger" : hpPercent <= 50 ? " is-warn" : ""}`}
                style={{ width: `${hpPercent}%` }}
              />
            </div>
            <div className="battle-hp-numbers">
              {fighter.currentHp} / {fighter.maxHp}
            </div>

            {/* 대전 중엔 셋업 카드가 안 보여서 내가 맞춘 능력치를 확인할 방법이 없었다는 피드백 반영 —
                HP·공격·방어·특공·특방·스피드 실능치를 배틀 보드에도 그대로 노출한다. 칼춤·위협 등
                랭크 변화는 턴 진행 중 이 표시에 즉시 반영한다(Phase 6.5 §6-2 ⑧) — HP는 랭크 대상이 아님. */}
            <div className="battle-real-stats">
              {REAL_STAT_LABELS.map(({ key, label }) => {
                const base = fighter.realStats[key];
                const stage = key === "hp" ? 0 : fighter.stages[key];
                const effective = stage === 0 ? base : Math.round(base * rankStageMultiplier(stage));
                return (
                  <div
                    key={key}
                    className={`battle-real-stat-item${
                      stage > 0 ? " is-boosted" : stage < 0 ? " is-lowered" : ""
                    }`}
                  >
                    <span className="battle-real-stat-label">{label}</span>
                    <span
                      className="battle-real-stat-value"
                      title={
                        stage !== 0
                          ? `기본 ${Math.round(base)} (${stage > 0 ? "+" : ""}${stage}랭크)`
                          : undefined
                      }
                    >
                      {Math.round(effective)}
                      {stage !== 0 && (
                        <span className="battle-real-stat-stage">
                          {stage > 0 ? `+${stage}` : stage}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* 파티 트래커 — 이 편 3마리의 HP·상태·기절, 활성 슬롯 표시 */}
            {(() => {
              const bs = side === "a" ? battleState.sideA : battleState.sideB;
              if (bs.party.length <= 1) return null;
              return (
                <div className="battle-party-tracker">
                  {bs.party.map((f, i) => {
                    // 일루전(§6-1): 위장 중인 활성 조로아크는 트래커에서도 위장 대상 이름으로 보인다.
                    const pk = getPokemon(f.illusionAs ?? f.slot.pokemonId);
                    const pct = Math.max(0, Math.min(100, (f.currentHp / f.maxHp) * 100));
                    const fainted = f.currentHp <= 0;
                    return (
                      <div
                        key={i}
                        className={`battle-party-chip${i === bs.activeIndex ? " is-active" : ""}${fainted ? " is-fainted" : ""}`}
                        title={`${pk?.name ?? "포켓몬"} · ${f.currentHp}/${f.maxHp}${f.status.condition ? ` · ${STATUS_LABELS[f.status.condition]}` : ""}`}
                      >
                        <span className="battle-party-chip-name">
                          {i === bs.activeIndex ? "▶ " : ""}
                          {pk?.name ?? "포켓몬"}
                        </span>
                        <span className="battle-party-chip-hp">
                          {fainted ? "기절" : `${f.currentHp}/${f.maxHp}`}
                          {f.status.condition && !fainted && ` · ${STATUS_LABELS[f.status.condition]}`}
                          {f.perishCount !== undefined && !fainted && ` · 멸망 ${f.perishCount}`}
                        </span>
                        <span className="battle-party-chip-bar">
                          <span
                            className={`battle-party-chip-fill${pct <= 20 ? " is-danger" : pct <= 50 ? " is-warn" : ""}`}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* ── 이번 턴 이 편의 입력 영역 ── */}
            {(() => {
              const bs = side === "a" ? battleState.sideA : battleState.sideB;
              const benchIdx = switchableIndices(side);

              // 1) 강제 교체: 활성이 기절해 다음 턴 전에 교대해야 한다
              if (pendingForcedSwitch?.[side]) {
                return (
                  <div className="battle-switch-panel">
                    <div className="battle-switch-panel-title">
                      {pokemon.name}
                      {eunNeun(pokemon.name)} 쓰러졌다!
                      <br />
                      내보낼 포켓몬을 선택하세요!
                    </div>
                    <div className="battle-switch-list">
                      {benchIdx.map((i) => (
                        <button
                          key={i}
                          type="button"
                          className="battle-switch-button"
                          onClick={() => resolveForcedSwitch(side, i)}
                        >
                          {getPokemon(bs.party[i].slot.pokemonId)?.name ?? "포켓몬"} 내보내기
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }

              // 2) 유턴류 자체 교체: 사용측 기술까지 처리된 뒤 멈춘 상태 — 나올 포켓몬을 고르면
              //    나머지 턴(상대 행동·턴 종료)이 새 포켓몬 기준으로 이어진다(§7-2).
              if (pendingPivot && pendingPivot.side === side) {
                return (
                  <div className="battle-switch-panel">
                    <div className="battle-switch-panel-title">
                      {pendingPivot.emergencyExit ? (
                        <>
                          {pokemon.name}의 위기회피! 위험을 피해 물러난다!
                        </>
                      ) : pendingPivot.ejectItemName ? (
                        <>
                          {pokemon.name}의 {pendingPivot.ejectItemName}! 그 자리에서 물러난다!
                        </>
                      ) : (
                        <>
                          {pokemon.name}
                          {eunNeun(pokemon.name)} 돌아온다!
                          {pendingPivot.passBaton && " (능력 변화 인계)"}
                        </>
                      )}
                      <br />
                      내보낼 포켓몬을 선택하세요!
                    </div>
                    <div className="battle-switch-list">
                      {benchIdx.map((i) => (
                        <button
                          key={i}
                          type="button"
                          className="battle-switch-button"
                          onClick={() => resolvePivot(i)}
                        >
                          {getPokemon(bs.party[i].slot.pokemonId)?.name ?? "포켓몬"} 내보내기
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }

              if (winner) return null;

              // 문어굳히기/물고버티기(도망봉인)에 걸려 있으면 자발적 교체 불가(고스트 예외).
              const trapped = isTrappedFromSwitching(fighter);
              const canSwitch =
                benchIdx.length > 0 && !fighter.chargingMoveId && fighter.currentHp > 0 && !trapped;
              const mode = canSwitch ? inputMode[side] : "move";

              return (
                <>
                  {canSwitch && (
                    <div className="battle-input-toggle">
                      {(["move", "switch"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`battle-input-toggle-btn${mode === m ? " is-on" : ""}`}
                          onClick={() => {
                            setInputMode((p) => ({ ...p, [side]: m }));
                            setSelected((p) => ({ ...p, [side]: null }));
                          }}
                        >
                          {m === "move" ? "기술" : "교체"}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* PR-C1b: 도망봉인(문어굳히기·물고버티기) 안내 — 교체 토글이 사라진 이유 표시 */}
                  {trapped && benchIdx.length > 0 && fighter.currentHp > 0 && (
                    <div className="battle-input-hint is-muted">교체할 수 없다! (도망봉인)</div>
                  )}

                  {/* §4: 메가진화 선언 토글 — 스톤을 들었고, 아직 안 했고, 그 편이 이번 배틀에
                      메가진화를 안 썼을 때만. 켜고 기술을 고르면 그 턴 행동 전에 메가진화. */}
                  {mode !== "switch" &&
                    fighter.megaStone &&
                    !battleSide(side)?.megaUsed &&
                    !fighter.hasMegaEvolved && (
                      <label className="battle-mega-toggle">
                        <input
                          type="checkbox"
                          checked={megaDeclared[side]}
                          onChange={(e) =>
                            setMegaDeclared((p) => ({ ...p, [side]: e.target.checked }))
                          }
                        />
                        {MEGA_SYMBOL_SPRITE_URL && (
                          <img
                            className="battle-mega-toggle-icon"
                            src={MEGA_SYMBOL_SPRITE_URL}
                            alt=""
                            draggable={false}
                          />
                        )}
                        <span>
                          메가진화{form.mega ? ` (${megaBadgeLabel(form.mega)})` : ""}
                        </span>
                      </label>
                    )}

                  {mode === "switch" ? (
                    <div className="battle-switch-list">
                      {benchIdx.map((i) => {
                        const chosen = selected[side]?.kind === "switch" && selected[side]!.toIndex === i;
                        return (
                          <button
                            key={i}
                            type="button"
                            className={`battle-switch-button${chosen ? " is-selected" : ""}`}
                            onClick={() => {
                              setLockWarning(null);
                              setSelected((p) => ({ ...p, [side]: { kind: "switch", toIndex: i } }));
                            }}
                          >
                            {getPokemon(bs.party[i].slot.pokemonId)?.name ?? "포켓몬"} (
                            {bs.party[i].currentHp}/{bs.party[i].maxHp})
                          </button>
                        );
                      })}
                    </div>
                  ) : fighter.chargingMoveId ? (
                    <div className="battle-struggle-notice">
                      {getMove(fighter.chargingMoveId)?.name ?? "기술"} 준비 중...
                    </div>
                  ) : !isStruggling(side) ? (
              <div className="battle-move-grid">
                {moves.map((move) => {
                  const pp = fighter.remainingPp[move.id] ?? move.pp;
                  // 실제 배틀에서도 조건을 안 채웠다고 기술 자체를 못 내는 건 아니고, 내봤자
                  // 실패하는 것뿐이다(사용자 확인) — 코골기(잠든 상태 전용)·속이기(첫 턴 전용)
                  // 둘 다 조건 불충족이어도 버튼은 그대로 선택 가능하게 두고, resolveAction이
                  // "usageCondition"으로 실패 처리하는 걸 로그에서 그대로 보여준다.
                  const sleepConditionUnmet = move.usageCondition === "sleep-only" && fighter.status.condition !== "sleep";
                  const firstTurnConditionUnmet =
                    move.usageCondition === "first-turn-only" && battleState.turnNumber !== 0;
                  const fieldConditionUnmet = move.usageCondition === "field-required" && !battleState.field;
                  const weatherConditionUnmet =
                    move.usageCondition === "weather-required" && battleState.weather !== move.requiresWeather;
                  // 기습은 상대가 이번 턴 뭘 낼지(동시 비공개 선택이라) 미리 알 수 없어 다른
                  // usageCondition처럼 "지금 조건 충족 여부"를 판정할 수 없다 — 매번 고정 안내만 띄운다.
                  const suckerPunchHint = move.usageCondition === "opponent-damaging-move-only";
                  const choiceLocked = lockedMoveId !== null && move.id !== lockedMoveId;
                  const restrictionMsg = moveRestrictionMessage(side, move.id);
                  const disabled = pp <= 0 || fighter.currentHp <= 0 || !!winner;
                  // 셋업 카드의 party-move-pip와 동일하게 기술 타입 배경색을 입힌다.
                  const moveColor = move.type ? TYPE_COLORS[move.type] : undefined;
                  return (
                    <button
                      key={move.id}
                      type="button"
                      className={`battle-move-button${moveColor ? " has-type" : ""}${
                        selected[side]?.kind === "move" && selected[side]!.moveId === move.id ? " is-selected" : ""
                      }`}
                      style={moveColor ? { background: moveColor } : undefined}
                      disabled={disabled}
                      title={
                        sleepConditionUnmet
                          ? "잠든 상태에서만 사용 가능 — 지금 쓰면 실패해요"
                          : firstTurnConditionUnmet
                            ? "등장 후 첫 턴에만 사용 가능 — 지금 쓰면 실패해요"
                            : fieldConditionUnmet
                              ? "필드가 있을 때만 사용 가능 — 지금 쓰면 실패해요"
                              : weatherConditionUnmet
                                ? `${move.requiresWeather} 날씨일 때만 사용 가능 — 지금 쓰면 실패해요`
                                : suckerPunchHint
                                ? "상대보다 먼저 움직이면서, 상대가 데미지 기술을 낼 때만 성공해요"
                                : choiceLocked
                                ? "구애스카프 때문에 지금은 이 기술을 쓸 수 없다"
                                : restrictionMsg ?? undefined
                      }
                      onClick={() => {
                        setLockWarning(null);
                        setSelected((prev) => ({ ...prev, [side]: { kind: "move", moveId: move.id } }));
                      }}
                    >
                      <span className="battle-move-name">{move.name}</span>
                      <span className="battle-move-pp">
                        {pp}/{move.pp}
                      </span>
                    </button>
                  );
                })}
              </div>
                  ) : (
                    // PP 전부 0 / 구애류 잠긴 기술 PP 0 / 앙코르·도발 등으로 고를 수 있는
                    // 기술이 하나도 없음 — 어느 경우든 발버둥이 자동으로 나간다(§5-2)
                    <div className="battle-struggle-notice">
                      {pokemon.name}
                      {eunNeun(pokemon.name)} 사용할 수 있는 기술이 없다!
                      <br />
                      {pokemon.name}의 발버둥!
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        );
      })}
    </div>

    {battleState.entryAnnouncements.length > 0 && (
      <div className="battle-entry-announcements">
        {battleState.entryAnnouncements.map((text, i) => (
          <div key={i}>{text}</div>
        ))}
      </div>
    )}

    {winner ? (
      <div className={`battle-result-banner${winner === "draw" ? " is-draw" : ""}`}>
        {winner === "draw" ? "🤝 무승부! 양쪽 다 기절했어요" : `🏆 ${fighterLabel(battleState, winner)} 승리!`}
        <button type="button" className="battle-reset-button" onClick={resetToSetup}>
          다시 설정하기
        </button>
      </div>
    ) : pendingForcedSwitch ? (
      <div className="battle-lock-warning">내보낼 포켓몬을 선택하세요!</div>
    ) : pendingPivot ? (
      <div className="battle-lock-warning">교체 기술로 물러날 포켓몬을 선택하세요!</div>
    ) : (
      <>
        <button
          type="button"
          className="battle-start-button"
          disabled={(["a", "b"] as const).some(
            (side) =>
              selected[side]?.kind !== "switch" &&
              !isStruggling(side) &&
              battleState[side].chargingMoveId === undefined &&
              !selected[side],
          )}
          onClick={playTurn}
        >
          턴 진행
        </button>
        {lockWarning && <div className="battle-lock-warning">{lockWarning}</div>}
      </>
    )}

    <BattleTurnLog log={log} />
    </>
  );
}
export function BattleLogPage() {
  const setup = useBattleSetup();
  const slotPresets = useSlotPresets();
  const partyPresets = usePartyPresets();
  const battleVideos = useBattleVideos();
  // 배틀비디오 목록/다시보기 토글(§6). "list"면 목록 모달, BattleVideo 객체면 그 비디오의 로그를 보여준다.
  const [battleVideoView, setBattleVideoView] = useState<"list" | BattleVideo | null>(null);
  const [picker, setPicker] = useState<PickerState>(null);
  const [battleState, setBattleState] = useState<BattleState | null>(null);
  const [log, setLog] = useState<TurnResult[]>([]);
  const [selected, setSelected] = useState<SelectedState>({ a: null, b: null });
  // 대전 시작 시점의 편측 파티(선출 순서대로 압축). battleState 안의 slot은 EvaluatorSlot이라
  // 기술 4개 목록이 없어서, 활성 슬롯의 기술은 여기서 activeIndex로 되짚는다. 배틀 중엔 안 바뀜.
  const [partySlots, setPartySlots] = useState<{ a: PartySlot[]; b: PartySlot[] }>({ a: [], b: [] });
  // 이번 턴 처리 결과 활성 슬롯이 기절해 강제 교체가 필요한 편. 해소되면 null.
  const [pendingForcedSwitch, setPendingForcedSwitch] = useState<PendingForcedSwitchState>(null);
  // 유턴·볼트체인지·배턴터치(§7-2): 사용측 기술 데미지까지 처리하고 턴이 "멈춘" 상태. 이 편이
  // 교대할 포켓몬을 골라야 나머지 턴(상대 행동·턴 종료)이 새 포켓몬 기준으로 이어진다.
  // ctx는 엔진이 준 불투명 컨텍스트 — resumeTurn에 그대로 넘긴다.
  const [pendingPivot, setPendingPivot] = useState<PendingPivotState>(null);
  // 편별 턴 입력 모드 — "기술" 또는 "교체"
  const [inputMode, setInputMode] = useState<InputModeState>({ a: "move", b: "move" });
  // 구애스카프 잠금 위반으로 턴 진행이 막혔을 때 보여줄 경고 문구. 선택이 바뀌거나 턴이 정상
  // 진행되면 지운다.
  const [lockWarning, setLockWarning] = useState<string | null>(null);
  // 빌드(6슬롯) → 선출(3+순서) → 대전. selecting=true면 선출 화면(§3).
  const [selecting, setSelecting] = useState(false);
  // 각 편이 선출한 빌드 슬롯 인덱스 — 고른 순서대로(index 0 = 리드). 선출이 필요 없는 편
  // (유효 빌드 ≤ BATTLE_SELECT_SIZE)은 "다음"을 누른 시점에 빌드 순서대로 자동으로 채운다.
  const [selection, setSelection] = useState<{ a: SlotIndex[]; b: SlotIndex[] }>({ a: [], b: [] });
  // 이번 턴 메가진화를 선언했는지(§4). 매 턴 시작 시 꺼짐으로 초기화한다.
  const [megaDeclared, setMegaDeclared] = useState<MegaDeclaredState>({ a: false, b: false });

  const sideCtls = (side: Side) => (side === "a" ? setup.a : setup.b);
  const slotCtl = (side: Side, i: SlotIndex) => sideCtls(side)[i];
  const pokemonAt = (side: Side, i: SlotIndex) => {
    const slot = slotCtl(side, i).slot;
    return slot ? getPokemon(slot.pokemonId) : undefined;
  };
  const battleSide = (side: Side): BattleSide | undefined =>
    side === "a" ? battleState?.sideA : battleState?.sideB;
  /** 배틀 중 이 편의 현재 활성 포켓몬(종) */
  const activePokemon = (side: Side) =>
    battleState ? getPokemon(battleState[side].slot.pokemonId) : undefined;
  /**
   * 배틀 중 이 편의 현재 활성 슬롯이 지닌 기술 4개(셋업 PartySlot에서 되짚음). 단, 변신/괴짜로
   * 상대 기술을 복제한 상태(fighter.transformed)면 셋업 때의 원본 기술(메타몽이면 "변신" 하나뿐)이
   * 아니라 실제로 복제된 fighter.remainingPp의 키를 써야 한다 — 전에는 이 구분이 없어서 변신 후에도
   * 계속 "변신" 하나만 낼 수 있던 버그가 있었다(ver.1.6).
   */
  const activeMoveIds = (side: Side): (string | null)[] => {
    const fighter = battleState?.[side];
    if (fighter?.transformed) return Object.keys(fighter.remainingPp);
    const idx = battleSide(side)?.activeIndex ?? 0;
    return partySlots[side][idx]?.moves ?? [];
  };

  function handleSaveSlotAsSample(side: Side, i: SlotIndex) {
    const slot = slotCtl(side, i).slot;
    if (!slot) return;
    const pokemon = getPokemon(slot.pokemonId);
    const name = window.prompt("이 빌드를 저장할 이름을 입력하세요.", pokemon?.name ?? "");
    if (name === null) return;
    slotPresets.savePreset(name, slot);
  }

  /**
   * 구애스카프: 이 쪽 활성 포켓몬이 그 도구를 지녔고, 로그에 이미 이 쪽이 실제로 쓴 기술이 있으면
   * 그 첫 기술 id로 잠긴다. 판정 엔진이 아니라 이 화면의 턴 진행 버튼이 UI 단에서 막는 방식이라,
   * 잠긴 기술 id를 여기서 로그를 훑어 매번 다시 구한다(별도 상태로 안 들고 다닌다).
   * 교체하면 슬롯이 바뀌므로 잠금도 풀린다 — 마지막 교체 이후의 로그만 훑는다.
   */
  function choiceLockedMoveId(side: Side): string | null {
    if (!battleState) return null;
    const itemId = battleState[side].slot.item;
    const item = itemId ? getItem(itemId) : undefined;
    if (!item?.locksFirstMoveUsed) return null;
    // 이 편이 마지막으로 교체한 턴 번호 — 그 뒤의 기술 사용부터가 유효하다.
    let lastSwitchTurn = 0;
    for (const turn of log) {
      if (turn.switches.some((s) => s.side === side)) lastSwitchTurn = turn.turnNumber;
    }
    for (const turn of log) {
      if (turn.turnNumber <= lastSwitchTurn) continue;
      const action = turn.actions.find((a) => a.actor === side);
      if (action) return action.move.id;
    }
    return null;
  }

  /**
   * 이번 턴 이 쪽이 발버둥을 자동으로 내야 하는지. PP 남은 기술이 하나도 없거나(hasUsableMove),
   * 구애류 도구로 특정 기술에 잠겼는데 그 기술의 PP가 0이 됐으면(다른 기술 PP가 남아 있어도
   * 잠금 때문에 못 씀) 발버둥이 나간다.
   */
  function isStruggling(side: Side): boolean {
    if (!battleState) return false;
    const fighter = battleState[side];
    if (!hasUsableMove(fighter)) return true;
    const locked = choiceLockedMoveId(side);
    if (locked !== null && (fighter.remainingPp[locked] ?? 0) <= 0) return true;
    // 이번 턴 실제로 고를 수 있는 기술이 하나도 없으면 발버둥(본가 규칙, 백로그 §7-5):
    //  - 앙코르로 변화기가 강제됐는데 도발/사슬묶기로 그 기술을 못 씀
    //  - 앙코르 강제 기술의 PP가 0
    //  - 도발 상태에서 지닌 기술이 전부 변화기
    const anySelectable = activeMoveIds(side).some((id) => {
      if (!id) return false;
      if ((fighter.remainingPp[id] ?? getMove(id)?.pp ?? 0) <= 0) return false;
      if (locked !== null && id !== locked) return false;
      return moveRestrictionMessage(side, id) === null;
    });
    return !anySelectable;
  }

  /**
   * 도발/사슬묶기/앙코르: 이 쪽이 지금 이 기술을 고르면 왜 안 되는지(있다면) 문구로 돌려준다.
   * 구애스카프(choiceLockedMoveId)와 달리 판정 엔진(battleSimulator)의 volatile 상태를 그대로
   * 읽는다 — 로그를 다시 훑을 필요 없이 battleState에 이미 반영돼있다.
   */
  function moveRestrictionMessage(side: Side, moveId: string): string | null {
    if (!battleState) return null;
    const fighter = battleState[side];
    const pokemonName = activePokemon(side)?.name ?? "포켓몬";
    if (fighter.volatile.active.taunt && getMove(moveId)?.category === "status") {
      return `${pokemonName}${eunNeun(pokemonName)} 도발에 걸려 변화기를 쓸 수 없다!`;
    }
    const disableEntry = fighter.volatile.active.disable;
    if (disableEntry && disableEntry.moveId === moveId) {
      const disabledName = getMove(moveId)?.name ?? "그 기술";
      return `${disabledName}${eunNeun(disabledName)} 사슬묶기에 걸려 쓸 수 없다!`;
    }
    const encoreEntry = fighter.volatile.active.encore;
    if (encoreEntry?.moveId && encoreEntry.moveId !== moveId) {
      const forcedName = getMove(encoreEntry.moveId)?.name ?? "그 기술";
      return `${pokemonName}${eunNeun(pokemonName)} 앙코르 때문에 ${forcedName}만 사용할 수 있다!`;
    }
    return null;
  }

  /** 이 편에서 포켓몬이 있고 기술이 1개 이상인 빌드 슬롯 인덱스(빌드 순서). 이게 곧 "선출 가능" 후보. */
  const buildableIndices = (side: Side): SlotIndex[] =>
    SLOT_INDICES.filter((i) => {
      const s = slotCtl(side, i).slot;
      return s !== null && s.moves.some((m) => m !== null);
    });

  /**
   * 포켓몬은 골랐는데 기술을 하나도 안 배정한 슬롯(§4-2). buildableIndices가 이런 슬롯을
   * "선출 가능" 후보에서 조용히 빼버려서, 배턴터치·유턴처럼 자체 교체를 하려는 기술이 예비가
   * 없는 것처럼 취급돼 아무 안내 없이 무산되는 문제로 이어졌다 — 대전 시작 시점에 미리 막아서
   * 애초에 그 상태로 대전에 들어가지 못하게 한다.
   */
  const movelessIndices = (side: Side): SlotIndex[] =>
    SLOT_INDICES.filter((i) => {
      const s = slotCtl(side, i).slot;
      return s !== null && s.moves.every((m) => m === null);
    });

  /**
   * movelessIndices가 하나라도 있으면 그 편 소속 포켓몬 이름만 모아 그 편 전용 경고 문구를
   * 만든다(양쪽을 한 줄로 합치지 않음 — 각자 파티 상단에 표시하려면 편별로 갈라져 있어야 함).
   */
  const movelessWarningFor = (side: Side): string | null => {
    const names = movelessIndices(side).map((i) => {
      const s = slotCtl(side, i).slot;
      return s ? (getPokemon(s.pokemonId)?.name ?? "포켓몬") : "포켓몬";
    });
    if (names.length === 0) return null;
    return `${names.join(", ")}에게 기술을 최소 1개 배정해야 대전을 시작할 수 있습니다.`;
  };

  /** 양쪽 중 어느 편이든 기술 없는 슬롯이 있으면 true — canProceed·VS 버튼 문구용 */
  const hasMovelessSlot = (["a", "b"] as const).some((side) => movelessIndices(side).length > 0);

  /** 이 편이 선출 화면에서 골라야 하는지 — 유효 빌드가 선출 인원을 초과하면 true */
  const needsSelection = (side: Side) => buildableIndices(side).length > BATTLE_SELECT_SIZE;

  /** 양쪽 다 유효 빌드가 1마리 이상이고, 기술 없는 슬롯이 하나도 없어야 다음 단계로 갈 수 있다 */
  const canProceed =
    !hasMovelessSlot && (["a", "b"] as const).every((side) => buildableIndices(side).length >= 1);

  /** 셋업 화면 VS 버튼이 무엇을 하는지 (선출 화면을 거치면 "다음 (선출)", 아니면 바로 "대전 시작") */
  const proceedLabel = needsSelection("a") || needsSelection("b") ? "다음 (선출)" : "대전 시작";

  /** 선출된 빌드 슬롯 인덱스 목록으로 배틀 상태를 만들고 대전을 시작한다 */
  function startBattleWith(sel: { a: SlotIndex[]; b: SlotIndex[] }) {
    const partyOf = (side: Side) =>
      sel[side].map((i) => slotCtl(side, i).slot).filter((s): s is PartySlot => s !== null);
    const aParty = partyOf("a");
    const bParty = partyOf("b");
    if (aParty.length < 1 || bParty.length < 1) return;
    const movesOf = (s: PartySlot) => s.moves.filter((id): id is string => id !== null).map((id) => getMove(id)!);
    const state = createBattleState({
      a: { slots: aParty, movesList: aParty.map(movesOf) },
      b: { slots: bParty, movesList: bParty.map(movesOf) },
    });
    setPartySlots({ a: aParty, b: bParty });
    setBattleState(state);
    setLog([]);
    setSelected({ a: null, b: null });
    setInputMode({ a: "move", b: "move" });
    setPendingForcedSwitch(null);
    setPendingPivot(null);
    setLockWarning(null);
    setSelecting(false);
    setMegaDeclared({ a: false, b: false });
  }

  /** 빌드 화면 "다음/대전 시작" — 양쪽 다 3마리 이하면 선출을 건너뛰고 바로 대전, 아니면 선출 화면으로 */
  function handleProceed() {
    if (!canProceed) return;
    const autoSel = (side: Side) =>
      needsSelection(side) ? [] : buildableIndices(side).slice(0, BATTLE_SELECT_SIZE);
    const sel = { a: autoSel("a"), b: autoSel("b") };
    if (!needsSelection("a") && !needsSelection("b")) {
      startBattleWith(sel);
    } else {
      setSelection(sel);
      setSelecting(true);
    }
  }

  /** 선출 화면에서 포켓몬 카드를 눌렀을 때 — 이미 골랐으면 해제(뒤 번호 자동 재정렬), 아니면 다음 번호로 추가 */
  function toggleSelection(side: Side, i: SlotIndex) {
    setSelection((prev) => {
      const cur = prev[side];
      const at = cur.indexOf(i);
      if (at >= 0) return { ...prev, [side]: cur.filter((x) => x !== i) };
      if (cur.length >= BATTLE_SELECT_SIZE) return prev;
      return { ...prev, [side]: [...cur, i] };
    });
  }

  /** 선출 화면 "대전 시작" 가능 여부 — 각 편이 정확히 min(빌드 수, 선출 인원)만큼 골랐는지 */
  const selectionComplete = (["a", "b"] as const).every(
    (side) => selection[side].length === Math.min(buildableIndices(side).length, BATTLE_SELECT_SIZE),
  );

  function resetToSetup() {
    setBattleState(null);
    setLog([]);
    setPartySlots({ a: [], b: [] });
    setSelected({ a: null, b: null });
    setInputMode({ a: "move", b: "move" });
    setPendingForcedSwitch(null);
    setPendingPivot(null);
    setLockWarning(null);
    setSelecting(false);
    setSelection({ a: [], b: [] });
    setMegaDeclared({ a: false, b: false });
  }

  /**
   * runTurn/resumeTurn의 결과를 UI에 반영한다(§7-2). 멈춘 결과(awaitingSelfSwitch)면 부분 결과를
   * 로그에 얹고 교체 대기 상태로, 최종 결과면 (부분 결과가 있었으면 그걸 대체하며) 완결 처리한다.
   */
  function applyTurnOutcome(
    outcome: ReturnType<typeof runTurn>,
    /** 직전에 부분 결과 카드를 로그에 올려둔 상태면 true — 대체(replace)한다 */
    replacingPartial: boolean,
  ) {
    setBattleState(outcome.nextState);
    if ("awaitingSelfSwitch" in outcome) {
      setLog((prev) =>
        replacingPartial ? [...prev.slice(0, -1), outcome.partialResult] : [...prev, outcome.partialResult],
      );
      setPendingPivot({
        ctx: outcome._ctx,
        side: outcome.awaitingSelfSwitch.side,
        passBaton: outcome.awaitingSelfSwitch.passBaton,
        emergencyExit: outcome.awaitingSelfSwitch.emergencyExit,
        ejectItemName: outcome.awaitingSelfSwitch.ejectItemName,
      });
      return;
    }
    setLog((prev) => (replacingPartial ? [...prev.slice(0, -1), outcome.result] : [...prev, outcome.result]));
    setPendingPivot(null);
    setPendingForcedSwitch(outcome.forcedSwitch ?? null);
    setSelected({ a: null, b: null });
    setInputMode({ a: "move", b: "move" });
    setMegaDeclared({ a: false, b: false });
  }

  /** 유턴류 자체 교체 선택 확정 — 고른 슬롯으로 교체하고 나머지 턴(상대 행동·턴 종료)을 이어간다. */
  function resolvePivot(toIndex: number) {
    if (!pendingPivot) return;
    applyTurnOutcome(resumeTurn(pendingPivot.ctx, toIndex), true);
  }

  /** 이 편에서 지금 교대로 내보낼 수 있는 슬롯(활성 아님 + 안 쓰러짐) */
  function switchableIndices(side: Side): number[] {
    const bs = battleSide(side);
    if (!bs) return [];
    return bs.party.map((f, i) => ({ f, i })).filter(({ f, i }) => i !== bs.activeIndex && f.currentHp > 0).map(({ i }) => i);
  }

  /** 강제 교체 확정 — 기절한 활성 자리에 toIndex 슬롯을 세운다(턴은 소비 안 함) */
  function resolveForcedSwitch(side: Side, toIndex: number) {
    if (!battleState) return;
    const { nextState, entryMessages, outPokemonId, inPokemonId } = applySwitch(battleState, side, toIndex);
    setBattleState(nextState);
    // 스텔스록·압정 등장 데미지로(§6) 새로 나온 포켓몬이 그 자리에서 또 쓰러졌는지.
    const inSide = side === "a" ? nextState.sideA : nextState.sideB;
    const inFainted = nextState[side].currentHp <= 0;
    const hasReserve = inSide.party.some((f, i) => i !== inSide.activeIndex && f.currentHp > 0);
    // 강제 교체는 턴 밖 조작이라 별도 로그 카드로 남긴다(등장 파이프라인 문구까지 함께).
    const synthetic: TurnResult = {
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
        { side: side as FighterKey, fromIndex: -1, toIndex, outPokemonId, inPokemonId, entryMessages },
      ],
    };
    setLog((prev) => [...prev, synthetic]);
    // 새로 나온 포켓몬이 또 쓰러졌고 남은 슬롯이 있으면 강제 교체를 계속 요구한다.
    setPendingForcedSwitch((prev) => {
      const rest = { ...(prev ?? {}), [side]: inFainted && hasReserve ? true : undefined };
      return rest.a || rest.b ? rest : null;
    });
  }

  function playTurn() {
    if (!battleState || pendingForcedSwitch || pendingPivot) return;
    setLockWarning(null);
    // PP 남은 기술이 없거나(4개 다 0), 구애류 도구로 잠긴 기술의 PP가 0이면 선택 없이 발버둥.
    const struggling = { a: isStruggling("a"), b: isStruggling("b") };
    // 공중날기 등 차지 기술 2턴째는 준비해둔 기술이 선택 여부와 무관하게 자동으로 나간다.
    const charging = {
      a: battleState.a.chargingMoveId !== undefined,
      b: battleState.b.chargingMoveId !== undefined,
    };
    const isSwitch = (side: Side) => selected[side]?.kind === "switch";
    // 교체를 고른 쪽은 발버둥/차지와 무관하게 교체가 우선. 그 외엔 선택(또는 발버둥/차지)이 있어야 진행.
    for (const side of ["a", "b"] as const) {
      if (!isSwitch(side) && !struggling[side] && !charging[side] && !selected[side]) return;
    }

    // 구애스카프·도발/사슬묶기/앙코르 확인 — 기술을 고른 쪽만. 교체·발버둥·차지는 대상 아님.
    for (const side of ["a", "b"] as const) {
      if (isSwitch(side) || struggling[side] || charging[side]) continue;
      const chosen = selected[side]?.kind === "move" ? selected[side]!.moveId : null;
      if (!chosen) continue;
      const locked = choiceLockedMoveId(side);
      if (locked && chosen !== locked) {
        const lockedMoveName = getMove(locked)?.name ?? "그 기술";
        const pokemonName = activePokemon(side)?.name ?? "포켓몬";
        setLockWarning(`${pokemonName}${eunNeun(pokemonName)} 구애스카프 때문에 ${lockedMoveName}만 쓸 수 있다!`);
        return;
      }
      const restriction = moveRestrictionMessage(side, chosen);
      if (restriction) {
        setLockWarning(restriction);
        return;
      }
    }

    const actionFor = (side: Side): TurnAction | null => {
      const sel = selected[side];
      if (sel?.kind === "switch") return { kind: "switch", toIndex: sel.toIndex };
      const mega = megaDeclared[side] || undefined; // 메가진화는 기술 행동에만 실린다
      if (struggling[side]) return { kind: "move", move: STRUGGLE_MOVE, mega };
      if (charging[side]) {
        const m = getMove(battleState[side].chargingMoveId!);
        return m ? { kind: "move", move: m, mega } : null;
      }
      const m = sel?.kind === "move" ? getMove(sel.moveId) : undefined;
      if (!m) return null;
      return { kind: "move", move: m, ...(mega ? { mega } : {}) };
    };
    const actionA = actionFor("a");
    const actionB = actionFor("b");
    if (!actionA || !actionB) return;

    applyTurnOutcome(runTurn(battleState, actionA, actionB), false);
  }

  const winner = log.at(-1)?.winner;

  // 대전이 끝날 때마다 그 시점의 로그를 배틀비디오로 저장한다(§6). winner가 undefined→값으로
  // 바뀌는 시점에만 한 번 실행되고, 새 대전을 시작하면(setLog([])) winner가 다시 undefined로
  // 돌아가 다음 대전 종료 때 또 한 번만 저장된다.
  useEffect(() => {
    if (!winner || !battleState) return;
    // 선출된 3마리 전원의 이름을 그대로 나열한다(사용자 확정 — 활성 1마리가 아니라 선출 전체).
    const teamLabel = (side: Side) =>
      partySlots[side].map((s) => getPokemon(s.pokemonId)?.name ?? s.pokemonId).join(", ");
    battleVideos.addVideo({
      labelA: teamLabel("a"),
      labelB: teamLabel("b"),
      winner,
      log,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winner]);

  return (
    <section className="battle-log-page">
      <header className="battle-log-header">
        <div>
          <h2>배틀타워</h2>
          <p>실전 배틀 시뮬레이션</p>
        </div>
        <button
          type="button"
          className="battle-video-toggle"
          onClick={() => setBattleVideoView("list")}
        >
          배틀비디오{battleVideos.videos.length > 0 && ` (${battleVideos.videos.length})`}
        </button>
      </header>

      {!battleState && !selecting && (
        <BattleSetupScreen
          setup={setup}
          hasPartyPresets={partyPresets.presets.length > 0}
          hasSlotPresets={slotPresets.presets.length > 0}
          movelessWarningFor={movelessWarningFor}
          onSaveSlotAsSample={handleSaveSlotAsSample}
          onOpenPicker={setPicker}
          canProceed={canProceed}
          proceedLabel={proceedLabel}
          hasMovelessSlot={hasMovelessSlot}
          onProceed={handleProceed}
        />
      )}

      {!battleState && selecting && (
        <BattleSelectScreen
          selection={selection}
          buildableIndices={buildableIndices}
          needsSelection={needsSelection}
          pokemonAt={pokemonAt}
          slotAt={(side, i) => slotCtl(side, i).slot}
          onToggleSelection={toggleSelection}
          onBack={() => setSelecting(false)}
          selectionComplete={selectionComplete}
          onStartBattle={() => startBattleWith(selection)}
        />
      )}

      {battleState && (
        <BattleBoard
          battleState={battleState}
          winner={winner}
          selected={selected}
          setSelected={setSelected}
          inputMode={inputMode}
          setInputMode={setInputMode}
          megaDeclared={megaDeclared}
          setMegaDeclared={setMegaDeclared}
          pendingForcedSwitch={pendingForcedSwitch}
          pendingPivot={pendingPivot}
          lockWarning={lockWarning}
          setLockWarning={setLockWarning}
          log={log}
          battleBoardBackground={battleBoardBackground}
          fighterLabel={fighterLabel}
          activeMoveIds={activeMoveIds}
          choiceLockedMoveId={choiceLockedMoveId}
          battleSide={battleSide}
          switchableIndices={switchableIndices}
          resolveForcedSwitch={resolveForcedSwitch}
          resolvePivot={resolvePivot}
          isStruggling={isStruggling}
          moveRestrictionMessage={moveRestrictionMessage}
          playTurn={playTurn}
          resetToSetup={resetToSetup}
        />
      )}

      {picker?.kind === "pokemon" && (
        <PokemonPickerModal
          onClose={() => setPicker(null)}
          usedPokemonIds={sideCtls(picker.side)
            .filter((_, i) => i !== picker.slotIndex)
            .map((ctl) => ctl.slot?.pokemonId)
            .filter((id): id is string => id !== undefined)}
          onSelect={(pokemonId) => {
            slotCtl(picker.side, picker.slotIndex).setPokemon(pokemonId);
            setPicker(null);
          }}
        />
      )}

      {picker?.kind === "ability" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          const pokemon = pokemonAt(picker.side, picker.slotIndex);
          const slot = ctl.slot;
          if (!pokemon || !slot) return null;
          return (
            <AbilityPickerModal
              pokemon={pokemon}
              slot={slot}
              currentAbilityId={slot.ability}
              onClose={() => setPicker(null)}
              onSelect={(abilityId) => {
                ctl.setAbility(abilityId);
                setPicker(null);
              }}
              onClear={() => {
                ctl.setAbility(null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "item" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          const pokemon = pokemonAt(picker.side, picker.slotIndex);
          if (!pokemon) return null;
          return (
            <ItemPickerModal
              pokemon={pokemon}
              currentItemId={ctl.slot?.item ?? null}
              onClose={() => setPicker(null)}
              onSelect={(itemId) => {
                ctl.setItem(itemId);
                setPicker(null);
              }}
              onClear={() => {
                ctl.setItem(null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "nature" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          return (
            <NaturePickerModal
              currentNatureId={ctl.slot?.nature ?? null}
              onClose={() => setPicker(null)}
              onSelect={(natureId) => {
                ctl.setNature(natureId);
                setPicker(null);
              }}
              onClear={() => {
                ctl.setNature(null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "points" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          const pokemon = pokemonAt(picker.side, picker.slotIndex);
          if (!pokemon || !ctl.slot) return null;
          const form = getEffectiveForm(pokemon, ctl.slot);
          return (
            <PointsEditorModal
              pokemonName={pokemon.name}
              baseStats={form.baseStats}
              points={ctl.slot.points}
              natureId={ctl.slot.nature}
              onClose={() => setPicker(null)}
              onChange={(stat, value) => ctl.setPoint(stat, value)}
              onStep={(stat, delta) => ctl.stepPoint(stat, delta)}
            />
          );
        })()}

      {picker?.kind === "cosmeticForm" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          const pokemon = pokemonAt(picker.side, picker.slotIndex);
          if (!pokemon?.cosmeticForms || !ctl.slot) return null;
          return (
            <CosmeticFormPickerModal
              pokemonName={pokemon.name}
              forms={pokemon.cosmeticForms}
              currentFormId={ctl.slot.cosmeticForm ?? null}
              onClose={() => setPicker(null)}
              onSelect={(formId) => {
                ctl.setCosmeticForm(formId);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "move" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          const pokemon = pokemonAt(picker.side, picker.slotIndex);
          if (!pokemon || !ctl.slot) return null;
          const moveIndex = picker.moveIndex;
          return (
            <MovePickerModal
              pokemon={pokemon}
              formVariant={ctl.slot.formVariant}
              currentMoveIds={ctl.slot.moves}
              onClose={() => setPicker(null)}
              onSelect={(moveId) => {
                ctl.setMove(moveIndex, moveId);
                setPicker(null);
              }}
              onClear={() => {
                ctl.setMove(moveIndex, null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "slotPresets" &&
        (() => {
          const ctl = slotCtl(picker.side, picker.slotIndex);
          return (
            <SlotPresetsModal
              presets={slotPresets.presets}
              slotIsFilled={ctl.slot !== null}
              usedPokemonIds={sideCtls(picker.side)
                .filter((_, i) => i !== picker.slotIndex)
                .map((c) => c.slot?.pokemonId)
                .filter((id): id is string => id !== undefined)}
              onClose={() => setPicker(null)}
              onLoad={(preset) => ctl.loadSlot(preset.slot)}
              onRename={slotPresets.renamePreset}
              onDelete={slotPresets.deletePreset}
            />
          );
        })()}

      {picker?.kind === "loadParty" &&
        (() => {
          const side = picker.side;
          return (
            <PartyPresetsModal
              presets={partyPresets.presets}
              loadOnly
              loadTargetLabel={`${side === "a" ? "내 파티" : "상대 파티"} 빌드`}
              onClose={() => setPicker(null)}
              onLoad={(preset) => setup.loadSide(side, preset.slots)}
            />
          );
        })()}

      {battleVideoView === "list" && (
        <BattleVideoListModal
          videos={battleVideos.videos}
          onClose={() => setBattleVideoView(null)}
          onView={(video) => setBattleVideoView(video)}
          onDelete={battleVideos.deleteVideo}
        />
      )}

      {battleVideoView && battleVideoView !== "list" && (
        <Modal
          title={`${battleVideoView.labelA} VS ${battleVideoView.labelB}`}
          onClose={() => setBattleVideoView(null)}
        >
          {/* 배틀비디오는 그 시점의 텍스트 로그만 그대로 보여준다 — 포켓몬 UI(스프라이트·게이지)는 없음(§6) */}
          <BattleTurnLog log={battleVideoView.log} />
        </Modal>
      )}
    </section>
  );
}
