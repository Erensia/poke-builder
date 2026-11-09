import { BattleTurnLog } from "../BattleTurnLog";
import { getPokemon } from "../../lib/data";
import type { BattleBoardProps } from "./battleBoardTypes";
import { BattleFieldStatus } from "./BattleFieldStatus";
import { BattleFighterCard } from "./BattleFighterCard";
import { BattleFighterInput } from "./BattleFighterInput";
import { BattleTurnPanel } from "./BattleTurnPanel";
import { useTurnFx } from "./useTurnFx";

/**
 * 실시간 배틀판 — HP게이지·상태태그·실능치·파티트래커·기술/교체 입력·메가진화 토글·턴
 * 진행 버튼까지(§16). `BattleLogPage`가 쥔 배틀 상태·핸들러를 그대로 넘기는
 * presentational 컴포넌트 — 워낙 많은 값을 필요로 해서(23개) `BattleSetupScreen`처럼
 * 개별 훅 객체 하나로 뭉뚱그릴 수 없어 각자 이름 그대로 prop으로 받는다.
 */
export function BattleBoard(props: BattleBoardProps) {
  const { battleState, winner, battleBoardBackground, battleSide, aiSide, log } = props;
  // 6.5 M1 G — 새 턴 결과가 들어오면 행동 순서대로 카드에 돌진·피격 효과를 겹쳐 재생한다.
  // 7.4 E7 — fx는 재생 중인 턴의 로그 공개 범위·HP(이펙트에 맞춰 단계 재생). 재생이 아니면 null
  const [attachA, attachB, fx, resultMs] = useTurnFx(log, battleState);
  // 7.5 F1: 재생 중에는 그 항목이 끝난 시점의 상태(fx.live)를 보여 준다 — 뒤 항목이 상태를 이미 바꿨어도 앞 연출이 끝나야 새 포켓몬이 나온다
  const cur = fx?.live ?? battleState;
  // 7.4 E9: 날씨·필드가 바뀌는 행동이 나오기 전까지는 이전 날씨·필드를 보여 준다
  const env = fx?.env ?? cur;
  // 연출(기절 등)이 재생되는 동안은 선택 UI를 미룬다 — 상태는 이미 "내보낼 포켓몬을 고르는 중"이라 안 그러면 연출보다 먼저 뜬다(7.5)
  const holdChoice = fx !== null && !!(props.pendingForcedSwitch || props.pendingPivot);
  // 로그의 AI HP 수치를 %로 바꾸는 데 쓰는 AI 파티의 종 id·최대 HP(파티 인덱스 순 — 같은 종이 둘이어도 개체별로 구분되도록 인덱스로 찾는다)
  const aiParty = aiSide ? battleSide(aiSide)?.party.map((f) => ({ id: f.slot.pokemonId, maxHp: f.maxHp })) : undefined;
  return (
    <>
    <div className="battle-board" data-weather={env.weather} data-field={env.field} style={{ background: battleBoardBackground({ ...cur, ...env }) }}>
      <BattleFieldStatus battleState={cur} />
      {(["a", "b"] as const).map((side) => {
        const pokemon = getPokemon(battleState[side].slot.pokemonId);
        const shownLive = cur[side];
        if (!pokemon) return null;
        // 7.4 E3: 교체하는 편은 나가는 모션 동안 교체 전 포켓몬 카드를 보여 준다(입력 영역은 실제 상태 그대로)
        const shownState = fx?.showPrev[side] ? fx.prev : cur;
        const shownPokemon = getPokemon(shownState[side].slot.pokemonId) ?? pokemon;
        return (
          <div
            key={side}
            ref={side === "a" ? attachA : attachB}
            className={`battle-fighter battle-fighter-${side}${winner === side ? " is-winner" : ""}${shownLive.currentHp <= 0 ? " is-fainted" : ""}`}
          >
            {/* 기절 효과(회색조·가라앉음)는 카드 부분에만 걸고, 아래 교체·기술 입력 영역은 그대로 둔다 */}
            <div className="battle-fighter-top">
              <BattleFighterCard {...props} battleState={shownState} side={side} pokemon={shownPokemon} shownHp={fx?.hp[side]} />
            </div>
            {/* 자리는 유지한 채 숨겨 카드 높이가 흔들리지 않게 한다 */}
            <div style={{ display: "contents", visibility: holdChoice && (props.pendingForcedSwitch?.[side] || props.pendingPivot?.side === side) ? "hidden" : undefined }}>
              <BattleFighterInput {...props} side={side} pokemon={pokemon} />
            </div>
          </div>
        );
      })}
    </div>

    {/* 대전을 끝내는 항목이 재생 대기 중이거나 선택(교체)을 기다리는 중이면 연출이 끝날 때까지 배너·안내를 미룬다(7.5) */}
    {!(winner && fx && fx.entry < log.length - 1) && !holdChoice && <BattleTurnPanel {...props} resultDelay={resultMs} />}

    <BattleTurnLog log={log} aiSide={aiSide} aiParty={aiParty} reveal={fx ?? undefined} />
    </>
  );
}

