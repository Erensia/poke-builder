import { useMemo, useState } from "react";
import { POKEMON, getAbility, getMove } from "../lib/data";
import { TypeBadge } from "./TypeBadge";
import { TYPE_COLORS } from "../lib/typeColors";
import { STAT_LABELS, STAT_ORDER } from "../lib/statLabels";
import { megaBadgeLabel } from "../lib/pokemonForm";
import { getDefensiveProfile } from "../lib/typeEffectiveness";
import { POKEMON_TYPES, type PokemonType } from "../types/pokemon-type";
import type { Pokemon, MegaEvolution } from "../types/pokemon";
import type { BaseStats } from "../types/stats";
import "./PokedexPage.css";

/** 챔피언스 로스터 종족값 막대의 기준선. 실제 최고치(라이츄메가X/Y 585 등)보다 넉넉하게 잡아
 * 극단적으로 높은 스탯도 막대가 가득 차 보이지 않게 여유를 둔다. */
const STAT_BAR_MAX = 200;

function avatarGradient(types: Pokemon["types"]): string {
  return `linear-gradient(135deg, ${TYPE_COLORS[types[0]]}, ${TYPE_COLORS[types[1] ?? types[0]]})`;
}

function StatBars({ stats }: { stats: BaseStats }) {
  const total = STAT_ORDER.reduce((sum, stat) => sum + stats[stat], 0);
  return (
    <div className="pokedex-stat-bars">
      {STAT_ORDER.map((stat) => (
        <div className="pokedex-stat-row" key={stat}>
          <span className="pokedex-stat-label">{STAT_LABELS[stat]}</span>
          <div className="pokedex-stat-track">
            <div
              className="pokedex-stat-fill"
              style={{ width: `${Math.min(100, (stats[stat] / STAT_BAR_MAX) * 100)}%` }}
            />
          </div>
          <span className="pokedex-stat-value">{stats[stat]}</span>
        </div>
      ))}
      <div className="pokedex-stat-total">
        <span>총합</span>
        <strong>{total}</strong>
      </div>
    </div>
  );
}

/**
 * 방어 상성 타입 표기(Phase 6 §2-2, 사용자 1차 정리) — 이 포켓몬의 두 타입 조합이 각 공격
 * 타입에 대해 갖는 배율을 등배(×1)를 제외하고 약점부터 면역까지 그룹으로 묶어 보여준다.
 * lib/typeEffectiveness.ts의 getDefensiveProfile을 그대로 재사용(파티 빌더의 타입 상성 요약
 * 컴포넌트와 같은 하위 재료) — 메가진화 폼별 타입 변화는 이 섹션의 범위 밖(기본 폼 기준).
 */
