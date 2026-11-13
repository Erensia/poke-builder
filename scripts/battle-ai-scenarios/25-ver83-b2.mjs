// 8.3 B2 설치물 발동의 구조화 필드(SwitchLogEntry.hazardTriggers): 교체로 등장한 포켓몬에게 설치물이 발동하면 문구(entryMessages)와 별개로 구조화 이벤트가 남는다.
// 규칙은 바뀌지 않는다 — 이벤트는 문구가 나온 때와 1:1이고 순서도 문구 순서다. 발동이 없으면 키 자체가 없다(JSON 해시 불변).
// 발동 순서·네트 -6 문구·비접지 독타입 흡수는 Showdown과 다른 기존 동작이라 기대값을 박지 않고 "문구 = 이벤트" 불변식만 본다(백로그 F6). 설계 `8.3-B2-설치물발동설계.md`, 검수 `8.3-B2-설치물발동설계-검수.md`
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
  const helpers = await server.ssrLoadModule("/src/components/battleLog/battleSessionHelpers.ts");
  const mv = (x) => (typeof x === "string" ? { kind: "move", move: data.getMove(x) } : x);
  const R = (v) => () => v;
  const play = (st, a, b = "칼춤", rng = R(0.5)) => rt.runTurn(st, mv(a), mv(b), rng);
  const hz = (o = {}) => ({ stealthRock: false, spikesLayers: 0, toxicSpikesLayers: 0, stickyWeb: false, ...o });
  const json = JSON.stringify;

  // 옛 화면의 문구 판별(HAZARD_TRIGGERS + "독압정을 흡수")을 엔진 문구 순서대로 읽은 기준 — 새 이벤트와 같아야 한다
  const TEXTS = [["독압정을 흡수", "toxicSpikesAbsorbed"], ["뾰족한 바위", "stealthRock"], ["압정에 상처", "spikes"], ["몸에 독이 퍼졌다", "toxicSpikes"], ["몸에 맹독이 퍼졌다", "toxicSpikes"], ["끈적끈적네트에 걸려", "stickyWeb"]];
  const fromText = (msgs) => msgs.flatMap((m) => TEXTS.filter(([t]) => m.includes(t)).map(([, k]) => k));

  // a: 잠만보(칼춤), b: 잠만보 + 예비 하나 — b가 예비로 교체(행동 1번)하면 b 편(sideB) 설치물이 발동한다
  const bench = (pokemon = "잠만보", ability = null, item = null) => mon(pokemon, ["칼춤"], ability, item);
  const mk = (benchMon, hazards, tweak) => {
    const st = battle([mon("잠만보", ["칼춤"])], [mon("잠만보", ["칼춤"]), benchMon]);
    st.sideB.hazards = hz(hazards);
    tweak?.(st.sideB.party[1], st);
    return st;
  };
  const enter = (st) => {
    const o = rt.runTurn(st, mv("칼춤"), { kind: "switch", toIndex: 1 }, R(0.5));
    const s = (o.result ?? o.partialResult).switches[0]; // 등장하자마자 쓰러지면 강제 교체 대기라 partialResult
    return { sw: s, ns: o.nextState, msgs: s.entryMessages };
  };
  const trig = (st) => enter(st).sw.hazardTriggers;
  // 이벤트와 문구가 1:1·같은 순서
  const matches = (e) => json(e.sw.hazardTriggers ?? []) === json(fromText(e.msgs));

  // ── B2-a: 스텔스록 ──
  { const e = enter(mk(bench(), { stealthRock: true })); check("8.3 B2-a: 스텔스록 등장 → hazardTriggers [stealthRock]", json(e.sw.hazardTriggers) === '["stealthRock"]' && e.msgs.some((m) => m.includes("뾰족한 바위")), json(e.sw.hazardTriggers)); }

  // ── B2-b: 압정뿌리기 1·2·3층(접지) ──
  for (const n of [1, 2, 3]) check(`8.3 B2-b: 압정뿌리기 ${n}층 접지 → [spikes]`, json(trig(mk(bench(), { spikesLayers: n }))) === '["spikes"]');

  // ── B2-c: 압정뿌리기, 비접지(비행·풍선) → 키 없음 ──
  for (const [name, m] of [["비행 타입", bench("글라이온")], ["풍선", bench("잠만보", null, "풍선")]]) {
    const e = enter(mk(m, { spikesLayers: 2 }));
    check(`8.3 B2-c: 압정뿌리기, ${name}(비접지) → 키 없음·압정 문구 없음`, !("hazardTriggers" in e.sw) && !e.msgs.some((x) => x.includes("압정에 상처")), json(e.msgs));
  }

  // ── B2-d: 독압정 1층(독)·2층(맹독) ──
  for (const [n, cond] of [[1, "poison"], [2, "badly-poisoned"]]) {
    const e = enter(mk(bench(), { toxicSpikesLayers: n }));
    check(`8.3 B2-d: 독압정 ${n}층 → [toxicSpikes], 상태 ${cond}`, json(e.sw.hazardTriggers) === '["toxicSpikes"]' && e.ns.b.status.condition === cond, `${json(e.sw.hazardTriggers)} ${e.ns.b.status.condition}`);
  }

  // ── B2-e: 독압정이 걸리지 않는 경우 — 강철 타입(중독 면역) / 이미 상태이상 / 신비의부적 ──
  for (const [name, m, tweak] of [
    ["강철 타입", bench("핫삼")],
    ["이미 상태이상", bench(), (f) => { f.status = { ...f.status, condition: "burn" }; }],
    ["신비의부적", bench(), (_f, st) => { st.sideB.safeguardTurnsRemaining = 5; }],
  ]) {
    const e = enter(mk(m, { toxicSpikesLayers: 1 }, tweak));
    check(`8.3 B2-e: 독압정, ${name} → 키 없음·문구 없음`, !("hazardTriggers" in e.sw) && !e.msgs.some((x) => x.includes("독이 퍼졌다")), json(e.msgs));
  }

  // ── B2-f: 접지한 독타입이 독압정을 흡수 ──
  { const e = enter(mk(bench("아보크"), { toxicSpikesLayers: 2 })); check("8.3 B2-f: 접지 독타입 → [toxicSpikesAbsorbed], 층 0·중독 안 걸림", json(e.sw.hazardTriggers) === '["toxicSpikesAbsorbed"]' && e.ns.sideB.hazards.toxicSpikesLayers === 0 && !e.ns.b.status.condition, json(e.sw.hazardTriggers)); }

  // ── B2-f2: 비접지 독타입(독/비행·풍선) — 현행 엔진은 접지 판정 없이 흡수한다(Showdown은 안 함, F6). 기대값은 규칙이 아니라 문구 ⇔ 이벤트 불변식 ──
  for (const [name, m, tweak] of [["독/비행", bench("아보크"), (f) => { f.types = ["독", "비행"]; }], ["풍선 든 독타입", bench("아보크", null, "풍선")]]) {
    const e = enter(mk(m, { toxicSpikesLayers: 1 }, tweak));
    const said = e.msgs.some((x) => x.includes("독압정을 흡수")), has = (e.sw.hazardTriggers ?? []).includes("toxicSpikesAbsorbed");
    check(`8.3 B2-f2: ${name}(비접지) 독압정 — 흡수 문구가 있으면 이벤트도 있고 없으면 없다`, said === has && matches(e), `문구=${said} 이벤트=${has}`);
  }

  // ── B2-g: 끈적끈적네트 — 접지 / 스피드 랭크 이미 -6 / 비접지 ──
  { const e = enter(mk(bench(), { stickyWeb: true })); check("8.3 B2-g: 끈적끈적네트 접지 → [stickyWeb], 스피드 -1", json(e.sw.hazardTriggers) === '["stickyWeb"]' && e.ns.b.stages.spe === -1, `${json(e.sw.hazardTriggers)} spe=${e.ns.b.stages.spe}`); }
  { const e = enter(mk(bench(), { stickyWeb: true }, (f) => { f.stages = { ...f.stages, spe: -6 }; })); check("8.3 B2-g: 스피드 랭크 이미 -6 → 키 없음(현행 엔진은 랭크가 바뀔 때만 발동 문구, 불변식 유지)", !("hazardTriggers" in e.sw) && e.msgs.every((x) => !x.includes("끈적끈적네트")), json(e.msgs)); }
  { const e = enter(mk(bench("글라이온"), { stickyWeb: true })); check("8.3 B2-g: 비행 타입 → 키 없음", !("hazardTriggers" in e.sw), json(e.msgs)); }

  // ── B2-h: 4종 전부(접지 비독타입) — 이벤트 순서 = 문구 순서 (리터럴 순서를 박지 않는다) ──
  { const e = enter(mk(bench(), { stealthRock: true, spikesLayers: 1, toxicSpikesLayers: 1, stickyWeb: true })); const t = e.sw.hazardTriggers ?? [];
    check("8.3 B2-h: 4종 전부 → 이벤트 4개이고 문구 순서와 같다", t.length === 4 && new Set(t).size === 4 && matches(e), json(t)); }

  // ── B2-i: 독압정 + 스텔스록, 접지 독타입 — 흡수가 이벤트에 포함, 문구 순서와 같음 ──
  { const e = enter(mk(bench("아보크"), { stealthRock: true, toxicSpikesLayers: 1 })); const t = e.sw.hazardTriggers ?? [];
    check("8.3 B2-i: 독타입 흡수+스텔스록 → 이벤트 2개(흡수 포함)이고 문구 순서와 같다", t.length === 2 && t.includes("toxicSpikesAbsorbed") && t.includes("stealthRock") && matches(e), json(t)); }

  // ── B2-j: 스텔스록으로 쓰러지면 뒤 설치물은 발동하지 않는다 ──
  { const e = enter(mk(bench(), { stealthRock: true, spikesLayers: 1, toxicSpikesLayers: 1, stickyWeb: true }, (f) => { f.currentHp = 1; }));
    check("8.3 B2-j: 스텔스록으로 쓰러짐 → [stealthRock]만, 뒤 설치물 문구·이벤트 없음", json(e.sw.hazardTriggers) === '["stealthRock"]' && e.msgs.length === 1, json(e.sw.hazardTriggers)); }

  // ── B2-k: 매직가드 — 스텔스록·압정은 데미지 0이라 없고, 네트는 발동 ──
  { const e = enter(mk(bench("픽시", "매직가드"), { stealthRock: true, spikesLayers: 1, stickyWeb: true })); check("8.3 B2-k: 매직가드 → [stickyWeb]만(스텔스록·압정 이벤트 없음)", json(e.sw.hazardTriggers) === '["stickyWeb"]', json(e.sw.hazardTriggers)); }

  // ── B2-l: 설치물이 없는 교체엔 키 자체가 없다(JSON 바이트 불변) ──
  { const e = enter(mk(bench(), {})); check("8.3 B2-l: 설치물 없는 교체 → hazardTriggers 키 없음(JSON에도 없음)", !("hazardTriggers" in e.sw) && !json(e.sw).includes("hazardTriggers"), json(Object.keys(e.sw))); }

  // ── B2-m: 교체 기록을 만드는 경로마다 이벤트가 채워진다 ──
  // 유턴 사용자(a)/방어측(b) 시나리오 — A7과 같은 구성
  const bulky = pts({ hp: 32, spd: 32, def: 32 });
  const atk = (move) => mon("핫삼", [move], null, null, pts({ atk: 32, spe: 32, hp: 2 }));
  const spare = () => mon("메타그로스", ["칼춤"]);
  const holder = (item, ability = null) => mon("잠만보", ["칼춤", "방어"], ability, item, { ...bulky, spe: 0 });
  const mkPivot = ({ item = null, ability = null, ha, hb } = {}) => {
    const st = battle([atk("유턴"), spare()], [holder(item, ability), spare()]);
    if (ha) st.sideA.hazards = hz(ha);
    if (hb) st.sideB.hazards = hz(hb);
    return st;
  };
  const drive = (first) => { let out = first; for (let g = 0; "awaitingSelfSwitch" in out && g < 5; g++) out = rt.resumeTurn(out._ctx, 1); return out; };
  const msgsOf = (s) => s.entryMessages.join(" / ");

  // ② 유턴 선택(performChoice 비지연)
  { const out = drive(play(mkPivot({ ha: { stealthRock: true } }), "유턴")); const s = out.result.switches.find((x) => x.side === "a");
    check("8.3 B2-m②: 유턴 선택 교체 → [stealthRock]·문구 남음", json(s?.hazardTriggers) === '["stealthRock"]' && msgsOf(s).includes("뾰족한 바위"), json(s?.hazardTriggers)); }

  // ③ 동시 교체(A7 deferEntry) — 양쪽 편에 서로 다른 설치물, 각자 자기 편 설치물만. entryMessages 참조가 끊기지 않았는지(문구도 남는지)까지
  { const st = mkPivot({ ability: "위기회피", ha: { stealthRock: true }, hb: { spikesLayers: 1 } }); st.b.currentHp = Math.floor(st.b.maxHp / 2) + 1;
    const out = drive(play(st, "유턴")); const sa = out.result.switches.find((x) => x.side === "a"), sb = out.result.switches.find((x) => x.side === "b");
    check("8.3 B2-m③: 동시 교체 — a는 [stealthRock], b는 [spikes], 편이 섞이지 않고 문구도 남는다", out.result.switches.length === 2 && json(sa.hazardTriggers) === '["stealthRock"]' && json(sb.hazardTriggers) === '["spikes"]'
      && msgsOf(sa).includes("뾰족한 바위") && !msgsOf(sa).includes("압정에 상처") && msgsOf(sb).includes("압정에 상처") && !msgsOf(sb).includes("뾰족한 바위"), `${json(sa?.hazardTriggers)} ${json(sb?.hazardTriggers)} | ${msgsOf(sa)} | ${msgsOf(sb)}`); }

  // ④ 레드카드 forceRandomSwitch
  { const o = play(mkPivot({ item: "레드카드", ha: { stealthRock: true } }), "유턴"); const r = (o.result ?? o.partialResult).switches.find((s) => s.redCardItemName);
    check("8.3 B2-m④: 레드카드 강제 교체 → [stealthRock]·문구 남음", json(r?.hazardTriggers) === '["stealthRock"]' && msgsOf(r).includes("뾰족한 바위"), json(r?.hazardTriggers)); }

  // ⑤ applySwitch(기절 후 강제 교체) → 결과 + 화면의 합성 카드(forcedSwitchLogEntry)
  { const st = mkPivot({ ha: { stealthRock: true } }); const ap = sw.applySwitch(st, "a", 1);
    check("8.3 B2-m⑤: applySwitch → hazardTriggers [stealthRock](항상 배열)", json(ap.hazardTriggers) === '["stealthRock"]', json(ap.hazardTriggers));
    const card = helpers.forcedSwitchLogEntry(ap.nextState, "a", 1, ap, { inFainted: false, hasReserve: true }).switches[0];
    check("8.3 B2-m⑤: 강제 교체 합성 카드 → hazardTriggers [stealthRock]", json(card.hazardTriggers) === '["stealthRock"]', json(card.hazardTriggers));
    const none = sw.applySwitch(mkPivot(), "a", 1); const card2 = helpers.forcedSwitchLogEntry(none.nextState, "a", 1, none, { inFainted: false, hasReserve: true }).switches[0];
    check("8.3 B2-m⑤: 설치물 없으면 applySwitch는 [], 합성 카드엔 키 없음", json(none.hazardTriggers) === "[]" && !("hazardTriggers" in card2), json(card2)); }

  // ── B2-n: 문구 회귀 — 구조화해도 로그 줄(entryMessages)은 그대로 ──
  { const pats = [
      [mk(bench(), { stealthRock: true }), /^뾰족한 바위가 잠만보를 덮쳤다! \(\d+ 데미지\)$/],
      [mk(bench(), { spikesLayers: 1 }), /^잠만보는 압정에 상처를 입었다! \(\d+ 데미지\)$/],
      [mk(bench(), { toxicSpikesLayers: 1 }), /^잠만보의 몸에 독이 퍼졌다!$/],
      [mk(bench(), { toxicSpikesLayers: 2 }), /^잠만보의 몸에 맹독이 퍼졌다!$/],
      [mk(bench("아보크"), { toxicSpikesLayers: 1 }), /^아보크는 독압정을 흡수했다!$/],
      [mk(bench(), { stickyWeb: true }), /^잠만보는 끈적끈적네트에 걸려 스피드가 떨어졌다!$/],
    ];
    check("8.3 B2-n: 설치물 6종 문구가 구조화 전과 같다", pats.every(([st, re]) => { const m = enter(st).msgs; return m.length === 1 && re.test(m[0]); }), pats.map(([st]) => enter(st).msgs[0]).join(" | ")); }
}
