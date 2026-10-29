// 2.5 L4 배틀 프런티어
export default async function ({ server, data, check }) {
  // 2.5 L4: 배틀 프런티어 — 대진표는 샘플 파티를 한 번씩 전부(원본 불변), 연승·최대 연승·샘플별 누적·이탈 정산
  {
    const bs = await server.ssrLoadModule("/src/lib/battleSeries.ts");
    const before = data.SAMPLE_PARTIES.map((p) => p.id).join(",");
    let seed = 11;
    const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const order = bs.shuffled(data.SAMPLE_PARTIES, rng);
    check(
      "L4 대진표 = 샘플 파티 전부 한 번씩, 원본 순서 불변",
      order.length === data.SAMPLE_PARTIES.length && new Set(order.map((p) => p.id)).size === data.SAMPLE_PARTIES.length && data.SAMPLE_PARTIES.map((p) => p.id).join(",") === before,
    );
    const E = bs.EMPTY_FRONTIER;
    let st = bs.finishMatch(bs.finishMatch(bs.finishMatch(E, "x", true), "y", true), "x", true);
    check("L4 3연승 → 연승·최대 3, 샘플별 누적 x 2승 y 1승", st.streak === 3 && st.best === 3 && st.samples.x.wins === 2 && st.samples.y.wins === 1, JSON.stringify(st));
    st = bs.finishMatch(st, "z", false);
    check("L4 패배 → 연승 0, 최대 3 유지, 누적은 유지", st.streak === 0 && st.best === 3 && st.samples.z.losses === 1 && st.samples.x.wins === 2);
    st = bs.finishMatch(st, "x", true);
    check("L4 연승이 끊긴 뒤 다시 1연승, 최대는 3", st.streak === 1 && st.best === 3);
    const begun = bs.beginMatch(st, "q");
    check("L4 판 시작 표시는 연승을 건드리지 않음", begun.pendingId === "q" && begun.streak === 1);
    const settled = bs.settleAbandoned(begun);
    check("L4 이탈 정산 → 연승 0·그 샘플 패배 +1·표시 해제", settled.streak === 0 && settled.best === 3 && settled.samples.q.losses === 1 && settled.pendingId === null);
    check("L4 표시가 없으면 정산은 그대로(같은 객체)", bs.settleAbandoned(settled) === settled);
    check("L4 정산을 두 번 해도 한 번만 집계(멱등)", bs.settleAbandoned(bs.settleAbandoned(begun)).samples.q.losses === 1);
    const done = bs.finishMatch(begun, "q", true);
    check("L4 결과가 나오면 표시 해제", done.pendingId === null && done.streak === 2);
    check("L4 저장본 검증: 정상·손상", bs.isFrontierSave(done) && !bs.isFrontierSave({ streak: "1" }) && !bs.isFrontierSave(null) && !bs.isFrontierSave({ ...done, samples: null }));
    check("L4 입력 저장본을 변형하지 않음", E.streak === 0 && Object.keys(E.samples).length === 0 && E.pendingId === null);
    // 3.0 L4-a: 대기열 — 저장·정산·재충전
    const ids = ["a", "b", "c"];
    let q = bs.refillQueue(E, ids, rng);
    check("L4-a 빈 대기열 → 샘플 전부를 섞어 채움", q.queue.length === 3 && new Set(q.queue).size === 3 && q.queue.every((id) => ids.includes(id)));
    check("L4-a 남은 대기열이 있으면 그대로(같은 객체)", bs.refillQueue(q, ids, rng) === q);
    const head = q.queue[0];
    const after = bs.finishMatch(bs.beginMatch(q, head), head, true);
    check("L4-a 만난 상대는 대기열 맨 앞에서 빠짐", after.queue.length === 2 && after.queue.join() === q.queue.slice(1).join());
    const lost = bs.settleAbandoned(bs.beginMatch(q, head));
    check("L4-a 이탈 정산도 그 상대를 대기열에서 뺌(새로고침해도 같은 상대 재등장 없음)", lost.queue.join() === q.queue.slice(1).join() && lost.samples[head].losses === 1);
    const drained = bs.refillQueue({ ...q, queue: [] }, ids, rng);
    check("L4-a 한 바퀴를 다 돌면 다시 섞어 채움", drained.queue.length === 3);
    check("L4-a 없는 샘플 id는 대기열에서 걸러냄", bs.refillQueue({ ...q, queue: ["x", "a"] }, ids, rng).queue.join() === "a" && bs.refillQueue({ ...q, queue: ["x"] }, ids, rng).queue.length === 3);
    check("L4-a 2.5 저장본(queue 없음)도 유효, 잘못된 queue는 거부", bs.isFrontierSave({ streak: 1, best: 2, samples: {}, pendingId: null }) && !bs.isFrontierSave({ ...E, queue: [1] }) && !bs.isFrontierSave({ ...E, queue: "a" }));
    check("L4-a 입력 저장본을 변형하지 않음(대기열)", E.queue.length === 0 && q.queue.length === 3);
    // 3.1 S2: 내 샘플 — 프런티어 풀 옵션 저장·쓸 수 있는 샘플 판정
    check("S2 includeMine 기본 끔, 결과 정산 후에도 유지", E.includeMine === false && bs.finishMatch({ ...E, includeMine: true }, "x", true).includeMine === true);
    check("S2 저장본 검증: includeMine 없음(2.5·3.0 저장본)은 유효, 잘못된 값은 거부", bs.isFrontierSave({ streak: 0, best: 0, samples: {}, pendingId: null }) && !bs.isFrontierSave({ ...E, includeMine: "yes" }));
    const ms = await server.ssrLoadModule("/src/lib/mySamples.ts");
    const sampleOk = structuredClone(data.SAMPLE_PARTIES[0]);
    check("S2 기본 샘플은 쓸 수 있는 샘플로 판정", ms.isUsableSample(sampleOk));
    const brokenMon = structuredClone(sampleOk);
    brokenMon.slots[2].pokemonId = "없는포켓몬";
    const brokenMove = structuredClone(sampleOk);
    brokenMove.slots[0].moves[1] = "없는기술";
    const short = structuredClone(sampleOk);
    short.slots.pop();
    check("S2 없는 포켓몬·없는 기술·6마리가 아닌 샘플은 거름", !ms.isUsableSample(brokenMon) && !ms.isUsableSample(brokenMove) && !ms.isUsableSample(short));
    // 3.2 V3: 내 샘플 내보내기·가져오기 — 파일은 믿을 수 없는 입력
    const exported = (samples) => ms.exportMySamples(samples);
    const all = ms.parseMySamples(exported(data.SAMPLE_PARTIES));
    check(
      "V3 기본 샘플 전부를 내보내 다시 읽으면 하나도 안 빠지고 내용이 같음",
      all?.skipped === 0 &&
        all.samples.length === data.SAMPLE_PARTIES.length &&
        all.samples.every((x, i) => ms.sampleKey(x) === ms.sampleKey(data.SAMPLE_PARTIES[i]) && JSON.stringify(x.slots.map((t) => t.points)) === JSON.stringify(data.SAMPLE_PARTIES[i].slots.map((t) => t.points))),
      `읽음=${all?.samples.length} 건너뜀=${all?.skipped}`,
    );
    check("V3 읽은 샘플에는 받은 id를 넘기지 않음", all.samples.every((x) => !("id" in x)));
    check(
      "V3 내보내기 파일이 아니면 null",
      ms.parseMySamples("not json") === null && ms.parseMySamples("{}") === null && ms.parseMySamples("[]") === null && ms.parseMySamples(JSON.stringify({ kind: "other", samples: [] })) === null && ms.parseMySamples(JSON.stringify({ kind: "champions-my-samples", samples: "x" })) === null,
    );
    const mutate = (fn) => {
      const c = structuredClone(sampleOk);
      fn(c);
      return c;
    };
    const bad = [
      mutate((c) => (c.slots[0].pokemonId = "없는포켓몬")),
      mutate((c) => (c.slots[0].moves[1] = "없는기술")),
      mutate((c) => (c.slots[0].ability = "없는특성")),
      mutate((c) => (c.slots[0].item = "없는도구")),
      mutate((c) => (c.slots[0].nature = "없는성격")),
      mutate((c) => (c.slots[0].points.atk = 33)),
      mutate((c) => (c.slots[0].points.atk = 1.5)),
      mutate((c) => (c.slots[0].points = { hp: 32, atk: 32, def: 32, spa: 0, spd: 0, spe: 0 })),
      mutate((c) => (c.slots[0].points = null)),
      mutate((c) => (c.slots[0].moves = ["a"])),
      mutate((c) => (c.slots[0].gender = "x")),
      mutate((c) => (c.slots[0].formVariant = 3)),
      mutate((c) => c.slots.pop()),
      mutate((c) => (c.slots[2] = null)),
      mutate((c) => (c.group = "x")),
      mutate((c) => (c.name = "  ")),
      mutate((c) => (c.description = 5)),
      null,
      7,
    ];
    const mixed = ms.parseMySamples(exported([sampleOk, ...bad]));
    check("V3 틀린 샘플은 건너뛰고 멀쩡한 샘플만 읽음", mixed?.samples.length === 1 && mixed.skipped === bad.length, `읽음=${mixed?.samples.length} 건너뜀=${mixed?.skipped}/${bad.length}`);
    const trimmed = ms.parseMySamples(exported([mutate((c) => (c.name = "  이름  "))]));
    check("V3 이름은 앞뒤 공백을 지움", trimmed?.samples[0]?.name === "이름");
    check("V3 같은 샘플은 같은 열쇠, 이름·포켓몬·기술이 다르면 다른 열쇠", ms.sampleKey(sampleOk) === ms.sampleKey(structuredClone(sampleOk)) && ms.sampleKey(sampleOk) !== ms.sampleKey(brokenMove) && ms.sampleKey(sampleOk) !== ms.sampleKey({ ...sampleOk, name: "다른 이름" }));
    // 5.5 G1: 저장한 파티·포켓몬 빌드 백업/복원 — 파일은 믿을 수 없는 입력, 가져오기는 덮어쓰기라 읽기만 검증한다
    const bk = await server.ssrLoadModule("/src/lib/backup.ts");
    const gSlots = structuredClone(sampleOk.slots);
    const sig = (s) => (s === null ? "-" : [s.pokemonId, s.ability, s.item, s.nature, s.moves.join(","), JSON.stringify(s.points)].join("|"));
    const gFull = { id: "p1", name: "내 파티", savedAt: 1700000000000, slots: gSlots };
    const gHole = { id: "p2", name: "구멍 파티", savedAt: 1700000001000, slots: [gSlots[0], null, gSlots[2], null, null, null] };
    const gSlot = { id: "s1", name: "내 빌드", savedAt: 1700000002000, slot: gSlots[1] };
    const gRound = bk.parseBackup(bk.exportBackup([gFull, gHole], [gSlot]));
    check(
      "G1 내보낸 백업을 다시 읽으면 하나도 안 빠지고 이름·저장 시각·슬롯(빈 슬롯 포함)이 같음",
      gRound?.skipped === 0 &&
        gRound.partyPresets.length === 2 &&
        gRound.slotPresets.length === 1 &&
        [gFull, gHole].every((p, i) => gRound.partyPresets[i].name === p.name && gRound.partyPresets[i].savedAt === p.savedAt && gRound.partyPresets[i].slots.map(sig).join("/") === p.slots.map(sig).join("/")) &&
        gRound.slotPresets[0].name === gSlot.name && gRound.slotPresets[0].savedAt === gSlot.savedAt && sig(gRound.slotPresets[0].slot) === sig(gSlot.slot),
      `파티=${gRound?.partyPresets.length} 빌드=${gRound?.slotPresets.length} 건너뜀=${gRound?.skipped}`,
    );
    const gIds = [...gRound.partyPresets, ...gRound.slotPresets].map((x) => x.id);
    check("G1 받은 id를 믿지 않고 새로 매김(겹치지 않음)", new Set(gIds).size === 3 && gIds.every((id) => !["p1", "p2", "s1"].includes(id)));
    const gEmpty = bk.parseBackup(bk.exportBackup([], []));
    check("G1 비어 있는 백업도 백업 파일(null 아님, 0개·0개)", gEmpty?.partyPresets.length === 0 && gEmpty.slotPresets.length === 0 && gEmpty.skipped === 0);
    check(
      "G1 백업 파일이 아니면 null (내 샘플 내보내기 파일 포함)",
      bk.parseBackup("not json") === null && bk.parseBackup("{}") === null && bk.parseBackup("[]") === null && bk.parseBackup("null") === null &&
        bk.parseBackup(JSON.stringify({ kind: "other", partyPresets: [], slotPresets: [] })) === null &&
        bk.parseBackup(JSON.stringify({ kind: "champions-backup", partyPresets: [] })) === null &&
        bk.parseBackup(JSON.stringify({ kind: "champions-backup", partyPresets: "x", slotPresets: [] })) === null &&
        bk.parseBackup(ms.exportMySamples([sampleOk])) === null,
    );
    const gBadParty = (fn) => {
      const c = structuredClone(gFull);
      fn(c);
      return c;
    };
    const gBadParties = [
      gBadParty((c) => (c.slots[0].pokemonId = "없는포켓몬")),
      gBadParty((c) => (c.slots[0].moves[1] = "없는기술")),
      gBadParty((c) => (c.slots[0].points.atk = 33)),
      gBadParty((c) => c.slots.pop()),
      gBadParty((c) => (c.slots[1] = 5)),
      gBadParty((c) => (c.name = "  ")),
      gBadParty((c) => (c.slots = "x")),
      null,
      7,
    ];
    const gBadSlots = [{ ...gSlot, slot: null }, { ...gSlot, slot: { ...gSlots[1], pokemonId: "없는포켓몬" } }, { ...gSlot, name: " " }, null, 7];
    const gMixed = bk.parseBackup(bk.exportBackup([gFull, ...gBadParties], [gSlot, ...gBadSlots]));
    check(
      "G1 틀린 파티·빌드는 건너뛰고 멀쩡한 것만 읽음",
      gMixed?.partyPresets.length === 1 && gMixed.slotPresets.length === 1 && gMixed.skipped === gBadParties.length + gBadSlots.length,
      `파티=${gMixed?.partyPresets.length} 빌드=${gMixed?.slotPresets.length} 건너뜀=${gMixed?.skipped}/${gBadParties.length + gBadSlots.length}`,
    );
    const gAllBad = bk.parseBackup(bk.exportBackup(gBadParties, gBadSlots));
    check("G1 읽을 수 있는 항목이 하나도 없으면 0개·0개로 돌려줌(화면이 덮어쓰기를 막는 근거)", gAllBad?.partyPresets.length === 0 && gAllBad.slotPresets.length === 0 && gAllBad.skipped === gBadParties.length + gBadSlots.length);
    const gOddMeta = bk.parseBackup(bk.exportBackup([{ ...gFull, name: "  공백  ", savedAt: "어제" }], []));
    check("G1 이름은 앞뒤 공백을 지우고 저장 시각이 숫자가 아니면 지금 시각으로", gOddMeta?.partyPresets[0]?.name === "공백" && Number.isFinite(gOddMeta.partyPresets[0].savedAt) && gOddMeta.partyPresets[0].savedAt !== "어제");
  }
}
