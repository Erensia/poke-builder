// 8.2 I1 3단계 방어 역산: 고정 데미지(나이트헤드·지구던지기) · 쓰러진 다단히트. 맨 뒤 모듈이라 결합 결과 해시에는 참여하지 않는다.
export default async function ({ data, inf, ev, stat, form, fm, pts, slot, fail }) {
  const reals = (s) => stat.computeRealStats(form.getEffectiveForm(data.getPokemon(s.pokemonId), s).baseStats, s.points, s.nature);
  let seed = 2468;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const mine = slot("한카리아스", { points: pts({ atk: 32, spa: 10 }), nature: "고집" });
  const pct = inf.displayPercent;

  // 고정 데미지: 진짜 HP 포인트가 남고, 방어·특방은 읽지 않으며(범위 없음), 풀피에서 한 방에 쓰러지는 관측은 모순
  {
    const move = data.getMove("나이트헤드"); // 고스트 — 한카리아스·망나뇽 상대로 면역 아님
    let ok = 0;
    let tried = 0;
    let narrowed = 0;
    for (let t = 0; t < 200 && tried < 40; t++) {
      const hpP = Math.floor(rnd() * 33);
      const opp = slot("망나뇽", { points: pts({ hp: hpP }), nature: "용감" });
      const hp = reals(opp).hp;
      if (hp <= 51) continue;
      tried++;
      const r = inf.inferDefense({ attacker: mine, defender: slot("망나뇽"), observations: [{ move, critical: false, before: 100, after: pct(hp - 50, hp) }] });
      if (r?.status === "ok" && r.hp.min <= hpP && hpP <= r.hp.max && r.def === null && r.spd === null) ok++;
      else fail(`나이트헤드 방어 역산: 진짜 HP ${hpP} 상태=${r?.status} hp=${JSON.stringify(r?.hp)} def=${JSON.stringify(r?.def)}`);
      if (r && r.feasible < r.total) narrowed++;
    }
    console.log(`고정 데미지 방어 역산 ${ok}/${tried} ok · HP 후보가 좁혀진 경우 ${narrowed}건`);
    if (tried < 20) fail("고정 데미지 방어 역산 시행 부족");
    if (narrowed === 0) fail("고정 데미지가 HP 후보를 하나도 못 거름");
    const base = { attacker: mine, defender: slot("망나뇽") };
    const faint = inf.inferDefense({ ...base, observations: [{ move, critical: false, before: 20, after: 0 }] });
    const faintFull = inf.inferDefense({ ...base, observations: [{ move, critical: false, before: 100, after: 0 }] });
    if (faint?.status !== "ok") fail(`고정 데미지: 20%에서 쓰러짐이 ${faint?.status}`);
    if (faintFull?.status !== "contradiction") fail(`고정 데미지: 풀피에서 한 방에 쓰러짐이 ${faintFull?.status}`);
    // 타입 면역: 나이트헤드→노말 타입, 지구던지기→고스트 타입. 면역 무시 특성(배짱)은 통과
    const immune = inf.inferDefense({ attacker: mine, defender: slot("잠만보"), observations: [{ move, critical: false, before: 100, after: 80 }] });
    if (immune?.status !== "invalid" || !immune.observationErrors[0]?.includes("효과가 없는")) fail(`나이트헤드→노말 면역이 ${immune?.status}`);
    const toss = data.getMove("지구던지기");
    const ghost = slot("팬텀");
    const tossGhost = inf.inferDefense({ attacker: mine, defender: ghost, observations: [{ move: toss, critical: false, before: 100, after: 80 }] });
    const tossGuts = inf.inferDefense({ attacker: { ...mine, ability: "배짱" }, defender: ghost, observations: [{ move: toss, critical: false, before: 100, after: 80 }] });
    if (tossGhost?.status !== "invalid") fail(`지구던지기→고스트 면역이 ${tossGhost?.status}`);
    if (tossGuts?.status === "invalid") fail("배짱인데 지구던지기→고스트가 막힘");
    console.log(`고정 데미지 방어 역산 예외: 20%→쓰러짐 ${faint?.status} · 풀피→쓰러짐 ${faintFull?.status} · 면역 ${immune?.status} · 배짱 ${tossGuts?.status}`);
    // 고정 데미지와 일반 기술이 섞이면 방어 스탯은 일반 기술 쪽만 읽는다
    const mixedMove = data.getMove("아이언헤드");
    const opp = slot("망나뇽", { points: pts({ hp: 10, def: 20 }), nature: "용감" });
    const oppReal = reals(opp);
    const parts = ev.evaluateSlotMatchup(mine, mixedMove, opp, { skipVerdict: true }).damageParts;
    const d1 = fm.integerTotalDamage(parts, oppReal[parts.defenseKey], 0.92);
    const hpAfterFixed = oppReal.hp - 50;
    if (hpAfterFixed - d1 > 0) {
      const mixed = inf.inferDefense({
        ...base,
        observations: [
          { move, critical: false, before: 100, after: pct(hpAfterFixed, oppReal.hp) },
          { move: mixedMove, critical: false, before: pct(hpAfterFixed, oppReal.hp), after: pct(hpAfterFixed - d1, oppReal.hp) },
        ],
      });
      if (!(mixed?.status === "ok" && mixed.hp.min <= 10 && 10 <= mixed.hp.max && mixed.def.min <= 20 && 20 <= mixed.def.max)) fail(`고정+일반 혼합: 상태=${mixed?.status} hp=${JSON.stringify(mixed?.hp)} def=${JSON.stringify(mixed?.def)}`);
      else console.log("고정 데미지 + 일반 기술 혼합 ok");
    }
  }

  // 쓰러진 다단히트: n타째에 쓰러진 관측(앞 n-1타 합계 < HP ≤ n타 합계)에서 진짜 배분이 남는다
  {
    const move = data.getMove("스케일샷");
    let ok = 0;
    let tried = 0;
    for (let t = 0; t < 600 && tried < 40; t++) {
      const defP = Math.floor(rnd() * 33);
      const hpP = Math.floor(rnd() * 33);
      const opp = slot("망나뇽", { points: pts({ hp: hpP, def: defP }), nature: "용감" });
      const oppReal = reals(opp);
      const n = 2 + Math.floor(rnd() * 4);
      const full = ev.evaluateSlotMatchup(mine, move, opp, { multiHitCount: n, skipVerdict: true })?.damageParts;
      const prev = ev.evaluateSlotMatchup(mine, move, opp, { multiHitCount: n - 1, skipVerdict: true })?.damageParts;
      if (!full || !prev) continue;
      const roll = (85 + Math.floor(rnd() * 16)) / 100;
      const D = oppReal[full.defenseKey];
      const sPrev = fm.integerTotalDamage(prev, D, roll);
      const sFull = fm.integerTotalDamage(full, D, roll);
      if (sPrev >= oppReal.hp) continue;
      const hp0 = sPrev + 1 + Math.floor(rnd() * Math.max(1, Math.min(sFull - sPrev, oppReal.hp - sPrev) ));
      if (hp0 > oppReal.hp || hp0 > sFull) continue;
      tried++;
      const r = inf.inferDefense({ attacker: mine, defender: slot("망나뇽"), observations: [{ move, critical: false, before: pct(hp0, oppReal.hp), after: 0, hits: n }] });
      if (r?.status === "ok" && r.hp.min <= hpP && hpP <= r.hp.max && r.def.min <= defP && defP <= r.def.max) ok++;
      else fail(`쓰러진 다단히트 방어 역산: 진짜 hp ${hpP} def ${defP} n=${n} 상태=${r?.status} hp=${JSON.stringify(r?.hp)} def=${JSON.stringify(r?.def)}`);
    }
    console.log(`쓰러진 다단히트 방어 역산 ${ok}/${tried} ok`);
    if (tried < 20) fail("쓰러진 다단히트 방어 역산 시행 부족");
    // 음성: 맞기 전 HP가 1%(≈1~3HP)면 1타째에 이미 쓰러졌을 것이라 "2타째에 쓰러짐"은 어떤 후보도 불가능하다
    const two = data.getMove("더블어택");
    const impossible = inf.inferDefense({ attacker: mine, defender: slot("망나뇽"), observations: [{ move: two, critical: false, before: 1, after: 0, hits: 2 }] });
    const firstHit = inf.inferDefense({ attacker: mine, defender: slot("망나뇽"), observations: [{ move: two, critical: false, before: 1, after: 0, hits: 1 }] });
    if (impossible?.status !== "contradiction") fail(`1%에서 2타째에 쓰러짐이 ${impossible?.status}`);
    if (firstHit?.status !== "ok") fail(`1%에서 1타째에 쓰러짐이 ${firstHit?.status}`);
    console.log(`쓰러진 다단히트 예외: 1% 2타째 ${impossible?.status} · 1% 1타째 ${firstHit?.status}`);
  }
}
