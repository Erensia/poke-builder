// 8.3 D3-fix-36 (E7-02·E7-10) 끈적끈적네트·위협이 능력치 하락 방지 특성(클리어바디·미러아머)과 반응 특성(오기·승기·주눅)을 따른다.
//  Showdown: 네트는 접지면 발동 줄을 항상 내고(`-activate`), 결과는 boost() 규칙 — 하락 방지가 막고, 미러아머가 반사하고, 실제 하락일 때만 오기·승기가 발동한다.
//  엔진은 등장 경로(applyEntryHazardsOnSwitchIn·applyIntimidateWithReaction)가 이 규칙이 없어 클리어바디도 −1이 들어갔다. 기술 경로(mirroredEffects)는 이미 지켰다.
// 설계 `8.3-D3-E7-검수.md` §2-2.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const R = (v) => () => v;
  const json = JSON.stringify;
  const mv = (x) => (typeof x === "string" ? { kind: "move", move: data.getMove(x) } : x);
  const hz = (o = {}) => ({ stealthRock: false, spikesLayers: 0, toxicSpikesLayers: 0, stickyWeb: false, ...o });

  // 네트: b가 예비(1번)로 교체해 등장 — 대상은 b 예비
  const web = (target, tweak) => {
    const st = battle([mon("잠만보", ["칼춤"])], [mon("잠만보", ["칼춤"]), target]);
    st.sideB.hazards = hz({ stickyWeb: true });
    tweak?.(st);
    const o = rt.runTurn(st, mv("칼춤"), { kind: "switch", toIndex: 1 }, R(0.5));
    const s = (o.result ?? o.partialResult).switches[0];
    return { sw: s, ns: o.nextState, msgs: s.entryMessages, t: o.nextState.b, src: o.nextState.a };
  };
  // 위협: a가 대상(활성), b가 갸라도스(위협)를 예비에서 교체 등장
  const intimidate = (target, tweak) => {
    const st = battle([target], [mon("잠만보", ["칼춤"]), mon("갸라도스", ["칼춤"], "위협")]);
    tweak?.(st);
    const o = rt.runTurn(st, mv("하품"), { kind: "switch", toIndex: 1 }, R(0.5));
    const s = (o.result ?? o.partialResult).switches[0];
    return { sw: s, ns: o.nextState, msgs: s.entryMessages, t: o.nextState.a, src: o.nextState.b };
  };
  const has = (msgs, s) => [].concat(msgs).some((m) => m.includes(s));

  // ── 네트(E7-02) ──
  { const e = web(mon("메타그로스", ["칼춤"], "클리어바디"));
    check("D3-fix36 1: 클리어바디 + 네트(접지) → 스피드 랭크 0, 발동 줄은 남고, 이벤트 [stickyWeb]",
      e.t.stages.spe === 0 && has(e.msgs, "끈적끈적네트에 걸렸다") && json(e.sw.hazardTriggers) === '["stickyWeb"]', json({ spe: e.t.stages.spe, msgs: e.msgs, trig: e.sw.hazardTriggers })); }
  { const e = web(mon("잠만보", ["칼춤"]));
    check("D3-fix36 2: 일반 포켓몬 + 네트 → 스피드 −1, 발동 줄 + 하락 줄(두 줄)",
      e.t.stages.spe === -1 && e.msgs.length === 2 && has(e.msgs[0], "끈적끈적네트에 걸렸다") && has(e.msgs[1], "스피드가 떨어졌다"), json({ spe: e.t.stages.spe, msgs: e.msgs })); }
  { const e = web(mon("잠만보", ["칼춤"]), (st) => { st.sideB.party[1].stages = { ...st.sideB.party[1].stages, spe: -6 }; });
    check("D3-fix36 3: 이미 스피드 −6 + 네트 → 발동 줄은 남고(이벤트 [stickyWeb]) 하락 줄 대신 '더 떨어지지 않는다' 줄",
      e.t.stages.spe === -6 && has(e.msgs, "끈적끈적네트에 걸렸다") && has(e.msgs.join("|"), "더 떨어지지 않") && json(e.sw.hazardTriggers) === '["stickyWeb"]', json({ msgs: e.msgs, trig: e.sw.hazardTriggers })); }
  { const e = web(mon("잠만보", ["칼춤"], null, "풍선"));
    check("D3-fix36 4: 비접지(풍선) + 네트 → 발동 없음(회귀)", e.t.stages.spe === 0 && !has(e.msgs, "끈적끈적네트") && !("hazardTriggers" in e.sw), json(e.msgs)); }
  { const e = web(mon("대도각참", ["칼춤"], "오기"));
    check("D3-fix36 5: 오기 + 네트 → 스피드 −1 뒤 공격 +2 (일반 상승 문구 줄 — 8.3 D3-fix-57: 특성 이름 없음)",
      e.t.stages.spe === -1 && e.t.stages.atk === 2 && has(e.msgs.join("|"), "공격이 크게 올라갔다") && !has(e.msgs.join("|"), "오기!"), json({ spe: e.t.stages.spe, atk: e.t.stages.atk, msgs: e.msgs })); }
  { const e = web(mon("잠만보", ["칼춤"], "승기"));
    check("D3-fix36 6: 승기 + 네트 → 스피드 −1 뒤 특공 +2", e.t.stages.spe === -1 && e.t.stages.spa === 2, json({ spe: e.t.stages.spe, spa: e.t.stages.spa })); }
  { const e = web(mon("대도각참", ["칼춤"], "오기"), (st) => { st.sideB.party[1].stages = { ...st.sideB.party[1].stages, spe: -6 }; });
    check("D3-fix36 7: 오기 + 이미 스피드 −6 + 네트 → 실제 하락이 없으니 오기 발동 안 함", e.t.stages.atk === 0, json({ atk: e.t.stages.atk })); }

  // ── 위협(E7-10) ──
  { const e = intimidate(mon("잠만보", ["하품"]));
    check("D3-fix36 8: 일반 포켓몬 + 위협 → 공격 −1, 기존 한 줄 문구 유지(회귀)", e.t.stages.atk === -1 && e.msgs.length === 1 && e.msgs[0] === "갸라도스의 위협! 상대의 공격이 떨어졌다!", json({ atk: e.t.stages.atk, msgs: e.msgs })); }
  { const e = intimidate(mon("메타그로스", ["하품"], "클리어바디"));
    check("D3-fix36 9: 클리어바디 + 위협 → 공격 0(위협 줄은 남고 결과는 막힘)", e.t.stages.atk === 0 && has(e.msgs, "위협"), json({ atk: e.t.stages.atk, msgs: e.msgs })); }
  { const e = intimidate(mon("잠만보", ["하품"], "부풀린가슴"));
    check("D3-fix36 10: 부풀린가슴은 방어만 막으므로 위협은 들어간다(공격 −1)", e.t.stages.atk === -1, json({ atk: e.t.stages.atk })); }
  { const e = intimidate(mon("아머까오", ["하품"], "미러아머"));
    check("D3-fix36 11: 미러아머 + 위협 → 아머까오 공격 0, 위협 사용자(갸라도스) 공격 −1, 반사 문구",
      e.t.stages.atk === 0 && e.src.stages.atk === -1 && has(e.msgs.join("|"), "되받아쳤다"), json({ t: e.t.stages.atk, src: e.src.stages.atk, msgs: e.msgs })); }
  { const e = intimidate(mon("대도각참", ["하품"], "오기"));
    check("D3-fix36 12: 오기 + 위협 → 공격 −1 뒤 +2 = +1", e.t.stages.atk === 1, json({ atk: e.t.stages.atk, msgs: e.msgs })); }
  { const e = intimidate(mon("잠만보", ["하품"], "주눅"));
    check("D3-fix36 13: 주눅 + 위협 → 공격 −1·스피드 +1(회귀)", e.t.stages.atk === -1 && e.t.stages.spe === 1, json({ atk: e.t.stages.atk, spe: e.t.stages.spe })); }
  { const e = intimidate(mon("잠만보", ["하품"], "파수견"));
    check("D3-fix36 14: 파수견 + 위협 → 공격 +1(회귀)", e.t.stages.atk === 1, json({ atk: e.t.stages.atk })); }
  { const e = intimidate(mon("잠만보", ["하품"], "정신력"));
    check("D3-fix36 15: 정신력 + 위협 → 공격 0(회귀)", e.t.stages.atk === 0, json({ atk: e.t.stages.atk })); }
}
