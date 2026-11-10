import type { CSSProperties } from "react";
import { SIDE_NAME } from "../../lib/battleLogText";
import type { BattleBoardProps } from "./battleBoardTypes";
import { canPlayTurn } from "./battleRules";

/**
 * 배틀판 아래쪽 — 등장 안내·결과 배너·강제 교체 안내·턴 진행 버튼.
 * resultDelay(ms)는 7.4 E4 — 결과 배너를 마지막 기절 연출이 끝난 뒤에 띄운다. 랭크 결과 카드(resultExtra)는 지연이 CSS·카운트업에 따로 박혀 있어
 * 순서가 어긋나지 않게 랭크 대전에서는 쓰지 않고 기본 지연(1.1초)을 유지한다.
 */
export function BattleTurnPanel(props: BattleBoardProps & { resultDelay?: number | null }) {
  const { battleState, winner, pendingForcedSwitch, pendingPivot, lockWarning, playTurn, resetToSetup, aiSide, learnedBattles, seriesNext, resultExtra } = props;
  // AI 상대면 고를 때는 기술을 한 번 더 눌러, 고를 게 없는 턴(난동·모으기·반동·발버둥)은 BattleBoard가 자동으로 진행하므로 모바일에서는 이 버튼을 숨긴다(8.1 U8-b)
  const tapConfirm = aiSide !== null;
  return (
    <>
    {battleState.entryAnnouncements.length > 0 && (
      <div className="battle-entry-announcements">
        {battleState.entryAnnouncements.map((text, i) => (
          <div key={i}>{text}</div>
        ))}
      </div>
    )}

    {winner ? (
      <>
        <div
          className={`battle-result-banner result-in${winner === "draw" ? " is-draw" : ""}`}
          style={props.resultDelay != null && !resultExtra ? ({ "--result-delay": `${props.resultDelay}ms` } as CSSProperties) : undefined}
        >
          {winner === "draw" ? "🤝 무승부! 양쪽 다 기절했어요" : `🏆 ${SIDE_NAME[winner]} 승리!`}
          <button type="button" className="battle-reset-button" onClick={seriesNext ? seriesNext.onNext : resetToSetup}>
            {seriesNext ? seriesNext.label : "대전 이어하기"}
          </button>
        </div>
        {resultExtra}
        {learnedBattles !== null && (
          <p className="battle-ai-learned-note">AI가 이번 대전을 학습했습니다 (누적 {learnedBattles}판)</p>
        )}
      </>
    ) : pendingForcedSwitch ? (
      <div className="battle-lock-warning">내보낼 포켓몬을 선택하세요!</div>
    ) : pendingPivot ? (
      <div className="battle-lock-warning">교체 기술로 물러날 포켓몬을 선택하세요!</div>
    ) : (
      <>
        <button
          type="button"
          className={`battle-start-button${tapConfirm ? " is-tap-confirm" : ""}`}
          disabled={!canPlayTurn(props)}
          onClick={playTurn}
        >
          턴 진행
        </button>
        {lockWarning && <div className="battle-lock-warning">{lockWarning}</div>}
        {seriesNext && (
          <p className="battle-ai-learned-note">{seriesNext.note}</p>
        )}
      </>
    )}
    </>
  );
}
