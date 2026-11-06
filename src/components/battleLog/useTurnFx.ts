import { useLayoutEffect, useRef, useState } from "react";
import { STATUS_LABELS } from "../../lib/battleLogLabels";
import { statOrAccuracyLabel } from "../../lib/statLabels";
import { TYPE_COLORS, typeColorRgba } from "../../lib/typeColors";
import type { StatusCondition } from "../../types/status";
import type { ActionLogEntry, EndOfTurnLogEntry, FighterKey, TurnResult } from "../../types/battle";

/** 행동 하나가 차지하는 시간(ms) — 돌진(0.26s) → 충돌 순간(IMPACT)에 맞은 쪽 흔들림(0.32s) */
const STEP = 700;
const IMPACT = 200;
const LUNGE_PX = 14;
const EASE = "cubic-bezier(0.2, 0.9, 0.3, 1.3)";
/** 맞은 카드를 덮는 테두리 플래시 — 기술 타입 색(없으면 붉은색, --danger-strong과 같다) */
const FLASH = (alpha: number, hex?: string) => `0 0 0 5px ${hex ? typeColorRgba(hex, alpha) : `rgba(209, 69, 58, ${alpha})`}`;
/** 피해 팝업에 붙는 문구 — 급소·상성(둘 다면 둘 다) */
/** 상태이상 걸림 번쩍임·팝업 색 — 앱의 타입 색을 빌린다 */
const STATUS_HEX: Record<StatusCondition, string> = { burn: TYPE_COLORS.불꽃, poison: TYPE_COLORS.독, "badly-poisoned": TYPE_COLORS.독, paralysis: TYPE_COLORS.전기, freeze: TYPE_COLORS.얼음, sleep: TYPE_COLORS.에스퍼 };
/** 회복 번쩍임 색(--safe 계열) */
const HEAL_HEX = "#4caf6d";
const popTags = (e: ActionLogEntry) => [e.critical && "급소!", e.typeEffectiveness >= 2 && "효과 굉장!", e.typeEffectiveness < 1 && "별로…"].filter(Boolean).join(" ");
/** 마지막 공개 뒤 줄이 나타나는 모션(0.25s)이 끝나도록 기다렸다가 재생 상태를 걷는다 */
const SETTLE = 350;

const other = (k: FighterKey): FighterKey => (k === "a" ? "b" : "a");

/**
 * 재생 중인 턴의 보이는 상태(7.4 E7) — 로그 줄 공개와 HP 표시를 이펙트 일정에 맞춘다.
 * null이면 재생이 아니다(전부 공개·실제 HP).
 */
export interface TurnFxView {
  /** 앞에서부터 공개된 행동 수 */
  actions: number;
  /** 턴 종료 줄·꼬리 줄이 공개됐는지 */
  end: boolean;
  /** 지금 보여줄 HP(편별). 없는 편은 실제 HP — 교체가 있었던 편은 카드 안 포켓몬이 바뀌어 중간값을 안 쓴다 */
  hp: Partial<Record<FighterKey, number>>;
}

/**
 * 한 턴의 HP 단계 — 시작 HP에서 행동마다 로그의 남은 HP(행동 후 양쪽 HP)로, 마지막에 턴 종료 항목의 남은 HP로 바꾼 값의 열.
 * 길이는 새 행동 수 + 1(마지막이 턴 종료 뒤). skip에 든 편은 카드 안 포켓몬이 바뀌어 중간값이 의미 없어 뺀다.
 */
export function hpSteps(start: Record<FighterKey, number>, actions: ActionLogEntry[], endOfTurn: EndOfTurnLogEntry[], skip: ReadonlySet<FighterKey>) {
  const cur: TurnFxView["hp"] = {};
  for (const k of ["a", "b"] as const) if (!skip.has(k)) cur[k] = start[k];
  const steps = actions.map((e) => {
    for (const s of ["a", "b"] as const) if (s in cur) cur[s] = e.actor === s ? e.attackerRemainingHp : e.defenderRemainingHp;
    return { ...cur };
  });
  for (const e of endOfTurn) if (e.actor in cur) cur[e.actor] = e.remainingHp;
  steps.push({ ...cur });
  return steps;
}

