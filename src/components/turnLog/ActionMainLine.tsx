import { type ReactNode } from "react";
import { type ActionLogEntry, type FighterKey } from "../../lib/battleSimulator";
import { statOrAccuracyLabel } from "../../lib/statLabels";
import { eunNeun, iGa, eulReul, waGwa, roEuro } from "../../lib/josa";
import { VOLATILE_LABELS, SCREEN_LABELS } from "../../lib/battleLogLabels";
import { FIELD_ENTRY_ANNOUNCEMENT } from "../../lib/fieldEffects";
import { CHARGE_TURN_MESSAGE, WEATHER_MOVE_LINES } from "../../lib/battleLogText";
import { abilityMummifiedLine } from "./abilityLines";

/** 액션 로그 한 줄 안에 "OO 발동!"으로 뭉뚱그리기보다 전용 문구를 따로 쓰는 volatile들 */
const VOLATILES_WITH_DEDICATED_LOG_LINE = new Set(["drowsy", "wish", "encore", "imprison", "meanLook", "lockOn", "noRetreat"]);

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
export function ActionMainLine({
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
        const label = statOrAccuracyLabel(stat);
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
