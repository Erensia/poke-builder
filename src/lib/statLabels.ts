import type { StatKey } from "../types/nature";
import type { AccuracyEvasionKey } from "../types/battleStats";

export const STAT_LABELS: Record<StatKey, string> = {
  hp: "체력",
  atk: "공격",
  def: "방어",
  spa: "특공",
  spd: "특방",
  spe: "스피드",
};

export const STAT_ORDER: StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** 명중률/회피율은 STAT_LABELS(5스탯+체력) 밖이라 랭크 변화 로그에서 공통으로 쓰는 라벨 변환. */
export function statOrAccuracyLabel(stat: StatKey | AccuracyEvasionKey): string {
  if (stat === "accuracy") return "명중률";
  if (stat === "evasion") return "회피율";
  return STAT_LABELS[stat];
}
