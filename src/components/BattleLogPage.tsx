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
import { getEffectiveForm, megaBadgeLabel } from "../lib/pokemonForm";
import { TYPE_COLORS, typeColorRgba } from "../lib/typeColors";
import { WEATHER_ACCENT_TYPE } from "../lib/weatherEffects";
import { FIELD_DISPLAY_TYPE } from "../lib/fieldEffects";
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

const VOLATILE_LABELS = {
  flinch: "풀죽음",
  recharge: "반동",
  confusion: "혼란",
  drowsy: "졸음",
  wish: "희망사항",
  ingrain: "뿌리박기",
  aquaRing: "아쿠아링",
  leechSeed: "씨앗",
} as const;

/** 액션 로그 한 줄 안에 "OO 발동!"으로 뭉뚱그리기보다 전용 문구를 따로 쓰는 volatile들 */
const VOLATILES_WITH_DEDICATED_LOG_LINE = new Set(["drowsy", "wish"]);

const SCREEN_LABELS = { reflect: "리플렉터", lightScreen: "빛의장막" } as const;

/**
 * 날씨/필드가 적용 중인지 배경색으로 알 수 있게 해달라는 요청 반영 — 날씨는 강화하는 타입 색(비=물,
 * 모래바람=바위, 눈=얼음, 쾌청=불꽃), 필드는 필드 자신의 타입 색(그래스=풀 등)을 낮은 불투명도로 섞는다.
 * 둘 다 있으면 좌우 그라데이션으로, 하나만 있으면 단색 틴트로, 둘 다 없으면 기본(투명) 배경.
 */
function battleBoardBackground(state: BattleState): string | undefined {
  const weatherColor = state.weather ? TYPE_COLORS[WEATHER_ACCENT_TYPE[state.weather]] : undefined;
  const fieldColor = state.field ? TYPE_COLORS[FIELD_DISPLAY_TYPE[state.field]] : undefined;

  if (weatherColor && fieldColor) {
    return `linear-gradient(135deg, ${typeColorRgba(weatherColor, 0.16)}, ${typeColorRgba(fieldColor, 0.16)})`;
  }
  if (weatherColor) return typeColorRgba(weatherColor, 0.14);
  if (fieldColor) return typeColorRgba(fieldColor, 0.14);
  return undefined;
}

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

/** "카리열매로"/"먹다남은음식으로"처럼 자음 받침 유무에 따라 "로"/"으로" 조사를 자동 판별한다 */
function roEuro(name: string): "로" | "으로" {
  const lastChar = name.at(-1);
  if (!lastChar) return "로";
  const code = lastChar.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "로";
  return code % 28 === 0 ? "로" : "으로";
}

/**
 * 상태이상 3단계 문구(사용자 확정 텍스트): 걸렸을 때(onset) → 매턴 효과가 발동했을 때(trigger,
 * 독/맹독/화상은 데미지 틱, 마비/잠듦/얼음은 이번 턴 행동이 막혔다는 뜻) → 해제됐을 때(cure).
 * "의"/"을" 같은 상태이상 이름 쪽 조사는 고정이라 그대로 박아뒀고, 포켓몬 이름 쪽만 eunNeun으로 판별한다.
 */
const STATUS_ONSET_TEXT: Record<StatusCondition, (name: string) => string> = {
  poison: (name) => `${name}의 몸에 독이 퍼졌다!`,
  "badly-poisoned": (name) => `${name}의 몸에 맹독이 퍼졌다!`,
  burn: (name) => `${name}${eunNeun(name)} 화상을 입었다!`,
  paralysis: (name) => `${name}${eunNeun(name)} 마비되어 기술이 나오기 어려워졌다!`,
  sleep: (name) => `${name}${eunNeun(name)} 잠들어 버렸다!`,
  freeze: (name) => `${name}${eunNeun(name)} 얼어붙었다!`,
};

