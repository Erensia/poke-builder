import type { MatchupSlot, PowerConditionKey } from "../types/matchup";
import type { Move } from "../types/move";
import type { StatusCondition } from "../types/status";
import { getPokemon, getMove, getAbility, getItem, getNature } from "../lib/data";
import {
  getEffectiveForm,
  megaBadgeLabel,
  resolveCosmeticForm,
  COSMETIC_FORM_CYCLE_MAX,
} from "../lib/pokemonForm";
import { computeRealStats } from "../lib/statCalculator";
import { totalAbilityPoints } from "../lib/statCalculator";
import { rankStageMultiplier } from "../lib/battlePower";
import { TypeBadge } from "./TypeBadge";
import { PokemonAvatarWithItem } from "./PokemonAvatarWithItem";
import { STAT_ORDER, STAT_LABELS } from "../lib/statLabels";
import { TYPE_COLORS } from "../lib/typeColors";
import "./MatchupSlotCard.css";

/**
 * ver.1.9 조건부 위력 가정 토글 — 기술의 2배 조건마다 하나(고른 기술에 해당하는 것만 보인다). 엔진은 실제 전투 이력으로 판정한다.
 */
const POWER_CONDITION_TOGGLES: { key: PowerConditionKey; label: string; relevant: (move: Move) => boolean }[] = [
  { key: "movesLastAssumed", label: "상대보다 늦게 행동 가정", relevant: (m) => m.conditionalDoublePower === "moves-after-target" },
  { key: "tookDamageAssumed", label: "이번 턴 상대 기술로 데미지를 입음 가정", relevant: (m) => m.conditionalDoublePower === "took-damage-this-turn" },
  { key: "moveFailedAssumed", label: "직전 턴 기술이 빗나감·실패 가정", relevant: (m) => m.conditionalDoublePower === "user-move-failed-last-turn" },
  { key: "statLoweredAssumed", label: "이번 턴 자신의 능력이 떨어짐 가정", relevant: (m) => m.conditionalDoublePower === "user-stat-lowered-this-turn" },
  { key: "targetDamagedAssumed", label: "이번 턴 상대가 이미 데미지를 입음 가정", relevant: (m) => m.conditionalDoublePower === "target-damaged-this-turn" },
  { key: "targetMinimizedAssumed", label: "상대가 작아지기를 사용 가정", relevant: (m) => !!m.bonusVsMinimize },
];

/** ver.1.9 상태이상 가정 선택지 */
const STATUS_OPTIONS: readonly (readonly [StatusCondition | null, string])[] = [
  [null, "없음"],
  ["burn", "화상"],
  ["poison", "독"],
  ["badly-poisoned", "맹독"],
  ["paralysis", "마비"],
  ["sleep", "잠듦"],
  ["freeze", "얼음"],
];

