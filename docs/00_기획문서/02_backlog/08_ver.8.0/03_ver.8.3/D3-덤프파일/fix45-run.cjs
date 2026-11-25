// fix-45(E8-13) 실행 대조 — 매직미러 반사 × 대타 (Showdown 965a535 champions)
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
	const RE = /^\|(move|drag|switch|-ability|-activate|-fail|-immune|-boost|-unboost|-invertboost|-status|-start|-end|-damage|-block)\|/;
	const a = b.p1.active[0], d = b.p2.active[0];
	console.log(`[${label}]\n   ` + b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1)).join(' / ') +
		`\n   => p1 ${a.species.name} status=${a.status || '-'} sub=${a.volatiles.substitute ? 'Y' : 'N'} boosts=${JSON.stringify(a.boosts)} | p2 ${d.species.name} status=${d.status || '-'} sub=${d.volatiles.substitute ? 'Y' : 'N'}`);
}
const BENCH = set('Snorlax', 'Thick Fat');
const ESP = set('Espeon', 'Magic Bounce');
const sub = (side) => (b) => { (side === 1 ? b.p1 : b.p2).active[0].addVolatile('substitute'); };
const both = (b) => { b.p1.active[0].addVolatile('substitute'); b.p2.active[0].addVolatile('substitute'); };
for (const mv of ['Poison Powder', 'Will-O-Wisp', 'Topsy-Turvy', 'Whirlwind', 'Roar', 'Stealth Rock', 'Growl']) {
	const user = set('Hippowdon', 'Sand Stream', '', [mv]);
	const prep = mv === 'Topsy-Turvy' ? (b) => { b.p1.active[0].addVolatile('substitute'); b.p1.active[0].boosts.def = -1; } : sub(1);
	run(`${mv}: 사용자 대타 O vs 매직미러`, [user, BENCH], [ESP, BENCH], 'move 1', 'move 1', prep);
	run(`${mv}: 사용자 대타 X vs 매직미러(대조)`, [user, BENCH], [ESP, BENCH], 'move 1', 'move 1', mv === 'Topsy-Turvy' ? (b) => { b.p1.active[0].boosts.def = -1; } : null);
}
// 반사한 쪽(매직미러 보유자)에게 대타가 있는 경우 — 반사가 먼저인가
for (const mv of ['Poison Powder', 'Will-O-Wisp']) {
	run(`${mv}: 매직미러 쪽 대타 O, 사용자 대타 X`, [set('Hippowdon', 'Sand Stream', '', [mv]), BENCH], [ESP, BENCH], 'move 1', 'move 1', sub(2));
	run(`${mv}: 양쪽 대타 O`, [set('Hippowdon', 'Sand Stream', '', [mv]), BENCH], [ESP, BENCH], 'move 1', 'move 1', both);
}
// 틈새포착 사용자(Infiltrator): 반사된 기술은 매직미러 보유자가 쓰는 것이라 사용자의 틈새포착과 무관
run('Poison Powder: 사용자 틈새포착+대타 vs 매직미러', [set('Hippowdon', 'Infiltrator', '', ['Poison Powder']), BENCH], [ESP, BENCH], 'move 1', 'move 1', sub(1));
