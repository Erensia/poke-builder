// 8.3 D3-fix-24 오로라베일 중첩: 해당 분류의 벽(리플렉터=물리, 빛의장막=특수)이 이미 있으면 오로라베일은 추가 경감이 없다 → 경감은 ×0.5 한 번.
// Showdown `auroraveil.onAnyModifyDamage`: reflect(물리)·lightscreen(특수)이 걸려 있으면 return(추가 없음). 설계 `8.3-D3-E5-검수.md` §3 fix-24 (E5-14).
// 엔진(hitResolution)과 계산기(matchupEvaluator)가 `battlePower.screenMultiplierFromFlags`를 공유한다.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const bp = await server.ssrLoadModule("/src/lib/battlePower.ts");
  const me = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  // 한카리아스 → 잠만보. 상대 편(sideB)에 벽을 직접 세워 한 턴 맞힌 피해량을 잰다. 급소는 난수 0.5로 피한다.
  const dmg = (moveId, screens, { ability = null } = {}) => {
    const st = battle([mon("한카리아스", [moveId, IDLE], ability)], [mon("잠만보", [IDLE], "매직가드")]);
    st.sideB.screens = { ...screens };
    const out = rt.runTurn(st, act(moveId), act(IDLE), () => 0.5);
    return (out.result ?? out.partialResult).actions.find((x) => x.actor === "a").damage;
  };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const T = 5;

  guard("D3-fix24 1 순수 함수: 분류 벽·오로라베일 중 하나라도 있으면 ×2, 둘 다여도 ×2(×4 아님), 둘 다 없으면 ×1", () => {
    const got = [bp.screenMultiplierFromFlags(false, false), bp.screenMultiplierFromFlags(true, false), bp.screenMultiplierFromFlags(false, true), bp.screenMultiplierFromFlags(true, true)];
    return json(got) === json([1, 2, 2, 2]) ? true : json(got);
  });
  guard("D3-fix24 2 물리 공격: 리플렉터 + 오로라베일 = 리플렉터만 = 오로라베일만 = 벽 없을 때의 절반", () => {
    const none = dmg("아이언헤드", {}), reflect = dmg("아이언헤드", { reflect: T }), aurora = dmg("아이언헤드", { auroraVeil: T }), both = dmg("아이언헤드", { reflect: T, auroraVeil: T });
    return none > 0 && near(reflect * 2, none, 3) && near(aurora * 2, none, 3) && both === reflect && both === aurora ? true : json({ none, reflect, aurora, both });
  });
  guard("D3-fix24 3 특수 공격: 빛의장막 + 오로라베일 = 빛의장막만 = 오로라베일만 = 벽 없을 때의 절반", () => {
    const none = dmg("파동탄", {}), light = dmg("파동탄", { lightScreen: T }), aurora = dmg("파동탄", { auroraVeil: T }), both = dmg("파동탄", { lightScreen: T, auroraVeil: T });
    return none > 0 && near(light * 2, none, 3) && near(aurora * 2, none, 3) && both === light && both === aurora ? true : json({ none, light, aurora, both });
  });
  guard("D3-fix24 4 반대 분류 벽은 영향이 없다: 물리 공격에 빛의장막만 = 벽 없음, 특수 공격에 리플렉터만 = 벽 없음, 물리 공격에 빛의장막 + 오로라 = 오로라만(×0.5 한 번)", () => {
    const nonePhys = dmg("아이언헤드", {}), lightOnly = dmg("아이언헤드", { lightScreen: T }), lightAurora = dmg("아이언헤드", { lightScreen: T, auroraVeil: T }), auroraOnly = dmg("아이언헤드", { auroraVeil: T });
    const noneSpec = dmg("파동탄", {}), reflectOnly = dmg("파동탄", { reflect: T });
    return lightOnly === nonePhys && reflectOnly === noneSpec && lightAurora === auroraOnly && near(lightAurora * 2, nonePhys, 3) ? true : json({ nonePhys, lightOnly, lightAurora, auroraOnly, noneSpec, reflectOnly });
  });
  guard("D3-fix24 5 틈새포착은 벽을 아예 무시한다(둘 다 걸려 있어도 벽 없을 때와 같다)", () => {
    const none = dmg("아이언헤드", {}, { ability: "틈새포착" }), both = dmg("아이언헤드", { reflect: T, auroraVeil: T }, { ability: "틈새포착" });
    return none > 0 && both === none ? true : json({ none, both });
  });
  guard("D3-fix24 6 계산기(matchupEvaluator): 리플렉터·오로라베일 옵션이 같은 경감(물리 ×0.5)이고 벽 없음보다 약하다", () => {
    const slot = (id, moves) => mon(id, moves, null).slot;
    const a = slot("한카리아스", ["아이언헤드"]), d = slot("잠만보", ["칼춤"]), mv = data.getMove("아이언헤드");
    const bulk = (screen) => me.evaluateSlotMatchup(a, mv, d, { screen })?.bulkPower;
    const none = bulk(undefined), reflect = bulk("reflect"), aurora = bulk("auroraVeil");
    return none > 0 && reflect === aurora && near(reflect, none * 2, none * 0.01) ? true : json({ none, reflect, aurora });
  });
}
