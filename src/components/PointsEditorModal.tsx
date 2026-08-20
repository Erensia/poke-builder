import { Modal } from "./Modal";
import {
  computeRealStats,
  MAX_ABILITY_POINTS_PER_STAT,
  MAX_ABILITY_POINTS_TOTAL,
  totalAbilityPoints,
} from "../lib/statCalculator";
import { STAT_LABELS, STAT_ORDER } from "../lib/statLabels";
import type { AbilityPoints } from "../types/party";
import type { BaseStats } from "../types/stats";
import type { StatKey } from "../types/nature";
import "./PointsEditorModal.css";

interface PointsEditorModalProps {
  pokemonName: string;
  baseStats: BaseStats;
  points: AbilityPoints;
  natureId: string | null;
  /** 숫자 입력창 직접 수정용 (절대값) */
  onChange: (stat: StatKey, value: number) => void;
  /** +/- 버튼용 (이전 상태 기준 증감, 연속 클릭에도 안전) */
  onStep: (stat: StatKey, delta: number) => void;
  onClose: () => void;
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
          return (
            <div className="points-row" key={stat}>
              <span className="points-label">{STAT_LABELS[stat]}</span>
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
              <span className="points-real">실수치 {realStats[stat]}</span>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
