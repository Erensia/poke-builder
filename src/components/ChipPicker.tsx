import "./ChipPicker.css";

interface ChipPickerProps<T> {
  label: string;
  options: readonly T[];
  /** 고른 값(없으면 null/undefined). 켜진 칩을 다시 누르면 onChange(null)로 해제한다 */
  value: T | null | undefined;
  onChange: (value: T | null) => void;
  /** 칩에 보일 글자(생략하면 값 그대로) */
  textOf?: (option: T) => string;
}

/** 계산 기능 헤더의 날씨·필드·스크린 선택기 — 칩 토글 한 줄 */
export function ChipPicker<T extends string>({ label, options, value, onChange, textOf }: ChipPickerProps<T>) {
  return (
    <div className="chip-picker">
      <span className="chip-picker-label">{label}</span>
      <div className="chip-picker-options">
        {options.map((o) => (
          <button key={o} type="button" className={`chip-picker-chip tap-target${value === o ? " is-active" : ""}`} onClick={() => onChange(value === o ? null : o)}>
            {textOf ? textOf(o) : o}
          </button>
        ))}
      </div>
    </div>
  );
}
