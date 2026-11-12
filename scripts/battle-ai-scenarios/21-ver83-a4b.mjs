// 8.3 A4-b 턴 종료 교체(Showdown 일치): 정상 공격 경로 정렬(위기회피·레드카드·탈출버튼의 가드·"맞았는가" 판정·우격다짐 제외·생명의구슬 반동 생략)
// + 미래예지 적중이 대상의 위기회피(교체 요구)·레드카드(사용자 강제 교체)를 턴 종료 효과 뒤에 발동시킨다.
// 설계 `8.3-A4b-턴종료교체설계.md` §7. 검수 `8.3-A4-b-턴종료교체설계-검수.md`.
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
  const vol = await server.ssrLoadModule("/src/lib/volatileConditions.ts");
  const ai = await server.ssrLoadModule("/src/lib/battle/ai/index.ts");
  const fsMove = data.getMove("미래예지");
  const mv = (x) => (typeof x === "string" ? { kind: "move", move: data.getMove(x) } : x);
  const safe = (fn) => { try { return fn(); } catch { return null; } };
  const play = (st, a = "칼춤", b = "칼춤", rng = () => 0.5) => safe(() => rt.runTurn(st, mv(a), mv(b), rng));
  const bulky = pts({ hp: 32, spd: 32, def: 32 });
  const ingrain = (f) => { f.volatile = vol.inflictVolatile(f.volatile, "ingrain", () => 0.5); };
  const redCardSwitch = (out) => (out?.result ?? out?.partialResult)?.switches.find((s) => s.redCardItemName);

  // ───────────────────────── 단계 ① 정상 공격 경로 ─────────────────────────
  // 공격자 a(한카리아스, 예비 있음) → 방어측 b. 잠만보는 막치기 한 방에 안 쓰러진다.
  const atk = (move = "막치기", { aAbility = null, aItem = null } = {}) =>
    mon("한카리아스", [move], aAbility, aItem, pts({ atk: 32, spe: 32, hp: 2 }));
  const spare = () => mon("메타그로스", ["칼춤"]);
  const holder = (item, ability = null, pokemon = "잠만보") => mon(pokemon, ["칼춤", "방어"], ability, item, bulky);
  const normal = ({ move = "막치기", aAbility, aItem, aBench = true, bItem, bAbility, bPokemon, bBench = true } = {}) =>
    battle([atk(move, { aAbility, aItem }), ...(aBench ? [spare()] : [])], [holder(bItem, bAbility, bPokemon), ...(bBench ? [spare()] : [])]);
  const hit = (st, move = "막치기", b = "칼춤") => play(st, move, b);

  // N-1 위기회피 — 도망봉인(그림자밟기)·뿌리박기여도 발동하고 교체창
  {
    const half = (st) => { st.b.currentHp = Math.floor(st.b.maxHp / 2) + 1; return st; };
    const shadow = hit(half(normal({ aAbility: "그림자밟기", bItem: null, bAbility: "위기회피" })));
    const root = (() => { const st = half(normal({ bAbility: "위기회피" })); ingrain(st.b); return hit(st); })();
    const plain = hit(half(normal({ bAbility: "위기회피" })));
    check("8.3 A4-b N-1: 위기회피 기본(회귀)", plain?.awaitingSelfSwitch?.emergencyExit === true, JSON.stringify(plain?.awaitingSelfSwitch));
    check("8.3 A4-b N-1a: 도망봉인(그림자밟기)에도 위기회피 발동", shadow?.awaitingSelfSwitch?.side === "b" && shadow.awaitingSelfSwitch.emergencyExit === true, JSON.stringify(shadow?.awaitingSelfSwitch));
    check("8.3 A4-b N-1b: 뿌리박기에도 위기회피 발동", root?.awaitingSelfSwitch?.side === "b" && root.awaitingSelfSwitch.emergencyExit === true, JSON.stringify(root?.awaitingSelfSwitch));
  }
  // N-2 레드카드 — 탈이 벗겨지는 적중(데미지 0)에도 발동 / N-5b 탈출버튼도 마찬가지
  {
    const mk = (item) => battle([mon("따라큐", ["사이코키네시스"], null, null, pts({ spa: 32, spe: 32, hp: 2 })), spare()], [mon("따라큐", ["칼춤"], "탈", item, bulky), spare()]);
    const rc = hit(mk("레드카드"), "사이코키네시스");
    const ej = hit(mk("탈출버튼"), "사이코키네시스");
    const first = rc?.result.actions.find((a) => a.actor === "a");
    check("8.3 A4-b N-2: 탈이 벗겨지는 적중(본체 HP 불변)에도 레드카드 발동", !!first && !!first.hitNegatedByAbilityName && rc.nextState.sideB.party[0].currentHp === rc.nextState.sideB.party[0].maxHp - (first.disguiseRecoilDamage ?? 0) && !!redCardSwitch(rc) && rc.nextState.b.currentItemId === null, `damage=${first?.damage} 탈=${first?.hitNegatedByAbilityName} 교체=${!!redCardSwitch(rc)} 도구=${rc?.nextState.b.currentItemId}`);
    check("8.3 A4-b N-5b: 탈이 벗겨지는 적중에도 탈출버튼 발동·버튼 소모·교체창", ej?.awaitingSelfSwitch?.side === "b" && !!ej.awaitingSelfSwitch.ejectItemName && ej.nextState.b.currentItemId === null, JSON.stringify(ej?.awaitingSelfSwitch) + ` 도구=${ej?.nextState.b.currentItemId}`);
  }
  // N-3 레드카드 — 공격자가 뿌리박기·흡반이면 카드만 소모되고 교체는 없다
  {
    const st = normal({ bItem: "레드카드" }); ingrain(st.a);
    const r = hit(st);
    const st2 = normal({ aAbility: "흡반", bItem: "레드카드" });
    const r2 = hit(st2);
    check("8.3 A4-b N-3a: 뿌리박기 공격자 → 카드 소모, 교체 없음", !!r && r.nextState.b.currentItemId === null && !redCardSwitch(r) && r.nextState.sideA.activeIndex === 0, `도구=${r?.nextState.b.currentItemId} 교체=${!!redCardSwitch(r)}`);
    check("8.3 A4-b N-3b: 흡반 공격자 → 카드 소모, 교체 없음", !!r2 && r2.nextState.b.currentItemId === null && !redCardSwitch(r2) && r2.nextState.sideA.activeIndex === 0, `도구=${r2?.nextState.b.currentItemId}`);
  }
  // N-4 레드카드 — 맞지 않았으면 미발동·카드 보존 (대타 적중·방어 막힘·타입 면역·예비 없음·상태 기술)
  {
    const sub = normal({ bItem: "레드카드" }); sub.b.substituteHp = 9999;
    const prot = hit(normal({ bItem: "레드카드" }), "막치기", "방어");
    const imm = normal({ bItem: "레드카드", bPokemon: "블래키" }); imm.b.types = ["고스트"];
    const noRes = normal({ bItem: "레드카드", aBench: false });
    const stat = hit(normal({ move: "독가루", bItem: "레드카드" }), "독가루");
    const kept = (r) => !!r && r.nextState.b.currentItemId === "레드카드" && !redCardSwitch(r);
    check("8.3 A4-b N-4a: 대타 적중 → 레드카드 미발동", kept(hit(sub)), "");
    check("8.3 A4-b N-4b: 방어 막힘 → 미발동", kept(prot), "");
    check("8.3 A4-b N-4c: 타입 면역 → 미발동", kept(hit(imm)), "");
    check("8.3 A4-b N-4d: 공격자 예비 없음 → 미발동·카드 보존", kept(hit(noRes)), "");
    check("8.3 A4-b N-4e: 상태 기술 → 미발동", kept(stat), "");
  }
  // N-5 탈출버튼 — 주인이 뿌리박기 / 공격자가 그림자밟기여도 발동하고 교체창
  {
    const root = normal({ bItem: "탈출버튼" }); ingrain(root.b);
    const shadow = normal({ aAbility: "그림자밟기", bItem: "탈출버튼" });
    const r1 = hit(root), r2 = hit(shadow);
    check("8.3 A4-b N-5a: 주인 뿌리박기에도 탈출버튼 발동", r1?.awaitingSelfSwitch?.side === "b" && !!r1.awaitingSelfSwitch.ejectItemName && r1.nextState.b.currentItemId === null, JSON.stringify(r1?.awaitingSelfSwitch));
    check("8.3 A4-b N-5c: 공격자 그림자밟기에도 탈출버튼 발동", r2?.awaitingSelfSwitch?.side === "b" && !!r2.awaitingSelfSwitch.ejectItemName, JSON.stringify(r2?.awaitingSelfSwitch));
  }
  // N-6 우격다짐 — 추가효과 있는 기술이면 세 효과 모두 불발, 없는 기술이면 정상 발동
  {
    const sheer = (move, extra) => normal({ move, aAbility: "우격다짐", ...extra });
    const nearHalf = (st) => { st.b.currentHp = Math.floor(st.b.maxHp / 2) + 1; return st; };
    const secondary = "독찌르기", plain = "지진"; // 독찌르기: 독 30%(추가효과), 지진: 추가효과 없음
    const rcS = hit(sheer(secondary, { bItem: "레드카드" }), secondary), rcP = hit(sheer(plain, { bItem: "레드카드" }), plain);
    const ejS = hit(sheer(secondary, { bItem: "탈출버튼" }), secondary), ejP = hit(sheer(plain, { bItem: "탈출버튼" }), plain);
    const exS = hit(nearHalf(sheer(secondary, { bAbility: "위기회피" })), secondary), exP = hit(nearHalf(sheer(plain, { bAbility: "위기회피" })), plain);
    check("8.3 A4-b N-6a: 우격다짐 + 추가효과 기술 → 레드카드 미발동·보존", !!rcS && rcS.nextState.b.currentItemId === "레드카드" && !redCardSwitch(rcS), `도구=${rcS?.nextState.b.currentItemId}`);
    check("8.3 A4-b N-6b: 우격다짐 + 추가효과 없는 기술 → 레드카드 정상 발동", !!redCardSwitch(rcP) && rcP.nextState.b.currentItemId === null, `교체=${!!redCardSwitch(rcP)}`);
    check("8.3 A4-b N-6c: 우격다짐 + 추가효과 기술 → 탈출버튼 미발동·보존", !!ejS && !ejS.awaitingSelfSwitch && ejS.nextState.b.currentItemId === "탈출버튼", JSON.stringify(ejS?.awaitingSelfSwitch));
    check("8.3 A4-b N-6d: 우격다짐 + 추가효과 없는 기술 → 탈출버튼 정상 발동", !!ejP?.awaitingSelfSwitch?.ejectItemName, JSON.stringify(ejP?.awaitingSelfSwitch));
    check("8.3 A4-b N-6e: 우격다짐 + 추가효과 기술 → 위기회피 미발동", !!exS && !exS.awaitingSelfSwitch, JSON.stringify(exS?.awaitingSelfSwitch));
    check("8.3 A4-b N-6f: 우격다짐 + 추가효과 없는 기술 → 위기회피 정상 발동", exP?.awaitingSelfSwitch?.emergencyExit === true, JSON.stringify(exP?.awaitingSelfSwitch));
  }
  // N-7 레드카드가 공격자를 끌어내면 생명의구슬 반동이 없다 / 못 끌어내면(뿌리박기) 반동은 있다
  {
    const clean = normal({ aItem: "생명의구슬", bItem: "레드카드" });
    const rooted = normal({ aItem: "생명의구슬", bItem: "레드카드" }); ingrain(rooted.a);
    const noCard = normal({ aItem: "생명의구슬" });
    const r1 = hit(clean), r2 = hit(rooted), r3 = hit(noCard);
    const a1 = r1?.nextState.sideA.party[0], a2 = r2?.nextState.sideA.party[0], a3 = r3?.nextState.sideA.party[0];
    check("8.3 A4-b N-7a: 레드카드로 끌려 나가면 생명의구슬 반동 없음", !!redCardSwitch(r1) && a1.currentHp === a1.maxHp, `교체=${!!redCardSwitch(r1)} HP=${a1?.currentHp}/${a1?.maxHp}`);
    check("8.3 A4-b N-7b: 뿌리박기로 못 끌려 나가면 카드 소모 + 반동 있음", !redCardSwitch(r2) && r2.nextState.b.currentItemId === null && a2.currentHp < a2.maxHp, `HP=${a2?.currentHp}/${a2?.maxHp}`);
    check("8.3 A4-b N-7c: 레드카드 없으면 반동 있음(회귀)", a3.currentHp < a3.maxHp, `HP=${a3?.currentHp}/${a3?.maxHp}`);
  }

  // ───────────────────────── 단계 ③ 미래예지 적중 반응 ─────────────────────────
  // a: 따라큐(미래예지 사용자) [+ 예비], b: 잠만보(대상) [+ 예비]. 예약 대기는 b 편(sideB)에 걸린다.
  const strong = pts({ spa: 32, hp: 2 });
  const mk = ({ aItem = null, aAbility = null, bItem = null, bAbility = null, aBench = true, bBench = true, aBenchAbility = null } = {}) =>
    battle(
      [mon("따라큐", ["미래예지", "명상", "칼춤", "사이코키네시스"], aAbility, aItem, strong), ...(aBench ? [mon("잠만보", ["칼춤"], aBenchAbility, null, bulky)] : [])],
      [mon("잠만보", ["칼춤", "버티기", "방어"], bAbility, bItem, bulky), ...(bBench ? [mon("잠만보", ["칼춤"], null, null, bulky)] : [])],
    );
  const queue = (st) => { st.sideB.futureSight = { turnsRemaining: 1, move: fsMove, sourceIndex: 0 }; return st; };
  const futureDmg = (opts) => { const r = play(queue(mk(opts))); return r?.result.endOfTurn.find((e) => e.futureSightMoveName)?.damage ?? -1; };
  // 적중으로 HP가 절반 초과 → 이하(0 초과)가 되도록 대상 HP를 맞춘다: 적중 전 = 데미지 + floor(max/2)
  const crossHalf = (st, opts) => { const d = futureDmg(opts); st.b.currentHp = d + Math.floor(st.b.maxHp / 2); return d; };
  const fsLine = (r) => r?.result.endOfTurn.find((e) => e.futureSightMoveName);

  // R3-x1 위기회피 — 적중으로 절반 이하 → 교체 요구(활성은 살아 있음), 교체를 적용하면 다음 턴 진행
  {
    const o = { bAbility: "위기회피" };
    const st = queue(mk(o)); const d = crossHalf(st, o);
    const r = play(st);
    check("8.3 A4-b R3-x1: 위기회피 발동 → forcedSwitch[b], 활성은 생존, 발동 줄", d > 0 && r?.forcedSwitch?.b === true && r.nextState.b.currentHp > 0 && !!fsLine(r)?.futureSightExitAbilityName, `d=${d} forcedSwitch=${JSON.stringify(r?.forcedSwitch)} 줄=${fsLine(r)?.futureSightExitAbilityName}`);
    const next = r && sw.applySwitch(r.nextState, "b", 1).nextState;
    const r2 = next && play(next);
    check("8.3 A4-b R3-x1b: 교체 적용 후 다음 턴 진행", !!r2 && next.sideB.activeIndex === 1, `activeIndex=${next?.sideB.activeIndex}`);
    const pick = r && safe(() => ai.chooseAiForcedSwitch(r.nextState, "b", 0.5));
    check("8.3 A4-b R3-x4: 살아 있는 활성에도 AI 강제 교체 선택이 동작", pick === 1, `선택=${pick}`);
  }
  // R3-x2 미발동 — 이미 절반 이하 / 적중 후에도 절반 초과 / 예비 없음 / 대타 적중 / 빗나감
  {
    const o = { bAbility: "위기회피" };
    const already = queue(mk(o)); already.b.currentHp = Math.floor(already.b.maxHp / 2);
    const above = queue(mk(o)); // 풀피 — 한 방으로 절반 아래로 안 간다
    const noBench = queue(mk({ ...o, bBench: false })); crossHalf(noBench, { ...o, bBench: false });
    const sub = queue(mk(o)); crossHalf(sub, o); sub.b.substituteHp = 9999;
    const miss = queue(mk(o)); crossHalf(miss, o); miss.b.accuracyStages = { ...miss.b.accuracyStages, evasion: 6 };
    const none = (r) => !!r && !r.forcedSwitch?.b && !fsLine(r)?.futureSightExitAbilityName;
    check("8.3 A4-b R3-x2a: 이미 절반 이하 → 미발동", none(play(already)), "");
    check("8.3 A4-b R3-x2b: 적중 후에도 절반 초과 → 미발동", none(play(above)), "");
    check("8.3 A4-b R3-x2c: 예비 없음 → 미발동", none(play(noBench)), "");
    check("8.3 A4-b R3-x2d: 대타 적중 → 미발동", none(play(sub)), "");
    check("8.3 A4-b R3-x2e: 빗나감 → 미발동", none(play(miss, "칼춤", "칼춤", () => 0.999)), "");
  }
  // R3-x3 같은 턴 종료에 대상이 상태이상 틱으로 기절 → 기절 교체가 우선, 요구는 한 번
  {
    const o = { bAbility: "위기회피" };
    const d = futureDmg(o);
    const st = queue(mk(o)); st.b.maxHp = d * 2; st.b.currentHp = d + 1; // 적중 후 HP 1 — 절반 이하(≤ max/2)
    st.b.status = { condition: "poison", turnsElapsed: 1 };
    const r = play(st);
    check("8.3 A4-b R3-x3: 위기회피 발동 후 독으로 기절 → 기절 교체 한 번", d > 0 && r?.nextState.b.currentHp === 0 && r.forcedSwitch?.b === true && !r.result.winner, `d=${d} HP=${r?.nextState.b.currentHp} forced=${JSON.stringify(r?.forcedSwitch)}`);
  }
  // R3-x5 도망봉인(그림자밟기)·뿌리박기여도 발동 / R3-x6 발동 뒤 먹다남은음식으로 HP가 절반을 넘어도 교체 요구
  {
    const o = { bAbility: "위기회피" };
    const rooted = queue(mk(o)); crossHalf(rooted, o); ingrain(rooted.b);
    const shadow = queue(mk({ ...o, aAbility: "그림자밟기" })); crossHalf(shadow, { ...o, aAbility: "그림자밟기" });
    check("8.3 A4-b R3-x5a: 뿌리박기에도 위기회피 교체 요구", play(rooted)?.forcedSwitch?.b === true, "");
    check("8.3 A4-b R3-x5b: 도망봉인(그림자밟기)에도 위기회피 교체 요구", play(shadow)?.forcedSwitch?.b === true, "");
    const lo = { bAbility: "위기회피", bItem: "먹다남은음식" };
    const st = queue(mk(lo)); crossHalf(st, lo);
    const r = play(st);
    check("8.3 A4-b R3-x6: 먹다남은음식으로 HP가 절반을 넘어도 교체 요구(HP 재확인 안 함)", r?.forcedSwitch?.b === true && r.nextState.b.currentHp * 2 > r.nextState.b.maxHp, `HP=${r?.nextState.b.currentHp}/${r?.nextState.b.maxHp} forced=${JSON.stringify(r?.forcedSwitch)}`);
  }
  // R3-t1 레드카드 — 턴 종료 효과(먹다남은음식 등)가 끝난 뒤 사용자가 무작위 예비로 교체, 카드 소모, endOfTurn 교체 줄
  {
    const st = queue(mk({ aItem: "먹다남은음식", bItem: "레드카드" })); st.a.currentHp = st.a.maxHp - 60;
    const r = play(st);
    const swl = r?.result.switches.find((s) => s.redCardItemName);
    const lef = r?.result.endOfTurn.find((e) => e.actor === "a" && e.itemHeal && e.itemHealItemName === "먹다남은음식");
    check("8.3 A4-b R3-t1: 레드카드 → 턴 종료 뒤 사용자 교체·카드 소모·endOfTurn 줄", !!swl && swl.endOfTurn === true && !swl.afterMove && swl.side === "a" && r.nextState.sideA.activeIndex === 1 && r.nextState.b.currentItemId === null, `줄=${JSON.stringify(swl && { side: swl.side, e: swl.endOfTurn, af: swl.afterMove })} a=${r?.nextState.sideA.activeIndex} 도구=${r?.nextState.b.currentItemId}`);
    check("8.3 A4-b R3-t1b: 사용자의 턴 종료 회복은 교체 전에 처리됨", !!lef, `먹다남은음식 줄=${!!lef}`);
  }
  // R3-t2 미발동·카드 보존 — 사용자 교체/기절 · 대타 적중 · 빗나감 · 타입 면역
  {
    const base = () => queue(mk({ bItem: "레드카드" }));
    const left = base(); const leftR = play(left, { kind: "switch", toIndex: 1 }, "칼춤");
    const sub = base(); sub.b.substituteHp = 9999;
    const miss = base(); miss.b.accuracyStages = { ...miss.b.accuracyStages, evasion: 6 };
    const imm = base(); imm.b.types = ["악"];
    const kept = (r) => !!r && r.nextState.b.currentItemId === "레드카드" && !r.result.switches.some((s) => s.redCardItemName);
    check("8.3 A4-b R3-t2a: 사용자가 교체돼 있으면 미발동", kept(leftR), "");
    check("8.3 A4-b R3-t2b: 대타 적중 → 미발동", kept(play(sub)), "");
    check("8.3 A4-b R3-t2c: 빗나감 → 미발동", kept(play(miss, "칼춤", "칼춤", () => 0.999)), "");
    check("8.3 A4-b R3-t2d: 타입 면역 → 미발동", kept(play(imm)), "");
  }
  // R3-t3 레드카드로 끌려 들어온 포켓몬이 스텔스록으로 쓰러짐 → 기절 교체로 정리
  {
    const st = queue(mk({ bItem: "레드카드" })); st.sideA.hazards.stealthRock = true;
    st.sideA.party[1].currentHp = 1;
    const r = play(st);
    check("8.3 A4-b R3-t3: 끌려 들어온 포켓몬이 스텔스록으로 기절 → forcedSwitch[a], 승패 미정", !!r && r.nextState.a.currentHp === 0 && r.forcedSwitch?.a === true && !r.result.winner, `a HP=${r?.nextState.a.currentHp} forced=${JSON.stringify(r?.forcedSwitch)} winner=${r?.result.winner}`);
  }
  // R3-t4 사용자가 뿌리박기 → 카드 소모, 교체 없음 / R3-t5 탈이 벗겨지는 적중(데미지 0)에도 발동 / R3-t6 예비 없음 → 카드 보존
  {
    const st = queue(mk({ bItem: "레드카드" })); ingrain(st.a);
    const r = play(st);
    check("8.3 A4-b R3-t4: 사용자 뿌리박기 → 카드 소모, 교체 없음", !!r && r.nextState.b.currentItemId === null && r.nextState.sideA.activeIndex === 0 && !r.result.switches.some((s) => s.redCardItemName), `도구=${r?.nextState.b.currentItemId} a=${r?.nextState.sideA.activeIndex}`);
    const mask = queue(battle(
      [mon("따라큐", ["미래예지", "칼춤"], null, null, strong), mon("잠만보", ["칼춤"], null, null, bulky)],
      [mon("따라큐", ["칼춤"], "탈", "레드카드", bulky), mon("잠만보", ["칼춤"], null, null, bulky)],
    ));
    const r5 = play(mask);
    const line = fsLine(r5);
    check("8.3 A4-b R3-t5: 탈이 벗겨지는 적중(데미지 0)에도 레드카드 발동", !!line && !!r5.result.switches.find((s) => s.redCardItemName) && r5.nextState.b.currentItemId === null, `damage=${line?.damage} 교체=${!!r5?.result.switches.find((s) => s.redCardItemName)}`);
    const none = queue(mk({ bItem: "레드카드", aBench: false }));
    const r6 = play(none);
    check("8.3 A4-b R3-t6: 사용자 편 예비 없음 → 미발동·카드 보존", !!r6 && r6.nextState.b.currentItemId === "레드카드", `도구=${r6?.nextState.b.currentItemId}`);
  }
  // R3-t7 [검수 V4] 생명의구슬 — 끌려 나가면 반동 없음 / 뿌리박기로 못 끌려 나가면 반동으로 기절 → 기절 교체
  {
    const st = queue(mk({ aItem: "생명의구슬", bItem: "레드카드" }));
    const r = play(st);
    const a0 = r?.nextState.sideA.party[0];
    const recoil = r?.result.endOfTurn.some((e) => e.itemRecoilItemName);
    check("8.3 A4-b R3-t7a: 레드카드로 끌려 나가면 생명의구슬 반동 없음 + 사용자 교체", !!r?.result.switches.find((s) => s.redCardItemName) && !recoil && a0.currentHp === a0.maxHp, `반동줄=${recoil} HP=${a0?.currentHp}/${a0?.maxHp}`);
    const st2 = queue(mk({ aItem: "생명의구슬", bItem: "레드카드" })); ingrain(st2.a); st2.a.currentHp = 1;
    const r2 = play(st2);
    check("8.3 A4-b R3-t7b: 뿌리박기 사용자 → 카드 소모, 반동으로 기절, 기절 교체", !!r2 && r2.nextState.b.currentItemId === null && r2.nextState.a.currentHp === 0 && r2.forcedSwitch?.a === true && !r2.result.switches.some((s) => s.redCardItemName), `a HP=${r2?.nextState.a.currentHp} forced=${JSON.stringify(r2?.forcedSwitch)}`);
  }
  // R3-t8 끌려 들어온 포켓몬이 필드를 펴면 같은 턴 만료 카운트다운을 맞지 않는다(5턴)
  {
    const st = queue(mk({ bItem: "레드카드", aBenchAbility: "그래스메이커" }));
    const r = play(st);
    check("8.3 A4-b R3-t8: 끌려 들어온 포켓몬의 필드는 5턴 유지", r?.nextState.field === "그래스필드" && r.nextState.fieldTurnsRemaining === 5, `field=${r?.nextState.field} 남은=${r?.nextState.fieldTurnsRemaining}`);
  }
  // R3-x7 같은 포켓몬이 위기회피 + 레드카드 — 사용자가 먼저 끌려 나오고 그다음 대상에게 교체 요구
  {
    const o = { bAbility: "위기회피", bItem: "레드카드" };
    const st = queue(mk(o)); crossHalf(st, o);
    const r = play(st);
    check("8.3 A4-b R3-x7: 위기회피 + 레드카드 → 사용자 교체와 대상 교체 요구 둘 다", !!r?.result.switches.find((s) => s.redCardItemName && s.side === "a") && r.forcedSwitch?.b === true, `교체=${!!r?.result.switches.find((s) => s.redCardItemName)} forced=${JSON.stringify(r?.forcedSwitch)}`);
  }
}
