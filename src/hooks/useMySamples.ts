import { loadMySamples, saveMySamples } from "../lib/storage";
import type { PartySlot, SamplePartyPreset } from "../types/party";
import { useStoredList } from "./useStoredList";

/** 사용자가 저장한 "내 샘플"(3.1 S2 스파이크) — 마스터 샘플과 같은 모양이라 내보낸 JSON을 그대로 마스터에 반영할 수 있다 */
export function useMySamples() {
  const { items, prependItem, removeItem } = useStoredList<SamplePartyPreset>(loadMySamples, saveMySamples);

  function addSample(fields: Pick<SamplePartyPreset, "name" | "style" | "group" | "description">, slots: PartySlot[]) {
    const name = fields.name.trim();
    if (!name) return;
    prependItem({ ...fields, name, id: `my-${crypto.randomUUID().slice(0, 8)}`, slots: structuredClone(slots) });
  }

  return { samples: items, addSample, removeSample: removeItem };
}
