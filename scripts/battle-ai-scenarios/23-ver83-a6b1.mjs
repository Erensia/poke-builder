// 8.3 A6+B1 (R8, Showdown 일치): 킬가르도 배틀스위치 폼 변경이 "행동 불가 판정 뒤, 성공 판정 앞"에서 일어나 기술이 실패해도 바뀌고,
// 바뀌면 행동 로그에 stanceChange 이벤트를 남긴다. 메가진화는 TurnResult.megaEvolutions 구조화 필드로도 알린다.
// 설계 `8.3-A6B1-폼변경메가로그설계.md` §5, 검수 `8.3-A6B1-폼변경메가로그설계-검수.md`.
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const stMod = await server.ssrLoadModule("/src/lib/battle/state.ts");
  const mv = (x) => (typeof x === "string" ? { kind: "move", move: data.getMove(x) } : x);
  const R = (v) => () => v; // 0.01: 확률 굴림 전부 통과(마비 행동불능 등) / 0.99: 전부 실패
  const run = (st, a, b, rng = R(0.5)) => rt.runTurn(st, mv(a), mv(b), rng);
  const act = (r) => r.result.actions.find((x) => x.actor === "a");
  const kg = (moves) => [mon("킬가르도", moves, null, null, pts({ hp: 32, spe: 32 })), mon("핫삼", ["칼춤"])];
  const kgSlow = (moves) => [mon("킬가르도", moves, null, null, pts({ hp: 32 })), mon("핫삼", ["칼춤"])];
  const foe = (item = null) => [mon("한카리아스", ["칼춤", "방어"], null, item, pts({ hp: 32, def: 32, spd: 32, spe: 32 })), mon("핫삼", ["칼춤"])];
  const blade = (st) => { st.a.currentStanceForm = "blade"; return st; };
  const sleep = () => ({ condition: "sleep", turnsElapsed: 0, sleepTurns: 5 });
  const stance = (r) => act(r)?.stanceChange?.to;

  // ── R8-c·g: 공격 기술이면 블레이드 이벤트, 이미 블레이드면 이벤트 없음 ──
  {
    const r = run(battle(kg(["섀도볼", "킹실드", "칼춤"]), foe()), "섀도볼", "칼춤");
    check("8.3 A6 R8-c: 공격 기술을 쓰면 블레이드 이벤트(실드→블레이드)", stance(r) === "blade" && r.nextState.a.currentStanceForm === "blade", `to=${stance(r)} form=${r.nextState.a.currentStanceForm}`);
    const r2 = run(r.nextState, "섀도볼", "칼춤");
    check("8.3 A6 R8-g: 이미 블레이드면 공격을 이어 써도 이벤트 없음", act(r2) && stance(r2) === undefined && r2.nextState.a.currentStanceForm === "blade", `to=${stance(r2)}`);
  }

  // ── R8-d·e1·f: 킹실드는 실패해도 실드 복귀, 다른 변화기는 폼 유지 ──
  {
    const r = run(blade(battle(kg(["섀도볼", "킹실드", "칼춤"]), foe())), "킹실드", "칼춤");
    check("8.3 A6 R8-d: 블레이드에서 킹실드를 쓰면 실드 이벤트", stance(r) === "shield" && r.nextState.a.currentStanceForm === "shield", `to=${stance(r)}`);
    const late = run(blade(battle(kgSlow(["섀도볼", "킹실드", "칼춤"]), foe())), "킹실드", "방어", R(0.99));
    check("8.3 A6 R8-e1: 킹실드가 마지막 행동이라 실패해도 실드로 복귀", act(late).protectFailed === true && stance(late) === "shield", `failed=${act(late).protectFailed} to=${stance(late)}`);
    const dance = run(blade(battle(kg(["섀도볼", "킹실드", "칼춤"]), foe())), "칼춤", "칼춤");
    check("8.3 A6 R8-f: 킹실드 외 변화기는 폼 유지·이벤트 없음", stance(dance) === undefined && dance.nextState.a.currentStanceForm === "blade", `to=${stance(dance)}`);
  }

  // ── R8-a·h: 폴터가이스트가 사용 조건(상대 도구 없음)으로 실패해도 폼은 바뀐다 ──
  {
    const r = run(battle(kg(["폴터가이스트", "킹실드"]), foe()), "폴터가이스트", "칼춤");
    check("8.3 A6 R8-a: 폴터가이스트(상대 도구 없음) 실패에도 블레이드 이벤트", act(r).blockedReason === "usageCondition" && stance(r) === "blade" && r.nextState.a.currentStanceForm === "blade", `reason=${act(r).blockedReason} to=${stance(r)}`);
    const r2 = run(battle(kgSlow(["폴터가이스트", "킹실드"]), foe()), "폴터가이스트", "칼춤");
    check("8.3 A6 R8-h: 후공이어도 사용 조건 실패에 블레이드 이벤트", act(r2).blockedReason === "usageCondition" && stance(r2) === "blade", `reason=${act(r2).blockedReason} to=${stance(r2)}`);
    const ok = run(battle(kg(["폴터가이스트", "킹실드"]), foe("먹다남은음식")), "폴터가이스트", "칼춤");
    check("8.3 A6 R8-a 대조: 상대가 도구를 지니면 정상 사용 + 블레이드 이벤트", act(ok).blockedReason === undefined && stance(ok) === "blade", `to=${stance(ok)}`);
  }

  // ── R8-b: 행동 불가(마비·수면)이면 폼 불변 ──
  {
    const para = battle(kg(["섀도볼", "킹실드"]), foe());
    para.a.status = { condition: "paralysis", turnsElapsed: 1 };
    const r = run(para, "섀도볼", "칼춤", R(0.01));
    check("8.3 A6 R8-b1: 마비로 못 움직이면 폼 불변·이벤트 없음", act(r).blockedReason === "status" && stance(r) === undefined && r.nextState.a.currentStanceForm === "shield", `reason=${act(r).blockedReason} to=${stance(r)}`);
    const slp = battle(kg(["섀도볼", "킹실드"]), foe());
    slp.a.status = sleep();
    const r2 = run(slp, "섀도볼", "칼춤");
    check("8.3 A6 R8-b2: 수면으로 못 움직이면 폼 불변·이벤트 없음", act(r2).blockedReason === "status" && stance(r2) === undefined, `reason=${act(r2).blockedReason} to=${stance(r2)}`);
  }

  // ── R8-i·k: 반동 턴은 폼 유지·이벤트 없음, 차지 1턴째는 이벤트·2턴째는 없음 ──
  {
    const r1 = run(battle(kg(["파괴광선", "킹실드"]), foe()), "파괴광선", "칼춤");
    const alive = r1.nextState.b.currentHp > 0;
    const r2 = run(r1.nextState, "파괴광선", "칼춤");
    check("8.3 A6 R8-i: 파괴광선 뒤 반동 턴은 이벤트 없음·폼 블레이드 유지", alive && act(r2).blockedReason === "recharge" && stance(r2) === undefined && r2.nextState.a.currentStanceForm === "blade", `alive=${alive} reason=${act(r2).blockedReason} to=${stance(r2)}`);
    const c1 = run(battle(kg(["솔라블레이드", "킹실드"]), foe()), "솔라블레이드", "칼춤");
    const c2 = run(c1.nextState, "킹실드", "칼춤");
    check("8.3 A6 R8-k: 솔라블레이드 1턴째(차지)에 블레이드 이벤트, 2턴째는 이벤트 없음", stance(c1) === "blade" && act(c2).move.id === "솔라블레이드" && stance(c2) === undefined, `t1=${stance(c1)} t2move=${act(c2).move.id} t2=${stance(c2)}`);
  }

  // ── R8-l: 발버둥(PP 0)도 데미지 기술이라 블레이드 ──
  {
    const st = battle(kg(["섀도볼"]), foe());
    st.a.remainingPp = Object.fromEntries(Object.keys(st.a.remainingPp).map((k) => [k, 0]));
    const r = run(st, { kind: "move", move: stMod.STRUGGLE_MOVE }, "칼춤");
    check("8.3 A6 R8-l: 발버둥도 블레이드 이벤트", stance(r) === "blade", `move=${act(r).move.id} to=${stance(r)}`);
  }

  // ── R8-m·n: 수면 중 잠꼬대로 킹실드를 부르면 실드 복귀 / 수면 중 코골기는 성공 ──
  {
    const talk = blade(battle(kg(["잠꼬대", "킹실드"]), foe()));
    talk.a.status = sleep();
    const r = run(talk, "잠꼬대", "칼춤");
    check("8.3 A6 R8-m: 블레이드 + 수면 중 잠꼬대로 킹실드 호출 → 실드 이벤트", stance(r) === "shield" && r.nextState.a.currentStanceForm === "shield", `to=${stance(r)} form=${r.nextState.a.currentStanceForm}`);
    const snore = battle(kg(["코골기", "킹실드"]), foe());
    snore.a.status = sleep();
    const s = run(snore, "코골기", "칼춤");
    check("8.3 A6 R8-n: 수면 중 코골기는 성공하고 블레이드 이벤트", act(s).blockedReason === undefined && stance(s) === "blade", `reason=${act(s).blockedReason} to=${stance(s)}`);
  }

  // ── B1: 메가진화 구조화 필드 ──
  {
    const zard = () => [mon("리자몽", ["불대문자"], null, "리자몽나이트X"), mon("핫삼", ["칼춤"])];
    const turtle = () => [mon("거북왕", ["파도타기"], null, "거북왕나이트"), mon("핫삼", ["칼춤"])];
    const megaMove = (m) => ({ kind: "move", move: data.getMove(m), mega: true });
    const one = run(battle(zard(), foe()), megaMove("불대문자"), "칼춤");
    const e = one.result.megaEvolutions?.[0];
    check("8.3 B1-a: 메가진화한 턴 megaEvolutions에 {side, pokemonId, megaForm} 1건", one.result.megaEvolutions?.length === 1 && e.side === "a" && e.pokemonId === "리자몽" && e.megaForm === "리자몽-메가X", JSON.stringify(one.result.megaEvolutions));
    check("8.3 B1-a: 메가진화 문구(turnStartAnnouncements)는 그대로", one.result.turnStartAnnouncements.some((t) => t.includes("메가진화했다")), one.result.turnStartAnnouncements.join("|"));
    const both = run(battle(zard(), turtle()), megaMove("불대문자"), megaMove("파도타기"));
    check("8.3 B1-b: 양쪽 모두 메가진화하면 2건", both.result.megaEvolutions?.length === 2 && new Set(both.result.megaEvolutions.map((m) => m.side)).size === 2, JSON.stringify(both.result.megaEvolutions));
    const sw = run(battle(zard(), foe()), { kind: "switch", toIndex: 1 }, "칼춤");
    check("8.3 B1-c: 교체한 편은 메가진화하지 않아 목록에 없음", !sw.result.megaEvolutions?.length, JSON.stringify(sw.result.megaEvolutions));
    const none = run(battle(zard(), foe()), "불대문자", "칼춤");
    check("8.3 B1-d: 메가진화 없는 턴은 megaEvolutions가 비어 있거나 없음", !none.result.megaEvolutions?.length, JSON.stringify(none.result.megaEvolutions));
  }
}
