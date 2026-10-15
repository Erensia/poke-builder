import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { environmentTintBackground } from "../lib/environmentBackground";
import { getAbility, getMove, getPokemon } from "../lib/data";
import { bulkMovesOf, bulkOptions, bulkSurvival } from "../lib/bulkAdjust";
import type { DamageParts } from "../lib/damageFormula";
import { evaluateSlotMatchup } from "../lib/matchupEvaluator";
import { getEffectiveForm } from "../lib/pokemonForm";
import { burnDamageMultiplier, ignoresBurnAttackPenalty, statusedAttackBoost } from "../lib/statusConditions";
import type { MatchupSlot } from "../types/matchup";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import "./SpeedTablePanel.css";

interface BulkAdjustPanelProps {
  /** 내 포켓몬 — 포인트를 조정하는 쪽(방어) */
  slot: MatchupSlot;
  /** 상대 포켓몬 — 고른 기술들(slot.bulkMoves)로 때리는 가정 공격자 */
  opponent: MatchupSlot;
  weather: WeatherKind | null;
  field: FieldKind | null;
  myCard: ReactNode;
  opponentCard: ReactNode;
}

const TARGETS = [
  { value: 1, label: "확정" },
  { value: 0.9, label: "90%" },
  { value: 0.75, label: "75%" },
  { value: 0.5, label: "50%" },
];

const pct = (p: number) => `${p >= 1 ? 100 : Math.floor(p * 1000) / 10}%`;

