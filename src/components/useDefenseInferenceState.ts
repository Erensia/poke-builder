import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { NEUTRAL_STAGES } from "../types/battleStats";
import { useSlotSwapDnd } from "../hooks/useSlotSwapDnd";
import { getAbility, getMove, getPokemon } from "../lib/data";
import { getEffectiveForm } from "../lib/pokemonForm";
import { inferCombined } from "../lib/combinedInference";
import {
  DEFENSE_ABILITY_CANDIDATES,
  inferenceUnsupportedReason,
  TOXIC_ID,
  ITEM_END_TURN_IDS,
  type InferenceInput,
  type InferenceObservation,
} from "../lib/defenseInference";
import { ATTACK_ABILITY_CANDIDATES, attackInferenceUnsupportedReason, type AttackInferenceInput, type AttackObservation } from "../lib/attackInference";
import {
  NEUTRAL_SPEED_CONDITIONS,
  SPEED_ABILITY_CANDIDATES,
  type SpeedConditions,
  type SpeedInferenceInput,
  type SpeedObservation,
} from "../lib/speedInference";
import { computeRealStats } from "../lib/statCalculator";
import { loadMatchupDraft, saveMatchupDraft } from "../lib/storage";
import { restoreInference, type ObservationRow, type RowKind } from "../lib/inferenceDraft";
import {
  hitsOf,
  megaOf,
  parseHp,
  parsePercent,
  followValue,
  followRows,
  relevantAbilities,
  type DefenseInferencePanelProps,
} from "./defenseInferenceHelpers";

