import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MatchupSlot } from "../types/matchup";
import type { MegaEvolution, Pokemon } from "../types/pokemon";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import { MovePickerModal } from "./MovePickerModal";
import { PokemonAvatar } from "./PokemonAvatar";
import { TypeBadge } from "./TypeBadge";
import { getAbility, getItem, getMove, getPokemon } from "../lib/data";
import type { Ability } from "../types/ability";
import { getEffectiveForm } from "../lib/pokemonForm";
import { NEUTRAL_STAGES } from "../types/battleStats";
import { inferCombined, type CombinedInference } from "../lib/combinedInference";
import {
  DEFENSE_ABILITY_CANDIDATES,
  DEFENSE_ITEM_CANDIDATES,
  GRID,
  countExtremeCells,
  isExtremePoints,
  inferenceUnsupportedReason,
  type InferenceInput,
  type InferenceObservation,
  type BulkEstimate,
  type CentralRange,
  type FormView,
  type InferenceResult,
  type Range,
} from "../lib/defenseInference";
import {
  ATTACK_ABILITY_CANDIDATES,
  ATTACK_ITEM_CANDIDATES,
  attackInferenceUnsupportedReason,
  type AttackInferenceInput,
  type AttackInferenceResult,
  type AttackObservation,
} from "../lib/attackInference";
import {
  NEUTRAL_SPEED_CONDITIONS,
  SPEED_ABILITY_CANDIDATES,
  SPEED_ITEM_CANDIDATES,
  type SpeedConditions,
  type SpeedInferenceInput,
  type SpeedInferenceResult,
  type SpeedObservation,
} from "../lib/speedInference";
import { computeRealStats, MAX_ABILITY_POINTS_PER_STAT } from "../lib/statCalculator";
import { loadMatchupDraft, saveMatchupDraft } from "../lib/storage";
import "./DefenseInferencePanel.css";

type Screen = "reflect" | "lightScreen" | "auroraVeil";

/** dealt = 내가 입힌 데미지(상대 HP %) → 상대 HP·방어 역산, received = 내가 받은 데미지(내 HP 수치) → 상대 공격 역산, speed = 선후공 → 상대 스피드 역산 */
type RowKind = "dealt" | "received" | "speed";

interface ObservationRow {
  id: number;
  kind: RowKind;
  moveId: string | null;
  critical: boolean;
  before: string;
  after: string;
  /** 이 관측을 맞을 때 상대가 메가진화한 폼("" = 메가 전) */
  megaForm: string;
  /** 선후공 줄: 이번 턴 먼저 움직인 쪽 */
  first: "me" | "opponent";
  /** 선후공 줄: 이 관측의 조건(행마다 따로) */
  cond: SpeedConditions;
}

const SCREENS: readonly unknown[] = ["reflect", "lightScreen", "auroraVeil"] satisfies Screen[];
const ROW_KINDS: readonly unknown[] = ["dealt", "received", "speed"] satisfies RowKind[];

function firstRow(): ObservationRow {
  return { id: 1, kind: "dealt", moveId: null, critical: false, before: "100", after: "", megaForm: "", first: "me", cond: NEUTRAL_SPEED_CONDITIONS };
}

/**
 * 저장된 입력을 불러온다(3.2 V2) — 새로고침·탭 이동에도 관측이 남게. localStorage는 믿을 수 없는 입력이라
 * 모양이 깨졌거나 데이터에서 사라진 id는 기본값으로 바꾼다. 줄 id는 1부터 다시 매긴다.
 */
export function restoreInference(raw: unknown) {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const stage = (v: unknown) => (Number.isInteger(v) && Math.abs(v as number) <= 6 ? (v as number) : 0);
  const screenOf = (v: unknown): Screen | "" => (SCREENS.includes(v) ? (v as Screen) : "");
  const idOf = (v: unknown, exists: (id: string) => unknown) => (typeof v === "string" && exists(v) ? v : "");
  const rows = (Array.isArray(d.rows) ? d.rows : []).flatMap((item, index): ObservationRow[] => {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (!ROW_KINDS.includes(r.kind)) return [];
    const c = (r.cond && typeof r.cond === "object" ? r.cond : {}) as Record<string, unknown>;
    const cond: Record<string, unknown> = { ...NEUTRAL_SPEED_CONDITIONS };
    for (const k of Object.keys(cond)) if (typeof c[k] === "boolean" && typeof cond[k] === "boolean") cond[k] = c[k];
    cond.oppStage = stage(c.oppStage);
    cond.oppItemId = idOf(c.oppItemId, getItem) || null;
    cond.oppAbilityId = idOf(c.oppAbilityId, getAbility) || null;
    return [
      {
        id: index + 1,
        kind: r.kind as RowKind,
        moveId: idOf(r.moveId, getMove) || null,
        critical: r.critical === true,
        before: str(r.before),
        after: str(r.after),
        megaForm: str(r.megaForm),
        first: r.first === "opponent" ? "opponent" : "me",
        cond: cond as unknown as SpeedConditions,
      },
    ];
  });
  return {
    rows: rows.length > 0 ? rows : [firstRow()],
    abilityId: idOf(d.abilityId, getAbility),
    itemId: idOf(d.itemId, getItem),
    screen: screenOf(d.screen),
    defStage: stage(d.defStage),
    spdStage: stage(d.spdStage),
    tolerant: d.tolerant === true,
    atkAbilityId: idOf(d.atkAbilityId, getAbility),
    atkItemId: idOf(d.atkItemId, getItem),
    atkStage: stage(d.atkStage),
    spaStage: stage(d.spaStage),
    oppBurned: d.oppBurned === true,
    myScreen: screenOf(d.myScreen),
  };
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
  /** 관측·가정 입력을 모두 지운다(저장본 포함) — 부모가 이 패널을 새로 띄운다 */
  onReset: () => void;
}

