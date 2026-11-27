// 8.3 D3-fix-49 (E8-30·31·36·34·35·33·37·39·38) 등장 처리 경로 정합. 설계 `8.3-D3-fix49-등장처리경로설계.md` §3, 검수 `…-검수.md`.
//  ① 위협(대타·배짱)·하양허브 즉시 복구(시험 1~13) — 이 파일에 ① 단계만 먼저 쓴다. ②(14~17)는 ② 착수 때 추가했고 ③(18)도 ③ 착수 때 추가했고 ④(19~22)도 ④ 착수 때 추가했고 ⑤(23~25)도 ⑤ 착수 때 추가했다.
export default async function ({ server, data, mon, battle, pts, check, state }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const sw1 = { kind: "switch", toIndex: 1 };
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const tank = pts({ hp: 32, def: 32 });
  const hitter = pts({ atk: 32, spe: 32 }); // 선공 박치기 역할(허브 보유 방어측)
  const fast = (st) => { st.b.realStats = { ...st.b.realStats, spe: 999 }; return st; };
  const noMove = () => 0.5;

  // 교체 등장 장면: a 라이츄(활성)·갸라도스(예비) → a가 1번으로 교체. b는 잠만보.
  const mkSwitch = ({ aSpare = mon("갸라도스", ["칼춤"], "위협", null, tank), b = mon("잠만보", ["아이언헤드"], null, null, hitter) } = {}) =>
    battle([mon("라이츄", ["칼춤"]), aSpare], [b, mon("잠만보", ["칼춤"])]);
  // 시작 장면: a 갸라도스(위협) vs b
  const mkStart = ({ a = mon("갸라도스", ["칼춤"], "위협", null, tank), b = mon("잠만보", ["아이언헤드"], null, null, hitter) } = {}) => battle([a], [b]);
  const entered = (st) => { const log = []; sw.performSwitch(st, "a", 1, log); return log; };
  const allZero = (f) => Object.values(f.stages).every((v) => v === 0);

  // ── 1 위협 × 대타(교체 등장) ──
  guard("D3-fix49 1: 위협 × 대타 — 상대 공격 불변·로그 한 줄(효과 없음)", () => {
    const st = mkSwitch(); st.b.substituteHp = 50; const log = entered(st);
    return st.b.stages.atk === 0 && log.some((l) => l.includes("효과가 없었다")) ? true : JSON.stringify({ atk: st.b.stages.atk, log });
  });
  // ── 2 위협 × 대타 × 반응 특성·미러아머·하양허브 전부 미발동 ──
  guard("D3-fix49 2: 위협 × 대타 × 오기·승기·주눅·파수견·미러아머·하양허브 — 랭크·도구 불변", () => {
    const bad = [];
    for (const ab of ["오기", "승기", "주눅", "파수견", "미러아머"]) {
      const st = mkSwitch({ b: mon("잠만보", ["칼춤"], ab) }); st.b.substituteHp = 50; entered(st);
      if (!allZero(st.b) || !allZero(st.a)) bad.push(`${ab}: b=${JSON.stringify(st.b.stages)} a.atk=${st.a.stages.atk}`);
    }
    const st = mkSwitch({ b: mon("잠만보", ["칼춤"], null, "하양허브") }); st.b.substituteHp = 50; entered(st);
    if (!allZero(st.b) || st.b.itemConsumed) bad.push(`하양허브: atk=${st.b.stages.atk} consumed=${st.b.itemConsumed}`);
    return bad.length === 0 ? true : bad.join(" | ");
  });
  // ── 3 위협 × 배짱(시작·교체) ──
  guard("D3-fix49 3: 위협 × 배짱 — 시작·교체 모두 공격 불변 + 효과 없음 로그", () => {
    const s = mkStart({ b: mon("잠만보", ["칼춤"], "배짱") });
    const w = mkSwitch({ b: mon("잠만보", ["칼춤"], "배짱") }); const log = entered(w);
    return s.b.stages.atk === 0 && w.b.stages.atk === 0 && log.some((l) => l.includes("배짱")) ? true : JSON.stringify({ start: s.b.stages.atk, sw: w.b.stages.atk, log });
  });
  // ── 4 회귀: 기존 면역 3종·배짱의 명중 효과 ──
  guard("D3-fix49 4: 회귀 — 정신력·둔감·마이페이스는 계속 위협 면역 / 배짱의 고스트 노말·격투 명중(bypassesImmunityForTypes) 유지", () => {
    const bad = [];
    for (const ab of ["정신력", "둔감", "마이페이스"]) { const st = mkSwitch({ b: mon("잠만보", ["칼춤"], ab) }); entered(st); if (st.b.stages.atk !== 0) bad.push(ab); }
    const gut = data.getAbility("배짱");
    if (JSON.stringify(gut?.bypassesImmunityForTypes) !== JSON.stringify(["노말", "격투"])) bad.push("배짱 명중 효과 변동");
    return bad.length === 0 ? true : bad.join(",");
  });

  // 하양허브 보유자가 위협을 받은 뒤 선공 박치기: 허브 있음 피해 > 허브 없음 피해(허브가 위협 −1을 즉시 지워서). 반환: 피해·허브 소모·공격 랭크
  const herbHit = (kind, herb) => {
    const b = mon("잠만보", ["아이언헤드"], null, herb ? "하양허브" : null, hitter);
    if (kind === "start") {
      const st = fast(mkStart({ b })); const after = { atk: st.b.stages.atk, used: !!st.b.itemConsumed };
      const o = rt.runTurn(st, mv("칼춤"), mv("아이언헤드"), noMove); return { ...after, dmg: st.a.maxHp - o.nextState.a.currentHp };
    }
    if (kind === "switch") {
      const st = fast(mkSwitch({ b })); const o = rt.runTurn(st, sw1, mv("아이언헤드"), noMove);
      return { atk: o.nextState.b.stages.atk, used: !!o.nextState.b.itemConsumed, dmg: o.nextState.a.maxHp - o.nextState.a.currentHp };
    }
    // mega: a 썬더볼트(메가 위협) → 메가진화 직후 위협
    const st = fast(battle([mon("썬더볼트", ["칼춤"], null, "썬더볼트나이트", tank)], [b]));
    const o = rt.runTurn(st, { kind: "move", move: data.getMove("칼춤"), mega: true }, mv("아이언헤드"), noMove);
    return { atk: o.nextState.b.stages.atk, used: !!o.nextState.b.itemConsumed, dmg: o.nextState.a.maxHp - o.nextState.a.currentHp };
  };
  const herbCase = (kind) => () => {
    const w = herbHit(kind, true), n = herbHit(kind, false);
    return w.dmg > n.dmg && w.used && !n.used && w.atk === 0 ? true : JSON.stringify({ 허브있음: w, 허브없음: n });
  };
  guard("D3-fix49 5: 하양허브 × 위협(시작) — 위협 직후 복구·소모, 첫 공격 피해가 허브 없을 때보다 크다(H1)", herbCase("start"));
  guard("D3-fix49 6: 하양허브 × 위협(교체 등장) — 5와 같음(H2)", herbCase("switch"));
  guard("D3-fix49 7: 하양허브 × 위협(메가 등장, 메가썬더볼트) — 5와 같음(H3)", herbCase("mega"));
  // ── 8 끈적끈적네트 ──
  guard("D3-fix49 8: 하양허브 보유 포켓몬이 끈적끈적네트 위로 교체 등장 — 스피드 −1을 즉시 복구·소모(H4)", () => {
    const st = battle([mon("라이츄", ["칼춤"])], [mon("라이츄", ["칼춤"]), mon("잠만보", ["칼춤"], null, "하양허브")]);
    st.sideB.hazards.stickyWeb = true; const log = []; sw.performSwitch(st, "b", 1, log);
    return st.b.stages.spe === 0 && st.b.itemConsumed === true ? true : JSON.stringify({ spe: st.b.stages.spe, used: st.b.itemConsumed, log });
  });
  // ── 9 양쪽 위협, 한쪽만 하양허브(시작) ──
  guard("D3-fix49 9: 양쪽 위협 × 한쪽만 하양허브(시작) — 허브 보유자 공격 0·소모, 허브 없는 쪽 −1 유지(좌우 반전도)", () => {
    const gy = (item) => mon("갸라도스", ["칼춤"], "위협", item, tank);
    const l = battle([gy("하양허브")], [gy(null)]), r = battle([gy(null)], [gy("하양허브")]);
    const okL = l.a.stages.atk === 0 && l.a.itemConsumed === true && l.b.stages.atk === -1;
    const okR = r.b.stages.atk === 0 && r.b.itemConsumed === true && r.a.stages.atk === -1;
    return okL && okR ? true : JSON.stringify({ L: [l.a.stages.atk, l.a.itemConsumed, l.b.stages.atk], R: [r.a.stages.atk, r.b.stages.atk, r.b.itemConsumed] });
  });
  // ── 10 곡예 ──
  guard("D3-fix49 10: 곡예 보유 하양허브가 위협으로 소모되면 스피드 2배 문구(교체 등장)", () => {
    const st = mkSwitch({ b: mon("잠만보", ["칼춤"], "곡예", "하양허브") }); const log = entered(st);
    return st.b.itemConsumed === true && st.b.unburdenActive === true && log.some((l) => l.includes("2배")) ? true : JSON.stringify({ used: st.b.itemConsumed, unburden: st.b.unburdenActive, log });
  });
  // ── 11 회귀 ──
  guard("D3-fix49 11: 회귀 — 하양허브 없음은 위협 −1 유지 / 위협 없음이면 허브 유지 / 행동 끝 기존 복구(랭크 −1 + 행동) 불변", () => {
    const none = mkSwitch(); entered(none);
    const noInt = mkSwitch({ aSpare: mon("잠만보", ["칼춤"], null, null, tank), b: mon("잠만보", ["칼춤"], null, "하양허브") }); entered(noInt);
    const act = battle([mon("라이츄", ["칼춤"])], [mon("잠만보", ["칼춤"], null, "하양허브")]); act.b.stages = { ...act.b.stages, atk: -1 };
    const o = rt.runTurn(act, mv("칼춤"), mv("칼춤"), noMove);
    return none.b.stages.atk === -1 && !noInt.b.itemConsumed && o.nextState.b.itemConsumed === true ? true : JSON.stringify({ none: none.b.stages.atk, noInt: noInt.b.itemConsumed, act: o.nextState.b.itemConsumed });
  });
  // ── 12 D1 자발 동시 교체 ──
  guard("D3-fix49 12: 자발 동시 교체 — 네트로 −1 → 허브 소모 → 상대 위협 −1은 남는다(Showdown D1: 공격 −1·허브 소모)", () => {
    const st = battle(
      [mon("라이츄", ["칼춤"]), mon("잠만보", ["칼춤"], null, "하양허브")],
      [mon("라이츄", ["칼춤"]), mon("갸라도스", ["칼춤"], "위협", null, tank)],
    );
    st.sideA.hazards.stickyWeb = true; st.a.realStats = { ...st.a.realStats, spe: 999 }; st.b.realStats = { ...st.b.realStats, spe: 1 };
    const o = rt.runTurn(st, sw1, sw1, noMove);
    const a = o.nextState.a;
    return a.itemConsumed === true && a.stages.spe === 0 && a.stages.atk === -1 ? true : JSON.stringify({ used: a.itemConsumed, spe: a.stages.spe, atk: a.stages.atk });
  });
  // ── 13 유턴류 동시 교체 묶음: 한 묶음의 끝에서 허브 1회 ──
  guard("D3-fix49 13: 유턴류 동시 교체 묶음 — 네트 −1과 위협 −1을 묶음 끝 허브 1회로 함께 복구(설계 R1, Showdown `runSwitch` 연속 묶음)", () => {
    const rbn = (x) => ({ kind: "move", move: data.getMove(x) });
    const a = mon("핫삼", ["유턴"], null, null, pts({ atk: 32, spe: 32, hp: 2 }));
    const b = mon("잠만보", ["칼춤", "방어"], null, "탈출버튼", { ...tank, spe: 0 });
    const st = battle([a, mon("잠만보", ["칼춤"], null, "하양허브")], [b, mon("갸라도스", ["칼춤"], "위협", null, tank)]);
    st.sideA.hazards.stickyWeb = true;
    let out = rt.runTurn(st, rbn("유턴"), rbn("칼춤"), noMove);
    for (let g = 0; "awaitingSelfSwitch" in out && g < 5; g++) out = rt.resumeTurn(out._ctx, 1);
    const f = out.nextState.a;
    return f.itemConsumed === true && f.stages.spe === 0 && f.stages.atk === 0 ? true : JSON.stringify({ used: f.itemConsumed, spe: f.stages.spe, atk: f.stages.atk });
  });
  // ══ ② 트레이스 (E8-34·35, R2·R3) ══
  const TRACE = (item = null, p = pts()) => mon("코터스", ["방어"], "트레이스", item, p);
  const GY = (ability = "위협", item = null) => mon("갸라도스", ["방어"], ability, item, tank);
  // ── 14 트레이스가 위협을 복사하면 즉시 발동 ──
  guard("D3-fix49 14: 트레이스가 위협 복사(시작·교체·메가후딘) — 복사 직후 상대 공격 −1", () => {
    const bad = [];
    const s = battle([TRACE()], [GY()]);
    if (!(s.b.stages.atk === -1 && s.a.stages.atk === -1 && s.a.effectiveAbilityId === "위협")) bad.push(`시작 b=${s.b.stages.atk} a=${s.a.stages.atk} ab=${s.a.effectiveAbilityId}`);
    const w = battle([mon("라이츄", ["방어"]), TRACE()], [GY()]); const log = []; sw.performSwitch(w, "a", 1, log);
    if (!(w.b.stages.atk === -1 && w.a.effectiveAbilityId === "위협")) bad.push(`교체 b=${w.b.stages.atk} ab=${w.a.effectiveAbilityId}`);
    const m = battle([mon("후딘", ["방어"], null, "후딘나이트", tank)], [GY()]);
    const o = rt.runTurn(m, { kind: "move", move: data.getMove("방어"), mega: true }, mv("방어"), noMove);
    if (!(o.nextState.b.stages.atk === -1 && o.nextState.a.effectiveAbilityId === "위협")) bad.push(`메가 b=${o.nextState.b.stages.atk} ab=${o.nextState.a.effectiveAbilityId}`);
    return bad.length === 0 ? true : bad.join(" | ");
  });
  // ── 15 시작 장면 복사한 날씨·필드의 주인(날씨 바위·필드연장 판정 대상) ──
  guard("D3-fix49 15: 시작 트레이스 날씨(R2) — TW1 트레이스 빠름·바위 8턴 / TW2 느림 5턴 / TW3 빠름·상대 바위 5턴, 필드 TW4 트레이스 빠름·그라운드코트 8턴 / 느림 5턴", () => {
    const fastP = pts({ spe: 32 }), slowP = pts({ spe: 0 });
    const droughtMon = (item, p) => mon("코터스", ["방어"], "가뭄", item, p);
    const weather = (a, b) => { const s = battle([a], [b]); return `${s.weather}${s.weatherTurnsRemaining}`; };
    const w1 = weather(TRACE("뜨거운바위", fastP), droughtMon(null, slowP));
    const w2 = weather(TRACE("뜨거운바위", slowP), droughtMon(null, fastP));
    const w3 = weather(TRACE(null, fastP), droughtMon("뜨거운바위", slowP));
    const psy = (item, p) => mon("코터스", ["방어"], "사이코메이커", item, p);
    const field = (a, b) => { const s = battle([a], [b]); return `${s.field}${s.fieldTurnsRemaining}`; };
    const f1 = field(TRACE("그라운드코트", fastP), psy(null, slowP));
    const f2 = field(TRACE("그라운드코트", slowP), psy(null, fastP));
    const got = { w1, w2, w3, f1, f2 }, want = { w1: "쾌청8", w2: "쾌청5", w3: "쾌청5", f1: "사이코필드8", f2: "사이코필드5" };
    return JSON.stringify(got) === JSON.stringify(want) ? true : JSON.stringify({ got, want });
  });
  // ── 16 대기 중인 트레이스는 상대가 복사 가능한 특성으로 교체해 오면 그때 복사(TR2) — 재시도는 하양허브 반응보다 먼저(TRW1, R3) ──
  guard("D3-fix49 16: 트레이스 대기 → 상대 교체로 위협 등장 시 복사·발동 / 허브 있는 갸라도스면 복사 위협 −1을 같은 처리 안에서 복구", () => {
    const run = (herb) => {
      const st = battle([mon("후딘", ["방어"], "트레이스", null, tank)], [mon("잠만보", ["방어"], "탈"), GY("위협", herb ? "하양허브" : null)]);
      const waiting = st.a.effectiveAbilityId === "트레이스";
      const o = rt.runTurn(st, mv("방어"), sw1, noMove).nextState;
      return { waiting, abil: o.a.effectiveAbilityId, bAtk: o.b.stages.atk, aAtk: o.a.stages.atk, herbUsed: !!o.b.itemConsumed };
    };
    const n = run(false), h = run(true);
    const ok = n.waiting && n.abil === "위협" && n.bAtk === -1 && n.aAtk === -1 && h.bAtk === 0 && h.herbUsed && h.aAtk === -1;
    return ok ? true : JSON.stringify({ 허브없음: n, 허브있음: h });
  });
  // ── 17 회귀 ──
  guard("D3-fix49 17: 회귀 — 상대가 복사 불가 특성(탈)이면 대기 유지·양쪽 트레이스는 서로 복사 안 함", () => {
    const w = battle([mon("후딘", ["방어"], "트레이스")], [mon("잠만보", ["방어"], "탈")]);
    const t = battle([mon("후딘", ["방어"], "트레이스")], [mon("후딘", ["방어"], "트레이스")]);
    return w.a.effectiveAbilityId === "트레이스" && t.a.effectiveAbilityId === "트레이스" && t.b.effectiveAbilityId === "트레이스" ? true : JSON.stringify([w.a.effectiveAbilityId, t.a.effectiveAbilityId, t.b.effectiveAbilityId]);
  });
  // ══ ③ 변환자재 메가 재발동 (E8-33) ══
  // ── 18 ──
  guard("D3-fix49 18: 변환자재 메가 재발동(R7) — 얼음 → 메가진화 → 악의파동 → 악 / 메가 없이는 1회라 얼음 유지 / 교체 복귀 재발동(R3) 회귀", () => {
    const mk = (item) => battle([mon("개굴닌자", ["냉동빔", "악의파동"], "변환자재", item, tank), mon("라이츄", ["방어"])], [mon("잠만보", ["방어"], null, null, tank)]);
    const turn = (st, move, mega = false) => rt.runTurn(st, { kind: "move", move: data.getMove(move), ...(mega ? { mega: true } : {}) }, mv("방어"), noMove).nextState;
    const t = (st) => JSON.stringify(st.a.types);
    const m1 = turn(mk("개굴닌자나이트"), "냉동빔"), m2 = turn(m1, "악의파동", true);
    const n1 = turn(mk(null), "냉동빔"), n2 = turn(n1, "악의파동");
    // 교체 복귀: 냉동빔 → 라이츄로 교체 → 개굴닌자로 복귀 → 악의파동 → 악(등장당 1회)
    let r = turn(mk(null), "냉동빔");
    r = rt.runTurn(r, sw1, mv("방어"), noMove).nextState;
    r = rt.runTurn(r, { kind: "switch", toIndex: 0 }, mv("방어"), noMove).nextState;
    r = turn(r, "악의파동");
    const got = { 메가전: t(m1), 메가후: t(m2), 메가없음: t(n2), 교체복귀: t(r) };
    const want = { 메가전: '["얼음"]', 메가후: '["악"]', 메가없음: '["얼음"]', 교체복귀: '["악"]' };
    return JSON.stringify(got) === JSON.stringify(want) ? true : JSON.stringify({ got, want });
  });
  // ══ ④ 시작 등장 순서 — 동률 무작위(E8-37)·스피드 보정(E8-39) ══
  const make = (a, b, random) => state.createBattleState({ a: { slots: a.map((m) => m.slot), movesList: a.map((m) => m.moves) }, b: { slots: b.map((m) => m.slot), movesList: b.map((m) => m.moves) } }, random);
  const KT = (ability, item = null, p = pts()) => mon("코터스", ["방어"], ability, item, p); // 같은 종 — 원시 스피드는 노력치로만 갈린다
  // ── 19 ──
  guard("D3-fix49 19: 동속 시작(SP3) — 난수 0이면 a 먼저(잔비가 나중에 덮음 → 비), 0.99면 b 먼저(가뭄 a가 나중에 덮음 → 쾌청)", () => {
    const w = (r) => make([KT("가뭄")], [KT("잔비")], () => r).weather;
    const got = { 영: w(0), 거의1: w(0.99) };
    return got.영 === "비" && got.거의1 === "쾌청" ? true : JSON.stringify(got);
  });
  // ── 20 ──
  guard("D3-fix49 20: 비동속이면 난수를 한 번도 안 부른다 / 난수 인자가 없으면 a 먼저(기존 동작)", () => {
    let calls = 0; const r = () => { calls++; return 0.5; };
    const diff = make([KT("가뭄", null, pts({ spe: 32 }))], [KT("잔비", null, pts({ spe: 0 }))], r);
    const none = make([KT("가뭄")], [KT("잔비")]); // 동속 + 난수 없음 → a 먼저 → 나중인 b(잔비)가 덮음
    return calls === 0 && diff.weather === "비" && none.weather === "비" ? true : JSON.stringify({ calls, diff: diff.weather, none: none.weather });
  });
  // ── 21 ──
  guard("D3-fix49 21: 날씨와 위협·트레이스 순서가 같은 동률 결과를 공유한다(난수 호출 정확히 1회)", () => {
    let calls = 0; const r = () => { calls++; return 0.99; };
    make([KT("가뭄")], [KT("트레이스")], r);
    return calls === 1 ? true : `calls=${calls}`;
  });
  // ── 22 ──
  guard("D3-fix49 22: 스피드 보정(E8-39) — SP1 스카프 잔비(원시 낮음)가 먼저 처리돼 가뭄이 덮음 → 쾌청 / SP1b 스카프 없음 → 비 / 검은철구는 반대", () => {
    const rainLow = (item, ab = "잔비") => KT(ab, item, pts({ spe: 20 })), sunHigh = () => KT("가뭄", null, pts({ spe: 32 }));
    const pre = rainLow(null).slot && make([rainLow("구애스카프")], [sunHigh()]);
    const sp = pre.a.realStats.spe, hi = pre.b.realStats.spe;
    if (!(sp < hi && Math.floor(sp * 1.5) > hi)) return `전제 실패 ${sp} ${hi}`;
    const sp1 = make([rainLow("구애스카프")], [sunHigh()]).weather;
    const sp1b = make([rainLow(null)], [sunHigh()]).weather;
    // 검은철구: 원시가 높은 쪽(a 잔비)이 철구로 느려져 b가 먼저 → a의 비가 덮음
    const ball = make([KT("잔비", "검은철구", pts({ spe: 32 }))], [KT("가뭄", null, pts({ spe: 20 }))]).weather;
    const got = { sp1, sp1b, ball };
    return sp1 === "쾌청" && sp1b === "비" && ball === "비" ? true : JSON.stringify(got);
  });

  // ══ ⑤ 감미로운꿀 교체·메가 등장 + 1회·대타·심술꾸러기 (E8-38) ══
  const syrupMon = () => mon("코터스", ["방어"], "감미로운꿀");
  const evasion = (f) => f.accuracyStages.evasion;
  // ── 23 ──
  guard("D3-fix49 23: 감미로운꿀 교체 등장(SY3) — 상대 회피율 −1", () => {
    const st = battle([mon("라이츄", ["방어"]), syrupMon()], [mon("잠만보", ["방어"])]); sw.performSwitch(st, "a", 1, []);
    return evasion(st.b) === -1 ? true : `evasion=${evasion(st.b)}`;
  });
  // ── 24 ──
  guard("D3-fix49 24: 같은 포켓몬 재등장은 무발동(SY2) / 트레이스가 복사해 발동한 뒤 물러났다 돌아와 다시 복사해도 무발동(SY6·SY7)", () => {
    const st = battle([mon("라이츄", ["방어"]), syrupMon()], [mon("잠만보", ["방어"])]);
    sw.performSwitch(st, "a", 1, []); st.b.accuracyStages = { ...st.b.accuracyStages, evasion: 0 };
    sw.performSwitch(st, "a", 0, []); sw.performSwitch(st, "a", 1, []);
    const re = evasion(st.b);
    const tr = battle([mon("후딘", ["방어"], "트레이스"), mon("라이츄", ["방어"])], [mon("잠만보", ["방어"], "감미로운꿀")]);
    const first = evasion(tr.b); // 시작: 트레이스가 복사해 발동
    sw.performSwitch(tr, "a", 1, []); tr.b.accuracyStages = { ...tr.b.accuracyStages, evasion: 0 };
    sw.performSwitch(tr, "a", 0, []);
    const again = evasion(tr.b); // 재등장 후 다시 복사 — 무발동
    return re === 0 && first === -1 && again === 0 ? true : JSON.stringify({ re, first, again });
  });
  // ── 25 ──
  guard("D3-fix49 25: 감미로운꿀 × 대타(SY4: 변화 없음·플래그는 섬) · 심술꾸러기(SY5: 회피율 +1)", () => {
    const sub = battle([mon("라이츄", ["방어"]), syrupMon()], [mon("잠만보", ["방어"])]); sub.b.substituteHp = 50;
    sw.performSwitch(sub, "a", 1, []); const subEv = evasion(sub.b);
    sub.b.substituteHp = undefined; sw.performSwitch(sub, "a", 0, []); sw.performSwitch(sub, "a", 1, []); const again = evasion(sub.b); // 대타 앞에서도 소모 → 재등장 무발동
    const ct = battle([mon("라이츄", ["방어"]), syrupMon()], [mon("잠만보", ["방어"], "심술꾸러기")]); sw.performSwitch(ct, "a", 1, []);
    return subEv === 0 && again === 0 && evasion(ct.b) === 1 ? true : JSON.stringify({ subEv, again, contrary: evasion(ct.b) });
  });
}
