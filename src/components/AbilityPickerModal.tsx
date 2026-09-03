import { Modal } from "./Modal";
import { getAbility } from "../lib/data";
import {
  getEffectiveForm,
  getEffectiveAbilityList,
  getEffectiveHiddenAbilityId,
  megaBadgeLabel,
  type FormSource,
  type GenderSource,
} from "../lib/pokemonForm";
import type { Pokemon } from "../types/pokemon";
import "./MovePickerModal.css";

interface AbilityPickerModalProps {
  pokemon: Pokemon;
  /** 메가진화 여부 판정용(item/activeMegaForm) + 성별(냐오닉스 성별별 숨겨진 특성). PartySlot·MatchupSlot 둘 다 만족한다 */
  slot: FormSource & GenderSource;
  currentAbilityId: string | null;
  onSelect: (abilityId: string) => void;
  onClear: () => void;
  onClose: () => void;
}

export function AbilityPickerModal({
  pokemon,
  slot,
  currentAbilityId,
  onSelect,
  onClear,
  onClose,
}: AbilityPickerModalProps) {
  // 메가진화 중이면 getEffectiveAbilityId가 slot.ability와 무관하게 항상 그 메가폼 고유 특성을
  // 쓴다(pokemonForm.ts) — 선택 UI를 그대로 보여주면 유저가 고른 값과 실제 적용되는 값이 달라
  // 보이는 버그가 생기므로, 이 경우엔 선택지 대신 고정 특성 안내만 보여준다.
  const form = getEffectiveForm(pokemon, slot);
  if (form.mega) {
    const fixedAbility = getAbility(form.mega.ability);
    return (
      <Modal title={`${pokemon.name} · 특성 선택`} onClose={onClose}>
        <p className="move-picker-locked-notice">
          {megaBadgeLabel(form.mega)} 진화 중에는 특성이 <strong>{fixedAbility?.name ?? form.mega.ability}</strong>
          (으)로 고정됩니다. 메가스톤을 해제하면 다시 특성을 고를 수 있어요.
        </p>
      </Modal>
    );
  }

  // 루가루암처럼 폼 변종이 있는 종은 그 폼의 abilities/hiddenAbility를 후보로 쓴다.
  // 냐오닉스처럼 숨겨진 특성이 성별로 갈리는 종은 슬롯 성별에 맞는 쪽 하나만 보여준다.
  const { abilities: normalAbilityIds } = getEffectiveAbilityList(pokemon, slot);
  const hiddenAbilityId = getEffectiveHiddenAbilityId(pokemon, slot);
  const candidates = [
    ...normalAbilityIds.map((id) => ({ id, hidden: false })),
    ...(hiddenAbilityId ? [{ id: hiddenAbilityId, hidden: true }] : []),
  ];

  return (
    <Modal title={`${pokemon.name} · 특성 선택`} onClose={onClose}>
      <button type="button" className="move-clear-btn" onClick={onClear}>
        특성 비우기
      </button>
      <ul className="move-picker-list">
        {candidates.map(({ id, hidden }) => {
          const ability = getAbility(id);
          if (!ability) return null;
          const active = id === currentAbilityId;
          return (
            <li key={id}>
              <button
                type="button"
                className={`move-picker-item${active ? " is-used" : ""}`}
                style={{ gridTemplateColumns: "1fr auto" }}
                onClick={() => onSelect(id)}
              >
                <span className="move-picker-name">{ability.name}</span>
                {hidden && <span className="move-picker-cat">숨겨진 특성</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
