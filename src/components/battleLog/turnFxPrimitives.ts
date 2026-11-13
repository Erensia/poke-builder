import { typeColorRgba, TYPE_COLORS } from "../../lib/typeColors";
import type { StatusCondition } from "../../types/status";
import type { ActionLogEntry, EntryHazardTrigger, FighterKey } from "../../types/battle";

/** 행동 하나가 차지하는 시간(ms) — 돌진(0.26s) → 충돌 순간(IMPACT)에 맞은 쪽 흔들림(0.32s) */
export const STEP = 700;
export const IMPACT = 200;
const LUNGE_PX = 14;
const EASE = "cubic-bezier(0.2, 0.9, 0.3, 1.3)";
/** 맞은 카드를 덮는 테두리 플래시 — 기술 타입 색(없으면 붉은색, --danger-strong과 같다) */
const FLASH = (alpha: number, hex?: string) => `0 0 0 5px ${hex ? typeColorRgba(hex, alpha) : `rgba(209, 69, 58, ${alpha})`}`;
/** 피해 팝업에 붙는 문구 — 급소·상성(둘 다면 둘 다) */
/** 상태이상 걸림 번쩍임·팝업 색 — 앱의 타입 색을 빌린다 */
export const STATUS_HEX: Record<StatusCondition, string> = { burn: TYPE_COLORS.불꽃, poison: TYPE_COLORS.독, "badly-poisoned": TYPE_COLORS.독, paralysis: TYPE_COLORS.전기, freeze: TYPE_COLORS.얼음, sleep: TYPE_COLORS.에스퍼 };
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
export const statusFxMs = (kind: StatusFxKind) => {
  const { n, gap, mode } = STATUS_FX[kind];
  return (n - 1) * gap + (mode === "spark" ? 650 : kind === "burn" ? 800 : 1100);
};
export const STATUS_KIND: Record<StatusCondition, StatusFxKind> = { burn: "burn", poison: "poison", "badly-poisoned": "poison", paralysis: "paralysis", sleep: "sleep", freeze: "freeze" };
/** 회복 번쩍임 색(--safe 계열) */
export const HEAL_HEX = "#4caf6d";
/** 길동무 보랏빛 기운 — 고스트 타입 색(#684870)은 다크 테마에서 안 보여 더 밝게 잡았다 */
export const GHOST_HEX = "#9b6fd0";
/** 설치물(스텔스록 등) — 설치할 때 카드 위로 떨어지는 조각과, 등장 시 발동하는 팝업에 쓴다(7.4 E9b) */
export const HAZARD = {
  stealth: { label: "스텔스록", hex: "#a08c6a" },
  spikes: { label: "압정뿌리기", hex: "#9aa3ad" },
  toxic: { label: "독압정", hex: "#a06cd5" },
  web: { label: "끈적끈적네트", hex: "#7d8597" },
} as const;
export type HazardKind = keyof typeof HAZARD;
/** 엔진이 교체 기록(hazardTriggers)에 남기는 설치물 발동 → 연출 종류(8.3 B2 — 문구 검색을 대체). 독압정 흡수는 종류가 아니라 별도 팝업이라 뺀다 */
const HAZARD_KIND: Record<Exclude<EntryHazardTrigger, "toxicSpikesAbsorbed">, HazardKind> = { stealthRock: "stealth", spikes: "spikes", toxicSpikes: "toxic", stickyWeb: "web" };
/** 기술 고유 연출 입자(7.4 E9c) — n개가 카드 위에서 오르거나(기본) 내린다. 모양은 CSS(.battle-fx-float.is-종류) */
const FLOAT = { stars: { n: 5 } } as const;
type FloatKind = keyof typeof FLOAT;
/**
 * 기술별 고유 연출 표 — 기술 id → 연출 종류·대상·성공 판정. 새 기술은 한 줄 추가한다.
 * 달빛(보름달이 빛을 내리쬔다)은 E2의 회복 번쩍임 위에 얹는 기술 고유 모양이다. 상태이상을 거는 기술은 기술별이 아니라 상태이상 종류별로 따로 다룬다(E10).
 */
export const MOVE_FX: Record<string, { kind: FloatKind | "moon"; on: "self" | "foe"; landed: (e: ActionLogEntry) => boolean }> = {
  희망사항: { kind: "stars", on: "self", landed: (e) => e.inflictedVolatile === "wish" },
  달빛: { kind: "moon", on: "self", landed: (e) => (e.healedAmount ?? 0) > 0 },
};
export const MOON_HEX = "#e2cf6a";
export const WISH_HEX = "#f5c542";
export const popTags = (e: ActionLogEntry) => [e.critical && "급소!", e.typeEffectiveness >= 2 && "효과 굉장!", e.typeEffectiveness < 1 && "별로…"].filter(Boolean).join(" ");
/** 마지막 공개 뒤 줄이 나타나는 모션(0.25s)이 끝나도록 기다렸다가 재생 상태를 걷는다 */
export const SETTLE = 350;
/** 교체 한 번이 차지하는 시간(ms) — 나가는 카드가 뒤로 물러나고(OUT_MS) 새 카드가 앞으로 나온다. 그만큼 뒤 행동 일정이 밀린다(7.4 E3) */
export const SWITCH_MS = 700;
export const OUT_MS = 300;
/** 턴 종료 시점의 교체(미래예지 적중 레드카드, 8.3 A4-b)가 턴 종료 줄이 나온 뒤 시작하기까지의 간격(ms) — 일정을 밀지 않고 그 시각에 겹쳐 시작한다 */
export const END_SWAP_MS = 450;
const SWITCH_PX = 26;
/** 메가진화 연출(7.4 E8) — 빛이 모여드는 MEGA_PEAK(ms)에 폼이 바뀌고, 터져 나가며 MEGA_MS가 끝난다. 그만큼 그 턴 일정이 밀린다 */
export const MEGA_MS = 1000;
export const MEGA_PEAK = 500;
const MEGA_HEX = "#d86cff";

export const other = (k: FighterKey): FighterKey => (k === "a" ? "b" : "a");

/** 카드 둘(a·b)과 판(board) 위에 그리는 연출 도구 한 벌 — 호출 한 번의 재생이 쓰고, 도구마다 delay(ms)에 맞춰 Web Animations로 시작한다 */
export function createFx(nodes: Record<FighterKey, HTMLElement>, board: HTMLElement | null) {
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
  // 등장하는 편에 설치물이 발동했을 때(엔진이 교체 기록의 hazardTriggers로 남긴다) — 설치물 색 번쩍임·흔들림과 이름 팝업. 독압정 흡수 팝업은 4종 뒤에 낸다(쌓이는 순서 보존)
  const hazardHit = (who: FighterKey, triggers: EntryHazardTrigger[], delay: number) => {
    triggers.forEach((t) => {
      if (t === "toxicSpikesAbsorbed") return;
      const kind = HAZARD_KIND[t];
      flash(who, 0.6, delay, HAZARD[kind].hex);
      shake(who, 4, delay, 260);
      pop(who, `${HAZARD[kind].label}!`, "", delay, undefined, HAZARD[kind].hex);
    });
    if (triggers.includes("toxicSpikesAbsorbed")) pop(who, "독압정 제거!", "", delay, undefined, HAZARD.toxic.hex);
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
  return { lunge, shake, flash, pop, shield, aura, swapOut, swapIn, wash, debris, hazardHit, drift, moonlight, statusFx, faintFx, impact, megaFx, pulse };
}
