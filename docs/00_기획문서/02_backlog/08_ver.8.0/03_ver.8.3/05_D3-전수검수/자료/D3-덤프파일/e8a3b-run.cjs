// E8-a ③ 마무리 — 불면·열교환·정화의소금·타오르는불꽃·축전·초식·플라워베일 실행 대조 (Showdown 965a535 champions)
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const F = 'gen9championsbssregmc';
const set = (sp, ab, item = '', moves = ['Splash']) =>
	`${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${moves.map(m => '- ' + m).join('\n')}`;
const BENCH = set('Snorlax', 'Thick Fat');
function run(label, p1, p2, c1 = 'move 1', c2 = 'move 1', prep, turns = 1) {
	const b = new Battle({formatid: F, seed: [1, 2, 3, 4]});
	b.setPlayer('p1', {name: 'p1', team: Teams.import([p1, BENCH].join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import([p2, BENCH].join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	if (prep) prep(b);
	const a = b.p1.active[0], d = b.p2.active[0];
	const n = b.log.length;
	for (let i = 0; i < turns; i++) b.makeChoices(c1, c2);
	const RE = /^\|(move|-ability|-activate|-fail|-immune|-boost|-unboost|-status|-start|-heal|-damage|-block|-curestatus|-end|cant)\|/;
	const st = (m) => `${m.species.name} hp=${m.hp}/${m.maxhp} st=${m.status || '-'} atk=${m.boosts.atk} def=${m.boosts.def} vol=[${Object.keys(m.volatiles).filter(v => !/^(?:turnstart|choicelock)/.test(v)).join(',')}]`;
	console.log(`[${label}]\n   ` + b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1)).join(' / ') + `\n   => p1 ${st(a)} | p2 ${st(d)}`);
}
const HIP = (m) => set('Hippowdon', 'Sand Stream', '', m);
// 불면
run('불면: 하품', HIP(['Yawn']), set('Espeon', 'Insomnia'));
run('불면: 수면가루', HIP(['Sleep Powder']), set('Espeon', 'Insomnia'));
run('불면: 잠자기(HP 절반)', HIP(['Splash']), set('Espeon', 'Insomnia', '', ['Rest']), 'move 1', 'move 1', (b) => { b.p2.active[0].hp = 70; });
run('불면: 대조(일반) 잠자기', HIP(['Splash']), set('Espeon', 'Synchronize', '', ['Rest']), 'move 1', 'move 1', (b) => { b.p2.active[0].hp = 70; });
// 열교환
run('열교환: 화염방사(데미지)', HIP(['Flamethrower']), set('Baxcalibur', 'Thermal Exchange'));
run('열교환: 도깨비불', HIP(['Will-O-Wisp']), set('Baxcalibur', 'Thermal Exchange'));
run('열교환: 물기(비불꽃)', HIP(['Crunch']), set('Baxcalibur', 'Thermal Exchange'));
// 정화의소금
run('정화의소금: 독가루/하품', HIP(['Yawn']), set('Garganacl', 'Purifying Salt'));
run('정화의소금: 독독(Toxic)', HIP(['Toxic']), set('Garganacl', 'Purifying Salt'));
run('정화의소금: 화염구슬 자가', HIP(['Splash']), set('Garganacl', 'Purifying Salt', 'Flame Orb'), 'move 1', 'move 1', null, 2);
// 타오르는불꽃
run('타오르는불꽃: 화염방사', HIP(['Flamethrower']), set('Arcanine', 'Flash Fire'));
run('타오르는불꽃: 도깨비불', HIP(['Will-O-Wisp']), set('Arcanine', 'Flash Fire'));
run('타오르는불꽃: 화염방사 2연속(이미 발동)', HIP(['Flamethrower']), set('Arcanine', 'Flash Fire'), 'move 1', 'move 1', null, 2);
// 축전
run('축전: 전기자석파(HP 절반)', HIP(['Thunder Wave']), set('Jolteon', 'Volt Absorb'), 'move 1', 'move 1', (b) => { b.p2.active[0].hp = 100; });
run('축전: 전기자석파(풀피)', HIP(['Thunder Wave']), set('Jolteon', 'Volt Absorb'));
run('축전: 10만볼트(HP 절반)', HIP(['Thunderbolt']), set('Jolteon', 'Volt Absorb'), 'move 1', 'move 1', (b) => { b.p2.active[0].hp = 100; });
// 초식
run('초식: 씨뿌리기', HIP(['Leech Seed']), set('Farigiraf', 'Sap Sipper'));
run('초식: 잎날가르기(데미지)', HIP(['Razor Leaf']), set('Farigiraf', 'Sap Sipper'));
run('초식: 씨뿌리기(공격 +6)', HIP(['Leech Seed']), set('Farigiraf', 'Sap Sipper'), 'move 1', 'move 1', (b) => { b.p2.active[0].boosts.atk = 6; });
// 플라워베일(풀 타입에게 부여 — Showdown은 풀 타입만 보호, 페어리 보유자는 보호 없음)
run('플라워베일: 도깨비불 vs 풀(보유자)', HIP(['Will-O-Wisp']), set('Venusaur', 'Flower Veil'));
run('플라워베일: 싫은소리 vs 풀(보유자)', HIP(['Screech']), set('Venusaur', 'Flower Veil'));
run('플라워베일: 하품 vs 풀(보유자)', HIP(['Yawn']), set('Venusaur', 'Flower Veil'));
run('플라워베일: 도깨비불 vs 페어리(보유자 플라제스)', HIP(['Will-O-Wisp']), set('Florges', 'Flower Veil'));
run('플라워베일: 대조(일반 특성 풀) 도깨비불', HIP(['Will-O-Wisp']), set('Venusaur', 'Overgrow'));
