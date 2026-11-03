import { useState } from "react";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import { environmentTintBackground } from "../lib/environmentBackground";
import "./EnvPicker.css";

type Screen = "reflect" | "lightScreen" | "auroraVeil";
type Tab = "weather" | "field" | "screen" | "room";

const WEATHERS: WeatherKind[] = ["쾌청", "비", "모래바람", "눈"];
const FIELDS: FieldKind[] = ["그래스필드", "미스트필드", "사이코필드", "일렉트릭필드"];
const SCREEN_LABELS: Record<Screen, string> = { reflect: "리플렉터", lightScreen: "빛의장막", auroraVeil: "오로라베일" };
const SCREENS = Object.keys(SCREEN_LABELS) as Screen[];
const ROOMS = ["트릭룸"]; // 원더룸 등은 여기에 추가
const TABS: { id: Tab; label: string }[] = [
  { id: "weather", label: "날씨" },
  { id: "field", label: "필드" },
  { id: "screen", label: "스크린" },
  { id: "room", label: "룸" },
];

/** 스크린이 걸린 쪽 — 막대의 왼쪽 반이 내 쪽, 오른쪽 반이 상대 쪽(보드의 좌·우와 같다). 누를 때마다 none → mine → opp → both → none */
const SIDES = ["none", "mine", "opp", "both"] as const;
type Side = (typeof SIDES)[number];
const SIDE_TEXT: Record<Side, string> = { none: "꺼짐", mine: "내 쪽", opp: "상대 쪽", both: "양쪽" };

interface EnvPickerProps {
  weather: WeatherKind | null | undefined;
  onWeather: (v: WeatherKind | null) => void;
  field: FieldKind | null | undefined;
  onField: (v: FieldKind | null) => void;
  room: string | null;
  onRoom: (v: string | null) => void;
  mineScreen: Screen | undefined;
  oppScreen: Screen | undefined;
  onMineScreen: (v: Screen | undefined) => void;
  onOppScreen: (v: Screen | undefined) => void;
}

/** 계산 기능 헤더의 날씨·필드·스크린·룸 선택기 — 가로 헤더 + 선택한 헤더의 알약 줄 + 적용 중 요약 */
export function EnvPicker(p: EnvPickerProps) {
  const [open, setOpen] = useState<Tab | null>(null);
  // 색조는 유리 배경 위에 겹쳐야 해서 backgroundImage로 준다(단색이면 같은 색 그라데이션으로 감싼다)
  const tint = environmentTintBackground(p.weather, p.field);

  const sideOf = (s: Screen): Side => SIDES[(p.mineScreen === s ? 1 : 0) + (p.oppScreen === s ? 2 : 0)];
  function cycleScreen(s: Screen) {
    const next = SIDES[(SIDES.indexOf(sideOf(s)) + 1) % 4];
    const mine = next === "mine" || next === "both";
    const opp = next === "opp" || next === "both";
    // 한 쪽에는 스크린이 하나뿐이라, 이 스크린이 걸리는 쪽만 바꾸고 다른 스크린이 걸린 쪽은 그대로 둔다
    p.onMineScreen(mine ? s : p.mineScreen === s ? undefined : p.mineScreen);
    p.onOppScreen(opp ? s : p.oppScreen === s ? undefined : p.oppScreen);
  }

  const activeScreens = SCREENS.filter((s) => sideOf(s) !== "none");
  const has: Record<Tab, boolean> = { weather: !!p.weather, field: !!p.field, screen: activeScreens.length > 0, room: !!p.room };

  function single<T extends string>(options: readonly T[], value: T | null | undefined, onChange: (v: T | null) => void) {
    return options.map((o) => (
      <button key={o} type="button" aria-pressed={value === o} className={`env-pill tap-target${value === o ? " is-active" : ""}`} onClick={() => onChange(value === o ? null : o)}>
        {o}
      </button>
    ));
  }

  return (
    <div className="env-picker" style={tint ? { backgroundImage: tint.startsWith("linear") ? tint : `linear-gradient(${tint}, ${tint})` } : undefined}>
      <div className="env-heads">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-expanded={open === t.id} className={`env-head tap-target${open === t.id ? " is-open" : ""}${has[t.id] ? " has-value" : ""}`} onClick={() => setOpen(open === t.id ? null : t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {open && (
        <div className="env-pills">
          {open === "weather" && single(WEATHERS, p.weather, p.onWeather)}
          {open === "field" && single(FIELDS, p.field, p.onField)}
          {open === "room" && single(ROOMS, p.room, p.onRoom)}
          {open === "screen" &&
            SCREENS.map((s) => {
              const side = sideOf(s);
              return (
                <button key={s} type="button" aria-pressed={side !== "none"} aria-label={`${SCREEN_LABELS[s]}, ${SIDE_TEXT[side]}`} className={`env-pill tap-target${side !== "none" ? " is-active" : ""}`} onClick={() => cycleScreen(s)}>
                  {SCREEN_LABELS[s]}
                  <i className="env-side" data-side={side} aria-hidden="true" />
                </button>
              );
            })}
        </div>
      )}
      {(p.weather || p.field || activeScreens.length > 0 || p.room) && (
        <p className="env-summary">
          {p.weather && <span>{p.weather}</span>}
          {p.field && <span>{p.field}</span>}
          {activeScreens.map((s) => (
            <span key={s} aria-label={`${SCREEN_LABELS[s]}, ${SIDE_TEXT[sideOf(s)]}`}>
              {SCREEN_LABELS[s]}
              <i className="env-side" data-side={sideOf(s)} aria-hidden="true" />
            </span>
          ))}
          {p.room && <span>{p.room}</span>}
        </p>
      )}
    </div>
  );
}
