import { useState } from "react";
import { BattleSetupCard } from "./BattleSetupCard";
import { WeatherPicker } from "./WeatherPicker";
import { PokemonPickerModal } from "./PokemonPickerModal";
import { MovePickerModal } from "./MovePickerModal";
import { AbilityPickerModal } from "./AbilityPickerModal";
import { ItemPickerModal } from "./ItemPickerModal";
import { NaturePickerModal } from "./NaturePickerModal";
import { PointsEditorModal } from "./PointsEditorModal";
import { SlotPresetsModal } from "./SlotPresetsModal";
import { useBattleSetup } from "../hooks/useBattleSetup";
import { useSlotPresets } from "../hooks/useSlotPresets";
import { getPokemon, getMove, getItem } from "../lib/data";
import { getEffectiveForm, megaBadgeLabel } from "../lib/pokemonForm";
import { TYPE_COLORS } from "../lib/typeColors";
import { environmentTintBackground } from "../lib/environmentBackground";
import { rankStageMultiplier } from "../lib/battlePower";
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
import { typeLabel } from "../types/pokemon-type";
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
  | { kind: "slotPresets"; side: Side }
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
  taunt: "도발",
  disable: "사슬묶기",
  encore: "앙코르",
  attract: "헤롱헤롱",
} as const;

/** 액션 로그 한 줄 안에 "OO 발동!"으로 뭉뚱그리기보다 전용 문구를 따로 쓰는 volatile들 */
const VOLATILES_WITH_DEDICATED_LOG_LINE = new Set(["drowsy", "wish"]);

const SCREEN_LABELS = { reflect: "리플렉터", lightScreen: "빛의장막", auroraVeil: "오로라베일" } as const;

