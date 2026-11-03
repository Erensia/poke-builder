import { useEffect, useState } from "react";
import { rankLabel, rankOf } from "../lib/battleRank";
import { prefersReducedMotion, useCountUp } from "../hooks/useCountUp";
import { describeChange, fixed } from "../lib/battleRankText";
import type { RankLastResult } from "../hooks/useRankBattle";
import { RankGauge } from "./RankGauge";
import "./RankPanel.css";

/** 승패 배너(1.1s) 뒤에 카드가 나타나고(1.5s), 그 뒤 게이지가 판 전 → 후로 바뀌고 레이팅이 올라간다. CSS 지연(RankPanel.css)과 맞춘다 */
const GAUGE_MS = 2000;

/** 승패 직후 카드 — 판 전→후 랭크 아이콘·게이지, 마스터볼 이상·진입은 계산 내역 한 줄, 챔피언 달성·복귀 연출 */
export function RankResultCard({ result }: { result: RankLastResult }) {
  const { before, entry } = result;
  // 6.5 M1 H — 결과 뒤 게이지가 판 전 모습에서 판 후 모습으로 바뀌고, 레이팅 숫자가 올라간다(동작 줄이기에서는 처음부터 판 후)
  const [shown, setShown] = useState(prefersReducedMotion);
  useEffect(() => {
    if (shown) return;
    const id = setTimeout(() => setShown(true), GAUGE_MS);
    return () => clearTimeout(id);
  }, [shown]);
  const rating = useCountUp(before.rating ?? entry.rating ?? 0, entry.rating ?? 0, GAUGE_MS, 700);
  const won = entry.result === "win";
  const beforeRank = rankOf(before);
  const champion = beforeRank.ball !== "champion" && entry.after.ball === "champion";
  const changed = rankLabel(beforeRank) !== rankLabel(entry.after);
  const up = entry.change.kind === "entry" || entry.change.delta > 0;
  // 마스터볼 이상 → 마스터볼 이상은 아이콘이 그대로라 레이팅 숫자로 보여 주고, 그 밖에는 판 전→후 게이지를 나란히 보여 준다
  const gaugeOnly = beforeRank.step !== null || entry.after.step !== null;

  return (
    <div className="rank-result result-in">
      {champion && (
        <div className="rank-champion-banner">
          <img src="/rank/champion.png" alt="" width={96} height={96} />
          <strong>{before.champion ? "챔피언 복귀!" : "챔피언 달성!"}</strong>
        </div>
      )}
      <div className="rank-result-visual">
        {gaugeOnly && (
          <>
            <RankGauge display={beforeRank} />
            <span className="rank-result-arrow">
              →{changed && <small>{up ? "승급!" : "강등"}</small>}
            </span>
          </>
        )}
        <RankGauge display={shown ? entry.after : beforeRank} />
      </div>
      {entry.rating !== null && (
        <p className="rank-result-line">
          {before.rating !== null && <>{fixed(before.rating)} → </>}
          <strong>{fixed(rating)}</strong>
        </p>
      )}
      {entry.change.kind !== "gauge" && <p className="rank-result-line rank-result-formula">{describeChange(entry.change, won)}</p>}
    </div>
  );
}
