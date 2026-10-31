import { rankOf, type RankState } from "../../battleRank";
import tiersJson from "../../../data/samplePartyTiers.json";
import { APP_DECISION_PARAMS, CHAMPION_DECISION_PARAMS } from "./aiClient";
import { DEFAULT_OPPONENT_MODEL, type DecisionParams } from "./decision";
import { buildRandomPartyFromSlots, PARTY_SIZE } from "../../randomSlotParty";
import type { SamplePartyPreset } from "../../../types/party";

/**
 * 랭크배틀 AI 정책(5.0 R3 S3) — 랭크·연패에서 "AI 단계(P0~P4)"와 "상대 샘플 파티 등급"만 정한다. 판단은 하지 않는다(설계·측정은 5.0-backlog.md R3).
 * 단계는 S2 측정(인접 직접 대전 승률 P1↔P0 68.8·P2↔P1 67.5·P3↔P2 64.8·P4↔P3 60.1%)으로 확정했다.
 * 마스터볼은 레이팅 4구간으로 나눠(5.0 R3 확장) 학습 메모리를 단계적으로 활용한다: 모델만(L5) → 앱 AI. 측정 L5↔L4 54.7%·앱 AI↔L5 53.2%,
 * 탐색 예산(8/16/24)은 강도 차이가 없어 구간은 학습 사용률 λ로만 가른다.
 */

/** 탐색·상대 모델·`*Aware`를 전부 끈 기반(측정의 c7) */
const OFF: Partial<DecisionParams> = {
  statusAware: false, setupAware: false, phase3Aware: false, a1Aware: false, a2Aware: false, trackMAware: false, tier2Aware: false,
  partyAware: false, oppSwitchAware: false, mySwitchAware: false,
};
const noisy = (rate: number, hardOverride?: boolean): Partial<DecisionParams> => ({ ...OFF, mistake: { rate, margin: 1e9, hardOverride } });

/** 상대 모델만(탐색 없음) — 마스터볼 4·3 */
const MODEL_ONLY: Partial<DecisionParams> = { opponentModel: DEFAULT_OPPONENT_MODEL };
/** 학습 사용률 λ를 붙인다 */
const learn = (params: Partial<DecisionParams>, use: number): Partial<DecisionParams> => ({ ...params, learn: { use } });
/** 모델이 없는 약한 단계도 습관을 쌓아 둔다(관측만 — 판단에는 쓰지 않아 측정한 강도는 그대로) */
const watch = (params: Partial<DecisionParams>): Partial<DecisionParams> => ({ ...params, learn: { use: 0, observe: true } });

/**
 * 인덱스 = 단계: 0~2 몬스터·슈퍼·하이퍼(관측만), 3~6 마스터볼 4·3·2·1(λ 0.25·0.5·0.75·1.0), 7 챔피언(앱 AI + 탐색 깊이 2, 6.3 G4 v0).
 * ponytail: 챔피언은 깊이 2 하나만 더한 v0(앱 AI 대비 약 55%) — 더 올리려면 학습된 가치 함수 등 별도 수단(`6.3-G4-챔피언AI-설계.md`)
 */
export const RANK_AI_PROFILES: Partial<DecisionParams>[] = [
  // 6.3 A2 — 인접 단계 직접 대전 승률이 위 단계 ≈ 60~62%가 되도록 위에서부터 하나씩 맞췄다(rank-sweep.mjs: P3 대 후보 → P2 대 후보 → P1 대 후보).
  // 앱 AI 대비 강도는 단계끼리 더해지지 않아(실수율 1.0은 앱 AI에겐 약해 보여도 실수율이 낮은 상대에겐 훨씬 약하다) 이웃끼리 직접 재야 한다. 이전 값(1 hard·0.7·0.3)은 P1/P0 77%·P3/P2 71%로 벌어졌다
  // (실수율: P0 0.5 확정 처치도 무시 · P1 0.4 · P2 0.12. 선출 포함 사다리 시드 300: P1/P0 62.2% · P2/P1 64.4% · P3/P2 64.8% · P6/P3 59.8%)
  watch(noisy(0.5, true)),
  watch(noisy(0.4)),
  watch(noisy(0.12)),
  learn(MODEL_ONLY, 0.25),
  learn(MODEL_ONLY, 0.5),
  learn(APP_DECISION_PARAMS, 0.75),
  APP_DECISION_PARAMS,
  CHAMPION_DECISION_PARAMS,
];

