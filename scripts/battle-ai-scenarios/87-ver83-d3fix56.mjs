// 8.3 D3-fix-56 (E8-51 a~e + 검수 R5·R-i·R-g) 먼저 움직인 쪽이 교체 직후 설치물로 쓰러진 턴, 뒤 행동의 "대상 없음" 판정을 Showdown과 맞춘다.
// 설계 `8.3-D3-fix56-대상없음판정설계.md` §3. 공통 장면: p1(a)이 예비1(HP 1)로 교체 → 스텔스록 기절 → 같은 턴 p2(b)의 기술.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const SW = (i) => ({ kind: "switch", toIndex: i });
  const rnd = () => 0.5;
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const eq = (got, want) => JSON.stringify(got) === JSON.stringify(want) ? true : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`;
  // b 파티: 활성 bId(bMoves, bAb) [+ 예비 1마리]. a 파티: [활성, 예비1(HP 1), 예비2]
  const scene = ({ bId = "잠만보", bMoves, bAb = "두꺼운지방", bSpare = true, sleep = false } = {}) => {
    const B = [mon(bId, bMoves, bAb)]; if (bSpare) B.push(mon("잠만보", ["누르기"]));
    const st = battle([mon("잠만보", ["누르기"]), mon("잠만보", ["누르기"]), mon("잠만보", ["누르기"])], B);
    if (sleep) st.sideB.party[0].status = { condition: "sleep", turnsElapsed: 0, sleepTurns: 3 };
    st.sideA.hazards = { ...st.sideA.hazards, stealthRock: true };
    st.sideA.party[1].currentHp = 1;
    return st;
  };
  const go = (st, bm) => rt.runTurn(st, SW(1), mv(bm), rnd);
  const bAct = (o) => o.result.actions.find((x) => x.actor === "b");
  const act = (o) => bAct(o)?.blockedReason;

  guard("D3-fix56 1: 고스트 저주 — 실패, 사용자 HP 그대로", () => {
    const st = scene({ bId: "팬텀", bMoves: ["저주", "방어"] }); const h0 = st.b.currentHp;
    const o = go(st, "저주");
    return eq([act(o), o.nextState.b.currentHp], ["usageCondition", h0]);
  });
  guard("D3-fix56 1b: 비고스트 저주 — 성공(공·방 +1, 스피드 −1)", () => {
    const o = go(scene({ bMoves: ["저주", "방어"] }), "저주"); const s = o.nextState.b.stages;
    return eq([act(o) ?? null, s.atk, s.def, s.spe], [null, 1, 1, -1]);
  });
  guard("D3-fix56 2: 록온 — 실패, lockOn 없음", () => {
    const o = go(scene({ bMoves: ["록온", "방어"] }), "록온");
    return eq([act(o), !!o.nextState.b.volatile?.active?.lockOn], ["usageCondition", false]);
  });
  guard("D3-fix56 3: 문어굳히기 — usageCondition", () => eq(act(go(scene({ bMoves: ["문어굳히기", "방어"] }), "문어굳히기")), "usageCondition"));
  guard("D3-fix56 4: 미래예지 — 예약 성공, 2턴 뒤 대체(party[2])가 맞는다", () => {
    const o = go(scene({ bMoves: ["미래예지", "방어"] }), "미래예지");
    if (act(o)) return `blocked ${act(o)}`;
    if (!o.nextState.sideA.futureSight) return "예약 없음";
    let s = sw.applySwitch(o.nextState, "a", 2).nextState; const h0 = s.a.currentHp;
    for (let t = 0; t < 2; t++) s = rt.runTurn(s, mv("누르기"), mv("방어"), rnd).nextState;
    return s.sideA.party[2].currentHp < h0 - 5 ? true : `대체 HP ${h0} → ${s.sideA.party[2].currentHp}`;
  });
  for (const m of ["대폭발", "자폭", "미스트버스트"]) {
    guard(`D3-fix56 5: ${m} — 실패 + 사용자 기절, 예비가 있으면 forcedSwitch {a, b}`, () => {
      const o = go(scene({ bMoves: [m, "방어"] }), m);
      return eq([act(o), bAct(o)?.selfFainted, o.nextState.b.currentHp, o.forcedSwitch], ["usageCondition", true, 0, { a: true, b: true }]);
    });
  }
  guard("D3-fix56 5b: 대폭발 — 사용자가 마지막 1마리면 a 승", () => eq(go(scene({ bMoves: ["대폭발", "방어"], bSpare: false }), "대폭발").result.winner ?? null, "a"));
  guard("D3-fix56 6: 칼춤·압정뿌리기 성공, 누르기·철제광선 실패(철제광선 반동 없음)", () => {
    const r = ["칼춤", "압정뿌리기", "누르기", "철제광선"].map((m) => { const st = scene({ bMoves: [m, "방어"] }); const h0 = st.b.currentHp; const o = go(st, m); return [act(o) ?? null, o.nextState.b.currentHp === h0]; });
    return eq(r, [[null, true], [null, true], ["usageCondition", true], ["usageCondition", true]]);
  });
  guard("D3-fix56 7: 습기 — 사용자가 습기면 대폭발 실패·기절 없음", () => {
    const o = go(scene({ bMoves: ["대폭발", "방어"], bAb: "습기" }), "대폭발");
    return eq([bAct(o)?.selfFainted ?? false, o.nextState.b.currentHp > 0], [false, true]);
  });
  guard("D3-fix56 7b: 습기 — 쓰러진 대상이 습기여도 사용자는 기절", () => {
    const st = scene({ bMoves: ["대폭발", "방어"] }); st.sideA.party[1].slot.ability = "습기";
    const o = go(st, "대폭발");
    return eq([act(o), o.nextState.b.currentHp], ["usageCondition", 0]);
  });
  // R-i: 잠꼬대 → 부른 기술. 잠든 b의 기술은 [잠꼬대, 부를 기술]
  const talk = (called, ab) => { const st = scene({ bMoves: ["잠꼬대", called], sleep: true }); st.sideA.party[1].slot.ability = ab ?? "두꺼운지방"; return go(st, "잠꼬대"); };
  guard("D3-fix56 8: 잠꼬대→누르기 — 실패, 데미지 0, 쓰러진 대상의 까칠한피부 없음, 부른 기술 이름이 실린다", () => {
    const o = talk("누르기", "까칠한피부"); const a = bAct(o); const st0 = scene({ bMoves: ["잠꼬대", "누르기"], sleep: true });
    return eq([a?.blockedReason, a?.damage ?? 0, o.nextState.b.currentHp === st0.b.currentHp, a?.sleepTalkCalledMoveName], ["usageCondition", 0, true, "누르기"]);
  });
  guard("D3-fix56 8b: 잠꼬대→대폭발 — 실패 + 사용자 기절", () => {
    const o = talk("대폭발"); return eq([act(o), o.nextState.b.currentHp], ["usageCondition", 0]);
  });
  guard("D3-fix56 8c: 흉내쟁이 — 직전 기술이 공격기여도 실패, 데미지 0", () => {
    const st = scene({ bMoves: ["흉내쟁이", "방어"] }); st.lastMoveUsedId = "누르기";
    const o = go(st, "흉내쟁이"); const a = bAct(o);
    return a?.blockedReason === "usageCondition" && !(a?.damage > 0) && a?.copycatCalledMoveName === "누르기" ? true : `blocked ${a?.blockedReason} dmg ${a?.damage} called ${a?.copycatCalledMoveName}`;
  });
  // R-g: 차지 기술 준비 턴
  guard("D3-fix56 9: 메테오빔 — 준비 성공(특공 +1), 다음 턴 대체에게 적중", () => {
    const o = go(scene({ bMoves: ["메테오빔", "방어"] }), "메테오빔");
    if (act(o)) return `blocked ${act(o)}`;
    if (o.nextState.b.stages.spa !== 1) return `특공 ${o.nextState.b.stages.spa}`;
    let s = sw.applySwitch(o.nextState, "a", 2).nextState; const h0 = s.a.currentHp;
    s = rt.runTurn(s, mv("누르기"), mv("방어"), rnd).nextState;
    return s.a.currentHp < h0 ? true : `대체 HP ${h0} → ${s.a.currentHp}`;
  });
  guard("D3-fix56 9b: 솔라빔(쾌청) — 준비 생략 → 실패", () => {
    const st = scene({ bMoves: ["솔라빔", "방어"] }); st.weather = "쾌청";
    return eq(act(go(st, "솔라빔")), "usageCondition");
  });
  guard("D3-fix56 9c: 일렉트로빔(비) — 특공 +1 후 실패", () => {
    const st = scene({ bMoves: ["일렉트로빔", "방어"] }); st.weather = "비";
    const o = go(st, "일렉트로빔");
    return eq([act(o), o.nextState.b.stages.spa], ["usageCondition", 1]);
  });
}
