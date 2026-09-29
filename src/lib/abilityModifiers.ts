import type { Ability, AbilityModifierCondition } from "../types/ability";
import type { Move } from "../types/move";
import type { PokemonType } from "../types/pokemon-type";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";

/** 특성 배율 조건 판정에 쓰는 전투 상황(안 넘긴 값은 매치업 페이지 기본값 — 풀피·상태이상 없음·날씨/필드 없음) */
interface ConditionContext {
  weather?: WeatherKind;
  field?: FieldKind;
  attackerHpFraction?: number;
  defenderHpIsFull?: boolean;
  defenderHasStatusCondition?: boolean;
}

function conditionMatches(condition: AbilityModifierCondition | undefined, move: Move, context: ConditionContext): boolean {
  const { weather, field, attackerHpFraction = 1, defenderHpIsFull = true, defenderHasStatusCondition = false } = context;
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
  if (condition.fieldIs !== undefined) {
    if (field !== condition.fieldIs) return false;
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
  if (condition.moveHasRecoilDamage !== undefined) {
    // 이판사판: recoilFraction(반동) 또는 crashFraction(빗나가면 자멸) 기술 — 발버둥 제외.
    const hasRecoil =
      (move.recoilFraction !== undefined || move.crashFraction !== undefined) && move.id !== "__struggle__";
    if (hasRecoil !== condition.moveHasRecoilDamage) return false;
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
    if (!conditionMatches(modifier.condition, move, { weather, attackerHpFraction })) continue;
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
  field?: FieldKind,
): number {
  if (!ability?.modifiers) return 1;
  let multiplier = 1;
  for (const modifier of ability.modifiers) {
    if (modifier.scope !== "defense") continue;
    if (!conditionMatches(modifier.condition, move, { defenderHpIsFull, defenderHasStatusCondition, field })) continue;
    multiplier *= modifier.multiplier;
  }
  return multiplier;
}

/** 자속보정 배율. 적응력이면 2.0, 그 외에는 표준 1.5 */
export function resolveStabMultiplier(ability: Ability | undefined): number {
  return ability?.stabOverride ?? 1.5;
}

/**
 * 짓궂은마음: 사용자가 이 특성을 가졌고 쓰려는 기술이 변화기(status)면 우선도가 이 값만큼
 * 오른다. 질풍날개(7세대 형식): 사용자가 풀피이고 쓰려는 기술이 비행타입이면 우선도 +1.
 * 필드(getFieldAdjustedPriority)와 같은 "델타"만 반환하는 함수라 호출부가 move.priority
 * (또는 이미 필드로 조정된 값)에 더해서 쓴다. atFullHp는 안 넘기면 true로 간주한다.
 */
export function getAbilityPriorityBoost(
  move: Move,
  ability: Ability | undefined,
  atFullHp = true,
): number {
  let boost = 0;
  if (ability?.statusMovePriorityBoost && move.category === "status") boost += ability.statusMovePriorityBoost;
  if (ability?.flyingMovePriorityBoostAtFullHp && atFullHp && move.type === "비행") boost += 1;
  return boost;
}

/**
 * 틀깨기(공격측)에 무시당하는 방어측 특성 목록(본가 — 사용자 정리 2026-09-29, 나무위키 기준). 공격측이 틀깨기면 방어측 특성이 이
 * 목록에 있을 때만 그 공격 동안 없는 것으로 친다. 목록에 없는 특성(정전기·까칠한피부 같은 반격형, 스펙터가드 등)은 그대로 작동한다.
 * 이 로스터에 아직 없는 이름도 향후 로스터 확장을 대비해 전부 넣어뒀다.
 * (ver.2.0 수정 — 이전엔 이 목록을 "무시 불가"로 거꾸로 적용해, 부유·멀티스케일·옹골참 등을 못 뚫고 반격형 특성을 무시했다.)
 * 파동의방호는 복슬복슬과 같은 취급(사용자 결정).
 * 상태이상 면역 특성(불면·유연 등)은 틀깨기 공격으로 걸린 상태이상을 턴 끝에 스스로 치료한다 — finishTurn.applyAbilityImmunityCure.
 */
export const MOLD_BREAKER_IGNORABLE_ABILITY_NAMES = new Set([
  "갈지자걸음", "건조피부", "괴력집게", "날카로운눈", "내열", "노릇노릇바디", "눈숨기", "단순", "두꺼운지방", "둔감",
  "라이트메탈", "리프가드", "마그마의무장", "마이페이스", "마중물", "매직미러", "멀티스케일", "면역", "모래숨기",
  "미라클스킨", "미러아머", "바람타기", "발광", "방음", "방진", "방탄", "복슬복슬", "부유", "부풀린가슴", "비비드바디",
  "불가사의부적", "불면", "수의베일", "수포", "스위트베일", "습기", "심술꾸러기", "심안", "아로마베일", "아이스페이스",
  "얼음인분", "여왕의위엄", "열교환", "오라브레이크", "옹골참", "유연", "의기양양", "이상한비늘", "인분", "재앙의그릇",
  "재앙의목간", "저수", "전기엔진", "전투무장", "점착", "정신력", "정화의소금", "조가비갑옷", "천정부지", "천진", "초식",
  "축전", "클리어바디", "타오르는불꽃", "탈", "테라셸", "테일아머", "텔레파시", "파동의방호", "파수견", "파스텔베일",
  "퍼코트", "펑크록", "풀모피", "프렌드가드", "플라워기프트", "플라워베일", "피뢰침", "필터", "하드록", "하얀연기",
  "헤비메탈", "황금몸", "흙먹기", "흡반",
]);

/**
 * 틀깨기(공격측)를 반영해 "이번 공격에서 실제로 계산에 쓸" 방어측 특성을 돌려준다. 공격측이 틀깨기이고 방어측 특성이
 * 무시당하는 목록에 있으면 특성이 아예 없는 것처럼(undefined), 그 외에는 원래 특성 그대로. 이 함수가 돌려준 값을
 * defenderAbility로 그대로 사용하면 modifiers·absorbsType·grantsImmunityToTypes·blocksOpponent* 등 방어측 특성을
 * 참조하는 코드 전부가 자동으로 틀깨기를 반영하게 된다.
 */
export function resolveEffectiveDefenderAbility(
  attackerAbility: Ability | undefined,
  defenderAbility: Ability | undefined,
): Ability | undefined {
  if (!attackerAbility?.bypassesDefensiveAbilities || !defenderAbility) return defenderAbility;
  return MOLD_BREAKER_IGNORABLE_ABILITY_NAMES.has(defenderAbility.name) ? undefined : defenderAbility;
}
