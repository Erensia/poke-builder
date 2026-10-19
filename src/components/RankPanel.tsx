import { useState } from "react";
import { rankLabel, rankOf } from "../lib/battleRank";
import { getPokemon, SAMPLE_PARTIES } from "../lib/data";
import type { useRankBattle } from "../hooks/useRankBattle";
import type { SamplePartyPreset } from "../types/party";
import { Modal } from "./Modal";
import { RankGauge } from "./RankGauge";
import { describeChange } from "../lib/battleRankText";
import "./RankPanel.css";

const RESULT_LABEL = { win: "승", loss: "패", abandon: "이탈" } as const;
const date = (ms: number) => new Date(ms).toLocaleDateString("ko-KR");
const dateTime = (ms: number) => new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const opponentName = (id: string) => SAMPLE_PARTIES.find((p) => p.id === id)?.name ?? id;

interface RankPanelProps {
  rank: ReturnType<typeof useRankBattle>;
  /** 시작할 수 있는 조건을 못 채웠을 때 이유(없으면 시작 가능) */
  startBlockedReason: string | null;
  /** 시작 — 상대 진영(b)에 첫 샘플을 채운다 */
  onStart: (first: SamplePartyPreset) => void;
}

/** 랭크배틀 프로필 — 랭크·게이지·레이팅·연승, 시작/종료, 이력과 시즌 기록, 초기화. 대전 설정 화면 맨 위에 둔다 */
export function RankPanel({ rank, startBlockedReason, onStart }: RankPanelProps) {
  const { save, active, current } = rank;
  const { state } = save;
  const display = rankOf(state);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="rank-panel">
      <div className="rank-profile">
        <RankGauge display={display} />
        <div className="rank-info">
          <strong className="rank-name">{rankLabel(display)}</strong>
          {state.rating !== null && (
            <span>
              레이팅 <strong>{state.rating.toFixed(2)}</strong> · 최고 {state.maxRating.toFixed(2)}
              {state.champion && " · 🏆 챔피언 달성 이력"}
            </span>
          )}
          <span>
            {state.streak}연승 · {state.lossStreak}연패 · 이번 시즌 {state.wins}승 {state.losses}패
          </span>
          <span className="rank-sub">
            {save.seasons.length + 1}시즌{save.seasonStartedAt !== null && ` · ${date(save.seasonStartedAt)} 시작`}
            {active && current && ` · 지금 상대: ${current.name} (${current.style})`}
          </span>
          <span className="rank-sub">결과가 나오기 전에 나가면(탭 이동·새로고침·창 닫기) 이 판은 패배로 기록돼요.</span>
        </div>
        {active ? (
          <button type="button" className="battle-setup-load-party tap-target" onClick={rank.stop}>
            종료하기
          </button>
        ) : (
          <button type="button" className="battle-setup-load-party tap-target" disabled={!!startBlockedReason} title={startBlockedReason ?? undefined} onClick={() => onStart(rank.start())}>
            랭크 배틀 시작
          </button>
        )}
      </div>

      {save.history.length > 0 && (
        <details className="rank-details">
          <summary>최근 판 이력 ({save.history.length}판)</summary>
          <ul className="rank-list">
            {save.history.map((h) => (
              <li key={h.at}>
                <span className="rank-list-when">{dateTime(h.at)}</span>
                <span className={`rank-list-result is-${h.result}`}>{RESULT_LABEL[h.result]}</span>
                <span className="rank-list-main">
                  {opponentName(h.opponentId)}
                  {h.turns !== null && ` · ${h.turns}턴`}
                </span>
                <span className="rank-list-sub">
                  {describeChange(h.change, h.result === "win")} → {rankLabel(h.after)}
                  {h.rating !== null && ` ${h.rating.toFixed(2)}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {save.seasons.length > 0 && (
        <details className="rank-details">
          <summary>시즌 기록 ({save.seasons.length}개)</summary>
          <ul className="rank-list">
            {[...save.seasons].reverse().map((s) => (
              <li key={s.season}>
                <span className="rank-list-when">{s.season}시즌</span>
                <span className="rank-list-main">
                  {date(s.startedAt)} ~ {date(s.endedAt)} · {s.wins}승
                </span>
                <span className="rank-list-sub">
                  마지막 {rankLabel(s.finalRank)}
                  {s.finalRating !== null && ` ${s.finalRating.toFixed(2)}`}
                  {s.champion ? " · 🏆 챔피언 달성" : s.maxRating > 0 ? ` · 최대 레이팅 ${s.maxRating.toFixed(2)}` : ""}
                </span>
                {s.party && (
                  <span className="rank-list-sub">
                    파티: {s.party.filter((x) => x !== null).map((x) => getPokemon(x.pokemonId)?.name ?? x.pokemonId).join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!active && (state.wins + state.losses > 0 || save.seasons.length > 0) && (
        <button type="button" className="battle-setup-load-party tap-target rank-reset" onClick={() => setConfirmReset(true)}>
          랭크 초기화
        </button>
      )}

      {confirmReset && (
        <Modal title="랭크 초기화" onClose={() => setConfirmReset(false)}>
          <p>
            {state.wins + state.losses > 0
              ? `${save.seasons.length + 1}시즌 기록(마지막 랭크·최대 레이팅·챔피언 달성 여부·승수·마지막 파티)을 저장하고, 랭크를 몬스터볼 4로 되돌려요. 이력도 비워져요.`
              : "아직 한 판도 안 해서 시즌 기록은 남기지 않아요."}
          </p>
          <div className="rank-confirm-actions">
            <button type="button" className="battle-setup-load-party tap-target" onClick={() => setConfirmReset(false)}>
              취소
            </button>
            <button
              type="button"
              className="battle-setup-load-party tap-target"
              onClick={() => {
                rank.reset();
                setConfirmReset(false);
              }}
            >
              초기화
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
