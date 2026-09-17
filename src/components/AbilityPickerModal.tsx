import { Modal } from "./Modal";
import { getAbility } from "../lib/data";
import {
  getEffectiveForm,
  getEffectiveAbilityList,
  getEffectiveHiddenAbilityId,
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
  /**
   * 매치업 페이지 전용(ver.1.6) — 메가스톤을 지녔으면 후보 목록 맨 끝에 메가폼 고유 특성도
   * 하나 더 얹는다. 메가진화 전/후 결정력을 비교해보고 싶을 때 명시적으로 골라 넣으라는 뜻 —
   * 배틀 시뮬레이션·파티 샘플 화면은 실제 배틀처럼 메가진화를 선언하기 전까진 기본 특성만
   * 써야 해서 이 옵션을 안 켠다(예전엔 메가스톤만 들어도 무조건 메가 특성으로 고정해버려서
   * 기본 특성을 아예 못 고르던 버그가 있었다 — 이제 기본이 "고정 없음"이다).
   */
  includeMegaAbilityOption?: boolean;
}

export function AbilityPickerModal({
  pokemon,
  slot,
  currentAbilityId,
  onSelect,
  onClear,
  onClose,
  includeMegaAbilityOption,
}: AbilityPickerModalProps) {
  const form = getEffectiveForm(pokemon, slot);
  // 루가루암처럼 폼 변종이 있는 종은 그 폼의 abilities/hiddenAbility를 후보로 쓴다.
  // 냐오닉스처럼 숨겨진 특성이 성별로 갈리는 종은 슬롯 성별에 맞는 쪽 하나만 보여준다.
  const { abilities: normalAbilityIds } = getEffectiveAbilityList(pokemon, slot);
  const hiddenAbilityId = getEffectiveHiddenAbilityId(pokemon, slot);
  const candidates: { id: string; hidden: boolean; mega?: boolean }[] = [
    ...normalAbilityIds.map((id) => ({ id, hidden: false })),
    ...(hiddenAbilityId ? [{ id: hiddenAbilityId, hidden: true }] : []),
  ];
  if (includeMegaAbilityOption && form.mega && !candidates.some((c) => c.id === form.mega!.ability)) {
    candidates.push({ id: form.mega.ability, hidden: false, mega: true });
  }

  return (
    <Modal title={`${pokemon.name} · 특성 선택`} onClose={onClose}>
      <button type="button" className="move-clear-btn" onClick={onClear}>
        특성 비우기
      </button>
      <ul className="move-picker-list">
        {candidates.map(({ id, hidden, mega }) => {
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
                {mega && <span className="move-picker-cat">메가진화 시</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
