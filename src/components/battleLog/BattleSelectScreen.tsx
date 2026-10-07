import { BATTLE_SELECT_SIZE } from "../../hooks/useBattleSetup";
import { getEffectiveForm, getEffectiveGender } from "../../lib/pokemonForm";
import { PokemonAvatarWithItem } from "../PokemonAvatarWithItem";
import type { PartySlot } from "../../types/party";
import type { Pokemon } from "../../types/pokemon";
import { type Side, type SlotIndex } from "./shared";

/**
 * 선출(3+순서) 화면 — 6마리 중 4마리 이상 빌드한 편만 여기서 순서까지 고른다(§16). 빌드
 * 화면과 마찬가지로 파생값/콜백만 props로 받는 presentational 컴포넌트.
 */
export function BattleSelectScreen({
  selection,
  buildableIndices,
  needsSelection,
  pokemonAt,
  slotAt,
  onToggleSelection,
  onBack,
  selectionComplete,
  onStartBattle,
  hiddenSide,
}: {
  /** AI가 선출한 편 — 대전 시작 전까지 선출을 공개하지 않는다(3선출 AI, ver.1.8) */
  hiddenSide: Side | null;
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
          const hidden = side === hiddenSide;
          const manual = needsSelection(side) && !hidden;
          return (
            <div key={side} className="battle-select-column">
              <div className="battle-setup-column-title">
                {side === "a" ? "내 선출" : "상대 선출"}{" "}
                <span className="battle-setup-column-hint">
                  {hidden
                    ? "AI가 선출함 · 대전 시작 때 공개"
                    : manual
                      ? `${picks.length}/${BATTLE_SELECT_SIZE} · 고른 순서가 선출 순서(첫 번째가 리드)`
                      : "빌드 순서대로 선출"}
                </span>
              </div>
              <div className="battle-select-list">
                {pool.map((i) => {
                  const pk = pokemonAt(side, i);
                  const pkSlot = slotAt(side, i);
                  // 수동 선출: 고른 순서대로 번호. 선출 스킵 편: 빌드 순서 그대로 1·2·3 고정.
                  const num = hidden
                    ? null
                    : manual
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
                      {/* 2.3 B2 보완(사용자 확인): 선출 화면은 내 카드까지 포함해 양쪽 다 도구
                          이미지를 숨긴다(itemId 생략) — 배틀 판은 여전히 상대만 숨긴다. */}
                      {pk && pkSlot && (
                        <PokemonAvatarWithItem
                          pokemon={pk}
                          size={28}
                          radius={8}
                          gradientTypes={getEffectiveForm(pk, pkSlot).types}
                          form={{
                            gender: getEffectiveGender(pk, pkSlot),
                            cosmeticForm: pkSlot.cosmeticForm,
                            formVariant: pkSlot.formVariant,
                            sizeForm: pkSlot.sizeForm,
                            activeMegaForm: pkSlot.activeMegaForm,
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
