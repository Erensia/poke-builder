// ver.2.x 틀깨기·상대 모델·턴 종료 처리·결정력 화면·랜덤 파티
export default async function ({ server, data, ai, dec, l1, pts, mon, battle, check }) {
  // ── 틀깨기 목록 수정(ver.2.0, 사용자 정리 2026-09-29): 목록 = 틀깨기에 무시당하는 특성 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const hit = (attackerAbility, defender, defenderAbility, move = "아이언헤드") => {
      const st = battle([mon("몰드류", [move], attackerAbility)], [mon(defender, ["칼춤"], defenderAbility, null, pts({ hp: 32 }))]);
      const out = rt.runTurn(st, act(move), act("칼춤"), () => 0.5);
      return { dealt: st.b.currentHp - out.nextState.b.currentHp, recoil: st.a.currentHp - out.nextState.a.currentHp, out };
    };
    const ms = hit("틀깨기", "망나뇽", "멀티스케일").dealt / hit("모래헤치기", "망나뇽", "멀티스케일").dealt;
    check("2.0 틀깨기 → 멀티스케일 무시(목록 = 무시당하는 특성, 이전엔 거꾸로)", ms > 1.8, `배율 ${ms.toFixed(2)}`);
    const aura = hit("틀깨기", "루카리오", "파동의방호").dealt / hit("모래헤치기", "루카리오", "파동의방호").dealt;
    check("2.0 틀깨기 → 파동의방호 무시(복슬복슬과 같은 취급)", aura > 1.8, `배율 ${aura.toFixed(2)}`);
    // 부유: 틀깨기 땅 기술은 맞는다(사용자 화면 확인에서 발견 — 접지 판정 기본값 매개변수가 무시된 특성을 되살렸다)
    const levitate = (ability) => hit(ability, "팬텀", "부유", "지진").dealt;
    check("2.0 틀깨기 지진 → 부유 무시하고 명중(틀깨기 없으면 무효)", levitate("틀깨기") > 0 && levitate("모래헤치기") === 0, `${levitate("틀깨기")} / ${levitate("모래헤치기")}`);
    const rough = hit("틀깨기", "한카리아스", "까칠한피부");
    check("2.0 틀깨기 → 까칠한피부(목록 밖)는 그대로 작동", rough.recoil > 0, `반동 ${rough.recoil}`);
    // 불면: 틀깨기 최면술로 잠들지만 턴 끝에 스스로 치료
    const insomnia = hit("틀깨기", "잠만보", "불면", "최면술");
    const cureLog = insomnia.out.result.endOfTurn?.find((e) => e.abilityCuredStatus === "sleep");
    check("2.0 틀깨기 최면술 → 불면이 턴 끝에 잠듦 치료", !!cureLog && insomnia.out.nextState.b.status.condition === null, cureLog?.abilityCuredStatusAbilityName ?? "치료 로그 없음");
    // 면역: 틀깨기로 건 맹독은 치료 없이 남는다(사용자 정리)
    const immunity = hit("틀깨기", "잠만보", "면역", "맹독");
    check("2.0 틀깨기 맹독 → 면역은 치료 없이 유지", immunity.out.nextState.b.status.condition === "badly-poisoned", `${immunity.out.nextState.b.status.condition}`);
    // 흡반: 틀깨기 울부짖기는 강제 교체된다
    const phaze = (ability) => {
      const st = battle([mon("몰드류", ["울부짖기"], ability)], [mon("잠만보", ["칼춤"], "흡반"), mon("망나뇽", ["칼춤"])]);
      return rt.runTurn(st, act("울부짖기"), act("칼춤"), () => 0.5).nextState.sideB.activeIndex;
    };
    check("2.0 틀깨기 울부짖기 → 흡반 무시하고 강제 교체(틀깨기 없으면 막힘)", phaze("틀깨기") === 1 && phaze("모래헤치기") === 0, `${phaze("틀깨기")} / ${phaze("모래헤치기")}`);
    // 등장 문구
    const lead = battle([mon("몰드류", ["아이언헤드"], "틀깨기")], [mon("잠만보", ["칼춤"])]);
    check("2.0 틀깨기 등장 문구 \"○○○의 틀깨기!\"", lead.entryAnnouncements.includes("몰드류의 틀깨기!"), lead.entryAnnouncements.join(" / "));
  }
  // ── 상대 모델 ver2(ver.2.0 1-B) — 한 단계 추론 · 교체 읽기 ──
  {
    const om = { opponentModel: dec.DEFAULT_OPPONENT_MODEL };
    const params = dec.paramsFor({});
    // 교체 읽기: 한카리아스 앞의 라이츄는 갸라도스(땅 무효)로 교체할 만하다. 지진이 확정 처치가 아니면 들어올 갸라도스를 노려
    // 스톤에지, 확정 처치면 교체 읽기와 무관하게 지진(죽어내밀기가 후속 포켓몬 부담이 적다 — 1-B 2차, 사용자 확인)
    const readCase = (atkPts) =>
      battle(
        [mon("한카리아스", ["지진", "스톤에지"], null, null, atkPts)],
        [mon("라이츄", ["10만볼트"], null, null, pts({ hp: 32, def: 32 })), mon("갸라도스", ["폭포오르기"], "위협", null, pts({ atk: 32, hp: 32 }))],
      );
    const st = readCase(pts({ spe: 32 }));
    const dist = l1.levelOneDistribution(st, "a", params, dec.DEFAULT_OPPONENT_MODEL);
    const off = ai.chooseAiAction(st, "a", 0.5);
    const on = ai.chooseAiAction(st, "a", 0.5, { decisionParams: om });
    check(
      "2.0 1-B 교체 읽기: 불리한 라이츄는 교체 예측 → 들어올 갸라도스에 스톤에지(끄면 지진)",
      dist.switchProb >= dec.DEFAULT_OPPONENT_MODEL.minSwitchProb && off.action.move?.id === "지진" && on.action.move?.id === "스톤에지",
      `q=${dist.switchProb.toFixed(2)} 끔 ${off.action.move?.id} 켬 ${on.action.move?.id}`,
    );
    const sure = ai.chooseAiAction(readCase(pts({ atk: 32, spe: 32 })), "a", 0.5, { decisionParams: om });
    check("2.0 1-B 확정 처치는 교체 읽기와 무관하게 우선(지진)", sure.action.move?.id === "지진", `${sure.action.move?.id}`);
    // 대칭: 교체 읽기는 공격기만이 아니라 교체·변화기 선택지에도 붙는다(1-B 1차는 공격기에만 붙어 AI 교체가 2배가 됐다)
    const benchCase = battle(
      [mon("한카리아스", ["지진", "칼춤"], null, null, pts({ spe: 32 })), mon("메타그로스", ["코멧펀치"])],
      [mon("라이츄", ["10만볼트"], null, null, pts({ hp: 32, def: 32 })), mon("갸라도스", ["폭포오르기"], "위협", null, pts({ atk: 32, hp: 32 }))],
    );
    const sym = ai.chooseAiAction(benchCase, "a", 0.5, { decisionParams: om });
    const kinds = new Set(sym.scored.filter((x) => x.option.switchRead).map((x) => (x.option.optionType === "switch" ? "switch" : x.option.move.category === "status" ? "status" : "attack")));
    check("2.0 1-B 교체 읽기 대칭 — 공격·변화기·교체 선택지 모두에 붙음", kinds.has("attack") && kinds.has("status") && kinds.has("switch"), [...kinds].join(","));
    // 상대가 확정 처치를 가지면 분포가 그 기술로 몰린다
    const ko = battle([mon("핫삼", ["불꽃펀치"], null, null, pts())], [mon("리자몽", ["화염방사", "칼춤"], null, null, pts({ spa: 32, spe: 32 }))]);
    const koDist = l1.levelOneDistribution(ko, "a", params, dec.DEFAULT_OPPONENT_MODEL);
    check("2.0 1-B 상대 확정 처치 → 분포가 그 기술로", (koDist.moveWeights.get("화염방사") ?? 0) > 0.99, JSON.stringify([...koDist.moveWeights]));
    // 난동 등 정해진 행동이면 추론 없음(고정 규칙 모델이 그 기술만 남긴다)
    const locked = battle([mon("핫삼", ["불꽃펀치"])], [mon("한카리아스", ["역린"])]);
    locked.b.volatile.active.rampage = { moveId: "역린", turnsLeft: 1 };
    check("2.0 1-B 상대 난동 중 → 추론 안 함", l1.levelOneDistribution(locked, "a", params, dec.DEFAULT_OPPONENT_MODEL) === undefined);
  }
  // ── 상대를 쓰러뜨린 턴의 턴 종료 처리(ver.2.0 버그 수정 — 플레이테스트 사용자 제보) ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    // 턴 1: 하마돈 하품 → 따라큐 졸음. 턴 2: 따라큐가 하마돈을 쓰러뜨림 → 그 턴 끝에 잠들어야 한다
    const st = battle([mon("따라큐", ["치근거리기"], null, "먹다남은음식")], [mon("하마돈", ["하품"]), mon("갸라도스", ["폭포오르기"])]);
    const t1 = rt.runTurn(st, act("치근거리기"), act("하품"), () => 0.5).nextState;
    t1.b.currentHp = 1;
    t1.a.currentHp = Math.floor(t1.a.maxHp / 2);
    const t2 = rt.runTurn(t1, act("치근거리기"), act("하품"), () => 0.5);
    const asleep = t2.nextState.a.status.condition === "sleep";
    const leftovers = t2.nextState.a.currentHp > t1.a.currentHp;
    check(
      "2.0 상대를 쓰러뜨린 턴에도 살아 있는 쪽 턴 종료 처리(하품 졸음 → 잠듦, 먹다남은음식)",
      t2.nextState.b.currentHp <= 0 && asleep && leftovers,
      `하마돈 기절 ${t2.nextState.b.currentHp <= 0} 잠듦 ${asleep} 회복 ${leftovers}`,
    );
    // 씨뿌리기: 씨를 뿌린 쪽이 이번 턴 쓰러졌으면 흡수 없음(데미지도 없음)
    const seeded = battle([mon("따라큐", ["치근거리기"])], [mon("하마돈", ["씨뿌리기"]), mon("갸라도스", ["폭포오르기"])]);
    seeded.a.volatile.active.leechSeed = {};
    seeded.b.currentHp = 1;
    const hpBefore = seeded.a.currentHp;
    const s2 = rt.runTurn(seeded, act("치근거리기"), act("씨뿌리기"), () => 0.5);
    check("2.0 씨를 뿌린 쪽이 쓰러진 턴엔 씨뿌리기 발동 안 함", s2.nextState.a.currentHp === hpBefore, `${hpBefore} → ${s2.nextState.a.currentHp}`);
    // 교체로 나온 포켓몬이 스텔스록에 그 자리에서 쓰러지면, 행동 전에 대체를 고른 뒤 상대의 HP회복이 정상 발동해야 한다
    {
      const hz = battle([mon("갸라도스", ["HP회복", "폭포오르기"])], [mon("갸라도스", ["폭포오르기"]), mon("한카리아스", ["지진"])]);
      hz.sideB.hazards.stealthRock = true;
      hz.sideB.party[1].currentHp = 10;
      hz.a.currentHp = Math.floor(hz.a.maxHp / 2);
      const hpBefore = hz.a.currentHp;
      const p1 = rt.runTurn(hz, act("HP회복"), { kind: "switch", toIndex: 1 }, () => 0.5);
      const paused = "awaitingSelfSwitch" in p1 && p1.awaitingSelfSwitch.side === "b" && p1.awaitingSelfSwitch.faintReplacement === true;
      const p2 = paused ? rt.resumeTurn(p1._ctx, 0) : p1;
      const healed = !!p2.result && p2.nextState.a.currentHp > hpBefore && p2.result.actions.length === 1;
      check("2.1 교체 직후 설치물로 쓰러지면 대체를 먼저 고른 뒤 상대 행동(HP회복) 진행", paused && healed, `멈춤 ${paused} 회복 ${hpBefore} → ${p2.nextState.a.currentHp}`);
    }
    void sw;
  }
  // 2.2 E1: 위기회피·탈출버튼은 상대가 턴 시작에 교체해 들어온 직후 맞아도 발동해야 한다(didSwitch 재사용 버그)
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const hit = { kind: "move", move: data.getMove("막치기") };
    const idle = { kind: "move", move: data.getMove("칼춤") };
    // 막치기 한 방이 HP를 절반 위→절반 이하(기절 아님)로 만들도록 갑주무사 HP를 맞춘다
    const setup = (ability, item) => {
      const st = battle(
        [mon("한카리아스", ["막치기"])],
        [mon("아머까오", ["칼춤"]), mon("갑주무사", ["칼춤"], ability, item, pts({ hp: 32 })), mon("메타그로스", ["칼춤"])],
      );
      const probe = structuredClone(st);
      probe.sideB.activeIndex = 1;
      const po = rt.runTurn(probe, hit, idle, () => 0.5);
      const dmg = (po.result ?? po.partialResult).actions.find((a) => a.actor === "a").damage;
      const f = st.sideB.party[1];
      f.currentHp = Math.floor(f.maxHp / 2) + 1;
      return { st, ok: dmg >= 1 && dmg < f.currentHp };
    };
    const exitCase = (ability, item, bAction, label, flag) => {
      const { st, ok } = setup(ability, item);
      if (bAction.kind === "move") st.sideB.activeIndex = 1;
      const out = rt.runTurn(st, hit, bAction, () => 0.5);
      const sw = out.awaitingSelfSwitch;
      const resumed = sw ? rt.resumeTurn(out._ctx, 2) : null;
      check(label, ok && sw?.side === "b" && !!sw[flag] && resumed?.nextState.sideB.activeIndex === 2, `세팅 ${ok} 멈춤 ${JSON.stringify(sw)} 재개 후 ${resumed?.nextState.sideB.activeIndex}`);
    };
    exitCase("위기회피", null, { kind: "switch", toIndex: 1 }, "E1-1 턴 시작 교체로 들어온 위기회피 → 맞으면 교체창", "emergencyExit");
    exitCase("위기회피", null, idle, "E1-2 가만히 있던 위기회피 → 교체창(회귀)", "emergencyExit");
    exitCase(null, "탈출버튼", { kind: "switch", toIndex: 1 }, "E1-3 턴 시작 교체로 들어온 탈출버튼 → 맞으면 교체창", "ejectItemName");
    // 위기회피가 발동하는 피격에서는 오랭열매를 먹지 않는다(포챔스 확인) — 나갈 수 없으면(예비 없음) 정상 발동
    {
      const { st, ok } = setup("위기회피", "오랭열매");
      const out = rt.runTurn(st, hit, { kind: "switch", toIndex: 1 }, () => 0.5);
      const held = out.nextState.sideB.party[1];
      check("E1-4 위기회피 발동 → 오랭열매 미소비", ok && !!out.awaitingSelfSwitch?.emergencyExit && held.currentItemId === "오랭열매" && !held.itemConsumed, `멈춤 ${!!out.awaitingSelfSwitch} 도구 ${held.currentItemId} 소비 ${held.itemConsumed}`);
      const solo = battle([mon("한카리아스", ["막치기"])], [mon("갑주무사", ["칼춤"], "위기회피", "오랭열매", pts({ hp: 32 }))]);
      solo.b.currentHp = Math.floor(solo.b.maxHp / 2) + 1;
      const so = rt.runTurn(solo, hit, idle, () => 0.5);
      check("E1-5 예비 없어 못 나가면 오랭열매 정상 발동", !so.awaitingSelfSwitch && so.nextState.b.itemConsumed === true, `멈춤 ${!!so.awaitingSelfSwitch} 소비 ${so.nextState.b.itemConsumed}`);
    }
    // 드래곤테일로 이미 강제 교체된 위기회피는 이중 교체 없이 끝난다
    {
      const st = battle(
        [mon("한카리아스", ["드래곤테일"])],
        [mon("갑주무사", ["칼춤"], "위기회피", null, pts({ hp: 32 })), mon("메타그로스", ["칼춤"])],
      );
      st.sideB.party[0].currentHp = Math.floor(st.sideB.party[0].maxHp / 2) + 1;
      const out = rt.runTurn(st, { kind: "move", move: data.getMove("드래곤테일") }, idle, () => 0.5);
      check("E1-6 드래곤테일 강제 교체 → 위기회피 이중 교체 없음", !out.awaitingSelfSwitch, JSON.stringify(out.awaitingSelfSwitch));
    }
  }
  // 2.2 F1: 결정력 화면 리베로·변환자재 자속보정 토글 — 켜면 기술 타입으로 자속 판정, 끄면 기본(자속 없음)
  {
    const me = await server.ssrLoadModule("/src/lib/matchupEvaluator.ts");
    const kick = data.getMove("무릎차기");
    const atk = (ability) => mon("에이스번", ["무릎차기"], ability, null, pts({ atk: 32 })).slot;
    const def = mon("메타그로스", ["칼춤"]).slot;
    const power = (ability, on) => me.computeSoloOffensePower(atk(ability), kick, { attackerTypeToMoveType: on });
    const off = power("리베로", false);
    check("F1 리베로 토글 끔 → 자속 없음, 켬 → 1.5배", off > 0 && Math.abs(power("리베로", true) / off - 1.5) < 1e-9, `끔 ${off} 켬 ${power("리베로", true)}`);
    const full = (on) => me.evaluateSlotMatchup(atk("리베로"), kick, def, { attackerTypeToMoveType: on })?.offensePower;
    check("F1 상대 계산(evaluateSlotMatchup)도 동일 1.5배", Math.abs(full(true) / full(false) - 1.5) < 1e-9, `${full(false)} → ${full(true)}`);
    const noLibero = atk("맹화");
    check("F1 리베로가 아닌 특성은 토글 켜도 무변화", me.computeSoloOffensePower(noLibero, kick, { attackerTypeToMoveType: true }) === me.computeSoloOffensePower(noLibero, kick, {}));
  }
  // 2.2 B6: 저장 슬롯 조합 랜덤 파티 — 6마리·중복 포켓몬/도구 없음·메가 최대 2마리, 모자라면 기본 제공 슬롯으로 보충, 입력 불변
  {
    const rs = await server.ssrLoadModule("/src/lib/randomSlotParty.ts");
    const pf = await server.ssrLoadModule("/src/lib/pokemonForm.ts");
    let seed = 7;
    const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const pool = data.SAMPLE_PARTIES.flatMap((p) => p.slots);
    const megaCount = (slots) => slots.filter((s) => s.activeMegaForm || pf.findMegaFormByStone(data.getPokemon(s.pokemonId), s.item)).length;
    const valid = (slots) =>
      slots.length === 6 &&
      new Set(slots.map((s) => s.pokemonId)).size === 6 &&
      new Set(slots.filter((s) => s.item).map((s) => s.item)).size === slots.filter((s) => s.item).length &&
      megaCount(slots) <= 2;
    const savedFew = structuredClone(data.SAMPLE_PARTIES[0].slots.slice(0, 3));
    const frozen = JSON.stringify(savedFew);
    let allValid = true;
    let allSavedFirst = true;
    for (let t = 0; t < 200; t++) {
      const r = rs.buildRandomPartyFromSlots(t % 2 ? savedFew : pool, pool, rng);
      if (!valid(r.slots)) allValid = false;
      if (t % 2 && !(r.fromSaved === 3 && r.slots.slice(0, 3).every((s) => savedFew.some((x) => x.pokemonId === s.pokemonId)))) allSavedFirst = false;
    }
    check("B6 랜덤 파티 200회 — 6마리·중복 포켓몬/도구 없음·메가 ≤2", allValid);
    // 메가 2마리까지 허용: 전체 풀로 뽑을 때 메가 2마리 파티가 실제로 나오고 3마리 이상은 안 나온다
    const megaMax = Math.max(...Array.from({ length: 200 }, () => megaCount(rs.buildRandomPartyFromSlots(pool, pool, rng).slots)));
    check("B6 메가 2마리 파티가 나올 수 있고 3마리 이상은 안 나옴", megaMax === 2, `최대 ${megaMax}`);
    check("B6 저장 슬롯 3마리 → 전부 포함하고 나머지는 기본 슬롯으로 보충", allSavedFirst);
    const none = rs.buildRandomPartyFromSlots([], pool, rng);
    check("B6 저장 슬롯 0개 → 기본 제공 슬롯으로만 6마리", none.fromSaved === 0 && valid(none.slots));
    const dup = rs.buildRandomPartyFromSlots([savedFew[0], savedFew[0], savedFew[0]], pool, rng);
    check("B6 같은 포켓몬만 저장돼 있어도 1마리만 쓰고 보충", dup.fromSaved === 1 && valid(dup.slots));
    check("B6 입력 슬롯을 변형하지 않음(사본 반환)", JSON.stringify(savedFew) === frozen && rs.buildRandomPartyFromSlots(savedFew, pool, rng).slots.every((s) => !savedFew.includes(s)));
  }
}
