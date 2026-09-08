/**
 * 한국어 조사 자동 판별. 이름 마지막 글자의 받침(종성) 유무로 조사를 고른다.
 * 한글이 아닌 글자로 끝나면(영문·숫자 등) 받침 없음으로 취급한다.
 */

function jongseong(name: string): number {
  const lastChar = name.at(-1);
  if (!lastChar) return -1;
  const code = lastChar.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return -1;
  return code % 28;
}

/** 은 / 는 */
export function eunNeun(name: string): "은" | "는" {
  const j = jongseong(name);
  return j > 0 ? "은" : "는";
}

/** 이 / 가 */
export function iGa(name: string): "이" | "가" {
  const j = jongseong(name);
  return j > 0 ? "이" : "가";
}

/** 을 / 를 */
export function eulReul(name: string): "을" | "를" {
  const j = jongseong(name);
  return j > 0 ? "을" : "를";
}

/** 와 / 과 */
export function waGwa(name: string): "와" | "과" {
  const j = jongseong(name);
  return j > 0 ? "과" : "와";
}

/** 로 / 으로 — 받침 없음 또는 ㄹ 받침(종성 8)이면 "로", 그 외 자음이면 "으로" */
export function roEuro(name: string): "로" | "으로" {
  const j = jongseong(name);
  return j <= 0 || j === 8 ? "로" : "으로";
}
