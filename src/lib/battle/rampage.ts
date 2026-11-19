import { type ActionLogEntry, type FighterKey, type TurnAction } from "@/types/battle";
import { NO_STATUS_CONDITION } from "@/types/status";
import { getMove } from "@/lib/data";
import { hasVolatile, inflictVolatile } from "@/lib/volatileConditions";
import { isConfusionBlockedByField } from "@/lib/fieldEffects";
import { abilityOf, isFainted, type BattleFighterState, type BattleState } from "./state";
import { isGrounded } from "./grounding";

/**
 * 난동(ver.1.9 — 역린·꽃잎댄스·난동부리기·대격분·소란피기, 사용자 확정 설계 1.9-backlog):
 *  - 쓰는 순간 지속 턴을 정한다(첫 턴 포함 — 역린류 2턴·3턴 각 50%, 소란피기 3턴). 남은 턴은 휘발 상태 rampage(moveId)로 들고 다닌다.
 *  - 남은 턴 동안 엔진이 입력과 무관하게 그 기술을 쓴다(교체 불가). PP는 첫 턴만(preHitEffects).
 *  - 끝까지 쓰면 역린류는 혼란(이미 혼란·마이페이스·미스트필드 위 접지면 없음). 소란피기는 혼란 없음.
 *  - 도중에 끊기면(빗나감·방어에 막힘·무효·행동불능) 난동이 끝난다. **예정 마지막 턴에 끊기면 끝까지 쓴 것과 같이 혼란**(8.3 D3-fix-10, 본가·Showdown
 *    `lockedmove` — 사용자 인게임 확인으로 1.9 결정 D 번복), 그 전에 끊기면 혼란 없음. 명중한 턴 안에서 잠들면 턴 종료에 혼란 없이 조용히 풀린다(calmRampageIfAsleep).
 *  - 소란피기가 이어지는 동안 양쪽 모두 새로 잠들 수 없고(sleepBlockedByUproar), 잠든 포켓몬은 깨어난다.
 */

/** 난동 중이면 이번 턴 강제 행동(그 기술) — 입력(다른 기술·교체)은 무시한다 */
export function forcedRampageAction(fighter: BattleFighterState): TurnAction | undefined {
  const moveId = fighter.volatile.active.rampage?.moveId;
  if (!moveId || isFainted(fighter)) return undefined;
  const move = getMove(moveId);
  return move ? { kind: "move", move } : undefined;
}

/** 이번 행동이 난동을 끊는가 — 행동불능(상태이상·풀죽음·혼란 자해 등), 빗나감, 방어에 막힘, 타입·특성 무효 */
function disrupted(action: ActionLogEntry): boolean {
  return (
    !!action.blockedReason ||
    !action.hit ||
    !!action.blockedByProtectMoveName ||
    action.typeEffectiveness === 0 ||
    !!action.abilityAbsorbAbilityName ||
    !!action.soundproofBlockedByAbilityName ||
    !!action.bulletproofBlockedByAbilityName
  );
}

function endRampage(fighter: BattleFighterState): void {
  const { rampage: _removed, ...rest } = fighter.volatile.active;
  fighter.volatile = { active: rest };
}

/**
 * 역린류가 끝났을 때(정상 종료·예정 마지막 턴에 끊김) 건다. 이미 혼란·혼란 면역 특성·미스트필드 위 접지(Showdown은 출처와 무관하게 막는다)면 걸지 않는다.
 * 걸렸으면 로그 항목에 rampageConfused를 남긴다.
 */
function confuseAfterRampage(state: BattleState, fighter: BattleFighterState, action: ActionLogEntry, random: () => number): void {
  const ability = abilityOf(fighter);
  if (hasVolatile(fighter.volatile, "confusion") || ability?.immuneToConfusion) return;
  if (isConfusionBlockedByField(state.field, isGrounded(state, fighter, ability))) return;
  fighter.volatile = inflictVolatile(fighter.volatile, "confusion", random);
  action.rampageConfused = true;
}

/**
 * 턴 종료: 난동 중인데 잠들어 있으면(이번 턴에 명중한 뒤 느린 상대의 수면 기술·하품으로 잠듦) 혼란 없이 조용히 푼다 — Showdown `lockedmove.onResidual`의 "calming".
 * 끊김·예정 마지막 턴은 updateRampage가 이미 정리하므로 이 시점까지 남은 난동은 "이번 턴에 명중했고 아직 마지막 턴이 아닌" 경우뿐이다.
 * 하품(졸음) 수면 부여 뒤에 불러야 하품으로 잠든 경우를 잡는다(하품 `onResidualOrder: 23`이 `lockedmove`(순서 없음 = 맨 뒤)보다 먼저).
 */
export function calmRampageIfAsleep(fighter: BattleFighterState): void {
  if (fighter.volatile.active.rampage && fighter.status.condition === "sleep") endRampage(fighter);
}

/** 행동 직후 난동 상태를 갱신한다(시작·이어가기·끝나면 혼란·끊기면 혼란 없이 종료). 로그 표시는 action에 남긴다 */
export function updateRampage(state: BattleState, key: FighterKey, action: ActionLogEntry, random: () => number): void {
  const fighter = state[key];
  if (action.actorPokemonId !== fighter.slot.pokemonId) return;
  const kind = action.move.rampage;
  const entry = fighter.volatile.active.rampage;
  if (!kind) {
    if (entry) endRampage(fighter);
    return;
  }
  if (isFainted(fighter) || disrupted(action)) {
    const wasFinalTurn = entry?.turnsRemaining === 1; // 예정 마지막 턴에 끊겼나(Showdown trueDuration ≤ 1). 1턴째 끊김은 entry가 아직 없다
    if (entry) endRampage(fighter);
    if (wasFinalTurn && kind === "confuse" && !isFainted(fighter)) confuseAfterRampage(state, fighter, action, random);
    return;
  }
  if (!entry) {
    const total = kind === "uproar" ? 3 : random() < 0.5 ? 2 : 3;
    fighter.volatile = { active: { ...fighter.volatile.active, rampage: { turnsRemaining: total - 1, moveId: action.move.id } } };
    return;
  }
  const left = entry.turnsRemaining - 1;
  if (left > 0) {
    fighter.volatile = { active: { ...fighter.volatile.active, rampage: { ...entry, turnsRemaining: left } } };
    return;
  }
  endRampage(fighter);
  action.rampageEnded = true;
  if (kind === "confuse") confuseAfterRampage(state, fighter, action, random);
}

/**
 * 소란피기: 나와 있는 누군가가 소란 중이면 양쪽 모두 잠들 수 없다(상태이상 면역 판정이 이 표시를 본다). 잠든 포켓몬은 깨운다 —
 * 깨운 포켓몬 이름을 소란을 일으킨 행동(action)에 남긴다.
 */
export function refreshUproar(state: BattleState, action?: ActionLogEntry): void {
  const actives = [state.a, state.b];
  const active = actives.some((f) => !isFainted(f) && getMove(f.volatile.active.rampage?.moveId ?? "")?.rampage === "uproar");
  for (const f of actives) {
    f.sleepBlockedByUproar = active || undefined;
    if (active && f.status.condition === "sleep" && !isFainted(f)) {
      f.status = { ...NO_STATUS_CONDITION };
      if (action) action.uproarWokeIds = [...(action.uproarWokeIds ?? []), f.slot.pokemonId];
    }
  }
}
