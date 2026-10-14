import { useState } from "react";
import type { CandidateCard, CandidateLists, CandidateSort } from "../lib/candidateCards";
import "./CandidateCards.css";

const FIRST_PAGE = 12;

const pct = (n: number) => n.toFixed(1);

const SORTS: { id: CandidateSort; label: string; list: (l: CandidateLists) => CandidateCard[] }[] = [
  { id: "spare", label: "남은 SP 많은 순", list: (l) => l.bySpare },
  { id: "likelihood", label: "가능도 높은 순", list: (l) => l.byLikelihood },
  { id: "center", label: "범위 중앙에 가까운 순", list: (l) => l.byCenter },
];

const cardKey = (c: CandidateCard) => `${c.natureLabel}|${c.points.map((p) => p.value).join(",")}`;

function Card({ card }: { card: CandidateCard }) {
  const names = card.natureNames.length > 3 ? `${card.natureNames.slice(0, 3).join("·")} 외 ${card.natureNames.length - 3}` : card.natureNames.join("·");
  const ranges = card.damagePercent.map((r, i) => `${card.damagePercent.length > 1 ? `${i + 1}) ` : ""}${pct(r.min)}–${pct(r.max)}%`).join(" · ");
  return (
    <li className="cand-card" title={card.natureNames.join(", ")}>
      <strong className="cand-nature">
        {card.natureLabel} <small>{names}</small>
      </strong>
      <span className="cand-points">{card.points.map((p) => `${p.label} SP ${p.value}`).join(" / ")}</span>
      <span className="cand-meta">
        범위 {ranges} ·{" "}
        {card.rollMatch !== null ? `일치 난수 ${Number.isInteger(card.rollMatch) ? card.rollMatch : card.rollMatch.toFixed(1)}/16` : `가능도 ${Math.round(card.likelihood * 100)}%`}
      </span>
      <span className="cand-meta">남은 SP 최대 {card.spare}</span>
    </li>
  );
}

/** 남은 후보 중 구체적인 (성격 묶음, 포인트) 조합을 카드로 — 기본은 남은 SP가 많은 순(투자가 적은 후보부터) */
export function CandidateCards({ lists }: { lists: CandidateLists | null }) {
  const [sort, setSort] = useState<CandidateSort>("spare");
  const [all, setAll] = useState(false);
  if (!lists) return null;
  const current = SORTS.find((x) => x.id === sort)!;
  const cards = current.list(lists);
  // 관측이 하나면 가능도가 k/16 몇 가지뿐이라 동점이 많다 — 동점은 남은 SP 순으로 가려서 다른 순서의 앞쪽이 남은 SP 순과 같아질 수 있다
  const sameOrder = sort !== "spare" && lists.bySpare.slice(0, FIRST_PAGE).every((c, i) => cardKey(c) === cardKey(cards[i]));
  return (
    <details className="dinf-details cand">
      <summary>후보 카드 보기</summary>
      <div className="cand-body">
        <div className="matchup-hitcount-row">
          {SORTS.map((x) => (
            <button key={x.id} type="button" className={`matchup-hitcount-pip${sort === x.id ? " is-active" : ""}`} onClick={() => setSort(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        {sameOrder && <p className="dinf-note">이 관측에서는 앞쪽 후보들의 기준 값이 같아서(같으면 남은 SP가 많은 쪽을 먼저 보여줘요) 남은 SP 순과 같아요. 관측을 더 넣으면 갈려요.</p>}
        <ul className="cand-grid">
          {cards.slice(0, all ? cards.length : FIRST_PAGE).map((c, i) => (
            <Card key={i} card={c} />
          ))}
        </ul>
        {cards.length > FIRST_PAGE && (
          <button type="button" className="cand-more" onClick={() => setAll((v) => !v)}>
            {all ? `접기 (${FIRST_PAGE}장만 보기)` : `더 보기 (${cards.length}장까지)`}
          </button>
        )}
        <p className="dinf-note">
          가능한 후보 중 일부만 보여줘요. 범위는 이 후보가 낼 수 있는 데미지(난수 16단계의 양 끝)를 최대 HP에 대한 %로 낸 값이에요.
          남은 SP는 합계 66에서 이 후보가 쓴 만큼을 뺀 값으로, 나머지 스탯이 쓸 수 있는 최대치예요.
          "범위 중앙에 가까운 순"은 관측한 데미지가 후보의 난수 범위 한가운데에 가까운 순서예요(보기 편하게 줄 세우는 기준이고, 가능성의 크기는 아니에요).
        </p>
      </div>
    </details>
  );
}
