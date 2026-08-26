import type { PokemonType } from "../types/pokemon-type";
import type { FieldKind } from "../types/field";
import type { StatusCondition } from "../types/status";
import type { Move } from "../types/move";

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

/**
 * 이 기술이 "상대(방어측)를 향한" 효과를 하나라도 가졌는지. 사이코필드 우선도 차단이 정확히
 * 이 축으로 갈린다 — 순풍/리플렉터/빛의장막처럼 자신(또는 필드 전역)에게만 적용되는 기술은
 * 우선도가 올라가 있어도(짖궂은마음 등) 사이코필드에 막히지 않는다(사용자 확인). 데미지 기술은
 * 항상 상대를 노리므로 카테고리만으로 먼저 걸러진다.
 */
function isOpponentTargetingMove(move: Move): boolean {
  if (move.category !== "status") return true;
  if (move.inflictsStatus && move.inflictsStatus.length > 0) return true; // 이 스키마에서 대상은 항상 상대
  if (move.inflictsVolatile?.some((v) => v.target === "opponent")) return true;
  if (move.statChanges?.some((s) => s.target === "opponent")) return true;
  if (move.setsLeechSeed) return true;
  if (move.setsDisable || move.setsEncore) return true;
  if (move.curesStatus?.target === "opponent") return true;
  if (move.healsTarget === "opponent") return true;
  return false;
}

/**
 * 사이코필드: 우선도 +1 이상인 기술이 상대를 노리면 그 기술 자체가 실패한다. 짖궂은마음처럼
 * 특성으로 우선도가 올라간 변화기라도, 그 기술 자체가 상대를 겨냥하지 않으면(순풍·리플렉터·
 * 빛의장막 등 자신/필드 전역 효과) 막히지 않는다(사용자 확인 — Phase 5 §4-3에서 우선도만 보고
 * 막던 걸 정정).
 */
export function isPriorityMoveBlockedByField(field: FieldKind | undefined, priority: number, move: Move): boolean {
  return field === "사이코필드" && priority >= 1 && isOpponentTargetingMove(move);
}

/** 그래스필드일 때 턴 종료 시 최대 HP의 1/16을 회복한다 */
export function computeFieldEndOfTurnHeal(field: FieldKind | undefined, maxHp: number): number {
  return field === "그래스필드" ? Math.floor(maxHp / 16) : 0;
}

/** 그래스슬라이더처럼 특정 필드에서만 우선도가 오르는 기술의 실제 우선도(조건 안 맞으면 원래 priority) */
export function getFieldAdjustedPriority(move: Move, field: FieldKind | undefined): number {
  if (move.priorityBoostInField && field === move.priorityBoostInField.field) {
    return move.priority + move.priorityBoostInField.delta;
  }
  return move.priority;
}

/** 미스트버스트·와이드포스·라이징볼트처럼 특정 필드에서 위력이 배가되는 기술의 배율(조건 안 맞으면 1) */
export function getFieldPowerMultiplier(move: Move, field: FieldKind | undefined): number {
  if (move.powerMultiplierInField && field === move.powerMultiplierInField.field) {
    return move.powerMultiplierInField.multiplier;
  }
  return 1;
}

/**
 * 대지의파동(fieldPulse) 전용. 필드가 활성 상태면 그 필드의 표시 타입으로 바뀌고 위력이 2배가
 * 된다. fieldPulse가 없거나 필드가 없으면 원본 타입/위력을 그대로 돌려준다.
 */
export function applyFieldPulse(
  move: Move,
  field: FieldKind | undefined,
): { type: PokemonType | null; power: number | null } {
  if (!move.fieldPulse || !field) return { type: move.type, power: move.power };
  return { type: FIELD_DISPLAY_TYPE[field], power: move.power === null ? null : move.power * 2 };
}
