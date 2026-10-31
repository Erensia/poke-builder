/**
 * 랭크배틀 AI 정책(5.0 R3 S3) 검증 — `lib/battle/ai/rankProfile.ts`: 랭크별 기본 단계, 연패 보정(파티 등급 먼저 → AI 단계), 마스터볼 이상 무보정, 복구, 상대 선택.
 * 랭크 학습 메모리 감쇠(`opponentMemory.ts` commitBattle)도 확인한다.
 *
 *   npm run test:rank-ai
 */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) {
    failed++;
    console.log(`FAIL ${name} ${detail}`);
  }
};
try {
  const { EMPTY_RANK } = await server.ssrLoadModule("/src/lib/battleRank.ts");
  const { resolveRankAiPolicy, pickRankOpponent, RANK_AI_PROFILES } = await server.ssrLoadModule("/src/lib/battle/ai/rankProfile.ts");
  const { SAMPLE_PARTIES } = await server.ssrLoadModule("/src/lib/data.ts");
  const tiers = (await server.ssrLoadModule("/src/data/samplePartyTiers.json")).default;
  const at = (o) => resolveRankAiPolicy({ ...EMPTY_RANK, ...o });
  const is = (name, got, level, tier) => check(name, got.level === level && got.tier === tier, JSON.stringify(got));

  check("프로필 8단", RANK_AI_PROFILES.length === 8);
  // 기본 단계: 게이지 0 몬스터 · 12칸×4=게이지 16/32 슈퍼·하이퍼 시작
  is("몬스터볼 P0·하", at({}), 0, "하");
  is("슈퍼볼 P1·중", at({ gauge: 16 }), 1, "중");
  is("하이퍼볼 P2·상", at({ gauge: 32 }), 2, "상");
  // 마스터볼 4~1: 레이팅 구간 경계 1600/1900/2200, 챔피언 2500(현재 레이팅 기준)
  is("마스터볼 4 (1300)", at({ rating: 1300 }), 3, "상");
  is("마스터볼 4 상단 (1599.99)", at({ rating: 1599.99 }), 3, "상");
  is("마스터볼 3 하단 (1600)", at({ rating: 1600 }), 4, "상");
  is("마스터볼 2 하단 (1900)", at({ rating: 1900 }), 5, "상");
  is("마스터볼 1 하단 (2200)", at({ rating: 2200 }), 6, "상");
  is("마스터볼 1 상단 (2499.99)", at({ rating: 2499.99 }), 6, "상");
  is("챔피언 (2500)", at({ rating: 2500 }), 7, "최상");
  is("챔피언 (2600)", at({ rating: 2600 }), 7, "최상");
  // 학습: 몬스터~하이퍼는 관측만(λ 0), 마스터볼 4~1은 λ 0.25/0.5/0.75/1.0, 챔피언 1.0
  const learnOf = (lv) => RANK_AI_PROFILES[lv].learn ?? { use: 1 };
  check("몬스터~하이퍼볼은 관측만", [0, 1, 2].every((lv) => learnOf(lv).use === 0 && learnOf(lv).observe === true && !RANK_AI_PROFILES[lv].opponentModel));
  check("마스터볼 4~1·챔피언 학습 사용률", [0.25, 0.5, 0.75, 1, 1].every((u, i) => learnOf(3 + i).use === u && !!RANK_AI_PROFILES[3 + i].opponentModel));
  // 연패 보정
  is("2연패 무보정", at({ gauge: 32, lossStreak: 2 }), 2, "상");
  is("3연패 파티 한 등급", at({ gauge: 32, lossStreak: 3 }), 2, "중");
  is("5연패 파티 두 등급", at({ gauge: 32, lossStreak: 5 }), 2, "하");
  is("6연패 하등급 뒤 AI 한 단계", at({ gauge: 32, lossStreak: 6 }), 1, "하");
  is("7연패 AI 두 단계", at({ gauge: 32, lossStreak: 7 }), 0, "하");
  is("P0 아래로 안 내려감", at({ gauge: 32, lossStreak: 20 }), 0, "하");
  is("슈퍼볼 3연패 → 하", at({ gauge: 16, lossStreak: 3 }), 1, "하");
  is("슈퍼볼 5연패 → AI P0", at({ gauge: 16, lossStreak: 5 }), 0, "하");
  is("몬스터볼은 보정 여지 없음", at({ lossStreak: 9 }), 0, "하");
  is("이기면 즉시 복구(연패 0)", at({ gauge: 32, lossStreak: 0 }), 2, "상");
  is("마스터볼 연패 무보정", at({ rating: 1500, lossStreak: 9 }), 3, "상");
  is("챔피언 연패 무보정", at({ rating: 2600, lossStreak: 9 }), 7, "최상");
  // 상대 선택
  const seq = [0.0, 0.3, 0.6, 0.99];
  // 상 풀은 최상 파티도 포함, 나머지는 같은 등급만
  const inPool = (id, tier) => (tier === "상" ? ["상", "최상"].includes(tiers[id]) : tiers[id] === tier);
  for (const tier of ["하", "중", "상", "최상"]) {
    const ok = seq.every((r) => inPool(pickRankOpponent(SAMPLE_PARTIES, tier, [], () => r).id, tier));
    check(`${tier}등급 풀에서만 선택`, ok);
  }
  const a = pickRankOpponent(SAMPLE_PARTIES, "상", [], () => 0.5).id;
  check("같은 난수 → 같은 선택", a === pickRankOpponent(SAMPLE_PARTIES, "상", [], () => 0.5).id);
  check("직전 상대 제외", seq.every((r) => pickRankOpponent(SAMPLE_PARTIES, "상", [a], () => r).id !== a));
  const fresh = [{ id: "새샘플" }];
  check("등급 없는 샘플은 중등급", pickRankOpponent([...fresh, { id: "real-m6-rank2" }], "중", [], () => 0).id === "새샘플");
  check("후보 없으면 전체에서", pickRankOpponent(fresh, "상", [], () => 0).id === "새샘플");
  check("샘플 전부 등급 보유", SAMPLE_PARTIES.every((p) => tiers[p.id]), SAMPLE_PARTIES.filter((p) => !tiers[p.id]).map((p) => p.id).join());
  check("등급 값은 하·중·상·최상", SAMPLE_PARTIES.every((p) => ["하", "중", "상", "최상"].includes(tiers[p.id])));
  const topIds = SAMPLE_PARTIES.filter((p) => tiers[p.id] === "최상").map((p) => p.id);
  check("최상 풀은 5개", topIds.length === 5, topIds.join());
  // 최상 풀이 작아 최근 제외로 비면 제외를 풀고 같은 풀에서 고른다(다른 등급으로 새지 않는다)
  check("최상 풀 전부 최근이어도 최상에서 선택", seq.every((r) => topIds.includes(pickRankOpponent(SAMPLE_PARTIES, "최상", topIds, () => r).id)));
  check("최근 제외 수: 챔피언 2 · 그 외 4", at({ rating: 2600 }).recent === 2 && at({ rating: 1500 }).recent === 4 && at({}).recent === 4);

  // 최근 상대 제외 · 랜덤 구축 비율(5.0 R3 확장)
  const recent = SAMPLE_PARTIES.filter((p) => tiers[p.id] === "상").slice(0, 4).map((p) => p.id);
  check("최근 4판 상대 제외", [0, 0.2, 0.5, 0.8, 0.99].every((r) => !recent.includes(pickRankOpponent(SAMPLE_PARTIES, "상", recent, () => r).id)));
  const rate = (o) => at(o).randomRate;
  check("볼별 랜덤 구축 확률", rate({ gauge: 0 }) === 1 && rate({ gauge: 16 }) === 0.7 && rate({ gauge: 32 }) === 0.5 && rate({ rating: 1500 }) === 0.3 && rate({ rating: 2600 }) === 0.4,
    [rate({ gauge: 0 }), rate({ gauge: 16 }), rate({ gauge: 32 }), rate({ rating: 1500 }), rate({ rating: 2600 })].join());
  for (const tier of ["하", "중", "상", "최상"]) {
    const pool = new Set(SAMPLE_PARTIES.filter((p) => inPool(p.id, tier)).flatMap((p) => p.slots.map((sl) => JSON.stringify(sl))));
    for (const r of [0.01, 0.37, 0.74]) {
      let k = 0;
      const rng = () => ((k += 1), (r * 7 + k * 0.137) % 1);
      const built = pickRankOpponent(SAMPLE_PARTIES, tier, [], rng, 1);
      check(`${tier}등급 랜덤 구축: 6마리·같은 등급 슬롯만·id`, built.id === `random:${tier}` && built.slots.length === 6 && built.slots.every((sl) => pool.has(JSON.stringify(sl))));
    }
  }
  check("확률 0이면 샘플", !pickRankOpponent(SAMPLE_PARTIES, "중", [], () => 0.1, 0).id.startsWith("random:"));
  check("확률 1이면 항상 랜덤 구축", pickRankOpponent(SAMPLE_PARTIES, "중", [], () => 0.1, 1).id === "random:중");

  // 학습 사용률 λ(calibrateDistribution strength): 0 = 보정 없음, 1 = 기본, 중간은 그 사이
  const { calibrateDistribution, emptyOpponentMemory: emptyMemory } = await server.ssrLoadModule("/src/lib/battle/ai/opponentMemory.ts");
  const dist = { moveWeights: new Map([["a", 0.5], ["b", 0.5]]), switches: [{ toIndex: 1, weight: 1 }], switchProb: 0.2, megaOf: new Map() };
  const memory = { ...emptyMemory(), switchActual: 30, switchPred: 3, species: { x: { seen: 20, lastBattle: 1, moves: { a: { actual: 20, pred: 2 }, b: { actual: 0, pred: 18 } } } } };
  const at0 = calibrateDistribution(dist, memory, "x", new Set(), 0);
  const at1 = calibrateDistribution(dist, memory, "x", new Set());
  const atHalf = calibrateDistribution(dist, memory, "x", new Set(), 0.5);
  check("λ 0이면 보정 없음", at0.switchProb === dist.switchProb && at0.moveWeights.get("a") === 0.5);
  check("λ 기본은 1", calibrateDistribution(dist, memory, "x", new Set(), 1).switchProb === at1.switchProb);
  check("λ 1은 교체·기술 보정이 걸림", at1.switchProb > dist.switchProb && at1.moveWeights.get("a") > 0.5);
  check("λ 0.5는 0과 1 사이", atHalf.switchProb > at0.switchProb && atHalf.switchProb < at1.switchProb && atHalf.moveWeights.get("a") > 0.5 && atHalf.moveWeights.get("a") < at1.moveWeights.get("a"));

  // 챔피언(6.3 G4 v0): 앱 AI와 같은 설정에 탐색 깊이 2만 더한다. 다른 단계는 깊이 1(기본)이다
  check("챔피언은 깊이 2 탐색, 나머지는 깊이 1", RANK_AI_PROFILES[7].search?.depth === 2 && RANK_AI_PROFILES.slice(3, 7).every((p) => (p.search?.depth ?? 1) === 1));
  check("챔피언은 마스터볼 1과 탐색 폭·상대 모델이 같다", RANK_AI_PROFILES[7].search.topK === RANK_AI_PROFILES[6].search.topK && RANK_AI_PROFILES[7].search.budget === RANK_AI_PROFILES[6].search.budget && !!RANK_AI_PROFILES[7].opponentModel);

  // 관측만 하는 프로필: 모델이 없어도 분포를 돌려주되 판단은 학습 설정이 없을 때와 같다
  const stateMod = await server.ssrLoadModule("/src/lib/battle/state.ts");
  const { chooseAiAction } = await server.ssrLoadModule("/src/lib/battle/ai/index.ts");
  const { getMove } = await server.ssrLoadModule("/src/lib/data.ts");
  const sideOf = (party) => { const slots = party.slots.slice(0, 3); return { slots, movesList: slots.map((sl) => sl.moves.filter(Boolean).map((m) => getMove(m))) }; };
  const battle = stateMod.createBattleState({ a: sideOf(SAMPLE_PARTIES[0]), b: sideOf(SAMPLE_PARTIES[1]) });
  const rng = () => 0.5;
  const plain = { ...RANK_AI_PROFILES[0] };
  delete plain.learn;
  const watched = chooseAiAction(battle, "a", 0.5, { decisionParams: RANK_AI_PROFILES[0], rng });
  const unwatched = chooseAiAction(battle, "a", 0.5, { decisionParams: plain, rng });
  check("관측만 프로필은 분포를 돌려준다", !!watched.opponentDistribution && unwatched.opponentDistribution === undefined);
  check("관측만 해도 판단은 그대로", JSON.stringify(watched.action) === JSON.stringify(unwatched.action));
  const started = performance.now();
  const champion = chooseAiAction(battle, "a", 0.5, { decisionParams: RANK_AI_PROFILES[7], rng });
  const championMs = performance.now() - started;
  check("챔피언 프로필이 정상 행동을 고르고 5초 안에 끝난다", (champion.action.kind === "move" || champion.action.kind === "switch") && championMs < 5000, `${championMs.toFixed(0)}ms`);

  // 학습 메모리 감쇠(랭크 0.995 > 배틀타워 0.99): 같은 누적본·세션이면 랭크가 옛 기록을 더 많이 남긴다
  const { commitBattle, emptyOpponentMemory, MEMORY_DECAY_PER_BATTLE, RANK_MEMORY_DECAY_PER_BATTLE } = await server.ssrLoadModule("/src/lib/battle/ai/opponentMemory.ts");
  const saved = { ...emptyOpponentMemory(), battles: 5, decisions: 100 };
  const session = emptyOpponentMemory();
  check("감쇠 기본값은 배틀타워 0.99", commitBattle(saved, session).decisions === 100 * MEMORY_DECAY_PER_BATTLE);
  check("랭크 감쇠 0.995", commitBattle(saved, session, RANK_MEMORY_DECAY_PER_BATTLE).decisions === 100 * 0.995);
  check("판 수는 감쇠와 무관하게 +1", commitBattle(saved, session, RANK_MEMORY_DECAY_PER_BATTLE).battles === 6);
} finally {
  await server.close();
}
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
if (failed > 0) process.exitCode = 1;
