import type { DragEvent } from "react";
import { useLongPressDrag } from "../hooks/useLongPressDrag";
import { useCardMotion } from "../hooks/usePop";
import type { PartySlot } from "../types/party";
import { getPokemon } from "../lib/data";
import { getEffectiveForm, getEffectiveGender, megaBadgeLabel } from "../lib/pokemonForm";
import { TypeBadge } from "./TypeBadge";
import { PokemonAvatarWithItem } from "./PokemonAvatarWithItem";
import { SlotMetaRow, SlotBulkRow } from "./SlotMetaRow";
import { MovePip } from "./MovePip";
import "./PartySlotCard.css";

interface PartySlotCardProps {
  index: number;
  slot: PartySlot | null;
  onPickPokemon: () => void;
  onClearPokemon: () => void;
  onPickMove: (moveIndex: 0 | 1 | 2 | 3) => void;
  /** 같은 슬롯 안에서 기술 칸 `from`과 `to`의 자리를 맞바꾼다(길게 눌러 끌기·드래그) */
  onSwapMoves: (from: number, to: number) => void;
  onPickAbility: () => void;
  onPickItem: () => void;
  onPickNature: () => void;
  onPickPoints: () => void;
  onToggleGender: () => void;
  /** 펌킨인 계열 크기 변종을 다음 크기로 순환 */
  onCycleSizeForm: () => void;
  /** 루가루암 계열 폼 변종을 다음 폼으로 순환 */
  onCycleFormVariant: () => void;
  /** 마휘핑 계열 겉모습을 다음 모습으로 순환(옵션 ≤4일 때) */
  onCycleCosmeticForm: () => void;
  /** 마휘핑 계열 겉모습을 리스트 모달로 고르기(옵션 >4일 때) */
  onPickCosmeticForm: () => void;
  /** 저장된 샘플(빌드)이 하나라도 있는지 — Phase 6 §1-3, 없으면 버튼 자체를 숨긴다 */
  hasSamples: boolean;
  /** 이 슬롯을 이름 붙여 샘플로 저장 */
  onSaveAsSample: () => void;
  /** 저장된 샘플 목록에서 이 슬롯에 불러올 것을 고르는 모달 열기 */
  onOpenSamplePicker: () => void;
  /** 지금 이 슬롯을 드래그해서 잡고 있는 중이면 true(§3 D&D) — 드는 카드 자체를 옅게 표시 */
  isDragging: boolean;
  /** 잡고 있는 다른 슬롯이 지금 이 슬롯 위에 올라와 있으면 true — 놓을 자리 하이라이트 */
  isDragOver: boolean;
  onDragStart: () => void;
  /** 이 슬롯 위로 드래그 중인 카드가 지나갈 때(dragover) */
  onDragOverSlot: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  /** 터치 길게 눌러 끌기로 다른 슬롯 위에서 손가락을 뗐을 때 — 받는 슬롯 번호(0부터) */
  onTouchReorder: (toIndex: number) => void;
  /** 파티 프리셋을 불러올 때마다 바뀌는 값 — 바뀌면 채워진 카드가 다시 튕긴다(8.1 U7) */
  reloadKey: number;
}

