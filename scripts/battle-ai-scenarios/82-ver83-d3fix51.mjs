// 8.3 D3-fix-51 (E8-41) 가속은 턴 도중 등장한 포켓몬에게 그 턴 끝에 발동하지 않는다(Showdown `activeTurns === 0`).
// 설계 `8.3-D3-fix51-가속등장턴설계.md` §3, 검수 `…-검수.md`. 실행 대조 `fix51-review-run.cjs`(경로 10개). 대기 기술은 잠꼬대(깨어 있으면 실패 — 방어는 상대 공격을 막는다).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const SW = (i) => ({ kind: "switch", toIndex: i });
  const NOP = "잠꼬대";
  const rnd = () => 0;
  const plain = (moves = [NOP], item = null, ability = "두꺼운지방") => mon("잠만보", moves, ability, item);
  const SB = () => plain([NOP], null, "가속");
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  // 한 턴. 유턴류·위기회피·탈출버튼 같은 자체 교체 일시정지는 pick 슬롯으로 이어간다.
  const turn = (st, a, b, pick = 1) => {
    let o = rt.runTurn(st, a, b, rnd);
    for (let g = 0; o.awaitingSelfSwitch && g < 5; g++) o = rt.resumeTurn(o._ctx, pick);
    return o.nextState;
  };
  // 두 턴: 가속 포켓몬이 들어온 그 턴 끝 spe 랭크와 다음 턴 끝 spe 랭크
  const twoTurns = (st, t1, t2, pick) => { const s1 = turn(st, t1[0], t1[1], pick); const e1 = s1.a.stages.spe; const s2 = turn(s1, t2[0], t2[1], pick); return { e1, e2: s2.a.stages.spe, who: s1.a.slot.ability }; };
  const want = (r, e1, e2) => r.who === "가속" && r.e1 === e1 && r.e2 === e2 ? true : JSON.stringify(r);

  // ── 1~3 강제 교체: 드래곤테일 / 울부짖기 · 날려버리기 / 레드카드 — 그 턴 0, 다음 턴 1 ──
  for (const m of ["드래곤테일", "울부짖기", "날려버리기"]) {
    guard(`D3-fix51 1·2: ${m}로 끌려 나온 가속 포켓몬 — 그 턴 spe 0, 다음 턴 끝 1`, () =>
      want(twoTurns(battle([plain(), SB()], [plain([NOP, m]), plain()]), [mv(NOP), mv(m)], [mv(NOP), mv(NOP)]), 0, 1));
  }
  guard("D3-fix51 3: 레드카드로 쫓겨난 공격자 자리에 가속 포켓몬 — 그 턴 spe 0, 다음 턴 끝 1", () =>
    want(twoTurns(battle([plain([NOP, "아이언헤드"]), SB()], [plain([NOP], "레드카드"), plain()]), [mv("아이언헤드"), mv(NOP)], [mv(NOP), mv(NOP)]), 0, 1));

  // ── 4 행동 전 기절 대체(스텔스록으로 교체 포켓몬 기절 → 대체가 가속). E8-46(대체 시점)과 독립 — 기대값 불변(fix-55가 대체를 턴 끝으로 옮겨도 같다) ──
  guard("D3-fix51 4: 행동 전 기절 대체로 들어온 가속 포켓몬 — 그 턴 spe 0, 다음 턴 끝 1 (E8-46과 독립)", () => {
    let st = battle([plain(), plain(), SB()], [plain([NOP, "스텔스록", "아이언헤드"]), plain()]);
    st = turn(st, mv(NOP), mv("스텔스록"));
    st.sideA.party[1].currentHp = 1;
    st = turn(st, SW(1), mv("아이언헤드"), 2); // 교체 → 설치물로 기절 → 대체(가속, 슬롯 2)
    const e1 = st.a.stages.spe; const who = st.a.slot.ability;
    st = turn(st, mv(NOP), mv(NOP));
    return who === "가속" && e1 === 0 && st.a.stages.spe === 1 ? true : JSON.stringify({ who, e1, e2: st.a.stages.spe });
  });

  // ── 5·6 회귀: 자발 교체 · 유턴류 중간 교체 ──
  guard("D3-fix51 5: 회귀 — 자발 교체로 나온 가속 포켓몬 — 0 → 1", () =>
    want(twoTurns(battle([plain(), SB()], [plain(), plain()]), [SW(1), mv(NOP)], [mv(NOP), mv(NOP)]), 0, 1));
  for (const m of ["유턴", "배턴터치", "꼬리자르기"]) {
    guard(`D3-fix51 6: 회귀 — ${m}로 들어온 가속 포켓몬 — 0 → 1`, () =>
      want(twoTurns(battle([plain([NOP, m]), SB()], [plain(), plain()]), [mv(m), mv(NOP)], [mv(NOP), mv(NOP)]), 0, 1));
  }

  // ── 7 회귀: 탈출버튼 · 위기회피 ──
  guard("D3-fix51 7: 회귀 — 탈출버튼으로 교체된 가속 포켓몬 — 0 → 1", () =>
    want(twoTurns(battle([plain([NOP], "탈출버튼"), SB()], [plain([NOP, "아이언헤드"]), plain()]), [mv(NOP), mv("아이언헤드")], [mv(NOP), mv(NOP)]), 0, 1));
  guard("D3-fix51 7: 회귀 — 위기회피로 교체된 가속 포켓몬(HP를 절반 바로 위로) — 0 → 1", () => {
    const st = battle([plain([NOP], null, "위기회피"), SB()], [plain([NOP, "아이언헤드"]), plain()]);
    st.a.currentHp = 170;
    return want(twoTurns(st, [mv(NOP), mv("아이언헤드")], [mv(NOP), mv(NOP)]), 0, 1);
  });

  // ── 8 회귀: 턴과 턴 사이의 기절 교체(applySwitch) — 교체 직후 0, 다음 턴 끝 1 ──
  guard("D3-fix51 8: 회귀 — 턴 사이 기절 교체로 나온 가속 포켓몬 — 교체 직후 0, 다음 턴 끝 1", () => {
    let st = battle([plain(), SB()], [plain([NOP, "아이언헤드"]), plain()]);
    st.a.currentHp = 1;
    st = turn(st, mv(NOP), mv("아이언헤드"));
    if (st.a.currentHp !== 0) return "기절 안 함";
    st = sw.applySwitch(st, "a", 1).nextState;
    const e0 = st.a.stages.spe;
    st = turn(st, mv(NOP), mv(NOP));
    return e0 === 0 && st.a.stages.spe === 1 ? true : JSON.stringify({ e0, e2: st.a.stages.spe });
  });

  // ── 9 회귀: 배틀 시작부터 나온 가속 포켓몬 · 10 +6 상한 ──
  guard("D3-fix51 9: 회귀 — 배틀 시작 가속 포켓몬 — 첫 턴 1, 둘째 턴 2", () => {
    let st = battle([SB(), plain()], [plain(), plain()]);
    st = turn(st, mv(NOP), mv(NOP)); const e1 = st.a.stages.spe;
    st = turn(st, mv(NOP), mv(NOP));
    return e1 === 1 && st.a.stages.spe === 2 ? true : JSON.stringify({ e1, e2: st.a.stages.spe });
  });
  guard("D3-fix51 10: 회귀 — +6에서 한 턴 더 — 6 유지", () => {
    const st = battle([SB(), plain()], [plain(), plain()]);
    st.a.stages = { ...st.a.stages, spe: 6 };
    return turn(st, mv(NOP), mv(NOP)).a.stages.spe === 6 ? true : "6 아님";
  });

  // ── 11 표지 불변: 강제 교체 뒤 switchedInThisTurn(AI 맞교체 판정용)은 안 서고 enteredThisTurn만 선다 ──
  guard("D3-fix51 11: 강제 교체 후 switchedInThisTurn=false · enteredThisTurn=true (AI 표지 불변)", () => {
    const st = turn(battle([plain(), SB()], [plain([NOP, "드래곤테일"]), plain()]), mv(NOP), mv("드래곤테일"));
    return !st.a.switchedInThisTurn && st.a.enteredThisTurn === true ? true : JSON.stringify({ s: st.a.switchedInThisTurn, e: st.a.enteredThisTurn });
  });
}
