import { getAbility, getItem } from "../lib/data";
import { countExtremeCells } from "../lib/defenseInference";
import type { CombinedInference } from "../lib/combinedInference";
import {
  GRID,
  isExtremePoints,
  type InferenceObservation,
  type BulkEstimate,
  type CentralRange,
  type FormView,
  type InferenceResult,
  type Range,
} from "../lib/defenseInference";
import type { AttackInferenceResult } from "../lib/attackInference";
import { SPEED_ITEM_CANDIDATES, type SpeedConditions, type SpeedInferenceResult } from "../lib/speedInference";
import { MAX_ABILITY_POINTS_PER_STAT } from "../lib/statCalculator";
import { CandidateCards } from "./CandidateCards";
import { STAGE_OPTIONS, describeConditions, PART_LABELS } from "./defenseInferenceHelpers";

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
                className={`${grid[y * GRID + x] ? "dinf-cell is-on" : "dinf-cell"}${isExtremePoints([x, y]) ? " is-extreme" : ""}`}
                style={grid[y * GRID + x] && weights ? { opacity: 0.45 + 0.55 * weights[y * GRID + x] } : undefined}
                title={`HP ${x} · ${yLabel} ${y}${isExtremePoints([x, y]) ? " · 극보정 형태" : ""}${
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
      <span className="dinf-grid-axis">
        보라색 칸 = 관측과 맞는 배분, 진할수록 그럴듯해요. 점선 테두리 = 극보정 형태(32 또는 합 2 이하). 칸에 마우스를 올리면 수치가 보여요.
      </span>
    </div>
  );
}

/**
 * 관측을 어떻게 모으면 범위가 좁아지는지 안내(2.4 X1). 화면 %가 정수라 한 번의 관측은 오차가 크고(난수 ±7%, 1% 단위 반올림),
 * 내구 지수는 큰 데미지·여러 번의 독립 관측일수록 좁아진다. 입력한 관측에서 눈에 띄는 약점이 있으면 알려 준다.
 */
export function ObservationTips({ observations }: { observations: InferenceObservation[] }) {
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

/**
 * 극보정 형태와 맞는 후보 수(3.1 C2-a) — 계산·가중에는 반영하지 않는 참고 표시. 하나도 없으면 일반적이지 않은 배분일 수 있다.
 * 격자(HP×방어, HP×특방)의 가능한 칸 가운데 32 또는 합 2 이하 모양인 칸을 센다.
 */
function ExtremeSummary({ result }: { result: InferenceResult }) {
  const parts = [
    { label: "HP × 방어", grid: result.hpDefGrid },
    { label: "HP × 특방", grid: result.hpSpdGrid },
  ].flatMap(({ label, grid }) => (grid ? [{ label, ...countExtremeCells(grid) }] : []));
  if (parts.length === 0) return null;
  const none = parts.every((p) => p.extreme === 0);
  return (
    <p className={`dinf-note${none ? " dinf-extreme-none" : ""}`}>
      극보정 형태(능력 포인트 32 또는 합 2 이하)와 맞는 후보:{" "}
      {parts.map((p, i) => (
        <span key={p.label}>
          {i > 0 && " · "}
          {p.label} <strong>{p.extreme}칸</strong> / 가능 {p.feasible}칸
        </span>
      ))}
      {none ? " — 극보정 후보가 하나도 없어요. 일반적이지 않은 배분(포인트를 나눠 투자)일 수 있어요." : ""} 계산에는 반영하지 않는 참고 표시예요.
    </p>
  );
}

/** 포인트 합의 범위 문구 — 하한이 0이면 상한만(3.3 V5: 합계 66을 다 쓴다고 보아 하한이 생기기도 한다) */
const rangeText = (min: number, max: number) => (min > 0 ? `${min}~${max}` : `${max} 이하`);

/** 방어·공격·스피드 결합 결과(3.1 C2-b·C2-c) — 관측이 있는 쪽들이 합친 성격 후보와 반영한 포인트 상한, 서로 안 맞을 때의 안내 */
export function CombinedView({ combined }: { combined: CombinedInference }) {
  const names = combined.parts.map((p) => PART_LABELS[p]).join(" · ");
  if (combined.conflict === "nature") {
    return <p className="dinf-warn">{names} 쪽에서 가능한 성격이 하나도 겹치지 않아요. 급소·가정·메가·조건 선택을 확인해 보세요.</p>;
  }
  if (combined.conflict === "points") {
    return <p className="dinf-warn">{names} 쪽 관측이 요구하는 포인트를 더하면 합계 66을 넘어요. 급소·가정·메가·조건 선택을 확인해 보세요.</p>;
  }
  if (!combined.natures || !combined.budget) return null;
  const { defenseMax, attackMax, speedMax, defenseMin, attackMin, speedMin } = combined.budget;
  const limits = [
    defenseMax !== null && `HP+방어+특방은 ${rangeText(defenseMin, defenseMax)}`,
    attackMax !== null && `공격+특공은 ${rangeText(attackMin, attackMax)}`,
    speedMax !== null && `스피드는 ${rangeText(speedMin, speedMax)}`,
  ].filter(Boolean);
  return (
    <div className="dinf-result">
      <h4 className="dinf-subhead">두 쪽을 합친 결과</h4>
      <div className="dinf-natures">
        <span className="dinf-subtitle">성격</span>
        {combined.natures.map((n) => (
          <span key={n.name} className="dinf-nature-chip tap-target">
            {n.name} <em>{n.weight >= 0.01 ? `${Math.round(n.weight * 100)}%` : "<1%"}</em>
          </span>
        ))}
      </div>
      <p className="dinf-note">
        성격은 한 값이라 {names} 쪽에서 모두 가능한 성격만 남겼어요. 포인트 합계는 66을 다 쓴다고 보고 {limits.join(", ")}로 따졌어요.
        {combined.speed && " 스피드 하한은 남은 성격 후보를 모두 고려한 최솟값이라, 성격 후보가 줄수록 올라가 다른 쪽 상한을 더 낮춰요."}
      </p>
    </div>
  );
}

/** 상대 공격(특공) 역산 결과(3.1 C2-b) — 내가 받은 데미지 관측으로 좁힌 값 */
export function AttackResultView({ result, rowNos, combinedOn }: { result: AttackInferenceResult; rowNos: number[]; combinedOn: boolean }) {
  if (result.status === "invalid") {
    return <p className="dinf-warn">관측을 계산할 수 없어요. 위 관측 줄의 안내를 확인해 주세요.</p>;
  }
  if (result.status === "contradiction") {
    return (
      <div className="dinf-contradiction">
        <strong>이 관측과 맞는 공격 배분이 없어요.</strong>
        {result.culprits.length > 0 ? (
          <p>관측 {result.culprits.map((c) => `#${rowNos[c]}`).join(", ")}을(를) 빼면 맞는 배분이 나와요. 그 관측의 HP 입력·급소 체크를 다시 확인해 보세요.</p>
        ) : (
          <p>급소 여부, 상대 공격 보정 가정(도구·특성), 상대 공격 랭크·화상, 내 쪽 벽·랭크를 확인해 보세요. 턴 종료 효과가 섞인 HP를 넣었다면 맞지 않아요.</p>
        )}
      </div>
    );
  }
  return (
    <div className="dinf-result">
      <p className="dinf-summary">
        가능한 공격 배분 <strong>{result.feasible.toLocaleString()}</strong> / {result.total.toLocaleString()} 가지
      </p>
      <RangeBar label="공격 포인트" range={result.atk} central={result.atkCentral} real={result.realAtk} />
      <RangeBar label="특공 포인트" range={result.spa} central={result.spaCentral} real={result.realSpa} />
      <div className="dinf-natures">
        <span className="dinf-subtitle">공격·특공 보정</span>
        {result.groups.map((g) => (
          <span key={g.id} className={`dinf-nature-chip tap-target${g.feasible === 0 ? " is-no" : ""}`} title={g.natureNames.join(", ")}>
            {g.label} <em>{g.feasible === 0 ? "불가" : `${Math.round(g.weight * 100)}%`}</em>
          </span>
        ))}
      </div>
      <CandidateCards lists={result.candidates} />
      <p className="dinf-note">
        관측이 1번이면 난수(±7%)와 성격(±10%) 때문에 범위가 넓어요. 같은 종류(물리/특수)의 공격을 여러 번 모을수록 좁아져요.{" "}
        {combinedOn
          ? "성격과 포인트 합계(66)는 다른 쪽 관측 결과와 합쳐 따졌어요."
          : "내가 입힌 데미지·선후공 관측도 함께 넣으면 성격과 포인트 합계(66)를 같이 따져 더 좁아져요."}
      </p>
    </div>
  );
}

