import { useMemo, useState, type ReactNode } from "react";
import { getPokemon } from "../lib/data";
import { resolvePokemonSpriteUrl } from "../lib/sprites";
import { getEffectiveForm } from "../lib/pokemonForm";
import { evaluateSpeedMatchup } from "../lib/matchupEvaluator";
import { speedNeighbors, type SpeedLine, type SpeedRow } from "../lib/speedTable";
import type { MatchupSlot } from "../types/matchup";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import "./SpeedTablePanel.css";

interface SpeedTablePanelProps {
  slot: MatchupSlot;
  weather: WeatherKind | null;
  field: FieldKind | null;
  card: ReactNode;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

const NATURE_MARK: Record<string, string> = { "스피드↑": "▲", "스피드↓": "▼" };

const rowLabel = (row: SpeedRow) => `${row.name} · ${row.nature} · ${row.points}pt`;

function Chip({ row, picked, onPick }: { row: SpeedRow; picked: boolean; onPick: (row: SpeedRow) => void }) {
  const pokemon = getPokemon(row.form.pokemonId);
  const url = pokemon ? resolvePokemonSpriteUrl(pokemon, row.form.sprite) : null;
  const mark = NATURE_MARK[row.nature];
  return (
    <button type="button" className={`speedtab-chip${picked ? " is-picked" : ""}`} title={rowLabel(row)} onClick={() => onPick(row)}>
      {url ? <img src={url} alt={row.name} loading="lazy" /> : <span className="speedtab-chip-name">{row.name}</span>}
      {mark && <i className="speedtab-chip-mark">{mark}</i>}
    </button>
  );
}

function Line({ value, rows, className, picked, onPick }: { value: string; rows: SpeedRow[]; className?: string; picked: SpeedRow | null; onPick: (row: SpeedRow) => void }) {
  return (
    <li className={`speedtab-line${className ? ` ${className}` : ""}`}>
      <strong className="speedtab-line-value">{value}</strong>
      <span className="speedtab-chips">
        {rows.map((r) => (
          <Chip key={r.name} row={r} picked={picked?.name === r.name} onPick={onPick} />
        ))}
      </span>
    </li>
  );
}

/** 내 포켓몬의 실효 스피드(도구·특성·랭크·상태이상·곡예는 슬롯 값, 순풍은 토글)와 표 위의 이웃들 */
export function SpeedTablePanel({ slot, weather, field, card }: SpeedTablePanelProps) {
  const [tailwind, setTailwind] = useState(false);
  // 칩을 누르면 아래에 이름·성격·포인트를 보인다(마우스 없는 모바일 대안, 호버 툴팁도 같은 문구)
  const [picked, setPicked] = useState<SpeedRow | null>(null);
  const togglePick = (row: SpeedRow) => setPicked((p) => (p?.name === row.name ? null : row));
  const lines = (list: SpeedLine[]) => list.map((l) => <Line key={l.value} value={String(l.value)} rows={l.rows} picked={picked} onPick={togglePick} />);
  const pokemon = slot.pokemonId ? getPokemon(slot.pokemonId) : undefined;
  // 같은 슬롯끼리 비교해 한쪽 실효 스피드만 얻는다(evaluateSpeedMatchup이 엔진과 같은 배율 순서를 이미 미러한다)
  const speed = useMemo(() => {
    if (!slot.pokemonId) return null;
    const evaluator = { ...slot, pokemonId: slot.pokemonId };
    return (
      evaluateSpeedMatchup(evaluator, evaluator, {
        weather: weather ?? undefined,
        field: field ?? undefined,
        attackerStatus: slot.statusAssumed,
        attackerUnburden: slot.unburdenAssumed,
        attackerTailwind: tailwind,
        attackerStages: slot.stages,
      })?.attackerSpeed ?? null
    );
  }, [slot, weather, field, tailwind]);
  const near = useMemo(() => (speed === null ? null : speedNeighbors(speed)), [speed]);
  const name = pokemon ? (getEffectiveForm(pokemon, slot).formLabel ?? pokemon.name) : "";

  return (
    <div className="speedtab-board">
      {card}
      {speed !== null && near && (
        <div className="speedtab-result">
          <label className="matchup-assume-toggle">
            <input type="checkbox" checked={tailwind} onChange={(e) => setTailwind(e.target.checked)} />
            <span>순풍 (×2)</span>
          </label>
          <p className="speedtab-summary">
            나보다 항상 빠름 <strong>{near.alwaysFaster}</strong>종 · 투자에 따라 갈림 <strong>{near.mixed}</strong>종 · 항상 느림{" "}
            <strong>{near.alwaysSlower}</strong>종
          </p>
          <ol className="speedtab-list">
            {lines(near.above)}
            <li className="speedtab-line is-me">
              <strong className="speedtab-line-value">{fmt(speed)}</strong>
              <span className="speedtab-chips">
                <span className="speedtab-me">▶ {name}</span>
                {near.tie.map((r) => (
                  <Chip key={r.name} row={r} picked={picked?.name === r.name} onPick={togglePick} />
                ))}
              </span>
            </li>
            {lines(near.below)}
          </ol>
          <p className="speedtab-picked">{picked ? rowLabel(picked) : "포켓몬을 누르면 이름·성격·포인트가 보여요"}</p>
          <p className="speedtab-note">
            도구·순풍·랭크 배율 전 표예요. 같은 실수치는 한 줄에 모았고, 폼마다 가까운 경우(▲스피드↑ · ▼스피드↓ · 숫자는 포인트) 하나만 보여요. 
          </p>
        </div>
      )}
    </div>
  );
}
