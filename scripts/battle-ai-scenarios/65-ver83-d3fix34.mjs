// 8.3 D3-fix-34 (E6-01) 턴 종료 효과를 한 목록으로 정렬한다 — Showdown `fieldEvent('Residual')`: order → 스피드(residual 직전, 트릭룸 반전) → subOrder, 동속은 (order, sub) 묶음마다 난수.
//  엔진은 "단계 → 포켓몬 a→b 고정"(④·⑤는 한 포켓몬 효과를 끝낸 뒤 다음 포켓몬)이라 로그 순서와, 효과 사이에서 HP가 오가는 승패가 Showdown과 달랐다.
//  전멸 판정은 핸들러마다(PR #533) — 단 날씨(order 1)·멸망의노래(24)는 같은 order 그룹이 끝난 뒤 한 번(`deferWipe`), 둘 다 쓰러지면 마지막에 쓰러진 쪽(느린 쪽) 승.
// 설계 `8.3-D3-fix34-턴종료정렬설계.md`(검수 반영·확정) §6.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const vol = await server.ssrLoadModule("/src/lib/volatileConditions.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const FAST = "피죤투", SLOW = "잠만보"; // 모래바람 면역 없음, 스피드 101 ↔ 30
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  const lcg = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
  const turn = (st, aMove = IDLE, bMove = IDLE, rng = () => 0.5) => { const out = rt.runTurn(st, act(aMove), act(bMove), rng); return { out, res: out.result ?? out.partialResult }; };
  const put = (f, ...ids) => { for (const id of ids) f.volatile = vol.inflictVolatile(f.volatile, id, () => 0.5); };
  const poison = (f) => { f.status = { condition: "poison", turnsElapsed: 1 }; };
  const burn = (f) => { f.status = { condition: "burn", turnsElapsed: 1 }; };
  const hurt = (f, n = 30) => { f.currentHp = f.maxHp - n; };
  // 턴 종료 로그 한 줄의 종류 — `<actor>:<kind>` 순서열로 비교한다
  const kind = (e) =>
    e.itemHeal ? "left" : e.fieldHeal ? "grass" : e.sandstormDamage ? "sand"
    : e.leechSeedDamage !== undefined ? "seed" : e.leechSeedHealAmount ? "seedHeal"
    : e.statusCondition ? (e.statusCondition === "burn" ? "brn" : "psn")
    : e.perishFainted ? "perishDead" : e.perishCount !== undefined ? "perish"
    : e.futureSightMoveName ? "fs" : e.wishHeal || e.wishNoHeal ? "wish" : e.regenSource ?? "?";
  const seq = (res) => res.endOfTurn.map((e) => `${e.actor}:${kind(e)}`).join(" ");

  // ── 1·2 스피드순·order 우선 ──
  const leftoversPoison = (aId, bId, { trickRoom = false } = {}) => {
    const st = battle([mon(aId, [IDLE], null, "먹다남은음식")], [mon(bId, [IDLE], null, "먹다남은음식")]);
    hurt(st.a); hurt(st.b); poison(st.a); poison(st.b);
    if (trickRoom) st.trickRoomTurnsRemaining = 5;
    return seq(turn(st).res);
  };
  guard("D3-fix34 1 먹다남은음식(5)·독(9): 두 포켓몬의 같은 order 효과가 스피드순으로 묶인다 — a 빠름 / b 빠름", () => {
    const a = leftoversPoison(FAST, SLOW), b = leftoversPoison(SLOW, FAST);
    return a === "a:left b:left a:psn b:psn" && b === "b:left a:left b:psn a:psn" ? true : json({ a, b });
  });
  guard("D3-fix34 2 트릭룸이면 느린 쪽이 먼저", () => {
    const got = leftoversPoison(FAST, SLOW, { trickRoom: true });
    return got === "b:left a:left b:psn a:psn" ? true : got;
  });

  // ── 3 상호 씨뿌리기(사례 A-1): b(빠름)의 씨뿌리기가 먼저라 a가 흡수분을 회복한 뒤 자기 피해를 받아 생존 ──
  guard("D3-fix34 3 상호 씨뿌리기: a(느림, HP < 최대/8)가 b의 씨뿌리기 흡수로 회복한 뒤 자기 씨뿌리기 피해를 받아 생존(현행은 a 먼저 기절)", () => {
    const st = battle([mon(SLOW, [IDLE])], [mon(FAST, [IDLE])]);
    put(st.a, "leechSeed"); put(st.b, "leechSeed");
    const aDmg = Math.floor(st.a.maxHp / 8), bDmg = Math.floor(st.b.maxHp / 8);
    st.a.currentHp = aDmg - 3;
    const { out, res } = turn(st);
    const want = (aDmg - 3) + bDmg - aDmg;
    return out.nextState.a.currentHp === want && want > 0 && !res.winner ? true : json({ hp: out.nextState.a.currentHp, want, winner: res.winner });
  });

  // ── 4 서로 다른 order 사망(사례 B) ──
  guard("D3-fix34 4 a 화상(10)·b 독(9), 둘 다 HP 1, 예비 없음: 독이 먼저라 b가 쓰러져 a 승, a의 화상은 처리되지 않는다(HP 1) — 스피드와 무관", () => {
    const bad = [];
    for (const [aId, bId] of [[FAST, SLOW], [SLOW, FAST]]) {
      const st = battle([mon(aId, [IDLE])], [mon(bId, [IDLE])]);
      st.a.currentHp = 1; st.b.currentHp = 1; burn(st.a); poison(st.b);
      const { out, res } = turn(st);
      if (res.winner !== "a" || out.nextState.a.currentHp !== 1) bad.push(`${aId}/${bId}: ${res.winner} aHP=${out.nextState.a.currentHp}`);
    }
    return bad.length === 0 ? true : json(bad);
  });

  // ── 5 같은 order 동시 사망(사례 C, PR #533 한계) ──
  guard("D3-fix34 5 둘 다 독 HP 1, 예비 없음: 빠른 쪽이 먼저 쓰러져 느린 쪽 승, 느린 쪽의 독은 처리되지 않는다(a 빠름 → b 승 / a 느림 → a 승)", () => {
    const run = (aId, bId) => {
      const st = battle([mon(aId, [IDLE])], [mon(bId, [IDLE])]);
      st.a.currentHp = 1; st.b.currentHp = 1; poison(st.a); poison(st.b);
      const { out, res } = turn(st);
      return { w: res.winner, aHp: out.nextState.a.currentHp, bHp: out.nextState.b.currentHp };
    };
    const fast = run(FAST, SLOW), slow = run(SLOW, FAST);
    return fast.w === "b" && fast.bHp === 1 && slow.w === "a" && slow.aHp === 1 ? true : json({ fast, slow });
  });

  // ── 6 스피드는 residual 직전 값 ──
  guard("D3-fix34 6 같은 종 둘: b가 이번 턴 고속이동으로 빨라지면 그 값으로 순서가 정해진다(턴 시작은 동속, 난수 0.9에도 b 먼저)", () => {
    const st = battle([mon(SLOW, [IDLE], null, "먹다남은음식")], [mon(SLOW, ["고속이동"], null, "먹다남은음식")]);
    hurt(st.a); hurt(st.b);
    const { res } = turn(st, IDLE, "고속이동", () => 0.9);
    const got = seq(res);
    return got === "b:left a:left" ? true : got;
  });

  // ── 7 날씨(order 1)는 포켓몬 단위 스피드순, 먹다남은음식(5)보다 앞 ──
  guard("D3-fix34 7 모래바람 피해(1)는 먹다남은음식(5)보다 앞, 빠른 포켓몬부터 — a 빠름 / b 빠름", () => {
    const run = (aId, bId) => {
      const st = battle([mon(aId, [IDLE], null, "먹다남은음식")], [mon(bId, [IDLE], null, "먹다남은음식")]);
      hurt(st.a); hurt(st.b); st.weather = "모래바람"; st.weatherTurnsRemaining = 5;
      return seq(turn(st).res);
    };
    const a = run(FAST, SLOW), b = run(SLOW, FAST);
    return a === "a:sand b:sand a:left b:left" && b === "b:sand a:sand b:left a:left" ? true : json({ a, b });
  });

  // ── 8 멸망의노래 동시 기절(F-4 일반화) ──
  guard("D3-fix34 8 멸망의노래 동시 0(예비 없음): 둘 다 쓰러지고(기절 줄 둘) 느린 쪽 승 — a 빠름 → b 승 / a 느림 → a 승. 예비가 있으면 둘 다 쓰러지고 승패 없이 양쪽 강제 교체", () => {
    const run = (aId, bId, reserve) => {
      const st = battle(reserve ? [mon(aId, [IDLE]), mon("팬텀", [IDLE])] : [mon(aId, [IDLE])], reserve ? [mon(bId, [IDLE]), mon("팬텀", [IDLE])] : [mon(bId, [IDLE])]);
      st.a.perishCount = 0; st.b.perishCount = 0;
      const { out, res } = turn(st);
      return { w: res.winner, dead: res.endOfTurn.filter((e) => e.perishFainted).length, fs: out.forcedSwitch };
    };
    const f = run(FAST, SLOW, false), s = run(SLOW, FAST, false), r = run(FAST, SLOW, true);
    return f.w === "b" && f.dead === 2 && s.w === "a" && s.dead === 2 && !r.w && r.dead === 2 && r.fs?.a && r.fs?.b ? true : json({ f, s, r });
  });

  // ── 9 동속 묶음별 독립 난수(Q1 (가')) ──
  guard("D3-fix34 9 완전 동속: 먹다남은음식(5/4) 순서와 독(9) 순서가 각각 따로 정해진다(200시드에서 네 조합 모두 나옴) · 항상 같은 order끼리 묶임 · 스피드가 다르면 시드와 무관하게 고정", () => {
    const combos = new Set();
    for (let seed = 1; seed <= 200; seed++) {
      const st = battle([mon(SLOW, [IDLE], null, "먹다남은음식")], [mon(SLOW, [IDLE], null, "먹다남은음식")]);
      hurt(st.a); hurt(st.b); poison(st.a); poison(st.b);
      const got = seq(turn(st, IDLE, IDLE, lcg(seed)).res).split(" ");
      if (got.length !== 4 || got[0].slice(2) !== "left" || got[1].slice(2) !== "left" || got[2].slice(2) !== "psn" || got[3].slice(2) !== "psn") return `묶음 깨짐 seed ${seed}: ${got.join(" ")}`;
      combos.add(got[0][0] + got[2][0]);
    }
    if (combos.size !== 4) return `조합 ${[...combos].sort().join(",")}`;
    for (let seed = 1; seed <= 200; seed++) {
      const st = battle([mon(FAST, [IDLE], null, "먹다남은음식")], [mon(SLOW, [IDLE], null, "먹다남은음식")]);
      hurt(st.a); hurt(st.b); poison(st.a); poison(st.b);
      const got = seq(turn(st, IDLE, IDLE, lcg(seed)).res);
      if (got !== "a:left b:left a:psn b:psn") return `스피드가 다른데 시드 ${seed}에서 ${got}`;
    }
    return true;
  });
  guard("D3-fix34 9b 그래스필드 회복(5/2) 둘 → 먹다남은음식(5/4) 둘: 같은 order 안에서 sub로 교차(a·b 그래스필드가 먼저 끝난 뒤 먹다남은음식)", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const st = battle([mon(SLOW, [IDLE], null, "먹다남은음식")], [mon(SLOW, [IDLE], null, "먹다남은음식")]);
      hurt(st.a); hurt(st.b); st.field = "그래스필드"; st.fieldTurnsRemaining = 5;
      const got = seq(turn(st, IDLE, IDLE, lcg(seed)).res).split(" ").map((s) => s.slice(2)).join(" ");
      if (got !== "grass grass left left") return `seed ${seed}: ${got}`;
    }
    return true;
  });

  // ── 10 자리 효과는 자리 주인 스피드순 ──
  guard("D3-fix34 10 미래예지가 양쪽에 대기: 자리 주인의 스피드순(빠른 쪽 자리 먼저), 별도 난수 없이 시드와 무관하게 같은 순서", () => {
    const run = (aId, bId, seed) => {
      const st = battle([mon(aId, [IDLE])], [mon(bId, [IDLE])]);
      const fsMove = data.getMove("미래예지");
      st.sideA.futureSight = { turnsRemaining: 1, move: fsMove, sourceIndex: 0 };
      st.sideB.futureSight = { turnsRemaining: 1, move: fsMove, sourceIndex: 0 };
      return seq(turn(st, IDLE, IDLE, lcg(seed)).res);
    };
    const bad = [];
    for (let seed = 1; seed <= 30; seed++) {
      const a = run(FAST, SLOW, seed), b = run(SLOW, FAST, seed);
      if (a !== "a:fs b:fs" || b !== "b:fs a:fs") bad.push(`${seed}:${a}|${b}`);
      if (bad.length > 2) break;
    }
    return bad.length === 0 ? true : json(bad);
  });

  // ── 11·12 같은 포켓몬 안 순서 보존·아쿠아링/뿌리박기 별개 줄 ──
  guard("D3-fix34 11 한 포켓몬 안 순서: 먹다남은음식(5/4) → 아쿠아링(6) → 뿌리박기(7) → 씨뿌리기(8) → 독(9), 아쿠아링·뿌리박기는 각각 줄 하나", () => {
    const st = battle([mon(SLOW, [IDLE], null, "먹다남은음식")], [mon(FAST, [IDLE])]);
    hurt(st.a, 60); hurt(st.b, 60); put(st.a, "aquaRing", "ingrain", "leechSeed"); poison(st.a); // b도 깎아 둬야 씨뿌리기 흡수 회복 줄이 남는다
    const got = seq(turn(st).res);
    return got === "a:left a:aquaRing a:ingrain a:seed b:seedHeal a:psn" ? true : got;
  });

  // ── 13 씨뿌리기 원천이 독으로 쓰러질 처지(사례 A-2) ──
  guard("D3-fix34 13 a(예비 있음)가 독·HP 1이고 b가 a의 씨앗 상태: 씨뿌리기(8) 흡수가 독(9)보다 먼저라 a 생존·b는 피해를 입는다(현행: a 기절·b 씨뿌리기 불발)", () => {
    const st = battle([mon(SLOW, [IDLE]), mon("팬텀", [IDLE])], [mon(FAST, [IDLE])]);
    put(st.b, "leechSeed"); st.b.maxHp = 800; st.b.currentHp = 800;
    st.a.currentHp = 1; poison(st.a);
    const poisonDmg = Math.floor(st.a.maxHp / 8), heal = Math.floor(800 / 8);
    const { out } = turn(st);
    const want = 1 + heal - poisonDmg;
    return out.nextState.a.currentHp === want && want > 0 && out.nextState.b.currentHp === 800 - heal ? true : json({ aHp: out.nextState.a.currentHp, want, bHp: out.nextState.b.currentHp });
  });

  // ── 14 모래바람 동시 기절(deferWipe order 1) ──
  guard("D3-fix34 14 모래바람으로 둘 다 쓰러질 처지(예비 없음, HP 1): 둘 다 기절 줄이 남고 느린 쪽 승 — a 빠름 → b 승 / a 느림 → a 승. 한쪽만 면역이면(한카리아스) 그쪽 승", () => {
    const run = (aId, bId) => {
      const st = battle([mon(aId, [IDLE])], [mon(bId, [IDLE])]);
      st.a.currentHp = 1; st.b.currentHp = 1; st.weather = "모래바람"; st.weatherTurnsRemaining = 5;
      const { res } = turn(st);
      return { w: res.winner, sand: res.endOfTurn.filter((e) => e.sandstormDamage && e.fainted).length };
    };
    const f = run(FAST, SLOW), s = run(SLOW, FAST), imm = run("한카리아스", SLOW);
    return f.w === "b" && f.sand === 2 && s.w === "a" && s.sand === 2 && imm.w === "a" && imm.sand === 1 ? true : json({ f, s, imm });
  });
}
