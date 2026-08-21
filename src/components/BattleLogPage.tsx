import { useState } from "react";
import { BattleSetupCard } from "./BattleSetupCard";
import { WeatherPicker } from "./WeatherPicker";
import { PokemonPickerModal } from "./PokemonPickerModal";
import { MovePickerModal } from "./MovePickerModal";
import { AbilityPickerModal } from "./AbilityPickerModal";
import { ItemPickerModal } from "./ItemPickerModal";
import { NaturePickerModal } from "./NaturePickerModal";
import { PointsEditorModal } from "./PointsEditorModal";
import { useBattleSetup } from "../hooks/useBattleSetup";
import { getPokemon, getMove } from "../lib/data";
import { getEffectiveForm } from "../lib/pokemonForm";
import { TYPE_COLORS } from "../lib/typeColors";
import {
  createBattleState,
  hasUsableMove,
  opponentKey,
  runTurn,
  STRUGGLE_MOVE,
  type BattleState,
  type FighterKey,
  type TurnResult,
} from "../lib/battleSimulator";
import type { StatusCondition } from "../types/status";
import type { BaseStats } from "../types/stats";
import "./BattleLogPage.css";

type Side = "a" | "b";
type PickerState =
  | { kind: "pokemon"; side: Side }
  | { kind: "ability"; side: Side }
  | { kind: "item"; side: Side }
  | { kind: "nature"; side: Side }
  | { kind: "points"; side: Side }
  | { kind: "move"; side: Side; moveIndex: 0 | 1 | 2 | 3 }
  | null;

const STATUS_LABELS: Record<StatusCondition, string> = {
  burn: "화상",
  poison: "독",
  "badly-poisoned": "맹독",
  paralysis: "마비",
  freeze: "얼음",
  sleep: "잠듦",
};

const VOLATILE_LABELS = { flinch: "풀죽음", recharge: "반동", confusion: "혼란" } as const;

function fighterLabel(state: BattleState, key: FighterKey): string {
  const pokemon = getPokemon(state[key].slot.pokemonId);
  return pokemon?.name ?? key;
}

/**
 * 한글 이름 뒤에 붙일 "은/는" 조사를 마지막 글자의 받침 유무로 자동 판별한다.
 * 한글 음절이 아닌 문자(영문 등)로 끝나면 안전하게 "는"으로 처리한다.
 */
function eunNeun(name: string): "은" | "는" {
  const lastChar = name.at(-1);
  if (!lastChar) return "는";
  const code = lastChar.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "는";
  return code % 28 === 0 ? "는" : "은";
}

/** 대전 중 실능치 패널에 표시할 6개 스탯을 표 순서(HP·공격·방어·특공·특방·스피드)대로 나열 */
const REAL_STAT_LABELS: { key: keyof BaseStats; label: string }[] = [
  { key: "hp", label: "HP" },
  { key: "atk", label: "공격" },
  { key: "def", label: "방어" },
  { key: "spa", label: "특공" },
  { key: "spd", label: "특방" },
  { key: "spe", label: "스피드" },
];

