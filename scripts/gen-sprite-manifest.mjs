// public/sprites/ 를 스캔해서 src/data/spriteManifest.json 을 만든다.
// 키 = 파일명(확장자 제외)에서 공백을 모두 제거한 것, 값 = 사이트 루트 기준 URL(/sprites/...).
// 공백 제거 정규화 이유: pokemon.json 의 폼 라벨(예: "한낮의모습")과 파일명("한낮의 모습")이
// 공백만 다른 경우가 있어, 양쪽을 같은 방식으로 정규화해서 매칭한다.
// 스프라이트를 추가/이름변경/삭제하면 `npm run sprites` 로 다시 생성한다.
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const spritesDir = join(root, "public", "sprites");
const outFile = join(root, "src", "data", "spriteManifest.json");

/** 공백 제거 — 매칭 키 정규화. */
const norm = (s) => s.replace(/\s+/g, "");

/** 디렉터리를 재귀 순회하며 이미지 파일 경로를 모은다. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(webp|png|jpg|jpeg|gif|avif)$/i.test(name)) out.push(full);
  }
  return out;
}

const files = walk(spritesDir).sort();
const manifest = {};
const collisions = [];

for (const full of files) {
  const rel = relative(join(root, "public"), full).split(/[\\/]/).join("/");
  const url = "/" + rel;
  const key = norm(basename(full, extname(full)));
  if (manifest[key] && manifest[key] !== url) collisions.push([key, manifest[key], url]);
  manifest[key] = url;
}

// 키를 정렬해 diff 를 안정적으로 유지한다.
const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
writeFileSync(outFile, JSON.stringify(sorted, null, 2) + "\n", "utf8");

console.log(`sprite manifest: ${Object.keys(sorted).length} entries → ${relative(root, outFile)}`);
if (collisions.length) {
  console.warn(`⚠ ${collisions.length} key collision(s) (공백 제거 후 동일 키):`);
  for (const [k, a, b] of collisions) console.warn(`  ${k}: ${a}  vs  ${b}`);
}
