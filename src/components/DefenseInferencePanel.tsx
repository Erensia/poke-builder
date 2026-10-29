import { environmentTintBackground } from "../lib/environmentBackground";
import { MovePickerModal } from "./MovePickerModal";
import { PokemonAvatar } from "./PokemonAvatar";
import { TypeBadge } from "./TypeBadge";
import { getAbility, getItem } from "../lib/data";
import "./DefenseInferencePanel.css";
import type { DefenseInferencePanelProps } from "./defenseInferenceHelpers";
import {
  ObservationTips,
  CombinedView,
  AttackResultView,
  SpeedResultView,
  FormCompare,
  ResultView,
} from "./DefenseInferenceViews";
import { useDefenseInferenceState } from "./useDefenseInferenceState";
import { ObservationsSection, AssumptionsSection } from "./DefenseInferenceSections";

export function DefenseInferencePanel({
  attackerCard,
  attacker,
  defender,
  defenderActions,
  onSwapDrop,
  weather,
  field,
  onReset,
}: DefenseInferencePanelProps) {
  const session = useDefenseInferenceState({ attackerCard, attacker, defender, defenderActions, onSwapDrop, weather, field, onReset });
  const { defenderPokemon, defenderForm, dragOverClass, dropProps, dragProps, hasDealtRows, activeAbilityId, anyMega, itemId, tolerant, hasReceivedRows, activeAtkAbilityId, anyMegaReceived, atkItemId, atkStage, spaStage, oppBurned, rows, attackerPokemon, updateRow, setMovePickerRow, pending, attackPending, speedPending, result, attackResult, speedResult, rowIdsByObservation, receivedRowNos, combined, speedRowNos, complete, myScreen, movePickerRow } = session;


  return (
    <div className="dinf">
      <p className="dinf-intro">
        내 포켓몬이 상대를 때린 뒤 상대 HP가 몇 %가 됐는지 입력하면, 상대의 <strong>HP·방어(특방) 능력 포인트와 성격</strong>이 될 수 있는 범위를 좁혀 줘요.
        반대로 상대가 나를 때려서 내 HP가 얼마가 됐는지 입력하면 상대의 <strong>공격(특공) 포인트와 성격 보정</strong>도 좁힐 수 있어요(내 HP는 정확한 수치라 더 정밀해요).
        이번 턴 누가 먼저 움직였는지(<strong>선후공</strong>)를 넣으면 상대의 <strong>스피드 포인트와 성격 보정</strong>을 좁혀요.
        데미지에는 난수가 있어서, 정답 하나가 아니라 <strong>가능한 범위</strong>로 보여 줍니다.
      </p>

      <div className="dinf-board" style={{ background: environmentTintBackground(weather, field) }}>
        {attackerCard}

        {defenderPokemon && defenderForm ? (
          <div className={`matchup-slot matchup-slot-filled dinf-defender${dragOverClass}`} {...dropProps}>
            <span className="matchup-slot-label">상대 포켓몬</span>
            <button type="button" className="matchup-slot-clear" onClick={defenderActions.onClear} aria-label="상대 비우기">
              ✕
            </button>
            <button type="button" className="matchup-slot-main" onClick={defenderActions.onPickPokemon} {...dragProps}>
              <PokemonAvatar
                pokemon={defenderPokemon}
                size={42}
                radius={11}
                gradientTypes={defenderForm.types}
                className="matchup-slot-avatar"
                form={{ activeMegaForm: undefined, formVariant: defender.formVariant, sizeForm: defender.sizeForm, cosmeticForm: defender.cosmeticForm, item: null }}
              />
              <span className="matchup-slot-info">
                <span className="matchup-slot-name">{defenderPokemon.name}</span>
                <span className="matchup-slot-types">
                  {defenderForm.types.map((t) => (
                    <TypeBadge key={t} type={t} />
                  ))}
                </span>
              </span>
            </button>
            {(defenderPokemon.formVariants || defenderPokemon.sizeForms) && (
              <div className="dinf-defender-forms tap-targets">
                {defenderPokemon.formVariants && (
                  <button type="button" onClick={defenderActions.onCycleFormVariant}>
                    폼 바꾸기{defenderForm.formLabel ? ` (${defenderForm.formLabel})` : ""}
                  </button>
                )}
                {defenderPokemon.sizeForms && (
                  <button type="button" onClick={defenderActions.onCycleSizeForm}>
                    크기 바꾸기{defenderForm.formLabel ? ` (${defenderForm.formLabel})` : ""}
                  </button>
                )}
              </div>
            )}
            <div className="dinf-defender-base">
              <span>
                종족값 HP <strong>{defenderForm.baseStats.hp}</strong>
              </span>
              <span>
                방어 <strong>{defenderForm.baseStats.def}</strong>
              </span>
              <span>
                특방 <strong>{defenderForm.baseStats.spd}</strong>
              </span>
              <span>
                스피드 <strong>{defenderForm.baseStats.spe}</strong>
              </span>
            </div>
            <p className="dinf-unknown">
              역산 대상: <strong>HP · 방어 · 특방 · 공격 · 특공 · 스피드 포인트, 성격</strong>
            </p>
          </div>
        ) : (
          <div className={`matchup-slot matchup-slot-empty dinf-defender${dragOverClass}`} {...dropProps}>
            <span className="matchup-slot-label">상대 포켓몬</span>
            <button type="button" className="matchup-slot-empty-main" onClick={defenderActions.onPickPokemon}>
              <span className="matchup-slot-plus" aria-hidden="true">
                +
              </span>
              <span className="matchup-slot-empty-text">상대 포켓몬 선택</span>
            </button>
          </div>
        )}
      </div>

      <AssumptionsSection s={session} />

      <ObservationsSection s={session} />

      <section className="dinf-section dinf-result-section" aria-live="polite">
        <h3>
          결과 {(pending || attackPending || speedPending) && <span className="dinf-pending">계산 중…</span>}
        </h3>
        {!attackerPokemon || !defenderPokemon ? (
          <p className="dinf-hint">내 포켓몬과 상대 포켓몬을 먼저 골라 주세요.</p>
        ) : !result && !attackResult && !speedResult ? (
          <p className="dinf-hint">관측의 기술과 맞은 뒤 값을 입력하거나, 선후공 줄을 추가하면 결과가 나와요.</p>
        ) : (
          <>
            {result && (
              <div className={pending ? "dinf-stale" : undefined}>
                {(attackResult || speedResult) && <h4 className="dinf-subhead">방어 쪽 — 내가 입힌 데미지</h4>}
                <ResultView result={result} rowIdsByObservation={rowIdsByObservation} />
              </div>
            )}
            {attackResult && (
              <div className={attackPending ? "dinf-stale" : undefined}>
                <h4 className="dinf-subhead">공격 쪽 — 내가 받은 데미지</h4>
                <AttackResultView result={attackResult} rowNos={receivedRowNos} combinedOn={combined.natures !== null} />
              </div>
            )}
            {speedResult && (
              <div className={speedPending ? "dinf-stale" : undefined}>
                <h4 className="dinf-subhead">스피드 쪽 — 선후공</h4>
                <SpeedResultView result={speedResult} rowNos={speedRowNos} combinedOn={combined.natures !== null} />
              </div>
            )}
            <FormCompare views={[result, attackResult, speedResult].map((r) => r?.formViews ?? [])} />
            <CombinedView combined={combined} />
          </>
        )}
        {complete.length > 0 && <ObservationTips observations={complete.map((c) => c.obs)} />}
        {hasDealtRows && (
          <p className="dinf-assume">
            가정(내가 입힌 데미지): 화면 %는 내림(HP가 남으면 최소 1%) · 상대 특성{" "}
            {activeAbilityId ? getAbility(activeAbilityId)?.name : "없음(모름)"}{anyMega ? " (메가 후 관측은 메가폼 특성)" : ""} · 상대 도구{" "}
            {anyMega ? "메가스톤" : itemId ? getItem(itemId)?.name : "없음(모름)"} · 관측 사이 회복 없음{tolerant ? " · ±1% 여유" : ""}
          </p>
        )}
        {hasReceivedRows && (
          <p className="dinf-assume">
            가정(내가 받은 데미지): 상대 공격 보정 특성 {activeAtkAbilityId ? getAbility(activeAtkAbilityId)?.name : "없음(모름)"}
            {anyMegaReceived ? " (메가 후 관측은 메가폼 특성)" : ""} · 상대 공격 보정 도구 {anyMegaReceived ? "메가스톤" : atkItemId ? getItem(atkItemId)?.name : "없음(모름)"} · 상대 공격{" "}
            {atkStage > 0 ? `+${atkStage}` : atkStage}·특공 {spaStage > 0 ? `+${spaStage}` : spaStage}랭크{oppBurned ? " · 상대 화상" : ""}
            {myScreen ? ` · 내 쪽 ${{ reflect: "리플렉터", lightScreen: "빛의장막", auroraVeil: "오로라베일" }[myScreen]}` : ""}
          </p>
        )}
      </section>

      {movePickerRow !== null &&
        (() => {
          const pickerRow = rows.find((r) => r.id === movePickerRow);
          const received = pickerRow?.kind === "received";
          const owner = received ? defenderPokemon : attackerPokemon;
          if (!owner) return null;
          return (
            <MovePickerModal
              pokemon={owner}
              formVariant={received ? defender.formVariant : attacker.formVariant}
              currentMoveIds={[pickerRow?.moveId ?? null]}
              onClose={() => setMovePickerRow(null)}
              onSelect={(moveId) => {
                updateRow(movePickerRow, { moveId, hits: "" });
                setMovePickerRow(null);
              }}
              onClear={() => {
                updateRow(movePickerRow, { moveId: null, hits: "" });
                setMovePickerRow(null);
              }}
            />
          );
        })()}
    </div>
  );
}
