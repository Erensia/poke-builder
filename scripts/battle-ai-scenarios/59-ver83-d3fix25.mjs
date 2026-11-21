// 8.3 D3-fix-25 벽 깨기(깨트리기·사이코팽·레이징불): 대상 편의 벽은 이 기술의 **데미지 계산 전에** 지워진다.
// Showdown 기술 자신의 `onTryHit`(히트 루프 안: 명중·상성·방어 통과 뒤, 대타·데미지 앞). 엔진은 데미지 뒤에 지워 이 기술 자신의 데미지가 벽에 줄었다.
// 빗나감·상성 무효·방어면 벽 유지(8.3 B8, 시험 29번), 대타를 때려도 깨진다(불변). AI 데미지 추정(moveDamage)도 같은 기준이어야 한다.
// 설계 `8.3-D3-E5-검수.md` §2-4·§3 fix-25 (E5-15).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const md = await server.ssrLoadModule("/src/lib/battle/ai/moveDamage.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  // 한카리아스 → 잠만보(매직가드: 턴 종료 영향 없음). 상대 편에 벽을 세워 한 턴 맞힌 피해량·결과를 잰다. 난수 0.5로 급소를 피한다.
  const hit = (moveId, screens, { defender = "잠만보", tweak } = {}) => {
    const st = battle([mon("한카리아스", [moveId, IDLE])], [mon(defender, [IDLE], "매직가드")]);
    st.sideB.screens = { ...screens };
    tweak?.(st);
    const out = rt.runTurn(st, act(moveId), act(IDLE), () => 0.5);
    const a = (out.result ?? out.partialResult).actions.find((x) => x.actor === "a");
    return { damage: a.damage, broke: a.brokeScreens, left: out.nextState.sideB.screens };
  };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const T = 5;

  guard("D3-fix25 1 깨트리기: 리플렉터가 있어도 이 기술의 피해는 벽 없을 때와 같다(벽은 데미지 전에 사라진다)", () => {
    const none = hit("깨트리기", {}), wall = hit("깨트리기", { reflect: T });
    return none.damage > 0 && wall.damage === none.damage && json(wall.broke) === json(["reflect"]) && json(wall.left) === "{}" ? true : json({ none, wall });
  });
  guard("D3-fix25 2 사이코팽(특수 아님·물리 격투)·레이징불도 같다 — 오로라베일·양쪽 벽이어도 피해 불변, 벽은 모두 제거", () => {
    const out = {};
    for (const mv of ["사이코팽", "레이징불"]) {
      const none = hit(mv, {}), wall = hit(mv, { reflect: T, lightScreen: T, auroraVeil: T });
      out[mv] = { none: none.damage, wall: wall.damage, left: wall.left, broke: wall.broke?.length };
    }
    return ["사이코팽", "레이징불"].every((k) => out[k].none > 0 && out[k].wall === out[k].none && json(out[k].left) === "{}" && out[k].broke === 3) ? true : json(out);
  });
  guard("D3-fix25 3 대조: 벽을 깨지 않는 물리 기술은 리플렉터에 여전히 절반으로 줄고 벽은 남는다", () => {
    const none = hit("아이언헤드", {}), wall = hit("아이언헤드", { reflect: T });
    return near(wall.damage * 2, none.damage, 3) && wall.left.reflect !== undefined && !wall.broke ? true : json({ none, wall });
  });
  guard("D3-fix25 4 대타를 때려도 벽은 깨진다(불변), 대타에 가로막힌 피해량 흡수 후에도 벽 없음", () => {
    const r = hit("깨트리기", { reflect: T }, { tweak: (st) => { st.b.substituteHp = 500; } });
    return json(r.left) === "{}" && json(r.broke) === json(["reflect"]) ? true : json(r);
  });
  guard("D3-fix25 5 빗나감·상성 무효·방어면 벽 유지(8.3 B8 불변): 고스트에게 깨트리기는 무효라 벽이 남는다", () => {
    const r = hit("깨트리기", { reflect: T }, { defender: "다크펫" });
    return r.damage === 0 && r.left.reflect !== undefined && !r.broke ? true : json(r);
  });
  guard("D3-fix25 6 AI 데미지 추정: 깨트리기는 상대 벽을 반영하지 않고(벽 없을 때와 같음), 아이언헤드는 벽에 줄어든다", () => {
    const est = (moveId, screens) => {
      const st = battle([mon("한카리아스", [moveId, IDLE])], [mon("잠만보", [IDLE])]);
      st.sideB.screens = { ...screens };
      return md.estimateMoveHits({ state: st, attacker: st.a, defender: st.b, defenderSide: st.sideB, attackerMovesSecond: false }, data.getMove(moveId)).rawHits;
    };
    const bbNone = est("깨트리기", {}), bbWall = est("깨트리기", { reflect: T }), ihNone = est("아이언헤드", {}), ihWall = est("아이언헤드", { reflect: T });
    return bbNone > 0 && bbWall === bbNone && ihWall > ihNone && ihNone > 0 ? true : json({ bbNone, bbWall, ihNone, ihWall });
  });
}
