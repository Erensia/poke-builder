import { getPokemon } from "../../lib/data";
import { opponentKey, type FighterKey, type TurnResult } from "../../lib/battleSimulator";
import { eunNeun } from "../../lib/josa";

/** 턴 시작 시점의 자발적 교체(빌드에서 고른 순서대로) — 유일하게 `action`과 무관하다 */
export function PreMoveSwitchLines({ switches }: { switches: TurnResult["switches"] }) {
  return (
    <>
      {switches
        .filter((sw) => !sw.afterMove)
        .map((sw, i) => {
          const outName = getPokemon(sw.outPokemonId)?.name ?? "포켓몬";
          const inName = getPokemon(sw.inPokemonId)?.name ?? "포켓몬";
          return (
            <div key={`sw-${i}`}>
              {/* 본가 스타일 2줄(§5-2). fromIndex<0(강제 교체 합성 카드)이면 물러나는 줄 없음 */}
              {sw.fromIndex >= 0 && <div className="battle-turn-line">돌아와! {outName}!</div>}
              <div className="battle-turn-line">가라! {inName}!</div>
              {sw.entryMessages.map((m, j) => (
                <div key={`swm-${i}-${j}`} className="battle-turn-line is-muted">
                  {m}
                </div>
              ))}
            </div>
          );
        })}
    </>
  );
}

/** 유턴류 자체 교체 — 이 행동 직후에(§7-2) 시간 순서대로 렌더 */
export function SelfSwitchAfterMoveLines({
  switches,
  actor,
}: {
  switches: TurnResult["switches"];
  actor: FighterKey;
}) {
  return (
    <>
      {switches
        .filter((sw) => sw.afterMove && !sw.forced && sw.side === actor)
        .map((sw, j) => {
          const outN = getPokemon(sw.outPokemonId)?.name ?? "포켓몬";
          const inN = getPokemon(sw.inPokemonId)?.name ?? "포켓몬";
          return (
            <div key={`swa-${j}`}>
              {(sw.shedTail || sw.returnsToTrainer) && (
                <div className="battle-turn-line">
                  {outN}
                  {eunNeun(outN)} 트레이너의 곁으로 돌아간다!
                </div>
              )}
              <div className="battle-turn-line">돌아와! {outN}!</div>
              <div className="battle-turn-line">가라! {inN}!</div>
              {sw.entryMessages.map((m, k) => (
                <div key={`swam-${j}-${k}`} className="battle-turn-line is-muted">
                  {m}
                </div>
              ))}
            </div>
          );
        })}
    </>
  );
}

/** 드래곤테일·울부짖기류 — 이 기술로 상대가 강제로 끌려나온 교체 */
export function ForcedOpponentSwitchLines({
  switches,
  actor,
}: {
  switches: TurnResult["switches"];
  actor: FighterKey;
}) {
  return (
    <>
      {switches
        .filter((sw) => sw.afterMove && sw.forced && sw.side === opponentKey(actor))
        .map((sw, j) => {
          const outN = getPokemon(sw.outPokemonId)?.name ?? "포켓몬";
          const inN = getPokemon(sw.inPokemonId)?.name ?? "포켓몬";
          return (
            <div key={`swf-${j}`}>
              <div className="battle-turn-line">
                {outN}
                {eunNeun(outN)} 강제로 교체되었다!
              </div>
              <div className="battle-turn-line">
                {inN}
                {eunNeun(inN)} 배틀에 끌려나왔다!
              </div>
              {sw.entryMessages.map((m, k) => (
                <div key={`swfm-${j}-${k}`} className="battle-turn-line is-muted">
                  {m}
                </div>
              ))}
            </div>
          );
        })}
    </>
  );
}

/** PR-C4c: 레드카드 — 공격자 자신이 상대 도구에 맞아 강제로 끌려나온 교체 */
export function RedCardSwitchLines({
  switches,
  actor,
  defenderName,
}: {
  switches: TurnResult["switches"];
  actor: FighterKey;
  defenderName: string;
}) {
  return (
    <>
      {switches
        .filter((sw) => sw.afterMove && sw.forced && sw.side === actor && sw.redCardItemName)
        .map((sw, j) => {
          const outN = getPokemon(sw.outPokemonId)?.name ?? "포켓몬";
          const inN = getPokemon(sw.inPokemonId)?.name ?? "포켓몬";
          return (
            <div key={`swrc-${j}`}>
              <div className="battle-turn-line">
                {defenderName}의 {sw.redCardItemName}! {outN}
                {eunNeun(outN)} 강제로 교체되었다!
              </div>
              <div className="battle-turn-line">
                {inN}
                {eunNeun(inN)} 배틀에 끌려나왔다!
              </div>
              {sw.entryMessages.map((m, k) => (
                <div key={`swrcm-${j}-${k}`} className="battle-turn-line is-muted">
                  {m}
                </div>
              ))}
            </div>
          );
        })}
    </>
  );
}
