// fix-55 (E8-46) — 교체 직후 설치물로 쓰러졌을 때(행동 전 기절 대체)의 Showdown 965a535 (gen9championsbssregmc) 실행 대조. 사용법: node fix55-review-run.cjs <빌드 폴더>
// p1 = 교체하는 쪽(스텔스록이 깔려 있고 예비1이 HP 1), p2 = 상대. 로그는 필터 없이 turn 경계까지 전부 출력해 "무엇이 언제" 일어나는지 본다.
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, moves, item, extra = '') => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${extra}${moves.map(m => '- ' + m).join('\n')}`;
const SN = (ab, moves = ['Splash'], item) => set('Snorlax', ab, moves, item);
const RE = /^\|(move|-damage|-heal|-boost|-unboost|-status|-fail|-notarget|-immune|-sidestart|-start|-enditem|-weather|switch|drag|faint|upkeep|turn|win|-activate|cant|-miss)\|/;
function make(p1, p2, seed = [1, 2, 3, 4]) {
	const b = new Battle({formatid: 'gen9championsbssregmc', seed});
	b.setPlayer('p1', {name: 'p1', team: Teams.import(p1.join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import(p2.join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	return b;
}
const fmt = (b, n) => b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1).replace(/\|\[from\]/g, '<').replace(/\|p[12]a: /g, '|')).join('\n      ');
// 스텔스록 깔기(p1 쪽에): T1 p2가 스텔스록 → 예비1(인덱스 1)을 HP 1로 → T2 p1 교체
function scen(title, p1, p2, t2p2, opts = {}) {
	console.log('--- ' + title);
	const b = make(p1, p2);
	b.makeChoices('move 1', 'move 1'); // T1: p2 = Stealth Rock
	b.p1.pokemon[1].sethp(1);
	if (opts.p2sethp) b.p2.pokemon[0].sethp(opts.p2sethp);
	const n = b.log.length;
	b.makeChoices('switch 2', t2p2);
	const asks = [];
	let guard = 0;
	while (b.requestState === 'switch' && guard++ < 4) {
		asks.push(`요청(p1 교체 필요=${b.p1.active[0].switchFlag || b.p1.active[0].fainted}, p2=${b.p2.active[0].switchFlag || b.p2.active[0].fainted})`);
		b.makeChoices(opts.p1pick || 'switch 3', opts.p2pick || 'default');
	}
	console.log(`   [요청] ${asks.join(' → ') || '없음'}`);
	console.log('      ' + fmt(b, n));
	const a = b.p1.active[0], d = b.p2.active[0];
	console.log(`   => p1 ${a.name} hp=${a.hp}/${a.maxhp} b=${JSON.stringify(a.boosts).replace(/"|:0,?/g, '')} | p2 ${d.name} hp=${d.hp}/${d.maxhp} st=${d.status || '-'} b=${JSON.stringify(d.boosts).replace(/"|:0,?/g, '')}`);
	return b;
}
const P1 = [SN('Thick Fat'), SN('Thick Fat'), SN('Thick Fat')];
const P2 = (moves, item) => [SN('Thick Fat', ['Stealth Rock', ...moves], item), SN('Thick Fat')];

console.log('===== S. 교체 직후 설치물로 쓰러진 쪽의 대체 시점 — 상대(p2)가 같은 턴에 쓰는 기술별 =====');
scen('S1 공격기(Tackle)', P1, P2(['Tackle']), 'move 2');
scen('S2 자기 대상 변화(Swords Dance) — 정상 실행되는가', P1, P2(['Swords Dance']), 'move 2');
scen('S3 자기 회복(Recover, p2 HP 절반) — 건너뛰던 옛 버그 장면', P1, P2(['Recover']), 'move 2', {p2sethp: 100});
scen('S4 상대 대상 변화(Toxic)', P1, P2(['Toxic']), 'move 2');
scen('S5 필드 기술(Rain Dance)', P1, P2(['Rain Dance']), 'move 2');
scen('S6 방어(Protect)', P1, P2(['Protect']), 'move 2');
scen('S7 잔류 처리 확인 — p2가 먹다남은음식, p1 대체는 잔류 전/후?', P1, P2(['Tackle'], 'Leftovers'), 'move 2', {p2sethp: 100});
scen('S8 우선도 기술(Quick Attack)', P1, P2(['Quick Attack']), 'move 2');

console.log('===== T. 양쪽 동시 =====');
{ // 양쪽이 모두 교체해서 쓰러진다: p2 쪽에도 스텔스록(p1이 T1에 깔음), p2 예비1 HP 1
	console.log('--- T1 양쪽 교체 → 양쪽 설치물 기절');
	const b = make([SN('Thick Fat', ['Stealth Rock']), SN('Thick Fat'), SN('Thick Fat')], [SN('Thick Fat', ['Stealth Rock']), SN('Thick Fat'), SN('Thick Fat')]);
	b.makeChoices('move 1', 'move 1');
	b.p1.pokemon[1].sethp(1); b.p2.pokemon[1].sethp(1);
	const n = b.log.length;
	b.makeChoices('switch 2', 'switch 2');
	let guard = 0, asks = [];
	while (b.requestState === 'switch' && guard++ < 4) { asks.push('요청'); b.makeChoices('switch 3', 'switch 3'); }
	console.log(`   [요청] ${asks.join(' → ')}\n      ` + fmt(b, n));
}

console.log('===== U. 유턴으로 들어온 포켓몬이 설치물로 쓰러짐 — 대체 시점 =====');
{
	console.log("--- U1 p1 유턴으로 예비1(HP1)이 들어와 스텔스록에 쓰러짐, p2 Tackle");
	const b = make([SN("Thick Fat", ["Splash", "U-turn"]), SN("Thick Fat"), SN("Thick Fat")], [SN("Thick Fat", ["Stealth Rock", "Tackle"]), SN("Thick Fat")]);
	b.makeChoices("move 1", "move 1"); // T1: p2 스텔스록
	b.p1.pokemon[1].sethp(1);
	const n = b.log.length;
	b.makeChoices("move 2", "move 2"); // T2: p1 유턴 · p2 Tackle
	let guard = 0, asks = [];
	while (b.requestState === "switch" && guard++ < 4) { asks.push("요청"); b.makeChoices("switch 2", "default"); if (b.requestState === "switch") { asks.push("요청"); b.makeChoices("switch 3", "default"); } }
	console.log("   [요청] " + asks.join(" → ") + "\n      " + fmt(b, n));
}
