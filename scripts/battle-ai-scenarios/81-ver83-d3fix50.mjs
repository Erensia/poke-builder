// 8.3 D3-fix-50 (E8-32) 프레셔 PP 차감 정합. 설계 `8.3-D3-fix50-프레셔설계.md` §4, 검수 `…-검수.md`(515종 전수 실측 `fix50-review-run.cjs`).
// 추가 차감 = 기술이 겨냥하는 상대 편 프레셔 수: 자기·자기편 진영·아군 대상은 0(면제 76종 `pressureExempt`), 상대·필드는 1, `mustpressure` 4종은 1, 저주는 비고스트 0.
import { readFileSync } from "node:fs";
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const ra = await server.ssrLoadModule("/src/lib/battle/resolveAction.ts");
  const M = (x) => data.getMove(x);
  const mv = (x) => ({ kind: "move", move: M(x) });
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const tank = pts({ hp: 32, def: 32 });
  const noRng = () => 0.5;
  // 공격측(a)이 방어측(b)을 상대로 기술 하나를 쓴다 — PP 차감은 성공 여부와 무관하게 payMovePp에서 일어난다. 기술 슬롯별 감소량을 돌려준다.
  const mk = ({ aMon = "잠만보", aMoves, aAbility = null, bAbility = "프레셔", asleep = false }) => {
    const st = battle([mon(aMon, aMoves, aAbility, null, tank)], [mon("아머까오", ["방어"], bAbility, null, tank)]);
    if (asleep) st.a.status = { condition: "sleep", turnsElapsed: 1, sleepTurns: 3 };
    return st;
  };
  const used = (st, pp0) => Object.fromEntries(Object.keys(pp0).map((id) => [id, pp0[id] - st.a.remainingPp[id]]));
  const cost = (move, opts = {}) => {
    const st = mk({ aMoves: [move, "칼춤"], ...opts }); const pp0 = { ...st.a.remainingPp };
    const r = ra.resolveAction(st, "a", M(move), noRng, false, M("방어"));
    return { n: pp0[move] - st.a.remainingPp[move], r };
  };
  const costs = (moves, opts) => Object.fromEntries(moves.map((m) => [m, cost(m, opts).n]));
  const allEq = (got, want) => Object.values(got).every((v) => v === want);

  guard("D3-fix50 1: 자기 대상(칼춤·방어·대타출동·배북·아쿠아링·HP회복) → 프레셔여도 −1", () => {
    const got = costs(["칼춤", "방어", "대타출동", "배북", "아쿠아링", "HP회복"]);
    return allEq(got, 1) ? true : JSON.stringify(got);
  });
  guard("D3-fix50 2: 자기편 진영(리플렉터·빛의장막·순풍·신비의부적) → −1", () => {
    const got = costs(["리플렉터", "빛의장막", "순풍", "신비의부적"]);
    return allEq(got, 1) ? true : JSON.stringify(got);
  });
  guard("D3-fix50 3: 상대 진영 설치기 — 압정뿌리기·스텔스록·독압정(mustpressure) −2 / 끈적끈적네트 −1", () => {
    const got = costs(["압정뿌리기", "스텔스록", "독압정", "끈적끈적네트"]);
    return got["압정뿌리기"] === 2 && got["스텔스록"] === 2 && got["독압정"] === 2 && got["끈적끈적네트"] === 1 ? true : JSON.stringify(got);
  });
  guard("D3-fix50 4: 필드·상대 대상 변화기(비바라기·트릭룸·안개제거·도발·사슬묶기·맹독) → −2", () => {
    const got = costs(["비바라기", "트릭룸", "안개제거", "도발", "사슬묶기", "맹독"]);
    return allEq(got, 2) ? true : JSON.stringify(got);
  });
  guard("D3-fix50 5: 공격기(물의파동·지진·스위프뺨치기) → −2", () => {
    const got = costs(["물의파동", "지진", "스위프뺨치기"]);
    return allEq(got, 2) ? true : JSON.stringify(got);
  });
  guard("D3-fix50 6: 봉인(대상 self지만 mustpressure) → −2", () => {
    const got = cost("봉인").n;
    return got === 2 ? true : `봉인 ${got}`;
  });
  guard("D3-fix50 7: 회귀 — 프레셔 없는 상대면 모든 기술 −1", () => {
    const got = costs(["칼춤", "압정뿌리기", "물의파동", "봉인", "끈적끈적네트", "저주"], { bAbility: null });
    return allEq(got, 1) ? true : JSON.stringify(got);
  });
  // ── 8 호출 계열: 호출된 기술의 대상으로 판정하고 호출한 슬롯에서 차감 ──
  guard("D3-fix50 8: 잠꼬대·흉내쟁이 — 호출된 기술 기준(깨물어부수기 −2·칼춤 −1·스텔스록 −2·끈적끈적네트 −1), 호출한 슬롯에서 차감·호출된 슬롯은 불변", () => {
    const bad = [];
    for (const [called, want] of [["깨물어부수기", 2], ["칼춤", 1], ["스텔스록", 2], ["끈적끈적네트", 1]]) {
      const st = mk({ aMoves: ["잠꼬대", called], asleep: true }); const pp0 = { ...st.a.remainingPp };
      const r = ra.resolveAction(st, "a", M("잠꼬대"), noRng, false, M("방어"));
      const u = used(st, pp0);
      if (r.sleepTalkCalledMoveName !== called || u["잠꼬대"] !== want || u[called] !== 0) bad.push(`잠꼬대→${called} 호출=${r.sleepTalkCalledMoveName} ${JSON.stringify(u)} 기대 ${want}`);
    }
    for (const [called, want] of [["깨물어부수기", 2], ["칼춤", 1]]) {
      const st = mk({ aMoves: ["흉내쟁이", "칼춤"] }); st.lastMoveUsedId = called; const pp0 = { ...st.a.remainingPp };
      const r = ra.resolveAction(st, "a", M("흉내쟁이"), noRng, false, M("방어"));
      if (r.copycatCalledMoveName !== called || pp0["흉내쟁이"] - st.a.remainingPp["흉내쟁이"] !== want) bad.push(`흉내쟁이→${called} 호출=${r.copycatCalledMoveName} 슬롯=${pp0["흉내쟁이"] - st.a.remainingPp["흉내쟁이"]} 기대 ${want}`);
    }
    return bad.length === 0 ? true : bad.join(" | ");
  });
  // ── 9 연속 사용(R3): 추가 −1은 PP를 새로 쓰는 턴에만(프레셔 − 대조 = 그 턴의 대조 PP 감소량) ──
  guard("D3-fix50 9: 연속 사용(역린·솔라빔·파괴광선) — 프레셔 추가분은 PP를 새로 쓰는 턴에만, 이어 쓰기·차지 2턴째·반동 턴은 0(구르기·소란은 엔진에 없음)", () => {
    const bad = [];
    const turns = (move, bAbility) => {
      let st = mk({ aMoves: [move, "칼춤"], bAbility }); const seq = [];
      for (let t = 0; t < 3; t++) { const pp0 = st.a.remainingPp[move]; st = rt.runTurn(st, mv(move), mv("칼춤"), noRng).nextState; seq.push(pp0 - st.a.remainingPp[move]); }
      return seq;
    };
    for (const m of ["역린", "솔라빔", "구르기", "소란", "파괴광선"]) {
      if (!data.getMove(m)) continue;
      const p = turns(m, "프레셔"), c = turns(m, null); const extra = p.map((v, i) => v - c[i]);
      if (!c.some((v) => v === 0) || !extra.every((e, i) => e === c[i])) bad.push(`${m}: 프레셔 ${p} 대조 ${c} 추가 ${extra}`);
    }
    return bad.length === 0 ? true : bad.join(" | ");
  });
  // ── 10 데이터 대조 ──
  const EXEMPT76 = ("토치카 소울비트 성장 킹실드 배수의진 방어 니들가드 볼가득넣기 희망사항 녹기 고속이동 사이드체인지 망각술 아쿠아링 배턴터치 배북 벌크업 명상 충전 똬리틀기 흉내쟁이 코스믹파워 코튼가드 길동무 판별 그림자분신 용의춤 버티기 기충전 날따름 치유소원 뿌리박기 철벽 전자부유 작아지기 달빛 아침햇살 나쁜음모 파워트릭 나비춤 분노가루 HP회복 리사이클 잠자기 회생의기도 록커트 날개쉬기 꼬리자르기 껍질깨기 농성 게으름피우기 잠꼬대 비축하기 대타출동 꿀꺽 칼춤 광합성 정리정돈 "
    + "오로라베일 빛의장막 자기장조작 패스트가드 리플렉터 신비의부적 순풍 와이드가드 드래곤옐 아로마미스트 코칭 도우미 멀리짖기 생명의물방울 우유마시기 경혈찌르기 치료방울 끈적끈적네트").split(" ");
  guard("D3-fix50 10: 데이터 — pressureExempt 집합 = 부록 A 76종, 봉인·압정뿌리기·스텔스록·독압정·저주는 표시 없음, 엔진에 없는 3종(파워시프트·기어체인지·알낳기)은 moves.json에 없다", () => {
    const moves = JSON.parse(readFileSync("src/data/moves.json", "utf8"));
    const got = moves.filter((m) => m.pressureExempt === true).map((m) => m.id).sort();
    const want = [...EXEMPT76].sort();
    const wrong = ["봉인", "압정뿌리기", "스텔스록", "독압정", "저주"].filter((n) => moves.find((m) => m.id === n)?.pressureExempt);
    const missing = ["파워시프트", "기어체인지", "알낳기"].filter((n) => moves.some((m) => m.id === n));
    return EXEMPT76.length === 76 && JSON.stringify(got) === JSON.stringify(want) && wrong.length === 0 && missing.length === 0
      ? true : JSON.stringify({ 기대수: EXEMPT76.length, 실제수: got.length, 빠짐: want.filter((x) => !got.includes(x)), 넘침: got.filter((x) => !want.includes(x)), 잘못표시: wrong, 엔진에있음: missing });
  });
  guard("D3-fix50 11: 로그 — 자기 대상 기술에는 pressureExtraPpAbilityName 없음 / 상대 대상에는 프레셔 이름", () => {
    const self = cost("칼춤").r.pressureExtraPpAbilityName, foe = cost("물의파동").r.pressureExtraPpAbilityName;
    return self === undefined && foe === "프레셔" ? true : JSON.stringify({ self, foe });
  });
  guard("D3-fix50 12: 저주(R1) — 비고스트 사용자 −1 / 고스트 사용자 −2", () => {
    const non = cost("저주").n, ghost = cost("저주", { aMon: "팬텀" }).n;
    return non === 1 && ghost === 2 ? true : JSON.stringify({ 비고스트: non, 고스트: ghost });
  });
  guard("D3-fix50 13: 틀깨기 공격자도 프레셔를 무시하지 못한다(R2) — 아이언헤드 −2·칼춤 −1", () => {
    const got = costs(["아이언헤드", "칼춤"], { aAbility: "틀깨기" });
    return got["아이언헤드"] === 2 && got["칼춤"] === 1 ? true : JSON.stringify(got);
  });
}
