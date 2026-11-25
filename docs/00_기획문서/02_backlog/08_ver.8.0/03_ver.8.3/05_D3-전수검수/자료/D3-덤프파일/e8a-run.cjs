// E8-a 실행 대조 (Showdown 965a535, gen9championsbssregmc). node e8a-run.cjs <빌드 폴더>
// 질문: 우격다짐 공격이 위기회피·탈출버튼·레드카드·발끈을 막는가(champions scripts.ts 424행 주석: 막지 않는다), 유턴이 위기회피로 상대 교체를 취소하는가
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const F = 'gen9championsbssregmc';
const set = (sp, ab, item = '', moves = ['Splash']) =>
	`${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${moves.map(m => '- ' + m).join('\n')}`;
function start(p1, p2) {
	const b = new Battle({formatid: F, seed: [1, 2, 3, 4]});
	b.setPlayer('p1', {name: 'p1', team: Teams.import(p1.join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import(p2.join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	return b;
}
const RE = /^\|(-damage|-activate|-boost|-unboost|-enditem|-status|move|switch|drag)\|/;
function run(label, p1, p2, c1, c2, hpTo = 0.5) {
	const b = start(p1, p2);
	const t = b.p2.active[0];
	t.hp = Math.floor(t.maxhp * hpTo) + 1; // 어떤 피해든 절반 이하로 넘게
	const n = b.log.length;
	b.makeChoices(c1, c2);
	const lines = b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1));
	const req = [b.p1, b.p2].map(s => (s.activeRequest && s.activeRequest.forceSwitch ? 'switch요구' : '-'));
	console.log(`[${label}] 요청 p1=${req[0]} p2=${req[1]} spa=${t.boosts.spa}\n   ${lines.join(' / ')}`);
}
const NIDO_SF = set('Nidoking', 'Sheer Force', '', ['Poison Sting']); // 추가효과(독 10%) → 우격다짐 적용
const NIDO_NO = set('Nidoking', 'Poison Point', '', ['Poison Sting']);
const GOLI = set('Golisopod', 'Emergency Exit');
const BENCH = set('Snorlax', 'Thick Fat');
const ATK = (x) => [x, BENCH];

run('A 우격다짐+위기회피', [NIDO_SF, BENCH], [GOLI, BENCH], 'move 1', 'move 1');
run('A\' 일반+위기회피(대조)', [NIDO_NO, BENCH], [GOLI, BENCH], 'move 1', 'move 1');
run('B 우격다짐+탈출버튼', [NIDO_SF, BENCH], [set('Snorlax', 'Thick Fat', 'Eject Button'), BENCH], 'move 1', 'move 1', 0.9);
run('B\' 일반+탈출버튼(대조)', [NIDO_NO, BENCH], [set('Snorlax', 'Thick Fat', 'Eject Button'), BENCH], 'move 1', 'move 1', 0.9);
run('C 우격다짐+레드카드', [NIDO_SF, BENCH], [set('Snorlax', 'Thick Fat', 'Red Card'), BENCH], 'move 1', 'move 1', 0.9);
run('C\' 일반+레드카드(대조)', [NIDO_NO, BENCH], [set('Snorlax', 'Thick Fat', 'Red Card'), BENCH], 'move 1', 'move 1', 0.9);
run('D 우격다짐+발끈', [NIDO_SF, BENCH], [set('Drampa', 'Berserk'), BENCH], 'move 1', 'move 1');
run('D\' 일반+발끈(대조)', ATK(NIDO_NO), [set('Drampa', 'Berserk'), BENCH], 'move 1', 'move 1');
run('E 유턴 사용자 vs 위기회피', [set('Scizor', 'Technician', '', ['U-turn']), BENCH], [GOLI, BENCH], 'move 1', 'move 1', 0.8);
