// 8.3 D3-fix-26 지속 연장 출처: 날씨·필드 지속 = 5턴 + (설치한 포켓몬의 **유효** 도구가 맞는 바위·그라운드코트면 +3).
// Showdown `durationCallback(source)` → `source.hasItem(...)`(서투름·매직룸이면 불발). 엔진은 기술 경로만 맞았고 특성 경로(시작·등장)는 양쪽 도구 중 큰 값을 썼으며,
// 모래뿜기·넘치는씨는 보너스가 없었다. 설계 `8.3-D3-E5-검수.md` §2-3·§3 fix-26. 수동 날씨(사용자가 시작 때 고름)는 설치자가 없어 양쪽 도구 규칙을 유지한다.
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  const idle = () => act(IDLE);
  const M = (id, ability = null, item = null, moves = [IDLE, "아이언헤드", "비바라기"]) => mon(id, moves, ability, item);

  // ── 시작(createBattleState): 날씨 특성의 지속 ──
  guard("D3-fix26 1 시작 단일 날씨 특성: 설치자의 맞는 바위만 +3(상대 바위·다른 날씨 바위는 무효)", () => {
    const t = (aItem, bItem) => battle([M("잠만보", "잔비", aItem)], [M("한카리아스", null, bItem)]).weatherTurnsRemaining;
    const got = { none: t(null, null), selfRock: t("축축한바위", null), oppRock: t(null, "축축한바위"), wrongRock: t("뜨거운바위", null) };
    return got.none === 5 && got.selfRock === 8 && got.oppRock === 5 && got.wrongRock === 5 ? true : json(got);
  });
  guard("D3-fix26 2 시작 날씨 특성 둘(다른 날씨): 최종 날씨(나중 발동)를 건 쪽의 도구만 본다", () => {
    // 한카리아스(빠름)=가뭄, 잠만보(느림)=잔비 → 잠만보의 비가 최종. 빠른 쪽의 축축한바위는 설치자가 아니라 무효, 잠만보의 바위만 +3.
    const t = (fastItem, slowItem) => { const st = battle([M("한카리아스", "가뭄", fastItem)], [M("잠만보", "잔비", slowItem)]); return json([st.weather, st.weatherTurnsRemaining]); };
    const got = { fastRock: t("축축한바위", null), slowRock: t(null, "축축한바위"), none: t(null, null) };
    return got.fastRock === json(["비", 5]) && got.slowRock === json(["비", 8]) && got.none === json(["비", 5]) ? true : json(got);
  });

  // ── 등장(교체): 날씨 특성 ──
  const entryTurns = (who, { room = false } = {}) => {
    const self = M("한카리아스", "모래날림", who === "self" ? "보송보송바위" : null);
    const st = battle([M("잠만보"), self], [M("잠만보", null, who === "opp" ? "보송보송바위" : null)]);
    if (room) st.magicRoomTurnsRemaining = 5;
    const out = rt.runTurn(st, { kind: "switch", toIndex: 1 }, idle(), () => 0.5);
    return out.nextState.weatherTurnsRemaining; // 턴 종료 감소가 같이 반영되지만 세 경우가 같아 상대 비교만 한다
  };
  guard("D3-fix26 3 등장 날씨 특성: 들어온 쪽의 바위만 +3(상대가 든 바위는 무효)", () => {
    const got = { none: entryTurns("none"), self: entryTurns("self"), opp: entryTurns("opp") };
    return got.self === got.none + 3 && got.opp === got.none ? true : json(got);
  });
  guard("D3-fix26 4 매직룸 중에는 설치자 바위도 불발(보너스 없음)", () => {
    const none = entryTurns("none", { room: true }), self = entryTurns("self", { room: true });
    return self === none ? true : json({ none, self });
  });

  // ── 모래뿜기·넘치는씨: 피격한 쪽(특성 보유자)의 도구 ──
  const hit = (defenderAbility, defenderItem, attackerItem, preset) => {
    const st = battle([M("한카리아스", null, attackerItem)], [M("잠만보", defenderAbility, defenderItem)]);
    if (preset) Object.assign(st, preset);
    const out = rt.runTurn(st, act("아이언헤드"), idle(), () => 0.5);
    return out.nextState;
  };
  guard("D3-fix26 5 모래뿜기: 피격한 보유자의 보송보송바위만 +3(공격자 바위는 무효)", () => {
    const none = hit("모래뿜기", null, null).weatherTurnsRemaining, own = hit("모래뿜기", "보송보송바위", null).weatherTurnsRemaining, atk = hit("모래뿜기", null, "보송보송바위").weatherTurnsRemaining;
    return hit("모래뿜기", null, null).weather === "모래바람" && own === none + 3 && atk === none ? true : json({ none, own, atk });
  });
  guard("D3-fix26 6 넘치는씨: 피격한 보유자의 그라운드코트만 +3(공격자 그라운드코트는 무효)", () => {
    const none = hit("넘치는씨", null, null).fieldTurnsRemaining, own = hit("넘치는씨", "그라운드코트", null).fieldTurnsRemaining, atk = hit("넘치는씨", null, "그라운드코트").fieldTurnsRemaining;
    return hit("넘치는씨", null, null).field === "그래스필드" && own === none + 3 && atk === none ? true : json({ none, own, atk });
  });
  guard("D3-fix26 7 이미 모래바람이면 모래뿜기가 다시 발동해도 갱신하지 않는다(남은 턴이 5로 채워지지 않음)", () => {
    const st = hit("모래뿜기", "보송보송바위", null, { weather: "모래바람", weatherTurnsRemaining: 2 });
    return st.weather === "모래바람" && st.weatherTurnsRemaining <= 2 ? true : json({ turns: st.weatherTurnsRemaining });
  });

  // ── 기술 경로(원래 맞음): 유효 도구 확인 — 서투름은 도구 효과가 없다 ──
  guard("D3-fix26 8 기술 경로: 비바라기 + 축축한바위 = 8턴이지만 서투름이면 5턴(불변 확인)", () => {
    const rain = (ability) => {
      const st = battle([M("잠만보", ability, "축축한바위")], [M("한카리아스")]);
      const out = rt.runTurn(st, act("비바라기"), idle(), () => 0.5);
      return out.nextState.weatherTurnsRemaining;
    };
    const plain = rain(null), klutz = rain("서투름");
    return plain === klutz + 3 ? true : json({ plain, klutz });
  });
}
