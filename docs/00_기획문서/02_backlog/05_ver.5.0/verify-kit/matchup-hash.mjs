// 계산 함수 차분 해시 — 무작위 대결 N건의 evaluateSlotMatchup·computeSoloOffensePower·evaluateSpeedMatchup 결과를 전부 해시한다.
// 리팩토링 전후 해시가 같으면 계산 결과가 한 비트도 달라지지 않은 것. 사용법: node scripts/zz-matchup-hash.mjs [건수]
import { createServer } from "vite";
import { createHash } from "node:crypto";

const N = Number(process.argv[2] ?? 60000);
const server = await createServer({ root: process.cwd(), server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
try {
  const data = await server.ssrLoadModule("/src/lib/data.ts");
  const ev = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
  let seed = 20261015;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const chance = (p) => rnd() < p;
  const pokemon = data.POKEMON;
  const moves = data.MOVES;
  const abilities = data.ABILITIES.map((a) => a.id);
  const items = data.ITEMS.map((i) => i.id);
  const natures = data.NATURES.map((n) => n.id);
  const stages = () => (chance(0.5) ? undefined : Object.fromEntries(["atk", "def", "spa", "spd", "spe", "acc", "eva"].map((k) => [k, chance(0.7) ? 0 : Math.floor(rnd() * 13) - 6])));
  const slot = () => {
    const p = pick(pokemon);
    const pts = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    for (const k of Object.keys(pts)) pts[k] = chance(0.5) ? 0 : Math.floor(rnd() * 33);
    return {
      pokemonId: p.id,
      ability: chance(0.1) ? null : chance(0.7) && p.abilities?.length ? pick(p.abilities.map((a) => a.id ?? a)) : pick(abilities),
      item: chance(0.4) ? null : pick(items),
      nature: chance(0.2) ? null : pick(natures),
      points: pts,
      activeMegaForm: p.megaEvolutions?.length && chance(0.4) ? pick(p.megaEvolutions).form : undefined,
    };
  };
  const status = () => (chance(0.6) ? null : pick(["burn", "poison", "badly-poisoned", "paralysis", "sleep", "freeze"]));
  const options = () => ({
    attackerTypeToMoveType: chance(0.15),
    attackerStages: stages(),
    defenderStages: stages(),
    multiHitCount: chance(0.5) ? undefined : 1 + Math.floor(rnd() * 5),
    stockpileCount: chance(0.7) ? undefined : 1 + Math.floor(rnd() * 3),
    weather: chance(0.5) ? undefined : pick(["쾌청", "비", "모래바람", "눈"]),
    field: chance(0.6) ? undefined : pick(["그래스필드", "미스트필드", "사이코필드", "일렉트릭필드"]),
    screen: chance(0.7) ? undefined : pick(["reflect", "lightScreen", "auroraVeil"]),
    attackerHpFraction: chance(0.6) ? undefined : rnd(),
    defenderHpIsFull: chance(0.5) ? undefined : chance(0.5),
    defenderHpFraction: chance(0.8) ? undefined : rnd(),
    defenderHasStatusCondition: chance(0.8) ? undefined : true,
    attackerStatus: status(),
    defenderStatus: status(),
    abilityHpFraction: chance(0.8) ? undefined : pick([1, 1 / 3]),
    attackerMovesLast: chance(0.85) ? undefined : true,
    attackerTookDamageThisTurn: chance(0.85) ? undefined : true,
    attackerMoveFailedLastTurn: chance(0.85) ? undefined : true,
    attackerStatLoweredThisTurn: chance(0.85) ? undefined : true,
    defenderDamagedThisTurn: chance(0.85) ? undefined : true,
    defenderMinimized: chance(0.85) ? undefined : true,
    critical: chance(0.7) ? undefined : true,
    defenderItemConsumed: chance(0.9) ? undefined : true,
    extraOffenseMultiplier: chance(0.9) ? undefined : 1.5,
    finalOffenseMultiplier: chance(0.9) ? undefined : 0.5,
  });
  const speedOptions = () => ({ weather: chance(0.5) ? undefined : pick(["쾌청", "비", "모래바람", "눈"]), field: chance(0.7) ? undefined : "그래스필드", trickRoom: chance(0.2) ? true : undefined });
  const replacer = (k, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "fn" : v);
  const hash = createHash("sha256");
  let ok = 0;
  let nulls = 0;
  let errors = 0;
  for (let i = 0; i < N; i++) {
    const a = slot();
    const d = slot();
    const m = pick(moves);
    const o = options();
    let r1, r2, r3;
    try { r1 = ev.evaluateSlotMatchup(a, m, d, o); } catch (e) { r1 = "ERR:" + e.message; errors++; }
    try { r2 = ev.computeSoloOffensePower(a, m, o); } catch (e) { r2 = "ERR:" + e.message; errors++; }
    try { r3 = ev.evaluateSpeedMatchup(a, d, speedOptions()); } catch (e) { r3 = "ERR:" + e.message; errors++; }
    if (r1 === null) nulls++; else ok++;
    hash.update(JSON.stringify([r1, r2, r3], replacer));
  }
  console.log(JSON.stringify({ samples: N, withResult: ok, nulls, errors, hash: hash.digest("hex") }));
} finally {
  await server.close();
}
