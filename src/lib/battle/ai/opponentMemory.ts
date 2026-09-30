import type { LevelOneDistribution } from "./levelOne";

/**
 * 상대(사용자) 패턴 학습(ver.2.0 1-C, `2.0-backlog.md` "1단계 계획" 1-C): 1-B 한 단계 추론이 낸 상대 행동 분포를, 그 상대가 실제로
 * 고른 행동으로 보정한다. 원본 로그가 아니라 "예측 합 vs 실제 횟수" 집계만 들고 다니고(대전 간 누적 — 대전이 끝날 때마다 × 0.99, 최근 약
 * 100판), 보정 배율 = (실제 + 사전 × 사전 강도) / (예측 + 사전 강도).
 *
 * - 교체: 사전값 0.15 — 공통 공식의 교체 확률은 실제보다 크다(1-B 1·2차 벤치). 기록이 없으면 예측의 15%만 믿어 교체 읽기가 거의 안 켜지고,
 *   실제로 교체를 보여 준 상대에게만 커진다.
 * - 변화기: 사전값 1(중립) — 예측보다 변화기를 자주 쓰면 올리고 덜 쓰면 내린다.
 * - 포켓몬별 기술: 그 종으로 실제로 쓴 기술 / 예측(사전값 1, 강도 약하게) — "이 사용자의 한카리아스는 칼춤을 자주" 같은 습관.
 */
export interface OpponentMemory {
  version: 1;
  /** 누적 대전 수(× 0.99 감쇠 반영 전 정수 — 화면 표시용) */
  battles: number;
  /** 관측한 결정 수(감쇠 반영) */
  decisions: number;
  switchActual: number;
  switchPred: number;
  statusActual: number;
  statusPred: number;
  /** 종 id → 기술 id → 실제·예측 */
  species: Record<string, { seen: number; lastBattle: number; moves: Record<string, { actual: number; pred: number }> }>;
}

export const MEMORY_DECAY_PER_BATTLE = 0.99;
const SWITCH_PRIOR = 0.15;
const SWITCH_PRIOR_STRENGTH = 10;
const STATUS_PRIOR_STRENGTH = 10;
const MOVE_PRIOR_STRENGTH = 2;
/** 포켓몬별 기록 상한(가장 오래 안 쓴 종부터 버림) — 저장 크기 상한 */
const MAX_SPECIES = 100;
/** 교체 확률 상한 — 보정 배율이 커져도 "무조건 교체"로 보지는 않는다 */
const MAX_SWITCH_PROB = 0.9;

export function emptyOpponentMemory(): OpponentMemory {
  return { version: 1, battles: 0, decisions: 0, switchActual: 0, switchPred: 0, statusActual: 0, statusPred: 0, species: {} };
}

/** 관측 한 번에 필요한 것: 그 순간의 원래(보정 전) 추론 분포와 상대가 실제로 고른 행동 */
export interface OpponentObservation {
  dist: LevelOneDistribution;
  speciesId: string;
  action: { kind: "switch" } | { kind: "move"; moveId: string; isStatus: boolean };
  /** 분포 안 기술 id → 변화기 여부 */
  statusMoveIds: ReadonlySet<string>;
}

/** 관측을 memory에 더한다(제자리 수정). 대전 중에는 세션용 memory에, 대전이 끝나면 commitBattle로 누적본에 합친다 */
export function observeOpponent(memory: OpponentMemory, obs: OpponentObservation): void {
  const { dist, action } = obs;
  const stay = 1 - dist.switchProb;
  memory.decisions += 1;
  memory.switchPred += dist.switchProb;
  if (action.kind === "switch") memory.switchActual += 1;
  let statusPred = 0;
  for (const [id, w] of dist.moveWeights) if (obs.statusMoveIds.has(id)) statusPred += stay * w;
  memory.statusPred += statusPred;
  if (action.kind === "move" && action.isStatus) memory.statusActual += 1;
  if (action.kind !== "move") return;
  const sp = (memory.species[obs.speciesId] ??= { seen: 0, lastBattle: memory.battles, moves: {} });
  sp.seen += 1;
  sp.lastBattle = memory.battles;
  for (const [id, w] of dist.moveWeights) {
    const m = (sp.moves[id] ??= { actual: 0, pred: 0 });
    m.pred += w;
  }
  (sp.moves[action.moveId] ??= { actual: 0, pred: 0 }).actual += 1;
}

