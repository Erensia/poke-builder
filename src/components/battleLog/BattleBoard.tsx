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
  const [attachA, attachB, fx] = useTurnFx(log, { a: battleState.a.currentHp, b: battleState.b.currentHp });
  // 로그의 AI HP 수치를 %로 바꾸는 데 쓰는 AI 파티의 종 id·최대 HP(파티 인덱스 순 — 같은 종이 둘이어도 개체별로 구분되도록 인덱스로 찾는다)
  const aiParty = aiSide ? battleSide(aiSide)?.party.map((f) => ({ id: f.slot.pokemonId, maxHp: f.maxHp })) : undefined;
  return (
    <>
    <div className="battle-board" style={{ background: battleBoardBackground(battleState) }}>
      <BattleFieldStatus battleState={battleState} />
      {(["a", "b"] as const).map((side) => {
        const pokemon = getPokemon(battleState[side].slot.pokemonId);
        if (!pokemon) return null;
        return (
          <div
            key={side}
            ref={side === "a" ? attachA : attachB}
            className={`battle-fighter battle-fighter-${side}${winner === side ? " is-winner" : ""}${battleState[side].currentHp <= 0 ? " is-fainted" : ""}`}
          >
            {/* 기절 효과(회색조·가라앉음)는 카드 부분에만 걸고, 아래 교체·기술 입력 영역은 그대로 둔다 */}
            <div className="battle-fighter-top">
              <BattleFighterCard {...props} side={side} pokemon={pokemon} shownHp={fx?.hp[side]} />
            </div>
            <BattleFighterInput {...props} side={side} pokemon={pokemon} />
          </div>
        );
      })}
    </div>

    <BattleTurnPanel {...props} />

    <BattleTurnLog log={log} aiSide={aiSide} aiParty={aiParty} reveal={fx ?? undefined} />
    </>
  );
}

