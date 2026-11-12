// 8.3 A7 유턴류 자체 교체 vs 방어측 교체(Showdown 일치): 레드카드만 유턴을 취소하고, 위기회피·탈출버튼은 유턴과 함께 동시 교체한다.
// 동시 교체는 나가는 포켓몬의 스피드순으로 실행하고(트릭룸 반전·마비 반영·동속 무작위), 등장 효과는 양쪽 교체가 끝난 뒤 들어온 포켓몬의 스피드순으로 발동한다.
// 판정 순서는 탈출버튼 → 레드카드 → 위기회피(같은 홀더가 탈출버튼 + 위기회피면 탈출버튼만). 설계 `8.3-A7-유턴과방어측교체설계.md`, 검수 `8.3-A7-유턴과방어측교체설계-검수.md` S1~S12.
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const vol = await server.ssrLoadModule("/src/lib/volatileConditions.ts");
  const mv = (x) => (typeof x === "string" ? { kind: "move", move: data.getMove(x) } : x);
  const R = (v) => () => v;
  const play = (st, a, b = "칼춤", rng = R(0.5)) => rt.runTurn(st, mv(a), mv(b), rng);
  const bulky = pts({ hp: 32, spd: 32, def: 32 });
  const ingrain = (f) => { f.volatile = vol.inflictVolatile(f.volatile, "ingrain", () => 0.5); };

  // 모든 교체 대기를 순서대로 해소한다. seq: 대기한 순서(편·옵션), out: 최종 결과(기본 첫 예비 1번 선택)
  const drive = (first, pick = () => 1) => {
    const seq = [];
    let out = first;
    for (let g = 0; "awaitingSelfSwitch" in out && g < 5; g++) {
      seq.push(out.awaitingSelfSwitch);
      out = rt.resumeTurn(out._ctx, pick(out.awaitingSelfSwitch.side));
    }
    return { seq, out };
  };
  const sides = (seq) => seq.map((s) => s.side).join("");
  const resultOf = (o) => o.result ?? o.partialResult;
  const redCard = (o) => resultOf(o).switches.find((s) => s.redCardItemName);

  // a: 유턴 사용자(핫삼 + 예비 메타그로스), b: 홀더(잠만보 + 예비) — b는 단단해서 한 방에 안 쓰러진다
  const atk = (move = "유턴", { spe = 32, ability = null, pokemon = "핫삼" } = {}) => mon(pokemon, [move], ability, null, pts({ atk: 32, spe, hp: 2 }));
  const spare = (ability = null, pokemon = "메타그로스") => mon(pokemon, ["칼춤"], ability);
  const holder = (item, ability = null, { spe = 0, pokemon = "잠만보" } = {}) => mon(pokemon, ["칼춤", "방어"], ability, item, { ...bulky, spe });
  const mk = ({ move, item = null, ability = null, aBench = true, bBench = true, aSpe = 32, bSpe = 0, aSpare, bSpare, aPokemon, bPokemon } = {}) =>
    battle([atk(move, { spe: aSpe, pokemon: aPokemon }), ...(aBench ? [aSpare ?? spare()] : [])], [holder(item, ability, { spe: bSpe, pokemon: bPokemon }), ...(bBench ? [bSpare ?? spare()] : [])]);
  const half = (st) => { st.b.currentHp = Math.floor(st.b.maxHp / 2) + 1; return st; };

  // ── A7-1·2·10: 유턴/볼트체인지 → 레드카드: 공격자만 끌려 나가고 유턴 교체는 취소 ──
  for (const [name, move] of [["A7-1 유턴", "유턴"], ["A7-2 볼트체인지", "볼트체인지"]]) {
    const o = play(mk({ move, item: "레드카드" }), move);
    check(`8.3 ${name} → 레드카드: 도구 소모·공격자 강제 교체·유턴 교체창 없음`, !("awaitingSelfSwitch" in o) && !!redCard(o) && o.nextState.b.currentItemId === null && o.nextState.sideA.activeIndex === 1, `awaiting=${"awaitingSelfSwitch" in o} red=${!!redCard(o)}`);
  }
  {
    const o = play(mk({ move: "유턴", item: "레드카드" }), "유턴");
    check("8.3 A7-10: 레드카드로 끌려 나간 뒤 홀더는 정상 행동(칼춤)한다", !("awaitingSelfSwitch" in o) && o.result.actions.some((a) => a.actor === "b" && a.move.id === "칼춤"), o.result?.actions.map((a) => a.actor + a.move.id).join(","));
  }

  // ── A7-3: 유턴 → 위기회피(절반 통과): 유턴 사용자와 방어측이 둘 다 교체 ──
  {
    const { seq, out } = drive(play(half(mk({ move: "유턴", ability: "위기회피" })), "유턴"));
    const sw = out.result.switches;
    check("8.3 A7-3: 유턴 → 위기회피: 교체창이 공격자·방어측 순으로 연속 2회(방어측은 emergencyExit)", sides(seq) === "ab" && seq[1].emergencyExit === true, JSON.stringify(seq));
    check("8.3 A7-3: 둘 다 고르면 교체 2건이 실행된다", sw.length === 2 && out.nextState.sideA.activeIndex === 1 && out.nextState.sideB.activeIndex === 1, `sw=${sw.length} a=${out.nextState.sideA.activeIndex} b=${out.nextState.sideB.activeIndex}`);
    check("8.3 A7-3: 방어측 교체 기록에만 defenderExit 표시(로그·연출이 공격자 행동 뒤에 놓는다)", sw.filter((x) => x.defenderExit).map((x) => x.side).join("") === "b" && !sw.find((x) => x.side === "a").defenderExit, JSON.stringify(sw.map((x) => [x.side, x.defenderExit])));
  }

  // ── A7-4: 유턴 → 탈출버튼: 도구 소모, 양쪽 교체 ──
  {
    const { seq, out } = drive(play(mk({ move: "유턴", item: "탈출버튼" }), "유턴"));
    check("8.3 A7-4: 유턴 → 탈출버튼: 교체창 연속 2회·도구 소모·교체 2건", sides(seq) === "ab" && !!seq[1].ejectItemName && out.nextState.b.currentItemId === null && out.result.switches.length === 2, JSON.stringify(seq));
  }

  // ── A7-5: 위기회피인데 절반을 못 넘김: 유턴 사용자만 ──
  {
    const { seq } = drive(play(mk({ move: "유턴", ability: "위기회피" }), "유턴"));
    check("8.3 A7-5: 위기회피 문턱 미통과면 유턴 사용자만 교체창", sides(seq) === "a", sides(seq));
  }

  // ── A7-6·7: 레드카드 + 공격자 뿌리박기 → 유턴 진행 / 공격자 편 예비 없음 → 도구 유지 ──
  {
    const st = mk({ move: "유턴", item: "레드카드" }); ingrain(st.a);
    const { seq, out } = drive(play(st, "유턴"));
    check("8.3 A7-6: 레드카드 + 공격자 뿌리박기: 도구는 소모되고 교체는 없지만 유턴 교체는 진행", sides(seq) === "a" && out.nextState.b.currentItemId === null && !redCard(out), `${sides(seq)} item=${out.nextState.b.currentItemId}`);
    const o = play(mk({ move: "유턴", item: "레드카드", aBench: false }), "유턴");
    check("8.3 A7-7: 공격자 편 예비가 없으면 레드카드 미발동·도구 유지·유턴도 없음", !("awaitingSelfSwitch" in o) && o.nextState.b.currentItemId === "레드카드", `item=${o.nextState.b.currentItemId}`);
  }

  // ── A7-8·9: 일반 공격 + 레드카드(회귀) / 배턴터치는 방어측 효과 대상 아님 ──
  {
    const o = play(mk({ move: "막치기", item: "레드카드" }), "막치기");
    check("8.3 A7-8: 일반 공격 → 레드카드(A4-b 회귀)", !!redCard(o) && !("awaitingSelfSwitch" in o), `red=${!!redCard(o)}`);
    const b = play(mk({ move: "배턴터치", item: "레드카드" }), "배턴터치");
    check("8.3 A7-9: 배턴터치는 레드카드를 건드리지 않는다(공격자만 교체창·도구 유지)", "awaitingSelfSwitch" in b && b.awaitingSelfSwitch.side === "a" && b.nextState.b.currentItemId === "레드카드", `item=${b.nextState.b.currentItemId}`);
  }

  // ── A7-11: 레드카드 + 위기회피 홀더: 공격자는 끌려 나가 유턴 취소, 홀더만 교체 ──
  {
    const { seq, out } = drive(play(half(mk({ move: "유턴", item: "레드카드", ability: "위기회피" })), "유턴"));
    check("8.3 A7-11: 레드카드 + 위기회피 홀더: 홀더만 교체창(emergencyExit)·레드카드 교체 기록", sides(seq) === "b" && seq[0].emergencyExit === true && !!redCard(out), `${sides(seq)} red=${!!redCard(out)}`);
  }

  // ── A7-12·18: 탈출버튼 + 위기회피 홀더: 탈출버튼만 발동(유턴 진행 / 일반 공격에도 같음) ──
  {
    const { seq } = drive(play(half(mk({ move: "유턴", item: "탈출버튼", ability: "위기회피" })), "유턴"));
    check("8.3 A7-12: 탈출버튼 + 위기회피 홀더(유턴): 교체창 2회, 방어측은 탈출버튼(위기회피 아님)", sides(seq) === "ab" && !!seq[1].ejectItemName && !seq[1].emergencyExit, JSON.stringify(seq));
    const o = play(half(mk({ move: "막치기", item: "탈출버튼", ability: "위기회피" })), "막치기");
    check("8.3 A7-18: 탈출버튼 + 위기회피 홀더(일반 공격): 탈출버튼만 발동", "awaitingSelfSwitch" in o && !!o.awaitingSelfSwitch.ejectItemName && !o.awaitingSelfSwitch.emergencyExit, JSON.stringify(o.awaitingSelfSwitch));
  }

  // ── A7-13: 동시 교체 실행 순서(나가는 포켓몬의 스피드) ──
  {
    const order = (o) => o.result.switches.map((s) => s.side).join("");
    const fastA = drive(play(mk({ move: "유턴", item: "탈출버튼", aSpe: 32, bSpe: 0 }), "유턴")).out;
    // 홀더가 더 빠르게: 기준 스피드가 낮은 잠만보를 사용자로, 핫삼을 홀더로 둔다
    const fastB = drive(play(mk({ move: "유턴", item: "탈출버튼", aSpe: 0, bSpe: 32, aPokemon: "잠만보", bPokemon: "핫삼" }), "유턴")).out;
    check("8.3 A7-13: 유턴 사용자가 빠르면 그쪽이 먼저 교체한다", order(fastA) === "ab", order(fastA));
    check("8.3 A7-13: 홀더가 빠르면 홀더가 먼저 교체한다", order(fastB) === "ba", order(fastB));
    const trick = mk({ move: "유턴", item: "탈출버튼", aSpe: 32, bSpe: 0 }); trick.trickRoomTurnsRemaining = 3;
    const t = drive(play(trick, "유턴")).out;
    check("8.3 A7-13b: 트릭룸이면 순서가 뒤집힌다(느린 쪽 먼저)", order(t) === "ba", order(t));
    const para = mk({ move: "유턴", item: "탈출버튼", aSpe: 32, bSpe: 20 }); para.a.status = { condition: "paralysis", turnsElapsed: 1 };
    const p = drive(play(para, "유턴", "칼춤", R(0.99))).out; // 마비는 스피드 절반 — 빠르던 a가 느려진다(0.99로 행동불능은 피한다)
    check("8.3 A7-13c: 마비(스피드 절반)로 순서가 바뀐다", order(p) === "ba", order(p));
    const same = (r) => { const st = battle([atk("유턴", { spe: 0 }), spare()], [mon("핫삼", ["칼춤"], null, "탈출버튼", pts({ hp: 32, spd: 32, def: 32, spe: 0 })), spare()]); return drive(play(st, "유턴", "칼춤", R(r))).out; };
    const lo = same(0.1), hi = same(0.9);
    check("8.3 A7-13d: 완전 동속은 난수로 정한다(0.1과 0.9에서 서로 다른 순서)", order(lo).length === 2 && order(hi).length === 2 && order(lo) !== order(hi), `${order(lo)} / ${order(hi)}`);
  }

  // ── A7-14: 탈출버튼 + 홀더 편 예비 없음: 미발동·도구 유지 ──
  {
    const { seq, out } = drive(play(mk({ move: "유턴", item: "탈출버튼", bBench: false }), "유턴"));
    check("8.3 A7-14: 홀더 편 예비가 없으면 탈출버튼 미발동·도구 유지(유턴 사용자만 교체창)", sides(seq) === "a" && out.nextState.b.currentItemId === "탈출버튼", `${sides(seq)} item=${out.nextState.b.currentItemId}`);
  }

  // ── A7-15: 단일 교체 경로 회귀 ──
  {
    const u = drive(play(mk({ move: "유턴" }), "유턴"));
    check("8.3 A7-15a: 유턴만(방어측 효과 없음): 유턴 사용자 교체창 1회", sides(u.seq) === "a" && u.out.result.switches.length === 1, sides(u.seq));
    const e = play(half(mk({ move: "막치기", ability: "위기회피" })), "막치기");
    check("8.3 A7-15b: 위기회피 단독 + 일반 공격: 방어측만 교체창(emergencyExit)", "awaitingSelfSwitch" in e && e.awaitingSelfSwitch.side === "b" && e.awaitingSelfSwitch.emergencyExit === true, JSON.stringify(e.awaitingSelfSwitch));
    const j = play(mk({ move: "막치기", item: "탈출버튼" }), "막치기");
    check("8.3 A7-15c: 탈출버튼 단독 + 일반 공격: 방어측만 교체창(ejectItemName)", "awaitingSelfSwitch" in j && j.awaitingSelfSwitch.side === "b" && !!j.awaitingSelfSwitch.ejectItemName, JSON.stringify(j.awaitingSelfSwitch));
  }

  // ── A7-16·17: 등장 효과는 양쪽 교체가 끝난 뒤 들어온 포켓몬의 스피드순 ──
  {
    // 위협: 양쪽 예비가 모두 위협이면 서로의 새 포켓몬을 낮춘다(교체 직후마다 처리하면 먼저 들어온 쪽의 위협이 나가는 포켓몬에게 낭비된다)
    const st = mk({ move: "유턴", item: "탈출버튼", aSpare: spare("위협"), bSpare: spare("위협") });
    const { out } = drive(play(st, "유턴"));
    check("8.3 A7-16: 양쪽이 위협 포켓몬으로 동시 교체하면 서로 공격 -1씩 받는다", out.nextState.a.stages.atk === -1 && out.nextState.b.stages.atk === -1, `a=${out.nextState.a.stages.atk} b=${out.nextState.b.stages.atk}`);
    // 날씨: 들어온 포켓몬 중 빠른 쪽이 먼저 깔고 느린 쪽이 나중에 덮어쓴다 — 나가는 쪽 스피드와 반대로 두어 "나가는 순서"가 아님을 본다
    const fastIn = (aInSpe, bInSpe) => {
      const aSp = mon("메타그로스", ["칼춤"], "가뭄", null, pts({ spe: aInSpe }));
      const bSp = mon("메타그로스", ["칼춤"], "잔비", null, pts({ spe: bInSpe }));
      const s = battle([atk("유턴", { spe: 32 }), aSp], [holder("탈출버튼", null, { spe: 0 }), bSp]);
      return drive(play(s, "유턴")).out.nextState.weather;
    };
    const w1 = fastIn(32, 0), w2 = fastIn(0, 32);
    check("8.3 A7-17: 날씨는 들어온 포켓몬의 스피드순(느린 쪽이 나중에 덮어씀)", w1 !== w2 && !!w1 && !!w2, `${w1} / ${w2}`);
  }
}
