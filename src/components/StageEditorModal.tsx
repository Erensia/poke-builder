import { Modal } from "./Modal";
import { rankStageMultiplier } from "../lib/battlePower";
import { STAT_LABELS } from "../lib/statLabels";
import type { StatStages, BattleStatKey } from "../types/battleStats";
import "./PointsEditorModal.css";

const STAGE_ORDER: BattleStatKey[] = ["atk", "def", "spa", "spd", "spe"];

interface StageEditorModalProps {
  pokemonName: string;
  stages: StatStages;
  onStep: (stat: BattleStatKey, delta: number) => void;
  onReset: () => void;
  onClose: () => void;
}

export function StageEditorModal({
  pokemonName,
  stages,
  onStep,
  onReset,
  onClose,
}: StageEditorModalProps) {
  return (
    <Modal title={`${pokemonName} · 랭크 상태`} onClose={onClose}>
      <button type="button" className="move-clear-btn" onClick={onReset}>
        전부 0랭크로 초기화
      </button>
      <div className="points-rows">
        {STAGE_ORDER.map((stat) => {
          const value = stages[stat];
          const pct = Math.round(rankStageMultiplier(value) * 100);
          return (
            <div className="points-row" key={stat}>
              <span className="points-label">{STAT_LABELS[stat]}</span>
              <button
                type="button"
                className="points-step"
                onClick={() => onStep(stat, -1)}
                disabled={value <= -6}
                aria-label={`${STAT_LABELS[stat]} 랭크 감소`}
              >
                −
              </button>
              <span className="points-input" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                {value > 0 ? `+${value}` : value}
              </span>
              <button
                type="button"
                className="points-step"
                onClick={() => onStep(stat, 1)}
                disabled={value >= 6}
                aria-label={`${STAT_LABELS[stat]} 랭크 증가`}
              >
                ＋
              </button>
              <span className="points-real">{pct}%</span>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
