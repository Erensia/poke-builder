import { useEffect, useRef, useState } from "react";
import { buildRandomPartyFromSlots } from "../../lib/randomSlotParty";
import { useBattleSeries } from "../../hooks/useBattleSeries";
import { useRankBattle } from "../../hooks/useRankBattle";
import { useBattleSetup, BATTLE_SELECT_SIZE } from "../../hooks/useBattleSetup";
import { useSlotPresets } from "../../hooks/useSlotPresets";
import { usePartyPresets } from "../../hooks/usePartyPresets";
import { useMySamples } from "../../hooks/useMySamples";
import { isUsableSample } from "../../lib/mySamples";
import { useBattleVideos } from "../../hooks/useBattleVideos";
import type { BattleVideo } from "../../types/battleVideo";
import { getPokemon, getMove, SAMPLE_PARTIES } from "../../lib/data";
import { eunNeun } from "../../lib/josa";
import { applySwitch } from "../../lib/battle/switching";
import { createBattleState, STRUGGLE_MOVE, type BattleState } from "../../lib/battle/state";
import { forcedLockedAction } from "../../lib/battle/lockedAction";
import { runTurn, resumeTurn } from "../../lib/battle/runTurn";
import type { FighterKey, TurnAction, TurnResult } from "../../types/battle";
import { chooseAiForcedSwitch, chooseAiSelection, sampleRiskAversion } from "../../lib/battle/ai";
import { RANK_AI_PROFILES } from "../../lib/battle/ai/rankProfile";
import { APP_DECISION_PARAMS, chooseAiActionAsync, prewarmAiWorker } from "../../lib/battle/ai/aiClient";
import { combinedMemory, emptyOpponentMemory, observeOpponent } from "../../lib/battle/ai/opponentMemory";
import { statusMoveIdsOf } from "../../lib/battle/ai";
import type { LevelOneDistribution } from "../../lib/battle/ai/levelOne";
import { useAiMemory } from "../../hooks/useAiMemory";
import type { PartySlot, PartySlots, SamplePartyPreset } from "../../types/party";
import { SLOT_INDICES, type InputModeState, type MegaDeclaredState, type PendingForcedSwitchState, type PendingPivotState, type PickerState, type SelectedState, type Side, type SlotIndex } from "./shared";
import { battleRules } from "./battleRules";

/** 배틀타워(free)와 랭크배틀(rank)이 같은 화면을 쓴다 — rank는 상대가 자동·AI 고정이고 결과가 랭크에 반영된다 */
export type BattleMode = "free" | "rank";

