// 8.3 B8 상성 무효 상대에게 기술의 부가 효과가 적용되는 결함: Showdown은 상성이 무효이면 기술 전체가 실패(`-immune`)하므로
// 상태이상·풀죽음·혼란·재충전·벽 파괴 같은 부가 효과가 하나도 없어야 한다. 게이트는 `damagingMoveLanded`(명중 + 방어 안 됨 + 데미지>0 또는 대타 적중, 변화기 true).
// 변화기는 전기자석파만 타입 면역을 존중한다(`Move.respectsTypeImmunity`, Showdown `ignoreImmunity: false`).
// 설계 `8.3-B8-무효상대부가효과설계.md`, 검수 `8.3-B8-무효상대부가효과설계-검수.md`(Showdown champions `965a535` 소스 판정, V3는 사용자 확정)
import { readFileSync } from "node:fs";
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const bulky = pts({ hp: 32, def: 32, spd: 32 });
  const mv = (n) => ({ kind: "move", move: data.getMove(n) });
  const IDLE = "잠꼬대"; // 시전자의 무동작 행동(잠들어 있지 않으면 실패. 잠자기는 풀피에서도 잠들어 못 쓴다)
  const HIT = "막치기"; // 상대의 행동 — 부가효과 없는 데미지 기술. 풀죽음이면 막히므로 blockedReason "flinch"로 풀죽음을 관측한다
  const ATK = "한카리아스"; // 빠른 시전자(풀죽음이 들어가려면 먼저 움직여야 한다)
  const fighterSnap = (f) => ({ status: f.status, volatile: f.volatile, stages: f.stages, acc: f.accuracyStages, crit: f.critStage, sub: f.substituteHp, item: f.currentItemId });
  // HP는 뺀다(실패 반동·턴 종료 데미지는 허용). skipA: 자폭류처럼 시전자가 쓰러지는 기술은 시전자 쪽을 비교하지 않는다.
  // skipA(자폭류)는 시전자가 쓰러져 턴이 일찍 끝나므로 턴 종료 처리(벽 감소 등)가 달라진다 — 상대 쪽 상태만 비교한다.
  const snap = (st, skipA = false) => skipA ? json({ b: fighterSnap(st.b) }) : json({ a: fighterSnap(st.a), b: fighterSnap(st.b), sa: { s: st.sideA.screens, h: st.sideA.hazards }, sb: { s: st.sideB.screens, h: st.sideB.hazards }, w: st.weather });
  const setup = (st) => { st.sideB.screens = { reflect: 5, lightScreen: 5 }; st.sideA.hazards = { ...st.sideA.hazards, stealthRock: true }; };
  const run = ({ a, b, aMove, bMove = HIT, tweak = setup, rand = () => 0 }) => {
    const st = battle([a], [b]);
    tweak?.(st);
    const o = rt.runTurn(st, mv(aMove), mv(bMove), rand);
    const act = (o.result ?? o.partialResult).actions.find((x) => x.actor === "a");
    const actB = (o.result ?? o.partialResult).actions.find((x) => x.actor === "b");
    return { act, actB, n: o.nextState, hpA: st.a.currentHp };
  };
  const att = (move, extra = [], ability = null) => mon(ATK, [move, IDLE, ...extra], ability, null, pts({ spe: 32 }));
  const def = (name, ability = null) => mon(name, [HIT], ability, null, bulky);
  const same = (move, defName, opts = {}) => { // 같은 상황에서 시전자도 상대도 무동작이었을 때와 상태가 같은가
    const A = att(move);
    const base = run({ a: A, b: def(defName), aMove: IDLE, ...opts });
    const r = run({ a: A, b: def(defName), aMove: move, ...opts });
    const skipA = !!data.getMove(move).selfFaints;
    // 풀죽음은 턴 끝에 지워지므로 상대 행동의 blockedReason(풀죽음·행동불능)도 같이 비교한다
    const full = (x) => snap(x.n, skipA) + (skipA ? "" : json(x.actB?.blockedReason ?? null)); // 자폭류는 시전자가 먼저 쓰러져 상대 행동 기록이 달라진다
    return { ok: full(r) === full(base), r, base, skipA };
  };

  // ── B8-a: 전수 매트릭스 — 데미지 기술 × 무효 상성 ──
  const IMMUNE = { 노말: "다크펫", 격투: "다크펫", 고스트: "이어롭", 전기: "하마돈", 독: "꿈트렁", 땅: "글라이온", 에스퍼: "블래키", 드래곤: "플라엣테영원의꽃" };
  const moves = Object.values(JSON.parse(readFileSync(new URL("../../src/data/moves.json", import.meta.url), "utf8")));
  const viol = [];
  let tested = 0;
  for (const m of moves) {
    const d = IMMUNE[m.type];
    if (!d || m.category === "status") continue;
    let r;
    try { r = same(m.name, d); } catch (e) { viol.push(`${m.name}(오류 ${String(e.message).slice(0, 30)})`); continue; }
    if (r.r.act?.typeEffectiveness !== 0) continue; // 이 조합이 실제로 무효가 아니면(예: 사우전드애로) 대상 밖
    tested++;
    if (!r.ok) viol.push(m.name);
  }
  if (process.env.B8_DEBUG) console.log("B8-a tested", tested, "violations", viol.length, viol.join(","));
  check(`8.3 B8-a: 전수 매트릭스(${tested}건) — 무효 상대에게 상태 변화(상태이상·휘발·랭크·벽·설치물)가 하나도 없다`, viol.length === 0 && tested >= 130, `위반 ${viol.length}: ${viol.join(",")}`);

  // ── B8-b: 상태이상 ──
  for (const [mvName, d] of [["번개펀치", "하마돈"], ["10만볼트", "하마돈"], ["누르기", "다크펫"], ["열사의대지", "글라이온"], ["백귀야행", "이어롭"]]) {
    const r = same(mvName, d);
    check(`8.3 B8-b: ${mvName} vs ${d}(무효) → 상대 상태이상 없음`, r.ok && !r.r.n.b.status.condition, json(r.r.n.b.status));
  }
  // ── B8-c: 휘발 ──
  for (const [mvName, d] of [["사념의박치기", "블래키"], ["신통력", "블래키"], ["드래곤다이브", "플라엣테영원의꽃"], ["3연화살", "다크펫"], ["폭발펀치", "다크펫"], ["발꿈치찍기", "다크펫"], ["사이코노이즈", "블래키"], ["그림자꿰매기", "이어롭"], ["속이기", "다크펫"]]) {
    const r = same(mvName, d);
    check(`8.3 B8-c: ${mvName} vs ${d}(무효) → 상대 휘발 없음(풀죽음·혼란·회복봉인·도망 불가)`, r.ok && json(r.r.n.b.volatile.active) === json(r.base.n.b.volatile.active) && r.r.actB?.blockedReason !== "flinch", json({ v: r.r.n.b.volatile.active, br: r.r.actB?.blockedReason }));
  }
  // ── B8-d: 자기 대상(재충전) ──
  for (const [mvName, d] of [["기가임팩트", "다크펫"], ["파괴광선", "다크펫"], ["스타어설트", "다크펫"]]) {
    const r = same(mvName, d);
    check(`8.3 B8-d: ${mvName} vs ${d}(무효) → 시전자 재충전 없음`, r.ok && !r.r.n.a.volatile.active.recharge, json(r.r.n.a.volatile.active));
  }
  // ── B8-d2: 고정(역린·난동·소란) — rampage.ts disrupted가 이미 막아야 한다(회귀) ──
  for (const [mvName, d] of [["역린", "플라엣테영원의꽃"], ["난동부리기", "다크펫"], ["소란피기", "다크펫"]]) {
    const r = same(mvName, d);
    check(`8.3 B8-d2: ${mvName} vs ${d}(무효) → 고정(rampage) 없음`, r.ok && !r.r.n.a.volatile.active.rampage, json(r.r.n.a.volatile.active));
  }
  // ── B8-e: 대조 — 무효가 아니면 효과가 그대로 ──
  { const r = run({ a: att("10만볼트"), b: def("잠만보"), aMove: "10만볼트", tweak: null }); check("8.3 B8-e: 10만볼트 vs 노말 → 마비(대조)", r.n.b.status.condition === "paralysis", json(r.n.b.status)); }
  { const r = run({ a: att("번개엄니"), b: def("잠만보"), aMove: "번개엄니", tweak: null }); check("8.3 B8-e: 번개엄니 vs 노말 → 마비(대조; 난수 0이라 완전 마비가 풀죽음보다 먼저)", r.n.b.status.condition === "paralysis", json({ s: r.n.b.status, br: r.actB?.blockedReason })); }
  { const r = run({ a: att("사념의박치기"), b: def("잠만보"), aMove: "사념의박치기", tweak: null }); check("8.3 B8-e: 사념의박치기 vs 노말 → 풀죽음(대조)", r.actB?.blockedReason === "flinch", json({ br: r.actB?.blockedReason })); }
  { const r = run({ a: att("파괴광선"), b: def("잠만보"), aMove: "파괴광선", tweak: null }); check("8.3 B8-e: 파괴광선 vs 노말 → 시전자 재충전(대조)", !!r.n.a.volatile.active.recharge, json(r.n.a.volatile.active)); }
  { const r = run({ a: att("누르기", [], "배짱"), b: def("다크펫"), aMove: "누르기", tweak: null }); check("8.3 B8-e: 배짱 시전자의 누르기 vs 고스트(무효 아님) → 마비", r.n.b.status.condition === "paralysis", json({ s: r.n.b.status, te: r.act.typeEffectiveness })); }
  { const r = run({ a: att("속이기", [], "배짱"), b: def("다크펫"), aMove: "속이기", tweak: null }); check("8.3 B8-e: 배짱 시전자의 속이기 vs 고스트(무효 아님) → 풀죽음(상대 행동 불가)", r.actB?.blockedReason === "flinch", json({ br: r.actB?.blockedReason, te: r.act.typeEffectiveness })); }
  // ── B8-f: 대타·탈 ──
  { const r = run({ a: att("10만볼트"), b: def("잠만보"), aMove: "10만볼트", tweak: (st) => { st.b.substituteHp = 500; } }); check("8.3 B8-f: 대타에 맞은 10만볼트 → 상대 마비 없음(기존 규칙)", !r.n.b.status.condition, json(r.n.b.status)); }
  { const r = run({ a: att("킬러스핀"), b: def("따라큐", "탈"), aMove: "킬러스핀", tweak: null }); check("8.3 B8-f: 탈 상대(데미지 흡수)에게 킬러스핀의 독이 정상 발동", !!r.act.hitNegatedByAbilityName && r.n.b.status.condition === "poison", json({ neg: r.act.hitNegatedByAbilityName, s: r.n.b.status })); }
  // ── B8-g: 빗나감·방어 — 회귀 고정 ──
  { const r = run({ a: att("번개"), b: def("잠만보"), aMove: "번개", tweak: null, rand: () => 0.99 }); check("8.3 B8-g: 빗나간 번개 → 마비 없음", !r.n.b.status.condition, json({ hit: r.act.hit, s: r.n.b.status })); }
  { const r = run({ a: att("10만볼트"), b: mon("잠만보", ["방어"], null, null, bulky), aMove: "10만볼트", bMove: "방어", tweak: null }); check("8.3 B8-g: 방어한 상대에게 10만볼트 → 마비 없음", !r.n.b.status.condition, json(r.n.b.status)); }
  // ── B8-h: 전기자석파(변화기) ──
  { const r = same("전기자석파", "하마돈"); check("8.3 B8-h: 전기자석파 vs 땅(하마돈) → 마비 없음·상태 변화 없음", r.ok && !r.r.n.b.status.condition, json(r.r.n.b.status)); }
  { const r = run({ a: att("전기자석파"), b: def("잠만보"), aMove: "전기자석파", tweak: null }); check("8.3 B8-h: 전기자석파 vs 노말 → 마비(대조)", r.n.b.status.condition === "paralysis", json(r.n.b.status)); }
  { const r = run({ a: att("전기자석파"), b: def("하마돈"), aMove: "전기자석파", tweak: null }); check("8.3 B8-h: 전기자석파 vs 땅 → 로그에 상성 무효(typeEffectiveness 0)", r.act.typeEffectiveness === 0, String(r.act.typeEffectiveness)); }
  // ── B8-i: 실패 반동·자폭류 ──
  { const r = run({ a: att("무릎차기"), b: def("다크펫"), aMove: "무릎차기", tweak: null }); check("8.3 B8-i: 무릎차기 vs 고스트 → 시전자 HP 감소(실패 반동 유지)", r.n.a.currentHp < r.hpA, `${r.hpA} → ${r.n.a.currentHp}`); }
  { const r = run({ a: att("대폭발"), b: def("다크펫"), aMove: "대폭발", tweak: null }); check("8.3 B8-i: 대폭발 vs 고스트 → 시전자 기절, 상대 HP·상태 변화 없음", r.n.a.currentHp === 0 && r.n.b.currentHp === r.n.b.maxHp, `${r.n.a.currentHp}/${r.n.b.currentHp}`); }
  // ── B8-j: 벽 파괴 ──
  const screensOf = (r) => json(r.n.sideB.screens);
  const both = json({ reflect: 4, lightScreen: 4 }); // 설치 5턴 → 턴 종료에 1 감소
  for (const [mvName, d] of [["깨트리기", "다크펫"], ["사이코팽", "블래키"]]) {
    const r = run({ a: att(mvName), b: def(d), aMove: mvName });
    check(`8.3 B8-j: ${mvName} vs ${d}(무효) → 벽 유지`, screensOf(r) === both && !r.act.brokeScreens, json({ s: r.n.sideB.screens, broke: r.act.brokeScreens }));
  }
  { const r = run({ a: att("깨트리기"), b: def("잠만보"), aMove: "깨트리기" }); check("8.3 B8-j: 깨트리기 vs 노말(무효 아님) → 벽 깨짐(대조)", screensOf(r) === "{}" && !!r.act.brokeScreens, json(r.n.sideB.screens)); }
  { const r = run({ a: att("깨트리기"), b: def("잠만보"), aMove: "깨트리기", tweak: (st) => { setup(st); st.b.substituteHp = 500; } }); check("8.3 B8-j: 깨트리기 vs 대타 → 벽 깨짐(Showdown onTryHit가 대타보다 앞)", screensOf(r) === "{}", json(r.n.sideB.screens)); }
  { const r = run({ a: att("깨트리기"), b: mon("잠만보", ["방어"], null, null, bulky), aMove: "깨트리기", bMove: "방어" }); check("8.3 B8-j: 방어한 상대에게 깨트리기 → 벽 유지", screensOf(r) === both, json(r.n.sideB.screens)); }
  { const r = run({ a: att("깨트리기"), b: def("잠만보"), aMove: "깨트리기", rand: () => 0.99, tweak: (st) => { setup(st); st.a.accuracyStages = { accuracy: -6, evasion: 0 }; } }); check("8.3 B8-j: 빗나간 깨트리기(명중 -6) → 벽 유지", r.act.hit === false && screensOf(r) === both, json({ hit: r.act.hit, s: r.n.sideB.screens })); }
  { const r = run({ a: att("사이코팽"), b: def("따라큐", "탈"), aMove: "사이코팽" }); check("8.3 B8-j: 사이코팽 vs 탈(데미지 흡수, 무효 아님) → 벽 깨짐", screensOf(r) === "{}", json(r.n.sideB.screens)); }
  { const r = run({ a: att("레이징불"), b: def("다크펫"), aMove: "레이징불" }); check("8.3 B8-j: 레이징불(노말) vs 고스트(무효) → 벽 유지", screensOf(r) === both, json({ te: r.act.typeEffectiveness, s: r.n.sideB.screens })); }
  { const r = run({ a: att("레이징불"), b: def("잠만보"), aMove: "레이징불" }); check("8.3 B8-j: 레이징불 vs 노말(무효 아님) → 벽 깨짐(대조)", screensOf(r) === "{}", json(r.n.sideB.screens)); }
  // ── B8-k: 데이터 불변식 — 타입 면역을 존중하는 변화기는 전기자석파 하나(V4) ──
  { const rs = moves.filter((m) => m.respectsTypeImmunity).map((m) => m.name); check("8.3 B8-k: respectsTypeImmunity 기술은 전기자석파 하나", json(rs) === json(["전기자석파"]), json(rs)); }
}
