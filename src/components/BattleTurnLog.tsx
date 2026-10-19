import { getPokemon } from "../lib/data";
import { opponentKey } from "../lib/battle/state";
import type { FighterKey, TurnResult } from "../types/battle";
import { eunNeun } from "../lib/josa";
import { activeIndexTrace, hpAsPercent, STATUS_CURE_TEXT } from "../lib/battleLogText";
import { ActionEffectLines } from "./turnLog/ActionEffectLines";
import { HpFormatContext } from "./turnLog/hpFormat";
import { ActionMainLine } from "./turnLog/ActionMainLine";
import { EndOfTurnLine, TurnFooterLines } from "./turnLog/EndOfTurnLines";
import { ForcedOpponentSwitchLines, PreMoveSwitchLines, RedCardSwitchLines, SelfSwitchAfterMoveLines } from "./turnLog/SwitchLines";

/**
 * 턴별 배틀 로그(실시간 배틀판·HP게이지·조작 UI에서 분리된, 텍스트 중심 히스토리) — 실시간
 * 대전(BattleLogPage)과 저장된 배틀비디오 다시보기(§6)가 그대로 공유한다. log 배열 하나만
 * 있으면 완전히 렌더 가능해 배틀비디오 저장에도 이 log만 그대로 남기면 된다.
 */
export function BattleTurnLog({
  log,
  aiSide = null,
  aiParty,
}: {
  log: TurnResult[];
  aiSide?: FighterKey | null;
  /** AI 파티(파티 인덱스 순)의 종 id·최대 HP. HP 수치를 %로 바꾸는 데 쓴다(같은 종이 둘이어도 개체별로 맞도록 인덱스로 찾는다) */
  aiParty?: { id: string; maxHp: number }[];
}) {
  // AI 쪽 포켓몬의 행동 줄 HP 수치(회복·반동 등)도 최대 HP 대비 %로 바꾼다. 최대 HP를 모르면 실수치 그대로.
  const fmtHp = (maxHp: number | undefined) => (n: number, key: FighterKey) =>
    maxHp && aiSide !== null && key === aiSide ? `${((n / maxHp) * 100).toFixed(1)}%` : n;
  // 로그엔 종 id뿐이라 AI 편의 활성 파티 인덱스를 교체 기록으로 되짚는다(시간순 → 아래 표시는 역순)
  const aiTrace = aiSide !== null && aiParty ? activeIndexTrace(log, aiSide, aiParty.map((p) => p.id)) : null;
  return (
    <>
          <div className="battle-turn-log">
            {[...log].reverse().map((turn, turnIdx) => {
              const trace = aiTrace?.[log.length - 1 - turnIdx];
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
                  // AI 상대전에서 내가 상대에게 입힌 데미지는 실수치 대신 줄어든 체력 %만 보여준다(최대 HP 역산 방지).
                  const percentOnly = aiSide !== null && action.actor !== aiSide;
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
                      {/* §2-4: 변환자재/리베로 타입 변경 — 기술을 쓰기 전에 발동하는 특성이라 기술·데미지 줄보다 먼저 2줄로 */}
                      {!action.blockedReason && action.changedOwnTypeTo && (
                        <>
                          <div className="battle-turn-line is-muted">
                            {actorName}의 {action.changedOwnTypeAbilityName}!
                          </div>
                          <div className="battle-turn-line is-muted">
                            {actorName}
                            {eunNeun(actorName)} {action.changedOwnTypeTo}타입이 되었다!
                          </div>
                        </>
                      )}
                      {/* 메인 라인: 누가 무슨 기술을 써서 어떻게 됐는지("빗나감"/데미지 수치)까지만.
                          기절 같은 "상태"는 아래에서 별도 줄로 분리한다. */}
                      <HpFormatContext.Provider value={fmtHp(aiParty?.[trace?.actions[i] ?? -1]?.maxHp)}>
                        <ActionMainLine
                          action={action}
                          actorName={actorName}
                          defenderName={defenderName}
                          headDamage={headDamage}
                          headDamagePercent={headDamagePercent}
                          percentOnly={percentOnly}
                        />
                        {/* 타입변화·방어·상태·스탯변화·도구·특성반응 계열(§15-5) */}
                        <ActionEffectLines action={action} actorName={actorName} defenderName={defenderName} percentOnly={percentOnly} />
                      </HpFormatContext.Provider>
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
                  <EndOfTurnLine
                    key={i}
                    entry={aiSide !== null && e.actor === aiSide ? hpAsPercent(e, aiParty?.[trace?.end ?? -1]?.maxHp) : e}
                    turnName={turnName}
                  />
                ))}
                <TurnFooterLines turn={turn} turnName={turnName} />
              </div>
              );
            })}
          </div>
    </>
  );
}
