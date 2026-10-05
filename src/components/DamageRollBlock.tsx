import { useState } from "react";
import { DAMAGE_ROLL_MIN_PERCENT, damageRollTotals, type DamageParts } from "../lib/damageFormula";

/**
 * 매치업 화면 — 난수별 데미지 표기(ver.1.7 트랙 H, ver.1.9부터 "실제 데미지(상대 최대 HP 대비 %)"). 평소엔 최소~최대 범위와
 * "몇 타 격파 난수"만, 펼치면 16개 난수별 값을 4×4로 보여 준다(사용자 선택: 범위 + 펼치기).
 * 2.4 B3부터 값은 엔진과 같은 단계별 정수 공식(damageFormula)으로 낸다. 다단히트는 모든 타가 같은 난수라고 보고 합친 총합.
 * 몇 타 판정도 같은 난수가 반복된다고 보는 근사 — 정확한 격파 확률은 위쪽 판정 배지(VerdictBadge)가 낸다.
 */
export function DamageRollBlock({
  parts,
  defenseStat,
  defenderMaxHp,
}: {
  parts: DamageParts;
  /** 방어측이 이 기술에서 읽는 방어 실능 */
  defenseStat: number;
  /** 방어측 최대 HP(실능) */
  defenderMaxHp: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (defenderMaxHp <= 0) return null;
  const rolls = damageRollTotals(parts, defenseStat).map((damage, k) => ({
    roll: DAMAGE_ROLL_MIN_PERCENT + k,
    damage,
    percent: (damage / defenderMaxHp) * 100,
  }));
  const min = rolls[0];
  const max = rolls[rolls.length - 1];
  // 최고 난수로 몇 타에 잡히는지, 그 타수로 잡히는 난수가 몇 개인지(같은 난수 반복 기준)
  const hits = Math.max(1, Math.ceil(defenderMaxHp / max.damage));
  const killing = rolls.filter((r) => r.damage * hits >= defenderMaxHp).length;
  const summary = killing === rolls.length ? `확정 ${hits}타` : `${hits}타 격파 난수 ${killing}/${rolls.length}`;

  return (
    <div className="matchup-roll-block">
      <div className="matchup-roll-row">
        <span className="matchup-roll-title">난수별 데미지</span>
        <span className="matchup-roll-range">
          <strong>{min.damage}</strong> ~ <strong>{max.damage}</strong> ({min.percent.toFixed(1)}% ~ {max.percent.toFixed(1)}%)
        </span>
        <span className="matchup-roll-summary">({summary})</span>
        <button type="button" className="matchup-roll-toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "접기 ▴" : "16개 전부 보기 ▾"}
        </button>
      </div>
      {expanded && (
        <ul className="matchup-roll-grid">
          {rolls.map((r) => (
            <li key={r.roll} className={r.damage * hits >= defenderMaxHp ? "is-killing" : undefined}>
              <span className="matchup-roll-value">{r.roll}</span>
              <span className="matchup-roll-percent">
                {r.damage} ({r.percent.toFixed(1)}%)
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
