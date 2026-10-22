import { useRef, useState } from "react";
import { SAMPLE_PARTIES } from "../lib/data";
import type { RankState } from "../lib/battleRank";
import { beginRankMatch, expireSeason, finishRankMatch, settleAbandonedRank, type RankHistoryEntry, type RankSave } from "../lib/battleRankSave";
import { pickRankOpponent, resolveRankAiPolicy } from "../lib/battle/ai/rankProfile";
import { loadBattleRank, saveBattleRank } from "../lib/storage";
import type { PartySlots, SamplePartyPreset } from "../types/party";

/** 직전 판 결과 — 계산 내역 카드가 판 전 상태와 비교해 승급·강등·챔피언 달성을 보여 준다 */
export interface RankLastResult {
  before: RankState;
  entry: RankHistoryEntry;
}

/**
 * 랭크배틀(5.0 R1 ⓒ) — 내 파티·선출은 배틀타워 화면 그대로 쓰고 상대만 샘플 파티로 이어 간다.
 * 랭크·이력·시즌 기록은 localStorage에 저장하고(`save`), 켜져 있는지(`active`)는 세션 상태다.
 * 앱을 열 때 "판은 시작됐는데 결과가 없는" 표시가 남아 있으면 이탈(= 패배)로 정산하고, 시즌이 30일을 넘겼으면 시즌 기록을 남기고 초기화한다.
 */
export function useRankBattle() {
  const [save, setSave] = useState<RankSave>(() => {
    const loaded = loadBattleRank();
    const now = Date.now();
    const settled = expireSeason(settleAbandonedRank(loaded, now), now);
    if (settled !== loaded) saveBattleRank(settled);
    return settled;
  });
  const [active, setActive] = useState(false);
  const [current, setCurrent] = useState<SamplePartyPreset | null>(null);
  const [aiLevel, setAiLevel] = useState(0);
  const [lastResult, setLastResult] = useState<RankLastResult | null>(null);
  const recentRef = useRef<string[]>([]);

  function update(next: RankSave) {
    setSave(next);
    saveBattleRank(next);
  }

  /** 지금 랭크·연패에 맞는 상대 파티와 AI 단계를 정한다(정책: rankProfile.ts) */
  function choose(state: RankState): SamplePartyPreset {
    const policy = resolveRankAiPolicy(state);
    setAiLevel(policy.level);
    const picked = pickRankOpponent(SAMPLE_PARTIES, policy.tier, recentRef.current, Math.random, policy.randomRate);
    recentRef.current = [picked.id, ...recentRef.current].slice(0, policy.recent);
    return picked;
  }

  /** 랭크배틀을 켜고 첫 상대를 돌려준다. 랭크·연승은 이어진다 */
  function start(): SamplePartyPreset {
    // 탭을 오래 켜 둔 채 30일이 지났으면 시즌을 먼저 닫는다
    const fresh = expireSeason(save, Date.now());
    if (fresh !== save) update(fresh);
    const first = choose(fresh.state);
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
    const opponent = choose(save.state);
    setCurrent(opponent);
    return opponent;
  }

  function stop() {
    setActive(false);
    setCurrent(null);
  }

  return { save, active, current, aiLevel, lastResult, start, begin, record, next, stop };
}