const STAGE_OPTIONS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];

/** 선후공 줄의 조건 중 기본값과 다른 것을 짧게 이름 붙인다(접힌 "조건" 요약줄용) */
function describeConditions(c: SpeedConditions): string[] {
  const out: string[] = [];
  if (c.trickRoom) out.push("트릭룸");
  if (c.myTailwind) out.push("내 순풍");
  if (c.oppTailwind) out.push("상대 순풍");
  if (c.myParalyzed) out.push("내 마비");
  if (c.oppParalyzed) out.push("상대 마비");
  if (c.myOtherStatus) out.push("내 상태이상");
  if (c.oppOtherStatus) out.push("상대 상태이상");
  if (c.oppStage !== 0) out.push(`상대 스피드 ${c.oppStage > 0 ? "+" : ""}${c.oppStage}랭크`);
  if (c.oppItemId) out.push(getItem(c.oppItemId)?.name ?? c.oppItemId);
  if (c.oppAbilityId) out.push(getAbility(c.oppAbilityId)?.name ?? c.oppAbilityId);
  if (c.oppUnburden) out.push("곡예 발동 후");
  return out;
}

const PART_LABELS = { defense: "내가 입힌 데미지(방어)", attack: "내가 받은 데미지(공격)", speed: "선후공(스피드)" } as const;

/** 줄에 고른 메가폼이 이 종에 실제로 있는 폼이면 그 이름, 아니면 메가 전("") */
function megaOf(row: ObservationRow, megas: MegaEvolution[] | undefined): string {
  return megas?.find((m) => m.form === row.megaForm)?.form ?? "";
}

function parseHp(text: string): number | null {
  return /^\d{1,4}$/.test(text.trim()) ? Number(text) : null;
}

function parsePercent(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const v = Number(text);
  return v >= 0 && v <= 100 ? v : null;
}

