// 8.3 D3-fix-35 (E7-01) 독압정은 접지일 때만 흡수·중독한다 — Showdown `toxicspikes.onSwitchIn`: `if (!pokemon.isGrounded()) return;`이 맨 앞.
//  엔진은 독 타입이면 접지와 상관없이 흡수해 설치물을 지웠다(풍선·독/비행 등). 비접지면 아무 일도 없고 설치물이 남아야 한다.
// 설계 `8.3-D3-E7-검수.md` §2-1.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const R = (v) => () => v;
  const json = JSON.stringify;
  const mv = (x) => (typeof x === "string" ? { kind: "move", move: data.getMove(x) } : x);
  const hz = (o = {}) => ({ stealthRock: false, spikesLayers: 0, toxicSpikesLayers: 0, stickyWeb: false, ...o });

  // b가 예비(1번)로 교체해 들어오면 sideB 설치물이 발동한다
  const enter = (benchMon, hazards, tweak) => {
    const st = battle([mon("잠만보", ["칼춤"])], [mon("잠만보", ["칼춤"]), benchMon]);
    st.sideB.hazards = hz(hazards);
    tweak?.(st);
    const o = rt.runTurn(st, mv("칼춤"), { kind: "switch", toIndex: 1 }, R(0.5));
    const s = (o.result ?? o.partialResult).switches[0];
    return { sw: s, ns: o.nextState, msgs: s.entryMessages };
  };
  const absorbed = (e) => e.msgs.some((m) => m.includes("독압정을 흡수")) || (e.sw.hazardTriggers ?? []).includes("toxicSpikesAbsorbed");

  // 1 풍선 든 독 타입(비접지): 흡수 안 함 — 설치물 남음·중독 없음·문구/이벤트 없음
  {
    const e = enter(mon("아보크", ["칼춤"], null, "풍선"), { toxicSpikesLayers: 2 });
    check("8.3 D3-fix35 1: 풍선 든 아보크 + 독압정 2층 → 흡수 안 됨, 설치물 2층 남음, 상태 없음, 이벤트 없음",
      !absorbed(e) && e.ns.sideB.hazards.toxicSpikesLayers === 2 && !e.ns.b.status.condition && !("hazardTriggers" in e.sw), json({ msgs: e.msgs, layers: e.ns.sideB.hazards.toxicSpikesLayers }));
  }

  // 2 독/비행(비접지): 마찬가지
  {
    const e = enter(mon("아보크", ["칼춤"]), { toxicSpikesLayers: 1 }, (st) => { st.sideB.party[1].types = ["독", "비행"]; });
    check("8.3 D3-fix35 2: 독/비행 + 독압정 1층 → 흡수 안 됨, 설치물 1층 남음",
      !absorbed(e) && e.ns.sideB.hazards.toxicSpikesLayers === 1 && !e.ns.b.status.condition, json({ msgs: e.msgs, layers: e.ns.sideB.hazards.toxicSpikesLayers }));
  }

  // 3 회귀: 접지 독 타입은 흡수하고 설치물이 사라진다
  {
    const e = enter(mon("아보크", ["칼춤"]), { toxicSpikesLayers: 2 });
    check("8.3 D3-fix35 3: 접지 아보크 + 독압정 2층 → 흡수(층 0)·중독 안 걸림·이벤트 [toxicSpikesAbsorbed]",
      absorbed(e) && e.ns.sideB.hazards.toxicSpikesLayers === 0 && !e.ns.b.status.condition && json(e.sw.hazardTriggers) === '["toxicSpikesAbsorbed"]', json({ msgs: e.msgs, trig: e.sw.hazardTriggers }));
  }

  // 4 중력이면 풍선을 들었어도 접지 → 흡수
  {
    const e = enter(mon("아보크", ["칼춤"], null, "풍선"), { toxicSpikesLayers: 1 }, (st) => { st.gravityTurnsRemaining = 5; });
    check("8.3 D3-fix35 4: 중력 중 풍선 든 아보크 → 접지라 흡수(층 0)",
      absorbed(e) && e.ns.sideB.hazards.toxicSpikesLayers === 0, json({ msgs: e.msgs, layers: e.ns.sideB.hazards.toxicSpikesLayers }));
  }

  // 5 회귀: 비접지 비독 타입(풍선 잠만보)은 중독도 안 걸리고 설치물도 그대로
  {
    const e = enter(mon("잠만보", ["칼춤"], null, "풍선"), { toxicSpikesLayers: 1 });
    check("8.3 D3-fix35 5: 풍선 든 잠만보(비접지, 비독) → 중독 없음·설치물 1층 유지",
      !e.ns.b.status.condition && e.ns.sideB.hazards.toxicSpikesLayers === 1 && !("hazardTriggers" in e.sw), json(e.msgs));
  }

  // 6 회귀: 접지 비독 타입은 독압정에 중독
  {
    const e = enter(mon("잠만보", ["칼춤"]), { toxicSpikesLayers: 1 });
    check("8.3 D3-fix35 6: 접지 잠만보 + 독압정 1층 → 독, 설치물 유지", e.ns.b.status.condition === "poison" && e.ns.sideB.hazards.toxicSpikesLayers === 1, json(e.ns.b.status));
  }
}
