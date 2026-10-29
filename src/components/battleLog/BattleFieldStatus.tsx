import type { Side } from "./shared";
import type { BattleBoardProps } from "./battleBoardTypes";

/** 날씨·필드·트릭룸·설치기(스텔스록 등)·순풍 등 판 전체 상태 줄 */
export function BattleFieldStatus({ battleState }: Pick<BattleBoardProps, "battleState">) {
        const hazardTag = (side: Side): string[] => {
          const hz = side === "a" ? battleState.sideA.hazards : battleState.sideB.hazards;
          const parts: string[] = [];
          if (hz.stealthRock) parts.push("스텔스록");
          if (hz.spikesLayers > 0) parts.push(`압정뿌리기 ${hz.spikesLayers}층`);
          if (hz.toxicSpikesLayers > 0) parts.push(`독압정 ${hz.toxicSpikesLayers}층`);
          if (hz.stickyWeb) parts.push("끈적끈적네트");
          return parts;
        };
        const anyHazard = hazardTag("a").length > 0 || hazardTag("b").length > 0;
        const tailwindTurns = (side: Side) =>
          (side === "a" ? battleState.sideA : battleState.sideB).tailwindTurnsRemaining;
        const anyTailwind = tailwindTurns("a") !== undefined || tailwindTurns("b") !== undefined;
        if (
          !battleState.weather &&
          !battleState.field &&
          battleState.trickRoomTurnsRemaining === undefined &&
          battleState.wonderRoomTurnsRemaining === undefined &&
          battleState.magicRoomTurnsRemaining === undefined &&
          battleState.gravityTurnsRemaining === undefined &&
          battleState.fairyLockTurnsRemaining === undefined &&
          !anyHazard &&
          !anyTailwind
        ) {
          return null;
        }
        return (
          <div className="battle-environment-tags">
            {battleState.weather && (
              <span className="battle-environment-tag">
                날씨: {battleState.weather} (앞으로 {battleState.weatherTurnsRemaining}턴)
              </span>
            )}
            {battleState.field && (
              <span className="battle-environment-tag">
                필드: {battleState.field} (앞으로 {battleState.fieldTurnsRemaining}턴)
              </span>
            )}
            {battleState.trickRoomTurnsRemaining !== undefined && (
              <span className="battle-environment-tag">
                트릭룸 (앞으로 {battleState.trickRoomTurnsRemaining}턴)
              </span>
            )}
            {battleState.wonderRoomTurnsRemaining !== undefined && (
              <span className="battle-environment-tag">원더룸 (앞으로 {battleState.wonderRoomTurnsRemaining}턴)</span>
            )}
            {battleState.magicRoomTurnsRemaining !== undefined && (
              <span className="battle-environment-tag">매직룸 (앞으로 {battleState.magicRoomTurnsRemaining}턴)</span>
            )}
            {battleState.gravityTurnsRemaining !== undefined && (
              <span className="battle-environment-tag">중력 (앞으로 {battleState.gravityTurnsRemaining}턴)</span>
            )}
            {battleState.fairyLockTurnsRemaining !== undefined && (
              <span className="battle-environment-tag">
                페어리록 ({battleState.fairyLockTurnsRemaining >= 2 ? "다음 턴 교체 불가" : "이번 턴 교체 불가"})
              </span>
            )}
            {/* 진영 태그는 포켓몬 이름 대신 내·상대 진영으로 — 같은 포켓몬끼리 싸우면 구분이 안 된다(ver.1.9 사용자 제보) */}
            {(["a", "b"] as const).map((side) =>
              tailwindTurns(side) !== undefined ? (
                <span key={`tw-${side}`} className="battle-environment-tag">
                  {side === "a" ? "내" : "상대"} 진영: 순풍 (앞으로 {tailwindTurns(side)}턴)
                </span>
              ) : null,
            )}
            {(["a", "b"] as const).map((side) =>
              hazardTag(side).length > 0 ? (
                <span key={`hz-${side}`} className="battle-environment-tag">
                  {side === "a" ? "내" : "상대"} 진영: {hazardTag(side).join(" · ")}
                </span>
              ) : null,
            )}
          </div>
        );
}
