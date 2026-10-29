import { getPokemon, getMove } from "../../lib/data";
import { eulReul, eunNeun } from "../../lib/josa";
import { choiceLockedMoveOf, hasUsableMove, type BattleSide, type BattleState } from "../../lib/battle/state";
import type { PartySlot } from "../../types/party";
import { type Side } from "./shared";

/** 배틀 상태(+ 대전 시작 때의 편측 파티)에서 읽기만 하는 규칙들 — 활성 포켓몬·기술 제약(구애·도발·사슬묶기·앙코르 등)·발버둥 판정 */
export function battleRules(battleState: BattleState | null, partySlots: { a: PartySlot[]; b: PartySlot[] }) {

  const battleSide = (side: Side): BattleSide | undefined =>
    side === "a" ? battleState?.sideA : battleState?.sideB;
  /** 배틀 중 이 편의 현재 활성 포켓몬(종) */
  const activePokemon = (side: Side) =>
    battleState ? getPokemon(battleState[side].slot.pokemonId) : undefined;
  /**
   * 배틀 중 이 편의 현재 활성 슬롯이 지닌 기술 4개(셋업 PartySlot에서 되짚음). 단, 변신/괴짜로
   * 상대 기술을 복제한 상태(fighter.transformed)면 셋업 때의 원본 기술(메타몽이면 "변신" 하나뿐)이
   * 아니라 실제로 복제된 fighter.remainingPp의 키를 써야 한다 — 전에는 이 구분이 없어서 변신 후에도
   * 계속 "변신" 하나만 낼 수 있던 버그가 있었다(ver.1.6).
   */
  const activeMoveIds = (side: Side): (string | null)[] => {
    const fighter = battleState?.[side];
    if (fighter?.transformed) return Object.keys(fighter.remainingPp);
    const idx = battleSide(side)?.activeIndex ?? 0;
    return partySlots[side][idx]?.moves ?? [];
  };

  /**
   * 구애류 잠금: 엔진 state(choiceLockedMoveOf — 지금 지닌 도구가 구애류이고 그 도구로 기술을 쓴 뒤)를 그대로 읽는다.
   * 트랙 M1 이전에는 로그를 훑어 처음 편성한 도구 기준으로 판정해, 도구를 잃거나 트릭으로 주고받아도 잠금이 그대로였다.
   */
  function choiceLockedMoveId(side: Side): string | null {
    if (!battleState) return null;
    return choiceLockedMoveOf(battleState[side], battleState);
  }

  /**
   * 이번 턴 이 쪽이 발버둥을 자동으로 내야 하는지. PP 남은 기술이 하나도 없거나(hasUsableMove),
   * 구애류 도구로 특정 기술에 잠겼는데 그 기술의 PP가 0이 됐으면(다른 기술 PP가 남아 있어도
   * 잠금 때문에 못 씀) 발버둥이 나간다.
   */
  function isStruggling(side: Side): boolean {
    if (!battleState) return false;
    const fighter = battleState[side];
    if (!hasUsableMove(fighter)) return true;
    const locked = choiceLockedMoveId(side);
    if (locked !== null && (fighter.remainingPp[locked] ?? 0) <= 0) return true;
    // 이번 턴 실제로 고를 수 있는 기술이 하나도 없으면 발버둥(본가 규칙, 백로그 §7-5):
    //  - 앙코르로 변화기가 강제됐는데 도발/사슬묶기로 그 기술을 못 씀
    //  - 앙코르 강제 기술의 PP가 0
    //  - 도발 상태에서 지닌 기술이 전부 변화기
    const anySelectable = activeMoveIds(side).some((id) => {
      if (!id) return false;
      if ((fighter.remainingPp[id] ?? getMove(id)?.pp ?? 0) <= 0) return false;
      if (locked !== null && id !== locked) return false;
      return moveRestrictionMessage(side, id) === null;
    });
    return !anySelectable;
  }

  /**
   * 도발/사슬묶기/앙코르: 이 쪽이 지금 이 기술을 고르면 왜 안 되는지(있다면) 문구로 돌려준다.
   * 구애스카프(choiceLockedMoveId)와 달리 판정 엔진(배틀 엔진)의 volatile 상태를 그대로
   * 읽는다 — 로그를 다시 훑을 필요 없이 battleState에 이미 반영돼있다.
   */
  function moveRestrictionMessage(side: Side, moveId: string): string | null {
    if (!battleState) return null;
    const fighter = battleState[side];
    const pokemonName = activePokemon(side)?.name ?? "포켓몬";
    if (fighter.volatile.active.taunt && getMove(moveId)?.category === "status") {
      return `${pokemonName}${eunNeun(pokemonName)} 도발에 걸려 변화기를 쓸 수 없다!`;
    }
    const disableEntry = fighter.volatile.active.disable;
    if (disableEntry && disableEntry.moveId === moveId) {
      const disabledName = getMove(moveId)?.name ?? "그 기술";
      return `${disabledName}${eunNeun(disabledName)} 사슬묶기에 걸려 쓸 수 없다!`;
    }
    const encoreEntry = fighter.volatile.active.encore;
    if (encoreEntry?.moveId && encoreEntry.moveId !== moveId) {
      const forcedName = getMove(encoreEntry.moveId)?.name ?? "그 기술";
      return `${pokemonName}${eunNeun(pokemonName)} 앙코르 때문에 ${forcedName}만 사용할 수 있다!`;
    }
    if (battleState.gravityTurnsRemaining !== undefined && getMove(moveId)?.blockedByGravity) {
      const movename = getMove(moveId)?.name ?? "그 기술";
      return `${pokemonName}${eunNeun(pokemonName)} 중력 때문에 ${movename}${eulReul(movename)} 사용하지 못한다!`;
    }
    if (fighter.volatile.active.torment && fighter.lastMoveId === moveId) {
      return `${pokemonName}${eunNeun(pokemonName)} 트집 때문에 같은 기술을 연속으로 쓸 수 없다!`;
    }
    const opponent = battleState[side === "a" ? "b" : "a"];
    if (opponent.volatile.active.imprison && opponent.remainingPp[moveId] !== undefined) {
      const movename = getMove(moveId)?.name ?? "그 기술";
      return `${pokemonName}${eunNeun(pokemonName)} 봉인 때문에 ${movename}${eulReul(movename)} 사용하지 못한다!`;
    }
    return null;
  }

  /** 이 편이 이번 턴 실제로 고를 수 있는 기술 id — 기술 버튼·턴 진행 검사와 같은 규칙 */
  function selectableMoveIds(side: Side): string[] {
    if (!battleState) return [];
    const fighter = battleState[side];
    const locked = choiceLockedMoveId(side);
    return activeMoveIds(side).filter(
      (id): id is string =>
        id !== null &&
        (fighter.remainingPp[id] ?? getMove(id)?.pp ?? 0) > 0 &&
        (locked === null || id === locked) &&
        moveRestrictionMessage(side, id) === null,
    );
  }

  /** 이 편에서 지금 교대로 내보낼 수 있는 슬롯(활성 아님 + 안 쓰러짐) */
  function switchableIndices(side: Side): number[] {
    const bs = battleSide(side);
    if (!bs) return [];
    return bs.party.map((f, i) => ({ f, i })).filter(({ f, i }) => i !== bs.activeIndex && f.currentHp > 0).map(({ i }) => i);
  }

  return { battleSide, activePokemon, activeMoveIds, choiceLockedMoveId, isStruggling, moveRestrictionMessage, selectableMoveIds, switchableIndices };
}