/** 날씨/필드 배경 틴트 — 매치업 페이지와 공유하는 environmentTintBackground에 위임한다. */
function battleBoardBackground(state: BattleState): string | undefined {
  return environmentTintBackground(state.weather, state.field);
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

/** "구애스카프를"/"압도적힘을"처럼 자음 받침 유무에 따라 "을"/"를" 조사를 자동 판별한다(매지션 강탈 로그용) */
function eulReul(name: string): "을" | "를" {
  const lastChar = name.at(-1);
  if (!lastChar) return "를";
  const code = lastChar.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "를";
  return code % 28 === 0 ? "를" : "을";
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
  const slotPresets = useSlotPresets();
  const [picker, setPicker] = useState<PickerState>(null);
  const [battleState, setBattleState] = useState<BattleState | null>(null);
  const [log, setLog] = useState<TurnResult[]>([]);
  const [selected, setSelected] = useState<{ a: string | null; b: string | null }>({ a: null, b: null });
  // 구애스카프 잠금 위반으로 턴 진행이 막혔을 때 보여줄 경고 문구. 선택이 바뀌거나 턴이 정상
  // 진행되면 지운다.
  const [lockWarning, setLockWarning] = useState<string | null>(null);

  const sideOf = (side: Side) => (side === "a" ? setup.a : setup.b);
  const pokemonOf = (side: Side) => {
    const slot = sideOf(side).slot;
    return slot ? getPokemon(slot.pokemonId) : undefined;
  };

  function handleSaveSlotAsSample(side: Side) {
    const slot = sideOf(side).slot;
    if (!slot) return;
    const pokemon = getPokemon(slot.pokemonId);
    const name = window.prompt("이 빌드를 저장할 이름을 입력하세요.", pokemon?.name ?? "");
    if (name === null) return;
    slotPresets.savePreset(name, slot);
  }

  /**
   * 구애스카프: 이 쪽이 그 도구를 지녔고, 로그에 이미 이 쪽이 실제로 쓴 기술이 있으면 그 첫 기술
   * id로 잠긴다. 판정 엔진(battleSimulator)이 아니라 이 화면의 턴 진행 버튼이 UI 단에서 막는
   * 방식이라, 잠긴 기술 id를 여기서 로그를 훑어 매번 다시 구한다(별도 상태로 안 들고 다닌다).
   */
  function choiceLockedMoveId(side: Side): string | null {
    const itemId = sideOf(side).slot?.item;
    const item = itemId ? getItem(itemId) : undefined;
    if (!item?.locksFirstMoveUsed) return null;
    for (const turn of log) {
      const action = turn.actions.find((a) => a.actor === side);
      if (action) return action.move.id;
    }
    return null;
  }

  /**
   * 도발/사슬묶기/앙코르: 이 쪽이 지금 이 기술을 고르면 왜 안 되는지(있다면) 문구로 돌려준다.
   * 구애스카프(choiceLockedMoveId)와 달리 판정 엔진(battleSimulator)의 volatile 상태를 그대로
   * 읽는다 — 로그를 다시 훑을 필요 없이 battleState에 이미 반영돼있다.
   */
  function moveRestrictionMessage(side: Side, moveId: string): string | null {
    if (!battleState) return null;
    const fighter = battleState[side];
    const pokemonName = pokemonOf(side)?.name ?? "포켓몬";
    if (fighter.volatile.active.taunt && getMove(moveId)?.category === "status") {
      return `${pokemonName}${eunNeun(pokemonName)} 도발에 걸려 변화기를 사용할 수 없어요.`;
    }
    const disableEntry = fighter.volatile.active.disable;
    if (disableEntry && disableEntry.moveId === moveId) {
      const disabledName = getMove(moveId)?.name ?? "그 기술";
      return `${disabledName}${eunNeun(disabledName)} 사슬묶기에 걸려 사용할 수 없어요.`;
    }
    const encoreEntry = fighter.volatile.active.encore;
    if (encoreEntry?.moveId && encoreEntry.moveId !== moveId) {
      const forcedName = getMove(encoreEntry.moveId)?.name ?? "그 기술";
      return `${pokemonName}${eunNeun(pokemonName)} 앙코르 때문에 ${forcedName}만 사용할 수 있어요.`;
    }
    return null;
  }

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
    setLockWarning(null);
  }

  function resetToSetup() {
    setBattleState(null);
    setLog([]);
    setSelected({ a: null, b: null });
    setLockWarning(null);
  }

  function playTurn() {
    if (!battleState) return;
    setLockWarning(null);
    // 남은 PP가 있는 기술이 하나도 없으면(4개 다 0) 선택 없이 발버둥을 자동으로 낸다.
    const aStruggling = !hasUsableMove(battleState.a);
    const bStruggling = !hasUsableMove(battleState.b);
    // 공중날기 등 차지 기술 2턴째는 준비해둔 기술이 선택 여부와 무관하게 자동으로 나가므로
    // 이 턴엔 수동 선택을 요구하지 않는다 — resolveAction이 어차피 이 값을 무시하고 강제한다.
    const aCharging = battleState.a.chargingMoveId !== undefined;
    const bCharging = battleState.b.chargingMoveId !== undefined;
    if ((!aStruggling && !aCharging && !selected.a) || (!bStruggling && !bCharging && !selected.b)) return;

    // 구애스카프 잠금 확인: 발버둥/차지 계속은 애초에 "선택"이 아니라서 대상이 아니다. 이미 잠긴
    // 기술과 다른 걸 골랐으면 턴 자체를 진행시키지 않고 경고만 띄운다.
    for (const side of ["a", "b"] as const) {
      const chosen = side === "a" ? (!aStruggling && !aCharging ? selected.a : null) : !bStruggling && !bCharging ? selected.b : null;
      const locked = chosen ? choiceLockedMoveId(side) : null;
      if (locked && chosen !== locked) {
        const lockedMoveName = getMove(locked)?.name ?? "그 기술";
        const pokemonName = pokemonOf(side)?.name ?? "포켓몬";
        setLockWarning(`${pokemonName}${eunNeun(pokemonName)} 구애스카프 때문에 ${lockedMoveName}만 사용할 수 있어요.`);
        return;
      }
      // 도발/사슬묶기/앙코르도 같은 방식으로 확인 — 선택 자체는 막지 않고 진행만 경고로 저지한다.
      const restriction = chosen ? moveRestrictionMessage(side, chosen) : null;
      if (restriction) {
        setLockWarning(restriction);
        return;
      }
    }

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
              onToggleGender={setup.a.toggleGender}
              hasSamples={slotPresets.presets.length > 0}
              onSaveAsSample={() => handleSaveSlotAsSample("a")}
              onOpenSamplePicker={() => setPicker({ kind: "slotPresets", side: "a" })}
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
              onToggleGender={setup.b.toggleGender}
              hasSamples={slotPresets.presets.length > 0}
              onSaveAsSample={() => handleSaveSlotAsSample("b")}
              onOpenSamplePicker={() => setPicker({ kind: "slotPresets", side: "b" })}
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
              // 구애스카프: 이미 잠긴 기술이 있으면(대전 시작 후 첫 사용 이후) 그 id를 미리 구해둔다
              const lockedMoveId = choiceLockedMoveId(side);

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
                      {(Object.keys(fighter.volatile.active) as (keyof typeof VOLATILE_LABELS)[]).map((v) => {
                        // 사슬묶기/앙코르는 대상 기술 이름까지 같이 보여줘야 어떤 기술이
                        // 막혔는지/강제됐는지 알 수 있다.
                        const moveId = fighter.volatile.active[v]?.moveId;
                        const moveName = moveId ? getMove(moveId)?.name : undefined;
                        return (
                          <span key={v} className="battle-status-tag is-volatile">
                            {VOLATILE_LABELS[v]}
                            {moveName && `(${moveName})`}
                          </span>
                        );
                      })}
                      {(Object.keys(fighter.screens) as ("reflect" | "lightScreen" | "auroraVeil")[])
                        .filter((s) => fighter.screens[s] !== undefined)
                        .map((s) => (
                          <span key={s} className="battle-status-tag is-volatile">
                            {SCREEN_LABELS[s]} {fighter.screens[s]}턴
                          </span>
                        ))}
                      {fighter.substituteHp !== undefined && (
                        <span className="battle-status-tag is-volatile">대타 HP {fighter.substituteHp}</span>
                      )}
                      {fighter.unburdenActive && (
                        <span className="battle-status-tag is-volatile">곡예(스피드 2배)</span>
                      )}
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
                      HP·공격·방어·특공·특방·스피드 실능치를 배틀 보드에도 그대로 노출한다. 칼춤·위협 등
                      랭크 변화는 턴 진행 중 이 표시에 즉시 반영한다(Phase 6.5 §6-2 ⑧) — HP는 랭크 대상이 아님. */}
                  <div className="battle-real-stats">
                    {REAL_STAT_LABELS.map(({ key, label }) => {
                      const base = fighter.realStats[key];
                      const stage = key === "hp" ? 0 : fighter.stages[key];
                      const effective = stage === 0 ? base : Math.round(base * rankStageMultiplier(stage));
                      return (
                        <div
                          key={key}
                          className={`battle-real-stat-item${
                            stage > 0 ? " is-boosted" : stage < 0 ? " is-lowered" : ""
                          }`}
                        >
                          <span className="battle-real-stat-label">{label}</span>
                          <span
                            className="battle-real-stat-value"
                            title={
                              stage !== 0
                                ? `기본 ${Math.round(base)} (${stage > 0 ? "+" : ""}${stage}랭크)`
                                : undefined
                            }
                          >
                            {Math.round(effective)}
                            {stage !== 0 && (
                              <span className="battle-real-stat-stage">
                                {stage > 0 ? `+${stage}` : stage}
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
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
                        const weatherConditionUnmet =
                          move.usageCondition === "weather-required" && battleState.weather !== move.requiresWeather;
                        // 기습은 상대가 이번 턴 뭘 낼지(동시 비공개 선택이라) 미리 알 수 없어 다른
                        // usageCondition처럼 "지금 조건 충족 여부"를 판정할 수 없다 — 매번 고정 안내만 띄운다.
                        const suckerPunchHint = move.usageCondition === "opponent-damaging-move-only";
                        const choiceLocked = lockedMoveId !== null && move.id !== lockedMoveId;
                        const restrictionMsg = moveRestrictionMessage(side, move.id);
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
                                    : weatherConditionUnmet
                                      ? `${move.requiresWeather} 날씨일 때만 사용 가능 — 지금 쓰면 실패해요`
                                      : suckerPunchHint
                                      ? "상대보다 먼저 움직이면서, 상대가 데미지 기술을 낼 때만 성공해요"
                                      : choiceLocked
                                      ? "구애스카프 때문에 이 기술은 지금 선택할 수 없어요"
                                      : restrictionMsg ?? undefined
                            }
                            onClick={() => {
                              setLockWarning(null);
                              setSelected((prev) => ({ ...prev, [side]: move.id }));
                            }}
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
            <>
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
              {lockWarning && <div className="battle-lock-warning">{lockWarning}</div>}
            </>
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
                        {action.sleepTalkCalledMoveName && " (잠꼬대로 냈다!)"}
                        {action.blockedReason === "usageCondition" && "!"}
                        {action.blockedReason === "moveRestricted" && "!"}
                        {action.blockedReason === "status" && action.blockedByStatus === undefined && " — 상태이상으로 행동 불가"}
                        {action.blockedReason === "flinch" && " — 풀이 죽어서 움직일 수 없었다!"}
                        {action.blockedReason === "recharge" && " — 반동으로 움직일 수 없었다!"}
                        {action.blockedReason === "confusion" &&
                          ` — 자기자신을 공격했다! (${action.selfDamage} 데미지)`}
                        {action.blockedReason === "attract" && " — 헤롱헤롱에 빠져 행동 불가"}
                        {action.blockedReason === "psychicFieldPriority" && " — 사이코필드에 막혀 실패"}
                        {!action.blockedReason && action.charging && " — 준비 중! 다음 턴 발동된다"}
                        {!action.blockedReason && !action.charging && action.evadedByCharge && " — 무적 상태라 빗나감"}
                        {!action.blockedReason && !action.charging && !action.evadedByCharge && !action.hit && " — 빗나갔다!"}
                        {!action.blockedReason && action.hit && action.damage > 0 && (
                          <>
                            {" "}
                            {/* 다단히트가 아닐 때만 "급소!"를 단일 판정으로 표시 — 다단히트는
                                타수마다 급소를 따로 판정해서 "하나라도 급소"라는 뜻이 다르므로
                                뒤의 "(급소 포함)" 표기로 대신한다 */}
                            — {action.hitCount === undefined && action.critical && "급소에 맞았다! "}
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
                          <> · 희망사항!</>
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
                        {!action.blockedReason && action.hit && action.setSubstitute && <> · 대타를 세웠다!</>}
                        {!action.blockedReason && action.hit && action.substituteSetFailed && (
                          <> · 이미 대타가 있거나 HP가 부족해 실패!</>
                        )}
                        {!action.blockedReason && action.hit && action.setDisabledMoveName && (
                          <> · {action.setDisabledMoveName} 봉인!</>
                        )}
                        {!action.blockedReason && action.hit && action.disableSetFailed && (
                          <> · 상대가 아직 기술을 안 썼거나 이미 걸려있어 실패!</>
                        )}
                        {!action.blockedReason && action.hit && action.setEncoreMoveName && (
                          <> · {action.setEncoreMoveName}밖에 쓸 수 없다!</>
                        )}
                        {!action.blockedReason && action.hit && action.encoreSetFailed && (
                          <> · 상대가 아직 기술을 안 썼거나 이미 걸려있어 실패!</>
                        )}
                        {!action.blockedReason && action.hit && action.swappedStatsMoveName && (
                          <> · 공격과 방어 수치가 서로 바뀌었다!</>
                        )}
                        {!action.blockedReason && action.hit && action.sheerForceAbilityName && (
                          <> · {action.sheerForceAbilityName} 발동! 부가 효과 대신 위력이 올랐다!</>
                        )}
                        {!action.blockedReason && action.hit && action.stolenItemName && (
                          <> · 매지션 발동! 상대의 {action.stolenItemName}{eulReul(action.stolenItemName)} 빼앗았다!</>
                        )}
                        {!action.blockedReason && action.hit && action.unburdenSelfAbilityName && (
                          <> · {action.unburdenSelfAbilityName} 발동! 스피드가 2배로 올랐다!</>
                        )}
                        {!action.blockedReason && action.hit && action.unburdenOpponentAbilityName && (
                          <> · 상대의 {action.unburdenOpponentAbilityName} 발동! 상대의 스피드가 2배로 올랐다!</>
                        )}
                        {!action.blockedReason && action.changedOwnTypeTo && (
                          <>
                            {" "}
                            · {action.changedOwnTypeAbilityName} 발동! 타입이 {action.changedOwnTypeTo}
                            {roEuro(action.changedOwnTypeTo)} 바뀌었다!
                          </>
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
                      {/* 도발/사슬묶기/앙코르로 이번 선택 자체가 막혔을 때 — 어떤 제약 때문인지 구분해서 보여준다 */}
                      {action.blockedReason === "moveRestricted" && (
                        <div className="battle-turn-line is-muted">
                          {action.moveRestrictionKind === "taunt" &&
                            `${actorName}은(는) 도발에 걸려 변화기를 쓸 수 없다!`}
                          {action.moveRestrictionKind === "disable" &&
                            `${actorName}의 ${action.move.name}${eunNeun(action.move.name)} 사슬묶기에 봉인돼있다!`}
                          {action.moveRestrictionKind === "encore" &&
                            `${actorName}은(는) 앙코르 때문에 이 기술을 쓸 수 없다!`}
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
                      {/* 방어측 접촉/피격 트리거 특성(정전기·불꽃몸=상태이상, 까칠한피부=고정 데미지,
                          저주받은바디=PP 봉인) — 전부 defenderName의 특성이 actorName(공격자)에게 발동한다 */}
                      {!action.blockedReason && action.abilityInflictedStatusOnAttacker && (
                        <div className="battle-turn-line is-muted">
                          {defenderName}의 {action.abilityInflictedStatusAbilityName}!{" "}
                          {STATUS_ONSET_TEXT[action.abilityInflictedStatusOnAttacker](actorName)}
                        </div>
                      )}
                      {/* 헤롱헤롱바디 — 접촉해 온 공격자가 이성이면 방어측 특성이 발동해 공격자에게 걸린다 */}
                      {!action.blockedReason && action.abilityInflictedVolatileOnAttacker && (
                        <div className="battle-turn-line is-muted">
                          {defenderName}의 {action.abilityInflictedVolatileAbilityName}! {actorName}
                          {eunNeun(actorName)} {VOLATILE_LABELS[action.abilityInflictedVolatileOnAttacker]} 상태가
                          되었다!
                        </div>
                      )}
                      {!action.blockedReason && !!action.abilityDamageToAttacker && (
                        <div className="battle-turn-line is-muted">
                          {defenderName}의 {action.abilityDamageAbilityName}! {actorName}
                          {eunNeun(actorName)} {action.abilityDamageToAttacker} 데미지를 입었다
                        </div>
                      )}
                      {!action.blockedReason && action.abilityDisabledMoveName && (
                        <div className="battle-turn-line is-muted">
                          {defenderName}의 {action.abilityDisableAbilityName}! {actorName}의{" "}
                          {action.abilityDisabledMoveName}이(가) 봉인되었다!
                        </div>
                      )}
                      {/* 타오르는불꽃/피뢰침 — 해당 타입 기술을 통째로 무효화(데미지는 이미 0으로
                          찍혀있어 별도 표시가 없으면 "그냥 약해서 0"인지 구분이 안 되니 전용 문구로 알려준다) */}
                      {!action.blockedReason && action.abilityAbsorbedMoveType && (
                        <div className="battle-turn-line is-muted">
                          {defenderName}의 {action.abilityAbsorbAbilityName}! {typeLabel(action.abilityAbsorbedMoveType)}
                          {eunNeun(typeLabel(action.abilityAbsorbedMoveType))} 전혀 효과가 없었다!
                          {!!action.abilityAbsorbHealAmount && <> 체력을 {action.abilityAbsorbHealAmount} 회복했다!</>}
                        </div>
                      )}
                      {/* 대타출동 — 데미지가 본체가 아니라 대타로 들어갔을 때 알려준다. 깨졌는지 아직
                          버티는지에 따라 문구를 분기(접촉/특성 트리거가 발동하지 않는 이유이기도 함) */}
                      {!action.blockedReason && action.hitSubstitute && (
                        <div className="battle-turn-line is-muted">
                          {action.substituteBroke ? "대타는 사라졌다!" : "대타가 대신 맞았다!"}
                        </div>
                      )}
                      {/* 탈(Disguise) — 데미지를 통째로 무효화하고 그 반동으로 벗겨지며 데미지를 입는다.
                          다단히트 나머지 타수는 이 필드 없이 정상적으로 데미지가 들어간다(첫 타만 무효화). */}
                      {!action.blockedReason && action.hitNegatedByAbilityName && (
                        <div className="battle-turn-line is-muted">
                          {defenderName}의 {action.hitNegatedByAbilityName}! {defenderName}의 정체가 드러났다!{" "}
                          {defenderName}
                          {eunNeun(defenderName)} 반동으로 {action.disguiseRecoilDamage} 데미지를 입었다!
                        </div>
                      )}
                      {/* 흑안개 — 자신/상대 구분 없이 양쪽 다 초기화되는 유일한 랭크변화 효과라 전용 문구로 알려준다 */}
                      {!action.blockedReason && action.resetAllStages && (
                        <div className="battle-turn-line is-muted">양쪽의 능력 변화가 전부 원래대로 돌아갔다!</div>
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
                      {/* 기합의띠·기합의머리띠 — 기절할 데미지를 버티고 HP 1로 남았을 때 */}
                      {!action.blockedReason && action.enduredItemName && (
                        <div className="battle-turn-line is-muted">
                          {defenderName}
                          {eunNeun(defenderName)} {action.enduredItemName}
                          {roEuro(action.enduredItemName)} 버텼다! (HP 1)
                        </div>
                      )}
                      {/* 옹골참 — 기합의띠와 같은 문구지만 도구가 아니라 특성이 버텨줬을 때 */}
                      {!action.blockedReason && action.enduredAbilityName && (
                        <div className="battle-turn-line is-muted">
                          {defenderName}
                          {eunNeun(defenderName)} {action.enduredAbilityName}
                          {roEuro(action.enduredAbilityName)} 버텼다! (HP 1)
                        </div>
                      )}
                      {/* 버티기 — 기합의띠/옹골참과 같은 문구지만 방어류 기술이 버텨줬을 때 */}
                      {!action.blockedReason && action.enduredProtectMoveName && (
                        <div className="battle-turn-line is-muted">
                          {defenderName}
                          {eunNeun(defenderName)} {action.enduredProtectMoveName}
                          {roEuro(action.enduredProtectMoveName)} 버텼다! (HP 1)
                        </div>
                      )}
                      {/* 방어/판별/킹실드 — 자신의 시도가 이번에 성공했는지/실패했는지. 길동무는 "몸을
                          지키는" 효과가 아니라(막지 않음) 전용 문구로 따로 표시한다(바로 아래). */}
                      {!action.blockedReason && action.protectSucceeded && action.move.protectEffect !== "destinyBond" && (
                        <div className="battle-turn-line is-muted">
                          {actorName}
                          {eunNeun(actorName)} {action.move.name}로 몸을 지켰다!
                        </div>
                      )}
                      {!action.blockedReason && action.protectSucceeded && action.move.protectEffect === "destinyBond" && (
                        <div className="battle-turn-line is-muted">
                          {actorName}는 상대를 길동무로 삼으려 한다!
                        </div>
                      )}
                      {!action.blockedReason && action.protectFailed && (
                        <div className="battle-turn-line is-muted">
                          {actorName}의 {action.move.name}{eunNeun(action.move.name)} 실패했다!
                        </div>
                      )}
                      {/* 공격이 상대의 방어류 기술에 완전히 막혔을 때 — 이 행동(공격측)의 로그에 표시 */}
                      {!action.blockedReason && action.blockedByProtectMoveName && (
                        <div className="battle-turn-line is-muted">
                          {defenderName}의 {action.blockedByProtectMoveName}
                          {roEuro(action.blockedByProtectMoveName)} 막혔다!
                        </div>
                      )}
                      {/* 킹실드 — 접촉기를 막아내 공격측의 공격이 떨어졌을 때 */}
                      {!action.blockedReason && action.protectContactPenaltyMoveName && (
                        <div className="battle-turn-line is-muted">
                          {actorName}
                          {eunNeun(actorName)} 접촉한 반동으로 공격이 떨어졌다!
                        </div>
                      )}
                      {/* 하양허브 — 자신/상대 어느 쪽에서 발동했는지 따로 표시 */}
                      {!action.blockedReason && action.restoredStatsSelfItemName && (
                        <div className="battle-turn-line is-muted">
                          {actorName}의 {action.restoredStatsSelfItemName}
                          {roEuro(action.restoredStatsSelfItemName)} 떨어진 능력을 원래대로 되돌렸다!
                        </div>
                      )}
                      {!action.blockedReason && action.restoredStatsOpponentItemName && (
                        <div className="battle-turn-line is-muted">
                          {defenderName}의 {action.restoredStatsOpponentItemName}
                          {roEuro(action.restoredStatsOpponentItemName)} 떨어진 능력을 원래대로 되돌렸다!
                        </div>
                      )}
                      {/* 상대가 쓰러졌는지 여부 — 데미지 수치와 분리된 별도 상태 줄 */}
                      {!action.blockedReason && action.fainted && (
                        <div className="battle-turn-line is-fainted">
                          {defenderName}
                          {eunNeun(defenderName)} 쓰러졌다
                        </div>
                      )}
                      {/* 자신이 쓰러졌는지 여부(자폭류·발버둥 반동·혼란 자멸·상대의 길동무) — 원인을 그대로 붙인다 */}
                      {action.selfFainted && (
                        <div className="battle-turn-line is-fainted">
                          {actorName}
                          {eunNeun(actorName)}{" "}
                          {action.triggeredDestinyBond
                            ? `${defenderName}의 길동무`
                            : action.blockedReason === "confusion"
                              ? "혼란으로 인한 데미지"
                              : `${action.move.name}의 여파`}
                          로 쓰러졌다
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
                    ) : e.abilityWeatherHeal ? (
                      <>
                        {fighterLabel(battleState, e.actor)}의 {e.abilityWeatherHealAbilityName}로{" "}
                        {e.abilityWeatherHeal} 회복 (남은 HP {e.remainingHp})
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
                    ) : e.abilityCuredStatus ? (
                      <>
                        {fighterLabel(battleState, e.actor)}의 {e.abilityCuredStatusAbilityName}!{" "}
                        {STATUS_CURE_TEXT[e.abilityCuredStatus](fighterLabel(battleState, e.actor))}
                      </>
                    ) : e.statusCondition ? (
                      <>
                        {STATUS_TRIGGER_TEXT[e.statusCondition](fighterLabel(battleState, e.actor))} (남은 HP{" "}
                        {e.remainingHp})
                        {e.fainted && " · 기절!"}
                      </>
                    ) : e.speedBoostAbilityName ? (
                      <>
                        {fighterLabel(battleState, e.actor)}의 {e.speedBoostAbilityName}! 스피드가 올라갔다!
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
                      ? "🤝 무승부!"
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

      {picker?.kind === "slotPresets" && (
        <SlotPresetsModal
          presets={slotPresets.presets}
          slotIsFilled={sideOf(picker.side).slot !== null}
          onClose={() => setPicker(null)}
          onLoad={(preset) => sideOf(picker.side).loadSlot(preset.slot)}
          onRename={slotPresets.renamePreset}
          onDelete={slotPresets.deletePreset}
        />
      )}
    </section>
  );
}
