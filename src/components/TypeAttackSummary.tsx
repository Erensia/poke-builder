import { useState } from "react";
import type { PartySlots } from "../types/party";
import type { MoveCategory } from "../types/move";
import { computePartyAttackMatrix, formTag, type MoveCount } from "../lib/partyAnalysis";
import { TypeBadge } from "./TypeBadge";
import { Fold } from "./Fold";
import { PillRow } from "./PillRow";
import "./TypeCoverageSummary.css";
import "./TypeAttackSummary.css";

interface TypeAttackSummaryProps {
  slots: PartySlots;
}

const CATEGORIES: { key: MoveCategory; short: string; label: string }[] = [
  { key: "physical", short: "물", label: "물리" },
  { key: "special", short: "특", label: "특수" },
  { key: "status", short: "변", label: "변화" },
];

/** 못 찌르는 방어 타입 조합을 이만큼만 보여 주고 나머지는 "외 N개" */
const UNCOVERED_SHOWN = 12;

type CoverMode = "single" | "combo";

/** 분류별 기술 개수 칩 — 0개인 분류는 그리지 않는다 */
function MoveChips({ count }: { count: MoveCount }) {
  return (
    <>
      {CATEGORIES.map(
        (c) =>
          count[c.key] > 0 && (
            <span key={c.key} className={`atk atk-${c.key}`} title={`${c.label} ${count[c.key]}개`}>
              {c.short}
              {count[c.key]}
            </span>
          ),
      )}
    </>
  );
}

/**
 * 타입 상성표(공격) — 현재 파티의 기술을 타입별로 물리·특수·변화 개수로 센 표(7.6 T3)와,
 * 파티가 약점을 찌를 수 있는 방어 타입 커버 범위(T4, 7.7에서 이중 타입 조합 기준 추가). 방어 표(TypeCoverageSummary)와 같은 모양, 기본은 접힘.
 */
export function TypeAttackSummary({ slots }: TypeAttackSummaryProps) {
  const [mode, setMode] = useState<CoverMode>("single");
  const { members, rows, memberTotals, single, combo } = computePartyAttackMatrix(slots);
  const cov = mode === "single" ? single : combo;
  const covered = cov.total - cov.uncovered.length;

  return (
    <section className="type-coverage type-attack">
      <Fold title="타입 상성표(공격)" defaultOpen={false} storageKey="champions-party-sim.fold.type-attack.v1">
        <header className="type-coverage-header">
          <p>
            빌드한 포켓몬의 기술을 타입별로 센 표입니다. <span className="atk atk-physical">물</span>리 ·{" "}
            <span className="atk atk-special">특</span>수 · <span className="atk atk-status">변</span>화 기술 개수이고, 마지막 열
            <b> 합계</b>는 파티 전체입니다. 기술 타입은 특성(스킨류 등)과 종(레이징불)으로 바뀐 뒤의 타입이고, 날씨에 따라 바뀌는
            기술(웨더볼 등)은 기본 타입으로 셉니다. <b>약점 커버</b>는 물리·특수 기술이 방어 타입을 ×2 이상으로 찌를 수 있는 타입
            수입니다.
          </p>
        </header>

        {members.length === 0 ? (
          <p className="type-coverage-empty">포켓몬을 배치하면 공격 기술 요약이 표시됩니다.</p>
        ) : (
          <>
            <div className="type-matrix-scroll">
              <table className="type-matrix">
                <thead>
                  <tr>
                    <th className="tm-corner" aria-hidden="true" />
                    {members.map((m) => (
                      <th key={m.pokemonId} className="tm-mon" title={m.formLabel ? `${m.name} (${m.formLabel})` : m.name}>
                        <span className="tm-mon-name">{m.name}</span>
                        {m.formLabel && <span className="tm-mon-form">{formTag(m.formLabel)}</span>}
                      </th>
                    ))}
                    <th className="tm-verdict-head">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.type}>
                      <th className="tm-type" scope="row" title={`${row.type}타입 기술`}>
                        <TypeBadge type={row.type} />
                      </th>
                      {row.cells.map((cell, i) => (
                        <td key={members[i].pokemonId} className="tm-cell">
                          <MoveChips count={cell} />
                        </td>
                      ))}
                      <td className="tm-verdict">
                        <MoveChips count={row.total} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th className="tm-type tm-foot-label" scope="row">
                      공격 기술
                    </th>
                    {memberTotals.map((t, i) => (
                      <td key={members[i].pokemonId} className="tm-foot-count">
                        {t.damage}
                      </td>
                    ))}
                    <td className="tm-foot-count tm-verdict">{memberTotals.reduce((n, t) => n + t.damage, 0)}</td>
                  </tr>
                  <tr>
                    <th className="tm-type tm-foot-label" scope="row">
                      변화 기술
                    </th>
                    {memberTotals.map((t, i) => (
                      <td key={members[i].pokemonId} className="tm-foot-count">
                        {t.status}
                      </td>
                    ))}
                    <td className="tm-foot-count tm-verdict">{memberTotals.reduce((n, t) => n + t.status, 0)}</td>
                  </tr>
                  <tr>
                    <th className="tm-type tm-foot-label" scope="row">
                      약점 커버
                    </th>
                    {cov.perMember.map((n, i) => (
                      <td key={members[i].pokemonId} className="tm-foot-count" title={`${members[i].name}의 기술이 약점을 찌르는 방어 타입 ${n}개`}>
                        {n}
                      </td>
                    ))}
                    <td className="tm-foot-count tm-verdict" title="파티 전체">
                      {covered}/{cov.total}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <PillRow<CoverMode>
              label="약점 커버 기준"
              ariaLabel="약점 커버 기준"
              options={[
                { value: "single", label: `단일 타입 ${single.total}` },
                { value: "combo", label: `실제 타입 조합 ${combo.total}` },
              ]}
              value={mode}
              onChange={setMode}
            />
            <p className="atk-cover">
              파티 전체 약점 커버 <strong>{covered}/{cov.total}</strong>
              {cov.uncovered.length === 0 ? (
                " — 모두 찌를 수 있어요."
              ) : (
                <>
                  {" "}· 못 찌르는 {mode === "single" ? "타입" : "조합"}{" "}
                  {cov.uncovered.slice(0, UNCOVERED_SHOWN).map((types) => (
                    <span key={types.join("/")} className="atk-combo">
                      {types.map((t) => (
                        <TypeBadge key={t} type={t} />
                      ))}
                    </span>
                  ))}
                  {cov.uncovered.length > UNCOVERED_SHOWN && ` 외 ${cov.uncovered.length - UNCOVERED_SHOWN}개`}
                </>
              )}
            </p>
            {mode === "combo" && (
              <p className="atk-cover-note">실제 타입 조합은 이 앱의 포켓몬 데이터(종·메가폼·폼 변종)에 있는 단일·이중 타입 조합입니다.</p>
            )}
          </>
        )}
      </Fold>
    </section>
  );
}
