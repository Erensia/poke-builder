import type { PokemonType } from "./pokemon-type";
import type { MoveClassification, MoveCategory } from "./move";
import type { WeatherKind } from "./weather";
import type { FieldKind } from "./field";
import type { BattleStatKey } from "./battleStats";
import type { StatusCondition, VolatileCondition } from "./status";

/** 랭크를 이만큼(stat, delta) 바꾼다는 짧은 서술 — 여러 특성이 같은 모양을 재사용한다 */
export interface AbilityStatBoost {
  stat: BattleStatKey;
  delta: number;
}

export interface AbilityModifierCondition {
  /** 이 위력 이하인 기술만 (테크니션: 60) */
  movePowerAtMost?: number;
  /** 기술 자신의 타입이 이 목록에 있을 때만 (모래의힘: 땅/바위/강철) */
  moveTypeIn?: PokemonType[];
  /** 기술 분류 태그가 이 목록과 하나라도 겹칠 때만 (메가런처: 파동) */
  moveClassificationIn?: MoveClassification[];
  /**
   * 기술 카테고리가 이 목록에 있을 때만 (이상한비늘: physical — 본가에서 방어 실수치만 올리는
   * 특성이라 방어 스탯이 관여하는 물리 데미지에만 영향을 준다. 특수 데미지는 특방을 쓰므로 무관).
   */
  moveCategoryIn?: MoveCategory[];
  /** 이 날씨일 때만 (모래의힘: 모래바람) */
  weatherIs?: WeatherKind;
  /** 접촉기일 때만 (단단한발톱) */
  makesContact?: boolean;
  /**
   * 공격측 현재 HP가 최대 HP의 이 비율 이하일 때만(맹화·급류·심록·벌레의알림: 1/3). 매치업
   * 페이지(evaluateSlotMatchup)는 "현재 HP" 개념이 없는 1턴 스냅샷이라 항상 풀피로 간주해서
   * 이 조건이 있는 특성은 거기서는 발동하지 않는다 — 배틀 시뮬레이터(battleSimulator.ts)에서만
   * attacker.currentHp/maxHp를 실제로 넘겨준다.
   */
  attackerHpAtMostFraction?: number;
  /**
   * 방어측 현재 HP가 최대 HP와 정확히 같을 때(=풀피)만(멀티스케일). 매치업 페이지
   * (evaluateSlotMatchup)는 "현재 HP" 개념이 없는 1턴 스냅샷이라 항상 풀피로 간주해서
   * 이 조건은 거기서는 항상 발동한다 — attackerHpAtMostFraction과 반대 방향의 기본값이다.
   * 배틀 시뮬레이터(battleSimulator.ts)에서만 defender.currentHp === defender.maxHp를 실제로 넘겨준다.
   */
  defenderHpIsFull?: boolean;
  /**
   * 방어측이 주 상태이상(화상/마비/독/잠듦/얼음 중 하나)에 걸려 있을 때만(이상한비늘). 매치업
   * 페이지(evaluateSlotMatchup)는 "현재 상태이상" 개념이 없는 1턴 스냅샷이라 항상 상태이상 없음
   * (false)으로 간주해서 이 조건은 거기서는 발동하지 않는다 — defenderHpIsFull과 반대 방향의
   * 기본값이다. 배틀 시뮬레이터(battleSimulator.ts)에서만 defender.status.condition !== null을
   * 실제로 넘겨준다.
   */
  defenderHasStatusCondition?: boolean;
}

export interface AbilityModifier {
  scope: "offense" | "defense";
  /** 조건을 만족하면 곱해지는 배율 */
  multiplier: number;
  condition?: AbilityModifierCondition;
  /** offense 전용. 조건을 만족하면 기술의 실제 타입을 이걸로 바꿔서 자속/상성을 계산 (페어리스킨) */
  overrideMoveType?: PokemonType;
}

/**
 * 방어측이 기술에 맞았을 때(주로 접촉) 발동하는 특성 하나를 기술한다(정전기·불꽃몸·까칠한피부·
 * 깨어진갑옷·저주받은바디 공용 훅 — Phase 5 §1). 데미지를 실제로 준(damage > 0) 피격에만 판정하고,
 * 효과는 전부 "이 특성을 가진 쪽"이 방어측일 때만 적용된다.
 */
