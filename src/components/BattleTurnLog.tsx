import { getPokemon } from "../lib/data";
import { opponentKey } from "../lib/battle/state";
import type { FighterKey, TurnResult } from "../types/battle";
import { eunNeun } from "../lib/josa";
import { activeIndexTrace, faintOrder, hpAsPercent, isForcedSwitchEntry, STATUS_CURE_TEXT } from "../lib/battleLogText";
import { ActionEffectLines } from "./turnLog/ActionEffectLines";
import { HpFormatContext } from "./turnLog/hpFormat";
import { ActionMainLine } from "./turnLog/ActionMainLine";
import { EndOfTurnLine, TurnFooterLines } from "./turnLog/EndOfTurnLines";
import { ForcedOpponentSwitchLines, MergedSwitchLines, PreMoveSwitchLines, RedCardSwitchLines, SelfSwitchAfterMoveLines } from "./turnLog/SwitchLines";

/**
 * 턴별 배틀 로그(실시간 배틀판·HP게이지·조작 UI에서 분리된, 텍스트 중심 히스토리) — 실시간
 * 대전(BattleLogPage)과 저장된 배틀비디오 다시보기(§6)가 그대로 공유한다. log 배열 하나만
 * 있으면 완전히 렌더 가능해 배틀비디오 저장에도 이 log만 그대로 남기면 된다.
 */
