// 8.3 D3-fix-16 혼란 자해: 확률 33%(Showdown `randomChance(33, 100)`)·피해에 자기 공격·방어 랭크 반영(`getConfusionDamage`는 `calculateStat(boosts)`)·
// 난수 85~100% 정수 16단계(본 피해 경로와 같은 굴림식). 천진·천하장사·도구·화상·자속은 자해에 영향 없음(`calculateStat`은 ModifyAtk/Def를 안 부른다).
// 설계 `8.3-D3-fix16-혼란자해설계.md`(검수 `…-검수.md`). E4b-02·03.
export default async function ({ server, data, mon, battle, check }) {
  const ph = await server.ssrLoadModule("/src/lib/battle/preHitEffects.ts");
  const vc = await server.ssrLoadModule("/src/lib/volatileConditions.ts");
  const tr = await server.ssrLoadModule("/src/lib/battle/ai/turnRates.ts");
  const json = JSON.stringify;
  const M = (n) => data.getMove(n);
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };

  // Showdown getConfusionDamage 참조 구현: 레벨 50·위력 40, 랭크는 floor 적용, 난수 단계 k(0~15) = 85+k %, 최소 1
  const stageApply = (stat, b) => (b >= 0 ? Math.floor((stat * (2 + b)) / 2) : Math.floor((stat * 2) / (2 - b)));
  const refDamage = (atk, def, atkStage, defStage, k) => {
    const a = stageApply(atk, atkStage), d = stageApply(def, defStage);
    const base = Math.floor(Math.floor(Math.floor((22 * 40 * a) / d) / 50)) + 2;
    return Math.max(1, Math.floor((base * (85 + k)) / 100));
  };

  // a는 혼란, 실능 atk/def를 고정(특성·도구 효과가 realStats에 섞이지 않게). b는 대기.
  const mk = ({ aMon = mon("한카리아스", [IDLE]), bMon = mon("잠만보", [IDLE]), atk = 150, def = 100, atkStage = 0, defStage = 0, turns = 3 } = {}) => {
    const st = battle([aMon], [bMon]);
    st.a.realStats = { ...st.a.realStats, atk, def };
    st.a.stages = { ...st.a.stages, atk: atkStage, def: defStage };
    st.a.volatile = { active: { confusion: { turnsRemaining: turns } } };
    return st;
  };
  // 난수 열(굴림 → 16단계)을 순서대로 돌려주고 호출 수를 센다. 열이 모자라면 마지막 값 반복.
  const seq = (...vals) => { let i = 0; const f = () => vals[Math.min(i++, vals.length - 1)]; f.calls = () => i; return f; };
  const roll = (st, rnd) => ph.resolvePreHitEffects(st, "a", M(IDLE), rnd, false, M(IDLE));
  const stepRand = (k) => (k + 0.5) / 16;
  const selfDamageOf = (opts, k) => { const r = roll(mk(opts), seq(0.1, stepRand(k))); return r.blockedReason === "confusion" ? r.selfDamage : `자해 안 함(${r.blockedReason})`; };

  guard("D3-fix16 1 참조 구현 일치: 실능 3조합 × 공격·방어 랭크 −2~+2 전수 × 난수 16단계", () => {
    const cases = [];
    for (const [atk, def] of [[150, 100], [200, 80], [90, 160]])
      for (let as = -2; as <= 2; as++) for (let ds = -2; ds <= 2; ds++) for (let k = 0; k < 16; k++) cases.push({ atk, def, as, ds, k });
    const mismatches = cases
      .map((x) => ({ ...x, got: selfDamageOf({ atk: x.atk, def: x.def, atkStage: x.as, defStage: x.ds }, x.k), want: refDamage(x.atk, x.def, x.as, x.ds, x.k) }))
      .filter((x) => x.got !== x.want);
    return mismatches.length === 0 ? true : `${mismatches.length}/${cases.length}건 불일치, 첫 ${json(mismatches[0])}`;
  });
  guard("D3-fix16 2 자기 랭크 반영: 공격 +2면 자해 피해 증가, 방어 +2면 감소", () => {
    const base = selfDamageOf({}, 8), atkUp = selfDamageOf({ atkStage: 2 }, 8), defUp = selfDamageOf({ defStage: 2 }, 8);
    return atkUp > base && defUp < base ? true : json({ base, atkUp, defUp });
  });
  guard("D3-fix16 3 확률 경계: 난수 0.329 → 자해, 0.331 → 자해 안 함(33%)", () => {
    const hit = roll(mk(), seq(0.329, 0.5)).blockedReason, miss = roll(mk(), seq(0.331, 0.5)).blockedReason;
    return hit === "confusion" && miss !== "confusion" ? true : json({ hit, miss });
  });
  guard("D3-fix16 4 난수 호출 수: 자해 2회(굴림 + 피해 단계)·안 하면 1회, 혼란이 풀린 뒤 행동은 0회", () => {
    const a = seq(0.1, 0.5); roll(mk(), a);
    const b = seq(0.9, 0.5); const rb = roll(mk(), b);
    // 상태 없는 기술이라 혼란 말고는 난수를 안 쓴다(안 쓰면 b는 정확히 1회).
    const c = seq(0.9, 0.5); roll(mk({ turns: 1 }), c);                       // 마지막 틱 행동: 굴림은 한다(엔진 N회 = Showdown T−1회)
    const st = mk({ turns: 1 }); roll(st, seq(0.9));                            // 첫 행동으로 혼란 소모
    const d = seq(0.1, 0.5); const rd = roll(st, d);                            // 이미 풀린 뒤 행동
    return a.calls() === 2 && b.calls() === 1 && rb.blockedReason !== "confusion" && c.calls() === 1 && d.calls() === 0 && rd.blockedReason !== "confusion"
      ? true : json({ hit: a.calls(), miss: b.calls(), lastTick: c.calls(), afterExpire: d.calls(), reason: rd.blockedReason });
  });
  guard("D3-fix16 5 무영향: 화상·자속·천진(자기·상대)·천하장사·힘의머리띠는 자해 피해를 바꾸지 않는다", () => {
    const base = selfDamageOf({ atkStage: 2 }, 8);
    const cases = {
      화상: () => { const st = mk({ atkStage: 2 }); st.a.status = { condition: "burn", turnsElapsed: 0 }; return st; },
      자속: () => mk({ atkStage: 2, aMon: mon("한카리아스", [IDLE]) }),                // 드래곤·땅 — 가짜 기술이 타입 null이라 자속 없음
      "자기 천진": () => mk({ atkStage: 2, aMon: mon("픽시", [IDLE], "천진") }),
      "상대 천진": () => mk({ atkStage: 2, bMon: mon("픽시", [IDLE], "천진") }),
      천하장사: () => mk({ atkStage: 2, aMon: mon("마릴리", [IDLE], "천하장사") }),
      힘의머리띠: () => mk({ atkStage: 2, aMon: mon("한카리아스", [IDLE], null, "힘의머리띠") }),
    };
    const bad = {};
    for (const [name, build] of Object.entries(cases)) {
      const r = roll(build(), seq(0.1, stepRand(8)));
      if (r.blockedReason !== "confusion" || r.selfDamage !== base) bad[name] = r.selfDamage;
    }
    return Object.keys(bad).length === 0 ? true : json({ base, bad });
  });
  guard("D3-fix16 6 지속 분포 불변: 혼란 N틱이면 자해 굴림이 정확히 N번 일어나고 끝난다(N=1~4)", () => {
    for (let n = 1; n <= 4; n++) {
      const st = mk({ turns: n }); let rolls = 0;
      for (let i = 0; i < 6 && st.a.volatile.active.confusion; i++) { const rnd = seq(0.9); roll(st, rnd); rolls += rnd.calls(); }
      if (rolls !== n || st.a.volatile.active.confusion) return json({ n, rolls });
    }
    return true;
  });
  guard("D3-fix16 7 최소 1: 공격 −6·방어 +6 극단 조합에서도 피해 ≥ 1", () => {
    const d = selfDamageOf({ atk: 5, def: 400, atkStage: -6, defStage: 6 }, 0);
    return typeof d === "number" && d >= 1 ? true : json(d);
  });
  guard("D3-fix16 8 AI: 자해 확률 상수가 0.33이고, 혼란 대상의 공격 랭크가 오르면 기대 처치 턴이 짧아진다(자해 기대값에 랭크 반영)", () => {
    if (vc.CONFUSION_SELF_HIT_CHANCE !== 0.33) return `상수 ${vc.CONFUSION_SELF_HIT_CHANCE}`;
    const build = (atkStage) => {
      const st = mk({ atkStage, atk: 250 });
      st.a.volatile = { active: { confusion: { turnsRemaining: 4 } } };
      return st;
    };
    const attacker = battle([mon("잠만보", [IDLE])], [mon("한카리아스", [IDLE])]).a;
    const calm = tr.turnsToKo(0.05, attacker, build(0).a, build(0).a.currentHp);
    const boosted = tr.turnsToKo(0.05, attacker, build(6).a, build(6).a.currentHp);
    return boosted < calm ? true : json({ calm, boosted });
  });
}
