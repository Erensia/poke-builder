import type { ReactNode } from "react";
import { getPokemon, getMove } from "../../lib/data";
import { getEffectiveForm, megaBadgeLabel } from "../../lib/pokemonForm";
import { MEGA_SYMBOL_SPRITE_URL } from "../../lib/sprites";
import { TYPE_COLORS } from "../../lib/typeColors";
import { eunNeun } from "../../lib/josa";
import { isRecharging } from "../../lib/battle/lockedAction";
import { isTrappedFromSwitching } from "../../lib/battle/switching";
import type { Pokemon } from "../../types/pokemon";
import type { Side } from "./shared";
import type { BattleBoardProps } from "./battleBoardTypes";
import { canPlayTurn } from "./battleRules";

/** 교체 후보 한 마리 — 벤치(교체 가능한) 슬롯의 파티 인덱스와 표시 정보 */
interface BenchOption {
  index: number;
  name: string;
  currentHp: number;
  maxHp: number;
}

/** 교체할 포켓몬을 고르는 패널 — 강제 교체(기절)와 유턴류 자체 교체가 같은 모양이고 눌렀을 때 하는 일만 다르다(7.0 R-4) */
function SwitchPanel({ title, bench, onPick }: { title: ReactNode; bench: BenchOption[]; onPick: (index: number) => void }) {
  return (
    <div className="battle-switch-panel">
      <div className="battle-switch-panel-title">
        {title}
        <br />
        내보낼 포켓몬을 선택하세요!
      </div>
      <div className="battle-switch-list">
        {bench.map((b) => (
          <button key={b.index} type="button" className="battle-switch-button" onClick={() => onPick(b.index)}>
            {b.name} 내보내기
          </button>
        ))}
      </div>
    </div>
  );
}

