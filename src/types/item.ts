import type { PokemonType } from "./pokemon-type";
import type { MoveCategory } from "./move";
import type { StatusCondition } from "./status";
import type { WeatherKind } from "./weather";

export type ItemCategory = "mega-stone" | "held-item";

export interface Item {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  /** 실크스카프 등 타입 강화 도구 18종 — 이 타입 기술의 위력 배율 */
  moveTypeMultiplier?: { type: PokemonType; multiplier: number };
  /** 힘의머리띠(물리)·박식안경(특수) — 기술 분류 한정 위력 배율 */
  moveCategoryMultiplier?: { category: MoveCategory; multiplier: number };
  /** 생명의구슬처럼 타입·분류 무관하게 걸리는 전체 위력 배율 */
  powerMultiplier?: number;
  /** 생명의구슬: 공격이 명중해 데미지를 준 뒤 최대 HP의 이 비율만큼 자신도 반동 데미지 */
  selfRecoilFractionOfMaxHp?: number;
  /** 달인의띠: 상대 타입 상성이 2배 이상("효과가 굉장했다")일 때 걸리는 위력 배율 */
  superEffectiveMultiplier?: number;
  /** 메트로놈: 같은 기술을 연속 사용할 때마다 perStreak만큼 배율이 오르고 max에서 멈춘다 */
  consecutiveSameMoveMultiplier?: { perStreak: number; max: number };
  /**
   * 나무열매 18종 — 자신이 이 타입 기술에 "효과가 굉장하게"(2배 이상) 맞으면 그 데미지를
   * 반감시키고 소모된다(대전 중 1회용). 방어측 아이템이라 offense가 아니라 defense multiplier로 적용.
   */
  resistsSuperEffectiveType?: PokemonType;
  /** 광각렌즈: 자신이 사용하는 기술의 명중률에 항상 곱하는 배율(1.1) */
  accuracyMultiplier?: number;
  /** 반짝가루: 상대가 자신에게 사용하는 기술의 명중률에 곱하는 배율(0.9) — 방어측 아이템 */
  opponentAccuracyMultiplier?: number;
  /** 포커스렌즈: 상대보다 행동 순서가 늦게 움직인 턴에 한해 자신이 사용하는 기술의 명중률에 곱하는 배율(1.2) */
  accuracyMultiplierWhenMovingSecond?: number;
  /**
   * 먹다남은음식: 턴 종료 시(생존해 있으면 항상) 최대 HP를 이 값으로 나눈(내림) 만큼 회복(1/6 → 6).
   * 1/6·1/8·1/4처럼 딱 안 떨어지는 분수를 부동소수점 배율로 저장하면 floor 계산에서 오차가
   * 날 수 있어, 분수 계열 회복량은 전부 "나눌 값(분모)"으로 저장하고 Math.floor(maxHp / n)로 계산한다.
   */
  endOfTurnHealDenominator?: number;
  /**
   * 큰뿌리: 흡수 계열(Move.drainFraction) 기술·뿌리박기/아쿠아링(setsRegenVolatile)·
   * 씨뿌리기(setsLeechSeed)로 회복하는 양에 곱하는 배율(1.3). 회복 "받는" 쪽이 이 도구를
   * 지녔을 때만 적용 — 씨뿌리기는 회복하는 쪽(시드를 심은 반대편)의 도구를 본다.
   */
  drainHealMultiplier?: number;
  /** 조개껍질방울: 기술로 데미지를 준 만큼을 이 값으로 나눈(내림) 만큼 자신도 회복(1/8 → 8). 흡수기(drainFraction)와 별개 축 */
  damageDealtHealDenominator?: number;
  /** 자뭉열매: 체력이 최대 HP 1/2 이하가 되면(1회) 최대 HP를 이 값으로 나눈(내림) 만큼 자동 회복 후 소모(1/4 → 4) */
  healsBelowHalfHpDenominator?: number;
  /** 오랭열매: 체력이 최대 HP 1/2 이하가 되면(1회) 고정 수치(10)만큼 자동 회복 후 소모 */
  healsBelowHalfHpFlat?: number;
  /** 과사열매: 사용한 기술의 PP가 0이 되면(1회) 그 기술의 PP를 이 수치(10, 최대 PP 한도 내)만큼 자동 회복 후 소모 */
  restoresPpOnZero?: number;
  /**
   * 리샘열매(전체)·버치열매(마비)·유루열매(잠듦)·복슝열매(독/맹독)·복분열매(화상)·배리열매(얼음) —
   * 이 목록에 있는 주 상태이상에 걸리는 "그 순간"(명중 시점) 자동으로 치료하고 소모된다.
   * curesStatus(치료 기술)와 달리 트리거가 "걸리는 순간"이라는 점이 다르다. 생략하면 전부(리샘열매).
   */
  curesStatusOnInflict?: StatusCondition[];
  /** 시몬열매: 혼란에 걸리는 순간(주 상태이상이 아니라 VolatileCondition) 자동으로 풀고 소모된다 */
  curesConfusionOnInflict?: boolean;
  /**
   * 날씨 연장 바위 4종(뜨거운바위·차가운바위·보송보송바위·축축한바위) — 이 도구를 지닌 쪽이
   * 이 날씨를 기술/특성으로 만들면 지속시간이 bonus만큼 늘어난다(기본 5턴 + 3 = 8턴).
   */
  weatherDurationBonus?: { weather: WeatherKind; bonus: number };
  /** 빛의점토: 리플렉터/빛의장막 지속시간이 이만큼 늘어난다(기본 5턴 + 3 = 8턴) */
  screenDurationBonus?: number;
  /**
   * 하양허브: 지닌 쪽의 랭크가 하나라도 마이너스면(자신이 스스로 내렸든, 상대가 내렸든) 그 즉시
   * 마이너스 랭크를 전부 0으로 되돌리고 소모된다(대전 중 1회). 플러스 랭크는 건드리지 않는다.
   */
  restoresLoweredStatsOnce?: boolean;
  /**
   * 기합의띠: 최대 HP 상태에서 기절할 정도의 데미지를 받으면 HP 1을 남기고 버틴다(대전 중 1회,
   * 발동하면 소모). survivesLethalChance(기합의머리띠, 확률부·무제한)와는 조건이 달라 별도 필드.
   */
  survivesLethalAtFullHpOnce?: boolean;
  /**
   * 기합의머리띠: 기절할 정도의 데미지를 받을 때마다 이 확률(%)로 HP 1을 남기고 버틴다.
   * 기합의띠와 달리 최대 HP 조건이 없고 소모되지도 않아(재사용 가능) 매번 새로 판정한다.
   */
  survivesLethalChance?: number;
  /**
   * 선제공격손톱: 이 확률(%)로 같은 우선도 안에서 실효 스피드와 무관하게 무조건 먼저 행동한다.
   * 우선도 자체가 다르면(더 높은 쪽) 이 효과와 무관하게 그쪽이 먼저 — turnOrder에서 우선도 비교
   * 뒤, 스피드 비교 전에 판정한다.
   */
  quickClawChance?: number;
  /**
   * 왕의징표석: 데미지를 주는 데 성공하면 이 확률(%)로 상대에게 추가로 풀죽음을 건다. 기술 자체의
   * inflictsVolatile(flinch) 확률과는 완전히 별개 판정이라 두 확률이 동시에 걸려도 각자 독립적으로
   * 판정되고(둘 다 실패해도, 둘 중 하나만 성공해도, 결과는 "풀죽음 1회"로 동일하게 보인다).
   */
  extraFlinchChance?: number;
  /** 초점렌즈: 급소율 랭크(0~3)에 항상 더해지는 보너스. 기충전 등으로 오른 랭크와 합산된다 */
  critStageBonus?: number;
  /**
   * 구애스카프(1.5)·검은철구(0.5) — 실효 스피드 계산에 곱하는 배율. 상태이상(마비 등) 배율과는
   * 별도로 곱해진다.
   */
  speedMultiplier?: number;
  /**
   * 검은철구: 땅타입 기술에 대한 타입 면역(부유 특성·비행타입 등)을 무시하고 맞는다("의사 땅타입
   * 부여"). 배짱(Ability.bypassesImmunityForTypes)의 방어측 버전 — 공격측이 아니라 이 도구를
   * 지닌 방어측 스스로 자기 면역을 없앤다는 점만 다르다. 반감/2배 관계는 그대로 존중(면역만 무시).
   */
  groundsHolder?: boolean;
  /**
   * 구애스카프: 대전 중 처음 실제로 사용한 기술로 이후 계속 고정된다. 판정 엔진(battleSimulator)이
   * 아니라 BattleLogPage의 턴 진행 버튼이 UI 단에서 막는 방식으로 구현되어 있어, 이 필드는
   * "이 도구가 잠금 대상인지"를 판별하는 플래그로만 쓰인다.
   */
  locksFirstMoveUsed?: boolean;
}
