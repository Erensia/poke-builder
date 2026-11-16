// 8.3 D3-fix-1 기술 값 오류 정정(Showdown champions `965a535` 대조): 막말내뱉기(변화기·소리·−1/−1·조건부 교체)·썬더다이브(100/95·자해·작아지기)·빙산바람 명중·액셀록 우선도·
// 트라이어택(특수·20% 한 번)·급소율(불새·메가톤킥·암석액스)·트릭 명중·반동 33%·반올림(최소 1).
// 설계 `8.3-D3-fix1-기술값오류설계.md`, 검수 `8.3-D3-fix1-기술값오류정정-검수.md`
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const mv = (n) => ({ kind: "move", move: data.getMove(n) });
  const IDLE = "도우미"; // 아무 일도 안 하는 변화기(피해·랭크 변화 없음)
  const bulky = pts({ hp: 32, def: 32, spd: 32 });
  const strong = pts({ atk: 32, spa: 32, spe: 32 });
  const M = (n) => data.getMove(n);

  // ── 데이터 ──
  { const d = (n, o) => Object.entries(o).every(([k, v]) => M(n)[k] === v);
    check("D3-fix1 데이터: 빙산바람 명중 85", M("빙산바람").accuracy === 85 && M("빙산바람").power === 120);
    check("D3-fix1 데이터: 액셀록 우선도 1", M("액셀록").priority === 1);
    check("D3-fix1 데이터: 트라이어택 특수·20% 한 번 + 3개 중 하나(inflictsStatus 없음)", d("트라이어택", { category: "special" }) && !M("트라이어택").inflictsStatus && json(M("트라이어택").inflictsRandomStatus) === json({ chance: 20, statuses: ["paralysis", "burn", "freeze"] }), json(M("트라이어택").inflictsRandomStatus));
    check("D3-fix1 데이터: 불새 급소율 높음 / 메가톤킥·암석액스 보통", !!M("불새").highCritRatio && !M("메가톤킥").highCritRatio && !M("암석액스").highCritRatio);
    check("D3-fix1 데이터: 트릭 명중 100", M("트릭").accuracy === 100);
    const p = M("막말내뱉기");
    check("D3-fix1 데이터: 막말내뱉기 = 변화·악·명중 100·PP 20·비접촉·소리·상대 공격·특공 −1·조건부 교체",
      p.category === "status" && p.type === "악" && p.power === null && p.accuracy === 100 && p.pp === 20 && !p.makesContact && (p.classification ?? []).includes("소리")
      && !p.selfSwitchAfterUse && p.selfSwitchIfStatLowered === true && json((p.statChanges ?? []).map((s) => `${s.target}${s.stat}${s.delta}`).sort()) === json(["opponentatk-1", "opponentspa-1"]), json(p));
    const t = M("썬더다이브");
    check("D3-fix1 데이터: 썬더다이브 = 100/95·PP 16·마비 없음·자해 1/2·작아지기 보너스", t.power === 100 && t.accuracy === 95 && t.pp === 16 && !t.inflictsStatus && t.crashFraction === 0.5 && t.bonusVsMinimize === true, json(t));
    check("D3-fix1 데이터: 반동 33% 6기술", ["이판사판태클", "우드해머", "웨이브태클", "브레이브버드", "플레어드라이브", "볼트태클"].every((n) => M(n).recoilFraction === 0.33));
  }

  // ── 막말내뱉기 ──
  const pshot = ({ def = "잠만보", ability = null, aAbility = null, bMove = IDLE, tweak, bench = true, rand = () => 0.5 } = {}) => {
    const a = [mon("어흥염", ["막말내뱉기"], aAbility, null, strong), ...(bench ? [mon("피카츄", [IDLE])] : [])];
    const st = battle(a, [mon(def, [bMove], ability, null, bulky)]);
    tweak?.(st);
    const o = rt.runTurn(st, mv("막말내뱉기"), mv(bMove), rand);
    const res = o.result ?? o.partialResult;
    return { o, switched: "awaitingSelfSwitch" in o, act: res.actions.find((x) => x.actor === "a"), n: o.nextState };
  };
  { const r = pshot();
    check("D3-fix1 막말내뱉기: 상대 공격·특공 −1 + 교체 대기", r.switched && r.n.b.stages.atk === -1 && r.n.b.stages.spa === -1, json({ sw: r.switched, atk: r.n.b.stages.atk, spa: r.n.b.stages.spa })); }
  { const r = pshot({ tweak: (st) => { st.b.stages = { ...st.b.stages, atk: -6, spa: -6 }; } });
    check("D3-fix1 막말내뱉기: 상대 공격·특공 둘 다 −6 → 교체 취소", !r.switched && r.n.b.stages.atk === -6, json({ sw: r.switched })); }
  { const r = pshot({ tweak: (st) => { st.b.stages = { ...st.b.stages, atk: -6 }; } });
    check("D3-fix1 막말내뱉기: 공격만 −6(특공은 떨어짐) → 교체", r.switched && r.n.b.stages.spa === -1, json({ sw: r.switched })); }
  { const r = pshot({ ability: "클리어바디" });
    check("D3-fix1 막말내뱉기: 상대 클리어바디 → 랭크 불변·교체 취소", !r.switched && r.n.b.stages.atk === 0, json({ sw: r.switched, atk: r.n.b.stages.atk })); }
  { const r = pshot({ ability: "미러아머" });
    check("D3-fix1 막말내뱉기: 상대 미러아머 → 사용자 공격·특공 −1, 교체는 한다", r.switched && r.n.a.stages.atk === -1 && r.n.a.stages.spa === -1 && r.n.b.stages.atk === 0, json({ sw: r.switched, a: r.n.a.stages.atk })); }
  { const r = pshot({ bMove: "방어" });
    check("D3-fix1 막말내뱉기: 상대 방어 → 막힘·교체 없음", !r.switched && r.n.b.stages.atk === 0, json({ sw: r.switched, atk: r.n.b.stages.atk })); }
  { const r = pshot({ ability: "방음" });
    check("D3-fix1 막말내뱉기: 상대 방음 → 무효·교체 없음", !r.switched && r.n.b.stages.atk === 0, json({ sw: r.switched, atk: r.n.b.stages.atk })); }
  { const r = pshot({ tweak: (st) => { st.b.substituteHp = 30; } });
    check("D3-fix1 막말내뱉기: 상대 대타 → 소리라 대타를 무시하고 적중·교체", r.switched && r.n.b.stages.atk === -1, json({ sw: r.switched, atk: r.n.b.stages.atk })); }
  { const r = pshot({ bench: false });
    check("D3-fix1 막말내뱉기: 교체할 포켓몬이 없으면 랭크 하락만(기술 성공)", !r.switched && r.n.b.stages.atk === -1, json({ sw: r.switched, atk: r.n.b.stages.atk })); }

  // ── 썬더다이브 ──
  const slam = ({ def = "잠만보", defAbility = null, aAbility = null, bMove = IDLE, tweak, rand = () => 0.5, atk = "거대코뿌리" } = {}) => {
    const st = battle([mon(atk, ["썬더다이브"], aAbility, null, strong)], [mon(def, [bMove], defAbility, null, bulky)]);
    tweak?.(st);
    const hpA = st.a.currentHp, hpB = st.b.currentHp, maxA = st.a.maxHp;
    const o = rt.runTurn(st, mv("썬더다이브"), mv(bMove), rand);
    return { act: (o.result ?? o.partialResult).actions.find((x) => x.actor === "a"), n: o.nextState, lossA: hpA - o.nextState.a.currentHp, dealt: hpB - o.nextState.b.currentHp, maxA };
  };
  { const half = (r) => Math.floor(r.maxA / 2);
    const miss = slam({ rand: () => 0.99 });
    check("D3-fix1 썬더다이브: 빗나가면 최대 HP 1/2 자해", miss.dealt === 0 && miss.lossA === half(miss), json({ loss: miss.lossA, half: half(miss) }));
    const ground = slam({ def: "한카리아스" });
    check("D3-fix1 썬더다이브: 땅 타입 상대(무효) → 자해", ground.dealt === 0 && ground.lossA === half(ground), json({ loss: ground.lossA, dealt: ground.dealt }));
    const prot = slam({ bMove: "방어" });
    check("D3-fix1 썬더다이브: 상대 방어 → 자해", prot.dealt === 0 && prot.lossA === half(prot), json({ loss: prot.lossA }));
    const absorb = slam({ defAbility: "축전" });
    check("D3-fix1 썬더다이브: 상대 축전(흡수) → 자해", absorb.lossA === half(absorb), json({ loss: absorb.lossA, half: half(absorb) }));
    const hit = slam();
    check("D3-fix1 썬더다이브: 맞히면 자해 없음·마비 없음", hit.dealt > 0 && hit.lossA === 0 && !hit.n.b.status.condition, json({ dealt: hit.dealt, loss: hit.lossA, st: hit.n.b.status.condition }));
    const sub = slam({ tweak: (st) => { st.b.substituteHp = 40; } });
    check("D3-fix1 썬더다이브: 대타 적중은 성공 → 자해 없음", sub.lossA === 0, json({ loss: sub.lossA }));
    const guard = slam({ rand: () => 0.99, aAbility: "매직가드" });
    check("D3-fix1 썬더다이브: 매직가드는 빗나가도 자해 없음", guard.lossA === 0, json({ loss: guard.lossA }));
    const base = slam({ aAbility: null }).dealt, reck = slam({ aAbility: "이판사판" }).dealt;
    check("D3-fix1 썬더다이브: 이판사판 보정 ×1.2(4915/4096)", base > 0 && Math.abs(reck / base - 4915 / 4096) < 0.03, `${base} → ${reck}`);
    const min = (st) => { st.b.usedMoveIds = { ...(st.b.usedMoveIds ?? {}), 작아지기: true }; };
    const mini = slam({ tweak: min }), miniMiss = slam({ tweak: min, rand: () => 0.99 });
    check("D3-fix1 썬더다이브: 작아지기를 쓴 상대에게 위력 2배", mini.dealt > 0 && Math.abs(mini.dealt / hit.dealt - 2) < 0.1, `${hit.dealt} → ${mini.dealt}`);
    check("D3-fix1 썬더다이브: 작아지기를 쓴 상대에게 필중(빗나갈 난수에도 적중)", miniMiss.dealt > 0 && miniMiss.lossA === 0, json({ dealt: miniMiss.dealt, loss: miniMiss.lossA }));
  }

  // ── 반동 반올림(최소 1) ──
  { const recoil = (move, def = "잠만보") => { const out = []; for (let k = 0; k < 16; k++) {
      const st = battle([mon("한카리아스", [move], null, null, strong)], [mon(def, [IDLE], null, null, pts({ hp: 32 }))]);
      const hpA = st.a.currentHp, hpB = st.b.currentHp;
      const o = rt.runTurn(st, mv(move), mv(IDLE), () => (k + 0.8) / 16);
      out.push({ d: hpB - o.nextState.b.currentHp, r: hpA - o.nextState.a.currentHp }); } return out; };
    for (const [move, frac] of [["브레이브버드", 0.33], ["양날박치기", 0.5], ["와일드볼트", 0.25]]) {
      const rows = recoil(move).filter((x) => x.d > 0), bad = rows.filter((x) => x.r !== Math.max(1, Math.round(x.d * frac)));
      const diffFloor = rows.some((x) => Math.max(1, Math.round(x.d * frac)) !== Math.max(1, Math.floor(x.d * frac)));
      check(`D3-fix1 반동: ${move} ${frac} = max(1, round(피해 × 비율)), floor와 갈리는 사례 포함`, bad.length === 0 && diffFloor, json({ bad: bad.slice(0, 2), diffFloor }));
    } }

  // ── 트라이어택: 20% 한 번 + 3개 중 하나 ──
  { let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const cnt = { none: 0, paralysis: 0, burn: 0, freeze: 0 }, N = 12000;
    for (let i = 0; i < N; i++) {
      const st = battle([mon("삼삼드래", ["트라이어택"], null, null, strong)], [mon("잠만보", [IDLE], null, null, pts({ hp: 32 }))]);
      const o = rt.runTurn(st, mv("트라이어택"), mv(IDLE), rnd);
      const c = o.nextState.b.status.condition || "none"; cnt[c] = (cnt[c] ?? 0) + 1;
    }
    const any = (N - cnt.none) / N;
    check("D3-fix1 트라이어택: 부가효과 발생률 20%±1%p(세 번 따로 굴리면 18.7%)", Math.abs(any - 0.2) < 0.01, json({ any, cnt }));
    const per = (cnt.paralysis + cnt.burn + cnt.freeze) / 3;
    check("D3-fix1 트라이어택: 세 상태가 고르게(각 평균의 ±35% 안)", [cnt.paralysis, cnt.burn, cnt.freeze].every((c) => Math.abs(c - per) < per * 0.35), json(cnt)); }

  // ── 액셀록 우선도 ──
  { const st = battle([mon("루가루암", ["액셀록"], null, null, pts({ atk: 32, spe: 0 }))], [mon("한카리아스", ["전광석화"], null, null, pts({ spe: 32 }))]);
    const o = rt.runTurn(st, mv("액셀록"), mv("전광석화"), () => 0.5);
    check("D3-fix1 액셀록: 우선도 1이라 같은 우선도의 전광석화와 스피드순(느린 쪽이 뒤)", (o.result ?? o.partialResult).actions[0].actor === "b", json((o.result ?? o.partialResult).actions.map((x) => x.actor))); }
}
