interface PillRowProps<T> {
  /** 있으면 "라벨 + 알약 줄" 한 덩어리(matchup-assume-grave), 없으면 알약 줄만 */
  label?: string;
  options: readonly { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
  /** 알약 줄에 더 붙일 클래스 */
  rowClass?: string;
}

/** 결정력·역산·스피드·내구 조정 카드가 같이 쓰는 알약 버튼 줄 — 값이 같은 알약이 켜진 상태(is-active) */
export function PillRow<T>({ label, options, value, onChange, rowClass }: PillRowProps<T>) {
  const row = (
    <div className={`matchup-hitcount-row${rowClass ? ` ${rowClass}` : ""}`}>
      {options.map((o) => (
        <button key={o.label} type="button" className={`matchup-hitcount-pip${o.value === value ? " is-active" : ""}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
  if (!label) return row;
  return (
    <div className="matchup-assume-grave">
      <span className="matchup-assume-grave-label">{label}</span>
      {row}
    </div>
  );
}
