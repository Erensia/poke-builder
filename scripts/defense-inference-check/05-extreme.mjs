// 3.1 C2-a 극보정 형태 표시
export default async function ({ data, inf, fail }) {
  // 3.1 C2-a) 극보정 형태 표시 — 32가 두 개 이하이고 나머지 합이 2 이하. 표시용이라 계산엔 영향이 없다.
  {
    const ext = inf.isExtremePoints;
    const cases = [
      [[32, 32], true], [[32, 2], true], [[2, 32], true], [[1, 1], true], [[0, 0], true], [[2, 0], true],
      [[2, 2], false], [[31, 1], false], [[16, 16], false], [[32, 3], false], [[32, 32, 32], false], [[32, 32, 2], true], [[32, 32, 3], false],
    ];
    const bad = cases.filter(([v, want]) => ext(v) !== want);
    if (bad.length) fail(`극보정 형태 판정이 다름: ${JSON.stringify(bad)}`);
    // HP×방어 격자 전체(33×33)에서 극보정 칸은 13개(32·32 1 + 32와 0~2 6 + 합 2 이하 6)
    const full = new Uint8Array(33 * 33).fill(1);
    const counted = inf.countExtremeCells(full);
    if (counted.feasible !== 1089 || counted.extreme !== 13) fail(`극보정 칸 수가 13이 아님: ${JSON.stringify(counted)}`);
    // 기본 샘플의 실제 배분 중 극보정 형태 비율(정의가 실사용과 맞는지 점검 — 나머지는 내구를 나눠 투자한 배분)
    let total = 0;
    let extremeSlots = 0;
    for (const party of data.SAMPLE_PARTIES) {
      for (const sl of party.slots) {
        total++;
        if (ext(Object.values(sl.points))) extremeSlots++;
      }
    }
    console.log(`극보정 형태 판정 ${cases.length}건 통과 · 격자 극보정 칸 ${counted.extreme}개 · 기본 샘플 슬롯 중 극보정 형태 ${extremeSlots}/${total} (${((extremeSlots / total) * 100).toFixed(0)}%)`);
    if (extremeSlots / total < 0.5) fail("극보정 형태 정의가 기본 샘플 배분과 너무 안 맞음");
  }
}
