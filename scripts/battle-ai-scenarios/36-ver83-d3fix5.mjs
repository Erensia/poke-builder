// 8.3 D3-fix-5 앙코르가 이미 고른 기술을 바꾸는 규칙(Showdown champions `data/mods/champions/moves.ts` encore.condition.onStart):
// 앙코르가 걸리는 순간 상대가 이번 턴에 이미 고른 기술이 아직 실행 전이면(`queue.willMove`) 앙코르 기술로 바꾼다(멘탈허브 제외). 교체·충전 2턴째·반동 중인 상대는 바꾸지 않는다.
// 엔진은 지금까지 그 행동을 "앙코르 때문에 이 기술을 쓸 수 없다!"로 실패 처리했다. 걸린 뒤의 턴은 UI·AI가 이미 앙코르 기술만 고르게 막는다.
// 설계 `8.3-D3-fix5-앙코르선택교체설계.md`, 검수 `8.3-D3-fix5-앙코르선택교체설계-검수.md`
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const M = (n) => data.getMove(n);
  const mv = (n) => ({ kind: "move", move: M(n) });
  const IDLE = "도우미";
  const bulky = pts({ hp: 32, def: 32, spd: 32 });
  const fast = pts({ spe: 32 }), slow = pts({ hp: 32, def: 32, spd: 32 });
  const act = (o, who) => (o.result ?? o.partialResult).actions.find((x) => x.actor === who);

  // 앙코르 사용자 a(다크펫 — 짓궂은마음이면 앙코르가 우선도 +1) vs 대상 b(번치코). b의 직전 기술은 lastMoveId로 세팅한다.
  const setup = ({ aMon = "다크펫", aAbility = "짓궂은마음", aPts = fast, bMoves = ["무릎차기", "플레어드라이브", "방어", IDLE], bItem = null, bPts = bulky, last = "무릎차기", bench = false, tweak } = {}) => {
    const st = battle([mon(aMon, ["앙코르", IDLE], aAbility, null, aPts)], [mon("번치코", bMoves, null, bItem, bPts), ...(bench ? [mon("피카츄", [IDLE])] : [])]);
    st.b.lastMoveId = last;
    tweak?.(st); return st;
  };
  const turn = (st, aMove, bAct, rand = () => 0.5) => { const o = rt.runTurn(st, mv(aMove), typeof bAct === "string" ? mv(bAct) : bAct, rand); return { o, n: o.nextState, a: act(o, "a"), b: act(o, "b") }; };

  // ── 제보 재현: 짓궂은마음 선공 앙코르 → 이미 고른 플레어드라이브가 앙코르 기술(무릎차기)로 바뀌어 나간다 ──
  { const st = setup(); const r = turn(st, "앙코르", "플레어드라이브");
    check("D3-fix5 제보 재현: 앙코르 선공 → 고른 플레어드라이브 대신 앙코르 기술(무릎차기)이 실행된다", r.a.setEncoreMoveName === "무릎차기" && r.b?.move.name === "무릎차기" && !r.b.blockedReason, json({ set: r.a.setEncoreMoveName, mv: r.b?.move.name, br: r.b?.blockedReason }));
    check("D3-fix5 PP: 바뀐 기술(무릎차기)의 PP가 깎이고 고른 기술(플레어드라이브)은 그대로", r.n.b.remainingPp["무릎차기"] === st.b.remainingPp["무릎차기"] - 1 && r.n.b.remainingPp["플레어드라이브"] === st.b.remainingPp["플레어드라이브"], json({ k: r.n.b.remainingPp["무릎차기"], f: r.n.b.remainingPp["플레어드라이브"] }));
    check("D3-fix5 지속 턴(정상 행동 경로): 걸린 턴에 앙코르 기술로 행동하면 앙코르 지속이 남아 있다", r.n.b.volatile.active.encore?.moveId === "무릎차기", json(r.n.b.volatile.active.encore)); }
  // ── 속도 선공(짓궂은마음 없이 더 빠름) ──
  { const r = turn(setup({ aAbility: null, aPts: pts({ spe: 32 }), bPts: pts({ hp: 32, def: 32, spd: 32 }) }), "앙코르", "플레어드라이브");
    check("D3-fix5 속도 선공: 앙코르 사용자가 더 빠르면 같다", r.b?.move.name === "무릎차기", json({ mv: r.b?.move.name })); }
  // ── 후공(상대가 이미 행동한 뒤 걸림): 이번 턴 변화 없음(경계: 이미 행동한 상대는 바꾸지 않는다) ──
  { const st = setup({ aAbility: null, aPts: pts({ hp: 32, def: 32, spd: 32 }), bPts: pts({ atk: 32, spe: 32 }) });
    const r = turn(st, "앙코르", "플레어드라이브");
    check("D3-fix5 후공: 상대가 먼저 행동했으면 고른 플레어드라이브가 그대로 나가고 앙코르는 그 기술에 걸린다", r.b?.move.name === "플레어드라이브" && r.n.b.volatile.active.encore?.moveId === "플레어드라이브", json({ mv: r.b?.move.name, enc: r.n.b.volatile.active.encore?.moveId }));
    const next = turn(r.n, "앙코르", "무릎차기");
    check("D3-fix5 후공 다음 턴: 앙코르 기술이 아닌 선택은 기존대로 실패(moveRestricted) — 현재 동작 고정", next.b?.blockedReason === "moveRestricted", json({ br: next.b?.blockedReason })); }
  // ── 멘탈허브: 앙코르가 걸리는 순간 치료·소모, 고른 기술 그대로 ──
  { const r = turn(setup({ bItem: "멘탈허브" }), "앙코르", "플레어드라이브");
    check("D3-fix5 멘탈허브: 앙코르 치료·소모, 고른 플레어드라이브가 그대로 실행된다", r.b?.move.name === "플레어드라이브" && r.n.b.volatile.active.encore === undefined && r.n.b.currentItemId == null, json({ mv: r.b?.move.name, enc: r.n.b.volatile.active.encore, item: r.n.b.currentItemId })); }
  // ── 이미 앙코르 기술을 골랐다 ──
  { const r = turn(setup(), "앙코르", "무릎차기");
    check("D3-fix5 이미 같은 기술: 변화 없이 무릎차기 실행", r.b?.move.name === "무릎차기" && !r.b.blockedReason, json({ mv: r.b?.move.name })); }
  // ── 교체를 골랐다: 교체 유지 ──
  { const r = turn(setup({ bench: true }), "앙코르", { kind: "switch", toIndex: 1 });
    check("D3-fix5 교체 선택: 교체가 그대로 이루어지고 앙코르 기술은 실행되지 않는다", r.n.b.slot.pokemonId === "피카츄" && r.b === undefined, json({ id: r.n.b.slot.pokemonId, b: r.b?.move?.name })); }
  // ── 변화기를 골랐다: 앙코르 기술로 교체 ──
  { const r = turn(setup({ bMoves: ["무릎차기", "플레어드라이브", "칼춤", IDLE] }), "앙코르", "칼춤");
    check("D3-fix5 변화기 선택(우선도 0): 칼춤이 앙코르 기술(무릎차기)로 바뀐다", r.b?.move.name === "무릎차기", json({ mv: r.b?.move.name })); }
  // 방어(우선도 +4)는 앙코르(짓궂은마음 +1)보다 먼저 움직여 이미 행동한 뒤라 바뀌지 않는다 — 앙코르는 그 방어에 걸린다
  { const r = turn(setup({ last: "방어" }), "앙코르", "방어");
    check("D3-fix5 방어 선택(우선도 +4로 앙코르보다 먼저 행동): 바뀌지 않고 방어가 실행된다", r.b?.move.name === "방어" && r.n.b.volatile.active.encore?.moveId === "방어", json({ mv: r.b?.move.name, enc: r.n.b.volatile.active.encore?.moveId })); }
  // ── 방어 앙코르: 직전 기술이 방어이고 공격을 골랐다 → 방어로 바뀌어 실행되지만 그 턴 마지막 행동이라 방어가 실패한다(Showdown onPrepareHit: 뒤에 행동할 기술이 없으면 실패) ──
  { const st = setup({ last: "방어" }); const r = turn(st, "앙코르", "무릎차기");
    check("D3-fix5 방어 앙코르: 방어로 바뀌어 실행(방어 PP −1·무릎차기 PP 그대로), 마지막 행동이라 방어는 실패", r.b?.move.name === "방어" && r.b.protectFailed === true && r.b.protectSucceeded !== true && r.n.b.remainingPp["방어"] === st.b.remainingPp["방어"] - 1 && r.n.b.remainingPp["무릎차기"] === st.b.remainingPp["무릎차기"], json({ mv: r.b?.move.name, failed: r.b?.protectFailed, pp: r.n.b.remainingPp["방어"] })); }
  // ── 충전 기술 1턴째를 골랐다(불새 — D3-fix-4): 앙코르 기술로 바뀌어 준비가 시작되지 않는다 ──
  { const r = turn(setup({ bMoves: ["무릎차기", "불새", "솔라빔", IDLE] }), "앙코르", "불새");
    check("D3-fix5 충전 1턴째 선택: 불새를 골랐어도 무릎차기로 바뀌고 준비는 시작되지 않는다", r.b?.move.name === "무릎차기" && r.n.b.chargingMoveId === undefined, json({ mv: r.b?.move.name, id: r.n.b.chargingMoveId })); }
  // ── 충전 2턴째(불새 준비 중): 바꾸지 않고 불새가 발동 → 이후 앙코르 기술 = 불새 ──
  { const st = setup({ bMoves: ["불새", "무릎차기", IDLE, "방어"], last: "불새", aAbility: null, aPts: slow, bPts: pts({ atk: 32, spe: 32 }) });
    const prep = rt.runTurn(st, mv(IDLE), mv("불새"), () => 0.5); // 1턴째: b가 불새 준비(a는 도우미)
    const st2 = prep.nextState; st2.b.lastMoveId = "불새";
    const r = turn(st2, "앙코르", "불새");
    check("D3-fix5 충전 2턴째: 준비 중인 상대는 바꾸지 않는다 — 불새 발동", r.b?.move.name === "불새" && r.n.b.chargingMoveId === undefined, json({ prep: prep.nextState.b.chargingMoveId, mv: r.b?.move.name, id: r.n.b.chargingMoveId })); }
  // ── 반동 중인 상대: 움직이지 못한다(교체 여부와 무관), 앙코르 기술 = 파괴광선 ──
  { const st = setup({ aMon: "잠만보", bMoves: ["파괴광선", "무릎차기", IDLE, "방어"], last: "파괴광선" }); // 노말 기술에 면역인 고스트 대신 잠만보(짓궂은마음 부여)
    const first = rt.runTurn(st, mv(IDLE), mv("파괴광선"), () => 0.5); // 1턴: b가 파괴광선 → 반동 상태
    const st2 = first.nextState;
    const recharging = st2.b.volatile.active.recharge !== undefined;
    const r = turn(st2, "앙코르", "무릎차기");
    check("D3-fix5 반동: 반동 중인 상대는 움직이지 못하고 무릎차기로 바뀌지 않는다(앙코르 기술 = 파괴광선)", recharging && r.b?.move.name === "파괴광선" && r.b?.blockedReason !== undefined && r.n.b.remainingPp["무릎차기"] === st2.b.remainingPp["무릎차기"] && r.n.b.volatile.active.encore?.moveId === "파괴광선", json({ rc: recharging, mv: r.b?.move.name, br: r.b?.blockedReason, enc: r.n.b.volatile.active.encore?.moveId })); }
  // ── PP 0 가드: 앙코르 기술의 PP가 0이면 바꾸지 않는다(0 PP 기술을 공짜로 실행하지 않는다) — 기존 실패 동작 유지 ──
  { const r = turn(setup({ tweak: (s) => { s.b.remainingPp["무릎차기"] = 0; } }), "앙코르", "플레어드라이브");
    check("D3-fix5 PP 0 가드: 앙코르 기술의 PP가 0이면 바꾸지 않는다(0 PP 기술을 실행하지 않음)", r.b?.move.name === "플레어드라이브" && r.n.b.remainingPp["무릎차기"] === 0, json({ mv: r.b?.move.name, pp: r.n.b.remainingPp["무릎차기"] })); }
  // ── 매직미러로 반사된 앙코르는 사용자에게 걸린다(이미 행동함) — 상대 행동 변화 없음 ──
  { const st = battle([mon("다크펫", ["앙코르", IDLE], "짓궂은마음", null, fast)], [mon("번치코", ["무릎차기", "플레어드라이브", IDLE, "방어"], "매직미러", null, bulky)]);
    st.b.lastMoveId = "무릎차기"; st.a.lastMoveId = "앙코르";
    const r = turn(st, "앙코르", "플레어드라이브");
    check("D3-fix5 반사: 매직미러로 반사된 앙코르는 상대의 선택을 바꾸지 않는다", r.b?.move.name === "플레어드라이브", json({ mv: r.b?.move.name })); }
}
