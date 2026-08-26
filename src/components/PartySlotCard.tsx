import type { PartySlot } from "../types/party";
import { getPokemon, getMove, getAbility, getItem, getNature } from "../lib/data";
import { getEffectiveForm, getEffectiveAbilityId, genderLabel, megaBadgeLabel } from "../lib/pokemonForm";
import { computeRealStats, totalAbilityPoints } from "../lib/statCalculator";
import { computeBulkPower } from "../lib/battlePower";
import { TypeBadge } from "./TypeBadge";
import { TYPE_COLORS } from "../lib/typeColors";
import "./PartySlotCard.css";

interface PartySlotCardProps {
  index: number;
  slot: PartySlot | null;
  onPickPokemon: () => void;
  onClearPokemon: () => void;
  onPickMove: (moveIndex: 0 | 1 | 2 | 3) => void;
  onPickAbility: () => void;
  onPickItem: () => void;
  onPickNature: () => void;
  onPickPoints: () => void;
  onToggleGender: () => void;
  /** 저장된 샘플(빌드)이 하나라도 있는지 — Phase 6 §1-3, 없으면 버튼 자체를 숨긴다 */
  hasSamples: boolean;
  /** 이 슬롯을 이름 붙여 샘플로 저장 */
  onSaveAsSample: () => void;
  /** 저장된 샘플 목록에서 이 슬롯에 불러올 것을 고르는 모달 열기 */
  onOpenSamplePicker: () => void;
}

export function PartySlotCard({
  index,
  slot,
  onPickPokemon,
  onClearPokemon,
  onPickMove,
  onPickAbility,
  onPickItem,
  onPickNature,
  onPickPoints,
  onToggleGender,
  hasSamples,
  onSaveAsSample,
  onOpenSamplePicker,
}: PartySlotCardProps) {
  const pokemon = slot ? getPokemon(slot.pokemonId) : undefined;

  if (!pokemon) {
    return (
      <div className="party-slot party-slot-empty">
        <span className="party-slot-num">{index + 1}</span>
        <button type="button" className="party-slot-empty-main" onClick={onPickPokemon}>
          <span className="party-slot-plus" aria-hidden="true">
            +
          </span>
          <span className="party-slot-empty-label">포켓몬 선택</span>
        </button>
        {hasSamples && (
          <button type="button" className="party-slot-sample-link" onClick={onOpenSamplePicker}>
            저장된 샘플에서 불러오기
          </button>
        )}
      </div>
    );
  }

  const form = getEffectiveForm(pokemon, slot!);
  const avatarGradient = `linear-gradient(135deg, ${TYPE_COLORS[form.types[0]]}, ${
    TYPE_COLORS[form.types[1] ?? form.types[0]]
  })`;
  // 파티 빌더는 랭크 개념이 없으니 0랭크 기준 내구력만 참고용으로 보여준다
  const realStats = computeRealStats(form.baseStats, slot!.points, slot!.nature);
  const bulkPhysical = computeBulkPower(realStats, "physical");
  const bulkSpecial = computeBulkPower(realStats, "special");

  return (
    <div className="party-slot party-slot-filled">
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
        <span className="party-slot-avatar" style={{ background: avatarGradient }}>
          {pokemon.name.at(0)}
        </span>
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
        {slot!.moves.map((moveId, i) => {
          const move = moveId ? getMove(moveId) : undefined;
          const moveColor = move?.type ? TYPE_COLORS[move.type] : undefined;
          return (
            <button
              key={i}
              type="button"
              className={`party-move-pip${move ? " has-type" : " is-empty"}`}
              style={moveColor ? { background: moveColor } : undefined}
              onClick={() => onPickMove(i as 0 | 1 | 2 | 3)}
            >
              {move ? move.name : "＋"}
            </button>
          );
        })}
      </div>

      <div className="party-slot-meta">
        <button type="button" className="party-meta-pip" onClick={onPickAbility}>
          <span className="party-meta-label">특성</span>
          <span className="party-meta-value">
            {(() => {
              // 메가진화 중이면 slot.ability와 무관하게 항상 그 메가폼 고유 특성으로 고정된다
              // (getEffectiveAbilityId) — 표시도 실제 적용되는 값을 따라가야 유저가 고른 값과
              // 안 맞아 보이는 혼란이 없다.
              const effectiveAbilityId = getEffectiveAbilityId(form, slot!.ability);
              return effectiveAbilityId ? getAbility(effectiveAbilityId)?.name : "미지정";
            })()}
          </span>
        </button>
        <button type="button" className="party-meta-pip" onClick={onPickItem}>
          <span className="party-meta-label">도구</span>
          <span className="party-meta-value">
            {slot!.item ? getItem(slot!.item)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="party-meta-pip" onClick={onPickNature}>
          <span className="party-meta-label">성격</span>
          <span className="party-meta-value">
            {slot!.nature ? getNature(slot!.nature)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="party-meta-pip" onClick={onPickPoints}>
          <span className="party-meta-label">포인트</span>
          <span className="party-meta-value">{totalAbilityPoints(slot!.points)} / 66</span>
        </button>
        {/* 종족 성별이 양성 다 가능("both")할 때만 노출 — 단일성별/무성별 종은 고를 게 없어 아예 숨긴다 */}
        {pokemon.genderCategory === "both" && (
          <button type="button" className="party-meta-pip" onClick={onToggleGender}>
            <span className="party-meta-label">성별</span>
            <span className="party-meta-value">{genderLabel(slot!.gender ?? "male")}</span>
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
