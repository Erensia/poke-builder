/**
 * 대전 로그(BattleTurnLog)가 쓰는 순수 텍스트 데이터. JSX가 섞이지 않은 문자열/문구 생성
 * 함수만 모아 컴포넌트 파일에서 분리했다 — [[../lib/battleLogLabels]]가 라벨(명사)을 모으듯,
 * 이쪽은 문장(서술) 단위 텍스트를 모은다.
 */

import type { EndOfTurnLogEntry, FighterKey, TurnResult } from "../types/battle";
import type { StatusCondition } from "../types/status";
import { eunNeun } from "./josa";

/**
 * 날씨 기술의 성공/실패 문구를 기술별로 바꿔 쓸 때(key는 move.id). 없으면 공통 문구
 * ("날씨가 ○로 바뀌었다!" / "그러나 실패했다!")를 쓴다. 썰렁개그 문구는 사용자 제공.
 */
export const WEATHER_MOVE_LINES: Record<string, { set: string; fail: string }> = {
  썰렁개그: { set: "눈이 내리기 시작했다!", fail: "그러나 실패하고 말았다!" },
};

/** 차징 기술 1턴째(준비 턴) 전용 문구 — 공통 "준비 중!" 대신 기술별로 쓴다(§1 D-1). key는 move.id */
export const CHARGE_TURN_MESSAGE: Record<string, string> = {
  구멍파기: " 땅을 파기 시작했다!",
  메테오빔: " 우주의 힘을 모으기 시작했다!",
  일렉트로빔: " 전기를 모았다!",
  공중날기: " 하늘 높이 날아올랐다!",
  뛰어오르기: " 하늘 높이 뛰어올랐다!",
  다이빙: " 물속 깊이 가라앉았다!",
};

/** 랭크 상승폭 → 본가식 수식어. 1랭크는 수식어 없음, 2랭크 "크게", 3랭크 이상 "아주 크게" */
export function stageRiseAdverb(delta: number): string {
  if (delta >= 3) return "아주 크게 ";
  if (delta === 2) return "크게 ";
  return "";
}

/**
 * 상태이상 3단계 문구(사용자 확정 텍스트): 걸렸을 때(onset) → 매턴 효과가 발동했을 때(trigger,
 * 독/맹독/화상은 데미지 틱, 마비/잠듦/얼음은 이번 턴 행동이 막혔다는 뜻) → 해제됐을 때(cure).
 * "의"/"을" 같은 상태이상 이름 쪽 조사는 고정이라 그대로 박아뒀고, 포켓몬 이름 쪽만 eunNeun으로 판별한다.
 */
export const STATUS_ONSET_TEXT: Record<StatusCondition, (name: string) => string> = {
  poison: (name) => `${name}의 몸에 독이 퍼졌다!`,
  "badly-poisoned": (name) => `${name}의 몸에 맹독이 퍼졌다!`,
  burn: (name) => `${name}${eunNeun(name)} 화상을 입었다!`,
  paralysis: (name) => `${name}${eunNeun(name)} 마비되어 기술이 나오기 어려워졌다!`,
  sleep: (name) => `${name}${eunNeun(name)} 잠들어 버렸다!`,
  freeze: (name) => `${name}${eunNeun(name)} 얼어붙었다!`,
};

export const STATUS_TRIGGER_TEXT: Record<StatusCondition, (name: string) => string> = {
  poison: (name) => `${name}${eunNeun(name)} 독에 의한 데미지를 입었다!`,
  "badly-poisoned": (name) => `${name}${eunNeun(name)} 맹독에 의한 데미지를 입었다!`,
  burn: (name) => `${name}${eunNeun(name)} 화상 데미지를 입었다!`,
  paralysis: (name) => `${name}${eunNeun(name)} 몸이 저려서 움직일 수 없다!`,
  sleep: (name) => `${name}${eunNeun(name)} 쿨쿨 잠들어 있다.`,
  freeze: (name) => `${name}${eunNeun(name)} 얼어 버려서 움직일 수 없다!`,
};

