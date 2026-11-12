import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { STATUS_LABELS } from "../../lib/battleLogLabels";
import { type BattleState } from "../../lib/battle/state";
import { statOrAccuracyLabel } from "../../lib/statLabels";
import { FIELD_DISPLAY_TYPE } from "../../lib/fieldEffects";
import { TYPE_COLORS } from "../../lib/typeColors";
import { WEATHER_ACCENT_TYPE } from "../../lib/weatherEffects";
import { createFx, other, GHOST_HEX, HAZARD, HEAL_HEX, type HazardKind, IMPACT, MOON_HEX, MOVE_FX, OUT_MS, SETTLE, STATUS_HEX, STATUS_KIND, STEP, WISH_HEX, popTags, statusFxMs } from "./turnFxPrimitives";
import { buildFxFrames, planTurnFx, type TurnFxView } from "./turnFxSchedule";
import type { ActionLogEntry, FighterKey, TurnResult } from "../../types/battle";


/** 재생 대기열(7.5 F1) — 새 로그 항목은 앞 항목 연출이 전부 끝난 뒤에 시작한다. run은 연출을 시작하고 걸리는 시간(ms)을 돌려준다 */
interface FxQueue {
  queue: (() => number)[];
  running: boolean;
  timers: number[];
}
function pump(q: FxQueue, setView: (v: TurnFxView | null) => void) {
  if (q.running) return;
  const next = q.queue.shift();
  if (!next) return setView(null);
  q.running = true;
  const ms = next();
  q.timers.push(window.setTimeout(() => {
    q.running = false;
    pump(q, setView);
  }, ms));
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
 * 7.4 E3: 교체는 나가는 카드가 상대에게서 멀어지는 쪽으로 물러나 사라지고 새 카드가 앞으로 나온다. 교체가 있는 만큼 뒤 행동 일정이 밀린다.
 * battleState는 단계 재생의 시작값(직전 턴 끝 HP)과 교체 전 포켓몬을 기억하는 데 쓴다.
 */
export function useTurnFx(log: TurnResult[], battleState: BattleState) {
  const [nodeA, setNodeA] = useState<HTMLElement | null>(null);
  const [nodeB, setNodeB] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<TurnFxView | null>(null);
  // 대전이 끝난 턴이면 결과 배너가 나타날 시각(ms) — 마지막 기절 연출이 끝난 뒤. 어느 로그 항목의 값인지 key를 붙여, 지금 로그와 안 맞으면(이전 대전 값) 쓰지 않는다
  const [result, setResult] = useState<{ key: string; ms: number } | null>(null);
  const seen = useRef<{ turn: number; actions: number; ended: boolean; switches: number } | null>(null);
  const mounted = useRef(false);
  const lastLog = useRef<TurnResult[] | null>(null);
  const fxq = useRef<FxQueue>({ queue: [], running: false, timers: [] });
  // 직전 렌더의 배틀 상태 — 다음 턴의 단계 재생 시작 HP·팝업 비율(HP 변화 ÷ 최대 HP)·교체 전 포켓몬에 쓴다
  const prevState = useRef(battleState);
  // 이번 커밋의 최신 배틀 상태 — 아래 재생 효과보다 먼저 선언해야 같은 커밋에서 새 상태를 읽는다(효과의 의존성에 넣으면 상태가 바뀔 때마다 재생이 끊긴다)
  const live = useRef(battleState);
  useLayoutEffect(() => {
    live.current = battleState;
  });

  useLayoutEffect(() => {
    const last = log[log.length - 1];
    if (!last) {
      seen.current = null;
      mounted.current = true;
      lastLog.current = log;
      const q = fxq.current;
      q.timers.forEach(clearTimeout);
      q.timers = [];
      q.queue = [];
      q.running = false;
      return;
    }
    const prev = seen.current;
    // 같은 턴이 이어지는 경우(부분 결과 → 완성본)에만 이전 기록을 쓰고, 아니면 새 턴으로 본다
    const same = prev && prev.turn === last.turnNumber && last.actions.length >= prev.actions;
    const doneActions = same ? prev.actions : 0;
    const endDone = same ? prev.ended : false;
    const doneSwitches = same ? prev.switches : 0;
    seen.current = { turn: last.turnNumber, actions: last.actions.length, ended: last.endOfTurn.length > 0 || endDone, switches: last.switches.length };
    // 처음 그릴 때는 기록만 하고 재생하지 않는다
    if (!mounted.current) {
      mounted.current = true;
      lastLog.current = log;
      return;
    }
    // 카드가 다시 붙어 효과만 다시 도는 경우(같은 로그)는 새 항목이 아니다
    if (lastLog.current === log) return;
    lastLog.current = log;
    if (!nodeA || !nodeB || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nodes = { a: nodeA, b: nodeB };
    // 이 항목이 도착한 시점의 상태 — 대기 중에 상태가 더 바뀌어도 이 항목은 자기 시점으로 재생한다
    const prevSnap = prevState.current;
    const liveSnap = live.current;
    const entryIdx = log.length - 1;
    const resultKey = `${log.length}:${last.turnNumber}`;
    const play = (): number => {
    // 이 재생이 새로 만든 애니메이션만 끝 시각에 센다(이미 돌던 CSS 애니메이션이 다음 항목을 밀지 않게)
    const existing = new Set((nodeA.parentElement ?? nodeA).getAnimations({ subtree: true }));
    const faintAt: Partial<Record<FighterKey, number>> = {};
    const board = nodeA.parentElement;
    const { lunge, shake, flash, pop, shield, aura, swapOut, swapIn, wash, debris, hazardHit, drift, moonlight, statusFx, faintFx, impact, megaFx, pulse } = createFx(nodes, board);

    const plan = planTurnFx({ last, doneActions, doneSwitches, endDone, prevSnap, liveSnap });
    const { newActions, steps, init, swaps, megas, shiftBefore, startOf, swapTime } = plan;
    swaps.forEach((sw) => {
      const t = swapTime(sw);
      if (sw.enter) swapOut(sw.side, t);
      swapIn(sw.side, t + (sw.enter ? OUT_MS : 0));
      hazardHit(sw.side, sw.messages, t + (sw.enter ? OUT_MS : 0) + 150);
    });
    megas.forEach((k) => megaFx(k, 0));
    plan.stances.forEach((s) => pop(s.side, s.to === "blade" ? "블레이드폼!" : "실드폼!", "", startOf(s.k) + IMPACT));
    // HP가 오른 편은 녹색 회복 효과, 내려간 편은 붉은 팝업 — 로그 필드를 일일이 모으지 않고 HP 단계의 증감으로 본다.
    // skip: 타격 연출(E1)이 이미 보여 준 피격 대상. hurtFlash: 턴 종료 피해는 아래 기존 번쩍임이 있어 끈다.
    const hpFx = (before: TurnFxView["hp"], after: TurnFxView["hp"], delay: number, skip?: FighterKey, hurtFlash = true) => {
      for (const s of ["a", "b"] as const) {
        const was = before[s];
        const now = after[s];
        if (was === undefined || now === undefined || now === was || s === skip) continue;
        const pct = Math.max(1, Math.round((Math.abs(now - was) / prevSnap[s].maxHp) * 100));
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
      const start = startOf(k);
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
      // 방어류: 태세에 들어가면 보호막이 퍼지고, 상대 공격을 막으면 막은 쪽 보호막이 번쩍인다(막힌 쪽은 위 else에서 돌진만 했다)
      if (e.protectStanceEntered) shield(e.actor, start, false);
      if (e.blockedByProtectMoveName) {
        shield(target, start + IMPACT, true);
        shake(target, 3, start + IMPACT);
      }
      // 길동무: 쓰면 보랏빛 기운이 감싸고, 길동무로 쓰러뜨린 공격자가 같이 쓰러질 때는 공격자 쪽에 기운이 덮친다
      if (e.protectSucceeded && e.move.protectEffect === "destinyBond") {
        aura(e.actor, start, GHOST_HEX);
        pop(e.actor, "길동무!", "", start + IMPACT, undefined, GHOST_HEX);
      }
      if (e.selfFainted && e.triggeredDestinyBond) {
        aura(target, start + IMPACT, GHOST_HEX);
        aura(e.actor, start + IMPACT + 250, GHOST_HEX, 1000);
        pop(e.actor, "길동무!", "", start + IMPACT + 250, undefined, GHOST_HEX);
      }
      // 상태이상 걸림·랭크 변화·회복/반동(HP 증감) — 매직미러로 되돌아온 상대 방향 효과는 시전자에게 간다
      const t = start + IMPACT;
      const foe = e.bouncedMoveName ? e.actor : target;
      if (e.inflictedStatus) {
        const c = STATUS_HEX[e.inflictedStatus];
        flash(foe, 0.55, t, c);
        pop(foe, `${STATUS_LABELS[e.inflictedStatus]}!`, "", t, undefined, c);
      }
      // 설치물을 깔면 그 진영(= 받는 편 카드) 위로 조각이 떨어져 내려앉는다
      const lay = (kind: HazardKind, side: FighterKey | undefined) => {
        if (!side) return;
        debris(side, kind, t);
        pop(side, `${HAZARD[kind].label}!`, "", t + 450, undefined, HAZARD[kind].hex);
      };
      lay("stealth", e.stealthRockSetForSide);
      lay("spikes", e.spikesSetForSide);
      lay("toxic", e.toxicSpikesSetForSide);
      lay("web", e.stickyWebSetForSide);
      // 특성으로 거는 경우도 같다: 독치장(맞으면 공격자 편에 독압정)·모래뿜기(맞으면 모래바람)
      if (e.toxicDebrisAbilityName) lay("toxic", e.actor);
      const weatherSet = e.setWeather ?? e.sandSpitWeather;
      if (weatherSet) wash(TYPE_COLORS[WEATHER_ACCENT_TYPE[weatherSet]], t, false);
      if (e.setField) wash(TYPE_COLORS[FIELD_DISPLAY_TYPE[e.setField]], t, true);
      if (e.setTrickRoom || e.roomChange?.on) wash(TYPE_COLORS.에스퍼, t, false);
      // 상태이상 연출(E10) — 상태이상을 거는 변화기 / 하품(졸음)·잠자기 / 상태이상으로 못 움직이는 턴 / 혼란 자멸
      if (e.move.category === "status" && !e.blockedReason) {
        if (e.inflictedStatus) statusFx(foe, STATUS_KIND[e.inflictedStatus], t);
        if (e.inflictedVolatile === "confusion") statusFx(foe, "confusion", t);
        if (e.inflictedVolatile === "attract") statusFx(foe, "attract", t);
        if (e.inflictedVolatile === "drowsy") statusFx(foe, "sleep", t);
        if (e.restSlept) statusFx(e.actor, "sleep", t);
      }
      if (e.blockedReason === "confusion") statusFx(e.actor, "confusion", start);
      else if (e.blockedReason === "status" && e.blockedByStatus) statusFx(e.actor, STATUS_KIND[e.blockedByStatus], start);
      // 기술 고유 연출(희망사항·달빛 …) — 표에 있는 기술이 성공했을 때만
      const mf = MOVE_FX[e.move.id];
      if (mf && !e.blockedReason && mf.landed(e)) {
        const who = mf.on === "self" ? e.actor : foe;
        if (mf.kind === "moon") {
          moonlight(who, t);
          aura(e.actor, t, MOON_HEX);
        } else {
          drift(who, mf.kind, t);
          if (mf.kind === "stars") aura(e.actor, t, WISH_HEX, 700);
        }
      }
      rank(e.actor, e.selfStatRises, true, t);
      rank(e.actor, e.selfStatDrops, false, t);
      rank(foe, e.opponentStatDrops, false, t);
      hpFx(k === 0 ? init : steps[k - 1], steps[k], t, !e.blockedReason && e.move.category !== "status" && e.hit && e.damage > 0 ? target : undefined);
    });
    // 턴 종료 피해는 행동이 다 끝난 뒤 맞은 쪽만 약하게 번쩍인다(새로 들어온 턴 종료 기록만)
    const endStart = newActions.length * STEP + shiftBefore(Infinity);
    if (!endDone) {
      last.endOfTurn.forEach((e) => {
        if (e.damage > 0) flash(e.actor, 0.3, endStart);
        // 상태이상 피해(화상·독·맹독)가 들어갈 때 / 하품의 졸음이 터져 잠들 때
        if (e.damage > 0 && e.statusCondition) statusFx(e.actor, STATUS_KIND[e.statusCondition], endStart);
        if (e.inflictedDelayedStatus) {
          const hex = STATUS_HEX[e.inflictedDelayedStatus];
          flash(e.actor, 0.55, endStart, hex);
          statusFx(e.actor, STATUS_KIND[e.inflictedDelayedStatus], endStart);
          pop(e.actor, `${STATUS_LABELS[e.inflictedDelayedStatus]}!`, "", endStart, undefined, hex);
        }
        // 희망사항이 이루어져 회복할 때
        if (e.wishHeal) {
          aura(e.actor, endStart, WISH_HEX);
          drift(e.actor, "stars", endStart, true);
        }
        // 상태이상 피해로 쓰러지면 기절 연출은 틱 입자가 다 끝난 뒤에(같은 카드에서 겹치지 않게, 7.5 F1)
        if (e.fainted) faintAt[e.actor] = endStart + (e.damage > 0 && e.statusCondition ? Math.max(250, statusFxMs(STATUS_KIND[e.statusCondition])) : 250);
      });
      hpFx(newActions.length ? steps[newActions.length - 1] : init, steps[newActions.length], endStart, undefined, false);
    }
    // 기절 표시의 CSS 전환 지연 — 같은 커밋에서 값이 바뀌므로 그리기 전에 심어 둔다(없으면 지운다)
    (["a", "b"] as const).forEach((k) => {
      const ms = faintAt[k];
      if (ms === undefined) nodes[k].style.removeProperty("--faint-delay");
      else nodes[k].style.setProperty("--faint-delay", `${ms}ms`);
    });
    // 기절 연출과 대전 종료 연출(E4) — 결과 배너는 마지막 기절 연출이 끝난 뒤에 나온다
    const faints = (["a", "b"] as const).flatMap((k) => (faintAt[k] === undefined ? [] : [[k, faintAt[k]] as const]));
    faints.forEach(([k, ms]) => faintFx(k, ms));
    const lastFaint = faints.length ? Math.max(...faints.map(([, ms]) => ms)) : endStart;
    if (last.winner) impact(lastFaint);
    if (last.winner) setResult({ key: resultKey, ms: lastFaint + 650 });

    const frames = buildFxFrames({ plan, last, same, doneActions, endDone, endStart, entryIdx, prevSnap, liveSnap });
    // 0ms 이하 상태는 그리기 전에 바로 적용하고(깜빡임 방지), 나머지는 타이머로 건다
    setView(frames.filter(([t]) => t <= 0).pop()![1]);
    fxq.current.timers.push(...frames.filter(([t]) => t > 0).map(([t, v]) => window.setTimeout(() => setView(v), t)));
    // 다음 항목이 시작해도 되는 시각 — 공개 일정이 끝난 뒤이자, 방금 건 웹 애니메이션(먼지·입자·팝업)과 기절 전환이 전부 끝난 뒤
    const anims = (board ?? nodeA).getAnimations({ subtree: true }).filter((an) => !existing.has(an)).map((an) => {
      const end = an.effect?.getComputedTiming().endTime;
      return typeof end === "number" && Number.isFinite(end) ? end - Number(an.currentTime ?? 0) : 0;
    });
    return Math.max(Math.max(...frames.map(([t]) => t)) + SETTLE, faints.length ? lastFaint + 450 : 0, ...anims);
    };
    fxq.current.queue.push(play);
    pump(fxq.current, setView);
  }, [log, nodeA, nodeB]);

  // 화면을 떠나면 대기 중인 재생을 버린다
  useEffect(() => {
    const q = fxq.current;
    return () => {
      q.timers.forEach(clearTimeout);
      q.timers = [];
      q.queue = [];
      q.running = false;
    };
  }, []);

  // 다음 턴이 시작할 때 읽을 직전 상태 — 위 효과보다 뒤에 선언해야 새 턴이 들어온 커밋에서도 직전 턴 끝 값을 읽는다
  useLayoutEffect(() => {
    prevState.current = battleState;
  }, [battleState]);

  const lastEntry = log[log.length - 1];
  const resultMs = lastEntry && result?.key === `${log.length}:${lastEntry.turnNumber}` ? result.ms : null;
  return [setNodeA, setNodeB, view, resultMs] as const;
}
