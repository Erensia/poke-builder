import type { MegaEvolution, Pokemon } from "../types/pokemon";
import type { ReactNode } from "react";
import type { MatchupSlot } from "../types/matchup";
import type { WeatherKind } from "../types/weather";
import type { FieldKind } from "../types/field";
import { getAbility, getItem } from "../lib/data";
import type { Ability } from "../types/ability";
import { endTurnSixteenths } from "../lib/defenseInference";
import type { SpeedConditions } from "../lib/speedInference";
import type { ObservationRow } from "../lib/inferenceDraft";

export interface DefenseInferencePanelProps {
  /** 내 포켓몬 카드 (MatchupSlotCard 재사용 — 기술 슬롯은 숨긴 채 넘어온다) */
  attackerCard: ReactNode;
  attacker: MatchupSlot;
  defender: MatchupSlot;
  defenderActions: DefenderActions;
  /** 내 포켓몬 ⇄ 상대 포켓몬 드래그 교체(3.3 U1) */
  onSwapDrop: () => void;
  weather: WeatherKind | null;
  field: FieldKind | null;
  /** 관측·가정 입력을 모두 지운다(저장본 포함) — 부모가 이 패널을 새로 띄운다 */
  onReset: () => void;
}

interface DefenderActions {
  onPickPokemon: () => void;
  onClear: () => void;
  onCycleFormVariant: () => void;
  onCycleSizeForm: () => void;
}

export const STAGE_OPTIONS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];

/** 선후공 줄의 조건 중 기본값과 다른 것을 짧게 이름 붙인다(접힌 "조건" 요약줄용) */
export function describeConditions(c: SpeedConditions): string[] {
  const out: string[] = [];
  if (c.trickRoom) out.push("트릭룸");
  if (c.myTailwind) out.push("내 순풍");
  if (c.oppTailwind) out.push("상대 순풍");
  if (c.myParalyzed) out.push("내 마비");
  if (c.oppParalyzed) out.push("상대 마비");
  if (c.myOtherStatus) out.push("내 상태이상");
  if (c.oppOtherStatus) out.push("상대 상태이상");
  if (c.oppStage !== 0) out.push(`상대 스피드 ${c.oppStage > 0 ? "+" : ""}${c.oppStage}랭크`);
  if (c.oppItemId) out.push(getItem(c.oppItemId)?.name ?? c.oppItemId);
  if (c.oppAbilityId) out.push(getAbility(c.oppAbilityId)?.name ?? c.oppAbilityId);
  if (c.oppUnburden) out.push("곡예 발동 후");
  return out;
}

export const PART_LABELS = { defense: "내가 입힌 데미지(방어)", attack: "내가 받은 데미지(공격)", speed: "선후공(스피드)" } as const;

/** 줄에 고른 메가폼이 이 종에 실제로 있는 폼이면 그 이름, 아니면 메가 전("") */
/** 줄에 고른 다단히트 타수(3.3 V4) — 안 골랐으면 undefined(타수가 정해진 기술은 계산 쪽에서 채운다) */
export const hitsOf = (row: ObservationRow) => (row.hits ? Number(row.hits) : undefined);

export function megaOf(row: ObservationRow, megas: MegaEvolution[] | undefined): string {
  return megas?.find((m) => m.form === row.megaForm)?.form ?? "";
}

export function parseHp(text: string): number | null {
  return /^\d{1,4}$/.test(text.trim()) ? Number(text) : null;
}

export function parsePercent(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const v = Number(text);
  return v >= 0 && v <= 100 ? v : null;
}

/**
 * 다음 줄 "맞기 전 %"의 기본값(4.0 F2) — 맞은 뒤 %에 턴 종료 효과의 회복·피해(16분율 합 ÷ 16, 반올림)를 더한 예상치.
 * 효과를 안 골랐거나 값이 비었으면 맞은 뒤 값 그대로. 실제 화면 %와 1쯤 어긋날 수 있어 직접 고칠 수 있다.
 */
export function followValue(row: ObservationRow): string {
  const after = parsePercent(row.after);
  if (row.kind !== "dealt" || after === null) return row.after;
  const sum = endTurnSixteenths(row.endTurn).reduce((a, b) => a + b, 0);
  return sum === 0 ? row.after : String(Math.min(100, Math.max(0, after + Math.round((sum * 100) / 16))));
}

/** 줄을 바꾼 뒤, 다음 줄(같은 종류)의 "맞기 전 값"이 직접 안 고친 값(옛 기본값)이었으면 새 기본값으로 따라가게 한다 */
export function followRows(prev: ObservationRow[], next: ObservationRow[]): ObservationRow[] {
  return next.map((r, i) => (i > 0 && r.kind === next[i - 1].kind && prev[i].before === followValue(prev[i - 1]) ? { ...r, before: followValue(next[i - 1]) } : r));
}

/** 이 종(폼 변종 포함)이 가질 수 있는 특성 중 후보 목록(방어·공격 영향 특성)에 드는 것 */
export function relevantAbilities(pokemon: Pokemon, candidates: Ability[]): string[] {
  const names = new Set<string>();
  const add = (list: string[], hidden?: string) => {
    list.forEach((a) => names.add(a));
    if (hidden) names.add(hidden);
  };
  add(pokemon.abilities, pokemon.hiddenAbility);
  pokemon.formVariants?.forEach((f) => add(f.abilities, f.hiddenAbility));
  const relevant = new Set(candidates.map((a) => a.id));
  return [...names].filter((id) => relevant.has(id));
}
