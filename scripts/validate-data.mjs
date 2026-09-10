// src/data/*.json 의 정합성 게이트.
//   1) 참조 무결성 — learnset·특성·메가스톤·성격 등이 실제 존재하는 id 를 가리키는지
//   2) 스키마·상식 — 필수 필드, 타입 값, 종족값 범위, id 중복, standard 폼 개수
//   3) 스프라이트 역방향 체크 — 각 포켓몬/폼/메가·각 도구에 대응하는 매니페스트 키가 있는지
// 1·2 위반은 ERROR(exit 1), 3 위반은 WARNING(이니셜 폴백이 있으므로). `--strict` 면 WARNING 도 exit 1.
// 실행: `npm run validate:data` (또는 `node scripts/validate-data.mjs [--strict]`)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = join(root, "src", "data");
const spritesDir = join(root, "public", "sprites");
const strict = process.argv.includes("--strict");

const read = (name) => JSON.parse(readFileSync(join(dataDir, name), "utf8"));
const POKEMON = read("pokemon.json");
const MOVES = read("moves.json");
const ABILITIES = read("abilities.json");
const ITEMS = read("items.json");
const NATURES = read("natures.json");
const TYPE_CHART = read("typeChart.json");
const MANIFEST = read("spriteManifest.json");

// src/types/pokemon-type.ts 와 동기화. 데이터에 저장되는 한글 명칭.
const TYPES = new Set([
  "노말", "불꽃", "물", "풀", "전기", "얼음", "격투", "독", "땅",
  "비행", "에스퍼", "벌레", "바위", "고스트", "드래곤", "악", "강철", "페어리",
]);
const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];
const GENDER_CATEGORIES = new Set(["both", "male-only", "female-only", "genderless"]);

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// ── 조회용 집합 ───────────────────────────────────────────────────────────────
const moveIds = new Set(MOVES.map((m) => m.id));
const abilityIds = new Set(ABILITIES.map((a) => a.id));
const itemIds = new Set(ITEMS.map((i) => i.id));

// ── 1) id 중복 ────────────────────────────────────────────────────────────────
for (const [label, list] of [
  ["pokemon.json", POKEMON], ["moves.json", MOVES], ["abilities.json", ABILITIES],
  ["items.json", ITEMS], ["natures.json", NATURES],
]) {
  const seen = new Set();
  for (const row of list) {
    if (seen.has(row.id)) err(`${label}: id 중복 "${row.id}"`);
    seen.add(row.id);
  }
}

// ── 2) moves / natures / typeChart 자체 검증 ─────────────────────────────────
for (const m of MOVES) {
  if (m.type !== null && m.type !== undefined && !TYPES.has(m.type))
    err(`moves.json "${m.id}": 알 수 없는 타입 "${m.type}"`);
}
for (const n of NATURES) {
  for (const k of ["increased", "decreased"]) {
    const v = n[k];
    if (v !== null && v !== undefined && !STAT_KEYS.includes(v))
      err(`natures.json "${n.id}": ${k} 가 스탯 키가 아님 "${v}"`);
  }
}
for (const [atk, row] of Object.entries(TYPE_CHART)) {
  if (!TYPES.has(atk)) err(`typeChart.json: 알 수 없는 공격 타입 키 "${atk}"`);
  for (const def of Object.keys(row))
    if (!TYPES.has(def)) err(`typeChart.json["${atk}"]: 알 수 없는 방어 타입 키 "${def}"`);
}

// ── 3) 포켓몬: 참조 무결성 + 스키마 ─────────────────────────────────────────
const checkTypes = (where, arr) => {
  if (!Array.isArray(arr) || arr.length < 1 || arr.length > 2)
    err(`${where}: types 는 1~2개여야 함 (${JSON.stringify(arr)})`);
  else for (const t of arr) if (!TYPES.has(t)) err(`${where}: 알 수 없는 타입 "${t}"`);
};
const checkStats = (where, s) => {
  if (!s || typeof s !== "object") return err(`${where}: baseStats 누락`);
  const keys = Object.keys(s);
  if (keys.length !== 6 || !STAT_KEYS.every((k) => k in s))
    err(`${where}: baseStats 키가 [${STAT_KEYS}] 와 다름 (${keys})`);
  for (const k of STAT_KEYS) {
    const v = s[k];
    if (!Number.isInteger(v) || v < 0 || v > 255) err(`${where}: baseStats.${k} 범위 밖 (${v})`);
    else if (v === 0) warn(`${where}: baseStats.${k} = 0 (TODO_STATS 미확정?)`);
  }
};
const checkAbility = (where, id) => {
  if (id !== null && id !== undefined && !abilityIds.has(id))
    err(`${where}: 특성 "${id}" 가 abilities.json 에 없음`);
};

