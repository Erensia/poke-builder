// 8.3 D3-fix-40 (E7-09) 소금절이는 교체하면 풀린다 — Showdown(champions) `clearVolatile`은 `volatiles = {}`로 소금절이도 비운다(`saltcure` 예외 없음, `[실행]` 확인).
//  엔진은 주석의 "본가"만 근거로 소금절이만 교체 뒤에도 남겼다. 사용자 결정(2026-11-25): Showdown을 따른다.
// 설계 `8.3-D3-E7-검수.md` §2-6.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const vol = await server.ssrLoadModule("/src/lib/volatileConditions.ts");
  const R = (v) => () => v;
  const json = JSON.stringify;
  const mv = (x) => (typeof x === "string" ? { kind: "move", move: data.getMove(x) } : x);
  const put = (f, ...ids) => { for (const id of ids) f.volatile = vol.inflictVolatile(f.volatile, id, () => 0.5); };

  const mk = () => battle([mon("잠만보", ["하품"]), mon("잠만보", ["하품"])], [mon("잠만보", ["하품"])]);
  // 1 소금절이에 걸린 a가 교체로 물러나면 풀리고, 다시 나와도 없다
  {
    const st = mk(); put(st.a, "saltCure");
    const o1 = rt.runTurn(st, { kind: "switch", toIndex: 1 }, mv("하품"), R(0.5));
    const out = o1.nextState.sideA.party[0];
    const o2 = rt.runTurn(o1.nextState, { kind: "switch", toIndex: 0 }, mv("하품"), R(0.5));
    check("D3-fix40 1: 소금절이에 걸린 포켓몬이 교체로 물러나면 풀리고, 다시 나와도 없다",
      !vol.hasVolatile(out.volatile, "saltCure") && !vol.hasVolatile(o2.nextState.a.volatile, "saltCure"), json({ out: out.volatile, back: o2.nextState.a.volatile }));
  }
  // 2 교체하지 않으면 유지 + 턴 종료 피해(1/16)
  {
    const st = mk(); put(st.a, "saltCure");
    const o = rt.runTurn(st, mv("하품"), mv("하품"), R(0.5));
    const a = o.nextState.a, want = Math.floor(a.maxHp / 16);
    check("D3-fix40 2: 교체하지 않으면 소금절이가 유지되고 턴 종료에 1/16 피해(회귀)", vol.hasVolatile(a.volatile, "saltCure") && a.currentHp === a.maxHp - want, json({ hp: a.currentHp, max: a.maxHp, want }));
  }
  // 3 다른 휘발성은 지금처럼 교체로 사라진다(회귀) — 소금절이와 함께 걸려도 전부 비움
  {
    const st = mk(); put(st.a, "saltCure", "confusion", "leechSeed");
    const o = rt.runTurn(st, { kind: "switch", toIndex: 1 }, mv("하품"), R(0.5));
    check("D3-fix40 3: 소금절이·혼란·씨뿌리기가 함께 걸려도 교체하면 전부 사라진다", Object.keys(o.nextState.sideA.party[0].volatile.active).length === 0, json(o.nextState.sideA.party[0].volatile));
  }
  // 4 소금절이에 걸린 a가 다른 포켓몬으로 교체해 나온 새 포켓몬은 소금절이 없음(회귀)
  {
    const st = mk(); put(st.a, "saltCure");
    const o = rt.runTurn(st, { kind: "switch", toIndex: 1 }, mv("하품"), R(0.5));
    check("D3-fix40 4: 새로 나온 포켓몬에겐 소금절이가 없다(회귀)", !vol.hasVolatile(o.nextState.a.volatile, "saltCure"), json(o.nextState.a.volatile));
  }
}