export interface AbilityHitTrigger {
  /**
   * 발동 조건 — 각 특성의 설명 텍스트를 그대로 축으로 나눴다:
   *  - "physicalContact": 물리 접촉기만 (정전기·불꽃몸 = "물리 접촉을 받으면")
   *  - "contact": 카테고리 무관 접촉기 전체 (까칠한피부 = "접촉기로 공격해 온")
   *  - "physical": 물리기 전체, 접촉 여부 무관 (깨어진갑옷 = "물리 공격을 받으면")
   *  - "damaging": 데미지를 준 모든 기술 (저주받은바디 = "공격을 받으면")
   */
  on: "physicalContact" | "contact" | "physical" | "damaging";
  /** 기술 자신의 타입이 이 목록에 있을 때만(정의의마음: 악타입) — 생략하면 타입 무관 */
  moveTypeIn?: PokemonType[];
  /** 발동 확률(%). 생략하면 100% 확정(까칠한피부·깨어진갑옷) */
  chance?: number;
  /** 공격자에게 이 주 상태이상을 건다(정전기=마비, 불꽃몸=화상). 타입 면역·중첩 규칙은 기존 inflictStatus/isImmuneToStatus를 그대로 재사용 */
  inflictsStatusOnAttacker?: StatusCondition;
  /** 공격자에게 이 행동방해(volatile) 효과를 건다(헤롱헤롱바디=attract) */
  inflictsVolatileOnAttacker?: VolatileCondition;
  /**
   * inflictsVolatileOnAttacker가 attract일 때만 의미 있음 — 방어측(이 특성 소유자)과 공격측이
   * 이성 관계일 때만(getEffectiveGender 기준) 발동한다. 무성별이거나 동성이면 조용히 무산된다.
   */
  requiresOppositeGender?: boolean;
  /** 공격자에게 자신(방어측)의 최대 HP 이 비율만큼 고정 데미지를 준다(까칠한피부: 1/8 = 0.125) */
  damagesAttackerFraction?: number;
  /** 자신(방어측)의 랭크를 이 목록만큼 바꾼다(깨어진갑옷: 방어 -1, 스피드 +2) */
  selfStatChanges?: { stat: BattleStatKey; delta: number }[];
  /** 공격자가 방금 사용한 기술의 남은 PP를 0으로 만든다(저주받은바디 — "사슬묶기" 텍스트를 PP 0 봉인으로 구현) */
  disablesAttackerMove?: boolean;
}

/**
 * 타오르는불꽃·피뢰침처럼 "이 타입 기술에 맞으면 데미지를 완전히 무효화하고 대신 이득을 본다"는
 * 특성 하나를 기술한다 — bypassesImmunityForTypes(공격측이 상대 면역을 무시)의 정반대 방향으로,
 * 방어측이 원래 없던 면역을 스스로 얻는다. moveContext.ts에서 typeEffectiveness를 무조건 0으로
 * 덮어쓰고, battleSimulator.ts가 명중한 시점(카테고리 무관 — 상태이상 기술도 흡수한다)에 아래
 * 효과를 적용한다. 정전기 등 hitTrigger와 달리 damage > 0을 요구하지 않는다(애초에 데미지가 없다).
 */
export interface AbilityTypeAbsorb {
  /** 이 타입의 기술을 완전히 무효화한다 */
  type: PokemonType;
  /** 무효화한 그 즉시 자신의 랭크를 이 목록만큼 바꾼다(피뢰침: 특공 +1) */
  selfStatChanges?: { stat: BattleStatKey; delta: number }[];
  /**
   * 타오르는불꽃처럼, 무효화한 이후로 배틀이 끝날 때까지(1v1이라 교체로 초기화될 일이 없음) 자신이
   * 쓰는 이 타입(=absorbsType.type과 동일) 기술의 위력을 이 배수로 올린다. 실제 활성화 여부는
   * BattleFighterState.ownMoveTypeBoosts 런타임 플래그로 추적한다 — 정적 데이터만 다루는
   * AbilityModifier로는 "배틀 중 발동한 적 있는지"를 표현할 수 없어 별도 필드로 분리했다.
   */
  boostsOwnMoveTypeMultiplier?: number;
  /** 저수처럼, 무효화한 그 즉시 자신의 최대 HP 이 비율만큼 회복한다(1/4). 랭크업 대신 회복인 케이스. */
  healsFraction?: number;
}