/** 최상 = 상등급 안에서도 상위(5.0 챔피언 전용 풀, 상등급 내부 라운드로빈 상위 5개 — 상 풀에도 포함된다) */
type PartyTier = "하" | "중" | "상" | "최상";
const TIERS: PartyTier[] = ["하", "중", "상", "최상"];
const BASE_TIER = { monster: 0, super: 1, hyper: 2, master: 2, champion: 3 } as const;
/** 최근 몇 판의 샘플 상대를 다시 만나지 않게 제외할지 — 챔피언은 풀(최상 5개)이 작아 2판 */
const RECENT_OPPONENTS = { default: 4, champion: 2 } as const;
/** 마스터볼 레이팅 구간 경계: 4 = ~1600 미만 · 3 = 1600~1900 · 2 = 1900~2200 · 1 = 2200~(챔피언 2500은 별도) → RANK_AI_PROFILES 3~6 */
const MASTER_BANDS = [1600, 1900, 2200];
const masterBand = (rating: number) => MASTER_BANDS.filter((edge) => rating >= edge).length;

/** 랭크 볼별 "랜덤 구축 상대" 확률 — 낮은 랭크일수록 랜덤 구축으로 다양하게, 높을수록 선별된 샘플 파티(5.0 R3 확장) */
const RANDOM_RATE = { monster: 1, super: 0.7, hyper: 0.5, master: 0.3, champion: 0.4 } as const;

interface RankAiPolicy {
  /** RANK_AI_PROFILES 인덱스 */
  level: number;
  tier: PartyTier;
  /** 상대를 샘플 대신 같은 등급 샘플 슬롯으로 랜덤 구축할 확률 */
  randomRate: number;
  /** 최근 몇 판의 샘플 상대를 제외할지 */
  recent: number;
}

/**
 * 몬스터볼 0·하 → 슈퍼볼 1·중 → 하이퍼볼 2·상 → 마스터볼 4~1(레이팅 구간) 3~6·상 → 챔피언 7·최상.
 * 연패 보정(경험치제만 — 마스터볼 이상은 연패 배율이 있다): 3연패 한 칸, 5연패 두 칸, 이후 연패마다 한 칸씩 내리되
 * 파티 등급을 먼저, 하등급에서도 남는 칸은 AI 단계에 쓴다(P0 아래로는 없음). 이기면 연패가 0이라 즉시 복구.
 */
export function resolveRankAiPolicy(state: RankState): RankAiPolicy {
  const { ball } = rankOf(state);
  let tier = BASE_TIER[ball];
  let level = ball === "master" ? 3 + masterBand(state.rating ?? 0) : { monster: 0, super: 1, hyper: 2, champion: 7 }[ball];
  if (state.rating === null) {
    const n = state.lossStreak;
    const drop = n >= 5 ? n - 3 : n >= 3 ? 1 : 0;
    const tierDrop = Math.min(drop, tier);
    tier -= tierDrop;
    level = Math.max(0, level - (drop - tierDrop));
  }
  return { level, tier: TIERS[tier], randomRate: RANDOM_RATE[ball], recent: RECENT_OPPONENTS[ball === "champion" ? "champion" : "default"] };
}

const TIER_OF: Record<string, PartyTier> = tiersJson as Record<string, PartyTier>;

const tierOf = (id: string): PartyTier => TIER_OF[id] ?? "중";
/** 상 풀은 최상 파티도 포함, 나머지는 같은 등급만 */
const inPool = (id: string, tier: PartyTier) => (tier === "상" ? tierOf(id) === "상" || tierOf(id) === "최상" : tierOf(id) === tier);

/**
 * 등급에 맞는 상대를 고른다. 확률 randomRate로 같은 등급 샘플의 슬롯만 모아 랜덤 구축(저장 슬롯 프리셋은 쓰지 않는다 — 등급이 유지된다),
 * 아니면 샘플 파티를 고르되 최근 상대(recentIds)는 제외. 등급 없는 새 샘플은 중등급. 최근 제외로 후보가 비면 제외를 풀고, 그 등급 파티가 아예 없으면 전체에서.
 * 랜덤 구축 상대의 id는 `random:<등급>`(이력 표시용).
 */
export function pickRankOpponent<T extends SamplePartyPreset>(
  parties: T[],
  tier: PartyTier,
  recentIds: readonly string[] = [],
  rng: () => number = Math.random,
  randomRate = 0,
): SamplePartyPreset {
  if (randomRate > 0 && rng() < randomRate) {
    const slots = parties.filter((p) => inPool(p.id, tier)).flatMap((p) => p.slots);
    const { slots: built } = buildRandomPartyFromSlots([], slots, rng);
    if (built.length === PARTY_SIZE) {
      return { id: `random:${tier}`, name: "랜덤 구축", style: "랜덤", group: "real", description: `${tier}등급 샘플 슬롯으로 무작위 구축`, slots: built };
    }
  }
  const inTier = parties.filter((p) => inPool(p.id, tier));
  const fresh = inTier.filter((p) => !recentIds.includes(p.id));
  const others = parties.filter((p) => !recentIds.includes(p.id));
  const pool = fresh.length ? fresh : inTier.length ? inTier : others.length ? others : parties;
  return pool[Math.floor(rng() * pool.length)];
}
