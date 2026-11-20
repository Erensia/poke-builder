// 8.3 D3-fix-19 헤롱헤롱·속박은 건 쪽이 필드를 떠나면 풀린다(Showdown `attract.onUpdate`: source가 !isActive면 제거, `partiallytrapped`: source 이탈·기절이면 피해 없이 종료).
// 싱글에서 걸린 쪽의 원천은 항상 상대 활성 포켓몬이라 "상대(건 쪽)가 교체·기절했다"로 판정한다. 건 쪽이 턴 도중 기절하면(반동기·생명의구슬·반사) 걸린 쪽의 그 턴 행동 전에 헤롱헤롱이 풀린다(검수 §2-1).
// 설계 `8.3-D3-fix19-건쪽이탈해제설계.md`(검수 `…-검수.md`). E4b-10·11.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
  const ph = await server.ssrLoadModule("/src/lib/battle/preHitEffects.ts");
  const json = JSON.stringify;
  const M = (n) => data.getMove(n);
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  const SWITCH1 = { kind: "switch", toIndex: 1 };
  const seq = (...vals) => { let i = 0; const f = () => vals[Math.min(i++, vals.length - 1)]; f.calls = () => i; return f; };
  const ATT = { attract: { turnsRemaining: 99 } };
  const BOUND = { bound: { turnsRemaining: 4 } };
  const bAct = (out) => (out.result ?? out.partialResult).actions.find((x) => x.actor === "b");
  // a(건 쪽 = 한카리아스, 교체 대상 잠만보·조임밴드 보유 가능) → b(걸린 쪽 잠만보)
  const mk = ({ bVolatile = {}, a1Item = null, bTwo = false } = {}) => {
    const st = battle(
      [mon("한카리아스", [IDLE, "브레이브버드"]), mon("잠만보", [IDLE], null, a1Item)],
      bTwo ? [mon("잠만보", [IDLE]), mon("루카리오", [IDLE])] : [mon("잠만보", [IDLE])],
    );
    st.b.volatile = { active: bVolatile };
    return st;
  };
  const bFree = (st) => !st.b.volatile.active.attract && !st.b.volatile.active.bound;

  guard("D3-fix19 1 헤롱헤롱, 건 쪽 교체: 걸린 쪽의 헤롱헤롱이 사라지고 다음 행동에서 굴림(난수) 없이 움직인다", () => {
    const st = mk({ bVolatile: ATT });
    sw.performSwitch(st, "a", 1);
    const rnd = seq(0.1);
    const r = ph.resolvePreHitEffects(st, "b", M(IDLE), rnd, false, M(IDLE));
    return !st.b.volatile.active.attract && r.blockedReason !== "attract" && rnd.calls() === 0 ? true : json({ attract: !!st.b.volatile.active.attract, reason: r.blockedReason, calls: rnd.calls() });
  });
  guard("D3-fix19 2 헤롱헤롱, 건 쪽 기절 후 교대(강제 교체): 같다", () => {
    const st = mk({ bVolatile: ATT });
    st.a.currentHp = 0;
    sw.performSwitch(st, "a", 1, [], { voluntary: false });
    return !st.b.volatile.active.attract ? true : "남음";
  });
  guard("D3-fix19 3 걸린 쪽 교체: 기존대로 새로 나온 포켓몬에는 헤롱헤롱 없음(불변)", () => {
    const st = mk({ bVolatile: ATT, bTwo: true });
    sw.performSwitch(st, "b", 1);
    return !st.b.volatile.active.attract ? true : "남음";
  });
  guard("D3-fix19 4 속박, 건 쪽 교체: 속박이 사라져 걸린 쪽이 교체 가능하고 턴 종료 속박 피해가 없다", () => {
    const st = mk({ bVolatile: BOUND });
    const hp = st.b.currentHp;
    const out = rt.runTurn(st, SWITCH1, act(IDLE), () => 0.5);
    return bFree(out.nextState) && !sw.isTrappedFromSwitching(out.nextState.b) && out.nextState.b.currentHp === hp ? true : json({ bound: !!out.nextState.b.volatile.active.bound, hp: [hp, out.nextState.b.currentHp] });
  });
  guard("D3-fix19 5 조임밴드: 새로 나온 건 쪽이 조임밴드를 들고 있어도 속박을 이어받지 않는다(1/6 피해 없음)", () => {
    const st = mk({ bVolatile: BOUND, a1Item: "조임밴드" });
    const hp = st.b.currentHp;
    const out = rt.runTurn(st, SWITCH1, act(IDLE), () => 0.5);
    return out.nextState.b.currentHp === hp && !out.nextState.b.volatile.active.bound ? true : json({ hp: [hp, out.nextState.b.currentHp] });
  });
  guard("D3-fix19 6 속박, 건 쪽 기절(턴 종료): 기존 처리대로 피해 없이 풀린다(불변)", () => {
    const st = mk({ bVolatile: BOUND });
    st.a.currentHp = 1;
    const out = rt.runTurn(st, act("브레이브버드"), act(IDLE), () => 0.5);
    return !out.nextState.b.volatile.active.bound ? true : "속박이 남음";
  });
  guard("D3-fix19 7 다른 휘발성은 영향 없음: 도발·씨뿌리기가 건 쪽 교체 뒤에도 유지된다", () => {
    const st = mk({ bVolatile: { taunt: { turnsRemaining: 3 }, leechSeed: { turnsRemaining: 99 }, ...ATT } });
    sw.performSwitch(st, "a", 1);
    const act = st.b.volatile.active;
    return act.taunt && act.leechSeed && !act.attract ? true : json(Object.keys(act));
  });
  guard("D3-fix19 8 헤롱헤롱·속박이 없는 상대에 대한 교체는 변화 없음", () => {
    const st = mk({ bVolatile: { taunt: { turnsRemaining: 3 } } });
    const before = json(st.b.volatile);
    sw.performSwitch(st, "a", 1);
    return json(st.b.volatile) === before ? true : json(st.b.volatile);
  });
  guard("D3-fix19 9 턴 도중 기절(검수 §2-1 필수 가드): 건 쪽이 이미 기절했으면 걸린 쪽은 헤롱헤롱 굴림 없이(난수 0회) 움직이고 헤롱헤롱이 풀린다", () => {
    const st = mk({ bVolatile: ATT });
    st.a.currentHp = 0;
    const rnd = seq(0.1);
    const r = ph.resolvePreHitEffects(st, "b", M(IDLE), rnd, true, M(IDLE));
    return r.blockedReason !== "attract" && rnd.calls() === 0 && !st.b.volatile.active.attract ? true : json({ reason: r.blockedReason, calls: rnd.calls(), attract: !!st.b.volatile.active.attract });
  });
  guard("D3-fix19 10 같은 턴 통합: 헤롱헤롱 건 쪽이 선공 반동기로 기절해도 후공 걸린 쪽은 헤롱헤롱으로 막히지 않는다(난수 0.1)", () => {
    const st = mk({ bVolatile: ATT });
    st.a.currentHp = 1;
    st.a.realStats = { ...st.a.realStats, spe: 300 };
    const out = rt.runTurn(st, act("브레이브버드"), act(IDLE), () => 0.1);
    const reason = bAct(out)?.blockedReason;
    return reason !== "attract" ? true : json({ reason });
  });
}
