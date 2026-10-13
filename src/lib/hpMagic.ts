/**
 * 포인트 분배용 HP "최적 수치" 판정(3.4 H1). 포챔스 HP 실수치 = 종족값 + 75 + 포인트(레벨 50·개체값 31 고정)이고,
 * 스텔스록·독·먹다남은음식 같은 HP 비율 효과는 나눗셈 버림이라 특정 나머지에서 같은 효과를 더 높은 HP로 받는다.
 * 16n+15는 8n+7·4n+3·홀수를 모두 포함하므로 사슬(chain)로 두고, 생명의구슬 10n+9는 따로 본다.
 */

export interface HpRule {
  label: string;
  mod: number;
  rem: number;
  /** 이 나머지일 때 득을 보는 효과 */
  effects: string;
}

/** 강한 조건 순 — HP가 만족하는 규칙 수가 곧 등급(4 = 16n+15) */
export const HP_CHAIN: HpRule[] = [
  { label: "16n+15", mod: 16, rem: 15, effects: "스텔스록(반감)·화상·모래바람·맹독·먹다남은음식" },
  { label: "8n+7", mod: 8, rem: 7, effects: "스텔스록(등배)·독·씨뿌리기" },
  { label: "4n+3", mod: 4, rem: 3, effects: "스텔스록(약점 2배)·자뭉열매·대타출동(4n은 피하기)" },
  { label: "홀수", mod: 2, rem: 1, effects: "스텔스록(약점 4배)" },
];

export const HP_ORB_RULE: HpRule = { label: "10n+9", mod: 10, rem: 9, effects: "생명의구슬 반동" };

export interface HpMark {
  points: number;
  hp: number;
  /** 만족하는 사슬 규칙(강한 순) — 길이가 등급 */
  chain: HpRule[];
  orb: boolean;
}

const matches = (hp: number, r: HpRule) => hp % r.mod === r.rem;

/** 포인트 0~maxPoints 중 HP가 최적 조건을 하나라도 만족하는 지점들. HP 식은 statCalculator.computeRealStats와 같다 */
export function hpMarks(baseHp: number, maxPoints: number): HpMark[] {
  return Array.from({ length: maxPoints + 1 }, (_, points) => {
    const hp = baseHp + 75 + points;
    return { points, hp, chain: HP_CHAIN.filter((r) => matches(hp, r)), orb: matches(hp, HP_ORB_RULE) };
  }).filter((m) => m.chain.length > 0 || m.orb);
}

export interface MarkInfoRow {
  label: string;
  effects: string;
  /** 슬롯의 도구·기술에 해당하는 조건 */
  relevant: boolean;
}

/** 눈금 설명(호버·클릭 공통): 머리글 + 만족하는 조건 목록 */
export interface MarkInfo {
  header: string;
  rows: MarkInfoRow[];
}

export function hpMarkInfo(m: HpMark, relevant: ReadonlySet<string>): MarkInfo {
  const rules = m.orb ? [...m.chain, HP_ORB_RULE] : m.chain;
  return {
    header: `HP ${m.hp} (${m.points}포인트)`,
    rows: rules.map((r) => ({ label: r.label, effects: r.effects, relevant: relevant.has(r.label) })),
  };
}

/** 이 슬롯의 도구·기술이 득을 보는 조건 라벨들 — 먹다남은음식 16n+15, 자뭉열매·대타출동 4n+3, 생명의구슬 10n+9 */
export function relevantHpRules(itemId: string | null | undefined, moveIds: readonly (string | null)[] = []): Set<string> {
  const out = new Set<string>();
  if (itemId === "먹다남은음식") out.add("16n+15");
  if (itemId === "자뭉열매" || moveIds.includes("대타출동")) out.add("4n+3");
  if (itemId === "생명의구슬") out.add(HP_ORB_RULE.label);
  return out;
}
