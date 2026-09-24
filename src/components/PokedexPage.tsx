import { useMemo, useState } from "react";
import { POKEMON, getAbility, getMove } from "../lib/data";
import { TypeBadge } from "./TypeBadge";
import { PokemonAvatar } from "./PokemonAvatar";
import { TYPE_COLORS } from "../lib/typeColors";
import { STAT_LABELS, STAT_ORDER } from "../lib/statLabels";
import { megaBadgeLabel } from "../lib/pokemonForm";
import { getDefensiveProfile } from "../lib/typeEffectiveness";
import { compareDexOrder } from "../lib/dexOrder";
import { POKEMON_TYPES, type PokemonType } from "../types/pokemon-type";
import type { FormVariant, Pokemon, MegaEvolution } from "../types/pokemon";
import type { BaseStats } from "../types/stats";
import "./PokedexPage.css";

/** 챔피언스 로스터 종족값 막대의 기준선. 실제 최고치(라이츄메가X/Y 585 등)보다 넉넉하게 잡아
 * 극단적으로 높은 스탯도 막대가 가득 차 보이지 않게 여유를 둔다. */
const STAT_BAR_MAX = 200;

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

function MegaBlock({ pokemon, mega }: { pokemon: Pokemon; mega: MegaEvolution }) {
  const ability = getAbility(mega.ability);
  return (
    <div className="pokedex-mega-block">
      <div className="pokedex-mega-head">
        <PokemonAvatar
          pokemon={pokemon}
          form={{ activeMegaForm: mega.form }}
          gradientTypes={mega.types}
          size={40}
          radius="circle"
          className="pokedex-mega-avatar"
        />
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

/**
 * 폼 변종(루가루암·스트린더·에써르·대쓰여너·시비꼬, ver.1.8 트랙 K) 선택 칩. 고른 폼 기준으로
 * 상세 전체(아바타·타입·종족값·방어 상성·특성·기술 목록)가 바뀐다.
 */
function FormTabs({
  forms,
  selectedId,
  onSelect,
}: {
  forms: FormVariant[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="pokedex-form-tabs" role="tablist" aria-label="모습">
      {forms.map((f) => (
        <button
          key={f.id}
          type="button"
          role="tab"
          aria-selected={f.id === selectedId}
          className={`pokedex-form-tab${f.id === selectedId ? " is-active" : ""}`}
          onClick={() => onSelect(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function PokedexDetail({ pokemon, onSelectMove }: { pokemon: Pokemon; onSelectMove: (moveId: string) => void }) {
  // 폼 변종이 있으면 기준(standard) 폼부터 보여준다. 종이 바뀌면 부모가 key로 다시 마운트해 초기화된다.
  const forms = pokemon.formVariants;
  const [formId, setFormId] = useState(() => forms?.find((f) => f.standard)?.id ?? forms?.[0]?.id);
  const form = forms?.find((f) => f.id === formId);
  const types = form?.types ?? pokemon.types;
  const baseStats = form?.baseStats ?? pokemon.baseStats;
  const learnset = form?.learnset ?? pokemon.learnset;

  const normalAbilities = (form?.abilities ?? pokemon.abilities)
    .map((id) => getAbility(id))
    .filter((a): a is NonNullable<typeof a> => !!a);
  const hiddenAbilityId = form ? form.hiddenAbility : pokemon.hiddenAbility;
  const hiddenAbility = hiddenAbilityId ? getAbility(hiddenAbilityId) : undefined;
  // 냐오닉스처럼 성별로 숨겨진 특성이 갈리는 종은 둘 다 보여준다(수컷/암컷 라벨 포함).
  const genderedHidden = !form && pokemon.genderedHiddenAbility
    ? {
        male: getAbility(pokemon.genderedHiddenAbility.male),
        female: getAbility(pokemon.genderedHiddenAbility.female),
      }
    : undefined;

  return (
    <div className="pokedex-detail">
      <div className="pokedex-detail-head">
        <PokemonAvatar
          pokemon={pokemon}
          form={form ? { formVariant: form.id } : undefined}
          gradientTypes={types}
          size={56}
          radius="circle"
          className="pokedex-detail-avatar"
        />
        <div>
          <h3>{pokemon.name}</h3>
          <div className="pokedex-detail-types">
            {types.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
          </div>
        </div>
      </div>

      {forms && formId && <FormTabs forms={forms} selectedId={formId} onSelect={setFormId} />}

      <section className="pokedex-detail-section">
        <h4>종족값</h4>
        <StatBars stats={baseStats} />
        {pokemon.sizeForms && (
          <p className="pokedex-ability-desc">
            크기 변종(스피드·몸무게만 상이):{" "}
            {pokemon.sizeForms.map((f) => `${f.label} 스피드 ${f.spe}·${f.weightKg}kg`).join(" / ")}
          </p>
        )}
      </section>

      <section className="pokedex-detail-section">
        <h4>방어 상성</h4>
        <DefensiveProfile types={types} />
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
          {genderedHidden
            ? (["male", "female"] as const).map((g) => {
                const a = genderedHidden[g];
                return a ? (
                  <li key={g}>
                    <strong>
                      {a.name}
                      <span className="pokedex-hidden-tag">
                        숨겨진 특성 · {g === "female" ? "암컷" : "수컷"}
                      </span>
                    </strong>
                    <p className="pokedex-ability-desc">{a.description}</p>
                  </li>
                ) : null;
              })
            : hiddenAbility && (
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
              <MegaBlock key={mega.form} pokemon={pokemon} mega={mega} />
            ))}
          </div>
        </section>
      )}

      <section className="pokedex-detail-section">
        <h4>
          기술 목록 <span className="pokedex-section-count">{learnset.length}개</span>
        </h4>
        <div className="pokedex-learnset">
          {learnset.map((moveId) => {
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
  // 처음 들어왔을 땐 아무 것도 안 골랐다는 뜻으로 null — 첫 항목을 자동으로 보여주지 않는다.
  // 사용자가 리스트에서 뭔가 클릭해야 상세가 뜬다(도구 도감 ItemDexPage와 동일한 패턴).
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 목록 정렬은 전국도감 순서를 따른다(ver.1.3 §5) — 리전폼은 원종과 같은 번호라 원종 바로 뒤에
  // 자연스럽게 이어붙고(정렬 안정성엔 id 알파벳순 타이브레이크), 메가진화는 애초에 별도 항목이
  // 아니라 이 정렬 대상이 아니다.
  const filtered = useMemo(
    () =>
      POKEMON.filter((p) => p.name.includes(query.trim())).sort((a, b) => compareDexOrder(a.id, b.id)),
    [query],
  );

  // 검색으로 목록이 좁혀져서 선택된 포켓몬이 더는 안 보이면, 필터된 첫 항목으로 자연스럽게 넘어간다.
  // 단, 애초에 아무 것도 선택 안 한 상태(null)면 그 자동 넘어가기 대상에서 제외 — 계속 빈 상태로 둔다.
  const selectedFromId = selectedId ? POKEMON.find((p) => p.id === selectedId) : undefined;
  const selected =
    selectedId === null
      ? undefined
      : selectedFromId && filtered.some((p) => p.id === selectedId)
        ? selectedFromId
        : filtered[0];

  return (
    <section className="pokedex-page">
      <header className="pokedex-page-header">
        <h2>포켓몬 도감</h2>
        <p>로스터 {POKEMON.length}종의 타입·종족값·특성·메가진화·기술을 한눈에 확인합니다.</p>
      </header>

      <div className="pokedex-board">
        <div className="pokedex-list-panel">
          <ul className="pokedex-list">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`pokedex-list-item${p.id === selected?.id ? " is-active" : ""}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <PokemonAvatar pokemon={p} size={28} radius="circle" className="pokedex-list-avatar" />
                  <span className="pokedex-list-name">{p.name}</span>
                  {p.megaEvolutions && p.megaEvolutions.length > 0 && (
                    <span className="pokedex-list-mega">메가×{p.megaEvolutions.length}</span>
                  )}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="pokedex-list-empty">검색 결과가 없습니다.</li>}
          </ul>
          <input
            type="text"
            className="pokedex-search"
            placeholder="이름으로 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="pokedex-detail-panel">
          {selected ? (
            <PokedexDetail key={selected.id} pokemon={selected} onSelectMove={onSelectMove} />
          ) : (
            <div className="pokedex-detail-empty">포켓몬을 선택하세요.</div>
          )}
        </div>
      </div>
    </section>
  );
}
