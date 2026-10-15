/**
 * 역산 후보 카드(3.6 I2) — 남은 후보 중 구체적인 (성격 묶음, 포인트) 조합을 몇 개 골라 카드로 보여 준다.
 * 후보는 수만 개라 전부 들고 있지 않고, 정렬 기준별로 상위 `CANDIDATE_LIMIT`개만 모은다.
 */

export interface CandidateCard {
  /** 성격 보정 묶음 이름(예: "방어↑·특방↓")과 그 묶음에 든 성격 */
  natureLabel: string;
  natureNames: string[];
  /** 이 후보의 포인트(관측이 쓰는 스탯만) */
  points: { label: string; value: number }[];
  /** 66 − 쓴 합계 — 나머지 스탯이 쓸 수 있는 최대 포인트 */
  spare: number;
  /** 관측 전체와 맞는 가능도(0~1) */
  likelihood: number;
  /** 관측이 하나이고 난수 16단계가 균등할 때 "일치 난수 k/16"의 k. 아니면 null */
  rollMatch: number | null;
  /** 관측마다 이 후보가 낼 수 있는 데미지 범위(맞는 쪽 최대 HP 대비 %) */
  damagePercent: { min: number; max: number }[];
  /** 관측한 데미지(%)와 후보 범위 중앙(%)의 차이를 관측마다 더한 값 — 작을수록 관측이 범위 한가운데에 가깝다(표시용 기준) */
  centerGap: number;
}

export interface CandidateLists {
  /** 남은 SP가 많은 순(투자가 적은 후보부터) */
  bySpare: CandidateCard[];
  /** 가능도가 높은 순 */
  byLikelihood: CandidateCard[];
  /** 관측이 후보의 데미지 범위 중앙에 가까운 순 */
  byCenter: CandidateCard[];
}

const CANDIDATE_LIMIT = 60;

export const TOTAL_POINTS = 66;

export type CandidateSort = "spare" | "likelihood" | "center";

interface Ranked<P> {
  spare: number;
  likelihood: number;
  gap: number;
  payload: P;
}

/** 정렬 기준에서 앞서는 항목만 `limit`개 남기는 목록. 동률이면 먼저 들어온 쪽이 앞이다 */
class TopList<P> {
  readonly items: Ranked<P>[] = [];
  private readonly limit: number;
  private readonly sort: CandidateSort;

  constructor(limit: number, sort: CandidateSort) {
    this.limit = limit;
    this.sort = sort;
  }

  /** (spare, likelihood, gap)가 b보다 앞서는가 — 기준마다 첫째·둘째·셋째 키가 다르다 */
  private before(spare: number, likelihood: number, gap: number, b: Ranked<P>): boolean {
    if (this.sort === "spare") return spare !== b.spare ? spare > b.spare : likelihood > b.likelihood;
    if (this.sort === "likelihood") return likelihood !== b.likelihood ? likelihood > b.likelihood : spare > b.spare;
    if (gap !== b.gap) return gap < b.gap;
    return likelihood !== b.likelihood ? likelihood > b.likelihood : spare > b.spare;
  }

  /** 들어갈 수 있는지 — 후보가 수만 개라 들어가지 못할 것은 payload를 만들기 전에 거른다 */
  accepts(spare: number, likelihood: number, gap: number): boolean {
    return this.items.length < this.limit || this.before(spare, likelihood, gap, this.items[this.items.length - 1]);
  }

  add(spare: number, likelihood: number, gap: number, payload: P): void {
    let i = this.items.length;
    while (i > 0 && this.before(spare, likelihood, gap, this.items[i - 1])) i--;
    this.items.splice(i, 0, { spare, likelihood, gap, payload });
    if (this.items.length > this.limit) this.items.pop();
  }
}

/** 세 정렬 기준의 상위 목록을 한 번에 채운다 */
export class TopLists<P> {
  readonly bySpare = new TopList<P>(CANDIDATE_LIMIT, "spare");
  readonly byLikelihood = new TopList<P>(CANDIDATE_LIMIT, "likelihood");
  readonly byCenter = new TopList<P>(CANDIDATE_LIMIT, "center");

  add(spare: number, likelihood: number, gap: number, payload: () => P): void {
    const lists = [this.bySpare, this.byLikelihood, this.byCenter].filter((l) => l.accepts(spare, likelihood, gap));
    if (lists.length === 0) return;
    const p = payload();
    for (const l of lists) l.add(spare, likelihood, gap, p);
  }

  /** 상위 목록의 항목을 카드로 바꾼다(같은 후보가 여러 목록에 들면 여러 번 만든다 — 최대 180장이라 가볍다) */
  toCards(build: (payload: P, spare: number, likelihood: number, gap: number) => CandidateCard): CandidateLists {
    const cards = (list: TopList<P>) => list.items.map((r) => build(r.payload, r.spare, r.likelihood, r.gap));
    return { bySpare: cards(this.bySpare), byLikelihood: cards(this.byLikelihood), byCenter: cards(this.byCenter) };
  }
}

/** 관측 하나일 때만 "일치 난수 k/16"을 말할 수 있다 — 16단계가 균등한(다단히트가 아닌) 난수에서만 */
export function rollMatchOf(likelihood: number, observations: number, rollCount: number, uniform: boolean): number | null {
  return observations === 1 && rollCount === 16 && uniform ? likelihood * 16 : null;
}
