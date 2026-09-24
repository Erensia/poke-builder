/**
 * 배틀 AI 시뮬레이션 하네스 — 시드 고정 무작위 파티(3마리씩) 배틀을 실제 엔진으로 자동 진행한다.
 * Vite ssrLoadModule로 src/를 그대로 불러오므로 브라우저가 필요 없다.
 *
 *   npm run sim:ai -- <mode> [판 수] [결정 파라미터 JSON]
 *
 *   regress  무작위 행동끼리 돌려 전체 로그 해시를 출력 — 엔진 수정 전후 해시가 같으면 동작 무변경
 *   ai       AI 대 무작위 봇 + AI 대 AI 승률, 턴당 판단 시간, NaN 점수 개수
 *   greedy   AI 대 그리디 봇(교체 없이 매 턴 가장 빨리 처치하는 기술만) — 파티를 좌우 바꿔 한 번 더
 *   diag     AI가 교체를 고른 순간의 모든 옵션 점수·c·d 출력(판단 이상 사례 찾기)
 *
 * 예) npm run sim:ai -- greedy 150 '{"scoring":"spec"}'   ← 파라미터 튜닝: 값을 바꿔 승률 비교
 * 환경변수 PIVOT=1: 유턴류를 배울 수 있는 포켓몬은 기술 하나를 유턴류로 바꿔 파티를 만든다(유턴 판단 검증용)
 * 환경변수 STATUS=1: AI가 점수 매기는 변화기를 배울 수 있으면 기술 하나를 그걸로 바꾼다(변화기 판단 검증용).
 *     diag 모드에 DIAG=status를 주면 그 변화기를 고른 순간을 덤프한다.
 *     (PowerShell에서는 JSON 따옴표를 '{\"scoring\":\"spec\"}' 처럼 이스케이프)
 */
import { createServer } from "vite";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] ?? "regress";
const battles = Number(process.argv[3] ?? 200);
const decisionParams = process.argv[4] ? JSON.parse(process.argv[4]) : undefined;
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

