import "./Sidebar.css";

const NAV_ITEMS = [
  { label: "파티 빌더", icon: "⬡", active: true },
  { label: "포켓몬 도감", icon: "▤", active: false },
  { label: "기술표", icon: "≡", active: false },
] as const;

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-mark" aria-hidden="true" />
        <span className="sidebar-logo-text">
          Poke-Builder
          <small>파티 빌더</small>
        </span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            className={`sidebar-nav-item${item.active ? " is-active" : ""}`}
            disabled={!item.active}
          >
            <span className="sidebar-nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
