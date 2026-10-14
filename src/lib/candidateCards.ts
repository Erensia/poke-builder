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
}

export interface CandidateLists {
  /** 남은 SP가 많은 순(투자가 적은 후보부터) */
  bySpare: CandidateCard[];
  /** 가능도가 높은 순 */
  byLikelihood: CandidateCard[];
}

export const CANDIDATE_LIMIT = 60;

export const TOTAL_POINTS = 66;

interface Ranked<P> {
  spare: number;
  likelihood: number;
  payload: P;
}

/** 정렬 기준에서 앞서는 항목만 `limit`개 남기는 목록. 동률이면 먼저 들어온 쪽이 앞이다 */
export class TopList<P> {
  readonly items: Ranked<P>[] = [];
  private readonly limit: number;
  private readonly byLikelihood: boolean;

  constructor(limit: number, byLikelihood: boolean) {
    this.limit = limit;
    this.byLikelihood = byLikelihood;
  }

  private before(aSpare: number, aLikelihood: number, b: Ranked<P>): boolean {
    return this.byLikelihood
      ? aLikelihood > b.likelihood || (aLikelihood === b.likelihood && aSpare > b.spare)
      : aSpare > b.spare || (aSpare === b.spare && aLikelihood > b.likelihood);
  }

  /** 들어갈 수 있는지 — 후보가 수만 개라 들어가지 못할 것은 payload를 만들기 전에 거른다 */
  accepts(spare: number, likelihood: number): boolean {
    return this.items.length < this.limit || this.before(spare, likelihood, this.items[this.items.length - 1]);
  }

  add(spare: number, likelihood: number, payload: P): void {
    let i = this.items.length;
    while (i > 0 && this.before(spare, likelihood, this.items[i - 1])) i--;
    this.items.splice(i, 0, { spare, likelihood, payload });
    if (this.items.length > this.limit) this.items.pop();
  }
}

/** 두 정렬 기준의 상위 목록을 한 번에 채운다 */
export class TopLists<P> {
  readonly bySpare = new TopList<P>(CANDIDATE_LIMIT, false);
  readonly byLikelihood = new TopList<P>(CANDIDATE_LIMIT, true);

  add(spare: number, likelihood: number, payload: () => P): void {
    const a = this.bySpare.accepts(spare, likelihood);
    const b = this.byLikelihood.accepts(spare, likelihood);
    if (!a && !b) return;
    const p = payload();
    if (a) this.bySpare.add(spare, likelihood, p);
    if (b) this.byLikelihood.add(spare, likelihood, p);
  }

  /** 상위 목록의 항목을 카드로 바꾼다(같은 후보가 두 목록에 들면 두 번 만든다 — 최대 120장이라 가볍다) */
  toCards(build: (payload: P, spare: number, likelihood: number) => CandidateCard): CandidateLists {
    const cards = (list: TopList<P>) => list.items.map((r) => build(r.payload, r.spare, r.likelihood));
    return { bySpare: cards(this.bySpare), byLikelihood: cards(this.byLikelihood) };
  }
}

/** 관측 하나일 때만 "일치 난수 k/16"을 말할 수 있다 — 16단계가 균등한(다단히트가 아닌) 난수에서만 */
export function rollMatchOf(likelihood: number, observations: number, rollCount: number, uniform: boolean): number | null {
  return observations === 1 && rollCount === 16 && uniform ? likelihood * 16 : null;
}
