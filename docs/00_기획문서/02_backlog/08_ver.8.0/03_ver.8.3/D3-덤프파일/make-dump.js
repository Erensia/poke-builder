// Showdown 965a535 · gen9championsbssregmc 최종 값 덤프 (E0용)
const fs = require('fs');
const SD = '/home/claude/ref/sd';
const {Dex} = require(SD + '/dist/sim');
const d = Dex.forFormat('gen9championsbssregmc');

// 함수는 "<fn>"으로, 나머지는 값 그대로. 메타 필드 제거.
const DROP = new Set(['effectType', 'kind', 'exists', 'fullname', 'gen', 'sourceEffect']);
function ser(o) {
  if (typeof o === 'function') return '<fn>';
  if (Array.isArray(o)) return o.map(ser);
  if (o && typeof o === 'object') {
    const r = {};
    for (const k of Object.keys(o).sort()) if (!DROP.has(k) && o[k] !== undefined) r[k] = ser(o[k]);
    return r;
  }
  return o;
}
// champions mod 원본(.ts)에서 항목별로 덮은 키 목록
function overrides(file) {
  const src = fs.readFileSync(`${SD}/data/mods/champions/${file}`, 'utf8');
  const out = {};
  for (const [, id, body] of src.matchAll(/\n\t([a-z0-9]+): \{\n([\s\S]*?)\n\t\},/g))
    out[id] = [...body.matchAll(/^\t\t([a-zA-Z]+)[:(]/gm)].map(m => m[1]).filter(k => k !== 'inherit');
  return out;
}

const fd = require(SD + '/dist/data/mods/champions/formats-data.js').FormatsData;
const legalSpecies = d.species.all().filter(s => { const t = (fd[s.id] || {}).tier; return t && !['Illegal', 'Unreleased'].includes(t) && !s.isNonstandard; });
const ls = require(SD + '/dist/data/mods/champions/learnsets.js').Learnsets;
const learnable = new Set(); for (const k in ls) for (const m in (ls[k].learnset || {})) learnable.add(m);
const abilitySet = new Set(); for (const s of legalSpecies) for (const k in s.abilities) abilitySet.add(d.toID(s.abilities[k]));

const legal = {
  moves: d.moves.all().filter(m => !m.isNonstandard).map(m => m.id).sort(),
  abilities: [...abilitySet].sort(),
  items: d.items.all().filter(i => !i.isNonstandard).map(i => i.id).sort(),
  species: legalSpecies.map(s => s.id).sort(),
};
const ov = {moves: overrides('moves.ts'), abilities: overrides('abilities.ts'), items: overrides('items.ts')};
const calcPP = pp => Math.floor(pp / 5 + 1) * 4; // champions scripts.ts calculatePP (최대 PP)

const moves = {}, abilities = {}, items = {};
for (const id of legal.moves) { const m = d.moves.get(id); moves[id] = {...ser(m), maxPP: calcPP(m.pp), learnable: learnable.has(id), championsOverride: ov.moves[id] || null}; }
for (const id of legal.abilities) abilities[id] = {...ser(d.abilities.get(id)), championsOverride: ov.abilities[id] || null};
for (const id of legal.items) items[id] = {...ser(d.items.get(id)), championsOverride: ov.items[id] || null};

const dump = {
  meta: {
    source: 'smogon/pokemon-showdown', commit: require('child_process').execSync(`git -C ${SD} rev-parse HEAD`).toString().trim(),
    format: 'gen9championsbssregmc', mod: d.currentMod, generated: new Date().toISOString(),
    notes: [
      '값은 Dex.forFormat(format)의 최종 값(기본 9세대 + champions mod 상속 + scripts.ts init의 PP 상한 20 적용)',
      'pp = init 적용 기본 PP, maxPP = champions calculatePP 결과 (pp/5+1)*4',
      '함수 필드는 "<fn>" (핸들러 존재 여부만), 동작은 소스 확인 필요',
      'championsOverride = data/mods/champions/*.ts 에서 그 항목이 덮은 키 목록(inherit 제외). null이면 mod 파일에 없음',
      'legal.moves = isNonstandard 없음(struggle, 아무도 못 배우는 powershift 포함, learnable 필드로 구분)',
      'legal.abilities = 출전 가능 포켓몬(legal.species)의 특성 합집합',
      'conditions.ts 재정의(par 1/8, slp 1~2턴, frz 25%·최대2턴)는 데이터가 아니라 동작이라 이 덤프에 없음',
    ],
    counts: Object.fromEntries(Object.entries(legal).map(([k, v]) => [k, v.length])),
  },
  legal, moves, abilities, items,
};
const out = process.argv[2] || 'showdown-champions-dump.json';
fs.writeFileSync(out, JSON.stringify(dump, null, 1));
console.log(out, dump.meta.counts, (fs.statSync(out).size / 1024 | 0) + 'KB');

// 자체 점검
const a = (c, m) => { if (!c) throw new Error('CHECK FAIL: ' + m); };
a(legal.moves.length === 515 && legal.abilities.length === 216 && legal.items.length === 166, 'counts');
a(moves.protect.pp === 5 && moves.protect.maxPP === 8, 'protect pp');
a(moves.batonpass.pp === 20, 'init cap');
a(moves.freezedry.secondary == null, 'freezedry');
a(moves.skyattack.flags.contact === undefined && moves.seismictoss.flags.contact === 1, 'F9');
a(Object.values(moves).filter(m => m.flags.reflectable).length === 60, 'reflectable');
a(items.ejectbutton.championsOverride.includes('onAfterMoveSecondary'), 'override');
console.log('self-check OK');
