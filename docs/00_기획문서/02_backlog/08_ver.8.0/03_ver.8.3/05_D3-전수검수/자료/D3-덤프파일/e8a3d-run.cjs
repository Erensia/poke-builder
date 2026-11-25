// 상태이상 전용 변화기가 면역(특성·타입·필드·신비의부적)에 막힐 때 Showdown 로그 — 엔진 로그 누락 확인용
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, item = '', moves = ['Splash']) => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${moves.map(m => '- ' + m).join('\n')}`;
const BENCH = set('Snorlax', 'Thick Fat');
function run(label, p1, p2, prep, c2 = 'move 1') {
	const b = new Battle({formatid: 'gen9championsbssregmc', seed: [1, 2, 3, 4]});
	b.setPlayer('p1', {name: 'p1', team: Teams.import([p1, BENCH].join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import([p2, BENCH].join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	if (prep) prep(b);
	const n = b.log.length;
	b.makeChoices('move 1', c2);
	const RE = /^\|(move|-immune|-fail|-activate|-block|-status|-miss)\|/;
	console.log(`[${label}] ` + b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1)).join(' / '));
}
const HIP = (m) => set('Hippowdon', 'Sand Stream', '', m);
run('도깨비불 vs 열교환(드닐레이브)', HIP(['Will-O-Wisp']), set('Baxcalibur', 'Thermal Exchange'));
run('도깨비불 vs 불꽃 타입(리자몽, 특성 무관)', HIP(['Will-O-Wisp']), set('Charizard', 'Blaze'));
run('독가루 vs 강철 타입', HIP(['Poison Powder']), set('Metagross', 'Clear Body'));
run('전기자석파 vs 전기 타입', HIP(['Thunder Wave']), set('Zapdos', 'Pressure'));
run('수면가루 vs 불면', HIP(['Sleep Powder']), set('Espeon', 'Insomnia'));
run('독독 vs 면역', HIP(['Toxic']), set('Snorlax', 'Immunity'));
run('도깨비불 vs 신비의부적', HIP(['Will-O-Wisp']), set('Snorlax', 'Thick Fat'), (b) => b.p2.addSideCondition('safeguard', b.p2.active[0]));
run('수면가루 vs 일렉트릭필드(지면)', HIP(['Sleep Powder']), set('Snorlax', 'Thick Fat'), (b) => b.field.setTerrain('electricterrain'));
run('도깨비불 이미 화상', HIP(['Will-O-Wisp']), set('Snorlax', 'Thick Fat'), (b) => b.p2.active[0].setStatus('brn'));
