// D3 E1·E2·E3 [실행] 일괄 확인 스크립트 (2026-11-18 검수 채팅 작성, 미실행 초안)
// 사용: node d3-run.js <pokemon-showdown 경로(965a535, node build 완료)>
// 원칙: 확률 비교 대신 값을 직접 찍는다(getStat·randomChance 인자·volatile). 통계가 필요한 2건만 반복.
const PS = process.argv[2] || '/home/claude/ref/pokemon-showdown';
const {Battle, Teams} = require(PS + '/dist/sim');
const F = 'gen9championsbssregmc';
const BENCH = '\n\nSnorlax @ Leftovers\nAbility: Thick Fat\n- Splash\n\nGarchomp @ Lum Berry\nAbility: Rough Skin\n- Splash';
function start(t1, t2, seed = [1, 2, 3, 4], debug = false) {
	const b = new Battle({formatid: F, seed, debug});
	b.setPlayer('p1', {team: Teams.import(t1 + BENCH)});
	b.setPlayer('p2', {team: Teams.import(t2 + BENCH)});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	return b;
}
const set = (sp, item, ab, moves) => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n` + moves.map(m => '- ' + m).join('\n');
const turn = (b, c1, c2) => { const n = b.log.length; b.makeChoices(c1, c2); return b.log.slice(n); };
const first = lines => (lines.find(l => /^\|move\|p[12]a/.test(l)) || '').slice(6, 8);
const st = p => `spe=${p.getStat('spe')} item=${p.item || '-'} ability=${p.ability} unburden=${!!p.volatiles['unburden']}`;
const spyChance = b => { const log = []; const o = b.randomChance.bind(b); b.randomChance = (n, d) => { const r = o(n, d); log.push(`${n}/${d}`); return r; }; return log; };
const out = (id, ...a) => console.log(`[${id}]`, ...a);

// ---------- E3 ----------
{ // E3-01: 검은철구 60 vs 61 → 둘 다 30, 선공 50%
	let p1 = 0; const N = 1000;
	for (let s = 1; s <= N; s++) {
		const b = start(set('Snorlax', 'Iron Ball', 'Thick Fat', ['Tackle']), set('Snorlax', 'Iron Ball', 'Thick Fat', ['Tackle']), [s, 7, 7, 7]);
		b.p1.active[0].storedStats.spe = 60; b.p2.active[0].storedStats.spe = 61;
		if (s === 1) out('E3-01', 'getStat', b.p1.active[0].getStat('spe'), b.p2.active[0].getStat('spe'), '(기대 30 30)');
		if (first(turn(b, 'move 1', 'move 1')) === 'p1') p1++;
	}
	out('E3-01', `스피드60 선공 ${p1}/${N} (기대 약 50%)`);
}
{ // E3-08: 퀵드로 + 선제공격손톱(같은 쪽), 느린 쪽 선공 확률 → 44%
	let p1 = 0; const N = 4000;
	for (let s = 1; s <= N; s++) {
		const b = start(set('Slowbro-Galar', 'Quick Claw', 'Quick Draw', ['Tackle']), set('Snorlax', 'Leftovers', 'Thick Fat', ['Tackle']), [s, 9, 9, 9]);
		b.p1.active[0].storedStats.spe = 50; b.p2.active[0].storedStats.spe = 100;
		if (first(turn(b, 'move 1', 'move 1')) === 'p1') p1++;
	}
	out('E3-08', `느린 쪽 선공 ${(p1 / N * 100).toFixed(1)}% (기대 44%)`);
}
{ // E3-02a: 던지기로 도구 소모(×2) → 상대 트릭으로 도구 받음(×1) → 다시 던지기(×2)
	const b = start(set('Sneasler', 'Sitrus Berry', 'Unburden', ['Fling', 'Splash']), set('Liepard', 'Life Orb', 'Limber', ['Trick', 'Splash']));
	turn(b, 'move 1', 'move 2'); out('E3-02a', 'T1 던지기 후', st(b.p1.active[0]), '(기대 ×2, unburden=true)');
	turn(b, 'move 2', 'move 1'); out('E3-02a', 'T2 트릭 받은 후', st(b.p1.active[0]), '(기대 ×1, unburden=true 유지)');
	turn(b, 'move 1', 'move 2'); out('E3-02a', 'T3 다시 던지기', st(b.p1.active[0]), '(기대 ×2)');
}
{ // E3-02b-1: 턴 종료 독 피해로 자뭉열매 소모
	const b = start(set('Hawlucha', 'Sitrus Berry', 'Unburden', ['Splash']), set('Liepard', 'Leftovers', 'Limber', ['Splash'])); // 독 타입(포푸니크)은 독에 걸리지 않으므로 루차불
	const p = b.p1.active[0]; p.sethp(Math.floor(p.maxhp / 2) + 1); p.setStatus('psn');
	const l = turn(b, 'move 1', 'move 1');
	out('E3-02b', '턴 종료 열매', st(p), '| 로그:', l.filter(x => /enditem|psn|-activate/.test(x)).join(' / '));
}
{ // E3-02b-2: 레드카드 소모(방어측이 곡예)
	const b = start(set('Sneasler', 'Red Card', 'Unburden', ['Splash']), set('Liepard', 'Leftovers', 'Limber', ['Tackle']));
	turn(b, 'move 1', 'move 1'); out('E3-02b', '레드카드 후', st(b.p1.active[0]), '(기대 unburden=true, ×2)');
}
{ // E3-02c: 곡예 켜진 뒤 고민씨·위액 / 곡예를 새로 받은 도구 없는 포켓몬
	for (const mv of ['Worry Seed', 'Gastro Acid']) {
		const b = start(set('Sneasler', 'Sitrus Berry', 'Unburden', ['Fling', 'Splash']), set('Liepard', 'Leftovers', 'Limber', [mv, 'Splash']));
		turn(b, 'move 1', 'move 2'); turn(b, 'move 2', 'move 1');
		out('E3-02c', mv, st(b.p1.active[0]), '(기대 ×1, unburden=false)');
	}
	const b = start(set('Hawlucha', '', 'Limber', ['Splash']), set('Hawlucha', 'Leftovers', 'Unburden', ['Skill Swap']));
	turn(b, 'move 1', 'move 1'); out('E3-02c', '곡예를 새로 받음', st(b.p1.active[0]), '(기대 ×1)');
}
{ // E3-15: 순풍이 자이로볼·일렉트릭볼 위력에 반영되는가 (debug BP 줄)
	for (const tw of [false, true]) {
		const b = start(set('Snorlax', 'Leftovers', 'Thick Fat', ['Tailwind', 'Electro Ball', 'Splash']), set('Ferrothorn', 'Leftovers', 'Iron Barbs', ['Gyro Ball', 'Splash']), [1, 2, 3, 4], true);
		b.p1.active[0].storedStats.spe = 100; b.p2.active[0].storedStats.spe = 50;
		turn(b, tw ? 'move 1' : 'move 3', 'move 2');
		const l = turn(b, 'move 2', 'move 1');
		out('E3-15', `순풍=${tw}`, l.filter(x => x.includes('BP:')).join(' / '), tw ? '(기대 자이로 101·일렉 150)' : '(기대 자이로 51·일렉 80)');
	}
}
// ---------- E2 ----------
{ // E2-02: 독 타입 맹독 필중 → 명중 난수를 굴리지 않는다
	const b = start(set('Arbok', 'Leftovers', 'Intimidate', ['Toxic']), set('Snorlax', 'Leftovers', 'Thick Fat', ['Splash']));
	const log = spyChance(b); turn(b, 'move 1', 'move 1');
	out('E2-02', 'randomChance 호출', log.join(',') || '(없음)', '| 상태', b.p2.active[0].status, '(기대: x/100 명중 호출 없음, tox)');
}
{ // E2-01: 명중 85 + 상대 회피 +1 → randomChance(63,100)
	const b = start(set('Snorlax', 'Leftovers', 'Thick Fat', ['Fire Blast']), set('Snorlax', 'Leftovers', 'Thick Fat', ['Splash']));
	b.p2.active[0].boosts.evasion = 1;
	const log = spyChance(b); turn(b, 'move 1', 'move 1');
	out('E2-01', 'randomChance 호출', log.join(','), '(기대 63/100 포함. 불대문자 명중이 85인지 함께 확인)', b.dex.moves.get('fireblast').accuracy);
}
{ // E2 [실행]3: 역린이 예정된 마지막 턴에 빗나가면 혼란 / 그 전 턴이면 혼란 없음
	for (const trueDur of [2, 3]) {
		const b = start(set('Garchomp', 'Leftovers', 'Rough Skin', ['Outrage']), set('Snorlax', 'Leftovers', 'Thick Fat', ['Splash']));
		turn(b, 'move 1', 'move 1');
		const p = b.p1.active[0]; p.volatiles['lockedmove'].trueDuration = trueDur;
		const o = b.randomChance.bind(b); b.randomChance = (n, d) => (d === 100 && n === 100 ? false : o(n, d)); // 2턴째 명중 판정만 실패
		turn(b, 'move 1', 'move 1'); b.randomChance = o;
		out('E2-역린', `trueDuration=${trueDur}, 2턴째 빗나감 → 혼란=${!!p.volatiles['confusion']}`, trueDur === 2 ? '(소스상 기대 true)' : '(소스상 기대 false)');
	}
}
// ---------- E1 ----------
function dmg(atk, ab, item, status, crit, base) {
	const b = start(set(atk, item, ab, ['Tackle']), set('Snorlax', 'Leftovers', 'Thick Fat', ['Splash']));
	const p = b.p1.active[0], t = b.p2.active[0];
	if (status) p.setStatus(status);
	b.randomizer = d => d;
	const m = b.dex.getActiveMove('tackle');
	t.getMoveHitData(m).crit = !!crit;
	return b.actions.modifyDamage(base, p, t, m);
}
out('E1-02', '화상+생명의구슬, 화상 직전 41 →', dmg('Garchomp', 'Rough Skin', 'Life Orb', 'brn', false, 39), '(기대 26, 엔진 현행 27)');
out('E1-03', '스나이퍼 급소(자속·상성 없음), +2 뒤 33 →', dmg('Ariados', 'Sniper', '', null, true, 31), '(기대 Showdown 73 · 엔진 현행 fl(33×2.25)=74)');