// Showdown(sim·data·lib·config)을 `npm ci` 없이 이 프로젝트의 typescript로 변환해 `dist/`를 만든다 — 검수 `[실행]` 대조용(8.3 D3).
// 사용: node showdown-build.cjs <Showdown 원본 폴더> <출력 폴더> <typescript.js 경로>
//   예) node showdown-build.cjs ~/showdown-ref ~/sd-build <프로젝트>/node_modules/typescript/lib/typescript.js
// 그다음 실행 스크립트에 출력 폴더를 넘긴다: node fix-34-run.js <출력 폴더>  (스크립트는 <출력 폴더>/dist/sim을 require한다)
// - 원본(~/showdown-ref)은 읽기만 한다(사본을 출력 폴더에 만든다). 약 15초(390개 .ts 변환).
// - 원래 빌드(`node build`)는 esbuild·`npm ci`가 필요한데 이 환경은 npm install이 막혀 있어 TypeScript `transpileModule`로 대신한다(타입 검사 없음).
// - 런타임 의존성 중 `ts-chacha20`(sodium 시드 전용)만 없으므로 호출되면 실패하는 스텁을 둔다 — 숫자 시드(Gen5RNG)를 쓰는 검증만 가능하다.
const fs = require("fs"), path = require("path");
const [src, out, tsPath] = process.argv.slice(2).map((p) => path.resolve(p.replace(/^~/, require("os").homedir())));
if (!src || !out || !tsPath) { console.error("사용: node showdown-build.cjs <Showdown 원본> <출력 폴더> <typescript.js>"); process.exit(1); }
const ts = require(tsPath);
const opts = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, useDefineForClassFields: false, jsx: ts.JsxEmit.React, sourceMap: false };
const DIRS = ["sim", "data", "lib", "config"];
for (const d of DIRS) fs.cpSync(path.join(src, d), path.join(out, d), { recursive: true });
let n = 0, json = 0;
const walk = (rel) => {
  for (const e of fs.readdirSync(path.join(out, rel), { withFileTypes: true })) {
    const r = `${rel}/${e.name}`, file = path.join(out, r), dist = path.join(out, "dist", r);
    if (e.isDirectory()) { walk(r); continue; }
    if (/\.tsx?$/.test(r) && !/\.d\.ts$/.test(r)) {
      fs.mkdirSync(path.dirname(dist), { recursive: true });
      fs.writeFileSync(dist.replace(/\.tsx?$/, ".js"), ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: opts, fileName: file }).outputText); n++;
    } else if (/\.json$/.test(r)) { fs.mkdirSync(path.dirname(dist), { recursive: true }); fs.copyFileSync(file, dist); json++; }
  }
};
for (const d of DIRS) walk(d);
fs.copyFileSync(path.join(out, "config/config-example.js"), path.join(out, "dist/config/config-example.js"));
fs.copyFileSync(path.join(out, "config/config-example.js"), path.join(out, "dist/config/config.js"));
fs.mkdirSync(path.join(out, "node_modules/ts-chacha20"), { recursive: true });
fs.writeFileSync(path.join(out, "node_modules/ts-chacha20/index.js"), 'exports.Chacha20 = class { constructor() { throw new Error("ts-chacha20 스텁: sodium 시드는 지원하지 않음"); } };\n');
console.log(`변환 ${n}개, JSON ${json}개 → ${out}/dist`);
