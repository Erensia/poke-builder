import type { useBattleSeries } from "../hooks/useBattleSeries";
import { summarizeSeries } from "../lib/battleSeries";
import { SAMPLE_PARTIES } from "../lib/data";
import type { SamplePartyPreset } from "../types/party";
import "./BattleSeriesPanel.css";

interface BattleSeriesPanelProps {
  series: ReturnType<typeof useBattleSeries>;
  /** 시작할 수 있는 조건을 못 채웠을 때 이유(없으면 시작 가능) */
  startBlockedReason: string | null;
  /** 시작·다음 상대 불러오기 — 상대 진영(b)에 이 샘플을 채운다 */
  onStart: (first: SamplePartyPreset) => void;
}

const RESULT_LABEL = { a: "승", b: "패", draw: "무" } as const;

/**
 * 연속 대전(2.2 B2) 안내·요약 패널. 대전 설정 화면 맨 위에 두고, 진행 중이면 현재 상대·전적, 끝났거나 중단했으면
 * 판별 결과 요약을 보여 준다.
 */
export function BattleSeriesPanel({ series, startBlockedReason, onStart }: BattleSeriesPanelProps) {
  const { state, current } = series;

  if (!state) {
    return (
      <div className="battle-series">
        <span className="battle-series-text">
          <strong>연속 대전</strong> — 내 파티는 그대로 두고 상대를 샘플 파티 {SAMPLE_PARTIES.length}개로 차례로 바꿔 가며 싸우고, 마지막에 승패를 요약해요.
        </span>
        <button type="button" className="battle-setup-load-party" disabled={!!startBlockedReason} title={startBlockedReason ?? undefined} onClick={() => onStart(series.start())}>
          연속 대전 시작
        </button>
      </div>
    );
  }

  const total = state.order.length;
  const sum = summarizeSeries(state.results);
  const record = `${sum.wins}승 ${sum.losses}패${sum.draws ? ` ${sum.draws}무` : ""}`;

  if (!state.finished) {
    return (
      <div className="battle-series">
        <span className="battle-series-text">
          <strong>연속 대전 {state.results.length + 1} / {total}</strong> · 지금 상대: {current?.name} ({current?.style}) · 전적 {record}
        </span>
        <button type="button" className="battle-setup-load-party" onClick={series.stop}>
          중단하고 요약 보기
        </button>
      </div>
    );
  }

  const played = state.results.length;
  return (
    <div className="battle-series is-summary">
      <div className="battle-series-head">
        <strong>연속 대전 요약</strong>
        <span>
          {played}판 · {record}
          {played > 0 && ` · 승률 ${Math.round((sum.wins / played) * 100)}%`}
        </span>
        <button type="button" className="battle-setup-load-party" onClick={series.close}>
          닫기
        </button>
      </div>
      {played === 0 ? (
        <p className="battle-series-text">치른 대전이 없어요.</p>
      ) : (
        <ol className="battle-series-list">
          {state.results.map((r, i) => {
            const sample = state.order.find((o) => o.id === r.sampleId);
            return (
              <li key={r.sampleId} className={`is-${r.winner}`}>
                <span className="battle-series-no">{i + 1}</span>
                <span className="battle-series-name">{sample?.name ?? r.sampleId}</span>
                <span className="battle-series-style">{sample?.style}</span>
                <span className="battle-series-result">{RESULT_LABEL[r.winner]}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
