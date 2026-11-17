// 8.3 D3-fix-6 데미지 4096 체인·화상 단계 분리·스나이퍼 (Showdown champions `modifyDamage`, `sim/battle.ts` chain·modify)
// 설계 `8.3-D3-fix6-데미지체인설계.md`(§9 검수 반영: 위력 1.3 = 5325, 최종 1.3 = 5324). 참조 구현은 이 파일 안에 Showdown 식을 그대로 옮겼다.
export default async function ({ server, data, mon, battle, pts, check }) {
  const fm = await server.ssrLoadModule("/src/lib/damageFormula.ts");
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const tr = Math.trunc;

  // ── 참조 구현(Showdown): 배율은 4096분율 정수(분자)로 직접 받는다 ──
  const modifyN = (v, n) => tr((tr(v * n) + 2047) / 4096);
  const chainN = (...ns) => ns.reduce((a, b) => ((a * b + 2048) >> 12), 4096);
  const N = { p13: 5325, f13: 5324, 12: 4915, 11: 4505, 75: 3072, 5: 2048, 15: 6144 }; // 위력 1.3·최종 1.3·1.2·1.1·0.75·0.5·1.5
  // 한 타 참조: 위력 체인 → 기본 데미지 → (급소) → 난수 → 자속 → 상성 → 화상 → 최종 체인
  const refHit = ({ power, atk, def, roll, powerN = 4096, crit = false, stabN = 4096, te = 1, burnN = 4096, finalN = 4096 }) => {
    const bp = Math.max(1, modifyN(power, powerN));
    let d = tr(tr(tr(22 * bp * atk) / def) / 50) + 2;
    if (crit) d = tr(d * 1.5);
    d = tr((d * roll) / 100);
    if (stabN !== 4096) d = modifyN(d, stabN);
    d = tr(d * te);
    if (burnN !== 4096) d = modifyN(d, burnN);
    if (finalN !== 4096) d = modifyN(d, finalN);
    return Math.max(1, d);
  };
  const base = (o) => ({ attackTerm: o.atk, defenseKey: "def", defenseRankMultiplier: 1, bulkMultiplier: 1, weatherMultiplier: 1, critMultiplier: o.crit ? 1.5 : 1, stabMultiplier: 1, typeEffectiveness: o.te ?? 1, baseMultiplier: 1, finalMultiplier: 1 });
  const engHit = (o, parts) => fm.integerHitDamage({ ...base(o), stabMultiplier: (o.stabN ?? 4096) / 4096, ...parts }, o.power, o.def, o.roll / 100);
  // 격자 비교: 서로 다른 값이 하나라도 있으면 첫 불일치를 돌려준다
  const cross = (...lists) => lists.reduce((acc, l) => acc.flatMap((a) => l.map((v) => [...a, v])), [[]]);
  const GRID = cross([25, 35, 45, 55, 65, 75, 85, 95, 100, 120, 150, 250], [60, 100, 150, 200, 300, 400], [40, 80, 120, 200], [85, 91, 93, 100], [1, 2], [4096, 6144])
    .map(([power, atk, def, roll, te, stabN]) => ({ power, atk, def, roll, te, stabN }));
  const grid = (mk) => {
    for (const o of GRID) {
      const { ref, eng } = mk(o);
      if (ref !== eng) return json({ ...o, ref, eng });
    }
    return null;
  };
  const guard = (name, fn) => { try { const bad = fn(); check(name, bad === null, bad ?? ""); } catch (e) { check(name, false, `예외: ${e.message}`); } };

  // 1. 최종 체인: 구슬(5324)×하드록(0.75) — 입력 범위: 위 격자(위력 12종·공격 6종·방어 4종·난수 4종·상성 2종·자속 2종)
  guard("D3-fix6 1 최종 체인 1.3(5324)×0.75 = 참조 구현", () => grid((o) => ({
    ref: refHit({ ...o, finalN: chainN(N.f13, N[75]) }),
    eng: engHit(o, { finalMultiplier: fm.chain4096("final", 1.3, 0.75) }),
  })));
  // 2. 위력 체인 1.2×1.3(5325)
  guard("D3-fix6 2 위력 체인 1.2×1.3(5325) = 참조 구현", () => grid((o) => ({
    ref: refHit({ ...o, powerN: chainN(N[12], N.p13) }),
    eng: engHit(o, { baseMultiplier: fm.chain4096("power", 1.2, 1.3) }),
  })));
  // 3. 최종 체인 3개(0.5×0.75×1.3)
  guard("D3-fix6 3 최종 체인 0.5×0.75×1.3 = 참조 구현", () => grid((o) => ({
    ref: refHit({ ...o, finalN: chainN(N[5], N[75], N.f13) }),
    eng: engHit(o, { finalMultiplier: fm.chain4096("final", 0.5, 0.75, 1.3) }),
  })));
  // 4. 회귀 방지: 정확히 표현되는 단일 배율(1.2·1.25·0.75·0.5·1.5)은 현행과 같은 값 — 소수 곱 그대로 넘겨도 참조와 일치
  for (const [m, n] of [[1.2, 4915], [1.25, 5120], [0.75, 3072], [0.5, 2048], [1.5, 6144]]) {
    guard(`D3-fix6 4 단일 배율 ${m}(최종)은 참조 구현과 일치`, () => grid((o) => ({ ref: refHit({ ...o, finalN: n }), eng: engHit(o, { finalMultiplier: m }) })));
  }
  // 8. 위력 1.3배(5325): 위력 75 × 1.3 = 98(소수 곱 97) — 5의 홀수 배수 위력 전수
  guard("D3-fix6 8 위력 1.3(5325): 위력 5의 홀수 배수 전수가 참조 구현과 일치", () => {
    for (let power = 5; power <= 195; power += 10) {
      const o = { power, atk: 100, def: 100, roll: 100, te: 1, stabN: 4096 };
      const ref = refHit({ ...o, powerN: N.p13 }), eng = engHit(o, { baseMultiplier: 1.3 });
      if (ref !== eng) return json({ power, ref, eng });
    }
    return null;
  });
  // 9. 최종 1.3배(생명의구슬 5324): 데미지가 큰 구간(d ≥ 512)까지 참조와 일치
  guard("D3-fix6 9 최종 1.3(5324) 단독이 큰 데미지 구간까지 참조 구현과 일치", () => {
    for (let atk = 100; atk <= 700; atk += 7) {
      const o = { power: 250, atk, def: 40, roll: 100, te: 2, stabN: 6144 };
      const ref = refHit({ ...o, finalN: N.f13 }), eng = engHit(o, { finalMultiplier: 1.3 });
      if (ref !== eng) return json({ atk, ref, eng });
    }
    return null;
  });
  // 2. 화상: 상성 직후 별도 modify(0.5) 뒤에 최종 체인(구슬 5324)
  guard("D3-fix6 5 화상 0.5(별도 단계) + 구슬 1.3 = 참조 구현", () => grid((o) => ({
    ref: refHit({ ...o, burnN: N[5], finalN: N.f13 }),
    eng: engHit(o, { burnMultiplier: 0.5, finalMultiplier: fm.chain4096("final", 1.3) }),
  })));
  // 6. burnMultiplier가 첫 타 배율과 함께 전달되는 경로(koChanceByUses·rollTotals) — 같은 입력으로 난수표가 참조 구현과 일치
  guard("D3-fix6 6 damageRollTotals가 burnMultiplier를 반영한다(난수 16개)", () => {
    const o = { power: 80, atk: 150, def: 100, te: 1, stabN: 6144 };
    const parts = { ...base(o), hitPowers: [80], stabMultiplier: 1.5, burnMultiplier: 0.5, finalMultiplier: fm.chain4096("final", 1.3) };
    const got = fm.damageRollTotals(parts, 100);
    const want = Array.from({ length: 16 }, (_, k) => refHit({ ...o, roll: 85 + k, burnN: N[5], finalN: N.f13 }));
    return json(got) === json(want) ? null : json({ got, want });
  });

  // ── 엔진 경로(runTurn): 스나이퍼 급소(상성 뒤 최종 체인 ×1.5)·화상 + 생명의구슬 ──
  // 공격 한카리아스 vs 방어 잠만보. 난수 0.5 고정 → 난수 93%. 스탯은 엔진 상태에서 읽는다.
  const dmg = (st, move, ra = () => 0.5) => {
    const o = rt.runTurn(st, { kind: "move", move: data.getMove(move) }, { kind: "move", move: data.getMove("도우미") }, ra);
    return (o.result ?? o.partialResult).actions.find((x) => x.actor === "a")?.damage;
  };
  const noPts = pts({ atk: 32, spe: 32 });
  // 업어후리기: 항상 급소(격투 60) → 잠만보(노말) 2배, 자속 없음
  guard("D3-fix6 7 스나이퍼 급소: 업어후리기 데미지 = 참조(급소 ×1.5 → … → 최종 체인 ×1.5)", () => {
    const st = battle([mon("한카리아스", ["업어후리기"], "스나이퍼", null, noPts)], [mon("잠만보", ["도우미"], null, null, pts({ hp: 32, def: 32 }))]);
    const want = refHit({ power: 60, atk: st.a.realStats.atk, def: st.b.realStats.def, roll: 93, crit: true, te: 2, finalN: N[15] });
    const got = dmg(st, "업어후리기");
    return got === want ? null : json({ got, want });
  });
  guard("D3-fix6 7b 스나이퍼가 아닌 급소 타는 급소 ×1.5만(회귀 방지)", () => {
    const st = battle([mon("한카리아스", ["업어후리기"], null, null, noPts)], [mon("잠만보", ["도우미"], null, null, pts({ hp: 32, def: 32 }))]);
    const want = refHit({ power: 60, atk: st.a.realStats.atk, def: st.b.realStats.def, roll: 93, crit: true, te: 2 });
    const got = dmg(st, "업어후리기");
    return got === want ? null : json({ got, want });
  });
  // 화상 + 생명의구슬: 역린(드래곤 120, 자속 1.5) → 잠만보(노말) 1배
  guard("D3-fix6 7c 화상 + 생명의구슬: 역린 데미지 = 참조(화상 별도 modify → 구슬 5324)", () => {
    const st = battle([mon("한카리아스", ["역린"], null, "생명의구슬", noPts)], [mon("잠만보", ["도우미"], null, null, pts({ hp: 32, def: 32 }))]);
    st.a.status = { condition: "burn", turnsElapsed: 0 };
    const want = refHit({ power: 120, atk: st.a.realStats.atk, def: st.b.realStats.def, roll: 93, stabN: 6144, te: 1, burnN: N[5], finalN: N.f13 });
    const got = dmg(st, "역린");
    return got === want ? null : json({ got, want });
  });
  // 스나이퍼 데이터: 필드 이름·값(급소 타 최종 배율 1.5)
  { const ab = data.getAbility?.("스나이퍼");
    check("D3-fix6 10 스나이퍼 데이터: critFinalMultiplier 1.5이고 옛 critDamageMultiplier는 없다", ab?.critFinalMultiplier === 1.5 && ab?.critDamageMultiplier === undefined, json({ f: ab?.critFinalMultiplier, old: ab?.critDamageMultiplier })); }
}
