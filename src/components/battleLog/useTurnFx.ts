import { useLayoutEffect, useRef, useState } from "react";
import type { ActionLogEntry, FighterKey, TurnResult } from "../../types/battle";

/** 행동 하나가 차지하는 시간(ms) — 돌진(0.26s) → 충돌 순간(IMPACT)에 맞은 쪽 흔들림(0.32s) */
const STEP = 700;
const IMPACT = 200;
const LUNGE_PX = 14;
const EASE = "cubic-bezier(0.2, 0.9, 0.3, 1.3)";
/** 맞은 카드를 덮는 붉은 테두리 플래시(색은 --danger-strong과 같다) */
const FLASH = (alpha: number) => `0 0 0 5px rgba(209, 69, 58, ${alpha})`;

const other = (k: FighterKey): FighterKey => (k === "a" ? "b" : "a");

/**
 * 턴 결과(log의 마지막 항목)가 새로 들어오면 그 턴의 행동을 순서대로 카드에 겹쳐 재생한다(6.5 M1 G) — 엔진·상태는 그대로이고 효과만 얹는다.
 * - 데미지 기술: 쓴 쪽이 상대 쪽으로 돌진 → 맞은 쪽이 흔들리며 붉게 번쩍(급소·효과 굉장함은 더 크게, 효과 별로는 작게)
 * - 변화기: 쓴 쪽 제자리 펄스 / 막힌 행동(잠듦·마비 등): 쓴 쪽이 짧게 떨림 / 빗나감·무효: 돌진만
 * - 턴 종료 피해(독·화상 등): 맞은 쪽 약한 번쩍임
 * HP바와 기절 표시는 CSS 전환에 지연(--hp-delay·--faint-delay)을 주어 맞는 순간에 맞춘다.
 * 처음 그릴 때(이미 진행 중인 대전을 다시 열 때)는 재생하지 않고, 같은 턴의 부분 결과가 완성본으로 바뀔 때는 이미 재생한 행동을 건너뛴다.
 * 동작 줄이기에서는 전체를 생략한다(웹 애니메이션 API는 CSS 미디어 쿼리의 영향을 받지 않는다).
 * 돌려주는 값은 [a편 카드의 ref, b편 카드의 ref] — 콜백 ref(state)라 린트가 렌더 중 ref 접근으로 보지 않는다.
 */
export function useTurnFx(log: TurnResult[]) {
  const [nodeA, setNodeA] = useState<HTMLElement | null>(null);
  const [nodeB, setNodeB] = useState<HTMLElement | null>(null);
  const seen = useRef<{ turn: number; actions: number; ended: boolean } | null>(null);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const last = log[log.length - 1];
    if (!last) {
      seen.current = null;
      mounted.current = true;
      return;
    }
    const prev = seen.current;
    // 같은 턴이 이어지는 경우(부분 결과 → 완성본)에만 이전 기록을 쓰고, 아니면 새 턴으로 본다
    const same = prev && prev.turn === last.turnNumber && last.actions.length >= prev.actions;
    const doneActions = same ? prev.actions : 0;
    const endDone = same ? prev.ended : false;
    seen.current = { turn: last.turnNumber, actions: last.actions.length, ended: last.endOfTurn.length > 0 || endDone };
    // 처음 그릴 때는 기록만 하고 재생하지 않는다
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!nodeA || !nodeB || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nodes = { a: nodeA, b: nodeB };

    const hitAt: Partial<Record<FighterKey, number>> = {};
    const faintAt: Partial<Record<FighterKey, number>> = {};
    const lunge = (who: FighterKey, delay: number) => {
      const from = nodes[who].getBoundingClientRect();
      const to = nodes[other(who)].getBoundingClientRect();
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      nodes[who].animate([{ transform: "none" }, { transform: `translate(${(dx / d) * LUNGE_PX}px, ${(dy / d) * LUNGE_PX}px)`, offset: 0.45 }, { transform: "none" }], { duration: 260, delay, easing: EASE });
    };
    const shake = (who: FighterKey, amp: number, delay: number, duration = 320) => {
      nodes[who].animate(
        [{ transform: "none" }, { transform: `translateX(${-amp}px)`, offset: 0.2 }, { transform: `translateX(${amp}px)`, offset: 0.45 }, { transform: `translateX(${-amp / 2}px)`, offset: 0.7 }, { transform: "none" }],
        { duration, delay },
      );
    };
    const flash = (who: FighterKey, alpha: number, delay: number) => {
      nodes[who].animate([{ boxShadow: FLASH(alpha), offset: 0.25 }], { duration: 360, delay });
    };
    const pulse = (who: FighterKey, delay: number) => {
      nodes[who].animate([{ transform: "none" }, { transform: "scale(1.04)", offset: 0.4 }, { transform: "none" }], { duration: 260, delay, easing: EASE });
    };

    last.actions.slice(doneActions).forEach((e: ActionLogEntry, k) => {
      const start = k * STEP;
      const target = other(e.actor);
      if (e.blockedReason) {
        shake(e.actor, 3, start, 220);
      } else if (e.move.category === "status") {
        pulse(e.actor, start);
      } else if (e.hit && e.damage > 0) {
        lunge(e.actor, start);
        // 급소·효과 굉장함은 크게(둘 다면 가장 크게), 효과 별로는 작게
        const strong = e.critical || e.typeEffectiveness >= 2;
        const amp = e.critical && e.typeEffectiveness >= 2 ? 14 : strong ? 10 : e.typeEffectiveness < 1 ? 3 : 6;
        shake(target, amp, start + IMPACT);
        flash(target, strong ? 0.75 : e.typeEffectiveness < 1 ? 0.3 : 0.5, start + IMPACT);
        hitAt[target] = start + IMPACT;
        if (e.fainted) faintAt[target] = start + IMPACT + 250;
        if (e.selfFainted) faintAt[e.actor] = start + IMPACT + 250;
      } else {
        lunge(e.actor, start); // 빗나감·무효: 돌진만
      }
    });
    // 턴 종료 피해는 행동이 다 끝난 뒤 맞은 쪽만 약하게 번쩍인다(새로 들어온 턴 종료 기록만)
    if (!endDone) {
      const start = (last.actions.length - doneActions) * STEP;
      last.endOfTurn.forEach((e) => {
        if (e.damage > 0) {
          flash(e.actor, 0.3, start);
          hitAt[e.actor] = start;
        }
        if (e.fainted) faintAt[e.actor] = start + 250;
      });
    }
    // HP바·기절 표시의 CSS 전환 지연 — 같은 커밋에서 값이 바뀌므로 그리기 전에 심어 둔다(없으면 지운다)
    (["a", "b"] as const).forEach((k) => {
      const set = (name: string, ms: number | undefined) => (ms === undefined ? nodes[k].style.removeProperty(name) : nodes[k].style.setProperty(name, `${ms}ms`));
      set("--hp-delay", hitAt[k]);
      set("--faint-delay", faintAt[k]);
    });
  }, [log, nodeA, nodeB]);

  return [setNodeA, setNodeB] as const;
}
