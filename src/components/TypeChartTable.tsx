import { useState } from "react";
import typeChart from "../data/typeChart.json";
import { POKEMON_TYPES, type PokemonType } from "../types/pokemon-type";
import { TYPE_COLORS } from "../lib/typeColors";
import { TypeBadge } from "./TypeBadge";
import "./TypeChartTable.css";

const CHART = typeChart as Record<PokemonType, Record<string, number>>;
const SYMBOL: Record<number, string> = { 2: "2", 0.5: "½", 0: "0" };
const CLASS: Record<number, string> = { 2: "is-super", 0.5: "is-resist", 0: "is-immune" };

/** 타입 머리글 — 넓은 화면은 타입 아이콘, 좁은 화면은 색 칸 + 첫 글자(CSS로 전환) */
function TypeHead({ type }: { type: PokemonType }) {
  return (
    <>
      <span className="tc-icon">
        <TypeBadge type={type} />
      </span>
      <span className="tc-chip" style={{ background: TYPE_COLORS[type] }} title={type}>
        {type[0]}
      </span>
    </>
  );
}

/**
 * 타입 상성표(3.0 N1) — 도감에서 포켓몬을 고르지 않았을 때 빈 패널에 보여 준다. 가로 = 공격 타입, 세로 = 방어 타입.
 * ×2·×½·×0만 표시하고 ×1은 비운다. 값은 배틀·분석과 같은 typeChart.json.
 */
export function TypeChartTable() {
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  return (
    <div className="tc">
      <h3 className="tc-title">타입 상성표</h3>
      <p className="tc-legend">
        <span className="tc-key is-super">2</span> 효과가 굉장 <span className="tc-key is-resist">½</span> 별로 <span className="tc-key is-immune">0</span> 효과 없음 · 가로 = 공격 타입, 세로 = 방어 타입
      </p>
      <table className="tc-table" onMouseLeave={() => setHover(null)}>
        <thead>
          <tr>
            <th className="tc-corner" scope="col" aria-label="공격 타입(가로) / 방어 타입(세로)" />
            {POKEMON_TYPES.map((atk, c) => (
              <th key={atk} scope="col" className={hover?.col === c ? "is-hl" : undefined} aria-label={`공격 ${atk}`}>
                <TypeHead type={atk} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {POKEMON_TYPES.map((def, r) => (
            <tr key={def}>
              <th scope="row" className={hover?.row === r ? "is-hl" : undefined} aria-label={`방어 ${def}`}>
                <TypeHead type={def} />
              </th>
              {POKEMON_TYPES.map((atk, c) => {
                const v = CHART[atk][def] ?? 1;
                const hl = hover && (hover.row === r || hover.col === c) ? " is-hl" : "";
                return (
                  <td
                    key={atk}
                    className={`${CLASS[v] ?? ""}${hl}`}
                    onMouseEnter={() => setHover({ row: r, col: c })}
                    title={v === 1 ? undefined : `${atk} → ${def}: ×${v}`}
                  >
                    {SYMBOL[v]}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
