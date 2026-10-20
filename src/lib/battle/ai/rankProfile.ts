import { rankOf, type RankState } from "../../battleRank";
import tiersJson from "../../../data/samplePartyTiers.json";
import { APP_DECISION_PARAMS } from "./aiClient";
import type { DecisionParams } from "./decision";

/**
 * 랭크배틀 AI 정책(5.0 R3 S3) — 랭크·연패에서 "AI 단계(P0~P4)"와 "상대 샘플 파티 등급"만 정한다. 판단은 하지 않는다(설계·측정은 5.0-backlog.md R3).
 * 단계는 S2 측정(인접 직접 대전 승률 P1↔P0 68.8·P2↔P1 67.5·P3↔P2 64.8·P4↔P3 60.1%)으로 확정했다.
 */

/** 탐색·상대 모델·`*Aware`를 전부 끈 기반(측정의 c7) */
const OFF: Partial<DecisionParams> = {
  statusAware: false, setupAware: false, phase3Aware: false, a1Aware: false, a2Aware: false, trackMAware: false, tier2Aware: false,
  partyAware: false, oppSwitchAware: false, mySwitchAware: false,
};
const noisy = (rate: number, hardOverride?: boolean): Partial<DecisionParams> => ({ ...OFF, mistake: { rate, margin: 1e9, hardOverride } });

/** P0(약)~P4(현재 앱 AI). ponytail: 앱 AI보다 강한 챔피언 전용 단계는 수단이 없어 P4 = 앱 AI — 챔피언은 상등급 파티로만 차별 */
export const RANK_AI_PROFILES: Partial<DecisionParams>[] = [noisy(1, true), noisy(0.7), noisy(0.3), OFF, APP_DECISION_PARAMS];

export type PartyTier = "하" | "중" | "상";
const TIERS: PartyTier[] = ["하", "중", "상"];
const BASE_TIER = { monster: 0, super: 1, hyper: 2, master: 2, champion: 2 } as const;

export interface RankAiPolicy {
  /** RANK_AI_PROFILES 인덱스 */
  level: number;
  tier: PartyTier;
}

/**
 * 몬스터볼 P0·하 → 슈퍼볼 P1·중 → 하이퍼볼 P2·상 → 마스터볼 P3·상 → 챔피언 P4·상.
 * 연패 보정(경험치제만 — 마스터볼 이상은 연패 배율이 있다): 3연패 한 칸, 5연패 두 칸, 이후 연패마다 한 칸씩 내리되
 * 파티 등급을 먼저, 하등급에서도 남는 칸은 AI 단계에 쓴다(P0 아래로는 없음). 이기면 연패가 0이라 즉시 복구.
 */
export function resolveRankAiPolicy(state: RankState): RankAiPolicy {
  const { ball } = rankOf(state);
  let tier = BASE_TIER[ball];
  let level = { monster: 0, super: 1, hyper: 2, master: 3, champion: 4 }[ball];
  if (state.rating === null) {
    const n = state.lossStreak;
    const drop = n >= 5 ? n - 3 : n >= 3 ? 1 : 0;
    const tierDrop = Math.min(drop, tier);
    tier -= tierDrop;
    level = Math.max(0, level - (drop - tierDrop));
  }
  return { level, tier: TIERS[tier] };
}

const TIER_OF: Record<string, PartyTier> = tiersJson as Record<string, PartyTier>;

/** 등급에 맞는 상대를 고른다(직전 상대 제외). 등급 없는 새 샘플은 중등급, 후보가 비면 전체에서 */
export function pickRankOpponent<T extends { id: string }>(parties: T[], tier: PartyTier, prevId?: string, rng: () => number = Math.random): T {
  const others = parties.filter((p) => p.id !== prevId);
  const inTier = others.filter((p) => (TIER_OF[p.id] ?? "중") === tier);
  const pool = inTier.length ? inTier : others;
  return pool[Math.floor(rng() * pool.length)];
}
