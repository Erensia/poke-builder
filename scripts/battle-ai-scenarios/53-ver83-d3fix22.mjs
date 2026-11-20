// 8.3 D3-fix-22 솔라빔·솔라블레이드: 위력 ×0.5는 비·모래바람·눈에서만. 날씨 없음·쾌청은 정상 위력, 메가솔라 보유자는 어느 날씨든 정상.
// Showdown `solarbeam`·`solarblade` `onBasePower`: weakWeathers = [비·모래바람·눈…]이면 chainModify(0.5). 검수 실측(E5): 솔라빔 120/60/60/60/120, 솔라블레이드 125/62/62/62/125, 메가솔라 모든 날씨 정상.
// 설계 `8.3-D3-E5-검수.md` §3 fix-22.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const we = await server.ssrLoadModule("/src/lib/weatherEffects.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  // 모으기 2턴째(발사 턴)를 직접 만든다 — 날씨에 따라 준비 턴이 생략되는 차이를 빼고 위력만 비교한다.
  const fire = (moveId, weather, { ability = null } = {}) => {
    const st = battle([mon("라플레시아", [moveId], ability)], [mon("잠만보", [IDLE], "매직가드")]); // 매직가드: 모래바람 턴 종료 피해가 측정값에 섞이지 않게
    st.weather = weather;
    st.weatherTurnsRemaining = weather ? 5 : undefined;
    st.a.chargingMoveId = moveId;
    const hp = st.b.currentHp;
    const out = rt.runTurn(st, act(moveId), act(IDLE), () => 0.5);
    return hp - out.nextState.b.currentHp;
  };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  guard("D3-fix22 1 솔라빔: 날씨 없음·쾌청은 같은 피해(위력 120), 비·모래바람·눈은 절반", () => {
    const none = fire("솔라빔", undefined), sun = fire("솔라빔", "쾌청");
    const r = fire("솔라빔", "비"), s = fire("솔라빔", "모래바람"), sn = fire("솔라빔", "눈");
    return none === sun && none > 0 && near(r * 2, none, 3) && near(s * 2, none, 3) && near(sn * 2, none, 3) ? true : json({ none, sun, r, s, sn });
  });
  guard("D3-fix22 2 솔라블레이드: 같은 규칙(날씨 없음·쾌청 정상, 비·모래바람·눈 절반)", () => {
    const none = fire("솔라블레이드", undefined), sun = fire("솔라블레이드", "쾌청");
    const r = fire("솔라블레이드", "비"), s = fire("솔라블레이드", "모래바람"), sn = fire("솔라블레이드", "눈");
    return none === sun && none > 0 && near(r * 2, none, 3) && near(s * 2, none, 3) && near(sn * 2, none, 3) ? true : json({ none, sun, r, s, sn });
  });
  guard("D3-fix22 3 메가솔라 보유자는 어느 날씨든 정상 위력(솔라빔·솔라블레이드)", () => {
    const o = {};
    for (const m of ["솔라빔", "솔라블레이드"]) {
      const none = fire(m, undefined, { ability: "메가솔라" });
      for (const w of ["비", "모래바람", "눈"]) o[m + w] = fire(m, w, { ability: "메가솔라" }) === none;
    }
    return Object.values(o).every(Boolean) ? true : json(o);
  });
  guard("D3-fix22 4 헬퍼 isSolarBeamHalved: 위력 절반 대상 날씨만 true, 메가솔라는 false, 다른 기술은 false", () => {
    const beam = data.getMove("솔라빔"), blade = data.getMove("솔라블레이드"), other = data.getMove("에너지볼");
    const got = {
      none: we.solarPowerHalved(beam, undefined, false), sun: we.solarPowerHalved(beam, "쾌청", false),
      rain: we.solarPowerHalved(beam, "비", false), sand: we.solarPowerHalved(blade, "모래바람", false), snow: we.solarPowerHalved(blade, "눈", false),
      megasol: we.solarPowerHalved(beam, "비", true), other: we.solarPowerHalved(other, "비", false),
    };
    const want = { none: false, sun: false, rain: true, sand: true, snow: true, megasol: false, other: false };
    return json(got) === json(want) ? true : json(got);
  });
  guard("D3-fix22 5 데이터: 두 기술에 표식, 솔라빔은 옛 이름 표식이 없다", () => {
    const beam = data.getMove("솔라빔"), blade = data.getMove("솔라블레이드");
    return beam.halvesPowerInRainSandSnow === true && blade.halvesPowerInRainSandSnow === true && beam.halvesPowerOutsideChargeSkipWeather === undefined ? true : json({ beam: beam.halvesPowerInRainSandSnow, blade: blade.halvesPowerInRainSandSnow, old: beam.halvesPowerOutsideChargeSkipWeather });
  });
  guard("D3-fix22 6 쾌청이면 충전을 건너뛴다(불변): 쾌청 1턴 발사, 날씨 없음은 준비 턴", () => {
    const run = (weather) => {
      const st = battle([mon("라플레시아", ["솔라빔"])], [mon("잠만보", [IDLE])]);
      st.weather = weather;
      st.weatherTurnsRemaining = weather ? 5 : undefined;
      const hp = st.b.currentHp;
      return hp - rt.runTurn(st, act("솔라빔"), act(IDLE), () => 0.5).nextState.b.currentHp;
    };
    return run("쾌청") > 0 && run(undefined) === 0 ? true : json({ sun: run("쾌청"), none: run(undefined) });
  });
}
