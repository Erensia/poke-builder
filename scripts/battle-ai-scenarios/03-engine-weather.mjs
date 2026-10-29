// 엔진: 날씨 기술·썰렁개그·도감 특성 배선(ver.1.8 트랙 J)
export default async function ({ server, data, pts, mon, battle, check }) {
  // ── 엔진: 날씨 기술·썰렁개그(2026-09-24 사용자 확인 규칙) ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
    const rng = () => 0.5;
    const moveAction = (id) => ({ kind: "move", move: data.getMove(id) });
    const idle = moveAction("칼춤");
    // 같은 날씨 → 실패, 남은 턴 유지 / 다른 날씨 → 덮어쓰고 5턴
    const same = battle([mon("패리퍼", ["비바라기"])], [mon("한카리아스", ["칼춤"])]);
    same.weather = "비";
    same.weatherTurnsRemaining = 2;
    const sameOut = rt.runTurn(same, moveAction("비바라기"), idle, rng);
    const sameAct = sameOut.result.actions.find((a) => a.actor === "a");
    check(
      "같은 날씨에 비바라기 → 실패·턴 유지",
      sameAct.weatherSetFailed === true && !sameAct.setWeather && sameOut.nextState.weatherTurnsRemaining === 1,
      `failed=${sameAct.weatherSetFailed} 남은턴=${sameOut.nextState.weatherTurnsRemaining}`,
    );
    const other = battle([mon("패리퍼", ["비바라기"])], [mon("한카리아스", ["칼춤"])]);
    other.weather = "쾌청";
    other.weatherTurnsRemaining = 2;
    const otherOut = rt.runTurn(other, moveAction("비바라기"), idle, rng);
    check("다른 날씨에 비바라기 → 덮어씀", otherOut.nextState.weather === "비" && otherOut.nextState.weatherTurnsRemaining === 4, `${otherOut.nextState.weather} ${otherOut.nextState.weatherTurnsRemaining}`);
    // 썰렁개그: 이미 눈이어도 실패 후 교체(returnsToTrainer)
    const chilly = battle([mon("야도킹", ["썰렁개그"]), mon("피카츄", ["10만볼트"])], [mon("한카리아스", ["칼춤"])]);
    chilly.weather = "눈";
    chilly.weatherTurnsRemaining = 3;
    const paused = rt.runTurn(chilly, moveAction("썰렁개그"), idle, rng);
    const chillyAct = paused.partialResult?.actions.find((a) => a.actor === "a");
    const resumed = "awaitingSelfSwitch" in paused ? rt.resumeTurn(paused._ctx, 1) : paused;
    const chillySwitch = resumed.result?.switches.find((s) => s.side === "a" && s.afterMove);
    check(
      "이미 눈에 썰렁개그 → 실패해도 교체",
      "awaitingSelfSwitch" in paused && chillyAct?.weatherSetFailed === true && chillySwitch?.returnsToTrainer === true && resumed.nextState.sideA.activeIndex === 1,
      `paused=${"awaitingSelfSwitch" in paused} failed=${chillyAct?.weatherSetFailed} 교체=${chillySwitch?.returnsToTrainer}`,
    );
    // 공격기의 랭크 변화는 맞았을 때만(방어로 막힘·빗나감·상성 무효면 없음)
    const overheat = (defMoves, rngValue) => {
      const s = battle([mon("히트로토무", ["오버히트"], null, null, pts({ spa: 32, hp: 32 }))], [mon("잠만보", defMoves, null, null, pts({ hp: 32 }))]);
      const out = rt.runTurn(s, moveAction("오버히트"), moveAction(defMoves[0]), () => rngValue);
      return out.nextState.a.stages.spa;
    };
    const blocked = overheat(["방어"], 0.5);
    const landed = overheat(["칼춤"], 0.5);
    const missed = overheat(["칼춤"], 0.95);
    check("오버히트: 방어로 막힘·빗나감 → 특공 유지, 명중 → −2", blocked === 0 && missed === 0 && landed === -2, `막힘=${blocked} 빗나감=${missed} 명중=${landed}`);
    const cc = battle([mon("루카리오", ["인파이트"], null, null, pts({ atk: 32 }))], [mon("팬텀", ["칼춤"], null, null, pts({ hp: 32 }))]);
    const ccOut = rt.runTurn(cc, moveAction("인파이트"), moveAction("칼춤"), rng);
    check("인파이트 vs 고스트(무효) → 방어·특방 유지", ccOut.nextState.a.stages.def === 0 && ccOut.nextState.a.stages.spd === 0, `def=${ccOut.nextState.a.stages.def}`);
    // 같은 날씨 특성으로 등장 → 턴 재충전 없음
    const entry = battle([mon("한카리아스", ["칼춤"]), mon("패리퍼", ["비바라기"], "잔비")], [mon("한카리아스", ["칼춤"])]);
    entry.weather = "비";
    entry.weatherTurnsRemaining = 2;
    const entered = sw.applySwitch(entry, "a", 1).nextState;
    check("같은 날씨 특성 등장 → 턴 유지", entered.weatherTurnsRemaining === 2, `남은턴=${entered.weatherTurnsRemaining}`);
  }
  // ── 도감 특성 배선(ver.1.8 트랙 J): 갈지자걸음·총대장 ──
  {
    const hc = await server.ssrLoadModule("/src/lib/battle/hitChance.ts");
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
    // 갈지자걸음: 혼란 상태일 때만 상대 명중률 ×0.5, 틀깨기는 무시
    const edge = data.getMove("스톤에지");
    const chance = (confused, attackerAbilityId) => {
      const st = battle([mon("한카리아스", ["스톤에지"], attackerAbilityId)], [mon("핫삼", ["불꽃펀치"], "갈지자걸음")]);
      if (confused) st.b.volatile.active.confusion = { turnsRemaining: 3 };
      const defenderAbility = attackerAbilityId === "틀깨기" ? undefined : data.getAbility("갈지자걸음");
      return hc.computeBattleHitChance({
        state: st, attacker: st.a, defender: st.b, move: edge,
        attackerAbility: attackerAbilityId ? data.getAbility(attackerAbilityId) : undefined, defenderAbility,
        attackerItem: undefined, defenderItem: undefined, attackerMovesSecond: false,
      });
    };
    const calm = chance(false, null);
    const confused = chance(true, null);
    const moldBreaker = chance(true, "틀깨기");
    check("갈지자걸음: 혼란 시 명중 ×0.5·틀깨기 무시", Math.abs(calm - 0.8) < 1e-9 && Math.abs(confused - 0.4) < 1e-9 && Math.abs(moldBreaker - 0.8) < 1e-9, `평상=${calm} 혼란=${confused} 틀깨기=${moldBreaker}`);

    // 총대장: 등장 시 쓰러진 같은 편 수를 세고(로그 2줄), 물러나면 초기화, 위력 ×(1 + 0.1 × 수)
    const overlordParty = () => [
      mon("핫삼", ["불꽃펀치"]),
      mon("메타그로스", ["코멧펀치"]),
      mon("대도각참", ["아이언헤드", "칼춤"], "총대장", null, pts({ atk: 32, hp: 32 })),
    ];
    const foe = () => [mon("잠만보", ["칼춤"], null, null, pts({ hp: 32, def: 32 }))];
    const two = battle(overlordParty(), foe());
    two.sideA.party[0].currentHp = 0;
    two.sideA.party[1].currentHp = 0;
    two.a.currentHp = 0;
    const entered = sw.applySwitch(two, "a", 2, { voluntary: false });
    const msgs = entered.entryMessages.join(" / ");
    check(
      "총대장: 쓰러진 2마리 → 수 2·발동 로그 2줄",
      entered.nextState.a.supremeOverlordCount === 2 && msgs.includes("대도각참의 총대장!") && msgs.includes("대도각참은 쓰러진 동료에게서 힘을 받았다!"),
      `count=${entered.nextState.a.supremeOverlordCount} ${msgs}`,
    );
    const none = sw.applySwitch(battle(overlordParty(), foe()), "a", 2);
    check("총대장: 쓰러진 동료 없음 → 발동 안 함", none.nextState.a.supremeOverlordCount === 0 && !none.entryMessages.join("").includes("총대장"), none.entryMessages.join(" / "));
    const back = sw.applySwitch(entered.nextState, "a", 0);
    check("총대장: 물러나면 수 초기화", back.nextState.sideA.party[2].supremeOverlordCount === undefined, `${back.nextState.sideA.party[2].supremeOverlordCount}`);
    const hit = (count) => {
      const st = sw.applySwitch(battle(overlordParty(), foe()), "a", 2).nextState;
      st.a.supremeOverlordCount = count;
      const out = rt.runTurn(st, { kind: "move", move: data.getMove("아이언헤드") }, { kind: "move", move: data.getMove("칼춤") }, () => 0.5);
      return out.result.actions.find((a) => a.actor === "a").damage;
    };
    const base = hit(0);
    const boosted = hit(5);
    check("총대장: 수 5 → 데미지 약 1.5배", boosted / base > 1.4 && boosted / base < 1.6, `${base} → ${boosted}`);
  }
}
