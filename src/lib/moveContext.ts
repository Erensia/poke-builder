import type { Ability } from "../types/ability";
import type { Item } from "../types/item";
import type { Move } from "../types/move";
import type { PokemonType } from "../types/pokemon-type";
import type { WeatherKind } from "../types/weather";
import { resolveAbilityOffense, resolveAbilityDefense, resolveStabMultiplier } from "./abilityModifiers";
import { getEffectiveness } from "./typeEffectiveness";

/**
 * 기술 하나가 공격측→방어측으로 나갈 때 항상 필요한 배율/실효 기술을 한 번에 계산한다.
 * evaluateSlotMatchup(1턴 스냅샷 판정)과 battleSimulator의 resolveAction(다중 턴 엔진)이
 * 둘 다 "특성 배율 + 타입 변경 + 자속 + 상대 타입 상성"을 똑같이 구해야 해서, 이 계산을
 * 한 곳으로 모아 양쪽이 재사용하게 만들었다 — Phase 1.5 문서에 적어뒀던 "evaluateSlotMatchup을
 * 재사용 가능하게 설계"를 실제로 지키는 지점.
 */
export interface MoveContext {
  /** 특성으로 타입이 바뀌었으면(페어리스킨 등) 그 타입이 반영된 기술. 안 바뀌었으면 원본과 동일 */
  effectiveMove: Move;
  /** 공격측 특성이 이 기술에 주는 배율 (테크니션/모래의힘/메가런처 등) */
  abilityOffenseMultiplier: number;
  /** 방어측 특성이 이 기술을 받을 때 주는 배율 (두꺼운지방 등) */
  abilityDefenseMultiplier: number;
  /** 자속보정 배율. 기본 1.5, 적응력이면 2.0 */
  stabMultiplier: number;
  /** 상대 타입 상성 배율 (0/0.25/0.5/1/2/4). 기술에 타입이 없으면(필드기 등) 1 */
  typeEffectiveness: number;
  /** 타오르는불꽃/피뢰침처럼 방어측 특성(absorbsType)이 이 기술 타입을 통째로 무효화했으면 true */
  absorbedByDefenderAbility: boolean;
  /** 방음: 방어측이 이 소리 기술을 완전히 무효화했으면 true (데미지 0 + 상대 방향 효과 전부 차단) */
  blockedBySoundproof: boolean;
  /** 방탄: 방어측이 이 구슬·폭탄 기술을 완전히 무효화했으면 true (방음과 동일 처리) */
  blockedByBulletproof: boolean;
}

