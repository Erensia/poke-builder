import { Fragment } from "react";
import { type ActionLogEntry } from "../../lib/battleSimulator";
import { hitAbilityEventLines } from "./abilityLines";

/**
 * §2-5: 연타(멀티히트) — 1타 몫은 메인 데미지 줄(호출부 책임)이 이미 찍었고, 여기서 1타
 * 급소·1타 방어측 특성 반응 → 2타부터 "타별 데미지 줄(+급소+특성 반응)" → 마지막에
 * "N번 맞았다!"까지. 변환자재 2줄은 §2-4 블록이 1타 직후에 이미 찍는다(호출부 책임).
 */
export function MultiHitLines({
  hits,
  moveName,
  hitCount,
  actorName,
  defenderName,
}: {
  hits: NonNullable<ActionLogEntry["hits"]>;
  moveName: string;
  hitCount: number | undefined;
  actorName: string;
  defenderName: string;
}) {
  if (hits.length === 0) return null;
  return (
    <>
      {hits[0].critical && <div className="battle-turn-line is-muted">급소에 맞았다!</div>}
      {hits[0].abilityEvent && hitAbilityEventLines(hits[0].abilityEvent, actorName, defenderName, "he-0")}
      {hits.slice(1).map((h, i) => (
        <Fragment key={i}>
          <div className="battle-turn-line">
            {actorName}의 {moveName} — {h.damage} 데미지 (
            {(h.damagePercent * 100).toFixed(1)}%)
          </div>
          {h.critical && <div className="battle-turn-line is-muted">급소에 맞았다!</div>}
          {h.abilityEvent && hitAbilityEventLines(h.abilityEvent, actorName, defenderName, `he-${i + 1}`)}
        </Fragment>
      ))}
      <div className="battle-turn-line is-muted">{hitCount}번 맞았다!</div>
    </>
  );
}
