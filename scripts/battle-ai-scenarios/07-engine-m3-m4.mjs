// 트랙 M3·M4(ver.1.8) 특성·타입 바꾸기, 원더룸 등
export default async function ({ server, data, ev, dec, pts, mon, battle, opt, check }) {
  // ── 트랙 M3(ver.1.8): 특성·타입 바꾸기 + 특성 면역 + 교체 시 원복 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b) => rt.runTurn(st, a.kind ? a : act(a), b.kind ? b : act(b), () => 0.5);
    const actionOf = (out, key) => out.result.actions.find((x) => x.actor === key);
    // 스킬스왑·동료만들기·역할 / 폼 변화 특성(배틀스위치)·트레이스는 안 됨
    {
      const st = battle([mon("팬텀", ["스킬스왑", "동료만들기", "역할"], "부유")], [mon("잠만보", ["칼춤"], "두꺼운지방")]);
      const sw1 = run(st, "스킬스왑", "칼춤").nextState;
      const give = run(st, "동료만들기", "칼춤").nextState;
      const copy = run(st, "역할", "칼춤").nextState;
      const fixed = actionOf(run(battle([mon("팬텀", ["스킬스왑"], "부유")], [mon("킬가르도", ["칼춤"], "배틀스위치")]), "스킬스왑", "칼춤"), "a");
      const trace = actionOf(run(battle([mon("팬텀", ["역할"], "부유")], [mon("잠만보", ["칼춤"], "트레이스")]), "역할", "칼춤"), "a");
      check(
        "M3: 스킬스왑·동료만들기·역할 / 배틀스위치 교환·트레이스 복사는 실패",
        sw1.a.effectiveAbilityId === "두꺼운지방" && sw1.b.effectiveAbilityId === "부유" && give.b.effectiveAbilityId === "부유" &&
          copy.a.effectiveAbilityId === "두꺼운지방" && fixed?.abilityChangeFailed === true && trace?.abilityChangeFailed === true,
        `교환=${sw1.a.effectiveAbilityId}/${sw1.b.effectiveAbilityId} 건넴=${give.b.effectiveAbilityId} 복사=${copy.a.effectiveAbilityId}`,
      );
    }
    // 위액: 특성 무효화 → 물러나면 원래 특성 / 심플빔·숲의저주도 물러나면 원복
    {
      const st = battle([mon("팬텀", ["위액", "심플빔", "숲의저주", "칼춤"])], [mon("잠만보", ["칼춤"], "두꺼운지방"), mon("메타그로스", ["코멧펀치"])]);
      const s1 = run(st, "위액", "칼춤").nextState;
      const s2 = run(run(s1, "심플빔", "칼춤").nextState, "숲의저주", "칼춤").nextState;
      const out = run(s2, "칼춤", { kind: "switch", toIndex: 1 }).nextState;
      const back = run(out, "칼춤", { kind: "switch", toIndex: 0 }).nextState;
      check(
        "M3: 위액(특성 무효) + 교체하면 특성·타입 원복(심플빔·숲의저주 포함)",
        s1.b.effectiveAbilityId === null && s1.b.abilitySuppressed === true && s2.b.effectiveAbilityId === "단순" && s2.b.types.includes("풀") &&
          back.b.effectiveAbilityId === "두꺼운지방" && !back.b.types.includes("풀") && !back.b.abilitySuppressed,
        `위액=${s1.b.effectiveAbilityId} 심플빔=${s2.b.effectiveAbilityId} 복귀=${back.b.effectiveAbilityId} 타입=${back.b.types}`,
      );
    }
    // 고민씨: 잠든 상대가 불면이 되면 바로 깬다 / 물붓기·미러타입
    {
      const st = battle([mon("팬텀", ["고민씨", "물붓기", "미러타입"])], [mon("잠만보", ["칼춤"])]);
      st.b.status = { condition: "sleep", turnsElapsed: 0, sleepTurns: 3 };
      const w = run(st, "고민씨", "칼춤");
      const soak = run(st, "물붓기", "칼춤").nextState;
      const mirror = run(st, "미러타입", "칼춤").nextState;
      check(
        "M3: 고민씨(불면 → 잠이 깸)·물붓기(단일 물)·미러타입(상대 타입 복사)",
        w.nextState.b.effectiveAbilityId === "불면" && !w.nextState.b.status.condition && actionOf(w, "a")?.curedStatus === "sleep" &&
          soak.b.types.join() === "물" && mirror.a.types.join() === st.b.types.join(),
        `고민씨=${w.nextState.b.effectiveAbilityId}/${w.nextState.b.status.condition} 물붓기=${soak.b.types} 미러=${mirror.a.types}`,
      );
    }
    // 특성 면역: 마이페이스(혼란) · 둔감(도발) · 정신력(위협)
    {
      const conf = actionOf(run(battle([mon("팬텀", ["이상한빛"])], [mon("잠만보", ["칼춤"], "마이페이스")]), "이상한빛", "칼춤"), "a");
      const taunt = actionOf(run(battle([mon("팬텀", ["도발"])], [mon("잠만보", ["칼춤"], "둔감")]), "도발", "칼춤"), "a");
      const intim = battle([mon("갸라도스", ["폭포오르기"], "위협")], [mon("잠만보", ["칼춤"], "정신력")]);
      const plain = battle([mon("갸라도스", ["폭포오르기"], "위협")], [mon("잠만보", ["칼춤"])]);
      check(
        "M3: 마이페이스 혼란 면역·둔감 도발 면역·정신력 위협 면역",
        conf?.volatileBlockedByAbility?.volatile === "confusion" && taunt?.volatileBlockedByAbility?.volatile === "taunt" &&
          intim.b.stages.atk === 0 && plain.b.stages.atk === -1,
        `혼란=${conf?.volatileBlockedByAbility?.abilityName} 도발=${taunt?.volatileBlockedByAbility?.abilityName} 위협 atk=${intim.b.stages.atk}/${plain.b.stages.atk}`,
      );
    }
    // AI: 물붓기로 땅타입을 물로 → 10만볼트가 통함 / 위액으로 두꺼운지방 해제 → 화염방사가 잘 들어감 / 토글
    {
      const P = dec.DEFAULT_DECISION_PARAMS;
      const optOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
      const soak = optOf(battle([mon("로토무", ["물붓기", "10만볼트"])], [mon("한카리아스", ["스톤에지"])]), "물붓기").support?.effect;
      const gastroOpt = optOf(battle([mon("리자몽", ["위액", "화염방사"])], [mon("잠만보", ["누르기"], "두꺼운지방", null, pts({ hp: 32 }))]), "위액");
      const gastro = gastroOpt.support?.effect;
      check(
        "M3 AI: 물붓기(면역 → 통함)·위액(두꺼운지방 해제) 재평가 + 토글",
        soak?.kind === "typeSet" && soak.base.killTurns === Infinity && Number.isFinite(soak.hit.killTurns) &&
          gastro?.kind === "abilitySuppress" && gastro.hit.killTurns < gastro.base.killTurns &&
          dec.scoreOption(gastroOpt, 0.5, { ...P, trackMAware: false }) === -Infinity,
        `물붓기 c ${soak?.base.killTurns}→${soak?.hit.killTurns} 위액 c ${gastro?.base.killTurns}→${gastro?.hit.killTurns}`,
      );
    }
  }
  // ── 트랙 M4(ver.1.8): 원더룸·매직룸·중력·전자부유·떨어뜨리기 + 접지 판정 ──
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const toi = await server.ssrLoadModule("/src/lib/battle/turnOrderInputs.ts");
    const act = (id) => ({ kind: "move", move: data.getMove(id) });
    const run = (st, a, b) => rt.runTurn(st, a.kind ? a : act(a), b.kind ? b : act(b), () => 0.5);
    const actionOf = (out, key) => out.result.actions.find((x) => x.actor === key);
    // 원더룸: 물리 기술이 특방으로 받아진다(메타그로스 방어 > 특방 → 더 아픔) / 다시 쓰면 해제 · 트릭룸도 다시 쓰면 해제
    {
      const st = battle([mon("한카리아스", ["지진", "원더룸", "트릭룸"])], [mon("메타그로스", ["원더룸", "칼춤"], null, null, pts({ hp: 32 }))]);
      const plain = actionOf(run(st, "지진", "칼춤"), "a").damage;
      const roomed = run(st, "원더룸", "칼춤").nextState;
      const inRoom = actionOf(run(roomed, "지진", "칼춤"), "a").damage;
      const off = run(roomed, "원더룸", "칼춤");
      const tr = run(run(st, "트릭룸", "칼춤").nextState, "트릭룸", "칼춤");
      check(
        "M4: 원더룸(방어·특방 맞바꿈)·다시 쓰면 해제 · 트릭룸도 다시 쓰면 해제",
        inRoom > plain && off.nextState.wonderRoomTurnsRemaining === undefined && actionOf(off, "a")?.roomChange?.on === false &&
          tr.nextState.trickRoomTurnsRemaining === undefined && actionOf(tr, "a")?.trickRoomEnded === true,
        `데미지 ${plain}→${inRoom} 해제=${off.nextState.wonderRoomTurnsRemaining} 트릭룸=${tr.nextState.trickRoomTurnsRemaining}`,
      );
    }
    // 매직룸: 구애스카프 스피드·먹다남은음식 회복이 꺼진다
    {
      const st = battle([mon("잠만보", ["매직룸", "칼춤"], null, "구애스카프", pts({ hp: 32 }))], [mon("메타그로스", ["칼춤"], null, "먹다남은음식")]);
      const before = toi.computeTurnOrderSpeed(st, st.a);
      st.b.currentHp = 100;
      const out = run(st, "매직룸", "칼춤").nextState;
      const after = toi.computeTurnOrderSpeed(out, out.a);
      check(
        "M4: 매직룸 — 구애스카프 스피드·먹다남은음식 회복 무효",
        out.magicRoomTurnsRemaining > 0 && after < before && out.b.currentHp === 100,
        `스피드 ${before}→${after} 음식 HP=${out.b.currentHp}`,
      );
    }
    // 중력: 비행 타입도 지진에 맞고 공중날기는 못 씀 / 이미 있으면 실패 / 5턴째 끝에 해제
    {
      const st = battle([mon("한카리아스", ["중력", "지진", "칼춤"])], [mon("갸라도스", ["공중날기", "칼춤"], null, null, pts({ hp: 32 }))]);
      const immune = actionOf(run(st, "지진", "칼춤"), "a").damage;
      let s = run(st, "중력", "칼춤").nextState;
      const eq = actionOf(run(s, "지진", "칼춤"), "a").damage;
      const fly = actionOf(run(s, "지진", "공중날기"), "b");
      const again = actionOf(run(s, "중력", "칼춤"), "a");
      let expired = false;
      for (let i = 0; i < 4; i++) {
        const out = run(s, "칼춤", "칼춤");
        if (out.result.expiredFieldEffects?.includes("gravity")) expired = i === 3;
        s = out.nextState;
      }
      check(
        "M4: 중력 — 비행 타입 접지·공중날기 사용 불가·중복 실패·5턴 해제",
        immune === 0 && eq > 0 && fly?.moveRestrictionKind === "gravity" && again?.gravitySetFailed === true && expired && s.gravityTurnsRemaining === undefined,
        `지진 ${immune}→${eq} 공중날기=${fly?.moveRestrictionKind} 해제=${expired}`,
      );
    }
    // 전자부유: 지진 무시 / 떨어뜨리기에 맞으면 풀리고 땅에 붙잡힘 / 중력 중엔 실패
    {
      const st = battle([mon("로토무", ["전자부유", "칼춤"], null, null, pts({ hp: 32 }))], [mon("한카리아스", ["지진", "떨어뜨리기", "중력"])]);
      const s1 = run(st, "전자부유", "칼춤").nextState;
      const dodge = actionOf(run(s1, "칼춤", "지진"), "b").damage;
      const smack = run(s1, "칼춤", "떨어뜨리기");
      const hit = actionOf(run(smack.nextState, "칼춤", "지진"), "b").damage;
      const grav = run(st, "칼춤", "중력").nextState;
      const failed = actionOf(run(grav, "전자부유", "칼춤"), "a");
      check(
        "M4: 전자부유(땅 무시) · 떨어뜨리기(풀리고 접지) · 중력 중엔 사용 불가",
        s1.a.magnetRiseTurnsRemaining > 0 && dodge === 0 && smack.nextState.a.smackedDown === true && actionOf(smack, "b")?.smackedDownTarget === true &&
          hit > 0 && failed?.moveRestrictionKind === "gravity",
        `부유 지진=${dodge} 떨어뜨린 뒤=${hit} 중력 중=${failed?.moveRestrictionKind}`,
      );
    }
    // 필드 접지: 비행 타입은 그래스필드 회복을 못 받고 미스트필드로 상태이상이 막히지 않는다
    {
      const st = battle([mon("로토무", ["도깨비불"])], [mon("갸라도스", ["칼춤"], null, null, pts({ hp: 32 }))]);
      st.field = "그래스필드";
      st.fieldTurnsRemaining = 5;
      st.b.currentHp = 100;
      const grassy = run(st, "도깨비불", "칼춤").nextState;
      const misty = battle([mon("로토무", ["도깨비불"])], [mon("갸라도스", ["칼춤"])]);
      misty.field = "미스트필드";
      misty.fieldTurnsRemaining = 5;
      const burned = run(misty, "도깨비불", "칼춤").nextState;
      check(
        "M4: 비행 타입은 필드 밖 — 그래스필드 회복 없음·미스트필드 상태이상 보호 없음",
        grassy.b.currentHp <= 100 && burned.b.status.condition === "burn",
        `그래스 HP=${grassy.b.currentHp} 미스트 화상=${burned.b.status.condition}`,
      );
    }
    // AI: 땅 기술밖에 없을 때 중력으로 비행 타입을 잡을 수 있게 됨 / 전자부유로 땅 기술을 피함
    {
      const optOf = (st, id) => opt(ev.evaluateOptions(st, "a"), id);
      const g = optOf(battle([mon("한카리아스", ["중력", "지진"])], [mon("갸라도스", ["폭포오르기"])]), "중력").support?.effect;
      const m = optOf(battle([mon("로토무", ["전자부유", "10만볼트"], null, null, pts({ hp: 32 }))], [mon("한카리아스", ["지진"])]), "전자부유").support?.effect;
      check(
        "M4 AI: 중력(비행 타입에 지진이 통함)·전자부유(지진 회피) 재평가",
        g?.kind === "gravity" && g.base.killTurns === Infinity && Number.isFinite(g.hit.killTurns) && m?.kind === "magnetRise" && m.hit.survivalTurns > m.base.survivalTurns,
        `중력 c ${g?.base.killTurns}→${g?.hit.killTurns} 전자부유 d ${m?.base.survivalTurns}→${m?.hit.survivalTurns}`,
      );
    }
  }
}
