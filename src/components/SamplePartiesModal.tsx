import { useState } from "react";
import { Modal } from "./Modal";
import { PokemonAvatarWithItem } from "./PokemonAvatarWithItem";
import { SAMPLE_PARTIES, getPokemon } from "../lib/data";
import { eulReul } from "../lib/josa";
import type { SamplePartyPreset } from "../types/party";
import "./PresetListModal.css";
import "./SamplePartiesModal.css";

type GroupFilter = "all" | SamplePartyPreset["group"];

const GROUP_LABEL: Record<SamplePartyPreset["group"], string> = {
  real: "심화샘플",
  textbook: "기초샘플",
};

const FILTERS: { key: GroupFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "real", label: "심화샘플" },
  { key: "textbook", label: "기초샘플" },
];

interface SamplePartiesModalProps {
  onClose: () => void;
  onLoad: (sample: SamplePartyPreset) => void;
  /** 불러오면 덮어쓰는 대상 설명(예: "상대 파티 빌드") — 확인 문구에 쓴다 */
  loadTargetLabel: string;
  /** 대상 진영에 이미 포켓몬이 있으면 덮어쓰기 확인을 묻는다 */
  targetHasPokemon: boolean;
}

/**
 * 기본 제공 샘플 파티 목록(ver.2.1 B). 읽기 전용 데이터라 저장·이름변경·삭제는 없다 —
 * 불러오면 그 진영에만 사본이 채워지고, 사용자가 저장한 파티는 건드리지 않는다.
 */
export function SamplePartiesModal({ onClose, onLoad, loadTargetLabel, targetHasPokemon }: SamplePartiesModalProps) {
  const [filter, setFilter] = useState<GroupFilter>("all");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const shown = SAMPLE_PARTIES.filter(
    (s) =>
      (filter === "all" || s.group === filter) &&
      (!q || `${s.name} ${s.style} ${s.description} ${s.slots.map((slot) => slot.pokemonId).join(" ")}`.toLowerCase().includes(q)),
  );

  function handleLoad(sample: SamplePartyPreset) {
    if (
      targetHasPokemon &&
      !window.confirm(`"${sample.name}"${eulReul(sample.name)} 불러올까요? ${loadTargetLabel}는 덮어써집니다.`)
    ) {
      return;
    }
    onLoad(sample);
    onClose();
  }

  return (
    <Modal title="샘플 파티" onClose={onClose}>
      <div className="sample-party-filters" role="tablist" aria-label="샘플 파티 종류">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={filter === f.key ? "is-active" : undefined}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <p className="sample-party-hint">
        심화샘플은 자주 볼 법한 강한 조합, 기초샘플은 한 가지 전술을 순수하게 보여 주는 표본이에요. 불러와서 고쳐도 원본은 바뀌지 않아요.
      </p>

      <ul className="preset-list">
        {shown.map((sample) => (
          <li key={sample.id} className="preset-item sample-party-item">
            <div className="preset-item-info">
              <span className="preset-item-name">
                {sample.name}
                <span className={`sample-party-tag is-${sample.group}`}>{GROUP_LABEL[sample.group]}</span>
                <span className="sample-party-style">{sample.style}</span>
              </span>
              <span className="sample-party-desc">{sample.description}</span>
              <span className="sample-party-mons">
                {sample.slots.map((slot) => {
                  const pokemon = getPokemon(slot.pokemonId);
                  if (!pokemon) return null;
                  return (
                    <span key={slot.pokemonId} className="sample-party-mon" title={`${pokemon.name} · ${slot.item ?? "도구 없음"}`}>
                      <PokemonAvatarWithItem
                        pokemon={pokemon}
                        size={34}
                        radius={9}
                        itemId={slot.item}
                        form={{
                          formVariant: slot.formVariant,
                          sizeForm: slot.sizeForm,
                          cosmeticForm: slot.cosmeticForm,
                          activeMegaForm: slot.activeMegaForm,
                          item: slot.item,
                        }}
                      />
                    </span>
                  );
                })}
              </span>
            </div>
            <div className="preset-item-actions">
              <button type="button" onClick={() => handleLoad(sample)}>
                불러오기
              </button>
            </div>
          </li>
        ))}
        {shown.length === 0 && <li className="preset-list-empty">검색 결과가 없습니다.</li>}
      </ul>

      <input
        type="text"
        className="preset-search-input"
        placeholder="파티 이름·포켓몬으로 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </Modal>
  );
}