try {
  const data = await server.ssrLoadModule("/src/lib/data.ts");
  const state = await server.ssrLoadModule("/src/lib/battle/state.ts");
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
  const ai = mode === "regress" ? null : await server.ssrLoadModule("/src/lib/battle/ai/index.ts");
  const ev = mode === "regress" ? null : await server.ssrLoadModule("/src/lib/battle/ai/evaluator.ts");
  const fx = await server.ssrLoadModule("/src/lib/battle/ai/statusMoveEffects.ts");
  // 변화기 종류 라벨(집계용)
  const statusLabel = (m) =>
    fx.effectKindOf(m) ?? (fx.isBatonPass(m) ? "batonPass" : m.healsFraction || m.healsWeatherDependent || m.restSleep ? "heal" : "setup");

  const heldItems = data.ITEMS.filter((i) => i.category === "held-item");
  const pool = data.POKEMON.filter((p) => (p.learnset ?? []).filter((m) => data.getMove(m)).length >= 4);
  const statKeys = ["hp", "atk", "def", "spa", "spd", "spe"];

  function makeSlot(rng) {
    const p = pick(rng, pool);
    const learn = [...new Set(p.learnset.filter((m) => data.getMove(m)))];
    const moves = [];
    while (moves.length < 4) {
      const m = pick(rng, learn);
      if (!moves.includes(m)) moves.push(m);
    }
    // PIVOT=1: 유턴류(selfSwitchAfterDamage)를 배울 수 있으면 4번째 기술을 그걸로 바꾼다(유턴 판단 검증용)
    if (process.env.PIVOT === "1") {
      const pivots = learn.filter((m) => data.getMove(m).selfSwitchAfterDamage && !moves.includes(m));
      if (pivots.length) moves[3] = pick(rng, pivots);
    }
    // STATUS=1: AI가 점수 매기는 변화기(상태이상·랭크다운·벽·설치기·배턴터치·날씨 회복기·잠자기)를 배울 수
    // 있으면 3번째 기술을 그걸로 바꾼다(변화기 판단 검증용). 4번째는 PIVOT용으로 남겨 둔다.
    if (process.env.STATUS === "1") {
      const designed = learn.filter((m) => fx.isDesignedStatusMove(data.getMove(m)) && !moves.includes(m));
      if (designed.length) moves[2] = pick(rng, designed);
    }
    const abilities = [...(p.abilities ?? []), ...(p.hiddenAbility ? [p.hiddenAbility] : [])];
    let item = rng() < 0.8 ? pick(rng, heldItems).id : null;
    if (p.megaEvolutions?.length && rng() < 0.4) item = pick(rng, p.megaEvolutions).megaStone ?? item;
    const points = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    const a = pick(rng, statKeys);
    let b = pick(rng, statKeys);
    if (b === a) b = "hp";
    points[a] += 32;
    points[b] += 32;
    points.spd += 2;
    return {
      slot: { pokemonId: p.id, moves, ability: abilities.length ? pick(rng, abilities) : null, item, nature: pick(rng, data.NATURES).id, points },
      moves: moves.map((m) => data.getMove(m)),
    };
  }
  function makeSide(rng) {
    const members = [makeSlot(rng), makeSlot(rng), makeSlot(rng)];
    return { slots: members.map((m) => m.slot), movesList: members.map((m) => m.moves) };
  }

  const living = (st, key) => {
    const side = state.sideOf(st, key);
    return side.party.map((f, i) => i).filter((i) => i !== side.activeIndex && !state.isFainted(side.party[i]));
  };

  // ── 행동 정책 ──
  function randomPolicy(rng) {
    return (st, key) => {
      const f = st[key];
      const switches = sw.isTrappedFromSwitching(f) ? [] : living(st, key);
      if (switches.length && rng() < 0.15) return { kind: "switch", toIndex: pick(rng, switches) };
      const usable = Object.entries(f.remainingPp).filter(([, pp]) => pp > 0).map(([id]) => data.getMove(id)).filter(Boolean);
      if (!usable.length) return { kind: "move", move: state.STRUGGLE_MOVE };
      return { kind: "move", move: pick(rng, usable), mega: rng() < 0.7 };
    };
  }
  const forcedSwitchRandom = (rng) => (st, key) => pick(rng, living(st, key));
  const firstLiving = (st, key) => living(st, key)[0];
  const greedyPolicy = (st, key) => {
    const moves = ev.evaluateOptions(st, key).filter((o) => o.optionType === "move");
    if (!moves.length) return { kind: "move", move: state.STRUGGLE_MOVE };
    const best = moves.reduce((a, b) => (b.hitsToKill.expected < a.hitsToKill.expected ? b : a));
    return { kind: "move", move: best.move, mega: best.mega };
  };
  const aiForced = (risk) => (st, key) => ai.chooseAiForcedSwitch(st, key, risk, decisionParams) ?? living(st, key)[0];

  function runBattle(seed, policies, forced) {
    const rng = mulberry32(seed);
    const partyRng = mulberry32(seed ^ 0x9e3779b9);
    let st = state.createBattleState({ a: makeSide(partyRng), b: makeSide(partyRng) });
    const trace = [];
    const timings = [];
    for (let turn = 0; turn < 80; turn++) {
      const t0 = performance.now();
      const actionA = policies.a(st, "a");
      const actionB = policies.b(st, "b");
      timings.push(performance.now() - t0);
      let out = rt.runTurn(st, actionA, actionB, rng);
      let guard = 0;
      while ("awaitingSelfSwitch" in out && guard++ < 5) {
        const side = out.awaitingSelfSwitch.side;
        const opts = living(out._ctx.state, side);
        out = rt.resumeTurn(out._ctx, opts.length ? forced[side](out._ctx.state, side) : -1);
      }
      if ("awaitingSelfSwitch" in out) throw new Error("stuck in pause");
      trace.push(out.result);
      st = out.nextState;
      if (out.result.winner) return { winner: out.result.winner, trace, turns: turn + 1, timings };
      for (const key of ["a", "b"]) {
        if (out.forcedSwitch?.[key]) st = sw.applySwitch(st, key, forced[key](st, key)).nextState;
      }
    }
    return { winner: "timeout", trace, turns: 80, timings };
  }

  if (mode === "regress") {
    const hash = createHash("sha256");
    let turns = 0;
    const winners = { a: 0, b: 0, draw: 0, timeout: 0 };
    for (let s = 1; s <= battles; s++) {
      const rng = mulberry32(s * 7919);
      const r = runBattle(s, { a: randomPolicy(rng), b: randomPolicy(rng) }, { a: forcedSwitchRandom(rng), b: forcedSwitchRandom(rng) });
      hash.update(JSON.stringify(r.trace));
      turns += r.turns;
      winners[r.winner]++;
    }
    console.log(JSON.stringify({ battles, turns, winners, hash: hash.digest("hex") }));
  } else if (mode === "diag") {
    const name = (f) => data.getPokemon(f.slot.pokemonId)?.name;
    const fmt = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
    let dumped = 0;
    // DIAG=pivot: 교체 대신 유턴류를 고른 순간을 덤프
    // DIAG=status: 변화기(회복·랭크업 제외)를 고른 순간을 덤프
    const wantDump = (d) =>
      process.env.DIAG === "pivot"
        ? d.action.kind === "move" && !!d.action.move.selfSwitchAfterDamage
        : process.env.DIAG === "status"
          ? d.action.kind === "move" && fx.isDesignedStatusMove(d.action.move)
          : d.action.kind === "switch";
    const aiPolicy = (st, key) => {
      const d = ai.chooseAiAction(st, key, 0.5, { decisionParams });
      if (wantDump(d) && dumped < 14) {
        dumped++;
        const me = st[key];
        const op = st[key === "a" ? "b" : "a"];
        console.log(`\n[T${st.turnNumber}] ${name(me)} ${me.currentHp}/${me.maxHp} vs ${name(op)} ${op.currentHp}/${op.maxHp}`);
        for (const s of d.scored) {
          const o = s.option;
          const label = o.optionType === "switch" ? `→${name(state.sideOf(st, key).party[o.toIndex])}` : o.move.name;
          console.log(
            `  ${s.option === d.chosen ? "*" : " "} ${label.padEnd(12)} score=${fmt(s.score)} c=${fmt(o.hitsToKill.expected)} d=${fmt(o.hitsToBeKilled.expected)} first=${o.firstProbability.toFixed(2)} entry=${o.entryCost}` +
              (o.support?.effect
                ? ` | 적용후 c=${fmt(o.support.effect.hit.killTurns)} d=${fmt(o.support.effect.hit.survivalTurns)} p=${o.support.effect.hit.firstProbability.toFixed(2)} 원래 c=${fmt(o.support.effect.base.killTurns)} d=${fmt(o.support.effect.base.survivalTurns)} 명중=${o.support.effect.hitChance.toFixed(2)} 이월=${fmt(o.support.effect.carry)}`
                : ""),
          );
        }
      }
      return d.action;
    };
    for (let s = 1; s <= battles && dumped < 14; s++) runBattle(s, { a: aiPolicy, b: greedyPolicy }, { a: aiForced(0.5), b: firstLiving });
  } else if (mode === "greedy") {
    const mix = { move: 0, pivot: 0, switch: 0, status: 0 };
    const statusMix = {};
    const aiPolicy = (risk) => (st, key) => {
      const d = ai.chooseAiAction(st, key, risk, { decisionParams });
      if (d.action.kind === "switch") mix.switch++;
      else if (d.action.move.category === "status") {
        mix.status++;
        const label = statusLabel(d.action.move);
        statusMix[label] = (statusMix[label] ?? 0) + 1;
      }
      else if (d.action.move.selfSwitchAfterDamage) mix.pivot++;
      else mix.move++;
      return d.action;
    };
    const res = { aiWins: 0, greedyWins: 0, other: 0 };
    const outcome = (seed, aiSide, risk) => {
      const gSide = aiSide === "a" ? "b" : "a";
      const r = runBattle(seed, { [aiSide]: aiPolicy(risk), [gSide]: greedyPolicy }, { [aiSide]: aiForced(risk), [gSide]: firstLiving });
      return r.winner === aiSide ? "aiWins" : r.winner === gSide ? "greedyWins" : "other";
    };
    for (let s = 1; s <= battles; s++) {
      const risk = mulberry32(s)();
      res[outcome(s, "a", risk)]++;
      res[outcome(s, "b", risk)]++;
    }
    console.log(JSON.stringify({ battles: battles * 2, res, aiActionMix: mix, statusMix }));
  } else if (mode === "ai") {
    const results = { aiVsRandom: { a: 0, b: 0, draw: 0, timeout: 0 }, aiVsAi: { a: 0, b: 0, draw: 0, timeout: 0 } };
    let maxMs = 0;
    let totalMs = 0;
    let decisions = 0;
    let nanScores = 0;
    const aiPolicy = (risk) => (st, key) => {
      const d = ai.chooseAiAction(st, key, risk, { decisionParams });
      for (const s of d.scored) if (Number.isNaN(s.score)) nanScores++;
      return d.action;
    };
    for (let s = 1; s <= battles; s++) {
      const rng = mulberry32(s * 104729);
      const risk = rng();
      const r1 = runBattle(s, { a: aiPolicy(risk), b: randomPolicy(rng) }, { a: aiForced(risk), b: forcedSwitchRandom(rng) });
      results.aiVsRandom[r1.winner]++;
      for (const t of r1.timings) {
        maxMs = Math.max(maxMs, t);
        totalMs += t;
        decisions++;
      }
      if (s <= Math.ceil(battles / 4)) {
        const r2 = runBattle(s, { a: aiPolicy(risk), b: aiPolicy(1 - risk) }, { a: aiForced(risk), b: aiForced(1 - risk) });
        results.aiVsAi[r2.winner]++;
      }
    }
    console.log(JSON.stringify({ battles, results, avgTurnMs: +(totalMs / decisions).toFixed(2), maxTurnMs: +maxMs.toFixed(1), nanScores }));
  } else {
    console.error(`알 수 없는 모드: ${mode} (regress | ai | greedy | diag)`);
    process.exitCode = 1;
  }
} finally {
  await server.close();
}
