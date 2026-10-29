import { getPokemon, getMove } from "../../lib/data";
import { getEffectiveForm, getEffectiveGender, megaBadgeLabel } from "../../lib/pokemonForm";
import type { SpriteFormOptions } from "../../lib/sprites";
import { PokemonAvatarWithItem } from "../PokemonAvatarWithItem";
import { rankStageMultiplier } from "../../lib/battlePower";
import { VOLATILE_LABELS, SCREEN_LABELS } from "../../lib/battleLogLabels";
import type { StatusCondition } from "../../types/status";
import type { BaseStats } from "../../types/stats";
import type { Pokemon } from "../../types/pokemon";
import type { Side } from "./shared";
import type { BattleBoardProps } from "./battleBoardTypes";

const STATUS_LABELS: Record<StatusCondition, string> = {
  burn: "화상",
  poison: "독",
  "badly-poisoned": "맹독",
  paralysis: "마비",
  freeze: "얼음",
  sleep: "잠듦",
};

/** 대전 중 실능치 패널에 표시할 6개 스탯을 표 순서(HP·공격·방어·특공·특방·스피드)대로 나열 */
const REAL_STAT_LABELS: { key: keyof BaseStats; label: string }[] = [
  { key: "hp", label: "HP" },
  { key: "atk", label: "공격" },
  { key: "def", label: "방어" },
  { key: "spa", label: "특공" },
  { key: "spd", label: "특방" },
  { key: "spe", label: "스피드" },
];

