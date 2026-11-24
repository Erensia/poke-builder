// 8.3 D3-fix-39 (E7-08) 압정뿌리기 등장 피해 — Showdown `spikes.onSwitchIn`: `damage(damageAmounts[layers] * maxHP / 24)` (damageAmounts = [0, 3, 4, 6]) 내림·최소 1.
//  즉 1층 1/8 · 2층 1/6 · 3층 1/4. 엔진은 1/16·1/8·1/4(phase 6.5·7·8 계획서 확정값)였고 사용자가 "비율을 잘못 찾아서 정한 것"이라며 Showdown을 따르기로 했다(2026-11-25).
// 설계 `8.3-D3-E7-검수.md` §2-6.
export default async function ({ server, data, mon, battle, check }) {
  const cost = await server.ssrLoadModule("/src/lib/battle/entryCost.ts");
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const R = (v) => () => v;
  const json = JSON.stringify;
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const hz = (layers) => ({ stealthRock: false, spikesLayers: layers, toxicSpikesLayers: 0, stickyWeb: false });
  const NUM = { 1: 3, 2: 4, 3: 6 };

  // 1 층별 피해 — 최대 HP 전수에서 floor(HP × 분자 / 24)(최소 1)
  for (const layers of [1, 2, 3]) {
    const bad = [];
    for (let hp = 50; hp <= 700; hp++) {
      const got = cost.calcSpikesDamage(hp, ["노말"], undefined, hz(layers), true);
      const want = Math.max(1, Math.floor((hp * NUM[layers]) / 24));
      if (got !== want) bad.push(`${hp}:${got}≠${want}`);
    }
    check(`D3-fix39 1 압정 ${layers}층: 최대HP 50~700 전수에서 floor(HP×${NUM[layers]}/24)`, bad.length === 0, bad.slice(0, 5).join(" "));
  }
  // 2 대표값(HP 235): 29·39·58 — Showdown `[실행]`
  check("D3-fix39 2 HP 235: 1층 29 · 2층 39 · 3층 58 (Showdown 실행값)", json([1, 2, 3].map((l) => cost.calcSpikesDamage(235, ["노말"], undefined, hz(l), true))) === "[29,39,58]", json([1, 2, 3].map((l) => cost.calcSpikesDamage(235, ["노말"], undefined, hz(l), true))));
  // 3 회귀: 매직가드·비접지·층 없음은 0
  check("D3-fix39 3 매직가드·비접지·0층은 피해 0(회귀)",
    cost.calcSpikesDamage(300, ["노말"], { negatesIndirectDamage: true }, hz(3), true) === 0 && cost.calcSpikesDamage(300, ["노말"], undefined, hz(3), false) === 0 && cost.calcSpikesDamage(300, ["노말"], undefined, hz(0), true) === 0, "");
  // 4 AI 교체 후보 예측(calcEntryHazardDamage)도 같은 값 — 스텔스록(노말 1/8)과 합산
  { const h = { stealthRock: true, spikesLayers: 2, toxicSpikesLayers: 0, stickyWeb: false };
    const got = cost.calcEntryHazardDamage(240, ["노말"], undefined, h, true), want = 30 + 40;
    check("D3-fix39 4 calcEntryHazardDamage(스텔스록 + 압정 2층, HP 240) = 30 + 40", got === want, json({ got, want })); }
  // 5 엔진 실전: b가 예비로 교체해 등장 — 압정 2층 피해 = floor(HP×4/24), 문구의 피해 수
  for (const layers of [1, 2, 3]) {
    const st = battle([mon("잠만보", ["하품"])], [mon("잠만보", ["하품"]), mon("잠만보", ["하품"])]);
    st.sideB.hazards = hz(layers);
    const o = rt.runTurn(st, mv("하품"), { kind: "switch", toIndex: 1 }, R(0.5));
    const t = o.nextState.b, want = Math.max(1, Math.floor((t.maxHp * NUM[layers]) / 24));
    check(`D3-fix39 5 실전 교체 등장, 압정 ${layers}층: 피해 ${want}`, t.currentHp === t.maxHp - want, json({ dmg: t.maxHp - t.currentHp, want, max: t.maxHp }));
  }
}
