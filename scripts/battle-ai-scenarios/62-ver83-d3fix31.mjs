// 8.3 D3-fix-31 일렉트릭필드 하품: 접지된 대상에게는 하품 상태(졸음) **자체가 걸리지 않는다**(Showdown electricterrain.onTryAddVolatile: yawn, 접지·비반무적).
// 엔진은 졸음을 걸고 2턴 뒤 잠듦만 막았다. 미스트필드는 하품 상태는 걸리고 잠듦만 막힌다(onTryAddVolatile이 혼란만 대상 — 엔진은 이미 같음).
// 설계 `8.3-D3-E5-검수.md` §3 fix-31 (E5-24).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  // a(하품 사용자) → b(대상). field로 필드를 깔고 한 턴 + 두 턴 더 진행해 졸음·잠듦을 본다. 매직가드: 날씨·필드 잔류 피해 영향 없음.
  const play = (field, bId, { turns = 1 } = {}) => {
    const st = battle([mon("잠만보", ["하품", IDLE], "매직가드")], [mon(bId, [IDLE], "매직가드")]);
    if (field) { st.field = field; st.fieldTurnsRemaining = 5; }
    let cur = st, last;
    for (let i = 0; i < turns; i++) {
      last = rt.runTurn(cur, act(i === 0 ? "하품" : IDLE), act(IDLE), () => 0.5);
      cur = last.nextState;
    }
    return { st: cur, drowsy: !!cur.b.volatile.active.drowsy, status: cur.b.status.condition };
  };

  guard("D3-fix31 1 일렉트릭필드 + 접지 대상: 하품이 졸음 상태 자체를 걸지 못한다", () => {
    const r = play("일렉트릭필드", "잠만보");
    return !r.drowsy && !r.status ? true : json(r);
  });
  guard("D3-fix31 2 일렉트릭필드 + 비접지 대상(비행 타입): 하품이 정상적으로 걸린다", () => {
    const r = play("일렉트릭필드", "피죤투");
    return r.drowsy ? true : json(r);
  });
  guard("D3-fix31 3 필드 없음: 하품 정상(졸음 → 2턴 뒤 잠듦)", () => {
    const a = play(undefined, "잠만보"), b = play(undefined, "잠만보", { turns: 3 });
    return a.drowsy && b.status === "sleep" ? true : json({ a: a.drowsy, b: b.status });
  });
  guard("D3-fix31 4 미스트필드 + 접지 대상(회귀): 하품 상태는 걸리고 잠듦만 막힌다", () => {
    const a = play("미스트필드", "잠만보"), b = play("미스트필드", "잠만보", { turns: 3 });
    return a.drowsy && !b.status ? true : json({ a: a.drowsy, b: b.status });
  });
  guard("D3-fix31 5 일렉트릭필드가 2턴 안에 끝나도(필드 만료) 하품은 걸려 있지 않다 — 부여 시점에 막혔으므로 잠들지 않는다", () => {
    const st = battle([mon("잠만보", ["하품", IDLE], "매직가드")], [mon("잠만보", [IDLE], "매직가드")]);
    st.field = "일렉트릭필드"; st.fieldTurnsRemaining = 1;
    let cur = st;
    for (let i = 0; i < 3; i++) cur = rt.runTurn(cur, act(i === 0 ? "하품" : IDLE), act(IDLE), () => 0.5).nextState;
    return cur.field === undefined && !cur.b.status.condition && !cur.b.volatile.active.drowsy ? true : json({ field: cur.field, status: cur.b.status.condition, drowsy: !!cur.b.volatile.active.drowsy });
  });
}
