import { useEffect, useMemo, useRef, useState } from "react";
import { MOVES } from "../lib/data";
import { TypeBadge } from "./TypeBadge";
import { POKEMON_TYPES, type PokemonType } from "../types/pokemon-type";
import type { Move, MoveCategory } from "../types/move";
import "./MoveDexPage.css";

const CATEGORY_LABEL: Record<MoveCategory, string> = { physical: "물리", special: "특수", status: "변화" };
const CATEGORY_FILTERS: { label: string; value: MoveCategory | "all" }[] = [
  { label: "전체", value: "all" },
  { label: "물리", value: "physical" },
  { label: "특수", value: "special" },
  { label: "변화", value: "status" },
];

type SortKey = "name" | "type" | "category" | "priority" | "power" | "accuracy" | "pp";
type SortDir = "asc" | "desc";

/**
 * 정렬용 보조값. null(변화기 위력·필중기/자신대상 명중률 등)은 오름/내림차순 방향과 무관하게 항상
 * 맨 뒤로 보내야 해서, 정렬 비교 쪽(sorted useMemo)에서 null을 따로 걸러낸다 — 여기서 -1 같은
 * 임의의 숫자로 치환하면 방향에 따라 맨 앞/맨 뒤가 뒤바뀌는 버그가 생기므로 null을 그대로 반환한다.
 */
function sortValue(move: Move, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return move.name;
    case "type":
      return move.type ?? "";
    case "category":
      return move.category ?? "";
    case "priority":
      return move.priority;
    case "power":
      return move.power;
    case "accuracy":
      return move.accuracy;
    case "pp":
      return move.pp;
  }
}

interface MoveDexPageProps {
  /** 포켓몬 도감의 기술 칩을 눌러 넘어왔을 때, 그 기술로 스크롤 + 강조 표시한다 */
  initialMoveId?: string | null;
  /** initialMoveId를 1회 소비했음을 상위에 알려서, 이후 사이드바로 직접 들어왔을 때는 재적용되지 않게 한다 */
  onInitialMoveConsumed?: () => void;
}

