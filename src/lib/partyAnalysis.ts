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
  /** members와 같은 순서 — 그 포켓몬 한 마리의 18타입 방어 상성 종합 판정(표 마지막 행) */
  memberVerdicts: PartyDefenseVerdict[];
}

/** w(약점 수)·r(저항+면역 수)로 취약/보통/강점을 가르는 공통 규칙 (백로그 §1-3 확정, 2026-09-02).
 *  타입 행(파티 전체)과 포켓몬 열(한 마리의 18타입) 양쪽에서 같은 임계값을 쓴다. */
function verdictOf(w: number, r: number): PartyDefenseVerdict {
  return r >= w && r >= 2 ? "강점" : w - r >= 2 ? "취약" : "보통";
}

/**
 * 포켓몬 × 공격타입 방어 상성 매트릭스(백로그 §1). 각 셀은 그 포켓몬이 해당 타입 기술을 받을 때의
 * 방어 배율(등배는 null). "종합" 판정은 그 타입 행에서 약점 인원 w·저항 인원 r(면역 포함, 4배/¼도
 * 인원 1로만 집계)로 결정한다:
 *  - 강점: r ≥ w  그리고  r ≥ 2
 *  - 취약: w − r ≥ 2
 *  - 보통: 그 외 (두 조건은 상호배타적)
 *
 * 표 마지막 행(`memberVerdicts`)은 같은 규칙을 세로로 — 그 포켓몬 한 마리가 18타입 중 몇 개에
 * 약한지(w)·저항하는지(r, 면역 포함)로 취약/보통/강점을 매긴다.
 */
export function computePartyDefenseMatrix(slots: PartySlots): PartyDefenseMatrix {
  const members = getPartyMembers(slots);
  const colW = members.map(() => 0);
  const colR = members.map(() => 0);
  const rows: PartyDefenseRow[] = POKEMON_TYPES.map((attacking) => {
    const cells = members.map((m) => {
      const mult = getEffectiveness(attacking, m.types);
      return mult === 1 ? null : mult;
    });
    let w = 0;
    let r = 0;
    cells.forEach((c, i) => {
      if (c === null) return;
      if (c > 1) {
        w++;
        colW[i]++;
      } else {
        r++; // c < 1 (0/0.25/0.5) — 면역도 저항으로 집계
        colR[i]++;
      }
    });
    return { type: attacking, cells, verdict: verdictOf(w, r) };
  });
  const memberVerdicts = members.map((_, i) => verdictOf(colW[i], colR[i]));
  return { members, rows, memberVerdicts };
}
