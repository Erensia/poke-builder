import { ActionEffectLines } from "./ActionEffectLines";
import { ActionMainLineHead, ActionMainLineField, ActionMainLineTail, MoveUseLabel, type ActionMainLineProps } from "./actionMainLineParts";
import { reflectedView } from "./reflectedView";


/**
 * 행동 한 건의 메인 라인 — 누가 무슨 기술을 써서 어떻게 됐는지("빗나감"/데미지 수치)까지만
 * 한 줄에 모은다. 기절 같은 "상태"는 이 컴포넌트 밖(호출부)에서 별도 줄로 분리한다. `action`의
 * ~50개 optional 필드를 조건부로 읽는 게 전부라 클로저 의존 없이(호출부가 넘겨주는 다섯 개
 * props만으로) 그대로 뗄 수 있었다.
 */
export function ActionMainLine(props: ActionMainLineProps) {
  return (
    <div className="battle-turn-line">
      <ActionMainLineHead {...props} />
      <ActionMainLineField {...props} />
      <ActionMainLineTail {...props} />
    </div>
  );
}

/**
 * 행동 한 건의 로그 줄 — 메인 줄 + 효과 줄. 매직미러로 반사된 행동이면 3줄로 나눈다: ① 원래 시전자의 기술 줄 ② 방어측의 특성 안내 ③ 방어측이 되받아친 줄(+ 효과).
 * ③과 효과 줄은 방어측이 사용자·시전자가 대상인 사본(reflectedView)으로 그려 대상 이름·"상대 편 필드"가 엔진 처리와 맞는다.
 */
export function ActionLines(props: ActionMainLineProps) {
  const { action, actorName, defenderName, percentOnly } = props;
  if (!action.bouncedMoveName) {
    return (
      <>
        <ActionMainLine {...props} />
        <ActionEffectLines action={action} actorName={actorName} defenderName={defenderName} percentOnly={percentOnly} />
      </>
    );
  }
  const r = reflectedView(props);
  return (
    <>
      <div className="battle-turn-line">
        <MoveUseLabel action={action} actorName={actorName} />
      </div>
      <div className="battle-turn-line is-muted">
        {defenderName}의 {action.bouncedByAbilityName}!
      </div>
      <ActionMainLine {...r} headVariant="bounced" />
      <ActionEffectLines action={r.action} actorName={r.actorName} defenderName={r.defenderName} percentOnly={percentOnly} />
    </>
  );
}
