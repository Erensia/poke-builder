import { type Dispatch, type SetStateAction } from "react";
import { BattleTurnLog } from "../BattleTurnLog";
import { getPokemon, getMove } from "../../lib/data";
import { getEffectiveForm, getEffectiveGender, megaBadgeLabel } from "../../lib/pokemonForm";
import { MEGA_SYMBOL_SPRITE_URL, type SpriteFormOptions } from "../../lib/sprites";
import { PokemonAvatarWithItem } from "../PokemonAvatarWithItem";
import { TYPE_COLORS } from "../../lib/typeColors";
import { rankStageMultiplier } from "../../lib/battlePower";
import { VOLATILE_LABELS, SCREEN_LABELS } from "../../lib/battleLogLabels";
import { eunNeun } from "../../lib/josa";
import { forcedLockedAction, isRecharging, isTrappedFromSwitching, type BattleSide, type BattleState, type FighterKey, type TurnResult } from "../../lib/battleSimulator";
import type { StatusCondition } from "../../types/status";
import type { BaseStats } from "../../types/stats";
import type { Pokemon } from "../../types/pokemon";
import { type InputModeState, type MegaDeclaredState, type PendingForcedSwitchState, type PendingPivotState, type SelectedState, type Side, type SlotIndex } from "./shared";

