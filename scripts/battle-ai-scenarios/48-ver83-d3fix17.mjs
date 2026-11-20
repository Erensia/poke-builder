// 8.3 D3-fix-17 행동 전 판정 순서(Showdown BeforeMove 우선도): 수면·얼음 10 → 풀죽음 8 → 도발·사슬묶기류 → 혼란 3 → 헤롱헤롱 2 → **마비 1(맨 마지막)**.
// 그 뒤 runMove 이후 TryMove(여왕의위엄·테일아머 `onFoeTryMove`) → TryHit(사이코필드 `onTryHitPriority 4`) — 둘 다 BeforeMove보다 뒤, 여왕의위엄이 사이코필드보다 먼저.
// 설계 `8.3-D3-fix17-행동전판정순서설계.md`(검수 `…-검수.md`). E4a-10. 난수는 순서대로 소비한다: 판정이 뒤로 가면 앞 판정이 먼저 난수를 쓴다.
export default async function ({ server, data, mon, battle, check }) {
  const ph = await server.ssrLoadModule("/src/lib/battle/preHitEffects.ts");
  const json = JSON.stringify;
  const M = (n) => data.getMove(n);
  const IDLE = "칼춤";
  const PRIORITY = "마하펀치"; // 우선도 +1 물리 — 상대를 겨냥
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const seq = (...vals) => { let i = 0; const f = () => vals[Math.min(i++, vals.length - 1)]; f.calls = () => i; return f; };
  const PARA = { condition: "paralysis", turnsElapsed: 0 };
  const mk = ({ aMon = mon("한카리아스", [IDLE, PRIORITY]), bMon = mon("잠만보", [IDLE]), status, volatile = {}, field } = {}) => {
    const st = battle([aMon], [bMon]);
    if (status) st.a.status = status;
    st.a.volatile = { active: volatile };
    if (field) { st.field = field; st.fieldTurnsRemaining = 5; }
    return st;
  };
  const roll = (st, rnd, move = IDLE) => ph.resolvePreHitEffects(st, "a", M(move), rnd, false, M(IDLE));
  const CONF = (turnsRemaining = 3) => ({ confusion: { turnsRemaining } });

  guard("D3-fix17 1 혼란+마비, 혼란 먼저: 난수 [0.1, 0.9] → 혼란 자해로 막히고(난수 2회 = 혼란 굴림 + 자해 피해 굴림) 마비 굴림은 일어나지 않는다", () => {
    const rnd = seq(0.1, 0.9);
    const r = roll(mk({ status: PARA, volatile: CONF() }), rnd);
    return r.blockedReason === "confusion" && rnd.calls() === 2 ? true : json({ reason: r.blockedReason, by: r.blockedByStatus, calls: rnd.calls() });
  });
  guard("D3-fix17 2 혼란+마비, 마비는 마지막: 난수 [0.5, 0.1] → 혼란 통과 뒤 마비 굴림(0.1 < 0.125)으로 막히고 혼란 지속은 소모된다", () => {
    const st = mk({ status: PARA, volatile: CONF(3) });
    const rnd = seq(0.5, 0.1);
    const r = roll(st, rnd);
    const left = st.a.volatile.active.confusion?.turnsRemaining;
    return r.blockedReason === "status" && r.blockedByStatus === "paralysis" && rnd.calls() === 2 && left === 2 ? true : json({ reason: r.blockedReason, by: r.blockedByStatus, calls: rnd.calls(), left });
  });
  guard("D3-fix17 3 마비+헤롱헤롱: [0.4, 0.1] → 헤롱헤롱(0.4 < 0.5)으로 막혀 마비 굴림 없음(1회) / [0.6, 0.1] → 헤롱헤롱 통과 뒤 마비로 막힘(2회)", () => {
    const att = { attract: { turnsRemaining: 99 } };
    const r1 = seq(0.4, 0.1), a = roll(mk({ status: PARA, volatile: att }), r1);
    const r2 = seq(0.6, 0.1), b = roll(mk({ status: PARA, volatile: att }), r2);
    return a.blockedReason === "attract" && r1.calls() === 1 && b.blockedReason === "status" && b.blockedByStatus === "paralysis" && r2.calls() === 2
      ? true : json({ a: [a.blockedReason, r1.calls()], b: [b.blockedReason, b.blockedByStatus, r2.calls()] });
  });
  guard("D3-fix17 4 마비 단독: 난수 1회, 12.5% 경계 불변(0.124 → 막힘, 0.126 → 통과)", () => {
    const r1 = seq(0.124), a = roll(mk({ status: PARA }), r1);
    const r2 = seq(0.126), b = roll(mk({ status: PARA }), r2);
    return a.blockedReason === "status" && a.blockedByStatus === "paralysis" && r1.calls() === 1 && !b.blockedReason && r2.calls() === 1
      ? true : json({ a: [a.blockedReason, r1.calls()], b: [b.blockedReason, r2.calls()] });
  });
  guard("D3-fix17 5 수면·얼음은 자기 판정 하나만(불변): 수면 난수 1회로 막히고 마비 굴림·혼란 굴림 없음", () => {
    const r = seq(0.9), x = roll(mk({ status: { condition: "sleep", turnsElapsed: 0 } }), r);
    return x.blockedReason === "status" && x.blockedByStatus === "sleep" && r.calls() === 1 ? true : json({ reason: x.blockedReason, by: x.blockedByStatus, calls: r.calls() });
  });
  guard("D3-fix17 6 풀죽음이 마비보다 먼저: 풀죽음+마비 → 풀죽음으로 막히고 난수 0회(현행은 마비가 먼저라 0.01에서 마비로 막힘)", () => {
    const rnd = seq(0.01);
    const r = roll(mk({ status: PARA, volatile: { flinch: { turnsRemaining: 1 } } }), rnd);
    return r.blockedReason === "flinch" && rnd.calls() === 0 ? true : json({ reason: r.blockedReason, by: r.blockedByStatus, calls: rnd.calls() });
  });
  guard("D3-fix17 7 사이코필드·여왕의위엄은 혼란·헤롱헤롱 뒤: 혼란 포켓몬이 우선도 기술이 막히는 턴에도 혼란 지속이 소모되고 난수 1회(혼란 굴림)", () => {
    const out = {};
    for (const [name, opts] of Object.entries({
      사이코필드: { field: "사이코필드" },
      여왕의위엄: { bMon: mon("잠만보", [IDLE], "여왕의위엄") },
    })) {
      const st = mk({ ...opts, volatile: CONF(3) });
      const rnd = seq(0.9);
      const r = roll(st, rnd, PRIORITY);
      out[name] = [r.blockedReason, rnd.calls(), st.a.volatile.active.confusion?.turnsRemaining];
    }
    const ok = out.사이코필드[0] === "psychicFieldPriority" && out.여왕의위엄[0] === "queenlyMajesty" && Object.values(out).every((v) => v[1] === 1 && v[2] === 2);
    return ok ? true : json(out);
  });
  guard("D3-fix17 8 속보(스피드만 면제)는 행동 불능 확률에 영향 없음: 마비+속보도 0.1 → 막힘", () => {
    const r = seq(0.1), x = roll(mk({ aMon: mon("한카리아스", [IDLE], "속보"), status: PARA }), r);
    return x.blockedReason === "status" && x.blockedByStatus === "paralysis" ? true : json({ reason: x.blockedReason, by: x.blockedByStatus });
  });
  guard("D3-fix17 9 여왕의위엄 + 사이코필드 동시: 막힌 이유는 여왕의위엄(TryMove가 TryHit보다 먼저)", () => {
    const st = mk({ bMon: mon("잠만보", [IDLE], "여왕의위엄"), field: "사이코필드" });
    const r = roll(st, seq(0.9), PRIORITY);
    return r.blockedReason === "queenlyMajesty" ? true : json(r.blockedReason);
  });
  guard("D3-fix17 10 테일아머도 같은 자리: 테일아머 상대 + 사이코필드 → 테일아머로 막힘", () => {
    const st = mk({ bMon: mon("잠만보", [IDLE], "테일아머"), field: "사이코필드" });
    const r = roll(st, seq(0.9), PRIORITY);
    return r.blockedReason === "queenlyMajesty" ? true : json(r.blockedReason);
  });
}
