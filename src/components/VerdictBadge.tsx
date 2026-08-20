import type { MatchupVerdict } from "../lib/battlePower";
import "./VerdictBadge.css";

const VERDICT_LABEL: Record<MatchupVerdict, string> = {
  "guaranteed-1hit": "확정 1타",
  "random-1hit": "난수 1타",
  "guaranteed-2hit": "확정 2타",
  "random-2hit": "난수 2타",
  "needs-3hit-plus": "3타 이상 필요",
};

const VERDICT_CLASS: Record<MatchupVerdict, string> = {
  "guaranteed-1hit": "verdict-danger-strong",
  "random-1hit": "verdict-danger",
  "guaranteed-2hit": "verdict-warn",
  "random-2hit": "verdict-neutral",
  "needs-3hit-plus": "verdict-safe",
};

interface VerdictBadgeProps {
  verdict: MatchupVerdict | null;
}

export function VerdictBadge({ verdict }: VerdictBadgeProps) {
  if (!verdict) {
    return (
      <div className="verdict-badge verdict-pending">
        <span>양쪽 포켓몬과 기술을 다 고르면</span>
        <strong>판정이 여기 표시돼요</strong>
      </div>
    );
  }

  return (
    <div className={`verdict-badge ${VERDICT_CLASS[verdict]}`}>
      <strong>{VERDICT_LABEL[verdict]}</strong>
    </div>
  );
}