/** 한 편의 이번 턴 입력 영역 — AI 대기·강제 교체·유턴류 교대·기술/교체 선택·메가진화 토글 */
export function BattleFighterInput(props: BattleBoardProps & { side: Side; pokemon: Pokemon; /** 사람이 고를 게 없는 턴을 자동으로 진행하기 전 쉬는 중(8.1 U8-b) */ autoWaiting?: boolean }) {
  const { side, pokemon, battleState, winner, selected, setSelected, inputMode, setInputMode, megaDeclared, setMegaDeclared, pendingForcedSwitch, pendingPivot, setLockWarning, activeMoveIds, battleSide, switchableIndices, resolveForcedSwitch, resolvePivot, isStruggling, aiSide, playTurn } = props;
  const fighter = battleState[side];
  const form = getEffectiveForm(pokemon, fighter.slot);
  const moveIds: (string | null)[] = activeMoveIds(side);
  const moves = moveIds
    .filter((id): id is string => id !== null)
    .map((id) => getMove(id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined);
  // 구애스카프: 이미 잠긴 기술이 있으면(대전 시작 후 첫 사용 이후) 그 id를 미리 구해둔다
  const bs = side === "a" ? battleState.sideA : battleState.sideB;
  const benchIdx = switchableIndices(side);
  const bench: BenchOption[] = benchIdx.map((i) => ({
    index: i,
    name: getPokemon(bs.party[i].slot.pokemonId)?.name ?? "포켓몬",
    currentHp: bs.party[i].currentHp,
    maxHp: bs.party[i].maxHp,
  }));

  // 0) AI가 조작하는 편: 기술·교체·메가진화·강제 교체·유턴류 교대를 전부 AI가 고른다.
  if (side === aiSide) {
    if (winner) return null;
    const waitingSwitch = pendingForcedSwitch?.[side] || pendingPivot?.side === side;
    return (
      <div className="battle-struggle-notice">
        {waitingSwitch ? "AI가 내보낼 포켓몬을 고르고 있다..." : props.autoWaiting ? "AI가 기술을 선택하는 중..." : "AI가 이번 턴 행동을 고른다"}
      </div>
    );
  }

  // 1) 강제 교체: 활성이 기절해 다음 턴 전에 교대해야 한다
  if (pendingForcedSwitch?.[side]) {
    return (
      <SwitchPanel
        title={
          battleState[side].currentHp > 0 ? (
            // 미래예지 적중 위기회피(8.3 A4-b): 활성이 살아 있는 채 물러난다
            <>
              {pokemon.name}의 위기회피! 위험을 피해 물러난다!
            </>
          ) : (
            <>
              {pokemon.name}
              {eunNeun(pokemon.name)} 쓰러졌다!
            </>
          )
        }
        bench={bench}
        onPick={(i) => resolveForcedSwitch(side, i)}
      />
    );
  }

  // 2) 유턴류 자체 교체: 사용측 기술까지 처리된 뒤 멈춘 상태 — 나올 포켓몬을 고르면
  //    나머지 턴(상대 행동·턴 종료)이 새 포켓몬 기준으로 이어진다(§7-2).
  if (pendingPivot && pendingPivot.side === side) {
    return (
      <SwitchPanel
        title={
          pendingPivot.faintReplacement ? (
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
          )
        }
        bench={bench}
        onPick={resolvePivot}
      />
    );
  }

  if (winner) return null;

  // 문어굳히기/물고버티기(도망봉인)에 걸려 있으면 자발적 교체 불가(고스트 예외).
  const trapped = isTrappedFromSwitching(fighter, battleState);
  // 난동(ver.1.9): 이어 쓰는 동안은 기술·교체 선택 자체가 없다 — 턴 진행 시 그 기술이 자동으로 나간다
  const rampageMoveId = fighter.volatile.active.rampage?.moveId;
  // 반동 턴(ver.1.9 A1): 파괴광선류를 맞힌 다음 턴은 움직일 수 없다 — 기술·교체 선택 없이 턴 진행만
  const recharging = isRecharging(fighter);
  const canSwitch = benchIdx.length > 0 && !fighter.chargingMoveId && !rampageMoveId && !recharging && fighter.currentHp > 0 && !trapped;
  const mode = canSwitch ? inputMode[side] : "move";
  // 8.1 U8-b: AI 상대면 이미 고른 기술·교체를 한 번 더 눌러 턴을 진행한다. 힌트는 자리를 항상 잡고 보이기만 바꿔 카드 높이가 흔들리지 않게 한다
  const tapToPlay = aiSide !== null && canPlayTurn(props);
  const tapHint = aiSide !== null && (
    <div className={`battle-tap-hint${selected[side] ? " is-on" : ""}`} aria-hidden={!selected[side]}>
      한 번 더 누르면 턴 진행
    </div>
  );

  return (
    <>
      {/* 교체할 수 없어도(남은 포켓몬이 없거나 도망봉인·반동 등) 알약은 두고 교체만 비활성으로 — 양쪽 모양을 통일한다(7.5) */}
      <div className="battle-input-toggle">
        {(["move", "switch"] as const).map((m) => (
          <button
            key={m}
            type="button"
            disabled={m === "switch" && !canSwitch}
            className={`battle-input-toggle-btn tap-target${mode === m ? " is-on" : ""}`}
            onClick={() => {
              setInputMode((p) => ({ ...p, [side]: m }));
              setSelected((p) => ({ ...p, [side]: null }));
            }}
          >
            {m === "move" ? "기술" : "교체"}
          </button>
        ))}
      </div>

      {/* PR-C1b: 도망봉인(문어굳히기·물고버티기) 안내 — 교체 알약이 비활성인 이유 표시 */}
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
          <label className="toggle-pill tap-target battle-mega-toggle">
            <input
              type="checkbox"
              checked={megaDeclared[side]}
              onChange={(e) => setMegaDeclared((p) => ({ ...p, [side]: e.target.checked }))}
            />
            {MEGA_SYMBOL_SPRITE_URL && (
              <img className="battle-mega-toggle-icon" src={MEGA_SYMBOL_SPRITE_URL} alt="" draggable={false} />
            )}
            <span>메가진화{form.mega ? ` (${megaBadgeLabel(form.mega)})` : ""}</span>
          </label>
        )}

      {mode === "switch" ? (
        <>
        <div className="battle-switch-list">
          {bench.map((b) => {
            const chosen = selected[side]?.kind === "switch" && selected[side]!.toIndex === b.index;
            return (
              <button
                key={b.index}
                type="button"
                className={`battle-switch-button${chosen ? " is-selected" : ""}`}
                onClick={() => {
                  if (chosen && tapToPlay) return playTurn();
                  setLockWarning(null);
                  setSelected((p) => ({ ...p, [side]: { kind: "switch", toIndex: b.index } }));
                }}
              >
                {b.name} ({b.currentHp}/{b.maxHp})
              </button>
            );
          })}
        </div>
        {tapHint}
        </>
      ) : rampageMoveId ? (
        <div className="battle-struggle-notice">
          {pokemon.name}
          {eunNeun(pokemon.name)} {getMove(rampageMoveId)?.name ?? "기술"} 사용 중! (끝날 때까지 자동으로 계속 사용)
        </div>
      ) : recharging ? (
        <div className="battle-struggle-notice">
          {pokemon.name}
          {eunNeun(pokemon.name)} 반동으로 움직일 수 없다! (자동으로 쉼)
        </div>
      ) : fighter.chargingMoveId ? (
        <div className="battle-struggle-notice">{getMove(fighter.chargingMoveId)?.name ?? "기술"} 준비 중...</div>
      ) : !isStruggling(side) ? (
        <>
          <div className="battle-move-grid">
            {moves.map((move) => {
              const pp = fighter.remainingPp[move.id] ?? move.pp;
              const disabled = pp <= 0 || fighter.currentHp <= 0 || !!winner;
              // 셋업 카드의 party-move-pip와 동일하게 기술 타입 배경색을 입힌다.
              const moveColor = move.type ? TYPE_COLORS[move.type] : undefined;
              const chosen = selected[side]?.kind === "move" && selected[side]!.moveId === move.id;
              return (
                <button
                  key={move.id}
                  type="button"
                  className={`battle-move-button${moveColor ? " has-type" : ""}${chosen ? " is-selected" : ""}`}
                  style={moveColor ? { background: moveColor } : undefined}
                  disabled={disabled}
                  onClick={() => {
                    if (chosen && tapToPlay) return playTurn();
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
          {tapHint}
        </>
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
}
