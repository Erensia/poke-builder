/**
 * 상대 실능치 역산(ver.2.1 C) 검증.
 *  1) 정수 데미지 공식: 역산이 쓰는 damageRolls 계열 식이 엔진 computeDamage와 같은 값을 내는지
 *  2) 왕복: 정해진 "진짜 배분"으로 관측을 만들어 역산에 넣으면 진짜 배분이 후보에 남는지(놓치면 안 됨), 후보가 얼마나 좁아지는지
 * 실패가 하나라도 있으면 종료 코드 1.
 *
 *   node scripts/defense-inference-check.mjs [왕복 시행 수, 기본 150]
 */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";

const trials = Number(process.argv[2] ?? 150);
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
let failed = 0;
// 결합 결과 해시 — 속도 최적화 전후로 결과가 한 비트도 달라지지 않았는지 대조한다(3.6 I1-a)
const combinedDigest = createHash("sha1");
const digestResult = (c) => combinedDigest.update(JSON.stringify(c, (k, v) => (k === "rounds" || k === "converged" || k === "candidates" ? undefined : ArrayBuffer.isView(v) ? Array.from(v) : v)));
const fail = (msg) => {
  failed++;
  console.log("FAIL", msg);
};
try {
  const data = await server.ssrLoadModule("/src/lib/data.ts");
  const inf = await server.ssrLoadModule("/src/lib/defenseInference.ts");
  const ev = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
  const bp = await server.ssrLoadModule("/src/lib/battlePower.ts");
  const stat = await server.ssrLoadModule("/src/lib/statCalculator.ts");
  const form = await server.ssrLoadModule("/src/lib/pokemonForm.ts");
  const fm = await server.ssrLoadModule("/src/lib/damageFormula.ts");
  const ai = await server.ssrLoadModule("/src/lib/attackInference.ts");

  // 결정적 난수
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const pts = (o = {}) => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...o });

  const usable = data.MOVES.filter((m) => inf.inferenceUnsupportedReason(m) === null && !inf.multiHitRange(m) && m.power !== null && m.power > 0);
  const species = data.POKEMON.filter((p) => !p.formVariants && !p.sizeForms);
  const natureIds = data.NATURES.map((n) => n.id);

  const within = (r, v) => !!r && r.min <= v && v <= r.max;
  const slot = (pokemonId, extra = {}) => ({ pokemonId, ability: null, item: null, nature: null, points: pts(), ...extra });

  // 진짜 배분(defTrue)에 실제로 입힐 데미지로 관측 하나를 만든다. 쓰러뜨리는 관측(0%)은 제외.
  const makeObservation = (cands, atk, defTrue, dReal, hp, notFull = false) => {
    for (let tries = 0; tries < 20; tries++) {
      const move = pick(cands);
      const res = ev.evaluateSlotMatchup(atk, move, defTrue, notFull ? { defenderHpIsFull: false } : undefined);
      const p = res?.damageParts;
      if (!p || p.typeEffectiveness === 0) continue;
      const roll = (85 + Math.floor(rnd() * 16)) / 100;
      const damage = fm.integerTotalDamage(p, dReal[p.defenseKey], roll);
      if (damage >= hp) continue;
      const observation = { move, critical: false, before: inf.displayPercent(hp, dReal.hp), after: inf.displayPercent(hp - damage, dReal.hp) };
      return { observation, damage };
    }
    return null;
  };

  const attackMoves = data.MOVES.filter((m) => ai.attackInferenceUnsupportedReason(m) === null && !inf.multiHitRange(m) && m.power !== null && m.power > 0);
  // 진짜 상대(oppTrue)가 내 포켓몬(mySlot)에게 실제로 입힐 데미지로 관측 하나를 만든다. 내 HP가 남지 않는 공격은 제외
  const makeAttackObservation = (cands, oppTrue, mySlot, maxHp, hp) => {
    for (let tries = 0; tries < 20; tries++) {
      const move = pick(cands);
      const res = ev.evaluateSlotMatchup(oppTrue, move, mySlot, { defenderHpIsFull: hp >= maxHp, skipVerdict: true });
      const p = res?.damageParts;
      if (!p || p.typeEffectiveness === 0) continue;
      const damage = fm.integerTotalDamage(p, res.defenseStat, (85 + Math.floor(rnd() * 16)) / 100);
      if (damage < hp) return { move, critical: false, hpBefore: hp, hpAfter: hp - damage };
    }
    return null;
  };

  // 난수 순서가 곧 결합 해시라 파일 이름순 = 원래 실행 순서를 지킨다.
  const ctx = { server, trials, data, inf, ev, bp, stat, form, fm, ai, rnd, pick, pts, usable, species, natureIds, within, slot, makeObservation, attackMoves, makeAttackObservation, fail, failCount: () => failed, digestResult };
  const dir = new URL("./defense-inference-check/", import.meta.url);
  for (const f of readdirSync(dir).sort()) await (await import(new URL(f, dir))).default(ctx);
} finally {
  await server.close();
}
console.log(`결합 결과 해시 ${combinedDigest.digest("hex").slice(0, 16)}`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