export function PartySlotCard({
  index,
  slot,
  onPickPokemon,
  onClearPokemon,
  onPickMove,
  onSwapMoves,
  onPickAbility,
  onPickItem,
  onPickNature,
  onPickPoints,
  onToggleGender,
  onCycleSizeForm,
  onCycleFormVariant,
  onCycleCosmeticForm,
  onPickCosmeticForm,
  hasSamples,
  onSaveAsSample,
  onOpenSamplePicker,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOverSlot,
  onDrop,
  onDragEnd,
  onTouchReorder,
  reloadKey,
}: PartySlotCardProps) {
  const pokemon = slot ? getPokemon(slot.pokemonId) : undefined;
  // 터치·펜(3.4 U1-b 후속): 카드를 길게 눌러 다른 슬롯 위에서 떼면 자리가 바뀐다(마우스 드래그는 그대로)
  // 6.5 M1 D — 포켓몬이 바뀌어 카드가 채워지면 카드가 튕겨 자리를 잡는다(비울 때는 없음)
  const [cardRef, cardMotion] = useCardMotion(slot?.pokemonId ?? null, onClearPokemon, "", reloadKey);
  const touch = useLongPressDrag(
    true,
    (x, y) => {
      const t = document.elementFromPoint(x, y)?.closest("[data-party-slot]") ?? null;
      return t && t.getAttribute("data-party-slot") !== String(index) ? t : null;
    },
    (t) => onTouchReorder(Number(t.getAttribute("data-party-slot"))),
  );

  // 카드 전체를 드래그 소스 겸 드롭 타겟으로 쓴다(§3) — 별도 손잡이 없이 카드를 그대로 잡아 옮긴다.
  const dragHandlers = {
    ...touch.touchProps,
    onAnimationEnd: cardMotion.onAnimationEnd,
    "data-party-slot": index,
    draggable: !touch.coarse,
    onDragStart: (e: DragEvent) => {
      if (touch.isTouch()) e.preventDefault();
      else onDragStart();
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      onDragOverSlot();
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      onDrop();
    },
    onDragEnd,
  };
  const dragStateClass = `${isDragging || touch.dragging ? " is-dragging" : ""}${isDragOver ? " is-drag-over" : ""}${cardMotion.motionClass}`;

  if (!pokemon) {
    return (
      <div className={`party-slot party-slot-empty${dragStateClass}`} ref={cardRef} {...dragHandlers}>
        <span className="party-slot-num">{index + 1}</span>
        <button type="button" className="party-slot-empty-main" onClick={onPickPokemon}>
          <span className="party-slot-plus" aria-hidden="true">
            +
          </span>
          <span className="party-slot-empty-label">포켓몬 선택</span>
        </button>
        {hasSamples && (
          <button type="button" className="party-slot-sample-link tap-target" onClick={onOpenSamplePicker}>
            저장된 샘플에서 불러오기
          </button>
        )}
      </div>
    );
  }

  const form = getEffectiveForm(pokemon, slot!);
  // 파티 빌더는 랭크 개념이 없으니 0랭크 기준 내구력만 참고용으로 보여준다

  return (
    <div className={`party-slot party-slot-filled${dragStateClass}`} ref={cardRef} {...dragHandlers}>
      <span className="party-slot-num">{index + 1}</span>
      <button
        type="button"
        className="party-slot-save-sample"
        onClick={onSaveAsSample}
        aria-label="이 빌드를 샘플로 저장"
        title="이 빌드를 샘플로 저장"
      >
        💾
      </button>
      <button type="button" className="party-slot-clear" onClick={cardMotion.clear} aria-label="슬롯 비우기">
        ✕
      </button>

      <button type="button" className="party-slot-main" onClick={onPickPokemon}>
        <PokemonAvatarWithItem
          pokemon={pokemon}
          size={36}
          radius={10}
          gradientTypes={form.types}
          avatarClassName="party-slot-avatar"
          itemId={slot!.item}
          form={{
            gender: getEffectiveGender(pokemon, slot!),
            cosmeticForm: slot!.cosmeticForm,
            formVariant: slot!.formVariant,
            sizeForm: slot!.sizeForm,
            activeMegaForm: slot!.activeMegaForm,
            item: slot!.item,
          }}
        />
        <span className="party-slot-info">
          <span className="party-slot-name">
            {pokemon.name}
            {form.mega && <span className="party-slot-mega-tag">{megaBadgeLabel(form.mega)}</span>}
          </span>
          <span className="party-slot-types">
            {form.types.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
          </span>
        </span>
      </button>

      <div className="party-slot-moves">
        {slot!.moves.map((moveId, i) => (
          <MovePip
            key={i}
            group={String(index)}
            moveIndex={i}
            moveId={moveId}
            onPick={() => onPickMove(i as 0 | 1 | 2 | 3)}
            onSwap={onSwapMoves}
          />
        ))}
      </div>

      <SlotMetaRow slot={slot!} pokemon={pokemon} onPickAbility={onPickAbility} onPickItem={onPickItem} onPickNature={onPickNature} onPickPoints={onPickPoints} onToggleGender={onToggleGender} onCycleSizeForm={onCycleSizeForm} onCycleFormVariant={onCycleFormVariant} onCycleCosmeticForm={onCycleCosmeticForm} onPickCosmeticForm={onPickCosmeticForm} />

      <SlotBulkRow slot={slot!} pokemon={pokemon} />
    </div>
  );
}
