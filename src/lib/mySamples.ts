import { getAbility, getItem, getMove, getNature, getPokemon } from "./data";
import { EMPTY_ABILITY_POINTS, type PartySlot, type SamplePartyPreset } from "../types/party";
import { MAX_ABILITY_POINTS_PER_STAT, MAX_ABILITY_POINTS_TOTAL } from "./statCalculator";

/**
 * 내 샘플이 지금 데이터로 쓸 수 있는지(3.1 S2) — 6마리 모두 있는 포켓몬이고 배정한 기술이 전부 있는 기술이다.
 * 데이터가 바뀌어 id가 사라지면 저장해 둔 샘플이 깨질 수 있어서, 무작위 샘플·프런티어 풀에 넣기 전에 거른다.
 */
export function isUsableSample(sample: SamplePartyPreset): boolean {
  return (
    Array.isArray(sample.slots) &&
    sample.slots.length === 6 &&
    sample.slots.every((slot) => !!slot && !!getPokemon(slot.pokemonId) && slot.moves.every((id) => id === null || !!getMove(id)))
  );
}

const EXPORT_KIND = "champions-my-samples";
/** 가져오기 파일 크기 상한 — 내 샘플 저장소(localStorage)를 한 파일이 채우지 못하게 */
export const MAX_IMPORT_BYTES = 1_000_000;

/** 내 샘플 목록을 내보내기 파일 내용(JSON)으로 — 마스터 샘플과 같은 모양이라 마스터 반영에도 쓴다 */
export function exportMySamples(samples: SamplePartyPreset[]): string {
  return JSON.stringify({ kind: EXPORT_KIND, version: 1, samples }, null, 2);
}

/** 가져온 값이 없거나(null) 데이터에 있는 id인지 */
const knownOrNull = (v: unknown, exists: (id: string) => unknown) => v === null || v === undefined || (typeof v === "string" && !!exists(v));
const optionalString = (v: unknown) => v === undefined || typeof v === "string";

/** 가져온 슬롯 하나 검증 — 믿을 수 없는 입력이라 모양·id·포인트 범위를 다 본다. 틀리면 null(그 샘플은 건너뜀) */
function cleanSlot(raw: unknown): PartySlot | null {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const p = (s.points && typeof s.points === "object" ? s.points : {}) as Record<string, unknown>;
  const stats = Object.keys(EMPTY_ABILITY_POINTS) as (keyof typeof EMPTY_ABILITY_POINTS)[];
  const points = { ...EMPTY_ABILITY_POINTS };
  for (const k of stats) {
    const v = p[k];
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > MAX_ABILITY_POINTS_PER_STAT) return null;
    points[k] = v as number;
  }
  if (stats.reduce((sum, k) => sum + points[k], 0) > MAX_ABILITY_POINTS_TOTAL) return null;
  if (typeof s.pokemonId !== "string" || !getPokemon(s.pokemonId)) return null;
  if (!Array.isArray(s.moves) || s.moves.length !== 4 || !s.moves.every((m) => m === null || (typeof m === "string" && !!getMove(m)))) return null;
  if (!knownOrNull(s.ability, getAbility) || !knownOrNull(s.item, getItem) || !knownOrNull(s.nature, getNature)) return null;
  if (![s.activeMegaForm, s.sizeForm, s.formVariant, s.cosmeticForm].every(optionalString)) return null;
  if (s.gender !== undefined && s.gender !== "male" && s.gender !== "female") return null;
  return {
    pokemonId: s.pokemonId,
    ...(s.activeMegaForm !== undefined && { activeMegaForm: s.activeMegaForm as string }),
    ...(s.sizeForm !== undefined && { sizeForm: s.sizeForm as string }),
    ...(s.formVariant !== undefined && { formVariant: s.formVariant as string }),
    ...(s.cosmeticForm !== undefined && { cosmeticForm: s.cosmeticForm as string }),
    moves: s.moves as PartySlot["moves"],
    ability: (s.ability as string | null | undefined) ?? null,
    item: (s.item as string | null | undefined) ?? null,
    nature: (s.nature as string | null | undefined) ?? null,
    points,
    ...(s.gender !== undefined && { gender: s.gender }),
  };
}

/**
 * 내보내기 파일 내용을 읽어 쓸 수 있는 샘플만 돌려준다(3.2 V3). 파일 형식이 아니면 null. 이름·분류·6마리 슬롯이 틀린 샘플은
 * 건너뛰고 skipped로 센다. id는 받은 값을 믿지 않고 비워 두니(호출한 쪽에서 새로 매긴다) 기존 샘플과 충돌하지 않는다.
 */
export function parseMySamples(text: string): { samples: Omit<SamplePartyPreset, "id">[]; skipped: number } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const file = data as { kind?: unknown; samples?: unknown };
  if (!file || file.kind !== EXPORT_KIND || !Array.isArray(file.samples)) return null;
  const samples: Omit<SamplePartyPreset, "id">[] = [];
  for (const raw of file.samples) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const slots = Array.isArray(r.slots) && r.slots.length === 6 ? r.slots.map(cleanSlot) : null;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!slots || slots.includes(null) || !name || typeof r.style !== "string" || typeof r.description !== "string" || (r.group !== "real" && r.group !== "textbook")) continue;
    samples.push({ name, style: r.style, group: r.group, description: r.description, slots: slots as PartySlot[] });
  }
  return { samples, skipped: file.samples.length - samples.length };
}

/** 같은 샘플인지 보는 열쇠(이름 + 6마리의 종·도구·기술) — 같은 파일을 두 번 가져와도 겹치지 않게. ponytail: 포인트·성격까지는 안 본다 */
export const sampleKey = (s: Pick<SamplePartyPreset, "name" | "slots">) =>
  `${s.name}|${s.slots.map((x) => [x.pokemonId, x.item, ...x.moves].join(",")).join("/")}`;
