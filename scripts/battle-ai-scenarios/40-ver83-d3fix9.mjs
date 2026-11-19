// 8.3 D3-fix-9 곡예(Unburden) 정정: (a) 도구를 되받으면 ×2가 멈춘다 (b) 도구를 잃는 모든 소모 경로에서 켜진다 (c) 특성이 바뀌면 해제된다.
// Showdown `data/abilities.ts` unburden: onAfterUseItem·onTakeItem이 상태를 달고, 상태의 onModifySpe는 `!pokemon.item`일 때만 ×2, onEnd(특성 변경)가 상태를 지운다.
// 설계 `8.3-D3-fix9-곡예설계.md`(검수 `…-검수.md`, 사용자 확정 2026-11-18: 새 로그·필드 없음, 헬퍼 방식)
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const toi = await server.ssrLoadModule("/src/lib/battle/turnOrderInputs.ts");
  const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
  const stt = await server.ssrLoadModule("/src/lib/battle/state.ts");
  const aiSpeed = await server.ssrLoadModule("/src/lib/battle/ai/speed.ts");
  const sts = await server.ssrLoadModule("/src/lib/statusConditions.ts");
  const { NO_STATUS_CONDITION: NO_STATUS } = await server.ssrLoadModule("/src/types/status.ts");
  const json = JSON.stringify;
  const M = (n) => data.getMove(n);
  const mv = (n) => ({ kind: "move", move: M(n) });
  const IDLE = "도우미";
  const fast = pts({ spe: 32 }), bulky = pts({ hp: 32, def: 32, spd: 32 });
  const act = (o, who) => (o.result ?? o.partialResult).actions.find((x) => x.actor === who);
  const spe = (st, f) => toi.computeTurnOrderSpeed(st, f);
  const near = (x, y) => Math.abs(x - y) < 1e-9;
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const rand = () => 0.5;
  const turn = (st, aMove, bMove) => { const o = rt.runTurn(st, mv(aMove), mv(bMove), rand); return { o, n: o.nextState }; };
  // 곡예 보유 a(루차불)·상대 b. 곡예가 이미 켜진 뒤(도구 없음)로 만들려면 flag를 직접 세운다.
  const setup = ({ aMon = "루차불", aMoves = [IDLE], aItem = null, aAbility = "곡예", aPts = fast, bMon = "번치코", bMoves = [IDLE], bItem = null, bAbility = null, bPts = bulky, bench = false, flagA = false, flagB = false } = {}) => {
    const st = battle([mon(aMon, aMoves, aAbility, aItem, aPts), ...(bench === "a" || bench === "ab" ? [mon("피카츄", [IDLE])] : [])], [mon(bMon, bMoves, bAbility, bItem, bPts), ...(bench === "b" || bench === "ab" ? [mon("피카츄", [IDLE])] : [])]);
    if (flagA) st.a.unburdenActive = true;
    if (flagB) st.b.unburdenActive = true;
    return st;
  };

  // ── 1. 판정(a): 곡예 ×2는 지금 도구가 없을 때만 ──
  guard("D3-fix9 1 플래그 켬 + 도구 없음 ×2 / 플래그 켬 + 도구 있음 ×1 / 플래그 꺼짐 + 도구 없음 ×1", () => {
    const st = setup();
    const base = spe(st, st.a);
    st.a.unburdenActive = true;
    const noItem = spe(st, st.a) / base;
    st.a.currentItemId = "하양허브";
    const withItem = spe(st, st.a) / base;
    st.a.unburdenActive = undefined; st.a.currentItemId = null;
    const noFlag = spe(st, st.a) / base;
    return near(noItem, 2) && near(withItem, 1) && near(noFlag, 1) ? true : json({ noItem, withItem, noFlag });
  });
  guard("D3-fix9 18 매직룸 중에도 곡예 ×2 유지(도구는 \"있는\" 게 아니라 \"없는\" 상태 기준 — currentItemId)", () => {
    const st = setup({ flagA: true });
    const base = (() => { const s2 = setup(); return spe(s2, s2.a); })();
    st.magicRoomTurnsRemaining = 5;
    return near(spe(st, st.a) / base, 2) ? true : json(spe(st, st.a) / base);
  });

  // ── 2. 도둑질로 도구를 되받음(6종 모두 습득, 1순위): ×2 → ×1 → 다시 던지면 ×2 ──
  guard("D3-fix9 2 도둑질로 도구를 받으면 ×1, 내던지기로 다시 잃으면 ×2 복귀", () => {
    const st = setup({ aMoves: ["도둑질", "내던지기", IDLE], bItem: "하양허브", flagA: true });
    const base = (() => { const s2 = setup(); return spe(s2, s2.a); })();
    if (!near(spe(st, st.a) / base, 2)) return "시작 ×2 아님";
    const t1 = turn(st, "도둑질", IDLE);
    if (t1.n.a.currentItemId !== "하양허브") return "도둑질 실패 " + json(act(t1.o, "a")?.blockedReason);
    const r1 = spe(t1.n, t1.n.a) / base;
    const t2 = turn(t1.n, "내던지기", IDLE);
    const r2 = spe(t2.n, t2.n.a) / base;
    return near(r1, 1) && near(r2, 2) && t2.n.a.currentItemId === null ? true : json({ afterSteal: r1, afterFling: r2, item: t2.n.a.currentItemId });
  });
  guard("D3-fix9 3 트릭으로 도구를 받으면 ×1", () => {
    const st = setup({ aMoves: ["트릭", IDLE], bItem: "하양허브", flagA: true });
    const base = (() => { const s2 = setup(); return spe(s2, s2.a); })();
    const t = turn(st, "트릭", IDLE);
    return t.n.a.currentItemId === "하양허브" && near(spe(t.n, t.n.a) / base, 1) ? true : json({ item: t.n.a.currentItemId, r: spe(t.n, t.n.a) / base });
  });

  // ── 3. 켜는 경로(b): 행동 밖 소모 ──
  guard("D3-fix9 4 턴 종료에 HP 임계 열매(오랭열매)를 먹으면 곡예가 켜져 다음 턴 ×2 (독 타입이 아닌 종)", () => {
    const st = setup({ aItem: "오랭열매" });
    const base = spe(st, st.a);
    // 행동 중 소모가 아니라 "턴 종료"에 임계를 넘도록: 반을 막 넘은 HP + 독(턴 종료 틱 1/8)으로 반 이하가 된다
    st.a.currentHp = Math.floor(st.a.maxHp / 2) + 1;
    st.a.status = sts.inflictStatus({ ...NO_STATUS }, "poison");
    const t = turn(st, IDLE, IDLE);
    return t.n.a.currentItemId === null && t.n.a.unburdenActive === true && near(spe(t.n, t.n.a) / base, 2) ? true : json({ item: t.n.a.currentItemId, flag: t.n.a.unburdenActive });
  });
  guard("D3-fix9 5 행동 뒤 레드카드(곡예 쪽이 방어측)를 소모하면 곡예가 켜진다", () => {
    const st = setup({ aItem: "레드카드", aPts: bulky, bMoves: ["불꽃펀치", IDLE], bPts: fast, bench: "b" });
    const t = turn(st, IDLE, "불꽃펀치");
    return t.n.a.currentItemId === null && t.n.a.unburdenActive === true ? true : json({ item: t.n.a.currentItemId, flag: t.n.a.unburdenActive });
  });
  guard("D3-fix9 6 미래예지 적중 뒤 레드카드(곡예 쪽이 대상, 사용자가 필드에 있음)를 소모하면 곡예가 켜진다", () => {
    let st = setup({ aMon: "루차불", aMoves: ["미래예지", IDLE], aAbility: null, aPts: pts({}), bMon: "루차불", bAbility: "곡예", bItem: "레드카드", bPts: bulky, bench: "a" });
    let t = turn(st, "미래예지", IDLE); st = t.n;
    for (let i = 0; i < 4 && st.b.currentItemId !== null; i++) { t = turn(st, IDLE, IDLE); st = t.n; }
    return st.b.currentItemId === null && st.b.unburdenActive === true ? true : json({ item: st.b.currentItemId, flag: st.b.unburdenActive });
  });

  // ── 4. 회귀 고정: 이미 맞는 경로 ──
  guard("D3-fix9 7 행동 중 소모(내던지기): 곡예가 켜지고 기존 로그 필드 unburdenSelfAbilityName 유지", () => {
    const st = setup({ aMoves: ["내던지기", IDLE], aItem: "하양허브" });
    const t = turn(st, "내던지기", IDLE);
    const a = act(t.o, "a");
    return t.n.a.unburdenActive === true && a?.unburdenSelfAbilityName === "곡예" ? true : json({ flag: t.n.a.unburdenActive, name: a?.unburdenSelfAbilityName });
  });
  guard("D3-fix9 8 등장 시 필드 시드 소모: 곡예가 켜지고 문구가 나온다", () => {
    const st = setup({ aItem: "그래스시드" });
    st.field = "그래스필드";
    const lines = sw.triggerTerrainSeeds(st);
    return st.a.unburdenActive === true && lines.some((l) => l.includes("스피드가 2배로 올랐다")) ? true : json({ flag: st.a.unburdenActive, lines });
  });
  guard("D3-fix9 12 교체로 물러나면 곡예가 해제된다", () => {
    const st = setup({ aItem: null, flagA: true, bench: "a" });
    const o = rt.runTurn(st, { kind: "switch", toIndex: 1 }, mv(IDLE), rand);
    return o.nextState.sideA.party[0].unburdenActive === undefined ? true : json(o.nextState.sideA.party[0].unburdenActive);
  });

  // ── 5. 특성 변경(c): 곡예를 잃으면 해제, 새로 받은 쪽은 ×1 ──
  const lostByTarget = (moveId, aAbility = "불면") => {
    const st = setup({ aMon: "번치코", aMoves: [moveId, IDLE], aAbility, aPts: fast, bMon: "루차불", bAbility: "곡예", bPts: bulky, flagB: true });
    const baseB = (() => { const s2 = setup({ aMon: "번치코", aAbility, bMon: "루차불", bAbility: "곡예", bPts: bulky }); return spe(s2, s2.b); })();
    const t = turn(st, moveId, IDLE);
    const ab = t.n.b.effectiveAbilityId;
    return { flag: t.n.b.unburdenActive, ab, r: spe(t.n, t.n.b) / baseB };
  };
  for (const [mvId, expectGone] of [["스킬스왑", true], ["고민씨", true], ["동료만들기", true], ["심플빔", true], ["위액", true]]) {
    guard(`D3-fix9 9 ${mvId}: 곡예를 잃은 대상의 곡예 상태가 해제되고 ×1`, () => {
      const r = lostByTarget(mvId);
      return expectGone && r.ab !== "곡예" && !r.flag && near(r.r, 1) ? true : json(r);
    });
  }
  guard("D3-fix9 9-b 역할(특성 복사): 곡예를 잃은 사용자의 곡예 상태가 해제된다", () => {
    const st = setup({ aMon: "루차불", aMoves: ["역할", IDLE], aAbility: "곡예", bMon: "번치코", bAbility: "불면", flagA: true });
    const t = turn(st, "역할", IDLE);
    return t.n.a.effectiveAbilityId === "불면" && !t.n.a.unburdenActive ? true : json({ ab: t.n.a.effectiveAbilityId, flag: t.n.a.unburdenActive });
  });
  guard("D3-fix9 9-c 미라(접촉): 공격자가 곡예를 잃고 상태 해제", () => {
    const st = setup({ aMon: "루차불", aMoves: ["불꽃펀치", IDLE], aAbility: "곡예", bMon: "번치코", bAbility: "미라", bPts: bulky, flagA: true });
    const t = turn(st, "불꽃펀치", IDLE);
    return t.n.a.effectiveAbilityId === "미라" && !t.n.a.unburdenActive ? true : json({ ab: t.n.a.effectiveAbilityId, flag: t.n.a.unburdenActive });
  });
  guard("D3-fix9 9-d 떠도는영혼(접촉): 특성이 바뀐 공격자의 곡예 상태 해제, 곡예를 받은 쪽은 ×1(상태 없음)", () => {
    const st = setup({ aMon: "루차불", aMoves: ["불꽃펀치", IDLE], aAbility: "곡예", bMon: "번치코", bAbility: "떠도는영혼", bPts: bulky, flagA: true });
    const t = turn(st, "불꽃펀치", IDLE);
    return t.n.a.effectiveAbilityId === "떠도는영혼" && !t.n.a.unburdenActive && t.n.b.effectiveAbilityId === "곡예" && !t.n.b.unburdenActive ? true : json({ a: t.n.a.effectiveAbilityId, fa: t.n.a.unburdenActive, b: t.n.b.effectiveAbilityId, fb: t.n.b.unburdenActive });
  });
  guard("D3-fix9 10 스킬스왑을 두 번(곡예를 되찾음): 되찾아도 새로 켜지지 않아 ×1 유지", () => {
    const st = setup({ aMon: "번치코", aMoves: ["스킬스왑", IDLE], aAbility: "불면", aPts: fast, bMon: "루차불", bAbility: "곡예", bPts: bulky, flagB: true });
    const baseB = (() => { const s2 = setup({ aMon: "번치코", aAbility: "불면", bMon: "루차불", bAbility: "곡예", bPts: bulky }); return spe(s2, s2.b); })();
    const t1 = turn(st, "스킬스왑", IDLE);
    const t2 = turn(t1.n, "스킬스왑", IDLE);
    return t2.n.b.effectiveAbilityId === "곡예" && !t2.n.b.unburdenActive && near(spe(t2.n, t2.n.b) / baseB, 1) ? true : json({ ab: t2.n.b.effectiveAbilityId, flag: t2.n.b.unburdenActive });
  });
  guard("D3-fix9 11 헬퍼 setEffectiveAbility: 곡예→다른 특성 해제, 곡예→같은 곡예 유지(알면서 둔 차이), null(위액)이면 해제, 곡예를 새로 받아도 켜지 않음", () => {
    if (typeof stt.setEffectiveAbility !== "function") return "setEffectiveAbility 없음";
    const st = setup();
    const f = st.a;
    f.effectiveAbilityId = "곡예"; f.unburdenActive = true;
    stt.setEffectiveAbility(f, "불면");
    const gone = f.effectiveAbilityId === "불면" && !f.unburdenActive;
    f.effectiveAbilityId = "곡예"; f.unburdenActive = true;
    stt.setEffectiveAbility(f, "곡예");
    const same = f.unburdenActive === true;
    stt.setEffectiveAbility(f, null);
    const suppressed = f.effectiveAbilityId === null && !f.unburdenActive;
    const g = st.b; g.effectiveAbilityId = "불면"; g.unburdenActive = undefined;
    stt.setEffectiveAbility(g, "곡예");
    const gained = g.effectiveAbilityId === "곡예" && !g.unburdenActive;
    return gone && same && suppressed && gained ? true : json({ gone, same, suppressed, gained });
  });

  // ── 6. 남의 열매를 먹는 경로는 먹는 쪽의 곡예를 켜지 않는다(검수 §3-1) ──
  guard("D3-fix9 16 벌레먹기로 남의 열매를 먹은 곡예 보유자(도구 없음)는 켜지지 않고, 열매를 잃은 곡예 보유자는 켜진다", () => {
    const st = setup({ aMoves: ["벌레먹기", IDLE], bMon: "루차불", bAbility: "곡예", bItem: "오랭열매" });
    const base = spe(st, st.a);
    const t = turn(st, "벌레먹기", IDLE);
    return t.n.b.currentItemId === null && t.n.b.unburdenActive === true && !t.n.a.unburdenActive && near(spe(t.n, t.n.a) / base, 1) ? true : json({ bItem: t.n.b.currentItemId, bFlag: t.n.b.unburdenActive, aFlag: t.n.a.unburdenActive });
  });
  guard("D3-fix9 17 상대가 내던진 열매를 맞은 곡예 보유자(도구 없음)는 켜지지 않는다", () => {
    const st = setup({ bMon: "번치코", bMoves: ["내던지기", IDLE], bItem: "자뭉열매", bPts: fast, aPts: bulky });
    const t = turn(st, IDLE, "내던지기");
    return !t.n.a.unburdenActive ? true : json(t.n.a.unburdenActive);
  });

  // ── 7. AI 속도 예측이 같은 함수를 쓴다(도구를 되받은 상태는 ×1) ──
  guard("D3-fix9 14 AI firstProbability: 곡예 플래그가 켜져 있어도 도구가 있으면 같은 스피드로 계산(동속 0.5)", () => {
    const st = setup({ aMoves: ["불꽃펀치", IDLE], aItem: "하양허브", flagA: true, aPts: fast, bMon: "루차불", bAbility: "유연", bMoves: ["불꽃펀치", IDLE], bPts: fast });
    const p = aiSpeed.firstProbability(st, st.a, M("불꽃펀치"), st.b, M("불꽃펀치"));
    return near(p.probability, 0.5) ? true : json(p);
  });
}
