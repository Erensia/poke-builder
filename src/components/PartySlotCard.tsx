import { useState, type DragEvent } from "react";
import { useLongPressDrag } from "../hooks/useLongPressDrag";
import type { PartySlot } from "../types/party";
import { getPokemon, getMove, getAbility, getItem, getNature } from "../lib/data";
import {
  getEffectiveForm,
  getEffectiveGender,
  genderLabel,
  megaBadgeLabel,
  resolveCosmeticForm,
  COSMETIC_FORM_CYCLE_MAX,
} from "../lib/pokemonForm";
import { computeRealStats, totalAbilityPoints } from "../lib/statCalculator";
import { computeBulkPower } from "../lib/battlePower";
import { TypeBadge } from "./TypeBadge";
import { PokemonAvatarWithItem } from "./PokemonAvatarWithItem";
import { TYPE_COLORS } from "../lib/typeColors";
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
}: PartySlotCardProps) {
  const pokemon = slot ? getPokemon(slot.pokemonId) : undefined;
  // 터치·펜(3.4 U1-b 후속): 카드를 길게 눌러 다른 슬롯 위에서 떼면 자리가 바뀐다(마우스 드래그는 그대로)
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
  const dragStateClass = `${isDragging || touch.dragging ? " is-dragging" : ""}${isDragOver ? " is-drag-over" : ""}`;

  if (!pokemon) {
    return (
      <div className={`party-slot party-slot-empty${dragStateClass}`} {...dragHandlers}>
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
  const realStats = computeRealStats(form.baseStats, slot!.points, slot!.nature);
  const bulkPhysical = computeBulkPower(realStats, "physical");
  const bulkSpecial = computeBulkPower(realStats, "special");

  return (
    <div className={`party-slot party-slot-filled${dragStateClass}`} {...dragHandlers}>
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
      <button type="button" className="party-slot-clear" onClick={onClearPokemon} aria-label="슬롯 비우기">
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
            slotIndex={index}
            moveIndex={i}
            moveId={moveId}
            onPick={() => onPickMove(i as 0 | 1 | 2 | 3)}
            onSwap={onSwapMoves}
          />
        ))}
      </div>

      <div className="party-slot-meta">
        <button type="button" className="party-meta-pip tap-target" onClick={onPickAbility}>
          <span className="party-meta-label">특성</span>
          <span className="party-meta-value">
            {slot!.ability ? getAbility(slot!.ability)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="party-meta-pip tap-target" onClick={onPickItem}>
          <span className="party-meta-label">도구</span>
          <span className="party-meta-value">
            {slot!.item ? getItem(slot!.item)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="party-meta-pip tap-target" onClick={onPickNature}>
          <span className="party-meta-label">성격</span>
          <span className="party-meta-value">
            {slot!.nature ? getNature(slot!.nature)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="party-meta-pip tap-target" onClick={onPickPoints}>
          <span className="party-meta-label">포인트</span>
          <span className="party-meta-value">{totalAbilityPoints(slot!.points)} / 66</span>
        </button>
        {/* 종족 성별이 양성 다 가능("both")할 때만 노출 — 단일성별/무성별 종은 고를 게 없어 아예 숨긴다.
            에써르류(formVariantByGender)는 이 핍이 formVariant(=폼)까지 토글하며, 아래 "모습" 핍은 숨긴다. */}
        {pokemon.genderCategory === "both" && (
          <button type="button" className="party-meta-pip tap-target" onClick={onToggleGender}>
            <span className="party-meta-label">성별</span>
            <span className="party-meta-value">{genderLabel(getEffectiveGender(pokemon, slot!) ?? "male")}</span>
          </button>
        )}
        {/* 펌킨인 계열 크기 변종 — sizeForms가 있는 종만 노출. 클릭하면 다음 크기로 순환 */}
        {pokemon.sizeForms && (
          <button type="button" className="party-meta-pip tap-target" onClick={onCycleSizeForm}>
            <span className="party-meta-label">크기</span>
            <span className="party-meta-value">
              {(() => {
                const forms = pokemon.sizeForms;
                const currentId = slot!.sizeForm ?? forms.find((f) => f.standard)?.id ?? forms[0].id;
                return forms.find((f) => f.id === currentId)?.label ?? forms[0].label;
              })()}
            </span>
          </button>
        )}
        {/* 루가루암 계열 폼 변종 — formVariants가 있는 종만 노출. 클릭하면 다음 폼으로 순환.
            에써르류(formVariantByGender)는 위 "성별" 핍이 이 역할을 하므로 숨긴다. */}
        {pokemon.formVariants && !pokemon.formVariantByGender && (
          <button type="button" className="party-meta-pip tap-target" onClick={onCycleFormVariant}>
            <span className="party-meta-label">모습</span>
            <span className="party-meta-value">
              {(() => {
                const forms = pokemon.formVariants;
                const currentId = slot!.formVariant ?? forms.find((f) => f.standard)?.id ?? forms[0].id;
                return forms.find((f) => f.id === currentId)?.label ?? forms[0].label;
              })()}
            </span>
          </button>
        )}
        {/* 마휘핑 계열 겉모습(이미지만 갈림) — cosmeticForms가 있는 종만 노출. 옵션 ≤4면 클릭 순환,
            5개 이상이면 리스트 모달을 연다(비비용 등). */}
        {pokemon.cosmeticForms && (
          <button
            type="button"
            className="party-meta-pip tap-target"
            onClick={
              pokemon.cosmeticForms.length <= COSMETIC_FORM_CYCLE_MAX
                ? onCycleCosmeticForm
                : onPickCosmeticForm
            }
          >
            <span className="party-meta-label">모습</span>
            <span className="party-meta-value">
              {resolveCosmeticForm(pokemon, slot!)?.label ?? pokemon.cosmeticForms[0].label}
            </span>
          </button>
        )}
      </div>

      <div className="party-slot-bulk">
        <div className="party-bulk-item">
          <span className="party-bulk-label">물리내구</span>
          <span className="party-bulk-value">{Math.round(bulkPhysical).toLocaleString()}</span>
        </div>
        <div className="party-bulk-item">
          <span className="party-bulk-label">특수내구</span>
          <span className="party-bulk-value">{Math.round(bulkSpecial).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

/** 지금 HTML5 드래그로 잡고 있는 기술 칸(3.5 M1) — dataTransfer는 dragover 중 읽을 수 없어 모듈 변수에 둔다 */
let draggedMovePip: { slot: number; move: number } | null = null;

interface MovePipProps {
  slotIndex: number;
  moveIndex: number;
  moveId: string | null;
  onPick: () => void;
  onSwap: (from: number, to: number) => void;
}

/**
 * 기술 칸 하나(3.5 M1) — 같은 슬롯 안의 다른 칸(빈 칸 포함)으로 끌어다 놓으면 자리가 바뀐다.
 * 마우스는 HTML5 드래그, 터치·펜은 길게 눌러 끌기(useLongPressDrag). 카드 전체의 슬롯 교체 드래그와 겹치지 않게
 * 칸에서 시작한 pointerdown·dragstart는 카드로 올리지 않는다.
 */
function MovePip({ slotIndex, moveIndex, moveId, onPick, onSwap }: MovePipProps) {
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);
  const move = moveId ? getMove(moveId) : undefined;
  const moveColor = move?.type ? TYPE_COLORS[move.type] : undefined;
  const pipKey = (m: number) => `${slotIndex}-${m}`;

  const touch = useLongPressDrag(
    !!moveId,
    (x, y) => {
      const t = document.elementFromPoint(x, y)?.closest("[data-move-pip]") ?? null;
      const key = t?.getAttribute("data-move-pip") ?? "";
      return key.startsWith(`${slotIndex}-`) && key !== pipKey(moveIndex) ? t : null;
    },
    (t) => onSwap(moveIndex, Number(t.getAttribute("data-move-pip")!.split("-")[1])),
  );
  const canDrop = () => draggedMovePip?.slot === slotIndex && draggedMovePip.move !== moveIndex;

  return (
    <button
      type="button"
      data-move-pip={pipKey(moveIndex)}
      className={`party-move-pip tap-target${move ? " has-type" : " is-empty"}${dragging || touch.dragging ? " is-dragging" : ""}${over ? " is-drag-over" : ""}`}
      style={moveColor ? { background: moveColor } : undefined}
      onClick={onPick}
      {...touch.touchProps}
      onPointerDown={(e) => {
        e.stopPropagation();
        touch.touchProps.onPointerDown(e);
      }}
      draggable={!!moveId && !touch.coarse}
      onDragStart={(e) => {
        e.stopPropagation();
        if (touch.isTouch()) return e.preventDefault();
        e.dataTransfer.setData("text/plain", "");
        draggedMovePip = { slot: slotIndex, move: moveIndex };
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!canDrop()) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!canDrop()) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onSwap(draggedMovePip!.move, moveIndex);
      }}
      onDragEnd={(e) => {
        e.stopPropagation();
        draggedMovePip = null;
        setDragging(false);
      }}
    >
      <span className="party-move-pip-text">{move ? move.name : "＋"}</span>
    </button>
  );
}
