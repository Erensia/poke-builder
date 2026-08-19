import type { PokemonType } from "../types/pokemon-type";

/** 타입 배지에 쓰는 색상. 라이트/다크 공용으로 쓸 수 있게 채도를 중간값으로 맞췄다. */
export const TYPE_COLORS: Record<PokemonType, string> = {
  노말: "#9a9382",
  불꽃: "#e2703a",
  물: "#4f8fd9",
  풀: "#5fa851",
  전기: "#d9b022",
  얼음: "#6cc2c2",
  격투: "#c1503d",
  독: "#9754ad",
  땅: "#c19a52",
  비행: "#8ba0e0",
  에스퍼: "#e26a95",
  벌레: "#9bb32e",
  바위: "#b39c5c",
  고스트: "#6f61ae",
  드래곤: "#6f5ce0",
  악: "#5f5648",
  강철: "#8b98a8",
  페어리: "#e08fbb",
};
