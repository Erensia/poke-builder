// 8.3 D3-fix-13 자이로볼 위력식을 Showdown식으로 정정(사용자 확정식 번복, 2026-11-19): Showdown gyroball = min(150, floor(25 * 상대 / 나) + 1), 내 스피드 0이면 1.
// 이전 확정식 `25×(t/p+1)`은 phase7.5-plan.md:161. 설계 `8.3-D3-fix13-자이로볼식설계.md`(검수 `…-검수.md`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const ph = await server.ssrLoadModule("/src/lib/battle/preHitEffects.ts");
  const bp = await server.ssrLoadModule("/src/lib/battlePower.ts");
  const me = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
  const md = await server.ssrLoadModule("/src/lib/battle/ai/moveDamage.ts");
  const json = JSON.stringify;
  const M = (n) => data.getMove(n);
  const IDLE = "도우미";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const fast = pts({ spe: 32 }), bulky = pts({ hp: 32, def: 32, spd: 32 });
  const gyro = (u, t) => bp.gyroBallPowerFromSpeeds(u, t);
  const ref = (u, t) => Math.min(Math.floor((25 * t) / u) + 1, 150); // Showdown 소스 순서 — 곱 먼저

  guard("D3-fix13 1 값표 7행: 50/100 → 51, 100/100 → 26, 100/50 → 13, 100/200 → 51, 30/150 → 126, 150/30 → 6, 200/60 → 8", () => {
    const got = [[50, 100], [100, 100], [100, 50], [100, 200], [30, 150], [150, 30], [200, 60]].map(([u, t]) => gyro(u, t));
    return json(got) === json([51, 26, 13, 51, 126, 6, 8]) ? true : json(got);
  });
  guard("D3-fix13 2 참조 구현과 내 1~1000 × 상대 1~1000 전수 일치 + 곱 먼저 순서 가드(상대 161·나 35 → 116)", () => {
    if (gyro(35, 161) !== 116) return `곱 먼저 가드 실패: ${gyro(35, 161)}`;
    let bad = 0, first = null;
    for (let u = 1; u <= 1000; u++) for (let t = 1; t <= 1000; t++) if (gyro(u, t) !== ref(u, t)) { bad++; first ??= [u, t, gyro(u, t), ref(u, t)]; }
    return bad === 0 ? true : `${bad}쌍 불일치, 첫 ${json(first)}`;
  });
  guard("D3-fix13 3 상한·경계: (100,595) → 149, (100,596) → 150, (100,600) → 150, 내 스피드 0 → 1", () => {
    const got = [gyro(100, 595), gyro(100, 596), gyro(100, 600), gyro(0, 100)];
    return json(got) === json([149, 150, 150, 1]) ? true : json(got);
  });

  // ── 엔진·매치업·AI ──
  const mk = ({ aSpe, bSpe } = {}) => {
    const st = battle([mon("번치코", ["자이로볼", IDLE], null, null, fast)], [mon("번치코", ["자이로볼", IDLE], null, null, bulky)]);
    if (aSpe !== undefined) st.a.realStats = { ...st.a.realStats, spe: aSpe };
    if (bSpe !== undefined) st.b.realStats = { ...st.b.realStats, spe: bSpe };
    return st;
  };
  const powerOf = (st, move) => ph.resolvePreHitEffects(st, "a", move, () => 0.5, false, M(IDLE)).effectiveMove?.power;
  const aDamage = (st, move) => { const o = rt.runTurn(st, { kind: "move", move }, { kind: "move", move: M(IDLE) }, () => 0.5); return (o.result ?? o.partialResult).actions.find((x) => x.actor === "a")?.damage; };
  guard("D3-fix13 4 엔진 통합: 같은 스피드 두 포켓몬 → 위력 26, 데미지는 위력 26 고정 기술과 같다", () => {
    const power = powerOf(mk({ aSpe: 100, bSpe: 100 }), M("자이로볼"));
    if (power !== 26) return `위력 ${power}`;
    const fake = { ...M("자이로볼"), gyroBallPower: false, power: 26 };
    const dReal = aDamage(mk({ aSpe: 100, bSpe: 100 }), M("자이로볼")), dFake = aDamage(mk({ aSpe: 100, bSpe: 100 }), fake);
    return dReal > 0 && dReal === dFake ? true : json({ dReal, dFake });
  });
  const slots = () => ({ a: mon("번치코", ["자이로볼"], null, null, fast).slot, b: mon("번치코", ["자이로볼"], null, null, bulky).slot });
  guard("D3-fix13 5 매치업 evaluateSlotMatchup의 자이로볼 위력이 엔진과 같은 입력에서 같다", () => {
    const s = slots(), st = mk();
    const want = powerOf(st, M("자이로볼")), got = me.evaluateSlotMatchup(s.a, M("자이로볼"), s.b, {})?.damageParts?.hitPowers?.[0];
    return want === got && want !== undefined ? true : json({ eng: want, matchup: got });
  });
  guard("D3-fix13 6 AI 경로(moveDamage)도 같은 식 — 같은 스피드에서 위력 26 고정 기술과 기대 데미지가 같고 구식(51)과는 다르다", () => {
    const frac = (move) => { const st = mk({ aSpe: 100, bSpe: 100 }); return md.estimateMoveHits({ state: st, attacker: st.a, defender: st.b, defenderSide: st.sideB, attackerMovesSecond: false }, move)?.damageFraction; };
    const real = frac(M("자이로볼")), p26 = frac({ ...M("자이로볼"), gyroBallPower: false, power: 26 }), p51 = frac({ ...M("자이로볼"), gyroBallPower: false, power: 51 });
    return real > 0 && real === p26 && real !== p51 ? true : json({ real, p26, p51 });
  });
  guard("D3-fix13 7 일렉트릭볼 불변 회귀: 50/100 → 40, 100/100 → 60, 299/100 → 80, 300/100 → 120, 400/100 → 150", () => {
    const v = [[50, 100], [100, 100], [299, 100], [300, 100], [400, 100]].map(([u, t]) => bp.electroBallPowerFromSpeeds(u, t));
    return json(v) === json([40, 60, 80, 120, 150]) ? true : json(v);
  });

  // 8: defense-inference-check 04·14 — 위력 고정 리터럴 없음(구현 첫 단계 확인), 왕복 통과는 verify.sh가 맡는다.
  // ── 9. 식의 사본이 없다: src에서 `25 * (상대/나…)` 꼴은 battlePower.ts뿐 ──
  guard("D3-fix13 9 식의 사본 없음: src에 자이로볼 식(25 곱·floor)이 battlePower.ts 밖에 없다", () => {
    const hits = [];
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f) && !p.replaceAll("\\", "/").endsWith("src/lib/battlePower.ts") && /floor\(\s*25\s*\*|25\s*\*\s*\(\s*\w*[tT]arget/.test(readFileSync(p, "utf8"))) hits.push(p); } };
    walk("src");
    return hits.length === 0 ? true : json(hits);
  });
  guard("D3-fix13 10 방향 단조성: 상대 스피드↑ → 위력 비감소, 내 스피드↑ → 위력 비증가 (무작위 5000쌍)", () => {
    let s = 12345; const rnd = (n) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return 1 + (s % n); };
    for (let i = 0; i < 5000; i++) {
      const u = rnd(500), t = rnd(500), d = rnd(50);
      if (gyro(u, t + d) < gyro(u, t)) return `상대↑ 감소 ${json([u, t, d])}`;
      if (gyro(u + d, t) > gyro(u, t)) return `나↑ 증가 ${json([u, t, d])}`;
    }
    return true;
  });
}
