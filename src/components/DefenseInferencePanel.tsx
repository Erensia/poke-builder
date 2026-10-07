import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import type { MatchupSlot } from "../types/matchup";
import type { MegaEvolution, Pokemon } from "../types/pokemon";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import { MovePickerModal } from "./MovePickerModal";
import { PokemonAvatar } from "./PokemonAvatar";
import { TypeBadge } from "./TypeBadge";
import { getAbility, getItem, getMove, getPokemon } from "../lib/data";
import { getEffectiveForm } from "../lib/pokemonForm";
import { NEUTRAL_STAGES } from "../types/battleStats";
import {
  DEFENSE_ABILITY_CANDIDATES,
  DEFENSE_ITEM_CANDIDATES,
  GRID,
  inferDefense,
  inferenceUnsupportedReason,
  type InferenceInput,
  type InferenceObservation,
  type BulkEstimate,
  type CentralRange,
  type InferenceResult,
  type Range,
} from "../lib/defenseInference";
import { MAX_ABILITY_POINTS_PER_STAT } from "../lib/statCalculator";
import "./DefenseInferencePanel.css";

type Screen = "reflect" | "lightScreen" | "auroraVeil";

interface ObservationRow {
  id: number;
  moveId: string | null;
  critical: boolean;
  before: string;
  after: string;
  /** 이 관측을 맞을 때 상대가 메가진화한 폼("" = 메가 전) */
  megaForm: string;
}

interface DefenderActions {
  onPickPokemon: () => void;
  onClear: () => void;
  onCycleFormVariant: () => void;
  onCycleSizeForm: () => void;
}

interface DefenseInferencePanelProps {
  /** 내 포켓몬 카드 (MatchupSlotCard 재사용 — 기술 슬롯은 숨긴 채 넘어온다) */
  attackerCard: ReactNode;
  attacker: MatchupSlot;
  defender: MatchupSlot;
  defenderActions: DefenderActions;
  weather: WeatherKind | null;
  field: FieldKind | null;
}

const STAGE_OPTIONS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];

/** 줄에 고른 메가폼이 이 종에 실제로 있는 폼이면 그 이름, 아니면 메가 전("") */
function megaOf(row: ObservationRow, megas: MegaEvolution[] | undefined): string {
  return megas?.find((m) => m.form === row.megaForm)?.form ?? "";
}

function parsePercent(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const v = Number(text);
  return v >= 0 && v <= 100 ? v : null;
}

/** 이 종(폼 변종 포함)이 가질 수 있는 특성 중 방어에 영향을 주는 것 */
function defenseRelevantAbilities(pokemon: Pokemon): string[] {
  const names = new Set<string>();
  const add = (list: string[], hidden?: string) => {
    list.forEach((a) => names.add(a));
    if (hidden) names.add(hidden);
  };
  add(pokemon.abilities, pokemon.hiddenAbility);
  pokemon.formVariants?.forEach((f) => add(f.abilities, f.hiddenAbility));
  const relevant = new Set(DEFENSE_ABILITY_CANDIDATES.map((a) => a.id));
  return [...names].filter((id) => relevant.has(id));
}

function RangeBar({
  label,
  range,
  central,
  real,
}: {
  label: string;
  range: Range | null;
  central: CentralRange | null;
  real: Range | null;
}) {
  if (!range) return null;
  const pos = (v: number) => (v / MAX_ABILITY_POINTS_PER_STAT) * 100;
  const span = (min: number, max: number) => (min === max ? String(min) : `${min} ~ ${max}`);
  return (
    <div className="dinf-range">
      <span className="dinf-range-label">{label}</span>
      <div className="dinf-range-track" aria-hidden="true">
        <div className="dinf-range-fill" style={{ left: `${pos(range.min)}%`, width: `${Math.max(pos(range.max - range.min), 2)}%` }} />
        {central && (
          <div
            className="dinf-range-central"
            style={{ left: `${pos(central.lo)}%`, width: `${Math.max(pos(central.hi - central.lo), 2)}%` }}
          />
        )}
      </div>
      <span className="dinf-range-text">
        {central ? (
          <>
            <strong>{span(central.lo, central.hi)}</strong>
            <span className="dinf-range-real">
              {" "}
              (가장 그럴듯한 80% · 중앙 {central.median}) · 가능한 전체 {span(range.min, range.max)}
            </span>
          </>
        ) : (
          <strong>{span(range.min, range.max)}</strong>
        )}
        {real && <span className="dinf-range-real"> (실수치 {span(real.min, real.max)})</span>}
      </span>
    </div>
  );
}

