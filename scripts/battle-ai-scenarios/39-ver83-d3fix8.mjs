// 8.3 D3-fix-8 명중 판정: 정수 절삭 + 4096 소스 분자(Showdown `hitStepAccuracy`), 연속기 2타째 이후 전용 규칙(champions `hitStepMoveHitLoop` multiaccuracy)
// 설계 `8.3-D3-fix8-명중정수설계.md`(검수 반영 §9). 참조 구현은 이 파일 안에 Showdown 식을 그대로 옮겼다.
export default async function ({ server, data, mon, battle, check }) {
  const hc = await server.ssrLoadModule("/src/lib/battle/hitChance.ts");
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const tr = Math.trunc;

  // ── 참조 구현(Showdown) ──
  const modifyN = (v, n) => tr((tr(v * n) + 2047) / 4096);
  const chainN = (ns) => ns.reduce((a, n) => ((a * n + 2048) >> 12), 4096);
  // 순서: 중력 → 복안·의욕·모래숨기·눈숨기·갈지자걸음 → 렌즈류·반짝가루
  const NUM = { gravity: 6840, compound: 5325, hustle: 3277, sand: 3277, tangled: 2048, wide: 4505, zoom: 4915, bright: 3686 };
  const ORDER = ["gravity", "compound", "hustle", "sand", "tangled", "wide", "zoom", "bright"];
  const refFirst = (base, accStage, evaStage, keys) => {
    const ns = ORDER.filter((k) => keys.includes(k)).map((k) => NUM[k]);
    let acc = ns.length ? modifyN(base, chainN(ns)) : base;
    const boost = Math.max(-6, Math.min(6, accStage - evaStage));
    if (boost > 0) acc = tr((acc * (3 + boost)) / 3);
    else if (boost < 0) acc = tr((acc * 3) / (3 - boost));
    return Math.min(100, acc) / 100;
  };
  const TABLE = [1, 4 / 3, 5 / 3, 2, 7 / 3, 8 / 3, 3];
  const refPerHit = (base, accStage, evaStage, keys) => {
    let acc = base;
    const a = Math.max(-6, Math.min(6, accStage));
    acc = a > 0 ? acc * TABLE[a] : acc / TABLE[-a];
    const e = Math.max(-6, Math.min(6, evaStage));
    acc = e > 0 ? acc / TABLE[e] : e < 0 ? acc * TABLE[-e] : acc;
    if (Number.isInteger(acc)) { // 정수일 때만 보정 이벤트가 적용된다(sim/battle.ts runEvent)
      const ns = ORDER.filter((k) => keys.includes(k)).map((k) => NUM[k]);
      if (ns.length) acc = modifyN(acc, chainN(ns));
    }
    return Math.min(100, Math.ceil(acc)) / 100; // random(100) < acc
  };

  // ── 상태 구성: 키(보정 종류)를 엔진 입력으로 바꾼다 ──
  const ITEM = { wide: ["a", "광각렌즈"], zoom: ["a", "포커스렌즈"], bright: ["d", "반짝가루"] };
  const ABIL = { compound: ["a", "복안"], hustle: ["a", "의욕"], sand: ["d", "모래숨기"], tangled: ["d", "갈지자걸음"] };
  const engine = (base, accStage, evaStage, keys, perHit = false, moveId = "스톤에지") => {
    const st = battle([mon("한카리아스", [moveId])], [mon("핫삼", ["불꽃펀치"])]);
    st.a.accuracyStages.accuracy = accStage; st.b.accuracyStages.evasion = evaStage;
    if (keys.includes("sand")) st.weather = "모래바람";
    if (keys.includes("tangled")) st.b.volatile.active.confusion = { turnsRemaining: 3 };
    if (keys.includes("gravity")) st.gravityTurnsRemaining = 5;
    const pick = (map, side) => keys.map((k) => map[k]).filter((x) => x?.[0] === side).map((x) => x[1]);
    const one = (names, getter) => (names.length ? getter(names[0]) : undefined);
    return hc.computeBattleHitChance({
      state: st, attacker: st.a, defender: st.b, move: { ...data.getMove(moveId), accuracy: base },
      attackerAbility: one(pick(ABIL, "a"), data.getAbility), defenderAbility: one(pick(ABIL, "d"), data.getAbility),
      attackerItem: one(pick(ITEM, "a"), data.getItem), defenderItem: one(pick(ITEM, "d"), data.getItem),
      attackerMovesSecond: keys.includes("zoom"), perHit,
    });
  };
  const guard = (name, fn) => { try { const bad = fn(); check(name, bad === null, bad ?? ""); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const COMBOS = [[], ["wide"], ["zoom"], ["bright"], ["compound"], ["sand"], ["tangled"], ["hustle"], ["gravity"], ["compound", "bright"], ["gravity", "compound", "wide"], ["hustle", "sand", "bright"]];
  const grid = (ref, perHit) => {
    for (const base of [50, 60, 70, 75, 80, 85, 90, 95, 100])
      for (const [accStage, evaStage] of [[0, 0], [-1, 0], [-2, 0], [-3, 0], [1, 0], [2, 0], [0, 1], [0, -1], [-1, 1], [1, 1], [-1, -1], [3, 2]])
        for (const keys of COMBOS) {
          const want = ref(base, accStage, evaStage, keys), got = engine(base, accStage, evaStage, keys, perHit);
          if (Math.abs(want - got) > 1e-9) return json({ base, accStage, evaStage, keys, want, got });
        }
    return null;
  };

  // 1. 첫 타: 정수 절삭·4096 분자 전수
  guard("D3-fix8 1 첫 타 명중이 참조 구현(보정 체인 → 랭크 절삭 → 정수 %)과 일치", () => grid(refFirst, false));
  // 2. 회귀 방지: 보정·랭크 없음이면 현행과 같다
  check("D3-fix8 2 보정·랭크 없음: 명중 85 = 0.85", Math.abs(engine(85, 0, 0, []) - 0.85) < 1e-9, json(engine(85, 0, 0, [])));
  // 3. 랭크 −1: 85 × 3/4 = 63.75 → 절삭 63
  check("D3-fix8 3 명중 85·랭크 −1 = 0.63(절삭)", Math.abs(engine(85, -1, 0, []) - 0.63) < 1e-9, json(engine(85, -1, 0, [])));
  // 4. 2타째 이후(트리플악셀·찍찍베기): 소수 랭크·보정 미적용·올림 판정
  guard("D3-fix8 4 2타째 이후 명중이 참조 구현(소수 랭크·회피 따로·정수일 때만 보정·올림)과 일치", () => grid(refPerHit, true));
  check("D3-fix8 4a 2타째 이후: 명중 90·랭크 −1 = 0.68(올림)", Math.abs(engine(90, -1, 0, [], true) - 0.68) < 1e-9, json(engine(90, -1, 0, [], true)));
  check("D3-fix8 4b 2타째 이후: 광각렌즈 + 랭크 −1은 렌즈가 무시되어 0.68", Math.abs(engine(90, -1, 0, ["wide"], true) - 0.68) < 1e-9, json(engine(90, -1, 0, ["wide"], true)));
  check("D3-fix8 4c 2타째 이후: 명중 −1과 회피 +1은 합치지 않고 따로 적용 = 0.51", Math.abs(engine(90, -1, 1, [], true) - 0.51) < 1e-9, json(engine(90, -1, 1, [], true)));
  check("D3-fix8 4d 2타째 이후: 랭크가 0이면 정수라 광각렌즈 적용 = 0.99", Math.abs(engine(90, 0, 0, ["wide"], true) - 0.99) < 1e-9, json(engine(90, 0, 0, ["wide"], true)));
  // 5. 상한: 복안 + 명중 90 = 117 → 100%
  check("D3-fix8 5 복안 + 명중 90은 100%로 자른다", engine(90, 0, 0, ["compound"]) === 1, json(engine(90, 0, 0, ["compound"])));
  // 6. 필중·일격필살·날씨: 기존 분기 유지, 날씨 명중 수치는 정수 경로의 입력
  { const st = battle([mon("한카리아스", ["폭풍"])], [mon("핫삼", ["불꽃펀치"])]);
    const call = (move, weather, accStage = 0) => { st.weather = weather; st.a.accuracyStages.accuracy = accStage;
      return hc.computeBattleHitChance({ state: st, attacker: st.a, defender: st.b, move: data.getMove(move), attackerAbility: undefined, defenderAbility: undefined, attackerItem: undefined, defenderItem: undefined, attackerMovesSecond: false }); };
    check("D3-fix8 6a 폭풍·비 = 필중(null)", call("폭풍", "비") === null, json(call("폭풍", "비")));
    check("D3-fix8 6b 폭풍·쾌청(명중 50) + 랭크 −1 = 0.37(50 × 3/4 = 37.5 절삭)", Math.abs(call("폭풍", "쾌청", -1) - 0.37) < 1e-9, json(call("폭풍", "쾌청", -1)));
    check("D3-fix8 6c 일격필살 절대영도(비얼음 사용자) = 0.2 고정(랭크 무시)", Math.abs(call("절대영도", undefined, -3) - 0.2) < 1e-9, json(call("절대영도", undefined, -3))); }
  // 7. 엔진 경로: 트리플악셀(명중 랭크 −1)이 3타 모두 들어가는지(난수 0.5) — 2타째 이후 확률 배선이 깨지지 않았는지
  { const st = battle([mon("한카리아스", ["트리플악셀"])], [mon("잠만보", ["도우미"])]);
    st.a.accuracyStages.accuracy = -1;
    const o = rt.runTurn(st, { kind: "move", move: data.getMove("트리플악셀") }, { kind: "move", move: data.getMove("도우미") }, () => 0.5);
    const a = (o.result ?? o.partialResult).actions.find((x) => x.actor === "a");
    check("D3-fix8 7 엔진: 명중 −1 트리플악셀(난수 0.5)은 3타 모두 맞는다", a?.hit === true && (a.hitCount ?? 3) === 3, json({ hit: a?.hit, n: a?.hitCount })); }
}
