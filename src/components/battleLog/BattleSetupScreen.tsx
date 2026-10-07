import { Fragment, useState } from "react";
import { BattleSetupCard } from "../BattleSetupCard";
import { useBattleSetup } from "../../hooks/useBattleSetup";
import { SLOT_INDICES, type PickerState, type Side, type SlotIndex } from "./shared";

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
          <div className={`battle-setup-column${side === "b" && opponentLocked ? " is-locked" : ""}`} inert={side === "b" && opponentLocked}>
            {side === "b" && opponentLocked && <p className="battle-lock-warning">배틀 프런티어 중에는 상대를 바꿀 수 없어요.</p>}
            <div className="battle-setup-actions">
              {hasPartyPresets && (
                <button
                  type="button"
                  className="battle-setup-load-party"
                  onClick={() => onOpenPicker({ kind: "loadParty", side })}
                >
                  파티 불러오기
                </button>
              )}
              <button
                type="button"
                className="battle-setup-load-party"
                onClick={() => onOpenPicker({ kind: "sampleParty", side })}
              >
                샘플 파티
              </button>
              <button
                type="button"
                className="battle-setup-load-party has-tip"
                onClick={() => onLoadRandomSample(side)}
                data-tip={`${side === "a" ? "내 파티" : "상대 파티"}를 기본 제공 샘플 파티 중 무작위 하나로 바꿉니다`}
              >
                무작위 샘플
              </button>
              {hasSlotPresets && (
                <button
                  type="button"
                  className="battle-setup-load-party has-tip"
                  onClick={() => onLoadRandomSlotParty(side)}
                  data-tip={`저장해 둔 포켓몬 샘플에서 6마리를 무작위로 뽑아 ${side === "a" ? "내 파티" : "상대 파티"}를 만듭니다(중복 포켓몬·도구 없음, 메가 2마리 이하). 저장 샘플이 모자라면 기본 제공 샘플로 채웁니다`}
                >
                  랜덤 구축
                </button>
              )}
            </div>
            <div className="battle-setup-column-title">
              {side === "a" ? "내 파티" : "상대 파티"}{" "}
              <span className="battle-setup-column-hint">6마리까지 빌드 · 4마리 이상이면 3마리 선출</span>
              {side === "b" && (
                <label className="battle-ai-toggle">
                  <input
                    type="checkbox"
                    checked={aiOpponent}
                    onChange={(e) => onToggleAiOpponent(e.target.checked)}
                  />
                  <span>AI가 조작</span>
                </label>
              )}
              {side === "b" && aiOpponent && (
                <button type="button" className="battle-ai-memory-chip" onClick={onOpenAiMemory}>
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
