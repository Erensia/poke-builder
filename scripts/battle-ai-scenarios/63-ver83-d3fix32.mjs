// 8.3 D3-fix-32 (E6-04·05) 뿌리박기·아쿠아링 동시 회복 + 큰뿌리 회복 반올림.
//  · 뿌리박기(order 7)·아쿠아링(order 6)은 각각 최대HP/16을 회복한다 — 둘 다 걸려 있으면 두 번(엔진은 뿌리박기 하나만 골랐다).
//  · 큰뿌리: Showdown heal()이 trunc(회복량) 뒤 bigroot.onTryHeal이 modify(×5324/4096, 0.5 내림). 엔진은 floor(원래값 × 1.3)이라 최대HP·피해에 따라 1 어긋났다.
//    뿌리박기·아쿠아링·씨뿌리기 흡수·흡수 기술 3경로가 공용 헬퍼를 쓴다(AI 흡수 추정은 연속 기대값이라 대상 아님).
// 설계 `8.3-D3-E6-검수.md` §2-3·§2-4, 결정은 `8.3-세션인계.md` 2026-11-23 절.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const vol = await server.ssrLoadModule("/src/lib/volatileConditions.ts");
  const df = await server.ssrLoadModule("/src/lib/damageFormula.ts");
  const ie = await server.ssrLoadModule("/src/lib/itemEffects.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  const put = (f, ...ids) => { for (const id of ids) f.volatile = vol.inflictVolatile(f.volatile, id, () => 0.5); };
  const turn = (st, aMove = IDLE, bMove = IDLE) => { const out = rt.runTurn(st, act(aMove), act(bMove), () => 0.5); return { out, res: out.result ?? out.partialResult }; };
  // Showdown 기준값: heal(trunc(base)) 뒤 큰뿌리면 modify(…, 5324/4096) = trunc((trunc(v × 5324) + 2047) / 4096)
  const sd = (base, root) => (root ? Math.trunc((Math.trunc(Math.trunc(base) * 5324) + 2047) / 4096) : Math.trunc(base));

  // a(매직가드: 날씨 피해 없음)를 최대HP maxHp·현재HP 1로 두고 volatiles를 건 뒤 한 턴 — 회복량(= 턴 종료 뒤 HP − 1)과 로그를 돌려준다.
  const regen = (maxHp, volatiles, item = null) => {
    const st = battle([mon("잠만보", [IDLE], "매직가드", item)], [mon("잠만보", [IDLE])]);
    st.a.maxHp = maxHp; st.a.currentHp = 1; put(st.a, ...volatiles);
    const { out, res } = turn(st);
    return { heal: out.nextState.a.currentHp - 1, log: res.endOfTurn.filter((e) => e.actor === "a" && e.regenSource) };
  };

  guard("D3-fix32 1 뿌리박기 + 아쿠아링 동시: 최대HP/16을 두 번 회복(160 → 10 + 10)", () => {
    const r = regen(160, ["ingrain", "aquaRing"]);
    return r.heal === 20 ? true : json(r);
  });
  guard("D3-fix32 2 둘 다 걸려도 로그는 항목 둘 — 아쿠아링(6)이 먼저, 뿌리박기(7)가 다음, 각 항목에 자기 regenSource", () => {
    const r = regen(160, ["ingrain", "aquaRing"]);
    const got = r.log.map((e) => `${e.regenSource}:${e.regenHeal}`);
    return got.join() === "aquaRing:10,ingrain:10" ? true : json(got);
  });
  guard("D3-fix32 3 하나만 걸리면 한 번(회귀): 뿌리박기 10·아쿠아링 10", () => {
    const a = regen(160, ["ingrain"]), b = regen(160, ["aquaRing"]);
    return a.heal === 10 && b.heal === 10 && a.log.length === 1 && b.log.length === 1 ? true : json({ a, b });
  });
  guard("D3-fix32 4 큰뿌리 + 둘 다: 최대HP 62 → 각 trunc(62/16)=3 → ×5324/4096 = 4, 합 8 (엔진 옛 식은 5씩)", () => {
    const r = regen(62, ["ingrain", "aquaRing"], "큰뿌리");
    return r.heal === 8 ? true : json(r);
  });
  guard("D3-fix32 5 큰뿌리 + 뿌리박기 하나, 최대HP 50~700 전수: 회복량 = modify(trunc(최대HP/16))", () => {
    const bad = [];
    for (let hp = 50; hp <= 700; hp++) {
      const want = sd(hp / 16, true), got = regen(hp, ["ingrain"], "큰뿌리").heal;
      if (got !== want) { bad.push(`${hp}:${got}≠${want}`); if (bad.length > 6) break; }
    }
    return bad.length === 0 ? true : json(bad);
  });
  guard("D3-fix32 6 큰뿌리 없음(회귀): 아쿠아링 하나, 최대HP 50~700 전수, 회복량 = trunc(최대HP/16)", () => {
    const bad = [];
    for (let hp = 50; hp <= 700; hp++) {
      const want = Math.trunc(hp / 16), got = regen(hp, ["aquaRing"]).heal;
      if (got !== want) { bad.push(`${hp}:${got}≠${want}`); if (bad.length > 6) break; }
    }
    return bad.length === 0 ? true : json(bad);
  });
  guard("D3-fix32 7 회복 금지: 뿌리박기·아쿠아링 모두 회복하지 않는다", () => {
    const r = regen(160, ["ingrain", "aquaRing", "healBlock"]);
    return r.heal === 0 && r.log.length === 0 ? true : json(r);
  });
  guard("D3-fix32 8 남은 HP가 모자라면 둘째 회복은 남은 만큼만(최대HP 160, HP 155 → 5로 가득)", () => {
    const st = battle([mon("잠만보", [IDLE], "매직가드")], [mon("잠만보", [IDLE])]);
    st.a.maxHp = 160; st.a.currentHp = 155; put(st.a, "ingrain", "aquaRing");
    const { out, res } = turn(st);
    const got = res.endOfTurn.filter((e) => e.actor === "a" && e.regenSource).map((e) => e.regenHeal);
    return out.nextState.a.currentHp === 160 && got.join() === "5" ? true : json({ hp: out.nextState.a.currentHp, got });
  });

  // 씨뿌리기: 씨가 걸린 b가 잃은 d를 a가 큰뿌리로 회복. b 최대HP = 8d → 피해 정확히 d.
  const leech = (d, item) => {
    const st = battle([mon("잠만보", [IDLE], "매직가드", item)], [mon("잠만보", [IDLE])]);
    st.a.maxHp = 1000; st.a.currentHp = 1; st.b.maxHp = 8 * d; st.b.currentHp = 8 * d; put(st.b, "leechSeed");
    const { out } = turn(st);
    return out.nextState.a.currentHp - 1;
  };
  guard("D3-fix32 9 씨뿌리기 + 큰뿌리: 피해 9 → 12 회복(옛 식은 11)", () => {
    const got = leech(9, "큰뿌리");
    return got === 12 ? true : String(got);
  });
  guard("D3-fix32 10 씨뿌리기 피해 1~90 전수: 큰뿌리 회복 = modify(피해), 도구 없으면 피해 그대로", () => {
    const bad = [];
    for (let d = 1; d <= 90; d++) {
      const g1 = leech(d, "큰뿌리"), g0 = leech(d, null);
      if (g1 !== sd(d, true) || g0 !== d) { bad.push(`${d}:${g1}/${g0}`); if (bad.length > 6) break; }
    }
    return bad.length === 0 ? true : json(bad);
  });

  // 흡수 기술: 실제로 준 피해 dealt의 1/2(기가드레인 drainFraction) → trunc → 큰뿌리면 modify. 보고된 피해에서 기대값을 계산해 대조한다.
  guard("D3-fix32 11 흡수 기술 + 큰뿌리: 여러 상대·피해에서 회복 = modify(floor(피해 × 1/2)), 어긋나는 옛 식 사례가 표본에 있다", () => {
    const bad = []; let oldDiff = 0, n = 0;
    for (const defId of ["한카리아스", "잠만보", "피죤투", "갸라도스", "망나뇽", "마기라스", "메타그로스"]) {
      for (const hp of [1, 2, 3]) {
        const st = battle([mon("잠만보", ["기가드레인", IDLE], "매직가드", "큰뿌리", { hp: 0, atk: 0, def: 0, spa: 4 * hp, spd: 0, spe: 0 })], [mon(defId, [IDLE])]);
        st.a.maxHp = 1000; st.a.currentHp = 1; st.b.maxHp = 5000; st.b.currentHp = 5000;
        const { res } = turn(st, "기가드레인");
        const r = res.actions.find((x) => x.actor === "a");
        const dealt = r.damage ?? 0;
        if (dealt <= 0) continue;
        n++;
        const want = sd(Math.floor(dealt * 0.5), true), got = r.drainHealAmount ?? 0;
        if (Math.floor(dealt * 0.5 * 1.3) !== want) oldDiff++;
        if (got !== want) { bad.push(`${defId}/${hp}: dealt ${dealt} → ${got}≠${want}`); if (bad.length > 4) break; }
      }
    }
    if (n < 10) return `표본 부족 ${n}`;
    if (oldDiff === 0) return "옛 식과 갈리는 표본이 없다(시험이 힘이 없음)";
    return bad.length === 0 ? true : json(bad);
  });

  guard("D3-fix32 12 공용 헬퍼 healWithBigRoot: 도구 없으면 trunc, 큰뿌리면 modify4096(trunc, 1.3)(1~2000 전수)", () => {
    const f = ie.healWithBigRoot;
    if (typeof f !== "function") return "healWithBigRoot 없음";
    const root = data.getItem("큰뿌리"), other = data.getItem("먹다남은음식");
    const bad = [];
    for (let v = 0; v <= 2000; v += 0.5) {
      if (f(v, undefined) !== Math.trunc(v) || f(v, other) !== Math.trunc(v) || f(v, root) !== df.modify4096(Math.trunc(v), 1.3, "final")) bad.push(v);
    }
    return bad.length === 0 ? true : json(bad.slice(0, 5));
  });
}
