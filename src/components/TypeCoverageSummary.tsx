import type { PartySlots } from "../hooks/useParty";
import { computePartyDefenseMatrix, type PartyDefenseVerdict } from "../lib/partyAnalysis";
import { TYPE_COLORS } from "../lib/typeColors";
import "./TypeCoverageSummary.css";

interface TypeCoverageSummaryProps {
  slots: PartySlots;
}

/** 방어 배율 → 표기. 등배(×1)는 애초에 셀에 안 들어온다. */
function multLabel(mult: number): string {
  if (mult === 0) return "면역";
  if (mult === 0.25) return "¼";
  if (mult === 0.5) return "½";
  if (mult === 2) return "×2";
  if (mult === 4) return "×4";
  return `×${mult}`;
}

/** 기존 cnt-* 색상 클래스 재사용 (백로그 §1-3) */
function multClass(mult: number): string {
  if (mult === 0) return "cnt cnt-immune";
  if (mult >= 4) return "cnt cnt-quad";
  if (mult >= 2) return "cnt cnt-weak";
  if (mult <= 0.25) return "cnt cnt-quadresist";
  return "cnt cnt-resist";
}

const VERDICT_SLUG: Record<PartyDefenseVerdict, string> = {
  취약: "weak",
  보통: "neutral",
  강점: "strong",
};

/** 메가·폼 라벨 축약 표시 */
function formTag(formLabel: string): string {
  return formLabel.includes("메가") ? "메가" : formLabel;
}

export function TypeCoverageSummary({ slots }: TypeCoverageSummaryProps) {
  const { members, rows } = computePartyDefenseMatrix(slots);

  return (
    <section className="type-coverage">
      <header className="type-coverage-header">
        <h2>타입 상성표</h2>
        <p>빌드한 포켓몬별 방어 배율입니다. 등배(×1)는 빈 칸, 마지막 열은 파티 전체 판정입니다.</p>
      </header>

      {members.length === 0 ? (
        <p className="type-coverage-empty">포켓몬을 배치하면 상성 요약이 표시됩니다.</p>
      ) : (
        <div className="type-matrix-scroll">
          <table className="type-matrix">
            <thead>
              <tr>
                <th className="tm-corner" aria-hidden="true" />
                {members.map((m) => (
                  <th
                    key={m.pokemonId}
                    className="tm-mon"
                    title={m.formLabel ? `${m.name} (${m.formLabel})` : m.name}
                  >
                    <span className="tm-mon-name">{m.name}</span>
                    {m.formLabel && <span className="tm-mon-form">{formTag(m.formLabel)}</span>}
                  </th>
                ))}
                <th className="tm-verdict-head">종합</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.type}>
                  <th className="tm-type" scope="row" title={`${row.type}타입 기술을 받을 때`}>
                    <span className="type-coverage-badge" style={{ background: TYPE_COLORS[row.type] }}>
                      {row.type}
                    </span>
                  </th>
                  {row.cells.map((cell, i) => (
                    <td key={members[i].pokemonId} className="tm-cell">
                      {cell !== null && (
                        <span className={multClass(cell)} title={`×${cell}`}>
                          {multLabel(cell)}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className={`tm-verdict tm-verdict-${VERDICT_SLUG[row.verdict]}`}>{row.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
