// 3.x~5.0 상대 위협 없음·교체 왕복·실수 모델
export default async function ({ server, data, state, ai, dec, pts, mon, battle, check }) {
  // 상대가 나에게 데미지를 줄 수단이 없을 때(+Infinity 점수)
  {
    const st = battle([mon("팬텀", ["10만볼트"])], [mon("한카리아스", ["지진"])]);
    st.a.effectiveAbilityId = "부유";
    const d = ai.chooseAiAction(st, "a", 0.5);
    check("상대 공격 불가 상황 처리", d.action.kind === "move", d.scored.map((s) => s.score).join(","));
  }

  // E1(3.3): 회복형 상대(블래키)가 변화기만 쓸 때 tb-snow의 교체 왕복 — 히스테리시스가 교체 수를 줄인다
  {
    const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
    const sw = await server.ssrLoadModule("/src/lib/battle/switching.ts");
    const se = await server.ssrLoadModule("/src/lib/battle/ai/search.ts");
    const presets = JSON.parse((await import("node:fs")).readFileSync(new URL("../../src/data/samplePartyPresets.json", import.meta.url), "utf8"));
    const snowAll = presets.find((p) => p.id === "tb-snow").slots.filter((s) => ["맘모꾸리", "툰베어", "글레이시아"].includes(s.pokemonId));
    const blacky = mon("블래키", ["하품", "속임수", "바크아웃", "달빛"], null, "먹다남은음식", pts({ hp: 21, def: 10, spd: 25, spe: 10 }));
    blacky.slot.nature = "차분";
    const cycle = ["속임수", "달빛", "바크아웃", "하품", "달빛", "바크아웃"];
    // 선봉 3가지 × 난수 2가지 = 6판의 12턴 안 자발적 교체 합
    const switchesWith = (stalemateSwitchMargin) => {
      let n = 0;
      for (const lead of snowAll) {
        const snow = [lead, ...snowAll.filter((s) => s !== lead)];
        for (const seed of [7, 11]) {
          let st = state.createBattleState({
            a: { slots: [blacky.slot], movesList: [blacky.moves] },
            b: { slots: snow, movesList: snow.map((s) => s.moves.filter(Boolean).map((m) => data.getMove(m))) },
          });
          const rng = (() => { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); })();
          const decisionParams = { search: se.PRODUCT_SEARCH_PARAMS, opponentModel: dec.DEFAULT_OPPONENT_MODEL, stalemateSwitchMargin };
          for (let t = 0; t < 12; t++) {
            const b = ai.chooseAiAction(st, "b", 0.5, { decisionParams }).action;
            if (b.kind === "switch") n++;
            const out = rt.runTurn(st, { kind: "move", move: data.getMove(cycle[t % cycle.length]) }, b, rng);
            if ("awaitingSelfSwitch" in out) break;
            st = out.nextState;
            if (out.result.winner) break;
            if (out.forcedSwitch?.b) st = sw.applySwitch(st, "b", st.sideB.party.findIndex((f, i) => i !== st.sideB.activeIndex && f.currentHp > 0)).nextState;
          }
        }
      }
      return n;
    };
    const off = switchesWith(0);
    const on = switchesWith(dec.DEFAULT_DECISION_PARAMS.stalemateSwitchMargin);
    check("E1(3.3) 회복형 상대 앞 교체 왕복 감소", on < off, `억제 끔=${off} 켬=${on} (6판×12턴)`);
  }

  // 실수 모델(5.0 R3): 꺼짐·rate 0은 원래 선택 그대로, rate 1은 차선책, 같은 난수면 같은 선택, 확정 처치(하드 오버라이드)는 제외
  {
    const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const idOf = (st, decisionParams, seed) => {
      const d = ai.chooseAiAction(st, "a", 0.5, { decisionParams, rng: lcg(seed) });
      return d.action.kind === "move" ? d.action.move.id : `교체${d.action.toIndex}`;
    };
    const st = battle([mon("한카리아스", ["스톤에지", "지진", "용성군"].filter((m) => data.getMove(m)))], [mon("핫삼", ["불꽃펀치"], null, null, pts({ hp: 32, def: 32 }))]);
    const base = idOf(st, undefined, 1);
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const wide = { mistake: { rate: 1, margin: 1e9 } };
    check("실수 모델 꺼짐·rate 0 → 원래 선택", seeds.every((sd) => idOf(st, { mistake: { rate: 0, margin: 1e9 } }, sd) === base), base);
    check("실수 모델 rate 1 → 차선책 선택", seeds.every((sd) => idOf(st, wide, sd) !== base), seeds.map((sd) => idOf(st, wide, sd)).join(","));
    check("실수 모델 같은 난수 → 같은 선택", seeds.every((sd) => idOf(st, wide, sd) === idOf(st, wide, sd)));
    const sure = battle([mon("한카리아스", ["불꽃펀치", "지진"])], [mon("핫삼", ["코멧펀치"], null, null, pts())]);
    check("실수 모델 확정 처치는 제외", seeds.every((sd) => idOf(sure, wide, sd) === "불꽃펀치"));
    check("실수 모델 hardOverride면 확정 처치도 대상", seeds.some((sd) => idOf(sure, { mistake: { ...wide.mistake, hardOverride: true } }, sd) !== "불꽃펀치"));
  }

}
