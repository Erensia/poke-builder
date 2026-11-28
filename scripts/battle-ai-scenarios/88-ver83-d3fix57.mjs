// 8.3 D3-fix-57 (E8-47·48) 하양허브가 명중·회피 하락도 복원(행동 뒤·등장 묶음·턴 끝·내던지기) + 오기·승기 발동 문구를 모든 경로에서 낸다
// (상승량별 문구·상한 "더 이상 올라가지 않는다!"·발동 횟수만큼 줄). 설계 `8.3-D3-fix57-하양허브명중회피-오기승기문구설계.md` §3, 검수 `…-검수.md`(R1~R3).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
  const lt = await server.ssrLoadModule("/src/lib/battleLogText.ts");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const NOP = "잠꼬대";
  const rnd = () => 0;
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const eq = (got, want) => JSON.stringify(got) === JSON.stringify(want) ? true : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`;
  const M = (id, moves, ability = "두꺼운지방", item = null) => mon(id, moves, ability, item);
  const BENCH = () => M("잠만보", [NOP]);
  // a가 move, b는 대기. b가 ab·item을 가진다.
  const scene = (move, { bAb = "두꺼운지방", bItem = null, aItem = null, aAb = "두꺼운지방", prep } = {}) => {
    const st = battle([M("잠만보", [move, NOP], aAb, aItem), BENCH()], [M("잠만보", [NOP], bAb, bItem), BENCH()]);
    prep?.(st);
    return st;
  };
  const aAct = (o) => o.result.actions.find((x) => x.actor === "a");

  // ── E8-47 하양허브 + 명중·회피
  guard("D3-fix57 1: 하양허브 + 진흙뿌리기(명중 −1) — 명중 0으로 복원·소모", () => {
    const o = rt.runTurn(scene("진흙뿌리기", { bItem: "하양허브" }), mv("진흙뿌리기"), mv(NOP), rnd);
    return eq([o.nextState.b.accuracyStages.accuracy, o.nextState.b.itemConsumed === true, aAct(o)?.restoredStatsOpponentItemName], [0, true, "하양허브"]);
  });
  guard("D3-fix57 1b: 하양허브 + 달콤한향기(회피 −2) — 회피 0으로 복원·소모", () => {
    const o = rt.runTurn(scene("달콤한향기", { bItem: "하양허브" }), mv("달콤한향기"), mv(NOP), rnd);
    return eq([o.nextState.b.accuracyStages.evasion, o.nextState.b.itemConsumed === true], [0, true]);
  });
  guard("D3-fix57 2: + 랭크(공격 +2)는 그대로, 명중만 복원", () => {
    const o = rt.runTurn(scene("진흙뿌리기", { bItem: "하양허브", prep: (st) => { st.b.stages = { ...st.b.stages, atk: 2 }; } }), mv("진흙뿌리기"), mv(NOP), rnd);
    return eq([o.nextState.b.stages.atk, o.nextState.b.accuracyStages.accuracy], [2, 0]);
  });
  guard("D3-fix57 3: 등장 묶음(finishEntryBundle) — 명중만 마이너스여도 발동, 새 문구", () => {
    const st = scene(NOP, { bItem: "하양허브", prep: (s) => { s.b.accuracyStages = { ...s.b.accuracyStages, accuracy: -1 }; } });
    const log = []; sw.finishEntryBundle(st, log);
    return eq([st.b.accuracyStages.accuracy, log.some((l) => l.includes("하양허브로 능력치를 원래대로 되돌렸다!")), log.some((l) => l.includes("떨어진 능력"))], [0, true, false]);
  });
  guard("D3-fix57 4: 내던지기 하양허브 — 상대 명중·회피도 복원", () => {
    const st = scene("내던지기", { aItem: "하양허브", prep: (s) => { s.b.accuracyStages = { ...s.b.accuracyStages, accuracy: -1 }; } });
    const o = rt.runTurn(st, mv("내던지기"), mv(NOP), rnd);
    return o.nextState.b.accuracyStages.accuracy === 0 ? true : `accuracy ${o.nextState.b.accuracyStages.accuracy}`;
  });
  guard("D3-fix57 5: 하양허브 + 시럽봄 — 그 턴 끝에 스피드 0으로 복원·소모(R1)", () => {
    const o = rt.runTurn(scene("시럽봄", { bItem: "하양허브" }), mv("시럽봄"), mv(NOP), rnd);
    const eot = o.result.endOfTurn.filter((e) => e.actor === "b");
    return eq([o.nextState.b.stages.spe, o.nextState.b.itemConsumed === true, eot.some((e) => e.syrupCoatDrop), eot.some((e) => e.whiteHerbItemName === "하양허브")], [0, true, true, true]);
  });
  guard("D3-fix57 6: 하양허브 + 문어굳히기 — 방어·특방 하락도 그 턴 끝에 복원(R1)", () => {
    const o = rt.runTurn(scene("문어굳히기", { bItem: "하양허브" }), mv("문어굳히기"), mv(NOP), rnd);
    return eq([o.nextState.b.stages.def, o.nextState.b.stages.spd, o.nextState.b.itemConsumed === true], [0, 0, true]);
  });
  guard("D3-fix57 7: 오기 + 하양허브 + 진흙뿌리기 — 공격 +2·명중 0·소모(오기 먼저)", () => {
    const o = rt.runTurn(scene("진흙뿌리기", { bAb: "오기", bItem: "하양허브" }), mv("진흙뿌리기"), mv(NOP), rnd);
    return eq([o.nextState.b.stages.atk, o.nextState.b.accuracyStages.accuracy, o.nextState.b.itemConsumed === true], [2, 0, true]);
  });

  // ── E8-48 오기·승기 문구
  guard("D3-fix57 8: 기술 경로 — 간지르기(2능력치 하락) → 줄 2개 각 +2, 쪽 b", () => {
    const o = rt.runTurn(scene("간지르기", { bAb: "오기" }), mv("간지르기"), mv(NOP), rnd);
    return eq(aAct(o)?.dropReactionRises, [{ side: "b", stat: "atk", delta: 2 }, { side: "b", stat: "atk", delta: 2 }]);
  });
  guard("D3-fix57 9: 상한 — 공격 +6에서 간지르기 → [1, 0]", () => {
    const o = rt.runTurn(scene("간지르기", { bAb: "오기", prep: (s) => { s.b.stages = { ...s.b.stages, atk: 6 }; } }), mv("간지르기"), mv(NOP), rnd);
    return eq(aAct(o)?.dropReactionRises?.map((r) => r.delta), [1, 0]);
  });
  guard("D3-fix57 10: 하락이 일어나지 않으면 줄 없음 — 승기 보유자의 공격이 이미 −6인 채 상대 공격하락", () => {
    const o = rt.runTurn(scene("간지르기", { bAb: "오기", prep: (s) => { s.b.stages = { ...s.b.stages, atk: -6, def: -6 }; } }), mv("간지르기"), mv(NOP), rnd);
    return eq(aAct(o)?.dropReactionRises ?? null, null);
  });
  guard("D3-fix57 11: 문구 — +2 \"크게 올라갔다!\" / +1 \"올라갔다!\" / 0 \"더 이상 올라가지 않는다!\" (특성 이름 없음)", () => {
    const t = (d) => lt.dropReactionText("대도각참", "atk", d);
    return eq([t(2), t(1), t(0)], ["대도각참의 공격이 크게 올라갔다!", "대도각참의 공격이 올라갔다!", "대도각참의 공격은 더 이상 올라가지 않는다!"]);
  });
  guard("D3-fix57 12: 턴 끝 — 물엿범벅(시럽봄)이 오기 보유자 스피드를 내리면 항목에 dropReactionRises", () => {
    const o = rt.runTurn(scene("시럽봄", { bAb: "오기" }), mv("시럽봄"), mv(NOP), rnd);
    const e = o.result.endOfTurn.find((x) => x.actor === "b" && x.syrupCoatDrop);
    return eq(e?.dropReactionRises, [{ side: "b", stat: "atk", delta: 2 }]);
  });
  guard("D3-fix57 13: 턴 끝 — 문어굳히기(방어·특방 2하락) → 줄 2개", () => {
    const o = rt.runTurn(scene("문어굳히기", { bAb: "오기" }), mv("문어굳히기"), mv(NOP), rnd);
    const e = o.result.endOfTurn.find((x) => x.actor === "b" && x.octolockDrop);
    return eq(e?.dropReactionRises?.length, 2);
  });
}
