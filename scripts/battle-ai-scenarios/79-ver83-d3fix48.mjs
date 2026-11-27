// 8.3 D3-fix-48 (E8-26·E8-27·E8-28) 접촉 반응 정합. 설계 `8.3-D3-fix48-접촉반응정합설계.md` §3.
//  ① E8-26 정전기·독가시·불꽃몸은 카테고리와 무관하게 접촉기면 발동(Showdown `checkMoveMakesContact`) — 시험 1~5.
//  ② E8-27 저주받은바디 4턴 봉인·호출 기술 기준(시험 6~11·19·20·26)은 ② 착수 때 추가했고, ③ E8-28 드레인 회복 순서·타별(시험 12~18·21~25)도 ③ 착수 때 추가했다.
import { readFileSync } from "node:fs";
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const ra = await server.ssrLoadModule("/src/lib/battle/resolveAction.ts");
  const ht = await server.ssrLoadModule("/src/lib/abilityHitTriggers.ts");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const bulky = pts({ hp: 32, spd: 32, def: 32 });
  const slow = pts({ hp: 32, def: 32 }); // 방어측은 느리게 — 공격측이 먼저 움직여 접촉 반응을 받는다
  // 공격측(a)이 방어측(b)을 때린 한 턴. 확률 특성은 난수 0으로 고정해 발동시킨다.
  const hit = (atk, move, def, defAbility, { rnd = () => 0, atkAbility = null } = {}) => {
    const st = battle([mon(atk, [move, "칼춤"], atkAbility, null, bulky), mon("잠만보", ["칼춤"])], [mon(def, ["방어", "칼춤"], defAbility, null, slow), mon("잠만보", ["칼춤"])]);
    try { return { n: rt.runTurn(st, mv(move), mv("칼춤"), rnd)?.nextState, hp0: st.a.currentHp }; } catch (e) { return { err: String(e) }; }
  };
  const has = (n, status) => JSON.stringify(n?.a.status ?? null).includes(status);
  const SPECIAL = ["드레인키스", "꽃잎댄스", "풀묶기", "엉겨붙기"]; // 챔피언스 합법 특수 접촉기 4종(설계서 §1)
  const FX = [["정전기", "라이츄", "paralysis"], ["독가시", "드래캄", "poison"], ["불꽃몸", "잠만보", "burn"]];

  // ── 1·2 특수 접촉기 4종 × 3특성 → 상태이상 ──
  {
    const miss = [];
    for (const [ab, def, st] of FX) for (const m of SPECIAL) if (!has(hit("하마돈", m, def, ab).n, st)) miss.push(`${ab}/${m}`);
    check("D3-fix48 1·2: 정전기→마비·독가시→중독·불꽃몸→화상이 특수 접촉기 4종에도 발동", miss.length === 0, miss.join(","));
  }
  // ── 3 회귀: 물리 접촉기 발동 / 비접촉기 무발동 / 전기 타입은 마비 면역 ──
  {
    const bad = [];
    for (const [ab, def, st] of FX) {
      if (!has(hit("하마돈", "아이언헤드", def, ab).n, st)) bad.push(`${ab}/물리접촉 미발동`);
      for (const m of ["물의파동", "지진"]) if (has(hit("하마돈", m, def, ab).n, st)) bad.push(`${ab}/${m} 발동`);
    }
    if (has(hit("라이츄", "아이언헤드", "라이츄", "정전기").n, "paralysis")) bad.push("전기 타입 마비");
    check("D3-fix48 3: 회귀 — 물리 접촉기 발동·비접촉기(물의파동·지진) 무발동·전기 타입 마비 면역", bad.length === 0, bad.join(","));
  }
  // ── 4 회귀: 까칠한피부(`contact`)는 특수 접촉기에도 계속 발동 ──
  {
    const r = hit("하마돈", "드레인키스", "잠만보", "까칠한피부");
    check("D3-fix48 4: 회귀 — 까칠한피부는 특수 접촉기(드레인키스)에도 반응 피해", r.n && r.n.a.currentHp < r.hp0, `전 ${r.hp0} 후 ${r.n?.a.currentHp} ${r.err ?? ""}`);
  }
  // ── 5 단위: 매처와 데이터 ──
  {
    const trig = (ab) => JSON.parse(readFileSync("src/data/abilities.json", "utf8")).find((a) => a.id === ab).hitTrigger;
    const t = trig("정전기");
    check("D3-fix48 5: hitTriggerMatchesMove — 정전기 × 드레인키스 true·× 물의파동 false", ht.hitTriggerMatchesMove(t, data.getMove("드레인키스")) === true && ht.hitTriggerMatchesMove(t, data.getMove("물의파동")) === false, JSON.stringify(t));
    check("D3-fix48 5b: 데이터에 physicalContact 0건", !readFileSync("src/data/abilities.json", "utf8").includes("physicalContact"), "");
  }
  // ══ ② E8-27 저주받은바디: 4턴 봉인(사슬묶기 경로), 봉인 대상은 호출한 기술 ══
  const M = (x) => data.getMove(x);
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  // 공격측(a 하마돈)이 저주받은바디 방어측(b 팬텀)을 때린다. 둘 다 예비 1마리.
  const mkc = ({ aMoves = ["아이언헤드", "칼춤"], aAbility = null, aItem = null } = {}) =>
    battle([mon("하마돈", aMoves, aAbility, aItem, bulky), mon("잠만보", ["칼춤"])], [mon("팬텀", ["칼춤"], "저주받은바디", null, slow), mon("잠만보", ["칼춤"])]);
  const aAct = (out) => (out.result ?? out.partialResult).actions.find((x) => x.actor === "a");
  const fire = (st, move, rnd = () => 0) => ra.resolveAction(st, "a", M(move), rnd, false, M("칼춤")); // 행동 하나만(턴 종료 처리 없음)
  const asleep = (st) => { st.a.status = { condition: "sleep", turnsElapsed: 1, sleepTurns: 3 }; return st; };

  // ── 6 발동하면 공격측에 disable(쓴 기술·지속 4), PP는 깎인 만큼만 ──
  guard("D3-fix48 6: 저주받은바디 → 공격측 disable(moveId=쓴 기술, 부여 직후 지속 4), PP는 깎인 만큼만(0이 아님)", () => {
    const st = mkc(); const pp0 = st.a.remainingPp["아이언헤드"];
    fire(st, "아이언헤드");
    const d = st.a.volatile.active.disable;
    return d?.moveId === "아이언헤드" && d.turnsRemaining === 4 && st.a.remainingPp["아이언헤드"] === pp0 - 1 ? true : JSON.stringify({ d, pp: st.a.remainingPp["아이언헤드"], pp0 });
  });
  // ── 7 (A-3) 해제 시점을 턴 단위로 + 교체하면 해제 ──
  guard("D3-fix48 7: T1 부여 → T2·T3·T4 그 기술 선택 불가(moveRestricted/disable) → T5 사용 가능 / 교체했다 돌아오면 봉인 없음·PP 복구 불필요", () => {
    let st = mkc(); let seq = "";
    for (let t = 1; t <= 5; t++) {
      const out = rt.runTurn(st, mv("아이언헤드"), mv("칼춤"), () => 0); const a = aAct(out);
      seq += a?.blockedReason === "moveRestricted" && a.moveRestrictionKind === "disable" ? "X" : "."; st = out.nextState;
    }
    let s2 = rt.runTurn(mkc(), mv("아이언헤드"), mv("칼춤"), () => 0).nextState;
    s2 = rt.runTurn(s2, { kind: "switch", toIndex: 1 }, mv("칼춤"), () => 0).nextState;
    s2 = rt.runTurn(s2, { kind: "switch", toIndex: 0 }, mv("칼춤"), () => 0).nextState;
    const back = s2.a.volatile.active.disable === undefined && s2.a.remainingPp["아이언헤드"] > 0;
    return seq === ".XXX." && back ? true : JSON.stringify({ seq, back, pp: s2.a.remainingPp["아이언헤드"], dis: s2.a.volatile.active.disable });
  });
  // ── 8 이미 봉인 중이면 무발동 ──
  guard("D3-fix48 8: 이미 disable 중이면 무발동 — 기존 봉인(moveId 칼춤) 유지, 쓴 기술 PP 0 아님", () => {
    const st = mkc(); const pp0 = st.a.remainingPp["아이언헤드"];
    st.a.volatile = { active: { disable: { turnsRemaining: 2, moveId: "칼춤" } } };
    fire(st, "아이언헤드"); const d = st.a.volatile.active.disable;
    return d?.moveId === "칼춤" && d.turnsRemaining === 2 && st.a.remainingPp["아이언헤드"] === pp0 - 1 ? true : JSON.stringify({ d, pp: st.a.remainingPp["아이언헤드"], pp0 });
  });
  // ── 9 아로마베일 무발동 / 멘탈허브 즉시 치료·소모 ──
  guard("D3-fix48 9: 공격측 아로마베일 → 무발동 / 멘탈허브 → 걸리자마자 치료·도구 소모·로그 필드 비움", () => {
    const aroma = mkc({ aAbility: "아로마베일" }); const ap0 = aroma.a.remainingPp["아이언헤드"];
    const ra1 = fire(aroma, "아이언헤드");
    const herb = mkc({ aItem: "멘탈허브" });
    const rh = fire(herb, "아이언헤드");
    const okA = aroma.a.volatile.active.disable === undefined && aroma.a.remainingPp["아이언헤드"] === ap0 - 1 && ra1.abilityDisabledMoveName === undefined;
    const okH = herb.a.volatile.active.disable === undefined && !herb.a.currentItemId && rh.abilityDisabledMoveName === undefined && rh.statusCureBerryItemName === "멘탈허브";
    return okA && okH ? true : JSON.stringify({ okA, okH, herbItem: herb.a.currentItemId, name: rh.abilityDisabledMoveName, cure: rh.statusCureBerryItemName });
  });
  // ── 10 회귀: 비접촉도 발동·방어측 KO여도 발동·대타 무발동·확률 30% ──
  guard("D3-fix48 10: 회귀 — 비접촉(물의파동) 발동·방어측 KO여도 발동·대타에 맞으면 무발동·난수 0.5면 무발동", () => {
    const fired = (st, move, rnd) => fire(st, move, rnd).abilityDisabledMoveName === M(move).name;
    const noncontact = fired(mkc({ aMoves: ["물의파동", "칼춤"] }), "물의파동");
    const ko = mkc(); ko.b.currentHp = 1; const koFired = fired(ko, "아이언헤드") && ko.b.currentHp === 0;
    const sub = mkc(); sub.b.substituteHp = 500; const subFired = fired(sub, "아이언헤드");
    const half = fired(mkc(), "아이언헤드", () => 0.5);
    return noncontact && koFired && !subFired && !half ? true : JSON.stringify({ noncontact, koFired, subFired, half });
  });
  // ── 11 마지막 PP 직후 무발동 ──
  guard("D3-fix48 11: 마지막 PP(1)로 쓴 직후에는 무발동(Showdown onStart PP 0 실패) — 미래예지는 20-ver83-a4 R3-s1이 확인", () => {
    const st = mkc(); st.a.remainingPp["아이언헤드"] = 1;
    const r = fire(st, "아이언헤드");
    return st.a.volatile.active.disable === undefined && r.abilityDisabledMoveName === undefined ? true : JSON.stringify({ d: st.a.volatile.active.disable, name: r.abilityDisabledMoveName });
  });
  // ── 19 (A-2) 잠꼬대가 부른 기술이 맞아도 봉인되는 것은 잠꼬대 ──
  guard("D3-fix48 19: 잠꼬대가 부른 깨물어부수기가 저주받은바디에 맞으면 잠꼬대가 봉인(disable.moveId·로그 이름), 호출된 기술 PP는 그대로", () => {
    const st = asleep(mkc({ aMoves: ["잠꼬대", "깨물어부수기"] })); const callPp = st.a.remainingPp["깨물어부수기"];
    const r = fire(st, "잠꼬대"); const d = st.a.volatile.active.disable;
    return r.sleepTalkCalledMoveName === "깨물어부수기" && d?.moveId === "잠꼬대" && r.abilityDisabledMoveName === "잠꼬대" && st.a.remainingPp["깨물어부수기"] === callPp
      ? true : JSON.stringify({ called: r.sleepTalkCalledMoveName, d, name: r.abilityDisabledMoveName, callPp: st.a.remainingPp["깨물어부수기"], callPp0: callPp });
  });
  // ── 20 (A-2) 흉내쟁이(데이터 id; 설계서의 따라하기)가 기술칸에 없는 기술을 불러도 봉인되는 것은 흉내쟁이 ──
  guard("D3-fix48 20: 흉내쟁이가 기술칸에 없는 기술(물의파동)을 불러 저주받은바디에 맞으면 흉내쟁이가 봉인된다", () => {
    const st = mkc({ aMoves: ["흉내쟁이", "칼춤"] }); st.lastMoveUsedId = "물의파동";
    const r = fire(st, "흉내쟁이"); const d = st.a.volatile.active.disable;
    return r.copycatCalledMoveName === "물의파동" && d?.moveId === "흉내쟁이" && r.abilityDisabledMoveName === "흉내쟁이" ? true : JSON.stringify({ called: r.copycatCalledMoveName, d, name: r.abilityDisabledMoveName });
  });
  // ── 26 호출 기술의 PP 판정은 호출한 기술의 슬롯 기준 ──
  guard("D3-fix48 26: 잠꼬대 PP가 마지막 1을 쓴 직후면 저주받은바디 무발동(호출된 깨물어부수기 PP가 남아 있어도)", () => {
    const st = asleep(mkc({ aMoves: ["잠꼬대", "깨물어부수기"] })); st.a.remainingPp["잠꼬대"] = 1;
    const r = fire(st, "잠꼬대");
    return r.sleepTalkCalledMoveName === "깨물어부수기" && st.a.volatile.active.disable === undefined && r.abilityDisabledMoveName === undefined && st.a.remainingPp["깨물어부수기"] > 0
      ? true : JSON.stringify({ called: r.sleepTalkCalledMoveName, d: st.a.volatile.active.disable, name: r.abilityDisabledMoveName, callPp: st.a.remainingPp["깨물어부수기"] });
  });
  // ══ ③ E8-28 드레인 회복(해감액 포함)은 접촉 반응보다 먼저·타마다 + 공격측 기절 시 후속 타·다단 중단 ══
  const dpts = pts({ hp: 20, atk: 32, spd: 14 }); // 공격측: 피해가 충분히 큰 빌드
  // a(공격측)가 b(방어측 잠만보)를 때린다. 예비 1마리씩.
  const mkd = ({ aMon = "하마돈", aMoves, aAbility = null, aItem = null, dAbility = null, dItem = null, aPts = dpts, dMon = "잠만보" }) =>
    battle([mon(aMon, aMoves, aAbility, aItem, aPts), mon("잠만보", ["칼춤"])], [mon(dMon, ["칼춤"], dAbility, dItem, slow), mon("잠만보", ["칼춤"])]);
  const R8 = (max) => Math.floor(max / 8); // 까칠한피부 반응 피해(공격측 최대 HP의 1/8)

  // ── 12 풀피 공격측 드레인 vs 까칠한피부: 회복은 상한에 막혀 0, 반응은 그대로 ──
  guard("D3-fix48 12: 풀피 공격측의 드레인키스·드레인펀치 vs 까칠한피부 → 최종 HP = 최대 − ⌊최대/8⌋(회복이 반응보다 먼저라 상한에 막힘)", () => {
    const bad = [];
    for (const m of ["드레인키스", "드레인펀치"]) {
      const st = mkd({ aMoves: [m, "칼춤"], dAbility: "까칠한피부" }); fire(st, m);
      if (st.a.currentHp !== st.a.maxHp - R8(st.a.maxHp)) bad.push(`${m}: ${st.a.currentHp}/${st.a.maxHp}`);
    }
    return bad.length === 0 ? true : bad.join(" ");
  });
  // ── 13 최대 − 5: 회복이 먼저 차올라 최대 HP까지 간 뒤 반응 ──
  guard("D3-fix48 13: HP = 최대 − 5인 드레인펀치 vs 까칠한피부 → 회복(≥5)이 먼저라 최대까지 찬 뒤 1/8 → 최종 = 최대 − ⌊최대/8⌋", () => {
    const st = mkd({ aMoves: ["드레인펀치", "칼춤"], dAbility: "까칠한피부" }); st.a.currentHp = st.a.maxHp - 5;
    const r = fire(st, "드레인펀치");
    return r.drainHealAmount >= 5 && st.a.currentHp === st.a.maxHp - R8(st.a.maxHp) ? true : JSON.stringify({ heal: r.drainHealAmount, hp: st.a.currentHp, max: st.a.maxHp });
  });
  // ── 14 HP 1: 회복이 먼저라 생존 ──
  guard("D3-fix48 14: HP 1인 드레인펀치 vs 까칠한피부 → 회복 먼저(최종 = min(최대, 1 + 회복) − ⌊최대/8⌋, 기절 아님)", () => {
    const st = mkd({ aMoves: ["드레인펀치", "칼춤"], dAbility: "까칠한피부" }); st.a.currentHp = 1;
    const r = fire(st, "드레인펀치"); const want = Math.min(st.a.maxHp, 1 + r.drainHealAmount) - R8(st.a.maxHp);
    return want > 0 && st.a.currentHp === want ? true : JSON.stringify({ want, hp: st.a.currentHp, heal: r.drainHealAmount });
  });
  // ── 15 (B-3) 해감액 + 울퉁불퉁멧: 해감액이 먼저(전액), 그 뒤 헬멧으로 기절 ──
  guard("D3-fix48 15: 흡혈로 해감액 + 울퉁불퉁멧 방어측 — 해감액 피해가 먼저 전액 들어가고(현재 HP로 안 잘림) 그 뒤 헬멧으로 기절", () => {
    const mk = () => mkd({ aMoves: ["흡혈", "칼춤"], dAbility: "해감액", dItem: "울퉁불퉁멧" });
    const probe = fire(mk(), "흡혈"); const D = probe.liquidOozeDamage, H = probe.rockyHelmetDamage;
    if (!(D >= 2 && H >= 2)) return `전제 실패 D=${D} H=${H}`;
    const st = mk(); st.a.currentHp = D + H - 1; // 해감액 D 뒤 남는 HP는 H − 1 → 헬멧 H가 쓰러뜨린다
    const r = fire(st, "흡혈");
    return r.liquidOozeDamage === D && st.a.currentHp === 0 ? true : JSON.stringify({ D, H, ooze: r.liquidOozeDamage, hp: st.a.currentHp });
  });
  // ── 16 회귀: 비접촉 드레인·반응 없는 방어측은 회복량 그대로 ──
  guard("D3-fix48 16: 회귀 — 기가드레인(비접촉)은 반응 방어측이든 아니든 회복 = ⌊방어측이 잃은 HP × 0.5⌋(상한)", () => {
    const bad = [];
    for (const dAbility of [null, "까칠한피부"]) {
      const st = mkd({ aMoves: ["기가드레인", "칼춤"], dAbility }); st.a.currentHp = Math.floor(st.a.maxHp / 2); const hp0 = st.a.currentHp;
      fire(st, "기가드레인"); const lost = st.b.maxHp - st.b.currentHp;
      if (st.a.currentHp !== Math.min(st.a.maxHp, hp0 + Math.floor(lost * 0.5))) bad.push(`${dAbility}: ${st.a.currentHp}`);
    }
    return bad.length === 0 ? true : bad.join(" ");
  });
  // ── 17 회귀: 반동·생명의구슬·조개껍질방울과 까칠한피부의 합산 HP(순서 불변) ──
  guard("D3-fix48 17: 회귀 — 브레이브버드 반동·생명의구슬·조개껍질방울 × 까칠한피부 합산 HP는 식과 같다", () => {
    const bad = [];
    { const st = mkd({ aMoves: ["브레이브버드", "칼춤"], dAbility: "까칠한피부" }); st.a.currentHp = Math.floor(st.a.maxHp / 2); const hp0 = st.a.currentHp;
      const r = fire(st, "브레이브버드"); if (!(r.recoilDamage > 0) || st.a.currentHp !== hp0 - r.recoilDamage - R8(st.a.maxHp)) bad.push(`반동 ${st.a.currentHp}`); }
    { const st = mkd({ aMoves: ["아이언헤드", "칼춤"], aItem: "생명의구슬", dAbility: "까칠한피부" }); st.a.currentHp = Math.floor(st.a.maxHp / 2); const hp0 = st.a.currentHp;
      fire(st, "아이언헤드"); if (st.a.currentHp !== hp0 - R8(st.a.maxHp) - Math.floor(st.a.maxHp / 10)) bad.push(`구슬 ${st.a.currentHp}`); }
    { const st = mkd({ aMoves: ["아이언헤드", "칼춤"], aItem: "조개껍질방울", dAbility: "까칠한피부" }); st.a.currentHp = Math.floor(st.a.maxHp / 2); const hp0 = st.a.currentHp;
      const r = fire(st, "아이언헤드"); if (!(r.shellBellHealAmount > 0) || st.a.currentHp !== Math.min(st.a.maxHp, hp0 - R8(st.a.maxHp) + r.shellBellHealAmount)) bad.push(`방울 ${st.a.currentHp}`); }
    return bad.length === 0 ? true : bad.join(" ");
  });
  // ── 18 회귀: 대타·KO 후의 드레인 ──
  guard("D3-fix48 18: 회귀 — 대타가 맞으면 접촉 반응 없이 대타에 준 만큼만 회복 / 방어측 KO면 남은 HP만큼만 회복하고 반응은 받는다", () => {
    const bad = [];
    { const st = mkd({ aMoves: ["드레인펀치", "칼춤"], dAbility: "까칠한피부" }); st.b.substituteHp = 40; st.a.currentHp = Math.floor(st.a.maxHp / 2); const hp0 = st.a.currentHp;
      const r = fire(st, "드레인펀치"); if ((r.abilityDamageToAttacker ?? 0) !== 0 || r.drainHealAmount !== 20 || st.a.currentHp !== hp0 + 20) bad.push(`대타 반응=${r.abilityDamageToAttacker} 회복=${r.drainHealAmount} hp=${st.a.currentHp}-${hp0}`); }
    { const st = mkd({ aMoves: ["드레인펀치", "칼춤"], dAbility: "까칠한피부" }); st.b.currentHp = 10; st.a.currentHp = Math.floor(st.a.maxHp / 2); const hp0 = st.a.currentHp;
      const r = fire(st, "드레인펀치"); if (st.b.currentHp !== 0 || r.drainHealAmount !== 5 || st.a.currentHp !== hp0 + 5 - R8(st.a.maxHp)) bad.push(`KO 회복=${r.drainHealAmount} hp=${st.a.currentHp}-${hp0}`); }
    return bad.length === 0 ? true : bad.join(" | ");
  });
  // ── 21 (A-1) 부자유친 타별 교차 ──
  guard("D3-fix48 21: 부자유친 드레인펀치 vs 까칠한피부 — 타마다 피해 → 회복 → 반응이 교차하고, 총 회복은 타별 ⌊피해×0.5⌋의 합", () => {
    const st = mkd({ aMon: "캥카", aMoves: ["드레인펀치", "칼춤"], aAbility: "부자유친", dAbility: "까칠한피부" });
    st.a.currentHp = st.a.maxHp - 1; const hp0 = st.a.currentHp;
    const r = fire(st, "드레인펀치"); const d2 = r.followUpHitDamage, d1 = r.damage - d2, h1 = Math.floor(d1 * 0.5), h2 = Math.floor(d2 * 0.5), max = st.a.maxHp, R = R8(max);
    const want = Math.min(max, Math.min(max, hp0 + h1) - R + h2) - R;
    return d2 > 0 && r.drainHealAmount === h1 + h2 && st.a.currentHp === want ? true : JSON.stringify({ d1, d2, heal: r.drainHealAmount, want, hp: st.a.currentHp });
  });
  // ── 22 (A-1) 부자유친 HP 낮음 + 울퉁불퉁멧: 1타 → 회복 → 헬멧으로 기절, 2타 없음 ──
  guard("D3-fix48 22: 부자유친 HP 1 드레인펀치 vs 울퉁불퉁멧 — 1타 → 회복 → 헬멧으로 기절하고 2타(followUpHitDamage)는 나가지 않는다", () => {
    const mk = () => mkd({ aMon: "캥카", aMoves: ["드레인펀치", "칼춤"], aAbility: "부자유친", dItem: "울퉁불퉁멧", aPts: bulky, dMon: "플라제스" }); // 격투를 반감하는 페어리(플라제스) 방어측 + 공격 노력치 0 — 1타 회복이 헬멧 피해보다 작게
    const probe = mk(); const pr = fire(probe, "드레인펀치"); const H = pr.rockyHelmetDamage / 2, h1 = Math.floor((pr.damage - pr.followUpHitDamage) * 0.5);
    if (!(pr.followUpHitDamage > 0 && 1 + h1 <= H)) return `전제 실패 H=${H} h1=${h1} follow=${pr.followUpHitDamage}`;
    const st = mk(); st.a.currentHp = 1; const r = fire(st, "드레인펀치");
    return st.a.currentHp === 0 && (r.followUpHitDamage ?? 0) === 0 ? true : JSON.stringify({ hp: st.a.currentHp, follow: r.followUpHitDamage });
  });
  // ── 23 (B-2) 단발 HP 1 드레인 vs 울퉁불퉁멧: 회복이 헬멧 피해 이상이면 생존 ──
  guard("D3-fix48 23: HP 1인 드레인펀치 vs 울퉁불퉁멧(단발) — 회복이 먼저라 헬멧 피해 이상이면 생존(최종 = min(최대, 1 + 회복) − 헬멧)", () => {
    const st = mkd({ aMoves: ["드레인펀치", "칼춤"], dItem: "울퉁불퉁멧" }); st.a.currentHp = 1;
    const r = fire(st, "드레인펀치"); const want = Math.min(st.a.maxHp, 1 + r.drainHealAmount) - r.rockyHelmetDamage;
    return r.drainHealAmount >= r.rockyHelmetDamage && want > 0 && st.a.currentHp === want ? true : JSON.stringify({ want, hp: st.a.currentHp, heal: r.drainHealAmount, helmet: r.rockyHelmetDamage });
  });
  // ── 24 (B-2) 유폭: 회복 후 유폭 피해 ──
  guard("D3-fix48 24: 드레인으로 유폭 방어측을 KO → 회복(남은 HP만큼)이 먼저, 그 뒤 유폭 피해(최종 = min(최대, HP + 회복) − 유폭)", () => {
    const st = mkd({ aMoves: ["드레인펀치", "칼춤"], dAbility: "유폭" }); st.b.currentHp = 10; st.a.currentHp = st.a.maxHp - 3; const hp0 = st.a.currentHp;
    const r = fire(st, "드레인펀치"); const want = Math.min(st.a.maxHp, hp0 + r.drainHealAmount) - r.abilityDamageToAttacker;
    return st.b.currentHp === 0 && r.abilityDamageToAttacker > 0 && st.a.currentHp === want ? true : JSON.stringify({ want, hp: st.a.currentHp, heal: r.drainHealAmount, aftermath: r.abilityDamageToAttacker });
  });
  // ── 25 공격측 기절 시 다단 루프 중단 ──
  guard("D3-fix48 25: HP 1 공격측의 트리플악셀 vs 까칠한피부 — 1타 반응으로 기절하면 남은 타는 나가지 않는다(hitCount 1) / 회귀: 풀피는 전 타(3) 진행", () => {
    const low = mkd({ aMoves: ["트리플악셀", "칼춤"], dAbility: "까칠한피부" }); low.a.currentHp = 1; const rl = fire(low, "트리플악셀");
    const full = mkd({ aMoves: ["트리플악셀", "칼춤"], dAbility: "까칠한피부" }); const rf = fire(full, "트리플악셀");
    return rl.hitCount === 1 && low.a.currentHp === 0 && rf.hitCount === 3 ? true : JSON.stringify({ lowHits: rl.hitCount, lowHp: low.a.currentHp, fullHits: rf.hitCount });
  });
}