/** 내구 지수(HP × 방어/특방 실수치) — 데미지 %가 실제로 알려 주는 값이라 포인트 범위보다 훨씬 좁다 */
function BulkLine({ label, estimate }: { label: string; estimate: BulkEstimate | null }) {
  if (!estimate) return null;
  const { central, support } = estimate;
  const half = Math.round(((central.hi - central.lo) / 2 / central.median) * 100);
  return (
    <div className="dinf-bulk">
      <span className="dinf-bulk-label">{label}</span>
      <span className="dinf-bulk-value">
        <strong>{central.median.toLocaleString()}</strong>
        <span className="dinf-bulk-error"> ±{half}%</span>
      </span>
      <span className="dinf-range-real">
        {" "}
        (가장 그럴듯한 80% {central.lo.toLocaleString()} ~ {central.hi.toLocaleString()} · 가능한 전체 {support.min.toLocaleString()} ~{" "}
        {support.max.toLocaleString()})
      </span>
    </div>
  );
}

const GRID_TICKS = [0, 4, 8, 12, 16, 20, 24, 28, 32];

function AllocationGrid({
  title,
  grid,
  weights,
  yLabel,
}: {
  title: string;
  grid: Uint8Array;
  /** 가능도 가중(0~1) — 있으면 진하기로 "얼마나 그럴듯한지" 표시 */
  weights: Float32Array | null;
  yLabel: string;
}) {
  const rows: number[] = [];
  for (let y = GRID - 1; y >= 0; y--) rows.push(y);
  // 눈금 위치: 칸 가운데 (값 + 0.5) / 33
  const pos = (v: number) => `${((v + 0.5) / GRID) * 100}%`;
  return (
    <div className="dinf-grid-wrap">
      <span className="dinf-grid-title">{title}</span>
      <span className="dinf-axis-name">세로 {yLabel} 포인트 ↑</span>
      <div className="dinf-plot">
        <div className="dinf-axis-y" aria-hidden="true">
          {GRID_TICKS.map((v) => (
            <span key={v} className="dinf-tick dinf-tick-y" style={{ bottom: pos(v) }}>
              {v}
            </span>
          ))}
        </div>
        <div className="dinf-grid" style={{ gridTemplateColumns: `repeat(${GRID}, 1fr)` }} role="img" aria-label={`${title} 분포`}>
          {rows.flatMap((y) =>
            Array.from({ length: GRID }, (_, x) => (
              <span
                key={`${x}-${y}`}
                className={grid[y * GRID + x] ? "dinf-cell is-on" : "dinf-cell"}
                style={grid[y * GRID + x] && weights ? { opacity: 0.45 + 0.55 * weights[y * GRID + x] } : undefined}
                title={`HP ${x} · ${yLabel} ${y}${
                  grid[y * GRID + x] ? (weights ? ` (가능 · 그럴듯함 ${Math.round(weights[y * GRID + x] * 100)}%)` : " (가능)") : ""
                }`}
              />
            )),
          )}
        </div>
        <div className="dinf-axis-x" aria-hidden="true">
          {GRID_TICKS.map((v) => (
            <span key={v} className="dinf-tick dinf-tick-x" style={{ left: pos(v) }}>
              {v}
            </span>
          ))}
        </div>
        <span className="dinf-axis-name dinf-axis-name-x">HP 포인트</span>
      </div>
      <span className="dinf-grid-axis">보라색 칸 = 관측과 맞는 배분, 진할수록 그럴듯해요. 칸에 마우스를 올리면 수치가 보여요.</span>
    </div>
  );
}

/**
 * 관측을 어떻게 모으면 범위가 좁아지는지 안내(2.4 X1). 화면 %가 정수라 한 번의 관측은 오차가 크고(난수 ±7%, 1% 단위 반올림),
 * 내구 지수는 큰 데미지·여러 번의 독립 관측일수록 좁아진다. 입력한 관측에서 눈에 띄는 약점이 있으면 알려 준다.
 */
