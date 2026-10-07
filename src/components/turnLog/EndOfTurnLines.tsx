import { type FighterKey, type TurnResult } from "../../lib/battleSimulator";
import type { EndOfTurnLogEntry } from "../../types/battle";
import { STAT_LABELS } from "../../lib/statLabels";
import { eunNeun, iGa, eulReul } from "../../lib/josa";
import { VOLATILE_LABELS, SCREEN_LABELS } from "../../lib/battleLogLabels";
import { STATUS_ONSET_TEXT, STATUS_TRIGGER_TEXT, STATUS_CURE_TEXT } from "../../lib/battleLogText";

/** 마이페이스·둔감이 턴 끝에 푼 행동방해(ver.2.0 틀깨기 목록 수정) */
const ABILITY_CURED_VOLATILE_TEXT: Record<"confusion" | "attract" | "taunt", string> = {
  confusion: "혼란이 풀렸다!",
  attract: "헤롱헤롱 상태가 풀렸다!",
  taunt: "도발이 풀렸다!",
};

/**
 * 턴 종료 처리 한 줄(회복/상태이상 틱/카운트다운 등 §6의 22개 메커니즘에 대응) — `entry` 하나와
 * 이름 조회용 `turnName`만 있으면 렌더 가능해 다른 섹션과 데이터 의존이 없다. `entry`의 어느
 * 필드가 채워져 있는지로 어떤 메커니즘인지 분기(엔진의 `finishTurn.ts` 실행 순서와 무관 —
 * 이미 끝난 결과를 필드 유무로 표시만 함).
 */
export function EndOfTurnLine({
  entry: e,
  turnName,
}: {
  entry: EndOfTurnLogEntry;
  turnName: (key: FighterKey) => string;
}) {
  return (
    <div className="battle-turn-line is-muted">
      {e.cudChewBerryName ? (
        <>
          {turnName(e.actor)}의 되새김질! {e.cudChewBerryName}
          {eulReul(e.cudChewBerryName)} 한 번 더 먹었다!
          {e.berryHeal ? ` HP ${e.berryHeal} 회복 (남은 HP ${e.remainingHp})` : ""}
          {e.abilityCuredStatus ? " 상태이상이 나았다!" : ""}
        </>
      ) : e.fieldHeal ? (
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
      ) : e.abilityCuredStatus || e.abilityCuredVolatiles ? (
        <>
          {turnName(e.actor)}의 {e.abilityCuredStatusAbilityName}!
          {e.abilityCuredStatus ? ` ${STATUS_CURE_TEXT[e.abilityCuredStatus](turnName(e.actor))}` : ""}
          {(e.abilityCuredVolatiles ?? []).map((v) => ` ${ABILITY_CURED_VOLATILE_TEXT[v]}`).join("")}
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
export function TurnFooterLines({
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
