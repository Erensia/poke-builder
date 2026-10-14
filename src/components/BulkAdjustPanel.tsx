import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { environmentTintBackground } from "../lib/environmentBackground";
import { getAbility, getMove, getPokemon } from "../lib/data";
import { bulkOptions, survivalAt } from "../lib/bulkAdjust";
import { damageRollSet } from "../lib/damageFormula";
import { evaluateSlotMatchup } from "../lib/matchupEvaluator";
import { getEffectiveForm } from "../lib/pokemonForm";
import { computeRealStats } from "../lib/statCalculator";
import { burnDamageMultiplier, ignoresBurnAttackPenalty, statusedAttackBoost } from "../lib/statusConditions";
import type { MatchupSlot } from "../types/matchup";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import "./SpeedTablePanel.css";

interface BulkAdjustPanelProps {
  /** 내 포켓몬 — 포인트를 조정하는 쪽(방어) */
  slot: MatchupSlot;
  /** 상대 포켓몬 — 고른 기술(slot.moveId)로 때리는 가정 공격자 */
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
const SCREENS = [
  { value: "", label: "없음" },
  { value: "reflect", label: "리플렉터" },
  { value: "lightScreen", label: "빛의장막" },
  { value: "auroraVeil", label: "오로라베일" },
] as const;

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

/** 내 포켓몬이 상대의 기술을 버티는 최소 HP·방어(특방) 포인트 조합 — 스피드 조정 탭처럼 왼쪽 카드, 오른쪽 결과 */
export function BulkAdjustPanel({ slot, opponent, weather, field, myCard, opponentCard }: BulkAdjustPanelProps) {
  const [target, setTarget] = useState(1);
  const [screen, setScreen] = useState<MatchupSlot["screen"] | "">("");
  const [critical, setCritical] = useState(false);
  const mine = slot.pokemonId ? getPokemon(slot.pokemonId) : undefined;
  const theirs = opponent.pokemonId ? getPokemon(opponent.pokemonId) : undefined;
  const move = opponent.moveId ? getMove(opponent.moveId) : undefined;

  const parts = useMemo(() => {
    if (!mine || !theirs || !move) return null;
    const status = opponent.statusAssumed ?? null;
    return (
      evaluateSlotMatchup({ ...opponent, pokemonId: theirs.id }, move, { ...slot, pokemonId: mine.id }, {
        weather: weather ?? undefined,
        field: field ?? undefined,
        multiHitCount: opponent.multiHitCount,
        attackerStages: opponent.stages,
        defenderStages: slot.stages,
        screen: screen || undefined,
        critical,
        attackerStatus: status,
        defenderStatus: slot.statusAssumed ?? null,
        defenderHasStatusCondition: !!slot.statusAssumed,
        defenderHpIsFull: slot.fullHpAssumed ?? true,
        extraOffenseMultiplier: statusedAttackBoost(status, move.category, opponent.ability ? getAbility(opponent.ability)?.physicalAttackMultiplierWhenStatused : undefined),
        finalOffenseMultiplier: burnDamageMultiplier(status, move.category, ignoresBurnAttackPenalty(opponent.ability ?? undefined, move.id)),
      })?.damageParts ?? null
    );
  }, [mine, theirs, move, slot, opponent, weather, field, screen, critical]);

  const base = mine ? getEffectiveForm(mine, slot).baseStats : null;
  const options = useMemo(() => (parts && base ? bulkOptions(parts, base, slot.nature, slot.points, target) : null), [parts, base, slot.nature, slot.points, target]);
  const now = useMemo(() => {
    if (!parts || !base) return null;
    const real = computeRealStats(base, slot.points, slot.nature);
    return { survival: survivalAt(damageRollSet(parts, real[parts.defenseKey]), real.hp), total: slot.points.hp + slot.points[parts.defenseKey] };
  }, [parts, base, slot.points, slot.nature]);

  const hint = !mine ? "내 포켓몬을 골라 주세요" : !theirs ? "상대 포켓몬을 골라 주세요" : !move ? "상대 기술을 골라 주세요" : !parts ? "이 기술은 계산할 수 없어요 (변화기·위력 없음·상성 무효)" : null;

  return (
    <div className="speedtab-board">
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
          <Pips label="벽" options={SCREENS} value={screen ?? ""} onChange={setScreen} />
          <Pips label="급소" options={[{ value: true, label: "있음" }]} value={critical} onChange={(v) => setCritical(!critical && v)} />
        </div>
        {hint && <p className="speedtab-note">{hint}</p>}
        {options && now && parts && (
          <>
            <p className="speedtab-summary">
              지금 HP {slot.points.hp}pt · {parts.defenseKey === "def" ? "방어" : "특방"} {slot.points[parts.defenseKey]}pt (합 {now.total}) → 버틸 확률 <strong>{pct(now.survival)}</strong>
            </p>
            {options.length === 0 ? (
              <p className="speedtab-note">HP·{parts.defenseKey === "def" ? "방어" : "특방"}을 32pt씩 줘도 이 조건으로는 못 버텨요.</p>
            ) : (
              <table className="speedtab-table">
                <thead>
                  <tr>
                    <th>합계</th>
                    <th>HP</th>
                    <th>{parts.defenseKey === "def" ? "방어" : "특방"}</th>
                    <th>버틸 확률</th>
                  </tr>
                </thead>
                <tbody>
                  {options.map((o) => (
                    <tr key={o.hpPoints}>
                      <th>{o.hpPoints + o.defPoints}pt</th>
                      <td>
                        {o.hpPoints}pt<small>{o.maxHp}{o.mark ? ` · ${o.mark}` : ""}</small>
                      </td>
                      <td>
                        {o.defPoints}pt<small>{o.stat}</small>
                      </td>
                      <td className={o.hpPoints <= slot.points.hp && o.defPoints <= slot.points[parts.defenseKey] ? "is-pass" : ""}>{pct(o.survival)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="speedtab-note">생존 목표는 같은 기술의 16단계 난수 중 버티는 비율이에요. HP를 올릴수록 방어를 덜 줘도 되는 조합만 보여줘요(합계가 적은 순). 성격·나머지 포인트·도구·특성은 지금 선택 그대로예요. 강조 = 지금 포인트로 이미 버팀.</p>
          </>
        )}
      </div>
    </div>
  );
}
