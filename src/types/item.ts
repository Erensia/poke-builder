export type ItemCategory = "mega-stone" | "held-item";

export interface Item {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
}
