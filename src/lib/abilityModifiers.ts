import type { Ability, AbilityModifierCondition } from "../types/ability";
import type { Move } from "../types/move";
import type { PokemonType } from "../types/pokemon-type";
import type { WeatherKind } from "../types/weather";

function conditionMatches(
  condition: AbilityModifierCondition | undefined,
  move: Move,
  weather?: WeatherKind,
  attackerHpFraction = 1,
  defenderHpIsFull = true,
  defenderHasStatusCondition = false,
): boolean {
  if (!condition) return true;
  if (condition.movePowerAtMost !== undefined) {
    if (move.power === null || move.power > condition.movePowerAtMost) return false;
  }
  if (condition.moveTypeIn !== undefined) {
    if (!move.type || !condition.moveTypeIn.includes(move.type)) return false;
  }
  if (condition.moveClassificationIn !== undefined) {
    const tags = move.classification ?? [];
    if (!condition.moveClassificationIn.some((t) => tags.includes(t))) return false;
  }
  if (condition.moveCategoryIn !== undefined) {
    if (!move.category || !condition.moveCategoryIn.includes(move.category)) return false;
  }
  if (condition.weatherIs !== undefined) {
    if (weather !== condition.weatherIs) return false;
  }
  if (condition.makesContact !== undefined) {
    if ((move.makesContact ?? false) !== condition.makesContact) return false;
  }
  if (condition.attackerHpAtMostFraction !== undefined) {
    if (attackerHpFraction > condition.attackerHpAtMostFraction) return false;
  }
  if (condition.defenderHpIsFull !== undefined) {
    if (condition.defenderHpIsFull !== defenderHpIsFull) return false;
  }
  if (condition.defenderHasStatusCondition !== undefined) {
    if (condition.defenderHasStatusCondition !== defenderHasStatusCondition) return false;
  }
  return true;
}

export interface AbilityOffenseResult {
  multiplier: number;
  /** 조건에 걸린 조정으로 기술의 유효 타입이 바뀌면 채워짐 (페어리스킨) */
  overrideMoveType?: PokemonType;
}

/**
 * 공격측 특성이 이 기술에 주는 배율과 타입 변경(있다면)을 계산한다.
 * attackerHpFraction(현재HP/최대HP)은 맹화·급류·심록·벌레의알림처럼 HP 1/3 이하 조건이 있는
 * 특성에만 쓰인다 — 안 넘기면 1(풀피)로 간주해서 그 조건은 항상 실패한다.
 */
export function resolveAbilityOffense(
  ability: Ability | undefined,
  move: Move,
  weather?: WeatherKind,
  attackerHpFraction = 1,
): AbilityOffenseResult {
  const result: AbilityOffenseResult = { multiplier: 1 };
  if (!ability?.modifiers) return result;

  for (const modifier of ability.modifiers) {
    if (modifier.scope !== "offense") continue;
    if (!conditionMatches(modifier.condition, move, weather, attackerHpFraction)) continue;
    result.multiplier *= modifier.multiplier;
    if (modifier.overrideMoveType) result.overrideMoveType = modifier.overrideMoveType;
  }
  return result;
}

/**
 * 방어측 특성이 (이 기술로 맞을 때) 주는 배율을 계산한다. 두꺼운지방처럼 내구력에 곱해서 쓴다.
 * defenderHpIsFull(멀티스케일용)은 안 넘기면 true(풀피)로 간주한다 — 매치업 페이지는 "현재 HP"
 * 개념이 없는 1턴 스냅샷이라 항상 풀피 취급, 배틀 시뮬레이터만 실제 HP를 넘겨준다.
 */
export function resolveAbilityDefense(
  ability: Ability | undefined,
  move: Move,
  defenderHpIsFull = true,
  defenderHasStatusCondition = false,
): number {
  if (!ability?.modifiers) return 1;
  let multiplier = 1;
  for (const modifier of ability.modifiers) {
    if (modifier.scope !== "defense") continue;
    if (!conditionMatches(modifier.condition, move, undefined, 1, defenderHpIsFull, defenderHasStatusCondition)) continue;
    multiplier *= modifier.multiplier;
  }
  return multiplier;
}

/** 자속보정 배율. 적응력이면 2.0, 그 외에는 표준 1.5 */
export function resolveStabMultiplier(ability: Ability | undefined): number {
  return ability?.stabOverride ?? 1.5;
}

