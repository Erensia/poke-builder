import { getPokemon } from "../lib/data";
import { opponentKey, type FighterKey, type TurnResult } from "../lib/battleSimulator";
import { eunNeun } from "../lib/josa";
import { STATUS_CURE_TEXT } from "../lib/battleLogText";
import { ActionEffectLines } from "./turnLog/ActionEffectLines";
import { ActionMainLine } from "./turnLog/ActionMainLine";
import { EndOfTurnLine, TurnFooterLines } from "./turnLog/EndOfTurnLines";
import { ForcedOpponentSwitchLines, PreMoveSwitchLines, RedCardSwitchLines, SelfSwitchAfterMoveLines } from "./turnLog/SwitchLines";

/**
 * 턴별 배틀 로그(실시간 배틀판·HP게이지·조작 UI에서 분리된, 텍스트 중심 히스토리) — 실시간
 * 대전(BattleLogPage)과 저장된 배틀비디오 다시보기(§6)가 그대로 공유한다. log 배열 하나만
 * 있으면 완전히 렌더 가능해 배틀비디오 저장에도 이 log만 그대로 남기면 된다.
 */
export function BattleTurnLog({ log }: { log: TurnResult[] }) {
  return (
          <div className="battle-turn-log">
            {[...log].reverse().map((turn, turnIdx) => {
              // 턴 종료 처리(회복·상태이상)는 그 시점의 활성 기준이라 activePokemonIds(턴 끝 스냅샷)로 되짚는다.
              const turnName = (key: FighterKey) => getPokemon(turn.activePokemonIds[key])?.name ?? key;
              // 강제 교체는 actions·endOfTurn이 비고 switches만 있는 합성 카드(fromIndex -1) — 제목을 다르게 준다.
              // 양쪽 다 교체한 실제 턴도 행동·턴 종료 로그가 비므로 fromIndex로 구분한다(실제 교체는 인덱스가 있음).
              const isForcedSwitchCard =
                turn.switches.length > 0 &&
                turn.switches.every((sw) => sw.fromIndex < 0) &&
                turn.actions.length === 0 &&
                turn.endOfTurn.length === 0 &&
                !turn.winner;
              // "먼저 행동"은 첫 행동 주체(유턴 턴 중간 교체 전이라 activePokemonIds와 다를 수 있음).
              const firstActorName =
                getPokemon(turn.actions[0]?.actorPokemonId ?? turn.activePokemonIds[turn.order[0]])?.name ??
                turn.order[0];
              return (
              <div key={`${turn.turnNumber}-${turnIdx}`} className="battle-turn-card">
                <div className="battle-turn-title">
                  {isForcedSwitchCard ? `턴 ${turn.turnNumber} · 교체` : `턴 ${turn.turnNumber} · 먼저 행동: ${firstActorName}`}
                </div>
                <PreMoveSwitchLines switches={turn.switches} />
                {turn.turnStartAnnouncements.map((text, i) => (
                  <div key={`tsa-${i}`} className="battle-turn-line is-muted">
                    {text}
                  </div>
                ))}
                {turn.actions.map((action, i) => {
                  // 행동/피격 시점의 종(유턴 턴 중간 교체 반영) — turn.activePokemonIds가 아니라 action에 스냅샷된 값.
                  const actorName = getPokemon(action.actorPokemonId)?.name ?? turnName(action.actor);
                  const defenderName =
                    getPokemon(action.defenderPokemonId)?.name ?? turnName(opponentKey(action.actor));
                  // 데미지 줄에 쓸 값 — 다단히트면 메인 줄엔 1타 몫만, 아니면 총합 그대로.
                  const headDamage = action.hits ? action.hits[0].damage : action.damage;
                  const headDamagePercent = action.hits ? action.hits[0].damagePercent : action.damagePercent;
                  return (
                    <div key={i}>
                      {/* 움직이기 전 상태 판정 — 잠듦/얼음이 이번 행동 시작 시점에 풀렸으면 기술 줄보다
                          먼저 알려준다("잠든 포켓몬은 눈을 떴다!" 순서). */}
                      {action.selfWokeBeforeMove && (
                        <div className="battle-turn-line is-muted">
                          {STATUS_CURE_TEXT[action.selfWokeBeforeMove](actorName)}
                        </div>
                      )}
                      {/* 썰렁개그처럼 기술을 실제로 쓸 때 기술 줄 앞에 붙는 대사("…은(는) 썰렁한 개그를 선보였다!").
                          행동불능 등으로 못 썼으면 나오지 않는다. */}
                      {!action.blockedReason && action.move.preUseUserAnnouncement && (
                        <div className="battle-turn-line">
                          {actorName}
                          {eunNeun(actorName)} {action.move.preUseUserAnnouncement}
                        </div>
                      )}
                      {/* 메인 라인: 누가 무슨 기술을 써서 어떻게 됐는지("빗나감"/데미지 수치)까지만.
                          기절 같은 "상태"는 아래에서 별도 줄로 분리한다. */}
                      <ActionMainLine
                        action={action}
                        actorName={actorName}
                        defenderName={defenderName}
                        headDamage={headDamage}
                        headDamagePercent={headDamagePercent}
                      />
                      {/* 타입변화·방어·상태·스탯변화·도구·특성반응 계열(§15-5) */}
                      <ActionEffectLines action={action} actorName={actorName} defenderName={defenderName} />
                      {/* 유턴류 자체 교체: 이 행동 직후에(§7-2) 시간 순서대로 렌더 */}
                      <SelfSwitchAfterMoveLines switches={turn.switches} actor={action.actor} />
                      {/* 드래곤테일·울부짖기류: 이 기술로 상대가 강제로 끌려나온 교체 */}
                      <ForcedOpponentSwitchLines switches={turn.switches} actor={action.actor} />
                      {/* PR-C4c: 레드카드 — 공격자 자신이 상대 도구에 맞아 강제로 끌려나온 교체 */}
                      <RedCardSwitchLines
                        switches={turn.switches}
                        actor={action.actor}
                        defenderName={defenderName}
                      />
                    </div>
                  );
                })}
                {turn.endOfTurn.map((e, i) => (
                  <EndOfTurnLine key={i} entry={e} turnName={turnName} />
                ))}
                <TurnFooterLines turn={turn} turnName={turnName} />
              </div>
              );
            })}
          </div>
  );
}
