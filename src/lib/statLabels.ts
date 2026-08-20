import type { StatKey } from "../types/nature";

export const STAT_LABELS: Record<StatKey, string> = {
  hp: "체력",
  atk: "공격",
  def: "방어",
  spa: "특공",
  spd: "특방",
  spe: "스피드",
};

export const STAT_ORDER: StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];
