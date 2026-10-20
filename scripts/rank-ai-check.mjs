/**
 * 랭크배틀 AI 정책(5.0 R3 S3) 검증 — `lib/battle/ai/rankProfile.ts`: 랭크별 기본 단계, 연패 보정(파티 등급 먼저 → AI 단계), 마스터볼 이상 무보정, 복구, 상대 선택.
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

  check("프로필 5단", RANK_AI_PROFILES.length === 5);
  // 기본 단계: 게이지 0 몬스터 · 12칸×4=게이지 16/32 슈퍼·하이퍼 시작
  is("몬스터볼 P0·하", at({}), 0, "하");
  is("슈퍼볼 P1·중", at({ gauge: 16 }), 1, "중");
  is("하이퍼볼 P2·상", at({ gauge: 32 }), 2, "상");
  is("마스터볼 P3·상", at({ rating: 1500 }), 3, "상");
  is("챔피언 P4·상", at({ rating: 2600 }), 4, "상");
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
  is("챔피언 연패 무보정", at({ rating: 2600, lossStreak: 9 }), 4, "상");
  // 상대 선택
  const seq = [0.0, 0.3, 0.6, 0.99];
  for (const tier of ["하", "중", "상"]) {
    const ok = seq.every((r) => tiers[pickRankOpponent(SAMPLE_PARTIES, tier, undefined, () => r).id] === tier);
    check(`${tier}등급 풀에서만 선택`, ok);
  }
  const a = pickRankOpponent(SAMPLE_PARTIES, "상", undefined, () => 0.5).id;
  check("같은 난수 → 같은 선택", a === pickRankOpponent(SAMPLE_PARTIES, "상", undefined, () => 0.5).id);
  check("직전 상대 제외", seq.every((r) => pickRankOpponent(SAMPLE_PARTIES, "상", a, () => r).id !== a));
  const fresh = [{ id: "새샘플" }];
  check("등급 없는 샘플은 중등급", pickRankOpponent([...fresh, { id: "real-m6-rank2" }], "중", undefined, () => 0).id === "새샘플");
  check("후보 없으면 전체에서", pickRankOpponent(fresh, "상", undefined, () => 0).id === "새샘플");
  check("샘플 전부 등급 보유", SAMPLE_PARTIES.every((p) => tiers[p.id]), SAMPLE_PARTIES.filter((p) => !tiers[p.id]).map((p) => p.id).join());
} finally {
  await server.close();
}
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
if (failed > 0) process.exitCode = 1;