function DefensiveProfile({ types }: { types: PokemonType[] }) {
  const profile = getDefensiveProfile(types);
  const groups: { label: string; className: string; types: PokemonType[] }[] = [
    { label: "4배 약점", className: "quad", types: [] },
    { label: "2배 약점", className: "weak", types: [] },
    { label: "½ 저항", className: "resist", types: [] },
    { label: "¼ 저항", className: "quadresist", types: [] },
    { label: "면역", className: "immune", types: [] },
  ];
  for (const type of POKEMON_TYPES) {
    const mult = profile[type];
    if (mult === 4) groups[0].types.push(type);
    else if (mult === 2) groups[1].types.push(type);
    else if (mult === 0.5) groups[2].types.push(type);
    else if (mult === 0.25) groups[3].types.push(type);
    else if (mult === 0) groups[4].types.push(type);
  }
  const nonEmpty = groups.filter((g) => g.types.length > 0);

  if (nonEmpty.length === 0) {
    return <p className="pokedex-defense-empty">모든 타입을 등배(×1)로 받습니다.</p>;
  }

  return (
    <div className="pokedex-defense-groups">
      {nonEmpty.map((g) => (
        <div className="pokedex-defense-row" key={g.label}>
          <span className={`pokedex-defense-label is-${g.className}`}>{g.label}</span>
          <span className="pokedex-defense-badges">
            {g.types.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function MegaBlock({ mega }: { mega: MegaEvolution }) {
  const ability = getAbility(mega.ability);
  return (
    <div className="pokedex-mega-block">
      <div className="pokedex-mega-head">
        <span className="pokedex-mega-tag">{megaBadgeLabel(mega)}</span>
        <span className="pokedex-mega-types">
          {mega.types.map((t) => (
            <TypeBadge key={t} type={t} />
          ))}
        </span>
      </div>
      <div className="pokedex-mega-ability">
        <span className="pokedex-meta-label">특성</span>
        <strong>{ability?.name ?? mega.ability}</strong>
        {ability?.description && <p className="pokedex-ability-desc">{ability.description}</p>}
      </div>
      <StatBars stats={mega.baseStats} />
    </div>
  );
}

function PokedexDetail({ pokemon, onSelectMove }: { pokemon: Pokemon; onSelectMove: (moveId: string) => void }) {
  const normalAbilities = pokemon.abilities
    .map((id) => getAbility(id))
    .filter((a): a is NonNullable<typeof a> => !!a);
  const hiddenAbility = pokemon.hiddenAbility ? getAbility(pokemon.hiddenAbility) : undefined;

  return (
    <div className="pokedex-detail">
      <div className="pokedex-detail-head">
        <span className="pokedex-detail-avatar" style={{ background: avatarGradient(pokemon.types) }}>
          {pokemon.name.at(0)}
        </span>
        <div>
          <h3>{pokemon.name}</h3>
          <div className="pokedex-detail-types">
            {pokemon.types.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
          </div>
        </div>
      </div>

      <section className="pokedex-detail-section">
        <h4>종족값</h4>
        <StatBars stats={pokemon.baseStats} />
      </section>

      <section className="pokedex-detail-section">
        <h4>방어 상성</h4>
        <DefensiveProfile types={pokemon.types} />
      </section>

      <section className="pokedex-detail-section">
        <h4>특성</h4>
        <ul className="pokedex-ability-list">
          {normalAbilities.map((a) => (
            <li key={a.id}>
              <strong>{a.name}</strong>
              <p className="pokedex-ability-desc">{a.description}</p>
            </li>
          ))}
          {hiddenAbility && (
            <li>
              <strong>
                {hiddenAbility.name}
                <span className="pokedex-hidden-tag">숨겨진 특성</span>
              </strong>
              <p className="pokedex-ability-desc">{hiddenAbility.description}</p>
            </li>
          )}
        </ul>
      </section>

      {pokemon.megaEvolutions && pokemon.megaEvolutions.length > 0 && (
        <section className="pokedex-detail-section">
          <h4>메가진화</h4>
          <div className="pokedex-mega-list">
            {pokemon.megaEvolutions.map((mega) => (
              <MegaBlock key={mega.form} mega={mega} />
            ))}
          </div>
        </section>
      )}

      <section className="pokedex-detail-section">
        <h4>
          기술 목록 <span className="pokedex-section-count">{pokemon.learnset.length}개</span>
        </h4>
        <div className="pokedex-learnset">
          {pokemon.learnset.map((moveId) => {
            const move = getMove(moveId);
            const color = move?.type ? TYPE_COLORS[move.type] : undefined;
            return (
              <button
                key={moveId}
                type="button"
                className="pokedex-move-chip"
                style={color ? { borderColor: color } : undefined}
                onClick={() => onSelectMove(moveId)}
              >
                {move?.name ?? moveId}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

interface PokedexPageProps {
  /** 기술 칩을 눌렀을 때 기술표 페이지로 넘어가는 콜백. App이 뷰 전환과 스크롤 대상 전달을 담당한다 */
  onSelectMove: (moveId: string) => void;
}

export function PokedexPage({ onSelectMove }: PokedexPageProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>(POKEMON[0]?.id ?? "");

  const filtered = useMemo(() => POKEMON.filter((p) => p.name.includes(query.trim())), [query]);

  // 검색으로 목록이 좁혀져서 선택된 포켓몬이 더는 안 보이면, 필터된 첫 항목으로 자연스럽게 넘어간다
  const selected = POKEMON.find((p) => p.id === selectedId) && filtered.some((p) => p.id === selectedId)
    ? POKEMON.find((p) => p.id === selectedId)
    : filtered[0];

  return (
    <section className="pokedex-page">
      <header className="pokedex-page-header">
        <h2>포켓몬 도감</h2>
        <p>로스터 {POKEMON.length}종의 타입·종족값·특성·메가진화·기술을 한눈에 확인합니다.</p>
      </header>

      <div className="pokedex-board">
        <div className="pokedex-list-panel">
          <input
            type="text"
            className="pokedex-search"
            placeholder="이름으로 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="pokedex-list">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`pokedex-list-item${p.id === selected?.id ? " is-active" : ""}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <span className="pokedex-list-avatar" style={{ background: avatarGradient(p.types) }}>
                    {p.name.at(0)}
                  </span>
                  <span className="pokedex-list-name">{p.name}</span>
                  {p.megaEvolutions && p.megaEvolutions.length > 0 && (
                    <span className="pokedex-list-mega">메가×{p.megaEvolutions.length}</span>
                  )}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="pokedex-list-empty">검색 결과가 없습니다.</li>}
          </ul>
        </div>

        <div className="pokedex-detail-panel">
          {selected ? (
            <PokedexDetail pokemon={selected} onSelectMove={onSelectMove} />
          ) : (
            <div className="pokedex-detail-empty">포켓몬을 선택하세요.</div>
          )}
        </div>
      </div>
    </section>
  );
}
