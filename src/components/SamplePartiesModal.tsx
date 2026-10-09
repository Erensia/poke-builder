import { useState, type ChangeEvent } from "react";
import { Modal } from "./Modal";
import { PokemonAvatarWithItem } from "./PokemonAvatarWithItem";
import { SAMPLE_PARTIES, getPokemon } from "../lib/data";
import { eulReul } from "../lib/josa";
import { MAX_IMPORT_BYTES, exportMySamples, parseMySamples } from "../lib/mySamples";
import type { PartySlot, SamplePartyPreset } from "../types/party";
import "./PresetListModal.css";
import "./SamplePartiesModal.css";

type GroupFilter = "all" | SamplePartyPreset["group"] | "mine";

const GROUP_LABEL: Record<SamplePartyPreset["group"], string> = {
  real: "심화샘플",
  textbook: "기초샘플",
};

const FILTERS: { key: GroupFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "real", label: "심화샘플" },
  { key: "textbook", label: "기초샘플" },
  { key: "mine", label: "내 샘플" },
];

type SampleFields = Pick<SamplePartyPreset, "name" | "style" | "group" | "description">;

interface SamplePartiesModalProps {
  onClose: () => void;
  onLoad: (sample: SamplePartyPreset) => void;
  /** 불러오면 덮어쓰는 대상 설명(예: "상대 파티 빌드") — 확인 문구에 쓴다 */
  loadTargetLabel: string;
  /** 대상 진영에 이미 포켓몬이 있으면 덮어쓰기 확인을 묻는다 */
  targetHasPokemon: boolean;
  /** 내 샘플(3.1 S2 스파이크) — 사용자가 저장한 샘플 목록과 저장·삭제 */
  mySamples: SamplePartyPreset[];
  /** 이 진영의 현재 6슬롯 — "현재 파티를 내 샘플로 저장"에 쓴다 */
  currentSlots: (PartySlot | null)[];
  onSaveMySample: (fields: SampleFields, slots: PartySlot[]) => void;
  onDeleteMySample: (id: string) => void;
  /** 가져온 샘플을 합치고 실제로 넣은 개수를 돌려준다(3.2 V3) */
  onImportMySamples: (samples: Omit<SamplePartyPreset, "id">[]) => number;
}

/**
 * 기본 제공 샘플 파티 목록(ver.2.1 B). 기본 샘플은 읽기 전용 데이터라 저장·이름변경·삭제가 없다 —
 * 불러오면 그 진영에만 사본이 채워지고, 사용자가 저장한 파티는 건드리지 않는다. "내 샘플" 탭만 사용자가
 * 저장·삭제할 수 있고(3.1 S2 스파이크) 기본 샘플과 따로 저장된다.
 */
export function SamplePartiesModal({
  onClose,
  onLoad,
  loadTargetLabel,
  targetHasPokemon,
  mySamples,
  currentSlots,
  onSaveMySample,
  onDeleteMySample,
  onImportMySamples,
}: SamplePartiesModalProps) {
  const [filter, setFilter] = useState<GroupFilter>("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<SampleFields>({ name: "", style: "", group: "textbook", description: "" });
  const isMine = filter === "mine";
  const filledSlots = currentSlots.filter((slot): slot is PartySlot => slot !== null);
  const canSave = filledSlots.length === currentSlots.length && draft.name.trim() !== "";

  const q = query.trim().toLowerCase();
  const shown = (isMine ? mySamples : SAMPLE_PARTIES).filter(
    (s) =>
      (filter === "all" || filter === "mine" || s.group === filter) &&
      (!q || `${s.name} ${s.style} ${s.description} ${s.slots.map((slot) => slot.pokemonId).join(" ")}`.toLowerCase().includes(q)),
  );

  function handleSave() {
    if (!canSave) return;
    onSaveMySample({ ...draft, name: draft.name.trim(), style: draft.style.trim(), description: draft.description.trim() }, filledSlots);
    setDraft({ name: "", style: "", group: draft.group, description: "" });
  }

  /** 내 샘플을 JSON 파일로 저장(브라우저 데이터를 지워도 남도록) */
  function handleExport() {
    const url = URL.createObjectURL(new Blob([exportMySamples(mySamples)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `my-samples-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 다시 골라도 change가 오게
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setNotice("파일이 너무 커요(1MB 이하만 가져와요).");
    let text: string;
    try {
      text = await file.text();
    } catch {
      return setNotice("파일을 읽지 못했어요.");
    }
    const parsed = parseMySamples(text);
    if (!parsed) return setNotice("내 샘플 내보내기 파일이 아니에요.");
    const added = onImportMySamples(parsed.samples);
    const duplicates = parsed.samples.length - added;
    setNotice(`${added}개 가져왔어요${duplicates ? ` · 이미 있는 ${duplicates}개는 제외` : ""}${parsed.skipped ? ` · 형식이 맞지 않아 ${parsed.skipped}개 건너뜀` : ""}.`);
  }

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
        {isMine
          ? "내가 저장한 샘플이에요. 기본 샘플과 따로 이 브라우저에만 저장되고(브라우저 데이터를 지우면 사라져요 — 내보내기로 백업하세요), 무작위 샘플에도 함께 뽑혀요."
          : "심화샘플은 자주 볼 법한 강한 조합, 기초샘플은 한 가지 전술을 순수하게 보여 주는 표본이에요. 불러와서 고쳐도 원본은 바뀌지 않아요."}
      </p>

      {isMine && (
        <div className="sample-party-backup">
          <button type="button" onClick={handleExport} disabled={mySamples.length === 0}>
            내보내기
          </button>
          <label>
            가져오기
            <input type="file" accept=".json,application/json" hidden onChange={handleImport} />
          </label>
          {notice && <span role="status">{notice}</span>}
        </div>
      )}

      {isMine && (
        <div className="sample-party-save">
          <strong>{loadTargetLabel}를 내 샘플로 저장</strong>
          <div className="preset-save-row">
            <input type="text" className="preset-save-input" placeholder="이름" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <select className="preset-save-input sample-party-save-group" value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value as SamplePartyPreset["group"] })} aria-label="분류">
              <option value="textbook">기초샘플</option>
              <option value="real">심화샘플</option>
            </select>
          </div>
          <div className="preset-save-row">
            <input type="text" className="preset-save-input" placeholder="성향(예: 날씨(쾌청))" value={draft.style} onChange={(e) => setDraft({ ...draft, style: e.target.value })} />
          </div>
          <div className="preset-save-row">
            <input
              type="text"
              className="preset-save-input"
              placeholder="설명"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
            <button type="button" className="preset-save-button" onClick={handleSave} disabled={!canSave}>
              저장
            </button>
          </div>
          {filledSlots.length < currentSlots.length && (
            <span className="sample-party-save-note">6마리를 모두 채워야 저장할 수 있어요(지금 {filledSlots.length}마리).</span>
          )}
        </div>
      )}

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
              {isMine && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`"${sample.name}"${eulReul(sample.name)} 삭제할까요?`)) onDeleteMySample(sample.id);
                  }}
                >
                  삭제
                </button>
              )}
            </div>
          </li>
        ))}
        {shown.length === 0 && <li className="preset-list-empty">{isMine && !q ? "저장한 내 샘플이 없어요." : "검색 결과가 없습니다."}</li>}
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
