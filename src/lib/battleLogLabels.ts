/**
 * 대전 로그 표시 라벨. 실시간 배틀판(BattleLogPage의 상태 태그)과 턴 히스토리(BattleTurnLog·
 * 배틀비디오 다시보기)가 똑같이 참조해야 해서 두 쪽 다 임포트할 수 있는 공유 위치에 둔다.
 */

/** 지속효과(volatile) 표시 라벨. */
export const VOLATILE_LABELS = {
  flinch: "풀죽음",
  recharge: "반동",
  confusion: "혼란",
  drowsy: "졸음",
  wish: "희망사항",
  ingrain: "뿌리박기",
  aquaRing: "아쿠아링",
  leechSeed: "씨앗",
  taunt: "도발",
  disable: "사슬묶기",
  encore: "앙코르",
  attract: "헤롱헤롱",
  bound: "속박",
  saltCure: "소금절이",
  syrupCoat: "물엿범벅",
  octolock: "문어굳히기",
  jawLock: "물고버티기",
} as const;

/** 리플렉터(물리 반감)/빛의장막(특수 반감)/오로라베일(양쪽 반감) 표시 라벨. */
export const SCREEN_LABELS = { reflect: "리플렉터", lightScreen: "빛의장막", auroraVeil: "오로라베일" } as const;