/** 상대 스피드 역산 결과(3.1 C2-c) — 선후공 관측으로 좁힌 값 */
export function SpeedResultView({ result, rowNos, combinedOn }: { result: SpeedInferenceResult; rowNos: number[]; combinedOn: boolean }) {
  if (result.status === "invalid") {
    return <p className="dinf-warn">관측을 계산할 수 없어요. 위 관측 줄의 안내를 확인해 주세요.</p>;
  }
  if (result.status === "contradiction") {
    return (
      <div className="dinf-contradiction">
        <strong>이 관측과 맞는 스피드가 없어요.</strong>
        {result.culprits.length > 0 ? (
          <p>관측 {result.culprits.map((c) => `#${rowNos[c]}`).join(", ")}을(를) 빼면 맞는 스피드가 나와요. 그 관측의 누가 먼저·조건을 다시 확인해 보세요.</p>
        ) : (
          <p>트릭룸·순풍·마비·랭크 조건, 상대 속도 보정 도구·특성 가정을 확인해 보세요. 관측 사이에 상대의 랭크가 바뀌었다면 줄마다 조건을 따로 넣어야 해요.</p>
        )}
      </div>
    );
  }
  return (
    <div className="dinf-result">
      <p className="dinf-summary">
        가능한 스피드 후보 <strong>{result.feasible.toLocaleString()}</strong> / {result.total.toLocaleString()} 가지
      </p>
      <RangeBar label="스피드 포인트" range={result.spe} central={result.speCentral} real={result.realSpe} />
      <div className="dinf-natures">
        <span className="dinf-subtitle">스피드 보정</span>
        {result.groups.map((g) => (
          <span key={g.id} className={`dinf-nature-chip tap-target${g.feasible === 0 ? " is-no" : ""}`} title={g.natureNames.join(", ")}>
            {g.label} <em>{g.feasible === 0 ? "불가" : `${Math.round(g.weight * 100)}%`}</em>
          </span>
        ))}
      </div>
      <p className="dinf-note">
        선후공은 “이 값보다 빠르다/느리다”만 알려 줘서, 상대 속도가 내 속도 근처일 때만 정보가 커요(관측을 8번 모아도 실수치 폭이 평균 35 정도 남아요). 내 순풍·상대
        랭크·마비 같은 조건을 바꿔 가며 모을수록 좁아져요. 실수치는 조건 배율을 적용하기 전 값이에요.{" "}
        {combinedOn
          ? "성격과 포인트 합계(66)는 다른 쪽 관측 결과와 합쳐 따졌어요."
          : "내가 입힌·받은 데미지 관측도 함께 넣으면 성격과 포인트 합계(66)를 같이 따져 더 좁아져요."}
      </p>
    </div>
  );
}

