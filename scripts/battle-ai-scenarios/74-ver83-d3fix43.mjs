// 8.3 D3-fix-43 (E8-09) 우격다짐이 위기회피·탈출버튼·레드카드를 막지 않는다 — Showdown champions `scripts.ts` 424행:
//  "Sheer Force doesn't suppress AfterMoveSecondary events: Berserk, Pickpocket, Emergency Exit, Eject Button, etc."
//  우격다짐의 추가효과 제거·생명의구슬 반동 면제는 그대로다(`useMoveInner`는 champions가 건드리지 않았다). 설계 `8.3-D3-fix43-우격다짐설계.md` §3.
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const mv = (x) => (typeof x === "string" ? { kind: "move", move: data.getMove(x) } : x);
  const play = (st, a = "칼춤", b = "칼춤", rng = () => 0.5) => { try { return rt.runTurn(st, mv(a), mv(b), rng); } catch { return null; } };
  const bulky = pts({ hp: 32, spd: 32, def: 32 });
  const redCardSwitch = (out) => (out?.result ?? out?.partialResult)?.switches.find((s) => s.redCardItemName);
  // a: 한카리아스(예비 있음) → b: 단단한 홀더(예비 있음). 독찌르기 = 독 30% 추가효과 기술(우격다짐 대상), 지진 = 추가효과 없음.
  const atk = (move, aAbility, aItem = null) => mon("한카리아스", [move], aAbility, aItem, pts({ atk: 32, spe: 32, hp: 2 }));
  const spare = () => mon("메타그로스", ["칼춤"]);
  const holder = (item, ability, pokemon = "잠만보") => mon(pokemon, ["칼춤", "방어"], ability, item, bulky);
  const normal = ({ move = "독찌르기", aAbility = "우격다짐", aItem, bItem, bAbility, bPokemon } = {}) =>
    battle([atk(move, aAbility, aItem), spare()], [holder(bItem, bAbility, bPokemon), spare()]);
  const aboveHalf = (st) => { st.b.currentHp = Math.floor(st.b.maxHp / 2) + 1; return st; }; // 공격 전 절반 위(한 대 맞으면 절반 이하로 생존)
  const hit = (st, move = "독찌르기", b = "칼춤", rng) => play(st, move, b, rng);

  // ── 1~3 우격다짐 + 추가효과 기술 → 세 효과 모두 발동 ──
  {
    const ex = hit(aboveHalf(normal({ bAbility: "위기회피" })));
    check("D3-fix43 1: 우격다짐 + 추가효과 기술 → 위기회피 발동(교체창, emergencyExit)", ex?.awaitingSelfSwitch?.side === "b" && ex.awaitingSelfSwitch.emergencyExit === true, JSON.stringify(ex?.awaitingSelfSwitch));
    const ej = hit(normal({ bItem: "탈출버튼" }));
    check("D3-fix43 2: 우격다짐 + 추가효과 기술 → 탈출버튼 발동·도구 소모", !!ej?.awaitingSelfSwitch?.ejectItemName && ej.nextState.b.currentItemId === null, JSON.stringify(ej?.awaitingSelfSwitch));
    const rc = hit(normal({ bItem: "레드카드" }));
    check("D3-fix43 3: 우격다짐 + 추가효과 기술 → 레드카드 발동·공격자 강제 교체·카드 소모", !!redCardSwitch(rc) && rc.nextState.b.currentItemId === null, `교체=${!!redCardSwitch(rc)} 도구=${rc?.nextState.b.currentItemId}`);
  }
  // ── 4 대조군: 우격다짐이 아닌 특성 + 같은 기술 → 세 효과 모두 발동(회귀) ──
  {
    const ex = hit(aboveHalf(normal({ aAbility: null, bAbility: "위기회피" })));
    const ej = hit(normal({ aAbility: null, bItem: "탈출버튼" }));
    const rc = hit(normal({ aAbility: null, bItem: "레드카드" }));
    check("D3-fix43 4: 대조군(우격다짐 아님) — 위기회피·탈출버튼·레드카드 모두 발동(회귀)", ex?.awaitingSelfSwitch?.emergencyExit === true && !!ej?.awaitingSelfSwitch?.ejectItemName && !!redCardSwitch(rc), JSON.stringify({ ex: ex?.awaitingSelfSwitch, ej: ej?.awaitingSelfSwitch, rc: !!redCardSwitch(rc) }));
  }
  // ── 5 (R2) 우격다짐은 여전히 추가효과를 지운다: 독이 반드시 걸리는 난수에서도 독 없음 / 같은 난수의 일반 특성은 독이 걸린다 ──
  {
    const R0 = () => 0;
    const sheer = hit(normal(), "독찌르기", "칼춤", R0), plain = hit(normal({ aAbility: null }), "독찌르기", "칼춤", R0);
    check("D3-fix43 5: 난수 0에서 우격다짐은 독 없음(추가효과 제거 유지) · 일반 특성은 독 걸림(대조)", sheer?.nextState.b.status.condition === null && plain?.nextState.b.status.condition === "poison", `우격다짐=${sheer?.nextState.b.status.condition} 일반=${plain?.nextState.b.status.condition}`);
  }
  // ── 6 생명의구슬 반동은 우격다짐이 면제(회귀) ──
  {
    const sheer = hit(normal({ aItem: "생명의구슬" })), plain = hit(normal({ aAbility: null, aItem: "생명의구슬" }));
    check("D3-fix43 6: 우격다짐은 생명의구슬 반동 없음 · 일반 특성은 반동(회귀)", sheer?.nextState.a.currentHp === sheer?.nextState.a.maxHp && plain?.nextState.a.currentHp < plain?.nextState.a.maxHp, `우격다짐=${sheer?.nextState.a.currentHp}/${sheer?.nextState.a.maxHp} 일반=${plain?.nextState.a.currentHp}`);
  }
  // ── 7 (R1) 탈출버튼 + 위기회피 동시 보유: 탈출버튼만 / 도구를 뺀 대조는 위기회피 ──
  {
    const both = hit(aboveHalf(normal({ bItem: "탈출버튼", bAbility: "위기회피" })));
    const only = hit(aboveHalf(normal({ bAbility: "위기회피" })));
    check("D3-fix43 7: 우격다짐 + 탈출버튼·위기회피 동시 보유(절반 위→이하) → 탈출버튼만, 도구를 뺀 대조는 위기회피", !!both?.awaitingSelfSwitch?.ejectItemName && !both.awaitingSelfSwitch.emergencyExit && only?.awaitingSelfSwitch?.emergencyExit === true, JSON.stringify({ both: both?.awaitingSelfSwitch, only: only?.awaitingSelfSwitch }));
  }
  // ── 8 타입 면역·방어는 여전히 막는다(hitReachedBody 나머지 조건 회귀) ──
  {
    const immune = hit(normal({ bItem: "탈출버튼", bPokemon: "메타그로스" })); // 독찌르기 vs 강철(독 무효)
    const guarded = hit(normal({ bItem: "탈출버튼" }), "독찌르기", "방어");
    check("D3-fix43 8: 타입 면역·방어 → 탈출버튼 미발동·도구 보존", !immune?.awaitingSelfSwitch && immune?.nextState.b.currentItemId === "탈출버튼" && !guarded?.awaitingSelfSwitch && guarded?.nextState.b.currentItemId === "탈출버튼", JSON.stringify({ i: immune?.awaitingSelfSwitch, g: guarded?.awaitingSelfSwitch }));
  }
  // ── 9 발끈은 이미 우격다짐 무관(고정) ──
  {
    const o = hit(aboveHalf(normal({ bAbility: "발끈" })));
    check("D3-fix43 9: 우격다짐 + 발끈 → 특수공격 +1(이미 일치)", o?.nextState.b.stages.spa === 1, `spa=${o?.nextState.b.stages.spa}`);
  }
  // ── 10 (Q1) 유턴 사용자 vs 탈출버튼 → 양쪽 교체·도구 소모(champions는 공격자 교체를 취소하지 않는다, 엔진 이미 일치) ──
  {
    const st = battle([mon("핫삼", ["유턴"], null, null, pts({ atk: 32, spe: 32, hp: 2 })), spare()], [holder("탈출버튼"), spare()]);
    let out = play(st, "유턴"), seq = [];
    for (let g = 0; out && "awaitingSelfSwitch" in out && g < 5; g++) { seq.push(out.awaitingSelfSwitch); out = rt.resumeTurn(out._ctx, 1); }
    check("D3-fix43 10: 유턴 → 탈출버튼 — 교체창 공격자·방어측 2회, 도구 소모, 교체 2건", seq.map((s) => s.side).join("") === "ab" && !!seq[1].ejectItemName && out.nextState.b.currentItemId === null && out.result.switches.length === 2, JSON.stringify(seq));
  }
}
