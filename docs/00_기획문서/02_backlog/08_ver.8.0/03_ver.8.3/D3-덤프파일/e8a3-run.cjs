// E8-a ③ 실행 대조 — 매직미러가 울부짖기·날려버리기·뒤집어엎기를 반사하는가 (Showdown 965a535 champions)
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const F = 'gen9championsbssregmc';
const set = (sp, ab, item = '', moves = ['Splash']) =>
	`${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${moves.map(m => '- ' + m).join('\n')}`;
function run(label, p1, p2, c1, c2, prep) {
	const b = new Battle({formatid: F, seed: [1, 2, 3, 4]});
	b.setPlayer('p1', {name: 'p1', team: Teams.import(p1.join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import(p2.join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	if (prep) prep(b);
	const n = b.log.length;
	b.makeChoices(c1, c2);
	const RE = /^\|(move|drag|switch|-ability|-activate|-fail|-immune|-boost|-unboost|-invertboost)\|/;
	console.log(`[${label}]\n   ` + b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1)).join(' / '));
}
const BENCH = set('Snorlax', 'Thick Fat');
const ESP = set('Espeon', 'Magic Bounce');
const PLAIN = set('Espeon', 'Synchronize');
for (const [mv, user] of [['Whirlwind', 'Hippowdon'], ['Roar', 'Hippowdon']]) {
	run(`${mv} vs 매직미러`, [set(user, 'Sand Stream', '', [mv]), BENCH], [ESP, BENCH], 'move 1', 'move 1');
	run(`${mv} vs 일반(대조)`, [set(user, 'Sand Stream', '', [mv]), BENCH], [PLAIN, BENCH], 'move 1', 'move 1');
}
run('Topsy-Turvy vs 매직미러(상대 랭크 +2)', [set('Hippowdon', 'Sand Stream', '', ['Topsy-Turvy']), BENCH], [ESP, BENCH], 'move 1', 'move 1', (b) => { b.p2.active[0].boosts.atk = 2; b.p1.active[0].boosts.def = -1; });
run('Topsy-Turvy vs 일반(대조)', [set('Hippowdon', 'Sand Stream', '', ['Topsy-Turvy']), BENCH], [PLAIN, BENCH], 'move 1', 'move 1', (b) => { b.p2.active[0].boosts.atk = 2; b.p1.active[0].boosts.def = -1; });
