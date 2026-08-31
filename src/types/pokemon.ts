import type { PokemonType } from "./pokemon-type";
import type { BaseStats } from "./stats";

export interface MegaEvolution {
  /** 메가진화 폼 고유 id. 한 포켓몬이 메가진화를 2종 가질 수 있어 배열 원소마다 구분한다. */
  form: string;
  /** 이 폼으로 진화시키는 메가스톤 item id */
  megaStone: string;
  types: PokemonType[];
  baseStats: BaseStats;
  ability: string;
}

/**
 * 킬가르도(배틀스위치) 전용 — 실드폼/블레이드폼 두 종족값 세트. 타입·특성·HP·스피드는 두 폼이
 * 동일하고(킬가르도: 강철/고스트, HP 60, 스피드 60 고정) 공격/방어/특공/특방만 서로 뒤바뀐다.
 * `Pokemon.baseStats`에는 실드폼(등장 시 기본 폼) 수치를 그대로 채운다 — 매치업 페이지처럼
 * "현재 폼" 개념이 없는 1턴 스냅샷에서는 항상 실드폼 기준으로 보여진다.
 */
export interface StanceChangeForms {
  shieldBaseStats: BaseStats;
  bladeBaseStats: BaseStats;
  /** 이 기술을 사용하면(명중 여부 무관, 사용 자체로) 블레이드폼이어도 실드폼으로 되돌아간다 */
  revertMoveId: string;
}

/** 파티 슬롯에 실제로 배정되는 성별. 무성별은 이 타입이 아니라 null로 표현한다(getEffectiveGender 참고) */
export type PokemonGender = "male" | "female";

/**
 * 종족 단위 성별 분포 카테고리(헤롱헤롱/헤롱헤롱바디 구현에 필요, Phase 6 §1-1 — 사용자 확정
 * 2026-08-26: 배틀마다 랜덤 배정하지 않고, "both"인 종만 파티 슬롯에서 사용자가 직접 고른다):
 *  - "both": 수컷/암컷 둘 다 존재(비율 무관 — 87.5:12.5 같은 극단적 혼합도 포함). 슬롯의 gender
 *    필드로 사용자가 고르고, 미지정이면 수컷을 기본값으로 취급한다(getEffectiveGender).
 *  - "male-only" / "female-only": 그 종은 항상 그 성별 하나로 고정. 슬롯의 gender와 무관하다.
 *  - "genderless": 성별 개념이 없음(강철/에스퍼 무생물 모티브, 전설 등). 헤롱헤롱류는 이 종에
 *    아예 걸리지 않는다.
 */
export type PokemonGenderCategory = "both" | "male-only" | "female-only" | "genderless";

export interface Pokemon {
  id: string;
  name: string;
  types: PokemonType[];
  baseStats: BaseStats;
  abilities: string[];
  hiddenAbility?: string;
  /** 메가진화가 없으면 생략. 2종 이상 가진 포켓몬은 배열 원소를 늘린다. */
  megaEvolutions?: MegaEvolution[];
  /** 킬가르도(배틀스위치)처럼 배틀 중 기술 카테고리에 따라 폼이 바뀌는 포켓몬만 채운다 */
  stanceChangeForms?: StanceChangeForms;
  /** 본가 기준 성별 분포 카테고리. 헤롱헤롱(매혹)·헤롱헤롱바디 판정에 쓴다 */
  genderCategory: PokemonGenderCategory;
  /**
   * 몸무게(kg). 헤비봄버·히트스탬프·풀묶기·안다리걸기의 위력 계산에 쓴다(§3-6). 아직 개별
   * 조사 전이라 대부분 미입력 — 없으면 해당 기술은 폴백 위력으로 계산한다. 메가폼별 몸무게
   * 분리는 데이터 채울 때 재검토(현재는 기본 폼 값 하나만).
   */
  weightKg?: number;
  learnset: string[];
}