function ObservationTips({ observations }: { observations: InferenceObservation[] }) {
  const small = observations.filter((o) => o.before - o.after > 0 && o.before - o.after < 15);
  const hasPhysical = observations.some((o) => o.move.category === "physical");
  const hasSpecial = observations.some((o) => o.move.category === "special");
  return (
    <details className="dinf-details dinf-tips">
      <summary>범위를 좁히는 관측 방법</summary>
      <ul>
        <li>
          <strong>큰 데미지</strong>: 한 방에 깎인 %가 클수록 정확해요. 15% 미만 관측은 1% 단위 반올림 오차가 커서 정보가 적어요.
        </li>
        <li>
          <strong>관측을 여러 번</strong>: 난수가 매번 달라서 같은 분류도 여러 번 모으면 내구 지수 오차가 줄어요(약 1/√횟수).
        </li>
        <li>
          <strong>물리와 특수 둘 다</strong>: 물리는 HP×방어, 특수는 HP×특방만 알려 줘요. 둘을 모아야 HP를 가려낼 수 있어요.
        </li>
        <li>
          <strong>입력을 정확히</strong>: 내 능력 랭크·벽·날씨·급소·상대 특성/도구 가정이 틀리면 배분이 아니라 계산이 어긋나요.
        </li>
      </ul>
      {small.length > 0 && <p className="dinf-warn">작은 데미지(15% 미만) 관측이 {small.length}건 있어요. 더 큰 기술로 다시 관측하면 좁아져요.</p>}
      {observations.length > 0 && (!hasPhysical || !hasSpecial) && (
        <p className="dinf-note">
          {hasPhysical ? "특수" : "물리"} 기술 관측이 없어서 {hasPhysical ? "특방" : "방어"}은 알 수 없어요.
        </p>
      )}
    </details>
  );
}

function ResultView({
  result,
  rowIdsByObservation,
}: {
  result: InferenceResult;
  rowIdsByObservation: number[];
}) {
  const number = (obsIndex: number) => rowIdsByObservation[obsIndex];
  if (result.status === "invalid") {
    return <p className="dinf-warn">관측을 계산할 수 없어요. 위 관측 줄의 안내를 확인해 주세요.</p>;
  }
  if (result.status === "contradiction") {
    return (
      <div className="dinf-contradiction">
        <strong>이 관측과 맞는 배분이 없어요.</strong>
        {result.culprits.length > 0 ? (
          <p>
            관측 {result.culprits.map((c) => `#${number(c)}`).join(", ")}을(를) 빼면 맞는 배분이 나와요. 그 관측의 % 입력·급소 체크를 다시 확인해 보세요.
          </p>
        ) : (
          <p>급소 여부, 상대 특성·도구 가정, 벽·랭크, "여유 있게 보기"를 확인해 보세요. 관측 사이에 상대가 회복했다면 맞지 않아요.</p>
        )}
      </div>
    );
  }
  return (
    <div className="dinf-result">
      <p className="dinf-summary">
        가능한 배분 <strong>{result.feasible.toLocaleString()}</strong> / {result.total.toLocaleString()} 가지
        <span className="dinf-summary-sub"> ({((result.feasible / result.total) * 100).toFixed(1)}%)</span>
      </p>
      <BulkLine label="물리 내구 지수" estimate={result.bulkPhysical} />
      <BulkLine label="특수 내구 지수" estimate={result.bulkSpecial} />
      <p className="dinf-note">
        내구 지수 = 상대 실제 HP × 방어(특방). 데미지 %가 실제로 알려 주는 값이라 포인트보다 훨씬 정확해요. 아래 포인트는 같은 내구를 내는
        HP·방어 조합이 여럿이라 범위가 넓게 나옵니다.
      </p>
      <RangeBar label="HP 포인트" range={result.hp} central={result.hpCentral} real={result.realHp} />
      <RangeBar label="방어 포인트" range={result.def} central={result.defCentral} real={result.realDef} />
      <RangeBar label="특방 포인트" range={result.spd} central={result.spdCentral} real={result.realSpd} />
      <p className="dinf-note">
        각 범위는 따로 본 값이에요. HP와 방어는 서로 바꿔 칠 수 있어서, 아래 분포에서 실제로 가능한 조합을 확인하세요.
      </p>

      <div className="dinf-natures">
        <span className="dinf-subtitle">성격</span>
        {result.groups.map((g) => (
          <span
            key={g.id}
            className={`dinf-nature-chip${g.feasible === 0 ? " is-no" : ""}`}
            title={g.natureNames.join(", ")}
          >
            {g.label} <em>{g.feasible === 0 ? "불가" : `${Math.round(g.weight * 100)}%`}</em>
          </span>
        ))}
      </div>

      <details className="dinf-details">
        <summary>HP × 방어 분포 보기</summary>
        <div className="dinf-grids">
          {result.hpDefGrid && <AllocationGrid title="HP × 방어" grid={result.hpDefGrid} weights={result.hpDefWeights} yLabel="방어" />}
          {result.hpSpdGrid && <AllocationGrid title="HP × 특방" grid={result.hpSpdGrid} weights={result.hpSpdWeights} yLabel="특방" />}
        </div>
      </details>
    </div>
  );
}

