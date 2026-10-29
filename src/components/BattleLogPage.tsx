import { BattleSeriesPanel } from "./BattleSeriesPanel";
import { RankPanel } from "./RankPanel";
import { RankResultCard } from "./RankResultCard";
import { BattleTurnLog } from "./BattleTurnLog";
import { Modal } from "./Modal";
import { BattleVideoListModal } from "./BattleVideoListModal";
import { AiMemoryModal } from "./AiMemoryModal";
import { BattleBoard } from "./battleLog/BattleBoard";
import { BattleSelectScreen } from "./battleLog/BattleSelectScreen";
import { BattleSetupScreen } from "./battleLog/BattleSetupScreen";
import { battleBoardBackground } from "./battleLog/shared";
import "./BattleLogPage.css";
import { useBattleLogSession, type BattleMode } from "./battleLog/useBattleLogSession";
import { BattleLogPickers } from "./battleLog/BattleLogPickers";

export function BattleLogPage({ mode }: { mode: BattleMode }) {
  const session = useBattleLogSession(mode);
  const { rank, rankNotStarted, setBattleVideoView, battleVideos, battleState, selecting, series, seriesStartBlockedReason, setFrontierSelection, loadSample, setup, partyPresets, slotPresets, movelessWarningFor, handleSaveSlotAsSample, setPicker, canProceed, proceedLabel, hasMovelessSlot, handleProceed, aiOpponent, setAiOpponent, aiMemory, setShowAiMemory, loadRandomSample, loadRandomSlotParty, selection, buildableIndices, fixedPickIndices, needsSelection, pokemonAt, slotCtl, toggleSelection, setSelecting, selectionComplete, startBattleWith, winner, selected, setSelected, inputMode, setInputMode, megaDeclared, setMegaDeclared, pendingForcedSwitch, pendingPivot, lockWarning, setLockWarning, log, activeMoveIds, choiceLockedMoveId, battleSide, switchableIndices, resolveForcedSwitch, resolvePivot, isStruggling, moveRestrictionMessage, playTurn, resetToSetup, aiSide, aiThinking, learnedBattles, showAiMemory, battleVideoView } = session;


  return (
    <section className="battle-log-page">
      <header className="battle-log-header">
        <div>
          <h2>{mode === "rank" ? "랭크배틀" : "배틀타워"}</h2>
          <p>{mode === "rank" ? "AI와 랭크를 겨루는 배틀" : "실전 배틀 시뮬레이션"}</p>
        </div>
        <button
          type="button"
          className="battle-video-toggle tap-target"
          onClick={() => setBattleVideoView("list")}
        >
          배틀비디오{battleVideos.videos.length > 0 && ` (${battleVideos.videos.length})`}
        </button>
      </header>

      {!battleState && !selecting && mode === "free" && (
        <BattleSeriesPanel
          series={series}
          startBlockedReason={seriesStartBlockedReason}
          onStart={(first) => {
            setFrontierSelection(null);
            loadSample("b", first);
          }}
        />
      )}

      {!battleState && !selecting && mode === "rank" && (
        <RankPanel rank={rank} startBlockedReason={seriesStartBlockedReason} onStart={(first) => loadSample("b", first)} />
      )}

      {!battleState && !selecting && (
        <BattleSetupScreen
          setup={setup}
          hasPartyPresets={partyPresets.presets.length > 0}
          hasSlotPresets={slotPresets.presets.length > 0}
          movelessWarningFor={movelessWarningFor}
          onSaveSlotAsSample={handleSaveSlotAsSample}
          onOpenPicker={setPicker}
          canProceed={canProceed}
          proceedLabel={proceedLabel}
          hasMovelessSlot={hasMovelessSlot}
          onProceed={handleProceed}
          aiOpponent={aiOpponent}
          onToggleAiOpponent={setAiOpponent}
          aiMemoryBattles={aiMemory.memory.battles}
          onOpenAiMemory={() => setShowAiMemory(true)}
          onLoadRandomSample={loadRandomSample}
          onLoadRandomSlotParty={loadRandomSlotParty}
          opponentLocked={series.active || mode === "rank"}
          lockedNote={mode === "rank" ? null : "배틀 프런티어 중에는 상대를 바꿀 수 없어요."}
          proceedBlockedReason={rankNotStarted ? "위쪽의 \"랭크 배틀 시작\"을 먼저 눌러 주세요" : undefined}
        />
      )}

      {!battleState && selecting && (
        <BattleSelectScreen
          selection={selection}
          buildableIndices={buildableIndices}
          needsSelection={needsSelection}
          pokemonAt={pokemonAt}
          slotAt={(side, i) => slotCtl(side, i).slot}
          onToggleSelection={toggleSelection}
          onBack={() => setSelecting(false)}
          selectionComplete={selectionComplete}
          onStartBattle={() => startBattleWith(selection)}
          hiddenSide={aiOpponent ? "b" : null}
          isFixedPick={(side, i) => fixedPickIndices(side).includes(i)}
        />
      )}

      {battleState && (
        <BattleBoard
          battleState={battleState}
          winner={winner}
          selected={selected}
          setSelected={setSelected}
          inputMode={inputMode}
          setInputMode={setInputMode}
          megaDeclared={megaDeclared}
          setMegaDeclared={setMegaDeclared}
          pendingForcedSwitch={pendingForcedSwitch}
          pendingPivot={pendingPivot}
          lockWarning={lockWarning}
          setLockWarning={setLockWarning}
          log={log}
          battleBoardBackground={battleBoardBackground}
          activeMoveIds={activeMoveIds}
          choiceLockedMoveId={choiceLockedMoveId}
          battleSide={battleSide}
          switchableIndices={switchableIndices}
          resolveForcedSwitch={resolveForcedSwitch}
          resolvePivot={resolvePivot}
          isStruggling={isStruggling}
          moveRestrictionMessage={moveRestrictionMessage}
          buildableIndices={buildableIndices}
          pokemonAt={pokemonAt}
          selection={selection}
          playTurn={playTurn}
          resetToSetup={resetToSetup}
          aiSide={aiSide}
          aiThinking={aiThinking}
          learnedBattles={learnedBattles}
          seriesNext={
            series.active && series.current
              ? {
                  label: "다음 상대 →",
                  note: "배틀 프런티어 진행 중 — 결과가 나오기 전에 나가면(탭 이동·새로고침·창 닫기) 이 판은 패배로 기록되고 연승이 끊겨요.",
                  onNext: () => {
                    loadSample("b", series.current!);
                    resetToSetup();
                  },
                }
              : rank.active && rank.current
                ? {
                    label: "다음 상대 →",
                    note: "랭크배틀 진행 중 — 결과가 나오기 전에 나가면(탭 이동·새로고침·창 닫기) 이 판은 패배로 기록돼요.",
                    onNext: () => {
                      loadSample("b", rank.next());
                      resetToSetup();
                    },
                  }
                : null
          }
          resultExtra={rank.active && rank.lastResult ? <RankResultCard result={rank.lastResult} /> : null}
        />
      )}

      {showAiMemory && (
        <AiMemoryModal
          memory={aiMemory.memory}
          recentBattles={aiMemory.recentBattles}
          note={mode === "rank" ? "랭크 AI는 몬스터볼~하이퍼볼에서는 습관을 쌓아 두기만 하고, 마스터볼부터 단계적으로 활용합니다." : undefined}
          learningEnabled={aiMemory.learningEnabled}
          onToggleLearning={aiMemory.setLearningEnabled}
          onReset={aiMemory.reset}
          onClose={() => setShowAiMemory(false)}
        />
      )}

      <BattleLogPickers s={session} />

      {battleVideoView === "list" && (
        <BattleVideoListModal
          videos={battleVideos.videos}
          onClose={() => setBattleVideoView(null)}
          onView={(video) => setBattleVideoView(video)}
          onDelete={battleVideos.deleteVideo}
        />
      )}

      {battleVideoView && battleVideoView !== "list" && (
        <Modal
          title={`${battleVideoView.labelA} VS ${battleVideoView.labelB}`}
          onClose={() => setBattleVideoView(null)}
        >
          {/* 배틀비디오는 그 시점의 텍스트 로그만 그대로 보여준다 — 포켓몬 UI(스프라이트·게이지)는 없음(§6) */}
          <BattleTurnLog log={battleVideoView.log} />
        </Modal>
      )}
    </section>
  );
}
