import { createContext, useContext } from "react";
import { opponentKey } from "../../lib/battle/state";
import type { ActionLogEntry, FighterKey } from "../../types/battle";

/**
 * 로그의 HP 수치(데미지·회복량 등)를 화면에 찍기 전에 거치는 변환. 기본은 실수치 그대로이고,
 * AI 상대전의 BattleTurnLog가 AI 쪽 포켓몬의 수치를 최대 HP 대비 "x.x%"로 바꾸는 함수를 내려준다.
 */
export const HpFormatContext = createContext<(n: number, key: FighterKey) => number | string>((n) => n);

/** 행동 한 건 안에서 "행동한 쪽(actor)"과 "맞은 쪽(defender)" 포켓몬의 HP 수치 변환기 */
export function useActionHp(action: ActionLogEntry) {
  const fmt = useContext(HpFormatContext);
  return {
    actorHp: (n: number) => fmt(n, action.actor),
    defHp: (n: number) => fmt(n, opponentKey(action.actor)),
  };
}
