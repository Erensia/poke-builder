import { Fragment, type ReactNode } from "react";
import { getPokemon } from "../lib/data";
import {
  opponentKey,
  STRUGGLE_MOVE,
  type ActionLogEntry,
  type FighterKey,
  type HitAbilityEvent,
  type TurnResult,
} from "../lib/battleSimulator";
import type { EndOfTurnLogEntry } from "../types/battle";
import { STAT_LABELS } from "../lib/statLabels";
import { typeLabel } from "../types/pokemon-type";
import { eunNeun, iGa, eulReul, waGwa, roEuro } from "../lib/josa";
import { VOLATILE_LABELS, SCREEN_LABELS } from "../lib/battleLogLabels";
import { FIELD_ENTRY_ANNOUNCEMENT } from "../lib/fieldEffects";
import {
  CHARGE_TURN_MESSAGE,
  stageRiseAdverb,
  STATUS_ONSET_TEXT,
  STATUS_TRIGGER_TEXT,
  STATUS_CURE_TEXT,
  WEATHER_MOVE_LINES,
} from "../lib/battleLogText";

/** 액션 로그 한 줄 안에 "OO 발동!"으로 뭉뚱그리기보다 전용 문구를 따로 쓰는 volatile들 */
const VOLATILES_WITH_DEDICATED_LOG_LINE = new Set(["drowsy", "wish", "encore", "imprison", "meanLook", "lockOn"]);

/**
 * 방어측 on-hit 특성 효과 한 줄의 "내용"만 만드는 함수들(감싸는 div·key는 호출부 책임) —
 * 다단히트 집계(HitAbilityEvent, 타별로 여러 번 발동 가능)와 단일히트(ActionLogEntry의 개별
 * `ability*` 필드, 최대 1회)가 문구는 완전히 동일해서(§5와 같은 이유로 대조 확인 완료) 공유한다.
 */
function abilityStatusLine(
  abilityName: string | undefined,
  status: NonNullable<HitAbilityEvent["statusOnAttacker"]>,
  actorName: string,
  defenderName: string,
): ReactNode {
  return (
    <>
      {defenderName}의 {abilityName}! {STATUS_ONSET_TEXT[status](actorName)}
    </>
  );
}

function abilityVolatileLine(
  abilityName: string | undefined,
  volatile: NonNullable<HitAbilityEvent["volatileOnAttacker"]>,
  actorName: string,
  defenderName: string,
): ReactNode {
  return (
    <>
      {defenderName}의 {abilityName}! {actorName}
      {eunNeun(actorName)} {VOLATILE_LABELS[volatile]} 상태가 되었다!
    </>
  );
}

function abilityDamageLine(
  abilityName: string | undefined,
  damage: number,
  actorName: string,
  defenderName: string,
): ReactNode {
  return (
    <>
      {defenderName}의 {abilityName}! {actorName}
      {eunNeun(actorName)} {damage} 데미지를 입었다
    </>
  );
}

/** 방어측 랭크 변화(지구력·깨어진갑옷류 — 같은 특성이 내림·오름을 동시에 낼 수 있어 한 쌍으로 처리) */
function abilityDefenderStatsLines(
  abilityName: string | undefined,
  lowered: NonNullable<HitAbilityEvent["loweredDefenderStats"]>,
  raised: NonNullable<HitAbilityEvent["raisedDefenderStats"]>,
  defenderName: string,
): { lowered: ReactNode | null; raised: ReactNode | null } {
  let loweredContent: ReactNode | null = null;
  if (lowered.length > 0) {
    const joined = lowered.map((s) => STAT_LABELS[s.stat]).join(", ");
    const maxDelta = Math.max(...lowered.map((s) => s.delta));
    loweredContent = (
      <>
        {defenderName}의 {abilityName}! {defenderName}의 {joined}
        {iGa(joined)} {stageRiseAdverb(maxDelta)}내려갔다!
      </>
    );
  }
  let raisedContent: ReactNode | null = null;
  if (raised.length > 0) {
    const joined = raised.map((s) => STAT_LABELS[s.stat]).join(", ");
    const maxDelta = Math.max(...raised.map((s) => s.delta));
    raisedContent = (
      <>
        {lowered.length === 0 && (
          <>
            {defenderName}의 {abilityName}!{" "}
          </>
        )}
        {defenderName}의 {joined}
        {iGa(joined)} {stageRiseAdverb(maxDelta)}올라갔다!
      </>
    );
  }
  return { lowered: loweredContent, raised: raisedContent };
}

function abilityLoweredAttackerStatsLine(
  abilityName: string | undefined,
  lowered: NonNullable<HitAbilityEvent["loweredAttackerStats"]>,
  actorName: string,
  defenderName: string,
): ReactNode {
  const joined = lowered.map((s) => STAT_LABELS[s.stat]).join(", ");
  const maxDelta = Math.max(...lowered.map((s) => s.delta));
  return (
    <>
      {defenderName}의 {abilityName}! {actorName}의 {joined}
      {iGa(joined)} {stageRiseAdverb(maxDelta)}내려갔다!
    </>
  );
}

function abilityDisabledMoveLine(
  abilityName: string | undefined,
  moveName: string,
  actorName: string,
  defenderName: string,
): ReactNode {
  return (
    <>
      {defenderName}의 {abilityName}! {actorName}의 {moveName}
      {iGa(moveName)} 봉인되었다!
    </>
  );
}

function abilityPickpocketLine(
  abilityName: string | undefined,
  itemName: string,
  actorName: string,
  defenderName: string,
): ReactNode {
  return (
    <>
      {defenderName}의 {abilityName}! {actorName}의 {itemName}
      {eulReul(itemName)} 빼앗았다!
    </>
  );
}

function abilityMummifiedLine(abilityName: string, actorName: string, defenderName: string): ReactNode {
  return (
    <>
      {defenderName}의 {abilityName}! {actorName}의 특성이 미라가 되었다!
    </>
  );
}

function wanderingSpiritLine(actorName: string, defenderName: string): ReactNode {
  return (
    <>
      {defenderName}의 떠도는영혼! {actorName}
      {eunNeun(actorName)} {defenderName}
      {waGwa(defenderName)} 특성을 맞바꿨다!
    </>
  );
}

function sandSpitWeatherLine(
  weather: NonNullable<HitAbilityEvent["sandSpitWeather"]>,
  defenderName: string,
): ReactNode {
  return (
    <>
      {defenderName}의 모래뿜기! 날씨가 {weather}
      {roEuro(weather)} 바뀌었다!
    </>
  );
}

function setFieldOnHitLine(
  abilityName: string | undefined,
  field: NonNullable<HitAbilityEvent["setFieldOnHit"]>,
  defenderName: string,
): ReactNode {
  return (
    <>
      {defenderName}의 {abilityName}! {field}
      {roEuro(field)} 바뀌었다!
    </>
  );
}

/**
 * 다단히트 한 타의 방어측 on-hit 특성 이벤트(HitAbilityEvent)를 로그 줄들로 렌더한다.
 * 문구는 단타용 집계 렌더(아래 JSX)와 동일하게 맞춘다 — 다단히트일 땐 그 집계 줄들이 숨겨지고
 * 이 함수가 타별로 같은 문구를 찍는다.
 */
function hitAbilityEventLines(
  ev: HitAbilityEvent,
  actorName: string,
  defenderName: string,
  keyPrefix: string,
): ReactNode[] {
  const lines: ReactNode[] = [];
  const push = (node: ReactNode) =>
    lines.push(
      <div key={`${keyPrefix}-${lines.length}`} className="battle-turn-line is-muted">
        {node}
      </div>,
    );

  if (ev.statusOnAttacker) {
    push(abilityStatusLine(ev.abilityName, ev.statusOnAttacker, actorName, defenderName));
  }
  if (ev.volatileOnAttacker) {
    push(abilityVolatileLine(ev.abilityName, ev.volatileOnAttacker, actorName, defenderName));
  }
  if (ev.damageToAttacker) {
    push(abilityDamageLine(ev.abilityName, ev.damageToAttacker, actorName, defenderName));
  }
  if (ev.loweredDefenderStats?.length || ev.raisedDefenderStats?.length) {
    const { lowered, raised } = abilityDefenderStatsLines(
      ev.abilityName,
      ev.loweredDefenderStats ?? [],
      ev.raisedDefenderStats ?? [],
      defenderName,
    );
    if (lowered) push(lowered);
    if (raised) push(raised);
  }
  if (ev.loweredAttackerStats?.length) {
    push(abilityLoweredAttackerStatsLine(ev.abilityName, ev.loweredAttackerStats, actorName, defenderName));
  }
  if (ev.disabledMoveName) {
    push(abilityDisabledMoveLine(ev.abilityName, ev.disabledMoveName, actorName, defenderName));
  }
  if (ev.pickpocketStolenItemName) {
    push(abilityPickpocketLine(ev.abilityName, ev.pickpocketStolenItemName, actorName, defenderName));
  }
  if (ev.mummifiedAttackerAbilityName) {
    push(abilityMummifiedLine(ev.mummifiedAttackerAbilityName, actorName, defenderName));
  }
  if (ev.wanderingSpiritSwapped) {
    push(wanderingSpiritLine(actorName, defenderName));
  }
  if (ev.sandSpitWeather) {
    push(sandSpitWeatherLine(ev.sandSpitWeather, defenderName));
  }
  if (ev.setFieldOnHit) {
    push(setFieldOnHitLine(ev.abilityName, ev.setFieldOnHit, defenderName));
  }
  return lines;
}

/**
 * §2-5: 연타(멀티히트) — 1타 몫은 메인 데미지 줄(호출부 책임)이 이미 찍었고, 여기서 1타
 * 급소·1타 방어측 특성 반응 → 2타부터 "타별 데미지 줄(+급소+특성 반응)" → 마지막에
 * "N번 맞았다!"까지. 변환자재 2줄은 §2-4 블록이 1타 직후에 이미 찍는다(호출부 책임).
 */
function MultiHitLines({
  hits,
  moveName,
  hitCount,
  actorName,
  defenderName,
}: {
  hits: NonNullable<ActionLogEntry["hits"]>;
  moveName: string;
  hitCount: number | undefined;
  actorName: string;
  defenderName: string;
}) {
  if (hits.length === 0) return null;
  return (
    <>
      {hits[0].critical && <div className="battle-turn-line is-muted">급소에 맞았다!</div>}
      {hits[0].abilityEvent && hitAbilityEventLines(hits[0].abilityEvent, actorName, defenderName, "he-0")}
      {hits.slice(1).map((h, i) => (
        <Fragment key={i}>
          <div className="battle-turn-line">
            {actorName}의 {moveName} — {h.damage} 데미지 (
            {(h.damagePercent * 100).toFixed(1)}%)
          </div>
          {h.critical && <div className="battle-turn-line is-muted">급소에 맞았다!</div>}
          {h.abilityEvent && hitAbilityEventLines(h.abilityEvent, actorName, defenderName, `he-${i + 1}`)}
        </Fragment>
      ))}
      <div className="battle-turn-line is-muted">{hitCount}번 맞았다!</div>
    </>
  );
}

