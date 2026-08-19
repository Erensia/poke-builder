import { useState } from "react";
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
  const cells = computeTypeCoverage(slots);
  const hasAnyMember = slots.some((s) => s !== null);

  const members = getPartyMembers(slots);

  const openDetail =
    openType &&
    members
      .map((m) => ({ member: m, mult: getEffectiveness(openType, m.types) }))
      .filter((d) => d.mult !== 1)
      .sort((a, b) => b.mult - a.mult);

  return (
    <section className="type-coverage">
      <header className="type-coverage-header">
        <h2>타입 상성 요약</h2>
        <p>공격 타입별로 파티가 얼마나 약한지/버티는지 한눈에 봅니다. 칸을 누르면 어떤 포켓몬이 해당되는지 보여줍니다.</p>
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
        <div className="type-coverage-detail">
          <h3>
            <span className="type-coverage-badge" style={{ background: TYPE_COLORS[openType] }}>
              {openType}
            </span>
            공격에 대한 파티원 반응
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
