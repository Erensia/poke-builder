import { getAbility, getItem, getMove } from "./data";
import { NEUTRAL_SPEED_CONDITIONS, type SpeedConditions } from "./speedInference";

/** 역산 탭 입력의 저장·복원(3.2 V2) — 화면 파일에서 분리(컴포넌트 파일은 컴포넌트만 내보낸다) */

export type Screen = "reflect" | "lightScreen" | "auroraVeil";

/** dealt = 내가 입힌 데미지(상대 HP %) → 상대 HP·방어 역산, received = 내가 받은 데미지(내 HP 수치) → 상대 공격 역산, speed = 선후공 → 상대 스피드 역산 */
export type RowKind = "dealt" | "received" | "speed";

export interface ObservationRow {
  id: number;
  kind: RowKind;
  moveId: string | null;
  critical: boolean;
  before: string;
  after: string;
  /** 이 관측을 맞을 때 상대가 메가진화한 폼("" = 메가 전) */
  megaForm: string;
  /** 선후공 줄: 이번 턴 먼저 움직인 쪽 */
  first: "me" | "opponent";
  /** 선후공 줄: 이 관측의 조건(행마다 따로) */
  cond: SpeedConditions;
}

const SCREENS: readonly unknown[] = ["reflect", "lightScreen", "auroraVeil"] satisfies Screen[];
const ROW_KINDS: readonly unknown[] = ["dealt", "received", "speed"] satisfies RowKind[];

function firstRow(): ObservationRow {
  return { id: 1, kind: "dealt", moveId: null, critical: false, before: "100", after: "", megaForm: "", first: "me", cond: NEUTRAL_SPEED_CONDITIONS };
}

/**
 * 저장된 입력을 불러온다(3.2 V2) — 새로고침·탭 이동에도 관측이 남게. localStorage는 믿을 수 없는 입력이라
 * 모양이 깨졌거나 데이터에서 사라진 id는 기본값으로 바꾼다. 줄 id는 1부터 다시 매긴다.
 */
export function restoreInference(raw: unknown) {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const stage = (v: unknown) => (Number.isInteger(v) && Math.abs(v as number) <= 6 ? (v as number) : 0);
  const screenOf = (v: unknown): Screen | "" => (SCREENS.includes(v) ? (v as Screen) : "");
  const idOf = (v: unknown, exists: (id: string) => unknown) => (typeof v === "string" && exists(v) ? v : "");
  const rows = (Array.isArray(d.rows) ? d.rows : []).flatMap((item, index): ObservationRow[] => {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (!ROW_KINDS.includes(r.kind)) return [];
    const c = (r.cond && typeof r.cond === "object" ? r.cond : {}) as Record<string, unknown>;
    const cond: Record<string, unknown> = { ...NEUTRAL_SPEED_CONDITIONS };
    for (const k of Object.keys(cond)) if (typeof c[k] === "boolean" && typeof cond[k] === "boolean") cond[k] = c[k];
    cond.oppStage = stage(c.oppStage);
    cond.oppItemId = idOf(c.oppItemId, getItem) || null;
    cond.oppAbilityId = idOf(c.oppAbilityId, getAbility) || null;
    return [
      {
        id: index + 1,
        kind: r.kind as RowKind,
        moveId: idOf(r.moveId, getMove) || null,
        critical: r.critical === true,
        before: str(r.before),
        after: str(r.after),
        megaForm: str(r.megaForm),
        first: r.first === "opponent" ? "opponent" : "me",
        cond: cond as unknown as SpeedConditions,
      },
    ];
  });
  return {
    rows: rows.length > 0 ? rows : [firstRow()],
    abilityId: idOf(d.abilityId, getAbility),
    itemId: idOf(d.itemId, getItem),
    screen: screenOf(d.screen),
    defStage: stage(d.defStage),
    spdStage: stage(d.spdStage),
    tolerant: d.tolerant === true,
    atkAbilityId: idOf(d.atkAbilityId, getAbility),
    atkItemId: idOf(d.atkItemId, getItem),
    atkStage: stage(d.atkStage),
    spaStage: stage(d.spaStage),
    oppBurned: d.oppBurned === true,
    myScreen: screenOf(d.myScreen),
  };
}