/**
 * 턴 종료 처리 한 줄(회복/상태이상 틱/카운트다운 등 §6의 22개 메커니즘에 대응) — `entry` 하나와
 * 이름 조회용 `turnName`만 있으면 렌더 가능해 다른 섹션과 데이터 의존이 없다. `entry`의 어느
 * 필드가 채워져 있는지로 어떤 메커니즘인지 분기(엔진의 `finishTurn.ts` 실행 순서와 무관 —
 * 이미 끝난 결과를 필드 유무로 표시만 함).
 */
function EndOfTurnLine({
  entry: e,
  turnName,
}: {
  entry: EndOfTurnLogEntry;
  turnName: (key: FighterKey) => string;
}) {
  return (
    <div className="battle-turn-line is-muted">
      {e.fieldHeal ? (
        <>
          {turnName(e.actor)} 그래스필드로 {e.fieldHeal} 회복 (남은 HP {e.remainingHp})
        </>
      ) : e.itemHeal ? (
        <>
          {turnName(e.actor)}의 {e.itemHealItemName}로 {e.itemHeal} 회복 (남은 HP{" "}
          {e.remainingHp})
        </>
      ) : e.abilityWeatherHeal ? (
        <>
          {turnName(e.actor)}의 {e.abilityWeatherHealAbilityName}로{" "}
          {e.abilityWeatherHeal} 회복 (남은 HP {e.remainingHp})
        </>
      ) : e.regenHeal ? (
        <>
          {turnName(e.actor)}
          {e.regenSource && VOLATILE_LABELS[e.regenSource]}로 {e.regenHeal} 회복 (남은 HP {e.remainingHp})
        </>
      ) : e.leechSeedDamage ? (
        <>
          {turnName(e.actor)}의 씨앗이 체력을 {e.leechSeedDamage} 흡수했다 (남은 HP{" "}
          {e.remainingHp})
          {e.fainted && " · 기절!"}
        </>
      ) : e.leechSeedHealAmount ? (
        <>
          {turnName(e.actor)}가 씨앗으로 체력을 {e.leechSeedHealAmount} 회복 (남은 HP{" "}
          {e.remainingHp})
        </>
      ) : e.liquidOozeDamage ? (
        <>
          {turnName(e.actor)}
          {eunNeun(turnName(e.actor))} 해감액을 빨아들여 {e.damage} 데미지 (남은 HP {e.remainingHp})
          {e.fainted && " · 기절!"}
        </>
      ) : e.wishHeal ? (
        <>
          {turnName(e.actor)}의 희망사항으로 체력을 {e.wishHeal} 회복 (남은 HP{" "}
          {e.remainingHp})
        </>
      ) : e.berryHeal ? (
        <>
          {turnName(e.actor)}의 {e.berryHealItemName}로 {e.berryHeal} 회복 (남은 HP{" "}
          {e.remainingHp})
        </>
      ) : e.sandstormDamage ? (
        <>
          {turnName(e.actor)}
          {eunNeun(turnName(e.actor))} 모래바람에 시달리고 있다! {e.damage} 데미지 (남은
          HP {e.remainingHp}){e.fainted && " · 기절!"}
        </>
      ) : e.boundDamage ? (
        <>
          {turnName(e.actor)}
          {eunNeun(turnName(e.actor))} 속박에서 벗어나지 못하고 있다! {e.damage} 데미지
          (남은 HP {e.remainingHp}){e.fainted && " · 기절!"}
        </>
      ) : e.saltCureDamage ? (
        <>
          {turnName(e.actor)}
          {eunNeun(turnName(e.actor))} 소금절이 때문에 괴로워하고 있다! {e.damage} 데미지
          (남은 HP {e.remainingHp}){e.fainted && " · 기절!"}
        </>
      ) : e.syrupCoatDrop ? (
        <>
          {turnName(e.actor)}
          {eunNeun(turnName(e.actor))} 물엿범벅이 되어 스피드가 떨어졌다! (남은 HP{" "}
          {e.remainingHp})
        </>
      ) : e.octolockDrop ? (
        <>
          {turnName(e.actor)}
          {eunNeun(turnName(e.actor))} 문어굳히기 때문에 방어와 특수방어가 떨어졌다! (남은 HP{" "}
          {e.remainingHp})
        </>
      ) : e.perishFainted ? (
        <>
          {turnName(e.actor)}
          {eunNeun(turnName(e.actor))} 멸망의 노래 카운트가 0이 되어 쓰러졌다!
        </>
      ) : e.perishCount !== undefined ? (
        <>
          {turnName(e.actor)}의 멸망의 노래 카운트: {e.perishCount}
        </>
      ) : e.inflictedDelayedStatus ? (
        STATUS_ONSET_TEXT[e.inflictedDelayedStatus](turnName(e.actor))
      ) : e.abilityCuredStatus ? (
        <>
          {turnName(e.actor)}의 {e.abilityCuredStatusAbilityName}!{" "}
          {STATUS_CURE_TEXT[e.abilityCuredStatus](turnName(e.actor))}
        </>
      ) : e.statusCondition ? (
        <>
          {STATUS_TRIGGER_TEXT[e.statusCondition](turnName(e.actor))} (남은 HP{" "}
          {e.remainingHp})
          {e.fainted && " · 기절!"}
        </>
      ) : e.speedBoostAbilityName ? (
        <>
          {turnName(e.actor)}의 {e.speedBoostAbilityName}!{" "}
          {e.speedBoostAtCap
            ? `${turnName(e.actor)}의 스피드는 더 이상 올라가지 않는다!`
            : "스피드가 올라갔다!"}
        </>
      ) : e.moodyAbilityName && e.moodyRaisedStat && e.moodyLoweredStat ? (
        <>
          {turnName(e.actor)}의 {e.moodyAbilityName}! {STAT_LABELS[e.moodyRaisedStat]}
          {iGa(STAT_LABELS[e.moodyRaisedStat])} 크게 올라가고{" "}
          {STAT_LABELS[e.moodyLoweredStat]}
          {iGa(STAT_LABELS[e.moodyLoweredStat])} 떨어졌다!
        </>
      ) : e.poisonHealAbilityName ? (
        <>
          {turnName(e.actor)}의 {e.poisonHealAbilityName}! 독 데미지 대신 HP{" "}
          {e.poisonHealAmount} 회복 (남은 HP {e.remainingHp})
        </>
      ) : e.abilityWeatherDamageAbilityName ? (
        <>
          {turnName(e.actor)}의 {e.abilityWeatherDamageAbilityName}! 데미지 {e.damage}{" "}
          (남은 HP {e.remainingHp}){e.fainted && " · 기절!"}
        </>
      ) : e.harvestRestoredBerryName ? (
        <>
          {turnName(e.actor)}의 수확! {e.harvestRestoredBerryName}
          {eulReul(e.harvestRestoredBerryName)} 다시 만들었다!
        </>
      ) : e.cheekPouchHeal ? (
        <>
          {turnName(e.actor)}의 볼주머니! 체력을 {e.cheekPouchHeal} 회복 (남은 HP{" "}
          {e.remainingHp})
        </>
      ) : e.hungerModeChangedTo ? (
        <>
          {turnName(e.actor)}
          {eunNeun(turnName(e.actor))}{" "}
          {e.hungerModeChangedTo === "hangry" ? "배고픈모양" : "배부른모양"}이 되었다!
        </>
      ) : (
        <>
          {turnName(e.actor)} 상태이상 데미지 {e.damage} (남은 HP {e.remainingHp})
          {e.fainted && " · 기절!"}
        </>
      )}
    </div>
  );
}

/**
 * 턴 카드 맨 아래 — 필드/트릭룸/날씨 잔여턴·소멸, 스크린/신비의부적 만료, 승패 판정. 전부
 * `turn`(과 이름 조회용 `turnName`)만 있으면 렌더 가능해 다른 섹션과 데이터 의존이 없다.
 */
function TurnFooterLines({
  turn,
  turnName,
}: {
  turn: TurnResult;
  turnName: (key: FighterKey) => string;
}) {
  return (
    <>
      {turn.field && (
        <div className="battle-turn-line is-muted">
          필드: {turn.field} (앞으로 {turn.fieldTurnsRemaining}턴 뒤 소멸)
        </div>
      )}
      {turn.fieldExpired && <div className="battle-turn-line is-muted">필드가 사라졌다!</div>}
      {turn.trickRoomTurnsRemaining !== undefined && (
        <div className="battle-turn-line is-muted">
          트릭룸: 앞으로 {turn.trickRoomTurnsRemaining}턴 뒤 해제
        </div>
      )}
      {turn.trickRoomExpired && <div className="battle-turn-line is-muted">트릭룸이 해제됐다!</div>}
      {turn.weatherTurnsRemaining !== undefined && (
        <div className="battle-turn-line is-muted">
          날씨: 앞으로 {turn.weatherTurnsRemaining}턴 뒤 소멸
        </div>
      )}
      {turn.weatherExpired && <div className="battle-turn-line is-muted">날씨가 원래대로 돌아갔다!</div>}
      {turn.expiredScreens.map((e, i) => (
        <div key={i} className="battle-turn-line is-muted">
          {turnName(e.actor)}의 {SCREEN_LABELS[e.screen]}
          {iGa(SCREEN_LABELS[e.screen])} 사라졌다!
        </div>
      ))}
      {turn.expiredSafeguard.map((actor, i) => (
        <div key={i} className="battle-turn-line is-muted">
          {turnName(actor)}의 신비의부적 효과가 사라졌다!
        </div>
      ))}
      {turn.expiredFieldEffects?.map((effect) => (
        <div key={`fx-${effect}`} className="battle-turn-line is-muted">
          {effect === "wonderRoom"
            ? "원더룸이 해제되어 방어와 특수방어가 원래대로 돌아왔다!"
            : effect === "magicRoom"
              ? "매직룸이 해제되어 도구의 효과가 원래대로 돌아왔다!"
              : "중력이 원래대로 돌아왔다!"}
        </div>
      ))}
      {turn.expiredMagnetRise?.map((actor, i) => (
        <div key={`mr-${i}`} className="battle-turn-line is-muted">
          {turnName(actor)}의 전자부유 효과가 끝났다!
        </div>
      ))}
      {turn.expiredTailwind?.map((actor, i) => (
        <div key={`tw-${i}`} className="battle-turn-line is-muted">
          {turnName(actor)}의 순풍이 멈췄다!
        </div>
      ))}
      {turn.winner && (
        <div className="battle-turn-line is-winner">
          {turn.winner === "draw" ? "🤝 무승부!" : `🏆 ${turnName(turn.winner)} 승리!`}
        </div>
      )}
    </>
  );
}