const STATUS_LABELS: Record<StatusCondition, string> = {
  burn: "화상",
  poison: "독",
  "badly-poisoned": "맹독",
  paralysis: "마비",
  freeze: "얼음",
  sleep: "잠듦",
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

/**
 * 실시간 배틀판 — HP게이지·상태태그·실능치·파티트래커·기술/교체 입력·메가진화 토글·턴
 * 진행 버튼까지(§16). `BattleLogPage`가 쥔 배틀 상태·핸들러를 그대로 넘기는
 * presentational 컴포넌트 — 워낙 많은 값을 필요로 해서(23개) `BattleSetupScreen`처럼
 * 개별 훅 객체 하나로 뭉뚱그릴 수 없어 각자 이름 그대로 prop으로 받는다.
 */
export function BattleBoard({
  battleState,
  winner,
  selected,
  setSelected,
  inputMode,
  setInputMode,
  megaDeclared,
  setMegaDeclared,
  pendingForcedSwitch,
  pendingPivot,
  lockWarning,
  setLockWarning,
  log,
  battleBoardBackground,
  fighterLabel,
  activeMoveIds,
  choiceLockedMoveId,
  battleSide,
  switchableIndices,
  resolveForcedSwitch,
  resolvePivot,
  isStruggling,
  moveRestrictionMessage,
  buildableIndices,
  pokemonAt,
  selection,
  playTurn,
  resetToSetup,
  aiSide,
  aiThinking,
  learnedBattles,
  seriesNext,
}: {
  /** 배틀 프런티어 진행 중이면 결과 배너의 "대전 이어하기"를 이 라벨의 "다음 상대" 버튼으로 바꾼다 */
  seriesNext: { label: string; onNext: () => void } | null;
  /** 컴퓨터(배틀 AI)가 조작하는 편. 사람이 양쪽 다 조작하면 null */
  aiSide: Side | null;
  /** AI가 이번 턴 행동을 계산하는 중(ver.2.0 2-B — Web Worker) — 점 세 개 표시, 턴 진행 버튼 잠금 */
  aiThinking: boolean;
  /** 이번 대전을 학습했으면 누적 판 수(ver.2.0 1-C 결과 배너 한 줄) */
  learnedBattles: number | null;
  battleState: BattleState;
  winner: FighterKey | "draw" | undefined;
  selected: SelectedState;
  setSelected: Dispatch<SetStateAction<SelectedState>>;
  inputMode: InputModeState;
  setInputMode: Dispatch<SetStateAction<InputModeState>>;
  megaDeclared: MegaDeclaredState;
  setMegaDeclared: Dispatch<SetStateAction<MegaDeclaredState>>;
  pendingForcedSwitch: PendingForcedSwitchState;
  pendingPivot: PendingPivotState;
  lockWarning: string | null;
  setLockWarning: Dispatch<SetStateAction<string | null>>;
  log: TurnResult[];
  battleBoardBackground: (state: BattleState) => string | undefined;
  fighterLabel: (state: BattleState, key: FighterKey) => string;
  activeMoveIds: (side: Side) => (string | null)[];
  choiceLockedMoveId: (side: Side) => string | null;
  battleSide: (side: Side) => BattleSide | undefined;
  switchableIndices: (side: Side) => number[];
  resolveForcedSwitch: (side: Side, toIndex: number) => void;
  resolvePivot: (toIndex: number) => void;
  isStruggling: (side: Side) => boolean;
  moveRestrictionMessage: (side: Side, moveId: string) => string | null;
  /** 2.3 B2 — 상대 파티 6마리 나열용. 빌드된(포켓몬+기술 있는) 슬롯 인덱스 */
  buildableIndices: (side: Side) => SlotIndex[];
  pokemonAt: (side: Side, i: SlotIndex) => Pokemon | undefined;
  /** 선출된 빌드 슬롯 인덱스(선출 순서) — battleSide(side).party[j]가 selection[side][j] 슬롯과 대응 */
  selection: { a: SlotIndex[]; b: SlotIndex[] };
  playTurn: () => void;
  resetToSetup: () => void;
}) {
  return (
    <>
    <div className="battle-board" style={{ background: battleBoardBackground(battleState) }}>
      {(() => {
        const hazardTag = (side: Side): string[] => {
          const hz = side === "a" ? battleState.sideA.hazards : battleState.sideB.hazards;
          const parts: string[] = [];
          if (hz.stealthRock) parts.push("스텔스록");
          if (hz.spikesLayers > 0) parts.push(`압정뿌리기 ${hz.spikesLayers}층`);
          if (hz.toxicSpikesLayers > 0) parts.push(`독압정 ${hz.toxicSpikesLayers}층`);
          if (hz.stickyWeb) parts.push("끈적끈적네트");
          return parts;
        };
        const anyHazard = hazardTag("a").length > 0 || hazardTag("b").length > 0;
        const tailwindTurns = (side: Side) =>
          (side === "a" ? battleState.sideA : battleState.sideB).tailwindTurnsRemaining;
        const anyTailwind = tailwindTurns("a") !== undefined || tailwindTurns("b") !== undefined;
        if (
          !battleState.weather &&
          !battleState.field &&
          battleState.trickRoomTurnsRemaining === undefined &&
          battleState.wonderRoomTurnsRemaining === undefined &&
          battleState.magicRoomTurnsRemaining === undefined &&
          battleState.gravityTurnsRemaining === undefined &&
          battleState.fairyLockTurnsRemaining === undefined &&
          !anyHazard &&
          !anyTailwind
        ) {
          return null;
        }
        return (
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
            {battleState.wonderRoomTurnsRemaining !== undefined && (
              <span className="battle-environment-tag">원더룸 (앞으로 {battleState.wonderRoomTurnsRemaining}턴)</span>
            )}
            {battleState.magicRoomTurnsRemaining !== undefined && (
              <span className="battle-environment-tag">매직룸 (앞으로 {battleState.magicRoomTurnsRemaining}턴)</span>
            )}
            {battleState.gravityTurnsRemaining !== undefined && (
              <span className="battle-environment-tag">중력 (앞으로 {battleState.gravityTurnsRemaining}턴)</span>
            )}
            {battleState.fairyLockTurnsRemaining !== undefined && (
              <span className="battle-environment-tag">
                페어리록 ({battleState.fairyLockTurnsRemaining >= 2 ? "다음 턴 교체 불가" : "이번 턴 교체 불가"})
              </span>
            )}
            {/* 진영 태그는 포켓몬 이름 대신 내·상대 진영으로 — 같은 포켓몬끼리 싸우면 구분이 안 된다(ver.1.9 사용자 제보) */}
            {(["a", "b"] as const).map((side) =>
              tailwindTurns(side) !== undefined ? (
                <span key={`tw-${side}`} className="battle-environment-tag">
                  {side === "a" ? "내" : "상대"} 진영: 순풍 (앞으로 {tailwindTurns(side)}턴)
                </span>
              ) : null,
            )}
            {(["a", "b"] as const).map((side) =>
              hazardTag(side).length > 0 ? (
                <span key={`hz-${side}`} className="battle-environment-tag">
                  {side === "a" ? "내" : "상대"} 진영: {hazardTag(side).join(" · ")}
                </span>
              ) : null,
            )}
          </div>
        );
      })()}
      {(["a", "b"] as const).map((side) => {
        const fighter = battleState[side];
        const pokemon = getPokemon(fighter.slot.pokemonId);
        if (!pokemon) return null;
        // 일루전(§6-1): 위장 중이면 화면에는 위장 대상 이름을 보여준다(타입·실능·특성은 조로아크 그대로).
        const displayName = fighter.illusionAs
          ? getPokemon(fighter.illusionAs)?.name ?? pokemon.name
          : pokemon.name;
        // 셋업 카드와 동일하게 메가진화 여부를 반영해서 이름 옆에 배지를 그린다.
        // fighter.slot(EvaluatorSlot)은 FormSource를 만족하므로 getEffectiveForm을 그대로 쓸 수 있다.
        // (메가진화 관련 용도 전용 — 변신 중에도 메타몽 자신의 메가 여부라 원본 종 기준 그대로 둔다.)
        const form = getEffectiveForm(pokemon, fighter.slot);
        const hpPercent = Math.max(0, Math.min(100, (fighter.currentHp / fighter.maxHp) * 100));
        // 변신(§괴짜/변신, ver.1.6): 로그엔 "변신했다!"가 찍히는데 보드 표시가 안 바뀌던 버그 —
        // 이름은 원본 종 그대로 두되(본가 규칙), 스프라이트·타입 배지는 변신 대상 모습으로 보여준다.
        // fighter.types는 applyTransform이 이미 대상 것으로 갈아치워 둔 값이라 그대로 쓴다.
        const transformedPokemon =
          !fighter.illusionAs && fighter.transformedIntoPokemonId
            ? getPokemon(fighter.transformedIntoPokemonId)
            : undefined;
        // §1-4: 대전 화면 아바타. 일루전 중이면 위장 대상 종의 스프라이트를(상대가 안 눈치채도록,
        // 도구 뱃지도 숨김), 변신 중이면 변신 대상 종을(성별·폼 등은 복제 대상이 아니라 기본
        // 모습으로), 아니면 실제 종. 메가스톤을 들어도 실제로 선언(hasMegaEvolved)해야
        // 메가폼 스프라이트로 바뀐다 — 그래서 item은 스프라이트 옵션에 안 넘기고(메가스톤이
        // 스프라이트를 강제로 메가폼으로 만들기 때문) 뱃지로만 표시한다.
        const illusionPokemon = fighter.illusionAs ? getPokemon(fighter.illusionAs) : undefined;
        const avatarPokemon = illusionPokemon ?? transformedPokemon ?? pokemon;
        // 변신 시점에 대상이 메가진화 상태였으면(transformedIntoMegaStone) 그 메가폼 이미지 그대로.
        const transformedMegaForm = transformedPokemon?.megaEvolutions?.find(
          (m) => m.megaStone === fighter.transformedIntoMegaStone,
        )?.form;
        const avatarForm: SpriteFormOptions = illusionPokemon
          ? {}
          : transformedPokemon
            ? { activeMegaForm: transformedMegaForm }
            : {
                gender: getEffectiveGender(pokemon, fighter.slot),
                cosmeticForm: fighter.slot.cosmeticForm,
                formVariant: fighter.slot.formVariant,
                sizeForm: fighter.slot.sizeForm,
                activeMegaForm: fighter.hasMegaEvolved ? form.mega?.form : undefined,
              };
        // battleState 안의 slot은 EvaluatorSlot(moves 필드 없음)이라, 4개 기술 목록은
        // 셋업 단계에서 쓴 PartySlot을 활성 슬롯 인덱스로 되짚어 가져온다 — 배틀 중엔 안 바뀜
        const moveIds: (string | null)[] = activeMoveIds(side);
        const moves = moveIds
          .filter((id): id is string => id !== null)
          .map((id) => getMove(id))
          .filter((m): m is NonNullable<typeof m> => m !== undefined);
        // 구애스카프: 이미 잠긴 기술이 있으면(대전 시작 후 첫 사용 이후) 그 id를 미리 구해둔다
        const lockedMoveId = choiceLockedMoveId(side);

        return (
          <div
            key={side}
            className={`battle-fighter battle-fighter-${side}${winner === side ? " is-winner" : ""}`}
          >
            <div className="battle-fighter-head">
              <div className="battle-fighter-ident">
                {/* 2.3 B2: 배틀타워에서 상대(AI) 도구 이미지는 숨긴다. 내 포켓몬은 그대로 표기 */}
                <PokemonAvatarWithItem
                  pokemon={avatarPokemon}
                  form={avatarForm}
                  gradientTypes={illusionPokemon ? illusionPokemon.types : fighter.types}
                  size={38}
                  radius={9}
                  itemId={fighter.illusionAs || side === aiSide ? undefined : fighter.slot.item}
                />
                <span className="battle-fighter-name">
                  {displayName}
                  {/* §4: 스톤을 들어도 실제로 메가진화를 선언(hasMegaEvolved)해야 배지가 뜬다 */}
                  {!fighter.illusionAs && fighter.hasMegaEvolved && form.mega && (
                    <span className="battle-fighter-mega-tag">{megaBadgeLabel(form.mega)}</span>
                  )}
                  {fighter.currentHp <= 0 && <span className="battle-fighter-fainted"> (기절)</span>}
                  {side === aiSide && <span className="battle-fighter-ai-tag">AI</span>}
                  {side === aiSide && aiThinking && (
                    <span className="battle-ai-thinking" role="status" aria-label="AI 생각 중">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </span>
              </div>
              <div className="battle-status-tags">
                {fighter.status.condition && (
                  <span className="battle-status-tag is-major">{STATUS_LABELS[fighter.status.condition]}</span>
                )}
                {(Object.keys(fighter.volatile.active) as (keyof typeof VOLATILE_LABELS)[]).map((v) => {
                  // 사슬묶기/앙코르는 대상 기술 이름까지 같이 보여줘야 어떤 기술이
                  // 막혔는지/강제됐는지 알 수 있다.
                  const entry = fighter.volatile.active[v];
                  const moveName = entry?.moveId ? getMove(entry.moveId)?.name : undefined;
                  // 남은 턴수가 유한한 것(도발·앙코르·사슬묶기·속박·물엿범벅·혼란·졸음)만 " N턴"을
                  // 붙인다(§5-5). 뿌리박기·아쿠아링·씨뿌리기·헤롱헤롱·소금절이는 배틀 끝까지라
                  // 999 센티넬 → 표기 안 함.
                  const turns = entry && entry.turnsRemaining < 900 ? entry.turnsRemaining : undefined;
                  return (
                    <span key={v} className="battle-status-tag is-volatile">
                      {VOLATILE_LABELS[v]}
                      {moveName && `(${moveName})`}
                      {turns !== undefined && ` ${turns}턴`}
                    </span>
                  );
                })}
                {(() => {
                  // 스크린은 편(BattleSide) 단위 상태다(§6-3) — 활성 파이터가 아니라 side에서 읽는다.
                  const screens = battleSide(side)?.screens ?? {};
                  return (Object.keys(screens) as ("reflect" | "lightScreen" | "auroraVeil")[])
                    .filter((s) => screens[s] !== undefined)
                    .map((s) => (
                      <span key={s} className="battle-status-tag is-volatile">
                        {SCREEN_LABELS[s]} {screens[s]}턴
                      </span>
                    ));
                })()}
                {battleSide(side)?.wish && (
                  // 희망사항도 편 단위 큐다(§6-2). turnsRemaining 1 = 이번 턴 종료에 발동.
                  <span className="battle-status-tag is-volatile">희망사항 대기</span>
                )}
                {battleSide(side)?.healingWishPending && (
                  <span className="battle-status-tag is-volatile">치유소원 대기</span>
                )}
                {battleSide(side)?.safeguardTurnsRemaining !== undefined && (
                  // 신비의부적도 스크린과 같은 편 단위 상태다(§1-9).
                  <span className="battle-status-tag is-volatile">
                    신비의부적 {battleSide(side)?.safeguardTurnsRemaining}턴
                  </span>
                )}
                {fighter.magnetRiseTurnsRemaining !== undefined && (
                  <span className="battle-status-tag is-volatile">전자부유 {fighter.magnetRiseTurnsRemaining}턴</span>
                )}
                {fighter.smackedDown && <span className="battle-status-tag is-volatile">떨어뜨리기</span>}
                {fighter.perishCount !== undefined && (
                  <span className="battle-status-tag is-major">멸망 {fighter.perishCount}</span>
                )}
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

            {/* 2.3 B2: 배틀타워에서 상대(AI) 실능치는 숨기고, 그 자리에 상대 파티 6마리를 이미지로
                나열한다 — 출전 여부(선출된 3마리 중 무엇인지)는 표기하지 않고 기절 여부만 표기 */}
            {side === aiSide ? (
              <div className="battle-roster-icons">
                {buildableIndices(side).map((i) => {
                  const pk = pokemonAt(side, i);
                  if (!pk) return null;
                  const battleIdx = selection[side].indexOf(i);
                  const fainted = battleIdx >= 0 && (battleSide(side)?.party[battleIdx]?.currentHp ?? 1) <= 0;
                  return (
                    <div key={i} className={`battle-roster-chip${fainted ? " is-fainted" : ""}`}>
                      <PokemonAvatarWithItem pokemon={pk} size={40} radius={9} />
                      <span className="battle-roster-chip-name">{pk.name}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* 대전 중엔 셋업 카드가 안 보여서 내가 맞춘 능력치를 확인할 방법이 없었다는 피드백 반영 —
                 HP·공격·방어·특공·특방·스피드 실능치를 배틀 보드에도 그대로 노출한다. 칼춤·위협 등
                 랭크 변화는 턴 진행 중 이 표시에 즉시 반영한다(Phase 6.5 §6-2 ⑧) — HP는 랭크 대상이 아님. */
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
            )}

            {/* 파티 트래커 — 이 편 3마리의 HP·상태·기절, 활성 슬롯 표시. 상대(AI) 쪽은 선출된
                3마리가 그대로 드러나(이름·활성 슬롯) 2.3 B2의 "출전 여부 비공개"와 어긋나서
                숨긴다 — 그 칸은 위 battle-roster-icons가 대신 채운다(사용자 확인, 2.3 B2 보완). */}
            {side !== aiSide && (() => {
              const bs = side === "a" ? battleState.sideA : battleState.sideB;
              if (bs.party.length <= 1) return null;
              return (
                <div className="battle-party-tracker">
                  {bs.party.map((f, i) => {
                    // 일루전(§6-1): 위장 중인 활성 조로아크는 트래커에서도 위장 대상 이름으로 보인다.
                    const pk = getPokemon(f.illusionAs ?? f.slot.pokemonId);
                    const pct = Math.max(0, Math.min(100, (f.currentHp / f.maxHp) * 100));
                    const fainted = f.currentHp <= 0;
                    return (
                      <div
                        key={i}
                        className={`battle-party-chip${i === bs.activeIndex ? " is-active" : ""}${fainted ? " is-fainted" : ""}`}
                        title={`${pk?.name ?? "포켓몬"} · ${f.currentHp}/${f.maxHp}${f.status.condition ? ` · ${STATUS_LABELS[f.status.condition]}` : ""}`}
                      >
                        <span className="battle-party-chip-name">
                          {i === bs.activeIndex ? "▶ " : ""}
                          {pk?.name ?? "포켓몬"}
                        </span>
                        <span className="battle-party-chip-hp">
                          {fainted ? "기절" : `${f.currentHp}/${f.maxHp}`}
                          {f.status.condition && !fainted && ` · ${STATUS_LABELS[f.status.condition]}`}
                          {f.perishCount !== undefined && !fainted && ` · 멸망 ${f.perishCount}`}
                        </span>
                        <span className="battle-party-chip-bar">
                          <span
                            className={`battle-party-chip-fill${pct <= 20 ? " is-danger" : pct <= 50 ? " is-warn" : ""}`}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* ── 이번 턴 이 편의 입력 영역 ── */}
            {(() => {
              const bs = side === "a" ? battleState.sideA : battleState.sideB;
              const benchIdx = switchableIndices(side);

              // 0) AI가 조작하는 편: 기술·교체·메가진화·강제 교체·유턴류 교대를 전부 AI가 고른다.
              if (side === aiSide) {
                if (winner) return null;
                const waitingSwitch = pendingForcedSwitch?.[side] || pendingPivot?.side === side;
                return (
                  <div className="battle-struggle-notice">
                    {waitingSwitch ? "AI가 내보낼 포켓몬을 고르고 있다..." : "AI가 이번 턴 행동을 고른다"}
                  </div>
                );
              }

              // 1) 강제 교체: 활성이 기절해 다음 턴 전에 교대해야 한다
              if (pendingForcedSwitch?.[side]) {
                return (
                  <div className="battle-switch-panel">
                    <div className="battle-switch-panel-title">
                      {pokemon.name}
                      {eunNeun(pokemon.name)} 쓰러졌다!
                      <br />
                      내보낼 포켓몬을 선택하세요!
                    </div>
                    <div className="battle-switch-list">
                      {benchIdx.map((i) => (
                        <button
                          key={i}
                          type="button"
                          className="battle-switch-button"
                          onClick={() => resolveForcedSwitch(side, i)}
                        >
                          {getPokemon(bs.party[i].slot.pokemonId)?.name ?? "포켓몬"} 내보내기
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }

              // 2) 유턴류 자체 교체: 사용측 기술까지 처리된 뒤 멈춘 상태 — 나올 포켓몬을 고르면
              //    나머지 턴(상대 행동·턴 종료)이 새 포켓몬 기준으로 이어진다(§7-2).
              if (pendingPivot && pendingPivot.side === side) {
                return (
                  <div className="battle-switch-panel">
                    <div className="battle-switch-panel-title">
                      {pendingPivot.faintReplacement ? (
                        <>
                          {pokemon.name}
                          {eunNeun(pokemon.name)} 쓰러졌다!
                        </>
                      ) : pendingPivot.emergencyExit ? (
                        <>
                          {pokemon.name}의 위기회피! 위험을 피해 물러난다!
                        </>
                      ) : pendingPivot.ejectItemName ? (
                        <>
                          {pokemon.name}의 {pendingPivot.ejectItemName}! 그 자리에서 물러난다!
                        </>
                      ) : (
                        <>
                          {pokemon.name}
                          {eunNeun(pokemon.name)} 돌아온다!
                          {pendingPivot.passBaton && " (능력 변화 인계)"}
                        </>
                      )}
                      <br />
                      내보낼 포켓몬을 선택하세요!
                    </div>
                    <div className="battle-switch-list">
                      {benchIdx.map((i) => (
                        <button
                          key={i}
                          type="button"
                          className="battle-switch-button"
                          onClick={() => resolvePivot(i)}
                        >
                          {getPokemon(bs.party[i].slot.pokemonId)?.name ?? "포켓몬"} 내보내기
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }

              if (winner) return null;

              // 문어굳히기/물고버티기(도망봉인)에 걸려 있으면 자발적 교체 불가(고스트 예외).
              const trapped = isTrappedFromSwitching(fighter, battleState);
              // 난동(ver.1.9): 이어 쓰는 동안은 기술·교체 선택 자체가 없다 — 턴 진행 시 그 기술이 자동으로 나간다
              const rampageMoveId = fighter.volatile.active.rampage?.moveId;
              // 반동 턴(ver.1.9 A1): 파괴광선류를 맞힌 다음 턴은 움직일 수 없다 — 기술·교체 선택 없이 턴 진행만
              const recharging = isRecharging(fighter);
              const canSwitch =
                benchIdx.length > 0 && !fighter.chargingMoveId && !rampageMoveId && !recharging && fighter.currentHp > 0 && !trapped;
              const mode = canSwitch ? inputMode[side] : "move";

              return (
                <>
                  {canSwitch && (
                    <div className="battle-input-toggle">
                      {(["move", "switch"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`battle-input-toggle-btn${mode === m ? " is-on" : ""}`}
                          onClick={() => {
                            setInputMode((p) => ({ ...p, [side]: m }));
                            setSelected((p) => ({ ...p, [side]: null }));
                          }}
                        >
                          {m === "move" ? "기술" : "교체"}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* PR-C1b: 도망봉인(문어굳히기·물고버티기) 안내 — 교체 토글이 사라진 이유 표시 */}
                  {trapped && benchIdx.length > 0 && fighter.currentHp > 0 && (
                    <div className="battle-input-hint is-muted">교체할 수 없다! (도망봉인)</div>
                  )}

                  {/* §4: 메가진화 선언 토글 — 스톤을 들었고, 아직 안 했고, 그 편이 이번 배틀에
                      메가진화를 안 썼을 때만. 켜고 기술을 고르면 그 턴 행동 전에 메가진화. */}
                  {mode !== "switch" &&
                    !rampageMoveId &&
                    !recharging &&
                    fighter.megaStone &&
                    !battleSide(side)?.megaUsed &&
                    !fighter.hasMegaEvolved && (
                      <label className="battle-mega-toggle">
                        <input
                          type="checkbox"
                          checked={megaDeclared[side]}
                          onChange={(e) =>
                            setMegaDeclared((p) => ({ ...p, [side]: e.target.checked }))
                          }
                        />
                        {MEGA_SYMBOL_SPRITE_URL && (
                          <img
                            className="battle-mega-toggle-icon"
                            src={MEGA_SYMBOL_SPRITE_URL}
                            alt=""
                            draggable={false}
                          />
                        )}
                        <span>
                          메가진화{form.mega ? ` (${megaBadgeLabel(form.mega)})` : ""}
                        </span>
                      </label>
                    )}

                  {mode === "switch" ? (
                    <div className="battle-switch-list">
                      {benchIdx.map((i) => {
                        const chosen = selected[side]?.kind === "switch" && selected[side]!.toIndex === i;
                        return (
                          <button
                            key={i}
                            type="button"
                            className={`battle-switch-button${chosen ? " is-selected" : ""}`}
                            onClick={() => {
                              setLockWarning(null);
                              setSelected((p) => ({ ...p, [side]: { kind: "switch", toIndex: i } }));
                            }}
                          >
                            {getPokemon(bs.party[i].slot.pokemonId)?.name ?? "포켓몬"} (
                            {bs.party[i].currentHp}/{bs.party[i].maxHp})
                          </button>
                        );
                      })}
                    </div>
                  ) : rampageMoveId ? (
                    <div className="battle-struggle-notice">
                      {pokemon.name}
                      {eunNeun(pokemon.name)} {getMove(rampageMoveId)?.name ?? "기술"} 사용 중! (끝날 때까지 자동으로 계속 사용)
                    </div>
                  ) : recharging ? (
                    <div className="battle-struggle-notice">
                      {pokemon.name}
                      {eunNeun(pokemon.name)} 반동으로 움직일 수 없다! (턴 진행 시 자동으로 쉼)
                    </div>
                  ) : fighter.chargingMoveId ? (
                    <div className="battle-struggle-notice">
                      {getMove(fighter.chargingMoveId)?.name ?? "기술"} 준비 중...
                    </div>
                  ) : !isStruggling(side) ? (
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
                        selected[side]?.kind === "move" && selected[side]!.moveId === move.id ? " is-selected" : ""
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
                                ? "구애스카프 때문에 지금은 이 기술을 쓸 수 없다"
                                : restrictionMsg ?? undefined
                      }
                      onClick={() => {
                        setLockWarning(null);
                        setSelected((prev) => ({ ...prev, [side]: { kind: "move", moveId: move.id } }));
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
                    // PP 전부 0 / 구애류 잠긴 기술 PP 0 / 앙코르·도발 등으로 고를 수 있는
                    // 기술이 하나도 없음 — 어느 경우든 발버둥이 자동으로 나간다(§5-2)
                    <div className="battle-struggle-notice">
                      {pokemon.name}
                      {eunNeun(pokemon.name)} 사용할 수 있는 기술이 없다!
                      <br />
                      {pokemon.name}의 발버둥!
                    </div>
                  )}
                </>
              );
            })()}
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
      <>
        <div className={`battle-result-banner${winner === "draw" ? " is-draw" : ""}`}>
          {winner === "draw" ? "🤝 무승부! 양쪽 다 기절했어요" : `🏆 ${fighterLabel(battleState, winner)} 승리!`}
          <button type="button" className="battle-reset-button" onClick={seriesNext ? seriesNext.onNext : resetToSetup}>
            {seriesNext ? seriesNext.label : "대전 이어하기"}
          </button>
        </div>
        {learnedBattles !== null && (
          <p className="battle-ai-learned-note">AI가 이번 대전을 학습했습니다 (누적 {learnedBattles}판)</p>
        )}
      </>
    ) : pendingForcedSwitch ? (
      <div className="battle-lock-warning">내보낼 포켓몬을 선택하세요!</div>
    ) : pendingPivot ? (
      <div className="battle-lock-warning">교체 기술로 물러날 포켓몬을 선택하세요!</div>
    ) : (
      <>
        <button
          type="button"
          className="battle-start-button"
          disabled={aiThinking || (["a", "b"] as const).some(
            (side) =>
              side !== aiSide &&
              selected[side]?.kind !== "switch" &&
              !isStruggling(side) &&
              !forcedLockedAction(battleState[side]) &&
              !selected[side],
          )}
          onClick={playTurn}
        >
          턴 진행
        </button>
        {lockWarning && <div className="battle-lock-warning">{lockWarning}</div>}
        {seriesNext && (
          <p className="battle-ai-learned-note">
            배틀 프런티어 진행 중 — 결과가 나오기 전에 나가면(탭 이동·새로고침·창 닫기) 이 판은 패배로 기록되고 연승이 끊겨요.
          </p>
        )}
      </>
    )}

    <BattleTurnLog log={log} />
    </>
  );
}
