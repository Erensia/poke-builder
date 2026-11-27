// 8.3 D3-fix-54 (E8-45 + 검수 R1~R4) 변덕쟁이: 올릴 후보는 랭크 < +6, 내릴 후보는 랭크 > −6이고 올린 능력치가 아닌 것으로 먼저 거른 뒤 뽑는다.
// 후보가 비면 난수를 부르지 않는다(Showdown sample 미호출). 설계 `8.3-D3-fix54-변덕쟁이후보설계.md` §3. 키 순서 atk·def·spa·spd·spe.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const NOP = "잠꼬대";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const KEYS = ["atk", "def", "spa", "spd", "spe"];
  const stagesOf = (o = {}) => Object.fromEntries(KEYS.map((k) => [k, o[k] ?? 0]));
  // b 변덕쟁이(또는 대조용 두꺼운지방)가 랭크 s로 한 턴 대기 — 난수는 rnd 인자(호출 횟수는 대조와의 차이로 센다)
  const run = (ab, s, rndFn) => {
    const st = battle([mon("잠만보", [NOP]), mon("잠만보", [NOP])], [mon("잠만보", [NOP], ab), mon("잠만보", [NOP])]);
    st.b.stages = stagesOf(s);
    const o = rt.runTurn(st, mv(NOP), mv(NOP), rndFn);
    return { b: (o.nextState ?? o.partialResult).b, entry: o.result.endOfTurn.find((e) => e.moodyAbilityName) };
  };
  const counted = (value = 0) => { let n = 0; return { fn: () => { n++; return value; }, get n() { return n; } }; };
  const moodyCalls = (s, value = 0) => { const a = counted(value), b = counted(value); run("변덕쟁이", s, a.fn); run("두꺼운지방", s, b.fn); return a.n - b.n; };
  const eq = (got, want) => JSON.stringify(got) === JSON.stringify(want) ? true : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`;
  const ALL6 = { atk: 6, def: 6, spa: 6, spd: 6, spe: 6 };

  guard("D3-fix54 1: 전부 0·난수 0 — atk +2·def −1, 난수 2회", () => {
    const { b, entry } = run("변덕쟁이", {}, () => 0);
    return eq([b.stages.atk, b.stages.def, entry?.moodyRaisedStat, entry?.moodyLoweredStat, moodyCalls({})], [2, -1, "atk", "def", 2]);
  });
  guard("D3-fix54 2: atk +6 — 올림 후보에서 제외(def +2), atk −1 → +5", () => {
    const { b, entry } = run("변덕쟁이", { atk: 6 }, () => 0);
    return eq([b.stages.atk, b.stages.def, entry?.moodyRaisedStat, entry?.moodyLoweredStat], [5, 2, "def", "atk"]);
  });
  guard("D3-fix54 3: atk +6 — 난수를 0~0.99로 훑어도 올린 능력치는 atk가 아니고 +2가 실제로 들어간다", () => {
    for (let i = 0; i < 100; i++) {
      const v = i / 100; const { b, entry } = run("변덕쟁이", { atk: 6 }, () => v);
      if (!entry?.moodyRaisedStat || entry.moodyRaisedStat === "atk") return `v=${v} raised=${entry?.moodyRaisedStat}`;
      if (b.stages[entry.moodyRaisedStat] !== 2) return `v=${v} ${entry.moodyRaisedStat}=${b.stages[entry.moodyRaisedStat]}`;
    }
    return true;
  });
  guard("D3-fix54 4: 5종 전부 +6 — 올림 없음(로그 raised 없음), atk −1, 난수 1회", () => {
    const { b, entry } = run("변덕쟁이", ALL6, () => 0);
    return eq([b.stages.atk, b.stages.def, entry?.moodyRaisedStat, entry?.moodyLoweredStat, moodyCalls(ALL6)], [5, 6, undefined, "atk", 1]);
  });
  guard("D3-fix54 5: def·spa·spd·spe −6 — atk +2, 내림 없음(로그 lowered 없음), 난수 1회", () => {
    const S = { def: -6, spa: -6, spd: -6, spe: -6 };
    const { b, entry } = run("변덕쟁이", S, () => 0);
    return eq([b.stages.atk, b.stages.def, entry?.moodyRaisedStat, entry?.moodyLoweredStat, moodyCalls(S)], [2, -6, "atk", undefined, 1]);
  });
  guard("D3-fix54 6: 내림은 올린 능력치를 고르지 않는다(난수 0..0.99 훑기)", () => {
    for (let i = 0; i < 100; i++) { const v = i / 100; const { entry } = run("변덕쟁이", {}, () => v); if (!entry || entry.moodyRaisedStat === entry.moodyLoweredStat) return `v=${v} ${JSON.stringify(entry)}`; }
    return true;
  });
  guard("D3-fix54 7: 5종 전부 −6 — 올림 +2 하나, 내림 후보 없음, 난수 1회", () => {
    const S = { atk: -6, def: -6, spa: -6, spd: -6, spe: -6 };
    const { b, entry } = run("변덕쟁이", S, () => 0);
    return eq([b.stages.atk, entry?.moodyRaisedStat, entry?.moodyLoweredStat, moodyCalls(S)], [-4, "atk", undefined, 1]);
  });
}
