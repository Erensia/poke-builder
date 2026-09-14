// 스테이징 배치(신규 포켓몬·기술·도구)를 src/data/*.json 에 병합한다.
// "검토용" 배치가 맨 뒤에 append 되는 것 — 기존 데이터 수정·삭제는 이 스크립트의 범위 밖이다.
//
// 배치 폴더는 아래 파일들을 (있는 만큼만) 담는다. 정확한 파일명은 안 봐도 되고,
// "moves"/"pokemon"/"items"라는 단어가 파일명에 들어있으면 찾는다:
//   - *pokemon*.json — { "pokemon": [...], "megaEvolutionAdditions"?: [{ baseId, ...megaEvolution필드 }] }
//   - *moves*.json   — { "moves": [...] }
//   - *items*.json   — { "items": [...] }
//
// 각 항목 객체 안의 `_`로 시작하는 키(`_readme`·`_flags`·`_learnsetByForm` 등)는 스테이징 전용
// 메모라 병합 전 제거한다. 단 `_learnsetByForm`은 예외 — 폼별로 다른 learnset을 표현할 스키마가
// 없어서 쓰는 편법이라, 제거하기 전에 그 내용을 실제 learnset 필드에 반영한다:
//   standard 폼(또는 최상위 항목)에는 그 폼 id에 해당하는 배열을 최상위 `learnset`으로,
//   나머지 formVariants 각각에는 자기 id에 해당하는 배열을 그 폼의 `learnset`으로.
//
// id가 이미 존재하는 항목은 조용히 건너뛴다(재실행해도 안전) — 이미 병합된 배치를 다시 돌려도
// 중복이 생기지 않는다. 기존 파일의 기존 항목은 텍스트 그대로 두고 새 항목만 파일 끝에
// 이어붙이는 방식이라(전체 재직렬화 없음) 기존 항목의 서식이 흐트러질 위험이 없다.
//
// megaEvolutionAdditions는 baseId로 기존 포켓몬을 찾아 megaEvolutions 배열에 새 폼을 추가한다.
// 같은 form 이름이 이미 있으면 건너뛴다.
//
// 실행:
//   node scripts/merge-staging.mjs <스테이징폴더> [--dry-run]
// 병합 후에는 `npm run validate:data`로 참조 무결성(learnset·특성 등)을 확인할 것 — 이 스크립트는
// "새 항목을 파일에 추가"만 하고 내용 검증은 하지 않는다.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = join(root, "src", "data");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const stagingDir = args.find((a) => !a.startsWith("--"));

if (!stagingDir) {
  console.error("사용법: node scripts/merge-staging.mjs <스테이징폴더> [--dry-run]");
  process.exit(1);
}

const NL = "\r\n"; // src/data/*.json 은 전부 CRLF — 기존 파일과 서식을 맞춘다.

/** `_`로 시작하는 키를 재귀적으로 제거한다(스테이징 전용 메모). `_learnsetByForm`은 별도 처리하므로 여기선 그대로 둔다 — 호출부에서 먼저 소비한 뒤 strip한다. */
function stripUnderscoreKeys(value) {
  if (Array.isArray(value)) return value.map(stripUnderscoreKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith("_")) continue;
      out[k] = stripUnderscoreKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * `_learnsetByForm`(폼 id → learnset 배열)이 있으면 실제 learnset 필드로 풀어낸 뒤 제거한다.
 * standard 폼(formVariants에 standard:true가 있으면 그 id, 없으면 최상위 자신)의 learnset을
 * 최상위 `learnset`으로, 나머지는 각 formVariants 항목의 `learnset`으로.
 */
function resolveLearnsetByForm(species) {
  const byForm = species._learnsetByForm;
  if (!byForm) return species;
  const next = { ...species };
  const standardVariant = next.formVariants?.find((fv) => fv.standard);
  const topFormId = standardVariant?.id;
  if (topFormId && byForm[topFormId]) {
    next.learnset = byForm[topFormId];
  }
  if (next.formVariants) {
    next.formVariants = next.formVariants.map((fv) =>
      byForm[fv.id] ? { ...fv, learnset: byForm[fv.id] } : fv,
    );
  }
  return next;
}

function findStagingFile(dir, keyword) {
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".json") && f.toLowerCase().includes(keyword),
  );
  if (files.length === 0) return null;
  if (files.length > 1) {
    console.warn(`⚠ "${keyword}" 후보가 ${files.length}개 — 첫 번째(${files[0]})만 사용`);
  }
  return join(dir, files[0]);
}

/**
 * raw[openIdx]는 여는 괄호(`{` 또는 `[`) — 문자열 내용은 무시하고(이스케이프 포함) 괄호 깊이만
 * 추적해 짝이 맞는 닫는 괄호의 인덱스를 찾는다. 유효한 JSON이면 괄호 "종류"를 안 가려도(깊이만
 * 세도) 항상 정확하다 — 같은 깊이에서 타입이 안 맞게 닫히는 경우가 없기 때문.
 */
