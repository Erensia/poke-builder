import type { FighterKey, TurnResult } from "../lib/battleSimulator";

/**
 * 배틀타워 대전이 끝날 때 저장하는 "배틀비디오"(§6) — 그 시점의 턴별 로그를 그대로 담는다.
 * 포켓몬 UI(스프라이트·게이지)는 없이 BattleTurnLog로 텍스트만 다시 보여주면 충분하다는 게
 * 백로그 결정 — 그래서 저장 데이터도 화면을 다시 그리는 데 필요한 최소값(log)만 있으면 된다.
 */
export interface BattleVideo {
  id: string;
  /** Date.now() 기준 저장 시각. 목록 정렬(최근 저장 순)과 표시용 */
  savedAt: number;
  /** 대전 종료 시점 양쪽 활성 포켓몬 이름 — 목록 카드 제목에 "OO vs OO"로 보여준다 */
  labelA: string;
  labelB: string;
  winner: FighterKey | "draw";
  /** 대전 전체 턴 로그. BattleTurnLog가 이 배열 하나만으로 완전히 다시 그린다 */
  log: TurnResult[];
}
