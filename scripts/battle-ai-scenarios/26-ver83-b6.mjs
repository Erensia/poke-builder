// 8.3 B6 매직미러 반사 로그: 반사된 행동을 "방어측이 되받아쳐 쓴 것"으로 읽어 3줄로 그린다(① 시전자의 기술 / ② 방어측의 특성 안내 / ③ `{방어측}은/는 {기술}을/를 되받아쳤다!` + 효과).
// 엔진 규칙·로그 필드는 안 바뀐다(화면 문구만). 엔진이 반사 구간에서 방어측을 사용자·시전자를 대상으로 처리하므로 이름과 체력 표기 편을 맞바꾼 사본으로 그린다.
// 설계 `8.3-B6-매직미러반사로그설계.md`, 검수 `8.3-B6-매직미러반사로그설계-검수.md`
import { readFileSync } from "node:fs";
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const fe = await server.ssrLoadModule("/src/lib/fieldEffects.ts");
  const josa = await server.ssrLoadModule("/src/lib/josa.ts");
  const AML = await server.ssrLoadModule("/src/components/turnLog/ActionMainLine.tsx");
  const RV = await server.ssrLoadModule("/src/components/turnLog/reflectedView.ts");
  const AEL = await server.ssrLoadModule("/src/components/turnLog/ActionEffectLines.tsx");
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const R = (v) => () => v;
  const json = JSON.stringify;

  // 줄 텍스트: 구현 전에는 옛 조합(ActionMainLine + ActionEffectLines), 구현 후에는 ActionLines — 렌더 오류는 실패로 보이게 문자열로 돌려준다
  const text = (el) => renderToStaticMarkup(el).replace(/<\/div>/g, "\n").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").split("\n").map((s) => s.trim()).filter(Boolean);
  const render = (props) => {
    try {
      const el = AML.ActionLines
        ? React.createElement(AML.ActionLines, props)
        : React.createElement(React.Fragment, null, React.createElement(AML.ActionMainLine, props), React.createElement(AEL.ActionEffectLines, props));
      return text(el);
    } catch (e) { return ["렌더 오류: " + e.message]; }
  };

  // a(킬라플로르)가 move를 쓴다. 기본은 b(브리무음)가 매직미러. warm: 먼저 칼춤을 한 턴 써서 직전 기술이 있게 한다(앙코르·사슬묶기·원한)
  const play = (move, { aName = "킬라플로르", bName = "브리무음", bAbility = "매직미러", aAbility = "독치장", aItem = null, warm = false } = {}) => {
    let st = battle([mon(aName, [move, "칼춤"], aAbility, aItem)], [mon(bName, ["칼춤"], bAbility)]);
    if (warm) st = rt.runTurn(st, mv("칼춤"), mv("칼춤"), R(0.5)).nextState;
    const o = rt.runTurn(st, mv(move), mv("칼춤"), R(0.5));
    const action = o.result.actions.find((x) => x.actor === "a");
    const props = { action, actorName: aName, defenderName: bName, headDamage: 0, headDamagePercent: 0 };
    return { action, props, lines: action ? render(props) : ["행동 없음"], ns: o.nextState, result: o.result };
  };
  const back = (m, who = "브리무음") => `${who}${josa.eunNeun(who)} ${m}${josa.eulReul(m)} 되받아쳤다!`;
  const STAR = (m, ...effects) => [`킬라플로르의 ${m}`, "브리무음의 매직미러!", ...effects];

  // ── B6-a: 스텔스록 반사 — 3줄 ──
  { const r = play("스텔스록"); check("8.3 B6-a: 스텔스록 반사 → 3줄(시전자 기술 / 매직미러! / 되받아쳤다! · 상대 편 필드…)", json(r.lines) === json([...STAR("스텔스록", `${back("스텔스록")} · 상대 편 필드에 뾰족한 바위가 깔렸다!`)]), json(r.lines)); }

  // ── B6-b: 나머지 설치물 3종 — 조사(압정뿌리기를·독압정을·끈적끈적네트를)·"상대 편" 문구, 실제 설치 편 = 시전자(a) 편 ──
  for (const [m, tail, key] of [["압정뿌리기", "상대 편 필드에 압정이 흩뿌려졌다!", "spikesLayers"], ["독압정", "상대 편 필드에 독 압정이 흩뿌려졌다!", "toxicSpikesLayers"], ["끈적끈적네트", "상대 편 필드에 끈적끈적네트가 펼쳐졌다!", "stickyWeb"]]) {
    const r = play(m);
    check(`8.3 B6-b: ${m} 반사 → 3번째 줄 \`…${josa.eulReul(m)} 되받아쳤다! · 상대 편 필드에…\`, 설치는 시전자 편`, json(r.lines) === json(STAR(m, `${back(m)} · ${tail}`)) && !!r.ns.sideA.hazards[key] && !r.ns.sideB.hazards[key], json(r.lines));
  }

  // ── B6-c: 상태이상 — 효과 줄 대상은 시전자 ──
  { const r = play("도깨비불"); check("8.3 B6-c: 도깨비불 반사 → 효과 줄 `킬라플로르는 화상을 입었다!`", json(r.lines) === json(STAR("도깨비불", back("도깨비불"), "킬라플로르는 화상을 입었다!")), json(r.lines)); }
  { const r = play("전기자석파"); check("8.3 B6-c: 전기자석파 반사 → 효과 줄 대상 = 시전자", json(r.lines) === json(STAR("전기자석파", back("전기자석파"), "킬라플로르는 마비되어 기술이 나오기 어려워졌다!")), json(r.lines)); }

  // ── B6-d: 하품 — "상대" 접두(비반사와 같은 문구, 검수 V4 ✅) ──
  { const r = play("하품"); check("8.3 B6-d: 하품 반사 → 효과 줄 `상대 킬라플로르의 졸음을 유도했다!`", json(r.lines) === json(STAR("하품", back("하품"), "상대 킬라플로르의 졸음을 유도했다!")), json(r.lines)); }

  // ── B6-e: 앙코르 — 현행 엔진 출력 고정. 주석: Showdown은 반사된 앙코르가 항상 실패한다(백로그 F8) — 규칙을 고칠 때 이 기대값을 바꾼다 ──
  { const r = play("앙코르", { warm: true }); check("8.3 B6-e: 앙코르 반사 → 3번째 줄 `…앙코르를 되받아쳤다! · 앙코르밖에 쓸 수 없다!`(현행 엔진, Showdown은 항상 실패 — F8)", json(r.lines) === json(STAR("앙코르", `${back("앙코르")} · 앙코르밖에 쓸 수 없다!`)), json(r.lines)); }

  // ── B6-f: 랭크를 낮추는 변화기 — 효과 줄 대상은 시전자(변경 전과 같은 결과) ──
  { const all = JSON.parse(readFileSync(new URL("../../src/data/moves.json", import.meta.url), "utf8"));
    const drop = (Array.isArray(all) ? all : Object.values(all)).find((m) => m.category === "status" && !m.notReflectable && m.statChanges?.length && m.statChanges.every((s) => s.target === "opponent" && s.delta < 0));
    const r = drop ? play(drop.name) : null;
    check(`8.3 B6-f: 랭크 하락 변화기(${drop?.name}) 반사 → 효과 줄 대상 = 시전자·3번째 줄은 되받아쳤다!`, !!r && r.lines.length >= 4 && r.lines[2] === back(drop.name) && r.lines.slice(3).some((l) => l.startsWith("킬라플로르의 ")) && !r.lines.slice(3).some((l) => l.startsWith("브리무음의 ")), json(r?.lines)); }

  // ── B6-g: 특성 무효화(위액) — 대상 이름이 시전자(구현 전엔 반사 구분이 없어 반사한 쪽으로 오표기) ──
  { const r = play("위액"); check("8.3 B6-g: 위액 반사 → `킬라플로르의 특성이 효과를 잃었다!`", json(r.lines) === json(STAR("위액", `${back("위액")} · 킬라플로르의 특성이 효과를 잃었다!`)), json(r.lines)); }

  // ── B6-h: 타입 덮어쓰기·추가 — 대상 = 시전자 ──
  for (const [m, eff] of [["물붓기", "킬라플로르는 물타입 타입이 되었다!"], ["핼러윈", "킬라플로르는 고스트타입 타입이 추가되었다!"], ["숲의저주", "킬라플로르는 풀타입 타입이 추가되었다!"], ["마법가루", "킬라플로르는 에스퍼타입 타입이 되었다!"]]) {
    const r = play(m); check(`8.3 B6-h: ${m} 반사 → \`${eff}\``, json(r.lines) === json(STAR(m, back(m), eff)), json(r.lines));
  }

  // ── B6-i: 검은눈빛(도망칠 수 없다) ──
  { const r = play("검은눈빛"); check("8.3 B6-i: 검은눈빛 반사 → `킬라플로르는 이제 도망칠 수 없다!`", json(r.lines) === json(STAR("검은눈빛", back("검은눈빛"), "킬라플로르는 이제 도망칠 수 없다!")), json(r.lines)); }

  // ── B6-j: 원한 — PP가 깎이는 쪽은 시전자, 기술은 원한 자신(엔진도 Showdown과 같다: 검수 가정 정정, 실제 출력 확인) ──
  { const r = play("원한", { warm: true }); check("8.3 B6-j: 원한 반사 → `킬라플로르의 원한의 PP가 4 줄었다!`(원한 자신의 PP — Showdown과 같다)", json(r.lines) === json(STAR("원한", `${back("원한")} · 킬라플로르의 원한의 PP가 4 줄었다!`)), json(r.lines)); }

  // ── B6-s: 사슬묶기 — 봉인되는 것은 사슬묶기 자신(엔진도 Showdown과 같다) ──
  { const r = play("사슬묶기", { warm: true }); check("8.3 B6-s: 사슬묶기 반사 → `… · 사슬묶기 봉인!`", json(r.lines) === json(STAR("사슬묶기", `${back("사슬묶기")} · 사슬묶기 봉인!`)), json(r.lines)); }

  // ── B6-k: 씨뿌리기 ──
  { const r = play("씨뿌리기"); check("8.3 B6-k: 씨뿌리기 반사 → 3번째 줄 `…씨뿌리기를 되받아쳤다! · 씨앗을 심었다!`", json(r.lines) === json(STAR("씨뿌리기", `${back("씨뿌리기")} · 씨앗을 심었다!`)), json(r.lines)); }

  // ── B6-l: 부식가스 — 도구를 잃는 쪽은 시전자 ──
  { const r = play("부식가스", { aItem: "생명의구슬" }); check("8.3 B6-l: 부식가스 반사 → `킬라플로르의 생명의구슬이 녹아버렸다!`", json(r.lines) === json(STAR("부식가스", back("부식가스"), "킬라플로르의 생명의구슬이 녹아버렸다!")), json(r.lines)); }

  // ── B6-m: 전수 점검 — 엔진 반사 대상을 방어측 매직미러로 전부 실행해 구조 불변식 확인, 목록 출력(F8 입력) ──
  const all = JSON.parse(readFileSync(new URL("../../src/data/moves.json", import.meta.url), "utf8"));
  const reflectable = (Array.isArray(all) ? all : Object.values(all)).filter((m) => m.category === "status" && !m.notReflectable && (fe.isOpponentTargetingMove(m) || m.setsHazard));
  const bad = [], skipped = [], executed = [];
  const switched = [];
  for (const m of reflectable) {
    let r;
    try { r = play(m.name, { aItem: "생명의구슬", warm: true }); } catch { skipped.push(`${m.name}(예외)`); continue; }
    if (!r.action?.bouncedMoveName) { skipped.push(m.name); continue; }
    executed.push(m.name);
    const L = r.lines;
    const ok = L.length >= 3 && L[0] === `킬라플로르의 ${m.name}` && L[1] === "브리무음의 매직미러!" && L[2].startsWith(back(m.name)) && !L.some((l) => l.includes("되돌아왔다") || l.includes("시전자 쪽"));
    if (!ok) bad.push(`${m.name}: ${json(L)}`);
    if (r.result.switches.length) switched.push(m.name);
  }
  console.log(`[B6-m] 엔진 반사 대상 ${reflectable.length}종(실행 ${executed.length}, 반사 안 일어남 ${skipped.length}): ${reflectable.map((m) => m.name).join(", ")}${skipped.length ? " | 반사 안 일어남: " + skipped.join(", ") : ""}`);
  check(`8.3 B6-m: 엔진 반사 대상 ${reflectable.length}종 전수 — 실행된 ${executed.length}종 모두 줄 구성 불변식(3줄·시전자 기술·매직미러!·되받아쳤다!·옛 문구 없음)`, bad.length === 0 && executed.length > 0, bad.slice(0, 3).join(" / "));

  // ── B6-n: 비반사 회귀 — 구현 전 출력을 박은 리터럴과 같다(구현 전에도 후에도 통과) ──
  for (const [m, opt, want] of [
    ["스텔스록", {}, ["킬라플로르의 스텔스록 · 상대 편 필드에 뾰족한 바위가 깔렸다!"]],
    ["도깨비불", {}, ["킬라플로르의 도깨비불", "브리무음은 화상을 입었다!"]],
    ["앙코르", { warm: true }, ["킬라플로르의 앙코르 · 칼춤밖에 쓸 수 없다!"]],
    ["하품", {}, ["킬라플로르의 하품", "상대 브리무음의 졸음을 유도했다!"]],
    ["칼춤", {}, ["킬라플로르의 칼춤", "킬라플로르의 공격이 크게 올라갔다!"]],
    ["지진", {}, ["킬라플로르의 지진 — 0 데미지 (0.0%)"]],
  ]) { const r = play(m, { bAbility: null, ...opt }); check(`8.3 B6-n: 비반사 ${m} 출력은 변경 전과 같다`, json(r.lines) === json(want) && !r.action.bouncedMoveName, json(r.lines)); }

  // ── B6-o: reflectedView 단위 — 이름 맞바꿈·편 뒤집기·반사/흉내쟁이/잠꼬대 표기 제거, 원본 불변 ──
  { const base = play("스텔스록").action; const fake = { ...base, copycatCalledMoveName: "스텔스록", sleepTalkCalledMoveName: "스텔스록" };
    const rv = typeof RV.reflectedView === "function" ? RV.reflectedView({ action: fake, actorName: "킬라플로르", defenderName: "브리무음" }) : null;
    check("8.3 B6-o: reflectedView — 이름·편 맞바꿈, bounced*·흉내쟁이·잠꼬대 제거, 원본 불변", !!rv && rv.actorName === "브리무음" && rv.defenderName === "킬라플로르" && rv.action.actor === "b" && !("bouncedMoveName" in rv.action) && !("bouncedByAbilityName" in rv.action) && !("copycatCalledMoveName" in rv.action) && !("sleepTalkCalledMoveName" in rv.action)
      && fake.actor === "a" && fake.bouncedMoveName === "스텔스록" && fake.copycatCalledMoveName === "스텔스록", json(rv && { a: rv.actorName, d: rv.defenderName, act: rv.action.actor })); }

  // ── B6-p: 흉내쟁이·잠꼬대로 낸 기술을 반사 — 그 표기는 ①에만 나온다 ──
  { const base = play("스텔스록"); const props = { ...base.props, action: { ...base.action, copycatCalledMoveName: "스텔스록", sleepTalkCalledMoveName: "스텔스록" } };
    const L = render(props);
    check("8.3 B6-p: 흉내쟁이·잠꼬대 표기는 ①(시전자 기술 줄)에만, ③에는 없다", json(L) === json(["킬라플로르의 흉내쟁이!", "킬라플로르의 스텔스록 (잠꼬대로 냈다!)", "브리무음의 매직미러!", `${back("스텔스록")} · 상대 편 필드에 뾰족한 바위가 깔렸다!`]), json(L)); }

  // ── B6-q: 교체 줄 불변식(데이터) — 반사 대상에 교체를 일으키는 기술이 없고, 반사 결과에 교체 기록도 없다. 교체 줄 3종은 원래 action.actor 기준으로 그려도 충돌하지 않는다(설계 C10) ──
  { const sw = reflectable.filter((m) => m.selfSwitchAfterUse || m.forcesTargetSwitch || m.shedTail || m.returnsToTrainer).map((m) => m.name);
    check("8.3 B6-q: 반사 대상 중 교체를 일으키는 기술 없음(데이터)·반사 결과에 교체 기록 없음", sw.length === 0 && switched.length === 0, `기술=${sw.join(",")} 결과=${switched.join(",")}`); }

  // ── B6-r: 받침 없는 반사한 쪽(에브이) — 에브이는 / 브리무음은 조사 분기 ──
  { const r = play("스텔스록", { bName: "에브이" }); check("8.3 B6-r: 에브이가 반사 → `에브이의 매직미러!` / `에브이는 스텔스록을 되받아쳤다! …`", r.lines[1] === "에브이의 매직미러!" && r.lines[2].startsWith("에브이는 스텔스록을 되받아쳤다!"), json(r.lines)); }
}
