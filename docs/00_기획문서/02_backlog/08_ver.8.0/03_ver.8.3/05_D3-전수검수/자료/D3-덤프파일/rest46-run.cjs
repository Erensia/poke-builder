const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, moves) => `${sp}\nAbility: ${ab}\n${moves.map(m => '- ' + m).join('\n')}`;
function run(label, userSet, foeSet, prep, c1 = 'move 1') {
	const b = new Battle({formatid: 'gen9championsbssregmc', seed: [1, 2, 3, 4]});
	b.setPlayer('p1', {name: 'p1', team: Teams.import([userSet, set('Snorlax', 'Thick Fat', ['Splash'])].join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import([foeSet, set('Snorlax', 'Thick Fat', ['Splash'])].join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	if (prep) prep(b);
	const u = b.p1.active[0], n = b.log.length;
	b.makeChoices(c1, 'move 1');
	console.log(`[${label}] hp=${u.hp}/${u.maxhp} st=${u.status || '-'} | ` + b.log.slice(n).filter(l => /^\|(move|-fail|-status|-heal|-activate|-immune|cant)\|/.test(l)).map(l => l.slice(1)).join(' / '));
}
const SNOR = (m) => set('Snorlax', 'Thick Fat', m);
run('잠자기 HP 절반(대조)', SNOR(['Rest']), SNOR(['Splash']), (b) => { b.p1.active[0].hp = 100; });
run('잠자기 풀피', SNOR(['Rest']), SNOR(['Splash']));
run('잠자기 일렉트릭필드(접지)', SNOR(['Rest']), SNOR(['Splash']), (b) => { b.p1.active[0].hp = 100; b.field.setTerrain('electricterrain', b.p2.active[0]); });
run('잠자기 상대 소란피기 중', SNOR(['Rest']), SNOR(['Uproar']), (b) => { b.p1.active[0].hp = 100; }, 'move 1');
