// 사용: node unused-exports.cjs (저장소 루트에서) — 파일 밖에서 이름이 한 번도 안 쓰이는 export 목록. 읽기 전용
const fs=require("fs"),cp=require("child_process");
const files=cp.execSync("git ls-files src scripts",{encoding:"utf8"}).split("\n").filter(f=>/\.(ts|tsx|mjs)$/.test(f)&&!f.startsWith("src/data/"));
const text={};for(const f of files)text[f]=fs.readFileSync(f,"utf8");
const out=[];
for(const f of files){ if(!f.startsWith("src/"))continue;
  const names=[...text[f].matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+(\w+)/gm)].map(m=>m[1]);
  for(const name of names){
    const re=new RegExp("(?<![A-Za-z0-9_$])"+name+"(?![A-Za-z0-9_$])");
    let used=false; for(const g of files){ if(g!==f && re.test(text[g])){used=true;break} }
    if(!used) out.push(f+" :: "+name);
  }}
console.log(out.length+"개"); out.slice(0,60).forEach(x=>console.log(" ",x));
