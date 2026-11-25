const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, item = '', moves = ['Splash']) => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${moves.map(m => '- ' + m).join('\n')}`;
const BENCH = set('Snorlax', 'Thick Fat');
function run(label, p1, p2, c1 = 'move 1', c2 = 'move 1', prep) {
	const b = new Battle({formatid: 'gen9championsbssregmc', seed: [1, 2, 3, 4]});
	b.setPlayer('p1', {name: 'p1', team: Teams.import([p1, BENCH].join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import([p2, BENCH].join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	if (prep) prep(b);
	const d = b.p2.active[0], n = b.log.length;
	b.makeChoices(c1, c2);
	const RE = /^\|(move|-ability|-activate|-fail|-immune|-boost|-start|-weather|-fieldstart|-block)\|/;
	console.log(`[${label}]\n   ` + b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1)).join(' / ') + `\n   => p2 atk=${d.boosts.atk} vol=[${Object.keys(d.volatiles).join(',')}] weather=${b.field.weather || '-'} terrain=${b.field.terrain || '-'}`);
}
const HIP = (m) => set('Hippowdon', 'Sand Stream', '', m);
run('쾌청 vs 타오르는불꽃', HIP(['Sunny Day']), set('Arcanine', 'Flash Fire'));
run('일렉트릭필드 vs 축전', HIP(['Electric Terrain']), set('Jolteon', 'Volt Absorb'));
run('그래스필드 vs 초식', HIP(['Grassy Terrain']), set('Farigiraf', 'Sap Sipper'));
run('씨뿌리기 vs 대타', HIP(['Leech Seed']), set('Snorlax', 'Thick Fat'), 'move 1', 'move 1', (b) => b.p2.active[0].addVolatile('substitute'));
run('씨뿌리기 vs 황금몸', HIP(['Leech Seed']), set('Gholdengo', 'Good as Gold'));
run('씨뿌리기 vs 방어', HIP(['Leech Seed']), set('Snorlax', 'Thick Fat', '', ['Protect']));
run('씨뿌리기 vs 초식', HIP(['Leech Seed']), set('Farigiraf', 'Sap Sipper'));
run('씨뿌리기 대조', HIP(['Leech Seed']), set('Snorlax', 'Thick Fat'));
run('저주(고스트) vs 황금몸', set('Gengar', 'Cursed Body', '', ['Curse']), set('Gholdengo', 'Good as Gold'));
run('저주(고스트) vs 대조', set('Gengar', 'Cursed Body', '', ['Curse']), set('Snorlax', 'Thick Fat'));
