// 8.3 A3 회복봉인(R2, Showdown 일치): 봉인 중 HP 회복 열매는 먹지 않고 보존, 열매를 먹게 하는 기술·되새김질은 소비하되 회복 0, 볼주머니·저수 회복 0,
// 흡수 기술·치유소원·치유파동류는 사용 불가, 재적중은 갱신 없음, 해제 로그는 회복봉인만. 재생력·아픔나누기는 봉인과 무관.
// 설계 `8.3-A3-회복봉인설계.md` §7.
export default async function ({ server, data, ev, mon, battle, pts, opt, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const vol = await server.ssrLoadModule("/src/lib/volatileConditions.ts");
  const move = (id) => ({ kind: "move", move: data.getMove(id) });
  const rng = () => 0.5;
  const play = (st, a, b) => rt.runTurn(st, move(a), move(b), rng);
  const A = (e) => e.actor === "a";
  const big = pts({ hp: 32, spa: 32 });
  const halfHp = (f) => Math.floor(f.maxHp * 0.4); // 자뭉열매(절반 이하 회복)가 발동하는 HP
  // 봉인된 a(잠만보)와 평범한 b(잠만보)
  const mk = (aMoves = ["칼춤"], aItem = null, aAbility = null, bMoves = ["칼춤"], bItem = null) =>
    battle([mon("잠만보", aMoves, aAbility, aItem, big)], [mon("잠만보", bMoves, null, bItem, big)]);
  const block = (f, turns = 2) => {
    f.volatile = vol.inflictVolatile(f.volatile, "healBlock", () => 0.5);
    if (turns !== 2) f.volatile = { ...f.volatile, active: { ...f.volatile.active, healBlock: { ...f.volatile.active.healBlock, turnsRemaining: turns } } };
  };
  const blocked = (f) => !!f.volatile.active.healBlock;

  // R2-a 봉인 중 자뭉열매는 먹지 않고 보존한다 (대조군: 봉인 없으면 먹는다)
  {
    const st = mk(["칼춤"], "자뭉열매");
    st.a.currentHp = halfHp(st.a);
    const ctrl = mk(["칼춤"], "자뭉열매");
    ctrl.a.currentHp = halfHp(ctrl.a);
    block(st.a);
    const r = play(st, "칼춤", "칼춤");
    const rc = play(ctrl, "칼춤", "칼춤");
    check(
      "8.3 A3 R2-a: 봉인 중 HP 회복 열매는 먹지 않고 보존",
      rc.nextState.a.itemConsumed === true && r.nextState.a.currentItemId === "자뭉열매" && !r.nextState.a.itemConsumed && r.nextState.a.currentHp === halfHp(st.a),
      `보존=${r.nextState.a.currentItemId} 소비=${r.nextState.a.itemConsumed} HP=${r.nextState.a.currentHp}/${halfHp(st.a)}`,
    );
  }
  // R2-b 봉인 중 흡수 기술은 사용 불가(cant), 먹다남은음식은 회복 0
  {
    const st = mk(["기가드레인", "칼춤"]);
    st.a.currentHp = Math.floor(st.a.maxHp / 2);
    block(st.a);
    const r = play(st, "기가드레인", "칼춤");
    const act = r.result.actions.find(A);
    const left = mk(["칼춤"], "먹다남은음식");
    left.a.currentHp = Math.floor(left.a.maxHp / 2);
    block(left.a);
    const rl = play(left, "칼춤", "칼춤");
    check(
      "8.3 A3 R2-b: 봉인 중 흡수 기술은 사용 불가(cant), 먹다남은음식은 회복 0",
      act?.moveRestrictionKind === "healBlock" && (act?.damage ?? 0) === 0 && !rl.result.endOfTurn.some((e) => A(e) && e.itemHeal),
      `제한=${act?.moveRestrictionKind} 데미지=${act?.damage} 먹다남은음식회복=${rl.result.endOfTurn.some((e) => A(e) && e.itemHeal)}`,
    );
  }
  // R2-c 봉인/소리 봉인 중 재적중해도 지속 시간은 갱신되지 않는다 (2턴째 맞은 뒤 턴 종료에 해제)
  {
    const st = mk(["칼춤"], null, null, ["사이코노이즈"]);
    const t1 = play(st, "칼춤", "사이코노이즈");
    const t2 = play(t1.nextState, "칼춤", "사이코노이즈");
    check("8.3 A3 R2-c: 회복봉인 재적중은 갱신 없음(데미지는 들어감)", blocked(t1.nextState.a) && !blocked(t2.nextState.a) && (t2.result.actions.find((x) => !A(x))?.damage ?? 0) > 0, `1턴후=${blocked(t1.nextState.a)} 2턴후=${blocked(t2.nextState.a)}`);
    const st2 = mk(["칼춤"], null, null, ["지옥찌르기"]);
    const u1 = play(st2, "칼춤", "지옥찌르기");
    const u2 = play(u1.nextState, "칼춤", "지옥찌르기");
    const tc = (s) => !!s.a.volatile.active.throatChop;
    check("8.3 A3 R2-c: 지옥찌르기 재적중도 갱신 없음", tc(u1.nextState) && !tc(u2.nextState), `1턴후=${tc(u1.nextState)} 2턴후=${tc(u2.nextState)}`);
  }
  // R2-e 사이코노이즈 적중 후: 맞은 턴과 다음 턴 종료까지 봉인(먹다남은음식도 막힘), 3턴째 회복. 해제 턴 종료에 "회복봉인 해제" 줄
  {
    const st = mk(["칼춤"], "먹다남은음식", null, ["사이코노이즈", "칼춤"]);
    st.a.currentHp = Math.floor(st.a.maxHp / 2);
    const t1 = play(st, "칼춤", "사이코노이즈");
    const t2 = play(t1.nextState, "칼춤", "칼춤");
    const t3 = play(t2.nextState, "칼춤", "칼춤");
    const healed = (r) => r.result.endOfTurn.some((e) => A(e) && e.itemHeal);
    const ended = (r) => r.result.endOfTurn.some((e) => A(e) && e.volatileEnded === "healBlock");
    check(
      "8.3 A3 R2-e: 봉인 2턴(맞은 턴+다음 턴 종료까지), 해제 턴에 해제 줄, 3턴째 회복",
      !healed(t1) && !healed(t2) && ended(t2) && !ended(t1) && healed(t3),
      `회복 ${healed(t1)}/${healed(t2)}/${healed(t3)} 해제줄 ${ended(t1)}/${ended(t2)}`,
    );
  }
  // R2-f 봉인 중 회복 기술(달빛)·치유소원·치유파동은 사용 불가
  {
    const tries = ["달빛", "치유소원", "치유파동"].map((id) => {
      const st = mk([id, "칼춤"]);
      st.a.currentHp = Math.floor(st.a.maxHp / 2);
      block(st.a);
      const r = play(st, id, "칼춤");
      return [id, r.result.actions.find(A)?.moveRestrictionKind, r.nextState.a.currentHp === Math.floor(st.a.maxHp / 2)];
    });
    check("8.3 A3 R2-f: 봉인 중 달빛·치유소원·치유파동은 cant", tries.every(([, kind, same]) => kind === "healBlock" && same), JSON.stringify(tries));
  }
  // R2-g 봉인이 끝난 턴 종료(⑤)에 열매 발동: 1턴째는 보존, 2턴째 해제 후 소비·회복
  {
    const st = mk(["칼춤"], "자뭉열매");
    st.a.currentHp = halfHp(st.a);
    block(st.a);
    const t1 = play(st, "칼춤", "칼춤");
    const t2 = play(t1.nextState, "칼춤", "칼춤");
    check("8.3 A3 R2-g: 봉인 해제 턴 종료에 열매 소비·회복", t1.nextState.a.currentItemId === "자뭉열매" && t2.nextState.a.itemConsumed === true && t2.nextState.a.currentHp > halfHp(st.a), `1턴=${t1.nextState.a.currentItemId} 2턴소비=${t2.nextState.a.itemConsumed} HP=${t2.nextState.a.currentHp}/${halfHp(st.a)}`);
  }
  // R2-h 봉인 중 볼주머니(특성) + 상태이상 치료 열매(리샘열매): 치료는 되고 +1/3 회복은 없다
  {
    const st = mk(["칼춤"], "리샘열매", "볼주머니", ["전기자석파"]);
    st.a.currentHp = Math.floor(st.a.maxHp / 2);
    block(st.a);
    const r = play(st, "칼춤", "전기자석파");
    check("8.3 A3 R2-h: 봉인 중 볼주머니는 치료만 되고 회복 없음", r.nextState.a.itemConsumed === true && !r.nextState.a.status.condition && r.nextState.a.currentHp === Math.floor(st.a.maxHp / 2), `소비=${r.nextState.a.itemConsumed} 상태=${r.nextState.a.status.condition} HP=${r.nextState.a.currentHp}/${Math.floor(st.a.maxHp / 2)}`);
  }
  // R2-i 봉인 중 저수: 물 기술은 무효화, 회복은 없다 (대조군: 봉인 없으면 회복)
  {
    const mkW = () => {
      const st = mk(["칼춤"], null, "저수", ["하이드로펌프"]);
      st.a.currentHp = Math.floor(st.a.maxHp / 2);
      return st;
    };
    const st = mkW();
    block(st.a);
    const r = play(st, "칼춤", "하이드로펌프");
    const rc = play(mkW(), "칼춤", "하이드로펌프");
    check("8.3 A3 R2-i: 봉인 중 저수는 무효화만, 회복 없음", rc.nextState.a.currentHp > Math.floor(rc.nextState.a.maxHp / 2) && r.nextState.a.currentHp === Math.floor(st.a.maxHp / 2), `봉인=${r.nextState.a.currentHp} 대조=${rc.nextState.a.currentHp}`);
  }
  // R2-j 봉인 중 되새김질: 발동하되 회복 0, 대기 소멸
  {
    const st = mk(["칼춤"]);
    st.a.currentHp = Math.floor(st.a.maxHp / 2);
    st.a.cudChewBerryId = "자뭉열매";
    st.a.cudChewTurnsLeft = 1;
    block(st.a);
    const r = play(st, "칼춤", "칼춤");
    check("8.3 A3 R2-j: 봉인 중 되새김질은 회복 0, 대기 소멸", r.nextState.a.currentHp === Math.floor(st.a.maxHp / 2) && r.nextState.a.cudChewBerryId === undefined, `HP=${r.nextState.a.currentHp}/${Math.floor(st.a.maxHp / 2)} 대기=${r.nextState.a.cudChewBerryId}`);
  }
  // R2-n 봉인 해제 턴 = 되새김질 턴: 해제(④)가 먼저라 되새김질이 회복한다
  {
    const st = mk(["칼춤"]);
    st.a.currentHp = Math.floor(st.a.maxHp / 2);
    st.a.cudChewBerryId = "자뭉열매";
    st.a.cudChewTurnsLeft = 1;
    block(st.a, 1);
    const r = play(st, "칼춤", "칼춤");
    check("8.3 A3 R2-n: 봉인이 풀리는 턴의 되새김질은 회복한다", r.nextState.a.currentHp > Math.floor(st.a.maxHp / 2) && !blocked(r.nextState.a), `HP=${r.nextState.a.currentHp}/${Math.floor(st.a.maxHp / 2)}`);
  }
  // R2-o 재생력은 봉인 중에도 교체 시 회복한다 / R2-r 봉인은 교체하면 풀린다 (회귀)
  {
    const st = battle([mon("잠만보", ["칼춤"], "재생력", null, big), mon("팬텀", ["칼춤"], null, null, big)], [mon("잠만보", ["칼춤"], null, null, big)]);
    st.a.currentHp = Math.floor(st.a.maxHp / 3);
    const before = st.a.currentHp;
    block(st.a);
    const r = rt.runTurn(st, { kind: "switch", toIndex: 1 }, move("칼춤"), rng);
    const out = r.nextState.sideA.party[0];
    check("8.3 A3 R2-o: 봉인 중 재생력은 교체 시 회복(회귀)", out.currentHp > before, `${before} → ${out.currentHp}`);
    check("8.3 A3 R2-r: 교체하면 회복봉인이 풀린다(회귀)", !out.volatile.active.healBlock, `healBlock=${!!out.volatile.active.healBlock}`);
  }
  // R2-p 봉인된 쪽이 볼주머니(기술)·벌레먹기: 열매는 소비되고 부가 효과는 유지, 회복 0
  {
    const st = mk(["볼가득넣기"], "자뭉열매");
    st.a.currentHp = halfHp(st.a);
    st.a.stages = { ...st.a.stages, spe: 6 }; // a가 먼저 움직여야 상대 행동 직후의 자동 발동이 열매를 먼저 먹지 않는다
    block(st.a);
    const r = play(st, "볼가득넣기", "칼춤");
    check("8.3 A3 R2-p: 봉인 중 볼가득넣기는 열매 소비·방어 +2·회복 0", r.nextState.a.itemConsumed === true && r.nextState.a.stages.def === 2 && r.nextState.a.currentHp === halfHp(st.a), `소비=${r.nextState.a.itemConsumed} 방어=${r.nextState.a.stages.def} HP=${r.nextState.a.currentHp}/${halfHp(st.a)}`);
    const st2 = mk(["벌레먹기"], null, null, ["칼춤"], "자뭉열매");
    st2.a.currentHp = halfHp(st2.a);
    block(st2.a);
    const r2 = play(st2, "벌레먹기", "칼춤");
    check("8.3 A3 R2-p: 봉인 중 벌레먹기는 상대 열매 제거·회복 0", !r2.nextState.b.currentItemId && r2.nextState.a.currentHp === halfHp(st2.a), `상대도구=${r2.nextState.b.currentItemId} HP=${r2.nextState.a.currentHp}/${halfHp(st2.a)}`);
  }
  // ── AI(R2-k/l/m): 봉인 기술은 맞은 뒤 상대에게 휘발성이 걸린 파생 state로 재평가한다 ──
  {
    // 상대는 덜 단단하게(HP 투자 적게) 해 처치 턴이 유한하게 나오게 한다. 공격 측은 특공이 높은 팬텀(사이코노이즈·에어슬래시 모두 특수 75)
    const opts = (aSpecies, aMoves, bMoves, bItem, ...setups) => {
      const st = battle([mon(aSpecies, aMoves, null, null, big)], [mon("잠만보", bMoves, null, bItem, pts({ hp: 2 }))]);
      for (const setup of setups) setup(st);
      return ev.evaluateOptions(st, "a");
    };
    const hk = (o, id) => opt(o, id).hitsToKill.expected;
    const blockedFor = (turns) => (st) => {
      st.b.volatile = vol.inflictVolatile(st.b.volatile, "healBlock", () => 0.5);
      st.b.volatile = { ...st.b.volatile, active: { ...st.b.volatile.active, healBlock: { ...st.b.volatile.active.healBlock, turnsRemaining: turns } } };
    };
    const halfHpB = (st) => {
      st.b.currentHp = Math.floor(st.b.maxHp * 0.5);
    };
    const psy = (bMoves, bItem, ...setups) => opts("팬텀", ["사이코노이즈", "에어슬래시"], bMoves, bItem, ...setups);
    // R2-k 에어슬래시(같은 위력의 비봉인 특수기) 대비 사이코노이즈의 이득이, 회복에 의존하는 상대(먹다남은음식·회복 기술 보유)일수록 커진다
    const gain = (o) => hk(o, "에어슬래시") / hk(o, "사이코노이즈");
    const plain = gain(psy(["칼춤"], null, halfHpB));
    const healMove = gain(psy(["달빛", "칼춤"], null, halfHpB));
    const leftovers = psy(["칼춤"], "먹다남은음식");
    check(
      "8.3 A3 R2-k: AI 사이코노이즈 — 회복 기술·먹다남은음식에 의존하는 상대일수록 봉인 기술의 이득이 커진다",
      healMove > plain + 0.1 && Number.isFinite(hk(leftovers, "사이코노이즈")) && gain(leftovers) > gain(psy(["칼춤"], null)) + 0.1,
      `회복기술 ${healMove.toFixed(3)} vs ${plain.toFixed(3)} · 먹다남은음식 사이코노이즈=${hk(leftovers, "사이코노이즈").toFixed(2)} 에어슬래시=${hk(leftovers, "에어슬래시")}`,
    );
    // R2-m 이미 봉인된 대상: 남은 봉인 턴을 그대로 쓰고(새로 2턴으로 갱신하지 않음) 회복 기술은 위협에서 이미 빠져 있다
    const left2 = hk(psy(["칼춤"], "먹다남은음식", blockedFor(2)), "사이코노이즈");
    const left1 = hk(psy(["칼춤"], "먹다남은음식", blockedFor(1)), "사이코노이즈");
    const newlyBlocked = hk(leftovers, "사이코노이즈");
    const healBlockedAlready = hk(psy(["달빛", "칼춤"], null, halfHpB, blockedFor(2)), "사이코노이즈");
    const noHeal = hk(psy(["칼춤"], null, halfHpB), "사이코노이즈");
    check(
      "8.3 A3 R2-m: AI — 이미 봉인된 대상은 남은 턴을 그대로 쓰고 추가 가치가 없다",
      Math.abs(left2 - newlyBlocked) < 1e-9 && left1 > newlyBlocked + 1 && Math.abs(healBlockedAlready - noHeal) < 1e-9,
      `봉인(2)=${left2.toFixed(2)} 새로 거는 값=${newlyBlocked.toFixed(2)} 봉인(1)=${left1.toFixed(2)} · 봉인됨+달빛=${healBlockedAlready.toFixed(2)} 달빛없음=${noHeal.toFixed(2)}`,
    );
    // R2-l 지옥찌르기: 소리 기술을 가진 상대에게는 같은 분류·위력의 비봉인 기술(깨물어부수기)보다 맞은 뒤 내가 더 오래 버틴다
    const survive = (bMoves) => {
      const o = opts("잠만보", ["지옥찌르기", "깨물어부수기"], bMoves, null);
      return [opt(o, "지옥찌르기").hitsToBeKilled.expected, opt(o, "깨물어부수기").hitsToBeKilled.expected];
    };
    const [soundHell, soundCtl] = survive(["하이퍼보이스"]);
    const [plainHell, plainCtl] = survive(["누르기"]);
    check("8.3 A3 R2-l: AI 지옥찌르기 — 소리 기술 보유 상대에게만 이득", soundHell > soundCtl && Math.abs(plainHell - plainCtl) < 1e-9, `소리상대 ${soundHell}/${soundCtl} 일반상대 ${plainHell}/${plainCtl}`);
  }
}
