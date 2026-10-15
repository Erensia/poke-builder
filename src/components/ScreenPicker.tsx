import type { MatchupSlot } from "../types/matchup";
import "./FieldPicker.css";

type Screen = MatchupSlot["screen"];

const SCREENS: [NonNullable<Screen>, string][] = [
  ["reflect", "리플렉터"],
  ["lightScreen", "빛의장막"],
  ["auroraVeil", "오로라베일"],
];

interface ScreenPickerProps {
  /** "내 쪽" / "상대 쪽" — 스크린은 편마다 걸려서 방향을 라벨로 구분한다 */
  label: string;
  screen: Screen;
  onChange: (screen: Screen) => void;
}

/** 날씨·필드 선택기와 같은 모양(FieldPicker.css)의 스크린 선택기 — 켜진 칩을 다시 누르면 꺼진다 */
export function ScreenPicker({ label, screen, onChange }: ScreenPickerProps) {
  return (
    <div className="field-picker">
      <span className="field-picker-label">{label}</span>
      <div className="field-picker-options">
        {SCREENS.map(([value, text]) => (
          <button key={text} type="button" className={`field-chip${screen === value ? " is-active" : ""}`} onClick={() => onChange(screen === value ? undefined : value)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