export interface Ability {
  id: string;
  name: string;
  description: string;
  /** 결정력/내구력 계산에 자동으로 반영할 수 있는 배율들. 없으면 생략 */
  modifiers?: AbilityModifier[];
  /** 자속보정 배율 자체를 바꾸는 특성 전용 (적응력: 1.5 → 2.0) */
  stabOverride?: number;
  /** 가뭄/잔비/모래날림처럼 등장하면 날씨를 바꾸는 특성만 채운다 */
  setsWeather?: WeatherKind;
  /**
   * 배짱처럼 "이 타입 목록에 있는 자신의 기술은 상대의 타입 면역(0배)을 무시하고 등배로 맞힌다"는
   * 특성만 채운다(배짱=[노말, 격투] → 고스트타입 상대에게도 명중). 면역만 없앨 뿐 반감/2배 관계는
   * 그대로 존중한다 — moveContext.ts에서 typeEffectiveness가 정확히 0일 때만 1로 덮어쓴다.
   */
  bypassesImmunityForTypes?: PokemonType[];
  /** 방어측으로 피격당했을 때 발동하는 특성만 채운다(정전기·불꽃몸·까칠한피부·깨어진갑옷·저주받은바디) */
  hitTrigger?: AbilityHitTrigger;
  /** 특정 타입 기술을 완전히 무효화하는 특성만 채운다(타오르는불꽃·피뢰침) */
  absorbsType?: AbilityTypeAbsorb;
  /**
   * 옹골참: 최대 HP 상태에서 기절할 데미지를 받으면 HP 1을 남기고 버틴다. 기합의띠
   * (Item.survivesLethalAtFullHpOnce)와 조건은 똑같지만, 도구와 달리 소모되지 않아 대전 중
   * 몇 번이든(그때마다 다시 풀피여야) 반복 발동한다.
   */
  survivesLethalAtFullHp?: boolean;
  /**
   * 엽록소(쾌청)·쓱쓱(비)·모래헤치기(모래바람)처럼 특정 날씨일 때 스피드가 배로 뛰는 특성만
   * 채운다. 구애스카프(Item.speedMultiplier)와 같은 축에서 곱해진다.
   */
  weatherSpeedMultiplier?: { weather: WeatherKind; multiplier: number };
  /**
   * 젖은접시처럼 특정 날씨가 활성화된 동안 매 턴 종료 시 최대 HP의 1/denominator를 회복하는
   * 특성만 채운다(먹다남은음식과 같은 축이지만 날씨 조건이 붙는다). 선파워는 원문 설명("쾌청
   * 상태일 때 특수공격이 1.5배로 증가한다")에 본가의 "매턴 HP 1/8 소모" 페널티가 아예 없어서,
   * 그 페널티는 이 로스터에서 구현하지 않는다 — offense modifier(moveCategoryIn: ["special"])만으로 충분.
   */
  weatherEndOfTurnHealDenominator?: { weather: WeatherKind; denominator: number };
  /**
   * 모래숨기: 특정 날씨 동안 상대의 명중률에 곱해지는 배율(회피율 20% 상승 = 상대 명중률
   * 0.8배와 동치). 반짝가루(Item.opponentAccuracyMultiplier)와 같은 축으로, extraMultiplier에
   * 곱해진다 — 랭크 기반 회피율(accuracyStages.evasion)과는 별개 축이라 중첩 가능.
   */
  weatherOpponentAccuracyMultiplier?: { weather: WeatherKind; multiplier: number };
  /**
   * 승기: 자신의 능력치가(무엇이든, 자기 기술 자기 랭크변화든 상대 기술로 내려갔든) 하락하면
   * 그 즉시 이 랭크변화가 붙는다(승기: 특공 +2). battleSimulator.ts가 자신/상대 양쪽
   * statChanges 적용 전후로 랭크를 비교해서 실제로 내려간 스탯이 하나라도 있을 때만 발동시킨다
   * (이미 -6으로 클램프돼 있어 실질적으로 변화가 없었으면 발동하지 않음).
   */
  boostsStatOnOwnStatDrop?: AbilityStatBoost;
  /**
   * 불굴의마음: 풀죽음 상태가 될 때마다(원문 그대로 — 어느 기술/도구로 걸렸든) 이 랭크변화가
   * 붙는다(불굴의마음: 스피드 +1, 본가 "오기"와 동일 수치로 채움 — 원문에 배율이 없어 표준값 사용).
   */
  boostsStatOnFlinch?: AbilityStatBoost;
  /** 자기과신: 자신이 데미지를 줘서 상대를 쓰러뜨릴 때마다 이 랭크변화가 붙는다(공격 +1). */
  boostsStatOnKo?: AbilityStatBoost;
  /**
   * 부유: 이 타입 목록의 기술을 완전히 무효화한다(부유=[땅]). `bypassesImmunityForTypes`
   * (공격측이 상대의 원래 타입 면역을 무시)의 반대 방향으로, 방어측이 원래 없던 면역을 스스로
   * 얻는다 — absorbsType과 달리 랭크업 등 부가 이득은 없는 순수 면역이다. 검은철구
   * (Item.groundsHolder)나 미래의 틀깨기류(공격측이 방어측 특성 자체를 무시)로 뚫릴 수 있어야
   * 해서, moveContext.ts는 기존 bypassImmunity 판정이 참이면 이 필드를 무시한다.
   */
  grantsImmunityToTypes?: PokemonType[];
  /** 유연: 이 상태이상 목록에 면역이다(타입 기반 면역과 별개 축). 유연=["paralysis"] */
  immuneToStatuses?: StatusCondition[];
  /**
   * 정신력: 풀죽음에 면역이다. 원문에 "위협의 효과를 받지 않는다"도 있지만 위협(등장 시 효과)
   * 자체가 이 로스터에 아직 없어 그 절반은 적용 대상이 없다.
   */
  immuneToFlinch?: boolean;
  /**
   * 클리어바디(전체)·괴력집게(공격만)처럼 상대의 기술로 자신의 능력치가 떨어지는 걸 막는다.
   * 비워두면(undefined) 이 특성은 아무 스탯도 막지 않는다. 클리어바디는 5스탯 전부,
   * 괴력집게는 `["atk"]`만 채운다. 자기 기술로 자기 스탯을 내리는 것(칼춤 등)은 막지 않는다 —
   * "상대의 기술이나 특성으로"라는 원문 조건 그대로.
   */
  blocksOpponentStatDropsForStats?: BattleStatKey[];
  /**
   * 미러아머: 상대의 기술로 자신의 능력치가 떨어지려 하면, 자신은 그대로 두고 그 하락을 상대에게
   * 똑같이 되돌려준다(클리어바디처럼 "막기만" 하는 게 아니라 "반사"). blocksOpponentStatDropsForStats와
   * 동시에 채우지 않는다 — 하나의 특성은 막거나 반사하거나 둘 중 하나.
   */
  reflectsOpponentStatDrops?: boolean;
  /**
   * 싱크로: 자신이 이 목록의 상태이상에 걸리면(원인 무관 — 상대 기술이든 상대 특성이든) 그 즉시
   * 원인 제공자(이번 행동의 공격측)에게도 같은 상태이상을 건다. 상대가 타입/특성으로 면역이면
   * 조용히 무산된다(기존 isImmuneToStatus 재사용).
   */
  reflectsStatusToOpponent?: StatusCondition[];
  /** 탈피: 턴 종료 시 이 확률(%)로 자신의 주 상태이상을 치료한다. */
  curesOwnStatusChance?: number;
  /** 날카로운눈: 상대의 기술로 자신의 명중률이 떨어지지 않는다. */
  blocksOpponentAccuracyDrops?: boolean;
  /** 날카로운눈: 공격할 때 상대의 회피율 "상승분"을 무시한다(마이너스 회피율은 그대로 존중). */
  ignoresOpponentEvasionBoost?: boolean;
  /** 노가드: 자신이 관여하는 모든 기술(자신이 쓰든, 자신이 맞든)이 명중률/회피율과 무관하게 반드시 명중한다. */
  alwaysHits?: boolean;
  /**
   * 황금몸: 상대가 사용하는 변화기(카테고리 status)의 효과가 자신에게 걸리지 않는다. 상태이상
   * 부여·행동방해(풀죽음 등, target이 "opponent"인 것만)·랭크/명중회피/급소 하락이 전부 무산된다.
   * 필드 전역 효과(날씨·필드·트릭룸)나 상대가 자기 자신에게 거는 효과(자기 스탯 상승, 반동 예약)는
   * "이 포켓몬을 겨냥한" 게 아니라서 영향받지 않는다.
   */
  blocksOpponentStatusMoveEffects?: boolean;
  /**
   * 위협: 배틀에 등장하면(=createBattleState 시점) 상대의 이 스탯을 즉시 낮춘다(위협: atk, -1).
   * 가뭄류(setsWeather)와 같은 "등장 시 1회" 축이지만 날씨가 아니라 상대 랭크를 직접 건드리는
   * 경우라 별도 필드로 분리했다. resolveEntryAbilityEffects에서 적용한다.
   */
  lowersOpponentStatOnEntry?: { stat: BattleStatKey; delta: number };
  /** 일렉트릭메이커: 배틀에 등장하면 이 필드를 편다(이미 다른 필드가 있으면 실패). */
  setsFieldOnEntry?: FieldKind;
  /**
   * 트레이스: 배틀에 등장하면 상대의 특성을 그대로 복사해 이후 자신의 effectiveAbilityId가
   * 상대 것과 같아진다. 실제 게임처럼 일부 특성(다중특성·자기 자신 등)을 복사 제외하는 예외
   * 목록은 없다 — 그런 특성을 복사해도 이 시뮬레이터에서는 대부분 조용히 아무 효과가 없다
   * (예: 배틀스위치는 Pokemon.stanceChangeForms가 있어야 실제로 발동하는데, 특성만 복사해서는
   * 그 데이터가 안 따라오므로 자연히 무해하다).
   */
  copiesOpponentAbilityOnEntry?: boolean;
  /** 긴장감: 상대가 나무열매(도구)를 전혀 사용하지 못하게 한다. */
  preventsOpponentBerries?: boolean;
  /**
   * 습기: 자신이나 상대 중 누구든 이 특성이 있으면, 자폭류 기술(Move.selfFaints)을 양쪽 다
   * 사용할 수 없다(usageCondition과 같은 "시도 자체가 막힘" 축).
   */
  preventsSelfFaintMoves?: boolean;
  /** 짖궂은마음: 자신이 쓰는 변화기(카테고리 status)의 우선도를 이 값만큼 올린다(사이코필드 차단 판정에도 반영). */
  statusMovePriorityBoost?: number;
  /** 틈새포착: 자신이 공격할 때 상대의 스크린(리플렉터/빛의장막)과 대타출동을 전부 무시한다. */
  bypassesScreensAndSubstitute?: boolean;
  /**
   * 천진: 데미지 계산에서 상대의 능력 랭크 변화를 전부 무시한다 — 공격할 때는 상대(방어측)의
   * 방어/특방 랭크를, 공격받을 때는 상대(공격측)의 공격/특공 랭크를 항상 0랭크로 취급한다.
   * 원문("공격·방어 시 상대의 능력 랭크 변화를 무시")대로 등장 시 1회가 아니라 상시 발동 —
   * 매 데미지 계산마다 이 특성을 가진 쪽 기준으로 상대 쪽 랭크만 무시한다.
   */
  ignoresOpponentStatStagesInDamage?: boolean;
  /** 부자유친: 데미지를 준 공격 직후, 같은 기술로 이 배율만큼의 위력으로 추가타를 한 번 더 날린다. */
  followUpHitPowerMultiplier?: number;
  /**
   * 관통드릴: 접촉기를 쓸 때 상대의 방어/특방 랭크 "상승분"을 무시하고(마이너스는 그대로 페널티로
   * 적용 — 날카로운눈의 회피율 처리와 같은 패턴), 최종 데미지가 상대 최대 HP의 이 비율보다
   * 낮으면 그 비율만큼으로 끌어올린다(최소 데미지 보장).
   */
  contactIgnoresDefenseBoostAndGuaranteesMinDamageFraction?: number;
  /** 프레셔: 상대가 이 포켓몬을 대상으로 기술을 쓸 때마다 PP를 이 값만큼 추가로 더 소모시킨다. */
  extraPpCostWhenTargeted?: number;
  /**
   * 서투름: 자신이 지닌 도구의 전투 효과(나무열매·초식보정·스크린지속 등 attackerItem/defenderItem
   * 기반 전부)가 무효화된다. 메가스톤에 의한 폼 변화는 도구 "효과"가 아니라 별도 축(pokemonForm.ts)
   * 이라 영향받지 않는다 — 실제 게임과 동일.
   */
  disablesOwnItemEffects?: boolean;
  /**
   * 틀깨기: 공격할 때 상대의 방어적 특성 효과를 무시한다(예외 목록 제외 — abilityModifiers.ts의
   * `MOLD_BREAKER_IMMUNE_ABILITY_NAMES`에 있는 특성은 여전히 정상 작동한다). 실제 게임에서도
   * 세대를 거치며 예외가 계속 늘어났고(멀티스케일·부유·클리어바디·천진·유연·저수·타오르는불꽃·
   * 피뢰침·황금몸 등은 전부 무시 불가), 남는 건 정전기·불꽃몸·까칠한피부·깨어진갑옷·저주받은바디·
   * 저수(예외 목록에 있음 — 오타 아님, 실제로 무시 불가) 같은 소수뿐이다(사용자 확인).
   */
  bypassesDefensiveAbilities?: boolean;
  /**
   * 우격다짐: 부가 효과(상대에게 해로운 상태이상/행동방해/랭크다운, 또는 자신에게 이로운 랭크업)가
   * 있는 데미지 기술에서 그 효과를 전부 없애는 대신 위력에 이 배수를 곱한다(우격다짐: 1.3). 반동
   * (recoilFraction)·자기 디메리트(자기 랭크다운·행동불능 예약 등 target:"self"이면서 이롭지
   * 않은 것)는 "부가 효과"가 아니라서 그대로 유지된다 — 플레어드라이브가 반동은 그대로 받으면서
   * 화상만 사라지고 위력이 오르는 것과 같은 축(사용자 확인). 도구 상호작용(생명의구슬 반동 면제
   * 등)까지는 반영하지 않았다.
   */
  tradesSecondaryEffectForPower?: number;
  /**
   * 매지션: 데미지를 주는 기술로 상대를 실제로 맞혔을 때, 자신이 무도구 상태면 그 자리에서
   * 상대가 지닌 도구를 빼앗는다(자신은 그 도구를 얻고, 상대는 무도구가 된다). 자신이 이미
   * 도구를 지녔으면 발동하지 않는다(본가 규칙 — "자신이 도구를 갖고 있지 않으면"). 이 프로젝트의
   * 파티 슬롯 원본(slot.item)은 그대로 두고, BattleFighterState.currentItemId(배틀 중 실제로
   * 지닌 도구를 추적하는 런타임 필드)만 갈아치운다 — 도구 강탈은 파티 구성이 아니라 이 배틀
   * 한정 상태 변화이기 때문. 매치업 페이지(1턴 스냅샷)는 도구 강탈이 일어날 "이전 턴"이 없는
   * 구조라 적용하지 않는다.
   */
  stealsItemOnDamagingHit?: boolean;
  /**
   * 곡예: 지닌 도구가 소모되거나(나무열매 등 1회용 효과 발동) 매지션 등에게 빼앗겨 없어지는
   * "그 순간" 발동해서, 이후 배틀이 끝날 때까지 스피드가 2배로 유지된다. 특성 자체엔 "상시
   * 배율"이 아니라 "그 이후부터 계속"이라는 조건이 있어 정적 배율(weatherSpeedMultiplier 등)만
   * 으로는 표현이 안 돼서, BattleFighterState.unburdenActive라는 별도 런타임 플래그로
   * 한 번 켜지면 배틀 끝까지 유지되도록 추적한다(ownMoveTypeBoosts와 같은 패턴).
   *
   * 본가에서는 정확히는 "교체하기 전까지" 유지되고 교체하면 초기화되는데, 이 시뮬레이터는
   * 교체가 없는 1v1이라 "교체 전까지"와 "배틀이 끝날 때까지"가 사실상 같은 조건이 된다(교체
   * 이벤트 자체가 없어 초기화될 일이 없음) — 타오르는불꽃(absorbsType.boostsOwnMoveTypeMultiplier)이
   * 배틀 끝까지 유지되는 것과 같은 이유.
   */
  doublesSpeedOnItemLoss?: boolean;
  /**
   * 변환자재: 기술을 실제로 쓸 때마다(명중 여부·카테고리 무관, 타입이 없는 발버둥 등은 예외)
   * 그 기술과 같은 타입으로 자신의 타입이 바뀐다(사용자 확인 — "배틀에 나올 때 단 한 번"이 아니라
   * 기술을 낼 때마다 매번). BattleFighterState.types를 그 자리에서 실제로 갈아치우기 때문에,
   * 이번 턴 자속 판정뿐 아니라 다음 턴 이 포켓몬이 방어측이 될 때(타입 상성 계산)까지 전부
   * 새 타입이 반영된다.
   */
  changesUserTypeToMoveType?: boolean;
}
