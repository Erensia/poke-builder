import { getAbility, getItem, getMove } from "../lib/data";
import {
  DEFENSE_ITEM_CANDIDATES,
  multiHitRange,
  END_TURN_EFFECTS,
  TOXIC_ID,
  ITEM_END_TURN_IDS,
} from "../lib/defenseInference";
import { ATTACK_ITEM_CANDIDATES } from "../lib/attackInference";
import type { RowKind } from "../lib/inferenceDraft";
import { InfoTooltip } from "./InfoTooltip";
import { STAGE_OPTIONS, megaOf } from "./defenseInferenceHelpers";
import { SpeedConditionsEditor } from "./DefenseInferenceViews";
import { useDefenseInferenceState } from "./useDefenseInferenceState";

/** DefenseInferencePanel의 일부 화면 — 세션(useDefenseInferenceState 결과)에서 필요한 값만 꺼내 쓴다 */
export function ObservationsSection({ s }: { s: ReturnType<typeof useDefenseInferenceState> }) {
  const { rows, rowMessage, megas, defenderPokemon, attackerPokemon, changeKind, updateRow, setMovePickerRow, removeRow, setToxicTurn, updateCond, speedAbilityOptions, anyMegaSpeed, myQuickFeet, addRow, onReset, myMaxHp, hasReceivedRows } = s;
  return (
    <>
      <section className="dinf-section">
        <h3>관측</h3>
        <ol className="dinf-rows">
          {rows.map((row, index) => {
            const move = row.moveId ? getMove(row.moveId) : undefined;
            const message = rowMessage(row);
            const received = row.kind === "received";
            const speed = row.kind === "speed";
            // 앞 줄 중 메가 후인 줄이 있으면 그 폼(메가진화는 되돌릴 수 없다 — 3.1 L1-a)
            const lockedMega = rows.slice(0, index).map((r) => megaOf(r, megas)).find(Boolean) ?? "";
            const pickerOwner = received ? defenderPokemon : attackerPokemon;
            const hasNext = index < rows.length - 1;
            const itemLocked = rows.some((r) => megaOf(r, megas));
            const toxicTurn = Number(row.endTurn.find((x) => TOXIC_ID.test(x))?.slice(5) ?? 0);
            return (
              <li key={row.id} className="dinf-row">
                <span className="dinf-row-no">#{index + 1}</span>
                <select aria-label={`관측 ${index + 1} 종류`} value={row.kind} onChange={(e) => changeKind(row.id, e.target.value as RowKind)}>
                  <option value="dealt">입힌 데미지</option>
                  <option value="received">받은 데미지</option>
                  <option value="speed">선후공</option>
                </select>
                {speed ? (
                  <select aria-label={`관측 ${index + 1} 먼저 움직인 쪽`} value={row.first} onChange={(e) => updateRow(row.id, { first: e.target.value as "me" | "opponent" })}>
                    <option value="me">내가 먼저</option>
                    <option value="opponent">상대가 먼저</option>
                  </select>
                ) : (
                  <button
                    type="button"
                    className="dinf-move-btn"
                    onClick={() => setMovePickerRow(row.id)}
                    disabled={!pickerOwner}
                  >
                    {move ? move.name : !pickerOwner ? (received ? "상대 포켓몬부터 선택" : "내 포켓몬부터 선택") : received ? "상대 기술 선택" : "기술 선택"}
                  </button>
                )}
                <span className="dinf-row-opts">
                  {(() => {
                    const range = move && !speed ? multiHitRange(move) : null;
                    if (!range || range.min === range.max) return null;
                    return (
                      <select aria-label={`관측 ${index + 1} 맞은 타수`} value={row.hits} onChange={(e) => updateRow(row.id, { hits: e.target.value })}>
                        <option value="">타수</option>
                        {Array.from({ length: range.max - range.min + 1 }, (_, k) => range.min + k).map((n) => (
                          <option key={n} value={n}>
                            {n}타
                          </option>
                        ))}
                      </select>
                    );
                  })()}
                  {megas && megas.length > 0 && (
                    <select
                      aria-label={`관측 ${index + 1} 상대 폼`}
                      value={megaOf(row, megas)}
                      onChange={(e) => updateRow(row.id, { megaForm: e.target.value })}
                      disabled={!!lockedMega}
                    >
                      {/* 앞 줄에서 메가진화했으면 이 줄은 그 폼으로 고정 — 메가 전·다른 폼을 고를 수 없다 */}
                      {!lockedMega && <option value="">메가 전</option>}
                      {megas
                        .filter((m) => !lockedMega || m.form === lockedMega)
                        .map((m) => (
                          <option key={m.form} value={m.form}>
                            {m.form.replace(/^.*?-/, "")}
                          </option>
                        ))}
                    </select>
                  )}
                  {lockedMega && <span className="dinf-hint">앞 줄에서 이미 메가진화했어요 (되돌릴 수 없어요)</span>}
                </span>
                {!speed && (
                  <>
                    <span className="dinf-percent-pair">
                      <input
                        className="dinf-percent"
                        inputMode="numeric"
                        aria-label={`관측 ${index + 1} 맞기 전 ${received ? "HP" : "%"}`}
                        value={row.before}
                        onChange={(e) => updateRow(row.id, { before: e.target.value })}
                      />
                      <span>{received ? "HP →" : "% →"}</span>
                      <input
                        className="dinf-percent"
                        inputMode="numeric"
                        aria-label={`관측 ${index + 1} 맞은 뒤 ${received ? "HP" : "%"}`}
                        placeholder="?"
                        value={row.after}
                        onChange={(e) => updateRow(row.id, { after: e.target.value })}
                      />
                      <span>{received ? "HP" : "%"}</span>
                    </span>
                    <label className="toggle-pill tap-target">
                      <input type="checkbox" checked={row.critical} onChange={(e) => updateRow(row.id, { critical: e.target.checked })} />
                      급소
                    </label>
                  </>
                )}
                {message && <span className={`dinf-row-msg is-${message.kind}`}>{message.text}</span>}
                {rows.length > 1 && (
                  <button type="button" className="dinf-row-remove" onClick={() => removeRow(row.id)} aria-label={`관측 ${index + 1} 삭제`}>
                    ✕
                  </button>
                )}
                {!speed && !received && (
                  <div className="dinf-endturn">
                    <InfoTooltip
                      text={[
                        "자뭉열매: 상대가 맞은 직후 자뭉열매를 먹었을 때 켜세요 — 화면의 맞은 뒤 %에 회복(최대 HP의 1/4)이 이미 섞여 있어요",
                        itemLocked && "메가진화하는 포켓몬은 메가스톤을 들고 있어 도구 효과를 쓸 수 없어요",
                      ]
                        .filter(Boolean)
                        .join("\n")}
                    >
                      <span className="dinf-endturn-title">{hasNext ? "턴 종료 효과" : "맞은 직후 효과"}</span>
                    </InfoTooltip>
                    {END_TURN_EFFECTS.filter((e) => hasNext || e.id === "sitrus").map((e) => (
                      <label className="toggle-pill tap-target" key={e.id}>
                        <input
                          type="checkbox"
                          disabled={itemLocked && ITEM_END_TURN_IDS.includes(e.id)}
                          checked={row.endTurn.includes(e.id)}
                          onChange={(ev) => updateRow(row.id, { endTurn: ev.target.checked ? [...row.endTurn, e.id] : row.endTurn.filter((x) => x !== e.id) })}
                        />
                        {e.label}
                      </label>
                    ))}
                    {hasNext && (
                    <label className="toggle-pill tap-target">
                      <input type="checkbox" checked={toxicTurn > 0} onChange={(ev) => setToxicTurn(row, ev.target.checked ? 1 : 0)} />
                      맹독
                    </label>
                    )}
                    {hasNext && toxicTurn > 0 && (
                      <span className="dinf-stepper tap-targets">
                        <button type="button" aria-label={`관측 ${index + 1} 맹독 경과 턴 줄이기`} onClick={() => setToxicTurn(row, Math.max(1, toxicTurn - 1))}>
                          −
                        </button>
                        <span>{toxicTurn}턴째</span>
                        <button type="button" aria-label={`관측 ${index + 1} 맹독 경과 턴 늘리기`} onClick={() => setToxicTurn(row, Math.min(15, toxicTurn + 1))}>
                          +
                        </button>
                      </span>
                    )}
                  </div>
                )}
                {speed && (
                  <SpeedConditionsEditor
                    cond={row.cond}
                    onChange={(patch) => updateCond(row.id, patch)}
                    abilityOptions={speedAbilityOptions}
                    megaRow={!!megaOf(row, megas)}
                    itemDisabled={anyMegaSpeed}
                    myQuickFeet={myQuickFeet}
                  />
                )}
              </li>
            );
          })}
        </ol>
        <button type="button" className="dinf-add tap-target" onClick={addRow}>
          + 관측 추가
        </button>{" "}
        <button
          type="button"
          className="dinf-add tap-target"
          onClick={() => window.confirm("관측과 가정 입력을 모두 지울까요? (내 포켓몬·상대 포켓몬은 그대로예요)") && onReset()}
        >
          입력 지우기
        </button>
        <p className="dinf-note">
          내가 입힌 데미지는 턴 종료 효과를 고르지 않으면 관측 사이에 상대가 HP를 회복하지 않았다고 가정해요 — 효과를 고르면 다음 줄 “맞기 전 %”가 예상값으로 채워지니 화면과 다르면 직접 고쳐 주세요.
          상대가 맞은 직후 자뭉열매를 먹었으면 그 줄에서 “자뭉열매 발동”을 켜세요(화면 %에 회복이 섞여 있어요). 내가 받은 데미지는 맞은 직후 내 HP 수치를 넣어 주세요(먹다남은음식·독 같은 턴 종료 효과가
          섞이면 맞지 않아요){myMaxHp !== null && hasReceivedRows ? ` — 내 최대 HP는 ${myMaxHp}예요` : ""}. 다단히트·고정 데미지 기술은 아직 지원하지 않아요.
          선후공은 우선도가 같은 기술끼리 누가 먼저 움직였는지만 넣고, 그 턴의 조건(트릭룸·순풍·마비·상대 랭크 등)은 줄의 “조건”에서 골라 주세요. 새 줄은 직전 선후공 줄의 조건을 이어받아요.
        </p>
      </section>
    </>
  );
}

