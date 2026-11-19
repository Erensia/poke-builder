// 8.3 D3-fix-15 열사의대지가 얼음 상대를 해동(Showdown `thawsTarget`) + 해동 두 갈래(`curesStatus {상대, 얼음}`·불꽃 타입 데미지 기술)는 실제로 맞았을 때만:
// 대타·빗나감·무효 타입이면 얼음이 유지된다(대타에 맞은 대상은 `afterMoveSecondaryEvent`/`DamagingHit` 대상에서 빠진다). 사용자 자기 해동은 명중·방어 판정보다 먼저라 빗나가도 녹는다.
// 설계 `8.3-D3-fix15-열사의대지해동설계.md`(검수 `…-검수.md`). 우격다짐은 화상만 지우고 해동은 남는다(champions `hitStepMoveHitLoop`가 `suppressingSecondaries()`를 안 본다).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const IDLE = "칼춤";
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  const FRZ = { condition: "freeze", turnsElapsed: 1 };
  const turn = (st, aMove, bMove = IDLE, rand = 0.5) => rt.runTurn(st, act(aMove), act(bMove), () => rand);
  const aAct = (out) => (out.result ?? out.partialResult).actions.find((x) => x.actor === "a");
  // a(공격자) → b(얼음 잠만보). 기본은 a가 먼저 움직이고, 얼어 있는 b는 자기 차례에 25% 미만 난수가 아니면 계속 얼어 있다(난수 0.5).
  const mk = ({ aMon = mon("한카리아스", ["열사의대지", "열탕", "화염방사", IDLE]), bMon = mon("잠만보", [IDLE]), bStatus = FRZ } = {}) => {
    const st = battle([aMon], [bMon]);
    st.b.status = bStatus;
    return st;
  };
  const MOVES = ["열사의대지", "열탕", "화염방사"];

  guard("D3-fix15 1 열사의대지 → 얼음 상대: 해동(curedStatus 얼음·대상 상대), 상대 상태 없음", () => {
    const out = turn(mk(), "열사의대지");
    const a = aAct(out);
    return a.curedStatus === "freeze" && a.curedStatusTarget === "opponent" && out.nextState.b.status.condition === null ? true : json({ cured: a.curedStatus, target: a.curedStatusTarget, b: out.nextState.b.status });
  });
  guard("D3-fix15 2 열탕(대조군)·화염방사(불꽃 해동)도 얼음 상대를 해동한다", () => {
    for (const m of ["열탕", "화염방사"]) {
      const out = turn(mk(), m);
      if (aAct(out).curedStatus !== "freeze" || out.nextState.b.status.condition !== null) return json({ m, cured: aAct(out).curedStatus, b: out.nextState.b.status });
    }
    return true;
  });
  guard("D3-fix15 3 얼음이 아닌 상대(마비)는 영향 없음 — curedStatus 없고 상태 유지", () => {
    const out = turn(mk({ bStatus: { condition: "paralysis", turnsElapsed: 1 } }), "열사의대지");
    return !aAct(out).curedStatus && out.nextState.b.status.condition === "paralysis" ? true : json({ cured: aAct(out).curedStatus, b: out.nextState.b.status });
  });
  guard("D3-fix15 4 데이터: curesStatus가 얼음 한정인 기술은 열탕·열사의대지 둘", () => {
    const names = data.getAllMoves ? data.getAllMoves().filter((m) => m.curesStatus?.status === "freeze").map((m) => m.name).sort() : ["열사의대지", "열탕"].filter((n) => data.getMove(n).curesStatus?.status === "freeze");
    return json(names) === json(["열사의대지", "열탕"].sort()) ? true : json(names);
  });
  guard("D3-fix15 5 땅 무효 상대(리자몽, 열사의대지): 맞지 않으니 얼음 유지", () => {
    const out = turn(mk({ bMon: mon("리자몽", [IDLE]) }), "열사의대지");
    return out.nextState.b.status.condition === "freeze" ? true : json(out.nextState.b.status);
  });
  guard("D3-fix15 6 대타 뒤 얼음 상대: 열사의대지·열탕·화염방사 모두 얼음 유지(Showdown: 대타 맞은 대상은 해동 처리에서 빠짐)", () => {
    for (const m of MOVES) {
      const st = mk(); st.b.substituteHp = 500;
      const out = turn(st, m);
      if (out.nextState.b.status.condition !== "freeze") return json({ m, b: out.nextState.b.status, cured: aAct(out).curedStatus });
    }
    return true;
  });
  guard("D3-fix15 7 빗나감(상대 회피 +6): 열사의대지·열탕·화염방사 모두 얼음 유지", () => {
    for (const m of MOVES) {
      const st = mk(); st.b.accuracyStages = { accuracy: 0, evasion: 6 };
      const out = turn(st, m);
      if (out.nextState.b.status.condition !== "freeze") return json({ m, b: out.nextState.b.status, cured: aAct(out).curedStatus });
    }
    return true;
  });
  guard("D3-fix15 8 사용자 자기 해동: 얼어 있는 사용자가 열사의대지를 쓰면 카운트 판정 없이 녹고 기술이 나간다", () => {
    const st = battle([mon("한카리아스", ["열사의대지", IDLE])], [mon("잠만보", [IDLE])]);
    st.a.status = FRZ;
    const out = turn(st, "열사의대지");
    return out.nextState.a.status.condition === null && !aAct(out).blockedByStatus ? true : json({ a: out.nextState.a.status, blocked: aAct(out).blockedByStatus });
  });
  guard("D3-fix15 8-b 사용자 자기 해동은 기술이 빗나가도 일어난다(명중 판정보다 먼저)", () => {
    const st = battle([mon("한카리아스", ["열사의대지", IDLE])], [mon("잠만보", [IDLE])]);
    st.a.status = FRZ; st.b.accuracyStages = { accuracy: 0, evasion: 6 };
    const out = turn(st, "열사의대지");
    return out.nextState.a.status.condition === null ? true : json(out.nextState.a.status);
  });
  guard("D3-fix15 9 우격다짐 + 열사의대지(강철톤): 상대는 녹고 화상은 걸리지 않는다(가드에 우격다짐 조건 없음)", () => {
    const out = turn(mk({ aMon: mon("강철톤", ["열사의대지", IDLE], "우격다짐") }), "열사의대지", IDLE, 0.1);
    return aAct(out).curedStatus === "freeze" && out.nextState.b.status.condition !== "burn" ? true : json({ cured: aAct(out).curedStatus, b: out.nextState.b.status });
  });
  guard("D3-fix15 10 (선택) 틈새포착(대타 무시) + 열사의대지: 대타가 있어도 상대가 녹는다", () => {
    const st = mk({ aMon: mon("한카리아스", ["열사의대지", IDLE], "틈새포착") }); st.b.substituteHp = 500;
    const out = turn(st, "열사의대지");
    return aAct(out).curedStatus === "freeze" ? true : json({ cured: aAct(out).curedStatus, b: out.nextState.b.status });
  });
}
