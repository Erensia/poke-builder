// fix-50 검수 보조 — 면제 79종 영문→한글(PokeAPI data/v2/csv move_names.csv, local_language_id=3). 경로는 이 검수 환경 기준이라 실행 시 C·require 경로를 바꾼다.
const fs = require('fs'); const C = '/home/claude/pokeapi/data/v2/csv/';
const {Dex} = require('/home/claude/ps/dist/sim'); const d = Dex.forFormat(Dex.formats.get('gen9championsbssregmc'));
const id2ident = {}; for (const l of fs.readFileSync(C + 'moves.csv', 'utf8').split('\n').slice(1)) { const [id, ident] = l.split(','); if (ident) id2ident[id] = ident.replace(/-/g, ''); }
const ko = {}; for (const l of fs.readFileSync(C + 'move_names.csv', 'utf8').split('\n').slice(1)) { const [id, lang, name] = l.split(','); if (lang === '3') ko[id2ident[id]] = name; }
const src = fs.readFileSync('/home/claude/fix50-review-run.cjs', 'utf8'); const A = eval(src.match(/new Set\((\[[\s\S]*?\])\)/)[1]);
const groups = {};
for (const n of A) { const m = d.moves.get(n); (groups[m.target] ||= []).push(`${ko[m.id] ?? '??'}(${n})`); }
for (const [t, l] of Object.entries(groups)) console.log(`${t} ${l.length}: ${l.join(', ')}`);
console.log('미매핑:', A.filter(n => !ko[d.moves.get(n).id]));
console.log('mustpressure:', ['Imprison','Spikes','Stealth Rock','Toxic Spikes'].map(n => ko[d.moves.get(n).id]).join(', '), '/ 저주:', ko.curse, '/ 엔진에 없는 5종:', ['Power Shift','Shift Gear','Soft-Boiled','Spore','Struggle'].map(n=>ko[d.moves.get(n).id]).join(', '));
