import { useEffect, useRef, useState } from "react";
import type { PartySlots } from "../hooks/useParty";
import { computeTypeCoverage, getPartyMembers } from "../lib/partyAnalysis";
import { getEffectiveness } from "../lib/typeEffectiveness";
import { TYPE_COLORS } from "../lib/typeColors";
import type { PokemonType } from "../types/pokemon-type";
import "./TypeCoverageSummary.css";

interface TypeCoverageSummaryProps {
  slots: PartySlots;
}

export function TypeCoverageSummary({ slots }: TypeCoverageSummaryProps) {
  const [openType, setOpenType] = useState<PokemonType | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const cells = computeTypeCoverage(slots);
  const hasAnyMember = slots.some((s) => s !== null);

  const members = getPartyMembers(slots);

  const openDetail =
    openType &&
    members
      .map((m) => ({ member: m, mult: getEffectiveness(openType, m.types) }))
      .filter((d) => d.mult !== 1)
      .sort((a, b) => b.mult - a.mult);

  // 타입 칸을 누르면 하단에 상세 패널이 새로 생기거나 내용(높이)이 바뀐다 — 이전에 골라둔 타입보다
  // 파티원이 더 많이 걸리는 타입으로 바꾸면 패널이 더 길어지는데, 그때도 항상 패널 끝까지(페이지
  // 가장 아래까지) 스크롤되도록 매번 openType이 바뀔 때마다 새로 계산해서 스크롤한다.
  useEffect(() => {
    if (!openType) return;
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [openType, openDetail?.length]);

  return (
    <section className="type-coverage">
      <header className="type-coverage-header">
        <h2>타입 상성 요약</h2>
        <p>현재 파티의 약점 타입을 한눈에 볼 수 있습니다. 타입을 선택하면 어떤 포켓몬이 해당되는지 보여줍니다.</p>
      </header>

      {!hasAnyMember ? (
        <p className="type-coverage-empty">포켓몬을 배치하면 상성 요약이 표시됩니다.</p>
      ) : (
        <div className="type-coverage-grid">
          {cells.map((cell) => {
            const totalFlag = cell.weak + cell.quad + cell.resist + cell.quadResist + cell.immune;
            return (
              <button
                type="button"
                key={cell.type}
                className={`type-coverage-cell${openType === cell.type ? " is-open" : ""}`}
                onClick={() => setOpenType(openType === cell.type ? null : cell.type)}
                disabled={totalFlag === 0}
              >
                <span
                  className="type-coverage-badge"
                  style={{ background: TYPE_COLORS[cell.type] }}
                >
                  {cell.type}
                </span>
                <span className="type-coverage-counts">
                  {cell.quad > 0 && <span className="cnt cnt-quad">×4 {cell.quad}</span>}
                  {cell.weak > 0 && <span className="cnt cnt-weak">×2 {cell.weak}</span>}
                  {cell.resist > 0 && <span className="cnt cnt-resist">½ {cell.resist}</span>}
                  {cell.quadResist > 0 && <span className="cnt cnt-quadresist">¼ {cell.quadResist}</span>}
                  {cell.immune > 0 && <span className="cnt cnt-immune">면역 {cell.immune}</span>}
                  {totalFlag === 0 && <span className="cnt cnt-neutral">-</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {openType && openDetail && (
        <div className="type-coverage-detail" ref={detailRef}>
          <h3>
            <span className="type-coverage-badge" style={{ background: TYPE_COLORS[openType] }}>
              {openType}
            </span>
            기술에 대한 포켓몬 상성
          </h3>
          {openDetail.length === 0 ? (
            <p className="type-coverage-empty">모두 등배(×1)로 받습니다.</p>
          ) : (
            <ul className="type-coverage-detail-list">
              {openDetail.map(({ member, mult }) => (
                <li key={member.pokemonId}>
                  <span>
                    {member.name}
                    {member.formLabel && <span className="type-coverage-form-tag"> 메가</span>}
                  </span>
                  <span
                    className={
                      mult === 0
                        ? "cnt cnt-immune"
                        : mult >= 4
                          ? "cnt cnt-quad"
                          : mult >= 2
                            ? "cnt cnt-weak"
                            : mult <= 0.25
                              ? "cnt cnt-quadresist"
                              : "cnt cnt-resist"
                    }
                  >
                    {mult === 0 ? "면역" : `×${mult}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
