// 3.4 H1 HP 최적 수치 눈금
export default async function ({ server, data, stat, pts, fail, failCount }) {
  // 6) 3.4 H1 HP 최적 수치 눈금 — 사용자 표의 예시와 전 종족값 전수 대조
  {
    const hm = await server.ssrLoadModule("/src/lib/hpMagic.ts");
    const before = failCount();
    const bases = [...new Set(data.POKEMON.map((p) => p.baseStats.hp))];
    const checkBase = (base) => {
      const marks = hm.hpMarks(base, 32);
      const byP = new Map(marks.map((m) => [m.points, m]));
      for (let p = 0; p <= 32; p++) {
        const hp = stat.computeRealStats({ hp: base, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, pts({ hp: p }), null).hp;
        const chain = [16, 8, 4, 2].filter((d) => hp % d === d - 1).length;
        const orb = hp % 10 === 9;
        const m = byP.get(p);
        const got = m ? [m.hp, m.chain.length, m.orb] : [hp, 0, false];
        if (JSON.stringify(got) !== JSON.stringify([hp, chain, orb])) fail(`HP 눈금 불일치 base ${base} ${p}pt: ${got} vs ${[hp, chain, orb]}`);
        if ((chain > 0 || orb) !== !!m) fail(`HP 눈금 유무 불일치 base ${base} ${p}pt`);
      }
    };
    bases.forEach(checkBase);
    // 사용자 표: 종족값 100 → 16n+15는 0·16·32포인트(175·191·207), 10n+9는 4·14·24포인트(179·189·199)
    const m100 = hm.hpMarks(100, 32);
    const at = (p) => m100.find((m) => m.points === p);
    for (const p of [0, 16, 32]) if (at(p)?.chain.length !== 4) fail(`종족값 100 ${p}포인트가 16n+15가 아님`);
    for (const p of [4, 14, 24]) if (!at(p)?.orb) fail(`종족값 100 ${p}포인트가 10n+9가 아님`);
    if (m100.some((m) => m.orb && m.chain.length === 4)) fail("종족값 100은 16n+15와 10n+9가 겹치면 안 됨");
    // 80의 배수−1(159·239)은 둘이 겹침: 종족값 84·0포인트, 종족값 132·32포인트
    for (const [base, p] of [[84, 0], [132, 32]]) {
      const m = hm.hpMarks(base, 32).find((x) => x.points === p);
      if (!m || m.chain.length !== 4 || !m.orb) fail(`종족값 ${base} ${p}포인트가 16n+15 + 10n+9가 아님`);
    }
    const info = hm.hpMarkInfo(at(16), new Set(["16n+15"]));
    if (info.header !== "HP 191 (16포인트)" || info.rows.length !== 4 || !info.rows[0].relevant || info.rows.slice(1).some((r) => r.relevant)) fail("HP 눈금 설명 형식이 다름");
    const rel = (item, moves) => [...hm.relevantHpRules(item, moves)].sort().join();
    if (rel("먹다남은음식") !== "16n+15" || rel("자뭉열매") !== "4n+3" || rel(null, [null, "대타출동"]) !== "4n+3" || rel("생명의구슬") !== "10n+9" || rel("구애스카프", ["지진"]) !== "") fail("슬롯 도구·기술 강조 대상이 다름");
    // 3.7 H1-b: 스텔스록은 타입의 바위 상성 배율로, 배북·철제광선·저주(고스트)는 홀수로 강조
    const relT = (types, moves = []) => [...hm.relevantHpRules(null, moves, types)].sort().join();
    const stealth = [[["노말"], "8n+7"], [["강철"], "16n+15"], [["땅", "강철"], "16n+15"], [["불꽃"], "4n+3"], [["불꽃", "비행"], "홀수"]];
    for (const [types, want] of stealth) if (relT(types) !== want) fail(`스텔스록 강조 ${types} → ${relT(types)} (기대 ${want})`);
    if (relT(["노말"], ["배북"]) !== "8n+7,홀수" || relT(["노말"], ["철제광선"]) !== "8n+7,홀수") fail("배북·철제광선 홀수 강조가 다름");
    if (relT(["고스트"], ["저주"]) !== "8n+7,홀수" || relT(["노말"], ["저주"]) !== "8n+7") fail("저주는 고스트 타입일 때만 홀수");
    // 가장 강한 필요 조건 기준 — 먹다남은음식(16n+15) + 스텔스록 등배(8n+7)면 16n+15 눈금만 강조, 구슬이면 10n+9 눈금도
    const need = hm.relevantHpRules("먹다남은음식", [], ["노말"]);
    const marks100 = hm.hpMarks(100, 32);
    for (const m of marks100) if (hm.isRelevantMark(m, need) !== (m.chain.length === 4)) fail(`강조 판정 ${m.points}pt`);
    const orbNeed = hm.relevantHpRules("생명의구슬", [], ["노말"]);
    for (const m of marks100) if (hm.isRelevantMark(m, orbNeed) !== (m.chain.length >= 3 || m.orb)) fail(`구슬+스텔스록 강조 판정 ${m.points}pt`);
    console.log(`HP 최적 수치 눈금(종족값 ${bases.length}종·33포인트 전수 + 표 예시)`, failCount() === before ? "통과" : "실패");
  }
}
