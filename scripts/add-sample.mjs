// 샘플 파티 txt(docs/03_샘플파티추가/파티 샘플 템플릿.txt 형식)를 src/data/samplePartyPresets.json 에 추가한다 — SP 작업 자동화(5.2).
//
//   node scripts/add-sample.mjs <txt> --id <id> --style <성향> [--name <이름>] [--desc <설명>] [--group real|textbook] [--fix] [--dry]
//
// 하는 일: txt 파싱 → 이름·특성·도구·기술·성격을 데이터와 대조해 오타를 찾는다(가장 가까운 후보를 제안) → 프리셋 추가(+ 등급 임시 "중",
// README 샘플 수 숫자 갱신, `고정선출맴버:` 줄은 fixedPicks) → `validate:data`를 돌려 실패하면 파일을 원복한다.
//   --fix  가장 가까운 후보가 하나뿐일 때(편집거리 ≤2, 접두어 포함은 1)만 자동 교정하고 그 내용을 출력한다. 없으면 제안만 하고 쓰지 않는다.
//   --dry  쓰지 않고 결과 요약만 본다.
//   --name 생략하면 txt 첫 줄, --desc 생략하면 txt의 구축의도(없거나 "모름"이면 --desc 필요). 성향(--style)은 필수.
// 이름·성향·설명의 판단은 사람(또는 Claude)이 한다. README의 "5.2에서 …개 추가" 같은 이력 문구는 손으로 고친다(숫자만 자동).
// ponytail: 오타 사전은 ALIAS 한 줄뿐(편집거리로 못 잡는 확실한 것만), 나머지는 편집거리 — 새 유형은 ALIAS에 더한다.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const norm = (s) => s.replace(/\r\n/g, "\n");
const readText = (rel) => readFileSync(join(root, rel), "utf8");
const readJson = (rel) => JSON.parse(norm(readText(rel)));
const PRESETS = "src/data/samplePartyPresets.json";
const TIERS = "src/data/samplePartyTiers.json";
const POINT_KEYS = { H: "hp", A: "atk", B: "def", C: "spa", D: "spd", S: "spe" };
const ALIAS = { 얼어붙은바위: "차가운바위", 슈카열매: "슈캐열매" };

