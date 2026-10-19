import { useState } from "react";
import { SAMPLE_PARTIES } from "../lib/data";
import type { RankState } from "../lib/battleRank";
import { beginRankMatch, finishRankMatch, resetSeason, settleAbandonedRank, type RankHistoryEntry, type RankSave } from "../lib/battleRankSave";
import { loadBattleRank, saveBattleRank } from "../lib/storage";
import type { PartySlots, SamplePartyPreset } from "../types/party";

/** 직전 판 결과 — 계산 내역 카드가 판 전 상태와 비교해 승급·강등·챔피언 달성을 보여 준다 */
export interface RankLastResult {
  before: RankState;
  entry: RankHistoryEntry;
}

// ponytail: 상대는 기본 샘플 파티 무작위(직전 상대 제외). 랭크·연패에 맞춘 상대 선택은 R3에서 이 함수를 바꾼다
function pickOpponent(prevId?: string): SamplePartyPreset {
  const pool = SAMPLE_PARTIES.filter((p) => p.id !== prevId);
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 랭크배틀(5.0 R1 ⓒ) — 내 파티·선출은 배틀타워 화면 그대로 쓰고 상대만 샘플 파티로 이어 간다.
 * 랭크·이력·시즌 기록은 localStorage에 저장하고(`save`), 켜져 있는지(`active`)는 세션 상태다.
 * 앱을 열 때 "판은 시작됐는데 결과가 없는" 표시가 남아 있으면 이탈(= 패배)로 정산한다.
 */
export function useRankBattle() {
  const [save, setSave] = useState<RankSave>(() => {
    const loaded = loadBattleRank();
    const settled = settleAbandonedRank(loaded, Date.now());
    if (settled !== loaded) saveBattleRank(settled);
    return settled;
  });
  const [active, setActive] = useState(false);
  const [current, setCurrent] = useState<SamplePartyPreset | null>(null);
  const [lastResult, setLastResult] = useState<RankLastResult | null>(null);

  function update(next: RankSave) {
    setSave(next);
    saveBattleRank(next);
  }

  /** 랭크배틀을 켜고 첫 상대를 돌려준다. 랭크·연승은 이어진다 */
  function start(): SamplePartyPreset {
    const first = pickOpponent();
    setCurrent(first);
    setActive(true);
    setLastResult(null);
    return first;
  }

  /** 대전이 실제로 시작될 때 부른다 — 결과 전에 끊기면 이탈로 정산되도록 표시를 남기고, 내 빌드 6슬롯을 기록해 둔다 */
  function begin(party: PartySlots) {
    if (!current) return;
    update(beginRankMatch(save, current.id, party, Date.now()));
    setLastResult(null);
  }

  /** 지금 상대와의 한 판 결과(무승부는 패배). turns는 판이 끝난 시점의 턴 번호 */
  function record(winner: "a" | "b" | "draw", turns: number) {
    if (!current || save.pendingId === null) return;
    const next = finishRankMatch(save, winner === "a" ? { won: true, turns } : { won: false }, Date.now());
    update(next);
    setLastResult({ before: save.state, entry: next.history[0] });
  }

  /** 다음 상대로 넘어간다 */
  function next(): SamplePartyPreset {
    const opponent = pickOpponent(current?.id);
    setCurrent(opponent);
    return opponent;
  }

  function stop() {
    setActive(false);
    setCurrent(null);
  }

  /** 시즌 기록을 남기고 랭크를 처음으로 되돌린다. 켜져 있는 동안은 부르지 않는다(이탈=패배 우회 방지) */
  function reset() {
    if (!active) {
      update(resetSeason(save, Date.now()));
      setLastResult(null);
    }
  }

  return { save, active, current, lastResult, start, begin, record, next, stop, reset };
}