function findMatchingBracket(raw, openIdx) {
  let depth = 0;
  let inString = false;
  for (let i = openIdx; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("findMatchingBracket: 매칭되는 괄호를 못 찾음(JSON 형식이 예상과 다름)");
}

/** `[ {...}, {...} ]` 형태 파일에서 최상위 객체들의 [start, end) 오프셋을 배열 순서대로 찾는다. */
function splitTopLevelObjects(raw) {
  const objects = [];
  let i = raw.indexOf("[");
  if (i === -1) throw new Error("splitTopLevelObjects: 최상위 배열을 못 찾음");
  i++;
  while (i < raw.length) {
    while (i < raw.length && raw[i] !== "{" && raw[i] !== "]") i++;
    if (i >= raw.length || raw[i] === "]") break;
    const start = i;
    const end = findMatchingBracket(raw, start) + 1;
    objects.push({ start, end });
    i = end;
  }
  return objects;
}

/**
 * pokemon.json 원문에서 species(id로 지정)의 객체 블록 하나만 찾아 그 안에 메가폼 1개를
 * 추가한다 — 나머지 종·나머지 필드는 텍스트 그대로라 전체 재직렬화보다 안전하다(기존 파일이
 * 엔트리마다 한 줄/여러 줄이 섞여 있어 JSON.stringify 왕복이 byte-identical하지 않음을 확인함).
 * `megaEvolutions` 키가 이미 있으면 그 배열 끝에 추가, 없으면 `genderCategory` 키 앞에
 * `"megaEvolutions": [...]`를 새로 끼워 넣는다(이 스키마에서 이 키가 거의 항상 있는 자리).
 * 반환값: 수정된 raw 텍스트. 대상을 못 찾거나 이미 같은 form이 있으면 원본 raw를 그대로 반환.
 */
/** text 끝(정확히는 anchorIdx 직전)의 줄에서 그 줄의 들여쓰기(줄 시작 공백)를 읽는다. */
function indentOfLineBefore(text, anchorIdx) {
  const lineStart = text.lastIndexOf("\n", anchorIdx - 1) + 1;
  const m = /^[ \t]*/.exec(text.slice(lineStart, anchorIdx));
  return m[0];
}

function insertMegaEvolution(raw, speciesId, megaEntryText, speciesIndex, form) {
  const objects = splitTopLevelObjects(raw);
  const { start, end } = objects[speciesIndex];
  const block = raw.slice(start, end);

  const megaKeyIdx = block.indexOf('"megaEvolutions"');
  if (megaKeyIdx !== -1) {
    const keyIndent = indentOfLineBefore(block, megaKeyIdx); // "[" 여는 줄의 들여쓰기 = 닫는 "]"도 같은 들여쓰기
    const openBracket = block.indexOf("[", megaKeyIdx);
    const closeBracket = findMatchingBracket(block, openBracket);
    const inner = block.slice(openBracket + 1, closeBracket).trim();
    const hasExisting = inner.length > 0;
    if (hasExisting && inner.includes(`"form": "${form}"`)) return { raw, changed: false };
    // closeBracket 앞의 공백(마지막 항목 뒤 줄바꿈+들여쓰기)을 걷어내고 새로 채운다 —
    // 그래야 콤마가 마지막 "}" 바로 뒤에 붙고 닫는 "]"도 원래 들여쓰기를 유지한다.
    const before = block.slice(0, closeBracket).replace(/[ \t]*$/, "").replace(/\r?\n$/, "");
    const insertion = (hasExisting ? "," : "") + NL + megaEntryText + NL + keyIndent;
    const rebuilt = before + insertion + block.slice(closeBracket);
    return { raw: raw.slice(0, start) + rebuilt + raw.slice(end), changed: true };
  }

  // megaEvolutions 키가 아예 없는 종 — genderCategory 키 앞에 새로 끼워 넣는다.
  const anchorIdx = block.indexOf('"genderCategory"');
  if (anchorIdx === -1) {
    throw new Error(
      `insertMegaEvolution: "${speciesId}" 블록에서 "genderCategory" 키를 못 찾음 — 삽입 위치 확인 필요`,
    );
  }
  const keyIndent = indentOfLineBefore(block, anchorIdx);
  const insertion = `"megaEvolutions": [${NL}${megaEntryText}${NL}${keyIndent}],${NL}${keyIndent}`;
  const newBlock = block.slice(0, anchorIdx) + insertion + block.slice(anchorIdx);
  return { raw: raw.slice(0, start) + newBlock + raw.slice(end), changed: true };
}

/** 배열을 담은 JSON 파일 끝에 새 항목들을 텍스트로 이어붙인다(전체 재직렬화 없음). */
function appendEntriesToArrayFile(filePath, newEntries, indent = "  ") {
  if (newEntries.length === 0) return 0;
  const raw = readFileSync(filePath, "utf8");
  const tail = "}" + NL + "]" + NL;
  if (!raw.endsWith(tail)) {
    throw new Error(`${filePath}: 예상한 파일 끝 형식이 아님(수동 확인 필요) — "${raw.slice(-30)}"`);
  }
  const blocks = newEntries.map((entry) => {
    const txt = JSON.stringify(entry, null, 2);
    return txt
      .split("\n")
      .map((ln) => (ln ? indent + ln : ln))
      .join("\n");
  });
  const block = blocks.join("," + NL).replace(/\n/g, NL);
  const next = raw.slice(0, -tail.length) + "}," + NL + block + NL + "]" + NL;
  if (!dryRun) writeFileSync(filePath, next, "utf8");
  return newEntries.length;
}

function mergeFlatList(kind, jsonKey, dataFileName) {
  const stagingPath = findStagingFile(stagingDir, kind);
  if (!stagingPath) {
    console.log(`- ${kind}: 스테이징 파일 없음, 건너뜀`);
    return;
  }
  const staged = JSON.parse(readFileSync(stagingPath, "utf8"))[jsonKey] ?? [];
  const dataPath = join(dataDir, dataFileName);
  const existing = JSON.parse(readFileSync(dataPath, "utf8"));
  const existingIds = new Set(existing.map((e) => e.id));
  const toAdd = staged
    .map(stripUnderscoreKeys)
    .filter((e) => !existingIds.has(e.id));
  const skipped = staged.length - toAdd.length;
  const added = appendEntriesToArrayFile(dataPath, toAdd);
  console.log(
    `- ${dataFileName}: +${added}건${skipped ? ` (이미 존재해 ${skipped}건 건너뜀)` : ""}${
      dryRun ? " [dry-run]" : ""
    }${added ? " — " + toAdd.map((e) => e.id).join(", ") : ""}`,
  );
}

function mergePokemon() {
  const stagingPath = findStagingFile(stagingDir, "pokemon");
  if (!stagingPath) {
    console.log("- pokemon: 스테이징 파일 없음, 건너뜀");
    return;
  }
  const staged = JSON.parse(readFileSync(stagingPath, "utf8"));
  const dataPath = join(dataDir, "pokemon.json");
  const existing = JSON.parse(readFileSync(dataPath, "utf8"));
  const existingIds = new Set(existing.map((e) => e.id));

  const newSpecies = (staged.pokemon ?? [])
    .map(resolveLearnsetByForm)
    .map(stripUnderscoreKeys)
    .filter((e) => !existingIds.has(e.id));
  const skippedSpecies = (staged.pokemon ?? []).length - newSpecies.length;
  const addedSpecies = appendEntriesToArrayFile(dataPath, newSpecies);
  console.log(
    `- pokemon.json (신규 종): +${addedSpecies}건${
      skippedSpecies ? ` (이미 존재해 ${skippedSpecies}건 건너뜀)` : ""
    }${dryRun ? " [dry-run]" : ""}${addedSpecies ? " — " + newSpecies.map((e) => e.id).join(", ") : ""}`,
  );

  // megaEvolutionAdditions: 기존 종의 megaEvolutions 배열에 폼 추가. 신규 종 추가(위)까지 반영된
  // 최신 파일을 다시 읽고, insertMegaEvolution으로 대상 종 블록 하나만 텍스트 splice한다 — 전체
  // 재직렬화(JSON.stringify 왕복)는 기존 파일이 엔트리마다 한 줄/여러 줄이 섞여 있어 무관한
  // 종까지 재포맷해버리는 것을 확인해서 쓰지 않는다.
  const additions = staged.megaEvolutionAdditions ?? [];
  if (additions.length === 0) return;
  let raw = readFileSync(dataPath, "utf8");
  let currentIds = JSON.parse(raw).map((p) => p.id);
  let anyChanged = false;
  for (const entry of additions) {
    const { baseId, ...mega } = stripUnderscoreKeys(entry);
    const speciesIndex = currentIds.indexOf(baseId);
    if (speciesIndex === -1) {
      console.warn(`⚠ megaEvolutionAdditions: 기준 종 "${baseId}"를 pokemon.json에서 못 찾음 — 건너뜀`);
      continue;
    }
    const megaEntryText = JSON.stringify(mega, null, 2)
      .split("\n")
      .map((ln) => "      " + ln)
      .join(NL);
    const result = insertMegaEvolution(raw, baseId, megaEntryText, speciesIndex, mega.form);
    if (!result.changed) {
      console.log(`- megaEvolutionAdditions: "${mega.form}" 이미 존재, 건너뜀`);
      continue;
    }
    raw = result.raw;
    anyChanged = true;
    console.log(`- megaEvolutionAdditions: "${baseId}"에 "${mega.form}" 추가${dryRun ? " [dry-run]" : ""}`);
  }
  if (anyChanged && !dryRun) writeFileSync(dataPath, raw, "utf8");
}

console.log(`스테이징 병합: ${stagingDir}${dryRun ? " (dry-run — 파일 안 씀)" : ""}`);
mergeFlatList("moves", "moves", "moves.json");
mergeFlatList("items", "items", "items.json");
mergePokemon();
console.log(dryRun ? "\ndry-run 끝. 실제로 쓰려면 --dry-run을 빼고 다시 실행." : "\n완료. `npm run validate:data`로 확인할 것.");
