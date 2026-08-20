import type { WeatherKind } from "../types/weather";
import "./WeatherPicker.css";

const WEATHERS: WeatherKind[] = ["쾌청", "비", "모래바람", "눈"];

interface WeatherPickerProps {
  weather: WeatherKind | null;
  onChange: (weather: WeatherKind | null) => void;
}

export function WeatherPicker({ weather, onChange }: WeatherPickerProps) {
  return (
    <div className="weather-picker">
      <span className="weather-picker-label">날씨</span>
      <div className="weather-picker-options">
        <button
          type="button"
          className={`weather-chip${weather === null ? " is-active" : ""}`}
          onClick={() => onChange(null)}
        >
          없음
        </button>
        {WEATHERS.map((w) => (
          <button
            key={w}
            type="button"
            className={`weather-chip${weather === w ? " is-active" : ""}`}
            onClick={() => onChange(w)}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}
