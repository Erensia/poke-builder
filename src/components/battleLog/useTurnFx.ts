import { useLayoutEffect, useRef, useState } from "react";
import { STATUS_LABELS } from "../../lib/battleLogLabels";
import type { BattleState } from "../../lib/battle/state";
import { statOrAccuracyLabel } from "../../lib/statLabels";
import { FIELD_DISPLAY_TYPE } from "../../lib/fieldEffects";
import { TYPE_COLORS, typeColorRgba } from "../../lib/typeColors";
import { WEATHER_ACCENT_TYPE } from "../../lib/weatherEffects";
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
/** 길동무 보랏빛 기운 — 고스트 타입 색(#684870)은 다크 테마에서 안 보여 더 밝게 잡았다 */
const GHOST_HEX = "#9b6fd0";
/** 설치물(스텔스록 등) — 설치할 때 카드 위로 떨어지는 조각과, 등장 시 발동하는 팝업에 쓴다(7.4 E9b) */
const HAZARD = {
  stealth: { label: "스텔스록", hex: "#a08c6a" },
  spikes: { label: "압정뿌리기", hex: "#9aa3ad" },
  toxic: { label: "독압정", hex: "#a06cd5" },
  web: { label: "끈적끈적네트", hex: "#7d8597" },
} as const;
type HazardKind = keyof typeof HAZARD;
/** 설치물이 발동하면 엔진이 교체 기록(entryMessages)에 남기는 문구의 일부 — 발동 정보가 필드가 아니라 문구뿐이다 */
const HAZARD_TRIGGERS: [HazardKind, string][] = [
  ["stealth", "뾰족한 바위"],
  ["spikes", "압정에 상처"],
  ["toxic", "몸에 독이 퍼졌다"],
  ["toxic", "몸에 맹독이 퍼졌다"],
  ["web", "끈적끈적네트에 걸려"],
];
const popTags = (e: ActionLogEntry) => [e.critical && "급소!", e.typeEffectiveness >= 2 && "효과 굉장!", e.typeEffectiveness < 1 && "별로…"].filter(Boolean).join(" ");
/** 마지막 공개 뒤 줄이 나타나는 모션(0.25s)이 끝나도록 기다렸다가 재생 상태를 걷는다 */
const SETTLE = 350;
/** 교체 한 번이 차지하는 시간(ms) — 나가는 카드가 뒤로 물러나고(OUT_MS) 새 카드가 앞으로 나온다. 그만큼 뒤 행동 일정이 밀린다(7.4 E3) */
const SWITCH_MS = 700;
const OUT_MS = 300;
const SWITCH_PX = 26;

const other = (k: FighterKey): FighterKey => (k === "a" ? "b" : "a");

/**
 * 재생 중인 턴의 보이는 상태(7.4 E7) — 로그 줄 공개와 HP 표시를 이펙트 일정에 맞춘다.
 * null이면 재생이 아니다(전부 공개·실제 HP).
 */
