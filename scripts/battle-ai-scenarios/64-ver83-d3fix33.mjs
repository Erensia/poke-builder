// 8.3 D3-fix-33 (E6-02·03) 전멸하면 배틀이 그 자리에서 끝난다 + 동시 전멸은 마지막에 쓰러진 쪽이 이긴다(Showdown fieldEvent·resolveFaints·checkWin).
//  · 행동 구간에서 한쪽이 전멸하면 남은 행동·턴 종료 효과를 처리하지 않는다. 엔진은 finishTurn을 끝까지 돌려, 승자가 자기 턴 종료 효과로 쓰러지면 무승부가 났다(무작위 2만 판 중 27판).
//  · 턴 종료 효과도 하나가 끝날 때마다 전멸을 보고, 전멸하면 이후 효과를 건너뛴다. 같은 단계에서 둘 다 쓰러지면 나중에 쓰러진 쪽이 이긴다(무승부 없음).
//  · 포켓몬 간 처리 순서는 이번 PR에서 a→b 그대로(스피드순 정렬은 E6-01, 다음 PR) — 그래서 시험은 a가 더 빠른 구성으로 쓴다.
// 설계 `8.3-D3-E6-검수.md` §2-2·§5, 결정은 `8.3-세션인계.md` 2026-11-23 절.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  const turn = (st, aMove, bMove) => { const out = rt.runTurn(st, act(aMove), act(bMove), () => 0.5); return { out, res: out.result ?? out.partialResult }; };
  const poison = (f) => { f.status = { condition: "poison", turnsElapsed: 1 }; };
  const burn = (f) => { f.status = { condition: "burn", turnsElapsed: 1 }; };
  const eot = (res, key) => res.endOfTurn.filter((e) => e.actor === key);
  // 한카리아스(빠름)와 잠만보(느림) — 매직가드 없음: 독·화상·반동이 그대로 들어온다.
  const FAST = "한카리아스", SLOW = "잠만보";

  // ── 행동 구간 전멸 → 턴 종료 효과 생략 ──
  guard("D3-fix33 1 승자(a, 독 HP 1)가 상대의 마지막 포켓몬을 쓰러뜨리면 자기 독 피해 없이 a 승리(옛: 독으로 쓰러져 무승부)", () => {
    const st = battle([mon(FAST, ["지진", IDLE])], [mon(SLOW, [IDLE])]);
    st.a.currentHp = 1; poison(st.a); st.b.currentHp = 1;
    const { out, res } = turn(st, "지진", IDLE);
    return res.winner === "a" && out.nextState.a.currentHp === 1 && eot(res, "a").length === 0 ? true : json({ winner: res.winner, hp: out.nextState.a.currentHp, eot: eot(res, "a").length });
  });
  guard("D3-fix33 2 두 번째로 움직인 승자(b, 독 HP 1)도 마찬가지: b 승리, 독 피해 없음", () => {
    const st = battle([mon(FAST, [IDLE])], [mon(SLOW, ["지진", IDLE])]);
    st.a.currentHp = 1; st.b.currentHp = 1; poison(st.b);
    const { out, res } = turn(st, IDLE, "지진");
    return res.winner === "b" && out.nextState.b.currentHp === 1 && eot(res, "b").length === 0 ? true : json({ winner: res.winner, hp: out.nextState.b.currentHp });
  });
  guard("D3-fix33 3 전멸이 아니면(상대에게 예비가 있으면) 승자의 턴 종료 효과는 그대로 — a가 독으로 쓰러져 b 승리, 강제 교체 없음", () => {
    const st = battle([mon(FAST, ["지진", IDLE])], [mon(SLOW, [IDLE]), mon("피죤투", [IDLE])]);
    st.a.currentHp = 1; poison(st.a); st.b.currentHp = 1;
    const { res } = turn(st, "지진", IDLE);
    return res.winner === "b" && eot(res, "a").length === 1 ? true : json({ winner: res.winner, eotA: eot(res, "a").length });
  });
  guard("D3-fix33 4 전멸이 아니면 턴 종료 효과가 정상 처리되고 강제 교체를 요구한다(a 독 HP 5는 생존, b 교체)", () => {
    const st = battle([mon(FAST, ["지진", IDLE])], [mon(SLOW, [IDLE]), mon("피죤투", [IDLE])]);
    st.a.currentHp = Math.floor(st.a.maxHp / 8) + 5; poison(st.a); st.b.currentHp = 1;
    const out = rt.runTurn(st, act("지진"), act(IDLE), () => 0.5);
    const res = out.result ?? out.partialResult;
    return !res.winner && eot(res, "a").length === 1 && out.forcedSwitch?.b === true ? true : json({ winner: res.winner, eotA: eot(res, "a").length, fs: out.forcedSwitch });
  });

  // ── 행동 구간 전멸 → 남은 행동 생략 ──
  guard("D3-fix33 5 a가 자기 반동(생명의구슬)으로 전멸하면 b는 행동하지 않는다(옛: b가 쓰러진 a를 향해 행동) — b 승리, 행동 1건", () => {
    const st = battle([mon(FAST, ["지진", IDLE], null, "생명의구슬")], [mon(SLOW, [IDLE])]);
    st.a.currentHp = 1; st.b.maxHp = 5000; st.b.currentHp = 5000;
    const { res } = turn(st, "지진", IDLE);
    return res.winner === "b" && res.actions.length === 1 ? true : json({ winner: res.winner, actions: res.actions.length });
  });
  guard("D3-fix33 6 같은 상황이라도 예비가 있으면 b도 행동한다(회귀) — 승패 미정, a 강제 교체", () => {
    const st = battle([mon(FAST, ["지진", IDLE], null, "생명의구슬"), mon("피죤투", [IDLE])], [mon(SLOW, [IDLE])]);
    st.a.currentHp = 1; st.b.maxHp = 5000; st.b.currentHp = 5000;
    const out = rt.runTurn(st, act("지진"), act(IDLE), () => 0.5);
    const res = out.result ?? out.partialResult;
    return !res.winner && res.actions.length === 2 && out.forcedSwitch?.a === true ? true : json({ winner: res.winner, actions: res.actions.length, fs: out.forcedSwitch });
  });
  guard("D3-fix33 7 자폭 콤보 회귀: 대폭발로 상대 마지막을 쓰러뜨리며 자기도 쓰러지면 콤보 실행 쪽(a) 승리", () => {
    const st = battle([mon(FAST, ["대폭발", IDLE])], [mon(SLOW, [IDLE])]);
    st.b.currentHp = 1;
    const { res } = turn(st, "대폭발", IDLE);
    return res.winner === "a" ? true : json({ winner: res.winner });
  });

  // ── 턴 종료 효과 중 전멸 → 이후 효과 생략 ──
  guard("D3-fix33 8 턴 종료 중 a가 독으로 전멸하면 b의 화상 피해는 처리되지 않는다 — b 승리, b HP 그대로", () => {
    const st = battle([mon(FAST, [IDLE])], [mon(SLOW, [IDLE])]);
    st.a.currentHp = 1; poison(st.a); burn(st.b);
    const full = st.b.currentHp;
    const { out, res } = turn(st, IDLE, IDLE);
    return res.winner === "b" && out.nextState.b.currentHp === full && eot(res, "b").length === 0 ? true : json({ winner: res.winner, hp: out.nextState.b.currentHp, full, eotB: eot(res, "b").length });
  });
  guard("D3-fix33 9 같은 턴 종료에 둘 다 독으로 쓰러질 처지면 먼저 처리되는 a가 쓰러지고 b가 이긴다, b의 독은 처리되지 않아 HP 1 그대로(옛: 무승부)", () => {
    const st = battle([mon(FAST, [IDLE])], [mon(SLOW, [IDLE])]);
    st.a.currentHp = 1; st.b.currentHp = 1; poison(st.a); poison(st.b);
    const { out, res } = turn(st, IDLE, IDLE);
    return res.winner === "b" && out.nextState.b.currentHp === 1 ? true : json({ winner: res.winner, hpB: out.nextState.b.currentHp });
  });
  guard("D3-fix33 10 행동 구간에서 전멸한 턴에는 날씨 지속이 줄지 않고(턴 종료 단계가 없다) 강제 교체도 없다. 턴 종료 중 전멸이면 날씨(order 1)는 독(9)보다 먼저 줄어든다", () => {
    const wipe = battle([mon(FAST, ["지진", IDLE])], [mon(SLOW, [IDLE])]);
    wipe.b.currentHp = 1; wipe.weather = "비"; wipe.weatherTurnsRemaining = 3;
    const w = turn(wipe, "지진", IDLE);
    const eotWipe = battle([mon(FAST, [IDLE])], [mon(SLOW, [IDLE])]);
    eotWipe.a.currentHp = 1; poison(eotWipe.a); eotWipe.weather = "비"; eotWipe.weatherTurnsRemaining = 3;
    const e = turn(eotWipe, IDLE, IDLE);
    return w.res.winner === "a" && w.out.nextState.weatherTurnsRemaining === 3 && !w.out.forcedSwitch && e.out.nextState.weatherTurnsRemaining === 2
      ? true : json({ w: w.out.nextState.weatherTurnsRemaining, e: e.out.nextState.weatherTurnsRemaining, fs: w.out.forcedSwitch });
  });
}
