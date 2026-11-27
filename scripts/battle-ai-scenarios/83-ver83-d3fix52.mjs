// 8.3 D3-fix-52 (E8-42·43) 오기·승기: 상대가 낸 하락에만, 능력치마다 1회씩, 명중·회피·접촉 반응·턴 끝 하락 포함, 기절한 보유자 무발동.
// 설계 `8.3-D3-fix52-오기승기설계.md` §3, 검수 `…-검수.md`(R1~R6, Showdown 16장면 `fix52-recheck-run.cjs`). 대기 기술은 잠꼬대(깨어 있으면 실패 — 방어는 상대 공격을 막는다).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const NOP = "잠꼬대";
  const rnd = () => 0;
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const M = (id, moves, ability = "두꺼운지방", item = null) => mon(id, moves, ability, item);
  const P = (m, ability) => M("잠만보", [m, NOP], ability);
  const BENCH = () => M("잠만보", [NOP]);
  const turn = (st, a, b) => { const o = rt.runTurn(st, mv(a), mv(b), rnd); return o.nextState ?? o.partialResult; };
  const turns = (st, a, b, n) => { for (let i = 0; i < n; i++) st = turn(st, a, b); return st; };
  const pick = (f, keys) => Object.fromEntries(keys.map((k) => [k, f.stages[k]]));
  const eq = (got, want) => JSON.stringify(got) === JSON.stringify(want) ? true : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`;
  const BOTH = [["오기", "atk"], ["승기", "spa"]];
  // 방어측 보유자(b): a가 기술을 쓴다. 대기는 보유자 쪽 잠꼬대.
  const asDef = (ab, move, { n = 1, prep, extra = {} } = {}) => {
    const st = battle([P(move, extra.aAbility ?? "두꺼운지방"), BENCH()], [M("잠만보", [NOP, "대타출동"], ab, extra.bItem ?? null), BENCH()]);
    prep?.(st);
    return turns(st, move, NOP, n);
  };
  // 공격측 보유자(a): a가 기술을 쓴다. 방어측은 일반(또는 지정 특성).
  const asAtk = (ab, move, { bAbility = "두꺼운지방", prep, aItem = null } = {}) => {
    const st = battle([M("잠만보", [move, NOP], ab, aItem), BENCH()], [M("잠만보", [NOP], bAbility), BENCH()]);
    prep?.(st);
    return turn(st, move, NOP);
  };

  for (const [ab, key] of BOTH) {
    const tag = `D3-fix52 ${ab}`;
    // 1 E8-42: 자기 하락에는 발동하지 않는다
    guard(`${tag} 1: 보유자가 껍질깨기 — 발동 없음(atk·spa +2·def·spd −1·spe +2 그대로)`, () => eq(pick(asAtk(ab, "껍질깨기").a, ["atk", "def", "spa", "spd", "spe"]), { atk: 2, def: -1, spa: 2, spd: -1, spe: 2 }));
    guard(`${tag} 2: 보유자가 엄청난힘 — atk −1·def −1 그대로, ${key} 변화 없음`, () => { const f = asAtk(ab, "엄청난힘").a; return eq(pick(f, ["atk", "def", "spa"]), { atk: -1, def: -1, spa: 0 }); });
    // 3·4 접촉 반응(미끈미끈) — 3은 자기 반동과 함께: 접촉 하락만 센다
    guard(`${tag} 3: 보유자가 엄청난힘 + 방어측 미끈미끈 — 접촉 반응 하락 1회만(${key} +2)`, () => { const f = asAtk(ab, "엄청난힘", { bAbility: "미끈미끈" }).a; return f.stages[key] === (key === "atk" ? 1 : 2) && f.stages.spe === -1 ? true : JSON.stringify(f.stages); });
    guard(`${tag} 4: 보유자가 아이언헤드 + 방어측 미끈미끈 — ${key} +2·spe −1`, () => { const f = asAtk(ab, "아이언헤드", { bAbility: "미끈미끈" }).a; return f.stages[key] === 2 && f.stages.spe === -1 ? true : JSON.stringify(f.stages); });
    // 5 다중 하락: 간지르기(atk·def −1)
    guard(`${tag} 5: 간지르기(두 능력치) — ${ab === "오기" ? "atk +3·def −1" : "spa +4·atk −1·def −1"}`, () => { const f = asDef(ab, "간지르기").b; return ab === "오기" ? eq(pick(f, ["atk", "def", "spa"]), { atk: 3, def: -1, spa: 0 }) : eq(pick(f, ["atk", "def", "spa"]), { atk: -1, def: -1, spa: 4 }); });
    // 6 추억의선물(atk·spa −2)
    guard(`${tag} 6: 추억의선물(atk −2·spa −2) — ${ab === "오기" ? "atk +2·spa −2" : "atk −2·spa +2"}`, () => { const f = asDef(ab, "추억의선물").b; return ab === "오기" ? eq(pick(f, ["atk", "spa"]), { atk: 2, spa: -2 }) : eq(pick(f, ["atk", "spa"]), { atk: -2, spa: 2 }); });
    // 7 명중·회피 하락
    guard(`${tag} 7: 진흙뿌리기(명중 −1) — ${key} +2·명중 −1`, () => { const f = asDef(ab, "진흙뿌리기").b; return f.stages[key] === 2 && f.accuracyStages.accuracy === -1 ? true : JSON.stringify({ s: f.stages[key], a: f.accuracyStages }); });
    guard(`${tag} 7: 달콤한향기(회피 −2) — ${key} +2·회피 −2`, () => { const f = asDef(ab, "달콤한향기").b; return f.stages[key] === 2 && f.accuracyStages.evasion === -2 ? true : JSON.stringify({ s: f.stages[key], a: f.accuracyStages }); });
    // 8·9 턴 끝 지속 하락
    guard(`${tag} 8: 문어굳히기 3턴 — ${key} +4 → +6 → +6(상한)`, () => {
      let st = battle([P("문어굳히기"), BENCH()], [M("잠만보", [NOP, "대타출동"], ab), BENCH()]); const seq = [];
      for (let i = 0; i < 3; i++) { st = turn(st, "문어굳히기", NOP); seq.push(st.b.stages[key]); }
      return eq(seq, [4, 6, 6]);
    });
    guard(`${tag} 9: 시럽봄 2턴 — ${key} +2 → +4(턴 끝 스피드 하락마다)`, () => {
      let st = battle([P("시럽봄"), BENCH()], [M("잠만보", [NOP, "대타출동"], ab), BENCH()]); const seq = [];
      for (let i = 0; i < 2; i++) { st = turn(st, "시럽봄", NOP); seq.push(st.b.stages[key]); }
      return eq(seq, [2, 4]);
    });
    // 10 기절한 보유자(반응 능력치만 본다 — 엔진은 기절한 쪽의 하락도 적용하므로 spe는 보지 않는다, 검수 R3)
    guard(`${tag} 10: 기절한 보유자(HP 1 + 얼어붙은바람) — ${key} 무변화`, () => {
      const st = battle([P("얼어붙은바람"), BENCH()], [M("잠만보", [NOP], ab), BENCH()]); st.b.currentHp = 1;
      return turn(st, "얼어붙은바람", NOP).b.stages[key] === 0 ? true : "기절한 보유자에 발동";
    });
    // 11 회귀
    guard(`${tag} 11: 회귀 — 애교부리기·겁나는얼굴·얼어붙은바람 단일 하락 1회`, () => {
      const r = ["애교부리기", "겁나는얼굴", "얼어붙은바람"].map((m) => asDef(ab, m).b.stages[key]);
      return eq(r, ab === "오기" ? [0, 2, 2] : [2, 2, 2]); // 애교부리기는 atk −2 + 오기 +2 = 0, 승기는 spa +2
    });
    guard(`${tag} 11: 회귀 — 이미 −6이면(애교부리기 atk) 무발동 · 이미 +6이면 상한`, () => {
      const a = asDef(ab, "애교부리기", { prep: (s) => { s.b.stages = { ...s.b.stages, atk: -6 }; } }).b;
      const b = asDef(ab, "겁나는얼굴", { prep: (s) => { s.b.stages = { ...s.b.stages, [key]: 6 }; } }).b;
      return a.stages[key] === (key === "atk" ? -6 : 0) && b.stages[key] === 6 ? true : JSON.stringify({ a: a.stages[key], b: b.stages[key] });
    });
    guard(`${tag} 11: 회귀 — 대타가 막는 변화기(거짓울음) 무발동`, () => {
      let st = battle([P("거짓울음"), BENCH()], [M("잠만보", [NOP, "대타출동"], ab), BENCH()]);
      st = turn(st, NOP, "대타출동"); const before = st.b.stages[key];
      st = turn(st, "거짓울음", NOP);
      return st.b.stages[key] === before && st.b.stages.spd === 0 ? true : JSON.stringify(st.b.stages);
    });
    guard(`${tag} 11: 회귀 — 위협 시작 · 끈적끈적네트 등장은 1회`, () => {
      const start = battle([M("잠만보", [NOP], "위협"), BENCH()], [M("잠만보", [NOP], ab), BENCH()]);
      const s1 = turn(start, NOP, NOP).b.stages;
      const web = battle([P("끈적끈적네트"), BENCH()], [BENCH(), M("잠만보", [NOP], ab)]);
      let w = turn(web, "끈적끈적네트", NOP);
      w = rt.runTurn(w, mv("끈적끈적네트"), { kind: "switch", toIndex: 1 }, rnd); const s2 = (w.nextState ?? w.partialResult).b.stages;
      return ab === "오기" ? eq([s1.atk, s1.spe, s2.atk, s2.spe], [1, 0, 2, -1]) : eq([s1.atk, s1.spa, s2.spa, s2.spe], [-1, 2, 2, -1]);
    });
    // 12 미러아머 반사(보유자가 공격측 — 반사된 하락도 센다)
    guard(`${tag} 12: 미러아머에 겁나는얼굴 — 반사된 spe −2에 1회(${key} +2)`, () => { const st = battle([M("잠만보", ["겁나는얼굴", NOP], ab), BENCH()], [M("아머까오", [NOP], "미러아머"), BENCH()]); const f = turn(st, "겁나는얼굴", NOP).a; return f.stages[key] === 2 && f.stages.spe === -2 ? true : JSON.stringify(f.stages); });
    // 13~16 호출 위치 회귀 방지(R1): 하양허브·편승
    guard(`${tag} 13: 하양허브 보유자 + 얼어붙은바람 — ${key} +2·spe 0(오기가 허브보다 먼저)·허브 소모`, () => {
      const st = battle([P("얼어붙은바람"), BENCH()], [M("잠만보", [NOP], ab, "하양허브"), BENCH()]); const f = turn(st, "얼어붙은바람", NOP).b;
      return f.stages[key] === 2 && f.stages.spe === 0 && f.currentItemId === null ? true : JSON.stringify({ s: f.stages, item: f.currentItemId });
    });
    guard(`${tag} 14: 하양허브 보유자 + 간지르기 — ${ab === "오기" ? "atk +3" : "spa +4"}·atk/def 하락은 허브가 0으로`, () => {
      const st = battle([P("간지르기"), BENCH()], [M("잠만보", [NOP], ab, "하양허브"), BENCH()]); const f = turn(st, "간지르기", NOP).b;
      return f.stages[key] === (ab === "오기" ? 3 : 4) && f.stages.def === 0 ? true : JSON.stringify(f.stages);
    });
    guard(`${tag} 15: 상대 편승 + 얼어붙은바람 — 보유자 ${key} +2, 상대가 +2 복사`, () => {
      const st = battle([M("잠만보", ["얼어붙은바람", NOP], "편승"), BENCH()], [M("잠만보", [NOP], ab), BENCH()]); const s = turn(st, "얼어붙은바람", NOP);
      return s.b.stages[key] === 2 && s.a.stages[key] === 2 ? true : JSON.stringify({ b: s.b.stages[key], a: s.a.stages[key] });
    });
    guard(`${tag} 16: 상대 편승 + 진흙뿌리기(명중 −1) — 보유자 ${key} +2·상대 복사`, () => {
      const st = battle([M("잠만보", ["진흙뿌리기", NOP], "편승"), BENCH()], [M("잠만보", [NOP], ab), BENCH()]); const s = turn(st, "진흙뿌리기", NOP);
      return s.b.stages[key] === 2 && s.a.stages[key] === 2 && s.b.accuracyStages.accuracy === -1 ? true : JSON.stringify({ b: s.b.stages[key], a: s.a.stages[key] });
    });
    // 17 다단 접촉: 히트마다 발동(R2)
    guard(`${tag} 17: 보유자가 더블어택 → 방어측 미끈미끈 — 히트마다 발동(${key} +4·spe −2)`, () => { const f = asAtk(ab, "더블어택", { bAbility: "미끈미끈" }).a; return f.stages[key] === 4 && f.stages.spe === -2 ? true : JSON.stringify(f.stages); });
    // 18 뒤집어엎기는 발동하지 않는다(비교 끝점이 뒤)
    guard(`${tag} 18: 보유자 ${key} +2 뒤 상대 뒤집어엎기 — ${key} −2, 무발동`, () => {
      const st = battle([P("뒤집어엎기"), BENCH()], [M("잠만보", [NOP], ab), BENCH()]); st.b.stages = { ...st.b.stages, [key]: 2 };
      return turn(st, "뒤집어엎기", NOP).b.stages[key] === -2 ? true : "발동함";
    });
    // 19 하양허브 보유자(공격측)가 미끈미끈에 접촉
    guard(`${tag} 19: 하양허브 보유자(공격측)가 미끈미끈에 접촉 — ${key} +2·spe 0(허브가 −1을 되돌림)`, () => { const f = asAtk(ab, "아이언헤드", { bAbility: "미끈미끈", aItem: "하양허브" }).a; return f.stages[key] === 2 && f.stages.spe === 0 ? true : JSON.stringify(f.stages); });
  }
}
