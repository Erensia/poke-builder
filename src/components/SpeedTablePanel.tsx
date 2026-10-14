import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { environmentTintBackground } from "../lib/environmentBackground";
import { getPokemon } from "../lib/data";
import { resolvePokemonSpriteUrl } from "../lib/sprites";
import { getEffectiveForm } from "../lib/pokemonForm";
import { evaluateSpeedMatchup } from "../lib/matchupEvaluator";
import { minPointsToPass, speedBreakpoints, speedOutlook, SPEED_FORMS, SPEED_TIERS, tierRow, type SpeedRow, type TierOutlook } from "../lib/speedTable";
import { MAX_ABILITY_POINTS_PER_STAT } from "../lib/statCalculator";
import type { MatchupSlot } from "../types/matchup";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import { PokemonPickerModal } from "./PokemonPickerModal";
import "./SpeedTablePanel.css";

interface SpeedTablePanelProps {
  slot: MatchupSlot;
  weather: WeatherKind | null;
  field: FieldKind | null;
  /** 내 포켓몬 카드 — 상태이상 아래에 끼울 순풍 토글을 받아 그린다 */
  card: (statusExtra: ReactNode) => ReactNode;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

const NATURE_MARK: Record<string, string> = { "스피드↑": "▲", "스피드↓": "▼" };

const rowLabel = (row: SpeedRow) => `${row.name} · ${row.value} (${row.nature} ${row.points}pt)`;
const rowKey = (row: SpeedRow) => `${row.name}|${row.nature}|${row.points}`;

interface PickProps {
  picked: SpeedRow | null;
  onPick: (row: SpeedRow) => void;
}

/** bare: 같은 성격만 모인 묶음이라 스피드↑/↓ 표시를 생략 */
function Chip({ row, picked, onPick, bare }: PickProps & { row: SpeedRow; bare?: boolean }) {
  const pokemon = getPokemon(row.form.pokemonId);
  const url = pokemon ? resolvePokemonSpriteUrl(pokemon, row.form.sprite) : null;
  const mark = bare ? undefined : NATURE_MARK[row.nature];
  return (
    <button type="button" className={`speedtab-chip${picked && rowKey(picked) === rowKey(row) ? " is-picked" : ""}`} title={rowLabel(row)} onClick={() => onPick(row)}>
      {url ? <img src={url} alt={row.name} loading="lazy" /> : <span className="speedtab-chip-name">{row.name}</span>}
      {mark && <i className="speedtab-chip-mark">{mark}</i>}
    </button>
  );
}

function Chips({ rows, bare, ...pick }: PickProps & { rows: SpeedRow[]; bare?: boolean }) {
  return (
    <span className="speedtab-chips">
      {rows.map((r) => (
        <Chip key={rowKey(r)} row={r} bare={bare} {...pick} />
      ))}
    </span>
  );
}

/** 접고 펼 수 있는 구역 — 기본은 펼침 */
function Fold({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <details className="speedtab-fold" open>
      <summary className="speedtab-title">{title}</summary>
      <div className="speedtab-fold-body">{children}</div>
    </details>
  );
}

/** 상대가 이 단계(최속·준속·무투자·최저속)라고 가정했을 때 추월 못 하는·동속·추월하는 폼 */
function TierBlock({ outlook: { tier, fail, tie, pass }, ...pick }: PickProps & { outlook: TierOutlook }) {
  return (
    <section className="speedtab-tier">
      <h4 className="speedtab-head">
        {tier.label} <small>{tier.note}</small>
      </h4>
      <p className="speedtab-summary">
        추월 <strong>{pass.length}</strong>종 · 동속 <strong>{tie.length}</strong>종 · 못 추월 <strong>{fail.length}</strong>종
      </p>
      {fail.length > 0 && (
        <div className="speedtab-group">
          <span className="speedtab-group-label">못 추월</span>
          <Chips rows={fail} bare {...pick} />
        </div>
      )}
      {tie.length > 0 && (
        <div className="speedtab-group">
          <span className="speedtab-group-label">동속</span>
          <Chips rows={tie} bare {...pick} />
        </div>
      )}
      {pass.length > 0 && (
        <details className="speedtab-group">
          <summary>추월 {pass.length}종 보기</summary>
          <Chips rows={pass} bare {...pick} />
        </details>
      )}
    </section>
  );
}

/** 내 포켓몬의 실효 스피드(도구·특성·랭크·상태이상·곡예는 슬롯 값, 순풍은 토글)와 상대 단계별 추월 대상·포인트 조정 */
export function SpeedTablePanel({ slot, weather, field, card }: SpeedTablePanelProps) {
  const [tailwind, setTailwind] = useState(false);
  // 칩을 누르면 위에 이름·값·성격·포인트를 보인다(마우스 없는 모바일 대안, 호버 툴팁도 같은 문구)
  const [picked, setPicked] = useState<SpeedRow | null>(null);
  const togglePick = (row: SpeedRow) => setPicked((p) => (p && rowKey(p) === rowKey(row) ? null : row));
  const pick = { picked, onPick: togglePick };
  // 조정 기능에서 넘기고 싶은 상대 포켓몬(종 id)
  const [target, setTarget] = useState<string | null>(null);
  const [pickingTarget, setPickingTarget] = useState(false);
  const pokemon = slot.pokemonId ? getPokemon(slot.pokemonId) : undefined;
  // 포인트 0~32별 내 실효 스피드. 같은 슬롯끼리 비교해 한쪽 실효 스피드만 얻는다(evaluateSpeedMatchup이 엔진과 같은 배율 순서를 이미 미러한다)
  const speedAt = useMemo(() => {
    if (!slot.pokemonId) return null;
    const speeds = Array.from({ length: MAX_ABILITY_POINTS_PER_STAT + 1 }, (_, spe) => {
      const evaluator = { ...slot, pokemonId: slot.pokemonId as string, points: { ...slot.points, spe } };
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
    });
    return speeds.every((s): s is number => s !== null) ? speeds : null;
  }, [slot, weather, field, tailwind]);
  const speed = speedAt?.[slot.points.spe] ?? null;
  const outlook = useMemo(() => (speed === null ? null : speedOutlook(speed)), [speed]);
  const breakpoints = useMemo(() => (speedAt ? speedBreakpoints(speedAt, slot.points.spe) : null), [speedAt, slot.points.spe]);
  const name = pokemon ? (getEffectiveForm(pokemon, slot).formLabel ?? pokemon.name) : "";
  const targetForms = target ? SPEED_FORMS.filter((f) => f.pokemonId === target) : [];

  const tailwindToggle = (
    <div className="matchup-assume-grave">
      <span className="matchup-assume-grave-label">순풍</span>
      <div className="matchup-hitcount-row">
        <button type="button" className={`matchup-hitcount-pip${tailwind ? " is-active" : ""}`} onClick={() => setTailwind((t) => !t)}>
          있음
        </button>
      </div>
    </div>
  );

  return (
    <div className="speedtab-board">
      <div className="speedtab-side">
        <div className="speedtab-card" style={{ "--env-tint": environmentTintBackground(weather, field) } as CSSProperties}>
          {card(tailwindToggle)}
        </div>
        {speedAt && (
          <Fold title="목표 포켓몬">
            <div className="speedtab-target-head">
              <button type="button" className="speedtab-target-btn" onClick={() => setPickingTarget(true)}>
                {target ? `${getPokemon(target)?.name ?? target} (바꾸기)` : "목표 포켓몬 고르기"}
              </button>
              {target && (
                <button type="button" className="speedtab-target-btn" onClick={() => setTarget(null)}>
                  지우기
                </button>
              )}
            </div>
            {targetForms.length > 0 && (
              <table className="speedtab-table">
                <thead>
                  <tr>
                    <th>폼</th>
                    {SPEED_TIERS.map((t) => (
                      <th key={t.label}>{t.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {targetForms.map((f) => (
                    <tr key={f.name}>
                      <th>{f.name}</th>
                      {SPEED_TIERS.map((t) => {
                        const row = tierRow(f, t);
                        const need = minPointsToPass(speedAt, row.value);
                        return (
                          <td key={t.label} className={need !== null && need <= slot.points.spe ? "is-pass" : ""}>
                            {need === null ? "불가" : `${need}pt`}
                            <small>{row.value}</small>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="speedtab-note">
              {target
                ? "추월하는 데 필요한 최소 스피드 포인트예요(작은 숫자는 상대 스피드 값 · 불가 = 32pt로도 못 넘음 · 강조 = 지금 포인트로 이미 추월)."
                : "상대 포켓몬을 고르면 최속·준속·무투자·최저속을 추월하는 데 필요한 최소 스피드 포인트를 알려줘요."}
            </p>
          </Fold>
        )}
      </div>
      {speed !== null && outlook && speedAt && breakpoints && (
        <div className="speedtab-result">
          <p className="speedtab-picked">{picked ? rowLabel(picked) : "포켓몬을 누르면 이름·값·성격·포인트가 보여요"}</p>

          <Fold title={<>상대 단계별 추월 <small>내 스피드 {fmt(speed)}</small></>}>
            {outlook.map((o) => (
              <TierBlock key={o.tier.label} outlook={o} {...pick} />
            ))}
            <p className="speedtab-note">상대는 도구·순풍·랭크 배율 전 값이에요(스카프 상대는 값이 1.5배). 같은 실수치는 동속이에요.</p>
          </Fold>

          <Fold title="포인트 조정">
            <p className="speedtab-summary">스피드 포인트를 올리다 추월 대상이 늘어나는 지점이에요(성격·도구·순풍·랭크는 지금 선택 그대로).</p>
            <ul className="speedtab-list">
              {breakpoints.map((b) => (
                <li key={b.points} className={`speedtab-bp${b.points === slot.points.spe ? " is-me" : ""}`}>
                  <strong className="speedtab-line-value">{b.points}pt</strong>
                  <span className="speedtab-bp-body">
                    <span className="speedtab-bp-speed">
                      스피드 {fmt(b.speed)}
                      {b.points === slot.points.spe && ` · 지금 ${name}`}
                    </span>
                    {SPEED_TIERS.map((t, i) =>
                      b.gains[i].length > 0 ? (
                        <span key={t.label} className="speedtab-group">
                          <span className="speedtab-group-label">
                            {t.label} +{b.gains[i].length}
                          </span>
                          <Chips rows={b.gains[i]} bare {...pick} />
                        </span>
                      ) : null,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Fold>
        </div>
      )}
      {pickingTarget && (
        <PokemonPickerModal
          onClose={() => setPickingTarget(false)}
          onSelect={(id) => {
            setTarget(id);
            setPickingTarget(false);
          }}
        />
      )}
    </div>
  );
}