/**
 * 턴 결과(log의 마지막 항목)가 새로 들어오면 그 턴의 행동을 순서대로 카드에 겹쳐 재생한다(6.5 M1 G) — 엔진·상태는 그대로이고 효과만 얹는다.
 * - 데미지 기술: 쓴 쪽이 상대 쪽으로 돌진 → 맞은 쪽이 흔들리며 붉게 번쩍(급소·효과 굉장함은 더 크게, 효과 별로는 작게)
 * - 변화기: 쓴 쪽 제자리 펄스 / 막힌 행동(잠듦·마비 등): 쓴 쪽이 짧게 떨림 / 빗나감·무효: 돌진만
 * - 턴 종료 피해(독·화상 등): 맞은 쪽 약한 번쩍임
 * 7.4 E7: 로그 줄과 HP(바·숫자)는 상태가 이미 턴 끝 값이라 그대로 두면 이펙트보다 먼저 바뀐다 — 그래서 돌려주는 view로
 * 행동 블록을 충돌 순간에, 턴 종료 줄을 턴 종료 시각에 공개하고, HP는 행동마다 로그의 남은 HP로 단계 재생한다.
 * 기절 표시는 CSS 전환에 지연(--faint-delay)을 주어 쓰러지는 순간에 맞춘다.
 * 처음 그릴 때(이미 진행 중인 대전을 다시 열 때)는 재생하지 않고, 같은 턴의 부분 결과가 완성본으로 바뀔 때는 이미 재생한 행동을 건너뛴다.
 * 동작 줄이기(prefers-reduced-motion)에서는 이펙트·공개 지연을 전부 생략한다(웹 애니메이션 API는 CSS 미디어 쿼리의 영향을 받지 않는다).
 * 돌려주는 값은 [a편 카드의 ref, b편 카드의 ref, view] — 콜백 ref(state)라 린트가 렌더 중 ref 접근으로 보지 않는다.
 * hp는 두 편 활성 포켓몬의 실제(턴 끝) HP — 단계 재생의 시작값(직전 턴 끝 HP)을 기억하는 데 쓴다.
 */