export function BattleLogPage() {
  const setup = useBattleSetup();
  const [picker, setPicker] = useState<PickerState>(null);
  const [battleState, setBattleState] = useState<BattleState | null>(null);
  const [log, setLog] = useState<TurnResult[]>([]);
  const [selected, setSelected] = useState<{ a: string | null; b: string | null }>({ a: null, b: null });

  const sideOf = (side: Side) => (side === "a" ? setup.a : setup.b);
  const pokemonOf = (side: Side) => {
    const slot = sideOf(side).slot;
    return slot ? getPokemon(slot.pokemonId) : undefined;
  };

  const canStart =
    setup.a.slot !== null &&
    setup.b.slot !== null &&
    setup.a.slot.moves.some((m) => m !== null) &&
    setup.b.slot.moves.some((m) => m !== null);

  function startBattle() {
    if (!setup.a.slot || !setup.b.slot) return;
    const aMoves = setup.a.slot.moves.filter((id): id is string => id !== null).map((id) => getMove(id)!);
    const bMoves = setup.b.slot.moves.filter((id): id is string => id !== null).map((id) => getMove(id)!);
    const state = createBattleState(setup.a.slot, aMoves, setup.b.slot, bMoves, setup.weather ?? undefined);
    setBattleState(state);
    setLog([]);
    setSelected({ a: null, b: null });
  }

  function resetToSetup() {
    setBattleState(null);
    setLog([]);
    setSelected({ a: null, b: null });
  }

  function playTurn() {
    if (!battleState) return;
    // 남은 PP가 있는 기술이 하나도 없으면(4개 다 0) 선택 없이 발버둥을 자동으로 낸다.
    const aStruggling = !hasUsableMove(battleState.a);
    const bStruggling = !hasUsableMove(battleState.b);
    if ((!aStruggling && !selected.a) || (!bStruggling && !selected.b)) return;
    const moveA = aStruggling ? STRUGGLE_MOVE : getMove(selected.a!);
    const moveB = bStruggling ? STRUGGLE_MOVE : getMove(selected.b!);
    if (!moveA || !moveB) return;
    const { nextState, result } = runTurn(battleState, moveA, moveB);
    setBattleState(nextState);
    setLog((prev) => [...prev, result]);
    setSelected({ a: null, b: null });
  }

  const winner = log.at(-1)?.winner;

  return (
    <section className="battle-log-page">
      <header className="battle-log-header">
        <div>
          <h2>대전 로그</h2>
          <p>내 포켓몬과 상대 포켓몬을 편성하고, 매 턴 양쪽 기술을 직접 골라가며 여러 턴짜리 가상 대전을 진행해요.</p>
        </div>
        {!battleState && <WeatherPicker weather={setup.weather} onChange={setup.setWeather} />}
      </header>

      {!battleState && (
        <>
          <div className="battle-setup-board">
            <BattleSetupCard
              label="내 포켓몬"
              slot={setup.a.slot}
              onPickPokemon={() => setPicker({ kind: "pokemon", side: "a" })}
              onClearPokemon={setup.a.clearPokemon}
              onPickMove={(moveIndex) => setPicker({ kind: "move", side: "a", moveIndex })}
              onPickAbility={() => setPicker({ kind: "ability", side: "a" })}
              onPickItem={() => setPicker({ kind: "item", side: "a" })}
              onPickNature={() => setPicker({ kind: "nature", side: "a" })}
              onPickPoints={() => setPicker({ kind: "points", side: "a" })}
            />
            <BattleSetupCard
              label="상대 포켓몬"
              slot={setup.b.slot}
              onPickPokemon={() => setPicker({ kind: "pokemon", side: "b" })}
              onClearPokemon={setup.b.clearPokemon}
              onPickMove={(moveIndex) => setPicker({ kind: "move", side: "b", moveIndex })}
              onPickAbility={() => setPicker({ kind: "ability", side: "b" })}
              onPickItem={() => setPicker({ kind: "item", side: "b" })}
              onPickNature={() => setPicker({ kind: "nature", side: "b" })}
              onPickPoints={() => setPicker({ kind: "points", side: "b" })}
            />
          </div>
          <button type="button" className="battle-start-button" disabled={!canStart} onClick={startBattle}>
            대전 시작
          </button>
        </>
      )}

      {battleState && (
        <>
          <div className="battle-board">
            {(["a", "b"] as const).map((side) => {
              const fighter = battleState[side];
              const pokemon = getPokemon(fighter.slot.pokemonId);
              if (!pokemon) return null;
              // 셋업 카드와 동일하게 메가진화 여부를 반영해서 이름 옆에 배지를 그린다.
              // fighter.slot(EvaluatorSlot)은 FormSource를 만족하므로 getEffectiveForm을 그대로 쓸 수 있다.
              const form = getEffectiveForm(pokemon, fighter.slot);
              const hpPercent = Math.max(0, Math.min(100, (fighter.currentHp / fighter.maxHp) * 100));
              // battleState 안의 slot은 EvaluatorSlot(moves 필드 없음)이라, 4개 기술 목록은
              // 셋업 단계에서 쓴 PartySlot(setup.a/b.slot)에서 그대로 가져온다 — 배틀 중엔 안 바뀜
              const moveIds: (string | null)[] = sideOf(side).slot?.moves ?? [];
              const moves = moveIds
                .filter((id): id is string => id !== null)
                .map((id) => getMove(id))
                .filter((m): m is NonNullable<typeof m> => m !== undefined);

              return (
                <div key={side} className={`battle-fighter battle-fighter-${side}`}>
                  <div className="battle-fighter-head">
                    <span className="battle-fighter-name">
                      {pokemon.name}
                      {form.mega && <span className="battle-fighter-mega-tag">메가</span>}
                      {fighter.currentHp <= 0 && <span className="battle-fighter-fainted"> (기절)</span>}
                    </span>
                    <div className="battle-status-tags">
                      {fighter.status.condition && (
                        <span className="battle-status-tag is-major">{STATUS_LABELS[fighter.status.condition]}</span>
                      )}
                      {(Object.keys(fighter.volatile.active) as (keyof typeof VOLATILE_LABELS)[]).map((v) => (
                        <span key={v} className="battle-status-tag is-volatile">
                          {VOLATILE_LABELS[v]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="battle-hp-bar">
                    <div
                      className={`battle-hp-fill${hpPercent <= 20 ? " is-danger" : hpPercent <= 50 ? " is-warn" : ""}`}
                      style={{ width: `${hpPercent}%` }}
                    />
                  </div>
                  <div className="battle-hp-numbers">
                    {fighter.currentHp} / {fighter.maxHp}
                  </div>

                  {/* 대전 중엔 셋업 카드가 안 보여서 내가 맞춘 능력치를 확인할 방법이 없었다는 피드백 반영 —
                      HP·공격·방어·특공·특방·스피드 실능치를 배틀 보드에도 그대로 노출한다 */}
                  <div className="battle-real-stats">
                    {REAL_STAT_LABELS.map(({ key, label }) => (
                      <div key={key} className="battle-real-stat-item">
                        <span className="battle-real-stat-label">{label}</span>
                        <span className="battle-real-stat-value">{Math.round(fighter.realStats[key])}</span>
                      </div>
                    ))}
                  </div>

                  {hasUsableMove(fighter) ? (
                    <div className="battle-move-grid">
                      {moves.map((move) => {
                        const pp = fighter.remainingPp[move.id] ?? move.pp;
                        const disabled = pp <= 0 || fighter.currentHp <= 0 || !!winner;
                        // 셋업 카드의 party-move-pip와 동일하게 기술 타입 배경색을 입힌다.
                        const moveColor = move.type ? TYPE_COLORS[move.type] : undefined;
                        return (
                          <button
                            key={move.id}
                            type="button"
                            className={`battle-move-button${moveColor ? " has-type" : ""}${
                              selected[side] === move.id ? " is-selected" : ""
                            }`}
                            style={moveColor ? { background: moveColor } : undefined}
                            disabled={disabled}
                            onClick={() => setSelected((prev) => ({ ...prev, [side]: move.id }))}
                          >
                            <span className="battle-move-name">{move.name}</span>
                            <span className="battle-move-pp">
                              {pp}/{move.pp}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    // 4개 기술 PP가 전부 0 — 선택할 게 없으니 발버둥이 자동으로 나간다는 걸 알려준다
                    <div className="battle-struggle-notice">사용 가능한 기술이 없어요 — 발버둥이 자동으로 나갑니다!</div>
                  )}
                </div>
              );
            })}
          </div>

          {winner ? (
            <div className={`battle-result-banner${winner === "draw" ? " is-draw" : ""}`}>
              {winner === "draw" ? "🤝 무승부! 양쪽 다 기절했어요" : `🏆 ${fighterLabel(battleState, winner)} 승리!`}
              <button type="button" className="battle-reset-button" onClick={resetToSetup}>
                다시 설정하기
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="battle-start-button"
              disabled={
                (hasUsableMove(battleState.a) && !selected.a) || (hasUsableMove(battleState.b) && !selected.b)
              }
              onClick={playTurn}
            >
              턴 진행
            </button>
          )}

          <div className="battle-turn-log">
            {[...log].reverse().map((turn) => (
              <div key={turn.turnNumber} className="battle-turn-card">
                <div className="battle-turn-title">
                  턴 {turn.turnNumber} · 먼저 행동: {fighterLabel(battleState, turn.order[0])}
                </div>
                {turn.actions.map((action, i) => {
                  const actorName = fighterLabel(battleState, action.actor);
                  const defenderName = fighterLabel(battleState, opponentKey(action.actor));
                  return (
                    <div key={i}>
                      {/* 메인 라인: 누가 무슨 기술을 써서 어떻게 됐는지("빗나감"/데미지 수치)까지만.
                          기절 같은 "상태"는 아래에서 별도 줄로 분리한다. */}
                      <div className="battle-turn-line">
                        <strong>{actorName}</strong>의 {action.move.name}
                        {action.blockedReason === "status" && " — 상태이상으로 행동 불가"}
                        {action.blockedReason === "flinch" && " — 풀죽어서 행동 불가"}
                        {action.blockedReason === "recharge" && " — 반동으로 행동 불가"}
                        {action.blockedReason === "confusion" &&
                          ` — 혼란으로 자멸! (${action.selfDamage} 데미지)`}
                        {!action.blockedReason && !action.hit && " — 빗나감"}
                        {!action.blockedReason && action.hit && action.damage > 0 && (
                          <>
                            {" "}
                            — {action.critical && "급소! "}
                            {action.damage} 데미지 ({(action.damagePercent * 100).toFixed(1)}%)
                          </>
                        )}
                        {!action.blockedReason && action.hit && action.inflictedStatus && (
                          <> · {STATUS_LABELS[action.inflictedStatus]} 상태!</>
                        )}
                        {!action.blockedReason && action.hit && action.inflictedVolatile && (
                          <> · {VOLATILE_LABELS[action.inflictedVolatile]}!</>
                        )}
                      </div>
                      {/* 발버둥 반동은 상대 데미지와 별개의 수치라 자기 줄로 분리 */}
                      {!action.blockedReason && action.move.id === STRUGGLE_MOVE.id && action.selfDamage > 0 && (
                        <div className="battle-turn-line is-muted">
                          {actorName}
                          {eunNeun(actorName)} 반동으로 {action.selfDamage} 데미지를 입었다
                        </div>
                      )}
                      {/* 상대가 쓰러졌는지 여부 — 데미지 수치와 분리된 별도 상태 줄 */}
                      {!action.blockedReason && action.fainted && (
                        <div className="battle-turn-line is-fainted">
                          {defenderName}
                          {eunNeun(defenderName)} 쓰러졌다
                        </div>
                      )}
                      {/* 자신이 쓰러졌는지 여부(자폭류·발버둥 반동·혼란 자멸) — 원인이 된 기술명을 그대로 붙인다 */}
                      {action.selfFainted && (
                        <div className="battle-turn-line is-fainted">
                          {actorName}
                          {eunNeun(actorName)}{" "}
                          {action.blockedReason === "confusion" ? "혼란으로 인한 데미지" : `${action.move.name}의 여파`}로
                          쓰러졌다
                        </div>
                      )}
                    </div>
                  );
                })}
                {turn.endOfTurn.map((e, i) => (
                  <div key={i} className="battle-turn-line is-muted">
                    {fighterLabel(battleState, e.actor)} 상태이상 데미지 {e.damage} (남은 HP {e.remainingHp})
                    {e.fainted && " · 기절!"}
                  </div>
                ))}
                {turn.winner && (
                  <div className="battle-turn-line is-winner">
                    {turn.winner === "draw"
                      ? "🤝 무승부! 양쪽 다 기절했어요"
                      : `🏆 ${fighterLabel(battleState, turn.winner)} 승리!`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {picker?.kind === "pokemon" && (
        <PokemonPickerModal
          onClose={() => setPicker(null)}
          onSelect={(pokemonId) => {
            sideOf(picker.side).setPokemon(pokemonId);
            setPicker(null);
          }}
        />
      )}

      {picker?.kind === "ability" &&
        (() => {
          const pokemon = pokemonOf(picker.side);
          if (!pokemon) return null;
          return (
            <AbilityPickerModal
              pokemon={pokemon}
              currentAbilityId={sideOf(picker.side).slot?.ability ?? null}
              onClose={() => setPicker(null)}
              onSelect={(abilityId) => {
                sideOf(picker.side).setAbility(abilityId);
                setPicker(null);
              }}
              onClear={() => {
                sideOf(picker.side).setAbility(null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "item" &&
        (() => {
          const pokemon = pokemonOf(picker.side);
          if (!pokemon) return null;
          return (
            <ItemPickerModal
              pokemon={pokemon}
              currentItemId={sideOf(picker.side).slot?.item ?? null}
              onClose={() => setPicker(null)}
              onSelect={(itemId) => {
                sideOf(picker.side).setItem(itemId);
                setPicker(null);
              }}
              onClear={() => {
                sideOf(picker.side).setItem(null);
                setPicker(null);
              }}
            />
          );
        })()}

      {picker?.kind === "nature" && (
        <NaturePickerModal
          currentNatureId={sideOf(picker.side).slot?.nature ?? null}
          onClose={() => setPicker(null)}
          onSelect={(natureId) => {
            sideOf(picker.side).setNature(natureId);
            setPicker(null);
          }}
          onClear={() => {
            sideOf(picker.side).setNature(null);
            setPicker(null);
          }}
        />
      )}

      {picker?.kind === "points" &&
        (() => {
          const side = picker.side;
          const pokemon = pokemonOf(side);
          const slotState = sideOf(side);
          if (!pokemon || !slotState.slot) return null;
          const form = getEffectiveForm(pokemon, slotState.slot);
          return (
            <PointsEditorModal
              pokemonName={pokemon.name}
              baseStats={form.baseStats}
              points={slotState.slot.points}
              natureId={slotState.slot.nature}
              onClose={() => setPicker(null)}
              onChange={(stat, value) => slotState.setPoint(stat, value)}
              onStep={(stat, delta) => slotState.stepPoint(stat, delta)}
            />
          );
        })()}

      {picker?.kind === "move" &&
        (() => {
          const pokemon = pokemonOf(picker.side);
          const slotState = sideOf(picker.side);
          if (!pokemon || !slotState.slot) return null;
          return (
            <MovePickerModal
              pokemon={pokemon}
              currentMoveIds={slotState.slot.moves}
              onClose={() => setPicker(null)}
              onSelect={(moveId) => {
                slotState.setMove(picker.moveIndex, moveId);
                setPicker(null);
              }}
              onClear={() => {
                slotState.setMove(picker.moveIndex, null);
                setPicker(null);
              }}
            />
          );
        })()}
    </section>
  );
}
