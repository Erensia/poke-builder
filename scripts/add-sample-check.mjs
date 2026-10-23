// add-sample.mjs 검증 — 이미 손으로 변환해 둔 샘플 21~25의 txt를 --fix 로 변환했을 때 프리셋의 슬롯·fixedPicks와 같은지,
// --fix 없이는 오타를 문제로 잡는지 확인한다. 쓰지 않는다(파일을 건드리지 않음).
//   node scripts/add-sample-check.mjs   (npm run test:sample)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEntry, distance, loadData, parseSample } from "./add-sample.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const presets = JSON.parse(readFileSync(join(root, "src/data/samplePartyPresets.json"), "utf8").replace(/\r\n/g, "\n"));
const data = loadData();
const SAMPLES = { 21: "real-darkpet-malice", 22: "real-m7-rating2000", 23: "real-mega-gardevoir-rating", 24: "real-garchomp-z-lucario-z", 25: "real-m7-rating1950" };

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
};

check("편집거리: 한 글자 차이=1 · 접두어=1 · 무관=큼", distance("웨이프태클", "웨이브태클") === 1 && distance("메타그로스", "메타그로스나이트") === 1 && distance("가", "나나나") > 2);

for (const [n, id] of Object.entries(SAMPLES)) {
  const preset = presets.find((p) => p.id === id);
  const parsed = parseSample(readFileSync(join(root, `docs/03_샘플파티추가/파티 샘플${n}.txt`), "utf8"));
  const meta = { id, name: preset.name, style: preset.style, group: preset.group, desc: preset.description };
  const fixed = buildEntry(parsed, data, { ...meta, fix: true });
  check(`샘플${n}: --fix 변환이 프리셋 슬롯과 같음`, JSON.stringify(fixed.entry.slots) === JSON.stringify(preset.slots) && fixed.issues.length === 0, fixed.issues.join(" / "));
  check(`샘플${n}: fixedPicks가 프리셋과 같음`, JSON.stringify(fixed.entry.fixedPicks ?? []) === JSON.stringify(preset.fixedPicks ?? []));
  const plain = buildEntry(parsed, data, { ...meta, fix: false });
  const typos = fixed.notes.filter((x) => x.includes("자동 교정")).length;
  check(`샘플${n}: --fix 없이는 자동 교정 ${typos}건이 문제로 남음`, plain.issues.length >= typos, `issues ${plain.issues.length}`);
}

console.log(failed ? `\n${failed}건 실패` : "\nALL PASS");
process.exit(failed ? 1 : 0);