/** DefenseInferencePanel의 상태·핸들러 — 화면(JSX)이 쓰는 값만 돌려준다 */
export function useDefenseInferenceState({
  attackerCard,
  attacker,
  defender,
  defenderActions,
  onSwapDrop,
  weather,
  field,
  onReset,
}: DefenseInferencePanelProps) {
  const { dropProps, dragProps, dragOverClass } = useSlotSwapDnd("defender", onSwapDrop);
  const [saved] = useState(() => restoreInference(loadMatchupDraft().inference));
  const [rows, setRows] = useState<ObservationRow[]>(saved.rows);
  const [nextId, setNextId] = useState(saved.rows.length + 1);
  const [movePickerRow, setMovePickerRow] = useState<number | null>(null);
  const [abilityId, setAbilityId] = useState<string>(saved.abilityId);
  const [itemId, setItemId] = useState<string>(saved.itemId);
  const [defStage, setDefStage] = useState(saved.defStage);
  const [spdStage, setSpdStage] = useState(saved.spdStage);
  const [tolerant, setTolerant] = useState(saved.tolerant);
  // 내가 받은 데미지 관측용 가정(3.1 C2-b) — 상대 공격 보정 특성·도구, 상대 공격·특공 랭크, 상대 화상
  const [atkAbilityId, setAtkAbilityId] = useState<string>(saved.atkAbilityId);
  const [atkItemId, setAtkItemId] = useState<string>(saved.atkItemId);
  const [atkStage, setAtkStage] = useState(saved.atkStage);
  const [spaStage, setSpaStage] = useState(saved.spaStage);
  const [oppBurned, setOppBurned] = useState(saved.oppBurned);
  // 벽은 위쪽 "내 쪽/상대 쪽 스크린" 선택기 값 — 입힌 데미지는 상대 쪽, 받은 데미지는 내 쪽
  const screen = defender.screen ?? "";
  const myScreen = attacker.screen ?? "";

  useEffect(() => {
    saveMatchupDraft({
      inference: { rows, abilityId, itemId, defStage, spdStage, tolerant, atkAbilityId, atkItemId, atkStage, spaStage, oppBurned } satisfies ReturnType<typeof restoreInference>,
    });
  }, [rows, abilityId, itemId, defStage, spdStage, tolerant, atkAbilityId, atkItemId, atkStage, spaStage, oppBurned]);

  const attackerPokemon = attacker.pokemonId ? getPokemon(attacker.pokemonId) : undefined;
  const defenderPokemon = defender.pokemonId ? getPokemon(defender.pokemonId) : undefined;
  // 메가폼은 관측 줄마다 이 화면 안에서만 고른다(공유 슬롯·메가스톤 도구와 무관). 종이 바뀌어 없는 폼이면 메가 전으로 본다.
  const megas = defenderPokemon?.megaEvolutions;
  const defenderForm = defenderPokemon ? getEffectiveForm(defenderPokemon, { ...defender, item: null, activeMegaForm: undefined }) : undefined;

  const abilityOptions = defenderPokemon ? relevantAbilities(defenderPokemon, DEFENSE_ABILITY_CANDIDATES) : [];
  // 종이 바뀌면 그 종이 가질 수 없는 특성 가정은 자동으로 해제
  const activeAbilityId = abilityOptions.includes(abilityId) ? abilityId : "";
  const atkAbilityOptions = defenderPokemon ? relevantAbilities(defenderPokemon, ATTACK_ABILITY_CANDIDATES) : [];
  const activeAtkAbilityId = atkAbilityOptions.includes(atkAbilityId) ? atkAbilityId : "";
  // 내 포켓몬(받는 쪽)의 실제 최대 HP — 내가 받은 데미지 줄의 "맞기 전 HP" 기본값·검사 안내에 쓴다
  const myMaxHp = attackerPokemon ? computeRealStats(getEffectiveForm(attackerPokemon, attacker).baseStats, attacker.points, attacker.nature).hp : null;

  function updateRow(id: number, patch: Partial<ObservationRow>) {
    setRows((prev) => {
      const index = prev.findIndex((r) => r.id === id);
      if (index < 0) return prev;
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      // 메가진화는 되돌릴 수 없다(3.1 L1-a): 이 줄을 메가 후로 고르면 뒤의 모든 줄도 같은 메가 후 폼으로 맞춘다
      if (patch.megaForm) for (let j = index + 1; j < next.length; j++) next[j] = { ...next[j], megaForm: patch.megaForm };
      // 메가스톤을 들고 있으니 도구 효과(먹다남은음식·자뭉열매)는 모든 줄에서 끈다
      if (patch.megaForm) for (let j = 0; j < next.length; j++) next[j] = { ...next[j], endTurn: next[j].endTurn.filter((id) => !ITEM_END_TURN_IDS.includes(id)) };
      return patch.after !== undefined || patch.endTurn !== undefined || patch.megaForm ? followRows(prev, next) : next;
    });
  }

  /** 가장 가까운 선후공 줄의 조건 — 새 선후공 줄이 이어받는다(턴마다 크게 안 바뀌는 조건이 많아서) */
  const lastSpeedCond = () => [...rows].reverse().find((r) => r.kind === "speed")?.cond ?? NEUTRAL_SPEED_CONDITIONS;

  function addRow() {
    const last = rows[rows.length - 1];
    // 메가진화는 되돌릴 수 없어서 새 줄은 직전 줄의 폼을 이어받는다
    setRows([
      ...rows,
      {
        id: nextId,
        kind: last?.kind ?? "dealt",
        moveId: null,
        critical: false,
        hits: "",
        before: last?.kind === "speed" ? "" : last ? followValue(last) : "100",
        after: "",
        endTurn: [],
        megaForm: last ? megaOf(last, megas) : "",
        first: "me",
        cond: lastSpeedCond(),
      },
    ]);
    setNextId(nextId + 1);
  }

  /** 줄 종류를 바꾸면 고른 기술(다른 포켓몬의 기술)·값 입력을 비운다 — 받은 데미지는 맞기 전 HP를 내 최대 HP로 채워 둔다 */
  function changeKind(id: number, kind: RowKind) {
    updateRow(id, {
      kind,
      moveId: null,
      hits: "",
      endTurn: [],
      before: kind === "received" ? String(myMaxHp ?? "") : kind === "speed" ? "" : "100",
      after: "",
      cond: lastSpeedCond(),
    });
  }

  function updateCond(id: number, patch: Partial<SpeedConditions>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, cond: { ...r.cond, ...patch } } : r)));
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  // 완성된 줄(기술 + 두 %)만 계산에 넣는다
  const complete = useMemo(() => {
    const out: { row: ObservationRow; obs: InferenceObservation }[] = [];
    const defenderMegas = defender.pokemonId ? getPokemon(defender.pokemonId)?.megaEvolutions : undefined;
    for (const row of rows) {
      if (row.kind !== "dealt") continue;
      const move = row.moveId ? getMove(row.moveId) : undefined;
      const before = parsePercent(row.before);
      const after = parsePercent(row.after);
      if (move && before !== null && after !== null) out.push({ row, obs: { move, critical: row.critical, before, after, hits: hitsOf(row), endTurn: row.endTurn, megaForm: megaOf(row, defenderMegas) || undefined } });
    }
    return out;
  }, [rows, defender.pokemonId]);

  // 완성된 "내가 받은 데미지" 줄(상대 기술 + 내 HP 두 수치)
  const completeReceived = useMemo(() => {
    const out: { row: ObservationRow; obs: AttackObservation }[] = [];
    const opponentMegas = defender.pokemonId ? getPokemon(defender.pokemonId)?.megaEvolutions : undefined;
    for (const row of rows) {
      if (row.kind !== "received") continue;
      const move = row.moveId ? getMove(row.moveId) : undefined;
      const hpBefore = parseHp(row.before);
      const hpAfter = parseHp(row.after);
      if (move && hpBefore !== null && hpAfter !== null) {
        out.push({ row, obs: { move, critical: row.critical, hpBefore, hpAfter, hits: hitsOf(row), megaForm: megaOf(row, opponentMegas) || undefined } });
      }
    }
    return out;
  }, [rows, defender.pokemonId]);

  // 어느 종류 줄에서든 쓰인 메가폼 — 세 역산 모두에 넘겨 메가 전·후 비교(3.1 L1-b)를 같은 폼 목록으로 만든다. 문자열 키로 만들어 값이 같으면 배열도 그대로 둔다
  const megaKey = [...new Set(rows.map((r) => megaOf(r, megas)).filter(Boolean))].join("|");
  const viewMegaForms = useMemo(() => (megaKey ? megaKey.split("|") : []), [megaKey]);

  const input = useMemo<InferenceInput | null>(() => {
    if (!attacker.pokemonId || !defender.pokemonId || complete.length === 0) return null;
    return {
      attacker: { ...attacker, pokemonId: attacker.pokemonId },
      // 메가진화한 관측은 특성을 메가폼 값으로 계산하고, 하나라도 있으면 메가스톤이라 반감 열매 가정을 쓰지 못한다(엔진 쪽 처리)
      defender: {
        ...defender,
        pokemonId: defender.pokemonId,
        activeMegaForm: undefined,
        ability: activeAbilityId || null,
        item: itemId || null,
      },
      observations: complete.map((c) => c.obs),
      attackerStages: attacker.stages,
      attackerStatus: attacker.statusAssumed ?? null,
      defenderStages: { ...NEUTRAL_STAGES, def: defStage, spd: spdStage },
      weather: weather ?? undefined,
      field: field ?? undefined,
      screen: screen || undefined,
      tolerance: tolerant ? 1 : 0,
      viewMegaForms,
    };
  }, [attacker, defender, complete, activeAbilityId, itemId, weather, field, screen, defStage, spdStage, tolerant, viewMegaForms]);

  const anyMega = complete.some((c) => c.obs.megaForm);
  const rowIdsByObservation = complete.map((c) => rows.indexOf(c.row) + 1);

  // 상대 공격(특공) 역산(3.1 C2-b) — 내 포켓몬이 맞는 쪽, 상대가 때리는 쪽
  const anyMegaReceived = completeReceived.some((c) => c.obs.megaForm);
  const attackInput = useMemo<AttackInferenceInput | null>(() => {
    if (!attacker.pokemonId || !defender.pokemonId || completeReceived.length === 0) return null;
    return {
      attacker: {
        ...defender,
        pokemonId: defender.pokemonId,
        activeMegaForm: undefined,
        ability: activeAtkAbilityId || null,
        item: anyMegaReceived ? null : atkItemId || null,
      },
      defender: { ...attacker, pokemonId: attacker.pokemonId },
      observations: completeReceived.map((c) => c.obs),
      attackerStages: { ...NEUTRAL_STAGES, atk: atkStage, spa: spaStage },
      attackerStatus: oppBurned ? "burn" : null,
      defenderStages: attacker.stages,
      weather: weather ?? undefined,
      field: field ?? undefined,
      screen: myScreen || undefined,
      viewMegaForms,
    };
  }, [attacker, defender, completeReceived, anyMegaReceived, activeAtkAbilityId, atkItemId, atkStage, spaStage, oppBurned, weather, field, myScreen, viewMegaForms]);
  // 상대 스피드 역산(3.1 C2-c) — 선후공 줄은 항상 완성(누가 먼저만 고르면 됨). 조건은 줄마다 다르다.
  const speedRows = useMemo(() => rows.filter((r) => r.kind === "speed"), [rows]);
  const speedAbilityOptions = defenderPokemon ? relevantAbilities(defenderPokemon, SPEED_ABILITY_CANDIDATES) : [];
  const myQuickFeet = getAbility(attacker.ability ?? "")?.speedMultiplierWhenStatused !== undefined;
  const anyMegaSpeed = speedRows.some((r) => megaOf(r, megas));
  const speedInput = useMemo<SpeedInferenceInput | null>(() => {
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
          myOtherStatus: myQuickFeet && r.cond.myOtherStatus,
        },
      };
    });
    return {
      // 상대: 종·폼만 쓰고 특성·도구는 줄별 조건에서 정한다. 나: 능력·특성·도구를 전부 아는 쪽
      attacker: { ...defender, pokemonId: defender.pokemonId, activeMegaForm: undefined, ability: null, item: null },
      defender: { ...attacker, pokemonId: attacker.pokemonId },
      defenderStages: attacker.stages,
      weather: weather ?? undefined,
      field: field ?? undefined,
      observations,
      viewMegaForms,
    };
  }, [attacker, defender, speedRows, weather, field, viewMegaForms, myQuickFeet]);

  // 계산이 무거울 수 있어(물리+특수 관측이 함께면 수십만 후보) 입력은 즉시 반영하고 결과만 뒤따라 그린다.
  // 방어·공격·스피드는 같이 계산해 성격을 공유하고 포인트 합계(66)를 따진다(3.1 C2-b·C2-c 결합).
  const deferredInput = useDeferredValue(input);
  const deferredAttackInput = useDeferredValue(attackInput);
  const deferredSpeedInput = useDeferredValue(speedInput);
  const combined = useMemo(
    () => inferCombined(deferredInput, deferredAttackInput, deferredSpeedInput),
    [deferredInput, deferredAttackInput, deferredSpeedInput],
  );
  const result = combined.defense;
  const attackResult = combined.attack;
  const speedResult = combined.speed;
  const pending = input !== deferredInput;
  const attackPending = attackInput !== deferredAttackInput;
  const speedPending = speedInput !== deferredSpeedInput;
  const receivedRowNos = completeReceived.map((c) => rows.indexOf(c.row) + 1);
  const speedRowNos = speedRows.map((r) => rows.indexOf(r) + 1);
  const hasReceivedRows = rows.some((r) => r.kind === "received");
  const hasDealtRows = rows.some((r) => r.kind === "dealt");

  /** 맹독 경과 턴(1~15, 0이면 해제) — 맹독 id는 `toxic<n>`이라 다른 효과와 따로 갈아 끼운다 */
  function setToxicTurn(row: ObservationRow, n: number) {
    updateRow(row.id, { endTurn: [...row.endTurn.filter((x) => !TOXIC_ID.test(x)), ...(n > 0 ? [`toxic${n}`] : [])] });
  }

  function rowMessage(row: ObservationRow): { text: string; kind: "error" | "ok" } | null {
    const move = row.moveId ? getMove(row.moveId) : undefined;
    if (row.kind === "received") return receivedRowMessage(row, move);
    if (row.kind === "speed") return speedRowMessage(row);
    if (move) {
      const reason = inferenceUnsupportedReason(move);
      if (reason) return { text: reason, kind: "error" };
    }
    const before = parsePercent(row.before);
    const after = parsePercent(row.after);
    if (row.after.trim() !== "" && after === null) return { text: "%는 0~100 정수", kind: "error" };
    if (before !== null && after !== null && after > before) return { text: "맞은 뒤 %가 더 클 수 없어요", kind: "error" };
    const index = complete.findIndex((c) => c.row.id === row.id);
    if (index >= 0 && result && !pending) {
      const message = result.observationErrors[index];
      if (message) return { text: message, kind: "error" };
      if (result.status !== "invalid" && result.singleFeasible[index] === false) {
        return { text: "이 관측만으로도 맞는 배분이 없어요", kind: "error" };
      }
      if (result.status === "ok" && result.singleFeasible[index]) return { text: "가능", kind: "ok" };
    }
    return null;
  }

  function speedRowMessage(row: ObservationRow): { text: string; kind: "error" | "ok" } | null {
    const index = speedRows.findIndex((r) => r.id === row.id);
    if (index < 0 || !speedResult || speedPending) return null;
    const message = speedResult.observationErrors[index];
    if (message) return { text: message, kind: "error" };
    if (speedResult.status !== "invalid" && speedResult.singleFeasible[index] === false) return { text: "이 관측만으로도 맞는 스피드가 없어요", kind: "error" };
    if (speedResult.status === "ok" && speedResult.singleFeasible[index]) return { text: "가능", kind: "ok" };
    return null;
  }

  function receivedRowMessage(row: ObservationRow, move: ReturnType<typeof getMove>): { text: string; kind: "error" | "ok" } | null {
    if (move) {
      const reason = attackInferenceUnsupportedReason(move);
      if (reason) return { text: reason, kind: "error" };
    }
    const before = parseHp(row.before);
    const after = parseHp(row.after);
    if ((row.before.trim() !== "" && before === null) || (row.after.trim() !== "" && after === null)) return { text: "HP는 정수", kind: "error" };
    if (before !== null && myMaxHp !== null && before > myMaxHp) return { text: `최대 HP(${myMaxHp})보다 클 수 없어요`, kind: "error" };
    if (before !== null && after !== null && after >= before) return { text: "맞은 뒤 HP가 더 작아야 해요", kind: "error" };
    const index = completeReceived.findIndex((c) => c.row.id === row.id);
    if (index >= 0 && attackResult && !attackPending) {
      const message = attackResult.observationErrors[index];
      if (message) return { text: message, kind: "error" };
      if (attackResult.status !== "invalid" && attackResult.singleFeasible[index] === false) return { text: "이 관측만으로도 맞는 배분이 없어요", kind: "error" };
      if (attackResult.status === "ok" && attackResult.singleFeasible[index]) return { text: after === 0 ? "가능 (쓰러져서 최소 데미지로 계산)" : "가능", kind: "ok" };
    }
    return null;
  }

  return { weather, field, attackerCard, defenderPokemon, defenderForm, dragOverClass, dropProps, defenderActions, dragProps, defender, hasDealtRows, activeAbilityId, setAbilityId, anyMega, abilityOptions, itemId, setItemId, defStage, setDefStage, spdStage, setSpdStage, tolerant, setTolerant, hasReceivedRows, activeAtkAbilityId, setAtkAbilityId, anyMegaReceived, atkAbilityOptions, atkItemId, setAtkItemId, atkStage, setAtkStage, spaStage, setSpaStage, oppBurned, setOppBurned, rows, rowMessage, megas, attackerPokemon, changeKind, updateRow, setMovePickerRow, removeRow, setToxicTurn, updateCond, speedAbilityOptions, anyMegaSpeed, myQuickFeet, addRow, onReset, myMaxHp, pending, attackPending, speedPending, result, attackResult, speedResult, rowIdsByObservation, receivedRowNos, combined, speedRowNos, complete, myScreen, movePickerRow, attacker };
}
