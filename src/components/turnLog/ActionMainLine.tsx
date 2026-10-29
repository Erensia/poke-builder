import { ActionMainLineHead, ActionMainLineField, ActionMainLineTail, type ActionMainLineProps } from "./actionMainLineParts";


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
