import type { PartySlots } from "../types/party";
import { applyRankResult, EMPTY_RANK, rankOf, type RankChange, type RankDisplay, type RankResult, type RankState } from "./battleRank";

/** 판별 이력은 최근 50판만 보관한다 */
const HISTORY_LIMIT = 50;

/** 시즌은 첫 랭크 판을 한 날부터 30일 */
export const SEASON_MS = 30 * 24 * 60 * 60 * 1000;

/** 랭크 판 한 줄(최근 순으로 쌓는다). 이탈은 패배와 같게 계산되지만 표시는 따로 한다 */
export interface RankHistoryEntry {
  at: number;
  opponentId: string;
  result: "win" | "loss" | "abandon";
  /** 승리일 때만 판이 끝난 시점의 턴 번호 */
  turns: number | null;
  change: RankChange;
  /** 이 판이 끝난 뒤의 랭크 표시와 레이팅(마스터볼 이상일 때만) */
  after: RankDisplay;
  rating: number | null;
}

/** 수동 초기화(이후 30일 자동 초기화)로 닫힌 시즌의 기록 */
export interface SeasonRecord {
  /** 1시즌, 2시즌 … */
  season: number;
  startedAt: number;
  endedAt: number;
  /** 초기화 직전 랭크 — 마스터볼에 못 올랐으면 레이팅이 없으므로 이 표시(볼·단계)가 기록이 된다 */
  finalRank: RankDisplay;
  finalRating: number | null;
  maxRating: number;
  /** 시즌 중 챔피언 달성 여부. 못 했으면 maxRating만 표시한다 */
  champion: boolean;
  /** 시즌 랭크 판 전체 승수 */
  wins: number;
  /** 시즌 마지막에 쓴 파티(스냅숏) */
  party: PartySlots | null;
}

/**
 * 랭크배틀(5.0 R1 ⓑ) 저장본 — localStorage에 통째로 저장한다. 프런티어 `FrontierSave`와 별개.
 * pendingId는 "판이 시작됐지만 결과가 아직 없는" 상대 샘플 id — 다음에 앱이 열릴 때 남아 있으면 이탈(= 패배)로 정산한다.
 * seasonStartedAt은 이번 시즌 첫 랭크 판을 시작한 시각(30일 자동 초기화의 기준, ⓓ).
 */
export interface RankSave {
  state: RankState;
  history: RankHistoryEntry[];
  seasons: SeasonRecord[];
  pendingId: string | null;
  seasonStartedAt: number | null;
  lastParty: PartySlots | null;
}

export const EMPTY_RANK_SAVE: RankSave = { state: EMPTY_RANK, history: [], seasons: [], pendingId: null, seasonStartedAt: null, lastParty: null };

export function isRankSave(value: unknown): value is RankSave {
  const v = value as RankSave;
  const s = v?.state;
  return (
    !!s &&
    typeof s === "object" &&
    [s.gauge, s.wins, s.losses, s.streak, s.lossStreak].every(Number.isInteger) &&
    (s.rating === null || typeof s.rating === "number") &&
    typeof s.maxRating === "number" &&
    typeof s.champion === "boolean" &&
    Array.isArray(v.history) &&
    Array.isArray(v.seasons) &&
    (v.pendingId === null || typeof v.pendingId === "string") &&
    (v.seasonStartedAt === null || typeof v.seasonStartedAt === "number") &&
    (v.lastParty === null || (Array.isArray(v.lastParty) && v.lastParty.length === 6))
  );
}

/** 판 시작 — 결과 전에 끊기면 이탈로 정산할 수 있게 상대를 표시하고, 이번 시즌 첫 판이면 시작 시각·사용 파티를 남긴다 */
export function beginRankMatch(save: RankSave, opponentId: string, party: PartySlots, now: number): RankSave {
  return { ...save, pendingId: opponentId, lastParty: party, seasonStartedAt: save.seasonStartedAt ?? now };
}

/** 진행 중이던 판의 결과 반영(이탈·무승부는 `{ won: false }` + abandoned). 진행 표시가 없으면 그대로 */
export function finishRankMatch(save: RankSave, result: RankResult, now: number, abandoned = false): RankSave {
  if (save.pendingId === null) return save;
  const { state, change } = applyRankResult(save.state, result);
  const entry: RankHistoryEntry = {
    at: now,
    opponentId: save.pendingId,
    result: result.won ? "win" : abandoned ? "abandon" : "loss",
    turns: result.won ? result.turns : null,
    change,
    after: rankOf(state),
    rating: state.rating,
  };
  return { ...save, state, pendingId: null, history: [entry, ...save.history].slice(0, HISTORY_LIMIT) };
}

/** 앱을 열 때 진행 중 표시가 남아 있으면 그 판을 이탈 패배로 정산한다. 없으면 그대로 */
export function settleAbandonedRank(save: RankSave, now: number): RankSave {
  return finishRankMatch(save, { won: false }, now, true);
}

/**
 * 시즌 초기화 — 이번 시즌 기록을 남기고 랭크·이력을 처음으로 되돌린다(이전 시즌 기록은 유지). 30일이 지나면 expireSeason이 자동으로 부른다.
 * 한 판도 안 한 시즌은 기록하지 않는다. 판이 진행 중이면 초기화하지 않는다(이탈=패배 우회 방지).
 */
export function resetSeason(save: RankSave, now: number): RankSave {
  if (save.pendingId !== null) return save;
  const { state } = save;
  if (state.wins + state.losses === 0) return { ...EMPTY_RANK_SAVE, seasons: save.seasons };
  const record: SeasonRecord = {
    season: save.seasons.length + 1,
    startedAt: save.seasonStartedAt ?? now,
    endedAt: now,
    finalRank: rankOf(state),
    finalRating: state.rating,
    maxRating: state.maxRating,
    champion: state.champion,
    wins: state.wins,
    party: save.lastParty,
  };
  return { ...EMPTY_RANK_SAVE, seasons: [...save.seasons, record] };
}

/**
 * 30일 자동 초기화(5.0 R1 ⓓ) — 시즌 시작(첫 랭크 판)에서 30일이 지났으면 그 시즌을 닫는다. 앱을 열 때와 랭크 배틀을 시작할 때 부른다.
 * 시즌 종료일은 점검한 시각이 아니라 시작 + 30일로 기록한다. 시작 시각이 없으면(= 이번 시즌 한 판도 안 함) 할 일이 없다.
 */
export function expireSeason(save: RankSave, now: number): RankSave {
  if (save.seasonStartedAt === null || now - save.seasonStartedAt < SEASON_MS) return save;
  return resetSeason(save, save.seasonStartedAt + SEASON_MS);
}
