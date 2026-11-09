import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { STATUS_LABELS } from "../../lib/battleLogLabels";
import { sideOf, type BattleState } from "../../lib/battle/state";
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
/**
 * 상태이상 연출 입자 한 벌(7.4 E10) — 기술별이 아니라 상태이상 종류별이라 새 기술도 자동으로 따라온다.
 * rise = 카드 아래쪽에서 떠오름, spark = 카드 곳곳에서 반짝임, orbit = 머리 위를 돎(혼란의 병아리). 모양은 CSS(.battle-fx-status.is-종류)
 */
type StatusFxKind = "burn" | "poison" | "paralysis" | "sleep" | "freeze" | "confusion" | "attract";
const STATUS_FX: Record<StatusFxKind, { n: number; gap: number; mode: "rise" | "spark" | "orbit"; text?: string }> = {
  burn: { n: 6, gap: 90, mode: "rise" },
  poison: { n: 7, gap: 90, mode: "rise" },
  paralysis: { n: 5, gap: 80, mode: "spark" },
  sleep: { n: 3, gap: 220, mode: "rise", text: "Z" },
  freeze: { n: 7, gap: 70, mode: "spark" },
  confusion: { n: 3, gap: 0, mode: "orbit" },
  attract: { n: 5, gap: 110, mode: "rise", text: "♥" },
};
/** 상태이상 입자 한 벌이 끝나기까지(ms) — 입자 간격 × (개수-1) + 한 입자의 길이(statusFx의 duration과 같다) */
const statusFxMs = (kind: StatusFxKind) => {
  const { n, gap, mode } = STATUS_FX[kind];
  return (n - 1) * gap + (mode === "spark" ? 650 : kind === "burn" ? 800 : 1100);
};
const STATUS_KIND: Record<StatusCondition, StatusFxKind> = { burn: "burn", poison: "poison", "badly-poisoned": "poison", paralysis: "paralysis", sleep: "sleep", freeze: "freeze" };
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
/** 기술 고유 연출 입자(7.4 E9c) — n개가 카드 위에서 오르거나(기본) 내린다. 모양은 CSS(.battle-fx-float.is-종류) */
const FLOAT = { stars: { n: 5 } } as const;
type FloatKind = keyof typeof FLOAT;
/**
 * 기술별 고유 연출 표 — 기술 id → 연출 종류·대상·성공 판정. 새 기술은 한 줄 추가한다.
 * 달빛(보름달이 빛을 내리쬔다)은 E2의 회복 번쩍임 위에 얹는 기술 고유 모양이다. 상태이상을 거는 기술은 기술별이 아니라 상태이상 종류별로 따로 다룬다(E10).
 */
const MOVE_FX: Record<string, { kind: FloatKind | "moon"; on: "self" | "foe"; landed: (e: ActionLogEntry) => boolean }> = {
  희망사항: { kind: "stars", on: "self", landed: (e) => e.inflictedVolatile === "wish" },
  달빛: { kind: "moon", on: "self", landed: (e) => (e.healedAmount ?? 0) > 0 },
};
const MOON_HEX = "#e2cf6a";
const WISH_HEX = "#f5c542";
const popTags = (e: ActionLogEntry) => [e.critical && "급소!", e.typeEffectiveness >= 2 && "효과 굉장!", e.typeEffectiveness < 1 && "별로…"].filter(Boolean).join(" ");
/** 마지막 공개 뒤 줄이 나타나는 모션(0.25s)이 끝나도록 기다렸다가 재생 상태를 걷는다 */
const SETTLE = 350;
/** 교체 한 번이 차지하는 시간(ms) — 나가는 카드가 뒤로 물러나고(OUT_MS) 새 카드가 앞으로 나온다. 그만큼 뒤 행동 일정이 밀린다(7.4 E3) */
const SWITCH_MS = 700;
const OUT_MS = 300;
const SWITCH_PX = 26;
/** 메가진화 연출(7.4 E8) — 빛이 모여드는 MEGA_PEAK(ms)에 폼이 바뀌고, 터져 나가며 MEGA_MS가 끝난다. 그만큼 그 턴 일정이 밀린다 */
const MEGA_MS = 1000;
const MEGA_PEAK = 500;
const MEGA_HEX = "#d86cff";

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

const other = (k: FighterKey): FighterKey => (k === "a" ? "b" : "a");

