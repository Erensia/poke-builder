import { useState } from "react";
import { Sidebar, type AppView } from "./components/Sidebar";
import { PartyBoard } from "./components/PartyBoard";
import { MatchupPage } from "./components/MatchupPage";
import { BattleLogPage } from "./components/BattleLogPage";
import { PokedexPage } from "./components/PokedexPage";
import { MoveDexPage } from "./components/MoveDexPage";
import { ItemDexPage } from "./components/ItemDexPage";
import "./App.css";

function App() {
  const [view, setView] = useState<AppView>("party");
  // 포켓몬 도감의 기술 칩을 눌러 기술표로 넘어갈 때, 어떤 기술로 스크롤+강조할지 전달한다.
  // MoveDexPage가 1회 소비하면 비워서, 이후 사이드바로 직접 들어왔을 때는 재적용되지 않는다.
  const [pendingMoveId, setPendingMoveId] = useState<string | null>(null);

  return (
    <div className="app-shell">
      <Sidebar activeView={view} onSelectView={setView} />
      <main className="app-main">
        {view === "party" && <PartyBoard />}
        {view === "matchup" && <MatchupPage />}
        {view === "battle-log" && <BattleLogPage />}
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
    </div>
  );
}

export default App;
