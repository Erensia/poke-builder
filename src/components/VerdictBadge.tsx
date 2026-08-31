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
  /** 판정 타수로 격파할 확률(0~1). 확정 1·2타면 1, "3타 이상 필요"면 null */
  koChance?: number | null;
  /** 난수 1타일 때만: [격파 난수 수, 16] */
  killingRolls?: readonly [number, number];
}

interface ChanceDisplay {
  main: string;
  /** 난수 1타의 "16난수 중 7개" 같은 근거 줄 */
  detail?: string;
  /** "3타 이상 필요"의 0% 표기는 안심 색 대신 회색으로 */
  muted?: boolean;
}

function formatPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** 라벨 아래 난수 격파 확률 표시. 난수 1타·2타·3타 이상 필요일 때만 나오고 확정 1·2타는 없다. */
function chanceDisplay(
  verdict: MatchupVerdict,
  koChance: number | null | undefined,
  killingRolls: readonly [number, number] | undefined,
): ChanceDisplay | null {
  if (verdict === "random-1hit" && koChance != null) {
    return {
      main: formatPct(koChance),
      detail: killingRolls ? `${killingRolls[1]}난수 중 ${killingRolls[0]}개` : undefined,
    };
  }
  if (verdict === "random-2hit" && koChance != null) {
    return { main: `${formatPct(koChance)} · 2타` };
  }
  if (verdict === "needs-3hit-plus") {
    return { main: "2타 격파 0%", muted: true };
  }
  return null;
}

export function VerdictBadge({ verdict, koChance, killingRolls }: VerdictBadgeProps) {
  if (!verdict) {
    return (
      <div className="verdict-badge verdict-pending">
        <span>양쪽 포켓몬과 기술을 다 고르면</span>
        <strong>판정이 여기 표시돼요</strong>
      </div>
    );
  }

  const chance = chanceDisplay(verdict, koChance, killingRolls);

  return (
    <div className={`verdict-badge ${VERDICT_CLASS[verdict]}`}>
      <strong>{VERDICT_LABEL[verdict]}</strong>
      {chance && (
        <span className={`verdict-chance${chance.muted ? " verdict-chance-muted" : ""}`}>
          {chance.main}
          {chance.detail && <span className="verdict-chance-detail">{chance.detail}</span>}
        </span>
      )}
    </div>
  );
}
