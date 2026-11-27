// fix-50 검수 보조 — 연속 사용(난동·차지·구르기·반동·소란)과 틀깨기 × 프레셔 PP 실측. 사용법: node fix50-review-run2.cjs <showdown 빌드 폴더>
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const F = 'gen9championsbssregmc';
const set = (sp, ab, moves) => `${sp}\nAbility: ${ab}\nLevel: 50\n${moves.map(m => '- ' + m).join('\n')}`;
function run(user, ab, moves, turns, foeAb, foeMoves = ['Splash'], foeSp = 'Snorlax') {
  const b = new Battle({formatid: F, seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {name: 'p1', team: Teams.import(set(user, ab, moves))});
  b.setPlayer('p2', {name: 'p2', team: Teams.import(set(foeSp, foeAb, foeMoves))});
  if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
  const s = b.p1.active[0].moveSlots[0]; const p0 = s.pp; const per = [];
  for (let t = 0; t < turns; t++) { const before = s.pp; const req = b.p1.activeRequest; b.makeChoices(req?.active?.[0]?.moves?.length === 1 && req.active[0].trapped ? 'move 1' : 'move 1', 'move 1'); per.push(before - s.pp); }
  return per.join(',');
}
for (const [lab, u, mv, n] of [['역린(난동) 3턴', 'Dragonite', 'Outrage', 3], ['솔라빔 2턴', 'Venusaur', 'Solar Beam', 2], ['구르기 3턴', 'Snorlax', 'Rollout', 3], ['파괴광선+반동', 'Snorlax', 'Hyper Beam', 2], ['소란 3턴', 'Snorlax', 'Uproar', 3]])
  for (const fa of ['Pressure', 'Thick Fat']) console.log(`[${lab} vs ${fa}] 턴별 PP 감소 ${run(u, 'Inner Focus', [mv], n, fa)}`);
console.log(`[틀깨기 공격자 박치기 vs 프레셔] ${run('Excadrill', 'Mold Breaker', ['Tackle'], 1, 'Pressure')}`);
console.log(`[테라볼트(틀깨기류) 박치기 vs 프레셔] ${run('Zekrom', 'Teravolt', ['Tackle'], 1, 'Pressure')}`);
console.log(`[틀깨기 칼춤 vs 프레셔] ${run('Excadrill', 'Mold Breaker', ['Swords Dance'], 1, 'Pressure')}`);
