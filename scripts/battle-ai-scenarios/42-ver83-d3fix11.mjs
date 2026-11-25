// 8.3 D3-fix-11 스피드 정수 파이프라인(Showdown `getStat('spe')`): 랭크 floor → 보정 4096 체인(반내림) → 마비는 체인 뒤 floor(×50/100) (사용자 결정 "따라간다", 인게임 확인: 동속으로 갈린다).
// + E3-13 메가진화 순서·E3-16 양쪽 자발 교체 순서(Showdown getActionSpeed: 보정·랭크 반영, 트릭룸이면 먼저 행동하는 쪽부터, 동속은 무작위) + E3-14 시간벌기 + 선공 발동 양쪽 성공.
// 설계 `8.3-D3-fix11-스피드정수설계.md`(검수 `…-검수.md`). 참조 구현은 `05_D3-전수검수/자료/D3-검수자료/zz-e3-speed.mjs.txt`의 showdownSpeed를 그대로 옮겼다.
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const toi = await server.ssrLoadModule("/src/lib/battle/turnOrderInputs.ts");
  const bp = await server.ssrLoadModule("/src/lib/battlePower.ts");
  const me = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
  const aiSpeed = await server.ssrLoadModule("/src/lib/battle/ai/speed.ts");
  const json = JSON.stringify;
  const tr = Math.trunc;
  const M = (n) => data.getMove(n);
  const mv = (n) => ({ kind: "move", move: M(n) });
  const IDLE = "칼춤"; // 우선도 0 변화기
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };

  // ── 참조 구현(Showdown) ──
  const BT = [1, 1.5, 2, 2.5, 3, 3.5, 4];
  const sdModify = (v, m) => tr((tr(v * m) + 2047) / 4096);
  const sdChain = (mods) => mods.reduce((a, x) => (a * tr(x * 4096) + 2048) >> 12, 4096);
  const sd = (stat, stage, mods, par) => {
    let s = stage >= 0 ? Math.floor(stat * BT[stage]) : Math.floor(stat / BT[-stage]);
    if (mods.length) s = sdModify(s, sdChain(mods));
    if (par) s = Math.floor((s * 50) / 100);
    return s;
  };
  const eng = (stat, stage, mods, par) => bp.computeSpeedStat({ baseSpe: stat, stage, multipliers: mods, halvedByParalysis: par });
  const MODSETS = [
    { n: "없음", mods: [], par: false }, { n: "스카프", mods: [1.5], par: false }, { n: "철구", mods: [0.5], par: false }, { n: "순풍", mods: [2], par: false },
    { n: "날씨특성", mods: [2], par: false }, { n: "마비", mods: [], par: true }, { n: "스카프+순풍", mods: [1.5, 2], par: false },
    { n: "스카프+마비", mods: [1.5], par: true }, { n: "순풍+마비", mods: [2], par: true }, { n: "속보", mods: [1.5], par: false },
    { n: "속보+스카프", mods: [1.5, 1.5], par: false }, { n: "스카프+순풍+곡예", mods: [1.5, 2, 2], par: false },
  ];

  // ── 1~2. 순수 함수: 참조 구현과 전수 일치 + 규칙표 벡터 ──
  guard("D3-fix11 1 computeSpeedStat이 참조 구현과 일치: 스탯 60~200 × 랭크 −2~+2 × 보정 12종 전수", () => {
    for (let s = 60; s <= 200; s++) for (let g = -2; g <= 2; g++) for (const m of MODSETS) {
      const want = sd(s, g, m.mods, m.par), got = eng(s, g, m.mods, m.par);
      if (want !== got) return json({ s, g, m: m.n, want, got });
    }
    return true;
  });
  guard("D3-fix11 1-b 랭크 ±6 경계: 스탯 1~300 × 랭크 −6~+6 (보정 없음)도 참조 구현과 일치", () => {
    for (let s = 1; s <= 300; s++) for (let g = -6; g <= 6; g++) {
      const want = g >= 0 ? Math.floor(s * BT[g]) : Math.floor(s / BT[-g]);
      if (bp.applyRankStage(s, g) !== want) return json({ s, g, want, got: bp.applyRankStage(s, g) });
    }
    return true;
  });
  guard("D3-fix11 2 규칙표 벡터: 철구 60·61 → 30·30 / 랭크 −1 60·61 → 40·40 / 스카프+마비 80(−1) = 39 / 107(−2) = 39 / 105 스카프+마비 = 78(체인에 0.5로 넣으면 79) / 속보+마비+스카프 105 = 236", () => {
    const v = [eng(60, 0, [0.5], false), eng(61, 0, [0.5], false), eng(60, -1, [], false), eng(61, -1, [], false), eng(80, -1, [1.5], true), eng(107, -2, [1.5], true), eng(105, 0, [1.5], true), eng(105, 0, [1.5, 1.5], false)];
    const want = [30, 30, 40, 40, 39, 39, 78, 236];
    return json(v) === json(want) ? true : json({ v, want });
  });

  // ── 3. 실전 경로: 동속이면 난수로 갈린다(철구 60·61, 인게임 확인과 같은 상황) ──
  const firstActor = (st, rand) => { const o = rt.runTurn(st, mv(IDLE), mv(IDLE), () => rand); return (o.result ?? o.partialResult).actions[0].actor; };
  guard("D3-fix11 3 철구 60 vs 61: 정수 스피드가 같아 동속 — 난수 0.49면 a, 0.51이면 b가 먼저(소수 곱이면 항상 61이 먼저)", () => {
    const mk = () => { const st = battle([mon("번치코", [IDLE], null, "검은철구")], [mon("번치코", [IDLE], null, "검은철구")]); st.a.realStats = { ...st.a.realStats, spe: 60 }; st.b.realStats = { ...st.b.realStats, spe: 61 }; return st; };
    const a = firstActor(mk(), 0.49), b = firstActor(mk(), 0.51);
    return a === "a" && b === "b" ? true : json({ a, b });
  });
  guard("D3-fix11 3-b 트릭룸 + 동속(철구 60·61): 난수 양쪽이 50%로 갈린다(트릭룸이어도 동속은 그대로)", () => {
    const mk = () => { const st = battle([mon("번치코", [IDLE], null, "검은철구")], [mon("번치코", [IDLE], null, "검은철구")]); st.a.realStats = { ...st.a.realStats, spe: 60 }; st.b.realStats = { ...st.b.realStats, spe: 61 }; st.trickRoomTurnsRemaining = 5; return st; };
    const a = firstActor(mk(), 0.49), b = firstActor(mk(), 0.51);
    return a === "a" && b === "b" ? true : json({ a, b });
  });
  guard("D3-fix11 4 computeTurnOrderSpeed가 참조 구현과 일치: 랭크+1·구애스카프·순풍·마비 / 속보+마비 / 곡예(도구 없음)", () => {
    const base = (ab, item) => { const st = battle([mon("번치코", [IDLE], ab, item, pts({ spe: 32 }))], [mon("번치코", [IDLE])]); return st; };
    const st1 = base(null, "구애스카프"); st1.a.stages = { ...st1.a.stages, spe: 1 }; st1.sideA.tailwindTurnsRemaining = 4; st1.a.status = { condition: "paralysis", turnsElapsed: 1 };
    const w1 = sd(st1.a.realStats.spe, 1, [1.5, 2], true), g1 = toi.computeTurnOrderSpeed(st1, st1.a);
    const st2 = base("속보", null); st2.a.status = { condition: "paralysis", turnsElapsed: 1 };
    const w2 = sd(st2.a.realStats.spe, 0, [1.5], false), g2 = toi.computeTurnOrderSpeed(st2, st2.a);
    const st3 = base("곡예", null); st3.a.unburdenActive = true;
    const w3 = sd(st3.a.realStats.spe, 0, [2], false), g3 = toi.computeTurnOrderSpeed(st3, st3.a);
    return w1 === g1 && w2 === g2 && w3 === g3 ? true : json({ w: [w1, w2, w3], g: [g1, g2, g3] });
  });
  guard("D3-fix11 5 evaluateSpeedMatchup(매치업)이 엔진과 같은 정수를 낸다: 스카프+순풍+마비+랭크 / 속보+상태이상", () => {
    const a1 = mon("번치코", [IDLE], null, "구애스카프", pts({ spe: 32 })), b1 = mon("번치코", [IDLE], null, null, pts({ spe: 32 }));
    const st1 = battle([a1], [b1]); st1.a.stages = { ...st1.a.stages, spe: 1 }; st1.sideA.tailwindTurnsRemaining = 4; st1.a.status = { condition: "paralysis", turnsElapsed: 1 };
    const r1 = me.evaluateSpeedMatchup(a1.slot, b1.slot, { attackerTailwind: true, attackerStatus: "paralysis", attackerStages: st1.a.stages });
    const a2 = mon("번치코", [IDLE], "속보", null, pts({ spe: 32 }));
    const st2 = battle([a2], [b1]); st2.a.status = { condition: "paralysis", turnsElapsed: 1 };
    const r2 = me.evaluateSpeedMatchup(a2.slot, b1.slot, { attackerStatus: "paralysis" });
    const e1 = toi.computeTurnOrderSpeed(st1, st1.a), e2 = toi.computeTurnOrderSpeed(st2, st2.a);
    return r1.attackerSpeed === e1 && r2.attackerSpeed === e2 && Number.isInteger(r1.attackerSpeed) ? true : json({ matchup: [r1.attackerSpeed, r2.attackerSpeed], engine: [e1, e2] });
  });
  guard("D3-fix11 6 AI firstProbability: 철구 60·61 동속이면 0.5(소수 곱이면 항상 확정)", () => {
    const st = battle([mon("번치코", ["불꽃펀치"], null, "검은철구")], [mon("번치코", ["불꽃펀치"], null, "검은철구")]);
    st.a.realStats = { ...st.a.realStats, spe: 60 }; st.b.realStats = { ...st.b.realStats, spe: 61 };
    const p = aiSpeed.firstProbability(st, st.a, M("불꽃펀치"), st.b, M("불꽃펀치"));
    return Math.abs(p.probability - 0.5) < 1e-9 && p.order === "speed_tie" ? true : json(p);
  });
  guard("D3-fix11 7 랭크 이중 적용 없음: 멸망의노래 동시 기절 — 랭크 +1(100 → 150)이 160보다 느려 a가 이긴다(랭크를 두 번 곱하면 225라 b가 이긴다)", () => {
    const st = battle([mon("번치코", [IDLE])], [mon("번치코", [IDLE])]);
    st.a.realStats = { ...st.a.realStats, spe: 100 }; st.b.realStats = { ...st.b.realStats, spe: 160 };
    st.a.stages = { ...st.a.stages, spe: 1 };
    st.a.perishCount = 0; st.b.perishCount = 0;
    const o = rt.runTurn(st, mv(IDLE), mv(IDLE), () => 0.5);
    return (o.result ?? o.partialResult).winner === "a" ? true : json({ winner: (o.result ?? o.partialResult).winner });
  });

  // ── E3-13 메가진화 순서 / E3-16 양쪽 자발 교체 순서 ──
  const zard = () => [mon("리자몽", ["불대문자"], null, "리자몽나이트X"), mon("핫삼", [IDLE])];
  const turtle = () => [mon("거북왕", ["파도타기"], null, "거북왕나이트"), mon("핫삼", [IDLE])];
  const megaMove = (m) => ({ kind: "move", move: M(m), mega: true });
  const megaOrder = (tweak, rand = 0.5) => {
    const st = battle(zard(), turtle()); tweak?.(st);
    const o = rt.runTurn(st, megaMove("불대문자"), megaMove("파도타기"), () => rand);
    return (o.result ?? o.partialResult).megaEvolutions.map((m) => m.side).join("");
  };
  guard("D3-fix11 14 E3-13 양쪽 메가진화 순서: 기본은 빠른 쪽(a) 먼저 / 상대 편 순풍이면 b 먼저(원시 스피드가 아니라 보정 반영) / 트릭룸이면 느린 쪽 먼저", () => {
    const base = megaOrder(), tw = megaOrder((st) => { st.sideB.tailwindTurnsRemaining = 4; }), trick = megaOrder((st) => { st.trickRoomTurnsRemaining = 5; });
    return base === "ab" && tw === "ba" && trick === "ba" ? true : json({ base, tw, trick });
  });
  guard("D3-fix11 14-b E3-13 동속이면 난수(0.49 → a 먼저, 0.51 → b 먼저)", () => {
    const eq = (st) => { st.a.realStats = { ...st.a.realStats, spe: 100 }; st.b.realStats = { ...st.b.realStats, spe: 100 }; };
    const lo = megaOrder(eq, 0.49), hi = megaOrder(eq, 0.51);
    return lo === "ab" && hi === "ba" ? true : json({ lo, hi });
  });
  guard("D3-fix11 15 E3-13 한쪽만 메가진화하면 순서를 정하지 않는다(난수를 쓰지 않아 기존 시나리오와 해시 동일) — 메가진화 1건만", () => {
    const st = battle(zard(), turtle());
    const o = rt.runTurn(st, megaMove("불대문자"), mv("파도타기"), () => 0.5);
    const r = o.result ?? o.partialResult;
    return r.megaEvolutions.length === 1 && r.megaEvolutions[0].side === "a" ? true : json(r.megaEvolutions);
  });
  const switchOrder = (tweak, rand = 0.5) => {
    const st = battle(zard(), turtle()); tweak?.(st);
    const o = rt.runTurn(st, { kind: "switch", toIndex: 1 }, { kind: "switch", toIndex: 1 }, () => rand);
    return (o.result ?? o.partialResult).switches.map((s) => s.side ?? s.actor ?? "?").join("");
  };
  guard("D3-fix11 17 E3-16 양쪽 자발 교체 순서: 기본 빠른 쪽(a) 먼저 / 상대 편 순풍이면 b 먼저 / 트릭룸이면 느린 쪽(b) 먼저 / 동속이면 난수", () => {
    const base = switchOrder(), tw = switchOrder((st) => { st.sideB.tailwindTurnsRemaining = 4; }), trick = switchOrder((st) => { st.trickRoomTurnsRemaining = 5; });
    const eq = (st) => { st.a.realStats = { ...st.a.realStats, spe: 100 }; st.b.realStats = { ...st.b.realStats, spe: 100 }; };
    const lo = switchOrder(eq, 0.49), hi = switchOrder(eq, 0.51);
    return base === "ab" && tw === "ba" && trick === "ba" && lo === "ab" && hi === "ba" ? true : json({ base, tw, trick, lo, hi });
  });

  // ── E3-14 시간벌기 + 선제공격손톱 양쪽 성공 ──
  const stallTurn = (rand) => {
    // a: 깜까미(시간벌기) + 선제공격손톱, 더 빠름 / b: 선제공격손톱, 더 느림
    const st = battle([mon("깜까미", [IDLE], "시간벌기", "선제공격손톱", pts({ spe: 32 }))], [mon("번치코", [IDLE], null, "선제공격손톱", pts({ hp: 32 }))]);
    const o = rt.runTurn(st, mv(IDLE), mv(IDLE), rand);
    return (o.result ?? o.partialResult).actions[0].actor;
  };
  guard("D3-fix11 16 E3-14: 양쪽 손톱 성공 → 시간벌기가 사라져 스피드만 비교(빠른 a 먼저) / 둘 다 실패 → 시간벌기라 b 먼저(현행) / a만 성공 → a 먼저", () => {
    let n = 0;
    const onlyA = () => { n++; return n === 1 ? 0 : 0.99; }; // 첫 굴림(a) 성공, 둘째(b) 실패
    const both = stallTurn(() => 0), none = stallTurn(() => 0.99);
    n = 0; const one = stallTurn(onlyA);
    return both === "a" && none === "b" && one === "a" ? true : json({ both, none, one });
  });
  guard("D3-fix11 16-b AI firstProbability도 같은 규칙: 양쪽 성공 항에서 시간벌기를 무시(0.16 + 0.04 = 0.2, 이전은 0.16)", () => {
    const st = battle([mon("깜까미", ["불꽃펀치"], "시간벌기", "선제공격손톱", pts({ spe: 32 }))], [mon("번치코", ["불꽃펀치"], null, "선제공격손톱", pts({ hp: 32 }))]);
    const p = aiSpeed.firstProbability(st, st.a, M("불꽃펀치"), st.b, M("불꽃펀치"));
    return Math.abs(p.probability - 0.2) < 1e-9 ? true : json(p);
  });

  // ── 회귀: 보정·랭크 없음이면 값이 같다 ──
  guard("D3-fix11 10 보정·랭크 없음: 실효 스피드 = 실능 스피드 그대로(현행과 같음)", () => {
    const st = battle([mon("번치코", [IDLE])], [mon("번치코", [IDLE])]);
    return toi.computeTurnOrderSpeed(st, st.a) === st.a.realStats.spe ? true : json({ got: toi.computeTurnOrderSpeed(st, st.a), real: st.a.realStats.spe });
  });
}
