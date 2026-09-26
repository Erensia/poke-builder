import { type FighterKey } from "@/types/battle";
import { opponentKey, sideOf, type BattleState } from "../state";
import { chainParams, type DecisionParams } from "./decision";
import { paramsFor, type AiDifficulty } from "./difficulty";
import { createPartyModel, partyMatchValue } from "./partyEval";
import { withEndOfTurnModel } from "./turnRates";

/**
 * 3선출 AI(ver.1.8 로드맵 7, 결정 레이어 §4-13): 팀 프리뷰처럼 상대 빌드 전체는 알고 상대 선출은 모르는 상태에서, 내 선출
 * 조합 × 선봉마다 상대의 모든 조합 × 선봉과 붙여 본 대전 시작 판세(파티 단위 평가 — 6×6 대면표 한 번 + 이어지는 대면)를
 * 평균과 최악을 섞어 점수로 삼고, 상위권에서 소프트맥스로 고른다(쉬움은 폭을 넓게).
 */

export interface TeamSelectOptions {
  difficulty?: AiDifficulty;
  decisionParams?: Partial<DecisionParams>;
  random?: () => number;
  /** 선출 인원(기본 3) */
  size?: number;
}

/** 평균·최악 섞는 비율(평균 쪽) */
const MEAN_WEIGHT = 0.5;
/** 선출 소프트맥스 온도 — 어려움은 거의 최선, 쉬움은 넓게 */
const SELECT_TEMPERATURE: Record<AiDifficulty, number> = { hard: 0.05, easy: 0.3 };

function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < n; i++) {
      acc.push(i);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

interface Candidate {
  members: number[];
  lead: number;
}

function candidatesOf(n: number, size: number): Candidate[] {
  return combinations(n, Math.min(size, n)).flatMap((members) => members.map((lead) => ({ members, lead })));
}

function hpFor(n: number, members: number[]): number[] {
  return Array.from({ length: n }, (_, i) => (members.includes(i) ? 1 : 0));
}

/** 선출 순서(선봉 먼저, 나머지는 빌드 순서) */
function orderOf(candidate: Candidate): number[] {
  return [candidate.lead, ...candidate.members.filter((i) => i !== candidate.lead)];
}

/** key 편 AI의 선출(파티 인덱스, 선봉 먼저). state는 양쪽 빌드 전체로 만든 배틀 상태 */
export function chooseAiSelection(state: BattleState, key: FighterKey, options: TeamSelectOptions = {}): number[] {
  const size = options.size ?? 3;
  const difficulty = options.difficulty ?? "hard";
  const params = paramsFor(difficulty, options.decisionParams);
  const myCount = sideOf(state, key).party.length;
  const oppCount = sideOf(state, opponentKey(key)).party.length;
  const mine = candidatesOf(myCount, size);
  if (mine.length <= 1) return mine.length ? orderOf(mine[0]) : [];
  const theirs = candidatesOf(oppCount, size);
  // 상대 자발적 교체 갈래는 끈다 — 3600판 가까운 대전을 한 번에 재야 해서 켜면 약 4초, 끄면 약 1초(선출 판단엔 근사로 충분)
  const chain = { ...chainParams(params), oppSwitch: undefined };
  const scored = withEndOfTurnModel(params.endOfTurnAware, () => {
    const model = createPartyModel(state, key);
    return mine.map((candidate) => {
      const myHp = hpFor(myCount, candidate.members);
      let sum = 0;
      let worst = Infinity;
      for (const opp of theirs) {
        const value = partyMatchValue(model, myHp, hpFor(oppCount, opp.members), candidate.lead, opp.lead, chain);
        sum += value;
        worst = Math.min(worst, value);
      }
      return { candidate, score: MEAN_WEIGHT * (sum / theirs.length) + (1 - MEAN_WEIGHT) * worst };
    });
  });
  const best = Math.max(...scored.map((s) => s.score));
  const temperature = SELECT_TEMPERATURE[difficulty];
  const weights = scored.map((s) => Math.exp((s.score - best) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = (options.random ?? Math.random)() * total;
  for (let i = 0; i < scored.length; i++) {
    r -= weights[i];
    if (r <= 0) return orderOf(scored[i].candidate);
  }
  return orderOf(scored[scored.length - 1].candidate);
}
