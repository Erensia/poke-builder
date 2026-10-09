import { loadMySamples, saveMySamples } from "../lib/storage";
import { sampleKey } from "../lib/mySamples";
import type { PartySlot, SamplePartyPreset } from "../types/party";
import { useStoredList } from "./useStoredList";

/** 사용자가 저장한 "내 샘플"(3.1 S2 스파이크) — 마스터 샘플과 같은 모양이라 내보낸 JSON을 그대로 마스터에 반영할 수 있다 */
export function useMySamples() {
  const { items, setItems, prependItem, removeItem } = useStoredList<SamplePartyPreset>(loadMySamples, saveMySamples);

  function addSample(fields: Pick<SamplePartyPreset, "name" | "style" | "group" | "description">, slots: PartySlot[]) {
    const name = fields.name.trim();
    if (!name) return;
    prependItem({ ...fields, name, id: `my-${crypto.randomUUID().slice(0, 8)}`, slots: structuredClone(slots) });
  }

  /** 가져온 샘플을 새 id로 맨 앞에 합친다. 이미 같은 샘플이 있으면 건너뛰고, 실제로 넣은 개수를 돌려준다(3.2 V3) */
  function importSamples(incoming: Omit<SamplePartyPreset, "id">[]): number {
    const have = new Set(items.map(sampleKey));
    const fresh = incoming.filter((s) => !have.has(sampleKey(s)) && have.add(sampleKey(s)));
    setItems((prev) => [...fresh.map((s) => ({ ...s, id: `my-${crypto.randomUUID().slice(0, 8)}` })), ...prev]);
    return fresh.length;
  }

  return { samples: items, addSample, removeSample: removeItem, importSamples };
}
