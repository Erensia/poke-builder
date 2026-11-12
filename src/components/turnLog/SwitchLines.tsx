import { getPokemon } from "../../lib/data";
import { opponentKey } from "../../lib/battle/state";
import type { FighterKey, TurnResult } from "../../types/battle";
import { eunNeun } from "../../lib/josa";

/** 턴 시작 시점의 자발적 교체(빌드에서 고른 순서대로) — 유일하게 `action`과 무관하다 */
export function PreMoveSwitchLines({ switches }: { switches: TurnResult["switches"] }) {
  return (
    <>
      {switches
        .filter((sw) => !sw.afterMove && !sw.endOfTurn)
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

/** 기절 뒤 강제 교체(턴 카드 맨 아래에 묶인 블록, 7.5 F2) — 팀 표시 줄 아래에 등장 때 발동한 문구를 흐리게 붙인다 */
export function MergedSwitchLines({ switches, team }: { switches: TurnResult["switches"]; team: (side: FighterKey) => string }) {
  return (
    <>
      {switches.map((sw, i) => (
        <div key={i}>
          <div className="battle-turn-line">
            {team(sw.side)} ▸ 가라! {getPokemon(sw.inPokemonId)?.name ?? "포켓몬"}!
          </div>
          {sw.entryMessages.map((m, j) => (
            <div key={j} className="battle-turn-line is-muted">
              {m}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/** 미래예지 적중으로 대상의 레드카드가 발동해 턴 종료 효과가 끝난 뒤 사용자가 끌려나온 교체(8.3 A4-b) — 턴 종료 줄 맨 끝에 놓는다. holderName: 카드를 지닌 쪽(= 사용자의 상대) 포켓몬 이름 */
export function EndOfTurnSwitchLines({ switches, holderName }: { switches: TurnResult["switches"]; holderName: (userSide: FighterKey) => string }) {
  return (
    <>
      {switches
        .filter((sw) => sw.endOfTurn)
        .map((sw, j) => {
          const outN = getPokemon(sw.outPokemonId)?.name ?? "포켓몬";
          const inN = getPokemon(sw.inPokemonId)?.name ?? "포켓몬";
          return (
            <div key={`swet-${j}`}>
              <div className="battle-turn-line">
                {holderName(sw.side)}의 {sw.redCardItemName}! {outN}
                {eunNeun(outN)} 강제로 교체되었다!
              </div>
              <div className="battle-turn-line">
                {inN}
                {eunNeun(inN)} 배틀에 끌려나왔다!
              </div>
              {sw.entryMessages.map((m, k) => (
                <div key={`swetm-${j}-${k}`} className="battle-turn-line is-muted">
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

/** 드래곤테일·울부짖기류 — 이 기술로 상대가 강제로 끌려나온 교체. 레드카드 교체(redCardItemName)는 RedCardSwitchLines가 그리므로 제외한다(홀더가 행동할 때 같은 기록이 두 줄로 나오던 중복, 8.3 A7②) */
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
        .filter((sw) => sw.afterMove && sw.forced && !sw.redCardItemName && sw.side === opponentKey(actor))
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
