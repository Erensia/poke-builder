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
 *   style    AI(파라미터 A) 대 스타일 봇(환경변수 STYLE=switcher | setup | noisy), 파티 좌우 교대(ver.2.0 1-A — 상대 모델 판정용).
 *            봇은 지금 AI(기본 파라미터)의 점수를 보고 성향대로 비튼다: switcher = 교체 점수가 최선 −0.3 안이면 교체,
 *            setup = 변화기 점수가 최선 −0.5 안이면 변화기, noisy = 25%로 차선책(사람 실수 흉내).
 *   h2h      AI(파라미터 A) 대 AI(파라미터 B, 5번째 인자 — 생략하면 기본값), 파티 좌우 교대. 그리디 봇은 항상
 *            최선기만 써서 "상대 모델" 튜닝에 편향되므로, 모델 변경은 이 모드로도 비교한다.
 *
 *   selectvs 3선출 방식 A 대 B(ver.2.1 A-0): 같은 파티 두 개를 두고 A·B 각각이 양쪽 파티 선출을 맡아 좌우·파티를 바꿔 4판씩(시드당 4판).
 *            대전은 양쪽 같은 어려움 AI. 인자 4·5번째가 A·B 선출 옵션 JSON — chooseAiSelection 옵션({...}) 또는 {"kind":"random"|"first"}(비AI 기준).
 *            환경변수 POOL=samples(기본, 기본 제공 샘플 파티 중 서로 다른 둘 — 2.2 B5에서 26개가 돼 같은 시드의 대진이 2.1 때(20개)와 달라졌으니 그 기준값은 재현되지 않는다) | random(무작위 6마리 빌드).
 *
 * 예) npm run sim:ai -- greedy 150 '{"scoring":"spec"}'   ← 파라미터 튜닝: 값을 바꿔 승률 비교
 * 환경변수 POOL=samples(regress 제외 3마리 모드 전부, 2.2 B3): 편마다 기본 제공 샘플 파티 하나에서 3마리를 뽑는다(기본은 무작위 빌드).
 *     selectvs의 POOL(samples|random)과는 별개 — 그쪽은 6마리 파티 풀. PIVOT 등 기술 치환 환경변수는 샘플 파티에는 걸리지 않는다.
 * 환경변수 PIVOT=1: 유턴류를 배울 수 있는 포켓몬은 기술 하나를 유턴류로 바꿔 파티를 만든다(유턴 판단 검증용)
 * 환경변수 SETUP=1: 랭크업기·배턴터치를 배울 수 있으면 기술 두 개를 그걸로 바꾼다(랭크업·배턴터치 연계 검증용).
 *     diag 모드에 DIAG=setup을 주면 랭크업기·배턴터치를 고른 순간을 덤프한다.
 *     DIAG=tiesetup이면 확정 처치가 아닌 공격기와 동률인데 랭크업기를 고른 순간을 전부 센다(c 구간별, 앞 14건 덤프).
 * 환경변수 PROTECT=1: 방어류를 배울 수 있으면 4번째 기술을 방어류로 바꾼다. DIAG=protect면 방어류를 고른 순간을 덤프.
 * 환경변수 STATUS=1: AI가 점수 매기는 변화기를 배울 수 있으면 기술 하나를 그걸로 바꾼다(변화기 판단 검증용).
 *     diag 모드에 DIAG=status를 주면 그 변화기를 고른 순간을 덤프한다.
 * 환경변수 LEARN=1(greedy·style, ver.2.0 1-C): AI 쪽이 상대가 실제로 고른 행동을 대전 간 누적 학습(한 프로세스 안에서 이어짐) —
 *     상대 모델(opponentModel)이 켜진 파라미터에서만 보정이 걸린다. 결과에 learned(누적 대전 수·교체/변화기 보정 배율).
 * 환경변수 SEED_FROM=<n>(greedy·style·h2h·select): 시드 n부터 [판 수]개만 돈다(기본 1) — 벤치를 조각내 병렬로 돌린 뒤 합산(scripts/bench.mjs).
 *     각 판은 시드로만 정해지므로 조각의 합은 한 번에 돌린 결과와 같다.
 * 환경변수 SIM_ROOT=<체크아웃 경로>: 이 스크립트 대신 그 체크아웃의 src/를 불러온다(다른 커밋을 이 하네스로 벤치).
 *   h2h에 OPP_ROOT=<다른 체크아웃 경로>를 주면 B 쪽 AI를 그 코드에서 불러온다(예: ver.1.7 끝 대비 — 엔진·데이터는 이 체크아웃).
 *     (PowerShell에서는 JSON 따옴표를 '{\"scoring\":\"spec\"}' 처럼 이스케이프)
 */