/**
 * 짖궂은마음: 사용자가 이 특성을 가졌고 쓰려는 기술이 변화기(status)면 우선도가 이 값만큼
 * 오른다. 필드(getFieldAdjustedPriority)와 같은 "델타"만 반환하는 함수라 호출부가
 * move.priority(또는 이미 필드로 조정된 값)에 더해서 쓴다.
 */
export function getAbilityPriorityBoost(move: Move, ability: Ability | undefined): number {
  if (ability?.statusMovePriorityBoost && move.category === "status") return ability.statusMovePriorityBoost;
  return 0;
}

/**
 * 틀깨기가 절대 무시할 수 없는 특성 목록(본가 데이터, 세대를 거치며 계속 추가돼 지금은 이 정도로
 * 확정됐다 — 사용자 제공). 이 로스터에 아직 없는 이름도 향후 로스터 확장을 대비해 전부 넣어뒀다.
 * 정전기·불꽃몸·까칠한피부·깨어진갑옷·저주받은바디·긴장감·매지션·헤롱헤롱바디·싱크로·지구력
 * 처럼 이 목록에 없는 "반격/트리거형" 특성은 전부 틀깨기에 무시당한다.
 */
export const MOLD_BREAKER_IMMUNE_ABILITY_NAMES = new Set([
  // 4세대부터
  "갈지자걸음", "건조피부", "괴력집게", "날카로운눈", "내열", "눈숨기", "단순", "두꺼운지방", "둔감",
  "리프가드", "마그마의무장", "마이페이스", "마중물", "면역", "모래숨기", "방음", "부유", "불가사의부적",
  "불면", "수의베일", "습기", "옹골참", "유연", "의기양양", "이상한비늘", "인분", "저수", "전기엔진",
  "전투무장", "점착", "정신력", "조가비갑옷", "천진", "축전", "클리어바디", "타오르는불꽃", "플라워기프트",
  "피뢰침", "필터", "하드록", "하얀연기", "흡반",
  // 5세대부터
  // (매직미러는 본가에서 틀깨기에 무시당하므로 이 목록에서 제외 — Phase 7 §2-5)
  "라이트메탈", "멀티스케일", "미라클스킨", "부풀린가슴", "심술꾸러기", "초식", "텔레파시",
  "프렌드가드", "헤비메탈",
  // 6세대부터
  "다크오라", "방진", "방탄", "스위트베일", "아로마베일", "오라브레이크", "퍼코트", "페어리오라", "플라워베일",
  // 7세대부터
  "비비드바디", "탈", "복슬복슬", "여왕의위엄", "수포",
  // 8세대부터
  "미러아머", "아이스페이스", "얼음인분", "파스텔베일", "펑크록",
  // 9세대부터
  "테일아머", "흙먹기", "황금몸", "정화의소금", "노릇노릇바디", "바람타기",
  // 특성이 아니라 도구/기술의 "무효화 무시 불가" 축이지만 참고용으로 같이 기록된 것들
  "리밋실드", "매직가드", "메탈프로텍트", "스펙터가드", "절대안깸", "프리즘아머",
]);

/**
 * 틀깨기(공격측)를 반영해 "이번 공격에서 실제로 계산에 쓸" 방어측 특성을 돌려준다. 공격측이
 * 틀깨기가 아니거나, 방어측 특성이 예외 목록에 있으면 원래 특성 그대로 돌려준다 — 그 외에는
 * 방어측 특성이 아예 없는 것처럼(undefined) 취급한다. 이 함수가 돌려준 값을 defenderAbility로
 * 그대로 사용하면 modifiers·absorbsType·grantsImmunityToTypes·hitTrigger·blocksOpponent* 등
 * 방어측 특성을 참조하는 코드 전부가 자동으로 틀깨기를 반영하게 된다.
 */
export function resolveEffectiveDefenderAbility(
  attackerAbility: Ability | undefined,
  defenderAbility: Ability | undefined,
): Ability | undefined {
  if (!attackerAbility?.bypassesDefensiveAbilities) return defenderAbility;
  if (defenderAbility && MOLD_BREAKER_IMMUNE_ABILITY_NAMES.has(defenderAbility.name)) return defenderAbility;
  return undefined;
}
