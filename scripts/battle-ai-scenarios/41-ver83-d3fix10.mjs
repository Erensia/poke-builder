// 8.3 D3-fix-10 난동(역린 등): 예정 마지막 턴에 끊겨도 혼란이 걸린다(Showdown `lockedmove` — 해제 시 trueDuration ≤ 1이면 혼란, 사용자 인게임 확인 2026-11-18).
// 단 명중한 턴 안에서 잠들면(느린 상대의 수면 기술·하품) 턴 종료에 혼란 없이 조용히 해제된다(`lockedmove.onResidual` calming).
// 미스트필드 위(땅에 있는 대상)에서는 난동 끝 혼란도 막힌다. 1.9 결정 D("마지막 턴에 끊겨도 혼란 없음")는 본가와 달라 번복.
// 설계 `8.3-D3-fix10-난동혼란설계.md`(검수 `…-검수.md`)
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const rp = await server.ssrLoadModule("/src/lib/battle/rampage.ts");
  const sts = await server.ssrLoadModule("/src/lib/statusConditions.ts");
  const vol = await server.ssrLoadModule("/src/lib/volatileConditions.ts");
  const { NO_STATUS_CONDITION: NO_STATUS } = await server.ssrLoadModule("/src/types/status.ts");
  const json = JSON.stringify;
  const M = (n) => data.getMove(n);
  const mv = (n) => ({ kind: "move", move: M(n) });
  const IDLE = "도우미";
  const fast = pts({ spe: 32 }), bulky = pts({ hp: 32, def: 32, spd: 32 });
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const confused = (f) => vol.hasVolatile(f.volatile, "confusion");
  // a(난동 사용자) vs b. rampage 상태를 직접 세워 "남은 턴"을 정한다(turnsRemaining 1 = 이번이 예정 마지막 턴).
  const setup = ({ aMon = "번치코", aMoveId = "역린", aAbility = null, aPts = fast, bMon = "번치코", bMoves = [IDLE], bPts = bulky, left = 1, field = undefined } = {}) => {
    const st = battle([mon(aMon, [aMoveId, IDLE], aAbility, null, aPts)], [mon(bMon, bMoves, null, null, bPts)]);
    if (left) st.a.volatile = { active: { ...st.a.volatile.active, rampage: { turnsRemaining: left, moveId: aMoveId } } };
    if (field) st.field = field;
    return st;
  };
  // 직접 호출: updateRampage에 끊긴/정상 행동을 흉내 낸 로그 항목을 넣는다
  const fake = (st, { hit = true, blockedReason, moveId = "역린", typeEffectiveness = 1 } = {}) => ({ actorPokemonId: st.a.slot.pokemonId, move: M(moveId), hit, blockedReason, typeEffectiveness });
  const upd = (st, act, r = 0.5) => { rp.updateRampage(st, "a", act, () => r); return act; };

  // ── 1~3. 예정 마지막 턴 끊김(타입 무효·빗나감·방어): 혼란 ──
  guard("D3-fix10 1 2턴짜리 2턴째(예정 마지막 턴) 타입 무효 → 혼란, 난동 종료", () => {
    const st = setup({ left: 1 }); const a = upd(st, fake(st, { hit: true, typeEffectiveness: 0 }));
    return confused(st.a) && a.rampageConfused === true && !st.a.volatile.active.rampage ? true : json({ conf: confused(st.a), flag: a.rampageConfused, rampage: st.a.volatile.active.rampage });
  });
  guard("D3-fix10 2 3턴짜리 2턴째(중간) 타입 무효 → 난동 종료, 혼란 없음", () => {
    const st = setup({ left: 2 }); const a = upd(st, fake(st, { typeEffectiveness: 0 }));
    return !confused(st.a) && !a.rampageConfused && !st.a.volatile.active.rampage ? true : json({ conf: confused(st.a), rampage: st.a.volatile.active.rampage });
  });
  guard("D3-fix10 3 3턴짜리 3턴째(예정 마지막 턴) 무효 → 혼란 (turnsRemaining이 끊김 분기 전에 줄지 않는다)", () => {
    const st = setup({ left: 2 }); // 3턴짜리의 2턴째: 명중해 한 번 더 이어진다
    upd(st, fake(st, { hit: true }));
    if (st.a.volatile.active.rampage?.turnsRemaining !== 1) return "이어가기 실패 " + json(st.a.volatile.active.rampage);
    const a = upd(st, fake(st, { typeEffectiveness: 0 }));
    return confused(st.a) && a.rampageConfused === true ? true : json({ conf: confused(st.a) });
  });
  guard("D3-fix10 4 1턴째 무효·빗나감 → 상태 없음·혼란 없음", () => {
    const st = setup({ left: 0 }); upd(st, fake(st, { typeEffectiveness: 0 }));
    return !st.a.volatile.active.rampage && !confused(st.a) ? true : json({ conf: confused(st.a) });
  });
  guard("D3-fix10 5 예정 마지막 턴에 빗나감(hit 거짓) → 혼란", () => {
    const st = setup({ left: 1 }); upd(st, fake(st, { hit: false })); return confused(st.a) ? true : "혼란 없음";
  });
  guard("D3-fix10 6 예정 마지막 턴에 방어에 막힘 → 혼란", () => {
    const st = setup({ left: 1 }); const act = fake(st); act.blockedByProtectMoveName = "방어"; upd(st, act); return confused(st.a) ? true : "혼란 없음";
  });
  guard("D3-fix10 7 예정 마지막 턴에 마비로 행동불능 → 혼란(통합: runTurn, 난수 0 = 마비 행동불능)", () => {
    const st = setup({ left: 1 });
    st.a.status = sts.inflictStatus({ ...NO_STATUS }, "paralysis");
    const o = rt.runTurn(st, mv("역린"), mv(IDLE), () => 0);
    return confused(o.nextState.a) ? true : json({ blocked: (o.result ?? o.partialResult).actions.find((x) => x.actor === "a")?.blockedReason, conf: confused(o.nextState.a) });
  });
  guard("D3-fix10 8 예정 마지막 턴에 끊겨도 이미 혼란 / 마이페이스면 새로 걸지 않는다(rampageConfused 없음)", () => {
    const st = setup({ left: 1 }); st.a.volatile = vol.inflictVolatile(st.a.volatile, "confusion", () => 0.5);
    st.a.volatile = { active: { ...st.a.volatile.active, rampage: { turnsRemaining: 1, moveId: "역린" } } };
    const a1 = upd(st, fake(st, { hit: false }));
    const st2 = setup({ left: 1, aAbility: "마이페이스" }); const a2 = upd(st2, fake(st2, { hit: false }));
    return !a1.rampageConfused && !a2.rampageConfused && !confused(st2.a) ? true : json({ a1: a1.rampageConfused, a2: a2.rampageConfused });
  });
  guard("D3-fix10 9 정상 종료(끝까지 명중) → 혼란(회귀)", () => {
    const st = setup({ left: 1 }); const a = upd(st, fake(st, { hit: true })); return confused(st.a) && a.rampageConfused === true && a.rampageEnded === true ? true : json({ conf: confused(st.a) });
  });
  guard("D3-fix10 10 소란피기(uproar)는 마지막 턴에 끊겨도 혼란 없음", () => {
    const st = setup({ aMoveId: "소란피기", left: 1 }); const a = upd(st, fake(st, { moveId: "소란피기", typeEffectiveness: 0 }));
    return !confused(st.a) && !a.rampageConfused ? true : "혼란 걸림";
  });
  guard("D3-fix10 11 마지막 턴에 끊기면서 쓰러져 있으면 혼란 없음", () => {
    const st = setup({ left: 1 }); st.a.currentHp = 0; upd(st, fake(st, { hit: false })); return !confused(st.a) ? true : "혼란 걸림";
  });
  guard("D3-fix10 12 꽃잎댄스·난동부리기·대격분(confuse 종류) 동일", () => {
    for (const id of ["꽃잎댄스", "난동부리기", "대격분"]) { const st = setup({ aMoveId: id, left: 1 }); upd(st, fake(st, { moveId: id, typeEffectiveness: 0 })); if (!confused(st.a)) return id + " 혼란 없음"; }
    return true;
  });

  // ── 13~16. 수면 두 갈래(검수 §2): 명중한 턴 안에서 잠들면 혼란 없이 해제 / 움직이기 전 잠들면 혼란 ──
  guard("D3-fix10 13 2턴짜리 1턴째 명중 후 같은 턴에 잠듦(느린 상대의 수면 기술) → 턴 종료에 난동 해제, 2턴째 행동불능 → 혼란 없음", () => {
    const st = battle([mon("루차불", ["역린", IDLE], null, null, fast)], [mon("번치코", ["수면가루", IDLE], null, null, bulky)]);
    const o1 = rt.runTurn(st, mv("역린"), mv("수면가루"), () => 0.4); // 난동 2턴짜리(<0.5), 수면가루 명중(<0.75)
    const n1 = o1.nextState;
    if (n1.a.status.condition !== "sleep") return "수면 실패(전제) " + json(n1.a.status);
    const calmed = !n1.a.volatile.active.rampage; // 턴 종료에 난동이 조용히 풀렸나
    const o2 = rt.runTurn(n1, mv("역린"), mv(IDLE), () => 0.99);
    return calmed && !confused(o2.nextState.a) ? true : json({ calmedAfterTurn1: calmed, rampage: n1.a.volatile.active.rampage, confusedAfterTurn2: confused(o2.nextState.a) });
  });
  guard("D3-fix10 14 3턴짜리 2턴째 명중 + 그 턴 종료 하품으로 잠듦 → 난동 해제, 3턴째 행동불능 → 혼란 없음", () => {
    const st = setup({ aMon: "루차불", left: 2 });
    st.a.volatile = vol.inflictVolatile(st.a.volatile, "drowsy", () => 0.5);
    st.a.volatile = { active: { ...st.a.volatile.active, drowsy: { ...st.a.volatile.active.drowsy, turnsRemaining: 1 }, rampage: { turnsRemaining: 2, moveId: "역린" } } };
    const o1 = rt.runTurn(st, mv("역린"), mv(IDLE), () => 0.5);
    const n1 = o1.nextState;
    if (n1.a.status.condition !== "sleep") return "하품 수면 실패(전제) " + json({ status: n1.a.status, drowsy: n1.a.volatile.active.drowsy });
    const calmed = !n1.a.volatile.active.rampage;
    const o2 = rt.runTurn(n1, mv("역린"), mv(IDLE), () => 0.99);
    return calmed && !confused(o2.nextState.a) ? true : json({ calmedAfterTurn1: calmed, confusedAfterTurn2: confused(o2.nextState.a) });
  });
  guard("D3-fix10 15 2턴짜리 2턴째, 움직이기 전에 이미 잠들어 있음(빠른 상대의 수면 기술) → 행동불능 → 혼란(잠든 채)", () => {
    const st = setup({ left: 1 });
    st.a.status = sts.inflictStatus({ ...NO_STATUS }, "sleep");
    const o = rt.runTurn(st, mv("역린"), mv(IDLE), () => 0.99);
    return confused(o.nextState.a) ? true : json({ blocked: (o.result ?? o.partialResult).actions.find((x) => x.actor === "a")?.blockedReason, status: o.nextState.a.status });
  });
  guard("D3-fix10 16 3턴짜리 2턴째(중간), 움직이기 전에 잠들어 있음 → 혼란 없음", () => {
    const st = setup({ left: 2 });
    st.a.status = sts.inflictStatus({ ...NO_STATUS }, "sleep");
    const o = rt.runTurn(st, mv("역린"), mv(IDLE), () => 0.99);
    return !confused(o.nextState.a) ? true : "혼란 걸림";
  });

  // ── 17~19. 미스트필드 ──
  guard("D3-fix10 17 미스트필드 + 땅에 있는 대상: 정상 종료여도 혼란 없음(rampageConfused 없음)", () => {
    const st = setup({ left: 1, field: "미스트필드" }); const a = upd(st, fake(st, { hit: true }));
    return !confused(st.a) && !a.rampageConfused ? true : json({ conf: confused(st.a) });
  });
  guard("D3-fix10 18 미스트필드 + 땅에 있는 대상: 예정 마지막 턴에 끊겨도 혼란 없음", () => {
    const st = setup({ left: 1, field: "미스트필드" }); const a = upd(st, fake(st, { hit: false }));
    return !confused(st.a) && !a.rampageConfused ? true : json({ conf: confused(st.a) });
  });
  guard("D3-fix10 19 미스트필드지만 공중에 있는 대상(비행 타입)은 혼란이 걸린다(회귀)", () => {
    const st = setup({ aMon: "루차불", left: 1, field: "미스트필드" }); const a = upd(st, fake(st, { hit: true }));
    return confused(st.a) && a.rampageConfused === true ? true : json({ conf: confused(st.a) });
  });
}
