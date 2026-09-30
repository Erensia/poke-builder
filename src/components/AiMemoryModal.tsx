import { useState } from "react";
import { Modal } from "./Modal";
import { InfoTooltip } from "./InfoTooltip";
import { PokemonAvatarWithItem } from "./PokemonAvatarWithItem";
import { getMove, getPokemon } from "../lib/data";
import { memoryFactors, type OpponentMemory } from "../lib/battle/ai/opponentMemory";
import "./AiMemoryModal.css";

/** 이 판 수 미만이면 "아직 학습 중" 안내 — 사전값 때문에 실제로도 그쯤부터 반영된다 */
const LEARNING_WARMUP_BATTLES = 10;
/** 포켓몬별 목록 최대 개수 */
const MAX_SPECIES_ROWS = 12;

const LEARNING_SWITCH_HELP =
  "끄면 AI는 지금까지 배운 습관은 그대로 쓰지만, 이번 대전부터는 새로 배우지 않습니다. 평소와 다른 전략을 시험해 볼 때 꺼 두세요.";

function levelOf(factor: number): { label: string; tone: "low" | "mid" | "high" } {
  if (factor < 0.6) return { label: "낮음", tone: "low" };
  if (factor > 1.4) return { label: "높음", tone: "high" };
  return { label: "보통", tone: "mid" };
}

function FactorCard({ title, factor, detail }: { title: string; factor: number; detail: string }) {
  const level = levelOf(factor);
  return (
    <div className="ai-memory-card">
      <div className="ai-memory-card-title">{title}</div>
      <div className="ai-memory-bar" aria-hidden="true">
        <span className={`ai-memory-bar-fill is-${level.tone}`} style={{ width: `${Math.min(100, (factor / 2) * 100)}%` }} />
      </div>
      <div className={`ai-memory-card-level is-${level.tone}`}>{level.label}</div>
      <div className="ai-memory-card-detail">{detail}</div>
    </div>
  );
}

/**
 * "AI가 본 내 습관"(ver.2.0 1-C, 사용자 확인 설계): 카드 3개(교체 성향·변화기 성향·학습한 선택) + 포켓몬별 두드러진 습관 +
 * "대전에서 계속 학습" 스위치(설명 말풍선) + 학습 초기화(확인 창 — AI 학습 키만 지운다).
 */
export function AiMemoryModal({
  memory,
  learningEnabled,
  onToggleLearning,
  onReset,
  onClose,
}: {
  memory: OpponentMemory;
  learningEnabled: boolean;
  onToggleLearning: (on: boolean) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const { switchFactor, statusFactor } = memoryFactors(memory);
  const species = Object.entries(memory.species)
    .sort((a, b) => b[1].lastBattle - a[1].lastBattle || b[1].seen - a[1].seen)
    .slice(0, MAX_SPECIES_ROWS);

  return (
    <Modal title="AI가 본 내 습관" onClose={onClose}>
      <div className="ai-memory">
        <p className="ai-memory-meta">최근 약 100판 기준 · 누적 {memory.battles}판</p>
        {memory.battles < LEARNING_WARMUP_BATTLES && (
          <p className="ai-memory-warmup">아직 학습 중 — {LEARNING_WARMUP_BATTLES}판 정도부터 AI가 습관을 반영하기 시작합니다.</p>
        )}

        <div className="ai-memory-cards">
          <FactorCard title="교체 성향" factor={switchFactor} detail={`AI 예상 대비 ×${switchFactor.toFixed(2)}`} />
          <FactorCard title="변화기 성향" factor={statusFactor} detail={`AI 예상 대비 ×${statusFactor.toFixed(2)}`} />
          <div className="ai-memory-card">
            <div className="ai-memory-card-title">학습한 선택</div>
            <div className="ai-memory-card-count">{Math.round(memory.decisions)}회</div>
            <div className="ai-memory-card-detail">최근 기록일수록 크게 반영</div>
          </div>
        </div>

        <h4 className="ai-memory-section">포켓몬별 (최근 사용 순)</h4>
        {species.length === 0 ? (
          <p className="ai-memory-empty">아직 기록이 없습니다.</p>
        ) : (
          <ul className="ai-memory-species">
            {species.map(([id, sp]) => {
              const pokemon = getPokemon(id);
              const moves = Object.entries(sp.moves).sort((a, b) => b[1].actual - a[1].actual);
              const top = moves[0];
              const total = moves.reduce((sum, [, m]) => sum + m.actual, 0);
              const few = sp.seen < 3;
              return (
                <li key={id} className="ai-memory-species-row">
                  {pokemon && <PokemonAvatarWithItem pokemon={pokemon} size={32} radius="circle" />}
                  <span className="ai-memory-species-name">{pokemon?.name ?? id}</span>
                  <span className="ai-memory-species-habit">
                    {few || !top || total <= 0
                      ? "기록 적음"
                      : `${getMove(top[0])?.name ?? top[0]} 주로 (${Math.round((top[1].actual / total) * 100)}%)`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="ai-memory-footer">
          <InfoTooltip text={LEARNING_SWITCH_HELP}>
            <label className="ai-memory-switch">
              <input type="checkbox" checked={learningEnabled} onChange={(e) => onToggleLearning(e.target.checked)} />
              <span>대전에서 계속 학습</span>
            </label>
          </InfoTooltip>
          {confirmReset ? (
            <span className="ai-memory-confirm">
              되돌릴 수 없습니다. 초기화할까요?
              <button
                type="button"
                className="ai-memory-reset is-danger"
                onClick={() => {
                  onReset();
                  setConfirmReset(false);
                }}
              >
                초기화
              </button>
              <button type="button" className="ai-memory-reset" onClick={() => setConfirmReset(false)}>
                취소
              </button>
            </span>
          ) : (
            <button type="button" className="ai-memory-reset is-danger" onClick={() => setConfirmReset(true)}>
              학습 초기화
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
