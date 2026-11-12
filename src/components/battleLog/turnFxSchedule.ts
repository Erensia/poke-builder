import { sideOf, type BattleState } from "../../lib/battle/state";
import type { ActionLogEntry, EndOfTurnLogEntry, FighterKey, TurnResult } from "../../types/battle";
import { END_SWAP_MS, IMPACT, MEGA_MS, MEGA_PEAK, OUT_MS, other, STEP, SWITCH_MS } from "./turnFxPrimitives";

/**
 * 재생 중인 턴의 보이는 상태(7.4 E7) — 로그 줄 공개와 HP 표시를 이펙트 일정에 맞춘다.
 * null이면 재생이 아니다(전부 공개·실제 HP).
 */
export interface TurnFxView {
  /** 재생 중인 로그 항목의 인덱스 — 그보다 뒤 항목(대기 중)은 통째로 숨기고 앞 항목은 전부 공개한다(7.5 F1) */
  entry: number;
  /** 이 항목이 끝난 시점의 배틀 상태 — 뒤 항목이 이미 상태를 바꿨어도 카드는 재생이 끝날 때까지 이 상태를 보여 준다(7.5 F1) */
  live: BattleState;
  /** 행동 전 교체 줄이 공개됐는지 — 새 포켓몬이 나오는 순간에 나온다 */
  pre: boolean;
  /** 앞에서부터 공개된 행동 수 */
  actions: number;
  /** 턴 종료 줄·꼬리 줄이 공개됐는지 */
  end: boolean;
  /** 지금 보여줄 HP(편별). 없는 편은 실제 HP — 교체가 있었던 편은 카드 안 포켓몬이 바뀌어 중간값을 안 쓴다 */
  hp: Partial<Record<FighterKey, number>>;
  /** 교체 중인 편(true)은 카드가 교체 전 포켓몬(prev)을 보여 준다 — 상태는 이미 새 포켓몬이라 물러나는 모션 동안만 붙들어 둔다(7.4 E3) */
  showPrev: Partial<Record<FighterKey, boolean>>;
  /** 이 턴이 시작하기 직전의 배틀 상태 */
  prev: BattleState;
  /** 날씨·필드가 바뀌는 행동이 공개되기 전까지 보여 줄 이전 날씨·필드(7.4 E9) — 바뀐 뒤에는 없다(실제 상태) */
  env?: Pick<BattleState, "weather" | "field">;
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
 * 한 턴 항목의 재생 일정(순수 계산) — 새 행동·HP 단계·교체·메가진화와, 그것들이 일정을 미는 시각표.
 * doneActions·doneSwitches는 같은 턴의 앞 결과(부분 결과)에서 이미 재생한 만큼이다.
 */
export function planTurnFx({ last, doneActions, doneSwitches, endDone, prevSnap, liveSnap }: { last: TurnResult; doneActions: number; doneSwitches: number; endDone: boolean; prevSnap: BattleState; liveSnap: BattleState }) {
  const newActions = last.actions.slice(doneActions);
  // HP 단계(공개·HP 일정표와 회복·피해 팝업이 같이 쓴다). 교체가 있었던 편은 중간값 없이 실제 HP를 쓴다.
  const swapped = new Set(last.switches.map((s) => s.side));
  const startHp = { a: prevSnap.a.currentHp, b: prevSnap.b.currentHp };
  const steps = hpSteps(startHp, newActions, endDone ? [] : last.endOfTurn, swapped);
  const init = hpSteps(startHp, [], [], swapped)[0];
  // 교체 일정 — after: 이 새 행동 번호 뒤에 일어난다(-1 = 행동 전 교체, 이미 재생한 행동 뒤의 교체도 -1). 유턴류는 쓴 쪽의 행동 뒤, 끌려나온 교체는 상대의 행동 뒤
  // enter: 나가는 포켓몬이 있는 교체(강제 교체 합성 카드의 fromIndex -1은 들어오는 모션만)
  // 이미 재생한 교체는 건너뛴다 — 양쪽이 유턴을 쓰면 결과가 두 번(선공 교체 뒤 중간 결과, 후공 교체 뒤 완성본)에 걸쳐 들어오는데 완성본에도 선공 교체가 들어 있다
  const swaps = last.switches.slice(doneSwitches).map((sw) => {
    const idx = sw.afterMove ? last.actions.findIndex((a) => a.actor === (sw.forced && !sw.redCardItemName ? other(sw.side) : sw.side)) : -1; // 레드카드 교체는 side가 끌려나온 공격자 자신이라 그 편의 행동 뒤(드래곤테일류만 상대 행동 뒤)
    // atEnd: 턴 종료 효과가 끝난 뒤의 교체(8.3 A4-b) — 행동 번호가 아니라 턴 종료 줄 시각 뒤에 놓는다. outgoingAlive: 살아 있는 채 물러나는 합성 카드도 나가는 모션을 보인다
    return { side: sw.side, enter: sw.fromIndex >= 0 || !!sw.outgoingAlive, afterMove: !!sw.afterMove, atEnd: !!sw.endOfTurn, after: Math.max(idx - doneActions, -1), messages: sw.entryMessages };
  });
  // 메가진화(E8) — 로그에 정보가 없어서 직전 상태와 비교한다(이번 턴 교체한 편은 제외). 행동 전에 일어난다
  const nowState = liveSnap;
  const wasState = prevSnap;
  // 같은 턴에 유턴 등으로 나간 편은 지금 상태의 활성 포켓몬이 이미 바뀌었으니, 나가기 전 자리(파티)의 포켓몬으로 본다
  const megaFighter = (k: FighterKey) => (swapped.has(k) ? sideOf(nowState, k).party[sideOf(wasState, k).activeIndex] : nowState[k]);
  const megas = (["a", "b"] as const).filter((k) => megaFighter(k)?.hasMegaEvolved && !wasState[k].hasMegaEvolved);
  // 메가진화한 채 나가는 편은 폼이 바뀐 뒤(MEGA_PEAK)부터 나가는 모션이 끝날 때까지 메가진화한 모습을 보여 준다 — HP는 아직 턴 시작 값
  const megaPrev: BattleState = { ...prevSnap };
  megas.filter((k) => swapped.has(k)).forEach((k) => (megaPrev[k] = { ...megaFighter(k), currentHp: wasState[k].currentHp }));
  // 일정을 미는 지점별 시간 — after(행동 번호 뒤, -1 = 행동 전)마다 교체는 SWITCH_MS, 메가진화는 MEGA_MS(같은 지점이면 긴 쪽)
  const gapMs = new Map<number, number>();
  swaps.filter((s) => !s.atEnd).forEach((s) => gapMs.set(s.after, Math.max(gapMs.get(s.after) ?? 0, SWITCH_MS))); // 턴 종료 교체는 일정을 밀지 않는다(밀면 턴 종료 줄이 교체보다 늦게 나온다)
  if (megas.length) gapMs.set(-1, Math.max(gapMs.get(-1) ?? 0, MEGA_MS));
  const shiftBefore = (k: number) => [...gapMs].reduce((sum, [g, ms]) => (g < k ? sum + ms : sum), 0);
  // 행동 k의 시작 시각 — 그보다 앞서 일어난 교체·메가진화 시간만큼 밀린다
  const startOf = (k: number) => k * STEP + shiftBefore(k);
  const swapAt = (g: number) => (g < 0 ? 0 : startOf(g) + IMPACT + 150);
  // 턴 종료 줄이 나오는 시각(useTurnFx의 endStart와 같다) 뒤에 턴 종료 교체를 놓는다
  const swapTime = (s: { atEnd: boolean; after: number }) => (s.atEnd ? newActions.length * STEP + shiftBefore(Infinity) + END_SWAP_MS : swapAt(s.after));
  return { newActions, swapped, steps, init, swaps, megas, megaPrev, nowState, wasState, shiftBefore, startOf, swapAt, swapTime };
}

/**
 * 공개·HP 일정표 — [시각, 그 시각에 보이는 화면 상태]의 열(순수 계산). 훅은 이 열을 타이머로 건다.
 */
export function buildFxFrames({ plan, last, same, doneActions, endDone, endStart, entryIdx, prevSnap, liveSnap }: { plan: ReturnType<typeof planTurnFx>; last: TurnResult; same: boolean | null | undefined; doneActions: number; endDone: boolean; endStart: number; entryIdx: number; prevSnap: BattleState; liveSnap: BattleState }) {
  const { newActions, steps, init, swaps, megas, megaPrev, nowState, wasState, startOf, swapTime } = plan;
  // 공개·HP 일정표: [시각, 그 시각에 보이는 상태]. 행동 블록은 충돌 순간에, 턴 종료 줄은 턴 종료 시각에 나온다.
  // HP는 시작값(직전 턴 끝 HP)에서 행동마다 로그의 남은 HP로 바뀐다. 교체가 있었던 편은 중간값 없이 실제 HP를 쓴다.
  // 나가는 모션이 끝날 때까지 교체하는 편의 카드는 교체 전 포켓몬을 보여 준다(showPrev).
  // ponytail: 로그에 없는 HP 변화(드물다)는 SETTLE 뒤 재생이 끝날 때 실제 HP로 맞춰지고, 유턴 전에 맞은 HP는 나가는 카드에 반영되지 않는다.
  // 날씨·필드가 바뀌는 시각 — 그때까지는 이전 날씨·필드를 보여 준다(상태는 이미 턴 끝 값이라 안 그러면 연출보다 먼저 배경이 바뀐다)
  const envTimes = newActions.flatMap((e, k) => (e.setWeather || e.sandSpitWeather || e.setField || e.destroyedField ? [startOf(k) + IMPACT] : []));
  if (!endDone && (last.weatherExpired || last.fieldExpired)) envTimes.push(endStart);
  // 특성으로 펼쳐지는 날씨·필드(그래스메이커·가뭄 등)는 로그에 기술이 없다 — 상태를 직전과 비교해 기술이 설명하지 못하는 변화는
  // 새 포켓몬이 나오는 순간(교체가 없으면 턴 시작)에 배경·입자가 부드럽게 나타나게 한다. 색 물결은 교체 모션 위에 얹으면 튀어서 뺐다.
  const entryAt = swaps.length ? Math.min(...swaps.map((s) => swapTime(s) + (s.enter ? OUT_MS : 0))) : 0;
  if (nowState.weather && nowState.weather !== wasState.weather && !newActions.some((e) => e.setWeather || e.sandSpitWeather)) envTimes.push(entryAt);
  if (nowState.field && nowState.field !== wasState.field && !newActions.some((e) => e.setField)) envTimes.push(entryAt);
  const envAt = envTimes.length ? Math.min(...envTimes) : -1;
  const outUntil = swaps
    .filter((s) => s.enter)
    .map((s) => ({ side: s.side, until: swapTime(s) + OUT_MS }))
    .concat(megas.map((k) => ({ side: k, until: MEGA_PEAK })));
  // 행동 전 교체 줄은 그 교체의 새 포켓몬이 나오는 순간(나가는 모션이 끝난 뒤)에 공개한다
  // 이어지는 결과(중간 → 완성본)에서는 행동 전 교체 줄이 이미 나와 있으니 다시 숨기지 않는다
  const preAt = same ? 0 : Math.max(0, ...swaps.filter((s) => !s.afterMove && !s.atEnd).map((s) => (s.enter ? OUT_MS : 0)));
  const times = [...new Set([0, preAt, ...newActions.map((_, k) => startOf(k) + IMPACT), ...(endDone ? [] : [endStart]), ...outUntil.map((o) => o.until), ...(envAt > 0 ? [envAt] : [])])].sort((x, y) => x - y);
  const frames = times.map((t): [number, TurnFxView] => {
    const shown = newActions.filter((_, k) => startOf(k) + IMPACT <= t).length;
    const endShown = endDone || t >= endStart;
    return [
      t,
      {
        pre: t >= preAt,
        actions: doneActions + shown,
        end: endShown,
        hp: endShown && shown === newActions.length ? steps[newActions.length] : shown ? steps[shown - 1] : init,
        showPrev: { a: outUntil.some((o) => o.side === "a" && t < o.until), b: outUntil.some((o) => o.side === "b" && t < o.until) },
        prev: t >= MEGA_PEAK ? megaPrev : prevSnap,
        entry: entryIdx,
        live: liveSnap,
        env: envAt >= 0 && t < envAt ? { weather: prevSnap.weather, field: prevSnap.field } : undefined,
      },
    ];
  });
  return frames;
}
