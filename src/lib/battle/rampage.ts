import { type ActionLogEntry, type FighterKey, type TurnAction } from "@/types/battle";
import { NO_STATUS_CONDITION } from "@/types/status";
import { getMove } from "@/lib/data";
import { hasVolatile, inflictVolatile } from "@/lib/volatileConditions";
import { abilityOf, isFainted, type BattleFighterState, type BattleState } from "./state";

/**
 * 난동(ver.1.9 — 역린·꽃잎댄스·난동부리기·대격분·소란피기, 사용자 확정 설계 1.9-backlog):
 *  - 쓰는 순간 지속 턴을 정한다(첫 턴 포함 — 역린류 2턴·3턴 각 50%, 소란피기 3턴). 남은 턴은 휘발 상태 rampage(moveId)로 들고 다닌다.
 *  - 남은 턴 동안 엔진이 입력과 무관하게 그 기술을 쓴다(교체 불가). PP는 첫 턴만(preHitEffects).
 *  - 끝까지 쓰면 역린류는 혼란(이미 혼란·마이페이스면 없음). 소란피기는 혼란 없음.
 *  - 도중에 끊기면(빗나감·방어에 막힘·무효·행동불능 — 마지막 턴 포함) 혼란 없이 끝난다.
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
    if (entry) endRampage(fighter);
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
  if (kind === "confuse" && !hasVolatile(fighter.volatile, "confusion") && !abilityOf(fighter)?.immuneToConfusion) {
    fighter.volatile = inflictVolatile(fighter.volatile, "confusion", random);
    action.rampageConfused = true;
  }
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
