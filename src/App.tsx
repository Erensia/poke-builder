import { useState } from "react";
import { Sidebar, type AppView } from "./components/Sidebar";
import { PartyBoard } from "./components/PartyBoard";
import { MatchupPage } from "./components/MatchupPage";
import { BattleLogPage } from "./components/BattleLogPage";
import "./App.css";

function App() {
  const [view, setView] = useState<AppView>("party");

  return (
    <div className="app-shell">
      <Sidebar activeView={view} onSelectView={setView} />
      <main className="app-main">
        {view === "party" && <PartyBoard />}
        {view === "matchup" && <MatchupPage />}
        {view === "battle-log" && <BattleLogPage />}
      </main>
    </div>
  );
}

export default App;