/** 편집거리(접두어 관계면 1 — "메타그로스" ↔ "메타그로스나이트") */
export function distance(a, b) {
  if (a === b) return 0;
  if (a.startsWith(b) || b.startsWith(a)) return 1;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/** txt → { title, intent, fixed, members[] } */
export function parseSample(text) {
  const lines = norm(text).split("\n").map((l) => l.trim());
  const at = lines.findIndex((l) => l.startsWith("구축 맴버"));
  if (at < 0) throw new Error('"구축 맴버" 줄이 없다');
  const intent = [];
  let fixed = [];
  for (const l of lines.slice(1, at)) {
    if (l.startsWith("고정선출맴버:")) fixed = l.slice(7).includes("있다면") ? [] : l.slice(7).split(",").map((s) => s.trim()).filter(Boolean);
    else if (l) intent.push(l.replace(/^구축의도:/, ""));
  }
  const members = lines.slice(at + 1).join("\n").trim().split(/\n{2,}/).map((blk) => {
    const rows = blk.split("\n");
    const field = (k) => (rows.find((r) => r.startsWith(`${k}:`)) ?? "").slice(k.length + 1).trim();
    const gender = rows[0].match(/\((수컷|암컷)\)/)?.[1];
    return { raw: rows[0], name: rows[0].replace(/\(.*\)/, "").trim(), gender, ability: field("특성"), item: field("도구"), moves: field("기술배치").split(",").map((s) => s.trim()), nature: field("성격"), points: field("능력포인트") };
  });
  return { title: lines[0], intent: intent.join(" ").trim(), fixed, members };
}

function makeResolver(fix, issues, notes) {
  return (kind, word, list) => {
    if (list.includes(word)) return word;
    if (ALIAS[word] && list.includes(ALIAS[word])) {
      notes.push(`${kind} "${word}" → "${ALIAS[word]}" (별칭)`);
      return ALIAS[word];
    }
    const ranked = [...new Set(list)].map((c) => [c, distance(word, c)]).filter(([, d]) => d <= 2).sort((x, y) => x[1] - y[1]);
    if (fix && ranked.length && (ranked.length === 1 || ranked[0][1] < ranked[1][1])) {
      notes.push(`${kind} "${word}" → "${ranked[0][0]}" (자동 교정)`);
      return ranked[0][0];
    }
    issues.push(`${kind} "${word}" 없음${ranked.length ? ` — 혹시 ${ranked.slice(0, 3).map(([c]) => c).join(" / ")}?` : ""}`);
    return word;
  };
}

/** 고정선출 이름("로토무"·"메가갸라도스")을 슬롯 종 id로: 정확히 → "메가" 제거 → 부분 일치가 하나일 때 */
function resolvePick(word, ids) {
  const bare = word.replace(/^메가/, "");
  if (ids.includes(word)) return word;
  if (ids.includes(bare)) return bare;
  const part = ids.filter((id) => id.includes(bare) || bare.includes(id));
  return part.length === 1 ? part[0] : null;
}

/** 파싱 결과 → 프리셋 항목. 데이터와 맞지 않는 값은 issues(오류)·notes(자동 교정 내역)로 돌려준다 */
export function buildEntry(parsed, data, meta) {
  const issues = [];
  const notes = [];
  const resolve = makeResolver(meta.fix, issues, notes);
  const pokemonIds = data.pokemon.map((p) => p.id);
  const slots = parsed.members.map((m) => {
    const id = resolve("포켓몬", m.name, pokemonIds);
    const p = data.pokemon.find((x) => x.id === id);
    const abilities = p ? [p.abilities, p.hiddenAbility, ...(p.formVariants ?? []).flatMap((f) => [f.abilities, f.hiddenAbility])].flat().filter(Boolean) : [];
    const item = resolve(`${id} 도구`, m.item, data.items);
    const mega = p?.megaEvolutions?.find((x) => x.megaStone === item);
    const points = Object.fromEntries(Object.values(POINT_KEYS).map((k) => [k, 0]));
    for (const [, key, n] of m.points.matchAll(/([HABCDS])(\d+)/g)) points[POINT_KEYS[key]] = Number(n);
    const slot = {
      pokemonId: id,
      moves: m.moves.map((mv) => resolve(`${id} 기술(배우는 목록)`, mv, p?.learnset ?? [])),
      ability: resolve(`${id} 특성`, m.ability, abilities),
      item,
      nature: resolve("성격", m.nature, data.natures),
      points,
    };
    if (mega) slot.activeMegaForm = mega.form;
    if (m.gender === "암컷" && p?.genderCategory === "both") slot.gender = "female";
    return slot;
  });
  const ids = slots.map((s) => s.pokemonId);
  const fixedPicks = parsed.fixed.map((w) => {
    const hit = resolvePick(w, ids);
    if (!hit) issues.push(`고정선출 "${w}"이(가) 슬롯의 종이 아님 — ${ids.join(", ")} 중에서`);
    return hit ?? w;
  });
  const description = meta.desc ?? parsed.intent;
  if (!description || /^(모름|없음)$/.test(description)) issues.push("설명이 없다 — --desc 로 준다");
  const entry = { id: meta.id, name: meta.name ?? parsed.title, style: meta.style, group: meta.group ?? "real", description, ...(fixedPicks.length ? { fixedPicks } : {}), slots };
  return { entry, issues, notes };
}

export function loadData() {
  return {
    pokemon: readJson("src/data/pokemon.json"),
    items: readJson("src/data/items.json").map((i) => i.id),
    natures: readJson("src/data/natures.json").map((n) => n.id),
  };
}

function main(argv) {
  const opt = (n) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
  const file = argv.find((a) => !a.startsWith("--") && a !== opt("id") && a !== opt("style") && a !== opt("name") && a !== opt("desc") && a !== opt("group"));
  if (!file || !opt("id") || !opt("style")) throw new Error("사용법: node scripts/add-sample.mjs <txt> --id <id> --style <성향> [--name --desc --group --fix --dry]");
  const parsed = parseSample(readFileSync(file, "utf8"));
  const { entry, issues, notes } = buildEntry(parsed, loadData(), { id: opt("id"), style: opt("style"), name: opt("name"), desc: opt("desc"), group: opt("group"), fix: argv.includes("--fix") });
  for (const n of notes) console.log(`교정: ${n}`);
  if (issues.length) {
    console.error(`✖ 문제 ${issues.length}건 — 쓰지 않았다${argv.includes("--fix") ? "" : " (확실한 오타는 --fix 로 교정)"}`);
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }
  console.log(`${entry.id} · ${entry.name} · ${entry.style}${entry.fixedPicks ? ` · 고정 ${entry.fixedPicks.join(",")}` : ""}\n  ${entry.slots.map((s) => s.pokemonId + (s.activeMegaForm ? "*" : "")).join(", ")}`);
  if (argv.includes("--dry")) return console.log("(--dry: 쓰지 않음)");
  writeAll(entry);
}

/** 프리셋·등급·README를 쓰고 validate:data 가 실패하면 모두 원복한다 */
function writeAll(entry) {
  const files = [PRESETS, TIERS, "README.md"].map((rel) => [rel, readText(rel)]);
  const [presets, tiers, readme] = files.map(([, t]) => t);
  const crlf = (s, like) => (like.includes("\r\n") ? s.replace(/\n/g, "\r\n") : s);
  const list = JSON.parse(presets);
  if (crlf(JSON.stringify(list, null, 1), presets) !== presets) throw new Error("프리셋 파일 서식이 예상과 다르다(CRLF·indent 1) — 쓰지 않았다");
  if (list.some((p) => p.id === entry.id)) throw new Error(`id 중복: ${entry.id}`);
  const next = [...list, entry];
  const tierMap = { ...JSON.parse(tiers), [entry.id]: "중" };
  const count = (g) => next.filter((p) => p.group === g).length;
  const out = [
    [PRESETS, crlf(JSON.stringify(next, null, 1), presets)],
    [TIERS, crlf(`${JSON.stringify(Object.fromEntries(next.map((p) => [p.id, tierMap[p.id]])), null, 2)}\n`, tiers)],
    ["README.md", crlf(norm(readme).replace(/샘플 파티 \d+개/g, `샘플 파티 ${next.length}개`).replace(/심화샘플 \d+ \+ 기초샘플 \d+/, `심화샘플 ${count("real")} + 기초샘플 ${count("textbook")}`), readme)],
  ];
  if (!/샘플 파티 \d+개/.test(readme)) console.warn("README에서 '샘플 파티 N개' 문구를 못 찾았다 — 손으로 확인");
  for (const [rel, text] of out) writeFileSync(join(root, rel), text, "utf8");
  const run = spawnSync("node", [join(root, "scripts/validate-data.mjs")], { encoding: "utf8" });
  if (run.status !== 0) {
    for (const [rel, text] of files) writeFileSync(join(root, rel), text, "utf8");
    console.error(`✖ validate:data 실패 — 원복했다\n${run.stdout}`);
    process.exit(1);
  }
  console.log(`✔ 추가 완료 (총 ${next.length}개, 심화 ${count("real")} · 기초 ${count("textbook")}) · 등급 임시 "중" · validate:data 통과`);
  console.log('다음: README의 "5.2에서 …개 추가" 이력 문구, 백로그(SP 기록)를 고치고, test:ai·test:rank-ai 후 커밋(파일 지정). 측정 전 등급은 --new 로 알려 줄 것.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`✖ ${e.message}`);
    process.exit(1);
  }
}