interface MatchupSlotCardProps {
  role: "attacker" | "defender";
  label: string;
  slot: MatchupSlot;
  offensePower?: number | null;
  rawOffensePower?: number | null;
  /** ver.1.3 §4 — 상대 미선택 시 공격측 정보만으로 계산한 결정력(자속·랭크·특성·도구·날씨 반영,
   * 상대 타입 상성은 제외). 상대가 있으면 rawOffensePower 쪽이 더 정확하니 그때는 안 넘긴다. */
  soloOffensePower?: number | null;
  /** 다단히트 기술(트리플악셀 등)일 때 선택된 적중 타수 */
  multiHitCount?: number;
  onSetMultiHitCount?: (count: number) => void;
  bulkPhysical?: number;
  bulkSpecial?: number;
  onPickPokemon: () => void;
  onClearPokemon: () => void;
  onPickAbility: () => void;
  onPickItem: () => void;
  onPickNature: () => void;
  onPickPoints: () => void;
  onPickStages: () => void;
  /** 펌킨인 계열 크기 변종을 다음 크기로 순환 */
  onCycleSizeForm: () => void;
  /** 루가루암 계열 폼 변종을 다음 폼으로 순환 */
  onCycleFormVariant: () => void;
  /** 마휘핑 계열 겉모습을 다음 모습으로 순환(옵션 ≤4일 때) */
  onCycleCosmeticForm: () => void;
  /** 마휘핑 계열 겉모습을 리스트 모달로 고르기(옵션 >4일 때) */
  onPickCosmeticForm: () => void;
  onPickMove?: () => void;
  /** 실능치 역산 탭처럼 기술을 카드 밖(관측 줄)에서 고르는 화면 — 기술 칸을 숨긴다 */
  hideMoveSlot?: boolean;
  /** 도구 강탈·곡예 가정처럼 결정력 계산 전용인 토글을 숨긴다(실능치 역산 탭) */
  hideTurnAssumptions?: boolean;
  /** 저장된 샘플(빌드)이 하나라도 있는지 — Phase 6 §1-3, 없으면 버튼 자체를 숨긴다 */
  hasSamples: boolean;
  /** 저장된 샘플 목록에서 이 슬롯에 불러올 것을 고르는 모달 열기(불러오기 전용 — 저장 없음) */
  onOpenSamplePicker: () => void;
  /** Phase 6.5 §1 — "이 슬롯이 매지션/곡예로 상대 도구를 강탈했다" 가정 토글 */
  onToggleItemStolen: (value: boolean) => void;
  /** Phase 6.5 §1 — "곡예(Unburden) 발동 후 = 스피드 2배" 가정 토글 */
  onToggleUnburden: (value: boolean) => void;
  /** ver.1.9 — 상태이상 가정(이전 "마비 가정" 토글 통합). 마비 = 스피드 0.5배, 화상 = 물리 반감, 조건부 2배 기술·특성 판정 */
  onSetStatus: (status: StatusCondition | null) => void;
  /** 공격 슬롯 전용 — 고른 기술(조건부 위력·HP 비례 위력 기술일 때만 관련 가정을 보인다) */
  selectedMove?: Move;
  /** 공격 슬롯 전용(ver.1.9) — 조건부 위력 가정 토글. 고른 기술에 해당하는 조건만 보인다(POWER_CONDITION_TOGGLES) */
  onSetPowerCondition?: (key: PowerConditionKey, value: boolean) => void;
  /** 공격 슬롯 전용(ver.1.9 6-2) — 급소 가정. 기술을 골랐을 때 항상 보인다 */
  onToggleCrit?: (value: boolean) => void;
  /** 공격 슬롯 전용(2.2 F1) — 리베로·변환자재 자속보정. 공격 쪽 특성이 해당할 때만 보인다 */
  onToggleTypeShift?: (value: boolean) => void;
  /** 급소 가정인데 상대 특성(조가비갑옷·전투무장)으로 급소가 안 뜸 */
  critBlocked?: boolean;
  /** 공격 슬롯 전용(ver.1.9) — HP 1/3 이하 가정(맹화류 특성일 때만 보인다) */
  onTogglePinch?: (value: boolean) => void;
  /** 공격 슬롯 전용(ver.1.9) — 현재 HP %(분화·해수스파우팅·기사회생·바둥바둥일 때만 보인다) */
  onSetHpPercent?: (value: number) => void;
  /** 방어 슬롯 전용(ver.1.9) — HP 가득 가정(멀티스케일·섀도실드일 때만 보인다) */
  onToggleFullHp?: (value: boolean) => void;
  /** 공격 슬롯 전용 — 선택한 기술이 성묘인지 (아니면 성묘 배율 토글을 숨긴다) */
  moveIsGraveVisit?: boolean;
  /** 공격 슬롯 전용 — 성묘 배율(쓰러진 동료 수) 선택 */
  onSetGraveVisit?: (count: 0 | 1 | 2) => void;
  /** 공격 슬롯 전용 — 선택한 기술이 토해내기인지 (아니면 비축 스택 선택을 숨긴다) */
  moveIsSpitUp?: boolean;
  /** 공격 슬롯 전용 — 토해내기가 가정할 비축 스택(1~3) */
  stockpileCount?: number;
  onSetStockpileCount?: (count: number) => void;
  /** 방어 슬롯 전용 — 이 슬롯에 걸린 스크린 가정(리플렉터/빛의장막/오로라베일) */
  onSetScreen?: (screen: MatchupSlot["screen"]) => void;
}

