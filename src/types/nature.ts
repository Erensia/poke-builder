export type StatKey = "hp" | "atk" | "def" | "spa" | "spd" | "spe";

export interface Nature {
  id: string;
  name: string;
  /** 10% 상승하는 스탯. 무보정 성격이면 null (HP는 대상이 될 수 없다) */
  increased: Exclude<StatKey, "hp"> | null;
  /** 10% 하락하는 스탯. 무보정 성격이면 null */
  decreased: Exclude<StatKey, "hp"> | null;
}
