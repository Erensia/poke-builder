import { Fragment } from "react";
import { BattleSetupCard } from "../BattleSetupCard";
import { InfoTooltip } from "../InfoTooltip";
import { useBattleSetup } from "../../hooks/useBattleSetup";
import { SLOT_INDICES, type PickerState, type Side, type SlotIndex } from "./shared";
import { useClashMotion, useExpandedSlots, useSlotDnd } from "./useSetupBoardUi";

/** 제목 옆 ⓘ 설명 — 버튼 줄이 꽉 차서 버튼마다 ⓘ를 둘 수 없고, 터치에는 호버가 없어 버튼별 툴팁 대신 한 곳에 모은다(랜덤 구축은 저장 샘플이 있을 때만 보인다) */
const loadButtonsHelp = (side: Side, hasSlotPresets: boolean) => {
  const who = side === "a" ? "내 파티" : "상대 파티";
  return (
    `무작위 샘플: ${who}를 기본 제공 샘플 파티 중 무작위 하나로 바꿉니다.` +
    (hasSlotPresets
      ? `\n랜덤 구축: 저장해 둔 포켓몬 샘플에서 6마리를 무작위로 뽑아 ${who}를 만듭니다(중복 포켓몬·도구 없음, 메가진화 포켓몬은 최대 2마리). 저장 샘플이 모자라면 기본 제공 샘플로 채웁니다.`
      : "")
  );
};

/**
 * 빌드(6슬롯) 화면 — 양쪽 파티를 편성하는 단계(§16). `BattleLogPage`가 쥔 `setup`(훅
 * 반환값 그대로)과 피커 열기·샘플 저장·다음 단계 진행 콜백만 받는 presentational 컴포넌트.
 */
