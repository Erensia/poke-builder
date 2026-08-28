import { useState, type ReactNode } from "react";
import "./Sidebar.css";

export type AppView = "party" | "matchup" | "battle-log" | "pokedex" | "movedex" | "itemdex";

// 유니코드 글자 아이콘(⬡⚔▤≡)은 폰트마다 그려지는 실제 위치(광학 중심)가 제각각이라
// 박스를 아무리 맞춰도 어긋나 보일 수 있다. viewBox가 고정된 SVG로 바꿔서 확실히 정렬한다.
function IconHexagon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    </svg>
  );
}

function IconSwords() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
      <line x1="13" x2="19" y1="19" y2="13" />
      <line x1="16" x2="20" y1="16" y2="20" />
      <line x1="19" x2="21" y1="21" y2="19" />
      <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
      <line x1="5" x2="9" y1="14" y2="18" />
      <line x1="4" x2="6" y1="17" y2="19" />
      <line x1="3" x2="5" y1="19" y2="21" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  );
}

function IconScroll() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4" />
      <path d="M19 17V5a2 2 0 0 0-2-2H4" />
      <path d="M15 8h-5" />
      <path d="M15 12h-5" />
    </svg>
  );
}

function IconBag() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function IconList() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" x2="21" y1="6" y2="6" />
      <line x1="8" x2="21" y1="12" y2="12" />
      <line x1="8" x2="21" y1="18" y2="18" />
      <line x1="3" x2="3.01" y1="6" y2="6" />
      <line x1="3" x2="3.01" y1="12" y2="12" />
      <line x1="3" x2="3.01" y1="18" y2="18" />
    </svg>
  );
}

const NAV_ITEMS: { label: string; icon: ReactNode; view: AppView | null }[] = [
  { label: "파티 빌더", icon: <IconHexagon />, view: "party" },
  { label: "결정력 & 내구력", icon: <IconSwords />, view: "matchup" },
  { label: "배틀타워", icon: <IconScroll />, view: "battle-log" },
  { label: "포켓몬 도감", icon: <IconGrid />, view: "pokedex" },
  { label: "도구 도감", icon: <IconBag />, view: "itemdex" },
  { label: "기술표", icon: <IconList />, view: "movedex" },
];

interface SidebarProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
}

export function Sidebar({ activeView, onSelectView }: SidebarProps) {
  // hover만으로 펼침을 제어하면 클릭 후에도 마우스가 사이드바 위에 남아있는 동안 계속 펼쳐져 있으니,
  // 상태로 직접 제어해서 메뉴 클릭 시 즉시 접히게 한다.
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      className={`sidebar${expanded ? " is-expanded" : ""}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
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
            className={`sidebar-nav-item${item.view === activeView ? " is-active" : ""}`}
            disabled={item.view === null}
            onClick={() => {
              if (!item.view) return;
              onSelectView(item.view);
              setExpanded(false);
            }}
          >
            <span className="sidebar-nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="sidebar-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
