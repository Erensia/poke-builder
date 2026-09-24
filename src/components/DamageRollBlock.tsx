import { useState } from "react";
import { damageRollPercents } from "../lib/battlePower";

/**
 * 매치업 화면 — 난수별 데미지(상대 최대 HP 대비 %) 표기(ver.1.7 트랙 H). 평소엔 최소~최대 범위와
 * "몇 타 격파 난수"만, 펼치면 16개 난수별 값을 4×4로 보여 준다(사용자 선택: 범위 + 펼치기).
 * 몇 타 판정은 같은 난수가 반복된다고 보는 근사 — 정확한 격파 확률은 위쪽 판정 배지(VerdictBadge)가 낸다.
 */
export function DamageRollBlock({ offensePower, bulkPower }: { offensePower: number; bulkPower: number }) {
  const [expanded, setExpanded] = useState(false);
  const rolls = damageRollPercents(offensePower, bulkPower);
  if (rolls.length === 0) return null;

  const min = rolls[0].percent;
  const max = rolls[rolls.length - 1].percent;
  // 최고 난수로 몇 타에 잡히는지, 그 타수로 잡히는 난수가 몇 개인지(같은 난수 반복 기준)
  const hits = Math.max(1, Math.ceil(100 / max - 1e-9));
  const killing = rolls.filter((r) => r.percent * hits + 1e-9 >= 100).length;
  const summary = killing === rolls.length ? `확정 ${hits}타` : `${hits}타 격파 난수 ${killing}/${rolls.length}`;

  return (
    <div className="matchup-roll-block">
      <div className="matchup-roll-row">
        <span className="matchup-roll-title">난수별 데미지</span>
        <span className="matchup-roll-range">
          상대 HP의 <strong>{min.toFixed(1)}%</strong> ~ <strong>{max.toFixed(1)}%</strong>
        </span>
        <span className="matchup-roll-summary">({summary})</span>
        <button type="button" className="matchup-roll-toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "접기 ▴" : "16개 전부 보기 ▾"}
        </button>
      </div>
      {expanded && (
        <ul className="matchup-roll-grid">
          {rolls.map((r) => (
            <li key={r.roll} className={r.percent * hits + 1e-9 >= 100 ? "is-killing" : undefined}>
              <span className="matchup-roll-value">{r.roll}</span>
              <span className="matchup-roll-percent">{r.percent.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
