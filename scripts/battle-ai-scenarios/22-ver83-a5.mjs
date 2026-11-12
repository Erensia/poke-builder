// 8.3 A5 방어류 정렬(R7, Showdown 일치): 버티기·패스트가드도 "이번 턴 마지막에 행동하면 실패"(실패 시 연속 횟수 0), 패스트가드는 연속 사용 굴림이 없고
// 성공하면 연속 횟수만 올리며, 길동무는 연속 횟수와 분리돼 "직전 성공 예약이 남아 있으면 100% 실패"한다. 행동하지 못한 턴에도 연속 횟수가 사라지고,
// 연속 횟수 상한은 6(확률 1/729). AI 성공 확률도 같다. 설계 `8.3-A5-방어류설계.md` §7, 검수 `8.3-A5-방어류설계-검수.md`.
export default async function ({ server, data, ev, mon, battle, pts, opt, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const st0 = await server.ssrLoadModule("/src/types/status.ts");
  const pm = await server.ssrLoadModule("/src/lib/battle/ai/protectMoves.ts");
  const mv = (x) => (typeof x === "string" ? { kind: "move", move: data.getMove(x) } : x);
  const sw = (i) => ({ kind: "switch", toIndex: i });
  const R = (v) => () => v; // 상수 난수: 0.01 → 모든 굴림 통과 / 0.99 → streak 0만 통과
  const run = (st, a, b, rng) => rt.runTurn(st, mv(a), mv(b), rng);
  const act = (r) => r.result.actions.find((x) => x.actor === "a");
  const MOVES = ["방어", "패스트가드", "버티기", "길동무", "칼춤"];
  // a: 킬가르도(방어류 보유, 예비 있음), b: 한카리아스(칼춤·방어, 더 빠름). 방어류 우선도(+3/+4)는 칼춤(0)보다 높아 a가 먼저 움직이고,
  // a가 방어(+4) 상대로 후공이 되려면 느린 a(slow)와 빠른 b의 방어(+4)를 맞붙인다.
  const fast = () => [mon("킬가르도", MOVES, null, null, pts({ hp: 32, spe: 32 })), mon("핫삼", ["칼춤"])];
  const slow = () => [mon("킬가르도", MOVES, null, null, pts({ hp: 32 })), mon("핫삼", ["칼춤"])];
  const foe = () => [mon("한카리아스", ["칼춤", "방어"], null, null, pts({ atk: 32, spe: 32 })), mon("핫삼", ["칼춤"])];
  const para = () => ({ condition: "paralysis", turnsElapsed: 1 });
  const sleep = () => ({ condition: "sleep", turnsElapsed: 0, sleepTurns: 5 });

  // ── 버티기: 마지막 행동이면 실패, 연속 횟수 0 (R7-d) ──
  {
    const r = run(battle(slow(), foe()), "버티기", "방어", R(0.99));
    const a = act(r);
    check("8.3 A5 R7-d1: 버티기를 후공으로 쓰면 실패(태세·연속 횟수 없음)", a.protectFailed === true && !r.nextState.a.activeProtect && r.nextState.a.protectStreak === 0, `failed=${a.protectFailed} active=${r.nextState.a.activeProtect?.effect} streak=${r.nextState.a.protectStreak}`);
    const first = run(battle(fast(), foe()), "버티기", "칼춤", R(0.99));
    check("8.3 A5 R7-d2a: 버티기를 선공으로 쓰면 성공(연속 횟수 1)", first.nextState.a.activeProtect?.effect === "endure" && first.nextState.a.protectStreak === 1, `active=${first.nextState.a.activeProtect?.effect} streak=${first.nextState.a.protectStreak}`);
    const swit = run(battle(fast(), foe()), "버티기", sw(1), R(0.99));
    check("8.3 A5 R7-d2b: 상대가 교체한 턴(내가 마지막)의 버티기는 실패", act(swit).protectFailed === true && swit.nextState.a.protectStreak === 0 && !swit.nextState.a.activeProtect, `failed=${act(swit).protectFailed} streak=${swit.nextState.a.protectStreak}`);
    const next = run(r.nextState, "방어", "칼춤", R(0.99));
    check("8.3 A5 R7-d3: 버티기 후공 실패 다음 턴 방어는 확정 성공(Showdown 실측)", next.nextState.a.activeProtect?.effect === "block" && next.nextState.a.protectStreak === 1, `active=${next.nextState.a.activeProtect?.effect} streak=${next.nextState.a.protectStreak}`);
  }

  // ── 패스트가드: 마지막 행동이면 실패 / 굴림 없음 / 성공하면 다음 방어류 1/3 (R7-c) ──
  {
    const late = run(battle(slow(), foe()), "패스트가드", "방어", R(0.99));
    check("8.3 A5 R7-c1: 패스트가드를 후공으로 쓰면 실패(연속 횟수 0)", act(late).protectFailed === true && late.nextState.a.protectStreak === 0 && !late.nextState.a.activeProtect, `failed=${act(late).protectFailed} streak=${late.nextState.a.protectStreak}`);
    const st = battle(fast(), foe());
    st.a.protectStreak = 2;
    const chain = run(st, "패스트가드", "칼춤", R(0.99));
    check("8.3 A5 R7-c2: 패스트가드는 연속 사용 굴림이 없다(streak 2·난수 0.99에도 성공, 연속 횟수 3)", chain.nextState.a.activeProtect?.effect === "blockPriority" && chain.nextState.a.protectStreak === 3, `active=${chain.nextState.a.activeProtect?.effect} streak=${chain.nextState.a.protectStreak}`);
    const t1 = run(battle(fast(), foe()), "패스트가드", "칼춤", R(0.99));
    const miss = run(t1.nextState, "방어", "칼춤", R(0.5));
    const hit = run(t1.nextState, "방어", "칼춤", R(0.2));
    check("8.3 A5 R7-c3: 패스트가드 성공 직후 방어는 1/3(난수 0.5 실패 · 0.2 성공)", act(miss).protectFailed === true && !miss.nextState.a.activeProtect && hit.nextState.a.activeProtect?.effect === "block" && hit.nextState.a.protectStreak === 2, `0.5→${miss.nextState.a.activeProtect?.effect ?? "실패"} 0.2→${hit.nextState.a.activeProtect?.effect}`);
    // R7-c4 연속 횟수 상한: Showdown stall counterMax 729 → 6연속 이후 확률은 1/729에서 멈춘다
    const edge = 1 / 729;
    for (const n of [6, 7]) {
      const lo = battle(fast(), foe()); lo.a.protectStreak = n;
      const hi = battle(fast(), foe()); hi.a.protectStreak = n;
      const ok = run(lo, "방어", "칼춤", R(edge - 1e-6));
      const ng = run(hi, "방어", "칼춤", R(edge + 1e-6));
      check(`8.3 A5 R7-c4: 연속 ${n}회 뒤 방어는 1/729(난수 경계 ∓ε에서 성공/실패)`, ok.nextState.a.protectStreak === n + 1 && !ng.nextState.a.activeProtect && ng.nextState.a.protectStreak === 0, `성공쪽 streak=${ok.nextState.a.protectStreak} 실패쪽 active=${ng.nextState.a.activeProtect?.effect}`);
    }
  }

  // ── 길동무: 직전 성공 예약이 남아 있으면 100% 실패, 방어류 카운터와 분리 (R7-a·b·f·g·h) ──
  {
    const t1 = run(battle(fast(), foe()), "길동무", "칼춤", R(0.01));
    check("8.3 A5 R7-a0: 길동무 성공은 연속 횟수를 올리지 않는다(예약만 켜진다)", act(t1).protectSucceeded === true && t1.nextState.a.destinyBondArmed === true && t1.nextState.a.protectStreak === 0, `armed=${t1.nextState.a.destinyBondArmed} streak=${t1.nextState.a.protectStreak}`);
    const t2 = run(t1.nextState, "길동무", "칼춤", R(0.01));
    check("8.3 A5 R7-a1: 길동무 성공 다음 턴 길동무는 100% 실패(난수 0.01에도), 예약도 풀린다", act(t2).protectFailed === true && !act(t2).protectSucceeded && !t2.nextState.a.destinyBondArmed, `failed=${act(t2).protectFailed} armed=${t2.nextState.a.destinyBondArmed}`);
    const t3 = run(t2.nextState, "길동무", "칼춤", R(0.01));
    check("8.3 A5 R7-f: 성공 → 실패 → 3턴째 길동무는 성공", act(t3).protectSucceeded === true && t3.nextState.a.destinyBondArmed === true, `succeeded=${act(t3).protectSucceeded}`);

    const other = run(run(t1.nextState, "칼춤", "칼춤", R(0.01)).nextState, "길동무", "칼춤", R(0.01));
    check("8.3 A5 R7-a2a: 길동무 성공 → 다른 기술 → 길동무는 성공", act(other).protectSucceeded === true, `succeeded=${act(other).protectSucceeded}`);
    const away = run(run(run(t1.nextState, sw(1), "칼춤", R(0.01)).nextState, sw(0), "칼춤", R(0.01)).nextState, "길동무", "칼춤", R(0.01));
    check("8.3 A5 R7-a2b: 길동무 성공 → 교체 → 재등장 후 길동무는 성공", act(away).protectSucceeded === true, `succeeded=${act(away).protectSucceeded}`);

    for (const [label, status] of [["마비", para], ["수면", sleep]]) {
      const hold = t1.nextState;
      hold.a.status = status();
      const blocked = run(hold, "길동무", "칼춤", R(0.01));
      blocked.nextState.a.status = { ...st0.NO_STATUS_CONDITION };
      const again = run(blocked.nextState, "길동무", "칼춤", R(0.01));
      check(`8.3 A5 R7-g(${label}): 길동무 성공 → 행동불능 턴 → 길동무는 성공(예약은 행동불능 턴에 풀림)`, !act(blocked).protectSucceeded && !blocked.nextState.a.destinyBondArmed && act(again).protectSucceeded === true, `행동불능턴 succeeded=${act(blocked).protectSucceeded} armed=${blocked.nextState.a.destinyBondArmed} 다음 succeeded=${act(again).protectSucceeded}`);
      t1.nextState.a.status = { ...st0.NO_STATUS_CONDITION };
    }

    const guard1 = run(battle(fast(), foe()), "방어", "칼춤", R(0.01));
    const bond = run(guard1.nextState, "길동무", "칼춤", R(0.5));
    check("8.3 A5 R7-b: 방어 성공 후 길동무는 방어 카운터의 영향을 받지 않는다(난수 0.5에도 성공, 연속 횟수 0)", act(bond).protectSucceeded === true && bond.nextState.a.protectStreak === 0, `succeeded=${act(bond).protectSucceeded} streak=${bond.nextState.a.protectStreak}`);
    const after = run(t1.nextState, "방어", "칼춤", R(0.99));
    check("8.3 A5 R7-b2: 길동무 다음 턴 방어는 확정 성공(Showdown 실측 — 방어류가 아닌 턴에 카운터 만료)", after.nextState.a.activeProtect?.effect === "block" && after.nextState.a.protectStreak === 1, `active=${after.nextState.a.activeProtect?.effect} streak=${after.nextState.a.protectStreak}`);
    const lateBond = run(battle(slow(), foe()), "길동무", "방어", R(0.99));
    check("8.3 A5 R7-h: 길동무는 후공이어도 성공(7.3 B2 회귀)", act(lateBond).protectSucceeded === true, `succeeded=${act(lateBond).protectSucceeded}`);
  }

  // ── 잠꼬대로 나온 길동무는 예약 판정에서 직접 사용과 구분된다 (Q19, R7-i) ──
  {
    const talker = () => [mon("킬가르도", ["길동무", "잠꼬대"], null, null, pts({ hp: 32, spe: 32 })), mon("핫삼", ["칼춤"])];
    const viaTalk = battle(talker(), foe());
    viaTalk.a.status = sleep();
    const t1 = run(viaTalk, "잠꼬대", "칼춤", R(0.01));
    check("8.3 A5 R7-i0: 잠꼬대로 길동무가 나온다(예약 켜짐)", act(t1).sleepTalkCalledMoveName === "길동무" && act(t1).protectSucceeded === true && t1.nextState.a.destinyBondArmed === true, `called=${act(t1).sleepTalkCalledMoveName} succeeded=${act(t1).protectSucceeded}`);
    t1.nextState.a.status = { ...st0.NO_STATUS_CONDITION };
    const direct = run(t1.nextState, "길동무", "칼춤", R(0.01));
    check("8.3 A5 R7-i1: 잠꼬대 길동무(성공) → 직접 길동무는 실패", act(direct).protectFailed === true && !act(direct).protectSucceeded, `failed=${act(direct).protectFailed}`);
    const first = run(battle(talker(), foe()), "길동무", "칼춤", R(0.01));
    first.nextState.a.status = sleep();
    const viaTalk2 = run(first.nextState, "잠꼬대", "칼춤", R(0.01));
    check("8.3 A5 R7-i2: 직접 길동무(성공) → 잠꼬대 길동무는 성공(호출 기술 앞의 beforeMove가 예약을 먼저 푼다)", act(viaTalk2).sleepTalkCalledMoveName === "길동무" && act(viaTalk2).protectSucceeded === true, `called=${act(viaTalk2).sleepTalkCalledMoveName} succeeded=${act(viaTalk2).protectSucceeded}`);
  }

  // ── 행동하지 못한 턴·교체 뒤에는 방어류 연속 횟수가 사라진다 (Q22, R7-j·k) ──
  {
    for (const [label, status] of [["마비", para], ["수면", sleep]]) {
      const t1 = run(battle(fast(), foe()), "방어", "칼춤", R(0.01));
      const held = t1.nextState;
      held.a.status = status();
      const blocked = run(held, "방어", "칼춤", R(0.01));
      blocked.nextState.a.status = { ...st0.NO_STATUS_CONDITION };
      const t3 = run(blocked.nextState, "방어", "칼춤", R(0.99));
      check(`8.3 A5 R7-j(${label}): 방어 성공 → 행동불능 턴 → 방어는 확정 성공(카운터 만료)`, blocked.nextState.a.protectStreak === 0 && t3.nextState.a.activeProtect?.effect === "block", `행동불능 후 streak=${blocked.nextState.a.protectStreak} 다음 active=${t3.nextState.a.activeProtect?.effect}`);
    }
    const t1 = run(battle(fast(), foe()), "방어", "칼춤", R(0.01));
    const back = run(run(t1.nextState, sw(1), "칼춤", R(0.01)).nextState, sw(0), "칼춤", R(0.01));
    const again = run(back.nextState, "방어", "칼춤", R(0.99));
    check("8.3 A5 R7-k: 방어 성공 → 교체 → 재등장 방어는 확정 성공(회귀)", again.nextState.a.activeProtect?.effect === "block", `active=${again.nextState.a.activeProtect?.effect}`);
  }

  // ── AI 성공 확률 (R7-e) ──
  {
    const bondChance = (armed) => {
      const st = battle([mon("팬텀", ["길동무", "섀도볼"], null, null, pts({ spe: 32 }))], [mon("마기라스", ["깨물어부수기"], null, null, pts({ atk: 32 }))]);
      if (armed) st.a.destinyBondArmed = true;
      return opt(ev.evaluateOptions(st, "a"), "길동무").support.protect.successChance;
    };
    check("8.3 A5 R7-e1: AI 길동무 성공 확률 — 예약이 남아 있으면 0, 아니면 1", bondChance(true) === 0 && bondChance(false) === 1, `예약=${bondChance(true)} 없음=${bondChance(false)}`);
    const chanceOf = (id, moves, streak) => {
      const st = battle([mon("잠만보", moves)], [mon("루카리오", ["신속", "칼춤"], null, null, pts({ atk: 32 }))]);
      st.a.protectStreak = streak;
      return opt(ev.evaluateOptions(st, "a"), id).support.protect.successChance;
    };
    check("8.3 A5 R7-e2: AI 패스트가드는 연속 사용 확률 없음(streak 2에도 1)", chanceOf("패스트가드", ["패스트가드", "누르기"], 2) === 1, `chance=${chanceOf("패스트가드", ["패스트가드", "누르기"], 2)}`);
    const cap6 = chanceOf("방어", ["방어", "누르기"], 6), cap8 = chanceOf("방어", ["방어", "누르기"], 8);
    check("8.3 A5 R7-e4: AI 방어 성공 확률 상한 — 연속 6·8회 모두 1/729", Math.abs(cap6 - 1 / 729) < 1e-12 && Math.abs(cap8 - 1 / 729) < 1e-12, `6=${cap6} 8=${cap8}`);
    const st = battle(slow(), foe());
    const sim = pm.simulateProtectTurn(st, "a", data.getMove("버티기"), data.getMove("방어"), undefined);
    check("8.3 A5 R7-e3: AI 시뮬레이션 — 후공 버티기는 엔진대로 실패(태세 없음)", !sim.a.activeProtect && sim.a.protectStreak === 0, `active=${sim.a.activeProtect?.effect} streak=${sim.a.protectStreak}`);
  }
}
