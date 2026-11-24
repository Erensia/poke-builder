// 8.3 D3-fix-37 (E7-03·E7-04) 교체 등장 효과 순서를 Showdown `SwitchIn` 이벤트 순서로 맞춘다.
//  새 순서: ① 치유소원 ② 설치물 ③ 등장 특성 ④ 풍선 안내 ⑤ 의태 ⑥ 시드 ⑦ 기분파. 치유소원은 HP가 줄었거나 상태이상일 때만 소모된다.
//  엔진은 performSwitch가 기분파·의태 폼을 먼저 맞춘 뒤 설치물 → 특성 → 시드 → 풍선 → 치유소원 순이라, 캐스퐁·메더가 새 타입으로 스텔스록을 맞고
//  치유소원이 설치물 뒤라 HP 1이 스텔스록으로 쓰러졌다. 설계 `8.3-D3-E7-검수.md` §2-3.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const R = (v) => () => v;
  const json = JSON.stringify;
  const mv = (x) => (typeof x === "string" ? { kind: "move", move: data.getMove(x) } : x);
  const hz = (o = {}) => ({ stealthRock: false, spikesLayers: 0, toxicSpikesLayers: 0, stickyWeb: false, ...o });

  // b가 예비(1번)로 교체해 등장한다 — a는 중립 기술(하품)
  const enter = (benchMon, { hazards, tweak } = {}) => {
    const st = battle([mon("잠만보", ["하품"])], [mon("잠만보", ["하품"]), benchMon]);
    if (hazards) st.sideB.hazards = hz(hazards);
    tweak?.(st);
    const o = rt.runTurn(st, mv("하품"), { kind: "switch", toIndex: 1 }, R(0.5));
    const s = (o.result ?? o.partialResult).switches[0];
    return { sw: s, ns: o.nextState, msgs: s.entryMessages, t: o.nextState.b, side: o.nextState.sideB };
  };
  const idx = (msgs, s) => msgs.findIndex((m) => m.includes(s));
  const rock = (maxHp, mult) => Math.max(1, Math.floor((maxHp * mult) / 8));

  // ── E7-03 치유소원: 설치물보다 먼저, 회복이 필요할 때만 소모 ──
  { const e = enter(mon("잠만보", ["하품"]), { hazards: { stealthRock: true, toxicSpikesLayers: 1 }, tweak: (st) => { st.sideB.healingWishPending = true; const f = st.sideB.party[1]; f.currentHp = 1; f.status = { condition: "burn", turnsElapsed: 1 }; } });
    check("D3-fix37 1: 체력 1·화상 + 스텔스록·독압정 + 치유소원 → 회복 뒤 스텔스록 피해(기절 안 함)·독, 줄 순서 치유소원 → 스텔스록",
      !e.sw.entryMessages.some((m) => m.includes("쓰러")) && e.t.currentHp === e.t.maxHp - rock(e.t.maxHp, 1) - Math.floor(e.t.maxHp / 8) /* 같은 턴 종료의 독 1/8 */ && e.t.status.condition === "poison" && idx(e.msgs, "치유소원") >= 0 && idx(e.msgs, "치유소원") < idx(e.msgs, "뾰족한 바위"),
      json({ hp: e.t.currentHp, max: e.t.maxHp, st: e.t.status.condition, msgs: e.msgs })); }
  { const e = enter(mon("잠만보", ["하품"]), { tweak: (st) => { st.sideB.healingWishPending = true; } });
    check("D3-fix37 2: 체력 가득·상태이상 없음 → 치유소원이 남고 문구도 없다", e.side.healingWishPending === true && idx(e.msgs, "치유소원") < 0, json({ pending: e.side.healingWishPending, msgs: e.msgs })); }
  { const e = enter(mon("잠만보", ["하품"]), { tweak: (st) => { st.sideB.healingWishPending = true; st.sideB.party[1].status = { condition: "burn", turnsElapsed: 1 }; } });
    check("D3-fix37 3: 체력은 가득이어도 상태이상이면 소모되어 상태가 풀린다", e.side.healingWishPending === undefined && !e.t.status.condition && idx(e.msgs, "치유소원") >= 0, json({ pending: e.side.healingWishPending, st: e.t.status, msgs: e.msgs })); }
  { const e = enter(mon("잠만보", ["하품"]), { tweak: (st) => { st.sideB.healingWishPending = true; st.sideB.party[1].currentHp = 10; } });
    check("D3-fix37 4: 체력만 줄었어도 소모되어 가득 찬다", e.side.healingWishPending === undefined && e.t.currentHp === e.t.maxHp, json({ hp: e.t.currentHp, max: e.t.maxHp })); }

  // ── E7-04 기분파·의태는 설치물 뒤 ──
  { const e = enter(mon("캐스퐁", ["하품"], "기분파"), { hazards: { stealthRock: true }, tweak: (st) => { st.weather = "쾌청"; st.weatherTurnsRemaining = 5; } });
    check("D3-fix37 5: 쾌청 + 캐스퐁 + 스텔스록 → 피해는 노말 기준(1/8), 등장 뒤 폼은 불꽃",
      e.t.currentHp === e.t.maxHp - rock(e.t.maxHp, 1) && json(e.t.types) === '["불꽃"]', json({ dmg: e.t.maxHp - e.t.currentHp, max: e.t.maxHp, types: e.t.types })); }
  { const e = enter(mon("캐스퐁", ["하품"], "기분파"), { hazards: { stealthRock: true } });
    check("D3-fix37 6: 날씨 없음 + 캐스퐁(회귀) → 노말 그대로·스텔스록 1/8", json(e.t.types) === '["노말"]' && e.t.currentHp === e.t.maxHp - rock(e.t.maxHp, 1), json({ types: e.t.types, dmg: e.t.maxHp - e.t.currentHp })); }
  { const e = enter(mon("가라르메더", ["하품"], "의태"), { hazards: { stealthRock: true }, tweak: (st) => { st.field = "일렉트릭필드"; st.fieldTurnsRemaining = 5; } });
    check("D3-fix37 7: 일렉트릭필드 + 메더(가라르) + 스텔스록 → 피해는 땅/강철 기준(1/32), 등장 뒤 타입은 전기, 타입 변화 줄이 있다",
      e.t.currentHp === e.t.maxHp - rock(e.t.maxHp, 0.25) && json(e.t.types) === '["전기"]' && idx(e.msgs, "전기 타입이 되었다") > idx(e.msgs, "뾰족한 바위"), json({ dmg: e.t.maxHp - e.t.currentHp, max: e.t.maxHp, types: e.t.types, msgs: e.msgs })); }
  { const e = enter(mon("가라르메더", ["하품"], "의태", "일렉트릭시드"), { tweak: (st) => { st.field = "일렉트릭필드"; st.fieldTurnsRemaining = 5; } });
    check("D3-fix37 8: 일렉트릭필드 + 시드를 든 메더(가라르) → 의태 줄이 시드 줄보다 먼저(특성이 도구보다 먼저)",
      idx(e.msgs, "전기 타입이 되었다") >= 0 && idx(e.msgs, "일렉트릭시드") >= 0 && idx(e.msgs, "전기 타입이 되었다") < idx(e.msgs, "일렉트릭시드") && e.t.stages.def === 1, json({ msgs: e.msgs, def: e.t.stages.def })); }
  { const e = enter(mon("잠만보", ["하품"], "일렉트릭메이커", "일렉트릭시드"));
    check("D3-fix37 9: 일렉트릭메이커 + 시드 같은 포켓몬(회귀) → 필드 문구 뒤 시드 발동, 방어 +1", idx(e.msgs, "일렉트릭메이커") >= 0 && idx(e.msgs, "일렉트릭메이커") < idx(e.msgs, "일렉트릭시드") && e.t.stages.def === 1, json({ msgs: e.msgs, def: e.t.stages.def })); }
}
