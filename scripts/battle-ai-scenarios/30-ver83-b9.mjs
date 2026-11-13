// 8.3 B9 관통드릴·보이지않는주먹: 접촉 기술이 방어류(방어·판별·킹실드·니들가드·토치카, 패스트가드는 우선도 > 0 기술만)를 뚫고 데미지가 ×0.25(4096 반올림, 최소 1)가 된다.
// 관통드릴은 옛 해석("상대 방어 랭크 상승분 무시 + 최소 25% 보장")을 버리고 보이지않는주먹과 같은 필드(`contactBypassesProtectAtQuarterDamage`)를 쓴다.
// 뚫은 뒤 방어류의 접촉 반응(킹실드 공격 −1·니들가드 HP 1/8·토치카 독)은 **발동한다**(사용자 결정 2026-11-13 — Showdown은 반응이 없지만 공식 정보를 따른다).
// 설계 `8.3-B9-관통드릴정정설계.md`, 검수 `8.3-B9-관통드릴정정설계-검수.md`(Showdown champions `965a535` 소스 판정)
import { readFileSync } from "node:fs";
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const bulky = pts({ hp: 32, def: 32, spd: 32 });
  const mv = (n) => ({ kind: "move", move: data.getMove(n) });
  const ATK = "한카리아스";
  const HIT = "막치기"; // 상대의 무동작 대용(방어류를 안 쓰는 기준선)
  const att = (move, ability = "관통드릴", points = pts({ atk: 32, spe: 32 })) => mon(ATK, [move], ability, null, points);
  const def = (moves, name = "잠만보", ability = null) => mon(name, moves, ability, null, bulky);
  const run = ({ a, b, aMove, bMove = HIT, tweak, rand = () => 0.5 }) => {
    const st = battle([a], [b]);
    tweak?.(st);
    const hpA = st.a.currentHp, hpB = st.b.currentHp, maxA = st.a.maxHp;
    const o = rt.runTurn(st, mv(aMove), mv(bMove), rand);
    const acts = (o.result ?? o.partialResult).actions;
    return { act: acts.find((x) => x.actor === "a"), n: o.nextState, hpA, hpB, maxA, dealt: hpB - o.nextState.b.currentHp };
  };
  // Showdown modify(x, 0.25) = 4096 반올림(0.5는 버림) + 최소 1
  const quarter = (x) => Math.max(1, x % 4 === 3 ? Math.floor(x / 4) + 1 : Math.floor(x / 4));
  const noGuard = (move, ability, extra = {}) => run({ a: att(move, ability), b: def([HIT]), aMove: move, ...extra });
  const guarded = (move, ability, guard, extra = {}) => run({ a: att(move, ability), b: def([guard]), aMove: move, bMove: guard, ...extra });

  for (const ability of ["관통드릴", "보이지않는주먹"]) {
    const L = ability === "관통드릴" ? "" : "(보이지않는주먹) ";
    // ── P-a: 방어를 뚫는다 ──
    { const r = guarded("아이언헤드", ability, "방어"); check(`8.3 B9 P-a: ${L}${ability} 접촉기 vs 방어 → 막히지 않고 데미지`, !r.act.blockedByProtectMoveName && r.act.hit === true && r.dealt > 0, json({ br: r.act.blockedByProtectMoveName, hit: r.act.hit, dealt: r.dealt })); }
    // ── P-b: 데미지 = max(1, 4096 반올림(방어 없을 때 × 0.25)) — 롤 16단계를 훑고 mod 4 = 3인 롤이 있어야 의미가 있다 ──
    { const mods = new Set(); const bad = [];
      for (let k = 0; k < 16; k++) { const rand = () => (k + 0.8) / 16; // 급소(r < 1/24)를 피하고 롤 단계를 하나씩 고른다
        const x = noGuard("아이언헤드", ability, { rand }).dealt, y = guarded("아이언헤드", ability, "방어", { rand }).dealt;
        mods.add(x % 4); if (y !== quarter(x)) bad.push(`${x}→${y}(기대 ${quarter(x)})`); }
      check(`8.3 B9 P-b: ${L}뚫은 데미지 = max(1, 4096 반올림(원데미지 × 0.25)), mod 4 = 3 롤 포함`, bad.length === 0 && mods.has(3), json({ mods: [...mods], bad: bad.slice(0, 3) })); }
    // ── P-f: 뚫은 뒤 방어류의 접촉 반응은 발동한다(사용자 결정, Showdown과 다름) ──
    { const k = guarded("아이언헤드", ability, "킹실드"); check(`8.3 B9 P-f: ${L}킹실드를 뚫어도 시전자 공격 −1`, !k.act.blockedByProtectMoveName && k.n.a.stages.atk === -1, json({ atk: k.n.a.stages.atk, br: k.act.blockedByProtectMoveName }));
      const n = guarded("아이언헤드", ability, "니들가드"); check(`8.3 B9 P-f: ${L}니들가드를 뚫어도 시전자 최대 HP 1/8 데미지`, !n.act.blockedByProtectMoveName && n.hpA - n.n.a.currentHp === Math.floor(n.maxA / 8), `${n.hpA} → ${n.n.a.currentHp} (1/8 = ${Math.floor(n.maxA / 8)})`);
      const t = guarded("아이언헤드", ability, "토치카"); check(`8.3 B9 P-f: ${L}토치카를 뚫어도 시전자 독`, !t.act.blockedByProtectMoveName && t.n.a.status.condition === "poison", json(t.n.a.status)); }
    // ── P-k: 접촉 다단히트 — 타수마다 ×0.25, 방어류 반응은 행동당 1회(현재 엔진 결과를 고정 — 공식 정보 없음) ──
    { const x = noGuard("더블어택", ability).dealt, y = guarded("더블어택", ability, "방어").dealt;
      check(`8.3 B9 P-k: ${L}더블어택(2타) vs 방어 → 타수마다 ×0.25 (${x} → ${y})`, x % 2 === 0 && y === 2 * quarter(x / 2), `${x} → ${y}, 기대 ${2 * quarter(x / 2)}`);
      const n = guarded("더블어택", ability, "니들가드"); check(`8.3 B9 P-k: ${L}더블어택이 니들가드를 뚫을 때 반응은 행동당 1회(HP 1/8 한 번)`, n.hpA - n.n.a.currentHp === Math.floor(n.maxA / 8), `${n.hpA} → ${n.n.a.currentHp}`); }
  }

  // ── P-c: 뚫는 방어류 전부 ──
  for (const guard of ["판별", "킹실드", "니들가드", "토치카"]) { const r = guarded("아이언헤드", "관통드릴", guard); check(`8.3 B9 P-c: 관통드릴 접촉기 vs ${guard} → 뚫음`, !r.act.blockedByProtectMoveName && r.dealt > 0, json({ br: r.act.blockedByProtectMoveName, dealt: r.dealt })); }
  // ── P-d: 패스트가드는 우선도 > 0 접촉기만 막는다 — 관통드릴이면 뚫고, 우선도 0 접촉기는 원래 안 막힘(×0.25 아님) ──
  { const r = guarded("전광석화", "관통드릴", "패스트가드"); check("8.3 B9 P-d: 관통드릴 접촉 선공기(전광석화) vs 패스트가드 → 뚫음", !r.act.blockedByProtectMoveName && r.dealt > 0, json({ br: r.act.blockedByProtectMoveName, dealt: r.dealt }));
    const c = guarded("전광석화", null, "패스트가드"); check("8.3 B9 P-d: 대조 — 관통드릴 없는 전광석화 vs 패스트가드 → 막힘", c.act.blockedByProtectMoveName === "패스트가드" && c.dealt === 0, json({ br: c.act.blockedByProtectMoveName, dealt: c.dealt }));
    const z = guarded("아이언헤드", "관통드릴", "패스트가드"), full = noGuard("아이언헤드", "관통드릴"); check("8.3 B9 P-d: 우선도 0 접촉기 vs 패스트가드 → 원래 안 막힘, 데미지는 ×0.25가 아니라 전부", z.dealt === full.dealt && z.dealt > 0, `${z.dealt} vs ${full.dealt}`); }
  // ── P-e: 비접촉기는 그대로 막힌다 ──
  { const r = guarded("지진", "관통드릴", "방어"); check("8.3 B9 P-e: 비접촉기(지진) vs 방어 → 막힘", r.act.blockedByProtectMoveName === "방어" && r.dealt === 0, json({ br: r.act.blockedByProtectMoveName, dealt: r.dealt })); }
  // ── P-g: 옛 해석 삭제 — 방어 랭크 상승분 무시도, 최소 25% 보장도 없다 ──
  { const boost = (st) => { st.b.stages = { ...st.b.stages, def: 2 }; };
    const w = noGuard("아이언헤드", "관통드릴", { tweak: boost }).dealt, n = noGuard("아이언헤드", null, { tweak: boost }).dealt;
    check("8.3 B9 P-g: 상대 방어 +2일 때 관통드릴 접촉기 데미지 = 특성 없는 같은 기술(랭크 무시 없음)", w === n && w > 0, `관통드릴 ${w} / 없음 ${n}`);
    const weak = pts({ spe: 32 }), ww = run({ a: att("막치기", "관통드릴", weak), b: def([HIT]), aMove: "막치기", tweak: null }), wn = run({ a: att("막치기", null, weak), b: def([HIT]), aMove: "막치기", tweak: null });
    check("8.3 B9 P-g: 약한 접촉기로 두꺼운 상대를 칠 때 데미지가 최대 HP 25%로 끌어올려지지 않음(= 특성 없는 경우와 같음)", ww.dealt === wn.dealt && ww.dealt < Math.floor(ww.hpB / 4), `관통드릴 ${ww.dealt} / 없음 ${wn.dealt} / 25% ${Math.floor(ww.hpB / 4)}`); }
  // ── P-h: 방어가 없는 상대에게는 특성이 아무 영향이 없다(날씨 방어 배율 포함 — contactDefenseStat 이름 정리 보호) ──
  { const w = noGuard("아이언헤드", "관통드릴").dealt, n = noGuard("아이언헤드", null).dealt; check("8.3 B9 P-h: 방어류가 없으면 관통드릴 접촉기 데미지 = 특성 없음", w === n && w > 0, `${w} vs ${n}`);
    const sand = (st) => { st.weather = "모래바람"; st.weatherTurnsRemaining = 5; };
    const dmg = (ability, tweak) => run({ a: att("드레인키스", ability), b: def([HIT], "킬라플로르"), aMove: "드레인키스", tweak }).dealt;
    const sw = dmg("관통드릴", sand), sn = dmg(null, sand), clear = dmg("관통드릴", null);
    check("8.3 B9 P-h: 모래바람 + 바위 상대의 특방 배율이 그대로 적용된다(접촉 특수기 드레인키스, 관통드릴 = 없음, 맑을 때보다 작음)", sw === sn && sw < clear, `모래 관통드릴 ${sw} / 모래 없음 ${sn} / 맑음 ${clear}`); }
  // ── P-i: B7 연동 — 관통드릴 고속스핀이 방어한 상대에게도 설치물을 제거하고 스피드가 오른다 ──
  { const r = guarded("고속스핀", "관통드릴", "방어", { tweak: (st) => { st.sideA.hazards = { ...st.sideA.hazards, stealthRock: true }; } });
    check("8.3 B9 P-i: 관통드릴 고속스핀 vs 방어 → 스텔스록 제거·스피드 +1·spinCleared·데미지", r.n.sideA.hazards.stealthRock === false && r.n.a.stages.spe === 1 && !!r.act.spinCleared && r.dealt > 0, json({ rock: r.n.sideA.hazards.stealthRock, spe: r.n.a.stages.spe, sc: r.act.spinCleared, dealt: r.dealt })); }
  // ── P-j: B8 연동 — 뚫은 접촉기의 부가 효과·벽 파괴는 정상 ──
  { const r = guarded("독찌르기", "관통드릴", "방어", { rand: () => 0.1 }); check("8.3 B9 P-j: 뚫은 독찌르기의 독이 정상 발동(B8 `damagingMoveLanded`)", r.n.b.status.condition === "poison", json(r.n.b.status));
    const s = guarded("깨트리기", "관통드릴", "방어", { tweak: (st) => { st.sideB.screens = { reflect: 5, lightScreen: 5 }; } }); check("8.3 B9 P-j: 방어를 뚫은 깨트리기가 벽을 깬다", json(s.n.sideB.screens) === "{}", json(s.n.sideB.screens)); }
  // ── P-l: 명중 판정은 정상 — 뚫어도 빗나갈 수 있다 ──
  { const r = guarded("아이언헤드", "관통드릴", "방어", { rand: () => 0.99, tweak: (st) => { st.a.accuracyStages = { accuracy: -6, evasion: 0 }; } }); check("8.3 B9 P-l: 방어를 뚫어도 빗나가면 데미지 없음", r.act.hit === false && r.dealt === 0, json({ hit: r.act.hit, dealt: r.dealt })); }
  // ── P-m: 버티기(endure)는 막는 효과가 아니라 기존대로 — 접촉기가 들어가고 1 HP로 버틴다 ──
  { const r = guarded("아이언헤드", "관통드릴", "버티기", { tweak: (st) => { st.b.currentHp = 1; } }); check("8.3 B9 P-m: 버티기 상대는 관통과 무관하게 1 HP로 버틴다(회귀)", !r.act.blockedByProtectMoveName && r.n.b.currentHp === 1, json({ hp: r.n.b.currentHp, br: r.act.blockedByProtectMoveName })); }
  // ── P-p: 극단 — 방어 없을 때 데미지가 1~3이면 뚫은 데미지는 1(최소 1) ──
  { const tiny = (st) => { st.a.realStats = { ...st.a.realStats, atk: 1 }; st.b.realStats = { ...st.b.realStats, def: 5000 }; };
    const x = noGuard("아이언헤드", "관통드릴", { tweak: tiny }).dealt, y = guarded("아이언헤드", "관통드릴", "방어", { tweak: tiny }).dealt;
    check(`8.3 B9 P-p: 원데미지 ${x}(1~3)이면 뚫은 데미지는 1`, x >= 1 && x <= 3 && y === 1, `${x} → ${y}`); }
  // ── P-q: 뿔드릴(접촉 일격기) — 방어를 뚫고 ×0.25가 아니라 일격 기절(고정 데미지 분기) ──
  { const r = guarded("뿔드릴", "관통드릴", "방어", { rand: () => 0 }); check("8.3 B9 P-q: 관통드릴 뿔드릴 vs 방어 → 뚫고 대상 기절", r.n.b.currentHp === 0, json({ hp: r.n.b.currentHp, br: r.act.blockedByProtectMoveName }));
    const c = guarded("뿔드릴", null, "방어", { rand: () => 0 }); check("8.3 B9 P-q: 대조 — 관통드릴 없는 뿔드릴 vs 방어 → 막힘", c.act.blockedByProtectMoveName === "방어" && c.n.b.currentHp === c.hpB, json({ hp: c.n.b.currentHp, br: c.act.blockedByProtectMoveName })); }
  // ── P-r: 방어류 반응과 별개로 일반 접촉 반응(까칠한피부)은 그대로 ──
  { const r = run({ a: att("아이언헤드", "관통드릴"), b: def(["방어"], "잠만보", "까칠한피부"), aMove: "아이언헤드", bMove: "방어" }); check("8.3 B9 P-r: 뚫은 접촉기가 까칠한피부 상대에게 접촉 반동(시전자 HP 감소)을 받는다", r.hpA - r.n.a.currentHp === Math.floor(r.maxA / 8), `${r.hpA} → ${r.n.a.currentHp}`); }

  // ── P-o: 데이터·타입 불변식 ──
  { const abilities = JSON.parse(readFileSync(new URL("../../src/data/abilities.json", import.meta.url), "utf8")); const list = Array.isArray(abilities) ? abilities : Object.values(abilities);
    const drill = list.find((x) => x.name === "관통드릴"), fist = list.find((x) => x.name === "보이지않는주먹");
    const OLD = "contactIgnoresDefenseBoostAndGuaranteesMinDamageFraction";
    const oldRemain = readFileSync(new URL("../../src/data/abilities.json", import.meta.url), "utf8").includes(OLD) || readFileSync(new URL("../../src/types/ability.ts", import.meta.url), "utf8").includes(OLD);
    check("8.3 B9 P-o: 관통드릴은 contactBypassesProtectAtQuarterDamage이고 옛 필드는 어디에도 없다", drill?.contactBypassesProtectAtQuarterDamage === true && !oldRemain, json({ f: drill?.contactBypassesProtectAtQuarterDamage, oldRemain }));
    const TEXT = "접촉 기술을 사용하면 상대의 방어 효과를 무시하고 1/4의 데미지를 입힐 수 있다";
    check("8.3 B9 P-o: 두 특성의 설명문이 확정 문구로 같고 \"최소\"가 없다", drill?.description?.startsWith(TEXT) && drill.description === fist?.description && !drill.description.includes("최소"), json({ d: drill?.description, f: fist?.description })); }
}
