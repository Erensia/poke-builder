// 8.3 D3-fix-38 (E7-05·E7-06) 교체 소정정 — Showdown(champions) `clearVolatile`은 교체하면 분노의주먹 카운터(`timesAttacked`)를 0으로 되돌리고,
//  도주(`runaway.onTrapPokemon`)는 속박·검은눈빛·페어리록 등 교체 불가를 무시한다. 엔진은 카운터를 남겼고 도주는 설명만 있고 효과가 없었다.
// 설계 `8.3-D3-E7-검수.md` §2-4.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
  const vol = await server.ssrLoadModule("/src/lib/volatileConditions.ts");
  const json = JSON.stringify;
  const mv = (x) => (typeof x === "string" ? { kind: "move", move: data.getMove(x) } : x);
  const put = (f, ...ids) => { for (const id of ids) f.volatile = vol.inflictVolatile(f.volatile, id, () => 0.5); };

  // ── E7-05 분노의주먹 카운터: 교체로 물러나면 0(초기화) ──
  {
    const st = battle([mon("잠만보", ["분노의주먹"]), mon("잠만보", ["하품"])], [mon("잠만보", ["하품"])]);
    st.a.timesHitByMoves = 3;
    const o = rt.runTurn(st, { kind: "switch", toIndex: 1 }, mv("하품"), () => 0.5);
    const out = o.nextState.sideA.party[0];
    check("D3-fix38 1: 맞은 횟수 3인 분노의주먹 사용자가 교체로 물러나면 카운터가 초기화된다", !out.timesHitByMoves, json({ times: out.timesHitByMoves }));
  }
  {
    const st = battle([mon("잠만보", ["분노의주먹"]), mon("잠만보", ["하품"])], [mon("잠만보", ["하품"])]);
    st.a.timesHitByMoves = 3;
    const o = rt.runTurn(st, mv("하품"), mv("하품"), () => 0.5);
    check("D3-fix38 2: 교체하지 않으면 카운터 유지(회귀)", o.nextState.a.timesHitByMoves === 3, json({ times: o.nextState.a.timesHitByMoves }));
  }

  // ── E7-06 도주: 교체 불가를 무시 ──
  const trap = (name, ability, ...vols) => {
    const st = battle([mon(name, ["하품"], ability), mon("잠만보", ["하품"])], [mon("잠만보", ["하품"])]);
    put(st.a, ...vols);
    return st;
  };
  for (const [label, vols] of [["검은눈빛", ["meanLook"]], ["문어굳히기", ["octolock"]], ["물고버티기", ["jawLock"]], ["속박", ["bound"]]]) {
    const run = trap("폭슬라이", "도주", ...vols), norm = trap("잠만보", null, ...vols);
    check(`D3-fix38 3 ${label}: 도주 보유자는 교체할 수 있고, 일반 포켓몬은 여전히 못 한다(회귀)`,
      sw.isTrappedFromSwitching(run.a, run) === false && sw.isTrappedFromSwitching(norm.a, norm) === true, json({ run: sw.isTrappedFromSwitching(run.a, run), norm: sw.isTrappedFromSwitching(norm.a, norm) }));
  }
  {
    const run = trap("폭슬라이", "도주"), norm = trap("잠만보", null);
    run.fairyLockTurnsRemaining = 1; norm.fairyLockTurnsRemaining = 1;
    check("D3-fix38 4 페어리록: 도주 보유자는 교체 가능, 일반은 불가", sw.isTrappedFromSwitching(run.a, run) === false && sw.isTrappedFromSwitching(norm.a, norm) === true, json({ run: sw.isTrappedFromSwitching(run.a, run), norm: sw.isTrappedFromSwitching(norm.a, norm) }));
  }
  {
    const mk = (name, ability) => battle([mon(name, ["하품"], ability), mon("잠만보", ["하품"])], [mon("잠만보", ["하품"], "그림자밟기")]);
    const run = mk("폭슬라이", "도주"), norm = mk("잠만보", null);
    check("D3-fix38 5 그림자밟기: 도주 보유자는 교체 가능, 일반은 불가", sw.isTrappedFromSwitching(run.a, run) === false && sw.isTrappedFromSwitching(norm.a, norm) === true, json({ run: sw.isTrappedFromSwitching(run.a, run), norm: sw.isTrappedFromSwitching(norm.a, norm) }));
  }
  {
    const st = trap("폭슬라이", "도주");
    check("D3-fix38 6 교체 불가 상태가 없는 도주 보유자(회귀): 교체 가능", sw.isTrappedFromSwitching(st.a, st) === false, "");
  }
}