/**
 * 재생 중인 턴의 보이는 상태(7.4 E7) — 로그 줄 공개와 HP 표시를 이펙트 일정에 맞춘다.
 * null이면 재생이 아니다(전부 공개·실제 HP).
 */
interface TurnFxView {
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
    // 기술 고유 연출 입자 — 카드 위에서 흩어지며 오르거나(reverse면 내리며) 사라진다
    const drift = (who: FighterKey, kind: FloatKind, delay: number, reverse = false) => {
      const h = nodes[who].offsetHeight;
      const spec = FLOAT[kind];
      for (let i = 0; i < spec.n; i++) {
        const el = document.createElement("div");
        el.className = `battle-fx-float is-${kind}`;
        el.style.left = `${12 + Math.random() * 70}%`;
        el.style.top = "0";
        const dy = (reverse ? -1 : 1) * h * (0.45 + Math.random() * 0.2);
        const dx = (Math.random() * 2 - 1) * 14;
        nodes[who].append(el);
        el.animate(
          [
            { opacity: 0, transform: "translate(0, 0) scale(0.6)" },
            { opacity: 1, transform: `translate(${dx * 0.3}px, ${dy * 0.25}px) scale(1)`, offset: 0.2 },
            { opacity: 1, transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(1)`, offset: 0.7 },
            { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(0.9)` },
          ],
          { duration: 1000 + Math.random() * 300, delay: delay + i * 120, easing: "ease-out", fill: "both" },
        ).onfinish = () => el.remove();
      }
    };
    // 달빛: 카드 위에 보름달이 떠올라 아래로 빛을 내리쬔다
    const moonlight = (who: FighterKey, delay: number) => {
      const beam = document.createElement("div");
      beam.className = "battle-fx-moonbeam";
      const moon = document.createElement("div");
      moon.className = "battle-fx-moon";
      nodes[who].append(beam, moon);
      const life = { duration: 1500, delay, easing: "ease-out", fill: "both" } as const;
      beam.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], life).onfinish = () => beam.remove();
      moon.animate([{ opacity: 0, transform: "translateY(-14px) scale(0.7)" }, { opacity: 1, transform: "none", offset: 0.25 }, { opacity: 1, transform: "none", offset: 0.75 }, { opacity: 0, transform: "translateY(-6px)" }], life).onfinish = () => moon.remove();
    };
    // 상태이상 연출 입자 — 종류별 모양은 CSS, 움직임은 mode별(떠오름·반짝임·궤도). 끝나면 스스로 지운다
    const statusFx = (who: FighterKey, kind: StatusFxKind, delay: number) => {
      const node = nodes[who];
      const h = node.offsetHeight;
      const w = node.offsetWidth;
      const spec = STATUS_FX[kind];
      for (let i = 0; i < spec.n; i++) {
        const el = document.createElement("div");
        el.className = `battle-fx-status is-${kind}`;
        if (spec.text) el.textContent = spec.text;
        const at = delay + i * spec.gap;
        node.append(el);
        let anim: Animation;
        if (spec.mode === "orbit") {
          // 머리 위 타원 궤도를 도는 병아리 — 뒤쪽은 작고 흐리게, 앞쪽은 크고 선명하게. 2바퀴
          el.style.left = "50%";
          el.style.top = "4px";
          el.style.marginLeft = "-8px";
          const rx = Math.min(w * 0.3, 56);
          const phase = (i / spec.n) * Math.PI * 2;
          const frames = Array.from({ length: 25 }, (_, f) => {
            const a = phase + (f / 24) * Math.PI * 2;
            const depth = (Math.sin(a) + 1) / 2;
            return { transform: `translate(${Math.cos(a) * rx}px, ${Math.sin(a) * 9}px) scale(${0.75 + depth * 0.4})`, opacity: 0.55 + depth * 0.45 };
          });
          anim = el.animate(frames, { duration: 1100, iterations: 2, delay: at, fill: "both" });
        } else if (spec.mode === "spark") {
          el.style.left = `${8 + Math.random() * 84}%`;
          el.style.top = `${5 + Math.random() * 70}%`;
          el.style.rotate = `${Math.random() * 60 - 30}deg`;
          anim = el.animate(
            [
              { opacity: 0, transform: "scale(0.4)" },
              { opacity: 1, transform: "scale(1.2)", offset: 0.2 },
              { opacity: 0.2, transform: "scale(1)", offset: 0.4 },
              { opacity: 1, transform: "scale(1)", offset: 0.6 },
              { opacity: 0, transform: "scale(0.6)" },
            ],
            { duration: 650, delay: at, fill: "both" },
          );
        } else {
          el.style.left = `${10 + Math.random() * 76}%`;
          el.style.top = `${h * 0.6}px`;
          if (kind === "sleep") el.style.fontSize = `${0.9 + i * 0.35}rem`;
          if (kind === "poison") el.style.setProperty("--s", `${8 + Math.random() * 8}px`);
          const dy = -h * (0.35 + Math.random() * 0.2);
          const dx = (Math.random() * 2 - 1) * 14 + (kind === "sleep" ? 10 + i * 8 : 0);
          anim = el.animate(
            [
              { opacity: 0, transform: "translate(0, 0) scale(0.6)" },
              { opacity: 1, transform: `translate(${dx * 0.3}px, ${dy * 0.25}px) scale(1)`, offset: 0.2 },
              { opacity: 1, transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(1)`, offset: 0.7 },
              { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(0.9)` },
            ],
            { duration: kind === "burn" ? 800 : 1100, delay: at, easing: "ease-out", fill: "both" },
          );
        }
        anim.onfinish = () => el.remove();
      }
    };
    // 기절(E4): 카드 부분이 쿵 하고 가라앉고, 먼지가 양옆으로 퍼지고, "기절!" 팝업이 뜬다
    const faintFx = (who: FighterKey, delay: number) => {
      const node = nodes[who];
      const top = node.querySelector<HTMLElement>(".battle-fighter-top");
      top?.animate([{ transform: "none" }, { transform: "translateY(14px) rotate(-3deg) scale(0.97)", offset: 0.45 }, { transform: "none" }], { duration: 500, delay, easing: "ease-in-out" });
      const ground = top ? top.offsetTop + top.offsetHeight - 6 : node.offsetHeight * 0.5;
      for (let i = 0; i < 6; i++) {
        const el = document.createElement("div");
        el.className = "battle-fx-dust";
        el.style.top = `${ground}px`;
        el.style.left = `${38 + Math.random() * 24}%`;
        node.append(el);
        const side = i % 2 ? 1 : -1;
        el.animate(
          [
            { opacity: 0, transform: "translate(0, 0) scale(0.5)" },
            { opacity: 0.7, offset: 0.25 },
            { opacity: 0, transform: `translate(${side * (20 + Math.random() * 34)}px, ${-6 - Math.random() * 12}px) scale(1.6)` },
          ],
          { duration: 700, delay: delay + i * 30, easing: "ease-out", fill: "both" },
        ).onfinish = () => el.remove();
      }
      pop(who, "기절!", "is-bad", delay);
    };
    // 마지막 한 마리가 쓰러지는 순간 판 전체가 흔들리고 번쩍인다(대전 종료)
    const impact = (delay: number) => {
      if (!board) return;
      board.animate(
        [{ transform: "none" }, { transform: "translateX(-7px)", offset: 0.15 }, { transform: "translateX(7px)", offset: 0.35 }, { transform: "translateX(-4px)", offset: 0.55 }, { transform: "translateX(2px)", offset: 0.75 }, { transform: "none" }],
        { duration: 450, delay },
      );
      const el = document.createElement("div");
      el.className = "battle-fx-wash";
      el.style.background = "rgba(255, 255, 255, 0.65)";
      board.append(el);
      el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration: 500, delay, fill: "both" }).onfinish = () => el.remove();
    };
    // 메가진화(E8): 무지갯빛 고리가 모여들다 정점에서 하얗게 터지며 폼이 바뀌고, 반짝이가 사방으로 퍼진다
    const megaFx = (who: FighterKey, delay: number) => {
      const node = nodes[who];
      const ring = document.createElement("div");
      ring.className = "battle-fx-megaring";
      const burst = document.createElement("div");
      burst.className = "battle-fx-megaburst";
      node.append(ring, burst);
      ring.animate(
        [
          { opacity: 0, transform: "translate(-50%, -50%) scale(1.9) rotate(0deg)" },
          { opacity: 1, transform: "translate(-50%, -50%) scale(1) rotate(360deg)", offset: 0.5 },
          { opacity: 1, transform: "translate(-50%, -50%) scale(1.1) rotate(540deg)", offset: 0.6 },
          { opacity: 0, transform: "translate(-50%, -50%) scale(2.4) rotate(720deg)" },
        ],
        { duration: MEGA_MS, delay, easing: "ease-in-out", fill: "both" },
      ).onfinish = () => ring.remove();
      burst.animate([{ opacity: 0, transform: "scale(0.3)" }, { opacity: 0, offset: 0.45 }, { opacity: 1, transform: "scale(1)", offset: 0.55 }, { opacity: 0, transform: "scale(1.5)" }], { duration: MEGA_MS, delay, fill: "both" }).onfinish = () => burst.remove();
      for (let i = 0; i < 8; i++) {
        const el = document.createElement("div");
        el.className = "battle-fx-float is-stars";
        el.style.left = "50%";
        el.style.top = "38%";
        el.style.filter = `hue-rotate(${i * 45}deg)`;
        node.append(el);
        const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
        const d = 60 + Math.random() * 50;
        el.animate(
          [
            { opacity: 0, transform: "translate(-50%, -50%) scale(0.4)" },
            { opacity: 1, transform: `translate(calc(-50% + ${Math.cos(a) * d * 0.5}px), calc(-50% + ${Math.sin(a) * d * 0.5}px)) scale(1.2)`, offset: 0.3 },
            { opacity: 0, transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(0.6) rotate(${i % 2 ? 160 : -160}deg)` },
          ],
          { duration: MEGA_MS - MEGA_PEAK, delay: delay + MEGA_PEAK, easing: "ease-out", fill: "both" },
        ).onfinish = () => el.remove();
      }
      pop(who, "메가진화!", "", delay + MEGA_PEAK, undefined, MEGA_HEX);
    };
    const pulse = (who: FighterKey, delay: number) => {
      nodes[who].animate([{ transform: "none" }, { transform: "scale(1.04)", offset: 0.4 }, { transform: "none" }], { duration: 260, delay, easing: EASE });
    };

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
      const idx = sw.afterMove ? last.actions.findIndex((a) => a.actor === (sw.forced ? other(sw.side) : sw.side)) : -1;
      return { side: sw.side, enter: sw.fromIndex >= 0, afterMove: !!sw.afterMove, after: Math.max(idx - doneActions, -1), messages: sw.entryMessages };
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
    swaps.forEach((s) => gapMs.set(s.after, Math.max(gapMs.get(s.after) ?? 0, SWITCH_MS)));
    if (megas.length) gapMs.set(-1, Math.max(gapMs.get(-1) ?? 0, MEGA_MS));
    const shiftBefore = (k: number) => [...gapMs].reduce((sum, [g, ms]) => (g < k ? sum + ms : sum), 0);
    // 행동 k의 시작 시각 — 그보다 앞서 일어난 교체·메가진화 시간만큼 밀린다
    const startOf = (k: number) => k * STEP + shiftBefore(k);
    const swapAt = (g: number) => (g < 0 ? 0 : startOf(g) + IMPACT + 150);
    swaps.forEach((sw) => {
      const t = swapAt(sw.after);
      if (sw.enter) swapOut(sw.side, t);
      swapIn(sw.side, t + (sw.enter ? OUT_MS : 0));
      hazardHit(sw.side, sw.messages, t + (sw.enter ? OUT_MS : 0) + 150);
    });
    megas.forEach((k) => megaFx(k, 0));
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
    if (nowState.weather && nowState.weather !== wasState.weather && !newActions.some((e) => e.setWeather || e.sandSpitWeather)) envTimes.push(entryAt);
    if (nowState.field && nowState.field !== wasState.field && !newActions.some((e) => e.setField)) envTimes.push(entryAt);
    const envAt = envTimes.length ? Math.min(...envTimes) : -1;
    const outUntil = swaps
      .filter((s) => s.enter)
      .map((s) => ({ side: s.side, until: swapAt(s.after) + OUT_MS }))
      .concat(megas.map((k) => ({ side: k, until: MEGA_PEAK })));
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
          prev: t >= MEGA_PEAK ? megaPrev : prevSnap,
          entry: entryIdx,
          live: liveSnap,
          env: envAt >= 0 && t < envAt ? { weather: prevSnap.weather, field: prevSnap.field } : undefined,
        },
      ];
    });
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
