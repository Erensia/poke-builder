/**
 * 대전 로그(BattleTurnLog)가 쓰는 순수 텍스트 데이터. JSX가 섞이지 않은 문자열/문구 생성
 * 함수만 모아 컴포넌트 파일에서 분리했다 — [[../lib/battleLogLabels]]가 라벨(명사)을 모으듯,
 * 이쪽은 문장(서술) 단위 텍스트를 모은다.
 */

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
  일렉트로빔: " 전기를 모으기 시작했다!",
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
