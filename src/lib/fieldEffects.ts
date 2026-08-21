import type { PokemonType } from "../types/pokemon-type";
import type { FieldKind } from "../types/field";
import type { StatusCondition } from "../types/status";

/** 필드는 전부 5턴 지속 (그라운드코트로 8턴까지 늘어나는 건 아직 도구 배율처럼 스키마 밖) */
export const FIELD_DURATION = 5;

/** 필드마다 위력이 1.3배 오르는 타입. 미스트필드는 특정 타입을 강화하지 않고 대신 드래곤을 반감시킨다 */
const FIELD_BOOST_TYPE: Partial<Record<FieldKind, PokemonType>> = {
  그래스필드: "풀",
  사이코필드: "에스퍼",
  일렉트릭필드: "전기",
};

/** 배경색 등 UI 표시에 쓰는 필드→타입 매핑. moves.json에서 필드 기술 자신의 타입과 동일하다 */
export const FIELD_DISPLAY_TYPE: Record<FieldKind, PokemonType> = {
  그래스필드: "풀",
  미스트필드: "페어리",
  사이코필드: "에스퍼",
  일렉트릭필드: "전기",
};

/** 필드가 기술 데미지에 주는 배율. 그래스/사이코/일렉트릭=해당 타입 1.3배, 미스트필드=드래곤타입 0.5배 */
export function getFieldDamageMultiplier(field: FieldKind | undefined, moveType: PokemonType | null): number {
  if (!field || !moveType) return 1;
  if (field === "미스트필드") return moveType === "드래곤" ? 0.5 : 1;
  return FIELD_BOOST_TYPE[field] === moveType ? 1.3 : 1;
}

/**
 * 미스트필드(모든 상태이상+혼란 면역)·일렉트릭필드(잠듦만 면역) 조건에 걸려 상태이상을 못 거는지.
 * 두 필드 다 "땅에 있는 포켓몬"이 대상이고, 이 프로젝트는 부유/공중 포켓몬 구분이 없어 항상 땅에 있는 것으로 취급한다.
 */
export function isStatusBlockedByField(field: FieldKind | undefined, status: StatusCondition): boolean {
  if (field === "미스트필드") return true;
  if (field === "일렉트릭필드" && status === "sleep") return true;
  return false;
}

/** 혼란도 미스트필드의 "각종 상태이상" 면역 범위에 포함된다 (본가 규칙) */
export function isConfusionBlockedByField(field: FieldKind | undefined): boolean {
  return field === "미스트필드";
}

/** 사이코필드: 우선도 +1 이상인 기술이 상대를 노리면 그 기술 자체가 실패한다 */
export function isPriorityMoveBlockedByField(field: FieldKind | undefined, priority: number): boolean {
  return field === "사이코필드" && priority >= 1;
}

/** 그래스필드일 때 턴 종료 시 최대 HP의 1/16을 회복한다 */
export function computeFieldEndOfTurnHeal(field: FieldKind | undefined, maxHp: number): number {
  return field === "그래스필드" ? Math.floor(maxHp / 16) : 0;
}