export const STATUS_CURE_TEXT: Record<StatusCondition, (name: string) => string> = {
  poison: (name) => `${name}의 독이 나았다!`,
  "badly-poisoned": (name) => `${name}의 맹독이 나았다!`,
  burn: (name) => `${name}의 화상이 나았다!`,
  paralysis: (name) => `${name}의 몸저림이 풀렸다!`,
  sleep: (name) => `${name}${eunNeun(name)} 눈을 떴다!`,
  freeze: (name) => `${name}의 얼음이 녹았다!`,
};

const HP_AMOUNT_KEYS = [
  "damage", "remainingHp", "fieldHeal", "itemHeal", "abilityWeatherHeal", "regenHeal", "leechSeedDamage",
  "leechSeedHealAmount", "wishHeal", "berryHeal", "poisonHealAmount", "abilityWeatherDamage", "cheekPouchHeal",
] as const;

/**
 * AI 상대의 턴 종료 줄: HP 수치(데미지·회복량·남은 HP)를 최대 HP 대비 "x.x%" 문자열로 바꿔 최대 HP·실수치를
 * 역산하지 못하게 한다. 렌더 쪽은 `{e.damage}` 식으로 그대로 찍으므로 숫자 자리에 문자열을 넣으면 되고, 분기에
 * 쓰는 truthiness를 지키려고 0·undefined는 그대로 둔다(remainingHp만 0도 "0.0%"로).
 * 최대 HP를 모르면(파티 인덱스 밖) 원본 그대로.
 */
export function hpAsPercent(e: EndOfTurnLogEntry, maxHp: number | undefined): EndOfTurnLogEntry {
  if (!maxHp) return e;
  const out: Record<string, unknown> = { ...e };
  for (const k of HP_AMOUNT_KEYS) {
    const v = e[k];
    if (typeof v === "number" && (v || k === "remainingHp")) out[k] = `${((v / maxHp) * 100).toFixed(1)}%`;
  }
  return out as unknown as EndOfTurnLogEntry;
}

/**
 * 로그에는 종 id뿐이라 같은 종이 둘인 파티에서 개체를 가르지 못한다. 교체 기록(switches)을 따라가며 한 편의
 * 활성 파티 인덱스를 되짚는다(대전은 항상 0번 리드로 시작, partyIds는 그 편 파티의 종 id). 턴마다 행동 시점의
 * 인덱스와 턴 끝 인덱스. 행동 전 교체는 턴 시작에 반영하고, 행동 도중 교체(유턴류·강제 교체·탈출버튼 등 — 누가
 * 일으켰는지 필드로는 안 가려진다)는 행동에 찍힌 종이 맞는 후보를 앞에서부터 고른다.
 * ponytail: 행동 도중 교체 전후가 같은 종이면 앞의 것으로 본다(그 한 행동의 최대 HP만 틀릴 수 있다).
 */
export function activeIndexTrace(log: TurnResult[], side: FighterKey, partyIds: readonly string[]): { actions: number[]; end: number }[] {
  let idx = 0;
  return log.map((turn) => {
    for (const sw of turn.switches) if (sw.side === side && !sw.afterMove) idx = sw.toIndex;
    const chain = [idx, ...turn.switches.filter((sw) => sw.side === side && sw.afterMove).map((sw) => sw.toIndex)];
    let p = 0;
    const actions = turn.actions.map((a) => {
      const id = a.actor === side ? a.actorPokemonId : a.defenderPokemonId;
      const hit = chain.findIndex((c, k) => k >= p && partyIds[c] === id);
      if (hit >= 0) p = hit;
      return chain[p];
    });
    idx = chain[chain.length - 1];
    return { actions, end: idx };
  });
}

/** 승리 문구용 편 이름 — 활성 포켓몬 이름을 쓰면 쓰러진 포켓몬이 승리자처럼 보인다(편에 예비가 남아 이긴 경우). a=내 파티·b=상대 파티 고정 축 */
export const SIDE_NAME = { a: "내 파티", b: "상대 파티" } as const;
