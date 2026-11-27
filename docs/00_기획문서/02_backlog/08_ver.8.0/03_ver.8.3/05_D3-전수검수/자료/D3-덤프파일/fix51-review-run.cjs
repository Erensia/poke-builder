// fix-51 (E8-41 가속) — 턴 도중 등장 경로별 Showdown 965a535 (gen9championsbssregmc) 실행 대조. 사용법: node fix51-review-run.cjs <빌드 폴더>
// p1 = 가속 보유자가 예비에 있는 쪽. "턴 도중에 가속 포켓몬이 들어왔을 때 그 턴 끝에 +1이 되는가"를 경로마다 본다.
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, moves, item, extra = '') => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${extra}${moves.map(m => '- ' + m).join('\n')}`;
const SN = (ab, moves = ['Splash'], item) => set('Snorlax', ab, moves, item);
const BENCH = SN('Thick Fat');
const SB = SN('Speed Boost');
const RE = /^\|(move|-damage|-boost|-unboost|-ability|-sidestart|-enditem|switch|drag|faint|upkeep|turn|-activate)\|/;
function make(p1, p2, seed = [1, 2, 3, 4]) {
	const b = new Battle({formatid: 'gen9championsbssregmc', seed});
	b.setPlayer('p1', {name: 'p1', team: Teams.import(p1.join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import(p2.join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	return b;
}
const bs = o => JSON.stringify(o).replace(/"|:0,?/g, '').replace(/,}/g, '}');
// 한 턴 입력 + 교체 요청이 남아 있으면 swPick으로 응답. 가속 보유자(p1 활성)의 spe 랭크와 로그를 출력.
function turn(b, label, c1, c2, swPick = 'switch 2') {
	const n = b.log.length;
	b.makeChoices(c1, c2);
	let guard = 0;
	while (b.requestState === 'switch' && guard++ < 4) b.makeChoices(swPick, 'default');
	const a = b.p1.active[0];
	console.log(`[${label}] ${c1} / ${c2}\n   ` + b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1).replace(/\|\[from\]/g, '<').replace(/\|p[12]a: /g, '|')).join(' / ') +
		`\n   => p1 ${a.name}(${a.ability}) hp=${a.hp}/${a.maxhp} spe=${a.boosts.spe} b=${bs(a.boosts)} activeTurns=${a.activeTurns}`);
}
function scen(title, p1, p2, steps, seed) {
	console.log('--- ' + title);
	const b = make(p1, p2, seed);
	for (const s of steps) turn(b, ...s);
	return b;
}

console.log('===== F. 턴 도중 등장 경로별 가속(예비의 가속 포켓몬이 들어온 턴 끝 spe 랭크) =====');
scen('F1 드래곤테일(상대가 끌어냄)', [BENCH, SB], [SN('Thick Fat', ['Dragon Tail']), BENCH], [['T1', 'move 1', 'move 1'], ['T2 (다음 턴)', 'move 1', 'move 1']]);
scen('F2 울부짖기(Roar) — 우선도 −6', [BENCH, SB], [SN('Thick Fat', ['Roar']), BENCH], [['T1', 'move 1', 'move 1'], ['T2', 'move 1', 'move 1']]);
scen('F3 레드카드 — p1 공격자가 상대 레드카드에 맞아 끌려 나감', [SN('Thick Fat', ['Tackle']), SB], [SN('Thick Fat', ['Splash'], 'Red Card'), BENCH], [['T1', 'move 1', 'move 1'], ['T2', 'move 1', 'move 1']]);
scen('F4 탈출버튼 — p1 보유자가 맞고 직접 교체', [SN('Thick Fat', ['Splash'], 'Eject Button'), SB], [SN('Thick Fat', ['Tackle']), BENCH], [['T1', 'move 1', 'move 1'], ['T2', 'move 1', 'move 1']]);
scen('F5 위기회피(Emergency Exit) — HP 절반 위에서 맞고 직접 교체', [SN('Emergency Exit', ['Splash']), SB], [SN('Thick Fat', ['Body Slam']), BENCH], [['T1', 'move 1', 'move 1'], ['T2', 'move 1', 'move 1']]);
scen('F6 배턴터치(Baton Pass)', [SN('Thick Fat', ['Baton Pass']), SB], [BENCH, BENCH], [['T1', 'move 1', 'move 1'], ['T2', 'move 1', 'move 1']]);
scen('F7 꼬리자르기(Shed Tail)', [SN('Thick Fat', ['Shed Tail']), SB], [BENCH, BENCH], [['T1', 'move 1', 'move 1'], ['T2', 'move 1', 'move 1']]);
scen('F8 유턴(U-turn) — 비교용(이미 일치)', [SN('Thick Fat', ['U-turn']), SB], [BENCH, BENCH], [['T1', 'move 1', 'move 1'], ['T2', 'move 1', 'move 1']]);
scen('F9 자발 교체 — 비교용(이미 일치)', [BENCH, SB], [BENCH, BENCH], [['T1', 'switch 2', 'move 1'], ['T2', 'move 1', 'move 1']]);

console.log('===== G. 행동 전 기절 대체(설치물로 쓰러진 교체 포켓몬의 대체) — 교체 시점과 가속 =====');
{ // p2가 T1에 스텔스록, p1 예비1(HP 1)로 T2 교체 → 설치물로 기절 → 대체로 가속 포켓몬 투입
	const b = make([BENCH, SN('Thick Fat'), SB], [SN('Thick Fat', ['Stealth Rock', 'Tackle']), BENCH]);
	turn(b, 'G1 T1 스텔스록', 'move 1', 'move 1');
	b.p1.pokemon[1].sethp(1);
	const n = b.log.length;
	b.makeChoices('switch 2', 'move 2'); // p1 교체(예비1, HP1) · p2 몸통박치기(Tackle)
	const asked = b.requestState;
	console.log(`[G2 T2 교체 직후 요청 상태] requestState=${asked} (switch면 대체를 턴 도중에 요구한 것)`);
	let guard = 0; while (b.requestState === 'switch' && guard++ < 3) b.makeChoices('switch 3', 'default');
	const a = b.p1.active[0];
	console.log(`   로그: ` + b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1).replace(/\|p[12]a: /g, '|')).join(' / ') + `\n   => p1 ${a.name}(${a.ability}) hp=${a.hp}/${a.maxhp} spe=${a.boosts.spe} activeTurns=${a.activeTurns}`);
	turn(b, 'G3 T3 (다음 턴)', 'move 1', 'move 1');
}
