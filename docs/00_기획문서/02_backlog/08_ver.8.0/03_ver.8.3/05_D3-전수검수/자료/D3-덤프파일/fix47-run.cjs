// fix-47 — 상대 방향 변화기 × 차단(방어·황금몸·대타·초식) Showdown 로그 확인
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, item = '', moves = ['Splash']) => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${moves.map(m => '- ' + m).join('\n')}`;
const BENCH = set('Snorlax', 'Thick Fat');
function run(label, p1, p2, prep) {
	const b = new Battle({formatid: 'gen9championsbssregmc', seed: [1, 2, 3, 4]});
	b.setPlayer('p1', {name: 'p1', team: Teams.import([p1, BENCH].join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import([p2, BENCH].join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	if (prep) prep(b);
	const n = b.log.length;
	b.makeChoices('move 1', 'move 1');
	console.log(`[${label}] ` + b.log.slice(n).filter(l => /^\|(move|-activate|-immune|-fail|-start|-item|-transform|-ability|-endability|-boost|-unboost)\|/.test(l) && !/Splash|Protect\|p2a/.test(l)).map(l => l.slice(1)).join(' / ').slice(0, 220));
}
const U = (m, item = '') => set('Hippowdon', 'Sand Stream', item, [m]);
const SNORP = set('Snorlax', 'Thick Fat', '', ['Protect']);
run('트릭 vs 방어', U('Trick', 'Leftovers'), SNORP);
run('앙코르 vs 방어', U('Encore'), SNORP);
run('변신 vs 방어(protect 없음)', U('Transform'), SNORP);
run('저주(고스트) vs 방어(protect 없음)', set('Gengar', 'Cursed Body', '', ['Curse']), SNORP);
run('역할 vs 방어(protect 없음)', U('Role Play'), set('Snorlax', 'Thick Fat', '', ['Protect']));
run('스킬스왑 vs 방어', U('Skill Swap'), SNORP);
run('트릭 vs 황금몸', U('Trick', 'Leftovers'), set('Gholdengo', 'Good as Gold'));
run('앙코르 vs 황금몸', U('Encore'), set('Gholdengo', 'Good as Gold'));
run('역할 vs 황금몸', U('Role Play'), set('Gholdengo', 'Good as Gold'));
run('트릭 vs 대타', U('Trick', 'Leftovers'), set('Snorlax', 'Thick Fat'), (b) => b.p2.active[0].addVolatile('substitute'));
run('앙코르 vs 대타(bypass)', U('Encore'), set('Snorlax', 'Thick Fat'), (b) => b.p2.active[0].addVolatile('substitute'));
