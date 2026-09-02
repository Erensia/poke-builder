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
  /**
   * 이 메가폼의 몸무게(kg). 헤비봄버·히트스탬프·풀묶기·안다리걸기 위력 계산용(§3-6). 메가진화로
   * 몸무게가 바뀌는 종(대짱이 81.9→102.0, 캥카 80→100 등)이 있어 폼별로 따로 저장한다.
   * 비공식 메가폼은 사용자 지정값.
   */
  weightKg?: number;
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
 * 펌킨인·펌킨인 계열처럼 "크기 변종"이 있는 종 전용. 실제 게임에서 소과종/중과종/대과종/특대과종
 * 4개 변종이 스피드·몸무게만 다르고 나머지 5스탯·타입·특성·기술은 완전히 동일하다. 파티 슬롯의
 * `sizeForm` 필드가 이 배열의 `id`를 가리키며, getEffectiveForm이 그 크기의 spe·weightKg로
 * baseStats/weightKg를 덮어쓴다. `standard: true`인 항목이 종의 기준값(Pokemon.baseStats와 동일)이며,
 * slot.sizeForm이 없으면 이 기준 크기로 취급한다.
 */
export interface SizeForm {
  /** 크기 변종 고유 id (예: "small" | "medium" | "large" | "super") */
  id: string;
  /** 표시 라벨 ("소과종" 등) */
  label: string;
  /** 이 크기의 스피드 종족값 */
  spe: number;
  /** 이 크기의 몸무게(kg) */
  weightKg: number;
  /** 종의 기준 크기(Pokemon.baseStats/weightKg와 같은 값)면 true. 배열에 정확히 하나만 있어야 한다 */
  standard?: boolean;
}

/**
 * 루가루암(한낮/한밤중/황혼)처럼 종족값·타입·특성이 통째로 갈리는 "폼 변종"이 있는 종 전용.
 * 크기 변종(SizeForm)이 스피드·몸무게만 다른 것과 달리 이건 전투에 영향을 주는 거의 모든 축이
 * 다르다. 파티 슬롯의 `formVariant` 필드가 이 배열의 `id`를 가리키며, getEffectiveForm이 그 폼의
 * baseStats/types/weightKg로 덮어쓰고, 특성 선택 UI는 그 폼의 abilities/hiddenAbility를 쓴다.
 * `standard: true`인 항목이 종의 기준 폼(Pokemon 최상위 필드와 같은 값)이며, slot.formVariant가
 * 없으면 이 기준 폼으로 취급한다. learnset은 폼별로 나뉘지 않는 한 종 공통 learnset을 그대로 쓴다.
 */
export interface FormVariant {
  /** 폼 고유 id (예: "midday" | "midnight" | "dusk") */
  id: string;
  /** 표시 라벨 ("한낮의모습" 등) */
  label: string;
  types: PokemonType[];
  baseStats: BaseStats;
  abilities: string[];
  hiddenAbility?: string;
  weightKg?: number;
  /** 종의 기준 폼(Pokemon 최상위 필드와 동일)이면 true. 배열에 정확히 하나만 있어야 한다 */
  standard?: boolean;
}

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
  /**
   * 냐오닉스처럼 숨겨진 특성이 성별에 따라 갈리는 종 전용. 종족값·기술은 성별과 무관하게 동일하고
   * 숨겨진 특성만 male/female이 다르다. 이 필드가 있으면 특성 선택 UI는 `hiddenAbility` 대신
   * 슬롯의 성별(getEffectiveGender)에 맞는 쪽 하나만 숨겨진 특성 후보로 보여준다. `hiddenAbility`
   * 필드에는 수컷 기본값을 함께 채워 두어(포켓몬 도감 등 성별 개념이 없는 화면의 폴백) 준다.
   */
  genderedHiddenAbility?: { male: string; female: string };
  /** 펌킨인 계열처럼 크기 변종(스피드·몸무게만 상이)이 있는 종만 채운다 */
  sizeForms?: SizeForm[];
  /** 루가루암 계열처럼 종족값·타입·특성이 통째로 갈리는 폼 변종이 있는 종만 채운다 */
  formVariants?: FormVariant[];
  /** 메가진화가 없으면 생략. 2종 이상 가진 포켓몬은 배열 원소를 늘린다. */
  megaEvolutions?: MegaEvolution[];
  /** 킬가르도(배틀스위치)처럼 배틀 중 기술 카테고리에 따라 폼이 바뀌는 포켓몬만 채운다 */
  stanceChangeForms?: StanceChangeForms;
  /** 본가 기준 성별 분포 카테고리. 헤롱헤롱(매혹)·헤롱헤롱바디 판정에 쓴다 */
  genderCategory: PokemonGenderCategory;
  /**
   * 기본 폼 몸무게(kg). 헤비봄버·히트스탬프·풀묶기·안다리걸기의 위력 계산에 쓴다(§3-6).
   * 전 종 입력 완료(2026-08-31, PokéAPI 기준). 메가폼은 `megaEvolutions[].weightKg`로 폼별 저장.
   */
  weightKg?: number;
  learnset: string[];
}
