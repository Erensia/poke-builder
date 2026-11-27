// fix-52 검수: Showdown 965a535 실행 대조 (gen9customgame, 싱글)
const {Battle} = require(process.argv[2] + '/dist/sim/battle.js');
const S = (species, moves, ability, item = '') => ({species, moves, ability, item, evs: {hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0}, ivs: {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31}, level: 50, nature: 'Hardy'});
function run(name, p1, p2, turns, pre) {
  const b = new Battle({formatid: 'gen9customgame', seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {team: [p1]}); b.setPlayer('p2', {team: [p2]});
  if (b.requestState === 'teampreview') { b.choose('p1', 'team 1'); b.choose('p2', 'team 1'); }
  pre?.(b);
  const out = [];
  for (const [c1, c2] of turns) { b.choose('p1', c1); b.choose('p2', c2);
    const q = b.p2.pokemon[0], r = b.p1.pokemon[0];
    out.push(`p2${JSON.stringify(Object.fromEntries(Object.entries(q.boosts).filter(([, v]) => v)))} hp${q.hp} | p1${JSON.stringify(Object.fromEntries(Object.entries(r.boosts).filter(([, v]) => v)))}`); }
  const abil = b.log.filter(l => /-ability\|.*(Defiant|Competitive)/.test(l)).length;
  console.log(name.padEnd(34), out.join(' / '), `| 발동줄 ${abil}`);
}
const K = (moves, ab = 'Defiant', item) => S('Kingambit', moves, ab, item);
const mv = m => `move ${m}`;
run('A 간지르기→오기', S('Blissey', ['tickle'], 'Natural Cure'), K(['splash']), [[mv('tickle'), mv('splash')]]);
run('B 자기 엄청난힘', S('Blissey', ['splash'], 'Natural Cure'), K(['superpower']), [[mv('splash'), mv('superpower')]]);
run('C 진흙뿌리기→오기', S('Blissey', ['mudslap'], 'Natural Cure'), K(['splash']), [[mv('mudslap'), mv('splash')]]);
run('D1 더블어택→미끈미끈(2히트)', S('Goodra', ['splash'], 'Gooey'), K(['doublehit']), [[mv('splash'), mv('doublehit')]]);
run('D2 스위프뺨치기→미끈미끈', S('Goodra', ['splash'], 'Gooey'), K(['tailslap']), [[mv('splash'), mv('tailslap')]]);
run('D3 승기 더블어택→미끈미끈', S('Goodra', ['splash'], 'Gooey'), S('Milotic', ['doublehit'], 'Competitive'), [[mv('splash'), mv('doublehit')]]);
run('E 하양허브+얼어붙은바람', S('Blissey', ['icywind'], 'Natural Cure'), K(['splash'], 'Defiant', 'White Herb'), [[mv('icywind'), mv('splash')]]);
run('E2 하양허브+간지르기', S('Blissey', ['tickle'], 'Natural Cure'), K(['splash'], 'Defiant', 'White Herb'), [[mv('tickle'), mv('splash')]]);
run('F 편승 상대가 얼어붙은바람', S('Espathra', ['icywind'], 'Opportunist'), K(['splash']), [[mv('icywind'), mv('splash')]]);
run('F2 편승 상대가 진흙뿌리기', S('Espathra', ['mudslap'], 'Opportunist'), K(['splash']), [[mv('mudslap'), mv('splash')]]);
run('G 칼춤 후 뒤집어엎기', S('Blissey', ['splash', 'topsyturvy'], 'Natural Cure'), K(['swordsdance', 'splash']), [[mv('splash'), mv('swordsdance')], [mv('topsyturvy'), mv('splash')]]);
run('H 문어굳히기 3턴', S('Grapploct', ['octolock', 'splash'], 'Limber'), K(['splash']), [[mv('octolock'), mv('splash')], [mv('splash'), mv('splash')], [mv('splash'), mv('splash')]]);
run('I 시럽봄 2턴', S('Dipplin', ['syrupbomb', 'splash'], 'Gluttony'), K(['splash']), [[mv('syrupbomb'), mv('splash')], [mv('splash'), mv('splash')]]);
run('J 기절 보유자(HP1)+얼어붙은바람', S('Blissey', ['icywind'], 'Natural Cure'), K(['splash']), [[mv('icywind'), mv('splash')]], b => { b.p2.pokemon[0].sethp(1); });
run('K 미끈미끈 + 자기 엄청난힘', S('Goodra', ['splash'], 'Gooey'), K(['superpower']), [[mv('splash'), mv('superpower')]]);
run('L 하양허브 보유자 미끈미끈', S('Goodra', ['splash'], 'Gooey'), K(['tackle'], 'Defiant', 'White Herb'), [[mv('splash'), mv('tackle')]]);
