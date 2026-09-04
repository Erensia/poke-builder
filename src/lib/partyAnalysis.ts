import { POKEMON_TYPES, type PokemonType } from "../types/pokemon-type";
import { getEffectiveness } from "./typeEffectiveness";
import { getPokemon } from "./data";
import { getEffectiveForm } from "./pokemonForm";
import type { PartySlots } from "../hooks/useParty";

export interface PartyMember {
  pokemonId: string;
  name: string;
  types: PokemonType[];
  /** 메가진화·폼 변화 중이면 그 폼 라벨 (예: "리자몽-메가X"), 아니면 null */
  formLabel: string | null;
}

/** 파티에 채워진 포켓몬을, 메가스톤 장착 여부까지 반영한 실제 타입으로 계산해 반환한다 */
export function getPartyMembers(slots: PartySlots): PartyMember[] {
  return slots
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .map((slot) => {
      const pokemon = getPokemon(slot.pokemonId);
      if (!pokemon) return null;
      const form = getEffectiveForm(pokemon, slot);
      return {
        pokemonId: pokemon.id,
        name: pokemon.name,
        types: form.types,
        formLabel: form.formLabel,
      };
    })
    .filter((m): m is PartyMember => m !== null);
}

/** 파티 전체가 이 공격 타입 행에 대해 어떤 상태인지 (백로그 §1-3 확정 규칙, 2026-09-02) */
export type PartyDefenseVerdict = "취약" | "보통" | "강점";

export interface PartyDefenseRow {
  /** 공격 타입 (방어 상성 기준) */
  type: PokemonType;
  /** members와 같은 순서의 방어 배율. 등배(×1)면 null(=빈 칸) */
  cells: (number | null)[];
  verdict: PartyDefenseVerdict;
}

export interface PartyDefenseMatrix {
  /** 표의 열 헤더 — 빌드한 포켓몬 전부(선출로 좁히지 않음), 최대 6 */
  members: PartyMember[];
  /** 18행 고정 — POKEMON_TYPES 배열 순서 */
  rows: PartyDefenseRow[];
}

/**
 * 포켓몬 × 공격타입 방어 상성 매트릭스(백로그 §1). 각 셀은 그 포켓몬이 해당 타입 기술을 받을 때의
 * 방어 배율(등배는 null). "종합" 판정은 그 타입 행에서 약점 인원 w·저항 인원 r(면역 포함, 4배/¼도
 * 인원 1로만 집계)로 결정한다:
 *  - 강점: r ≥ w  그리고  r ≥ 2
 *  - 취약: w − r ≥ 2
 *  - 보통: 그 외 (두 조건은 상호배타적)
 */
export function computePartyDefenseMatrix(slots: PartySlots): PartyDefenseMatrix {
  const members = getPartyMembers(slots);
  const rows: PartyDefenseRow[] = POKEMON_TYPES.map((attacking) => {
    const cells = members.map((m) => {
      const mult = getEffectiveness(attacking, m.types);
      return mult === 1 ? null : mult;
    });
    let w = 0;
    let r = 0;
    for (const c of cells) {
      if (c === null) continue;
      if (c > 1) w++;
      else r++; // c < 1 (0/0.25/0.5) — 면역도 저항으로 집계
    }
    const verdict: PartyDefenseVerdict =
      r >= w && r >= 2 ? "강점" : w - r >= 2 ? "취약" : "보통";
    return { type: attacking, cells, verdict };
  });
  return { members, rows };
}