export interface TurnFxView {
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
  const seen = useRef<{ turn: number; actions: number; ended: boolean; switches: number } | null>(null);
  const mounted = useRef(false);
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
    // 방어류 보호막(벌집 무늬는 CSS 배경) — 태세에 들어갈 때(stance)는 육각 막이 퍼졌다가 오래 남고, 공격을 막는 순간(hit)은 한 번 강하게 번쩍인다
    const shield = (who: FighterKey, delay: number, hit: boolean) => {
      const el = document.createElement("div");
      el.className = "battle-fx-shield";
      nodes[who].append(el);
      el.animate(
        hit
          ? [{ opacity: 0, transform: "scale(0.98)" }, { opacity: 1, transform: "scale(1.06)", offset: 0.2 }, { opacity: 0, transform: "scale(1.02)" }]
          : [{ opacity: 0, transform: "scale(0.85)" }, { opacity: 0.9, transform: "scale(1)", offset: 0.2 }, { opacity: 0.6, transform: "scale(1)", offset: 0.8 }, { opacity: 0, transform: "scale(1)" }],
        { duration: hit ? 500 : STEP + IMPACT + 400, delay, easing: "ease-out", fill: "both" },
      ).onfinish = () => el.remove();
    };
    // 카드를 감싸는 은은한 빛(길동무 보랏빛 기운)
    const aura = (who: FighterKey, delay: number, hex: string, duration = 900) => {
      nodes[who].animate([{ boxShadow: `0 0 0 0 ${typeColorRgba(hex, 0)}` }, { boxShadow: `0 0 26px 8px ${typeColorRgba(hex, 0.85)}`, offset: 0.4 }, { boxShadow: `0 0 0 0 ${typeColorRgba(hex, 0)}` }], { duration, delay });
    };
    // 교체 모션 — 나가는 카드는 상대에게서 멀어지는 쪽으로 물러나며 사라지고, 들어오는 카드는 그쪽에서 앞으로 나온다
    const away = (who: FighterKey) => {
      const me = nodes[who].getBoundingClientRect();
      const op = nodes[other(who)].getBoundingClientRect();
      const dx = me.left + me.width / 2 - (op.left + op.width / 2);
      const dy = me.top + me.height / 2 - (op.top + op.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      return [(dx / d) * SWITCH_PX, (dy / d) * SWITCH_PX] as const;
    };
    const swapOut = (who: FighterKey, delay: number) => {
      const [x, y] = away(who);
      const gone = { transform: `translate(${x}px, ${y}px) scale(0.9)`, opacity: 0 };
      nodes[who].animate([{ transform: "none", opacity: 1 }, { ...gone, offset: 0.9 }, gone], { duration: OUT_MS + 40, delay, easing: "ease-in" });
    };
    const swapIn = (who: FighterKey, delay: number) => {
      const [x, y] = away(who);
      nodes[who].animate(
        [{ transform: `translate(${x}px, ${y}px) scale(0.9)`, opacity: 0 }, { transform: `translate(${-x * 0.4}px, ${-y * 0.4}px) scale(1.04)`, opacity: 1, offset: 0.65 }, { transform: "none", opacity: 1 }],
        { duration: 420, delay, easing: "ease-out", fill: "backwards" },
      );
    };
    // 판 전체를 한 번 훑는 색 물결(날씨·필드·룸이 바뀔 때) — 필드는 바닥에서 올라오고 나머지는 판 전체가 물든다
    const board = nodeA.parentElement;
    const wash = (hex: string, delay: number, fromBottom: boolean) => {
      if (!board) return;
      const el = document.createElement("div");
      el.className = "battle-fx-wash";
      el.style.background = fromBottom
        ? `linear-gradient(to top, ${typeColorRgba(hex, 0.85)}, transparent 90%)`
        : `radial-gradient(ellipse at center, ${typeColorRgba(hex, 0.5)}, transparent 80%)`;
      board.append(el);
      el.animate(
        [{ opacity: 0, transform: fromBottom ? "translateY(35%)" : "scale(0.9)" }, { opacity: 1, transform: "none", offset: 0.35 }, { opacity: 0, transform: "none" }],
        { duration: 1500, delay, easing: "ease-out", fill: "both" },
      ).onfinish = () => el.remove();
    };
    // 설치물 조각이 카드 위로 떨어진다(설치할 때). 바위·가시·독 방울은 왼쪽부터 일정한 리듬으로, 거미줄은 위치·시점·회전·깊이가 제각각이다
    const debris = (who: FighterKey, kind: HazardKind, delay: number) => {
      const h = nodes[who].offsetHeight;
      const loose = kind === "web";
      [10, 26, 42, 58, 74, 90].forEach((even, i) => {
        const el = document.createElement("div");
        el.className = `battle-fx-debris is-${kind}`;
        el.style.left = `${loose ? 6 + Math.random() * 88 : even}%`;
        const spin = loose ? (Math.random() * 2 - 1) * 220 : (i % 2 ? 1 : -1) * (40 + i * 25);
        const depth = h * (loose ? 0.6 + Math.random() * 0.26 : 0.78);
        nodes[who].append(el);
        el.animate(
          [
            { opacity: 0, transform: `translateY(${loose ? -20 - Math.random() * 30 : -30}px) rotate(0deg)` },
            { opacity: 1, offset: 0.2 },
            { opacity: 1, transform: `translateY(${depth}px) rotate(${spin}deg)`, offset: 0.75 },
            { opacity: 0, transform: `translateY(${depth + h * 0.04}px) rotate(${spin}deg)` },
          ],
          { duration: loose ? 750 + Math.random() * 350 : 900, delay: delay + (loose ? Math.random() * 400 : i * 50), easing: "ease-in", fill: "both" },
        ).onfinish = () => el.remove();
      });
    };
    // 등장하는 편에 설치물이 발동했을 때(엔진이 입장 문구로만 남긴다) — 설치물 색 번쩍임·흔들림과 이름 팝업
    const hazardHit = (who: FighterKey, messages: string[], delay: number) => {
      const hits = new Set(HAZARD_TRIGGERS.filter(([, text]) => messages.some((m) => m.includes(text))).map(([kind]) => kind));
      hits.forEach((kind) => {
        flash(who, 0.6, delay, HAZARD[kind].hex);
        shake(who, 4, delay, 260);
        pop(who, `${HAZARD[kind].label}!`, "", delay, undefined, HAZARD[kind].hex);
      });
      if (messages.some((m) => m.includes("독압정을 흡수"))) pop(who, "독압정 제거!", "", delay, undefined, HAZARD.toxic.hex);
    };
    const pulse = (who: FighterKey, delay: number) => {
      nodes[who].animate([{ transform: "none" }, { transform: "scale(1.04)", offset: 0.4 }, { transform: "none" }], { duration: 260, delay, easing: EASE });
    };

    const newActions = last.actions.slice(doneActions);
    // HP 단계(공개·HP 일정표와 회복·피해 팝업이 같이 쓴다). 교체가 있었던 편은 중간값 없이 실제 HP를 쓴다.
    const swapped = new Set(last.switches.map((s) => s.side));
    const startHp = { a: prevState.current.a.currentHp, b: prevState.current.b.currentHp };
    const steps = hpSteps(startHp, newActions, endDone ? [] : last.endOfTurn, swapped);
    const init = hpSteps(startHp, [], [], swapped)[0];
    // 교체 일정 — after: 이 새 행동 번호 뒤에 일어난다(-1 = 행동 전 교체, 이미 재생한 행동 뒤의 교체도 -1). 유턴류는 쓴 쪽의 행동 뒤, 끌려나온 교체는 상대의 행동 뒤
    // enter: 나가는 포켓몬이 있는 교체(강제 교체 합성 카드의 fromIndex -1은 들어오는 모션만)
    // 이미 재생한 교체는 건너뛴다 — 양쪽이 유턴을 쓰면 결과가 두 번(선공 교체 뒤 중간 결과, 후공 교체 뒤 완성본)에 걸쳐 들어오는데 완성본에도 선공 교체가 들어 있다
    const swaps = last.switches.slice(doneSwitches).map((sw) => {
      const idx = sw.afterMove ? last.actions.findIndex((a) => a.actor === (sw.forced ? other(sw.side) : sw.side)) : -1;
      return { side: sw.side, enter: sw.fromIndex >= 0, afterMove: !!sw.afterMove, after: Math.max(idx - doneActions, -1), messages: sw.entryMessages };
    });
    const groups = [...new Set(swaps.map((s) => s.after))];
    // 행동 k의 시작 시각 — 그보다 앞서 일어난 교체 그룹 수만큼 SWITCH_MS씩 밀린다
    const startOf = (k: number) => k * STEP + groups.filter((g) => g < k).length * SWITCH_MS;
    const swapAt = (g: number) => (g < 0 ? 0 : startOf(g) + IMPACT + 150);
    swaps.forEach((sw) => {
      const t = swapAt(sw.after);
      if (sw.enter) swapOut(sw.side, t);
      swapIn(sw.side, t + (sw.enter ? OUT_MS : 0));
      hazardHit(sw.side, sw.messages, t + (sw.enter ? OUT_MS : 0) + 150);
    });
    // HP가 오른 편은 녹색 회복 효과, 내려간 편은 붉은 팝업 — 로그 필드를 일일이 모으지 않고 HP 단계의 증감으로 본다.
    // skip: 타격 연출(E1)이 이미 보여 준 피격 대상. hurtFlash: 턴 종료 피해는 아래 기존 번쩍임이 있어 끈다.
    const hpFx = (before: TurnFxView["hp"], after: TurnFxView["hp"], delay: number, skip?: FighterKey, hurtFlash = true) => {
      for (const s of ["a", "b"] as const) {
        const was = before[s];
        const now = after[s];
        if (was === undefined || now === undefined || now === was || s === skip) continue;
        const pct = Math.max(1, Math.round((Math.abs(now - was) / prevState.current[s].maxHp) * 100));
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
      rank(e.actor, e.selfStatRises, true, t);
      rank(e.actor, e.selfStatDrops, false, t);
      rank(foe, e.opponentStatDrops, false, t);
      hpFx(k === 0 ? init : steps[k - 1], steps[k], t, !e.blockedReason && e.move.category !== "status" && e.hit && e.damage > 0 ? target : undefined);
    });
    // 턴 종료 피해는 행동이 다 끝난 뒤 맞은 쪽만 약하게 번쩍인다(새로 들어온 턴 종료 기록만)
    const endStart = newActions.length * STEP + groups.length * SWITCH_MS;
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
    // 나가는 모션이 끝날 때까지 교체하는 편의 카드는 교체 전 포켓몬을 보여 준다(showPrev).
    // ponytail: 로그에 없는 HP 변화(드물다)는 SETTLE 뒤 재생이 끝날 때 실제 HP로 맞춰지고, 유턴 전에 맞은 HP는 나가는 카드에 반영되지 않는다.
    // 날씨·필드가 바뀌는 시각 — 그때까지는 이전 날씨·필드를 보여 준다(상태는 이미 턴 끝 값이라 안 그러면 연출보다 먼저 배경이 바뀐다)
    const envTimes = newActions.flatMap((e, k) => (e.setWeather || e.sandSpitWeather || e.setField || e.destroyedField ? [startOf(k) + IMPACT] : []));
    if (!endDone && (last.weatherExpired || last.fieldExpired)) envTimes.push(endStart);
    // 특성으로 펼쳐지는 날씨·필드(그래스메이커·가뭄 등)는 로그에 기술이 없다 — 상태를 직전과 비교해 기술이 설명하지 못하는 변화는
    // 새 포켓몬이 나오는 순간(교체가 없으면 턴 시작)에 배경·입자가 부드럽게 나타나게 한다. 색 물결은 교체 모션 위에 얹으면 튀어서 뺐다.
    const entryAt = swaps.length ? Math.min(...swaps.map((s) => swapAt(s.after) + (s.enter ? OUT_MS : 0))) : 0;
    const now = live.current;
    const was = prevState.current;
    if (now.weather && now.weather !== was.weather && !newActions.some((e) => e.setWeather || e.sandSpitWeather)) envTimes.push(entryAt);
    if (now.field && now.field !== was.field && !newActions.some((e) => e.setField)) envTimes.push(entryAt);
    const envAt = envTimes.length ? Math.min(...envTimes) : -1;
    const outUntil = swaps.filter((s) => s.enter).map((s) => ({ side: s.side, until: swapAt(s.after) + OUT_MS }));
    // 행동 전 교체 줄은 그 교체의 새 포켓몬이 나오는 순간(나가는 모션이 끝난 뒤)에 공개한다
    // 이어지는 결과(중간 → 완성본)에서는 행동 전 교체 줄이 이미 나와 있으니 다시 숨기지 않는다
    const preAt = same ? 0 : Math.max(0, ...swaps.filter((s) => !s.afterMove).map((s) => (s.enter ? OUT_MS : 0)));
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
          prev: prevState.current,
          env: envAt >= 0 && t < envAt ? { weather: prevState.current.weather, field: prevState.current.field } : undefined,
        },
      ];
    });
    // 0ms 이하 상태는 그리기 전에 바로 적용하고(깜빡임 방지), 나머지는 타이머로 건다
    setView(frames.filter(([t]) => t <= 0).pop()![1]);
    const timers = frames.filter(([t]) => t > 0).map(([t, v]) => setTimeout(() => setView(v), t));
    timers.push(setTimeout(() => setView(null), Math.max(...frames.map(([t]) => t)) + SETTLE));
    return () => {
      timers.forEach(clearTimeout);
      setView(null);
    };
  }, [log, nodeA, nodeB]);

  // 다음 턴이 시작할 때 읽을 직전 상태 — 위 효과보다 뒤에 선언해야 새 턴이 들어온 커밋에서도 직전 턴 끝 값을 읽는다
  useLayoutEffect(() => {
    prevState.current = battleState;
  }, [battleState]);

  return [setNodeA, setNodeB, view] as const;
}
