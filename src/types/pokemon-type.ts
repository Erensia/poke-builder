// 포켓몬 챔피언스 18타입. 데이터에는 이 한글 명칭을 그대로 저장한다.
export const POKEMON_TYPES = [
  "노말",
  "불꽃",
  "물",
  "풀",
  "전기",
  "얼음",
  "격투",
  "독",
  "땅",
  "비행",
  "에스퍼",
  "벌레",
  "바위",
  "고스트",
  "드래곤",
  "악",
  "강철",
  "페어리",
] as const;

export type PokemonType = (typeof POKEMON_TYPES)[number];

/** 화면 표시용 라벨. 데이터는 "불꽃"만 저장하고, 표시할 때만 "불꽃타입"으로 이어붙인다. */
export function typeLabel(type: PokemonType): string {
  return `${type}타입`;
}