/** 다른 카드의 토글(순풍·타수)과 같은 알약 버튼 줄 */
function Pips<T extends string | number | boolean>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="matchup-assume-grave">
      <span className="matchup-assume-grave-label">{label}</span>
      <div className="matchup-hitcount-row">
        {options.map((o) => (
          <button key={String(o.value)} type="button" className={`matchup-hitcount-pip${o.value === value ? " is-active" : ""}`} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 내 포켓몬이 상대의 기술(최대 3개)을 모두 맞고도 버티는 최소 HP·방어·특방 포인트 조합 — 스피드 조정 탭처럼 왼쪽 카드, 오른쪽 결과 */
export function BulkAdjustPanel({ slot, opponent, weather, field, myCard, opponentCard }: BulkAdjustPanelProps) {
  const [target, setTarget] = useState(1);
  const [critical, setCritical] = useState(false);
  const mine = slot.pokemonId ? getPokemon(slot.pokemonId) : undefined;
  const theirs = opponent.pokemonId ? getPokemon(opponent.pokemonId) : undefined;
  const moveSlots = bulkMovesOf(opponent);

  // 기술마다 데미지 조각을 구한다. 가정(HP 비율·후공·피격 등)은 상대 카드 값을 모든 기술에 같이 쓴다 — 결정력 탭의 assumeOptions와 같은 규칙
  const { partsList, skipped } = useMemo(() => {
    const list: DamageParts[] = [];
    const skippedNames: string[] = [];
    if (!mine || !theirs) return { partsList: list, skipped: skippedNames };
    const status = opponent.statusAssumed ?? null;
    for (const m of bulkMovesOf(opponent)) {
      const move = m ? getMove(m.moveId) : undefined;
      if (!m || !move) continue;
      const parts = evaluateSlotMatchup({ ...opponent, pokemonId: theirs.id }, move, { ...slot, pokemonId: mine.id }, {
        weather: weather ?? undefined,
        field: field ?? undefined,
        multiHitCount: m.hits,
        attackerStages: opponent.stages,
        defenderStages: slot.stages,
        screen: slot.screen,
        critical,
        attackerStatus: status,
        defenderStatus: slot.statusAssumed ?? null,
        defenderHasStatusCondition: !!slot.statusAssumed,
        defenderHpIsFull: slot.fullHpAssumed ?? true,
        attackerHpFraction: (opponent.hpPercent ?? 100) / 100,
        abilityHpFraction: opponent.pinchAssumed ? 1 / 3 : 1,
        attackerMovesLast: !!opponent.movesLastAssumed,
        attackerTookDamageThisTurn: !!opponent.tookDamageAssumed,
        attackerMoveFailedLastTurn: !!opponent.moveFailedAssumed,
        attackerStatLoweredThisTurn: !!opponent.statLoweredAssumed,
        defenderDamagedThisTurn: !!opponent.targetDamagedAssumed,
        defenderMinimized: !!opponent.targetMinimizedAssumed,
        attackerTypeToMoveType: !!opponent.typeShiftAssumed,
        extraOffenseMultiplier: statusedAttackBoost(status, move.category, opponent.ability ? getAbility(opponent.ability)?.physicalAttackMultiplierWhenStatused : undefined),
        finalOffenseMultiplier: burnDamageMultiplier(status, move.category, ignoresBurnAttackPenalty(opponent.ability ?? undefined, move.id)),
      })?.damageParts;
      if (parts) list.push(parts);
      else skippedNames.push(move.name);
    }
    return { partsList: list, skipped: skippedNames };
  }, [mine, theirs, slot, opponent, weather, field, critical]);

  const usesDef = partsList.some((p) => p.defenseKey === "def");
  const usesSpd = partsList.some((p) => p.defenseKey === "spd");
  const base = mine ? getEffectiveForm(mine, slot).baseStats : null;
  const options = useMemo(() => (partsList.length > 0 && base ? bulkOptions(partsList, base, slot.nature, slot.points, target) : null), [partsList, base, slot.nature, slot.points, target]);
  const now = useMemo(() => {
    if (partsList.length === 0 || !base) return null;
    return { survival: bulkSurvival(partsList, base, slot.nature, slot.points), total: slot.points.hp + (usesDef ? slot.points.def : 0) + (usesSpd ? slot.points.spd : 0) };
  }, [partsList, base, slot.points, slot.nature, usesDef, usesSpd]);

  const picked = moveSlots.some(Boolean);
  const hint = !mine ? "내 포켓몬을 골라 주세요" : !theirs ? "상대 포켓몬을 골라 주세요" : !picked ? "상대 기술을 골라 주세요" : partsList.length === 0 ? "고른 기술은 계산할 수 없어요 (변화기·위력 없음·상성 무효)" : null;

  return (
    <div className="speedtab-board bulktab-board">
      <div className="speedtab-side">
        <div className="speedtab-card" style={{ "--env-tint": environmentTintBackground(weather, field) } as CSSProperties}>
          {myCard}
        </div>
        <div className="speedtab-card" style={{ "--env-tint": environmentTintBackground(weather, field) } as CSSProperties}>
          {opponentCard}
        </div>
      </div>
      <div className="speedtab-result">
        <div className="bulktab-controls">
          <Pips label="생존 목표" options={TARGETS} value={target} onChange={setTarget} />
          <Pips label="급소" options={[{ value: true, label: "있음" }]} value={critical} onChange={(v) => setCritical(!critical && v)} />
        </div>
        {hint && <p className="speedtab-note">{hint}</p>}
        {skipped.length > 0 && !hint && <p className="speedtab-note">계산할 수 없어 뺀 기술: {skipped.join(", ")}</p>}
        {options && now && (
          <>
            <p className="speedtab-summary">
              지금 HP {slot.points.hp}pt{usesDef && ` · 방어 ${slot.points.def}pt`}
              {usesSpd && ` · 특방 ${slot.points.spd}pt`} (합 {now.total}) → 모두 버틸 확률 <strong>{pct(now.survival)}</strong>
            </p>
            {options.length === 0 ? (
              <p className="speedtab-note">HP·방어·특방을 32pt씩 줘도 이 조건으로는 못 버텨요.</p>
            ) : (
              <table className="speedtab-table">
                <thead>
                  <tr>
                    <th>합계</th>
                    <th>HP</th>
                    {usesDef && <th>방어</th>}
                    {usesSpd && <th>특방</th>}
                    <th>버틸 확률</th>
                  </tr>
                </thead>
                <tbody>
                  {options.map((o) => (
                    <tr key={o.hpPoints}>
                      <th>{o.hpPoints + o.defPoints + o.spdPoints}pt</th>
                      <td>
                        {o.hpPoints}pt
                        <small>
                          {o.maxHp}
                          {o.mark ? ` · ${o.mark}` : ""}
                        </small>
                      </td>
                      {usesDef && (
                        <td>
                          {o.defPoints}pt<small>{o.defStat}</small>
                        </td>
                      )}
                      {usesSpd && (
                        <td>
                          {o.spdPoints}pt<small>{o.spdStat}</small>
                        </td>
                      )}
                      <td className={o.hpPoints <= slot.points.hp && (!usesDef || o.defPoints <= slot.points.def) && (!usesSpd || o.spdPoints <= slot.points.spd) ? "is-pass" : ""}>{pct(o.survival)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="speedtab-note">
              생존 목표는 고른 기술들의 16단계 난수 조합 중 모두 맞고도 버티는 비율이에요. HP를 올릴수록 방어·특방을 덜 줘도 되는 조합만 보여줘요(세 포인트 합이 적은 순). 가정(HP 비율·후공 등)은 상대 카드 값을 모든 기술에 같이 써요.
              성격·나머지 포인트·도구·특성은 지금 선택 그대로예요. 강조 = 지금 포인트로 이미 버팀.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
