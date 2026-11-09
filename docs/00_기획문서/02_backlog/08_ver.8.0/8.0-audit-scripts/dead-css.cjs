// 사용: node dead-css.cjs — CSS의 클래스 선택자 중 ts/tsx 어디에도 이름이 없는 것(동적 조합 클래스는 오탐 가능)
const fs = require("fs"), cp = require("child_process");
const all = cp.execSync("git ls-files src", { encoding: "utf8" }).split("\n");
const css = all.filter((f) => f.endsWith(".css"));
const code = all.filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("src/data/"));
const blob = code.map((f) => fs.readFileSync(f, "utf8")).join("\n");
const res = [];
let total = 0;
for (const f of css) {
  const t = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const names = new Set([...t.matchAll(/[.]([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]));
  const dead = [];
  for (const n of names) {
    total++;
    // 동적 조합(`prefix-${x}`)은 접두사가 코드에 있으면 살아 있는 것으로 본다
    const parts = n.split("-");
    let alive = blob.includes(n);
    for (let k = parts.length - 1; !alive && k >= 1; k--) alive = blob.includes(parts.slice(0, k).join("-") + "-");
    if (!alive) dead.push(n);
  }
  if (dead.length) res.push(`${f.replace("src/", "")} (${dead.length}): ${dead.slice(0, 8).join(", ")}${dead.length > 8 ? " …" : ""}`);
}
console.log(`클래스 ${total}개 중 죽은 후보 파일 ${res.length}곳`);
res.forEach((r) => console.log(" ", r));
