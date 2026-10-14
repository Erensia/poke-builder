/**
 * 포인트 분배용 HP "최적 수치" 판정(3.4 H1). 포챔스 HP 실수치 = 종족값 + 75 + 포인트(레벨 50·개체값 31 고정)이고,
 * 스텔스록·독·먹다남은음식 같은 HP 비율 효과는 나눗셈 버림이라 특정 나머지에서 같은 효과를 더 높은 HP로 받는다.
 * 16n+15는 8n+7·4n+3·홀수를 모두 포함하므로 사슬(chain)로 두고, 생명의구슬 10n+9는 따로 본다.
 */

import { getEffectiveness } from "./typeEffectiveness";
import type { PokemonType } from "../types/pokemon-type";

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
  { label: "홀수", mod: 2, rem: 1, effects: "스텔스록(약점 4배)·배북·철제광선·저주(고스트)" },
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

/**
 * 눈금을 강조할지 — 필요한 사슬 규칙 중 가장 강한 것(16n+15 > 8n+7 > 4n+3 > 홀수)을 만족하거나, 구슬이 필요하고 10n+9일 때.
 * 약한 규칙까지 "하나라도"로 보면 항상 붙는 스텔스록(8n+7 등)이 먹다남은음식의 16n+15를 묻어 버린다.
 */
export function isRelevantMark(m: HpMark, relevant: ReadonlySet<string>): boolean {
  const need = HP_CHAIN.find((r) => relevant.has(r.label));
  return (!!need && m.chain.includes(need)) || (m.orb && relevant.has(HP_ORB_RULE.label));
}

/** 스텔스록 등장 데미지는 ⌊HP × 바위 상성 / 8⌋ — 배율별로 득을 보는 조건(0.25배는 ⌊HP/32⌋라 가장 가까운 16n+15로 본다) */
function stealthRockRule(types: readonly PokemonType[]): string {
  const eff = getEffectiveness("바위", [...types]);
  return eff >= 4 ? "홀수" : eff >= 2 ? "4n+3" : eff >= 1 ? "8n+7" : "16n+15";
}

/** HP를 ⌊HP/2⌋ 깎는 기술 — 홀수일 때 같은 소모로 HP가 더 높다. 저주는 고스트 타입이 쓸 때만 HP를 깎는다 */
function halvesOwnHp(moveId: string | null, types: readonly PokemonType[]): boolean {
  return moveId === "배북" || moveId === "철제광선" || (moveId === "저주" && types.includes("고스트"));
}

/**
 * 이 슬롯이 득을 보는 조건 라벨들 — 먹다남은음식 16n+15, 자뭉열매·대타출동 4n+3, 생명의구슬 10n+9,
 * 배북·철제광선·저주(고스트) 홀수, 스텔스록은 타입(교체 등장 시점이라 메가 전 타입)의 바위 상성 배율에 따라
 */
export function relevantHpRules(
  itemId: string | null | undefined,
  moveIds: readonly (string | null)[] = [],
  types: readonly PokemonType[] = [],
): Set<string> {
  const out = new Set<string>();
  if (itemId === "먹다남은음식") out.add("16n+15");
  if (itemId === "자뭉열매" || moveIds.includes("대타출동")) out.add("4n+3");
  if (itemId === "생명의구슬") out.add(HP_ORB_RULE.label);
  if (moveIds.some((id) => halvesOwnHp(id, types))) out.add("홀수");
  if (types.length > 0) out.add(stealthRockRule(types));
  return out;
}
