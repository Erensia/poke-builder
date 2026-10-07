import type { useBattleSeries } from "../hooks/useBattleSeries";
import { SAMPLE_PARTIES } from "../lib/data";
import type { SamplePartyPreset } from "../types/party";
import "./BattleSeriesPanel.css";

interface BattleSeriesPanelProps {
  series: ReturnType<typeof useBattleSeries>;
  /** 시작할 수 있는 조건을 못 채웠을 때 이유(없으면 시작 가능) */
  startBlockedReason: string | null;
  /** 시작 — 상대 진영(b)에 첫 샘플을 채우고 내 선출을 다시 고르게 한다 */
  onStart: (first: SamplePartyPreset) => void;
}

/**
 * 배틀 프런티어(2.5 L4) 패널. 대전 설정 화면 맨 위에 두고, 현재·최대 연승과 샘플 파티별 누적 승패를 보여 준다.
 * 켜져 있으면 지금 상대를 안내하고, 상대는 수동으로 바꿀 수 없다(설정 화면이 상대 편을 잠근다).
 */
export function BattleSeriesPanel({ series, startBlockedReason, onStart }: BattleSeriesPanelProps) {
  const { save, active, current } = series;
  const played = SAMPLE_PARTIES.filter((s) => save.samples[s.id]);

  return (
    <div className="battle-series">
      <span className="battle-series-text">
        <strong>배틀 프런티어</strong> — 선출을 고정하고 샘플 파티 {SAMPLE_PARTIES.length}개를 무작위로 상대하며 연승을 쌓아요. 한 판 지면 연승이 끊기고, 도중에 나가면 진 걸로 쳐요.
        <br />
        현재 <strong>{save.streak}연승</strong> · 최대 <strong>{save.best}연승</strong>
        {active && current && ` · 지금 상대: ${current.name} (${current.style})`}
      </span>
      {active ? (
        <button type="button" className="battle-setup-load-party" onClick={series.stop}>
          종료하기
        </button>
      ) : (
        <button type="button" className="battle-setup-load-party" disabled={!!startBlockedReason} title={startBlockedReason ?? undefined} onClick={() => onStart(series.start())}>
          시작하기
        </button>
      )}
      {played.length > 0 && (
        <details className="battle-series-details">
          <summary>샘플 파티별 승패 ({played.length}개 상대)</summary>
          <ul className="battle-series-list">
            {played.map((s) => (
              <li key={s.id}>
                <span className="battle-series-name">{s.name}</span>
                <span className="battle-series-style">{s.style}</span>
                <span className="battle-series-result">
                  {save.samples[s.id].wins}승 {save.samples[s.id].losses}패
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
