// 8.3 D3-fix-20 도발·앙코르·사슬묶기 지속은 **턴 종료**에 줄어든다(Showdown residual 15·16·17 — 걸린 턴·못 움직인 턴도 센다) + 부여 시점 보정:
// 도발 3(+1: 대상이 이번 턴 이전부터 필드에 있었고 이미 움직임)·앙코르 3(+1: 이미 움직임)·사슬묶기 5(−1: 아직 안 움직임 — 엔진 기본값은 "아직 안 움직임"인 4, 이미 움직임이면 +1).
// "이미 움직였나"는 `c.movesSecond`(공격측 후공)에 "대상이 이번 턴 입장한 게 아님"을 더한 것이다(U턴 뒤·턴 시작 교체로 들어온 대상은 +1 없음).
// 설계 `8.3-D3-fix20-소모시점설계.md`(검수 `…-검수.md`). E4b-07·08. 설계 시험 11(저주받은바디 −1)은 엔진이 저주받은바디를 휘발이 아니라 PP 0으로 구현해 해당 없음(설계서 §8).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const ra = await server.ssrLoadModule("/src/lib/battle/resolveAction.ts");
  const json = JSON.stringify;
  const M = (n) => data.getMove(n);
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  const bAct = (out) => (out.result ?? out.partialResult).actions.find((x) => x.actor === "b");
  const mk = ({ first, bTwo = false } = {}) => {
    const st = battle(
      [mon("한카리아스", [IDLE, "도발", "사슬묶기", "앙코르"])],
      bTwo ? [mon("잠만보", [IDLE]), mon("루카리오", [IDLE])] : [mon("잠만보", [IDLE])],
    );
    // first=true: 공격측(a)이 선공(대상은 아직 안 움직임), false: 후공(대상이 이미 움직임)
    st.a.realStats = { ...st.a.realStats, spe: first ? 300 : 10 };
    st.b.realStats = { ...st.b.realStats, spe: first ? 10 : 300 };
    return st;
  };
  // 예열 한 턴(둘 다 칼춤 — 대상이 입장 직후가 아니게 하고 lastMoveId를 만든다) 뒤 turn 1에 aMove를 쓰고, b는 매 턴 칼춤. 이후 턴은 a도 칼춤.
  // 반환: 턴별 {reason: 대상 b의 막힘 이유(없으면 "-"), has: 그 턴 종료 뒤 걸려 있는 휘발성 목록}
  const run = (st0, aMove, turns, { between } = {}) => {
    let st = rt.runTurn(st0, act(IDLE), act(IDLE), () => 0.5).nextState;
    const rows = [];
    for (let t = 1; t <= turns; t++) {
      if (between) between(st, t);
      const out = rt.runTurn(st, act(t === 1 ? aMove : IDLE), act(IDLE), () => 0.5);
      rows.push({ reason: bAct(out)?.blockedReason ?? "-", has: Object.keys(out.nextState.b.volatile.active).filter((k) => ["taunt", "encore", "disable"].includes(k)) });
      st = out.nextState;
    }
    return { rows, st };
  };
  const pattern = (rows) => rows.map((r) => (r.reason === "moveRestricted" ? "X" : r.reason === "-" ? "." : r.reason[0])).join("");

  guard("D3-fix20 1 도발: 평소 행동 수 3 불변 — 선공은 [XXX.], 후공은 [.XXX.](걸린 턴의 행동은 이미 끝남)", () => {
    const f = pattern(run(mk({ first: true }), "도발", 4).rows), s = pattern(run(mk({ first: false }), "도발", 5).rows);
    return f === "XXX." && s === ".XXX." ? true : json({ first: f, second: s });
  });
  guard("D3-fix20 2 사슬묶기: 평소 막는 행동 수 4 불변 — 선공 [XXXX.], 후공 [.XXXX.]", () => {
    const f = pattern(run(mk({ first: true }), "사슬묶기", 5).rows), s = pattern(run(mk({ first: false }), "사슬묶기", 6).rows);
    return f === "XXXX." && s === ".XXXX." ? true : json({ first: f, second: s });
  });
  guard("D3-fix20 3 앙코르: 선공이면 3턴 종료 뒤 해제(걸린 턴 포함 2턴 뒤까지 유지), 후공이면 한 턴 더 — 유지 턴 [선공 2·후공 3]", () => {
    const f = run(mk({ first: true }), "앙코르", 4).rows.map((r) => r.has.includes("encore") ? 1 : 0).join("");
    const s = run(mk({ first: false }), "앙코르", 5).rows.map((r) => r.has.includes("encore") ? 1 : 0).join("");
    return f === "1100" && s === "11100" ? true : json({ first: f, second: s });
  });
  guard("D3-fix20 4 수면 중에도 소모(도발): 후공 도발(지속 4) 뒤 대상이 세 턴 자면(수면 스케줄 상 2~3턴) 깨어난 턴에는 이미 해제 [., s, s, s, .](현행은 [., s, s, s, X])", () => {
    const { rows } = run(mk({ first: false }), "도발", 5, { between: (st, t) => { if (t === 2) st.b.status = { condition: "sleep", turnsElapsed: 0 }; } });
    const p = pattern(rows);
    return p === ".sss." ? true : json({ pattern: p, rows });
  });
  guard("D3-fix20 5 재충전으로 못 움직인 턴도 소모(도발): 선공 도발 뒤 두 턴 재충전이면 4번째 턴에는 이미 해제 [X, r, r, .](현행은 재충전 턴에 소모되지 않아 마지막에 X). 도발(5)은 마비(1)보다 먼저 판정돼 마비로는 시험할 수 없고, 풀죽음은 러너가 턴 시작에 지운다", () => {
    let st = rt.runTurn(mk({ first: true }), act(IDLE), act(IDLE), () => 0.5).nextState;
    const out1 = rt.runTurn(st, act("도발"), act(IDLE), () => 0.5); // 걸린 턴: 대상은 도발에 막힘
    st = out1.nextState;
    const reasons = [bAct(out1)?.blockedReason ?? "-"];
    for (let t = 0; t < 3; t++) {
      if (t < 2) st.b.volatile = { active: { ...st.b.volatile.active, recharge: { turnsRemaining: 1 } } }; // 재충전(우선도 11)이 도발(5)보다 먼저 막는다
      const out = rt.runTurn(st, act(IDLE), act(IDLE), () => 0.5);
      reasons.push(bAct(out)?.blockedReason ?? "-"); st = out.nextState;
    }
    return json(reasons) === json(["moveRestricted", "recharge", "recharge", "-"]) ? true : json(reasons);
  });
  guard("D3-fix20 6 앙코르·사슬묶기도 수면 중 소모: 선공 앙코르 지속 3 → 잠든 두 턴 동안 소모돼 3번째 턴 종료에 해제 / 선공 사슬묶기 4 → 세 턴 자는 동안 소모돼 깨어난 턴에는 이미 해제(현행은 깨어난 턴에 1행동 더 막힘)", () => {
    const sleepFrom2 = (st, t) => { if (t === 2) st.b.status = { condition: "sleep", turnsElapsed: 0 }; };
    const enc = run(mk({ first: true }), "앙코르", 4, { between: sleepFrom2 }).rows.map((r) => (r.has.includes("encore") ? 1 : 0)).join("");
    const dis = run(mk({ first: true }), "사슬묶기", 5, { between: sleepFrom2 }).rows;
    // 앙코르: 턴1 적용(2) → 턴2 수면(1) → 턴3 수면(0 해제) → 턴4 없음 / 사슬묶기: 턴1 X(3) → 턴2 s(2) → 턴3 s(1) → 턴4 s(0 해제) → 턴5 .
    return enc === "1100" && pattern(dis) === "Xsss." ? true : json({ enc, dis: pattern(dis) });
  });
  guard("D3-fix20 7 해제 시점: 마지막 막히는 턴에도 그 행동은 막히고 턴 종료에 해제된다(도발 선공 3번째 턴)", () => {
    const { rows } = run(mk({ first: true }), "도발", 3);
    return rows[2].reason === "moveRestricted" && !rows[2].has.includes("taunt") && rows[1].has.includes("taunt") ? true : json(rows);
  });
  guard("D3-fix20 8 교체하면 휘발성이 초기화되는 기존 동작 불변: 도발 걸린 대상이 교체하면 새 포켓몬에는 도발이 없다", () => {
    const st0 = mk({ first: true, bTwo: true });
    let st = rt.runTurn(st0, act(IDLE), act(IDLE), () => 0.5).nextState;
    st = rt.runTurn(st, act("도발"), act(IDLE), () => 0.5).nextState;
    const out = rt.runTurn(st, act(IDLE), { kind: "switch", toIndex: 1 }, () => 0.5);
    return !out.nextState.b.volatile.active.taunt ? true : json(out.nextState.b.volatile.active);
  });
  guard("D3-fix20 9 턴 시작 교체 직후 도발(검수 §2-1): 새로 들어온 대상은 +1이 없어 다음 2행동만 막힌다 [switch, X, X, .]", () => {
    const st0 = mk({ first: false, bTwo: true });
    let st = rt.runTurn(st0, act(IDLE), act(IDLE), () => 0.5).nextState;
    const reasons = [];
    const out1 = rt.runTurn(st, act("도발"), { kind: "switch", toIndex: 1 }, () => 0.5);
    st = out1.nextState;
    for (let t = 0; t < 3; t++) { const out = rt.runTurn(st, act(IDLE), act(IDLE), () => 0.5); reasons.push(bAct(out)?.blockedReason ?? "-"); st = out.nextState; }
    return json(reasons) === json(["moveRestricted", "moveRestricted", "-"]) ? true : json(reasons);
  });
  guard("D3-fix20 10 부여 보정 단위(검수 §2-1): 후공이라도 대상이 이번 턴 입장이면 도발 3(+1 없음), 입장이 아니면 4, 선공이면 3 — 앙코르·사슬묶기는 이미 움직이면 4(앙코르 4·사슬묶기 5)", () => {
    const give = (movesSecond, entered, move) => {
      const st = mk({ first: !movesSecond });
      st.b.lastMoveId = M(IDLE).id;
      st.b.enteredThisTurn = entered || undefined;
      ra.resolveAction(st, "a", M(move), () => 0.5, movesSecond, M(IDLE));
      return st.b.volatile.active[{ 도발: "taunt", 앙코르: "encore", 사슬묶기: "disable" }[move]]?.turnsRemaining;
    };
    const got = {
      도발_후공: give(true, false, "도발"), 도발_후공_입장: give(true, true, "도발"), 도발_선공: give(false, false, "도발"),
      앙코르_후공: give(true, false, "앙코르"), 앙코르_선공: give(false, false, "앙코르"),
      사슬_후공: give(true, false, "사슬묶기"), 사슬_선공: give(false, false, "사슬묶기"),
    };
    const want = { 도발_후공: 4, 도발_후공_입장: 3, 도발_선공: 3, 앙코르_후공: 4, 앙코르_선공: 3, 사슬_후공: 5, 사슬_선공: 4 };
    return json(got) === json(want) ? true : json({ got, want });
  });
}