export function useTurnFx(log: TurnResult[], hp: Record<FighterKey, number>, maxHp: Record<FighterKey, number>) {
  const [nodeA, setNodeA] = useState<HTMLElement | null>(null);
  const [nodeB, setNodeB] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<TurnFxView | null>(null);
  const seen = useRef<{ turn: number; actions: number; ended: boolean } | null>(null);
  const mounted = useRef(false);
  // 직전 렌더 값 — 다음 턴의 단계 재생 시작 HP와 팝업 비율(HP 변화 ÷ 최대 HP)에 쓴다
  const prevHp = useRef(hp);
  const prevMaxHp = useRef(maxHp);

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
    const flash = (who: FighterKey, alpha: number, delay: number, hex?: string) => {
      nodes[who].animate([{ boxShadow: FLASH(alpha, hex), offset: 0.25 }], { duration: 360, delay });
    };
    // 카드 위로 떠오르는 팝업(피해 "-45%"·회복 "+12%"·상태 "화상!"·랭크 "▲ 공격") — 상대 실수치를 숨기려고 비율만 쓴다. 끝나면 스스로 지운다.
    // 같은 카드에 같은 시각으로 여러 개가 겹치면 아래로 비켜 쌓는다.
    const popAt = new Map<string, number>();
    const pop = (who: FighterKey, text: string, cls: string, delay: number, tag?: string, color?: string) => {
      const el = document.createElement("div");
      el.className = `battle-fx-pop ${cls}`;
      el.textContent = text;
      if (tag) el.append(Object.assign(document.createElement("small"), { textContent: tag }));
      if (color) {
        el.style.color = color;
        el.style.borderColor = color;
      }
      const key = `${who}:${delay}`;
      const stacked = popAt.get(key) ?? 0;
      popAt.set(key, stacked + 1);
      if (stacked) el.style.top = `calc(10% + ${stacked * 2.6}rem)`;
      nodes[who].append(el);
      el.animate(
        [
          { opacity: 0, transform: "translateY(8px) scale(0.8)" },
          { opacity: 1, transform: "translateY(-6px) scale(1.06)", offset: 0.2 },
          { opacity: 1, transform: "translateY(-18px) scale(1)", offset: 0.7 },
          { opacity: 0, transform: "translateY(-30px) scale(1)" },
        ],
        { duration: 1100, delay, easing: "ease-out", fill: "both" },
      ).onfinish = () => el.remove();
    };
    const pulse = (who: FighterKey, delay: number) => {
      nodes[who].animate([{ transform: "none" }, { transform: "scale(1.04)", offset: 0.4 }, { transform: "none" }], { duration: 260, delay, easing: EASE });
    };

    const newActions = last.actions.slice(doneActions);
    // HP 단계(공개·HP 일정표와 회복·피해 팝업이 같이 쓴다). 교체가 있었던 편은 중간값 없이 실제 HP를 쓴다.
    const swapped = new Set(last.switches.map((s) => s.side));
    const steps = hpSteps(prevHp.current, newActions, endDone ? [] : last.endOfTurn, swapped);
    const init = hpSteps(prevHp.current, [], [], swapped)[0];
    // HP가 오른 편은 녹색 회복 효과, 내려간 편은 붉은 팝업 — 로그 필드를 일일이 모으지 않고 HP 단계의 증감으로 본다.
    // skip: 타격 연출(E1)이 이미 보여 준 피격 대상. hurtFlash: 턴 종료 피해는 아래 기존 번쩍임이 있어 끈다.
    const hpFx = (before: TurnFxView["hp"], after: TurnFxView["hp"], delay: number, skip?: FighterKey, hurtFlash = true) => {
      for (const s of ["a", "b"] as const) {
        const was = before[s];
        const now = after[s];
        if (was === undefined || now === undefined || now === was || s === skip) continue;
        const pct = Math.max(1, Math.round((Math.abs(now - was) / prevMaxHp.current[s]) * 100));
        if (now > was) {
          flash(s, 0.5, delay, HEAL_HEX);
          pop(s, `+${pct}%`, "is-good", delay);
        } else {
          if (hurtFlash) flash(s, 0.3, delay);
          pop(s, `-${pct}%`, "is-bad", delay);
        }
      }
    };
    // 랭크 변화 팝업 — ▲/▼는 변화 칸 수만큼(최대 3개)
    const rank = (who: FighterKey, list: ActionLogEntry["selfStatRises"], up: boolean, delay: number) =>
      list?.forEach(({ stat, delta }) => pop(who, `${(up ? "▲" : "▼").repeat(Math.min(Math.abs(delta), 3))} ${statOrAccuracyLabel(stat)}`, up ? "is-good" : "is-bad", delay));
    newActions.forEach((e: ActionLogEntry, k) => {
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
        flash(target, strong ? 0.75 : e.typeEffectiveness < 1 ? 0.35 : 0.55, start + IMPACT, e.move.type ? TYPE_COLORS[e.move.type] : undefined);
        pop(target, `-${Math.min(100, Math.round(e.damagePercent * 100))}%`, e.typeEffectiveness >= 2 ? "is-super" : e.typeEffectiveness < 1 ? "is-weak" : "", start + IMPACT, popTags(e));
        if (e.fainted) faintAt[target] = start + IMPACT + 250;
        if (e.selfFainted) faintAt[e.actor] = start + IMPACT + 250;
      } else {
        lunge(e.actor, start); // 빗나감·무효: 돌진만
      }
      // 상태이상 걸림·랭크 변화·회복/반동(HP 증감) — 매직미러로 되돌아온 상대 방향 효과는 시전자에게 간다
      const t = start + IMPACT;
      const foe = e.bouncedMoveName ? e.actor : target;
      if (e.inflictedStatus) {
        const c = STATUS_HEX[e.inflictedStatus];
        flash(foe, 0.55, t, c);
        pop(foe, `${STATUS_LABELS[e.inflictedStatus]}!`, "", t, undefined, c);
      }
      rank(e.actor, e.selfStatRises, true, t);
      rank(e.actor, e.selfStatDrops, false, t);
      rank(foe, e.opponentStatDrops, false, t);
      hpFx(k === 0 ? init : steps[k - 1], steps[k], t, !e.blockedReason && e.move.category !== "status" && e.hit && e.damage > 0 ? target : undefined);
    });
    // 턴 종료 피해는 행동이 다 끝난 뒤 맞은 쪽만 약하게 번쩍인다(새로 들어온 턴 종료 기록만)
    const endStart = newActions.length * STEP;
    if (!endDone) {
      last.endOfTurn.forEach((e) => {
        if (e.damage > 0) flash(e.actor, 0.3, endStart);
        if (e.fainted) faintAt[e.actor] = endStart + 250;
      });
      hpFx(newActions.length ? steps[newActions.length - 1] : init, steps[newActions.length], endStart, undefined, false);
    }
    // 기절 표시의 CSS 전환 지연 — 같은 커밋에서 값이 바뀌므로 그리기 전에 심어 둔다(없으면 지운다)
    (["a", "b"] as const).forEach((k) => {
      const ms = faintAt[k];
      if (ms === undefined) nodes[k].style.removeProperty("--faint-delay");
      else nodes[k].style.setProperty("--faint-delay", `${ms}ms`);
    });

    // 공개·HP 일정표: [시각, 그 시각에 보이는 상태]. 행동 블록은 충돌 순간에, 턴 종료 줄은 턴 종료 시각에 나온다.
    // HP는 시작값(직전 턴 끝 HP)에서 행동마다 로그의 남은 HP로 바뀐다. 교체가 있었던 편은 중간값 없이 실제 HP를 쓴다.
    // ponytail: 로그에 없는 HP 변화(드물다)는 SETTLE 뒤 재생이 끝날 때 실제 HP로 맞춰진다.
    const frames: [number, TurnFxView][] = [[0, { actions: doneActions, end: endDone, hp: init }]];
    newActions.forEach((_, k) => frames.push([k * STEP + IMPACT, { actions: doneActions + k + 1, end: endDone, hp: steps[k] }]));
    if (!endDone) frames.push([endStart, { actions: last.actions.length, end: true, hp: steps[newActions.length] }]);
    // 0ms 이하 상태는 그리기 전에 바로 적용하고(깜빡임 방지), 나머지는 타이머로 건다
    setView(frames.filter(([t]) => t <= 0).pop()![1]);
    const timers = frames.filter(([t]) => t > 0).map(([t, v]) => setTimeout(() => setView(v), t));
    timers.push(setTimeout(() => setView(null), Math.max(...frames.map(([t]) => t)) + SETTLE));
    return () => {
      timers.forEach(clearTimeout);
      setView(null);
    };
  }, [log, nodeA, nodeB]);

  // 다음 턴의 단계 재생이 시작할 HP — 위 효과보다 뒤에 선언해야 새 턴이 들어온 커밋에서도 직전 턴 끝 값을 읽는다
  const { a: hpA, b: hpB } = hp;
  const { a: maxA, b: maxB } = maxHp;
  useLayoutEffect(() => {
    prevHp.current = { a: hpA, b: hpB };
    prevMaxHp.current = { a: maxA, b: maxB };
  }, [hpA, hpB, maxA, maxB]);

  return [setNodeA, setNodeB, view] as const;
}
