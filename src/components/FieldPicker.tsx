import type { FieldKind } from "../types/field";
import "./FieldPicker.css";

const FIELDS: FieldKind[] = ["그래스필드", "미스트필드", "사이코필드", "일렉트릭필드"];

interface FieldPickerProps {
  field: FieldKind | null;
  onChange: (field: FieldKind | null) => void;
}

export function FieldPicker({ field, onChange }: FieldPickerProps) {
  return (
    <div className="field-picker">
      <span className="field-picker-label">필드</span>
      <div className="field-picker-options">
        <button
          type="button"
          className={`field-chip${field === null ? " is-active" : ""}`}
          onClick={() => onChange(null)}
        >
          없음
        </button>
        {FIELDS.map((f) => (
          <button
            key={f}
            type="button"
            className={`field-chip${field === f ? " is-active" : ""}`}
            onClick={() => onChange(f)}
          >
            {f}
          </button>
        ))}
      </div>
    </div>
  );
}