/** 한 편의 카드 윗부분 — 이름·상태 태그·HP·실능치(또는 상대 파티)·파티 트래커 */
export function BattleFighterCard(props: BattleBoardProps & { side: Side; pokemon: Pokemon }) {
  const { side, pokemon, battleState, battleSide, buildableIndices, pokemonAt, selection, aiSide, aiThinking } = props;
  const fighter = battleState[side];
        const displayName = fighter.illusionAs
          ? getPokemon(fighter.illusionAs)?.name ?? pokemon.name
          : pokemon.name;
        // 셋업 카드와 동일하게 메가진화 여부를 반영해서 이름 옆에 배지를 그린다.
        // fighter.slot(EvaluatorSlot)은 FormSource를 만족하므로 getEffectiveForm을 그대로 쓸 수 있다.
        // (메가진화 관련 용도 전용 — 변신 중에도 메타몽 자신의 메가 여부라 원본 종 기준 그대로 둔다.)
        const form = getEffectiveForm(pokemon, fighter.slot);
        const hpPercent = Math.max(0, Math.min(100, (fighter.currentHp / fighter.maxHp) * 100));
        // 변신(§괴짜/변신, ver.1.6): 로그엔 "변신했다!"가 찍히는데 보드 표시가 안 바뀌던 버그 —
        // 이름은 원본 종 그대로 두되(본가 규칙), 스프라이트·타입 배지는 변신 대상 모습으로 보여준다.
        // fighter.types는 applyTransform이 이미 대상 것으로 갈아치워 둔 값이라 그대로 쓴다.
        const transformedPokemon =
          !fighter.illusionAs && fighter.transformedIntoPokemonId
            ? getPokemon(fighter.transformedIntoPokemonId)
            : undefined;
        // §1-4: 대전 화면 아바타. 일루전 중이면 위장 대상 종의 스프라이트를(상대가 안 눈치채도록,
        // 도구 뱃지도 숨김), 변신 중이면 변신 대상 종을(성별·폼 등은 복제 대상이 아니라 기본
        // 모습으로), 아니면 실제 종. 메가스톤을 들어도 실제로 선언(hasMegaEvolved)해야
        // 메가폼 스프라이트로 바뀐다 — 그래서 item은 스프라이트 옵션에 안 넘기고(메가스톤이
        // 스프라이트를 강제로 메가폼으로 만들기 때문) 뱃지로만 표시한다.
        const illusionPokemon = fighter.illusionAs ? getPokemon(fighter.illusionAs) : undefined;
        const avatarPokemon = illusionPokemon ?? transformedPokemon ?? pokemon;
        // 변신 시점에 대상이 메가진화 상태였으면(transformedIntoMegaStone) 그 메가폼 이미지 그대로.
        const transformedMegaForm = transformedPokemon?.megaEvolutions?.find(
          (m) => m.megaStone === fighter.transformedIntoMegaStone,
        )?.form;
        const avatarForm: SpriteFormOptions = illusionPokemon
          ? {}
          : transformedPokemon
            ? { activeMegaForm: transformedMegaForm }
            : {
                gender: getEffectiveGender(pokemon, fighter.slot),
                cosmeticForm: fighter.slot.cosmeticForm,
                formVariant: fighter.slot.formVariant,
                sizeForm: fighter.slot.sizeForm,
                activeMegaForm: fighter.hasMegaEvolved ? form.mega?.form : undefined,
              };
        // battleState 안의 slot은 EvaluatorSlot(moves 필드 없음)이라, 4개 기술 목록은
        // 셋업 단계에서 쓴 PartySlot을 활성 슬롯 인덱스로 되짚어 가져온다 — 배틀 중엔 안 바뀜
  return (
    <>
            <div className="battle-fighter-head">
              <div className="battle-fighter-ident">
                {/* 2.3 B2: 배틀타워에서 상대(AI) 도구 이미지는 숨긴다. 내 포켓몬은 그대로 표기 */}
                <PokemonAvatarWithItem
                  pokemon={avatarPokemon}
                  form={avatarForm}
                  gradientTypes={illusionPokemon ? illusionPokemon.types : fighter.types}
                  size={38}
                  radius={9}
                  itemId={fighter.illusionAs || side === aiSide ? undefined : fighter.slot.item}
                />
                <span className="battle-fighter-name">
                  {displayName}
                  {/* §4: 스톤을 들어도 실제로 메가진화를 선언(hasMegaEvolved)해야 배지가 뜬다 */}
                  {!fighter.illusionAs && fighter.hasMegaEvolved && form.mega && (
                    <span className="battle-fighter-mega-tag">{megaBadgeLabel(form.mega)}</span>
                  )}
                  {fighter.currentHp <= 0 && <span className="battle-fighter-fainted"> (기절)</span>}
                  {side === aiSide && <span className="battle-fighter-ai-tag">AI</span>}
                  {side === aiSide && aiThinking && (
                    <span className="battle-ai-thinking" role="status" aria-label="AI 생각 중">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </span>
              </div>
              <div className="battle-status-tags">
                {fighter.status.condition && (
                  <span className="battle-status-tag is-major">{STATUS_LABELS[fighter.status.condition]}</span>
                )}
                {(Object.keys(fighter.volatile.active) as (keyof typeof VOLATILE_LABELS)[]).map((v) => {
                  // 사슬묶기/앙코르는 대상 기술 이름까지 같이 보여줘야 어떤 기술이
                  // 막혔는지/강제됐는지 알 수 있다.
                  const entry = fighter.volatile.active[v];
                  const moveName = entry?.moveId ? getMove(entry.moveId)?.name : undefined;
                  // 남은 턴수가 유한한 것(도발·앙코르·사슬묶기·속박·물엿범벅·혼란·졸음)만 " N턴"을
                  // 붙인다(§5-5). 뿌리박기·아쿠아링·씨뿌리기·헤롱헤롱·소금절이는 배틀 끝까지라
                  // 999 센티넬 → 표기 안 함.
                  const turns = entry && entry.turnsRemaining < 900 ? entry.turnsRemaining : undefined;
                  return (
                    <span key={v} className="battle-status-tag is-volatile">
                      {VOLATILE_LABELS[v]}
                      {moveName && `(${moveName})`}
                      {turns !== undefined && ` ${turns}턴`}
                    </span>
                  );
                })}
                {(() => {
                  // 스크린은 편(BattleSide) 단위 상태다(§6-3) — 활성 파이터가 아니라 side에서 읽는다.
                  const screens = battleSide(side)?.screens ?? {};
                  return (Object.keys(screens) as ("reflect" | "lightScreen" | "auroraVeil")[])
                    .filter((s) => screens[s] !== undefined)
                    .map((s) => (
                      <span key={s} className="battle-status-tag is-volatile">
                        {SCREEN_LABELS[s]} {screens[s]}턴
                      </span>
                    ));
                })()}
                {battleSide(side)?.wish && (
                  // 희망사항도 편 단위 큐다(§6-2). turnsRemaining 1 = 이번 턴 종료에 발동.
                  <span className="battle-status-tag is-volatile">희망사항 대기</span>
                )}
                {battleSide(side)?.healingWishPending && (
                  <span className="battle-status-tag is-volatile">치유소원 대기</span>
                )}
                {battleSide(side)?.safeguardTurnsRemaining !== undefined && (
                  // 신비의부적도 스크린과 같은 편 단위 상태다(§1-9).
                  <span className="battle-status-tag is-volatile">
                    신비의부적 {battleSide(side)?.safeguardTurnsRemaining}턴
                  </span>
                )}
                {fighter.magnetRiseTurnsRemaining !== undefined && (
                  <span className="battle-status-tag is-volatile">전자부유 {fighter.magnetRiseTurnsRemaining}턴</span>
                )}
                {fighter.smackedDown && <span className="battle-status-tag is-volatile">떨어뜨리기</span>}
                {fighter.perishCount !== undefined && (
                  <span className="battle-status-tag is-major">멸망 {fighter.perishCount}</span>
                )}
                {fighter.substituteHp !== undefined && (
                  <span className="battle-status-tag is-volatile">
                    {side === aiSide ? "대타" : `대타 HP ${fighter.substituteHp}`}
                  </span>
                )}
                {fighter.unburdenActive && (
                  <span className="battle-status-tag is-volatile">곡예(스피드 2배)</span>
                )}
              </div>
            </div>
            <div className="battle-hp-bar">
              <div
                className={`battle-hp-fill${hpPercent <= 20 ? " is-danger" : hpPercent <= 50 ? " is-warn" : ""}`}
                style={{ width: `${hpPercent}%` }}
              />
            </div>
            <div className="battle-hp-numbers">
              {/* 상대(AI)는 실수치로 최대 HP·능력치를 역산하지 못하게 비율만 보여준다. 올림해서 생존 중엔 0%가 안 되게 */}
              {side === aiSide ? `${Math.ceil(hpPercent)}%` : `${fighter.currentHp} / ${fighter.maxHp}`}
            </div>

            {/* 2.3 B2: 배틀타워에서 상대(AI) 실능치는 숨기고, 그 자리에 상대 파티 6마리를 이미지로
                나열한다 — 출전 여부(선출된 3마리 중 무엇인지)는 표기하지 않고 기절 여부만 표기 */}
            {side === aiSide ? (
              <div className="battle-roster-icons">
                {buildableIndices(side).map((i) => {
                  const pk = pokemonAt(side, i);
                  if (!pk) return null;
                  const battleIdx = selection[side].indexOf(i);
                  const fainted = battleIdx >= 0 && (battleSide(side)?.party[battleIdx]?.currentHp ?? 1) <= 0;
                  return (
                    <div key={i} className={`battle-roster-chip${fainted ? " is-fainted" : ""}`}>
                      <PokemonAvatarWithItem pokemon={pk} size={40} radius={9} />
                      <span className="battle-roster-chip-name">{pk.name}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* 대전 중엔 셋업 카드가 안 보여서 내가 맞춘 능력치를 확인할 방법이 없었다는 피드백 반영 —
                 HP·공격·방어·특공·특방·스피드 실능치를 배틀 보드에도 그대로 노출한다. 칼춤·위협 등
                 랭크 변화는 턴 진행 중 이 표시에 즉시 반영한다(Phase 6.5 §6-2 ⑧) — HP는 랭크 대상이 아님. */
              <div className="battle-real-stats">
                {REAL_STAT_LABELS.map(({ key, label }) => {
                  const base = fighter.realStats[key];
                  const stage = key === "hp" ? 0 : fighter.stages[key];
                  const effective = stage === 0 ? base : Math.round(base * rankStageMultiplier(stage));
                  return (
                    <div
                      key={key}
                      className={`battle-real-stat-item${
                        stage > 0 ? " is-boosted" : stage < 0 ? " is-lowered" : ""
                      }`}
                    >
                      <span className="battle-real-stat-label">{label}</span>
                      <span
                        className="battle-real-stat-value"
                        title={
                          stage !== 0
                            ? `기본 ${Math.round(base)} (${stage > 0 ? "+" : ""}${stage}랭크)`
                            : undefined
                        }
                      >
                        {Math.round(effective)}
                        {stage !== 0 && (
                          <span className="battle-real-stat-stage">
                            {stage > 0 ? `+${stage}` : stage}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 파티 트래커 — 이 편 3마리의 HP·상태·기절, 활성 슬롯 표시. 상대(AI) 쪽은 선출된
                3마리가 그대로 드러나(이름·활성 슬롯) 2.3 B2의 "출전 여부 비공개"와 어긋나서
                숨긴다 — 그 칸은 위 battle-roster-icons가 대신 채운다(사용자 확인, 2.3 B2 보완). */}
            {side !== aiSide && (() => {
              const bs = side === "a" ? battleState.sideA : battleState.sideB;
              if (bs.party.length <= 1) return null;
              return (
                <div className="battle-party-tracker">
                  {bs.party.map((f, i) => {
                    // 일루전(§6-1): 위장 중인 활성 조로아크는 트래커에서도 위장 대상 이름으로 보인다.
                    const pk = getPokemon(f.illusionAs ?? f.slot.pokemonId);
                    const pct = Math.max(0, Math.min(100, (f.currentHp / f.maxHp) * 100));
                    const fainted = f.currentHp <= 0;
                    return (
                      <div
                        key={i}
                        className={`battle-party-chip${i === bs.activeIndex ? " is-active" : ""}${fainted ? " is-fainted" : ""}`}
                        title={`${pk?.name ?? "포켓몬"} · ${f.currentHp}/${f.maxHp}${f.status.condition ? ` · ${STATUS_LABELS[f.status.condition]}` : ""}`}
                      >
                        <span className="battle-party-chip-name">
                          {i === bs.activeIndex ? "▶ " : ""}
                          {pk?.name ?? "포켓몬"}
                        </span>
                        <span className="battle-party-chip-hp">
                          {fainted ? "기절" : `${f.currentHp}/${f.maxHp}`}
                          {f.status.condition && !fainted && ` · ${STATUS_LABELS[f.status.condition]}`}
                          {f.perishCount !== undefined && !fainted && ` · 멸망 ${f.perishCount}`}
                        </span>
                        <span className="battle-party-chip-bar">
                          <span
                            className={`battle-party-chip-fill${pct <= 20 ? " is-danger" : pct <= 50 ? " is-warn" : ""}`}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
    </>
  );
}
