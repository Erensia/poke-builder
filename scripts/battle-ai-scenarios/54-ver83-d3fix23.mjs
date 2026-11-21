// 8.3 D3-fix-23 그래스필드: 지진·땅고르기는 땅에 있는(반무적이 아닌) 대상에게 위력 ×0.5.
// Showdown `grassyterrain.onBasePower`: earthquake·bulldoze·magnitude + defender.isGrounded() && !isSemiInvulnerable() → chainModify(0.5). 검수 실측(E5): 기본 위력 100→50, 60→30.
// 설계 `8.3-D3-E5-검수.md` §3 fix-23. 매그니튜드는 출전 불가라 데이터에 없다.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const fe = await server.ssrLoadModule("/src/lib/fieldEffects.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  // 한카리아스(땅 STAB) → 잠만보.
  const dmg = (moveId, field, { hidden = false, defender = "잠만보" } = {}) => {
    const st = battle([mon("한카리아스", [moveId, IDLE])], [mon(defender, [IDLE, "구멍파기"], "매직가드")]);
    st.field = field;
    st.fieldTurnsRemaining = field ? 5 : undefined;
    if (hidden) st.b.chargingMoveId = "구멍파기";
    const out = rt.runTurn(st, act(moveId), hidden ? act("구멍파기") : act(IDLE), () => 0.5);
    // 행동 결과의 피해량(그래스필드 턴 종료 회복이 HP 차이에 섞이지 않게)
    return (out.result ?? out.partialResult).actions.find((x) => x.actor === "a").damage;
  };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  guard("D3-fix23 1 지진: 그래스필드의 접지 대상은 필드 없을 때의 절반(±3)", () => {
    const none = dmg("지진", undefined), grass = dmg("지진", "그래스필드");
    return none > 0 && near(grass * 2, none, 3) ? true : json({ none, grass });
  });
  guard("D3-fix23 2 땅고르기: 같은 규칙(절반)", () => {
    const none = dmg("땅고르기", undefined), grass = dmg("땅고르기", "그래스필드");
    return none > 0 && near(grass * 2, none, 3) ? true : json({ none, grass });
  });
  guard("D3-fix23 3 다른 필드(일렉트릭·사이코·미스트)에서는 지진이 줄지 않는다", () => {
    const none = dmg("지진", undefined);
    const got = ["일렉트릭필드", "사이코필드", "미스트필드"].map((f) => dmg("지진", f));
    return got.every((d) => d === none) ? true : json({ none, got });
  });
  guard("D3-fix23 4 데이터 표식: 지진·땅고르기에 weakenedByGrassyTerrain", () => {
    const m = data.getMove("지진"), other = data.getMove("땅고르기");
    return m.weakenedByGrassyTerrain === true && other.weakenedByGrassyTerrain === true ? true : json({ eq: m.weakenedByGrassyTerrain, bulldoze: other.weakenedByGrassyTerrain });
  });
  guard("D3-fix23 5 구멍파기 중(반무적) 대상에게 지진은 반감되지 않는다(위력 배가만, 필드 있어도 같은 피해)", () => {
    const none = dmg("지진", undefined, { hidden: true }), grass = dmg("지진", "그래스필드", { hidden: true });
    return none > 0 && none === grass ? true : json({ none, grass });
  });
  guard("D3-fix23 6 헬퍼 getFieldDamageMultiplier: 접지·비반무적 대상만 0.5, 풀 타입 ×1.3은 그대로, 필드 없음·비접지·반무적은 1", () => {
    const m = fe.getFieldDamageMultiplier;
    const got = {
      grounded: m("그래스필드", "땅", true, true, true, false),
      airborne: m("그래스필드", "땅", true, false, true, false),
      hidden: m("그래스필드", "땅", true, true, true, true),
      noField: m(undefined, "땅", true, true, true, false),
      notFlagged: m("그래스필드", "땅", true, true, false, false),
      grassMove: m("그래스필드", "풀", true, true, false, false),
    };
    const want = { grounded: 0.5, airborne: 1, hidden: 1, noField: 1, notFlagged: 1, grassMove: 1.3 };
    return json(got) === json(want) ? true : json(got);
  });
}