const FORM_STAT_ROWS = [
  ["hp", "HP"],
  ["def", "방어"],
  ["spd", "특방"],
  ["atk", "공격"],
  ["spa", "특공"],
  ["spe", "스피드"],
] as const;

/**
 * 메가 전·후 비교(3.1 L1-b) — 방어·공격·스피드 결과의 폼별 표시값을 폼 하나당 한 열로 합친다.
 * 메가진화는 포인트·성격이 그대로라, 같은 후보를 각 폼의 종족값으로 환산한 실수치다. 위쪽 각 결과의 실수치·내구 지수는 마지막 관측 폼 기준.
 */
export function FormCompare({ views }: { views: FormView[][] }) {
  const forms = new Map<string, FormView>();
  for (const list of views) {
    for (const v of list) {
      const prev = forms.get(v.form);
      forms.set(v.form, prev ? { ...prev, real: { ...prev.real, ...v.real }, bulkPhysical: prev.bulkPhysical ?? v.bulkPhysical, bulkSpecial: prev.bulkSpecial ?? v.bulkSpecial } : v);
    }
  }
  const columns = [...forms.values()].sort((a, b) => Number(!!a.form) - Number(!!b.form));
  if (columns.length < 2) return null;
  const span = (min: number, max: number) => (min === max ? String(min) : `${min} ~ ${max}`);
  const bulkCell = (b: FormView["bulkPhysical"]) =>
    b ? (
      <>
        <strong>{b.central.median.toLocaleString()}</strong>
        <span className="dinf-range-real">
          {" "}
          ({b.central.lo.toLocaleString()} ~ {b.central.hi.toLocaleString()})
        </span>
      </>
    ) : (
      "—"
    );
  const statRows = FORM_STAT_ROWS.filter(([key]) => columns.some((c) => c.real[key]));
  const bulkRows = [
    { label: "물리 내구 지수", pick: (c: FormView) => c.bulkPhysical },
    { label: "특수 내구 지수", pick: (c: FormView) => c.bulkSpecial },
  ].filter((r) => columns.some((c) => r.pick(c)));
  return (
    <div className="dinf-result">
      <h4 className="dinf-subhead">메가 전·후 비교</h4>
      <div className="dinf-form-scroll">
        <table className="dinf-form-table">
          <thead>
            <tr>
              <th scope="col" />
              {columns.map((c) => (
                <th key={c.form} scope="col">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {statRows.map(([key, label]) => (
              <tr key={key}>
                <th scope="row">{label} 실수치</th>
                {columns.map((c) => (
                  <td key={c.form}>{c.real[key] ? span(c.real[key].min, c.real[key].max) : "—"}</td>
                ))}
              </tr>
            ))}
            {bulkRows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {columns.map((c) => (
                  <td key={c.form}>{bulkCell(r.pick(c))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dinf-note">
        메가진화는 능력 포인트와 성격이 그대로라서, 같은 후보를 폼마다 그 폼의 종족값으로 환산했어요. 내구 지수는 가장 그럴듯한 80% 구간(괄호)과 중앙값이에요.
      </p>
    </div>
  );
}

/** 선후공 줄 한 개의 조건 입력 — 접이식. 내 랭크·특성·도구는 내 카드, 날씨·필드는 위쪽 선택기 값을 쓴다 */
export function SpeedConditionsEditor({
  cond,
  onChange,
  abilityOptions,
  megaRow,
  itemDisabled,
  myQuickFeet,
}: {
  cond: SpeedConditions;
  onChange: (patch: Partial<SpeedConditions>) => void;
  abilityOptions: string[];
  /** 이 줄이 메가 후 관측이면 상대 특성은 메가폼 값을 쓴다 */
  megaRow: boolean;
  /** 메가 관측이 하나라도 있으면 메가스톤이라 속도 보정 도구를 쓸 수 없다 */
  itemDisabled: boolean;
  /** 내 포켓몬 특성이 속보 — 마비 외 상태이상 체크를 보여 준다 */
  myQuickFeet: boolean;
}) {
  const active = describeConditions(cond);
  const checks: [keyof SpeedConditions, string][] = [
    ["trickRoom", "트릭룸"],
    ["myTailwind", "내 쪽 순풍"],
    ["oppTailwind", "상대 쪽 순풍"],
    ["myParalyzed", "내 마비"],
    ["oppParalyzed", "상대 마비"],
  ];
  return (
    <details className="dinf-details dinf-speed-cond">
      <summary>조건{active.length > 0 ? ` · ${active.join(", ")}` : " (기본)"}</summary>
      <div className="dinf-speed-checks">
        {checks.map(([key, label]) => (
          <label key={key} className="toggle-pill tap-target">
            <input type="checkbox" checked={cond[key] as boolean} onChange={(e) => onChange({ [key]: e.target.checked })} />
            {label}
          </label>
        ))}
      </div>
      <div className="dinf-conditions">
        <label>
          상대 스피드 랭크
          <select value={cond.oppStage} onChange={(e) => onChange({ oppStage: Number(e.target.value) })}>
            {STAGE_OPTIONS.map((st) => (
              <option key={st} value={st}>
                {st > 0 ? `+${st}` : st}
              </option>
            ))}
          </select>
        </label>
        <label>
          상대 속도 보정 도구
          <select value={itemDisabled ? "" : (cond.oppItemId ?? "")} onChange={(e) => onChange({ oppItemId: e.target.value || null })} disabled={itemDisabled}>
            <option value="">{itemDisabled ? "메가스톤 (보정 도구 사용 불가)" : "모름 (보정 도구 없음으로 가정)"}</option>
            {SPEED_ITEM_CANDIDATES.map((item) => (
              <option key={item.id} value={item.id}>
                {getItem(item.id)?.name ?? item.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          상대 속도 보정 특성
          <select
            value={megaRow ? "" : (cond.oppAbilityId ?? "")}
            onChange={(e) => onChange({ oppAbilityId: e.target.value || null, oppUnburden: false, oppOtherStatus: false })}
            disabled={megaRow}
          >
            <option value="">{megaRow ? "메가폼 특성 사용" : "모름 (보정 특성 없음으로 가정)"}</option>
            {abilityOptions.map((id) => (
              <option key={id} value={id}>
                {getAbility(id)?.name ?? id}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(myQuickFeet || (cond.oppAbilityId === "속보" && !megaRow)) && (
        <div className="dinf-speed-checks">
          {myQuickFeet && (
            <label className="toggle-pill tap-target">
              <input type="checkbox" checked={cond.myOtherStatus} onChange={(e) => onChange({ myOtherStatus: e.target.checked })} />
              내 상태이상 (속보 ×1.5)
            </label>
          )}
          {cond.oppAbilityId === "속보" && !megaRow && (
            <label className="toggle-pill tap-target">
              <input type="checkbox" checked={cond.oppOtherStatus} onChange={(e) => onChange({ oppOtherStatus: e.target.checked })} />
              상대 상태이상 (속보 ×1.5)
            </label>
          )}
        </div>
      )}
      {cond.oppAbilityId === "곡예" && !megaRow && (
        <label className="toggle-pill tap-target">
          <input type="checkbox" checked={cond.oppUnburden} onChange={(e) => onChange({ oppUnburden: e.target.checked })} />
          <span>곡예 발동 후 (도구를 잃어 상대 스피드 ×2)</span>
        </label>
      )}
    </details>
  );
}

export function ResultView({
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
            className={`dinf-nature-chip tap-target${g.feasible === 0 ? " is-no" : ""}`}
            title={g.natureNames.join(", ")}
          >
            {g.label} <em>{g.feasible === 0 ? "불가" : `${Math.round(g.weight * 100)}%`}</em>
          </span>
        ))}
      </div>

      <ExtremeSummary result={result} />

      <CandidateCards lists={result.candidates} />

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
