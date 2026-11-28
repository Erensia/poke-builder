// fix-56 검수 2: 차지 기술 후속 턴·습기·잠꼬대 호출·파워풀허브/비 일렉트로빔 (Showdown 965a535)
const {Battle} = require('/home/claude/ps/dist/sim/battle.js');
const FMT = process.argv[2] || 'gen9customgame';
const P = (species, moves, x = {}) => ({name: x.name || species, species, moves, ability: x.ability || 'noability', item: x.item || '', evs: {hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84}, level: 50, ...x});
const lax = (n, moves = ['tackle'], x = {}) => P('Snorlax', moves, {name: n, ...x});
const low = b => { b.p1.addSideCondition('stealthrock', b.p2.active[0]); b.p1.pokemon[1].hp = 1; };
const st = x => `${x.side.id}:${x.name} ${x.hp}/${x.maxhp}${x.fainted ? ' FNT' : ''} vol=[${Object.keys(x.volatiles)}] boosts=${JSON.stringify(Object.fromEntries(Object.entries(x.boosts).filter(([, v]) => v)))} item=${x.item || '-'}`;
function run(title, {p1, p2, steps}) {
  const b = new Battle({formatid: FMT, seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {team: p1 || [lax('A'), lax('Spare1'), lax('C')]}); b.setPlayer('p2', {team: p2});
  b.makeChoices('default', 'default');
  let start = b.log.length;
  for (const s of steps) {
    if (typeof s === 'function') { s(b); continue; }
    if (s === 'mark') { start = b.log.length; continue; }
    try { b.makeChoices(s[0], s[1]); } catch (e) { console.log('  !choice error', s, e.message); break; }
  }
  console.log('\n=== ' + title);
  let prev = '';
  for (const l of b.log.slice(start)) { if (/^\|(t:|split|upkeep|)\|/.test(l) || l === '|' || l.startsWith('|request') || l.startsWith('|-hint') || l === prev) continue; prev = l; console.log('  ' + l); }
  console.log('  >> ' + st(b.p1.active[0]) + ' | ' + st(b.p2.active[0]) + ` | winner=${b.winner ?? '-'}`);
}
for (const mv of ['solarbeam', 'meteorbeam', 'fly'])
  run('g ' + mv + ' 준비 → 다음 턴 대체에게', {p2: [P('Mew', [mv])], steps: [low, 'mark', ['switch 2', 'move 1'], ['switch 3', ''], ['move 1', 'move 1']]});
run('g meteorbeam + 파워풀허브', {p2: [P('Mew', ['meteorbeam'], {item: 'powerherb'})], steps: [low, 'mark', ['switch 2', 'move 1'], ['switch 3', '']]});
run('g electroshot 비', {p2: [P('Mew', ['electroshot'])], steps: [low, b => b.field.setWeather('raindance', b.p2.active[0]), 'mark', ['switch 2', 'move 1'], ['switch 3', '']]});
run('g solarbeam 쾌청', {p2: [P('Mew', ['solarbeam'])], steps: [low, b => b.field.setWeather('sunnyday', b.p2.active[0]), 'mark', ['switch 2', 'move 1'], ['switch 3', '']]});
run('e 습기(사용자 자신)', {p2: [P('Mew', ['explosion'], {ability: 'damp'}), P('Mew', ['splash'], {name: 'Mew2'})], steps: [low, 'mark', ['switch 2', 'move 1'], ['switch 3', '']]});
run('e 습기(쓰러진 대상)', {p1: [lax('A'), lax('Spare1', ['tackle'], {ability: 'damp'}), lax('C')], p2: [P('Mew', ['explosion']), P('Mew', ['splash'], {name: 'Mew2'})], steps: [low, 'mark', ['switch 2', 'move 1'], ['switch 3', 'switch 2']]});
for (const called of ['tackle', 'explosion'])
  run('잠꼬대 → ' + called, {p2: [P('Mew', ['sleeptalk', called]), P('Mew', ['splash'], {name: 'Mew2'})], steps: [low, b => { b.p2.active[0].setStatus('slp'); b.p2.active[0].statusState.time = 3; }, 'mark', ['switch 2', 'move 1'], ['switch 3', 'switch 2'], ['switch 3', '']]});