export function resolveMoveContext(
  attackerAbility: Ability | undefined,
  move: Move,
  defenderTypes: PokemonType[],
  defenderAbility: Ability | undefined,
  weather?: WeatherKind,
  defenderItem?: Item,
  /** 맹화·급류·심록·벌레의알림(HP 1/3 이하 조건)용. 안 넘기면 풀피로 간주(매치업 페이지 기본값) */
  attackerHpFraction?: number,
  /** 멀티스케일(HP 풀피 조건)용. 안 넘기면 풀피로 간주(매치업 페이지 기본값) */
  defenderHpIsFull = true,
  /** 이상한비늘(상태이상 조건)용. 안 넘기면 상태이상 없음으로 간주(매치업 페이지 기본값) */
  defenderHasStatusCondition = false,
): MoveContext {
  const abilityOffense = resolveAbilityOffense(attackerAbility, move, weather, attackerHpFraction);
  const effectiveMove = abilityOffense.overrideMoveType ? { ...move, type: abilityOffense.overrideMoveType } : move;

  // 페어리오라(오라): 공격측·방어측 중 한쪽이라도 이 특성을 지녔고, 이 기술의 (타입 변경 반영 후)
  // 타입이 오라 타입과 같으면 위력 배율을 추가로 곱한다. 양쪽이 서로 다른 오라를 지녀도 타입만
  // 맞으면 각자 적용 — 곱으로 중첩한다.
  const auraMultiplier = effectiveMove.type
    ? [attackerAbility, defenderAbility].reduce(
        (acc, a) =>
          a?.auraMoveTypeMultiplier?.type === effectiveMove.type ? acc * a.auraMoveTypeMultiplier.multiplier : acc,
        1,
      )
    : 1;
  let abilityDefenseMultiplier = resolveAbilityDefense(
    defenderAbility,
    effectiveMove,
    defenderHpIsFull,
    defenderHasStatusCondition,
  );
  const stabMultiplier = resolveStabMultiplier(attackerAbility);

  // 배짱처럼 특정 타입의 면역만 무시하는 특성(공격측)이거나, 검은철구처럼 방어측이 스스로 땅타입
  // 면역을 무시하는 도구를 지녔을 때. 방어측이 2타입이면 면역을 준 타입 쪽 배율만 1로 무시되고,
  // 다른 타입의 반감/약점 배율은 그대로 곱해진다(getEffectiveness에 위임 — 예: 고스트/독에게
  // 격투 → 0.5배, 고스트/악에게 격투 → 2배. 전체를 1배로 뭉개면 안 됨).
  const bypassImmunity =
    !!(effectiveMove.type && attackerAbility?.bypassesImmunityForTypes?.includes(effectiveMove.type)) ||
    (effectiveMove.type === "땅" && !!defenderItem?.groundsHolder);

  // 타오르는불꽃/피뢰침: bypassImmunity(공격측이 상대 면역을 무시)와 정반대로, 방어측이 원래
  // 없던 면역을 스스로 얻는다. 상성표를 거치지 않고 무조건 0배로 덮어쓴다 — 카테고리 무관(상태이상
  // 기술도 흡수). 틀깨기류(공격측이 방어측 특성 자체를 무시)는 아직 이 로스터에 없어 충돌을
  // 고려하지 않았다(Phase 5 §1 잔여 항목, 나중에 붙이면 여기서 우선순위를 다시 봐야 함).
  const absorbedByDefenderAbility = !!(effectiveMove.type && effectiveMove.type === defenderAbility?.absorbsType?.type);
  // 부유: 방어측이 원래 없던 면역을 스스로 얻는다(bypassImmunity와 반대 방향). bypassImmunity가
  // 이미 참이면(배짱류·검은철구) 이 면역은 뚫린 것으로 취급 — 위 두 경로가 이 필드보다 우선한다.
  const grantsImmunity = !!(
    effectiveMove.type &&
    defenderAbility?.grantsImmunityToTypes?.includes(effectiveMove.type) &&
    !bypassImmunity
  );
  // 프리즈드라이: 상대가 이 타입이면 상성표를 무시하고 강제로 이 배율을 쓴다. 단, 방어측이
  // 스스로 얻은 완전 면역(absorbsType·grantsImmunityToTypes)이 이미 걸려있으면 면역이 우선이다
  // — 저수 같은 특성을 가진 물타입 상대에게 프리즈드라이를 써도 여전히 무효화돼야 한다.
  const typeEffectivenessOverride =
    !absorbedByDefenderAbility &&
    !grantsImmunity &&
    effectiveMove.overridesTypeEffectivenessFor &&
    defenderTypes.includes(effectiveMove.overridesTypeEffectivenessFor.type)
      ? effectiveMove.overridesTypeEffectivenessFor.effectiveness
      : undefined;

  // 방음: 소리 기술(classification "소리")은 데미지기·변화기 모두 방어측에게 통하지 않는다.
  const blockedBySoundproof = !!(
    defenderAbility?.blocksSound && (effectiveMove.classification ?? []).includes("소리")
  );
  // 방탄: 구슬·폭탄 기술(tags "구슬"/"폭탄")은 데미지기·변화기 모두 방어측에게 통하지 않는다.
  const blockedByBulletproof = !!(
    defenderAbility?.blocksBallBomb &&
    (effectiveMove.tags ?? []).some((t) => t === "구슬" || t === "폭탄")
  );

  const typeEffectiveness = absorbedByDefenderAbility
    ? 0
    : grantsImmunity
      ? 0
      : blockedBySoundproof || blockedByBulletproof
        ? 0
        : typeEffectivenessOverride !== undefined
          ? typeEffectivenessOverride
          : effectiveMove.type
            ? getEffectiveness(effectiveMove.type, defenderTypes, { bypassImmunity }) *
              (effectiveMove.additionalType
                ? getEffectiveness(effectiveMove.additionalType, defenderTypes, { bypassImmunity })
                : 1)
            : 1;

  // 하드록/필터/프리즘아머: 효과가 굉장한(상성 > 1) 공격이면 데미지를 이 배율(0.75)로 줄인다.
  // abilityDefenseMultiplier는 "내구력 배율"이라 데미지는 그 역수 — 데미지 ×0.75 = 내구력 ÷0.75.
  if (defenderAbility?.reducesSuperEffectiveDamageMultiplier !== undefined && typeEffectiveness > 1) {
    abilityDefenseMultiplier /= defenderAbility.reducesSuperEffectiveDamageMultiplier;
  }

  return {
    effectiveMove,
    abilityOffenseMultiplier: abilityOffense.multiplier * auraMultiplier,
    abilityDefenseMultiplier,
    stabMultiplier,
    typeEffectiveness,
    absorbedByDefenderAbility,
    blockedBySoundproof,
    blockedByBulletproof,
  };
}