/** DefenseInferencePanel의 일부 화면 — 세션(useDefenseInferenceState 결과)에서 필요한 값만 꺼내 쓴다 */
export function AssumptionsSection({ s }: { s: ReturnType<typeof useDefenseInferenceState> }) {
  const { hasDealtRows, activeAbilityId, setAbilityId, defenderPokemon, anyMega, abilityOptions, itemId, setItemId, defStage, setDefStage, spdStage, setSpdStage, tolerant, setTolerant, hasReceivedRows, activeAtkAbilityId, setAtkAbilityId, anyMegaReceived, atkAbilityOptions, atkItemId, setAtkItemId, atkStage, setAtkStage, spaStage, setSpaStage, oppBurned, setOppBurned } = s;
  return (
    <>
      <section className="dinf-section">
        <h3>가정 · 조건</h3>
        {hasDealtRows && (
          <>
        <div className="dinf-conditions">
          <label>
            상대 특성
            <select value={activeAbilityId} onChange={(e) => setAbilityId(e.target.value)} disabled={!defenderPokemon}>
              <option value="">{anyMega ? "모름 (메가 전 관측에 적용)" : "모름 (방어 특성 없음으로 가정)"}</option>
              {abilityOptions.map((id) => (
                <option key={id} value={id}>
                  {getAbility(id)?.name ?? id}
                </option>
              ))}
            </select>
          </label>
          <label>
            상대 도구
            <select value={anyMega ? "" : itemId} onChange={(e) => setItemId(e.target.value)} disabled={anyMega}>
              <option value="">{anyMega ? "메가스톤 (반감 열매 사용 불가)" : "모름 (도구 없음으로 가정)"}</option>
              {DEFENSE_ITEM_CANDIDATES.map((item) => (
                <option key={item.id} value={item.id}>
                  {getItem(item.id)?.name ?? item.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            상대 방어 랭크
            <select value={defStage} onChange={(e) => setDefStage(Number(e.target.value))}>
              {STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s > 0 ? `+${s}` : s}
                </option>
              ))}
            </select>
          </label>
          <label>
            상대 특방 랭크
            <select value={spdStage} onChange={(e) => setSpdStage(Number(e.target.value))}>
              {STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s > 0 ? `+${s}` : s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="toggle-pill tap-target">
          <input type="checkbox" checked={tolerant} onChange={(e) => setTolerant(e.target.checked)} />
          <span>여유 있게 보기 (화면 %를 ±1%까지 허용 — 게임의 % 표시 방식이 다를 때 대비)</span>
        </label>
          </>
        )}
        {hasReceivedRows && (
          <>
            <h4 className="dinf-subhead">내가 받은 데미지 관측용 가정</h4>
            <div className="dinf-conditions">
              <label>
                상대 공격 보정 특성
                <select value={activeAtkAbilityId} onChange={(e) => setAtkAbilityId(e.target.value)} disabled={!defenderPokemon}>
                  <option value="">{anyMegaReceived ? "모름 (메가 전 관측에 적용)" : "모름 (보정 특성 없음으로 가정)"}</option>
                  {atkAbilityOptions.map((id) => (
                    <option key={id} value={id}>
                      {getAbility(id)?.name ?? id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                상대 공격 보정 도구
                <select value={anyMegaReceived ? "" : atkItemId} onChange={(e) => setAtkItemId(e.target.value)} disabled={anyMegaReceived}>
                  <option value="">{anyMegaReceived ? "메가스톤 (보정 도구 사용 불가)" : "모름 (보정 도구 없음으로 가정)"}</option>
                  {ATTACK_ITEM_CANDIDATES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {getItem(item.id)?.name ?? item.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                상대 공격 랭크
                <select value={atkStage} onChange={(e) => setAtkStage(Number(e.target.value))}>
              {STAGE_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st > 0 ? `+${st}` : st}
                </option>
              ))}
                </select>
              </label>
              <label>
                상대 특공 랭크
                <select value={spaStage} onChange={(e) => setSpaStage(Number(e.target.value))}>
              {STAGE_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st > 0 ? `+${st}` : st}
                </option>
              ))}
                </select>
              </label>
            </div>
            <label className="toggle-pill tap-target">
              <input type="checkbox" checked={oppBurned} onChange={(e) => setOppBurned(e.target.checked)} />
              <span>상대가 화상 (물리 공격 반감 — 근성·객기는 예외)</span>
            </label>
          </>
        )}
        <p className="dinf-note">날씨·필드는 위쪽 선택기 값을, 내 랭크·특성·도구는 내 포켓몬 카드 값을 그대로 써요.</p>
      </section>
    </>
  );
}
