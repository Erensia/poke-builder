import { Sidebar } from "./components/Sidebar";
import { PartyBoard } from "./components/PartyBoard";
import "./App.css";

function App() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <PartyBoard />
      </main>
    </div>
  );
}

export default App;
