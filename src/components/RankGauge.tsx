import { rankLabel, type RankDisplay } from "../lib/battleRank";
import "./RankPanel.css";

/**
 * 원형 게이지 — 몬스터볼~하이퍼볼은 한 단계의 4/4 눈금(이어진 고리가 12시 방향부터 시계 방향으로 1/4씩 찬다). 마스터볼 이상은 레이팅제라 게이지 없이 아이콘만 보여 준다.
 * 아이콘 5종(160×160)은 가운데 볼이 이미지 정중앙(80,80)에 있어, 160칸 좌표계에서 그 점을 중심으로 고리를 아이콘 뒤에 깐다(아이콘이 고리 위를 덮는다).
 * 반지름 45·두께 22칸(프로필 7.5rem 기준 약 16.5px) — 더 작게 잡으면 엠블럼(가장 먼 모서리 53~73)에 가려 눈금이 안 보인다.
 */
export function RankGauge({ display }: { display: RankDisplay }) {
  const full = display.step === null;
  return (
    <div className="rank-gauge" role="img" aria-label={`${rankLabel(display)}${full ? "" : `, 게이지 ${display.fill}/4`}`}>
      {!full && (
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <circle cx="80" cy="80" r="45" />
          <circle
            cx="80"
            cy="80"
            r="45"
            pathLength="100"
            strokeDasharray={`${display.fill * 25} 100`}
            transform="rotate(-90 80 80)"
            className="is-on"
          />
        </svg>
      )}
      <img src={`/rank/${display.ball}.png`} alt="" width={160} height={160} />
    </div>
  );
}
