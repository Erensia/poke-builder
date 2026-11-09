import { NEUTRAL_STAGES } from "../types/battleStats";
import { getMove, getPokemon } from "../lib/data";
import { inferCombined } from "../lib/combinedInference";
import { inferenceUnsupportedReason, type InferenceInput, type InferenceObservation } from "../lib/defenseInference";
import { attackInferenceUnsupportedReason, type AttackInferenceInput, type AttackObservation } from "../lib/attackInference";
import { SPEED_ABILITY_CANDIDATES, type SpeedInferenceInput, type SpeedObservation } from "../lib/speedInference";
import type { ObservationRow } from "../lib/inferenceDraft";
import { megaOf, parseHp, parsePercent, relevantAbilities, type DefenseInferencePanelProps } from "./defenseInferenceHelpers";

/**
 * useDefenseInferenceState에서 뺀 순수 계산(7.0 R-3) — 훅의 상태·메모를 값으로 받아 입력 객체와 줄 안내 문구를 만든다.
 * 입력 객체의 정체성(useMemo 의존성)은 훅이 그대로 쥐고 있어서, 여기로 옮겨도 계산 시점·결과는 같다.
 */
type Slot = DefenseInferencePanelProps["attacker"];
type Weather = DefenseInferencePanelProps["weather"];
type Field = DefenseInferencePanelProps["field"];
type Combined = ReturnType<typeof inferCombined>;
type RowMessage = { text: string; kind: "error" | "ok" } | null;

/** 방어 역산 입력 — 내가 입힌 데미지 줄이 하나도 없으면 null */
export function buildDefenseInput(p: {
  attacker: Slot;
  defender: Slot;
  complete: { obs: InferenceObservation }[];
  activeAbilityId: string;
  itemId: string;
  weather: Weather;
  field: Field;
  screen: Slot["screen"] | "";
  defStage: number;
  spdStage: number;
  tolerant: boolean;
  viewMegaForms: string[];
}): InferenceInput | null {
  const { attacker, defender } = p;
  if (!attacker.pokemonId || !defender.pokemonId || p.complete.length === 0) return null;
  return {
    attacker: { ...attacker, pokemonId: attacker.pokemonId },
    // 메가진화한 관측은 특성을 메가폼 값으로 계산하고, 하나라도 있으면 메가스톤이라 반감 열매 가정을 쓰지 못한다(엔진 쪽 처리)
    defender: {
      ...defender,
      pokemonId: defender.pokemonId,
      activeMegaForm: undefined,
      ability: p.activeAbilityId || null,
      item: p.itemId || null,
    },
    observations: p.complete.map((c) => c.obs),
    attackerStages: attacker.stages,
    attackerStatus: attacker.statusAssumed ?? null,
    defenderStages: { ...NEUTRAL_STAGES, def: p.defStage, spd: p.spdStage },
    weather: p.weather ?? undefined,
    field: p.field ?? undefined,
    screen: p.screen || undefined,
    tolerance: p.tolerant ? 1 : 0,
    viewMegaForms: p.viewMegaForms,
  };
}

/** 상대 공격(특공) 역산 입력(3.1 C2-b) — 내 포켓몬이 맞는 쪽, 상대가 때리는 쪽. 받은 데미지 줄이 없으면 null */
export function buildAttackInput(p: {
  attacker: Slot;
  defender: Slot;
  completeReceived: { obs: AttackObservation }[];
  anyMegaReceived: boolean;
  activeAtkAbilityId: string;
  atkItemId: string;
  atkStage: number;
  spaStage: number;
  oppBurned: boolean;
  weather: Weather;
  field: Field;
  myScreen: Slot["screen"] | "";
  viewMegaForms: string[];
}): AttackInferenceInput | null {
  const { attacker, defender } = p;
  if (!attacker.pokemonId || !defender.pokemonId || p.completeReceived.length === 0) return null;
  return {
    attacker: {
      ...defender,
      pokemonId: defender.pokemonId,
      activeMegaForm: undefined,
      ability: p.activeAtkAbilityId || null,
      item: p.anyMegaReceived ? null : p.atkItemId || null,
    },
    defender: { ...attacker, pokemonId: attacker.pokemonId },
    observations: p.completeReceived.map((c) => c.obs),
    attackerStages: { ...NEUTRAL_STAGES, atk: p.atkStage, spa: p.spaStage },
    attackerStatus: p.oppBurned ? "burn" : null,
    defenderStages: attacker.stages,
    weather: p.weather ?? undefined,
    field: p.field ?? undefined,
    screen: p.myScreen || undefined,
    viewMegaForms: p.viewMegaForms,
  };
}