/** BattleLogPage의 상태·핸들러 — 화면(JSX)이 쓰는 값만 돌려준다 */
export function useBattleLogSession(mode: BattleMode) {
  const setup = useBattleSetup();
  const slotPresets = useSlotPresets();
  const partyPresets = usePartyPresets();
  const mySamples = useMySamples();
  const battleVideos = useBattleVideos(mode);
  // 배틀비디오 목록/다시보기 토글(§6). "list"면 목록 모달, BattleVideo 객체면 그 비디오의 로그를 보여준다.
  const [battleVideoView, setBattleVideoView] = useState<"list" | BattleVideo | null>(null);
  const [picker, setPicker] = useState<PickerState>(null);
  const [battleState, setBattleState] = useState<BattleState | null>(null);
  const [log, setLog] = useState<TurnResult[]>([]);
  const [selected, setSelected] = useState<SelectedState>({ a: null, b: null });
  // 대전 시작 시점의 편측 파티(선출 순서대로 압축). battleState 안의 slot은 EvaluatorSlot이라
  // 기술 4개 목록이 없어서, 활성 슬롯의 기술은 여기서 activeIndex로 되짚는다. 배틀 중엔 안 바뀜.
  const [partySlots, setPartySlots] = useState<{ a: PartySlot[]; b: PartySlot[] }>({ a: [], b: [] });
  // 이번 턴 처리 결과 활성 슬롯이 기절해 강제 교체가 필요한 편. 해소되면 null.
  const [pendingForcedSwitch, setPendingForcedSwitch] = useState<PendingForcedSwitchState>(null);
  // 유턴·볼트체인지·배턴터치(§7-2): 사용측 기술 데미지까지 처리하고 턴이 "멈춘" 상태. 이 편이
  // 교대할 포켓몬을 골라야 나머지 턴(상대 행동·턴 종료)이 새 포켓몬 기준으로 이어진다.
  // ctx는 엔진이 준 불투명 컨텍스트 — resumeTurn에 그대로 넘긴다.
  const [pendingPivot, setPendingPivot] = useState<PendingPivotState>(null);
  // 편별 턴 입력 모드 — "기술" 또는 "교체"
  const [inputMode, setInputMode] = useState<InputModeState>({ a: "move", b: "move" });
  // 구애스카프 잠금 위반으로 턴 진행이 막혔을 때 보여줄 경고 문구. 선택이 바뀌거나 턴이 정상
  // 진행되면 지운다.
  const [lockWarning, setLockWarning] = useState<string | null>(null);
  // 빌드(6슬롯) → 선출(3+순서) → 대전. selecting=true면 선출 화면(§3).
  const [selecting, setSelecting] = useState(false);
  // 각 편이 선출한 빌드 슬롯 인덱스 — 고른 순서대로(index 0 = 리드). 선출이 필요 없는 편
  // (유효 빌드 ≤ BATTLE_SELECT_SIZE)은 "다음"을 누른 시점에 빌드 순서대로 자동으로 채운다.
  const [selection, setSelection] = useState<{ a: SlotIndex[]; b: SlotIndex[] }>({ a: [], b: [] });
  // 이번 턴 메가진화를 선언했는지(§4). 매 턴 시작 시 꺼짐으로 초기화한다.
  const [megaDeclared, setMegaDeclared] = useState<MegaDeclaredState>({ a: false, b: false });
  // 배틀 AI: 셋업 화면 토글(상대 편을 AI가 조작할지)과, 대전 시작 시점에 확정된 AI 편·위험 회피 성향.
  // 위험 회피 성향은 대전마다 1회만 뽑아 끝까지 쓴다(decision-layer §5).
  const [aiOpponentChoice, setAiOpponent] = useState(true);
  // 랭크배틀은 사람이 양쪽을 조작해 승리를 만들 수 없게 AI 상대로 고정한다
  const aiOpponent = mode === "rank" || aiOpponentChoice;
  const [aiSide, setAiSide] = useState<Side | null>(null);
  const [aiRiskAversion, setAiRiskAversion] = useState(0.5);
  // AI 행동 계산 중(ver.2.0 2-B) — 요청 번호로, 계산 도중 초기화·새 대전이 시작되면 늦게 온 답을 버린다
  const [aiThinking, setAiThinking] = useState(false);
  const aiRequestRef = useRef(0);
  // 사용자 패턴 학습(ver.2.0 1-C): 누적본은 useAiMemory(localStorage), 이번 대전 관측은 세션 기록 — 대전이 끝나면 합친다
  const aiMemory = useAiMemory(mode);
  const aiSessionRef = useRef(emptyOpponentMemory());
  const [showAiMemory, setShowAiMemory] = useState(false);
  /** 이번 대전을 학습했으면 누적 판 수(결과 배너 한 줄), 아니면 null */
  const [learnedBattles, setLearnedBattles] = useState<number | null>(null);
  /** 배틀 프런티어(2.5 L4, 전 연속 대전) */
  const series = useBattleSeries(mySamples.samples);
  /** 랭크배틀(5.0 R1) — 프런티어와 별도 저장·연승 */
  const rank = useRankBattle();
  /** 프런티어 중 내 선출 고정 — 첫 판에 고른 빌드 슬롯 인덱스(프런티어를 새로 켜면 다시 고른다) */
  const [frontierSelection, setFrontierSelection] = useState<SlotIndex[] | null>(null);

  const sideCtls = (side: Side) => (side === "a" ? setup.a : setup.b);
  const slotCtl = (side: Side, i: SlotIndex) => sideCtls(side)[i];

  /** 기본 제공 샘플 파티(ver.2.1 B)를 한 진영에 사본으로 채운다 — 원본 데이터와 사용자 저장 파티는 그대로 */
  function loadSample(side: Side, sample: SamplePartyPreset) {
    setup.loadSide(side, structuredClone(sample.slots), sample.fixedPicks);
  }
  function loadRandomSample(side: Side) {
    // 기본 샘플 + 쓸 수 있는 내 샘플(3.1 S2)에서 무작위로 고른다
    const pool = [...SAMPLE_PARTIES, ...mySamples.samples.filter(isUsableSample)];
    loadSample(side, pool[Math.floor(Math.random() * pool.length)]);
  }
  /** 저장 슬롯 프리셋 조합 랜덤 파티(2.2 B6) — 저장 파티·슬롯 프리셋 원본은 그대로, 사본만 진영에 채운다 */
  function loadRandomSlotParty(side: Side) {
    const { slots } = buildRandomPartyFromSlots(
      slotPresets.presets.map((p) => p.slot),
      SAMPLE_PARTIES.flatMap((party) => party.slots),
    );
    setup.loadSide(side, slots);
  }
  const pokemonAt = (side: Side, i: SlotIndex) => {
    const slot = slotCtl(side, i).slot;
    return slot ? getPokemon(slot.pokemonId) : undefined;
  };
  const { battleSide, activePokemon, activeMoveIds, choiceLockedMoveId, isStruggling, moveRestrictionMessage, selectableMoveIds, switchableIndices } = battleRules(battleState, partySlots);

  function handleSaveSlotAsSample(side: Side, i: SlotIndex) {
    const slot = slotCtl(side, i).slot;
    if (!slot) return;
    const pokemon = getPokemon(slot.pokemonId);
    const name = window.prompt("이 빌드를 저장할 이름을 입력하세요.", pokemon?.name ?? "");
    if (name === null) return;
    slotPresets.savePreset(name, slot);
  }


  /** 이 편에서 포켓몬이 있고 기술이 1개 이상인 빌드 슬롯 인덱스(빌드 순서). 이게 곧 "선출 가능" 후보. */
  const buildableIndices = (side: Side): SlotIndex[] =>
    SLOT_INDICES.filter((i) => {
      const s = slotCtl(side, i).slot;
      return s !== null && s.moves.some((m) => m !== null);
    });

  /**
   * 포켓몬은 골랐는데 기술을 하나도 안 배정한 슬롯(§4-2). buildableIndices가 이런 슬롯을
   * "선출 가능" 후보에서 조용히 빼버려서, 배턴터치·유턴처럼 자체 교체를 하려는 기술이 예비가
   * 없는 것처럼 취급돼 아무 안내 없이 무산되는 문제로 이어졌다 — 대전 시작 시점에 미리 막아서
   * 애초에 그 상태로 대전에 들어가지 못하게 한다.
   */
  const movelessIndices = (side: Side): SlotIndex[] =>
    SLOT_INDICES.filter((i) => {
      const s = slotCtl(side, i).slot;
      return s !== null && s.moves.every((m) => m === null);
    });

  /**
   * movelessIndices가 하나라도 있으면 그 편 소속 포켓몬 이름만 모아 그 편 전용 경고 문구를
   * 만든다(양쪽을 한 줄로 합치지 않음 — 각자 파티 상단에 표시하려면 편별로 갈라져 있어야 함).
   */
  const movelessWarningFor = (side: Side): string | null => {
    const names = movelessIndices(side).map((i) => {
      const s = slotCtl(side, i).slot;
      return s ? (getPokemon(s.pokemonId)?.name ?? "포켓몬") : "포켓몬";
    });
    if (names.length === 0) return null;
    return `${names.join(", ")}에게 기술을 최소 1개 배정해야 대전을 시작할 수 있습니다.`;
  };

  /** 양쪽 중 어느 편이든 기술 없는 슬롯이 있으면 true — canProceed·VS 버튼 문구용 */
  const hasMovelessSlot = (["a", "b"] as const).some((side) => movelessIndices(side).length > 0);

  /** 이 편이 선출 화면에서 골라야 하는지 — 유효 빌드가 선출 인원을 초과하면 true */
  const needsSelection = (side: Side) => buildableIndices(side).length > BATTLE_SELECT_SIZE;

  /** 양쪽 다 유효 빌드가 1마리 이상이고, 기술 없는 슬롯이 하나도 없어야 다음 단계로 갈 수 있다 */
  const rankNotStarted = mode === "rank" && !rank.active;
  const canProceed =
    !hasMovelessSlot && (["a", "b"] as const).every((side) => buildableIndices(side).length >= 1) && !rankNotStarted;

  /** 배틀 프런티어·랭크배틀 시작은 AI 상대 + 내 쪽에 빌드가 있을 때만 — 이유를 버튼 툴팁으로 보여 준다 */
  const seriesStartBlockedReason = !aiOpponent
    ? "\"AI가 조작\"을 켜야 배틀 프런티어를 할 수 있어요"
    : buildableIndices("a").length < 1
      ? "내 파티에 포켓몬을 먼저 구성해 주세요"
      : movelessIndices("a").length > 0
        ? "기술이 없는 슬롯이 있어요"
        : null;
  /** 프런티어 중 이미 고정한 내 선출(그 사이 빌드가 바뀌어 못 쓰게 됐으면 null → 다시 고른다) */
  const fixedSelectionA =
    series.active && frontierSelection?.every((i) => buildableIndices("a").includes(i)) ? frontierSelection : null;
  const selectsA = needsSelection("a") && !fixedSelectionA;
  /** 셋업 화면 VS 버튼이 무엇을 하는지 (선출 화면을 거치면 "다음 (선출)", 아니면 바로 "대전 시작") */
  // AI 편 선출은 자동(비공개)이라, 내 편이 고를 게 없으면 바로 대전
  const proceedLabel = selectsA || (needsSelection("b") && !aiOpponent) ? "다음 (선출)" : "대전 시작";

  /** 선출된 빌드 슬롯 인덱스 목록으로 배틀 상태를 만들고 대전을 시작한다 */
  function startBattleWith(sel: { a: SlotIndex[]; b: SlotIndex[] }) {
    const partyOf = (side: Side) =>
      sel[side].map((i) => slotCtl(side, i).slot).filter((s): s is PartySlot => s !== null);
    const aParty = partyOf("a");
    const bParty = partyOf("b");
    if (aParty.length < 1 || bParty.length < 1) return;
    if (series.active) {
      setFrontierSelection(sel.a);
      series.begin();
    }
    // 랭크배틀: 이탈 정산용 표시와 시즌 기록용 내 빌드(6슬롯)를 남긴다. 선출은 판마다 새로 고른다
    if (rank.active) rank.begin(SLOT_INDICES.map((i) => slotCtl("a", i).slot) as PartySlots);
    const movesOf = (s: PartySlot) => s.moves.filter((id): id is string => id !== null).map((id) => getMove(id)!);
    const state = createBattleState({
      a: { slots: aParty, movesList: aParty.map(movesOf) },
      b: { slots: bParty, movesList: bParty.map(movesOf) },
    });
    setPartySlots({ a: aParty, b: bParty });
    setBattleState(state);
    setLog([]);
    setSelected({ a: null, b: null });
    setInputMode({ a: "move", b: "move" });
    setPendingForcedSwitch(null);
    setPendingPivot(null);
    setLockWarning(null);
    setSelecting(false);
    setMegaDeclared({ a: false, b: false });
    setAiSide(aiOpponent ? "b" : null);
    if (aiOpponent) prewarmAiWorker();
    setAiRiskAversion(sampleRiskAversion());
    aiSessionRef.current = emptyOpponentMemory();
    setLearnedBattles(null);
    aiRequestRef.current++;
    setAiThinking(false);
  }

  /**
   * 3선출 AI(ver.1.8): AI 편은 팀 프리뷰처럼 양쪽 빌드 전체를 보고 선출한다(사용자 선출은 모름). 약 1초 걸린다.
   * 결과는 빌드 슬롯 인덱스(선봉 먼저).
   */
  function aiSelectionFor(side: Side): SlotIndex[] {
    const buildsOf = (s: Side) => buildableIndices(s).map((i) => slotCtl(s, i).slot).filter((x): x is PartySlot => x !== null);
    const movesOf = (slot: PartySlot) => slot.moves.filter((id): id is string => id !== null).map((id) => getMove(id)!);
    const aBuilds = buildsOf("a");
    const bBuilds = buildsOf("b");
    const full = createBattleState({
      a: { slots: aBuilds, movesList: aBuilds.map(movesOf) },
      b: { slots: bBuilds, movesList: bBuilds.map(movesOf) },
    });
    const pool = buildableIndices(side);
    // 5.5 F1 — 샘플의 fixedPicks는 풀 위치로 바꿔 넘긴다(chooseAiSelection의 fixed는 파티 인덱스). 남은 자리는 AI가 고른다
    const fixed = fixedPickIndices(side).map((i) => pool.indexOf(i));
    return chooseAiSelection(full, side, { size: BATTLE_SELECT_SIZE, fixed }).map((p) => pool[p]);
  }

  /** 샘플의 fixedPicks(5.4 E3)를 현재 빌드 슬롯 인덱스로 바꾼다 — 그 사이 빠지거나 기술이 없어진 마리는 건너뛴다 */
  const fixedPickIndices = (side: Side): SlotIndex[] =>
    setup.fixedPicks[side].flatMap((id) => buildableIndices(side).filter((i) => slotCtl(side, i).slot?.pokemonId === id));

  /** 빌드 화면 "다음/대전 시작" — 양쪽 다 3마리 이하면 선출을 건너뛰고 바로 대전, 아니면 선출 화면으로 */
  function handleProceed() {
    if (!canProceed) return;
    const aiSelects = aiOpponent && needsSelection("b");
    const autoSel = (side: Side) =>
      side === "b" && aiSelects
        ? aiSelectionFor("b")
        : side === "a" && fixedSelectionA
          ? fixedSelectionA
          : needsSelection(side)
            ? fixedPickIndices(side)
            : buildableIndices(side).slice(0, BATTLE_SELECT_SIZE);
    const sel = { a: autoSel("a"), b: autoSel("b") };
    if (!selectsA && (!needsSelection("b") || aiSelects)) {
      startBattleWith(sel);
    } else {
      setSelection(sel);
      setSelecting(true);
    }
  }

  /** 선출 화면에서 포켓몬 카드를 눌렀을 때 — 이미 골랐으면 해제(뒤 번호 자동 재정렬), 아니면 다음 번호로 추가 */
  function toggleSelection(side: Side, i: SlotIndex) {
    setSelection((prev) => {
      const cur = prev[side];
      const at = cur.indexOf(i);
      if (at >= 0) return { ...prev, [side]: cur.filter((x) => x !== i) };
      if (cur.length >= BATTLE_SELECT_SIZE) return prev;
      return { ...prev, [side]: [...cur, i] };
    });
  }

  /** 선출 화면 "대전 시작" 가능 여부 — 각 편이 정확히 min(빌드 수, 선출 인원)만큼 골랐는지 */
  const selectionComplete = (["a", "b"] as const).every(
    (side) => selection[side].length === Math.min(buildableIndices(side).length, BATTLE_SELECT_SIZE),
  );

  function resetToSetup() {
    aiRequestRef.current++;
    setAiThinking(false);
    setBattleState(null);
    setLog([]);
    setPartySlots({ a: [], b: [] });
    setSelected({ a: null, b: null });
    setInputMode({ a: "move", b: "move" });
    setPendingForcedSwitch(null);
    setPendingPivot(null);
    setLockWarning(null);
    setSelecting(false);
    setSelection({ a: [], b: [] });
    setMegaDeclared({ a: false, b: false });
    setAiSide(null);
  }

  /**
   * runTurn/resumeTurn의 결과를 UI에 반영한다(§7-2). 멈춘 결과(awaitingSelfSwitch)면 부분 결과를
   * 로그에 얹고 교체 대기 상태로, 최종 결과면 (부분 결과가 있었으면 그걸 대체하며) 완결 처리한다.
   */
  function applyTurnOutcome(
    outcome: ReturnType<typeof runTurn>,
    /** 직전에 부분 결과 카드를 로그에 올려둔 상태면 true — 대체(replace)한다 */
    replacingPartial: boolean,
  ) {
    setBattleState(outcome.nextState);
    if ("awaitingSelfSwitch" in outcome) {
      setLog((prev) =>
        replacingPartial ? [...prev.slice(0, -1), outcome.partialResult] : [...prev, outcome.partialResult],
      );
      setPendingPivot({
        ctx: outcome._ctx,
        side: outcome.awaitingSelfSwitch.side,
        passBaton: outcome.awaitingSelfSwitch.passBaton,
        emergencyExit: outcome.awaitingSelfSwitch.emergencyExit,
        faintReplacement: outcome.awaitingSelfSwitch.faintReplacement,
        ejectItemName: outcome.awaitingSelfSwitch.ejectItemName,
      });
      return;
    }
    setLog((prev) => (replacingPartial ? [...prev.slice(0, -1), outcome.result] : [...prev, outcome.result]));
    setPendingPivot(null);
    setPendingForcedSwitch(outcome.forcedSwitch ?? null);
    setSelected({ a: null, b: null });
    setInputMode({ a: "move", b: "move" });
    setMegaDeclared({ a: false, b: false });
  }

  /** 유턴류 자체 교체 선택 확정 — 고른 슬롯으로 교체하고 나머지 턴(상대 행동·턴 종료)을 이어간다. */
  function resolvePivot(toIndex: number) {
    if (!pendingPivot) return;
    applyTurnOutcome(resumeTurn(pendingPivot.ctx, toIndex), true);
  }


  /** 강제 교체 확정 — 기절한 활성 자리에 toIndex 슬롯을 세운다(턴은 소비 안 함) */
  function resolveForcedSwitch(side: Side, toIndex: number) {
    if (!battleState) return;
    const { nextState, entryMessages, outPokemonId, inPokemonId } = applySwitch(battleState, side, toIndex);
    setBattleState(nextState);
    // 스텔스록·압정 등장 데미지로(§6) 새로 나온 포켓몬이 그 자리에서 또 쓰러졌는지.
    const inSide = side === "a" ? nextState.sideA : nextState.sideB;
    const inFainted = nextState[side].currentHp <= 0;
    const hasReserve = inSide.party.some((f, i) => i !== inSide.activeIndex && f.currentHp > 0);
    // 강제 교체는 턴 밖 조작이라 별도 로그 카드로 남긴다(등장 파이프라인 문구까지 함께).
    const synthetic: TurnResult = {
      turnNumber: nextState.turnNumber,
      order: ["a", "b"],
      activePokemonIds: { a: nextState.a.slot.pokemonId, b: nextState.b.slot.pokemonId },
      actions: [],
      endOfTurn: [],
      winner: inFainted && !hasReserve ? (side === "a" ? "b" : "a") : undefined,
      expiredScreens: [],
      expiredSafeguard: [],
      turnStartAnnouncements: [],
      switches: [
        { side: side as FighterKey, fromIndex: -1, toIndex, outPokemonId, inPokemonId, entryMessages },
      ],
    };
    setLog((prev) => [...prev, synthetic]);
    // 새로 나온 포켓몬이 또 쓰러졌고 남은 슬롯이 있으면 강제 교체를 계속 요구한다.
    setPendingForcedSwitch((prev) => {
      const rest = { ...(prev ?? {}), [side]: inFainted && hasReserve ? true : undefined };
      return rest.a || rest.b ? rest : null;
    });
  }


  // AI 편의 강제 교체(기절 후)·유턴류 교대는 사람 입력을 기다리지 않고 AI가 바로 고른다.
  useEffect(() => {
    if (!battleState || !aiSide) return;
    if (pendingPivot?.side === aiSide) {
      resolvePivot(chooseAiForcedSwitch(battleState, aiSide, aiRiskAversion) ?? switchableIndices(aiSide)[0] ?? -1);
      return;
    }
    if (pendingForcedSwitch?.[aiSide] && !pendingPivot) {
      const toIndex = chooseAiForcedSwitch(battleState, aiSide, aiRiskAversion) ?? switchableIndices(aiSide)[0];
      if (toIndex !== undefined) resolveForcedSwitch(aiSide, toIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingForcedSwitch, pendingPivot, battleState, aiSide]);

  function playTurn() {
    if (!battleState || pendingForcedSwitch || pendingPivot || aiThinking) return;
    setLockWarning(null);
    // PP 남은 기술이 없거나(4개 다 0), 구애류 도구로 잠긴 기술의 PP가 0이면 선택 없이 발버둥.
    const struggling = { a: isStruggling("a"), b: isStruggling("b") };
    // 공중날기 등 차지 기술 2턴째는 준비해둔 기술이 선택 여부와 무관하게 자동으로 나간다.
    // 난동·반동 턴(ver.1.9)도 차지 2턴째와 같이 선택 없이 자동 — 엔진이 정해진 행동으로 바꿔 쓴다(forcedLockedAction)
    const charging = {
      a: !!forcedLockedAction(battleState.a),
      b: !!forcedLockedAction(battleState.b),
    };
    const isSwitch = (side: Side) => selected[side]?.kind === "switch";
    // 교체를 고른 쪽은 발버둥/차지와 무관하게 교체가 우선. 그 외엔 선택(또는 발버둥/차지)이 있어야 진행.
    // AI 편은 사람 선택 없이 아래에서 AI가 고른다.
    for (const side of ["a", "b"] as const) {
      if (side === aiSide) continue;
      if (!isSwitch(side) && !struggling[side] && !charging[side] && !selected[side]) return;
    }

    // 구애스카프·도발/사슬묶기/앙코르 확인 — 기술을 고른 쪽만. 교체·발버둥·차지는 대상 아님.
    for (const side of ["a", "b"] as const) {
      if (side === aiSide || isSwitch(side) || struggling[side] || charging[side]) continue;
      const chosen = selected[side]?.kind === "move" ? selected[side]!.moveId : null;
      if (!chosen) continue;
      const locked = choiceLockedMoveId(side);
      if (locked && chosen !== locked) {
        const lockedMoveName = getMove(locked)?.name ?? "그 기술";
        const pokemonName = activePokemon(side)?.name ?? "포켓몬";
        setLockWarning(`${pokemonName}${eunNeun(pokemonName)} 구애스카프 때문에 ${lockedMoveName}만 쓸 수 있다!`);
        return;
      }
      const restriction = moveRestrictionMessage(side, chosen);
      if (restriction) {
        setLockWarning(restriction);
        return;
      }
    }

    // AI 편: 발버둥·차지 2턴째는 사람과 같은 자동 처리를 따르고, 그 외엔 AI가 기술·교체·메가진화를 고른다.
    // 고를 수 있는 기술은 사람에게 적용하는 규칙(PP·구애 고정·도발·사슬묶기·앙코르)과 똑같이 거른다.
    // ver.2.0 2-B: 탐색 오라클을 Web Worker에서 계산한다(화면 멈춤 없음, 2초 안에 답이 없으면 지금 AI로 — aiClient.ts).
    const needsAi = !!aiSide && !struggling[aiSide] && !charging[aiSide];
    if (!needsAi) {
      executeTurn(null);
      return;
    }
    const requestId = ++aiRequestRef.current;
    setAiThinking(true);
    void chooseAiActionAsync({
      state: battleState,
      key: aiSide!,
      riskAversion: aiRiskAversion,
      legalMoveIds: selectableMoveIds(aiSide!),
      decisionParams: mode === "rank" ? RANK_AI_PROFILES[rank.aiLevel] : APP_DECISION_PARAMS,
      opponentMemory: combinedMemory(aiMemory.memory, aiSessionRef.current),
    }).then((result) => {
      if (requestId !== aiRequestRef.current) return; // 계산 도중 초기화·새 대전
      setAiThinking(false);
      executeTurn(result.action, result.opponentDistribution);
    });

    function executeTurn(aiAction: TurnAction | null, opponentDistribution?: LevelOneDistribution) {
    if (!battleState) return;
    const actionFor = (side: Side): TurnAction | null => {
      if (side === aiSide && aiAction) return aiAction;
      const sel = selected[side];
      if (sel?.kind === "switch") return { kind: "switch", toIndex: sel.toIndex };
      const mega = megaDeclared[side] || undefined; // 메가진화는 기술 행동에만 실린다
      if (struggling[side]) return { kind: "move", move: STRUGGLE_MOVE, mega };
      if (charging[side]) {
        const forced = forcedLockedAction(battleState[side]);
        return forced?.kind === "move" ? { ...forced, mega } : null;
      }
      const m = sel?.kind === "move" ? getMove(sel.moveId) : undefined;
      if (!m) return null;
      return { kind: "move", move: m, ...(mega ? { mega } : {}) };
    };
    const actionA = actionFor("a");
    const actionB = actionFor("b");
    if (!actionA || !actionB) return;

    // 1-C: AI가 예측한 사용자 행동 분포와 사용자가 실제로 고른 행동을 짝지어 이번 대전 세션 기록에 더한다
    if (aiSide && opponentDistribution) {
      const humanSide = aiSide === "a" ? "b" : "a";
      const human = humanSide === "a" ? actionA : actionB;
      observeOpponent(aiSessionRef.current, {
        dist: opponentDistribution,
        speciesId: battleState[humanSide].slot.pokemonId,
        statusMoveIds: statusMoveIdsOf(opponentDistribution),
        action: human.kind === "switch" ? { kind: "switch" } : { kind: "move", moveId: human.move.id, isStatus: human.move.category === "status" },
      });
    }

    applyTurnOutcome(runTurn(battleState, actionA, actionB), false);
    }
  }

  const winner = log.at(-1)?.winner;

  // 대전이 끝날 때마다 그 시점의 로그를 배틀비디오로 저장한다(§6). winner가 undefined→값으로
  // 바뀌는 시점에만 한 번 실행되고, 새 대전을 시작하면(setLog([])) winner가 다시 undefined로
  // 돌아가 다음 대전 종료 때 또 한 번만 저장된다.
  useEffect(() => {
    if (!winner || !battleState) return;
    // 선출된 3마리 전원의 이름을 그대로 나열한다(사용자 확정 — 활성 1마리가 아니라 선출 전체).
    const teamLabel = (side: Side) =>
      partySlots[side].map((s) => getPokemon(s.pokemonId)?.name ?? s.pokemonId).join(", ");
    battleVideos.addVideo({
      labelA: teamLabel("a"),
      labelB: teamLabel("b"),
      winner,
      log,
    });
    // 1-C: AI 대전이면 이번 대전 관측을 누적 학습에 합친다("대전에서 계속 학습"이 꺼져 있으면 합치지 않음)
    if (aiSide && aiMemory.commit(aiSessionRef.current)) setLearnedBattles(aiMemory.memory.battles + 1);
    series.record(winner);
    rank.record(winner, log.at(-1)?.turnNumber ?? 0);
    aiSessionRef.current = emptyOpponentMemory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winner]);

  return { mode, rank, rankNotStarted, setBattleVideoView, battleVideos, battleState, selecting, series, seriesStartBlockedReason, setFrontierSelection, loadSample, setup, partyPresets, slotPresets, movelessWarningFor, handleSaveSlotAsSample, setPicker, canProceed, proceedLabel, hasMovelessSlot, handleProceed, aiOpponent, setAiOpponent, aiMemory, setShowAiMemory, loadRandomSample, loadRandomSlotParty, selection, buildableIndices, fixedPickIndices, needsSelection, pokemonAt, slotCtl, toggleSelection, setSelecting, selectionComplete, startBattleWith, winner, selected, setSelected, inputMode, setInputMode, megaDeclared, setMegaDeclared, pendingForcedSwitch, pendingPivot, lockWarning, setLockWarning, log, activeMoveIds, choiceLockedMoveId, battleSide, switchableIndices, resolveForcedSwitch, resolvePivot, isStruggling, moveRestrictionMessage, playTurn, resetToSetup, aiSide, aiThinking, learnedBattles, showAiMemory, picker, sideCtls, mySamples, battleVideoView };
}