export function BattleTurnLog({
  log,
  aiSide = null,
  aiParty,
  reveal,
}: {
  log: TurnResult[];
  aiSide?: FighterKey | null;
  /** AI 파티(파티 인덱스 순)의 종 id·최대 HP. HP 수치를 %로 바꾸는 데 쓴다(같은 종이 둘이어도 개체별로 맞도록 인덱스로 찾는다) */
  aiParty?: { id: string; maxHp: number }[];
  /** 7.4 E7: entry번째 항목이 이펙트와 함께 재생 중일 때 공개된 범위(그 뒤 항목은 대기 중이라 통째로 숨긴다, 7.5 F1) — 아직 안 나온 행동·턴 종료 줄은 자리만 차지한 채 숨긴다. 없으면 전부 공개 */
  reveal?: { entry: number; pre: boolean; actions: number; end: boolean };
}) {
  // AI 쪽 포켓몬의 행동 줄 HP 수치(회복·반동 등)도 최대 HP 대비 %로 바꾼다. 최대 HP를 모르면 실수치 그대로.
  const fmtHp = (maxHp: number | undefined) => (n: number, key: FighterKey) =>
    maxHp && aiSide !== null && key === aiSide ? `${((n / maxHp) * 100).toFixed(1)}%` : n;
  // 로그엔 종 id뿐이라 AI 편의 활성 파티 인덱스를 교체 기록으로 되짚는다(시간순 → 아래 표시는 역순)
  const aiTrace = aiSide !== null && aiParty ? activeIndexTrace(log, aiSide, aiParty.map((p) => p.id)) : null;
  // 기절 뒤 강제 교체 카드는 직전 턴 카드 안으로 묶는다(7.5 F2) — 로그 데이터는 그대로이고 그리기만 합친다
  const groups: { idx: number; extras: number[] }[] = [];
  log.forEach((t, i) => {
    const head = groups.at(-1);
    if (head && isForcedSwitchEntry(t) && !isForcedSwitchEntry(log[head.idx])) head.extras.push(i);
    else groups.push({ idx: i, extras: [] });
  });
  return (
    <>
          <div className="battle-turn-log">
            {[...groups].reverse().map(({ idx: entryIdx, extras }) => {
              const turn = log[entryIdx];
              const trace = aiTrace?.[entryIdx];
              // 턴 종료 처리(회복·상태이상)는 그 시점의 활성 기준이라 activePokemonIds(턴 끝 스냅샷)로 되짚는다.
              const turnName = (key: FighterKey) => getPokemon(turn.activePokemonIds[key])?.name ?? key;
              // 강제 교체는 actions·endOfTurn이 비고 switches만 있는 합성 카드(fromIndex -1) — 제목을 다르게 준다.
              // 양쪽 다 교체한 실제 턴도 행동·턴 종료 로그가 비므로 fromIndex로 구분한다(실제 교체는 인덱스가 있음).
              const isForcedSwitchCard = isForcedSwitchEntry(turn) && !turn.winner;
              // "먼저 행동"은 포켓몬 이름이 아니라 팀으로 적는다(양쪽이 같은 포켓몬이어도 구분). 첫 행동 주체는 실제 행동한 쪽
              // (turn.actions[0].actor) — 없으면 정해진 순서. 우리팀은 AI 대전이면 AI 반대편, 그 외(다시보기·수동 대전)는 a편.
              const myTeam: FighterKey = aiSide ? opponentKey(aiSide) : "a";
              // 재생 중이 아니면 undefined — 재생 중인 항목만 해당, 그 뒤 항목은 통째로 대기
              const rv = reveal?.entry === entryIdx ? reveal : undefined;
              const waiting = reveal !== undefined && entryIdx > reveal.entry;
              const pending = (shown: boolean) => (rv && !shown ? "battle-turn-pending" : rv ? "battle-turn-reveal" : undefined);
              const team = (key: FighterKey) => (key === myTeam ? "우리팀" : "상대팀");
              // 묶인 강제 교체 블록 — 먼저 쓰러진 쪽 먼저(같은 편의 연속 교체는 로그 순서 유지). 재생 중이면 도착한 것까지만 공개한다
              const order = faintOrder(turn);
              const rank = (i: number) => {
                const r = order.indexOf(log[i].switches[0].side);
                return r < 0 ? order.length : r;
              };
              const sorted = [...extras].sort((x, y) => rank(x) - rank(y));
              const extraCls = (i: number) => (!reveal || reveal.entry > i ? undefined : reveal.entry === i && reveal.pre ? "battle-turn-reveal" : "battle-turn-pending");
              const firstActorTeam = (turn.actions[0]?.actor ?? turn.order[0]) === myTeam ? "우리팀" : "상대팀";
              return (
              <div key={`${turn.turnNumber}-${entryIdx}`} className={`battle-turn-card${waiting ? " battle-turn-pending" : ""}`}>
                <div className="battle-turn-title">
                  {isForcedSwitchCard ? `턴 ${turn.turnNumber} · 교체` : `턴 ${turn.turnNumber} · 먼저 행동: ${firstActorTeam}`}
                </div>
                <div className={pending(rv?.pre ?? true)}>
                  <PreMoveSwitchLines switches={turn.switches} />
                </div>
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
                    <div key={i} className={pending(i < (rv?.actions ?? 0))}>
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
                <div className={pending(rv?.end ?? false)}>
                  {/* 날씨 종료는 턴 종료 효과보다 먼저 일어난다(8.3 A1 ①) */}
                  {turn.weatherExpired && <div className="battle-turn-line is-muted">날씨가 원래대로 돌아갔다!</div>}
                  {turn.endOfTurn.map((e, i) => (
                    <EndOfTurnLine
                      key={i}
                      entry={aiSide !== null && e.actor === aiSide ? hpAsPercent(e, aiParty?.[trace?.end ?? -1]?.maxHp) : e}
                      turnName={turnName}
                    />
                  ))}
                  <TurnFooterLines turn={turn} turnName={turnName} />
                </div>
                {sorted.length > 0 && <div className={`battle-turn-switch-sep ${extraCls(sorted[0]) ?? ""}`} />}
                {sorted.map((i) => (
                  <div key={i} className={extraCls(i)}>
                    <MergedSwitchLines switches={log[i].switches} team={team} />
                  </div>
                ))}
              </div>
              );
            })}
          </div>
    </>
  );
}
