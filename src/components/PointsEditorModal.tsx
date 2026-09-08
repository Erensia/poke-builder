import { useRef } from "react";
import { Modal } from "./Modal";
import {
  computeRealStats,
  MAX_ABILITY_POINTS_PER_STAT,
  MAX_ABILITY_POINTS_TOTAL,
  totalAbilityPoints,
} from "../lib/statCalculator";
import { STAT_LABELS, STAT_ORDER } from "../lib/statLabels";
import { getNature } from "../lib/data";
import type { AbilityPoints } from "../types/party";
import type { BaseStats } from "../types/stats";
import type { StatKey, Nature } from "../types/nature";
import "./PointsEditorModal.css";

interface PointsEditorModalProps {
  pokemonName: string;
  baseStats: BaseStats;
  points: AbilityPoints;
  natureId: string | null;
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
  magicPoints: number[];
  /** 클릭·드래그로 절대값 지정 */
  onSet: (value: number) => void;
  /** 방향키 ±1 — 이전 상태 기준 증감이라 키 반복(길게 누름)에도 안전 */
  onStep: (delta: number) => void;
}

/** 로딩바 형태의 포인트 슬라이더. 매직 넘버 위치엔 굵은 눈금을 그린다. 클릭·드래그·방향키로 조절. */
function PointsSlider({ label, value, max, cap, magicPoints, onSet, onStep }: PointsSliderProps) {
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
      {magicPoints.map((p) => (
        <span
          key={p}
          className={`points-slider-magic${p <= value ? " is-reached" : ""}`}
          style={{ left: `${max > 0 ? (p / max) * 100 : 0}%` }}
          title={`${p}포인트 — 실수치 +2 구간`}
        />
      ))}
    </div>
  );
}

export function PointsEditorModal({
  pokemonName,
  baseStats,
  points,
  natureId,
  onChange,
  onStep,
  onClose,
}: PointsEditorModalProps) {
  const used = totalAbilityPoints(points);
  const remaining = MAX_ABILITY_POINTS_TOTAL - used;
  const realStats = computeRealStats(baseStats, points, natureId);
  const nature = natureId ? getNature(natureId) : undefined;

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
          const magicPoints = magicPointsFor(stat, baseStats[stat], MAX_ABILITY_POINTS_PER_STAT, nature);
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
              <PointsSlider
                label={STAT_LABELS[stat]}
                value={value}
                max={MAX_ABILITY_POINTS_PER_STAT}
                cap={maxForStat}
                magicPoints={magicPoints}
                onSet={(v) => onChange(stat, v)}
                onStep={(d) => onStep(stat, d)}
              />
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
