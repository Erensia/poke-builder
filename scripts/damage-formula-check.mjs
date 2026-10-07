/**
 * 정수 데미지 공식(2.4 B3) 회귀 검증 — 사용자가 외부 계산기(스마트누오·포케챔스·포챔스GG)로 모은 16개 난수 값과 16/16 일치하는지 본다.
 * 같은 입력을 ① 매치업 난수표 경로(evaluateSlotMatchup → damageParts) ② 배틀 엔진 경로(runTurn, 난수 0.5 = 93%) 두 곳에서 확인한다.
 * 실패가 하나라도 있으면 종료 코드 1.
 *
 *   npm run test:damage
 */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
let failed = 0;
try {
  const data = await server.ssrLoadModule("/src/lib/data.ts");
  const ev = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
  const fm = await server.ssrLoadModule("/src/lib/damageFormula.ts");
  const st = await server.ssrLoadModule("/src/lib/battle/state.ts");
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");

  const pts = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const slot = (pokemonId, extra = {}) => ({ pokemonId, ability: null, item: null, nature: null, points: pts, moves: [], ...extra });
  const onePerHit = [25, 27, 27, 27, 27, 27, 28, 28, 28, 28, 28, 30, 30, 30, 30, 31];

  // [이름, 공격측 슬롯, 기술, 방어측 슬롯, 평가 옵션, 기대 16개, 엔진 대조 여부, (선택) 엔진 상태 준비 함수]
  const cases = [
    ["① 글레이시아→패리퍼 프리즈드라이", slot("글레이시아"), "프리즈드라이", slot("패리퍼"), {},
      [268, 268, 276, 276, 280, 280, 288, 288, 292, 292, 300, 300, 304, 304, 312, 316], true],
    ["② +생명의구슬", slot("글레이시아", { item: "생명의구슬" }), "프리즈드라이", slot("패리퍼"), {},
      [348, 348, 359, 359, 364, 364, 374, 374, 380, 380, 390, 390, 395, 395, 406, 411], true],
    ["③ +빛의장막", slot("글레이시아"), "프리즈드라이", slot("패리퍼"), { screen: "lightScreen" },
      [134, 134, 138, 138, 140, 140, 144, 144, 146, 146, 150, 150, 152, 152, 156, 158], false],
    ["④ +급소", slot("글레이시아"), "프리즈드라이", slot("패리퍼"), { critical: true },
      [400, 400, 408, 412, 420, 424, 424, 432, 436, 444, 448, 448, 456, 460, 468, 472], false],
    ["⑤ 쾌청 리자몽 화염방사→패리퍼", slot("리자몽"), "화염방사", slot("패리퍼"), { weather: "쾌청" },
      [54, 55, 56, 57, 57, 58, 59, 60, 60, 60, 61, 62, 63, 63, 64, 65], false],
    ["⑥ +급소", slot("리자몽"), "화염방사", slot("패리퍼"), { weather: "쾌청", critical: true },
      [82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97], false],
    ["⑦ 글레이시아→잠만보 두꺼운지방", slot("글레이시아"), "프리즈드라이", slot("잠만보", { ability: "두꺼운지방" }), {},
      [24, 24, 24, 24, 24, 25, 25, 25, 25, 25, 27, 27, 27, 27, 27, 28], true],
    ["⑧ 스케일샷 2타", slot("한카리아스"), "스케일샷", slot("잠만보"), { multiHitCount: 2 }, onePerHit.map((x) => x * 2), false],
    ["⑨ 스케일샷 5타", slot("한카리아스"), "스케일샷", slot("잠만보"), { multiHitCount: 5 }, onePerHit.map((x) => x * 5), false],
    ["⑩ 화상 역린", slot("한카리아스"), "역린", slot("잠만보"), { attackerStatus: "burn", finalOffenseMultiplier: 0.5 },
      [60, 60, 61, 62, 63, 63, 64, 65, 66, 66, 67, 68, 69, 69, 70, 71], false],
    ["⑪ 용의이빨 역린", slot("한카리아스", { item: "용의이빨" }), "역린", slot("잠만보"), {},
      [144, 145, 147, 148, 150, 151, 153, 154, 157, 159, 160, 162, 163, 165, 166, 169], true],
    ["⑫ 하드록 아쿠아브레이크→폭타", slot("한카리아스"), "아쿠아브레이크", slot("폭타", { ability: "하드록" }), {},
      [162, 165, 165, 168, 168, 171, 174, 174, 177, 180, 180, 183, 186, 186, 189, 192], true],
    // ── 2.5 (사용자 검증 사례, 스마트누오·포챔스GG 16개 값) ──
    ["2.5-1a 필드 없음 에써르→잠만보 와이드포스", slot("에써르"), "와이드포스", slot("잠만보"), {}, [43, 45, 45, 45, 46, 46, 46, 48, 48, 48, 49, 49, 49, 51, 51, 52], false],
    ["2.5-1b 사이코필드", slot("에써르"), "와이드포스", slot("잠만보"), { field: "사이코필드" }, [85, 87, 88, 88, 90, 91, 91, 93, 94, 94, 96, 97, 97, 99, 100, 102], false],
    ["2.5-2a 멀티스케일 없음 에써르→망나뇽", slot("에써르"), "와이드포스", slot("망나뇽"), {}, [48, 48, 49, 49, 49, 51, 51, 51, 52, 52, 54, 54, 54, 55, 55, 57], false],
    ["2.5-2b 멀티스케일(최종 ×½)", slot("에써르"), "와이드포스", slot("망나뇽", { ability: "멀티스케일" }), {}, [24, 24, 24, 24, 24, 25, 25, 25, 26, 26, 27, 27, 27, 27, 27, 28], true],
    ["2.5-3a 복슬복슬 없음 번치코→묘두기 번개펀치", slot("번치코"), "번개펀치", slot("묘두기"), {}, [34, 34, 34, 35, 35, 36, 36, 36, 37, 37, 38, 38, 38, 39, 39, 40], false],
    ["2.5-3b 복슬복슬(접촉 최종 ×½)", slot("번치코"), "번개펀치", slot("묘두기", { ability: "복슬복슬" }), {}, [17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 20], true],
    ["2.5-4a 펑크록 없음 누리레느→스트린더 물거품아리아", slot("누리레느"), "물거품아리아", slot("스트린더"), {}, [84, 84, 85, 87, 87, 88, 90, 90, 91, 93, 93, 94, 96, 96, 97, 99], false],
    ["2.5-4b 펑크록(소리 최종 ×½)", slot("누리레느"), "물거품아리아", slot("스트린더", { ability: "펑크록" }), {}, [42, 42, 42, 43, 43, 44, 45, 45, 45, 46, 46, 47, 48, 48, 48, 49], true],
    ["2.5-5a 달인의띠 없음 히스이미끄래곤→보만다 냉동빔", slot("히스이미끄래곤"), "냉동빔", slot("보만다"), {}, [180, 180, 184, 184, 188, 188, 192, 192, 196, 196, 200, 200, 204, 204, 208, 212], false],
    ["2.5-5b 달인의띠(최종 ×1.2)", slot("히스이미끄래곤", { item: "달인의띠" }), "냉동빔", slot("보만다"), {}, [216, 216, 221, 221, 226, 226, 230, 230, 235, 235, 240, 240, 245, 245, 250, 254], true],
    ["2.5-6a 급류 없음 누리레느→스트린더", slot("누리레느"), "물거품아리아", slot("스트린더"), {}, [84, 84, 85, 87, 87, 88, 90, 90, 91, 93, 93, 94, 96, 96, 97, 99], false],
    ["2.5-6b 급류(공격 스탯 ×1.5)", slot("누리레느", { ability: "급류" }), "물거품아리아", slot("스트린더"), { pinchAssumed: true, abilityHpFraction: 0.3 }, [124, 126, 127, 129, 130, 132, 133, 135, 136, 138, 139, 141, 142, 144, 145, 147], true, (st) => { st.a.currentHp = Math.floor(st.a.maxHp / 3); }],
    ["2.5-7 비+급소 리자몽→핫삼 화염방사", slot("리자몽"), "화염방사", slot("핫삼"), { weather: "비", critical: true }, [196, 196, 196, 204, 204, 208, 208, 208, 216, 216, 220, 220, 220, 228, 228, 232], false],
    ["2.5-D3 비+급소 리자몽→보르그", slot("리자몽"), "화염방사", slot("보르그"), { weather: "비", critical: true }, [54, 54, 55, 55, 57, 57, 58, 58, 58, 60, 60, 61, 61, 63, 63, 64], false],
    ["2.5-D3 비+급소 리자몽→펜드라", slot("리자몽"), "화염방사", slot("펜드라"), { weather: "비", critical: true }, [108, 108, 110, 110, 114, 114, 116, 116, 116, 120, 120, 122, 122, 126, 126, 128], false],
    ["2.5-D3 비+급소 리자몽→아마루르가", slot("리자몽"), "화염방사", slot("아마루르가"), { weather: "비", critical: true }, [42, 43, 43, 43, 45, 45, 45, 46, 46, 46, 48, 48, 48, 49, 49, 51], false],
    ["2.5-D3 비+급소 리자몽→브리무음", slot("리자몽"), "화염방사", slot("브리무음"), { weather: "비", critical: true }, [39, 39, 39, 40, 40, 40, 42, 42, 42, 43, 43, 43, 45, 45, 45, 46], false],
    ["2.5-D3 비+급소 리자몽→모르페코", slot("리자몽"), "화염방사", slot("모르페코"), { weather: "비", critical: true }, [61, 63, 63, 64, 64, 66, 66, 67, 67, 69, 69, 70, 70, 72, 72, 73], false],
    ["2.5-D3 비+급소 리자몽→폭슬라이", slot("리자몽"), "화염방사", slot("폭슬라이"), { weather: "비", critical: true }, [42, 43, 43, 43, 45, 45, 45, 46, 46, 46, 48, 48, 48, 49, 49, 51], false],
    ["2.5-D2 맹화 리자몽→이어롭", slot("리자몽", { ability: "맹화" }), "화염방사", slot("이어롭"), { pinchAssumed: true, abilityHpFraction: 0.3 }, [84, 85, 87, 87, 88, 90, 90, 91, 93, 93, 94, 96, 96, 97, 99, 100], true, (st) => { st.a.currentHp = Math.floor(st.a.maxHp / 3); }],
    ["2.5-D2 맹화 리자몽→블래키", slot("리자몽", { ability: "맹화" }), "화염방사", slot("블래키"), { pinchAssumed: true, abilityHpFraction: 0.3 }, [66, 66, 67, 67, 69, 69, 70, 70, 72, 72, 73, 73, 75, 75, 76, 78], false],
    ["2.5-D2 맹화 리자몽→입치트", slot("리자몽", { ability: "맹화" }), "화염방사", slot("입치트"), { pinchAssumed: true, abilityHpFraction: 0.3 }, [260, 264, 266, 270, 272, 276, 278, 282, 284, 288, 290, 294, 296, 300, 302, 308], false],
    ["2.5-D2 맹화 리자몽→님피아", slot("리자몽", { ability: "맹화" }), "화염방사", slot("님피아"), { pinchAssumed: true, abilityHpFraction: 0.3 }, [66, 66, 67, 67, 69, 69, 70, 70, 72, 72, 73, 73, 75, 75, 76, 78], false],
    ["2.5-D2 맹화 리자몽→데덴네", slot("리자몽", { ability: "맹화" }), "화염방사", slot("데덴네"), { pinchAssumed: true, abilityHpFraction: 0.3 }, [112, 114, 115, 117, 118, 120, 120, 121, 123, 124, 126, 127, 129, 130, 132, 133], false],
    ["2.5-D2 맹화 리자몽→크레베이스", slot("리자몽", { ability: "맹화" }), "화염방사", slot("크레베이스"), { pinchAssumed: true, abilityHpFraction: 0.3 }, [296, 300, 302, 306, 312, 314, 318, 320, 324, 326, 332, 336, 338, 342, 344, 350], false],
    ["2.5-선파워 쾌청 리자몽→보르그", slot("리자몽", { ability: "선파워" }), "화염방사", slot("보르그"), { weather: "쾌청" }, [165, 166, 169, 171, 172, 175, 177, 178, 180, 183, 184, 186, 189, 190, 192, 195], false],
    ["2.5-선파워 쾌청 리자몽→펜드라", slot("리자몽", { ability: "선파워" }), "화염방사", slot("펜드라"), { weather: "쾌청" }, [330, 332, 338, 342, 344, 350, 354, 356, 360, 366, 368, 372, 378, 380, 384, 390], false],
    ["2.5-선파워 쾌청 리자몽→아마루르가", slot("리자몽", { ability: "선파워" }), "화염방사", slot("아마루르가"), { weather: "쾌청" }, [133, 135, 136, 138, 139, 141, 142, 144, 145, 147, 148, 150, 151, 153, 154, 157], false],
  ];

  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const fail = (msg) => {
    failed++;
    console.log("FAIL", msg);
  };

  for (const [name, atk, moveId, def, options, want, engine, prep] of cases) {
    const move = data.getMove(moveId);
    const res = ev.evaluateSlotMatchup(atk, move, def, options);
    if (!res?.damageParts) {
      fail(`${name}: damageParts 없음`);
      continue;
    }
    const got = fm.damageRollTotals(res.damageParts, res.defenseStat);
    if (!same(got, want)) fail(`${name} 난수표: ${got.join(",")} ≠ ${want.join(",")}`);

    if (engine) {
      // 엔진 경로: 난수 0.5 → 93%(16개 중 9번째, 인덱스 8)
      const toMon = (s, m) => ({ slot: { ...s, moves: [m, null, null, null] }, moves: [data.getMove(m)] });
      const a = toMon(atk, moveId);
      // 공격측 HP를 낮추는 준비(prep)가 있으면 상대가 먼저 때려 쓰러뜨리지 않게 변화기로 둔다
      const b = toMon(def, prep ? "칼춤" : "폭포오르기");
      const state = st.createBattleState({
        a: { slots: [a.slot], movesList: [a.moves] },
        b: { slots: [b.slot], movesList: [b.moves] },
      });
      prep?.(state);
      const out = rt.runTurn(state, { kind: "move", move: a.moves[0] }, { kind: "move", move: b.moves[0] }, () => 0.5);
      const hit = out.result.actions?.find((x) => x.actor === "a");
      if (hit?.damage !== want[8]) fail(`${name} 엔진: ${hit?.damage} ≠ ${want[8]}`);
    }
  }

  // 부수 확인: 아쿠아브레이크의 방어 하락(부가 효과)이 이번 데미지에 먼저 반영되지 않는다(데미지 계산은 부가 효과를 먼저 적용하지 않는다)
  {
    const res = ev.evaluateSlotMatchup(slot("한카리아스"), data.getMove("아쿠아브레이크"), slot("폭타"), {});
    if (res?.damageParts?.defenseRankMultiplier !== 1) fail("부가 효과 랭크 변화가 이번 타 계산에 반영됨");
  }

  // 외부 값이 없는 최종 단계 특성은 "특성 없음 표에 규칙을 그대로 적용한 값"과 같은지로 확인한다(2.5 D1-a)
  //  - 복슬복슬: 접촉 ×½(내림 쪽 반올림), 불꽃 ×2(정수 곱), 불꽃+접촉(불꽃펀치)은 두 배율을 먼저 곱해 합성 ×1
  //  - 파동의방호: 접촉 ×½만(불꽃 약점 없음)
  {
    const table = (a, m, d) => {
      const r = ev.evaluateSlotMatchup(a, data.getMove(m), d, {});
      return fm.damageRollTotals(r.damageParts, r.defenseStat);
    };
    const half = (v) => Math.max(1, Math.ceil(v / 2 - 0.5 - 1e-9));
    const check = (name, got, want) => {
      if (!same(got, want)) fail(`${name}: ${got.join(",")} ≠ ${want.join(",")}`);
    };
    const fluffy = slot("묘두기", { ability: "복슬복슬" });
    check("복슬복슬 불꽃(비접촉) ×2", table(slot("번치코"), "화염방사", fluffy), table(slot("번치코"), "화염방사", slot("묘두기")).map((v) => v * 2));
    check("복슬복슬 불꽃펀치(접촉+불꽃) 합성 ×1", table(slot("번치코"), "불꽃펀치", fluffy), table(slot("번치코"), "불꽃펀치", slot("묘두기")));
    const ward = slot("루카리오", { ability: "파동의방호" });
    check("파동의방호 접촉 ×½", table(slot("번치코"), "번개펀치", ward), table(slot("번치코"), "번개펀치", slot("루카리오")).map(half));
    check("파동의방호 비접촉 ×1", table(slot("번치코"), "화염방사", ward), table(slot("번치코"), "화염방사", slot("루카리오")));
  }

  // 판정 배지(2.5 D4-a·D5): 단타는 난수표 판정과 같아야 하고, 다단히트는 타별 독립 난수를 전수 열거한 확률과 같아야 한다
  {
    const sc = await server.ssrLoadModule("/src/lib/statCalculator.ts");
    const nodeFs = await import("node:fs");
    const parties = JSON.parse(nodeFs.readFileSync(new URL("../src/data/samplePartyPresets.json", import.meta.url), "utf8"));
    const slots = parties.flatMap((p) => p.slots);
    const defenders = slots.filter((s) => !s.activeMegaForm);
    let compared = 0;
    slots.forEach((a, i) => {
      const d = defenders[(i * 7) % defenders.length];
      const hp = sc.computeRealStats(data.getPokemon(d.pokemonId).baseStats, d.points, d.nature).hp;
      for (const mv of a.moves) {
        const move = data.getMove(mv);
        const r = move && ev.evaluateSlotMatchup(a, move, d, {});
        if (!r?.damageParts || r.damageParts.hitPowers.length !== 1) continue;
        compared++;
        const rolls = fm.damageRollTotals(r.damageParts, r.defenseStat);
        const killing = rolls.filter((x) => x >= hp).length;
        const want = killing === 16 ? "guaranteed-1hit" : killing > 0 ? "random-1hit" : rolls[0] * 2 >= hp ? "guaranteed-2hit" : null;
        if (want && r.verdict !== want) fail(`판정 배지 ${a.pokemonId} ${mv}→${d.pokemonId}: ${r.verdict} ≠ ${want}`);
        if (want === "random-1hit" && r.killingRolls?.[0] !== killing) fail(`판정 배지 격파 난수 수 ${a.pokemonId} ${mv}→${d.pokemonId}`);
      }
    });
    if (compared < 100) fail(`판정 배지 비교 표본 부족: ${compared}`);
    // 독립 난수 전수 열거: 위력 40짜리 2타를 중앙 HP 경계에서 직접 센다
    const parts = { hitPowers: [40, 40], attackTerm: 100, defenseKey: "def", defenseRankMultiplier: 1, baseMultiplier: 1, bulkMultiplier: 1,
      weatherMultiplier: 1, critMultiplier: 1, stabMultiplier: 1, typeEffectiveness: 1, finalMultiplier: 1 };
    const one = Array.from({ length: 16 }, (_, k) => fm.integerHitDamage(parts, 40, 100, (85 + k) / 100));
    const pairs = one.flatMap((x) => one.map((y) => x + y));
    const hpEdge = pairs.slice().sort((x, y) => x - y)[128];
    const exact = pairs.filter((x) => x >= hpEdge).length / 256;
    const got = fm.koChanceByUses(parts, 100, hpEdge);
    if (got?.uses !== 1 || Math.abs(got.probability - exact) > 1e-9) fail(`다단히트 격파 확률 ${got?.probability} ≠ ${exact}`);
  }

  console.log(failed ? `${failed} FAIL` : `ALL PASS (${cases.length}건 난수표 + 엔진 대조)`);
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
