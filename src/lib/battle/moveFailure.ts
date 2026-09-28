import { type ActionLogEntry, type ActionBlockReason } from "@/types/battle";

/**
 * 분함의발구르기·열불내기(ver.1.9, 사용자 정의 2026-09-28): 직전 턴 자기 행동이 "실패"였으면 위력 2배. 실패로 치는 것:
 *  - "그러나 실패했다" 류(사용 조건 실패·효과 실패 — ActionLogEntry의 …Failed 표시 전부)
 *  - 빗나감(차지 무적 포함), 타입·특성 무효, 필드에 의한 무효(사이코필드 선공 차단)
 *  - 도발·사슬묶기 등으로 막힘, 상태이상(마비 몸저림·잠듦·얼음)·혼란 자해·풀죽음으로 행동 못 함
 *  - HP가 가득인데 회복기, 대타출동 실패, 더 올릴 수 없는데 랭크업기
 * 실패가 아닌 것: 방어류에 막힘, 반동으로 쉼, 대타·탈이 데미지를 흡수, 튀어오르기·축하처럼 원래 아무 일도 안 하는 기술.
 * 헤롱헤롱으로 못 움직인 것은 정의 목록에 없어 실패로 치지 않는다.
 */
const FAILED_BLOCK_REASONS: ReadonlySet<ActionBlockReason> = new Set<ActionBlockReason>([
  "status",
  "flinch",
  "confusion",
  "psychicFieldPriority",
  "queenlyMajesty",
  "usageCondition",
  "moveRestricted",
]);

export function actionFailed(action: ActionLogEntry): boolean {
  if (action.blockedReason) return FAILED_BLOCK_REASONS.has(action.blockedReason);
  // 방어류에 막힌 건 실패가 아니다(빗나감 판정보다 먼저)
  if (action.blockedByProtectMoveName) return false;
  const move = action.move;
  // 기술별 "그러나 실패했다" 표시(…Failed) — 효과 실패 전부
  for (const [key, value] of Object.entries(action)) {
    if (value === true && key.endsWith("Failed")) return true;
  }
  // 빗나감(명중 실패·차지 무적)
  if (!action.hit) return true;
  // 타입·특성 무효
  if (action.typeEffectiveness === 0 && move.category !== "status") return true;
  if (
    action.abilityAbsorbAbilityName ||
    action.soundproofBlockedByAbilityName ||
    action.bulletproofBlockedByAbilityName ||
    action.goodAsGoldBlockedByAbilityName ||
    action.mentalMoveBlockedByAbilityName ||
    action.powderBlockedMoveName ||
    action.ohkoBlockedByAbilityName ||
    action.ohkoImmune ||
    action.leechSeedBlockedByGrass ||
    action.blockedBySubstituteMoveName
  ) {
    return true;
  }
  // HP가 가득인데 자기 회복기(회복량 0)
  const selfHeal = (move.healsFraction !== undefined && move.healsTarget !== "opponent") || move.healsWeatherDependent;
  if (move.category === "status" && selfHeal && !move.restSleep && !action.healedAmount) return true;
  // 더 올릴 수 없는데 랭크업기(오른 능력 없이 "더 이상 올라가지 않는다"만)
  if (move.category === "status" && action.selfStatsAtMax?.length && !action.selfStatRises?.length) return true;
  return false;
}
