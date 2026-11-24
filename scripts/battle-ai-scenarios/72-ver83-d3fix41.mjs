// 8.3 D3-fix-41 (E7-07) 설치물은 설치한 순서대로 발동한다 — Showdown은 설치물 각각의 `onSwitchIn`을 `effectOrder`(설치 순서)로 정렬해 돌리고,
//  기절한 보유자의 이후 설치물은 처리하지 않는다(`fieldEvent`). 엔진은 고정 순서(독압정 흡수 → 스텔스록 → 압정 → 독압정 중독 → 네트)였다.
//  새 구조: `HazardState.order?`(처음 깐 순서, 불변 갱신 `layHazard`) + `hazardEntryOrder`(기본 순서 보충) + `applyEntryHazardsOnSwitchIn` 핸들러 표.
// 설계 `8.3-D3-E7-검수.md` §2-5.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const st0 = await server.ssrLoadModule("/src/lib/battle/state.ts");
  const R = (v) => () => v;
  const json = JSON.stringify;
  const mv = (x) => (typeof x === "string" ? { kind: "move", move: data.getMove(x) } : x);
  const plain = (o = {}) => ({ stealthRock: false, spikesLayers: 0, toxicSpikesLayers: 0, stickyWeb: false, ...o });
  const lay = (hz, kind) => {
    st0.layHazard(hz, kind);
    if (kind === "stealthRock") hz.stealthRock = true;
    else if (kind === "spikes") hz.spikesLayers = 1;
    else if (kind === "toxicSpikes") hz.toxicSpikesLayers = 1;
    else hz.stickyWeb = true;
  };

  // ── 헬퍼 단위 ──
  { const hz = plain(); lay(hz, "stealthRock"); lay(hz, "toxicSpikes");
    check("D3-fix41 1: layHazard로 깐 순서(스텔스록 → 독압정)가 hazardEntryOrder에 그대로 나온다", json(st0.hazardEntryOrder(hz)) === '["stealthRock","toxicSpikes"]', json(st0.hazardEntryOrder(hz))); }
  { const hz = plain({ stealthRock: true, spikesLayers: 2, toxicSpikesLayers: 1, stickyWeb: true });
    check("D3-fix41 2: order가 없는 상태(직접 세운 시험·AI 투영)는 기본 순서 스텔스록 → 압정 → 독압정 → 네트(회귀)", json(st0.hazardEntryOrder(hz)) === '["stealthRock","spikes","toxicSpikes","stickyWeb"]', json(st0.hazardEntryOrder(hz))); }
  { const hz = plain(); lay(hz, "toxicSpikes"); lay(hz, "stealthRock"); hz.spikesLayers = 1; // 압정은 order에 없다
    check("D3-fix41 3: order에 없는 것은 기본 순서로 뒤에 보충된다(독압정 → 스텔스록, 그 뒤 압정)", json(st0.hazardEntryOrder(hz)) === '["toxicSpikes","stealthRock","spikes"]', json(st0.hazardEntryOrder(hz))); }
  { const hz = plain(); lay(hz, "spikes"); lay(hz, "stealthRock");
    const before = hz.order; hz.spikesLayers = 0; lay(hz, "spikes"); // 지웠다 다시 깔면 맨 뒤
    check("D3-fix41 4: 지웠다 다시 깔면 맨 뒤(스텔스록 → 압정), 배열은 제자리 변경하지 않는다", json(st0.hazardEntryOrder(hz)) === '["stealthRock","spikes"]' && json(before) === '["spikes","stealthRock"]', json({ now: st0.hazardEntryOrder(hz), before })); }
  { const hz = plain(); lay(hz, "stealthRock");
    const side = { party: [], activeIndex: 0, hazards: hz, screens: {} }; const cloned = st0.cloneSide(side);
    lay(cloned.hazards, "stickyWeb");
    check("D3-fix41 5: 사본(cloneSide)에 새로 깔아도 원본의 순서는 그대로", json(side.hazards.order) === '["stealthRock"]' && json(cloned.hazards.order) === '["stealthRock","stickyWeb"]', json({ o: side.hazards.order, c: cloned.hazards.order })); }

  // ── 기술로 설치 ──
  const A = ["스텔스록", "독압정", "압정뿌리기", "끈적끈적네트", "코트체인지", "비검천중파", "하품", "전광석화"];
  // 상대 b는 자기 강화(칼춤)만 쓴다 — 하품은 3턴째에 a를 재워 설치가 막힌다
  const turn = (st, aMove, bMove = "칼춤") => rt.runTurn(st, mv(aMove), mv(bMove), R(0.5)).nextState;
  const orderOfB = (st) => st0.hazardEntryOrder(st.sideB.hazards);
  { let st = battle([mon("잠만보", A)], [mon("잠만보", ["하품"])]);
    st = turn(st, "독압정"); st = turn(st, "스텔스록");
    check("D3-fix41 6: 기술로 독압정 → 스텔스록을 깔면 순서 [독압정, 스텔스록](기본 순서와 반대)", json(orderOfB(st)) === '["toxicSpikes","stealthRock"]', json(orderOfB(st))); }
  { let st = battle([mon("잠만보", A)], [mon("잠만보", ["하품"])]);
    st = turn(st, "압정뿌리기"); st = turn(st, "스텔스록"); st = turn(st, "압정뿌리기");
    check("D3-fix41 7: 압정을 두 겹으로 올려도 순서 불변 [압정, 스텔스록]", json(orderOfB(st)) === '["spikes","stealthRock"]' && st.sideB.hazards.spikesLayers === 2, json(orderOfB(st))); }
  { let st = battle([mon("잠만보", A)], [mon("잠만보", ["하품"])]);
    st = turn(st, "비검천중파"); st = turn(st, "스텔스록");
    check("D3-fix41 8: 비검천중파가 깐 압정도 순서에 들어간다 [압정, 스텔스록]", json(orderOfB(st)) === '["spikes","stealthRock"]' && st.sideB.hazards.spikesLayers >= 1, json({ o: orderOfB(st), l: st.sideB.hazards.spikesLayers })); }
  { let st = battle([mon("잠만보", A)], [mon("잠만보", ["코트체인지", "하품"])]);
    st = turn(st, "압정뿌리기"); st = turn(st, "스텔스록"); st = turn(st, "하품", "코트체인지");
    const onA = st0.hazardEntryOrder(st.sideA.hazards);
    check("D3-fix41 9: 코트체인지 뒤에도 설치 순서가 따라간다 [압정, 스텔스록](기본 순서와 반대)", json(onA) === '["spikes","stealthRock"]' && !st.sideB.hazards.stealthRock, json({ onA })); }
  { let st = battle([mon("잠만보", A)], [mon("잠만보", ["하품"])]);
    st = turn(st, "압정뿌리기"); st = turn(st, "스텔스록");
    st.sideB.hazards = { ...st.sideB.hazards, spikesLayers: 0 }; // 압정만 지워졌다(order 배열은 그대로)
    st = turn(st, "압정뿌리기");
    check("D3-fix41 10: 압정이 지워진 뒤 다시 깔면 맨 뒤 [스텔스록, 압정]", json(orderOfB(st)) === '["stealthRock","spikes"]', json(orderOfB(st))); }
  { // 독치장(킬라플로르): 접촉 공격을 맞으면 공격자(a) 편에 독압정 한 층
    let st = battle([mon("잠만보", A)], [mon("킬라플로르", ["하품"], "독치장")]);
    st = turn(st, "전광석화");
    check("D3-fix41 11: 독치장이 깐 독압정(a 편)이 순서 [독압정]으로 기록된다", st.sideA.hazards.toxicSpikesLayers >= 1 && json(st0.hazardEntryOrder(st.sideA.hazards)) === '["toxicSpikes"]' && json(st.sideA.hazards.order) === '["toxicSpikes"]', json({ lay: st.sideA.hazards.toxicSpikesLayers, order: st.sideA.hazards.order })); }

  // ── 실전 발동 순서 ──
  const enterB = (hazards, benchMon, tweak) => {
    const st = battle([mon("잠만보", ["하품"])], [mon("잠만보", ["하품"]), benchMon]);
    st.sideB.hazards = hazards; tweak?.(st);
    const o = rt.runTurn(st, mv("하품"), { kind: "switch", toIndex: 1 }, R(0.5));
    const s = (o.result ?? o.partialResult).switches[0];
    return { ns: o.nextState, msgs: s.entryMessages, trig: s.hazardTriggers ?? [], t: o.nextState.b };
  };
  const laid = (...kinds) => { const hz = plain(); for (const k of kinds) lay(hz, k); return hz; };
  { const e = enterB(laid("stealthRock", "spikes"), mon("잠만보", ["하품"]));
    const f = enterB(laid("spikes", "stealthRock"), mon("잠만보", ["하품"]));
    check("D3-fix41 12: 로그·이벤트 순서가 설치 순서를 따른다(스텔스록 → 압정 / 압정 → 스텔스록)", json(e.trig) === '["stealthRock","spikes"]' && json(f.trig) === '["spikes","stealthRock"]', json({ e: e.trig, f: f.trig })); }
  { const e = enterB(laid("stealthRock", "toxicSpikes"), mon("아보크", ["하품"]), (st) => { st.sideB.party[1].currentHp = 1; });
    check("D3-fix41 13: 스텔스록 → 독압정 설치, 체력 1 독 타입 등장 → 스텔스록에서 기절하고 독압정이 남는다(Showdown [실행])", e.t.currentHp === 0 && e.ns.sideB.hazards.toxicSpikesLayers === 1 && json(e.trig) === '["stealthRock"]', json({ hp: e.t.currentHp, layers: e.ns.sideB.hazards.toxicSpikesLayers, trig: e.trig })); }
  { const e = enterB(laid("toxicSpikes", "stealthRock"), mon("아보크", ["하품"]), (st) => { st.sideB.party[1].currentHp = 1; });
    check("D3-fix41 14: 독압정 → 스텔스록 설치면 독압정을 먼저 흡수해 제거한 뒤 스텔스록에서 기절한다", e.t.currentHp === 0 && e.ns.sideB.hazards.toxicSpikesLayers === 0 && json(e.trig) === '["toxicSpikesAbsorbed","stealthRock"]', json({ layers: e.ns.sideB.hazards.toxicSpikesLayers, trig: e.trig })); }
  { const e = enterB(laid("stealthRock", "spikes", "toxicSpikes", "stickyWeb"), mon("잠만보", ["하품"]));
    check("D3-fix41 15: 4종 모두(접지 비독 타입) 설치 순서대로 이벤트 4개", json(e.trig) === '["stealthRock","spikes","toxicSpikes","stickyWeb"]' && e.t.stages.spe === -1 && e.t.status.condition === "poison", json({ trig: e.trig, spe: e.t.stages.spe, st: e.t.status.condition })); }
  { const e = enterB(laid("stickyWeb", "toxicSpikes", "spikes", "stealthRock"), mon("잠만보", ["하품"]));
    check("D3-fix41 16: 거꾸로 깔면 거꾸로 발동한다(네트 → 독압정 → 압정 → 스텔스록)", json(e.trig) === '["stickyWeb","toxicSpikes","spikes","stealthRock"]', json(e.trig)); }
}
