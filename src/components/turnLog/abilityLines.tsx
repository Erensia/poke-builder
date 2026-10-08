import { type ReactNode } from "react";
import { type HitAbilityEvent } from "../../lib/battleSimulator";
import { STAT_LABELS } from "../../lib/statLabels";
import { eunNeun, iGa, eulReul, waGwa, roEuro } from "../../lib/josa";
import { VOLATILE_LABELS } from "../../lib/battleLogLabels";
import { stageRiseAdverb, STATUS_ONSET_TEXT } from "../../lib/battleLogText";

/**
 * 방어측 on-hit 특성 효과 한 줄의 "내용"만 만드는 함수들(감싸는 div·key는 호출부 책임) —
 * 다단히트 집계(HitAbilityEvent, 타별로 여러 번 발동 가능)와 단일히트(ActionLogEntry의 개별
 * `ability*` 필드, 최대 1회)가 문구는 완전히 동일해서(§5와 같은 이유로 대조 확인 완료) 공유한다.
 */
export function abilityStatusLine(
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

export function abilityVolatileLine(
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

export function abilityDamageLine(
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
export function abilityDefenderStatsLines(
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

export function abilityLoweredAttackerStatsLine(
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

export function abilityDisabledMoveLine(
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

export function abilityPickpocketLine(
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

export function abilityMummifiedLine(abilityName: string, actorName: string, defenderName: string): ReactNode {
  return (
    <>
      {defenderName}의 {abilityName}! {actorName}의 특성이 미라가 되었다!
    </>
  );
}

export function wanderingSpiritLine(actorName: string, defenderName: string): ReactNode {
  return (
    <>
      {defenderName}의 떠도는영혼! {actorName}
      {eunNeun(actorName)} {defenderName}
      {waGwa(defenderName)} 특성을 맞바꿨다!
    </>
  );
}

export function sandSpitWeatherLine(
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

export function setFieldOnHitLine(
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
export function hitAbilityEventLines(
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
