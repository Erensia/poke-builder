import { useEffect, useState } from "react";
import { Sidebar, type AppView } from "./components/Sidebar";
import { PartyBoard } from "./components/PartyBoard";
import { MatchupPage } from "./components/MatchupPage";
import { BattleLogPage } from "./components/BattleLogPage";
import { PokedexPage } from "./components/PokedexPage";
import { MoveDexPage } from "./components/MoveDexPage";
import { ItemDexPage } from "./components/ItemDexPage";
import { Footer } from "./components/Footer";
import { Modal } from "./components/Modal";
import { startCloudSync } from "./lib/cloudSync";
import { loadBattleRank, loadCloudSyncMeta } from "./lib/storage";
import "./App.css";

function App() {
  const [view, setView] = useState<AppView>("party");
  // 포켓몬 도감의 기술 칩을 눌러 기술표로 넘어갈 때, 어떤 기술로 스크롤+강조할지 전달한다.
  // MoveDexPage가 1회 소비하면 비워서, 이후 사이드바로 직접 들어왔을 때는 재적용되지 않는다.
  const [pendingMoveId, setPendingMoveId] = useState<string | null>(null);
  // 이동하려던 화면 — 랭크 대전 중이면 확인 모달이 이 값을 들고 있다가 "나가기"에서 이동한다
  const [leaveTo, setLeaveTo] = useState<AppView | null>(null);

  // 지난번에 클라우드 로그인을 했던 브라우저만 시작할 때 동기화를 이어간다(그 외에는 Firebase를 내려받지 않는다)
  useEffect(() => {
    if (loadCloudSyncMeta().lastUid) startCloudSync();
  }, []);

  // 랭크 판이 시작됐는데 결과가 없는 채(`pendingId` 표시가 저장돼 있다) 화면을 벗어나면 이탈(= 패배)로 정산되므로, 이동 전에 한 번 묻는다.
  // 하단 탭(5.1 A6)은 엄지로 쉽게 눌려 오조작이 잦을 수 있다. 표시는 localStorage가 원본이라 App이 상태를 따로 받지 않고 이동 시점에 읽는다.
  function requestView(next: AppView) {
    if (next !== view && view === "rank-battle" && loadBattleRank().pendingId !== null) setLeaveTo(next);
    else setView(next);
  }

  return (
    <div className="app-shell">
      <Sidebar activeView={view} onSelectView={requestView} />
      <div className="app-body">
        <main className="app-main">
          {view === "party" && <PartyBoard />}
          {view === "matchup" && <MatchupPage />}
          {view === "battle-log" && <BattleLogPage mode="free" />}
          {view === "rank-battle" && <BattleLogPage mode="rank" />}
          {view === "pokedex" && (
            <PokedexPage
              onSelectMove={(moveId) => {
                setPendingMoveId(moveId);
                setView("movedex");
              }}
            />
          )}
          {view === "movedex" && (
            <MoveDexPage initialMoveId={pendingMoveId} onInitialMoveConsumed={() => setPendingMoveId(null)} />
          )}
          {view === "itemdex" && <ItemDexPage />}
        </main>
        <Footer />
      </div>
      {leaveTo && (
        <Modal title="랭크 대전 중이에요" onClose={() => setLeaveTo(null)}>
          <p className="rank-leave-note">지금 나가면 이 판은 패배로 기록돼요. 대전을 계속할까요?</p>
          <div className="rank-leave-actions">
            <button
              type="button"
              className="battle-setup-load-party tap-target"
              onClick={() => {
                setView(leaveTo);
                setLeaveTo(null);
              }}
            >
              나가기 (패배)
            </button>
            <button type="button" className="battle-setup-load-party tap-target" autoFocus onClick={() => setLeaveTo(null)}>
              계속 대전
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default App;
