// 8.3 B7 고속스핀·킬러스핀의 설치물·씨뿌리기·속박 제거(`Move.hazardClear: "spin"`): 명중 + 방어 안 됨 + 상성 무효 아님이면 사용자 편 설치물 4종과 사용자의 씨뿌리기·속박을 지운다.
// 엔진 로직은 이미 있었고 데이터 필드가 빠져 있었다. 무효 상대(고스트·강철)에게 제거되던 결함을 `typeEffectiveness !== 0` 가드로 막고, 지운 것을 `ActionLogEntry.spinCleared`와 화면 줄로 남긴다.
// 설계 `8.3-B7-스핀제거효과설계.md`, 검수 `8.3-B7-스핀제거효과설계-검수.md`(Showdown champions 실측 MS-a~h·RS-a~d)
import { readFileSync } from "node:fs";
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const vol = await server.ssrLoadModule("/src/lib/volatileConditions.ts");
  const josa = await server.ssrLoadModule("/src/lib/josa.ts");
  const AEL = await server.ssrLoadModule("/src/components/turnLog/ActionEffectLines.tsx");
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const json = JSON.stringify;
  const bulky = pts({ hp: 32, def: 32, spd: 32 });
  const hz = (o = {}) => ({ stealthRock: false, spikesLayers: 0, toxicSpikesLayers: 0, stickyWeb: false, ...o });
  const none = hz();
  const mv = (n) => ({ kind: "move", move: data.getMove(n) });
  // 정규화: 키 순서와 상관없이 비교(spinCleared가 없으면 undefined)
  const canon = (s) => (s ? json({ leechSeed: s.leechSeed, hazards: s.hazards, bound: s.bound }) : "undefined");
  const spinner = () => mon("킬라플로르", ["킬러스핀"], "부식");
  const holder = (ability = "독치장") => mon("킬라플로르", ["칼춤"], ability, null, bulky);
  const play = ({ a = spinner(), b = holder(), bMove = "칼춤", tweak } = {}) => {
    const st = battle([a], [b]);
    tweak?.(st);
    const hpBefore = st.a.currentHp;
    const o = rt.runTurn(st, { kind: "move", move: a.moves[0] }, mv(bMove), () => 0.5);
    const act = (o.result ?? o.partialResult).actions.find((x) => x.actor === "a");
    return { act, n: o.nextState, hpBefore };
  };
  const cleared = (h) => json(h) === json(none);

  // ── MS-a: 킬러스핀 vs 독치장 — 독치장이 깐 독압정이 같은 행동 안에서 지워진다 ──
  { const r = play(); check("8.3 B7 MS-a: 킬러스핀 vs 독치장 → 독치장 발동 후 독압정 0층, 상대 독, spinCleared [toxicSpikes]", cleared(r.n.sideA.hazards) && r.act.toxicDebrisAbilityName === "독치장" && r.n.b.status.condition === "poison" && canon(r.act.spinCleared) === canon({ hazards: ["toxicSpikes"] }), json({ h: r.n.sideA.hazards, s: r.act.spinCleared })); }
  // ── MS-b: A편 독압정 이미 2층 — 독치장은 미발동, 기존 2층은 제거 ──
  { const r = play({ tweak: (st) => { st.sideA.hazards = hz({ toxicSpikesLayers: 2 }); } }); check("8.3 B7 MS-b: 독압정 2층 → 독치장 미발동, 2층 제거", cleared(r.n.sideA.hazards) && !r.act.toxicDebrisAbilityName && canon(r.act.spinCleared) === canon({ hazards: ["toxicSpikes"] }), json({ h: r.n.sideA.hazards, s: r.act.spinCleared })); }
  // ── MS-c: 설치물 + 씨뿌리기·속박 — 전부 제거, 목록은 Showdown 고정 순서(씨뿌리기 → 압정 → 독압정 → 스텔스록 → 네트 → 속박). 방어측이 독치장이라 독치장이 깐 독압정도 같이 지워진다(검수 MS-c 실측: 독치장 설치 → 씨뿌리기 → 독압정 → 스텔스록) ──
  const msc = play({ tweak: (st) => { st.sideA.hazards = hz({ stealthRock: true, spikesLayers: 2, stickyWeb: true }); st.a.volatile = vol.inflictVolatile(vol.inflictVolatile(st.a.volatile, "leechSeed", () => 0.5), "bound", () => 0.5); } });
  check("8.3 B7 MS-c: 스텔스록·압정·네트 + 씨뿌리기·속박 → 전부 제거, spinCleared가 고정 순서", cleared(msc.n.sideA.hazards) && !msc.n.a.volatile.active.leechSeed && !msc.n.a.volatile.active.bound && canon(msc.act.spinCleared) === canon({ leechSeed: true, hazards: ["spikes", "toxicSpikes", "stealthRock", "stickyWeb"], bound: true }), json({ h: msc.n.sideA.hazards, s: msc.act.spinCleared }));
  // ── MS-d: 방어측 대타 — 독치장·독 없음, 제거는 한다 ──
  { const r = play({ tweak: (st) => { st.sideA.hazards = hz({ stealthRock: true }); st.b.substituteHp = 200; } }); check("8.3 B7 MS-d: 대타가 맞음 → 독치장·독 없음, 스텔스록은 제거", cleared(r.n.sideA.hazards) && !r.act.toxicDebrisAbilityName && !r.n.b.status.condition && canon(r.act.spinCleared) === canon({ hazards: ["stealthRock"] }), json({ h: r.n.sideA.hazards, s: r.act.spinCleared })); }
  // ── MS-e: 강철 상대(상성 무효) — 제거 없음 ──
  { const r = play({ b: mon("핫삼", ["칼춤"], null, null, bulky), tweak: (st) => { st.sideA.hazards = hz({ stealthRock: true }); } }); check("8.3 B7 MS-e: 강철 상대(무효) → 스텔스록 그대로, spinCleared 없음", r.n.sideA.hazards.stealthRock === true && r.act.spinCleared === undefined && !("spinCleared" in r.act), json({ h: r.n.sideA.hazards, s: r.act.spinCleared })); }
  // ── MS-f: 독치장 아닌 상대 — 제거만 ──
  { const r = play({ b: mon("잠만보", ["칼춤"], null, null, bulky), tweak: (st) => { st.sideA.hazards = hz({ spikesLayers: 1 }); } }); check("8.3 B7 MS-f: 독치장 아닌 상대 → 압정 제거만(독압정 설치 없음)", cleared(r.n.sideA.hazards) && !r.act.toxicDebrisAbilityName && canon(r.act.spinCleared) === canon({ hazards: ["spikes"] }), json({ h: r.n.sideA.hazards, s: r.act.spinCleared })); }
  // ── MS-g: 상대가 방어 — 막히면 제거 없음 ──
  { const r = play({ b: mon("킬라플로르", ["방어"], "독치장", null, bulky), bMove: "방어", tweak: (st) => { st.sideA.hazards = hz({ stealthRock: true }); } }); check("8.3 B7 MS-g: 상대가 방어 → 스텔스록 그대로, spinCleared 없음", r.n.sideA.hazards.stealthRock === true && r.act.spinCleared === undefined, json({ h: r.n.sideA.hazards, s: r.act.spinCleared })); }
  // ── MS-h (검수 추가): 탈 상태의 따라큐 — 탈이 데미지를 흡수해도 적중이라 제거한다(가드는 데미지가 아니라 상성 무효 여부) ──
  { const r = play({ b: mon("따라큐", ["칼춤"], "탈", null, bulky), tweak: (st) => { st.sideA.hazards = hz({ stealthRock: true }); } }); check("8.3 B7 MS-h: 탈(데미지 흡수) 따라큐 → 탈 발동·스텔스록 제거·spinCleared 있음", !!r.act.hitNegatedByAbilityName && r.n.sideA.hazards.stealthRock === false && canon(r.act.spinCleared) === canon({ hazards: ["stealthRock"] }), json({ neg: r.act.hitNegatedByAbilityName, h: r.n.sideA.hazards, s: r.act.spinCleared })); }

  // ── RS-a~e: 고속스핀 ──
  const rs = (b = mon("잠만보", ["칼춤"], null, null, bulky), tweak, a = mon("잠만보", ["고속스핀"])) => play({ a, b, tweak });
  { const r = rs(undefined, (st) => { st.sideA.hazards = hz({ stealthRock: true, toxicSpikesLayers: 1 }); }); check("8.3 B7 RS-a: 고속스핀 → 스텔스록·독압정 제거, 자기 스피드 +1 유지", cleared(r.n.sideA.hazards) && r.n.a.stages.spe === 1 && canon(r.act.spinCleared) === canon({ hazards: ["toxicSpikes", "stealthRock"] }), json({ h: r.n.sideA.hazards, spe: r.n.a.stages.spe, s: r.act.spinCleared })); }
  { const r = rs(mon("다크펫", ["칼춤"], null, null, bulky), (st) => { st.sideA.hazards = hz({ stealthRock: true }); }); check("8.3 B7 RS-b: 고속스핀 vs 고스트(무효) → 제거 없음, 스피드 +1도 없음", r.n.sideA.hazards.stealthRock === true && r.n.a.stages.spe === 0 && r.act.spinCleared === undefined, json({ h: r.n.sideA.hazards, spe: r.n.a.stages.spe, s: r.act.spinCleared })); }
  { const r = rs(undefined, (st) => { st.sideA.hazards = hz({ spikesLayers: 1 }); st.b.currentHp = 1; }); check("8.3 B7 RS-c: 상대를 쓰러뜨려도 제거(V7)", r.n.b.currentHp === 0 && cleared(r.n.sideA.hazards) && canon(r.act.spinCleared) === canon({ hazards: ["spikes"] }), json({ bhp: r.n.b.currentHp, h: r.n.sideA.hazards })); }
  { const r = rs(mon("한카리아스", ["칼춤"], "까칠한피부", null, bulky), (st) => { st.sideA.hazards = hz({ stealthRock: true }); st.a.currentHp = 1; }); check("8.3 B7 RS-d (검수 추가): 시전자가 접촉 반응으로 쓰러져도 설치물은 제거(일반 명중은 pokemon.hp 조건 없음)", r.n.a.currentHp === 0 && cleared(r.n.sideA.hazards) && canon(r.act.spinCleared) === canon({ hazards: ["stealthRock"] }), json({ ahp: r.n.a.currentHp, h: r.n.sideA.hazards, s: r.act.spinCleared })); }
  { const r = rs(mon("한카리아스", ["칼춤"], "까칠한피부", null, bulky)); check("8.3 B7 RS-e (검수 추가): 고속스핀은 접촉 기술 — 까칠한피부 상대에게 쓰면 시전자가 접촉 데미지를 받는다", r.n.a.currentHp < r.hpBefore, `전 ${r.hpBefore} 후 ${r.n.a.currentHp}`); }

  // ── B7-d: 지울 것이 없으면 spinCleared 키 자체가 없다(JSON·해시 불변) ──
  { const r = rs(); check("8.3 B7-d: 지울 것이 없으면 spinCleared 키가 없다(JSON에도 없음)", !("spinCleared" in r.act) && !json(r.act).includes("spinCleared"), json(Object.keys(r.act).filter((k) => /spin/i.test(k)))); }

  // ── B7-e: 데이터 불변식 ──
  { const moves = Object.values(JSON.parse(readFileSync(new URL("../../src/data/moves.json", import.meta.url), "utf8")));
    const hc = Object.fromEntries(moves.filter((m) => m.hazardClear).map((m) => [m.name, m.hazardClear]));
    const rapid = moves.find((m) => m.name === "고속스핀");
    check("8.3 B7-e: hazardClear를 가진 기술은 정리정돈(tidy)·고속스핀(spin)·킬러스핀(spin)이고 고속스핀은 접촉 기술", json(Object.entries(hc).sort()) === json([["고속스핀", "spin"], ["정리정돈", "tidy"], ["킬러스핀", "spin"]].sort()) && rapid.makesContact === true, json(hc)); }

  // ── B7-f: 화면 줄(문구 상수는 설계 §3-3 기본안) ──
  const lines = (props) => { try { return renderToStaticMarkup(React.createElement(AEL.ActionEffectLines, props)).replace(/<\/div>/g, "\n").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").split("\n").map((s) => s.trim()).filter(Boolean); } catch (e) { return ["렌더 오류: " + e.message]; } };
  const props = (act) => ({ action: act, actorName: "킬라플로르", defenderName: "킬라플로르" });
  const spinLines = (act) => lines(props(act)).filter((l) => /사라졌다|벗어났다/.test(l) && !/환경 효과/.test(l));
  { const want = ["킬라플로르는 씨뿌리기에서 벗어났다!", "킬라플로르 편 필드의 압정이 사라졌다!", "킬라플로르 편 필드의 독압정이 사라졌다!", "킬라플로르 편 필드의 뾰족한 바위가 사라졌다!", "킬라플로르 편 필드의 끈적끈적네트가 사라졌다!", "킬라플로르는 속박에서 벗어났다!"];
    check("8.3 B7-f: 제거 줄이 고정 순서(씨뿌리기 → 압정 → 독압정 → 스텔스록 → 네트 → 속박)로 나온다", json(spinLines(msc.act)) === json(want), json(spinLines(msc.act)));
    check("8.3 B7-f: 지운 것이 없으면(spinCleared 없음) 제거 줄이 없다", spinLines(play({ b: mon("핫삼", ["칼춤"], null, null, bulky), tweak: (st) => { st.sideA.hazards = hz({ stealthRock: true }); } }).act).length === 0);
    check("8.3 B7-f: 조사 — 독압정이(받침 있음)·스텔스 바위가(받침 없음)", josa.iGa("독압정") === "이" && josa.iGa("뾰족한 바위") === "가"); }

  // ── B7-g: 회귀 — 정리정돈·안개제거·일반 공격 줄은 그대로 ──
  { const tidy = play({ a: mon("잠만보", ["정리정돈"]), b: mon("잠만보", ["칼춤"], null, null, bulky), tweak: (st) => { st.sideA.hazards = hz({ stealthRock: true }); } });
    check("8.3 B7-g: 정리정돈은 '정리정돈 끝!' 줄을 그대로 내고 spinCleared는 없다", lines(props(tidy.act)).includes("정리정돈 끝!") && tidy.act.spinCleared === undefined, json(lines(props(tidy.act))));
    const defog = play({ a: mon("잠만보", ["안개제거"]), b: mon("잠만보", ["칼춤"], null, null, bulky), tweak: (st) => { st.sideA.hazards = hz({ stealthRock: true }); } });
    check("8.3 B7-g: 안개제거는 기존 문구를 그대로 내고 spinCleared는 없다", lines(props(defog.act)).includes("강한 바람이 불어 주위의 환경 효과가 모두 사라졌다!") && defog.act.spinCleared === undefined, json(lines(props(defog.act))));
    const plain = play({ a: mon("잠만보", ["드래곤클로"]), b: mon("잠만보", ["칼춤"], null, null, bulky) });
    check("8.3 B7-g: 일반 공격은 제거 줄이 없다", plain.act.spinCleared === undefined && lines(props(plain.act)).every((l) => !/사라졌다|벗어났다/.test(l)), json(lines(props(plain.act)))); }
}