/** 상대 스피드 역산 입력(3.1 C2-c) — 선후공 줄은 항상 완성(누가 먼저만 고르면 됨). 조건은 줄마다 다르다. 스피드 줄이 없으면 null */
export function buildSpeedInput(p: {
  attacker: Slot;
  defender: Slot;
  speedRows: ObservationRow[];
  myQuickFeet: boolean;
  weather: Weather;
  field: Field;
  viewMegaForms: string[];
}): SpeedInferenceInput | null {
  const { attacker, defender, speedRows } = p;
  const opponent = defender.pokemonId ? getPokemon(defender.pokemonId) : undefined;
  if (!attacker.pokemonId || !defender.pokemonId || !opponent || speedRows.length === 0) return null;
  const abilityOptions = relevantAbilities(opponent, SPEED_ABILITY_CANDIDATES);
  const observations: SpeedObservation[] = speedRows.map((r) => {
    // 종이 바뀌어 그 종이 가질 수 없는 특성 가정은 해제하고, 곡예가 아니면 발동 후 체크는 무시
    const oppAbilityId = r.cond.oppAbilityId && abilityOptions.includes(r.cond.oppAbilityId) ? r.cond.oppAbilityId : null;
    return {
      first: r.first,
      megaForm: megaOf(r, opponent.megaEvolutions) || undefined,
      conditions: {
        ...r.cond,
        oppAbilityId,
        oppUnburden: oppAbilityId === "곡예" && r.cond.oppUnburden,
        oppOtherStatus: oppAbilityId === "속보" && r.cond.oppOtherStatus,
        myOtherStatus: p.myQuickFeet && r.cond.myOtherStatus,
      },
    };
  });
  return {
    // 상대: 종·폼만 쓰고 특성·도구는 줄별 조건에서 정한다. 나: 능력·특성·도구를 전부 아는 쪽
    attacker: { ...defender, pokemonId: defender.pokemonId, activeMegaForm: undefined, ability: null, item: null },
    defender: { ...attacker, pokemonId: attacker.pokemonId },
    defenderStages: attacker.stages,
    weather: p.weather ?? undefined,
    field: p.field ?? undefined,
    observations,
    viewMegaForms: p.viewMegaForms,
  };
}

/** 관측 줄 아래에 보이는 오류·가능 안내가 읽는 값 — 훅이 렌더마다 만들어 넘긴다 */
interface RowMessageCtx {
  complete: { row: ObservationRow }[];
  completeReceived: { row: ObservationRow }[];
  speedRows: ObservationRow[];
  result: Combined["defense"];
  pending: boolean;
  attackResult: Combined["attack"];
  attackPending: boolean;
  speedResult: Combined["speed"];
  speedPending: boolean;
  myMaxHp: number | null;
}

export function rowMessageOf(row: ObservationRow, c: RowMessageCtx): RowMessage {
  const move = row.moveId ? getMove(row.moveId) : undefined;
  if (row.kind === "received") return receivedRowMessage(row, move, c);
  if (row.kind === "speed") return speedRowMessage(row, c);
  if (move) {
    const reason = inferenceUnsupportedReason(move);
    if (reason) return { text: reason, kind: "error" };
  }
  const before = parsePercent(row.before);
  const after = parsePercent(row.after);
  if (row.after.trim() !== "" && after === null) return { text: "%는 0~100 정수", kind: "error" };
  if (before !== null && after !== null && after > before) return { text: "맞은 뒤 %가 더 클 수 없어요", kind: "error" };
  const index = c.complete.findIndex((x) => x.row.id === row.id);
  if (index >= 0 && c.result && !c.pending) {
    const message = c.result.observationErrors[index];
    if (message) return { text: message, kind: "error" };
    if (c.result.status !== "invalid" && c.result.singleFeasible[index] === false) {
      return { text: "이 관측만으로도 맞는 배분이 없어요", kind: "error" };
    }
    if (c.result.status === "ok" && c.result.singleFeasible[index]) return { text: "가능", kind: "ok" };
  }
  return null;
}

function speedRowMessage(row: ObservationRow, c: RowMessageCtx): RowMessage {
  const index = c.speedRows.findIndex((r) => r.id === row.id);
  if (index < 0 || !c.speedResult || c.speedPending) return null;
  const message = c.speedResult.observationErrors[index];
  if (message) return { text: message, kind: "error" };
  if (c.speedResult.status !== "invalid" && c.speedResult.singleFeasible[index] === false) return { text: "이 관측만으로도 맞는 스피드가 없어요", kind: "error" };
  if (c.speedResult.status === "ok" && c.speedResult.singleFeasible[index]) return { text: "가능", kind: "ok" };
  return null;
}

function receivedRowMessage(row: ObservationRow, move: ReturnType<typeof getMove>, c: RowMessageCtx): RowMessage {
  if (move) {
    const reason = attackInferenceUnsupportedReason(move);
    if (reason) return { text: reason, kind: "error" };
  }
  const before = parseHp(row.before);
  const after = parseHp(row.after);
  if ((row.before.trim() !== "" && before === null) || (row.after.trim() !== "" && after === null)) return { text: "HP는 정수", kind: "error" };
  if (before !== null && c.myMaxHp !== null && before > c.myMaxHp) return { text: `최대 HP(${c.myMaxHp})보다 클 수 없어요`, kind: "error" };
  if (before !== null && after !== null && after >= before) return { text: "맞은 뒤 HP가 더 작아야 해요", kind: "error" };
  const index = c.completeReceived.findIndex((x) => x.row.id === row.id);
  if (index >= 0 && c.attackResult && !c.attackPending) {
    const message = c.attackResult.observationErrors[index];
    if (message) return { text: message, kind: "error" };
    if (c.attackResult.status !== "invalid" && c.attackResult.singleFeasible[index] === false) return { text: "이 관측만으로도 맞는 배분이 없어요", kind: "error" };
    if (c.attackResult.status === "ok" && c.attackResult.singleFeasible[index]) return { text: after === 0 ? "가능 (쓰러져서 최소 데미지로 계산)" : "가능", kind: "ok" };
  }
  return null;
}
