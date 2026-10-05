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

  // [이름, 공격측 슬롯, 기술, 방어측 슬롯, 평가 옵션, 기대 16개, 엔진 대조 여부]
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
  ];

  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const fail = (msg) => {
    failed++;
    console.log("FAIL", msg);
  };

  for (const [name, atk, moveId, def, options, want, engine] of cases) {
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
      const b = toMon(def, "폭포오르기");
      const state = st.createBattleState({
        a: { slots: [a.slot], movesList: [a.moves] },
        b: { slots: [b.slot], movesList: [b.moves] },
      });
      const out = rt.runTurn(state, { kind: "move", move: a.moves[0] }, { kind: "move", move: b.moves[0] }, () => 0.5);
      const hit = out.result.actions?.find((x) => x.actor === "a");
      if (hit?.damage !== want[8]) fail(`${name} 엔진: ${hit?.damage} ≠ ${want[8]}`);
    }
  }

  // 부수 확인: 아쿠아브레이크의 방어 하락(부가 효과)이 이번 데미지에 먼저 반영되지 않는다(기본 applyMoveOwnStatChanges=false)
  {
    const res = ev.evaluateSlotMatchup(slot("한카리아스"), data.getMove("아쿠아브레이크"), slot("폭타"), {});
    if (res?.damageParts?.defenseRankMultiplier !== 1) fail("부가 효과 랭크 변화가 이번 타 계산에 반영됨");
  }

  console.log(failed ? `${failed} FAIL` : `ALL PASS (${cases.length}건 난수표 + 엔진 대조)`);
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