/** 이 종(폼 변종 포함)이 가질 수 있는 특성 중 후보 목록(방어·공격 영향 특성)에 드는 것 */
function relevantAbilities(pokemon: Pokemon, candidates: Ability[]): string[] {
  const names = new Set<string>();
  const add = (list: string[], hidden?: string) => {
    list.forEach((a) => names.add(a));
    if (hidden) names.add(hidden);
  };
  add(pokemon.abilities, pokemon.hiddenAbility);
  pokemon.formVariants?.forEach((f) => add(f.abilities, f.hiddenAbility));
  const relevant = new Set(candidates.map((a) => a.id));
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

/** 방어·공격·스피드 결합 결과(3.1 C2-b·C2-c) — 관측이 있는 쪽들이 합친 성격 후보와 반영한 포인트 상한, 서로 안 맞을 때의 안내 */
function CombinedView({ combined }: { combined: CombinedInference }) {
  const names = combined.parts.map((p) => PART_LABELS[p]).join(" · ");
  if (combined.conflict === "nature") {
    return <p className="dinf-warn">{names} 쪽에서 가능한 성격이 하나도 겹치지 않아요. 급소·가정·메가·조건 선택을 확인해 보세요.</p>;
  }
  if (combined.conflict === "points") {
    return <p className="dinf-warn">{names} 쪽 관측이 요구하는 포인트를 더하면 합계 66을 넘어요. 급소·가정·메가·조건 선택을 확인해 보세요.</p>;
  }
  if (!combined.natures || !combined.budget) return null;
  const { defenseMax, attackMax, speedMax } = combined.budget;
  const limits = [
    defenseMax !== null && `HP+방어+특방은 ${defenseMax} 이하`,
    attackMax !== null && `공격+특공은 ${attackMax} 이하`,
    speedMax !== null && `스피드는 ${speedMax} 이하`,
  ].filter(Boolean);
  return (
    <div className="dinf-result">
      <h4 className="dinf-subhead">두 쪽을 합친 결과</h4>
      <div className="dinf-natures">
        <span className="dinf-subtitle">성격</span>
        {combined.natures.map((n) => (
          <span key={n.name} className="dinf-nature-chip">
            {n.name} <em>{n.weight >= 0.01 ? `${Math.round(n.weight * 100)}%` : "<1%"}</em>
          </span>
        ))}
      </div>
      <p className="dinf-note">
        성격은 한 값이라 {names} 쪽에서 모두 가능한 성격만 남겼어요. 포인트 합계는 66을 넘을 수 없어서 {limits.join(", ")}로 따졌어요.
        {combined.speed && " 스피드 하한은 남은 성격 후보를 모두 고려한 최솟값이라, 성격 후보가 줄수록 올라가 다른 쪽 상한을 더 낮춰요."}
      </p>
    </div>
  );
}

/** 상대 공격(특공) 역산 결과(3.1 C2-b) — 내가 받은 데미지 관측으로 좁힌 값 */
function AttackResultView({ result, rowNos, combinedOn }: { result: AttackInferenceResult; rowNos: number[]; combinedOn: boolean }) {
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
          <span key={g.id} className={`dinf-nature-chip${g.feasible === 0 ? " is-no" : ""}`} title={g.natureNames.join(", ")}>
            {g.label} <em>{g.feasible === 0 ? "불가" : `${Math.round(g.weight * 100)}%`}</em>
          </span>
        ))}
      </div>
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
function SpeedResultView({ result, rowNos, combinedOn }: { result: SpeedInferenceResult; rowNos: number[]; combinedOn: boolean }) {
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
          <span key={g.id} className={`dinf-nature-chip${g.feasible === 0 ? " is-no" : ""}`} title={g.natureNames.join(", ")}>
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
function FormCompare({ views }: { views: FormView[][] }) {
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
function SpeedConditionsEditor({
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
          <label key={key} className="dinf-crit">
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
            <label className="dinf-crit">
              <input type="checkbox" checked={cond.myOtherStatus} onChange={(e) => onChange({ myOtherStatus: e.target.checked })} />
              내 상태이상 (속보 ×1.5)
            </label>
          )}
          {cond.oppAbilityId === "속보" && !megaRow && (
            <label className="dinf-crit">
              <input type="checkbox" checked={cond.oppOtherStatus} onChange={(e) => onChange({ oppOtherStatus: e.target.checked })} />
              상대 상태이상 (속보 ×1.5)
            </label>
          )}
        </div>
      )}
      {cond.oppAbilityId === "곡예" && !megaRow && (
        <label className="dinf-check">
          <input type="checkbox" checked={cond.oppUnburden} onChange={(e) => onChange({ oppUnburden: e.target.checked })} />
          <span>곡예 발동 후 (도구를 잃어 상대 스피드 ×2)</span>
        </label>
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

      <ExtremeSummary result={result} />

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
  onReset,
}: DefenseInferencePanelProps) {
  const [saved] = useState(() => restoreInference(loadMatchupDraft().inference));
  const [rows, setRows] = useState<ObservationRow[]>(saved.rows);
  const [nextId, setNextId] = useState(saved.rows.length + 1);
  const [movePickerRow, setMovePickerRow] = useState<number | null>(null);
  const [abilityId, setAbilityId] = useState<string>(saved.abilityId);
  const [itemId, setItemId] = useState<string>(saved.itemId);
  const [screen, setScreen] = useState<Screen | "">(saved.screen);
  const [defStage, setDefStage] = useState(saved.defStage);
  const [spdStage, setSpdStage] = useState(saved.spdStage);
  const [tolerant, setTolerant] = useState(saved.tolerant);
  // 내가 받은 데미지 관측용 가정(3.1 C2-b) — 상대 공격 보정 특성·도구, 상대 공격·특공 랭크, 상대 화상, 내 쪽 벽
  const [atkAbilityId, setAtkAbilityId] = useState<string>(saved.atkAbilityId);
  const [atkItemId, setAtkItemId] = useState<string>(saved.atkItemId);
  const [atkStage, setAtkStage] = useState(saved.atkStage);
  const [spaStage, setSpaStage] = useState(saved.spaStage);
  const [oppBurned, setOppBurned] = useState(saved.oppBurned);
  const [myScreen, setMyScreen] = useState<Screen | "">(saved.myScreen);

  useEffect(() => {
    saveMatchupDraft({
      inference: { rows, abilityId, itemId, screen, defStage, spdStage, tolerant, atkAbilityId, atkItemId, atkStage, spaStage, oppBurned, myScreen } satisfies ReturnType<typeof restoreInference>,
    });
  }, [rows, abilityId, itemId, screen, defStage, spdStage, tolerant, atkAbilityId, atkItemId, atkStage, spaStage, oppBurned, myScreen]);

  const attackerPokemon = attacker.pokemonId ? getPokemon(attacker.pokemonId) : undefined;
  const defenderPokemon = defender.pokemonId ? getPokemon(defender.pokemonId) : undefined;
  // 메가폼은 관측 줄마다 이 화면 안에서만 고른다(공유 슬롯·메가스톤 도구와 무관). 종이 바뀌어 없는 폼이면 메가 전으로 본다.
  const megas = defenderPokemon?.megaEvolutions;
  const defenderForm = defenderPokemon ? getEffectiveForm(defenderPokemon, { ...defender, item: null, activeMegaForm: undefined }) : undefined;

  const abilityOptions = defenderPokemon ? relevantAbilities(defenderPokemon, DEFENSE_ABILITY_CANDIDATES) : [];
  // 종이 바뀌면 그 종이 가질 수 없는 특성 가정은 자동으로 해제
  const activeAbilityId = abilityOptions.includes(abilityId) ? abilityId : "";
  const atkAbilityOptions = defenderPokemon ? relevantAbilities(defenderPokemon, ATTACK_ABILITY_CANDIDATES) : [];
  const activeAtkAbilityId = atkAbilityOptions.includes(atkAbilityId) ? atkAbilityId : "";
  // 내 포켓몬(받는 쪽)의 실제 최대 HP — 내가 받은 데미지 줄의 "맞기 전 HP" 기본값·검사 안내에 쓴다
  const myMaxHp = attackerPokemon ? computeRealStats(getEffectiveForm(attackerPokemon, attacker).baseStats, attacker.points, attacker.nature).hp : null;

  function updateRow(id: number, patch: Partial<ObservationRow>) {
    setRows((prev) => {
      const index = prev.findIndex((r) => r.id === id);
      if (index < 0) return prev;
      const oldAfter = prev[index].after;
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      // 메가진화는 되돌릴 수 없다(3.1 L1-a): 이 줄을 메가 후로 고르면 뒤의 모든 줄도 같은 메가 후 폼으로 맞춘다
      if (patch.megaForm) for (let j = index + 1; j < next.length; j++) next[j] = { ...next[j], megaForm: patch.megaForm };
      // 다음 줄(같은 종류)의 "맞기 전 값"이 이 줄의 옛 "맞은 뒤 값"과 같았으면(직접 안 고친 값) 같이 따라간다
      if (patch.after !== undefined && index + 1 < next.length && next[index + 1].kind === next[index].kind && next[index + 1].before === oldAfter) {
        next[index + 1] = { ...next[index + 1], before: patch.after };
      }
      return next;
    });
  }

  /** 가장 가까운 선후공 줄의 조건 — 새 선후공 줄이 이어받는다(턴마다 크게 안 바뀌는 조건이 많아서) */
  const lastSpeedCond = () => [...rows].reverse().find((r) => r.kind === "speed")?.cond ?? NEUTRAL_SPEED_CONDITIONS;

  function addRow() {
    const last = rows[rows.length - 1];
    // 메가진화는 되돌릴 수 없어서 새 줄은 직전 줄의 폼을 이어받는다
    setRows([
      ...rows,
      {
        id: nextId,
        kind: last?.kind ?? "dealt",
        moveId: null,
        critical: false,
        before: last?.kind === "speed" ? "" : (last?.after ?? "100"),
        after: "",
        megaForm: last ? megaOf(last, megas) : "",
        first: "me",
        cond: lastSpeedCond(),
      },
    ]);
    setNextId(nextId + 1);
  }

  /** 줄 종류를 바꾸면 고른 기술(다른 포켓몬의 기술)·값 입력을 비운다 — 받은 데미지는 맞기 전 HP를 내 최대 HP로 채워 둔다 */
  function changeKind(id: number, kind: RowKind) {
    updateRow(id, {
      kind,
      moveId: null,
      before: kind === "received" ? String(myMaxHp ?? "") : kind === "speed" ? "" : "100",
      after: "",
      cond: lastSpeedCond(),
    });
  }

  function updateCond(id: number, patch: Partial<SpeedConditions>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, cond: { ...r.cond, ...patch } } : r)));
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  // 완성된 줄(기술 + 두 %)만 계산에 넣는다
  const complete = useMemo(() => {
    const out: { row: ObservationRow; obs: InferenceObservation }[] = [];
    const defenderMegas = defender.pokemonId ? getPokemon(defender.pokemonId)?.megaEvolutions : undefined;
    for (const row of rows) {
      if (row.kind !== "dealt") continue;
      const move = row.moveId ? getMove(row.moveId) : undefined;
      const before = parsePercent(row.before);
      const after = parsePercent(row.after);
      if (move && before !== null && after !== null) out.push({ row, obs: { move, critical: row.critical, before, after, megaForm: megaOf(row, defenderMegas) || undefined } });
    }
    return out;
  }, [rows, defender.pokemonId]);

  // 완성된 "내가 받은 데미지" 줄(상대 기술 + 내 HP 두 수치)
  const completeReceived = useMemo(() => {
    const out: { row: ObservationRow; obs: AttackObservation }[] = [];
    const opponentMegas = defender.pokemonId ? getPokemon(defender.pokemonId)?.megaEvolutions : undefined;
    for (const row of rows) {
      if (row.kind !== "received") continue;
      const move = row.moveId ? getMove(row.moveId) : undefined;
      const hpBefore = parseHp(row.before);
      const hpAfter = parseHp(row.after);
      if (move && hpBefore !== null && hpAfter !== null) {
        out.push({ row, obs: { move, critical: row.critical, hpBefore, hpAfter, megaForm: megaOf(row, opponentMegas) || undefined } });
      }
    }
    return out;
  }, [rows, defender.pokemonId]);

  // 어느 종류 줄에서든 쓰인 메가폼 — 세 역산 모두에 넘겨 메가 전·후 비교(3.1 L1-b)를 같은 폼 목록으로 만든다. 문자열 키로 만들어 값이 같으면 배열도 그대로 둔다
  const megaKey = [...new Set(rows.map((r) => megaOf(r, megas)).filter(Boolean))].join("|");
  const viewMegaForms = useMemo(() => (megaKey ? megaKey.split("|") : []), [megaKey]);

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
      viewMegaForms,
    };
  }, [attacker, defender, complete, activeAbilityId, itemId, weather, field, screen, defStage, spdStage, tolerant, viewMegaForms]);

  const anyMega = complete.some((c) => c.obs.megaForm);
  const rowIdsByObservation = complete.map((c) => rows.indexOf(c.row) + 1);

  // 상대 공격(특공) 역산(3.1 C2-b) — 내 포켓몬이 맞는 쪽, 상대가 때리는 쪽
  const anyMegaReceived = completeReceived.some((c) => c.obs.megaForm);
  const attackInput = useMemo<AttackInferenceInput | null>(() => {
    if (!attacker.pokemonId || !defender.pokemonId || completeReceived.length === 0) return null;
    return {
      attacker: {
        ...defender,
        pokemonId: defender.pokemonId,
        activeMegaForm: undefined,
        ability: activeAtkAbilityId || null,
        item: anyMegaReceived ? null : atkItemId || null,
      },
      defender: { ...attacker, pokemonId: attacker.pokemonId },
      observations: completeReceived.map((c) => c.obs),
      attackerStages: { ...NEUTRAL_STAGES, atk: atkStage, spa: spaStage },
      attackerStatus: oppBurned ? "burn" : null,
      defenderStages: attacker.stages,
      weather: weather ?? undefined,
      field: field ?? undefined,
      screen: myScreen || undefined,
      viewMegaForms,
    };
  }, [attacker, defender, completeReceived, anyMegaReceived, activeAtkAbilityId, atkItemId, atkStage, spaStage, oppBurned, weather, field, myScreen, viewMegaForms]);
  // 상대 스피드 역산(3.1 C2-c) — 선후공 줄은 항상 완성(누가 먼저만 고르면 됨). 조건은 줄마다 다르다.
  const speedRows = useMemo(() => rows.filter((r) => r.kind === "speed"), [rows]);
  const speedAbilityOptions = defenderPokemon ? relevantAbilities(defenderPokemon, SPEED_ABILITY_CANDIDATES) : [];
  const myQuickFeet = getAbility(attacker.ability ?? "")?.speedMultiplierWhenStatused !== undefined;
  const anyMegaSpeed = speedRows.some((r) => megaOf(r, megas));
  const speedInput = useMemo<SpeedInferenceInput | null>(() => {
    const opponent = defender.pokemonId ? getPokemon(defender.pokemonId) : undefined;
    if (!attacker.pokemonId || !defender.pokemonId || !opponent || speedRows.length === 0) return null;
    const abilityOptions = relevantAbilities(opponent, SPEED_ABILITY_CANDIDATES);
    const observations: SpeedObservation[] = speedRows.map((r) => {
      // 종이 바뀌어 그 종이 가질 수 없는 특성 가정은 해제하고, 곡예가 아니면 발동 후 체크는 무시
      const oppAbilityId = r.cond.oppAbilityId && abilityOptions.includes(r.cond.oppAbilityId) ? r.cond.oppAbilityId : null;
      return {
        first: r.first,
        megaForm: megaOf(r, opponent.megaEvolutions) || undefined,
        conditions: {
          ...r.cond,
          oppAbilityId,
          oppUnburden: oppAbilityId === "곡예" && r.cond.oppUnburden,
          oppOtherStatus: oppAbilityId === "속보" && r.cond.oppOtherStatus,
          myOtherStatus: myQuickFeet && r.cond.myOtherStatus,
        },
      };
    });
    return {
      // 상대: 종·폼만 쓰고 특성·도구는 줄별 조건에서 정한다. 나: 능력·특성·도구를 전부 아는 쪽
      attacker: { ...defender, pokemonId: defender.pokemonId, activeMegaForm: undefined, ability: null, item: null },
      defender: { ...attacker, pokemonId: attacker.pokemonId },
      defenderStages: attacker.stages,
      weather: weather ?? undefined,
      field: field ?? undefined,
      observations,
      viewMegaForms,
    };
  }, [attacker, defender, speedRows, weather, field, viewMegaForms, myQuickFeet]);

  // 계산이 무거울 수 있어(물리+특수 관측이 함께면 수십만 후보) 입력은 즉시 반영하고 결과만 뒤따라 그린다.
  // 방어·공격·스피드는 같이 계산해 성격을 공유하고 포인트 합계(66)를 따진다(3.1 C2-b·C2-c 결합).
  const deferredInput = useDeferredValue(input);
  const deferredAttackInput = useDeferredValue(attackInput);
  const deferredSpeedInput = useDeferredValue(speedInput);
  const combined = useMemo(
    () => inferCombined(deferredInput, deferredAttackInput, deferredSpeedInput),
    [deferredInput, deferredAttackInput, deferredSpeedInput],
  );
  const result = combined.defense;
  const attackResult = combined.attack;
  const speedResult = combined.speed;
  const pending = input !== deferredInput;
  const attackPending = attackInput !== deferredAttackInput;
  const speedPending = speedInput !== deferredSpeedInput;
  const receivedRowNos = completeReceived.map((c) => rows.indexOf(c.row) + 1);
  const speedRowNos = speedRows.map((r) => rows.indexOf(r) + 1);
  const hasReceivedRows = rows.some((r) => r.kind === "received");
  const hasDealtRows = rows.some((r) => r.kind === "dealt");

  function rowMessage(row: ObservationRow): { text: string; kind: "error" | "ok" } | null {
    const move = row.moveId ? getMove(row.moveId) : undefined;
    if (row.kind === "received") return receivedRowMessage(row, move);
    if (row.kind === "speed") return speedRowMessage(row);
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

  function speedRowMessage(row: ObservationRow): { text: string; kind: "error" | "ok" } | null {
    const index = speedRows.findIndex((r) => r.id === row.id);
    if (index < 0 || !speedResult || speedPending) return null;
    const message = speedResult.observationErrors[index];
    if (message) return { text: message, kind: "error" };
    if (speedResult.status !== "invalid" && speedResult.singleFeasible[index] === false) return { text: "이 관측만으로도 맞는 스피드가 없어요", kind: "error" };
    if (speedResult.status === "ok" && speedResult.singleFeasible[index]) return { text: "가능", kind: "ok" };
    return null;
  }

  function receivedRowMessage(row: ObservationRow, move: ReturnType<typeof getMove>): { text: string; kind: "error" | "ok" } | null {
    if (move) {
      const reason = attackInferenceUnsupportedReason(move);
      if (reason) return { text: reason, kind: "error" };
    }
    const before = parseHp(row.before);
    const after = parseHp(row.after);
    if ((row.before.trim() !== "" && before === null) || (row.after.trim() !== "" && after === null)) return { text: "HP는 정수", kind: "error" };
    if (before !== null && myMaxHp !== null && before > myMaxHp) return { text: `최대 HP(${myMaxHp})보다 클 수 없어요`, kind: "error" };
    if (before !== null && after !== null && after >= before) return { text: "맞은 뒤 HP가 더 작아야 해요", kind: "error" };
    if (after === 0) return { text: "쓰러진 공격은 정확한 데미지를 몰라요", kind: "error" };
    const index = completeReceived.findIndex((c) => c.row.id === row.id);
    if (index >= 0 && attackResult && !attackPending) {
      const message = attackResult.observationErrors[index];
      if (message) return { text: message, kind: "error" };
      if (attackResult.status !== "invalid" && attackResult.singleFeasible[index] === false) return { text: "이 관측만으로도 맞는 배분이 없어요", kind: "error" };
      if (attackResult.status === "ok" && attackResult.singleFeasible[index]) return { text: "가능", kind: "ok" };
    }
    return null;
  }

  return (
    <div className="dinf">
      <p className="dinf-intro">
        내 포켓몬이 상대를 때린 뒤 상대 HP가 몇 %가 됐는지 입력하면, 상대의 <strong>HP·방어(특방) 능력 포인트와 성격</strong>이 될 수 있는 범위를 좁혀 줘요.
        반대로 상대가 나를 때려서 내 HP가 얼마가 됐는지 입력하면 상대의 <strong>공격(특공) 포인트와 성격 보정</strong>도 좁힐 수 있어요(내 HP는 정확한 수치라 더 정밀해요).
        이번 턴 누가 먼저 움직였는지(<strong>선후공</strong>)를 넣으면 상대의 <strong>스피드 포인트와 성격 보정</strong>을 좁혀요.
        데미지에는 난수가 있어서, 정답 하나가 아니라 <strong>가능한 범위</strong>로 보여 줍니다.
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
              <span>
                스피드 <strong>{defenderForm.baseStats.spe}</strong>
              </span>
            </div>
            <p className="dinf-unknown">
              역산 대상: <strong>HP · 방어 · 특방 · 공격 · 특공 · 스피드 포인트, 성격</strong>
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
        {hasDealtRows && (
          <>
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
          </>
        )}
        {hasReceivedRows && (
          <>
            <h4 className="dinf-subhead">내가 받은 데미지 관측용 가정</h4>
            <div className="dinf-conditions">
              <label>
                상대 공격 보정 특성
                <select value={activeAtkAbilityId} onChange={(e) => setAtkAbilityId(e.target.value)} disabled={!defenderPokemon}>
                  <option value="">{anyMegaReceived ? "모름 (메가 전 관측에 적용)" : "모름 (보정 특성 없음으로 가정)"}</option>
                  {atkAbilityOptions.map((id) => (
                    <option key={id} value={id}>
                      {getAbility(id)?.name ?? id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                상대 공격 보정 도구
                <select value={anyMegaReceived ? "" : atkItemId} onChange={(e) => setAtkItemId(e.target.value)} disabled={anyMegaReceived}>
                  <option value="">{anyMegaReceived ? "메가스톤 (보정 도구 사용 불가)" : "모름 (보정 도구 없음으로 가정)"}</option>
                  {ATTACK_ITEM_CANDIDATES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {getItem(item.id)?.name ?? item.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                내 쪽 벽
                <select value={myScreen} onChange={(e) => setMyScreen(e.target.value as Screen | "")}>
                  <option value="">없음</option>
                  <option value="reflect">리플렉터</option>
                  <option value="lightScreen">빛의장막</option>
                  <option value="auroraVeil">오로라베일</option>
                </select>
              </label>
              <label>
                상대 공격 랭크
                <select value={atkStage} onChange={(e) => setAtkStage(Number(e.target.value))}>
              {STAGE_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st > 0 ? `+${st}` : st}
                </option>
              ))}
                </select>
              </label>
              <label>
                상대 특공 랭크
                <select value={spaStage} onChange={(e) => setSpaStage(Number(e.target.value))}>
              {STAGE_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st > 0 ? `+${st}` : st}
                </option>
              ))}
                </select>
              </label>
            </div>
            <label className="dinf-check">
              <input type="checkbox" checked={oppBurned} onChange={(e) => setOppBurned(e.target.checked)} />
              <span>상대가 화상 (물리 공격 반감 — 근성·객기는 예외)</span>
            </label>
          </>
        )}
        <p className="dinf-note">날씨·필드는 위쪽 선택기 값을, 내 랭크·특성·도구는 내 포켓몬 카드 값을 그대로 써요.</p>
      </section>

      <section className="dinf-section">
        <h3>관측</h3>
        <ol className="dinf-rows">
          {rows.map((row, index) => {
            const move = row.moveId ? getMove(row.moveId) : undefined;
            const message = rowMessage(row);
            const received = row.kind === "received";
            const speed = row.kind === "speed";
            // 앞 줄 중 메가 후인 줄이 있으면 그 폼(메가진화는 되돌릴 수 없다 — 3.1 L1-a)
            const lockedMega = rows.slice(0, index).map((r) => megaOf(r, megas)).find(Boolean) ?? "";
            const pickerOwner = received ? defenderPokemon : attackerPokemon;
            return (
              <li key={row.id} className="dinf-row">
                <span className="dinf-row-no">#{index + 1}</span>
                <select aria-label={`관측 ${index + 1} 종류`} value={row.kind} onChange={(e) => changeKind(row.id, e.target.value as RowKind)}>
                  <option value="dealt">내가 입힌 데미지</option>
                  <option value="received">내가 받은 데미지</option>
                  <option value="speed">선후공</option>
                </select>
                {speed ? (
                  <select aria-label={`관측 ${index + 1} 먼저 움직인 쪽`} value={row.first} onChange={(e) => updateRow(row.id, { first: e.target.value as "me" | "opponent" })}>
                    <option value="me">내가 먼저</option>
                    <option value="opponent">상대가 먼저</option>
                  </select>
                ) : (
                  <button
                    type="button"
                    className="dinf-move-btn"
                    onClick={() => setMovePickerRow(row.id)}
                    disabled={!pickerOwner}
                    title={pickerOwner ? undefined : received ? "먼저 상대 포켓몬을 골라 주세요" : "먼저 내 포켓몬을 골라 주세요"}
                  >
                    {move ? move.name : received ? "상대 기술 선택" : "기술 선택"}
                  </button>
                )}
                {megas && megas.length > 0 && (
                  <select
                    aria-label={`관측 ${index + 1} 상대 폼`}
                    value={megaOf(row, megas)}
                    onChange={(e) => updateRow(row.id, { megaForm: e.target.value })}
                    disabled={!!lockedMega}
                    title={lockedMega ? "앞 줄에서 이미 메가진화했어요 (되돌릴 수 없어요)" : undefined}
                  >
                    {/* 앞 줄에서 메가진화했으면 이 줄은 그 폼으로 고정 — 메가 전·다른 폼을 고를 수 없다 */}
                    {!lockedMega && <option value="">메가 전</option>}
                    {megas
                      .filter((m) => !lockedMega || m.form === lockedMega)
                      .map((m) => (
                        <option key={m.form} value={m.form}>
                          {m.form.replace(/^.*?-/, "")}
                        </option>
                      ))}
                  </select>
                )}
                {!speed && (
                  <>
                    <label className="dinf-crit">
                      <input type="checkbox" checked={row.critical} onChange={(e) => updateRow(row.id, { critical: e.target.checked })} />
                      급소
                    </label>
                    <span className="dinf-percent-pair">
                      <input
                        className="dinf-percent"
                        inputMode="numeric"
                        aria-label={`관측 ${index + 1} 맞기 전 ${received ? "HP" : "%"}`}
                        value={row.before}
                        onChange={(e) => updateRow(row.id, { before: e.target.value })}
                      />
                      <span>{received ? "HP →" : "% →"}</span>
                      <input
                        className="dinf-percent"
                        inputMode="numeric"
                        aria-label={`관측 ${index + 1} 맞은 뒤 ${received ? "HP" : "%"}`}
                        placeholder="?"
                        value={row.after}
                        onChange={(e) => updateRow(row.id, { after: e.target.value })}
                      />
                      <span>{received ? "HP" : "%"}</span>
                    </span>
                  </>
                )}
                {message && <span className={`dinf-row-msg is-${message.kind}`}>{message.text}</span>}
                {rows.length > 1 && (
                  <button type="button" className="dinf-row-remove" onClick={() => removeRow(row.id)} aria-label={`관측 ${index + 1} 삭제`}>
                    ✕
                  </button>
                )}
                {speed && (
                  <SpeedConditionsEditor
                    cond={row.cond}
                    onChange={(patch) => updateCond(row.id, patch)}
                    abilityOptions={speedAbilityOptions}
                    megaRow={!!megaOf(row, megas)}
                    itemDisabled={anyMegaSpeed}
                    myQuickFeet={myQuickFeet}
                  />
                )}
              </li>
            );
          })}
        </ol>
        <button type="button" className="dinf-add" onClick={addRow}>
          + 관측 추가
        </button>{" "}
        <button
          type="button"
          className="dinf-add"
          onClick={() => window.confirm("관측과 가정 입력을 모두 지울까요? (내 포켓몬·상대 포켓몬은 그대로예요)") && onReset()}
        >
          입력 지우기
        </button>
        <p className="dinf-note">
          내가 입힌 데미지는 관측 사이에 상대가 HP를 회복하지 않았다고 가정해요. 내가 받은 데미지는 맞은 직후 내 HP 수치를 넣어 주세요(먹다남은음식·독 같은 턴 종료 효과가
          섞이면 맞지 않아요){myMaxHp !== null && hasReceivedRows ? ` — 내 최대 HP는 ${myMaxHp}예요` : ""}. 다단히트·고정 데미지 기술은 아직 지원하지 않아요.
          선후공은 우선도가 같은 기술끼리 누가 먼저 움직였는지만 넣고, 그 턴의 조건(트릭룸·순풍·마비·상대 랭크 등)은 줄의 “조건”에서 골라 주세요. 새 줄은 직전 선후공 줄의 조건을 이어받아요.
        </p>
      </section>

      <section className="dinf-section dinf-result-section" aria-live="polite">
        <h3>
          결과 {(pending || attackPending || speedPending) && <span className="dinf-pending">계산 중…</span>}
        </h3>
        {!attackerPokemon || !defenderPokemon ? (
          <p className="dinf-hint">내 포켓몬과 상대 포켓몬을 먼저 골라 주세요.</p>
        ) : !result && !attackResult && !speedResult ? (
          <p className="dinf-hint">관측의 기술과 맞은 뒤 값을 입력하거나, 선후공 줄을 추가하면 결과가 나와요.</p>
        ) : (
          <>
            {result && (
              <div className={pending ? "dinf-stale" : undefined}>
                {(attackResult || speedResult) && <h4 className="dinf-subhead">방어 쪽 — 내가 입힌 데미지</h4>}
                <ResultView result={result} rowIdsByObservation={rowIdsByObservation} />
              </div>
            )}
            {attackResult && (
              <div className={attackPending ? "dinf-stale" : undefined}>
                <h4 className="dinf-subhead">공격 쪽 — 내가 받은 데미지</h4>
                <AttackResultView result={attackResult} rowNos={receivedRowNos} combinedOn={combined.natures !== null} />
              </div>
            )}
            {speedResult && (
              <div className={speedPending ? "dinf-stale" : undefined}>
                <h4 className="dinf-subhead">스피드 쪽 — 선후공</h4>
                <SpeedResultView result={speedResult} rowNos={speedRowNos} combinedOn={combined.natures !== null} />
              </div>
            )}
            <FormCompare views={[result, attackResult, speedResult].map((r) => r?.formViews ?? [])} />
            <CombinedView combined={combined} />
          </>
        )}
        {complete.length > 0 && <ObservationTips observations={complete.map((c) => c.obs)} />}
        {hasDealtRows && (
          <p className="dinf-assume">
            가정(내가 입힌 데미지): 화면 %는 내림(HP가 남으면 최소 1%) · 상대 특성{" "}
            {activeAbilityId ? getAbility(activeAbilityId)?.name : "없음(모름)"}{anyMega ? " (메가 후 관측은 메가폼 특성)" : ""} · 상대 도구{" "}
            {anyMega ? "메가스톤" : itemId ? getItem(itemId)?.name : "없음(모름)"} · 관측 사이 회복 없음{tolerant ? " · ±1% 여유" : ""}
          </p>
        )}
        {hasReceivedRows && (
          <p className="dinf-assume">
            가정(내가 받은 데미지): 상대 공격 보정 특성 {activeAtkAbilityId ? getAbility(activeAtkAbilityId)?.name : "없음(모름)"}
            {anyMegaReceived ? " (메가 후 관측은 메가폼 특성)" : ""} · 상대 공격 보정 도구 {anyMegaReceived ? "메가스톤" : atkItemId ? getItem(atkItemId)?.name : "없음(모름)"} · 상대 공격{" "}
            {atkStage > 0 ? `+${atkStage}` : atkStage}·특공 {spaStage > 0 ? `+${spaStage}` : spaStage}랭크{oppBurned ? " · 상대 화상" : ""}
            {myScreen ? ` · 내 쪽 ${{ reflect: "리플렉터", lightScreen: "빛의장막", auroraVeil: "오로라베일" }[myScreen]}` : ""}
          </p>
        )}
      </section>

      {movePickerRow !== null &&
        (() => {
          const pickerRow = rows.find((r) => r.id === movePickerRow);
          const received = pickerRow?.kind === "received";
          const owner = received ? defenderPokemon : attackerPokemon;
          if (!owner) return null;
          return (
            <MovePickerModal
              pokemon={owner}
              formVariant={received ? defender.formVariant : attacker.formVariant}
              currentMoveIds={[pickerRow?.moveId ?? null]}
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
          );
        })()}
    </div>
  );
}