const STATUS_TRIGGER_TEXT: Record<StatusCondition, (name: string) => string> = {
  poison: (name) => `${name}${eunNeun(name)} 독에 의한 데미지를 입었다!`,
  "badly-poisoned": (name) => `${name}${eunNeun(name)} 맹독에 의한 데미지를 입었다!`,
  burn: (name) => `${name}${eunNeun(name)} 화상 데미지를 입었다!`,
  paralysis: (name) => `${name}${eunNeun(name)} 몸이 저려서 움직일 수 없다!`,
  sleep: (name) => `${name}${eunNeun(name)} 쿨쿨 잠들어 있다.`,
  freeze: (name) => `${name}${eunNeun(name)} 얼어 버려서 움직일 수 없다!`,
};

const STATUS_CURE_TEXT: Record<StatusCondition, (name: string) => string> = {
  poison: (name) => `${name}의 독이 나았다!`,
  "badly-poisoned": (name) => `${name}의 맹독이 나았다!`,
  burn: (name) => `${name}의 화상이 나았다!`,
  paralysis: (name) => `${name}의 몸저림이 풀렸다!`,
  sleep: (name) => `${name}의 눈을 떴다!`,
  freeze: (name) => `${name}의 얼음이 녹았다!`,
};

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
    // 공중날기 등 차지 기술 2턴째는 준비해둔 기술이 선택 여부와 무관하게 자동으로 나가므로
    // 이 턴엔 수동 선택을 요구하지 않는다 — resolveAction이 어차피 이 값을 무시하고 강제한다.
    const aCharging = battleState.a.chargingMoveId !== undefined;
    const bCharging = battleState.b.chargingMoveId !== undefined;
    if ((!aStruggling && !aCharging && !selected.a) || (!bStruggling && !bCharging && !selected.b)) return;
    const moveA = aStruggling ? STRUGGLE_MOVE : aCharging ? getMove(battleState.a.chargingMoveId!) : getMove(selected.a!);
    const moveB = bStruggling ? STRUGGLE_MOVE : bCharging ? getMove(battleState.b.chargingMoveId!) : getMove(selected.b!);
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
          <div className="battle-board" style={{ background: battleBoardBackground(battleState) }}>
            {(battleState.weather || battleState.field || battleState.trickRoomTurnsRemaining !== undefined) && (
              <div className="battle-environment-tags">
                {battleState.weather && (
                  <span className="battle-environment-tag">
                    날씨: {battleState.weather} (앞으로 {battleState.weatherTurnsRemaining}턴)
                  </span>
                )}
                {battleState.field && (
                  <span className="battle-environment-tag">
                    필드: {battleState.field} (앞으로 {battleState.fieldTurnsRemaining}턴)
                  </span>
                )}
                {battleState.trickRoomTurnsRemaining !== undefined && (
                  <span className="battle-environment-tag">
                    트릭룸 (앞으로 {battleState.trickRoomTurnsRemaining}턴)
                  </span>
                )}
              </div>
            )}
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
                      {form.mega && <span className="battle-fighter-mega-tag">{megaBadgeLabel(form.mega)}</span>}
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
                      {(Object.keys(fighter.screens) as ("reflect" | "lightScreen")[])
                        .filter((s) => fighter.screens[s] !== undefined)
                        .map((s) => (
                          <span key={s} className="battle-status-tag is-volatile">
                            {SCREEN_LABELS[s]} {fighter.screens[s]}턴
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

                  {fighter.chargingMoveId ? (
                    // 공중날기 등 차지 기술 1턴째를 막 썼다 — 다음 턴 이 기술이 선택 없이 자동으로 나간다
                    <div className="battle-struggle-notice">
                      {getMove(fighter.chargingMoveId)?.name ?? "기술"} 준비 중 — 다음 턴 자동으로 발동돼요!
                    </div>
                  ) : hasUsableMove(fighter) ? (
                    <div className="battle-move-grid">
                      {moves.map((move) => {
                        const pp = fighter.remainingPp[move.id] ?? move.pp;
                        // 실제 배틀에서도 조건을 안 채웠다고 기술 자체를 못 내는 건 아니고, 내봤자
                        // 실패하는 것뿐이다(사용자 확인) — 코골기(잠든 상태 전용)·속이기(첫 턴 전용)
                        // 둘 다 조건 불충족이어도 버튼은 그대로 선택 가능하게 두고, resolveAction이
                        // "usageCondition"으로 실패 처리하는 걸 로그에서 그대로 보여준다.
                        const sleepConditionUnmet = move.usageCondition === "sleep-only" && fighter.status.condition !== "sleep";
                        const firstTurnConditionUnmet =
                          move.usageCondition === "first-turn-only" && battleState.turnNumber !== 0;
                        const fieldConditionUnmet = move.usageCondition === "field-required" && !battleState.field;
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
                            title={
                              sleepConditionUnmet
                                ? "잠든 상태에서만 사용 가능 — 지금 쓰면 실패해요"
                                : firstTurnConditionUnmet
                                  ? "등장 후 첫 턴에만 사용 가능 — 지금 쓰면 실패해요"
                                  : fieldConditionUnmet
                                    ? "필드가 있을 때만 사용 가능 — 지금 쓰면 실패해요"
                                    : undefined
                            }
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

          {battleState.entryAnnouncements.length > 0 && (
            <div className="battle-entry-announcements">
              {battleState.entryAnnouncements.map((text, i) => (
                <div key={i}>{text}</div>
              ))}
            </div>
          )}

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
                (hasUsableMove(battleState.a) && battleState.a.chargingMoveId === undefined && !selected.a) ||
                (hasUsableMove(battleState.b) && battleState.b.chargingMoveId === undefined && !selected.b)
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
                        {action.blockedReason === "usageCondition" && "!"}
                        {action.blockedReason === "status" && action.blockedByStatus === undefined && " — 상태이상으로 행동 불가"}
                        {action.blockedReason === "flinch" && " — 풀죽어서 행동 불가"}
                        {action.blockedReason === "recharge" && " — 반동으로 행동 불가"}
                        {action.blockedReason === "confusion" &&
                          ` — 혼란으로 자멸! (${action.selfDamage} 데미지)`}
                        {action.blockedReason === "psychicFieldPriority" && " — 사이코필드에 막혀 실패"}
                        {!action.blockedReason && action.charging && " — 준비 중! 다음 턴 발동된다"}
                        {!action.blockedReason && !action.charging && action.evadedByCharge && " — 무적 상태라 빗나감"}
                        {!action.blockedReason && !action.charging && !action.evadedByCharge && !action.hit && " — 빗나감"}
                        {!action.blockedReason && action.hit && action.damage > 0 && (
                          <>
                            {" "}
                            {/* 다단히트가 아닐 때만 "급소!"를 단일 판정으로 표시 — 다단히트는
                                타수마다 급소를 따로 판정해서 "하나라도 급소"라는 뜻이 다르므로
                                뒤의 "(급소 포함)" 표기로 대신한다 */}
                            — {action.hitCount === undefined && action.critical && "급소! "}
                            {action.damage} 데미지 ({(action.damagePercent * 100).toFixed(1)}%)
                            {action.hitCount !== undefined && (
                              <> · {action.hitCount}타 명중{action.critical && " (급소 포함)"}</>
                            )}
                          </>
                        )}
                        {!action.blockedReason &&
                          action.hit &&
                          action.inflictedVolatile &&
                          !VOLATILES_WITH_DEDICATED_LOG_LINE.has(action.inflictedVolatile) && (
                            <> · {VOLATILE_LABELS[action.inflictedVolatile]}!</>
                          )}
                        {!action.blockedReason && action.hit && action.inflictedVolatile === "wish" && (
                          <> · 희망사항 발동 준비!</>
                        )}
                        {!action.blockedReason && action.hit && action.setField && (
                          <> · {action.setField} 설치!</>
                        )}
                        {!action.blockedReason && action.hit && action.fieldSetFailed && (
                          <> · 이미 필드가 있어 실패!</>
                        )}
                        {!action.blockedReason && action.hit && action.destroyedField && (
                          <> · {action.destroyedField} 파괴!</>
                        )}
                        {!action.blockedReason && action.hit && action.setTrickRoom && (
                          <> · 트릭룸 발동!</>
                        )}
                        {!action.blockedReason && action.hit && action.trickRoomSetFailed && (
                          <> · 이미 트릭룸이 있어 실패!</>
                        )}
                        {!action.blockedReason && action.hit && action.setWeather && (
                          <>
                            {" "}
                            · 날씨가 {action.setWeather}
                            {roEuro(action.setWeather)} 바뀌었다!
                          </>
                        )}
                        {!action.blockedReason && action.hit && action.setScreen && (
                          <> · {SCREEN_LABELS[action.setScreen]} 설치!</>
                        )}
                        {!action.blockedReason && action.hit && action.screenSetFailed && (
                          <> · 이미 {SCREEN_LABELS[action.move.setsScreen!]}이(가) 있어 실패!</>
                        )}
                        {!action.blockedReason && action.hit && !!action.healedAmount && (
                          <>
                            {" "}
                            · {action.healedTarget === "opponent" ? defenderName : actorName}
                            {roEuro(action.healedTarget === "opponent" ? defenderName : actorName)} 체력을{" "}
                            {action.healedAmount} 회복했다!
                          </>
                        )}
                        {!action.blockedReason && action.hit && action.restSlept && <> · 잠들었다!</>}
                        {!action.blockedReason && action.hit && !!action.drainHealAmount && (
                          <> · 체력을 {action.drainHealAmount} 흡수했다!</>
                        )}
                        {!action.blockedReason && action.hit && action.setRegenVolatile && (
                          <> · {VOLATILE_LABELS[action.setRegenVolatile]} 발동!</>
                        )}
                        {!action.blockedReason && action.hit && action.regenSetFailed && (
                          <> · 이미 걸려있어 실패!</>
                        )}
                        {!action.blockedReason && action.hit && action.setLeechSeed && (
                          <> · 씨앗을 심었다!</>
                        )}
                        {!action.blockedReason && action.hit && action.leechSeedSetFailed && (
                          <> · 이미 씨앗이 심어져 있어 실패!</>
                        )}
                      </div>
                      {/* 마비/잠듦/얼음으로 이번 턴 행동이 막혔으면(단순 "상태이상으로 행동 불가"가
                          아니라) 매턴 효과가 발동한 것과 같은 의미라 트리거 문구를 그대로 쓴다 */}
                      {action.blockedReason === "status" && action.blockedByStatus && (
                        <div className="battle-turn-line is-muted">
                          {STATUS_TRIGGER_TEXT[action.blockedByStatus](actorName)}
                        </div>
                      )}
                      {/* 속이기(첫 턴 전용)처럼 사용 조건을 못 채워 실패했을 때 — 메인 줄은
                          "OO의 속이기!"로만 끝내고, 실패 여부는 이 별도 줄로 알려준다 */}
                      {action.blockedReason === "usageCondition" && (
                        <div className="battle-turn-line is-muted">
                          {actorName}의 {action.move.name}{eunNeun(action.move.name)} 실패했다!
                        </div>
                      )}
                      {/* 상태이상에 새로 걸렸을 때(onset) — 항상 상대가 대상(기존 관례) */}
                      {!action.blockedReason && action.hit && action.inflictedStatus && (
                        <div className="battle-turn-line is-muted">
                          {STATUS_ONSET_TEXT[action.inflictedStatus](defenderName)}
                        </div>
                      )}
                      {/* 하품(졸음) 유도 — 실제로 잠드는 건 2턴 뒤라 onset 문구와 다르게 "유도했다"로 표현 */}
                      {!action.blockedReason && action.hit && action.inflictedVolatile === "drowsy" && (
                        <div className="battle-turn-line is-muted">상대 {defenderName}의 졸음을 유도했다!</div>
                      )}
                      {/* 상태이상이 나았을 때(cure) — curedStatusTarget으로 자신/상대 구분 */}
                      {!action.blockedReason && action.hit && action.curedStatus && (
                        <div className="battle-turn-line is-muted">
                          {STATUS_CURE_TEXT[action.curedStatus](
                            action.curedStatusTarget === "self" ? actorName : defenderName,
                          )}
                        </div>
                      )}
                      {/* 발버둥 반동은 상대 데미지와 별개의 수치라 자기 줄로 분리 */}
                      {!action.blockedReason && action.move.id === STRUGGLE_MOVE.id && action.selfDamage > 0 && (
                        <div className="battle-turn-line is-muted">
                          {actorName}
                          {eunNeun(actorName)} 반동으로 {action.selfDamage} 데미지를 입었다
                        </div>
                      )}
                      {/* 불꽃세례·웨이브태클 등 recoilFraction 기술의 반동. 발버둥과 계산 기준이
                          달라 별도 필드(recoilDamage)로 표시한다 */}
                      {!action.blockedReason && action.recoilDamage > 0 && (
                        <div className="battle-turn-line is-muted">
                          {actorName}
                          {eunNeun(actorName)} 반동으로 {action.recoilDamage} 데미지를 입었다
                        </div>
                      )}
                      {/* 생명의구슬처럼 도구가 주는 반동 — 데미지 기준 반동(recoilDamage)과 달리
                          최대 HP 비율 고정이라 별도 필드(itemRecoilDamage)로 표시한다 */}
                      {!action.blockedReason && !!action.itemRecoilDamage && (
                        <div className="battle-turn-line is-muted">
                          {actorName}
                          {eunNeun(actorName)} {action.itemRecoilItemName}의 반동으로 {action.itemRecoilDamage} 데미지를 입었다
                        </div>
                      )}
                      {/* 나무열매(카리열매 등)로 이번 피격 데미지가 반감됐으면 알려준다 */}
                      {!action.blockedReason && action.berryReducedDamageItemName && (
                        <div className="battle-turn-line is-muted">
                          {defenderName}의 {action.berryReducedDamageItemName}
                          {roEuro(action.berryReducedDamageItemName)} 데미지가 절반으로 줄었다!
                        </div>
                      )}
                      {/* 조개껍질방울 — 흡수기(drainHealAmount)와 별개 축이라 따로 표시 */}
                      {!action.blockedReason && !!action.shellBellHealAmount && (
                        <div className="battle-turn-line is-muted">
                          {actorName}의 조개껍질방울로 체력을 {action.shellBellHealAmount} 회복했다!
                        </div>
                      )}
                      {/* 과사열매 — PP 0이 된 기술을 즉시 복구 */}
                      {!action.blockedReason && action.leppaRestoredPpItemName && (
                        <div className="battle-turn-line is-muted">
                          {actorName}의 {action.leppaRestoredPpItemName}
                          {roEuro(action.leppaRestoredPpItemName)} {action.move.name}의 PP를 회복시켰다!
                        </div>
                      )}
                      {/* 상태이상/혼란 즉시치료 나무열매 — curedStatus 문구와 별개로 "어떤 도구가 발동했는지"만 알려준다 */}
                      {!action.blockedReason && action.statusCureBerryItemName && (
                        <div className="battle-turn-line is-muted">
                          {action.statusCureBerryItemName}이(가) 발동했다!
                        </div>
                      )}
                      {/* 자뭉열매/오랭열매 — 공격자/방어자 중 발동한 쪽만 표시 */}
                      {!action.blockedReason && !!action.attackerBerryHealAmount && (
                        <div className="battle-turn-line is-muted">
                          {actorName}의 {action.attackerBerryHealItemName}
                          {roEuro(action.attackerBerryHealItemName ?? "")} 체력을 {action.attackerBerryHealAmount} 회복했다!
                        </div>
                      )}
                      {!action.blockedReason && !!action.defenderBerryHealAmount && (
                        <div className="battle-turn-line is-muted">
                          {defenderName}의 {action.defenderBerryHealItemName}
                          {roEuro(action.defenderBerryHealItemName ?? "")} 체력을 {action.defenderBerryHealAmount} 회복했다!
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
                    {e.fieldHeal ? (
                      <>
                        {fighterLabel(battleState, e.actor)} 그래스필드로 {e.fieldHeal} 회복 (남은 HP {e.remainingHp})
                      </>
                    ) : e.itemHeal ? (
                      <>
                        {fighterLabel(battleState, e.actor)}의 {e.itemHealItemName}로 {e.itemHeal} 회복 (남은 HP{" "}
                        {e.remainingHp})
                      </>
                    ) : e.regenHeal ? (
                      <>
                        {fighterLabel(battleState, e.actor)}
                        {e.regenSource && VOLATILE_LABELS[e.regenSource]}로 {e.regenHeal} 회복 (남은 HP {e.remainingHp})
                      </>
                    ) : e.leechSeedDamage ? (
                      <>
                        {fighterLabel(battleState, e.actor)}의 씨앗이 체력을 {e.leechSeedDamage} 흡수했다 (남은 HP{" "}
                        {e.remainingHp})
                        {e.fainted && " · 기절!"}
                      </>
                    ) : e.leechSeedHealAmount ? (
                      <>
                        {fighterLabel(battleState, e.actor)}가 씨앗으로 체력을 {e.leechSeedHealAmount} 회복 (남은 HP{" "}
                        {e.remainingHp})
                      </>
                    ) : e.wishHeal ? (
                      <>
                        {fighterLabel(battleState, e.actor)}의 희망사항으로 체력을 {e.wishHeal} 회복 (남은 HP{" "}
                        {e.remainingHp})
                      </>
                    ) : e.berryHeal ? (
                      <>
                        {fighterLabel(battleState, e.actor)}의 {e.berryHealItemName}로 {e.berryHeal} 회복 (남은 HP{" "}
                        {e.remainingHp})
                      </>
                    ) : e.inflictedDelayedStatus ? (
                      STATUS_ONSET_TEXT[e.inflictedDelayedStatus](fighterLabel(battleState, e.actor))
                    ) : e.statusCondition ? (
                      <>
                        {STATUS_TRIGGER_TEXT[e.statusCondition](fighterLabel(battleState, e.actor))} (남은 HP{" "}
                        {e.remainingHp})
                        {e.fainted && " · 기절!"}
                      </>
                    ) : (
                      <>
                        {fighterLabel(battleState, e.actor)} 상태이상 데미지 {e.damage} (남은 HP {e.remainingHp})
                        {e.fainted && " · 기절!"}
                      </>
                    )}
                  </div>
                ))}
                {turn.field && (
                  <div className="battle-turn-line is-muted">
                    필드: {turn.field} (앞으로 {turn.fieldTurnsRemaining}턴 뒤 소멸)
                  </div>
                )}
                {turn.fieldExpired && (
                  <div className="battle-turn-line is-muted">필드가 사라졌다!</div>
                )}
                {turn.trickRoomTurnsRemaining !== undefined && (
                  <div className="battle-turn-line is-muted">
                    트릭룸: 앞으로 {turn.trickRoomTurnsRemaining}턴 뒤 해제
                  </div>
                )}
                {turn.trickRoomExpired && (
                  <div className="battle-turn-line is-muted">트릭룸이 해제됐다!</div>
                )}
                {turn.weatherTurnsRemaining !== undefined && (
                  <div className="battle-turn-line is-muted">
                    날씨: 앞으로 {turn.weatherTurnsRemaining}턴 뒤 소멸
                  </div>
                )}
                {turn.weatherExpired && (
                  <div className="battle-turn-line is-muted">날씨가 원래대로 돌아갔다!</div>
                )}
                {turn.expiredScreens.map((e, i) => (
                  <div key={i} className="battle-turn-line is-muted">
                    {fighterLabel(battleState, e.actor)}의 {SCREEN_LABELS[e.screen]}이(가) 사라졌다!
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
          const slot = sideOf(picker.side).slot;
          if (!pokemon || !slot) return null;
          return (
            <AbilityPickerModal
              pokemon={pokemon}
              slot={slot}
              currentAbilityId={slot.ability}
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
