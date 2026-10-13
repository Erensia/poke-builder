import { useRef, useState, type MouseEvent } from "react";
import { Modal } from "./Modal";
import {
  computeRealStats,
  MAX_ABILITY_POINTS_PER_STAT,
  MAX_ABILITY_POINTS_TOTAL,
  totalAbilityPoints,
} from "../lib/statCalculator";
import { STAT_LABELS, STAT_ORDER } from "../lib/statLabels";
import { getNature } from "../lib/data";
import { hpMarks, hpMarkInfo, relevantHpRules, type MarkInfo } from "../lib/hpMagic";
import type { AbilityPoints } from "../types/party";
import type { BaseStats } from "../types/stats";
import type { StatKey, Nature } from "../types/nature";
import "./PointsEditorModal.css";

interface PointsEditorModalProps {
  pokemonName: string;
  baseStats: BaseStats;
  points: AbilityPoints;
  natureId: string | null;
  /** 슬롯의 도구·기술 — HP 눈금 중 이 포켓몬에게 유리한 조건(먹다남은음식·자뭉열매·대타출동·생명의구슬)을 강조한다 */
  itemId?: string | null;
  moveIds?: readonly (string | null)[];
  /** 숫자 입력창·슬라이더 직접 수정용 (절대값) */
  onChange: (stat: StatKey, value: number) => void;
  /** +/- 버튼용 (이전 상태 기준 증감, 연속 클릭에도 안전) */
  onStep: (stat: StatKey, delta: number) => void;
  onClose: () => void;
}

/** 이 스탯에 포인트 p를 배분했을 때의 실수치 (computeRealStats와 동일 공식, 한 스탯만) */
function realStatAt(stat: StatKey, base: number, p: number, nature: Nature | undefined): number {
  if (stat === "hp") return base + 75 + p;
  const mult = nature?.increased === stat ? 1.1 : nature?.decreased === stat ? 0.9 : 1;
  return Math.floor((base + 20 + p) * mult);
}

/**
 * "매직 넘버" — 포인트를 p로 올리는 순간 실수치가 +2 되는 p들. 성격 ×1.1 보정을 받는 스탯에서만
 * 생긴다(무보정·HP는 항상 +1, ×0.9는 +1 또는 +0). computeRealStats와 같은 공식으로 실제 차이를
 * 재서 찾으므로 공식이 바뀌어도 자동으로 맞는다.
 */
function magicPointsFor(
  stat: StatKey,
  base: number,
  maxP: number,
  nature: Nature | undefined,
): number[] {
  const out: number[] = [];
  for (let p = 1; p <= maxP; p++) {
    if (realStatAt(stat, base, p, nature) - realStatAt(stat, base, p - 1, nature) === 2) {
      out.push(p);
    }
  }
  return out;
}

interface PointsSliderProps {
  label: string;
  value: number;
  /** 슬라이더 눈금 기준 최대치 — 스탯별 상한(32) 고정이라 매직 눈금 위치가 흔들리지 않는다 */
  max: number;
  /** 지금 남은 총 예산까지 고려해 실제로 올릴 수 있는 상한. 이 지점 뒤는 흐리게 표시 */
  cap: number;
  /** 클릭·드래그로 절대값 지정 */
  onSet: (value: number) => void;
  /** 방향키 ±1 — 이전 상태 기준 증감이라 키 반복(길게 누름)에도 안전 */
  onStep: (delta: number) => void;
}

