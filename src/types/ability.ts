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
  /**
   * 이판사판: 기술이 "자신도 데미지를 입는" 반동기일 때만(recoilFraction 또는 crashFraction이
   * 있는 기술 — 단 발버둥은 제외). 위력 ×1.2.
   */
  moveHasRecoilDamage?: boolean;
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
  /**
   * 미끈미끈(Gooey)·점착: 접촉기로 피격당하면 공격자의 이 랭크를 바꾼다(미끈미끈=스피드 -1).
   * selfStatChanges가 "이 특성 소유자(방어측)"의 랭크를 바꾸는 것과 방향이 반대 — 공격자 랭크를
   * 건드린다. 심술꾸러기(공격자 쪽)·클리어바디류(공격자 쪽)는 그대로 존중한다. on:"contact"와 함께 쓴다.
   */
  attackerStatChanges?: { stat: BattleStatKey; delta: number }[];
  /**
   * 나쁜손버릇: 접촉기로 공격당하면 공격자가 지닌 도구를 빼앗는다. 매지션(stealsItemOnDamagingHit)과
   * 방향이 정반대로, 피격측(이 특성 소유자)이 무도구일 때만 발동한다. on:"contact"와 함께 쓴다.
   */
  stealsAttackerItem?: boolean;
  /**
   * 미라(Mummy): 접촉기로 피격당하면 그 공격자의 특성을 이 id(="미라")로 바꾼다. on:"contact"와
   * 함께 쓴다. 대타·면역 피격 시엔 무발동(triggerAbilityHitEffect 진입부 가드 공유).
   */
  setsAttackerAbilityId?: string;
  /**
   * 떠도는영혼(Wandering Spirit): 접촉기로 피격당하면 공격자와 특성(effectiveAbilityId)을 서로
   * 맞바꾼다. 미라(setsAttackerAbilityId)의 양방향 스왑 버전 — 이 포켓몬은 공격자의 특성을 얻고,
   * 공격자는 떠도는영혼을 얻는다. on:"contact"와 함께 쓴다.
   */
  swapsAbilityWithAttacker?: boolean;
  /**
   * 모래뿜기(Sand Spit): 데미지를 주는 기술로 피격당하면 날씨를 이 값(모래바람)으로 바꾼다(5턴).
   * 가뭄류(setsWeather 상시 필드)와 달리 "맞을 때마다" 발동한다. on:"damaging"와 함께 쓴다.
   */
  setsWeather?: WeatherKind;
  /**
   * 유폭(Aftermath): 접촉기로 이 포켓몬이 쓰러진 그 순간, 공격자에게 공격자 최대 HP의 이 비율만큼
   * 데미지를 준다. 까칠한피부(damagesAttackerFraction)와 달리 "쓰러졌을 때만" 1회. 매직가드
   * 공격자에겐 무효. on:"contact"와 함께 쓴다.
   */
  damagesContactAttackerFractionOnFaint?: number;
  /**
   * 내용물분출(포챔스판 우츠보트-메가): 기술로 이 포켓몬이 쓰러진 그 순간, 그 마지막 타를 맞기
   * "직전"에 남아 있던 HP만큼을 공격자에게 데미지로 되돌린다(유폭이 최대 HP 비율 고정인 것과 달리
   * 그때그때 남아 있던 실 HP). 매직가드 공격자에겐 무효. on:"damaging"과 함께 쓴다.
   */
  damagesAttackerByRemainingHpOnFaint?: boolean;
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
  /** 방어측으로 피격당했을 때 발동하는 특성만 채운다(정전기·불꽃몸·까칠한피부·깨어진갑옷·저주받은바디·나쁜손버릇) */
  hitTrigger?: AbilityHitTrigger;
  /**
   * 통찰: 배틀에 등장하는 그 순간(=1대1 전용이라 첫 턴 시작) 상대가 지닌 도구를 UI 로그로 알린다.
   * 배틀 수치에는 영향이 없는 정보 표시 전용 효과 — resolveEntryAbilityEffects에서 처리한다.
   */
  revealsOpponentItemOnEntry?: boolean;
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
   * 복안: 자신이 쓰는 기술의 명중률에 곱해지는 배율(복안=1.3). weatherOpponentAccuracyMultiplier
   * (모래숨기, 방어측)와 같은 extraMultiplier 축이지만 방향이 반대 — 공격측이 지녔을 때 자기
   * 명중률을 올린다. 필중기(accuracy=null)는 computeHitChance가 그대로 null을 돌려줘 영향 없음.
   */
  userAccuracyMultiplier?: number;
  /**
   * 페어리오라(오라): 필드에 있는 아무 포켓몬(자신이든 상대든)이 이 특성을 지녔으면, 해당 타입
   * (페어리오라=페어리) 기술 전체의 위력에 이 배율이 곱해진다 — 공격측/방어측 어느 쪽이 지녔는지
   * 무관한 "장 전체" 효과라 modifiers(공격측 전용)로는 표현할 수 없어 별도 필드로 뒀다.
   * resolveMoveContext가 attackerAbility·defenderAbility 양쪽을 보고 offense 배율에 합친다.
   * (본가 오라브레이크는 이 로스터에 대상이 없어 미구현.)
   */
  auraMoveTypeMultiplier?: { type: PokemonType; multiplier: number };
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
   * 플라워베일(Flower Veil): 자신이 **풀타입일 때만** 상대의 기술/특성으로 인한 랭크 하락과 주
   * 상태이상을 전부 막는다(클리어바디 5스탯 + 유연 전체 상태이상을 합친 효과). 본가는 자기 편
   * 다른 풀타입까지 보호하지만, 3v3 싱글 교체(Phase 8)에서는 필드에 동시 아군이 없어 보유자
   * 자신만 대상이 된다. 플라엣테는 페어리라 실제로는 발동하지 않고, 트레이스/스킬스왑 등으로
   * 풀타입 포켓몬이 이 특성을 얻어야 의미가 생긴다.
   */
  grassVeil?: boolean;
  /**
   * 공생(Symbiosis): 자기 편 다른 포켓몬이 지닌 도구를 소모하는 순간 자신의 도구를 그 포켓몬에게
   * 넘긴다. 본가는 더블 배틀 전용이고, 3v3 싱글 교체(Phase 8)에서는 필드에 동시 아군이 없어
   * **실제로 발동하지 않는다** — 파이프라인 자리만 잡아 둔 플래그(consumeItem 주석 참조).
   */
  passesItemToConsumingAlly?: boolean;
  /**
   * 부식(Corrosion): 공격측이 이 특성이면 상대가 독·강철 타입이어도 독/맹독을 걸 수 있다.
   * isImmuneToStatus에서 타입 기반 면역 판정만 건너뛴다 — 유연 같은 상태이상 특성 면역은
   * 그대로 존중한다(본가 일치).
   */
  bypassesPoisonTypeImmunity?: boolean;
  /**
   * 정신력: 풀죽음에 면역이다. 원문에 "위협의 효과를 받지 않는다"도 있지만 위협(등장 시 효과)
   * 자체가 이 로스터에 아직 없어 그 절반은 적용 대상이 없다.
   */
  immuneToFlinch?: boolean;
  /**
   * 인분(Shield Dust): 자신에게 올 "추가효과"를 전부 무산시킨다. 추가효과의 정의 —
   * 데미지 기술(category !== "status")이 상대(자신)에게 딸려 거는 상태이상·행동방해·랭크변화.
   * 확률(chance) 유무와 무관하다(연옥 100% 화상·일렉트릭네트 100% 스피드↓도 추가효과).
   * 막지 않는 것: 변화기(도깨비불·전기자석파 등)의 주효과, 자기 대상 효과(반동·자기 랭크변화).
   * 왕의징표석(도구발 추가 풀죽음)도 이 특성이 막는다.
   * battleSimulator에서 hasSheerForceSecondaryEffect(우격다짐)와 같은 "추가효과" 정의를 공유하되,
   * 우격다짐은 여기에 자기 랭크업까지 얹어 제거 후 위력을 올리는 공격측 특성이라는 점만 다르다.
   */
  blocksSecondaryEffects?: boolean;
  /**
   * 방음(Soundproof): 소리 기술(classification "소리" — 돌림노래·멸망의노래·하이퍼보이스·폭음파·
   * 노래하기 등)이 자신에게 통하지 않는다 — 데미지기·변화기 모두. 자신이 쓰는 소리 기술에는
   * 영향이 없다(피격 시에만 판정). resolveMoveContext에서 typeEffectiveness를 0으로 덮어쓰고,
   * battleSimulator가 opponentEffectsBlocked에 더해 상대 방향 부가효과까지 전부 차단한다.
   * 4세대 로스터의 바리톱스·눈설왕이 보유.
   */
  blocksSound?: boolean;
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
  /**
   * 매직가드: 상대의 공격기 데미지 이외의 "부가 피해"를 전부 무효화한다. 이 엔진에 실재하는 피해원
   * 기준으로 — 상태이상(독·맹독·화상) 지속 데미지, 씨뿌리기, 반동기(recoilFraction)·발버둥 반동,
   * 생명의구슬 반동, 까칠한피부류 접촉 반사 데미지(damagesAttackerFraction)를 막는다.
   * 막지 않는 것: 직접 공격 데미지, 화상의 물리 위력 감소, 혼란 자멸(본가에서도 매직가드가 못 막음),
   * 상태이상에 "걸리는" 것 자체(HP만 안 깎임). 스텔스록은 현재 HP 피해 로직이 없어 대상 없음 —
   * 훗날 설치물 등장 데미지가 생기면 그 지점도 이 플래그로 함께 막아야 한다.
   */
  negatesIndirectDamage?: boolean;
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
   * 매직미러: 상대가 자신을 겨냥해 쓴 "좋지 않은 변화기"(status 카테고리 + isOpponentTargetingMove)를
   * 그 자리에서 시전자에게 되돌린다. 되돌린 기술은 빗나가지 않고, 시전자 기준으로 효과가 다시
   * 평가된다(타입 면역·조사 등 전부 시전자 것으로). 반사 제외: notReflectable 플래그가 붙은
   * 기술(고스트 저주·추억의선물·멸망의노래·흔들흔들댄스), 도구·특성 효과, 데미지기.
   * 틀깨기(공격측)에는 무시당한다 — MOLD_BREAKER_IMMUNE_ABILITY_NAMES에서 제외돼 있어
   * resolveEffectiveDefenderAbility가 자동으로 이 특성을 무효화한다.
   */
  reflectsOpponentStatusMoves?: boolean;
  /**
   * 위협: 배틀에 등장하면(=createBattleState 시점) 상대의 이 스탯을 즉시 낮춘다(위협: atk, -1).
   * 가뭄류(setsWeather)와 같은 "등장 시 1회" 축이지만 날씨가 아니라 상대 랭크를 직접 건드리는
   * 경우라 별도 필드로 분리했다. resolveEntryAbilityEffects에서 적용한다.
   */
  lowersOpponentStatOnEntry?: { stat: BattleStatKey; delta: number };
  /** 일렉트릭메이커: 배틀에 등장하면 이 필드를 편다(이미 다른 필드가 있으면 실패). */
  setsFieldOnEntry?: FieldKind;
  /**
   * 재생력(Regenerator): 교체로 물러날 때 최대 HP의 이 비율(1/3)만큼 회복한 상태로 벤치에
   * 들어간다. 교체 개념이 도입된 Phase 8 §4부터 의미가 생긴다(performSwitch의 나가는 포켓몬 훅).
   */
  healsFractionOnSwitchOut?: number;
  /**
   * 자연회복(Natural Cure): 교체로 물러나는 순간 주 상태이상(화상/독/맹독/마비/잠듦/얼음)이
   * 치유된다. 재생력과 같은 축(performSwitch의 나가는 포켓몬 훅, Phase 8 §4).
   */
  curesStatusOnSwitchOut?: boolean;
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
  /** 짓궂은마음: 자신이 쓰는 변화기(카테고리 status)의 우선도를 이 값만큼 올린다(사이코필드 차단 판정에도 반영). */
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
   * 탈(Disguise): 배틀 중 처음으로 데미지를 입는 순간(다단히트라면 그 첫 타만) 데미지를 통째로
   * 무효화하고, 그 즉시 최대 HP의 이 비율만큼 반동 데미지를 자신이 입는다(Bulbapedia 확인 —
   * 8세대부터 벗겨지는 즉시 적용, 다단히트 나머지 타수는 정상적으로 맞음). 상태이상 등 데미지 외
   * 부가 효과는 막지 않는다. 한 번 벗겨지면 배틀 끝까지 다시 발동하지 않는다(BattleFighterState.
   * disguiseBroken으로 추적) — 이 프로젝트는 교체가 없는 1v1이라 "복귀 시 재생성" 축은 해당 없음.
   */
  negatesFirstHitThenRecoils?: { recoilFraction: number };
  /**
   * 가속(Speed Boost): 매 턴 종료 시 스피드가 1랭크 상승한다. 본가에서는 "포켓몬 교체로 나온
   * 턴에는 발동 안 함"이 규칙이라, 이 시뮬레이터에서는 배틀 첫 턴(state.turnNumber === 1)에는
   * 적용하지 않고 그 다음 턴부터 매 턴 종료 시 적용한다.
   */
  boostsSpeedEachTurnEnd?: boolean;
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
  /**
   * 괴짜(Imposter) — 메타몽 전용. 배틀에 등장하는 순간 상대로 변신한다(Move.transformsIntoTarget과
   * 동일 처리). resolveEntryAbilityEffects에서 위협·트레이스와 같은 훅으로 실행하며, 타입·5실능
   * (HP 제외)·특성·능력 랭크·기술 목록을 상대와 똑같이 복사한다.
   */
  transformsIntoOpponentOnEntry?: boolean;
  /**
   * 대운: 자신이 공격할 때 급소율 카운터가 상시로 이 값만큼(대운=1) 오른다. 초점렌즈
   * (Item.critStageBonus)·highCritRatio·기충전(critStage 랭크)과 같은 축에서 그냥 더해지므로,
   * "기충전 + 급소율 높은 기술 + 대운"이면 카운터가 3(=100% 급소)에 도달한다.
   */
  raisesCritStageBy?: number;
  /**
   * 스나이퍼: 자신의 공격이 급소에 맞았을 때의 데미지 배율을 기본값(1.5) 대신 이 값(스나이퍼=2.25)
   * 으로 쓴다. computeDamage의 critDamageMultiplier로 넘어간다.
   */
  critDamageMultiplier?: number;
  /**
   * 조가비갑옷·전투무장: 자신이 방어측일 때 상대의 공격이 급소에 맞지 않는다(alwaysCrit 기술도
   * 포함해 전부 막는다 — 본가 규칙). resolveHit의 급소 판정에서 이 특성이면 항상 비급소로 고정.
   */
  preventsCritsAgainstSelf?: boolean;
  /**
   * 하드록·필터·프리즘아머: 자신이 받는 "효과가 굉장한"(타입 상성 > 1배) 공격의 데미지에 이 배율을
   * 곱한다(하드록=0.75 → 데미지의 75%). resolveMoveContext에서 typeEffectiveness > 1일 때만
   * abilityDefenseMultiplier(=내구력 배율, 데미지는 그 역수)에 반영된다.
   */
  reducesSuperEffectiveDamageMultiplier?: number;
  /**
   * 헤비메탈(2)·라이트메탈(0.5): 몸무게 관련 계산에서 자신의 몸무게에 이 배율을 곱한다. 헤비봄버·
   * 히트스탬프(자신이 공격측일 때 위력 ↑)와 풀묶기·안다리걸기(자신이 방어측일 때 받는 데미지 ↑)
   * 양쪽에 반영된다 — battleSimulator weightOf / matchupEvaluator의 폼 몸무게 조회 지점에서 곱한다.
   */
  weightMultiplier?: number;
  /**
   * 변덕쟁이: 매 턴 종료 시 5스탯(공격/방어/특공/특방/스피드) 중 하나가 2랭크 오르고, 그와 다른
   * 하나가 1랭크 내려간다(랜덤). 가속(boostsSpeedEachTurnEnd)과 같은 턴 종료 훅에서 처리한다.
   * 본가는 명중/회피 랭크도 대상이지만 이 로스터는 BattleStatKey 5종만 대상으로 한다.
   */
  moodyRandomStages?: boolean;
  /**
   * 시간벌기: 자신의 기술이 항상 "같은 우선도 안에서 가장 마지막"에 나간다(스피드 무관). 두 행동자가
   * 모두 이 특성이면 우선도가 같을 때 정상 스피드 비교로 되돌아간다. compareTurnOrder에서 처리.
   */
  movesLastInPriorityBracket?: boolean;
  /**
   * 날씨부정(에어록/날씨부정): 자신이 필드에 있는 동안 모든 날씨의 부가효과가 사라진다 — 날씨
   * 데미지 배율·날씨 조건 특성(엽록소·모래의힘·젖은접시·아이스바디 등)·웨더볼·모래바람 틱·쾌청
   * 얼음면역이 전부 무시된다. 날씨 자체와 지속 턴 카운트는 그대로 흘러간다(activeWeather 헬퍼).
   */
  negatesWeather?: boolean;
  /**
   * 기분파(Forecast) — 캐스퐁 전용. 날씨에 따라 타입이 바뀐다: 쾌청→불꽃, 비→물, 눈→얼음,
   * 그 외(모래바람·날씨 없음·날씨부정)→노말. battleSimulator가 턴 시작·날씨 변동·등장 시점에
   * fighter.types를 다시 계산한다. 종족값·특성은 그대로.
   */
  weatherFormChange?: boolean;
  /**
   * 투쟁심(Rivalry): 상대와 성별이 같으면 위력 ×1.25, 다르면 ×0.75. 어느 한쪽이라도 성별
   * 불명(genderless)이면 ×1.0. 양쪽 성별을 알아야 해서 modifiers가 아니라 battleSimulator·
   * matchupEvaluator에서 직접 곱한다.
   */
  rivalryDamage?: boolean;
  /**
   * 건조피부·아이스바디류의 "특정 날씨에 매턴 종료 시 피해" 축(weatherEndOfTurnHealDenominator의
   * 반대). 건조피부=쾌청일 때 매턴 최대 HP 1/8 피해. (비일 때의 회복은 weatherEndOfTurnHealDenominator로 따로 채운다.)
   */
  weatherEndOfTurnDamageDenominator?: { weather: WeatherKind; denominator: number };
  /**
   * 포이즌힐(Poison Heal): 독·맹독 상태일 때 턴 종료 시 독 지속 데미지를 받는 대신 최대 HP의
   * 1/denominator를 회복한다(포이즌힐=8). 상태이상 카운터(맹독 누적)는 그대로 진행된다.
   */
  healsFromPoisonEachTurnDenominator?: number;
  /**
   * 위험예지(Anticipation): 배틀에 등장하는 순간, 상대가 지닌 기술 중 자신에게 효과가 굉장한
   * (타입 상성 > 1) 기술이나 일격필살기(tags에 "일격")가 하나라도 있으면 UI 로그로 알린다.
   * 배틀 수치 영향 없음(통찰과 같은 정보 표시 훅).
   */
  revealsThreateningMovesOnEntry?: boolean;
  /**
   * 독수(Poison Touch): 접촉하는 기술로 공격해 데미지를 준 직후 이 확률(%)로 상대를 독 상태로
   * 만든다(독가시 hitTrigger의 공격측 버전). 타입/특성 상태이상 면역은 그대로 존중.
   */
  poisonTouchChance?: number;
  /**
   * 악취(Stench): 데미지를 주는 기술로 공격했을 때 이 확률(%)로 상대를 추가로 풀죽게 만든다.
   * 왕의징표석(Item.extraFlinchChance)의 특성 버전 — 같은 블록에서 OR로 판정한다.
   */
  flinchChanceOnHit?: number;
  /**
   * 예지몽(Forewarn): 배틀에 등장하는 순간 상대가 지닌 기술 중 가장 위력이 높은 기술을 UI 로그로
   * 알린다(통찰·위험예지와 같은 정보 표시 훅). 배틀 수치 영향 없음.
   */
  revealsStrongestOpponentMoveOnEntry?: boolean;
  /**
   * 심술꾸러기(Contrary): 이 포켓몬의 능력치 랭크 변화가 전부 반대로 적용된다(오르면 내려가고
   * 내려가면 올라간다). 기술·특성이 거는 의도적 랭크 변화(자기 것이든 상대가 건 것이든)에 적용되며,
   * 흑안개·하양허브 같은 "초기화/복구"에는 적용되지 않는다. battleSimulator가 랭크 변경 지점에서
   * delta를 부호 반전한다.
   */
  invertsStatChanges?: boolean;
  /**
   * 의태(Mimicry): 필드 상태에 따라 자신의 타입이 바뀐다 — 일렉트릭필드→전기, 사이코필드→에스퍼,
   * 그래스필드→풀, 미스트필드→페어리, 필드 없음→원래 타입. battleSimulator가 턴 시작 시점에
   * fighter.types를 다시 계산하고 바뀌면 turnStartAnnouncements로 알린다.
   */
  terrainTypeChange?: boolean;
  /**
   * 방탄(Bulletproof): 구슬·폭탄 계열 기술(tags에 "구슬" 또는 "폭탄"이 있는 기술 —
   * 기합구슬·오물폭탄·섀도볼·에너지볼·파동탄·록블라스트·전자포·암석포 등, 데미지기·변화기 모두)이
   * 자신에게 통하지 않는다. 방음(blocksSound)과 완전히 같은 처리 — resolveMoveContext에서
   * typeEffectiveness를 0으로 덮고, battleSimulator가 opponentEffectsBlocked에 합류시킨다.
   */
  blocksBallBomb?: boolean;
  /**
   * 질풍날개(Gale Wings, 7세대 형식): 자신의 HP가 가득 찬 상태에서 쓰는 비행타입 기술의 우선도가
   * +1이 된다. 짓궂은마음(statusMovePriorityBoost)과 같은 "우선도 델타" 축이지만 조건이
   * "비행타입 기술 + 풀피"라 별도 필드로 뒀다 — getAbilityPriorityBoost/compareTurnOrder에서 처리.
   */
  flyingMovePriorityBoostAtFullHp?: boolean;
  /**
   * 볼주머니(Cheek Pouch): 나무열매를 먹으면(HP 임계 자동 발동·볼가득넣기·탁쳐서떨구기로 먹거나
   * 떨어뜨려 먹은 것 포함) 그 열매 고유 효과와 별개로 최대 HP의 이 비율만큼 추가로 회복한다(1/3).
   */
  berryHealFraction?: number;
  /**
   * 수확(Harvest): 턴 종료 시, 이번 배틀에서 소비한 나무열매가 있으면 chance(%) 확률로 그 열매를
   * 다시 지닌다(currentItemId 복원). 날씨가 쾌청/큰햇살이면 sunChance(%) 확률(수확=100). 이미
   * 도구를 지녔거나 소비한 나무열매 기록이 없으면 아무 일도 없다.
   */
  restoresBerryEndOfTurn?: { chance: number; sunChance: number };
  /**
   * 아로마베일(Aroma Veil): 자신을 겨냥한 "마음을 옭아매는" 변화기의 효과를 받지 않는다 —
   * 헤롱헤롱(attract)·도발(taunt)·기술봉인(disable)·앙코르(encore). (본가의 트집·회복봉인은 이
   * 엔진에 volatile로 모델링돼 있지 않아 대상 없음.) battleSimulator가 해당 volatile 부여 직전에 차단한다.
   */
  blocksMentalMoves?: boolean;
  /**
   * 흡반(Suction Cups): 교체를 강제하는 기술·도구에 밀려나지 않는다. 현행 1v1 시뮬레이터엔 교체가
   * 없어 아직 배선하지 않는다 — 배틀타워 리뉴얼로 교체가 도입되면 강제 교체 저항 지점에서 이 플래그를 읽는다.
   */
  preventsForcedSwitch?: boolean;
  /**
   * 원격(Long Reach): 자신이 쓰는 모든 기술이 접촉 판정을 받지 않는다. resolveAction의 접촉
   * 판정(`makesContact`)을 공격측이 이 특성이면 강제로 false로 취급한다 — 까칠한피부·정전기·불꽃몸·
   * 독가시·미끈미끈·저주받은바디·나쁜손버릇·헤롱헤롱바디 같은 접촉 반격 특성과 록키헬멧 도구,
   * 접촉 조건부 배율(단단한발톱 등)이 전부 발동하지 않게 된다.
   */
  movesIgnoreContact?: boolean;
  /**
   * 스킬링크(Skill Link): 2~5회 연속 공격 기술(minHits/maxHits가 있는 기술)을 쓰면 명중 횟수가
   * 항상 최대치(maxHits)로 고정된다. 트리플악셀처럼 minHits가 1인 기술도 max로 고정.
   */
  multiHitAlwaysMax?: boolean;
  /**
   * 무도한행동(Merciless): 방어측(상대)이 독/맹독 상태이면 자신의 공격이 반드시 급소에 맞는다.
   * accuracyCrit.ts의 급소 판정에서 이 조건이면 항상 급소로 고정한다(조가비갑옷·전투무장 등
   * 방어측의 급소 방지 특성은 그대로 존중 — 본가 규칙).
   */
  alwaysCritsVsPoisonedTarget?: boolean;
  /**
   * 발끈(포챔스판): 상대의 데미지 기술로 HP가 최대치의 절반 이하가 되면 그 즉시 특수공격이
   * 1랭크 오른다. 판정은 "상대가 사용한 기술의 데미지"에 한정한다 — 모래바람·독/맹독·씨뿌리기·
   * 설치물처럼 상대 기술이 아닌 경로로 절반 이하가 되면 발동하지 않는다. 배틀당 여러 번 가능하되
   * "절반 이하로 처음 내려가는 그 순간"에만 트리거된다(이미 절반 이하였으면 재발동 안 함).
   */
  raisesSpaWhenHalvedByMoveDamage?: boolean;
  /**
   * 여왕의위엄(Queenly Majesty): 상대가 이 포켓몬을 겨냥해 쓰는 우선도 +1 이상의 공격 기술이
   * 실패한다(특성·필드로 우선도가 올라간 경우도 포함). 사이코필드의 우선도 차단과 같은 로직을
   * "이 특성 소유자를 방어측으로 둔" 상황에 적용한다. 더블 전용인 "같은 편 보호"는 1v1이라 미반영.
   * 전용 실패 문구: "(상대)은(는) (기술)을(를) 쓸 수 없다!"
   */
  blocksOpponentPriorityMoves?: boolean;
  /**
   * 의욕(Hustle): 자신의 물리 기술 위력에 이 배율(1.5)을 곱한다. computeDamage의 abilityMultiplier
   * 축에 물리기일 때만 합쳐진다(근성의 화상 무시와는 별개 — 근성은 위력 배율이 없다).
   */
  hustleAttackMultiplier?: number;
  /**
   * 의욕(Hustle): 자신의 물리 기술 명중률에 이 배율(0.8)을 곱한다. 복안(userAccuracyMultiplier)과
   * 같은 extraMultiplier 축이지만 물리기 한정이라 별도 필드로 뒀다. 필중기(accuracy=null)엔 영향 없음.
   */
  hustlePhysicalAccuracyMultiplier?: number;
  /**
   * 숙성(Ripen): 자신이 먹는 나무열매의 효과(HP 회복량·데미지 경감 등)가 2배가 된다.
   * consumeItem이 나무열매를 감지하는 지점, 그리고 나무열매 회복량을 계산하는 지점에서 반영한다.
   */
  doublesBerryEffect?: boolean;
  /**
   * 먹보(Gluttony): 원래 HP 1/4 이하에서 발동하는 위기 나무열매(자뭉·오랭 등)를 HP 1/2 이하에서
   * 미리 먹는다. 이 프로젝트는 위기 나무열매 baseline 문턱이 이미 1/2(getHpThresholdBerryHeal)이라
   * 실질 효과가 없다 — 데이터만 반영하고 엔진 배선은 사실상 무의미.
   */
  pinchBerryAtHalfHp?: boolean;
  /**
   * 배리어프리(Screen Cleaner): 배틀에 등장하면 양쪽의 리플렉터·빛의장막·오로라베일을 전부
   * 없앤다. resolveEntryAbilityEffects에서 처리(등장 시 1회).
   */
  clearsAllScreensOnEntry?: boolean;
  /**
   * 일루전(Illusion, 조로아크/히스이조로아크): 등장 시 파티의 마지막 슬롯(자신 아님·안 쓰러짐)
   * 포켓몬의 이름·아이콘으로 위장한다(BattleFighterState.illusionAs). 타입·실능·특성은 조로아크
   * 그대로 — 순수 표시용 위장이며, 기술 데미지를 받는 순간 위장이 풀린다(§6-1).
   */
  illusion?: boolean;
  /**
   * 꼬르륵스위치(Hunger Switch) — 모르페코 전용. 매 턴 종료 시 배부른모양/배고픈모양으로 번갈아
   * 바뀐다(BattleFighterState.hungerMode). 종족값·타입·특성은 동일하고, 오라휠(Move.hungerSwitchType)의
   * 타입만 모양에 따라 달라진다.
   */
  hungerSwitch?: boolean;
  /**
   * 내열(Heatproof): 불꽃타입 데미지 절반(modifiers로 처리)에 더해, 화상 상태의 매 턴 종료 지속
   * 데미지도 절반이 된다. runEndOfTurn의 상태이상 데미지 틱에서 statusCondition이 "burn"이면
   * computeStatusEndOfTurnDamage 결과를 반으로 줄인다(내림).
   */
  halvesBurnDamage?: boolean;
  /**
   * 전기로바꾸기(Electromorphosis): 기술 데미지를 받으면 충전 상태가 된다(BattleFighterState.
   * electroChargedForElectric). 충전 상태에서 다음에 쓰는 전기타입 기술은 위력이 2배가 되고,
   * 그 즉시 충전이 소모된다(1회 한정).
   */
  chargesOnDamageTaken?: boolean;
  /**
   * 편승(Opportunist): 상대의 능력치 랭크가 올라가면(자기 강화기·부가효과 등 원인 무관) 자신도
   * 같은 능력치를 같은 폭만큼 올린다. battleSimulator가 기술 한 번의 랭크 변화가 전부 반영된 뒤,
   * 상대가 이번 기술로 얻은 양(+)의 랭크 상승분을 이 특성 소유자에게 그대로 복사한다(심술꾸러기·
   * 클리어바디류는 복사 적용 시점에서 그대로 존중). 자기 자신의 상승은 복사하지 않는다.
   */
  copiesOpponentStatBoosts?: boolean;
  /**
   * 점착(Sticky Hold): 지닌 도구를 상대에게 빼앗기지 않는다. 나쁜손버릇(hitTrigger.stealsAttackerItem)·
   * 매지션(stealsItemOnDamagingHit)의 도구 강탈 지점에서 이 특성 소유자가 피해자면 강탈이 무산된다.
   * (이 엔진엔 도구를 옮기는 기술 — 탁쳐서떨구기·도둑질·트릭 — 로직이 없어 특성 두 곳만 막으면 충분하다.)
   */
  preventsItemLoss?: boolean;
  /**
   * 감미로운꿀(포챔스판): 배틀에 등장하면 상대의 회피율을 이 값(-1)만큼 떨어뜨린다. 위협
   * (lowersOpponentStatOnEntry)의 회피율 버전 — 회피율은 BattleStatKey가 아니라 accuracyStages라
   * 별도 필드로 뒀다. 배틀당 1회(1v1이라 등장도 1회). resolveEntryAbilityEffects에서 처리.
   * 전용 안내 2줄: "…의 꿀에서 달콤한 향기가 나고 있다!" / "…의 회피율이 떨어졌다!"
   */
  lowersOpponentEvasionOnEntry?: number;
  /**
   * 메가솔라(포챔스판 메가니움-메가): 자신이 쓰는 기술이 현재 날씨와 무관하게 "쾌청" 상태처럼
   * 취급된다 — 솔라빔이 준비 턴 없이 나가고(chargeSkipWeather:"쾌청" 대상), 광합성·달빛류
   * (healsWeatherDependent)의 회복량이 항상 2/3, 웨더볼이 불꽃타입·위력 2배로 나간다.
   * (모래바람의 바위 특방 1.5배·눈의 얼음 방어 1.5배 무시 조항은 이 엔진에 해당 방어 보정 자체가
   *  없어 실질 대상 없음.)
   */
  treatsOwnWeatherAsSun?: boolean;
  /**
   * 천정부지(포챔스판 저리더프-메가): grantsImmunityToTypes:["땅"](부유)와 함께 쓴다. 자신의
   * 데미지로 상대를 실제로 쓰러뜨리면, 그 즉시 자신의 실능치(realStats)가 가장 높은 능력
   * (공격/방어/특공/특방/스피드 중)이 1랭크 오른다. 자기과신(boostsStatOnKo)과 같은 KO 훅.
   */
  boostsHighestStatOnKo?: boolean;
  /**
   * 보이지않는주먹(Unseen Fist, 골루그-메가): 자신이 쓰는 접촉기가 상대의 방어류(방어/판별/킹실드/
   * 니들가드/토치카 — protectEffect:"block")를 뚫고 명중한다. 단, 그렇게 뚫고 들어간 타는 데미지가
   * 1/4로 줄고, 상대 방어류의 접촉 성공 시 부가효과(킹실드 공격 -1·니들가드 1/8 데미지·토치카 독)는
   * 그대로 발동한다(본가와 달리 데미지 페널티가 있는 포챔스판 — 사용자 확정).
   */
  contactBypassesProtectAtQuarterDamage?: boolean;
}
