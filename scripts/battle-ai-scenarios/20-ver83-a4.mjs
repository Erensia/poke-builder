// 8.3 A4 미래예지(R3, Showdown 일치): 적중 시점에 정상 피격 파이프라인으로 계산한다 — 사용자 능력치·랭크는 적중 시점(교체되면 초기화),
// 대타가 대신 맞고, 명중·은신·급소·방어(무시)·버티기·기합의띠·옹골참을 일반 공격처럼 거친다. 사용자가 필드에 없으면 특성·도구 미적용,
// 생명의구슬 반동은 빗나감·무효에도 생기고, 조개껍질방울·길동무·저주받은바디는 꺼지며, 자기과신류는 필드에 있을 때 발동한다.
// 설계 `8.3-A4-미래예지설계.md` §7. 예약은 `side.futureSight = { turnsRemaining, move, sourceIndex }`(사용자 = 상대 편 party[sourceIndex]).
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const fsMove = data.getMove("미래예지");
  const mv = (x) => (typeof x === "string" ? { kind: "move", move: data.getMove(x) } : x);
  const safe = (fn) => { try { return fn(); } catch { return null; } };
  const play = (st, a = "칼춤", b = "칼춤", rng = () => 0.5) => safe(() => rt.runTurn(st, mv(a), mv(b), rng));
  const hitOf = (r) => r?.result.endOfTurn.find((e) => e.futureSightMoveName);
  const dmg = (r) => hitOf(r)?.damage ?? -1;
  const recoilOf = (r) => r?.result.endOfTurn.find((e) => e.actor === "a" && e.itemRecoilItemName);
  const sw = (i) => ({ kind: "switch", toIndex: i });
  const strong = pts({ spa: 32, hp: 2 });
  const bulky = pts({ hp: 32, spd: 32 });
  // a: 따라큐(미래예지 사용자) [+ 교대 잠만보], b: 잠만보(대상) [+ 교대 잠만보]. 예약 대기는 b 편(sideB)에 걸린다.
  const mk = ({ aItem = null, aAbility = null, bItem = null, bAbility = null, aBench = false, bBench = false } = {}) =>
    battle(
      [mon("따라큐", ["미래예지", "명상", "칼춤", "사이코키네시스"], aAbility, aItem, strong), ...(aBench ? [mon("잠만보", ["칼춤"], null, null, bulky)] : [])],
      [mon("잠만보", ["칼춤", "버티기", "방어", "공중날기", "길동무"], bAbility, bItem, bulky), ...(bBench ? [mon("잠만보", ["칼춤"], null, null, bulky)] : [])],
    );
  const queue = (st, turns = 1, src = 0) => { st.sideB.futureSight = { turnsRemaining: turns, move: fsMove, sourceIndex: src }; return st; };
  const frail = (f, hp = 5) => { f.maxHp = hp; f.currentHp = hp; }; // 한 방에 쓰러지게 (기합의띠는 풀피에서만 듣는다)
  const base = (opts) => dmg(play(queue(mk(opts))));

  // R3-a 쓴 뒤 사용자가 특공을 올리면 적중 시점 값으로 계산한다 (실제로 미래예지를 쓰고 3턴째 종료에 적중)
  {
    const three = (second) => {
      const t1 = play(mk(), "미래예지", "칼춤");
      const t2 = t1 && play(t1.nextState, second, "칼춤");
      return t2 && play(t2.nextState, "칼춤", "칼춤");
    };
    const boosted = dmg(three("명상")), flat = dmg(three("칼춤"));
    check("8.3 A4 R3-a: 쓴 뒤 특공 상승 → 적중 시점 능력치로 계산", flat > 0 && boosted > flat, `명상=${boosted} 무보정=${flat}`);
  }
  // R3-b 대타가 대신 맞는다 (본체 HP 불변), 대타 HP 이상이면 깨진다
  {
    const hit = (subHp) => { const st = queue(mk()); st.b.substituteHp = subHp; const hp0 = st.b.currentHp; return { r: play(st), hp0 }; };
    const big = hit(9999), br = hit(5);
    check("8.3 A4 R3-b: 대타가 대신 맞음(본체 HP 불변)", big.r?.nextState.b.currentHp === big.hp0 && hitOf(big.r)?.futureSightSubstitute === "hit" && big.r.nextState.b.substituteHp < 9999, `본체=${big.r?.nextState.b.currentHp}/${big.hp0} 대타=${big.r?.nextState.b.substituteHp} 로그=${hitOf(big.r)?.futureSightSubstitute}`);
    check("8.3 A4 R3-b2: 대타 HP 이하면 깨지고 본체는 그대로", br.r?.nextState.b.currentHp === br.hp0 && hitOf(br.r)?.futureSightSubstitute === "broke" && !br.r.nextState.b.substituteHp, `본체=${br.r?.nextState.b.currentHp}/${br.hp0} 로그=${hitOf(br.r)?.futureSightSubstitute}`);
  }
  // R3-c 적중 시점의 필드·스크린·대상 랭크가 반영된다
  {
    const ref = base();
    const field = dmg(play((() => { const st = queue(mk()); st.field = "사이코필드"; st.fieldTurnsRemaining = 5; return st; })()));
    const screen = dmg(play((() => { const st = queue(mk()); st.sideB.screens = { lightScreen: 5 }; return st; })()));
    const spd = dmg(play((() => { const st = queue(mk()); st.b.stages = { ...st.b.stages, spd: 2 }; return st; })()));
    check("8.3 A4 R3-c1: 사이코필드 → 데미지 증가", ref > 0 && field > ref * 1.2, `필드=${field} 기준=${ref}`);
    check("8.3 A4 R3-c2: 대상 편 빛의장막 → 반감", ref > 0 && screen > 0 && screen < ref * 0.6, `스크린=${screen} 기준=${ref}`);
    check("8.3 A4 R3-c3: 대상 특방 +2 → 데미지 감소", ref > 0 && spd > 0 && spd < ref * 0.6, `특방+2=${spd} 기준=${ref}`);
  }
  // R3-e1 사용자가 교체되면 랭크는 초기화, 특성·도구는 적용되지 않는다 (생명의구슬 배율·반동 없음)
  {
    const sent = (item, boost) => {
      const st = queue(mk({ aItem: item, aBench: true }));
      if (boost) st.a.stages = { ...st.a.stages, spa: 2 };
      return play(st, sw(1), "칼춤");
    };
    const plain = sent(null, false), geared = sent("생명의구슬", true);
    check("8.3 A4 R3-e1: 교체된 사용자 — 랭크 초기화, 도구 미적용", dmg(plain) > 0 && dmg(geared) === dmg(plain) && !recoilOf(geared) && geared?.nextState.sideA.party[0].currentHp === geared?.nextState.sideA.party[0].maxHp, `기본=${dmg(plain)} 도구·랭크=${dmg(geared)} 반동=${!!recoilOf(geared)}`);
  }
  // R3-e2 필드에 있는 사용자의 생명의구슬은 ×1.3 + 반동 줄
  {
    const plain = base(), orb = play(queue(mk({ aItem: "생명의구슬" })));
    const a = orb?.nextState.a;
    check("8.3 A4 R3-e2: 필드에 있는 사용자의 생명의구슬 → ×1.3 + 반동", plain > 0 && dmg(orb) > plain * 1.25 && dmg(orb) < plain * 1.35 && !!recoilOf(orb) && a?.currentHp === a?.maxHp - Math.floor(a.maxHp / 10), `배율=${(dmg(orb) / plain).toFixed(2)} 반동=${!!recoilOf(orb)} HP=${a?.currentHp}/${a?.maxHp}`);
  }
  // R3-e3 사용자가 기절한 채로(교대 슬롯) 적중해도 맞고 도구는 적용되지 않는다
  {
    const st = queue(mk({ aBench: true }), 1, 1);
    st.sideA.party[1].currentHp = 0;
    st.sideA.party[1].currentItemId = "생명의구슬";
    const r = play(st);
    check("8.3 A4 R3-e3: 기절한 사용자의 미래예지도 맞음, 도구 미적용", dmg(r) > 0 && !recoilOf(r), `데미지=${dmg(r)} 반동=${!!recoilOf(r)}`);
  }
  // R3-f 대기 중인 자리에 다시 쓰면 실패 (회귀)
  {
    const t1 = play(mk(), "미래예지", "칼춤");
    const again = t1 && play(t1.nextState, "미래예지", "칼춤");
    check("8.3 A4 R3-f: 이미 예약돼 있으면 실패", t1?.result.actions[0].futureSightSet === true && again?.result.actions[0].futureSightFailed === true);
  }
  // R3-g 적중 시점에 대상이 기절해 있으면 맞지 않는다 — 생명의구슬 반동도 없다 (회귀)
  {
    const st = queue(mk({ aItem: "생명의구슬", bBench: true }));
    st.b.currentHp = 1;
    const r = play(st, "사이코키네시스", "칼춤");
    check("8.3 A4 R3-g: 대상 기절 → 미래예지 불발, 반동 줄 없음", !!r && r.nextState.b.currentHp === 0 && !hitOf(r) && !recoilOf(r) && !r.nextState.sideB.futureSight, `미래예지줄=${!!hitOf(r)} 반동=${!!recoilOf(r)}`);
  }
  // R3-h 대상이 교체하면 그 자리의 새 포켓몬이 맞는다 (회귀)
  {
    const r = play(queue(mk({ bBench: true })), "칼춤", sw(1));
    const sb = r?.nextState.sideB;
    check("8.3 A4 R3-h: 교체한 대상 자리의 새 포켓몬이 맞음", dmg(r) > 0 && sb?.party[1].currentHp < sb?.party[1].maxHp && sb?.party[0].currentHp === sb?.party[0].maxHp, `데미지=${dmg(r)}`);
  }
  // R3-i 급소가 난다
  {
    const r = play(queue(mk()), "칼춤", "칼춤", () => 0);
    check("8.3 A4 R3-i: 급소 가능", !!hitOf(r)?.futureSightCritical, `데미지=${dmg(r)}`);
  }
  // R3-j 버티기는 적용된다(HP 1로 버팀) / R3-j2 방어는 무시한다
  {
    const st = queue(mk());
    st.b.currentHp = 5;
    const endure = play(st, "칼춤", "버티기");
    check("8.3 A4 R3-j: 버티기는 적용 — HP 1로 버팀", endure?.nextState.b.currentHp === 1, `HP=${endure?.nextState.b.currentHp}`);
    const guard = play(queue(mk()), "칼춤", "방어");
    check("8.3 A4 R3-j2: 방어는 무시하고 맞음", dmg(guard) > 0, `데미지=${dmg(guard)}`);
  }
  // R3-k 기합의띠(풀피)·옹골참(풀피)은 1 남기고 버틴다
  {
    const sash = queue(mk({ bItem: "기합의띠" })); frail(sash.b);
    const rs = play(sash);
    const stu = queue(mk({ bAbility: "옹골참" })); frail(stu.b);
    const ru = play(stu);
    check("8.3 A4 R3-k1: 기합의띠 → HP 1, 띠 소모", rs?.nextState.b.currentHp === 1 && !!rs.nextState.b.itemConsumed, `HP=${rs?.nextState.b.currentHp}`);
    check("8.3 A4 R3-k2: 옹골참 → HP 1", ru?.nextState.b.currentHp === 1, `HP=${ru?.nextState.b.currentHp}`);
  }
  // R3-l 타입 면역(악)
  {
    const st = queue(mk()); st.b.types = ["악"];
    const r = play(st);
    check("8.3 A4 R3-l: 타입 면역 → 데미지 0 + 효과 없음", hitOf(r)?.damage === 0 && !!hitOf(r)?.futureSightImmune, `데미지=${dmg(r)}`);
  }
  // R3-m 틈새포착은 사용자가 필드에 있을 때만 대타를 뚫는다
  {
    const run = (switched) => { const st = queue(mk({ aAbility: "틈새포착", aBench: switched })); st.b.substituteHp = 9999; const hp0 = st.b.currentHp; const r = play(st, switched ? sw(1) : "칼춤", "칼춤"); return { r, hp0 }; };
    const on = run(false), off = run(true);
    check("8.3 A4 R3-m1: 필드의 틈새포착 → 대타 관통(본체 피해)", on.r?.nextState.b.currentHp < on.hp0, `HP=${on.r?.nextState.b.currentHp}/${on.hp0}`);
    check("8.3 A4 R3-m2: 교체된 틈새포착 → 대타가 맞음", off.r?.nextState.b.currentHp === off.hp0 && off.r.nextState.b.substituteHp < 9999, `HP=${off.r?.nextState.b.currentHp}/${off.hp0}`);
  }
  // R3-n 명중 판정: 회피 +6에서 빗나감
  {
    const st = queue(mk()); st.b.accuracyStages = { ...st.b.accuracyStages, evasion: 6 };
    const r = play(st, "칼춤", "칼춤", () => 0.999);
    check("8.3 A4 R3-n: 회피 +6 → 빗나감", !!hitOf(r)?.futureSightMiss && hitOf(r)?.damage === 0, `miss=${hitOf(r)?.futureSightMiss}`);
  }
  // R3-o 무적 은신(공중날기 1턴째)에는 빗나간다
  {
    const r = play(queue(mk()), "칼춤", "공중날기");
    check("8.3 A4 R3-o: 공중날기 1턴째 → 빗나감", !!hitOf(r)?.futureSightMiss, `miss=${hitOf(r)?.futureSightMiss}`);
  }
  // R3-q 생명의구슬 반동은 무효·빗나감·대타 적중에도 생긴다
  {
    const imm = queue(mk({ aItem: "생명의구슬" })); imm.b.types = ["악"];
    const mis = queue(mk({ aItem: "생명의구슬" })); mis.b.accuracyStages = { ...mis.b.accuracyStages, evasion: 6 };
    const sub = queue(mk({ aItem: "생명의구슬" })); sub.b.substituteHp = 9999;
    const ri = play(imm), rm = play(mis, "칼춤", "칼춤", () => 0.999), rs = play(sub);
    check("8.3 A4 R3-q: 무효·빗나감·대타 적중에도 반동 줄", !!recoilOf(ri) && !!recoilOf(rm) && !!recoilOf(rs), `무효=${!!recoilOf(ri)} 빗나감=${!!recoilOf(rm)} 대타=${!!recoilOf(rs)}`);
  }
  // R3-r 틀깨기는 필드에 있어도 적용되지 않는다 (옹골참 풀피가 버틴다)
  {
    const st = queue(mk({ aAbility: "틀깨기", bAbility: "옹골참" })); frail(st.b);
    const r = play(st);
    check("8.3 A4 R3-r: 틀깨기 미적용 → 옹골참이 버팀", r?.nextState.b.currentHp === 1, `HP=${r?.nextState.b.currentHp}`);
  }
  // R3-s 저주받은바디·길동무는 미래예지에는 발동하지 않는다
  {
    const ctl = mk({ bAbility: "저주받은바디" });
    const c = play(ctl, "사이코키네시스", "칼춤", () => 0);
    const st = queue(mk({ bAbility: "저주받은바디" }));
    const r = play(st, "칼춤", "칼춤", () => 0);
    check("8.3 A4 R3-s1: 저주받은바디 — 정상 공격은 막지만(대조) 미래예지는 PP 불변", c?.nextState.a.remainingPp["사이코키네시스"] === 0 && r?.nextState.a.remainingPp["미래예지"] !== 0 && !!hitOf(r), `대조PP=${c?.nextState.a.remainingPp["사이코키네시스"]} 미래예지PP=${r?.nextState.a.remainingPp["미래예지"]}`);
    const dst = queue(mk({ bBench: true })); frail(dst.b);
    const rd = play(dst, "칼춤", "길동무");
    check("8.3 A4 R3-s2: 길동무 상태의 대상이 미래예지로 쓰러져도 사용자는 무사", rd?.nextState.b.currentHp === 0 && rd.nextState.sideA.party[0].currentHp > 0, `a=${rd?.nextState.sideA.party[0].currentHp} b=${rd?.nextState.b.currentHp}`);
  }
  // R3-u 조개껍질방울은 미래예지로는 회복하지 않는다
  {
    const st = queue(mk({ aItem: "조개껍질방울" }));
    st.a.currentHp = Math.floor(st.a.maxHp / 2);
    const half = st.a.currentHp;
    const r = play(st);
    check("8.3 A4 R3-u: 조개껍질방울 미래예지로 회복 없음", dmg(r) > 0 && r?.nextState.a.currentHp === half, `HP=${r?.nextState.a.currentHp}/${half}`);
  }
  // R3-v 내려갔다가 적중 전에 다시 나오면 필드에 있는 것 — 생명의구슬 배율·반동이 적용된다
  {
    const run = (item) => {
      const st = mk({ aItem: item, aBench: true });
      const t1 = play(st, "미래예지", "칼춤");
      const t2 = t1 && play(t1.nextState, sw(1), "칼춤");
      return t2 && play(t2.nextState, sw(0), "칼춤");
    };
    const plain = run(null), orb = run("생명의구슬");
    check("8.3 A4 R3-v: 재등장한 사용자는 필드에 있음 — 도구 배율·반동 적용", dmg(plain) > 0 && dmg(orb) > dmg(plain) * 1.25 && !!recoilOf(orb), `기본=${dmg(plain)} 구슬=${dmg(orb)} 반동=${!!recoilOf(orb)}`);
  }
  // R3-w 쓰러뜨린 뒤 발동하는 특성(자기과신)은 필드에 있을 때만
  {
    const run = (switched) => { const st = queue(mk({ aAbility: "자기과신", aBench: switched, bBench: true })); frail(st.b); return play(st, switched ? sw(1) : "명상", "칼춤"); }; // 대기 행동은 공격을 올리지 않는 명상
    const on = run(false), off = run(true);
    check("8.3 A4 R3-w: 필드의 자기과신 → 공격 +1 / 교체된 사용자는 미발동", on?.nextState.a.stages.atk === 1 && off?.nextState.sideA.party[0].stages.atk === 0 && off?.nextState.b.currentHp === 0, `필드=${on?.nextState.a.stages.atk} 교체=${off?.nextState.sideA.party[0].stages.atk}`);
  }
  // R3-p 양쪽 마지막 포켓몬이 같은 턴 종료에 쓰러져도(대상 기절 + 사용자 반동 기절) 오류 없이 승패가 정해진다
  {
    const st = queue(mk({ aItem: "생명의구슬" })); frail(st.b); st.a.currentHp = 1;
    const r = play(st);
    check("8.3 A4 R3-p: 대상 기절 + 사용자 반동 기절 → 오류 없이 승패 결정", !!r && r.result.winner !== undefined, `winner=${r?.result.winner}`);
  }
}