for (const p of POKEMON) {
  const at = `pokemon.json "${p.id}"`;
  if (!p.name) err(`${at}: name 누락`);
  checkTypes(at, p.types);
  checkStats(at, p.baseStats);

  if (!Array.isArray(p.abilities) || p.abilities.length < 1) err(`${at}: abilities 가 비어 있음`);
  else p.abilities.forEach((a) => checkAbility(`${at}.abilities`, a));
  checkAbility(`${at}.hiddenAbility`, p.hiddenAbility);
  if (p.genderedHiddenAbility) {
    checkAbility(`${at}.genderedHiddenAbility.male`, p.genderedHiddenAbility.male);
    checkAbility(`${at}.genderedHiddenAbility.female`, p.genderedHiddenAbility.female);
  }

  if (!GENDER_CATEGORIES.has(p.genderCategory))
    err(`${at}: genderCategory 값이 잘못됨 "${p.genderCategory}"`);
  if (p.weightKg !== undefined && (!(p.weightKg > 0)))
    err(`${at}: weightKg 는 양수여야 함 (${p.weightKg})`);

  if (!Array.isArray(p.learnset)) err(`${at}: learnset 이 배열이 아님`);
  else {
    const seen = new Set();
    for (const mv of p.learnset) {
      if (!moveIds.has(mv)) err(`${at}.learnset: 기술 "${mv}" 가 moves.json 에 없음`);
      if (seen.has(mv)) warn(`${at}.learnset: "${mv}" 중복`);
      seen.add(mv);
    }
  }

  for (const mega of p.megaEvolutions ?? []) {
    const mat = `${at}.mega "${mega.form}"`;
    if (!mega.megaStone || !itemIds.has(mega.megaStone))
      err(`${mat}: megaStone "${mega.megaStone}" 가 items.json 에 없음`);
    checkAbility(`${mat}.ability`, mega.ability);
    checkTypes(mat, mega.types);
    checkStats(mat, mega.baseStats);
  }
  const megaForms = (p.megaEvolutions ?? []).map((m) => m.form);
  if (new Set(megaForms).size !== megaForms.length) err(`${at}: megaEvolutions[].form 중복`);

  for (const fv of p.formVariants ?? []) {
    checkTypes(`${at}.formVariant "${fv.id}"`, fv.types);
    checkStats(`${at}.formVariant "${fv.id}"`, fv.baseStats);
    (fv.abilities ?? []).forEach((a) => checkAbility(`${at}.formVariant "${fv.id}".abilities`, a));
    checkAbility(`${at}.formVariant "${fv.id}".hiddenAbility`, fv.hiddenAbility);
    for (const mv of fv.learnset ?? [])
      if (!moveIds.has(mv)) err(`${at}.formVariant "${fv.id}".learnset: 기술 "${mv}" 가 moves.json 에 없음`);
  }
  for (const [field, forms] of [["formVariants", p.formVariants], ["sizeForms", p.sizeForms], ["cosmeticForms", p.cosmeticForms]]) {
    if (!forms) continue;
    const std = forms.filter((f) => f.standard).length;
    if (std !== 1) err(`${at}.${field}: standard:true 항목이 정확히 1개여야 함 (현재 ${std})`);
  }
  if (p.stanceChangeForms?.revertMoveId && !moveIds.has(p.stanceChangeForms.revertMoveId))
    err(`${at}.stanceChangeForms.revertMoveId: "${p.stanceChangeForms.revertMoveId}" 가 moves.json 에 없음`);
}

// ── 4) 스프라이트 역방향 체크 ───────────────────────────────────────────────
// sprites.ts / gen-sprite-manifest.mjs 와 동일한 정규화(공백 제거).
const norm = (s) => String(s).replace(/\s+/g, "");
const manifestHas = (key) => Object.prototype.hasOwnProperty.call(MANIFEST, norm(key));

// 알려진 예외(아직 에셋이 없거나, 의도적으로 이니셜 폴백을 쓰는 것)는 여기 등록해 소음을 줄인다.
let allow = { spriteMissingPokemon: [], spriteMissingMegaForm: [], spriteMissingItem: [] };
try {
  allow = { ...allow, ...JSON.parse(readFileSync(join(root, "scripts", "data-allowlist.json"), "utf8")) };
} catch {
  /* 파일 없으면 빈 allowlist */
}
const allowP = new Set(allow.spriteMissingPokemon);
const allowM = new Set(allow.spriteMissingMegaForm);
const allowI = new Set(allow.spriteMissingItem);

