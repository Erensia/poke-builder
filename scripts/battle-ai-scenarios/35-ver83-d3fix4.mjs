// 8.3 D3-fix-4 불새 2턴 충전(Showdown champions `965a535` 대조): 불새는 `flags.charge` 기술 — 1턴째 준비만(데미지·명중 판정 없음, PP 1 소모), 2턴째 발동.
// 날씨 생략·능력치 상승·숨음이 없고(파워풀허브는 champions에서 Past라 쓸 수 없다), 준비 중에는 교체·다른 기술 선택이 불가하다. 엔진 코드는 그대로고 `moves.json`에 `chargeTurn: true`만 더한다.
// 설계 `8.3-D3-fix4-불새충전설계.md`, 검수 `8.3-D3-fix4-불새충전설계-검수.md`
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const M = (n) => data.getMove(n);
  const mv = (n) => ({ kind: "move", move: M(n) });
  const IDLE = "도우미";
  const bulky = pts({ hp: 32, def: 32, spd: 32 });
  const fast = pts({ atk: 32, spe: 32 }), slow = pts({ atk: 32 });
  const act = (o, who = "a") => (o.result ?? o.partialResult).actions.find((x) => x.actor === who);

  // ── 데이터 ──
  { const s = M("불새");
    check("D3-fix4 데이터: 불새 chargeTurn true, 날씨 생략·숨음·능력치 상승 필드 없음", s.chargeTurn === true && s.chargeSkipWeather === undefined && s.chargeHideType === undefined && s.chargeStatChanges === undefined, json({ ct: s.chargeTurn, w: s.chargeSkipWeather, h: s.chargeHideType, st: s.chargeStatChanges }));
    check("D3-fix4 데이터: 불새 나머지 값 불변(140·명중 90·PP 8·급소 높음·풀죽음 30%·비접촉)", s.power === 140 && s.accuracy === 90 && s.pp === 8 && s.highCritRatio === true && json(s.inflictsVolatile) === json([{ volatile: "flinch", target: "opponent", chance: 30 }]) && s.makesContact === false, json(s)); }
  { const all = JSON.parse((await import("node:fs")).readFileSync(new URL("../../src/data/moves.json", import.meta.url), "utf8"));
    const got = all.filter((m) => m.chargeTurn).map((m) => m.name).sort();
    const want = ["솔라빔", "다이빙", "고스트다이브", "구멍파기", "공중날기", "뛰어오르기", "메테오빔", "솔라블레이드", "일렉트로빔", "불새"].sort(); // Showdown flags.charge 10개(champions 사용 가능)
    check("D3-fix4 데이터: chargeTurn 기술 집합 = Showdown flags.charge 10개", json(got) === json(want), got.join(",")); }

  // ── 공통 실행기: 불새 사용자 a(예비 피카츄) vs b ──
  const setup = ({ bMove = IDLE, aPts = fast, bPts = bulky, aAbility = null, bAbility = null, tweak } = {}) => {
    const st = battle([mon("한카리아스", ["불새", "잠꼬대"], aAbility, null, aPts), mon("피카츄", [IDLE])], [mon("잠만보", [bMove, IDLE, "방어"], bAbility, null, bPts)]);
    tweak?.(st); return st;
  };
  const turn = (st, aAct, bMoveName, rand = () => 0.5) => { const o = rt.runTurn(st, aAct, mv(bMoveName), rand); return { o, n: o.nextState, a: act(o), b: act(o, "b") }; };

  // ── 1턴째: 준비만 ──
  const st1 = setup();
  const hp0 = st1.b.currentHp;
  const t1 = turn(st1, mv("불새"), IDLE);
  check("D3-fix4 1턴째: 준비만 — 데미지 0·상대 HP 불변·charging·준비 중 상태·PP −1", t1.a.charging === true && t1.n.b.currentHp === hp0 && t1.n.a.chargingMoveId === "불새" && t1.n.a.remainingPp["불새"] === 7, json({ ch: t1.a.charging, hp: t1.n.b.currentHp - hp0, id: t1.n.a.chargingMoveId, pp: t1.n.a.remainingPp["불새"] }));
  // ── 2턴째: 발동 ──
  const t2 = turn(t1.n, mv("불새"), IDLE);
  check("D3-fix4 2턴째: 발동 — 데미지 > 0·준비 상태 해제·PP 추가 소모 없음", t2.n.b.currentHp < hp0 && t2.n.a.chargingMoveId === undefined && t2.n.a.remainingPp["불새"] === 7 && !t2.a.charging, json({ dmg: hp0 - t2.n.b.currentHp, id: t2.n.a.chargingMoveId, pp: t2.n.a.remainingPp["불새"] }));
  // 한 번 쓴 뒤에는 다시 1턴째부터
  { const t3 = turn(t2.n, mv("불새"), IDLE); check("D3-fix4 연속 사용: 발동 뒤 다시 쓰면 또 준비부터(PP −1)", t3.a.charging === true && t3.n.a.remainingPp["불새"] === 6, json({ ch: t3.a.charging, pp: t3.n.a.remainingPp["불새"] })); }

  // ── 날씨: 쾌청·비에서도 1턴째는 준비만(chargeSkipWeather 없음) ──
  for (const weather of ["쾌청", "비"]) { const st = setup({ tweak: (s) => { s.weather = weather; s.weatherTurnsRemaining = 5; } }); const r = turn(st, mv("불새"), IDLE);
    check(`D3-fix4 날씨: ${weather}에서도 1턴째는 준비만`, r.a.charging === true && r.n.b.currentHp === st.b.currentHp, json({ ch: r.a.charging })); }

  // ── 준비 중 입력 무시: 교체를 입력해도 불새가 발동한다 ──
  { const r = turn(t1.n, { kind: "switch", toIndex: 1 }, IDLE);
    check("D3-fix4 준비 중 교체 입력 무시: 활성 포켓몬 그대로, 불새 발동", r.n.a.slot.pokemonId === "한카리아스" && r.n.b.currentHp < hp0 && r.a.move.name === "불새", json({ id: r.n.a.slot.pokemonId, mv: r.a?.move?.name })); }
  { const r = turn(t1.n, mv("잠꼬대"), IDLE);
    check("D3-fix4 준비 중 다른 기술 입력 무시: 불새 발동", r.a.move.name === "불새" && r.n.b.currentHp < hp0, json({ mv: r.a.move.name })); }

  // ── 방어: 1턴째 방어는 무관, 2턴째 방어는 막힘(충전은 소모) ──
  { const a1 = turn(setup({ bMove: "방어" }), mv("불새"), "방어");
    check("D3-fix4 방어: 준비 턴의 상대 방어는 준비를 막지 않는다", a1.a.charging === true && a1.n.a.chargingMoveId === "불새", json({ ch: a1.a.charging }));
    const a2 = turn(t1.n, mv("불새"), "방어");
    check("D3-fix4 방어: 2턴째 방어에 막힘 → 데미지 0, 준비 해제, PP는 1회분만 소모", a2.a.blockedByProtectMoveName === "방어" && a2.n.b.currentHp === hp0 && a2.n.a.chargingMoveId === undefined && a2.n.a.remainingPp["불새"] === 7, json({ br: a2.a.blockedByProtectMoveName, id: a2.n.a.chargingMoveId, pp: a2.n.a.remainingPp["불새"] }));
    const a3 = turn(a2.n, mv("잠꼬대"), IDLE);
    check("D3-fix4 방어로 막힌 뒤: 잠금이 풀려 다음 턴에는 다른 기술을 고를 수 있다", a3.a.move.name === "잠꼬대", json({ mv: a3.a.move.name })); }

  // ── 발동 중단: 2턴째에 풀죽음으로 못 움직이면 준비가 해제된다 ──
  { const flinchers = turn(setup({ aPts: slow, bPts: pts({ atk: 32, spe: 32, hp: 32 }), bMove: "물기" }), mv("불새"), IDLE); // 1턴째는 상대 도우미 → 준비 성립
    check("D3-fix4 발동 중단(준비): 1턴째 성립", flinchers.n.a.chargingMoveId === "불새", json({ id: flinchers.n.a.chargingMoveId }));
    flinchers.n.a.stages = { ...flinchers.n.a.stages, spe: -6 }; // 한카리아스는 기본 스피드가 잠만보보다 높아, 랭크 −6으로 상대가 확실히 먼저 움직이게 한다
    const f2 = turn(flinchers.n, mv("불새"), "물기", () => 0); // 상대가 먼저 물기 → 풀죽음 30%(난수 0)
    check("D3-fix4 발동 중단: 2턴째에 풀죽음 → 불새 미발동·준비 해제·다음 턴 자유 선택·PP는 1회분", f2.a.blockedReason === "flinch" && f2.n.b.currentHp === flinchers.n.b.currentHp && f2.n.a.chargingMoveId === undefined && f2.n.a.remainingPp["불새"] === 7, json({ r: f2.a.blockedReason, id: f2.n.a.chargingMoveId, pp: f2.n.a.remainingPp["불새"] })); }

  // ── 풀죽음 30%: 2턴째에 먼저 맞히면 상대가 풀죽음(난수 0 → 30% 통과) ──
  { const o2 = turn(t1.n, mv("불새"), IDLE, () => 0);
    check("D3-fix4 풀죽음: 2턴째에 맞히면 30%로 상대가 풀죽음 상태(난수 0)", o2.n.b.volatile.active.flinch !== undefined || o2.b?.blockedReason === "flinch", json({ flinch: o2.n.b.volatile.active.flinch, b: o2.b?.blockedReason })); }

  // ── 잠꼬대로 불러지지 않는다(nosleeptalk) ──
  { const st = setup({ tweak: (s) => { s.a.status = { condition: "sleep", turnsElapsed: 0, sleepTurns: 5 }; } });
    const r = turn(st, mv("잠꼬대"), IDLE);
    check("D3-fix4 잠꼬대: 후보에 불새가 있어도 호출하지 않는다(충전 기술 제외)", r.a.sleepTalkCalledMoveName !== "불새", json({ called: r.a.sleepTalkCalledMoveName })); }

  // ── 비접촉 유지(D3-fix-2): 2턴째에 까칠한피부 상대에게도 사용자 피해 없음 ──
  { const st = setup({ bAbility: "까칠한피부" }); const p = turn(st, mv("불새"), IDLE); const q = turn(p.n, mv("불새"), IDLE);
    check("D3-fix4 비접촉 유지: 불새 2턴째 vs 까칠한피부 → 사용자 피해 없음", q.n.b.currentHp < st.b.currentHp && q.n.a.currentHp === st.a.currentHp, json({ a: st.a.currentHp - q.n.a.currentHp })); }
}
