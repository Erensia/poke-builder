// 8.3 D3-fix-44 (E8-10) 매직미러가 울부짖기·날려버리기·뒤집어엎기를 반사한다 — Showdown `reflectable` 60종과 같은 집합.
//  반사되면 같은 기술을 원래 사용자에게 다시 쓴다: 끌려 나가는 쪽·랭크가 뒤집히는 쪽이 사용자다. 설계 `8.3-D3-fix44-매직미러반사설계.md` §3.
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const fe = await server.ssrLoadModule("/src/lib/fieldEffects.ts");
  const vol = await server.ssrLoadModule("/src/lib/volatileConditions.ts");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const play = (st, a, b = "칼춤", rng = () => 0.5) => { try { return rt.runTurn(st, mv(a), mv(b), rng); } catch { return null; } };
  const bulky = pts({ hp: 32, spd: 32, def: 32 });
  const forcedSides = (o) => ((o?.result ?? o?.partialResult)?.switches ?? []).filter((s) => s.forced).map((s) => s.side).join("");
  // a: 사용자(+예비 잠만보), b: 방어측(+예비 잠만보). 기본 b는 에브이 매직미러.
  const mk = ({ user = "하마돈", userAbility = null, move = "날려버리기", bPoke = "에브이", bAbility = "매직미러", aBench = true } = {}) =>
    battle([mon(user, [move], userAbility, null, bulky), ...(aBench ? [mon("잠만보", ["칼춤"])] : [])], [mon(bPoke, ["칼춤"], bAbility, null, bulky), mon("잠만보", ["칼춤"])]);
  const go = (st, move = "날려버리기") => play(st, move);

  // ── 1~2 날려버리기·울부짖기 → 반사 → 사용자(a)가 끌려 나오고 매직미러(b)는 유지 ──
  for (const [n, m] of [[1, "날려버리기"], [2, "울부짖기"]]) {
    const o = go(mk({ move: m }), m);
    check(`D3-fix44 ${n}: ${m} vs 매직미러 → 사용자(a)가 끌려 나오고 매직미러(b)는 유지`, forcedSides(o) === "a" && o.nextState.sideB.activeIndex === 0, `forced=${forcedSides(o)} bActive=${o?.nextState.sideB.activeIndex}`);
  }
  // ── 3 뒤집어엎기 → 반사 → 사용자 랭크가 뒤집히고 매직미러 쪽은 그대로 / (R2) 사용자 랭크가 모두 0이면 변화 없음 ──
  {
    // 상대(에브이)가 같은 턴에 쓰는 칼춤(atk +2)이 섞이지 않게 def 랭크로 본다
    const st = mk({ move: "뒤집어엎기" }); st.a.stages = { ...st.a.stages, def: -1, spa: 2 }; st.b.stages = { ...st.b.stages, def: 2 };
    const o = go(st, "뒤집어엎기");
    check("D3-fix44 3: 뒤집어엎기 vs 매직미러 → 사용자 랭크가 뒤집히고(def +1·spa −2) 매직미러 쪽은 그대로(def +2)", o?.nextState.a.stages.def === 1 && o.nextState.a.stages.spa === -2 && o.nextState.b.stages.def === 2, JSON.stringify({ a: o?.nextState.a.stages, b: o?.nextState.b.stages }));
    const st0 = mk({ move: "뒤집어엎기" }); st0.b.stages = { ...st0.b.stages, def: 2 };
    const o0 = go(st0, "뒤집어엎기");
    check("D3-fix44 3b: 사용자 랭크가 모두 0이면 반사된 뒤집어엎기는 변화 없음(매직미러 쪽 def +2 그대로)", o0?.nextState.b.stages.def === 2 && ["atk", "def", "spa", "spd", "spe"].every((k) => o0.nextState.a.stages[k] === 0), JSON.stringify({ a: o0?.nextState.a.stages, b: o0?.nextState.b.stages }));
  }
  // ── 4 대조: 매직미러가 아니면 방어측이 끌려 나온다(fix-42 포함 회귀) ──
  {
    const o = go(mk({ bAbility: null, bPoke: "잠만보" }));
    check("D3-fix44 4: 대조(매직미러 아님) → 방어측(b)이 끌려 나온다", forcedSides(o) === "b", forcedSides(o));
  }
  // ── 5 반사돼도 교체가 막히는 경우: 예비 없음·흡반·파수견·뿌리박기 ──
  {
    const noBench = go(mk({ aBench: false }));
    const suction = go(mk({ userAbility: "흡반" }));
    const guard = go(mk({ userAbility: "파수견" }));
    const root = mk(); root.a.volatile = vol.inflictVolatile(root.a.volatile, "ingrain", () => 0.5);
    const ingrain = go(root);
    check("D3-fix44 5: 반사돼도 사용자에게 예비 없음·흡반·파수견·뿌리박기면 아무도 교체되지 않음", [noBench, suction, guard, ingrain].every((o) => o && forcedSides(o) === ""), JSON.stringify([noBench, suction, guard, ingrain].map(forcedSides)));
  }
  // ── 6 회귀: 설치기·상태이상기·랭크 하락기는 기존대로 반사 ──
  {
    const hz = go(mk({ user: "잠만보", move: "스텔스록" }), "스텔스록");
    check("D3-fix44 6a: 스텔스록은 반사돼 사용자 편에 깔린다(회귀)", hz?.nextState.sideA.hazards.stealthRock === true && hz.nextState.sideB.hazards.stealthRock !== true, JSON.stringify({ a: hz?.nextState.sideA.hazards.stealthRock, b: hz?.nextState.sideB.hazards.stealthRock }));
    const ps = go(mk({ user: "잠만보", move: "독가루" }), "독가루");
    check("D3-fix44 6b: 독가루는 반사돼 사용자가 독에 걸린다(회귀)", ps?.nextState.a.status.condition === "poison" && ps.nextState.b.status.condition === null, JSON.stringify({ a: ps?.nextState.a.status.condition, b: ps?.nextState.b.status.condition }));
  }
  // ── 7 회귀: notReflectable 8종은 반사 집합 밖(반사 판정이 이 함수를 쓴다). 흔들흔들댄스는 사용자도 혼란에 걸려 동적 장면으로는 판별이 안 돼 함수 단위로 본다 ──
  {
    const f = fe.isMagicBounceReflectable;
    const bad = ["저주", "바꿔치기", "흔들흔들댄스", "추억의선물", "스킬스왑", "트릭", "멸망의노래", "아픔나누기"].filter((n) => typeof f === "function" && f(data.getMove(n)));
    check("D3-fix44 7: notReflectable 8종(저주·바꿔치기·흔들흔들댄스·추억의선물·스킬스왑·트릭·멸망의노래·아픔나누기)은 반사 집합 밖(회귀)", typeof f === "function" && bad.length === 0, JSON.stringify(bad));
  }
  // ── 8 회귀: 틀깨기 사용자는 매직미러를 무시 → 방어측이 끌려 나온다 ──
  {
    const o = go(mk({ user: "하마돈", userAbility: "틀깨기" }));
    check("D3-fix44 8: 틀깨기 사용자의 날려버리기는 매직미러를 무시하고 방어측(b)을 끌어낸다(회귀)", forcedSides(o) === "b", forcedSides(o));
  }
  // ── 9 회귀: 데미지 기술 드래곤테일은 반사되지 않고 평소처럼 방어측을 끌어낸다 ──
  {
    const o = go(mk({ move: "드래곤테일" }), "드래곤테일");
    check("D3-fix44 9: 드래곤테일(데미지 기술)은 매직미러에도 반사되지 않음 — 방어측(b) 교체(회귀)", forcedSides(o) === "b", forcedSides(o));
  }
  // ── 10 공용 함수 단위 ──
  {
    const f = fe.isMagicBounceReflectable;
    const r = (n) => typeof f === "function" && f(data.getMove(n));
    check("D3-fix44 10: isMagicBounceReflectable — 날려버리기·울부짖기·뒤집어엎기·스텔스록·독가루 true / 칼춤·지진·흔들흔들댄스 false", ["날려버리기", "울부짖기", "뒤집어엎기", "스텔스록", "독가루"].every(r) && !["칼춤", "지진", "흔들흔들댄스"].some(r), "");
  }
  // ── 12 (R1) 사용자 대타 — 강제 교체는 대타를 무시한다 ──
  {
    // 시험 11(반사된 상태 변화기가 사용자 대타에 막힘)은 이 PR에서 제외 — 엔진의 반사 구간이 독가루·도깨비불 등 기존 반사기에서도 사용자 대타를 통과해 해시 원인이 섞인다. 별도 항목 E8-13(`8.3-D3-E8-검수.md` §8).
    const s2 = mk(); s2.a.substituteHp = 50;
    const o2 = go(s2);
    check("D3-fix44 12: 사용자가 대타 뒤에서 날려버리기 → 반사 → 대타를 무시하고 끌려 나온다", forcedSides(o2) === "a", forcedSides(o2));
  }
  // ── 13 (Q1) 방음 사용자의 울부짖기는 반사돼도 방음에 막힌다 / 방음 없는 사용자는 끌려 나온다 ──
  {
    const loud = go(mk({ user: "짜랑고우거", userAbility: "방음", move: "울부짖기" }), "울부짖기");
    const plain = go(mk({ user: "하마돈", move: "울부짖기" }), "울부짖기");
    check("D3-fix44 13: 방음 사용자의 울부짖기 → 반사돼도 방음에 막혀 아무도 교체되지 않음 / 방음 없으면 사용자가 끌려 나옴(대조)", forcedSides(loud) === "" && forcedSides(plain) === "a", JSON.stringify({ loud: forcedSides(loud), plain: forcedSides(plain) }));
  }
}
