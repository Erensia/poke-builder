// 8.3 D3-fix-55 (E8-46 + 검수 R1~R3) 교체 직후 설치물로 쓰러지면 대체는 행동 전이 아니라 턴 끝(잔류 처리 뒤)에 들어온다.
// 상대 행동은 그대로 진행(쓰러진 대상을 노리는 기술은 실패, 자기 대상·필드 기술은 정상). 설계 `8.3-D3-fix55-행동전기절대체설계.md` §3, 검수 `…-검수.md`.
// 시험 9(사전 쓰러짐 + 예비 없음)는 구성 불가 — 그 턴 자발 교체한 포켓몬만 사전 쓰러짐이 되고, 교체로 나간 포켓몬이 살아 있어 대체 후보가 항상 있다(실행 시험 없음).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const SW = (i) => ({ kind: "switch", toIndex: i });
  const NOP = "잠꼬대";
  const rnd = () => 0;
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const eq = (got, want) => JSON.stringify(got) === JSON.stringify(want) ? true : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`;
  const mk = (id, moves, ab = "두꺼운지방", item = null) => mon(id, moves, ab, item);
  // p1(a) 파티 [활성, 예비1(HP 1), 예비2], p1 편에 스텔스록. p2(b)는 bMoves를 쓴다.
  const scene = ({ bMoves = [NOP], bAb = "두꺼운지방", bItem = null, aReserve2Ab = "두꺼운지방", aReserve2Item = null, prep } = {}) => {
    const st = battle([mk("잠만보", [NOP]), mk("잠만보", [NOP]), mk("잠만보", [NOP], aReserve2Ab, aReserve2Item)], [mk("잠만보", bMoves, bAb, bItem), mk("잠만보", [NOP])]);
    st.sideA.hazards.stealthRock = true;
    st.sideA.party[1].currentHp = 1;
    prep?.(st);
    return st;
  };
  const go = (st, am, bm) => rt.runTurn(st, am, bm, rnd);
  const bAct = (o) => o.result.actions.find((x) => x.actor === "b");

  // 1 공격기: 일시정지 없음, p2 행동 실패(usageCondition), 활성 a 기절 + forcedSwitch.a
  guard("D3-fix55 1: 상대 공격기 — 일시정지 없음, 상대 행동 usageCondition, 턴 끝 forcedSwitch.a", () => {
    const o = go(scene({ bMoves: ["아이언헤드"] }), SW(1), mv("아이언헤드"));
    if (o.awaitingSelfSwitch) return "일시정지 발생";
    const b = bAct(o);
    return eq([b?.blockedReason, o.forcedSwitch, o.nextState.a.currentHp], ["usageCondition", { a: true }, 0]);
  });
  // 1b 대체는 턴 밖 applySwitch로 들어와 스텔스록 피해만 받는다(공격 피해 없음)
  guard("D3-fix55 1b: 대체는 applySwitch로 들어와 스텔스록 피해만 받는다", () => {
    const o = go(scene({ bMoves: ["아이언헤드"] }), SW(1), mv("아이언헤드"));
    const s = sw.applySwitch(o.nextState, "a", 2).nextState;
    const loss = s.a.maxHp - s.a.currentHp;
    return loss > 0 && loss <= Math.ceil(s.a.maxHp / 4) ? true : `loss ${loss}/${s.a.maxHp}`;
  });
  // 2 자기 대상·필드 기술은 정상
  guard("D3-fix55 2: 칼춤 — 상대 행동 정상(공격 +2)", () => eq(go(scene({ bMoves: ["칼춤"] }), SW(1), mv("칼춤")).nextState.b.stages.atk, 2));
  guard("D3-fix55 2: 달빛 — HP 절반이던 상대가 회복", () => {
    const st = scene({ bMoves: ["달빛"] }); st.b.currentHp = Math.floor(st.b.maxHp / 2); const h0 = st.b.currentHp;
    const o = go(st, SW(1), mv("달빛"));
    return o.nextState.b.currentHp > h0 && !o.awaitingSelfSwitch ? true : `hp ${h0} → ${o.nextState.b.currentHp}`;
  });
  guard("D3-fix55 2: 비바라기 — 날씨 변경", () => eq(go(scene({ bMoves: ["비바라기"] }), SW(1), mv("비바라기")).nextState.weather ?? null, "비"));
  // 3 상대 대상 변화기는 실패
  guard("D3-fix55 3: 맹독 — 실패, 대체(applySwitch 뒤)에 상태이상 없음", () => {
    const o = go(scene({ bMoves: ["맹독"] }), SW(1), mv("맹독"));
    const s = sw.applySwitch(o.nextState, "a", 2).nextState;
    return eq([bAct(o)?.blockedReason, s.a.status.condition ?? null], ["usageCondition", null]);
  });
  // 4 우선도
  guard("D3-fix55 4: 전광석화 — 실패", () => eq(bAct(go(scene({ bMoves: ["전광석화"] }), SW(1), mv("전광석화")))?.blockedReason, "usageCondition"));
  // 5 잔류 → 대체
  guard("D3-fix55 5: 상대 먹다남은음식 — 잔류 회복이 돌고 p1 대체는 턴 끝 forcedSwitch", () => {
    const st = scene({ bItem: "먹다남은음식" }); st.b.currentHp = Math.floor(st.b.maxHp / 2); const h0 = st.b.currentHp;
    const o = go(st, SW(1), mv(NOP));
    return !o.awaitingSelfSwitch && o.forcedSwitch?.a && o.nextState.b.currentHp > h0 ? true : `pause ${!!o.awaitingSelfSwitch} fs ${JSON.stringify(o.forcedSwitch)} hp ${h0} → ${o.nextState.b.currentHp}`;
  });
  // 6 양쪽 모두 교체해 기절
  guard("D3-fix55 6: 양쪽 모두 교체해 기절 — 일시정지 없음, forcedSwitch가 {a, b}", () => {
    const st = scene(); st.sideB.hazards.stealthRock = true; st.sideB.party[1].currentHp = 1;
    const o = go(st, SW(1), SW(1));
    return !o.awaitingSelfSwitch ? eq(o.forcedSwitch, { a: true, b: true }) : "일시정지 발생";
  });
  // 10 가속: 대체 직후 spe 0, 다음 턴 끝 +1
  guard("D3-fix55 10: 가속 대체 — 대체 직후 spe 0, 다음 턴 끝 1", () => {
    const o = go(scene({ aReserve2Ab: "가속", bMoves: ["아이언헤드"] }), SW(1), mv("아이언헤드"));
    const s = sw.applySwitch(o.nextState, "a", 2).nextState; const e1 = s.a.stages.spe;
    const o2 = rt.runTurn(s, mv(NOP), mv(NOP), rnd);
    return eq([s.a.slot.ability, e1, o2.nextState.a.stages.spe], ["가속", 0, 1]);
  });
  // 11 대체는 그 턴 잔류 효과를 받지 않는다
  guard("D3-fix55 11: 상대 먹다남은음식·변덕쟁이 보유 대체 — 대체 HP는 설치물 피해만, 랭크 변화 없음", () => {
    const o = go(scene({ aReserve2Ab: "변덕쟁이", bItem: "먹다남은음식" }), SW(1), mv(NOP));
    const s = sw.applySwitch(o.nextState, "a", 2).nextState;
    const stages = Object.values(s.a.stages).every((v) => v === 0);
    return stages && s.a.currentHp < s.a.maxHp ? true : `stages ${JSON.stringify(s.a.stages)} hp ${s.a.currentHp}/${s.a.maxHp}`;
  });
  // 12 R3: 그 턴 새 압정을 대체가 턴 끝에 밟는다(현행 실패)
  guard("D3-fix55 12: 상대 압정뿌리기 — 대체가 스텔스록 + 압정 피해(턴 끝 등장)", () => {
    const o = go(scene({ bMoves: ["압정뿌리기"] }), SW(1), mv("압정뿌리기"));
    if (!o.nextState.sideA.hazards.spikesLayers) return "압정 미설치";
    const s = sw.applySwitch(o.nextState, "a", 2).nextState;
    const ref = sw.applySwitch(go(scene({ bMoves: [NOP] }), SW(1), mv(NOP)).nextState, "a", 2).nextState;
    return s.a.currentHp < ref.a.currentHp ? true : `압정 피해 없음 hp ${s.a.currentHp} vs 기준 ${ref.a.currentHp}`;
  });
  // 13 R3: 씨뿌리기를 건 쪽 자리가 쓰러지면 흡수 없음
  guard("D3-fix55 13: p1이 걸어 둔 씨뿌리기 — 그 자리가 이번 턴 기절하면 p2 HP 변화 없음", () => {
    const st = scene(); st.b.volatile.active.leechSeed = {}; st.b.currentHp = Math.floor(st.b.maxHp / 2); const h0 = st.b.currentHp;
    const o = go(st, SW(1), mv(NOP));
    return o.nextState.b.currentHp === h0 ? true : `hp ${h0} → ${o.nextState.b.currentHp}`;
  });
  // 14 R3: 상대 배턴터치 — 일시정지는 b 하나, 이어서 forcedSwitch.a
  guard("D3-fix55 14: 상대 배턴터치 — 일시정지는 b 하나, 이어서 forcedSwitch.a", () => {
    let o = go(scene({ bMoves: ["배턴터치"] }), SW(1), mv("배턴터치"));
    if (!o.awaitingSelfSwitch || o.awaitingSelfSwitch.side !== "b") return `일시정지 ${JSON.stringify(o.awaitingSelfSwitch)}`;
    o = rt.resumeTurn(o._ctx, 1);
    return o.awaitingSelfSwitch ? "일시정지 2회" : eq(o.forcedSwitch, { a: true });
  });
}
