import { opponentKey } from "../../lib/battle/state";
import type { ActionLogEntry } from "../../types/battle";

/**
 * 매직미러 반사(8.3 B6): 엔진이 반사 구간을 "방어측이 되받아쳐 쓴 것"으로 처리하므로(attacker·defender 바인딩을 통째로 맞바꾼다) 줄도 그렇게 읽는다.
 * 이름과 체력 표기 편(action.actor)을 맞바꾼 사본을 돌려준다. 반사 표시와 흉내쟁이·잠꼬대 표기는 원래 시전자의 것이라 사본에서 뺀다. 원본은 건드리지 않는다.
 */
export function reflectedView<P extends { action: ActionLogEntry; actorName: string; defenderName: string }>(p: P): P {
  const action: ActionLogEntry = { ...p.action, actor: opponentKey(p.action.actor) };
  delete action.bouncedMoveName;
  delete action.bouncedByAbilityName;
  delete action.copycatCalledMoveName;
  delete action.sleepTalkCalledMoveName;
  return { ...p, actorName: p.defenderName, defenderName: p.actorName, action };
}