export function MatchupSlotCard({
  role,
  label,
  slot,
  offensePower,
  rawOffensePower,
  soloOffensePower,
  multiHitCount,
  onSetMultiHitCount,
  bulkPhysical,
  bulkSpecial,
  onPickPokemon,
  onClearPokemon,
  onPickAbility,
  onPickItem,
  onPickNature,
  onPickPoints,
  onPickStages,
  onCycleSizeForm,
  onCycleFormVariant,
  onCycleCosmeticForm,
  onPickCosmeticForm,
  onPickMove,
  hideMoveSlot,
  hideTurnAssumptions,
  hasSamples,
  onOpenSamplePicker,
  onToggleItemStolen,
  onToggleUnburden,
  onSetStatus,
  selectedMove,
  onSetPowerCondition,
  onToggleCrit,
  onToggleTypeShift,
  critBlocked,
  onTogglePinch,
  onSetHpPercent,
  onToggleFullHp,
  moveIsGraveVisit,
  onSetGraveVisit,
  moveIsSpitUp,
  stockpileCount,
  onSetStockpileCount,
  onSetScreen,
}: MatchupSlotCardProps) {
  const pokemon = slot.pokemonId ? getPokemon(slot.pokemonId) : undefined;
  // ver.1.9 가정 토글 — 관련 기술·특성을 골랐을 때만 보인다
  const ability = slot.ability ? getAbility(slot.ability) : undefined;
  const powerConditions = selectedMove ? POWER_CONDITION_TOGGLES.filter((t) => t.relevant(selectedMove)) : [];
  const pinchRelevant = !!ability?.modifiers?.some((m) => m.condition?.attackerHpAtMostFraction !== undefined);
  const fullHpRelevant = !!ability?.modifiers?.some((m) => m.condition?.defenderHpIsFull === true);
  const hpPowerRelevant = !!selectedMove && (!!selectedMove.reversalPower || !!selectedMove.userHpScaledPower);

  if (!pokemon) {
    return (
      <div className="matchup-slot matchup-slot-empty">
        <span className="matchup-slot-label">{label}</span>
        <button type="button" className="matchup-slot-empty-main" onClick={onPickPokemon}>
          <span className="matchup-slot-plus" aria-hidden="true">
            +
          </span>
          <span className="matchup-slot-empty-text">포켓몬 선택</span>
        </button>
        {hasSamples && (
          <button type="button" className="matchup-slot-sample-link" onClick={onOpenSamplePicker}>
            저장된 샘플에서 불러오기
          </button>
        )}
      </div>
    );
  }

  const form = getEffectiveForm(pokemon, slot);
  const realStats = computeRealStats(form.baseStats, slot.points, slot.nature);
  const move = slot.moveId ? getMove(slot.moveId) : undefined;
  const usedPoints = totalAbilityPoints(slot.points);
  const activeStageCount = Object.values(slot.stages).filter((v) => v !== 0).length;

  return (
    <div className="matchup-slot matchup-slot-filled">
      <span className="matchup-slot-label">{label}</span>
      <button type="button" className="matchup-slot-clear" onClick={onClearPokemon} aria-label="슬롯 비우기">
        ✕
      </button>

      <button type="button" className="matchup-slot-main" onClick={onPickPokemon}>
        <PokemonAvatarWithItem
          pokemon={pokemon}
          size={42}
          radius={11}
          gradientTypes={form.types}
          avatarClassName="matchup-slot-avatar"
          itemId={slot.item}
          form={{
            // 매치업 슬롯엔 성별 선택이 없다 — genderedSprite 종은 기본(수컷) 스프라이트.
            cosmeticForm: slot.cosmeticForm,
            formVariant: slot.formVariant,
            sizeForm: slot.sizeForm,
            activeMegaForm: slot.activeMegaForm,
            item: slot.item,
          }}
        />
        <span className="matchup-slot-info">
          <span className="matchup-slot-name">
            {pokemon.name}
            {form.mega && <span className="matchup-slot-mega-tag">{megaBadgeLabel(form.mega)}</span>}
          </span>
          <span className="matchup-slot-types">
            {form.types.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
          </span>
        </span>
      </button>

      {/* 실능치 칩 — 랭크 변화(칼춤·위협 등)를 반영한 값을 보여준다. 결정력/내구력/스피드 계산은
          이미 stages를 반영하고 있었는데 이 표시만 포인트 분배 고정값이라 안 따라가고 있었다(Phase 6.5 §5).
          도구(구애머리띠 등)·특성(가속 등)은 계산식 배율이거나 턴마다 변하는 값이라 여기 칩에는 넣지 않는다. */}
      <div className="matchup-stat-row">
        {STAT_ORDER.map((stat) => {
          const base = realStats[stat];
          const stage = stat === "hp" ? 0 : slot.stages[stat];
          const effective = stage === 0 ? base : Math.round(base * rankStageMultiplier(stage));
          return (
            <div
              className={`matchup-stat-chip${
                stage > 0 ? " is-boosted" : stage < 0 ? " is-lowered" : ""
              }`}
              key={stat}
            >
              <span className="matchup-stat-label">{STAT_LABELS[stat]}</span>
              <span
                className="matchup-stat-value"
                title={stage !== 0 ? `기본 ${base} (${stage > 0 ? "+" : ""}${stage}랭크)` : undefined}
              >
                {effective}
                {stage !== 0 && (
                  <span className="matchup-stat-stage">{stage > 0 ? `+${stage}` : stage}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="matchup-meta-row">
        <button type="button" className="matchup-meta-pip" onClick={onPickAbility}>
          <span className="matchup-meta-label">특성</span>
          <span className="matchup-meta-value">
            {slot.ability ? getAbility(slot.ability)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="matchup-meta-pip" onClick={onPickItem}>
          <span className="matchup-meta-label">도구</span>
          <span className="matchup-meta-value">
            {slot.item ? getItem(slot.item)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="matchup-meta-pip" onClick={onPickNature}>
          <span className="matchup-meta-label">성격</span>
          <span className="matchup-meta-value">
            {slot.nature ? getNature(slot.nature)?.name : "미지정"}
          </span>
        </button>
        <button type="button" className="matchup-meta-pip" onClick={onPickPoints}>
          <span className="matchup-meta-label">포인트</span>
          <span className="matchup-meta-value">{usedPoints} / 66</span>
        </button>
        <button type="button" className="matchup-meta-pip" onClick={onPickStages}>
          <span className="matchup-meta-label">랭크</span>
          <span className="matchup-meta-value">
            {activeStageCount > 0 ? `${activeStageCount}개 변경` : "0랭크"}
          </span>
        </button>
        {pokemon?.sizeForms && (
          <button type="button" className="matchup-meta-pip" onClick={onCycleSizeForm}>
            <span className="matchup-meta-label">크기</span>
            <span className="matchup-meta-value">
              {(() => {
                const forms = pokemon.sizeForms;
                const currentId = slot.sizeForm ?? forms.find((f) => f.standard)?.id ?? forms[0].id;
                return forms.find((f) => f.id === currentId)?.label ?? forms[0].label;
              })()}
            </span>
          </button>
        )}
        {pokemon?.formVariants && (
          <button type="button" className="matchup-meta-pip" onClick={onCycleFormVariant}>
            {/* 매치업엔 성별 핍이 없어 formVariantByGender 종은 이 핍이 성별 선택을 겸한다. */}
            <span className="matchup-meta-label">{pokemon.formVariantByGender ? "성별" : "모습"}</span>
            <span className="matchup-meta-value">
              {(() => {
                const forms = pokemon.formVariants;
                const currentId = slot.formVariant ?? forms.find((f) => f.standard)?.id ?? forms[0].id;
                return forms.find((f) => f.id === currentId)?.label ?? forms[0].label;
              })()}
            </span>
          </button>
        )}
        {pokemon?.cosmeticForms && (
          <button
            type="button"
            className="matchup-meta-pip"
            onClick={
              pokemon.cosmeticForms.length <= COSMETIC_FORM_CYCLE_MAX
                ? onCycleCosmeticForm
                : onPickCosmeticForm
            }
          >
            <span className="matchup-meta-label">모습</span>
            <span className="matchup-meta-value">
              {resolveCosmeticForm(pokemon, slot)?.label ?? pokemon.cosmeticForms[0].label}
            </span>
          </button>
        )}
      </div>

      {/* Phase 6.5 §1 — "이전 턴 가정" 토글. 켜기 전까지는 지금까지와 동일한 계산 */}
      <div className="matchup-assume-section">
        {!hideTurnAssumptions && (
          <>
        <label className="matchup-assume-toggle">
          <input
            type="checkbox"
            checked={!!slot.itemStolenFromOpponent}
            onChange={(e) => onToggleItemStolen(e.target.checked)}
          />
          <span>상대 도구 강탈 가정</span>
        </label>
        <label className="matchup-assume-toggle">
          <input
            type="checkbox"
            checked={!!slot.unburdenAssumed}
            onChange={(e) => onToggleUnburden(e.target.checked)}
          />
          <span>곡예 발동(스피드 2배) 가정</span>
        </label>
          </>
        )}
        <div className="matchup-assume-grave">
          <span className="matchup-assume-grave-label">상태이상</span>
          <div className="matchup-hitcount-row matchup-status-row">
            {STATUS_OPTIONS.map(([value, text]) => (
              <button
                key={text}
                type="button"
                className={`matchup-hitcount-pip${(slot.statusAssumed ?? null) === value ? " is-active" : ""}`}
                onClick={() => onSetStatus(value)}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        {role === "attacker" && onToggleCrit && (
          <label className="matchup-assume-toggle">
            <input type="checkbox" checked={!!slot.critAssumed} onChange={(e) => onToggleCrit(e.target.checked)} />
            <span>{critBlocked ? "급소 가정 — 상대 특성으로 급소에 맞지 않음" : "급소 가정"}</span>
          </label>
        )}
        {role === "attacker" &&
          onSetPowerCondition &&
          powerConditions.map((t) => (
            <label key={t.key} className="matchup-assume-toggle">
              <input type="checkbox" checked={!!slot[t.key]} onChange={(e) => onSetPowerCondition(t.key, e.target.checked)} />
              <span>{t.label}</span>
            </label>
          ))}
        {role === "attacker" && ability?.changesUserTypeToMoveType && onToggleTypeShift && (
          <label className="matchup-assume-toggle">
            <input type="checkbox" checked={!!slot.typeShiftAssumed} onChange={(e) => onToggleTypeShift(e.target.checked)} />
            <span>리베로•변환자재 자속보정</span>
          </label>
        )}
        {role === "attacker" && pinchRelevant && onTogglePinch && (
          <label className="matchup-assume-toggle">
            <input type="checkbox" checked={!!slot.pinchAssumed} onChange={(e) => onTogglePinch(e.target.checked)} />
            <span>HP 1/3 이하 가정</span>
          </label>
        )}
        {role === "defender" && fullHpRelevant && onToggleFullHp && (
          <label className="matchup-assume-toggle">
            <input type="checkbox" checked={slot.fullHpAssumed ?? true} onChange={(e) => onToggleFullHp(e.target.checked)} />
            <span>HP 가득 가정({ability?.name} 발동)</span>
          </label>
        )}
        {role === "attacker" && hpPowerRelevant && onSetHpPercent && (
          <div className="matchup-assume-grave">
            <span className="matchup-assume-grave-label">현재 HP {slot.hpPercent ?? 100}%</span>
            <input
              type="range"
              className="matchup-hp-slider"
              min={1}
              max={100}
              value={slot.hpPercent ?? 100}
              onChange={(e) => onSetHpPercent(Number(e.target.value))}
              aria-label="현재 HP 퍼센트"
            />
          </div>
        )}
        {slot.itemStolenFromOpponent && (
          <p className="matchup-assume-hint">
            {slot.item
              ? "이 슬롯의 도구는 무시하고 상대 도구를 가져온 것으로 계산합니다(강탈은 무도구 상태에서 성립)."
              : "상대 도구를 가져온 것으로, 상대는 무도구로 계산합니다."}
          </p>
        )}
        {role === "attacker" && moveIsGraveVisit && onSetGraveVisit && (
          <div className="matchup-assume-grave">
            <span className="matchup-assume-grave-label">쓰러진 동료</span>
            <div className="matchup-hitcount-row">
              {([0, 1, 2] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`matchup-hitcount-pip${(slot.graveVisitFaintedAllies ?? 0) === n ? " is-active" : ""}`}
                  onClick={() => onSetGraveVisit(n)}
                >
                  {n}마리
                </button>
              ))}
            </div>
          </div>
        )}
        {role === "attacker" && moveIsSpitUp && onSetStockpileCount && (
          <div className="matchup-assume-grave">
            <span className="matchup-assume-grave-label">비축 스택</span>
            <div className="matchup-hitcount-row">
              {([1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`matchup-hitcount-pip${(stockpileCount ?? 3) === n ? " is-active" : ""}`}
                  onClick={() => onSetStockpileCount(n)}
                >
                  ×{n}
                </button>
              ))}
            </div>
          </div>
        )}
        {role === "defender" && onSetScreen && (
          <div className="matchup-assume-grave">
            <span className="matchup-assume-grave-label">스크린</span>
            <div className="matchup-hitcount-row">
              {(
                [
                  [undefined, "없음"],
                  ["reflect", "리플렉터"],
                  ["lightScreen", "빛의장막"],
                  ["auroraVeil", "오로라베일"],
                ] as const
              ).map(([value, text]) => (
                <button
                  key={text}
                  type="button"
                  className={`matchup-hitcount-pip${(slot.screen ?? undefined) === value ? " is-active" : ""}`}
                  onClick={() => onSetScreen(value)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {role === "attacker" && !hideMoveSlot && (
        <div className="matchup-move-section">
          <button
            type="button"
            className={`matchup-move-pip${move ? " has-type" : ""}`}
            style={move?.type ? { background: TYPE_COLORS[move.type] } : undefined}
            onClick={onPickMove}
          >
            {move ? move.name : "기술 선택"}
          </button>
          {move?.multiHitPowers && onSetMultiHitCount && (
            <div className="matchup-hitcount-row">
              {move.multiHitPowers.map((_, i) => {
                const hits = i + 1;
                return (
                  <button
                    key={hits}
                    type="button"
                    className={`matchup-hitcount-pip${multiHitCount === hits ? " is-active" : ""}`}
                    onClick={() => onSetMultiHitCount(hits)}
                  >
                    ×{hits}
                  </button>
                );
              })}
            </div>
          )}
          {/* 록블라스트·스케일샷류(minHits~maxHits, 타수별 위력 동일) — x2~x5 결정력 비교(Phase 6.5 §5).
              고정 타수(더블어택 등 min===max)는 선택지가 없으니 행을 띄우지 않는다(계산엔 항상 반영). */}
          {move &&
            !move.multiHitPowers &&
            move.minHits !== undefined &&
            move.maxHits !== undefined &&
            move.minHits !== move.maxHits &&
            onSetMultiHitCount &&
            (() => {
              const lo = move.minHits;
              const hi = move.maxHits;
              return (
                <div className="matchup-hitcount-row">
                  {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((hits) => (
                    <button
                      key={hits}
                      type="button"
                      className={`matchup-hitcount-pip${multiHitCount === hits ? " is-active" : ""}`}
                      onClick={() => onSetMultiHitCount(hits)}
                    >
                      ×{hits}
                    </button>
                  ))}
                </div>
              );
            })()}
          {move && rawOffensePower !== undefined && rawOffensePower !== null && (
            <div className="matchup-power-readout">
              결정력 <span className="matchup-power-caveat">(상대 타입 반영)</span>{" "}
              <strong>{Math.round(rawOffensePower).toLocaleString()}</strong>{" "}
              {offensePower !== undefined && offensePower !== null && (
                <span className="matchup-power-caveat">
                  ({Math.round(offensePower).toLocaleString()})
                </span>
              )}
            </div>
          )}
          {/* ver.1.3 §4 — 상대 미선택이라 rawOffensePower를 못 구했을 때: 자속·랭크·특성·도구·
              날씨는 반영하되 상대 타입 상성만 뺀 결정력(soloOffensePower)을 대신 보여준다. */}
          {move &&
            (rawOffensePower === null || rawOffensePower === undefined) &&
            soloOffensePower !== undefined &&
            soloOffensePower !== null && (
              <div className="matchup-power-readout">
                결정력 <span className="matchup-power-caveat">(상대 미선택 · 상성 제외)</span>{" "}
                <strong>{Math.round(soloOffensePower).toLocaleString()}</strong>
              </div>
            )}
          {move && move.category === "status" && (
            <div className="matchup-power-readout is-muted">변화기는 결정력이 없어요</div>
          )}
          {move &&
            (rawOffensePower === null || rawOffensePower === undefined) &&
            (soloOffensePower === undefined || soloOffensePower === null) &&
            move.category !== "status" && (
              <div className="matchup-power-readout is-muted">
                이 기술은 결정력을 고정 수치로 표시할 수 없어요
              </div>
            )}
        </div>
      )}

      {role === "defender" && bulkPhysical !== undefined && bulkSpecial !== undefined && (
        <div className="matchup-move-section">
          <div className="matchup-power-readout">
            물리내구 <strong>{Math.round(bulkPhysical).toLocaleString()}</strong>
          </div>
          <div className="matchup-power-readout">
            특수내구 <strong>{Math.round(bulkSpecial).toLocaleString()}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
