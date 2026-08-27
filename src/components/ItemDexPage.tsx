import { useMemo, useState } from "react";
import { ITEMS, POKEMON, getAbility } from "../lib/data";
import { TypeBadge } from "./TypeBadge";
import { megaBadgeLabel } from "../lib/pokemonForm";
import type { Item, ItemCategory } from "../types/item";
import type { MegaEvolution, Pokemon } from "../types/pokemon";
import "./ItemDexPage.css";

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  "mega-stone": "메가스톤",
  "held-item": "지닌 도구",
};

/** 메가스톤 데이터는 description이 비어있다(메가진화 자체가 설명이라 별도 문구가 없음) —
 * 어느 포켓몬의 어느 메가진화 폼과 연결되는지 로스터를 역탐색해서 대신 보여준다. */
function findMegaOwner(item: Item): { pokemon: Pokemon; mega: MegaEvolution } | undefined {
  if (item.category !== "mega-stone") return undefined;
  for (const pokemon of POKEMON) {
    const mega = pokemon.megaEvolutions?.find((m) => m.megaStone === item.id);
    if (mega) return { pokemon, mega };
  }
  return undefined;
}

function ItemDetail({ item }: { item: Item }) {
  const megaOwner = findMegaOwner(item);
  const ability = megaOwner ? getAbility(megaOwner.mega.ability) : undefined;

  return (
    <div className="itemdex-detail">
      <div className="itemdex-detail-head">
        <span className="itemdex-detail-avatar" aria-hidden="true">
          {item.name.at(0)}
        </span>
        <div>
          <h3>{item.name}</h3>
          <span className={`itemdex-category-badge is-${item.category}`}>
            {CATEGORY_LABELS[item.category]}
          </span>
        </div>
      </div>

      <section className="itemdex-detail-section">
        <h4>설명</h4>
        {item.description ? (
          <p className="itemdex-description">{item.description}</p>
        ) : megaOwner ? (
          <p className="itemdex-description">
            {megaOwner.pokemon.name}의 메가진화 전용 도구입니다.
          </p>
        ) : (
          <p className="itemdex-description itemdex-description-empty">등록된 설명이 없습니다.</p>
        )}
      </section>

      {megaOwner && (
        <section className="itemdex-detail-section">
          <h4>메가진화 정보</h4>
          <div className="itemdex-mega-block">
            <div className="itemdex-mega-head">
              <span className="itemdex-mega-pokemon">{megaOwner.pokemon.name}</span>
              <span className="itemdex-mega-tag">{megaBadgeLabel(megaOwner.mega)}</span>
              <span className="itemdex-mega-types">
                {megaOwner.mega.types.map((t) => (
                  <TypeBadge key={t} type={t} />
                ))}
              </span>
            </div>
            {ability && (
              <div className="itemdex-mega-ability">
                <span className="itemdex-meta-label">특성</span>
                <strong>{ability.name}</strong>
                {ability.description && <p className="itemdex-ability-desc">{ability.description}</p>}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export function ItemDexPage() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>(ITEMS[0]?.id ?? "");

  const filtered = useMemo(() => ITEMS.filter((i) => i.name.includes(query.trim())), [query]);

  // 검색으로 목록이 좁혀져서 선택된 도구가 더는 안 보이면, 필터된 첫 항목으로 자연스럽게 넘어간다
  // (포켓몬 도감 PokedexPage와 동일한 패턴).
  const selected = ITEMS.find((i) => i.id === selectedId) && filtered.some((i) => i.id === selectedId)
    ? ITEMS.find((i) => i.id === selectedId)
    : filtered[0];

  return (
    <section className="itemdex-page">
      <header className="itemdex-page-header">
        <h2>포켓몬 도구 도감</h2>
        <p>로스터 {ITEMS.length}종의 메가스톤·지닌 도구 효과를 한눈에 확인합니다.</p>
      </header>

      <div className="itemdex-board">
        <div className="itemdex-list-panel">
          <input
            type="text"
            className="itemdex-search"
            placeholder="이름으로 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="itemdex-list">
            {filtered.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  className={`itemdex-list-item${i.id === selected?.id ? " is-active" : ""}`}
                  onClick={() => setSelectedId(i.id)}
                >
                  <span className="itemdex-list-name">{i.name}</span>
                  {i.category === "mega-stone" && <span className="itemdex-list-mega">메가</span>}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="itemdex-list-empty">검색 결과가 없습니다.</li>}
          </ul>
        </div>

        <div className="itemdex-detail-panel">
          {selected ? <ItemDetail item={selected} /> : <div className="itemdex-detail-empty">도구를 선택하세요.</div>}
        </div>
      </div>
    </section>
  );
}