/** 로딩바 형태의 포인트 슬라이더(매직 넘버·HP 눈금은 아래 MarkStrip). 클릭·드래그·방향키로 조절. */
function PointsSlider({ label, value, max, cap, onSet, onStep }: PointsSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = max > 0 ? (value / max) * 100 : 0;
  const capPct = max > 0 ? (cap / max) * 100 : 100;

  function setFromClientX(clientX: number) {
    const el = trackRef.current;
    if (!el || max <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSet(Math.round(ratio * max));
  }

  return (
    <div
      ref={trackRef}
      className="points-slider"
      role="slider"
      tabIndex={0}
      aria-label={`${label} 포인트`}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromClientX(e.clientX);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onStep(-1);
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onStep(1);
        } else if (e.key === "Home") {
          e.preventDefault();
          onSet(0);
        } else if (e.key === "End") {
          e.preventDefault();
          onSet(max);
        }
      }}
    >
      <div className="points-slider-fill" style={{ width: `${pct}%` }} />
      {capPct < 100 && (
        <div
          className="points-slider-cap"
          style={{ left: `${capPct}%`, width: `${100 - capPct}%` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** 슬라이더 아래 눈금 하나 — level은 막대 높이(0 = 막대 없음, 마름모만) */
interface StripMark {
  points: number;
  level: 0 | 1 | 2 | 3 | 4;
  orb?: boolean;
  relevant?: boolean;
  info: MarkInfo;
}

/**
 * 슬라이더 아래 눈금 띠(3.4 H1) — HP는 최적 수치(막대 높이 = 등급, 마름모 = 생명의구슬 10n+9),
 * 성격 ▲ 스탯은 매직 넘버(실수치 +2)를 같은 모양으로 보인다. 누르면(클릭·탭) 아래에 설명 패널이 열리고 다시 누르면
 * 닫힌다 — 띠 어디를 눌러도 가장 가까운 눈금이 대상. 호버는 패널이 생겼다 사라지며 줄 높이가 흔들려 쓰지 않는다.
 * 도구·기술에 해당하는 눈금이 있으면 그것만 강조하고 나머지는 흐리게 한다.
 */
function MarkStrip({ marks, value, max, label }: { marks: StripMark[]; value: number; max: number; label: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (marks.length === 0) return null;
  const emphasize = marks.some((m) => m.relevant);
  const shown = marks.find((m) => m.points === open);

  function toggleNearest(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const at = ((e.clientX - rect.left) / rect.width) * max;
    const nearest = marks.reduce((best, m) => (Math.abs(m.points - at) < Math.abs(best.points - at) ? m : best));
    setOpen((o) => (o === nearest.points ? null : nearest.points));
  }

  return (
    <>
      <div className="mark-strip" role="group" aria-label={`${label} 눈금`} onClick={toggleNearest}>
        {marks.map((m) => (
          <span
            key={m.points}
            className={`mark level-${m.level}${m.orb ? " has-orb" : ""}${m.points <= value ? " is-reached" : ""}${m.points === open ? " is-open" : ""}${emphasize ? (m.relevant ? " is-relevant" : " is-dim") : ""}`}
            style={{ left: `${(m.points / max) * 100}%` }}
          >
            <i className="mark-bar" />
            {m.orb && <i className="mark-orb" />}
          </span>
        ))}
      </div>
      {shown && (
        <div className="mark-tip">
          <strong>{shown.info.header}</strong>
          {shown.info.rows.map((r) => (
            <div key={r.label} className={`mark-tip-row${r.relevant ? " is-relevant" : ""}`}>
              <b>
                {r.relevant ? "★ " : ""}
                {r.label}
              </b>
              <span>{r.effects}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function PointsEditorModal({
  pokemonName,
  baseStats,
  points,
  natureId,
  itemId,
  moveIds,
  onChange,
  onStep,
  onClose,
}: PointsEditorModalProps) {
  const used = totalAbilityPoints(points);
  const remaining = MAX_ABILITY_POINTS_TOTAL - used;
  const realStats = computeRealStats(baseStats, points, natureId);
  const nature = natureId ? getNature(natureId) : undefined;
  const relevant = relevantHpRules(itemId, moveIds);

  // 슬라이더 아래 눈금: HP는 최적 수치, 그 외는 성격 ▲ 스탯의 매직 넘버(실수치 +2)
  function marksFor(stat: StatKey): StripMark[] {
    if (stat === "hp") {
      return hpMarks(baseStats.hp, MAX_ABILITY_POINTS_PER_STAT).map((m) => {
        const info = hpMarkInfo(m, relevant);
        return { points: m.points, level: m.chain.length as StripMark["level"], orb: m.orb, relevant: info.rows.some((r) => r.relevant), info };
      });
    }
    return magicPointsFor(stat, baseStats[stat], MAX_ABILITY_POINTS_PER_STAT, nature).map((p) => ({
      points: p,
      level: 4,
      info: { header: `${STAT_LABELS[stat]} ${p}포인트`, rows: [{ label: "매직 넘버", effects: "이 포인트에서 실수치가 한 번에 2 오릅니다(▲ 성격 보정)", relevant: false }] },
    }));
  }

  return (
    <Modal title={`${pokemonName} · 능력 포인트`} onClose={onClose}>
      <div className="points-remaining">
        <span>남은 포인트</span>
        <strong className={remaining === 0 ? "is-zero" : ""}>
          {remaining} / {MAX_ABILITY_POINTS_TOTAL}
        </strong>
      </div>

      <div className="points-rows">
        {STAT_ORDER.map((stat) => {
          const value = points[stat];
          const maxForStat = Math.min(
            MAX_ABILITY_POINTS_PER_STAT,
            MAX_ABILITY_POINTS_TOTAL - (used - value),
          );
          const boosted = nature?.increased === stat;
          const lowered = nature?.decreased === stat;
          return (
            <div className="points-row" key={stat}>
              <span
                className={`points-label${boosted ? " is-boosted" : lowered ? " is-lowered" : ""}`}
              >
                {STAT_LABELS[stat]}
                {boosted && <span className="points-nature-mark"> ▲</span>}
                {lowered && <span className="points-nature-mark"> ▼</span>}
              </span>
              <button
                type="button"
                className="points-step"
                onClick={() => onStep(stat, -1)}
                disabled={value <= 0}
                aria-label={`${STAT_LABELS[stat]} 포인트 감소`}
              >
                −
              </button>
              <input
                type="number"
                className="points-input"
                min={0}
                max={maxForStat}
                value={value}
                onChange={(e) => onChange(stat, Number(e.target.value) || 0)}
              />
              <button
                type="button"
                className="points-step"
                onClick={() => onStep(stat, 1)}
                disabled={value >= maxForStat}
                aria-label={`${STAT_LABELS[stat]} 포인트 증가`}
              >
                ＋
              </button>
              <div className="points-slider-wrap">
                <PointsSlider
                  label={STAT_LABELS[stat]}
                  value={value}
                  max={MAX_ABILITY_POINTS_PER_STAT}
                  cap={maxForStat}
                  onSet={(v) => onChange(stat, v)}
                  onStep={(d) => onStep(stat, d)}
                />
                <MarkStrip marks={marksFor(stat)} value={value} max={MAX_ABILITY_POINTS_PER_STAT} label={STAT_LABELS[stat]} />
              </div>
              <span className="points-real">실수치 {realStats[stat]}</span>
            </div>
          );
        })}
      </div>

      {nature && (nature.increased || nature.decreased) && (
        <p className="points-nature-hint">
          <span className="is-boosted">▲ {nature.name}: {nature.increased && STAT_LABELS[nature.increased]} +10%</span>
          {nature.decreased && (
            <span className="is-lowered">
              {" · "}▼ {STAT_LABELS[nature.decreased]} −10%
            </span>
          )}
        </p>
      )}
    </Modal>
  );
}
