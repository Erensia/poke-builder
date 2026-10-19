/**
 * 배틀타워 랭크배틀(5.0 R1 ⓐ) — 판 결과 → 새 랭크 상태. UI·저장과 분리한 순수 함수이고, 규칙은 5.0-backlog.md R1 절.
 * 몬스터볼~하이퍼볼은 경험치제(게이지), 마스터볼 이상은 레이팅제다. 챔피언은 마스터볼 레이팅 2500 이상.
 */

/** 게이지 눈금 하나 = 한 단계의 1/4. 12단계(몬스터볼 4 ~ 하이퍼볼 1) × 4 = 48을 채우면 마스터볼 */
const STEP_QUARTERS = 4;
const GAUGE_FULL = 12 * STEP_QUARTERS;
const BALLS = ["monster", "super", "hyper"] as const;

const ENTRY_BASE = 1300;
const ENTRY_PER_WIN = 2;
const ENTRY_BONUS_WIN_LEAD = 10;
const MASTER_BASE = 20;
const CHAMPION_RATING = 2500;

export interface RankState {
  /** 경험치제 게이지(1/4 단위 정수, 0~47). 마스터볼에 오르면 더는 쓰지 않는다 */
  gauge: number;
  /** 시즌 랭크 판 전체 승수·패수(이탈 패배 포함) — 마스터볼 진입 레이팅은 진입 때의 값으로 계산한다 */
  wins: number;
  losses: number;
  /** 랭크 전용 연승·연패(단계·볼이 바뀌어도 이어진다) */
  streak: number;
  lossStreak: number;
  /** 마스터볼 이상에서만 값이 있다(소수점 둘째 자리까지) */
  rating: number | null;
  /** 이번 시즌 최대 레이팅과 챔피언 달성 여부(2500 미만으로 내려가도 남는다) */
  maxRating: number;
  champion: boolean;
}

export const EMPTY_RANK: RankState = { gauge: 0, wins: 0, losses: 0, streak: 0, lossStreak: 0, rating: null, maxRating: 0, champion: false };

/** 승리는 턴 수가 필요하다. 이탈·무승부는 `{ won: false }`(패배와 같다) */
export type RankResult = { won: true; turns: number } | { won: false };

/** 승패 직후 보여줄 계산 내역 */
export type RankChange =
  | { kind: "gauge"; delta: number }
  | { kind: "entry"; base: number; bonus: boolean; rating: number }
  | { kind: "rating"; base: number; turnBonus: number; multiplier: number; delta: number };

export interface RankDisplay {
  ball: "monster" | "super" | "hyper" | "master" | "champion";
  /** 몬스터볼~하이퍼볼의 단계(4~1). 마스터볼 이상은 null */
  step: number | null;
  /** 현재 단계 게이지(0~3 눈금, 4눈금이 차면 승급) */
  fill: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** 현재 랭크를 표시용으로 푼다. 챔피언은 지금 레이팅이 2500 이상일 때만(내려가면 마스터볼) */
export function rankOf(state: RankState): RankDisplay {
  if (state.rating !== null) return { ball: state.rating >= CHAMPION_RATING ? "champion" : "master", step: null, fill: 0 };
  const stage = Math.floor(state.gauge / STEP_QUARTERS);
  return { ball: BALLS[Math.floor(stage / 4)], step: 4 - (stage % 4), fill: state.gauge % STEP_QUARTERS };
}

/** 턴 보정: 30턴 이하 1턴당 +1(최대 +10), 40턴 초과 1턴당 -1(최대 -10), 31~40턴은 0 */
function turnBonus(turns: number): number {
  if (turns <= 30) return Math.min(30 - turns, 10);
  if (turns > 40) return -Math.min(turns - 40, 10);
  return 0;
}

/** 마스터볼 이상의 한 판. 연승·연패 n에 배율은 1 + 0.1(n-1), (기본 ± 턴 보정) × 배율을 둘째 자리로 반올림 */
function masterGame(rating: number, result: RankResult, streak: number, lossStreak: number): { rating: number; change: RankChange } {
  const n = result.won ? streak : lossStreak;
  const multiplier = n >= 2 ? (9 + n) / 10 : 1;
  const bonus = result.won ? turnBonus(result.turns) : 0;
  const base = result.won ? MASTER_BASE + bonus : MASTER_BASE;
  const delta = round2((result.won ? base : -base) * multiplier);
  return { rating: Math.max(0, round2(rating + delta)), change: { kind: "rating", base: MASTER_BASE, turnBonus: bonus, multiplier, delta } };
}

/** 한 판 결과를 반영한 새 상태(원본은 건드리지 않는다)와 계산 내역 */
export function applyRankResult(state: RankState, result: RankResult): { state: RankState; change: RankChange } {
  const wins = state.wins + (result.won ? 1 : 0);
  const losses = state.losses + (result.won ? 0 : 1);
  const streak = result.won ? state.streak + 1 : 0;
  const lossStreak = result.won ? 0 : state.lossStreak + 1;
  const next: RankState = { ...state, wins, losses, streak, lossStreak };
  let change: RankChange;

  if (state.rating !== null) {
    const g = masterGame(state.rating, result, streak, lossStreak);
    next.rating = g.rating;
    change = g.change;
  } else {
    // 경험치제: 승리 +1, 2연승째부터 +2(합산 아님), 패배 -1(연패 가중 없음, 몬스터볼 4의 0이 하한). 눈금이 연속이라 초과분 이월·볼 경계 강등이 그대로 된다
    const delta = result.won ? (streak >= 2 ? 2 : 1) : -1;
    const gauge = Math.max(0, state.gauge + delta);
    if (gauge < GAUGE_FULL) {
      next.gauge = gauge;
      change = { kind: "gauge", delta: gauge - state.gauge };
    } else {
      // 마스터볼 진입: (1300 + 2×누적 승수) × 1.1 — 승급 시점에 연승 중(2연승 이상)이거나 승수 − 패수 ≥ 10일 때만 1.1배
      const bonus = streak >= 2 || wins - losses >= ENTRY_BONUS_WIN_LEAD;
      const base = ENTRY_BASE + ENTRY_PER_WIN * wins;
      next.rating = round2(bonus ? base * 1.1 : base);
      next.gauge = 0;
      change = { kind: "entry", base, bonus, rating: next.rating };
    }
  }

  if (next.rating !== null) {
    next.maxRating = Math.max(state.maxRating, next.rating);
    next.champion = state.champion || next.rating >= CHAMPION_RATING;
  }
  return { state: next, change };
}
