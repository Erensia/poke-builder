// 8.3 D3-fix-30 광합성류(광합성·달빛·아침햇살) 회복 반올림: 회복량 = Showdown `modify(maxHp, factor)` — 쾌청 0.667(=2732/4096)·비/모래/눈 0.25·그 외 0.5, 0.5는 내림.
// 엔진 `floor(maxHp × 2/3 …)`은 쾌청 최대HP≡1(mod 3)·비/모래/눈 최대HP≡3(mod 4)에서 1 적게 회복했다. 설계 `8.3-D3-E5-검수.md` §3 fix-30 (E5-09).
// 기술이 아닌 고정 비율 회복(회복약류 healsFraction)은 이 PR 범위 밖(E10에서 확인).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const df = await server.ssrLoadModule("/src/lib/damageFormula.ts");
  const we = await server.ssrLoadModule("/src/lib/weatherEffects.ts");
  const json = JSON.stringify;
  const IDLE = "칼춤";
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const act = (id) => ({ kind: "move", move: data.getMove(id) });
  // 광합성류를 쓰는 a(매직가드: 모래 피해 없음)의 최대HP를 maxHp, 현재 HP를 1로 두고 한 턴. 회복량 = 행동 결과의 healedAmount.
  const healed = (moveId, weather, maxHp) => {
    const st = battle([mon("잠만보", [moveId, IDLE], "매직가드")], [mon("한카리아스", [IDLE])]);
    st.weather = weather; st.weatherTurnsRemaining = weather ? 5 : undefined;
    st.a.maxHp = maxHp; st.a.currentHp = 1;
    const out = rt.runTurn(st, act(moveId), act(IDLE), () => 0.5);
    return (out.result ?? out.partialResult).actions.find((x) => x.actor === "a").healedAmount ?? 0; // 회복 0이면 필드가 빠진다
  };
  // Showdown 기준값: modify(maxHp, 0.667 | 0.25 | 0.5) = floor((floor(maxHp × numer) + 2047) / 4096)
  const sd = (maxHp, numer) => Math.floor((Math.floor(maxHp * numer) + 2047) / 4096);

  guard("D3-fix30 1 검수 실측: 쾌청 154→103, 비 155→39, 날씨 없음 155→77", () => {
    const got = { sun: healed("광합성", "쾌청", 154), rain: healed("광합성", "비", 155), none: healed("광합성", undefined, 155) };
    return got.sun === 103 && got.rain === 39 && got.none === 77 ? true : json(got);
  });
  guard("D3-fix30 2 최대HP 1~500 전수: 광합성이 쾌청·비·모래바람·눈·날씨 없음 모두 modify(maxHp, factor)와 같다", () => {
    const bad = [];
    for (let hp = 2; hp <= 500; hp++) {
      for (const [w, numer] of [["쾌청", 2732], ["비", 1024], ["모래바람", 1024], ["눈", 1024], [undefined, 2048]]) {
        const got = healed("광합성", w, hp), want = Math.min(hp - 1, sd(hp, numer));
        if (got !== want) { bad.push(`${hp}/${w ?? "없음"}:${got}≠${want}`); if (bad.length > 6) return json(bad); }
      }
    }
    return bad.length === 0 ? true : json(bad);
  });
  guard("D3-fix30 3 달빛·아침햇살도 같은 헬퍼(쾌청 154→103)", () => {
    const got = { moonlight: healed("달빛", "쾌청", 154), morningSun: healed("아침햇살", "쾌청", 154) };
    return got.moonlight === 103 && got.morningSun === 103 ? true : json(got);
  });
  guard("D3-fix30 4 공용 헬퍼(엔진·AI 같은 값): weatherHealAmount가 modify4096(maxHp, 0.667/0.25/0.5)와 같다", () => {
    const f = we.weatherHealAmount;
    if (typeof f !== "function") return "weatherHealAmount 없음";
    const bad = [];
    for (let hp = 1; hp <= 500; hp++) {
      if (f(hp, "쾌청") !== df.modify4096(hp, 0.667) || f(hp, "비") !== df.modify4096(hp, 0.25) || f(hp, undefined) !== df.modify4096(hp, 0.5)) bad.push(hp);
    }
    return bad.length === 0 ? true : json(bad.slice(0, 5));
  });
}