// megaFormFullName(pokemonForm.ts): "리자몽-메가X" → "메가리자몽X"
const megaKey = (form) => {
  const m = String(form).match(/^(.+)-메가([XYZ]?)$/);
  return m ? `메가${m[1]}${m[2]}` : form;
};
// regionalStem(sprites.ts): "알로라나인테일" → "나인테일(알로라)"
const regionalKey = (id) => {
  const m = id.match(/^(알로라|가라르|히스이)(.+)$/);
  return m ? `${m[2]}(${m[1]})` : null;
};
// sprites.ts 의 ID_TO_SPRITE_STEM 사본. sprites.ts 를 고치면 여기도 맞춘다.
const ID_TO_SPRITE_STEM = {
  팔데아켄타로스컴뱃종: "켄타로스(팔데아 컴뱃종)",
  팔데아켄타로스블레이즈종: "켄타로스(팔데아 블레이즈종)",
  팔데아켄타로스워터종: "켄타로스(팔데아 워터종)",
  플라엣테영원의꽃: "플라엣테(영원의 꽃)",
};

// 폼 파일만 있고 기본 파일이 없는 종(펌킨인·마휘핑 등)은 기준 폼 파일이 기본 역할을 한다(sprites.ts).
const standardFormKeys = (p) => {
  const keys = [];
  for (const forms of [p.formVariants, p.sizeForms, p.cosmeticForms]) {
    const std = forms?.find((f) => f.standard) ?? forms?.[0];
    if (std) keys.push(`${p.id}(${std.label})`);
  }
  if (p.genderedSprite) keys.push(`${p.id}(수컷)`, `${p.id}(암컷)`);
  return keys;
};

for (const p of POKEMON) {
  if (allowP.has(p.id)) continue;
  // 기본 스프라이트 — id / 리전 보정 / 파일명 보정(ID_TO_SPRITE_STEM) / 기준 폼 파일 중 하나면 OK
  const baseOk =
    manifestHas(p.id) ||
    (regionalKey(p.id) && manifestHas(regionalKey(p.id))) ||
    (ID_TO_SPRITE_STEM[p.id] && manifestHas(ID_TO_SPRITE_STEM[p.id])) ||
    standardFormKeys(p).some(manifestHas);
  if (!baseOk) warn(`sprite: 포켓몬 "${p.id}" 기본 스프라이트 없음 (매니페스트 키 "${norm(p.id)}")`);

  for (const mega of p.megaEvolutions ?? [])
    if (!allowM.has(mega.form) && !manifestHas(megaKey(mega.form)))
      warn(`sprite: 메가폼 "${mega.form}" 없음 (매니페스트 키 "${norm(megaKey(mega.form))}")`);

  // 기준(standard)이 아닌 폼 변종·크기·겉모습은 전용 파일이 있어야 한다
  for (const [field, forms] of [["formVariants", p.formVariants], ["sizeForms", p.sizeForms], ["cosmeticForms", p.cosmeticForms]]) {
    for (const f of forms ?? []) {
      if (f.standard) continue;
      const key = `${p.id}(${f.label})`;
      if (!manifestHas(key)) warn(`sprite: ${field} "${p.id} / ${f.label}" 없음 (매니페스트 키 "${norm(key)}")`);
    }
  }
  if (p.genderedSprite) {
    for (const g of ["수컷", "암컷"])
      if (!manifestHas(`${p.id}(${g})`))
        warn(`sprite: 성별 스프라이트 "${p.id}(${g})" 없음`);
  }
}

for (const it of ITEMS) {
  if (allowI.has(it.id)) continue;
  if (!manifestHas(it.id)) warn(`sprite: 도구 "${it.id}" 아이콘 없음 (매니페스트 키 "${norm(it.id)}")`);
}

// 매니페스트에는 있는데 public/sprites 에서 사라진 파일(스테일 매니페스트) 감지
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const full = join(dir, n);
  return statSync(full).isDirectory() ? walk(full) : [full.split(/[\\/]/).join("/")];
});
const diskUrls = new Set(walk(spritesDir).map((f) => "/" + f.slice(f.indexOf("public/sprites/") + "public/".length)));
for (const [key, url] of Object.entries(MANIFEST))
  if (!diskUrls.has(url)) err(`spriteManifest.json: "${key}" → ${url} 파일이 디스크에 없음 (npm run sprites 필요)`);

// ── 결과 ─────────────────────────────────────────────────────────────────────
const line = (s) => console.log(s);
if (warnings.length) {
  line(`\n⚠ 경고 ${warnings.length}건`);
  for (const w of warnings) line(`  - ${w}`);
}
if (errors.length) {
  line(`\n✖ 오류 ${errors.length}건`);
  for (const e of errors) line(`  - ${e}`);
}
if (!errors.length && !warnings.length) line("✓ 데이터 정합성 이상 없음");

const failed = errors.length > 0 || (strict && warnings.length > 0);
line(
  `\n${failed ? "FAIL" : "OK"} — 오류 ${errors.length} · 경고 ${warnings.length}` +
  `${strict ? " (strict)" : ""}`,
);
process.exit(failed ? 1 : 0);
