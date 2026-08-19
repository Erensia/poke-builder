export interface PartySlot {
  pokemonId: string;
  /** 메가진화가 있는 포켓몬이 도구로 메가스톤을 장착했을 때 선택된 폼 id */
  activeMegaForm?: string;
  /** 항상 4개 슬롯. 비어있는 슬롯은 null */
  moves: [string | null, string | null, string | null, string | null];
  ability: string | null;
  item: string | null;
}

export interface Party {
  id: string;
  name: string;
  /** 항상 6마리 슬롯. 비어있는 슬롯은 null */
  slots: [
    PartySlot | null,
    PartySlot | null,
    PartySlot | null,
    PartySlot | null,
    PartySlot | null,
    PartySlot | null,
  ];
}
