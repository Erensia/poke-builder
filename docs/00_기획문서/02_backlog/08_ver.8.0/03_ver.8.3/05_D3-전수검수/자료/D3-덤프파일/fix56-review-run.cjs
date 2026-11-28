// fix-56 검수: Showdown 965a535 — 교체 직후 설치물로 쓰러진 상대에게 뒤 행동(대상 없음 판정)
// node fix56-review-run.cjs [formatid]   (pokemon-showdown 965a535을 /home/claude/ps 에 빌드)
const {Battle} = require('/home/claude/ps/dist/sim/battle.js');
const FMT = process.argv[2] || 'gen9customgame';
const P = (species, moves, x = {}) => ({name: x.name || species, species, moves, ability: x.ability || 'noability', item: x.item || '', evs: {hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84}, level: 50, ...x});
const lax = (n, moves = ['tackle'], x = {}) => P('Snorlax', moves, {name: n, ...x});
const low = b => { b.p1.addSideCondition('stealthrock', b.p2.active[0]); b.p1.pokemon[1].hp = 1; };
const st = x => x ? `${x.side.id}:${x.name} ${x.hp}/${x.maxhp}${x.fainted ? ' FNT' : ''} vol=[${Object.keys(x.volatiles)}] boosts=${JSON.stringify(Object.fromEntries(Object.entries(x.boosts).filter(([, v]) => v)))}` : '-';
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
  for (const l of b.log.slice(start)) if (!/^\|(t:|split|upkeep|)\|/.test(l) && l !== '|' && !l.startsWith('|request') && !l.startsWith('|-hint')) console.log('  ' + l);
  console.log('  >> ' + st(b.p1.active[0]) + ' | ' + st(b.p2.active[0]) + ` | p1 slot0=[${Object.keys(b.p1.slotConditions[0])}] winner=${b.winner ?? '-'} ended=${b.ended} req=${b.p1.requestState}/${b.p2.requestState}`);
  return b;
}
const std = (p2, extra = []) => ({p2, steps: [low, 'mark', ['switch 2', 'move 1'], ...extra]});
console.log('# format', FMT);
// a. 저주(고스트/비고스트)
run('a1 curse by ghost (Gengar)', std([P('Gengar', ['curse'])], [['switch 3', '']]));
run('a2 curse by non-ghost (Mew)', std([P('Mew', ['curse'])], [['switch 3', '']]));
run('a3 curse by ghost after terastal-free type change? (Trevenant Ghost/Grass)', std([P('Trevenant', ['curse'])], [['switch 3', '']]));
// b. 록온·마인드리더
for (const mv of ['lockon', 'mindreader']) run('b ' + mv, std([P('Mew', [mv, 'zapcannon'])], [['switch 3', '']]));
// c. 문어굳히기
run('c octolock', std([P('Mew', ['octolock'])], [['switch 3', '']]));
// d. 미래예지·파괴예지 — 빈 자리에 예약 → 2턴 뒤 대체가 맞는가
for (const mv of ['futuresight', 'doomdesire'])
  run('d ' + mv + ' (cast T, +2턴 끝 착탄)', {p2: [P('Mew', [mv, 'splash'])], steps: [low, 'mark', ['switch 2', 'move 1'], b => console.log('  [after cast] p1 slot0 =', Object.keys(b.p1.slotConditions[0]), 'source', b.p1.slotConditions[0].futuremove?.source?.name), ['switch 3', ''], ['move 1', 'move 2'], ['move 1', 'move 2']]});
// d'. 예약 뒤 사용자(p2)가 교체해도 착탄하는가(sourceIndex 유효성 참고)
run("d' futuresight, user switches out before landing", {p2: [P('Mew', ['futuresight', 'splash']), P('Mew', ['splash'], {name: 'Mew2'})], steps: [low, 'mark', ['switch 2', 'move 1'], ['switch 3', ''], ['move 1', 'switch 2'], ['move 1', 'move 1']]});
// e. 대폭발류 — 사용자 기절, 마지막 1마리면 승패
for (const mv of ['explosion', 'selfdestruct', 'mistyexplosion']) {
  run('e ' + mv + ' (p2 예비 있음)', std([P('Mew', [mv]), P('Mew', ['splash'], {name: 'Mew2'})], [['switch 3', 'switch 2']]));
  run('e ' + mv + ' (p2 마지막 1마리)', std([P('Mew', [mv])]));
}
// 참고: 다른 "대상 없음" 경로
for (const mv of ['swordsdance', 'tackle', 'steelbeam', 'mindblown', 'solarbeam', 'meteorbeam', 'electroshot', 'fly', 'dig', 'phantomforce', 'skyattack', 'pollenpuff', 'perishsong', 'haze', 'stealthrock'])
  run('ref ' + mv, std([P('Mew', [mv])], [['switch 3', '']]));
