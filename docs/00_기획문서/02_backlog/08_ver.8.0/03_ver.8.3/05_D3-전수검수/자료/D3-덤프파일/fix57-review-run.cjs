// fix-57 검수 보조 — 하양허브 명중·회피 복원, 오기·승기 로그 순서·상한 문구. 사용: node fix57-review-run.cjs <showdown 빌드 폴더>
const {Battle} = require(process.argv[2] + '/dist/sim/battle');
const {Teams} = require(process.argv[2] + '/dist/sim');
const mon = (species, ability, item, moves) => ({species, ability, item, moves: [...new Set([...moves, 'splash'])], evs: {hp: 252}, level: 50});
function run(label, p1, p2, turns) {
  const b = new Battle({formatid: 'gen9customgame', seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {team: Teams.pack([p1])}); b.setPlayer('p2', {team: Teams.pack([p2])});
  for (const [m1, m2] of turns) { b.choose('p1', 'move ' + m1); b.choose('p2', 'move ' + m2); }
  console.log('== ' + label);
  console.log(b.log.filter(l => /^\|(-boost|-unboost|-ability|-enditem|-clearnegativeboost|move|turn)\|/.test(l)).join('\n'));
  const p = b.p2.active[0]; console.log('p2 boosts', JSON.stringify(p.boosts), 'item', p.item || '(소모)');
}
const herb = m => mon('Blissey', 'Natural Cure', 'whiteherb', m);
run('W1 하양허브 + 진흙뿌리기(명중 -1)', mon('Mew', 'Synchronize', '', ['mudslap']), herb(['splash']), [['mudslap', 'splash']]);
run('W2 하양허브 + 달콤한향기(회피 -2)', mon('Mew', 'Synchronize', '', ['sweetscent']), herb(['splash']), [['sweetscent', 'splash']]);
run('W3 칼춤 +2 뒤 진흙뿌리기(+ 유지)', mon('Mew', 'Synchronize', '', ['mudslap']), herb(['swordsdance']), [['splash', 'swordsdance'], ['mudslap', 'splash']]);
run('W4 오기+하양허브 + 진흙뿌리기', mon('Mew', 'Synchronize', '', ['mudslap']), mon('Bisharp', 'Defiant', 'whiteherb', ['splash']), [['mudslap', 'splash']]);
run('W5 하양허브 + 시럽봄(턴 끝 스피드 하락 → 같은 턴 끝 복원?)', mon('Dipplin', 'Supersweet Syrup', '', ['syrupbomb']), herb(['splash']), [['syrupbomb', 'splash'], ['splash', 'splash']]);
run('D1 오기 + 간지르기(줄 순서)', mon('Mew', 'Synchronize', '', ['tickle']), mon('Bisharp', 'Defiant', '', ['splash']), [['tickle', 'splash']]);
run('D2 오기 +6 상태에서 진흙뿌리기(boost0 줄)', mon('Mew', 'Synchronize', '', ['mudslap']), mon('Bisharp', 'Defiant', '', ['bellydrum']), [['splash', 'bellydrum'], ['mudslap', 'splash']]);
run('D3 오기 +5 상태(boost1 줄)', mon('Mew', 'Synchronize', '', ['mudslap']), mon('Bisharp', 'Defiant', '', ['swordsdance', 'howl']), [['splash', 'swordsdance'], ['splash', 'swordsdance'], ['splash', 'howl'], ['mudslap', 'splash']]);
