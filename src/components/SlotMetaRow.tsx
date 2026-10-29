import type { PartySlot } from "../types/party";
import type { Pokemon } from "../types/pokemon";
import { getAbility, getItem, getNature } from "../lib/data";
import { getEffectiveForm, getEffectiveGender, genderLabel, resolveCosmeticForm, COSMETIC_FORM_CYCLE_MAX } from "../lib/pokemonForm";
import { computeRealStats, totalAbilityPoints } from "../lib/statCalculator";
import { computeBulkPower } from "../lib/battlePower";

interface SlotMetaRowProps {
  slot: PartySlot;
  pokemon: Pokemon;
  onPickAbility: () => void;
  onPickItem: () => void;
  onPickNature: () => void;
  onPickPoints: () => void;
  onToggleGender: () => void;
  onCycleSizeForm: () => void;
  onCycleFormVariant: () => void;
  onCycleCosmeticForm: () => void;
  onPickCosmeticForm: () => void;
}

/** 파티 편성 카드(PartySlotCard)와 대전 셋업 카드(BattleSetupCard)가 같이 쓰는 특성·도구·성격·포인트·성별·모습 알약 줄 */
export function SlotMetaRow({ slot, pokemon, onPickAbility, onPickItem, onPickNature, onPickPoints, onToggleGender, onCycleSizeForm, onCycleFormVariant, onCycleCosmeticForm, onPickCosmeticForm }: SlotMetaRowProps) {
  return (
      <div className="party-slot-meta">
        <button type="button" className="party-meta-pip tap-target" onClick={onPickAbility}>
          <span className="party-meta-label">특성</span>
          <span className="party-meta-value">
            {slot.ability ? getAbility(slot.ability)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="party-meta-pip tap-target" onClick={onPickItem}>
          <span className="party-meta-label">도구</span>
          <span className="party-meta-value">
            {slot.item ? getItem(slot.item)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="party-meta-pip tap-target" onClick={onPickNature}>
          <span className="party-meta-label">성격</span>
          <span className="party-meta-value">
            {slot.nature ? getNature(slot.nature)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="party-meta-pip tap-target" onClick={onPickPoints}>
          <span className="party-meta-label">포인트</span>
          <span className="party-meta-value">{totalAbilityPoints(slot.points)} / 66</span>
        </button>
        {/* 종족 성별이 양성 다 가능("both")할 때만 노출 — 단일성별/무성별 종은 고를 게 없어 아예 숨긴다.
            에써르류(formVariantByGender)는 이 핍이 formVariant(=폼)까지 토글하며, 아래 "모습" 핍은 숨긴다. */}
        {pokemon.genderCategory === "both" && (
          <button type="button" className="party-meta-pip tap-target" onClick={onToggleGender}>
            <span className="party-meta-label">성별</span>
            <span className="party-meta-value">{genderLabel(getEffectiveGender(pokemon, slot) ?? "male")}</span>
          </button>
        )}
        {/* 펌킨인 계열 크기 변종 — sizeForms가 있는 종만 노출. 클릭하면 다음 크기로 순환 */}
        {pokemon.sizeForms && (
          <button type="button" className="party-meta-pip tap-target" onClick={onCycleSizeForm}>
            <span className="party-meta-label">크기</span>
            <span className="party-meta-value">
              {(() => {
                const forms = pokemon.sizeForms;
                const currentId = slot.sizeForm ?? forms.find((f) => f.standard)?.id ?? forms[0].id;
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
                const currentId = slot.formVariant ?? forms.find((f) => f.standard)?.id ?? forms[0].id;
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
              {resolveCosmeticForm(pokemon, slot)?.label ?? pokemon.cosmeticForms[0].label}
            </span>
          </button>
        )}
      </div>
  );
}

/** 물리·특수 내구 수치 줄 — 실능치에서 바로 계산한다 */
export function SlotBulkRow({ slot, pokemon, ignoreMega }: { slot: PartySlot; pokemon: Pokemon; ignoreMega?: boolean }) {
  const form = getEffectiveForm(pokemon, slot, { ignoreMega });
  const realStats = computeRealStats(form.baseStats, slot.points, slot.nature);
  const bulkPhysical = computeBulkPower(realStats, "physical");
  const bulkSpecial = computeBulkPower(realStats, "special");
  return (
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
  );
}