export function MoveDexPage({ initialMoveId, onInitialMoveConsumed }: MoveDexPageProps) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<PokemonType | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<MoveCategory | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // 마운트 시점의 initialMoveId로 고정 — 페이지 전환마다 컴포넌트가 통째로 다시 마운트되므로
  // (App.tsx가 뷰를 조건부 렌더링) 이후 갱신은 필요 없다.
  const highlightedId = initialMoveId ?? null;
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const filtered = useMemo(() => {
    const q = query.trim();
    return MOVES.filter((m) => (q ? m.name.includes(q) : true))
      .filter((m) => (typeFilter === "all" ? true : m.type === typeFilter))
      .filter((m) => (categoryFilter === "all" ? true : m.category === categoryFilter));
  }, [query, typeFilter, categoryFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      // null(해당 없음)은 정렬 방향과 무관하게 항상 맨 뒤로
      if (av === null && bv === null) return a.name.localeCompare(b.name, "ko");
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.name.localeCompare(b.name, "ko");
    });
  }, [filtered, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // 도감에서 넘어온 초기 기술로 스크롤(강조 표시는 useState 초깃값에서 이미 처리됨).
  // 스크롤 대상 DOM을 읽는 시점이라 진짜 effect가 필요한 지점 — 한 번 스크롤하고 상위에 소비했음을 알린다.
  useEffect(() => {
    if (!initialMoveId) return;
    const el = rowRefs.current.get(initialMoveId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    onInitialMoveConsumed?.();
  }, [initialMoveId, onInitialMoveConsumed]);

  return (
    <section className="movedex-page">
      <header className="movedex-page-header">
        <h2>기술표</h2>
        <p>기술 {MOVES.length}개를 타입·분류·위력·우선도로 필터링하고 정렬합니다.</p>
      </header>

      <div className="movedex-controls">
        <input
          type="text"
          className="movedex-search"
          placeholder="기술 이름으로 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <select
          className="movedex-type-select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as PokemonType | "all")}
        >
          <option value="all">전체 타입</option>
          {POKEMON_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <div className="movedex-category-tabs">
          {CATEGORY_FILTERS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`movedex-category-tab${categoryFilter === c.value ? " is-active" : ""}`}
              onClick={() => setCategoryFilter(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="movedex-count">{sorted.length}개 표시 중</div>

      <div className="movedex-table">
        <div className="movedex-row movedex-head-row">
          <SortableHeader label="기술" sortKey="name" active={sortKey} dir={sortDir} onSort={handleSort} />
          <SortableHeader label="타입" sortKey="type" active={sortKey} dir={sortDir} onSort={handleSort} />
          <SortableHeader label="분류" sortKey="category" active={sortKey} dir={sortDir} onSort={handleSort} />
          <span className="movedex-cell movedex-cell-contact">접촉</span>
          <SortableHeader label="우선도" sortKey="priority" active={sortKey} dir={sortDir} onSort={handleSort} />
          <SortableHeader label="위력" sortKey="power" active={sortKey} dir={sortDir} onSort={handleSort} />
          <SortableHeader label="명중률" sortKey="accuracy" active={sortKey} dir={sortDir} onSort={handleSort} />
          <SortableHeader label="PP" sortKey="pp" active={sortKey} dir={sortDir} onSort={handleSort} />
        </div>

        <ul className="movedex-list">
          {sorted.map((m) => (
            <li
              key={m.id}
              id={`movedex-row-${m.id}`}
              ref={(el) => {
                if (el) rowRefs.current.set(m.id, el);
                else rowRefs.current.delete(m.id);
              }}
              className={`movedex-row${m.id === highlightedId ? " is-highlighted" : ""}`}
            >
              <div className="movedex-cell movedex-cell-name">
                <span className="movedex-name">{m.name}</span>
                {(() => {
                  // 연속 공격 태그(Phase 6 §2-2, 사용자 1차 정리) — minHits/maxHits가 있는 다단히트
                  // 기술만 "연속 N회"(고정)나 "연속 N~M회"(가변)로 표시. classification 배열과는
                  // 별개 축(특성 상호작용용이 아니라 순수 표시용)이라 데이터에 추가하지 않고 여기서
                  // 즉석으로 계산해 같은 줄에 붙인다.
                  const multiHitLabel =
                    m.minHits !== undefined && m.maxHits !== undefined
                      ? m.minHits === m.maxHits
                        ? `연속 ${m.minHits}회`
                        : `연속 ${m.minHits}~${m.maxHits}회`
                      : undefined;
                  const tags = [...(m.classification ?? []), ...(multiHitLabel ? [multiHitLabel] : [])];
                  return (
                    tags.length > 0 && <span className="movedex-classification">{tags.join(" · ")}</span>
                  );
                })()}
                {m.effect && <p className="movedex-effect">{m.effect}</p>}
              </div>
              <span className="movedex-cell">{m.type ? <TypeBadge type={m.type} /> : "—"}</span>
              <span className="movedex-cell movedex-cell-cat">{m.category ? CATEGORY_LABEL[m.category] : "—"}</span>
              <span className="movedex-cell movedex-cell-contact">
                {m.makesContact === undefined ? "—" : m.makesContact ? "접촉" : "비접촉"}
              </span>
              <span className={`movedex-cell movedex-cell-num${m.priority !== 0 ? " is-priority" : ""}`}>
                {m.priority > 0 ? `+${m.priority}` : m.priority}
              </span>
              <span className="movedex-cell movedex-cell-num">{m.power ?? "—"}</span>
              <span className="movedex-cell movedex-cell-num">{m.accuracy ? `${m.accuracy}%` : "—"}</span>
              <span className="movedex-cell movedex-cell-num">{m.pp}</span>
            </li>
          ))}
          {sorted.length === 0 && <li className="movedex-empty">검색 결과가 없습니다.</li>}
        </ul>
      </div>
    </section>
  );
}

function SortableHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = active === sortKey;
  return (
    <button
      type="button"
      className={`movedex-cell movedex-th${isActive ? " is-active" : ""}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {isActive && <span className="movedex-sort-arrow">{dir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}
