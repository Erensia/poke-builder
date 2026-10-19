import type { RankChange } from "./battleRank";

export const fixed = (n: number) => n.toFixed(2);
const signed = (n: number) => (n >= 0 ? `+${fixed(n)}` : `−${fixed(-n)}`);

/** 승패 직후·이력에 쓰는 계산 내역 한 줄 */
export function describeChange(change: RankChange, won: boolean): string {
  if (change.kind === "gauge") {
    if (change.delta === 2) return "게이지 +1/2 (연승 보너스)";
    if (change.delta === 1) return "게이지 +1/4";
    if (change.delta === -1) return "게이지 −1/4";
    return "게이지 변동 없음";
  }
  if (change.kind === "entry") {
    return `마스터볼 진입 — 초기 레이팅 ${fixed(change.rating)} (기준 ${change.base}${change.bonus ? " × 1.1 보너스" : ""})`;
  }
  const mult = change.multiplier > 1 ? ` × ${won ? "연승" : "연패"} ${change.multiplier.toFixed(1)}` : "";
  const turn = won && change.turnBonus !== 0 ? ` ${change.turnBonus > 0 ? "+" : "−"} 턴 보정 ${Math.abs(change.turnBonus)}` : "";
  return `(${won ? "" : "−"}${change.base}${turn})${mult} = ${signed(change.delta)}`;
}