import { createServer } from "vite";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] ?? "regress";
const battles = Number(process.argv[3] ?? 200);
const decisionParams = process.argv[4] ? JSON.parse(process.argv[4]) : undefined;
const root = process.env.SIM_ROOT ?? fileURLToPath(new URL("..", import.meta.url));
const seedFrom = Number(process.env.SEED_FROM ?? 1);
const seedTo = seedFrom + battles - 1;
// hmr: false — 병렬 실행 시 HMR 웹소켓 포트(24678) 충돌로 프로세스가 죽는 걸 막는다.
const server = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
const opponentParams = process.argv[5] ? JSON.parse(process.argv[5]) : undefined;
// 3선출 소프트맥스 선택용 시드 고정 난수(배틀 결과 재현)
const choiceRng = mulberry32(0x5eed);
// h2h 모드: OPP_ROOT=<다른 체크아웃 경로>면 B 쪽 AI를 그 코드(예: ver.1.7 끝)에서 불러온다 — 엔진·데이터는 이 체크아웃 것.
const oppServer = process.env.OPP_ROOT
  ? await createServer({ root: process.env.OPP_ROOT, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" })
  : undefined;

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
  const pm = await server.ssrLoadModule("/src/lib/battle/ai/protectMoves.ts");
  const statusLabel = (m) => {
    const group = pm.protectGroupOf(m);
    if (group) return `protect:${group}`;
    if (m.callsLastMoveInBattle) return "copycat";
    if (m.shedTail) return "shedTail";
    if (m.setsWeather && m.selfSwitchAfterUse) return "chillyReception";
    return fx.effectKindOf(m) ?? (fx.isBatonPass(m) ? "batonPass" : m.healsFraction || m.healsWeatherDependent || m.restSleep ? "heal" : "setup");
  };

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
    // SETUP=1: 랭크업기를 배울 수 있으면 2번째 기술을 랭크업기로, 배턴터치를 배울 수 있으면 3번째 기술을
    // 배턴터치로 바꾼다(랭크업 재평가·"올린 뒤 배턴터치" 검증용).
    if (process.env.SETUP === "1") {
      const setups = learn.filter((m) => {
        const mv = data.getMove(m);
        return mv.category === "status" && mv.statChanges?.some((s) => s.target === "self" && (s.delta ?? 0) > 0) && !moves.includes(m);
      });
      if (setups.length) moves[1] = pick(rng, setups);
      if (learn.includes("배턴터치") && !moves.includes("배턴터치")) moves[2] = "배턴터치";
    }
    // PROTECT=1: 방어류를 배울 수 있으면 4번째 기술을 방어류로 바꾼다(방어류 판단 검증용)
    if (process.env.PROTECT === "1") {
      const protects = learn.filter((m) => pm.protectGroupOf(data.getMove(m)) && !moves.includes(m));
      if (protects.length) moves[3] = pick(rng, protects);
    }
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
  // POOL=samples(2.2 B3): 무작위 빌드 대신 기본 제공 샘플 파티 하나에서 3마리를 뽑아 편을 만든다(실전형 조합으로 벤치 다양성 확보).
  // PIVOT·SETUP·PROTECT·STATUS 기술 치환은 무작위 빌드(makeSlot)에만 걸린다. 기본값(POOL 없음)은 기존과 동일.
  function sampleSide(rng) {
    const party = data.SAMPLE_PARTIES[Math.floor(rng() * data.SAMPLE_PARTIES.length)];
    const idx = [0, 1, 2, 3, 4, 5];
    for (let i = 5; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const sel = idx.slice(0, 3);
    return { slots: sel.map((i) => structuredClone(party.slots[i])), movesList: sel.map((i) => party.slots[i].moves.filter((m) => m).map((m) => data.getMove(m))) };
  }
  function makeSide(rng) {
    if (process.env.POOL === "samples") return sampleSide(rng);
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

  // LEARN=1(ver.2.0 1-C): AI 쪽이 상대가 실제로 고른 행동을 대전 간 누적 학습 — 한 프로세스(벤치 조각) 안에서 이어진다(같은 상대와
  // 계속 두는 셈). 상대 모델(opponentModel)이 켜진 파라미터에서만 보정이 걸린다.
  const opponentMemoryModule = process.env.LEARN === "1" ? await server.ssrLoadModule("/src/lib/battle/ai/opponentMemory.ts") : null;
  function makeLearner() {
    if (!opponentMemoryModule) return null;
    const m = opponentMemoryModule;
    let saved = m.emptyOpponentMemory();
    let session = m.emptyOpponentMemory();
    let pending = null;
    return {
      options: () => ({ opponentMemory: m.combinedMemory(saved, session) }),
      note(d, st, key) {
        pending = d.opponentDistribution ? { dist: d.opponentDistribution, speciesId: st[key === "a" ? "b" : "a"].slot.pokemonId } : null;
      },
      observe(oppAction) {
        if (!pending || !oppAction) return;
        const action =
          oppAction.kind === "switch"
            ? { kind: "switch" }
            : { kind: "move", moveId: oppAction.move.id, isStatus: oppAction.move.category === "status" };
        m.observeOpponent(session, { ...pending, statusMoveIds: ai.statusMoveIdsOf(pending.dist), action });
        pending = null;
      },
      endBattle() {
        saved = m.commitBattle(saved, session);
        session = m.emptyOpponentMemory();
      },
      summary: () => ({ battles: saved.battles, ...m.memoryFactors(saved) }),
    };
  }

  function runBattle(seed, policies, forced, initial, onActions) {
    const rng = mulberry32(seed);
    const partyRng = mulberry32(seed ^ 0x9e3779b9);
    let st = initial ?? state.createBattleState({ a: makeSide(partyRng), b: makeSide(partyRng) });
    const trace = [];
    const timings = [];
    for (let turn = 0; turn < 80; turn++) {
      const t0 = performance.now();
      const actionA = policies.a(st, "a");
      const actionB = policies.b(st, "b");
      timings.push(performance.now() - t0);
      onActions?.(actionA, actionB);
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
        : process.env.DIAG === "protect"
          ? d.action.kind === "move" && !!pm.protectGroupOf(d.action.move)
          : process.env.DIAG === "setup"
          ? d.action.kind === "move" && ["setup", "batonPass"].includes(statusLabel(d.action.move)) && d.action.move.category === "status"
          : process.env.DIAG === "status"
          ? d.action.kind === "move" && fx.isDesignedStatusMove(d.action.move)
          : d.action.kind === "switch";
    // DIAG=tiesetup: 확정 처치가 아닌 공격기(c > 1)와 동률(점수 차 tieThreshold 안)인데 랭크업기를 고른 순간을 전부 세고
    // 앞 14건을 덤프한다(한계점 정리 ⑤). 공격기의 c 구간별 빈도와, 반대로 동률에서 공격기를 고른 횟수도 같이 센다.
    const tieSetup = process.env.DIAG === "tiesetup";
    const tieThreshold = decisionParams?.tieThreshold ?? 0.1;
    const tieStats = { decisions: 0, setupChosenTie: 0, attackChosenTie: 0, byC: { "<1.5": 0, "1.5-2": 0, ">=2": 0 } };
    const tieAttackOf = (d) => {
      const best = Math.max(...d.scored.map((s) => s.score));
      if (!Number.isFinite(best)) return undefined;
      const inTie = (s) => best - s.score < tieThreshold;
      const hasSetup = d.scored.some((s) => inTie(s) && s.option.support?.kind === "setup");
      const attacks = d.scored.filter(
        (s) => inTie(s) && s.option.optionType === "move" && s.option.move?.category !== "status" && s.option.hitsToKill.expected > 1,
      );
      if (!hasSetup || attacks.length === 0) return undefined;
      return attacks.reduce((a, b) => (b.option.hitsToKill.expected < a.option.hitsToKill.expected ? b : a));
    };
    const aiPolicy = (st, key) => {
      const d = ai.chooseAiAction(st, key, 0.5, { decisionParams });
      let dumpThis = wantDump(d);
      if (tieSetup) {
        tieStats.decisions++;
        const atk = tieAttackOf(d);
        const chosen = d.scored.find((s) => s.option === d.chosen);
        dumpThis = false;
        if (atk && chosen?.option.support?.kind === "setup") {
          tieStats.setupChosenTie++;
          const c = atk.option.hitsToKill.expected;
          tieStats.byC[c < 1.5 ? "<1.5" : c < 2 ? "1.5-2" : ">=2"]++;
          dumpThis = c < 1.5;
        } else if (atk && chosen?.option.optionType === "move" && chosen.option.move?.category !== "status") tieStats.attackChosenTie++;
      }
      if (dumpThis && dumped < 14) {
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
                : "") +
              (o.support?.protect
                ? ` | ${o.support.protect.group} 성공=${o.support.protect.successChance.toFixed(2)}${o.support.protect.pointless ? " 무의미" : ""} ` +
                  o.support.protect.outcomes
                    .map(
                      (x) =>
                        `[w${x.weight.toFixed(2)} 나${x.myAfter.toFixed(2)} 상대${x.oppAfter.toFixed(2)}` +
                        (x.race ? ` c${fmt(x.race.killTurns)} d${fmt(x.race.survivalTurns)} p${x.race.firstProbability.toFixed(2)}` : "") +
                        "]",
                    )
                    .join("")
                : ""),
          );
        }
      }
      return d.action;
    };
    for (let s = 1; s <= battles && (tieSetup || dumped < 14); s++) runBattle(s, { a: aiPolicy, b: greedyPolicy }, { a: aiForced(0.5), b: firstLiving });
    if (tieSetup) console.log(`\n${JSON.stringify(tieStats)}`);
  } else if (mode === "greedy") {
    const mix = { move: 0, pivot: 0, switch: 0, status: 0 };
    const statusMix = {};
    const learner = makeLearner();
    const aiPolicy = (risk) => (st, key) => {
      const d = ai.chooseAiAction(st, key, risk, { decisionParams, ...learner?.options() });
      learner?.note(d, st, key);
      if (d.action.kind === "switch") mix.switch++;
      else if (d.action.move.category === "status") {
        mix.status++;
        let label = statusLabel(d.action.move);
        // 랭크가 오른 상태에서 쓴 배턴터치는 따로 센다("올린 뒤 넘기기")
        if (label === "batonPass" && Object.values(st[key].stages).some((v) => v > 0)) label = "batonPassBoosted";
        statusMix[label] = (statusMix[label] ?? 0) + 1;
      }
      else if (d.action.move.selfSwitchAfterDamage) mix.pivot++;
      else mix.move++;
      return d.action;
    };
    const res = { aiWins: 0, greedyWins: 0, other: 0 };
    const outcome = (seed, aiSide, risk) => {
      const gSide = aiSide === "a" ? "b" : "a";
      const r = runBattle(seed, { [aiSide]: aiPolicy(risk), [gSide]: greedyPolicy }, { [aiSide]: aiForced(risk), [gSide]: firstLiving }, undefined, (a, b) =>
        learner?.observe(aiSide === "a" ? b : a),
      );
      learner?.endBattle();
      return r.winner === aiSide ? "aiWins" : r.winner === gSide ? "greedyWins" : "other";
    };
    for (let s = seedFrom; s <= seedTo; s++) {
      const risk = mulberry32(s)();
      res[outcome(s, "a", risk)]++;
      res[outcome(s, "b", risk)]++;
    }
    console.log(JSON.stringify({ battles: battles * 2, res, aiActionMix: mix, statusMix, ...(learner && { learned: learner.summary() }) }));
  } else if (mode === "style") {
    // 스타일 봇(ver.2.0 1-A): 지금 AI의 채점 결과를 성향대로 비틀어 고른다. 무작위는 시드 고정(판 재현).
    const style = process.env.STYLE ?? "noisy";
    if (!["switcher", "setup", "noisy"].includes(style)) throw new Error(`알 수 없는 STYLE: ${style}`);
    const botPolicy = (risk, rng) => (st, key) => {
      const d = ai.chooseAiAction(st, key, risk, {});
      const finite = d.scored.filter((x) => Number.isFinite(x.score)).sort((x, y) => y.score - x.score);
      if (finite.length < 2) return d.action;
      const best = finite[0].score;
      const toAction = (o) => (o.optionType === "switch" ? { kind: "switch", toIndex: o.toIndex } : { kind: "move", move: o.move, mega: o.mega });
      if (style === "switcher") {
        const sw = finite.find((x) => x.option.optionType === "switch");
        if (sw && sw.score >= best - 0.3) return toAction(sw.option);
      } else if (style === "setup") {
        const status = finite.find((x) => x.option.optionType === "move" && x.option.move.category === "status");
        if (status && status.score >= best - 0.5) return toAction(status.option);
      } else if (rng() < 0.25) {
        return toAction(finite[1].option);
      }
      return d.action;
    };
    const res = { aiWins: 0, botWins: 0, other: 0 };
    const learner = makeLearner();
    const botMix = { move: 0, status: 0, switch: 0 };
    for (let s = seedFrom; s <= seedTo; s++) {
      const risk = mulberry32(s)();
      for (const aiSide of ["a", "b"]) {
        const botSide = aiSide === "a" ? "b" : "a";
        const botRng = mulberry32(s * 31 + (aiSide === "a" ? 1 : 2));
        const bot = botPolicy(1 - risk, botRng);
        const counted = (st, key) => {
          const action = bot(st, key);
          botMix[action.kind === "switch" ? "switch" : action.move.category === "status" ? "status" : "move"]++;
          return action;
        };
        const r = runBattle(
          s,
          {
            [aiSide]: (st, key) => {
              const d = ai.chooseAiAction(st, key, risk, { decisionParams, ...learner?.options() });
              learner?.note(d, st, key);
              return d.action;
            },
            [botSide]: counted,
          },
          { [aiSide]: aiForced(risk), [botSide]: (st, key) => ai.chooseAiForcedSwitch(st, key, 1 - risk) ?? living(st, key)[0] },
          undefined,
          (a, b) => learner?.observe(aiSide === "a" ? b : a),
        );
        learner?.endBattle();
        res[r.winner === aiSide ? "aiWins" : r.winner === botSide ? "botWins" : "other"]++;
      }
    }
    console.log(JSON.stringify({ battles: battles * 2, style, res, botMix, ...(learner && { learned: learner.summary() }) }));
  } else if (mode === "h2h") {
    // AI(파라미터 A = argv[4]) 대 AI(파라미터 B = argv[5], 생략하면 기본값), 파티 좌우 교대.
    // OPP_ROOT면 B는 그 체크아웃의 AI — 고른 기술은 이 체크아웃 데이터의 같은 id 기술로 바꿔 엔진에 넘긴다.
    const oppAi = oppServer ? await oppServer.ssrLoadModule("/src/lib/battle/ai/index.ts") : ai;
    const remap = (action) => (action.kind === "move" && action.move ? { ...action, move: data.getMove(action.move.id) ?? action.move } : action);
    // 탐색 오라클(ver.2.0 0단계, A 쪽 params.search): 판단 시간과 "평가식만으로 골랐을 선택"과 갈린 턴을 종류별로 센다
    // msBuckets: 판단 시간 분포(초 구간별 횟수 — 벤치 조각 합산이 가능하게 배열 대신 구간 객체)
    const searchStats = { decisions: 0, differ: 0, ms: 0, maxMs: 0, byKind: {}, msBuckets: {} };
    const bucketOf = (ms) => (ms < 250 ? "<0.25s" : ms < 500 ? "<0.5s" : ms < 1000 ? "<1s" : ms < 1500 ? "<1.5s" : ms < 2000 ? "<2s" : ms < 3000 ? "<3s" : ">=3s");
    const kindOf = (o) =>
      o.optionType === "switch" ? "switch" : o.move.category === "status" ? statusLabel(o.move) : o.move.selfSwitchAfterDamage ? "pivot" : "attack";
    // LEARN=1: A 쪽(파라미터 A)이 B를 대전 간 누적 학습
    const learner = makeLearner();
    const policy = (params, risk, which = ai, learn = null) => (st, key) => {
      const t0 = performance.now();
      const d = which.chooseAiAction(st, key, risk, { decisionParams: params, ...learn?.options() });
      learn?.note(d, st, key);
      if (d.baseChosen) {
        const ms = performance.now() - t0;
        searchStats.decisions++;
        searchStats.ms += ms;
        searchStats.maxMs = Math.max(searchStats.maxMs, ms);
        searchStats.msBuckets[bucketOf(ms)] = (searchStats.msBuckets[bucketOf(ms)] ?? 0) + 1;
        if (d.baseChosen !== d.chosen) {
          searchStats.differ++;
          const label = `${kindOf(d.baseChosen)}→${kindOf(d.chosen)}`;
          searchStats.byKind[label] = (searchStats.byKind[label] ?? 0) + 1;
          if (process.env.DIAG === "search" && searchStats.differ <= 20) {
            const name = (o) => (o.optionType === "switch" ? `→${data.getPokemon(state.sideOf(st, key).party[o.toIndex].slot.pokemonId)?.name}` : o.move.name);
            const me = st[key];
            const op = st[key === "a" ? "b" : "a"];
            console.error(
              `[T${st.turnNumber}] ${data.getPokemon(me.slot.pokemonId)?.name} ${me.currentHp}/${me.maxHp} vs ${data.getPokemon(op.slot.pokemonId)?.name} ${op.currentHp}/${op.maxHp}: ` +
                `평가식 ${name(d.baseChosen)} → 오라클 ${name(d.chosen)} | ` +
                d.searchValues.map((v) => `${name(v.option)} 점수=${d.scored.find((x) => x.option === v.option)?.score.toFixed(2)} 값=${v.value.toFixed(2)}`).join(", "),
            );
          }
        }
      }
      return remap(d.action);
    };
    const forced = (params, risk, which = ai) => (st, key) => which.chooseAiForcedSwitch(st, key, risk, params) ?? living(st, key)[0];
    const res = { aWins: 0, bWins: 0, other: 0 };
    for (let s = seedFrom; s <= seedTo; s++) {
      const risk = mulberry32(s)();
      for (const aSide of ["a", "b"]) {
        const bSide = aSide === "a" ? "b" : "a";
        const r = runBattle(
          s,
          { [aSide]: policy(decisionParams, risk, ai, learner), [bSide]: policy(opponentParams, risk, oppAi) },
          { [aSide]: forced(decisionParams, risk), [bSide]: forced(opponentParams, risk, oppAi) },
          undefined,
          (x, y) => learner?.observe(aSide === "a" ? y : x),
        );
        learner?.endBattle();
        res[r.winner === aSide ? "aWins" : r.winner === bSide ? "bWins" : "other"]++;
      }
    }
    const search = searchStats.decisions > 0 ? { search: searchStats } : {};
    console.log(JSON.stringify({ battles: battles * 2, A: { ...decisionParams }, B: { ...opponentParams }, res, ...search }));
  } else if (mode === "select") {
    // 3선출 AI(로드맵 7): 양쪽 6마리 빌드 → 한쪽은 AI 선출, 다른 쪽은 SELECT_B(random | first, 기본 random) → 양쪽 AI로 대전.
    // 좌우 교대.
    const baseline = process.env.SELECT_B ?? "random";
    const make6 = (rng) => {
      const members = Array.from({ length: 6 }, () => makeSlot(rng));
      return { slots: members.map((m) => m.slot), movesList: members.map((m) => m.moves) };
    };
    const pickSide = (side6, sel) => ({ slots: sel.map((i) => side6.slots[i]), movesList: sel.map((i) => side6.movesList[i]) });
    const policy = (risk) => (st, key) => ai.chooseAiAction(st, key, risk, {}).action;
    const forced = (risk) => (st, key) => ai.chooseAiForcedSwitch(st, key, risk) ?? living(st, key)[0];
    const res = { aiSelectWins: 0, baselineWins: 0, other: 0 };
    let selectMs = 0;
    let selects = 0;
    for (let s = seedFrom; s <= seedTo; s++) {
      const partyRng = mulberry32(s ^ 0x51ec7);
      const six = { a: make6(partyRng), b: make6(partyRng) };
      const full = state.createBattleState(six);
      const risk = mulberry32(s)();
      for (const aiSide of ["a", "b"]) {
        const other = aiSide === "a" ? "b" : "a";
        const t0 = performance.now();
        const aiSel = ai.chooseAiSelection(full, aiSide, { random: choiceRng });
        selectMs += performance.now() - t0;
        selects++;
        const baseSel =
          baseline === "first" ? [0, 1, 2] : (() => { const r = mulberry32(s * 97 + (aiSide === "a" ? 1 : 2)); const idx = [0, 1, 2, 3, 4, 5]; for (let i = 5; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } return idx.slice(0, 3); })();
        const initial = state.createBattleState({ [aiSide]: pickSide(six[aiSide], aiSel), [other]: pickSide(six[other], baseSel) });
        const r = runBattle(s, { a: policy(risk), b: policy(1 - risk) }, { a: forced(risk), b: forced(1 - risk) }, initial);
        res[r.winner === aiSide ? "aiSelectWins" : r.winner === other ? "baselineWins" : "other"]++;
      }
    }
    console.log(JSON.stringify({ battles: battles * 2, baseline, res, avgSelectMs: +(selectMs / selects).toFixed(1) }));
  } else if (mode === "selectvs") {
    // 3선출 방식 A 대 B(ver.2.1 A-0). 같은 파티 P·Q를 두고 (A→P·B→Q) × (P가 a편·b편) 조합 4판 — 파티 강약과 편 차이를 상쇄한다.
    // 선출의 난수는 시드에서 파생시켜(조각 병렬 실행 합 = 한 번에 돌린 결과) 재현 가능하다.
    const selectA = decisionParams ?? {};
    const selectB = opponentParams ?? {};
    const poolKind = process.env.POOL ?? "samples";
    const samples = data.SAMPLE_PARTIES;
    const sixOf = (party) => ({ slots: party.slots, movesList: party.slots.map((sl) => sl.moves.filter((m) => m).map((m) => data.getMove(m))) });
    const make6 = (rng) => {
      const members = Array.from({ length: 6 }, () => makeSlot(rng));
      return { slots: members.map((m) => m.slot), movesList: members.map((m) => m.moves) };
    };
    const pickSide = (side6, sel) => ({ slots: sel.map((i) => side6.slots[i]), movesList: sel.map((i) => side6.movesList[i]) });
    const shuffle3 = (rng) => { const idx = [0, 1, 2, 3, 4, 5]; for (let i = 5; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } return idx.slice(0, 3); };
    const choose = (opts, full, side, rng) =>
      opts.kind === "random" ? shuffle3(rng) : opts.kind === "first" ? [0, 1, 2] : ai.chooseAiSelection(full, side, { ...opts, random: rng });
    const policy = (risk) => (st, key) => ai.chooseAiAction(st, key, risk, {}).action;
    const forced = (risk) => (st, key) => ai.chooseAiForcedSwitch(st, key, risk) ?? living(st, key)[0];
    const res = { aWins: 0, bWins: 0, other: 0 };
    const time = { selectMsA: 0, selectsA: 0, selectMsB: 0, selectsB: 0, maxSelectMs: 0 };
    for (let s = seedFrom; s <= seedTo; s++) {
      const partyRng = mulberry32(s ^ 0x51ec7);
      let P, Q;
      if (poolKind === "random") {
        P = make6(partyRng);
        Q = make6(partyRng);
      } else {
        const i = Math.floor(partyRng() * samples.length);
        const j = (i + 1 + Math.floor(partyRng() * (samples.length - 1))) % samples.length;
        P = sixOf(samples[i]);
        Q = sixOf(samples[j]);
      }
      const risk = mulberry32(s)();
      for (let c = 0; c < 4; c++) {
        const sideP = c & 1 ? "b" : "a";
        const sideQ = sideP === "a" ? "b" : "a";
        const methodP = c & 2 ? "B" : "A";
        const methodQ = methodP === "A" ? "B" : "A";
        const full = state.createBattleState({ [sideP]: P, [sideQ]: Q });
        const selectFor = (method, side, six) => {
          const t0 = performance.now();
          const sel = choose(method === "A" ? selectA : selectB, full, side, mulberry32(s * 131 + c * 7 + (side === "a" ? 1 : 2)));
          const ms = performance.now() - t0;
          time[`selectMs${method}`] += ms;
          time[`selects${method}`]++;
          time.maxSelectMs = Math.max(time.maxSelectMs, ms);
          return pickSide(six, sel);
        };
        const initial = state.createBattleState({ [sideP]: selectFor(methodP, sideP, P), [sideQ]: selectFor(methodQ, sideQ, Q) });
        const r = runBattle(s, { a: policy(risk), b: policy(1 - risk) }, { a: forced(risk), b: forced(1 - risk) }, initial);
        const winnerMethod = r.winner === sideP ? methodP : r.winner === sideQ ? methodQ : null;
        res[winnerMethod === "A" ? "aWins" : winnerMethod === "B" ? "bWins" : "other"]++;
      }
    }
    console.log(JSON.stringify({ battles: (seedTo - seedFrom + 1) * 4, pool: poolKind, A: selectA, B: selectB, res, ...time }));
  } else if (mode === "ai") {
    const results = { aiVsRandom: { a: 0, b: 0, draw: 0, timeout: 0 }, aiVsAi: { a: 0, b: 0, draw: 0, timeout: 0 } };
    let maxMs = 0;
    let totalMs = 0;
    let decisions = 0;
    let nanScores = 0;
    const aiPolicy = (risk) => (st, key) => {
      const d = ai.chooseAiAction(st, key, risk, { decisionParams });
      for (const s of d.scored) {
        if (s.nan || Number.isNaN(s.score)) {
          nanScores++;
          if (process.env.NAN_DUMP) {
            const o = s.option;
            console.error("NaN", o.optionType, o.move?.name, o.support?.kind, o.support?.effect?.kind, JSON.stringify({ c: o.hitsToKill.expected, d: o.hitsToBeKilled.expected, p: o.firstProbability, hp: o.hpFraction, opp: o.opponentHpFraction, eff: o.support?.effect && { hit: o.support.effect.hit, base: o.support.effect.base, hc: o.support.effect.hitChance, carry: o.support.effect.carry } }));
          }
        }
      }
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
    console.error(`알 수 없는 모드: ${mode} (regress | ai | greedy | diag | style | h2h | select | selectvs)`);
    process.exitCode = 1;
  }
} finally {
  await server.close();
  await oppServer?.close();
}
