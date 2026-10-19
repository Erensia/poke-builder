/**
 * 랭크배틀(5.0 R1 ⓐ) 규칙 검증 — `lib/battleRank.ts`가 5.0-backlog.md R1 규칙표와 일치하는지 본다.
 * 실패가 하나라도 있으면 종료 코드 1.
 *
 *   npm run test:rank
 */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
let failed = 0;
let total = 0;
const check = (name, ok, detail = "") => {
  total++;
  if (!ok) {
    failed++;
    console.log(`FAIL ${name} ${detail}`);
  }
};
try {
  const { EMPTY_RANK, applyRankResult, rankOf } = await server.ssrLoadModule("/src/lib/battleRank.ts");
  const S = (o = {}) => Object.freeze({ ...EMPTY_RANK, ...o });
  const win = (s, turns = 35) => applyRankResult(s, { won: true, turns });
  const lose = (s) => applyRankResult(s, { won: false });
  const show = (s) => JSON.stringify(s);

  // ── 경험치제 ──
  check("승리 +1/4", win(S()).state.gauge === 1);
  check("2연승째부터 +1/2(합산 아님)", win(S({ streak: 1, gauge: 1 })).state.gauge === 3);
  check("패배 -1/4, 연승 끊김", (({ state: s }) => s.gauge === 4 && s.streak === 0)(lose(S({ gauge: 5, streak: 3 }))));
  check("몬스터볼 4의 0에서 패배는 하한", lose(S()).state.gauge === 0);
  check("패배는 연패와 무관하게 -1/4 고정", lose(S({ gauge: 10, lossStreak: 5 })).state.gauge === 9);
  // 문서 예: 몬스터볼 1(3/4) 연승 중 +1/2 → 합계 5/4 → 슈퍼볼 4에 게이지 1/4
  const carry = win(S({ gauge: 15, streak: 1 })).state;
  check("승급 초과분 이월", carry.gauge === 17 && show(rankOf(carry)) === show({ ball: "super", step: 4, fill: 1 }), show(rankOf(carry)));
  check("게이지 0 패배 → 아래 단계 3/4(슈퍼볼 4 → 몬스터볼 1)", show(rankOf(lose(S({ gauge: 16 })).state)) === show({ ball: "monster", step: 1, fill: 3 }));
  check("하이퍼볼 4 0에서 패배 → 슈퍼볼 1 3/4", show(rankOf(lose(S({ gauge: 32 })).state)) === show({ ball: "super", step: 1, fill: 3 }));
  check("연패 카운트는 쌓이고 승리로 리셋", lose(lose(S()).state).state.lossStreak === 2 && win(S({ lossStreak: 4 })).state.lossStreak === 0);
  check("승패수는 이탈 포함 누적", (({ state: s }) => s.wins === 1 && s.losses === 1)(lose(win(S()).state)));
  check("표시: 처음·하이퍼볼 1 끝", show(rankOf(S())) === show({ ball: "monster", step: 4, fill: 0 }) && show(rankOf(S({ gauge: 47 }))) === show({ ball: "hyper", step: 1, fill: 3 }));

  // ── 마스터볼 진입 (1300 + 2×승수, 조건부 ×1.1) ──
  // 사용자 가계산: 누적 30승 · 7연승으로 진입 = 1496.00
  const e1 = win(S({ gauge: 46, streak: 6, wins: 29 }));
  check("진입: 30승 7연승 → 1496.00", e1.state.rating === 1496 && e1.change.kind === "entry" && e1.change.bonus, show(e1));
  check("진입 뒤 게이지 0, 연승은 이어진다", e1.state.gauge === 0 && e1.state.streak === 7);
  check("진입: 1연승 + 승-패 10(경계) → 1.1배", win(S({ gauge: 47, wins: 29, losses: 20 })).state.rating === 1496);
  check("진입: 1연승 + 승-패 9 → 1.1배 없음", win(S({ gauge: 47, wins: 29, losses: 21 })).state.rating === 1360);
  check("진입: 연승 중(2연승)이면 승-패 낮아도 1.1배", win(S({ gauge: 46, streak: 1, wins: 29, losses: 29 })).state.rating === 1496);
  check("진입: 25승 → 1485.00(부동소수 오차 제거)", win(S({ gauge: 46, streak: 1, wins: 24 })).state.rating === 1485);

  // ── 마스터볼 ──
  const M = (o = {}) => S({ rating: 1500, maxRating: 1500, ...o });
  const gain = (turns, o) => win(M(o), turns).state.rating - 1500;
  check("승리 기본 +20(31~40턴 보정 없음)", gain(31) === 20 && gain(35) === 20 && gain(40) === 20);
  check("30턴 이하 1턴당 +1, 20턴 이하 최대 +10", gain(30) === 20 && gain(29) === 21 && gain(21) === 29 && gain(20) === 30 && gain(5) === 30 && gain(1) === 30);
  check("40턴 초과 1턴당 -1, 50턴 이상 최대 -10", gain(41) === 19 && gain(49) === 11 && gain(50) === 10 && gain(80) === 10);
  check("패배 -20, 턴 수 무관", lose(M()).state.rating === 1480);
  check("연승 배율 2연승 ×1.1 ~ 5연승 ×1.4(턴 35)", [1, 2, 3, 4].map((s) => win(M({ streak: s }), 35).state.rating - 1500).join() === "22,24,26,28", [1, 2, 3, 4].map((s) => win(M({ streak: s }), 35).state.rating - 1500).join());
  check("연승 배율은 턴 보정 뒤에 곱한다", win(M({ streak: 1 }), 20).state.rating === 1533, `${win(M({ streak: 1 }), 20).state.rating}`);
  check("소수 둘째 자리(29턴 21 × 1.1 = 23.1)", win(M({ streak: 1 }), 29).state.rating === 1523.1);
  check("연패 배율 2연패 ×1.1, 3연패 ×1.2", lose(M({ lossStreak: 1 })).state.rating === 1478 && lose(M({ lossStreak: 2 })).state.rating === 1476);
  check("진입 직전 연승이 첫 판 배율에 반영(7연승 뒤 8연승째 ×1.7)", win(M({ streak: 7 }), 35).state.rating === 1534);
  check("레이팅 하한 0", lose(M({ rating: 10 })).state.rating === 0);
  check("이탈·무승부도 연패 배율 적용(-20, -22)", lose(lose(M()).state).state.rating === 1458);

  // ── 챔피언 ──
  const c1 = win(M({ rating: 2480, maxRating: 2480 }), 35).state;
  check("2500.00 정확히 도달하면 챔피언", c1.rating === 2500 && c1.champion && rankOf(c1).ball === "champion");
  check("2499.99는 마스터볼", rankOf(M({ rating: 2499.99 })).ball === "master");
  const c2 = lose(c1).state;
  check("2500 미만으로 내려가면 마스터볼 표시, 달성 이력·최대 레이팅은 유지", rankOf(c2).ball === "master" && c2.champion && c2.maxRating === 2500, show(c2));
  check("챔피언 도달 못 하면 달성 여부 false, 최대 레이팅만", !win(M(), 35).state.champion && win(M(), 35).state.maxRating === 1520);

  // ── 불변·범위 (무작위 판 2만 번) ──
  let seed = 7;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let s = EMPTY_RANK;
  let bad = "";
  for (let i = 0; i < 20000 && !bad; i++) {
    const r = rng() < 0.6 ? { won: true, turns: 1 + Math.floor(rng() * 70) } : { won: false };
    s = applyRankResult(s, r).state;
    if (s.rating === null ? s.gauge < 0 || s.gauge >= 48 : s.rating < 0 || s.rating !== Math.round(s.rating * 100) / 100 || s.maxRating < s.rating) bad = `i=${i} ${show(s)}`;
    if (s.rating !== null && s.gauge !== 0) bad = `gauge i=${i}`;
  }
  check("무작위 2만 판 범위·소수 둘째 자리 유지", !bad, bad);

  console.log(failed ? `${failed} FAIL / ${total}` : `ALL PASS (${total}건)`);
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
