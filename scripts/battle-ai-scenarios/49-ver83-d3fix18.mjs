// 8.3 D3-fix-18 불굴의마음은 풀죽음으로 **행동이 막힐 때만** 속도 +1(Showdown `steadfast.onFlinch` ← `flinch.onBeforeMove`, 우선도 8):
// 이미 움직인 뒤 걸린 풀죽음·수면/얼음/재충전으로 먼저 막힌 턴에는 오르지 않고, 풀죽음(8)이 혼란(3)·마비(1)보다 먼저라 그 턴에도 오른다.
// 설계 `8.3-D3-fix18-불굴의마음설계.md`(검수 `…-검수.md`). E4b-05. 시험 8(심술꾸러기 −1)은 두 특성을 동시에 가진 포켓몬이 없어 시험하지 않는다(기존 `contraryDelta` 호출 유지).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const IDLE = "칼춤";
  const FAKE = "속이기"; // 우선도 +3·풀죽음 100%(첫 턴 한정)
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  const turn = (st, aMove, bMove = IDLE, rand = 0.5) => rt.runTurn(st, act(aMove), act(bMove), () => rand);

  const bAct = (out) => (out.result ?? out.partialResult).actions.find((x) => x.actor === "b");
  // a(속이기·아이언헤드) → b(불굴의마음 루카리오). 기본은 b가 풀죽음에 막히는 구도.
  const mk = ({ bAbility = "불굴의마음", bStatus, bVolatile, aSpe } = {}) => {
    const st = battle([mon("한카리아스", [FAKE, "아이언헤드", IDLE])], [mon("루카리오", [IDLE], bAbility)]);
    if (bStatus) st.b.status = bStatus;
    if (bVolatile) st.b.volatile = { active: bVolatile };
    if (aSpe !== undefined) st.a.realStats = { ...st.a.realStats, spe: aSpe };
    return st;
  };

  guard("D3-fix18 1 정상: 공격측이 먼저 풀죽음을 걸면 불굴의마음 대상은 그 턴 행동하지 못하고 속도 랭크 +1", () => {
    const out = turn(mk(), FAKE);
    return out.nextState.b.stages.spe === 1 && bAct(out)?.blockedReason === "flinch" ? true : json({ spe: out.nextState.b.stages.spe, reason: bAct(out)?.blockedReason });
  });
  guard("D3-fix18 2 이미 움직인 뒤: 느린 공격측의 풀죽음이 대상의 행동 뒤에 걸리면 속도 랭크 변화 없음(현행은 +1)", () => {
    const st = mk({ aSpe: 10 });
    st.b.realStats = { ...st.b.realStats, spe: 200 };
    // 난수 0 → 아이언헤드 풀죽음(20%) 확정, 대상은 이미 행동을 마친 뒤다
    const out = turn(st, "아이언헤드", IDLE, 0);
    const moved = bAct(out)?.blockedReason === undefined;
    return out.nextState.b.stages.spe === 0 && moved ? true : json({ spe: out.nextState.b.stages.spe, bReason: bAct(out)?.blockedReason });
  });
  guard("D3-fix18 3 수면 대상: 수면이 먼저 막아 랭크 변화 없음(현행은 +1)", () => {
    const out = turn(mk({ bStatus: { condition: "sleep", turnsElapsed: 0 } }), FAKE);
    return out.nextState.b.stages.spe === 0 && bAct(out)?.blockedReason === "status" ? true : json({ spe: out.nextState.b.stages.spe, reason: bAct(out)?.blockedReason });
  });
  guard("D3-fix18 4 얼음 대상: 같음", () => {
    const out = turn(mk({ bStatus: { condition: "freeze", turnsElapsed: 0 } }), FAKE);
    return out.nextState.b.stages.spe === 0 && bAct(out)?.blockedReason === "status" ? true : json({ spe: out.nextState.b.stages.spe, reason: bAct(out)?.blockedReason });
  });
  guard("D3-fix18 5 풀죽음 면역 특성(정신력) 대상: 부여 자체가 막혀 랭크 변화 없음(불변)", () => {
    const out = turn(mk({ bAbility: "정신력" }), FAKE);
    return out.nextState.b.stages.spe === 0 && !out.nextState.b.volatile.active.flinch ? true : json({ spe: out.nextState.b.stages.spe });
  });
  guard("D3-fix18 6 다른 특성(압력)은 풀죽음으로 막혀도 랭크 변화 없음(불변)", () => {
    const out = turn(mk({ bAbility: "압력" }), FAKE);
    return out.nextState.b.stages.spe === 0 && bAct(out)?.blockedReason === "flinch" ? true : json({ spe: out.nextState.b.stages.spe, reason: bAct(out)?.blockedReason });
  });
  guard("D3-fix18 7 풀죽음 + 마비: 풀죽음이 마비보다 먼저라 마비 굴림 전에 +1(난수 0.05여도 풀죽음이 막는다)", () => {
    const out = turn(mk({ bStatus: { condition: "paralysis", turnsElapsed: 0 } }), FAKE, IDLE, 0.05);
    return out.nextState.b.stages.spe === 1 && bAct(out)?.blockedReason === "flinch" ? true : json({ spe: out.nextState.b.stages.spe, reason: bAct(out)?.blockedReason });
  });
  guard("D3-fix18 9 풀죽음 + 혼란(검수 §2-1): 속도 +1, 혼란 지속은 줄지 않는다(풀죽음이 혼란보다 먼저 막아 혼란 판정이 없다)", () => {
    const out = turn(mk({ bVolatile: { confusion: { turnsRemaining: 3 } } }), FAKE);
    const left = out.nextState.b.volatile.active.confusion?.turnsRemaining;
    return out.nextState.b.stages.spe === 1 && bAct(out)?.blockedReason === "flinch" && left === 3 ? true : json({ spe: out.nextState.b.stages.spe, reason: bAct(out)?.blockedReason, left });
  });
  guard("D3-fix18 10 재충전 + 풀죽음(검수 §2-2): 재충전(우선도 11)이 먼저 막아 랭크 변화 없음(현행은 +1)", () => {
    const out = turn(mk({ bVolatile: { recharge: { turnsRemaining: 1 } } }), FAKE);
    return out.nextState.b.stages.spe === 0 && bAct(out)?.blockedReason === "recharge" ? true : json({ spe: out.nextState.b.stages.spe, reason: bAct(out)?.blockedReason });
  });
}