export function BattleSetupScreen({
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
  aiOpponent,
  onToggleAiOpponent,
  aiMemoryBattles,
  onOpenAiMemory,
  onLoadRandomSample,
  onLoadRandomSlotParty,
  opponentLocked,
  lockedNote,
  proceedBlockedReason,
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
  aiOpponent: boolean;
  onToggleAiOpponent: (on: boolean) => void;
  /** AI 학습 누적 대전 수(ver.2.0 1-C) — "AI가 조작" 옆 칩 */
  aiMemoryBattles: number;
  onOpenAiMemory: () => void;
  /** 기본 제공 샘플 파티 중 하나를 무작위로 이 진영에 불러온다(ver.2.1 B) */
  onLoadRandomSample: (side: Side) => void;
  /** 저장해 둔 슬롯 프리셋에서 마리 단위로 6마리를 뽑아 랜덤 파티로 불러온다(2.2 B6) */
  onLoadRandomSlotParty: (side: Side) => void;
  /** 배틀 프런티어 중에는 상대 편을 수동으로 바꿀 수 없다 */
  opponentLocked: boolean;
  /** 상대 편이 잠겼을 때 안내 문구(없으면 표시하지 않는다) */
  lockedNote: string | null;
  /** 대전 시작이 막혔을 때 파티 문제 대신 보여 줄 이유(없으면 기본 안내) */
  proceedBlockedReason?: string;
}) {
  const sideCtls = (side: Side) => (side === "a" ? setup.a : setup.b);
  const slotCtl = (side: Side, i: SlotIndex) => sideCtls(side)[i];

  // 슬롯 드래그 순서 변경·압축 뷰·랭크 시작 충돌 모션은 useSetupBoardUi.ts의 훅이다(호출 순서는 그대로)
  const dnd = useSlotDnd(setup.reorderSlots);
  const expand = useExpandedSlots();

  // VS 아래 안내는 "이유가 분명하고 사용자가 고칠 수 있는 것"만 보인다(랭크 시작 전·기술 없는 슬롯). 빈 슬롯 때문에 막힌 것은 슬롯이 비어 보여서 따로 말하지 않는다.
  const hintText = proceedBlockedReason ?? (hasMovelessSlot ? "기술을 배정하지 않은 포켓몬이 있습니다" : null);
  const showHint = !canProceed && hintText !== null;
  const blockedReason = hintText ?? "양쪽 파티를 먼저 완성하세요"; // VS 버튼의 접근성 이름 전용(화면에는 보이지 않는다)

  const [columnRef, vsEl] = useClashMotion(canProceed, proceedBlockedReason);

  return (
    <div className="battle-setup-board">
      {(["a", "b"] as const).map((side) => (
        <Fragment key={side}>
          <div
            ref={columnRef(side === "a" ? 0 : 1)}
            className={`battle-setup-column${side === "b" && opponentLocked ? " is-locked" : ""}`}
            inert={side === "b" && opponentLocked}
          >
            {side === "b" && opponentLocked && lockedNote && <p className="battle-lock-warning">{lockedNote}</p>}
            <div className="battle-setup-actions">
              {hasPartyPresets && (
                <button
                  type="button"
                  className="battle-setup-load-party tap-target"
                  onClick={() => onOpenPicker({ kind: "loadParty", side })}
                >
                  파티 불러오기
                </button>
              )}
              <button
                type="button"
                className="battle-setup-load-party tap-target"
                onClick={() => onOpenPicker({ kind: "sampleParty", side })}
              >
                샘플 파티
              </button>
              <button
                type="button"
                className="battle-setup-load-party tap-target"
                onClick={() => onLoadRandomSample(side)}
              >
                무작위 샘플
              </button>
              {hasSlotPresets && (
                <button
                  type="button"
                  className="battle-setup-load-party tap-target"
                  onClick={() => onLoadRandomSlotParty(side)}
                >
                  랜덤 구축
                </button>
              )}
            </div>
            <div className="battle-setup-column-title">
              <InfoTooltip text={loadButtonsHelp(side, hasSlotPresets)}>{side === "a" ? "내 파티" : "상대 파티"}</InfoTooltip>{" "}
              <span className="battle-setup-column-hint">6마리까지 빌드 · 4마리 이상이면 3마리 선출</span>
              {side === "b" && (
                <label className="toggle-pill tap-target battle-ai-toggle">
                  <input
                    type="checkbox"
                    checked={aiOpponent}
                    onChange={(e) => onToggleAiOpponent(e.target.checked)}
                  />
                  <span>AI가 조작</span>
                </label>
              )}
              {side === "b" && aiOpponent && (
                <button type="button" className="battle-ai-memory-chip tap-target" onClick={onOpenAiMemory}>
                  🧠 AI 학습 {aiMemoryBattles}판
                </button>
              )}
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
                onSwapMoves={slotCtl(side, i).swapMoves}
                dragId={`${side}:${i}`}
                onTouchReorder={(id) => {
                  const [s, n] = id.split(":");
                  if (s === side) setup.reorderSlots(side, i, Number(n) as SlotIndex);
                }}
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
                expanded={expand.isExpanded(side, i)}
                onToggleExpand={() => expand.toggle(side, i)}
                isDragging={dnd.isDragging(side, i)}
                isDragOver={dnd.isDragOver(side, i)}
                concealBuild={side === "b" && opponentLocked}
                onDragStart={() => dnd.onDragStart(side, i)}
                onDragOverSlot={() => dnd.onDragOver(side, i)}
                onDrop={() => dnd.onDrop(side, i)}
                onDragEnd={dnd.onDragEnd}
              />
            ))}
          </div>
          {side === "a" && (
            <div className="battle-setup-center">
              <button
                ref={vsEl}
                type="button"
                className="battle-setup-vs"
                disabled={!canProceed}
                onClick={onProceed}
                aria-label={canProceed ? proceedLabel : blockedReason}
                title={canProceed ? proceedLabel : undefined}
              >
                VS
              </button>
              <div className={`battle-setup-vs-hint-box${showHint ? "" : " is-closed"}`} aria-hidden={!showHint}>
                <p className="battle-setup-vs-hint">{hintText}</p>
              </div>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
