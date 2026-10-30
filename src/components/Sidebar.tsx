import { useEffect, useRef, useState, type ReactNode } from "react";
import { SyncDot } from "./SyncDot";
import "./Sidebar.css";

export type AppView = "party" | "matchup" | "battle-log" | "rank-battle" | "pokedex" | "movedex" | "itemdex";

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

function IconTrophy() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
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

/** 하단 탭의 "도감" 탭 아이콘 */
function IconBook() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

/** short: 하단 탭 라벨(좁은 폭용). dex: 모바일 하단 탭에서 "도감" 시트 하나로 묶는 항목 */
const NAV_ITEMS: { label: string; short?: string; icon: ReactNode; view: AppView; dex?: boolean }[] = [
  { label: "파티 샘플 작성", short: "파티", icon: <IconHexagon />, view: "party" },
  { label: "계산 기능", short: "계산", icon: <IconSwords />, view: "matchup" },
  { label: "배틀타워", icon: <IconScroll />, view: "battle-log" },
  { label: "랭크배틀", icon: <IconTrophy />, view: "rank-battle" },
  { label: "포켓몬 도감", icon: <IconGrid />, view: "pokedex", dex: true },
  { label: "도구 도감", icon: <IconBag />, view: "itemdex", dex: true },
  { label: "기술표", icon: <IconList />, view: "movedex", dex: true },
];
const MAIN_ITEMS = NAV_ITEMS.filter((item) => !item.dex);
const DEX_ITEMS = NAV_ITEMS.filter((item) => item.dex);

interface SidebarProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
}

/**
 * 모바일(≤760px) 하단 탭. 메뉴가 7개라 하단 탭 권장 상한(5개)을 넘으므로 도감류 3개는 "도감" 탭이 여는 시트로 묶는다.
 * 시트는 Esc·바깥 탭으로 닫히고, 열면 첫 항목에 포커스가 가며 닫히면 "도감" 탭으로 돌아온다.
 */
function BottomNav({ activeView, onSelectView }: SidebarProps) {
  const [dexOpen, setDexOpen] = useState(false);
  const dexRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dexOpen) return;
    const tab = dexRef.current;
    sheetRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDexOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      tab?.focus();
    };
  }, [dexOpen]);

  return (
    <>
      {dexOpen && <div className="bottom-sheet-backdrop" onClick={() => setDexOpen(false)} aria-hidden="true" />}
      {dexOpen && (
        <div ref={sheetRef} className="bottom-sheet" role="group" aria-label="도감 메뉴">
          {DEX_ITEMS.map((item) => (
            <button
              key={item.view}
              type="button"
              className={`bottom-sheet-item${item.view === activeView ? " is-active" : ""}`}
              aria-current={item.view === activeView ? "page" : undefined}
              onClick={() => {
                onSelectView(item.view);
                setDexOpen(false);
              }}
            >
              <span className="bottom-sheet-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
      <nav className="bottom-nav" aria-label="주요 메뉴">
        {MAIN_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            className={`bottom-nav-item${item.view === activeView ? " is-active" : ""}`}
            aria-current={item.view === activeView ? "page" : undefined}
            onClick={() => {
              onSelectView(item.view);
              setDexOpen(false);
            }}
          >
            <span className="bottom-nav-icon" aria-hidden="true">
              {item.icon}
              {item.view === "party" && <SyncDot />}
            </span>
            <span className="bottom-nav-label">{item.short ?? item.label}</span>
          </button>
        ))}
        <button
          ref={dexRef}
          type="button"
          className={`bottom-nav-item${DEX_ITEMS.some((item) => item.view === activeView) ? " is-active" : ""}`}
          aria-haspopup="true"
          aria-expanded={dexOpen}
          onClick={() => setDexOpen((v) => !v)}
        >
          <span className="bottom-nav-icon" aria-hidden="true">
            <IconBook />
          </span>
          <span className="bottom-nav-label">도감</span>
        </button>
      </nav>
    </>
  );
}

export function Sidebar({ activeView, onSelectView }: SidebarProps) {
  // hover만으로 펼침을 제어하면 클릭 후에도 마우스가 사이드바 위에 남아있는 동안 계속 펼쳐져 있으니,
  // 상태로 직접 제어해서 메뉴 클릭 시 즉시 접히게 한다. (데스크톱 전용 — 모바일에선 하단 탭이 대신한다)
  const [expanded, setExpanded] = useState(false);

  return (
    <>
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
              onClick={() => {
                onSelectView(item.view);
                setExpanded(false);
              }}
            >
              <span className="sidebar-nav-icon" aria-hidden="true">
                {item.icon}
                {item.view === "party" && <SyncDot />}
              </span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <BottomNav activeView={activeView} onSelectView={onSelectView} />
    </>
  );
}
