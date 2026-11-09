import { POKEMON_TYPES, type PokemonType } from "../types/pokemon-type";
import { getEffectiveness } from "./typeEffectiveness";
import { getMove, getPokemon } from "./data";
import { getEffectiveForm } from "./pokemonForm";
import type { PartySlot, PartySlots } from "../types/party";
import type { Move, MoveCategory } from "../types/move";

export interface PartyMember {
  pokemonId: string;
  name: string;
  types: PokemonType[];
  /** 슬롯에 배치한 기술 id (빈 칸은 null) — 공격 표(7.6)가 쓴다 */
  moves: PartySlot["moves"];
  /** 메가진화·폼 변화 중이면 그 폼 라벨 (예: "리자몽-메가X"), 아니면 null */
  formLabel: string | null;
}

/** 파티에 채워진 포켓몬을, 메가스톤 장착 여부까지 반영한 실제 타입으로 계산해 반환한다 */
function getPartyMembers(slots: PartySlots): PartyMember[] {
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
        moves: slot.moves,
        formLabel: form.formLabel,
      };
    })
    .filter((m): m is PartyMember => m !== null);
}

/** 파티 전체가 이 공격 타입 행에 대해 어떤 상태인지 (백로그 §1-3 확정 규칙, 2026-09-02) */
export type PartyDefenseVerdict = "취약" | "보통" | "강점";

interface PartyDefenseRow {
  /** 공격 타입 (방어 상성 기준) */
  type: PokemonType;
  /** members와 같은 순서의 방어 배율. 등배(×1)면 null(=빈 칸) */
  cells: (number | null)[];
  verdict: PartyDefenseVerdict;
}

interface PartyDefenseMatrix {
  /** 표의 열 헤더 — 빌드한 포켓몬 전부(선출로 좁히지 않음), 최대 6 */
  members: PartyMember[];
  /** 18행 고정 — POKEMON_TYPES 배열 순서 */
  rows: PartyDefenseRow[];
  /** members와 같은 순서 — 그 포켓몬 한 마리가 18타입 중 약점(×2·×4)인 타입 수(표 마지막 행) */
  memberWeakCounts: number[];
}

/**
 * 포켓몬 × 공격타입 방어 상성 매트릭스(백로그 §1). 각 셀은 그 포켓몬이 해당 타입 기술을 받을 때의
 * 방어 배율(등배는 null). "종합" 판정은 그 타입 행에서 약점 인원 w·저항 인원 r(면역 포함, 4배/¼도
 * 인원 1로만 집계)로 결정한다:
 *  - 강점: r ≥ w  그리고  r ≥ 2
 *  - 취약: w − r ≥ 2
 *  - 보통: 그 외 (두 조건은 상호배타적)
 *
 * 표 마지막 행(`memberWeakCounts`)은 그 포켓몬 한 마리가 18타입 중 약점(×2·×4)인 타입 수
 * (¼·면역 등 저항은 세지 않고, ×4도 타입 1개로만 집계).
 */
export function computePartyDefenseMatrix(slots: PartySlots): PartyDefenseMatrix {
  const members = getPartyMembers(slots);
  const memberWeakCounts = members.map(() => 0);
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
        memberWeakCounts[i]++;
      } else {
        r++; // c < 1 (0/0.25/0.5) — 면역도 저항으로 집계
      }
    });
    const verdict: PartyDefenseVerdict =
      r >= w && r >= 2 ? "강점" : w - r >= 2 ? "취약" : "보통";
    return { type: attacking, cells, verdict };
  });
  return { members, rows, memberWeakCounts };
}

/** 분류별 기술 개수 (공격 표의 한 칸) */
export type MoveCount = Record<MoveCategory, number>;

interface PartyAttackRow {
  /** 기술 타입 */
  type: PokemonType;
  /** members와 같은 순서 — 그 포켓몬이 가진 이 타입 기술의 분류별 개수 */
  cells: MoveCount[];
  /** 파티 전체 합계 (표 마지막 열) */
  total: MoveCount;
}

interface PartyAttackMemberTotal {
  /** 물리 + 특수 기술 수 */
  damage: number;
  /** 변화 기술 수 */
  status: number;
  /** 이 포켓몬의 물리·특수 기술이 약점(×2 이상)을 찌를 수 있는 방어 타입 수 (단일 타입 18개 기준) */
  covered: number;
}

interface PartyAttackMatrix {
  members: PartyMember[];
  /** 18행 고정 — POKEMON_TYPES 배열 순서 */
  rows: PartyAttackRow[];
  /** members와 같은 순서 (표 아래쪽 합계 행) */
  memberTotals: PartyAttackMemberTotal[];
  /** 파티 전체가 약점을 찌를 수 있는 방어 타입 / 못 찌르는 방어 타입 (POKEMON_TYPES 순서) */
  coveredTypes: PokemonType[];
  uncoveredTypes: PokemonType[];
}

/** 이 기술이 방어 타입 하나(단일 타입)를 ×2 이상으로 찌르는가 — 프리즈드라이처럼 상성을 덮어쓰는 기술을 반영 */
function hitsSuperEffective(move: Move & { type: PokemonType }, defending: PokemonType): boolean {
  const o = move.overridesTypeEffectivenessFor;
  return (o && o.type === defending ? o.effectiveness : getEffectiveness(move.type, [defending])) >= 2;
}

/**
 * 포켓몬 × 기술 타입 공격 매트릭스(7.6 T3·T4). 각 셀은 그 포켓몬이 가진 해당 타입 기술을 물리·특수·변화로 센 것이다.
 * 기술 자체의 타입만 본다(특성 스킨·웨더볼 같은 가변 타입, 이중 타입 방어 조합은 반영하지 않는다 — ponytail: 단일 타입 18개 기준).
 * 약점 커버는 물리·특수 기술(변화 제외) 하나라도 그 방어 타입을 ×2 이상으로 찌르면 "커버"다.
 */
export function computePartyAttackMatrix(slots: PartySlots): PartyAttackMatrix {
  const members = getPartyMembers(slots);
  const moves = members.map((m) =>
    m.moves.flatMap((id) => {
      const move = id ? getMove(id) : undefined;
      return move?.type && move.category ? [{ move: move as Move & { type: PokemonType }, category: move.category }] : [];
    }),
  );
  const empty = (): MoveCount => ({ physical: 0, special: 0, status: 0 });
  const rows: PartyAttackRow[] = POKEMON_TYPES.map((type) => {
    const total = empty();
    const cells = moves.map((list) => {
      const cell = empty();
      for (const m of list) {
        if (m.move.type !== type) continue;
        cell[m.category]++;
        total[m.category]++;
      }
      return cell;
    });
    return { type, cells, total };
  });
  const coveredBy = moves.map(
    (list) => new Set(POKEMON_TYPES.filter((def) => list.some((m) => m.category !== "status" && hitsSuperEffective(m.move, def)))),
  );
  const memberTotals = moves.map((list, i) => {
    const status = list.filter((m) => m.category === "status").length;
    return { damage: list.length - status, status, covered: coveredBy[i].size };
  });
  const coveredTypes = POKEMON_TYPES.filter((t) => coveredBy.some((s) => s.has(t)));
  return { members, rows, memberTotals, coveredTypes, uncoveredTypes: POKEMON_TYPES.filter((t) => !coveredTypes.includes(t)) };
}