export function DefenseInferencePanel({
  attackerCard,
  attacker,
  defender,
  defenderActions,
  weather,
  field,
}: DefenseInferencePanelProps) {
  const [rows, setRows] = useState<ObservationRow[]>([{ id: 1, moveId: null, critical: false, before: "100", after: "", megaForm: "" }]);
  const [nextId, setNextId] = useState(2);
  const [movePickerRow, setMovePickerRow] = useState<number | null>(null);
  const [abilityId, setAbilityId] = useState<string>("");
  const [itemId, setItemId] = useState<string>("");
  const [screen, setScreen] = useState<Screen | "">("");
  const [defStage, setDefStage] = useState(0);
  const [spdStage, setSpdStage] = useState(0);
  const [tolerant, setTolerant] = useState(false);

  const attackerPokemon = attacker.pokemonId ? getPokemon(attacker.pokemonId) : undefined;
  const defenderPokemon = defender.pokemonId ? getPokemon(defender.pokemonId) : undefined;
  // 메가폼은 관측 줄마다 이 화면 안에서만 고른다(공유 슬롯·메가스톤 도구와 무관). 종이 바뀌어 없는 폼이면 메가 전으로 본다.
  const megas = defenderPokemon?.megaEvolutions;
  const defenderForm = defenderPokemon ? getEffectiveForm(defenderPokemon, { ...defender, item: null, activeMegaForm: undefined }) : undefined;

  const abilityOptions = defenderPokemon ? defenseRelevantAbilities(defenderPokemon) : [];
  // 종이 바뀌면 그 종이 가질 수 없는 특성 가정은 자동으로 해제
  const activeAbilityId = abilityOptions.includes(abilityId) ? abilityId : "";

  function updateRow(id: number, patch: Partial<ObservationRow>) {
    setRows((prev) => {
      const index = prev.findIndex((r) => r.id === id);
      if (index < 0) return prev;
      const oldAfter = prev[index].after;
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      // 다음 줄의 "맞기 전 %"가 이 줄의 옛 "맞은 뒤 %"와 같았으면(직접 안 고친 값) 같이 따라간다
      if (patch.after !== undefined && index + 1 < next.length && next[index + 1].before === oldAfter) {
        next[index + 1] = { ...next[index + 1], before: patch.after };
      }
      return next;
    });
  }

  function addRow() {
    const last = rows[rows.length - 1];
    // 메가진화는 되돌릴 수 없어서 새 줄은 직전 줄의 폼을 이어받는다
    setRows([...rows, { id: nextId, moveId: null, critical: false, before: last?.after ?? "100", after: "", megaForm: last ? megaOf(last, megas) : "" }]);
    setNextId(nextId + 1);
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  // 완성된 줄(기술 + 두 %)만 계산에 넣는다
  const complete = useMemo(() => {
    const out: { row: ObservationRow; obs: InferenceObservation }[] = [];
    const defenderMegas = defender.pokemonId ? getPokemon(defender.pokemonId)?.megaEvolutions : undefined;
    for (const row of rows) {
      const move = row.moveId ? getMove(row.moveId) : undefined;
      const before = parsePercent(row.before);
      const after = parsePercent(row.after);
      if (move && before !== null && after !== null) out.push({ row, obs: { move, critical: row.critical, before, after, megaForm: megaOf(row, defenderMegas) || undefined } });
    }
    return out;
  }, [rows, defender.pokemonId]);

  const input = useMemo<InferenceInput | null>(() => {
    if (!attacker.pokemonId || !defender.pokemonId || complete.length === 0) return null;
    return {
      attacker: { ...attacker, pokemonId: attacker.pokemonId },
      // 메가진화한 관측은 특성을 메가폼 값으로 계산하고, 하나라도 있으면 메가스톤이라 반감 열매 가정을 쓰지 못한다(엔진 쪽 처리)
      defender: {
        ...defender,
        pokemonId: defender.pokemonId,
        activeMegaForm: undefined,
        ability: activeAbilityId || null,
        item: itemId || null,
      },
      observations: complete.map((c) => c.obs),
      attackerStages: attacker.stages,
      attackerStatus: attacker.statusAssumed ?? null,
      defenderStages: { ...NEUTRAL_STAGES, def: defStage, spd: spdStage },
      weather: weather ?? undefined,
      field: field ?? undefined,
      screen: screen || undefined,
      tolerance: tolerant ? 1 : 0,
    };
  }, [attacker, defender, complete, activeAbilityId, itemId, weather, field, screen, defStage, spdStage, tolerant]);

  // 계산이 무거울 수 있어(물리+특수 관측이 함께면 수십만 후보) 입력은 즉시 반영하고 결과만 뒤따라 그린다
  const deferredInput = useDeferredValue(input);
  const result = useMemo(() => (deferredInput ? inferDefense(deferredInput) : null), [deferredInput]);
  const pending = input !== deferredInput;
  const anyMega = complete.some((c) => c.obs.megaForm);
  const rowIdsByObservation = complete.map((c) => rows.indexOf(c.row) + 1);

  function rowMessage(row: ObservationRow): { text: string; kind: "error" | "ok" } | null {
    const move = row.moveId ? getMove(row.moveId) : undefined;
    if (move) {
      const reason = inferenceUnsupportedReason(move);
      if (reason) return { text: reason, kind: "error" };
    }
    const before = parsePercent(row.before);
    const after = parsePercent(row.after);
    if (row.after.trim() !== "" && after === null) return { text: "%는 0~100 정수", kind: "error" };
    if (before !== null && after !== null && after > before) return { text: "맞은 뒤 %가 더 클 수 없어요", kind: "error" };
    const index = complete.findIndex((c) => c.row.id === row.id);
    if (index >= 0 && result && !pending) {
      const message = result.observationErrors[index];
      if (message) return { text: message, kind: "error" };
      if (result.status !== "invalid" && result.singleFeasible[index] === false) {
        return { text: "이 관측만으로도 맞는 배분이 없어요", kind: "error" };
      }
      if (result.status === "ok" && result.singleFeasible[index]) return { text: "가능", kind: "ok" };
    }
    return null;
  }

  return (
    <div className="dinf">
      <p className="dinf-intro">
        내 포켓몬이 상대를 때린 뒤 상대 HP가 몇 %가 됐는지 입력하면, 상대의 <strong>HP·방어(특방) 능력 포인트와 성격</strong>이 될 수 있는 범위를 좁혀 줘요.
        게임의 상대 HP는 정수 %로만 보이고 데미지에는 난수가 있어서, 정답 하나가 아니라 <strong>가능한 범위</strong>로 보여 줍니다.
      </p>

      <div className="dinf-board">
        {attackerCard}

        {defenderPokemon && defenderForm ? (
          <div className="matchup-slot matchup-slot-filled dinf-defender">
            <span className="matchup-slot-label">상대 포켓몬</span>
            <button type="button" className="matchup-slot-clear" onClick={defenderActions.onClear} aria-label="상대 비우기">
              ✕
            </button>
            <button type="button" className="matchup-slot-main" onClick={defenderActions.onPickPokemon}>
              <PokemonAvatar
                pokemon={defenderPokemon}
                size={42}
                radius={11}
                gradientTypes={defenderForm.types}
                className="matchup-slot-avatar"
                form={{ activeMegaForm: undefined, formVariant: defender.formVariant, sizeForm: defender.sizeForm, cosmeticForm: defender.cosmeticForm, item: null }}
              />
              <span className="matchup-slot-info">
                <span className="matchup-slot-name">{defenderPokemon.name}</span>
                <span className="matchup-slot-types">
                  {defenderForm.types.map((t) => (
                    <TypeBadge key={t} type={t} />
                  ))}
                </span>
              </span>
            </button>
            {(defenderPokemon.formVariants || defenderPokemon.sizeForms) && (
              <div className="dinf-defender-forms">
                {defenderPokemon.formVariants && (
                  <button type="button" onClick={defenderActions.onCycleFormVariant}>
                    폼 바꾸기{defenderForm.formLabel ? ` (${defenderForm.formLabel})` : ""}
                  </button>
                )}
                {defenderPokemon.sizeForms && (
                  <button type="button" onClick={defenderActions.onCycleSizeForm}>
                    크기 바꾸기{defenderForm.formLabel ? ` (${defenderForm.formLabel})` : ""}
                  </button>
                )}
              </div>
            )}
            <div className="dinf-defender-base">
              <span>
                종족값 HP <strong>{defenderForm.baseStats.hp}</strong>
              </span>
              <span>
                방어 <strong>{defenderForm.baseStats.def}</strong>
              </span>
              <span>
                특방 <strong>{defenderForm.baseStats.spd}</strong>
              </span>
            </div>
            <p className="dinf-unknown">
              역산 대상: <strong>HP · 방어 · 특방 포인트, 성격</strong>
            </p>
          </div>
        ) : (
          <div className="matchup-slot matchup-slot-empty dinf-defender">
            <span className="matchup-slot-label">상대 포켓몬</span>
            <button type="button" className="matchup-slot-empty-main" onClick={defenderActions.onPickPokemon}>
              <span className="matchup-slot-plus" aria-hidden="true">
                +
              </span>
              <span className="matchup-slot-empty-text">상대 포켓몬 선택</span>
            </button>
          </div>
        )}
      </div>

      <section className="dinf-section">
        <h3>가정 · 조건</h3>
        <div className="dinf-conditions">
          <label>
            상대 특성
            <select value={activeAbilityId} onChange={(e) => setAbilityId(e.target.value)} disabled={!defenderPokemon}>
              <option value="">{anyMega ? "모름 (메가 전 관측에 적용)" : "모름 (방어 특성 없음으로 가정)"}</option>
              {abilityOptions.map((id) => (
                <option key={id} value={id}>
                  {getAbility(id)?.name ?? id}
                </option>
              ))}
            </select>
          </label>
          <label>
            상대 도구
            <select value={anyMega ? "" : itemId} onChange={(e) => setItemId(e.target.value)} disabled={anyMega}>
              <option value="">{anyMega ? "메가스톤 (반감 열매 사용 불가)" : "모름 (도구 없음으로 가정)"}</option>
              {DEFENSE_ITEM_CANDIDATES.map((item) => (
                <option key={item.id} value={item.id}>
                  {getItem(item.id)?.name ?? item.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            벽
            <select value={screen} onChange={(e) => setScreen(e.target.value as Screen | "")}>
              <option value="">없음</option>
              <option value="reflect">리플렉터</option>
              <option value="lightScreen">빛의장막</option>
              <option value="auroraVeil">오로라베일</option>
            </select>
          </label>
          <label>
            상대 방어 랭크
            <select value={defStage} onChange={(e) => setDefStage(Number(e.target.value))}>
              {STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s > 0 ? `+${s}` : s}
                </option>
              ))}
            </select>
          </label>
          <label>
            상대 특방 랭크
            <select value={spdStage} onChange={(e) => setSpdStage(Number(e.target.value))}>
              {STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s > 0 ? `+${s}` : s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="dinf-check">
          <input type="checkbox" checked={tolerant} onChange={(e) => setTolerant(e.target.checked)} />
          <span>여유 있게 보기 (화면 %를 ±1%까지 허용 — 게임의 % 표시 방식이 다를 때 대비)</span>
        </label>
        <p className="dinf-note">날씨·필드는 위쪽 선택기 값을, 내 랭크·특성·도구는 내 포켓몬 카드 값을 그대로 써요.</p>
      </section>

      <section className="dinf-section">
        <h3>관측 (내가 때린 결과)</h3>
        <ol className="dinf-rows">
          {rows.map((row, index) => {
            const move = row.moveId ? getMove(row.moveId) : undefined;
            const message = rowMessage(row);
            return (
              <li key={row.id} className="dinf-row">
                <span className="dinf-row-no">#{index + 1}</span>
                <button
                  type="button"
                  className="dinf-move-btn"
                  onClick={() => setMovePickerRow(row.id)}
                  disabled={!attackerPokemon}
                  title={attackerPokemon ? undefined : "먼저 내 포켓몬을 골라 주세요"}
                >
                  {move ? move.name : "기술 선택"}
                </button>
                {megas && megas.length > 0 && (
                  <select
                    aria-label={`관측 ${index + 1} 상대 폼`}
                    value={megaOf(row, megas)}
                    onChange={(e) => updateRow(row.id, { megaForm: e.target.value })}
                  >
                    <option value="">메가 전</option>
                    {megas.map((m) => (
                      <option key={m.form} value={m.form}>
                        {m.form.replace(/^.*?-/, "")}
                      </option>
                    ))}
                  </select>
                )}
                <label className="dinf-crit">
                  <input type="checkbox" checked={row.critical} onChange={(e) => updateRow(row.id, { critical: e.target.checked })} />
                  급소
                </label>
                <span className="dinf-percent-pair">
                  <input
                    className="dinf-percent"
                    inputMode="numeric"
                    aria-label={`관측 ${index + 1} 맞기 전 %`}
                    value={row.before}
                    onChange={(e) => updateRow(row.id, { before: e.target.value })}
                  />
                  <span>% →</span>
                  <input
                    className="dinf-percent"
                    inputMode="numeric"
                    aria-label={`관측 ${index + 1} 맞은 뒤 %`}
                    placeholder="?"
                    value={row.after}
                    onChange={(e) => updateRow(row.id, { after: e.target.value })}
                  />
                  <span>%</span>
                </span>
                {message && <span className={`dinf-row-msg is-${message.kind}`}>{message.text}</span>}
                {rows.length > 1 && (
                  <button type="button" className="dinf-row-remove" onClick={() => removeRow(row.id)} aria-label={`관측 ${index + 1} 삭제`}>
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        <button type="button" className="dinf-add" onClick={addRow}>
          + 관측 추가
        </button>
        <p className="dinf-note">관측 사이에 상대가 HP를 회복하지 않았다고 가정해요. 다단히트·고정 데미지 기술은 아직 지원하지 않아요.</p>
      </section>

      <section className="dinf-section dinf-result-section" aria-live="polite">
        <h3>
          결과 {pending && <span className="dinf-pending">계산 중…</span>}
        </h3>
        {!attackerPokemon || !defenderPokemon ? (
          <p className="dinf-hint">내 포켓몬과 상대 포켓몬을 먼저 골라 주세요.</p>
        ) : !result ? (
          <p className="dinf-hint">관측의 기술과 맞은 뒤 %를 입력하면 결과가 나와요.</p>
        ) : (
          <div className={pending ? "dinf-stale" : undefined}>
            <ResultView result={result} rowIdsByObservation={rowIdsByObservation} />
          </div>
        )}
        <ObservationTips observations={complete.map((c) => c.obs)} />
        <p className="dinf-assume">
          가정: 화면 %는 내림(HP가 남으면 최소 1%) · 상대 특성{" "}
          {activeAbilityId ? getAbility(activeAbilityId)?.name : "없음(모름)"}{anyMega ? " (메가 후 관측은 메가폼 특성)" : ""} · 상대 도구{" "}
          {anyMega ? "메가스톤" : itemId ? getItem(itemId)?.name : "없음(모름)"} · 관측 사이 회복 없음{tolerant ? " · ±1% 여유" : ""}
        </p>
      </section>

      {movePickerRow !== null && attackerPokemon && (
        <MovePickerModal
          pokemon={attackerPokemon}
          formVariant={attacker.formVariant}
          currentMoveIds={[rows.find((r) => r.id === movePickerRow)?.moveId ?? null]}
          onClose={() => setMovePickerRow(null)}
          onSelect={(moveId) => {
            updateRow(movePickerRow, { moveId });
            setMovePickerRow(null);
          }}
          onClear={() => {
            updateRow(movePickerRow, { moveId: null });
            setMovePickerRow(null);
          }}
        />
      )}
    </div>
  );
}
