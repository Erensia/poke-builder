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
  const { EMPTY_RANK, applyRankResult, rankOf, rankLabel } = await server.ssrLoadModule("/src/lib/battleRank.ts");
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

  check("표시 이름", rankLabel(rankOf(S())) === "몬스터볼 4" && rankLabel(rankOf(S({ gauge: 47 }))) === "하이퍼볼 1" && rankLabel(rankOf(S({ rating: 1500 }))) === "마스터볼" && rankLabel(rankOf(S({ rating: 2500 }))) === "챔피언");

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

  // ── 저장·정산·시즌 (lib/battleRankSave.ts) ──
  const { EMPTY_RANK_SAVE, isRankSave, beginRankMatch, finishRankMatch, settleAbandonedRank, resetSeason, expireSeason, SEASON_MS } = await server.ssrLoadModule("/src/lib/battleRankSave.ts");
  const party = Array(6).fill(null);
  const play = (save, won, now = 1000) => finishRankMatch(beginRankMatch(save, "s1", party, now), won ? { won: true, turns: 25 } : { won: false }, now + 1);

  const b1 = beginRankMatch(EMPTY_RANK_SAVE, "s1", party, 1000);
  check("판 시작: 진행 표시·사용 파티·시즌 시작 시각", b1.pendingId === "s1" && b1.lastParty === party && b1.seasonStartedAt === 1000);
  check("시즌 시작 시각은 첫 판 때만 정해진다", beginRankMatch(play(b1, true), "s2", party, 5000).seasonStartedAt === 1000);
  const f1 = play(EMPTY_RANK_SAVE, true);
  check("승리 반영: 게이지·진행 표시 해제", f1.state.gauge === 1 && f1.pendingId === null);
  const h = f1.history[0];
  check("이력 한 줄: 상대·승·턴·변화·판 뒤 랭크", h.opponentId === "s1" && h.result === "win" && h.turns === 25 && h.change.kind === "gauge" && h.after.ball === "monster" && h.after.fill === 1 && h.rating === null && h.at === 1001, show(h));
  check("진행 표시 없이 결과가 오면 그대로", finishRankMatch(EMPTY_RANK_SAVE, { won: false }, 1) === EMPTY_RANK_SAVE);
  let many = EMPTY_RANK_SAVE;
  for (let i = 0; i < 60; i++) many = play(many, i % 2 === 0, 1000 + i * 10);
  check("이력은 최근 50판, 최신이 맨 앞", many.history.length === 50 && many.history[0].at === 1000 + 59 * 10 + 1 && many.history[49].at === 1000 + 10 * 10 + 1);
  check("이력이 잘려도 승패수는 전부 센다", many.state.wins + many.state.losses === 60);
  const ab = settleAbandonedRank(b1, 2000);
  check("이탈 정산: 패배·연패 +1, 이력 abandon, 표시 해제", ab.state.losses === 1 && ab.state.lossStreak === 1 && ab.history[0].result === "abandon" && ab.pendingId === null);
  check("진행 표시가 없으면 이탈 정산도 그대로", settleAbandonedRank(f1, 2000) === f1);

  const nothing = resetSeason({ ...EMPTY_RANK_SAVE, seasons: [{ season: 1 }] }, 9000);
  check("한 판도 안 한 시즌은 기록하지 않고, 이전 시즌은 유지", nothing.seasons.length === 1 && show(nothing.state) === show(EMPTY_RANK));
  const played = play(play(play(EMPTY_RANK_SAVE, true), true), false);
  const r1 = resetSeason(played, 9000);
  const rec = r1.seasons[0];
  check("시즌 기록: 번호·시작/끝·직전 랭크·최대·챔피언·승수·파티", rec.season === 1 && rec.startedAt === 1000 && rec.endedAt === 9000 && rec.finalRank.ball === "monster" && rec.finalRank.fill === 2 && rec.finalRating === null && rec.maxRating === 0 && !rec.champion && rec.wins === 2 && rec.party === party, show(rec));
  check("초기화 뒤: 몬스터볼 4, 이력·시작 시각·파티 비움", show(r1.state) === show(EMPTY_RANK) && r1.history.length === 0 && r1.seasonStartedAt === null && r1.lastParty === null);
  check("두 번째 시즌은 2시즌, 1시즌 기록 유지", resetSeason(play(r1, true), 20000).seasons.map((x) => x.season).join() === "1,2");
  check("판 진행 중에는 초기화하지 않는다", resetSeason(b1, 9000) === b1);
  const champ = resetSeason({ ...EMPTY_RANK_SAVE, state: { ...EMPTY_RANK, wins: 40, losses: 3, rating: 2600, maxRating: 2650, champion: true } }, 9000).seasons[0];
  check("챔피언 시즌 기록", champ.champion && champ.finalRank.ball === "champion" && champ.finalRating === 2600 && champ.maxRating === 2650 && champ.wins === 40);
  check("저장 검증: 빈 기록·직렬화 왕복 통과", isRankSave(EMPTY_RANK_SAVE) && isRankSave(JSON.parse(JSON.stringify(many))) && isRankSave(JSON.parse(JSON.stringify(r1))));
  check("저장 검증: 손상된 값 거부", [null, {}, { ...EMPTY_RANK_SAVE, state: null }, { ...EMPTY_RANK_SAVE, history: {} }, { ...EMPTY_RANK_SAVE, state: { ...EMPTY_RANK, gauge: 1.5 } }, { ...EMPTY_RANK_SAVE, lastParty: [null] }].every((v) => !isRankSave(v)));

  // ── 30일 자동 초기화 (ⓓ) ──
  const DAY = 86400000;
  const t0 = 1_000_000;
  const p30 = play(play(EMPTY_RANK_SAVE, true, t0), false, t0 + 1000);
  check("시즌 길이는 30일", SEASON_MS === 30 * DAY);
  check("30일 전에는 그대로", expireSeason(p30, t0 + 30 * DAY - 1) === p30);
  check("한 판도 안 한 시즌(시작 시각 없음)은 아무 일도 없다", expireSeason(EMPTY_RANK_SAVE, t0 + 999 * DAY) === EMPTY_RANK_SAVE);
  const ex = expireSeason(p30, t0 + 45 * DAY);
  check("30일이 지나면 시즌을 닫는다: 종료일은 시작+30일", ex.seasons.length === 1 && ex.seasons[0].season === 1 && ex.seasons[0].startedAt === t0 && ex.seasons[0].endedAt === t0 + 30 * DAY && ex.seasons[0].wins === 1, show(ex.seasons));
  check("닫은 뒤 처음 상태·시작 시각·이력 비움", show(ex.state) === show(EMPTY_RANK) && ex.seasonStartedAt === null && ex.history.length === 0);
  check("정확히 30일이면 닫는다", expireSeason(p30, t0 + 30 * DAY).seasons.length === 1);
  check("판이 진행 중이면 닫지 않는다", expireSeason(beginRankMatch(p30, "s9", party, t0 + 1), t0 + 40 * DAY).seasons.length === 0);
  const s2 = play(ex, true, t0 + 50 * DAY);
  check("다음 시즌은 다음 첫 판부터 다시 30일", s2.seasonStartedAt === t0 + 50 * DAY && expireSeason(s2, t0 + 79 * DAY) === s2 && expireSeason(s2, t0 + 80 * DAY).seasons.map((x) => x.season).join() === "1,2");

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