/** a × decay + b(새 객체). 종 기록은 MAX_SPECIES개까지(가장 오래 안 쓴 종부터 버림) */
function addMemory(a: OpponentMemory, b: OpponentMemory, decay: number, battles: number): OpponentMemory {
  const out: OpponentMemory = {
    version: 1,
    battles,
    decisions: a.decisions * decay + b.decisions,
    switchActual: a.switchActual * decay + b.switchActual,
    switchPred: a.switchPred * decay + b.switchPred,
    statusActual: a.statusActual * decay + b.statusActual,
    statusPred: a.statusPred * decay + b.statusPred,
    species: {},
  };
  for (const id of new Set([...Object.keys(a.species), ...Object.keys(b.species)])) {
    const x = a.species[id];
    const y = b.species[id];
    const moves: Record<string, { actual: number; pred: number }> = {};
    for (const [mid, m] of Object.entries(x?.moves ?? {})) moves[mid] = { actual: m.actual * decay, pred: m.pred * decay };
    for (const [mid, m] of Object.entries(y?.moves ?? {})) {
      const cur = (moves[mid] ??= { actual: 0, pred: 0 });
      cur.actual += m.actual;
      cur.pred += m.pred;
    }
    out.species[id] = { seen: (x?.seen ?? 0) * decay + (y?.seen ?? 0), lastBattle: y ? battles : (x?.lastBattle ?? 0), moves };
  }
  const entries = Object.entries(out.species);
  if (entries.length > MAX_SPECIES) {
    entries.sort((p, q) => q[1].lastBattle - p[1].lastBattle);
    out.species = Object.fromEntries(entries.slice(0, MAX_SPECIES));
  }
  return out;
}

/** 대전이 끝나면: 누적본을 × 0.99로 감쇠한 뒤 이번 대전(세션)을 더한다(새 객체) */
export function commitBattle(saved: OpponentMemory, session: OpponentMemory): OpponentMemory {
  return addMemory(saved, session, MEMORY_DECAY_PER_BATTLE, saved.battles + 1);
}

/** 누적본 + 이번 대전 세션(감쇠 없이) — 대전 중 보정에 쓴다 */
export function combinedMemory(saved: OpponentMemory, session: OpponentMemory): OpponentMemory {
  return addMemory(saved, session, 1, saved.battles);
}

/** 보정 배율들(화면 요약에도 쓴다) */
export function memoryFactors(memory: OpponentMemory): { switchFactor: number; statusFactor: number } {
  return {
    switchFactor: (memory.switchActual + SWITCH_PRIOR * SWITCH_PRIOR_STRENGTH) / (memory.switchPred + SWITCH_PRIOR_STRENGTH),
    statusFactor: (memory.statusActual + STATUS_PRIOR_STRENGTH) / (memory.statusPred + STATUS_PRIOR_STRENGTH),
  };
}

/**
 * 추론 분포를 학습값으로 보정한다: 교체 확률 × 교체 배율(상한 0.9), 변화기 확률 × 변화기 배율, 그 종의 기술별 배율 — 기술 쪽은 다시 합 1.
 */
export function calibrateDistribution(
  dist: LevelOneDistribution,
  memory: OpponentMemory,
  speciesId: string,
  statusMoveIds: ReadonlySet<string>,
): LevelOneDistribution {
  const { switchFactor, statusFactor } = memoryFactors(memory);
  const sp = memory.species[speciesId];
  const weights = new Map<string, number>();
  let total = 0;
  for (const [id, w] of dist.moveWeights) {
    const m = sp?.moves[id];
    // 그 종으로 이 기술을 실제로 쓴 횟수 / 예측 합(사전: 예측대로 MOVE_PRIOR_STRENGTH번 쓴 셈)
    const moveFactor = m ? (m.actual + MOVE_PRIOR_STRENGTH) / (m.pred + MOVE_PRIOR_STRENGTH) : 1;
    const v = w * (statusMoveIds.has(id) ? statusFactor : 1) * moveFactor;
    weights.set(id, v);
    total += v;
  }
  if (total > 0) for (const [id, v] of weights) weights.set(id, v / total);
  const switchProb = dist.switches.length > 0 ? Math.min(MAX_SWITCH_PROB, dist.switchProb * switchFactor) : 0;
  return { ...dist, moveWeights: total > 0 ? weights : dist.moveWeights, switchProb };
}

/** 저장본 형태 검증(localStorage 손상 대비) */
export function isOpponentMemory(value: unknown): value is OpponentMemory {
  const v = value as OpponentMemory;
  return !!v && typeof v === "object" && v.version === 1 && typeof v.battles === "number" && typeof v.species === "object" && v.species !== null;
}
