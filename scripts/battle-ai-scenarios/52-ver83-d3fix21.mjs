// 8.3 D3-fix-21 속박: 지속 N이면 피해 N−1번·가둠 N−1번, N번째 턴 종료에 피해 없이 해제(Showdown `partiallytrapped` — 턴 종료 잔류가 지속을 먼저 줄이고 0이면 끝낸다, 지속 `random(5, 7)`).
// 설계 `8.3-D3-fix21-속박가둠설계.md`(검수 `…-검수.md`). E4b-13.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
  const vc = await server.ssrLoadModule("/src/lib/volatileConditions.ts");
  const tr = await server.ssrLoadModule("/src/lib/battle/ai/turnRates.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  const SWITCH1 = { kind: "switch", toIndex: 1 };
  // a(건 쪽 한카리아스) → b(걸린 쪽). 기본 b는 잠만보(HP 넉넉) + 교체 대상 루카리오.
  const mk = ({ b = "잠만보", bAbility = null, bItem = null, aItem = null, aMoves = [IDLE, "조이기", "회오리불꽃"] } = {}) =>
    battle([mon("한카리아스", aMoves, null, aItem), mon("잠만보", [IDLE])], [mon(b, [IDLE], bAbility, bItem), mon("루카리오", [IDLE])]);
  const bounds = (st) => st.b.volatile.active.bound;
  const dmgTicks = (out) => (out.result ?? out.partialResult).endOfTurn.filter((e) => e.actor === "b" && e.boundDamage);
  // 턴 단위 기록: 행동 선택 때 교체 불가(trapped)·그 턴 종료 속박 피해(dmg). T1은 a가 기술을 쓰고 이후는 모두 대기.
  const play = (st, first, turns) => {
    const rows = [];
    let cur = st;
    for (let t = 1; t <= turns; t++) {
      const trapped = sw.isTrappedFromSwitching(cur.b, cur);
      const out = rt.runTurn(cur, t === 1 ? act(first) : act(IDLE), act(IDLE), () => 0);
      rows.push({ t, trapped, dmg: dmgTicks(out).length, bound: !!bounds(out.nextState) });
      cur = out.nextState;
    }
    return rows;
  };
  const turnsOf = (rows, key) => rows.filter((r) => r[key]).map((r) => r.t).join(",");
  // 직접 부여한 속박(지속 n)을 두고 T1부터 전부 대기 — 걸린 턴(T1)에도 지속이 줄며 피해가 들어간다.
  const playGiven = (st, n, turns) => {
    st.b.volatile = { active: { bound: { turnsRemaining: n } } };
    const rows = [];
    let cur = st;
    for (let t = 1; t <= turns; t++) {
      const trapped = sw.isTrappedFromSwitching(cur.b, cur);
      const out = rt.runTurn(cur, act(IDLE), act(IDLE), () => 0);
      rows.push({ t, trapped, dmg: dmgTicks(out).length, bound: !!bounds(out.nextState) });
      cur = out.nextState;
    }
    return rows;
  };

  guard("D3-fix21 1 지속 굴림: 난수 0 → 5, 0.99 → 6(Showdown random(5, 7))", () => {
    const lo = vc.inflictVolatile({ active: {} }, "bound", () => 0).active.bound.turnsRemaining;
    const hi = vc.inflictVolatile({ active: {} }, "bound", () => 0.99).active.bound.turnsRemaining;
    return lo === 5 && hi === 6 ? true : json({ lo, hi });
  });
  guard("D3-fix21 2 지속 5, 실제 기술(조이기): 피해 T1~T4, 교체 불가 T2~T5, T6 교체 가능", () => {
    const rows = play(mk(), "조이기", 7);
    const got = { dmg: turnsOf(rows, "dmg"), trapped: turnsOf(rows, "trapped") };
    return got.dmg === "1,2,3,4" && got.trapped === "2,3,4,5" ? true : json(got);
  });
  guard("D3-fix21 3 지속 6(직접 부여): 피해 5번(T1~T5), 교체 불가 T2~T6, T7 가능", () => {
    const rows = playGiven(mk(), 6, 8);
    // 직접 부여는 T1 행동 선택 전에 이미 걸려 있어 T1도 가둠이다 — 걸린 턴(T1) 뒤인 T2부터 비교한다.
    const got = { dmg: turnsOf(rows, "dmg"), trapped: turnsOf(rows.slice(1), "trapped") };
    return got.dmg === "1,2,3,4,5" && got.trapped === "2,3,4,5,6" ? true : json(got);
  });
  guard("D3-fix21 4 해제 턴(T5)에는 피해 항목이 없고 속박이 사라진다; 새 endOfTurn 항목도 없다", () => {
    const rows = play(mk(), "조이기", 5);
    const t5 = rows[4];
    // 해제 틱의 endOfTurn에 잠만보(b) 항목이 하나도 없어야 한다(해제 메시지 항목 없음 = 현행 유지)
    let cur = mk();
    let last;
    for (let t = 1; t <= 5; t++) { last = rt.runTurn(cur, t === 1 ? act("조이기") : act(IDLE), act(IDLE), () => 0); cur = last.nextState; }
    const bItems = (last.result ?? last.partialResult).endOfTurn.filter((e) => e.actor === "b");
    return rows[3].bound && t5.dmg === 0 && !t5.bound && bItems.length === 0 ? true : json({ t5, bItems: bItems.length });
  });
  guard("D3-fix21 5 매직가드: 피해 0이어도 가둠 기간은 같다(T2~T5, T6 가능)", () => {
    const rows = play(mk({ bAbility: "매직가드" }), "조이기", 7);
    const got = { dmg: turnsOf(rows, "dmg"), trapped: turnsOf(rows, "trapped") };
    return got.dmg === "" && got.trapped === "2,3,4,5" ? true : json(got);
  });
  guard("D3-fix21 6 조임밴드: 피해 1/6, 횟수 4번", () => {
    const st = mk({ aItem: "조임밴드" });
    const out = rt.runTurn(st, act("조이기"), act(IDLE), () => 0);
    const first = dmgTicks(out)[0];
    const rows = play(mk({ aItem: "조임밴드" }), "조이기", 7);
    return first && first.damage === Math.floor(st.b.maxHp / 6) && turnsOf(rows, "dmg") === "1,2,3,4" ? true : json({ first: first?.damage, per6: Math.floor(st.b.maxHp / 6), dmg: turnsOf(rows, "dmg") });
  });
  guard("D3-fix21 7 이미 속박 중이면 갱신 안 함: T2에 다시 써도 해제 시점이 같다", () => {
    let cur = mk();
    const trapped = [];
    const dmg = [];
    for (let t = 1; t <= 7; t++) {
      trapped.push(sw.isTrappedFromSwitching(cur.b, cur));
      const out = rt.runTurn(cur, t <= 2 ? act("조이기") : act(IDLE), act(IDLE), () => 0);
      if (dmgTicks(out).length) dmg.push(t);
      cur = out.nextState;
    }
    const tr_ = trapped.map((x, i) => (x ? i + 1 : 0)).filter(Boolean).join(",");
    return dmg.join(",") === "1,2,3,4" && tr_ === "2,3,4,5" ? true : json({ dmg, trapped: tr_ });
  });
  guard("D3-fix21 8 건 쪽이 교체하면 피해 없이 즉시 풀린다(fix-19 경로 유지)", () => {
    let cur = mk();
    cur = rt.runTurn(cur, act("조이기"), act(IDLE), () => 0).nextState;
    const out = rt.runTurn(cur, SWITCH1, act(IDLE), () => 0);
    return !bounds(out.nextState) && dmgTicks(out).length === 0 ? true : json({ bound: !!bounds(out.nextState), ticks: dmgTicks(out).length });
  });
  guard("D3-fix21 9 고스트(팬텀)+회오리불꽃: 교체는 항상 가능, 피해 4번", () => {
    const rows = play(mk({ b: "팬텀" }), "회오리불꽃", 7);
    return turnsOf(rows, "trapped") === "" && turnsOf(rows, "dmg") === "1,2,3,4" ? true : json({ trapped: turnsOf(rows, "trapped"), dmg: turnsOf(rows, "dmg") });
  });
  guard("D3-fix21 10 AI: 남은 속박 1은 속박 없음과 같고(마지막 틱은 피해 없음), 3은 더 짧아진다", () => {
    const st = mk();
    const ko = (n) => {
      const s = mk();
      s.b.volatile = n === 0 ? { active: {} } : { active: { bound: { turnsRemaining: n } } };
      return tr.turnsToKo(0.05, s.a, s.b, s.b.currentHp, undefined, s);
    };
    const [none, one, three] = [ko(0), ko(1), ko(3)];
    return one === none && three < one ? true : json({ none, one, three, st: !!st });
  });
  guard("D3-fix21 11 아름다운허물(허물갑옷): 속박 중에도 교체 가능, 피해는 4번", () => {
    const rows = play(mk({ bItem: "아름다운허물" }), "조이기", 7);
    return turnsOf(rows, "trapped") === "" && turnsOf(rows, "dmg") === "1,2,3,4" ? true : json({ trapped: turnsOf(rows, "trapped"), dmg: turnsOf(rows, "dmg") });
  });
}