/**
 * 교체 로그 4계열 — 문구가 계열마다 달라(누가 왜 교체됐는지) 하나로 합치지 않고 이름만
 * "TurnSwitchLines" 아래 나란히 뒀다. 공통점은 outName/inName 조회 + entryMessages 꼬리뿐.
 */

/** 턴 시작 시점의 자발적 교체(빌드에서 고른 순서대로) — 유일하게 `action`과 무관하다 */
function PreMoveSwitchLines({ switches }: { switches: TurnResult["switches"] }) {
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
function SelfSwitchAfterMoveLines({
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
function ForcedOpponentSwitchLines({
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
function RedCardSwitchLines({
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

/**
 * 사이코필드에 선공기가 막혔을 때(ver.1.6 §3-3-5) — 보호받은 쪽이 "내 파티"(side a)면 실제
 * 이름을, "상대 파티"(side b)면 "상대 포켓몬"으로 뭉뚱그린다. 보호받은 쪽은 시전자(actor)의
 * 반대편이라, actor가 a면 보호받은 쪽은 b(상대), actor가 b면 보호받은 쪽은 a(내 파티)다.
 */
function psychicFieldBlockedLine(actor: FighterKey, defenderName: string): ReactNode {
  const protectedName = actor === "a" ? "상대 포켓몬" : defenderName;
  return (
    <>
      {" — "}
      {protectedName}
      {eunNeun(protectedName)} 사이코필드의 보호를 받고 있다!
    </>
  );
}

/**
 * 행동 한 건의 메인 라인 — 누가 무슨 기술을 써서 어떻게 됐는지("빗나감"/데미지 수치)까지만
 * 한 줄에 모은다. 기절 같은 "상태"는 이 컴포넌트 밖(호출부)에서 별도 줄로 분리한다. `action`의
 * ~50개 optional 필드를 조건부로 읽는 게 전부라 클로저 의존 없이(호출부가 넘겨주는 다섯 개
 * props만으로) 그대로 뗄 수 있었다.
 */
function ActionMainLine({
  action,
  actorName,
  defenderName,
  headDamage,
  headDamagePercent,
}: {
  action: ActionLogEntry;
  actorName: string;
  defenderName: string;
  headDamage: number;
  headDamagePercent: number;
}) {
  return (
    <div className="battle-turn-line">
      {/* 흉내쟁이(트랙 M2): "OO의 흉내쟁이!" 다음 줄에 따라 쓴 기술 — action.move는 따라 쓴 기술이다 */}
      {action.copycatCalledMoveName && (
        <>
          <strong>{actorName}</strong>의 흉내쟁이!
          <br />
        </>
      )}
      <strong>{actorName}</strong>의 {action.move.name}
      {action.sleepTalkCalledMoveName && " (잠꼬대로 냈다!)"}
      {action.bouncedMoveName && (
        <> — {defenderName}의 {action.bouncedByAbilityName}! 기술이 되돌아왔다!</>
      )}
      {action.blockedReason === "usageCondition" && "!"}
      {action.blockedReason === "moveRestricted" && "!"}
      {action.blockedReason === "status" && action.blockedByStatus === undefined && " — 상태이상으로 행동 불가"}
      {action.blockedReason === "flinch" && " — 풀이 죽어서 움직일 수 없었다!"}
      {action.blockedReason === "recharge" && " — 반동으로 움직일 수 없었다!"}
      {action.blockedReason === "confusion" &&
        ` — 자기자신을 공격했다! (${action.selfDamage} 데미지)`}
      {action.blockedReason === "attract" && " — 헤롱헤롱에 빠져 행동 불가"}
      {action.blockedReason === "psychicFieldPriority" && psychicFieldBlockedLine(action.actor, defenderName)}
      {action.blockedReason === "queenlyMajesty" && (
        <>
          {" — "}
          {actorName}
          {eunNeun(actorName)} {action.move.name}
          {eulReul(action.move.name)} 쓸 수 없다!
        </>
      )}
      {!action.blockedReason &&
        action.charging &&
        (CHARGE_TURN_MESSAGE[action.move.id]
          ? ` — ${actorName}${eunNeun(actorName)}${CHARGE_TURN_MESSAGE[action.move.id]}`
          : " — 준비 중...")}
      {!action.blockedReason && !action.charging && action.evadedByCharge && " — 무적 상태라 빗나감"}
      {!action.blockedReason && !action.charging && !action.evadedByCharge && !action.hit && " — !"}
      {/* 데미지 표기. 다단히트면 이 줄은 1타 몫만 — 나머지 타는 아래 별도 줄(§2-5). */}
      {!action.blockedReason && action.hit && action.damage > 0 && (
        <>
          {" "}
          — {headDamage} 데미지 ({(headDamagePercent * 100).toFixed(1)}%)
        </>
      )}
      {!action.blockedReason &&
        action.hit &&
        action.inflictedVolatile &&
        !VOLATILES_WITH_DEDICATED_LOG_LINE.has(action.inflictedVolatile) && (
          <> · {VOLATILE_LABELS[action.inflictedVolatile]}!</>
        )}
      {!action.blockedReason && action.hit && action.inflictedVolatile === "wish" && (
        <> · 희망사항!</>
      )}
      {!action.blockedReason && action.hit && action.setField && (
        <>
          {" "}
          ·{" "}
          {action.setField === "미스트필드" ? FIELD_ENTRY_ANNOUNCEMENT.미스트필드 : `${action.setField} 설치!`}
        </>
      )}
      {!action.blockedReason && action.hit && action.fieldSetFailed && (
        <> · 그러나 실패했다!</>
      )}
      {!action.blockedReason && action.hit && action.stealthRockSetForSide && (
        <>
          {" "}
          ·{" "}
          {action.bouncedMoveName
            ? "뾰족한 바위가 되돌아와 시전자 쪽 필드에 깔렸다!"
            : "상대 편 필드에 뾰족한 바위가 깔렸다!"}
        </>
      )}
      {!action.blockedReason && action.hit && action.spikesSetForSide && (
        <> · 상대 편 필드에 압정이 흩뿌려졌다!</>
      )}
      {!action.blockedReason && action.hit && action.toxicSpikesSetForSide && (
        <> · 상대 편 필드에 독 압정이 흩뿌려졌다!</>
      )}
      {!action.blockedReason && action.hit && action.stickyWebSetForSide && (
        <> · 상대 편 필드에 끈적끈적네트가 펼쳐졌다!</>
      )}
      {!action.blockedReason && action.hit && action.hazardSetFailed && (
        <> · 그러나 실패했다!</>
      )}
      {!action.blockedReason && action.hit && action.abilitySwappedTargetToName && (
        <>
          {" "}
          · {defenderName}의 특성이 {action.abilitySwappedTargetToName}
          {roEuro(action.abilitySwappedTargetToName)} 바뀌었다!
        </>
      )}
      {!action.blockedReason && action.hit && action.abilitySwapFailed && (
        <> · 그러나 실패했다!</>
      )}
      {/* 트랙 M3: 스킬스왑·동료만들기·역할·위액·미러타입 */}
      {!action.blockedReason && action.abilityChange?.kind === "swap" && (
        <>
          {" "}
          · {actorName}
          {eunNeun(actorName)} 서로의 특성을 바꿨다!
        </>
      )}
      {!action.blockedReason && action.abilityChange?.kind === "give" && action.abilityChange.abilityName && (
        <>
          {" "}
          · {defenderName}의 특성이 {action.abilityChange.abilityName}
          {roEuro(action.abilityChange.abilityName)} 바뀌었다!
        </>
      )}
      {!action.blockedReason && action.abilityChange?.kind === "copy" && action.abilityChange.abilityName && (
        <>
          {" "}
          · {actorName}
          {eunNeun(actorName)} {defenderName}의 {action.abilityChange.abilityName}
          {eulReul(action.abilityChange.abilityName)} 복사했다!
        </>
      )}
      {!action.blockedReason && action.abilityChange?.kind === "suppress" && (
        <> · {defenderName}의 특성이 효과를 잃었다!</>
      )}
      {!action.blockedReason && action.abilityChangeFailed && <> · 그러나 실패했다!</>}
      {!action.blockedReason && action.copiedTypes && (
        <>
          {" "}
          · {actorName}
          {eunNeun(actorName)} {defenderName}
          {waGwa(defenderName)} 같은 타입이 되었다!
        </>
      )}
      {!action.blockedReason && action.hit && !action.hits && action.mummifiedAttackerAbilityName && (
        <> · {abilityMummifiedLine(action.mummifiedAttackerAbilityName, actorName, defenderName)}</>
      )}
      {!action.blockedReason && action.ateBerryName && (
        <>
          {" "}
          · {actorName}
          {eunNeun(actorName)} {action.ateBerryName}
          {eulReul(action.ateBerryName)} 먹었다!
          {!!action.ateBerryHeal && <> HP {action.ateBerryHeal} 회복!</>}
        </>
      )}
      {!action.blockedReason && action.berryEatFailed && <> · 그러나 나무열매가 없어 실패했다!</>}
      {!action.blockedReason && action.hit && action.destroyedField && (
        <> · {action.destroyedField} 파괴!</>
      )}
      {!action.blockedReason && action.hit && action.setTrickRoom && (
        <> · 트릭룸 발동!</>
      )}
      {!action.blockedReason && action.hit && action.trickRoomSetFailed && (
        <> · 그러나 실패했다!</>
      )}
      {/* 트랙 M4: 룸·중력·전자부유·떨어뜨리기 */}
      {!action.blockedReason && action.trickRoomEnded && <> · 뒤틀린 시공이 원래대로 돌아왔다!</>}
      {!action.blockedReason && action.roomChange && (
        <>
          {" "}
          ·{" "}
          {action.roomChange.room === "wonderRoom"
            ? action.roomChange.on
              ? "방어와 특수방어가 뒤바뀌는 이상한 공간이 만들어졌다!"
              : "원더룸이 해제되어 방어와 특수방어가 원래대로 돌아왔다!"
            : action.roomChange.on
              ? "도구의 효과가 사라지는 이상한 공간이 만들어졌다!"
              : "매직룸이 해제되어 도구의 효과가 원래대로 돌아왔다!"}
        </>
      )}
      {!action.blockedReason && action.gravitySet && <> · 중력이 강해졌다!</>}
      {!action.blockedReason && action.gravitySetFailed && <> · 그러나 실패했다!</>}
      {!action.blockedReason && action.magnetRiseSet && (
        <>
          {" "}
          · {actorName}
          {eunNeun(actorName)} 전자기력으로 떠올랐다!
        </>
      )}
      {!action.blockedReason && action.magnetRiseFailed && <> · 그러나 실패했다!</>}
      {!action.blockedReason && action.smackedDownTarget && (
        <>
          {" "}
          · {defenderName}
          {eunNeun(defenderName)} 땅으로 떨어졌다!
        </>
      )}
      {!action.blockedReason && action.hit && action.setWeather && (
        <>
          {" "}
          ·{" "}
          {WEATHER_MOVE_LINES[action.move.id]?.set ?? (
            <>
              날씨가 {action.setWeather}
              {roEuro(action.setWeather)} 바뀌었다!
            </>
          )}
        </>
      )}
      {!action.blockedReason && action.hit && action.weatherSetFailed && (
        <> · {WEATHER_MOVE_LINES[action.move.id]?.fail ?? "그러나 실패했다!"}</>
      )}
      {!action.blockedReason && action.hit && action.setScreen && (
        <> · {SCREEN_LABELS[action.setScreen]} 설치!</>
      )}
      {!action.blockedReason && action.hit && action.screenSetFailed && (
        <> · 그러나 실패했다!</>
      )}
      {!action.blockedReason && action.hit && action.setSafeguard && (
        <> · 신비한 힘의 보호를 받았다!</>
      )}
      {!action.blockedReason && action.hit && action.safeguardSetFailed && (
        <> · 그러나 실패했다!</>
      )}
      {!action.blockedReason && action.hit && action.brokeScreens?.length && (
        <>
          {" "}
          · {action.brokeScreens.map((s) => SCREEN_LABELS[s]).join("·")}
          {eulReul(SCREEN_LABELS[action.brokeScreens[action.brokeScreens.length - 1]])} 부쉈다!
        </>
      )}
      {!action.blockedReason && action.hit && !!action.healedAmount && (
        <>
          {" "}
          · {action.healedTarget === "opponent" ? defenderName : actorName}
          {roEuro(action.healedTarget === "opponent" ? defenderName : actorName)} 체력을{" "}
          {action.healedAmount} 회복했다!
        </>
      )}
      {!action.blockedReason && action.hit && action.restSlept && <> · 잠들었다!</>}
      {!action.blockedReason && action.hit && !!action.drainHealAmount && (
        <> · 체력을 {action.drainHealAmount} 흡수했다!</>
      )}
      {!action.blockedReason && action.hit && action.setRegenVolatile && (
        <> · {VOLATILE_LABELS[action.setRegenVolatile]} 발동!</>
      )}
      {!action.blockedReason && action.hit && action.regenSetFailed && (
        <> · 그러나 실패했다!</>
      )}
      {!action.blockedReason && action.hit && action.setLeechSeed && (
        <> · 씨앗을 심었다!</>
      )}
      {!action.blockedReason && action.hit && action.leechSeedSetFailed && (
        <> · 그러나 실패했다!</>
      )}
      {!action.blockedReason && action.hit && action.leechSeedBlockedByGrass && (
        <> · 그러나 풀타입 {defenderName}에게는 통하지 않는다!</>
      )}
      {!action.blockedReason && action.hit && action.setSubstitute && <> · 대타를 세웠다!</>}
      {!action.blockedReason && action.hit && action.substituteSetFailed && (
        <> · 그러나 실패하고 말았다!</>
      )}
      {!action.blockedReason && action.hit && action.shedTailSucceeded && (
        <> · 꼬리를 잘라 분신을 만들었다!</>
      )}
      {!action.blockedReason && action.hit && action.shedTailFailed && (
        <> · 그러나 실패했다!</>
      )}
      {!action.blockedReason && action.hit && action.setDisabledMoveName && (
        <> · {action.setDisabledMoveName} 봉인!</>
      )}
      {!action.blockedReason && action.hit && action.disableSetFailed && (
        <> · 그러나 실패했다!</>
      )}
      {!action.blockedReason && action.hit && action.setEncoreMoveName && (
        <> · {action.setEncoreMoveName}밖에 쓸 수 없다!</>
      )}
      {!action.blockedReason && action.hit && action.encoreSetFailed && (
        <> · 그러나 실패했다!</>
      )}
      {!action.blockedReason && action.hit && action.swappedStatsMoveName && (
        <> · 공격과 방어 수치가 서로 바뀌었다!</>
      )}
      {!action.blockedReason && action.hit && action.swappedStagesMoveName && (
        <> · 서로의 랭크 변화를 맞바꿨다!</>
      )}
      {!action.blockedReason && action.hit && action.averagedDefensesMoveName && (
        <> · 서로의 방어와 특수방어를 나눠 가졌다!</>
      )}
      {!action.blockedReason && action.hit && action.swappedSpeedMoveName && (
        <> · 서로의 스피드를 교체했다!</>
      )}
      {!action.blockedReason && action.hit && action.swappedItems && (
        <>
          {" "}
          · 서로의 도구를 바꿨다!
          {action.swappedItems.userGotName && (
            <>
              <br />
              {actorName}
              {eunNeun(actorName)} {action.swappedItems.userGotName}
              {eulReul(action.swappedItems.userGotName)} 손에 넣었다!
            </>
          )}
          {action.swappedItems.targetGotName && (
            <>
              <br />
              {defenderName}
              {eunNeun(defenderName)} {action.swappedItems.targetGotName}
              {eulReul(action.swappedItems.targetGotName)} 손에 넣었다!
            </>
          )}
        </>
      )}
      {!action.blockedReason && action.hit && action.itemSwapFailed && <> · 그러나 실패했다!</>}
      {!action.blockedReason && action.hit && action.painSplitHp !== undefined && (
        <> · 서로의 체력을 나눠 가졌다!</>
      )}
      {!action.blockedReason && action.hit && action.tailwindSet && <> · 순풍이 불기 시작했다!</>}
      {!action.blockedReason && action.hit && action.tailwindSetFailed && <> · 그러나 실패했다!</>}
      {!action.blockedReason && action.hit && action.stockpileHealFailed && <> · 그러나 실패했다!</>}
      {!action.blockedReason && action.hit && action.recycledItemName && (
        <>
          {" "}
          · {action.recycledItemName}
          {eulReul(action.recycledItemName)} 다시 손에 넣었다!
        </>
      )}
      {!action.blockedReason && action.hit && action.recycleFailed && <> · 그러나 실패했다!</>}
      {!action.blockedReason && action.hit && action.copiedStagesFromName && (
        <> · {action.copiedStagesFromName}의 능력 변화를 복사했다!</>
      )}
      {!action.blockedReason && action.hit && action.averagedAttacksMoveName && (
        <> · 서로의 공격과 특수공격을 나눠 가졌다!</>
      )}
      {!action.blockedReason && action.hit && action.spitePp && (
        <>
          {" "}
          · {defenderName}의 {action.spitePp.moveName}의 PP가 {action.spitePp.amount} 줄었다!
        </>
      )}
      {!action.blockedReason && action.hit && action.spiteFailed && <> · 그러나 실패했다!</>}
      {!action.blockedReason && action.hit && action.acupressureRaised && (() => {
        const { stat, delta } = action.acupressureRaised;
        const label = stat === "accuracy" ? "명중률" : stat === "evasion" ? "회피율" : STAT_LABELS[stat];
        return (
          <>
            {" "}
            · {actorName}의 {label}
            {iGa(label)} {delta >= 2 ? "크게 " : ""}올라갔다!
          </>
        );
      })()}
      {!action.blockedReason && action.hit && action.acupressureFailed && <> · 그러나 실패했다!</>}
      {!action.blockedReason && action.hit && action.shellSideArmCategory && (
        <> · {action.shellSideArmCategory === "physical" ? "물리" : "특수"} 판정!</>
      )}
      {!action.blockedReason && action.hit && action.transformedIntoName && (
        <> · {action.transformedIntoName}{roEuro(action.transformedIntoName)} 변신했다!</>
      )}
      {!action.blockedReason && action.hit && action.transformFailed && (
        <> · 그러나 실패했다!</>
      )}
      {!action.blockedReason && action.hit && action.sheerForceAbilityName && (
        <> · {action.sheerForceAbilityName} 발동! 부가 효과 대신 위력이 올랐다!</>
      )}
      {!action.blockedReason && action.hit && action.stolenItemName && (
        <> · 매지션 발동! 상대의 {action.stolenItemName}{eulReul(action.stolenItemName)} 빼앗았다!</>
      )}
      {!action.blockedReason && action.hit && action.unburdenSelfAbilityName && (
        <> · {action.unburdenSelfAbilityName} 발동! 스피드가 2배로 올랐다!</>
      )}
      {!action.blockedReason && action.hit && action.unburdenOpponentAbilityName && (
        <> · 상대의 {action.unburdenOpponentAbilityName} 발동! 상대의 스피드가 2배로 올랐다!</>
      )}
    </div>
  );
}

/**
 * 행동 한 건의 타입변화·방어·상태·스탯변화·도구·특성반응 계열 — ActionMainLine(메인 라인)
 * 다음부터 교체 로그(TurnSwitchLines 계열) 앞까지 오는 나머지 전부(연타 집계용
 * MultiHitLines 호출도 이 안에 포함). §15에서 가장 크고(원래 836줄) 마지막으로 남겨둔
 * 덩어리 — 순서가 그대로 로그 문구 순서라 세부 계열별로 더 쪼개지 않고 하나로 뒀다.
 */
function ActionEffectLines({
  action,
  actorName,
  defenderName,
}: {
  action: ActionLogEntry;
  actorName: string;
  defenderName: string;
}) {
  return (
    <>
      {/* §2-4: 변환자재/리베로 타입 변경 — 데미지 줄 인라인에서 분리해 2줄로 */}
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
      {/* PR-C1: 전광쌍격 — 사용 후 자기 타입 소실(빗나가도 표시) */}
      {!action.blockedReason && action.lostTypeAfterUse && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} {action.lostTypeAfterUse}타입이 사라졌다!
        </div>
      )}
      {/* PR-C1: 대검돌격 — 사용 후 피격 필중·피해 2배 상태 */}
      {!action.blockedReason && action.glaiveRushArmed && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} 무방비 상태가 되었다!
        </div>
      )}
      {/* PR-C1: 코트체인지 — 양쪽 진영 설치물·스크린 교체 */}
      {!action.blockedReason && action.hit && action.courtChangeDone && (
        <div className="battle-turn-line is-muted">서로의 필드 효과를 뒤바꿨다!</div>
      )}
      {/* PR-C1: 회생의기도 — 교대 포켓몬 부활 / 대상 없음 */}
      {!action.blockedReason && action.hit && action.revivedPartyName && (
        <div className="battle-turn-line is-muted">
          {action.revivedPartyName}의 기운을 되찾아주었다!
        </div>
      )}
      {!action.blockedReason && action.hit && action.reviveFailed && (
        <div className="battle-turn-line is-muted">그러나 실패했다!</div>
      )}
      {/* PR-C1b: 문어굳히기 / 물고버티기 — 도망봉인 */}
      {!action.blockedReason && action.hit && action.octolockApplied && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} 문어굳히기에 붙잡혀 도망칠 수 없다!
        </div>
      )}
      {!action.blockedReason && action.hit && action.jawLockApplied && (
        <div className="battle-turn-line is-muted">
          {actorName}와(과) {defenderName}
          {eunNeun(defenderName)} 서로 물고 늘어져 교체할 수 없다!
        </div>
      )}
      {/* PR-C2b: 위기회피 — 피격으로 HP 절반 이하 → 퇴장 (실제 교체는 pendingPivot 패널) */}
      {!action.blockedReason && action.hit && action.triggersDefenderEmergencyExit && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.emergencyExitAbilityName ?? "위기회피"}!
        </div>
      )}
      {/* C-5 명중 빗나감 — 메인 줄은 "OO의 기합구슬 — !"로 끝내고 여기서 별도 줄 */}
      {!action.blockedReason && !action.charging && !action.evadedByCharge && !action.hit && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} 맞지 않았다!
        </div>
      )}
      {/* §2-5: 연타(멀티히트) — 1타 몫은 위 데미지 줄이 이미 찍었고, 여기서 1타 급소·
          1타 방어측 특성 반응 → 2타부터 "타별 데미지 줄(+급소+특성 반응)" → 마지막에
          "N번 맞았다!". 변환자재 2줄은 위 §2-4 블록이 1타 직후에 이미 찍는다. */}
      {!action.blockedReason && action.hits && action.hits.length > 0 && (
        <MultiHitLines
          hits={action.hits}
          moveName={action.move.name}
          hitCount={action.hitCount}
          actorName={actorName}
          defenderName={defenderName}
        />
      )}
      {/* C-4 급소 — 데미지 줄 인라인에서 분리 (다단히트는 "(급소 포함)" 인라인 유지) */}
      {!action.blockedReason && action.hit && action.critical && action.hitCount === undefined && action.damage > 0 && (
        <div className="battle-turn-line is-muted">급소에 맞았다!</div>
      )}
      {/* C-1~C-3 타입 상성 문구 — 데미지 기술이 명중했을 때만 */}
      {!action.blockedReason &&
        action.hit &&
        !action.charging &&
        action.move.category !== "status" &&
        (action.move.power !== null || action.move.fixedDamage !== undefined) && (
          <>
            {action.typeEffectiveness === 0 && (
              <div className="battle-turn-line is-muted">
                상대 {defenderName}에게는 효과가 없는 듯하다...
              </div>
            )}
            {action.typeEffectiveness >= 2 && (
              <div className="battle-turn-line is-muted">효과가 굉장했다!</div>
            )}
            {action.typeEffectiveness > 0 && action.typeEffectiveness <= 0.5 && (
              <div className="battle-turn-line is-muted">효과가 별로인 듯하다...</div>
            )}
          </>
        )}
      {/* 마비/잠듦/얼음으로 이번 턴 행동이 막혔으면(단순 "상태이상으로 행동 불가"가
          아니라) 매턴 효과가 발동한 것과 같은 의미라 트리거 문구를 그대로 쓴다 */}
      {action.blockedReason === "status" && action.blockedByStatus && (
        <div className="battle-turn-line is-muted">
          {STATUS_TRIGGER_TEXT[action.blockedByStatus](actorName)}
        </div>
      )}
      {/* 속이기(첫 턴 전용)처럼 사용 조건을 못 채워 실패했을 때 — 메인 줄은
          "OO의 속이기!"로만 끝내고, 실패 여부는 이 별도 줄로 알려준다 */}
      {action.blockedReason === "usageCondition" && (
        <div className="battle-turn-line is-muted">
          {actorName}의 {action.move.name}{eunNeun(action.move.name)} 실패했다!
        </div>
      )}
      {/* 도발/사슬묶기/앙코르로 이번 선택 자체가 막혔을 때 — 어떤 제약 때문인지 구분해서 보여준다 */}
      {action.blockedReason === "moveRestricted" && (
        <div className="battle-turn-line is-muted">
          {action.moveRestrictionKind === "taunt" &&
            `${actorName}${eunNeun(actorName)} 도발에 걸려 변화기를 쓸 수 없다!`}
          {action.moveRestrictionKind === "disable" &&
            `${actorName}의 ${action.move.name}${eunNeun(action.move.name)} 사슬묶기에 봉인돼있다!`}
          {action.moveRestrictionKind === "encore" &&
            `${actorName}${eunNeun(actorName)} 앙코르 때문에 이 기술을 쓸 수 없다!`}
          {action.moveRestrictionKind === "torment" &&
            `${actorName}${eunNeun(actorName)} 트집 때문에 같은 기술을 연속으로 쓸 수 없다!`}
          {action.moveRestrictionKind === "imprison" &&
            `${actorName}${eunNeun(actorName)} 봉인 때문에 ${action.move.name}${eulReul(action.move.name)} 사용하지 못한다!`}
          {action.moveRestrictionKind === "gravity" &&
            `${actorName}${eunNeun(actorName)} 중력 때문에 ${action.move.name}${eulReul(action.move.name)} 사용하지 못한다!`}
        </div>
      )}
      {/* 상태이상에 새로 걸렸을 때(onset) — 보통 상대가 대상이지만, 매직미러로 되돌아온
          경우(bouncedMoveName)엔 시전자(actor) 자신에게 걸린 것이다 */}
      {!action.blockedReason && action.hit && action.inflictedStatus && (
        <div className="battle-turn-line is-muted">
          {STATUS_ONSET_TEXT[action.inflictedStatus](
            action.bouncedMoveName ? actorName : defenderName,
          )}
        </div>
      )}
      {/* C-8 이미 걸린 상태이상에 상태이상 전용기를 다시 써서 아무 변화가 없었을 때 */}
      {!action.blockedReason && action.hit && action.statusInflictFailed && (
        <div className="battle-turn-line is-muted">
          {actorName}의 {action.move.name} - 그러나 실패했다!
        </div>
      )}
      {/* 앙코르 성공 — 사용/받은 쪽을 두 줄로 나눈다(백로그 §7-3) */}
      {/* 트랙 M6 */}
      {!action.blockedReason && action.hit && action.inflictedVolatile === "meanLook" && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} 이제 도망칠 수 없다!
        </div>
      )}
      {!action.blockedReason && action.hit && action.inflictedVolatile === "lockOn" && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} {defenderName}에게 조준을 맞췄다!
        </div>
      )}
      {!action.blockedReason && action.fairyLockSet && (
        <div className="battle-turn-line is-muted">다음 턴에는 누구도 도망칠 수 없게 되었다!</div>
      )}
      {!action.blockedReason && (action.fairyLockFailed || action.healingWishFailed || action.meltFailed || action.magneticFluxFailed) && (
        <div className="battle-turn-line is-muted">그러나 실패했다!</div>
      )}
      {!action.blockedReason && action.healingWishSet && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} 치유소원을 빌고 쓰러졌다!
        </div>
      )}
      {!action.blockedReason && action.meltedItemName && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.meltedItemName}
          {iGa(action.meltedItemName)} 녹아버렸다!
        </div>
      )}
      {!action.blockedReason && action.hit && action.inflictedVolatile === "imprison" && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} 상대의 기술을 봉인했다!
        </div>
      )}
      {!action.blockedReason && action.hit && action.inflictedVolatile === "encore" && (
        <div className="battle-turn-line is-muted">
          {action.bouncedMoveName ? (
            <>
              {actorName}의 앙코르!<br />
              {actorName}
              {eunNeun(actorName)} 앙코르를 받았다!
            </>
          ) : (
            <>
              {actorName}의 앙코르!<br />
              {defenderName}
              {eunNeun(defenderName)} 앙코르를 받았다!
            </>
          )}
        </div>
      )}
      {/* 하품(졸음) 유도 — 실제로 잠드는 건 2턴 뒤라 onset 문구와 다르게 "유도했다"로 표현 */}
      {!action.blockedReason && action.hit && action.inflictedVolatile === "drowsy" && (
        <div className="battle-turn-line is-muted">
          {action.bouncedMoveName
            ? `${actorName}의 졸음을 유도했다!`
            : `상대 ${defenderName}의 졸음을 유도했다!`}
        </div>
      )}
      {/* 상태이상이 나았을 때(cure) — curedStatusTarget으로 자신/상대 구분 */}
      {!action.blockedReason && action.hit && action.curedStatus && (
        <div className="battle-turn-line is-muted">
          {STATUS_CURE_TEXT[action.curedStatus](
            action.curedStatusTarget === "self" ? actorName : defenderName,
          )}
        </div>
      )}
      {/* 방어측 접촉/피격 트리거 특성(정전기·불꽃몸=상태이상, 까칠한피부=고정 데미지,
          저주받은바디=PP 봉인) — 전부 defenderName의 특성이 actorName(공격자)에게 발동한다.
          다단히트(action.hits)면 §2-5 블록이 타별로 찍으므로 아래 집계 줄은 건너뛴다. */}
      {!action.blockedReason && !action.hits && action.abilityInflictedStatusOnAttacker && (
        <div className="battle-turn-line is-muted">
          {abilityStatusLine(
            action.abilityInflictedStatusAbilityName,
            action.abilityInflictedStatusOnAttacker,
            actorName,
            defenderName,
          )}
        </div>
      )}
      {/* 헤롱헤롱바디 — 접촉해 온 공격자가 이성이면 방어측 특성이 발동해 공격자에게 걸린다 */}
      {!action.blockedReason && !action.hits && action.abilityInflictedVolatileOnAttacker && (
        <div className="battle-turn-line is-muted">
          {abilityVolatileLine(
            action.abilityInflictedVolatileAbilityName,
            action.abilityInflictedVolatileOnAttacker,
            actorName,
            defenderName,
          )}
        </div>
      )}
      {!action.blockedReason && !action.hits && !!action.abilityDamageToAttacker && (
        <div className="battle-turn-line is-muted">
          {abilityDamageLine(
            action.abilityDamageAbilityName,
            action.abilityDamageToAttacker,
            actorName,
            defenderName,
          )}
        </div>
      )}
      {/* PR-C4a: 울퉁불퉁멧 — 접촉기 공격자 반동(다단히트 합산이라 hits 무관 표시) */}
      {!action.blockedReason && !!action.rockyHelmetDamage && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.rockyHelmetItemName}! {actorName}
          {eunNeun(actorName)} {action.rockyHelmetDamage} 데미지를 입었다!
        </div>
      )}
      {/* PR-C4a: 노말주얼 등 타입 젬 — 소모되며 위력 상승 */}
      {!action.blockedReason && action.ateGemItemName && (
        <div className="battle-turn-line is-muted">
          {actorName}의 {action.ateGemItemName}
          {eunNeun(action.ateGemItemName)} 발동해 위력이 올랐다!
        </div>
      )}
      {/* PR-C4a: 풍선 — 피격으로 터짐 */}
      {!action.blockedReason && action.hit && action.balloonPoppedItemName && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.balloonPoppedItemName}
          {iGa(action.balloonPoppedItemName)} 터졌다!
        </div>
      )}
      {!action.blockedReason && !action.hits && action.abilityDisabledMoveName && (
        <div className="battle-turn-line is-muted">
          {abilityDisabledMoveLine(
            action.abilityDisableAbilityName,
            action.abilityDisabledMoveName,
            actorName,
            defenderName,
          )}
        </div>
      )}
      {/* 나쁜손버릇 — 접촉기로 피격당한 방어측이 공격자의 도구를 빼앗았을 때 */}
      {!action.blockedReason && !action.hits && action.pickpocketStolenItemName && (
        <div className="battle-turn-line is-muted">
          {abilityPickpocketLine(
            action.pickpocketAbilityName,
            action.pickpocketStolenItemName,
            actorName,
            defenderName,
          )}
        </div>
      )}
      {/* 지구력·깨어진갑옷 등 — 피격 시 방어측 특성이 자기 랭크를 바꿨을 때
          (Phase 6.5 §6-2 ③ / §6-1). 깨어진갑옷은 방어↓·스피드↑가 같이 오므로 줄을 나눠 낸다.
          내림 줄에서 특성 이름을 한 번 알리고, 오름 줄은 이름 없이 결과만. */}
      {!action.blockedReason &&
        !action.hits &&
        ((action.abilityLoweredDefenderStats?.length ?? 0) > 0 ||
          (action.abilityRaisedDefenderStats?.length ?? 0) > 0) &&
        (() => {
          const { lowered, raised } = abilityDefenderStatsLines(
            action.abilityRaisedDefenderStatsAbilityName,
            action.abilityLoweredDefenderStats ?? [],
            action.abilityRaisedDefenderStats ?? [],
            defenderName,
          );
          return (
            <>
              {lowered && <div className="battle-turn-line is-muted">{lowered}</div>}
              {raised && <div className="battle-turn-line is-muted">{raised}</div>}
            </>
          );
        })()}
      {/* 타오르는불꽃/피뢰침 — 해당 타입 기술을 통째로 무효화(데미지는 이미 0으로
          찍혀있어 별도 표시가 없으면 "그냥 약해서 0"인지 구분이 안 되니 전용 문구로 알려준다) */}
      {!action.blockedReason && action.abilityAbsorbedMoveType && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.abilityAbsorbAbilityName}! {typeLabel(action.abilityAbsorbedMoveType)}
          {eunNeun(typeLabel(action.abilityAbsorbedMoveType))} 전혀 효과가 없었다!
          {!!action.abilityAbsorbHealAmount && <> 체력을 {action.abilityAbsorbHealAmount} 회복했다!</>}
        </div>
      )}
      {/* 방음 — 소리 기술을 통째로 무효화 */}
      {!action.blockedReason && action.soundproofBlockedByAbilityName && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.soundproofBlockedByAbilityName}! 소리 기술은 통하지 않는다!
        </div>
      )}
      {/* 방탄 — 구슬·폭탄 기술을 통째로 무효화 */}
      {!action.blockedReason && action.bulletproofBlockedByAbilityName && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.bulletproofBlockedByAbilityName}! 구슬·폭탄 기술은 통하지 않는다!
        </div>
      )}
      {/* 황금몸 — 명중한 변화기의 효과를 통째로 무효화(§4-5). 빗나감(C-5)과 헷갈리지
          않도록 battleSimulator에서 hit까지 확인해서 내려준다 */}
      {!action.blockedReason && action.goodAsGoldBlockedByAbilityName && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.goodAsGoldBlockedByAbilityName}!
          <br />
          {defenderName}에게 효과가 없는 듯하다...
        </div>
      )}
      {/* 아로마베일 — 헤롱헤롱·도발·기술봉인·앙코르를 막았을 때 */}
      {/* 내던지기(트랙 M5): 던진 도구와 맞은 상대에게 일어난 도구 효과 */}
      {action.flungItemName && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} {action.flungItemName}
          {eulReul(action.flungItemName)} 던졌다!
        </div>
      )}
      {action.flingEffect?.status && (
        <div className="battle-turn-line is-muted">{STATUS_ONSET_TEXT[action.flingEffect.status](defenderName)}</div>
      )}
      {action.flingEffect?.flinched && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} 풀이 죽었다!
        </div>
      )}
      {action.flingEffect?.berry && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} {action.flingEffect.berry.name}
          {eulReul(action.flingEffect.berry.name)} 먹었다!
          {action.flingEffect.berry.healed ? ` HP를 ${action.flingEffect.berry.healed} 회복했다!` : ""}
          {action.flingEffect.berry.curedStatus ? ` ${STATUS_CURE_TEXT[action.flingEffect.berry.curedStatus](defenderName)}` : ""}
          {action.flingEffect.berry.curedConfusion ? " 혼란이 풀렸다!" : ""}
        </div>
      )}
      {action.flingEffect?.herb && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} {action.flingEffect.herb.name}
          {roEuro(action.flingEffect.herb.name)} 상태를 원래대로 되돌렸다!
        </div>
      )}
      {/* 일격기(트랙 M5) */}
      {!action.blockedReason && action.hit && action.move.oneHitKo && action.damage > 0 && (
        <div className="battle-turn-line is-muted">일격필살!</div>
      )}
      {!action.blockedReason && action.hit && action.ohkoBlockedByAbilityName && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.ohkoBlockedByAbilityName}! 일격필살 기술은 통하지 않는다!
        </div>
      )}
      {!action.blockedReason && action.hit && action.ohkoImmune && (
        <div className="battle-turn-line is-muted">{defenderName}에게는 효과가 없는 것 같다...</div>
      )}
      {!action.blockedReason && action.volatileBlockedByAbility && (() => {
        const { abilityName, volatile, self } = action.volatileBlockedByAbility;
        const who = self ? actorName : defenderName;
        const label = VOLATILE_LABELS[volatile];
        return (
          <div className="battle-turn-line is-muted">
            {who}의 {abilityName}! {label}에 걸리지 않는다!
          </div>
        );
      })()}
      {!action.blockedReason && action.mentalMoveBlockedByAbilityName && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.mentalMoveBlockedByAbilityName}! 마음을 옭아매는 기술은 통하지 않는다!
        </div>
      )}
      {/* 미끈미끈·점착 — 접촉한 공격자의 랭크를 내렸을 때 */}
      {!action.blockedReason &&
        !action.hits &&
        action.abilityLoweredAttackerStatsAbilityName &&
        (action.abilityLoweredAttackerStats?.length ?? 0) > 0 &&
        (() => (
          <div className="battle-turn-line is-muted">
            {abilityLoweredAttackerStatsLine(
              action.abilityLoweredAttackerStatsAbilityName,
              action.abilityLoweredAttackerStats ?? [],
              actorName,
              defenderName,
            )}
          </div>
        ))()}
      {/* 뒤집어엎기 — 상대 능력 변화를 전부 반전 */}
      {!action.blockedReason && action.invertedTargetStages && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 능력 변화가 모두 반대로 뒤집혔다!
        </div>
      )}
      {/* 숲의저주·핼러윈 — 상대에게 타입 추가 */}
      {!action.blockedReason && action.addedTypeToTarget && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} {typeLabel(action.addedTypeToTarget)} 타입이 추가되었다!
        </div>
      )}
      {/* 송전 — 이번 턴 상대 기술 타입 강제 */}
      {!action.blockedReason && action.targetMoveTypeOverride && (
        <div className="battle-turn-line is-muted">
          송전되었다! 이번 턴 {defenderName}의 기술은 {typeLabel(action.targetMoveTypeOverride)} 타입이 된다!
        </div>
      )}
      {/* 볼주머니 — 나무열매를 먹어 추가 회복 */}
      {!action.blockedReason && !!action.cheekPouchHeal && (
        <div className="battle-turn-line is-muted">
          볼주머니! 체력을 {action.cheekPouchHeal} 회복했다!
        </div>
      )}
      {/* 소울비트 — HP 소비 / HP 부족 실패 */}
      {!action.blockedReason && action.soulBeatFailed && (
        <div className="battle-turn-line is-muted">하지만 HP가 부족해 실패했다!</div>
      )}
      {!action.blockedReason && !!action.soulBeatHpCost && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} 혼을 실어 HP를 {action.soulBeatHpCost} 소비했다!
        </div>
      )}
      {/* 부리캐논 — 가열 중 접촉기로 맞아 공격자 화상 */}
      {!action.blockedReason && action.beakBlastBurnedAttacker && (
        <div className="battle-turn-line is-muted">
          가열된 부리에 데어 {actorName}
          {eunNeun(actorName)} 화상을 입었다!
        </div>
      )}
      {/* 토치카 — 접촉기를 막고 공격자를 독으로 */}
      {!action.blockedReason && action.protectContactInflictedStatus === "poison" && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} 토치카의 독에 당했다!
        </div>
      )}
      {/* 발끈 — HP 절반 이하가 되어 방어측 특수공격 상승 */}
      {!action.blockedReason && action.angerPointRaisedSpa && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.angerPointAbilityName}! {defenderName}의 특수공격이 올라갔다!
        </div>
      )}
      {/* 떠도는영혼 — 접촉 피격으로 공격자와 특성 교환 */}
      {!action.blockedReason && !action.hits && action.wanderingSpiritSwapped && (
        <div className="battle-turn-line is-muted">{wanderingSpiritLine(actorName, defenderName)}</div>
      )}
      {/* 모래뿜기 — 피격으로 날씨 변경 */}
      {!action.blockedReason && !action.hits && action.sandSpitWeather && (
        <div className="battle-turn-line is-muted">
          {sandSpitWeatherLine(action.sandSpitWeather, defenderName)}
        </div>
      )}
      {/* PR-C2: 넘치는씨 — 피격으로 그래스필드 설정 */}
      {!action.blockedReason && !action.hits && action.seedSowerField && (
        <div className="battle-turn-line is-muted">
          {setFieldOnHitLine("넘치는씨", action.seedSowerField, defenderName)}
        </div>
      )}
      {/* PR-C4b: 시드류 — 이번 행동으로 필드가 새로 깔려 발동 */}
      {!action.blockedReason &&
        action.terrainSeedMessages?.map((m, i) => (
          <div key={`seed-${i}`} className="battle-turn-line is-muted">
            {m}
          </div>
        ))}
      {/* PR-C2: 해감액 — 흡수기가 회복 대신 데미지 */}
      {!action.blockedReason && action.hit && !!action.liquidOozeDamage && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.liquidOozeAbilityName ?? "해감액"}! {actorName}
          {eunNeun(actorName)} 체력을 흡수해 오히려 {action.liquidOozeDamage} 데미지를 입었다!
        </div>
      )}
      {/* 마법가루 — 상대 타입을 단일 타입으로 치환 */}
      {!action.blockedReason && action.overwroteTargetType && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} {typeLabel(action.overwroteTargetType)} 타입이 되었다!
        </div>
      )}
      {/* 전기로바꾸기 — 충전 상태로 전기 기술 위력 2배 */}
      {!action.blockedReason && action.electromorphosisEmpoweredAbilityName && (
        <div className="battle-turn-line is-muted">
          {actorName}의 {action.electromorphosisEmpoweredAbilityName}! 충전한 전기의 힘이 실렸다!
        </div>
      )}
      {/* 변덕레이저 — 확률 발동으로 위력 2배 */}
      {!action.blockedReason && action.fickleBeamEmpowered && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} 전력을 다하기 시작했다!
        </div>
      )}
      {/* 편승 — 상대의 랭크 상승을 그대로 복사 */}
      {!action.blockedReason &&
        action.opportunistAbilityName &&
        (action.opportunistCopiedStats?.length ?? 0) > 0 &&
        (() => {
          const copied = action.opportunistCopiedStats ?? [];
          const joined = copied.map((s) => STAT_LABELS[s.stat]).join(", ");
          return (
            <div className="battle-turn-line is-muted">
              {action.opportunistAbilityName}! 상대의 능력 상승에 편승해서 {joined}
              {iGa(joined)} 올라갔다!
            </div>
          );
        })()}
      {/* 정리정돈 — 설치물·대타 정리 완료 */}
      {!action.blockedReason && action.tidyUpDone && (
        <div className="battle-turn-line is-muted">정리정돈 끝!</div>
      )}
      {/* 소금절이 — 상대를 소금절이 상태로 */}
      {!action.blockedReason && action.saltCureApplied && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} 소금에 절여졌다!
        </div>
      )}
      {/* 인분 — 데미지 기술의 추가효과(상태이상·풀죽음·랭크하락·왕의징표석 풀죽음)를
          무산시켰을 때. 실제로 무산된 게 있을 때만 채워진다 */}
      {!action.blockedReason && action.secondaryBlockedByAbilityName && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.secondaryBlockedByAbilityName}! 추가 효과를 받지 않는다!
        </div>
      )}
      {/* 대타출동 — 데미지 기술이 대타로 들어갔을 때. 깨졌는지 버텼는지에 따라 분기
          (접촉/특성 트리거가 발동하지 않는 이유이기도 함). */}
      {!action.blockedReason && action.hitSubstitute && (
        <div className="battle-turn-line is-muted">
          {action.substituteBroke ? "대타는 사라졌다!" : "대타가 대신 맞았다!"}
        </div>
      )}
      {/* 변화기 등이 대타에 통째로 막혀 본체에 아무것도 못 했을 때
          (데미지 자체가 없어 hitSubstitute가 안 뜸) — 소리 기술 제외. */}
      {!action.blockedReason && action.blockedBySubstituteMoveName && (
        <div className="battle-turn-line is-muted">
          {actorName}의 {action.blockedBySubstituteMoveName}
          {eunNeun(action.blockedBySubstituteMoveName)} 실패했다!
        </div>
      )}
      {/* 가루/포자 기술을 풀타입 상대에게 썼을 때 */}
      {!action.blockedReason && action.powderBlockedMoveName && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} 풀타입이라 {action.powderBlockedMoveName}
          {eunNeun(action.powderBlockedMoveName)} 통하지 않는다!
        </div>
      )}
      {/* 탈(Disguise) — 데미지를 통째로 무효화하고 그 반동으로 벗겨지며 데미지를 입는다.
          다단히트 나머지 타수는 이 필드 없이 정상적으로 데미지가 들어간다(첫 타만 무효화). */}
      {!action.blockedReason && action.hitNegatedByAbilityName && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.hitNegatedByAbilityName}! {defenderName}의 정체가 드러났다!{" "}
          {defenderName}
          {eunNeun(defenderName)} 반동으로 {action.disguiseRecoilDamage} 데미지를 입었다!
        </div>
      )}
      {/* 일루전(§6-1) — 기술 데미지를 받는 순간 위장이 풀린다 */}
      {action.illusionBrokenSpeciesId && (
        <div className="battle-turn-line is-muted">
          {getPokemon(action.illusionBrokenSpeciesId)?.name ?? "포켓몬"}의 일루전이 풀렸다!
        </div>
      )}
      {/* 흑안개 — 자신/상대 구분 없이 양쪽 다 초기화되는 유일한 랭크변화 효과라 전용 문구로 알려준다 */}
      {!action.blockedReason && action.resetAllStages && (
        <div className="battle-turn-line is-muted">양쪽의 능력 변화가 전부 원래대로 돌아갔다!</div>
      )}
      {/* 발버둥 반동은 상대 데미지와 별개의 수치라 자기 줄로 분리 */}
      {!action.blockedReason && action.move.id === STRUGGLE_MOVE.id && action.selfDamage > 0 && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} 반동으로 {action.selfDamage} 데미지를 입었다
        </div>
      )}
      {/* 플레어드라이브·웨이브태클 등 recoilFraction 기술의 반동. 발버둥과 계산 기준이
          달라 별도 필드(recoilDamage)로 표시한다 */}
      {!action.blockedReason && action.recoilDamage > 0 && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} 반동으로 {action.recoilDamage} 데미지를 입었다
        </div>
      )}
      {/* 생명의구슬처럼 도구가 주는 반동 — 데미지 기준 반동(recoilDamage)과 달리
          최대 HP 비율 고정이라 별도 필드(itemRecoilDamage)로 표시한다 */}
      {!action.blockedReason && !!action.itemRecoilDamage && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} {action.itemRecoilItemName}의 반동으로 {action.itemRecoilDamage} 데미지를 입었다
        </div>
      )}
      {/* E-2 무릎차기 반동 (빗나감·방어류·타입면역) */}
      {!!action.crashDamage && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} 의욕이 넘쳐 땅에 부딪혔다!
        </div>
      )}
      {/* E-3 철제광선 등 "사용하는 순간" 자해 */}
      {!!action.selfDamageOnUse && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} {action.move.name}의 반동으로 {action.selfDamageOnUse} 데미지를 입었다
        </div>
      )}
      {/* F-1 미러코트 반격 / 실패 */}
      {!action.blockedReason && !!action.counterDamage && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} 받은 데미지를 그대로 되돌려줬다! ({action.counterDamage} 데미지)
        </div>
      )}
      {!action.blockedReason && action.counterFailed && (
        <div className="battle-turn-line is-muted">{actorName}의 {action.move.name} - 그러나 실패했다!</div>
      )}
      {/* F-4 멸망의노래 */}
      {!action.blockedReason && action.perishSongStarted && (
        <div className="battle-turn-line is-muted">
          노래를 들은 모두가 3턴 후에 쓰러진다!
        </div>
      )}
      {!action.blockedReason && action.perishSongFailed && (
        <div className="battle-turn-line is-muted">{actorName}의 {action.move.name} - 그러나 실패했다!</div>
      )}
      {/* E-1 떨어뜨리기 등 상대 차징 캔슬 */}
      {!action.blockedReason && action.canceledTargetChargeMoveName && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} 땅으로 떨어져 {action.canceledTargetChargeMoveName}
          {iGa(action.canceledTargetChargeMoveName)} 캔슬됐다!
        </div>
      )}
      {/* E-4 미러아머 — 능력 다운 효과 반사 */}
      {!action.blockedReason && action.reflectedStatDropAbilityName && action.reflectedStatDrops && (
        <>
          <div className="battle-turn-line is-muted">
            {defenderName}의 {action.reflectedStatDropAbilityName}! 능력을 떨어뜨리는 효과를 되받아쳤다!
          </div>
          {(() => {
            const byDelta = new Map<number, string[]>();
            for (const d of action.reflectedStatDrops) {
              const labels = byDelta.get(d.delta) ?? [];
              labels.push(STAT_LABELS[d.stat]);
              byDelta.set(d.delta, labels);
            }
            return [...byDelta.entries()].map(([delta, labels]) => {
              const joined = labels.join(", ");
              return (
                <div key={`refl-${delta}`} className="battle-turn-line is-muted">
                  {actorName}의 {joined}
                  {iGa(joined)} {stageRiseAdverb(delta)}떨어졌다!
                </div>
              );
            });
          })()}
        </>
      )}
      {/* 나무열매(카리열매 등)로 이번 피격 데미지가 반감됐으면 알려준다 */}
      {!action.blockedReason && action.berryReducedDamageItemName && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.berryReducedDamageItemName}
          {roEuro(action.berryReducedDamageItemName)} 데미지가 절반으로 줄었다!
        </div>
      )}
      {/* 조개껍질방울 — 흡수기(drainHealAmount)와 별개 축이라 따로 표시 */}
      {!action.blockedReason && !!action.shellBellHealAmount && (
        <div className="battle-turn-line is-muted">
          {actorName}의 조개껍질방울로 체력을 {action.shellBellHealAmount} 회복했다!
        </div>
      )}
      {/* 과사열매 — PP 0이 된 기술을 즉시 복구 */}
      {!action.blockedReason && action.leppaRestoredPpItemName && (
        <div className="battle-turn-line is-muted">
          {actorName}의 {action.leppaRestoredPpItemName}
          {roEuro(action.leppaRestoredPpItemName)} {action.move.name}의 PP를 회복시켰다!
        </div>
      )}
      {/* 상태이상/혼란 즉시치료 나무열매 — curedStatus 문구와 별개로 "어떤 도구가 발동했는지"만 알려준다 */}
      {!action.blockedReason && action.statusCureBerryItemName && (
        <div className="battle-turn-line is-muted">
          {action.statusCureBerryItemName}
          {iGa(action.statusCureBerryItemName)} 발동했다!
        </div>
      )}
      {/* 자뭉열매/오랭열매 — 공격자/방어자 중 발동한 쪽만 표시 */}
      {!action.blockedReason && !!action.attackerBerryHealAmount && (
        <div className="battle-turn-line is-muted">
          {actorName}의 {action.attackerBerryHealItemName}
          {roEuro(action.attackerBerryHealItemName ?? "")} 체력을 {action.attackerBerryHealAmount} 회복했다!
        </div>
      )}
      {!action.blockedReason && !!action.defenderBerryHealAmount && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.defenderBerryHealItemName}
          {roEuro(action.defenderBerryHealItemName ?? "")} 체력을 {action.defenderBerryHealAmount} 회복했다!
        </div>
      )}
      {/* 기합의띠·기합의머리띠 — 기절할 데미지를 버티고 HP 1로 남았을 때 */}
      {!action.blockedReason && action.enduredItemName && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} {action.enduredItemName}
          {roEuro(action.enduredItemName)} 버텼다! (HP 1)
        </div>
      )}
      {/* 옹골참 — 기합의띠와 같은 문구지만 도구가 아니라 특성이 버텨줬을 때 */}
      {!action.blockedReason && action.enduredAbilityName && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} {action.enduredAbilityName}
          {roEuro(action.enduredAbilityName)} 버텼다! (HP 1)
        </div>
      )}
      {/* 버티기 — 기합의띠/옹골참과 같은 문구지만 방어류 기술이 버텨줬을 때 */}
      {!action.blockedReason && action.enduredProtectMoveName && (
        <div className="battle-turn-line is-muted">
          {defenderName}
          {eunNeun(defenderName)} {action.enduredProtectMoveName}
          {roEuro(action.enduredProtectMoveName)} 버텼다! (HP 1)
        </div>
      )}
      {/* 랭크업 기술 결과 — "OO의 공격이 크게 올라갔다!". 같은 폭으로 오른 스탯은 쉼표로
          묶어 한 줄로 낸다(Phase 6.5 §6-2 ⑥⑦, §6-3). */}
      {!action.blockedReason &&
        action.selfStatRises &&
        action.selfStatRises.length > 0 &&
        (() => {
          const byDelta = new Map<number, string[]>();
          for (const r of action.selfStatRises) {
            const labels = byDelta.get(r.delta) ?? [];
            labels.push(STAT_LABELS[r.stat]);
            byDelta.set(r.delta, labels);
          }
          return [...byDelta.entries()].map(([delta, labels]) => {
            const joined = labels.join(", ");
            return (
              <div key={`rise-${delta}`} className="battle-turn-line is-muted">
                {actorName}의 {joined}
                {iGa(joined)} {stageRiseAdverb(delta)}올라갔다!
              </div>
            );
          });
        })()}
      {/* 랭크업 상한 — 이미 +6이라 한 칸도 못 올랐을 때 */}
      {!action.blockedReason && action.selfStatsAtMax && action.selfStatsAtMax.length > 0 && (
        <div className="battle-turn-line is-muted">
          {actorName}의{" "}
          {action.selfStatsAtMax.map((s) => STAT_LABELS[s]).join(", ")}
          {eunNeun(action.selfStatsAtMax.map((s) => STAT_LABELS[s]).join(", "))} 더 이상 올라가지
          않는다!
        </div>
      )}
      {/* C-6 랭크다운 기술 결과 — "OO의 X가 (크게) 떨어졌다!". selfStatRises와 대칭.
          매직미러 반사면 시전자(actor) 자신에게 적용된 것 */}
      {!action.blockedReason &&
        action.opponentStatDrops &&
        action.opponentStatDrops.length > 0 &&
        (() => {
          const subject = action.bouncedMoveName ? actorName : defenderName;
          const byDelta = new Map<number, string[]>();
          for (const d of action.opponentStatDrops) {
            const labels = byDelta.get(d.delta) ?? [];
            labels.push(STAT_LABELS[d.stat]);
            byDelta.set(d.delta, labels);
          }
          return [...byDelta.entries()].map(([delta, labels]) => {
            const joined = labels.join(", ");
            return (
              <div key={`drop-${delta}`} className="battle-turn-line is-muted">
                {subject}의 {joined}
                {iGa(joined)} {stageRiseAdverb(delta)}떨어졌다!
              </div>
            );
          });
        })()}
      {/* §4-6 골드러시·오버히트·용성군 등 — 자기 대상 확정 랭크 하락 부가효과.
          opponentStatDrops와 같은 렌더 패턴, 주어만 항상 actorName. */}
      {!action.blockedReason &&
        action.selfStatDrops &&
        action.selfStatDrops.length > 0 &&
        (() => {
          const byDelta = new Map<number, string[]>();
          for (const d of action.selfStatDrops) {
            const labels = byDelta.get(d.delta) ?? [];
            labels.push(STAT_LABELS[d.stat]);
            byDelta.set(d.delta, labels);
          }
          return [...byDelta.entries()].map(([delta, labels]) => {
            const joined = labels.join(", ");
            return (
              <div key={`self-drop-${delta}`} className="battle-turn-line is-muted">
                {actorName}의 {joined}
                {iGa(joined)} {stageRiseAdverb(delta)}떨어졌다!
              </div>
            );
          });
        })()}
      {/* G: 방어/판별/킹실드 — "방어태세 돌입" → 상대가 자신을 겨냥했으면 "몸을 지켰다",
          아니면 "실패". 버티기/길동무는 별도 문구 축을 유지한다. */}
      {!action.blockedReason && action.protectStanceEntered && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} 방어태세에 들어갔다!
        </div>
      )}
      {!action.blockedReason && action.protectStanceEntered && action.protectSucceeded && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} 공격으로부터 몸을 지켜냈다!
        </div>
      )}
      {!action.blockedReason && action.protectStanceEntered && action.protectFailed && (
        <div className="battle-turn-line is-muted">{actorName}의 방어는 실패했다!</div>
      )}
      {!action.blockedReason &&
        !action.protectStanceEntered &&
        action.protectSucceeded &&
        action.move.protectEffect !== "destinyBond" && (
          <div className="battle-turn-line is-muted">
            {actorName}
            {eunNeun(actorName)} {action.move.name}로 몸을 지켰다!
          </div>
        )}
      {!action.blockedReason && action.protectSucceeded && action.move.protectEffect === "destinyBond" && (
        <div className="battle-turn-line is-muted">
          {actorName}는 상대를 길동무로 삼으려 한다!
        </div>
      )}
      {!action.blockedReason && !action.protectStanceEntered && action.protectFailed && (
        <div className="battle-turn-line is-muted">
          {actorName}의 {action.move.name}{eunNeun(action.move.name)} 실패했다!
        </div>
      )}
      {/* 공격이 상대의 방어류 기술에 완전히 막혔을 때 — 이 행동(공격측)의 로그에 표시 */}
      {!action.blockedReason && action.blockedByProtectMoveName && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.blockedByProtectMoveName}
          {roEuro(action.blockedByProtectMoveName)} 막혔다!
        </div>
      )}
      {/* 킹실드 — 접촉기를 막아내 공격측의 공격이 떨어졌을 때 */}
      {!action.blockedReason &&
        action.protectContactPenaltyMoveName &&
        !action.protectContactDamage && (
          <div className="battle-turn-line is-muted">
            {actorName}
            {eunNeun(actorName)} 접촉한 반동으로 공격이 떨어졌다!
          </div>
        )}
      {/* 니들가드 — 접촉기를 막아내 공격측이 가시에 데미지를 입었을 때 */}
      {!action.blockedReason && !!action.protectContactDamage && (
        <div className="battle-turn-line is-muted">
          {actorName}
          {eunNeun(actorName)} {action.protectContactPenaltyMoveName}의 가시에 부딪혀{" "}
          {action.protectContactDamage} 데미지를 입었다!
        </div>
      )}
      {/* 하양허브 — 자신/상대 어느 쪽에서 발동했는지 따로 표시 */}
      {!action.blockedReason && action.restoredStatsSelfItemName && (
        <div className="battle-turn-line is-muted">
          {actorName}의 {action.restoredStatsSelfItemName}
          {roEuro(action.restoredStatsSelfItemName)} 떨어진 능력을 원래대로 되돌렸다!
        </div>
      )}
      {!action.blockedReason && action.restoredStatsOpponentItemName && (
        <div className="battle-turn-line is-muted">
          {defenderName}의 {action.restoredStatsOpponentItemName}
          {roEuro(action.restoredStatsOpponentItemName)} 떨어진 능력을 원래대로 되돌렸다!
        </div>
      )}
      {/* 상대가 쓰러졌는지 여부 — 데미지 수치와 분리된 별도 상태 줄 */}
      {!action.blockedReason && action.fainted && (
        <div className="battle-turn-line is-fainted">
          {defenderName}
          {eunNeun(defenderName)} 쓰러졌다
        </div>
      )}
      {/* D-2 길동무 — "삼았다!" 한 줄 + "쓰러졌다" 한 줄로 분리 */}
      {action.selfFainted && action.triggeredDestinyBond && (
        <>
          <div className="battle-turn-line is-muted">
            {defenderName}
            {eunNeun(defenderName)} {actorName}
            {eulReul(actorName)} 길동무로 삼았다!
          </div>
          <div className="battle-turn-line is-fainted">
            {actorName}
            {eunNeun(actorName)} 쓰러졌다
          </div>
        </>
      )}
      {/* 자신이 쓰러졌는지 여부(자폭류·발버둥 반동·혼란 자멸) — 원인을 그대로 붙인다 */}
      {action.selfFainted && !action.triggeredDestinyBond && (
        <div className="battle-turn-line is-fainted">
          {actorName}
          {eunNeun(actorName)}{" "}
          {action.blockedReason === "confusion"
            ? "혼란으로 인한 데미지"
            : `${action.move.name}의 여파`}
          로 쓰러졌다
        </div>
      )}
    </>
  );
}
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
              // 강제 교체는 actions·endOfTurn이 비고 switches만 있는 합성 카드 — 제목을 다르게 준다.
              const isForcedSwitchCard =
                turn.switches.length > 0 && turn.actions.length === 0 && turn.endOfTurn.length === 0 && !turn.winner;
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
