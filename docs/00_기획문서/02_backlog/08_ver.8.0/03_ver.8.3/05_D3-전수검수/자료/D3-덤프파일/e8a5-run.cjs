// E8-a ⑤ 턴 종료·상태 연동 묶음 — Showdown 965a535 (gen9championsbssregmc) 실행 대조. 사용법: node e8a5-run.cjs <빌드 폴더>
// 대상(샘플 사용): 가속·변덕쟁이·승기·오기·싱크로·젖은접시 (곡예는 fix-9로 정합 완료, 위기회피·자연회복·재생력·치유의마음은 §1·§5에서 끝남)
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, moves, item, extra = '') => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${extra}${moves.map(m => '- ' + m).join('\n')}`;
const SN = (ab, moves = ['Splash'], item, extra) => set('Snorlax', ab, moves, item, extra);
const BENCH = SN('Thick Fat');
const RE = /^\|(move|-damage|-immune|-status|-curestatus|-start|-end|-fail|-activate|-block|-boost|-unboost|-heal|-ability|-weather|-sidestart|-sideend|faint|switch|drag)\|/;
function make(p1, p2, prep, seed = [1, 2, 3, 4]) {
	const b = new Battle({formatid: 'gen9championsbssregmc', seed});
	b.setPlayer('p1', {name: 'p1', team: Teams.import(p1.join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import(p2.join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	if (prep) prep(b);
	return b;
}
const bs = o => JSON.stringify(o).replace(/"|:0,?/g, '').replace(/,}/g, '}');
function show(b, n, label) {
	const a = b.p1.active[0], d = b.p2.active[0];
	console.log(`[${label}]\n   ` + b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1).replace(/\|\[from\]/g, '<').replace(/\|p[12]a: /g, '|')).join(' / ') +
		`\n   => p1 ${a.name} hp=${a.hp}/${a.maxhp} st=${a.status || '-'} b=${bs(a.boosts)} spe=${a.getActionSpeed()} | p2 ${d.name} hp=${d.hp}/${d.maxhp} st=${d.status || '-'} b=${bs(d.boosts)} spe=${d.getActionSpeed()}`);
}
// 여러 턴: choices = [[p1선택, p2선택], ...] — 턴마다 출력
function run(label, p1, p2, prep, choices) {
	const b = make(p1, p2, prep);
	console.log(`--- ${label}`);
	choices.forEach((c, i) => { const n = b.log.length; b.makeChoices(c[0], c[1]); show(b, n, `T${i + 1} ${c[0]} / ${c[1]}`); });
	return b;
}

// 확률 접촉 반응: 공격자가 상태이상이 되는 첫 시드를 찾아 그 실행을 출력
function runFirst(label, p1, p2, pred) {
	for (let sd = 1; sd <= 60; sd++) {
		const b = make(p1, p2, null, [sd, sd + 1, sd + 2, sd + 3]); const n = b.log.length;
		b.makeChoices('move 1', 'move 1');
		if (pred(b)) { console.log('--- ' + label + ' (seed ' + sd + ')'); show(b, n, 'T1'); return; }
	}
	console.log('--- ' + label + ' : 60개 시드 중 반응 없음');
}
const hp1 = b => b.p1.active[0].sethp(1);

console.log('===== A. 가속 (speedboost, 샘플 2) =====');
run('A1 일반: 가만히 2턴', [SN('Speed Boost'), BENCH], [SN('Thick Fat'), BENCH], null, [['move 1', 'move 1'], ['move 1', 'move 1']]);
run('A2 자발적 교체로 나온 턴(교체 후 대기)', [SN('Thick Fat'), SN('Speed Boost')], [SN('Thick Fat'), BENCH], null, [['switch 2', 'move 1'], ['move 1', 'move 1']]);
run('A3 상대 드래곤테일로 끌려 나온 턴(강제 교체)', [SN('Thick Fat'), SN('Speed Boost')], [SN('Thick Fat', ['Dragon Tail']), BENCH], null, [['move 1', 'move 1'], ['move 1', 'move 1']]);
run('A4 유턴으로 중간 교체(유턴 사용자는 가속 아님, 교체된 쪽이 가속)', [SN('Thick Fat', ['U-turn']), SN('Speed Boost')], [SN('Thick Fat'), BENCH], null, [['move 1', 'move 1'], ['switch 2', 'default'], ['move 1', 'move 1']]);
run('A5 기절 후 교체(턴 끝 후 교체) — 나온 턴 / 다음 턴', [SN('Thick Fat'), SN('Speed Boost')], [SN('Thick Fat', ['Tackle']), BENCH], hp1, [['move 1', 'move 1'], ['switch 2', 'default'], ['move 1', 'move 1']]);
run('A7 +6에서 한 턴 더', [SN('Speed Boost'), BENCH], [SN('Thick Fat'), BENCH], b => {b.p1.active[0].boosts.spe = 6;}, [['move 1', 'move 1']]);

console.log('===== B. 변덕쟁이 (moody, 샘플 2) =====');
// 시드 120개: 변덕쟁이 사용자의 (오른 스탯 +2, 내려간 스탯 -1) 분포
function moodyDist(label, prep, seeds = 120) {
	const tally = {};
	for (let s = 1; s <= seeds; s++) {
		const b = make([SN('Moody'), BENCH], [SN('Thick Fat'), BENCH], prep, [s, s + 7, s + 13, s + 29]);
		b.makeChoices('move 1', 'move 1');
		const a = b.p1.active[0].boosts, k = bs(a);
		tally[k] = (tally[k] || 0) + 1;
	}
	const top = Object.entries(tally).sort((x, y) => y[1] - x[1]);
	console.log(`[${label}] 서로 다른 결과 ${top.length}가지 — ` + top.slice(0, 8).map(([k, v]) => `${k}×${v}`).join(' ') + (top.length > 8 ? ' …' : ''));
}
moodyDist('B1 기본(전부 0)');
moodyDist('B2 atk·def·spa·spd = +6, spe = 0 (오를 수 있는 건 spe뿐)', b => {const x = b.p1.active[0].boosts; x.atk = x.def = x.spa = x.spd = 6;});
moodyDist('B3 전부 -6 (atk만 오를 수 있고 내릴 곳 없음…)', b => {const x = b.p1.active[0].boosts; x.atk = x.def = x.spa = x.spd = x.spe = -6;});
moodyDist('B4 spe = +6 (spe는 오르지 않는다), 나머지 0', b => {b.p1.active[0].boosts.spe = 6;});
moodyDist('B5 atk = -6 (atk는 내려가지 않는다), 나머지 0', b => {b.p1.active[0].boosts.atk = -6;});
// 교체로 나온 턴에도 변덕쟁이가 도는지
run('B6 자발적 교체로 나온 턴(가속과 달리 발동하는가)', [SN('Thick Fat'), SN('Moody')], [SN('Thick Fat'), BENCH], null, [['switch 2', 'move 1']]);

console.log('===== C. 오기(defiant)·승기(competitive) (샘플 1·3) =====');
const DEF = ab => SN(ab, ['Splash', 'Substitute']);
for (const [ab, tag] of [['Defiant', '오기'], ['Competitive', '승기']]) {
	console.log(`--- ${tag}`);
	run(`C1 ${tag}: 위협(Intimidate) — 배틀 시작`, [SN('Intimidate'), BENCH], [DEF(ab), BENCH], null, [['move 1', 'move 1']]);
	run(`C2 ${tag}: 위협 — 교체로 등장`, [SN('Thick Fat'), SN('Intimidate')], [DEF(ab), BENCH], null, [['switch 2', 'move 1']]);
	run(`C3 ${tag}: 애교부리기(Charm, atk-2 변화기)`, [SN('Thick Fat', ['Charm']), BENCH], [DEF(ab), BENCH], null, [['move 1', 'move 1']]);
	run(`C4 ${tag}: 겁나는얼굴(Scary Face, spe-2)`, [SN('Thick Fat', ['Scary Face']), BENCH], [DEF(ab), BENCH], null, [['move 1', 'move 1']]);
	run(`C5 ${tag}: 얼어붙은바람(Icy Wind, 데미지 기술의 스피드 하락)`, [SN('Thick Fat', ['Icy Wind']), BENCH], [DEF(ab), BENCH], null, [['move 1', 'move 1']]);
	run(`C6 ${tag}: 간지르기(Tickle, 두 능력치)`, [SN('Thick Fat', ['Tickle']), BENCH], [DEF(ab), BENCH], null, [['move 1', 'move 1']]);
	run(`C7 ${tag}: 자기 기술의 반동 하락(엄청난힘 Superpower) — 본인이 사용`, [SN('Thick Fat'), BENCH], [SN(ab, ['Superpower']), BENCH], null, [['move 1', 'move 1']]);
	run(`C8 ${tag}: 이미 해당 능력치가 -6(변화 없음)`, [SN('Thick Fat', ['Charm', 'Scary Face']), BENCH], [DEF(ab), BENCH], b => {b.p2.active[0].boosts.atk = -6;}, [['move 1', 'move 1']]);
	run(`C9 ${tag}: 대타가 막는 변화기(거짓울음 Fake Tears)`, [SN('Thick Fat', ['Fake Tears']), BENCH], [DEF(ab), BENCH], b => {b.p2.active[0].addVolatile('substitute');}, [['move 1', 'move 1']]);
	run(`C10 ${tag}: 끈적끈적네트(Sticky Web) 설치 후 교체 등장`, [SN('Thick Fat', ['Sticky Web']), BENCH], [SN('Thick Fat'), DEF(ab)], null, [['move 1', 'move 1'], ['move 1', 'switch 2']]);
	run(`C11 ${tag}: 달콤한향기(Sweet Scent, 회피율 하락)`, [SN('Thick Fat', ['Sweet Scent']), BENCH], [DEF(ab), BENCH], null, [['move 1', 'move 1']]);
	run(`C12 ${tag}: 위협 + ${tag}가 올리는 스탯이 이미 +6`, [SN('Intimidate'), BENCH], [DEF(ab), BENCH], b => {b.p2.active[0].boosts[ab === 'Defiant' ? 'atk' : 'spa'] = 6;}, [['move 1', 'move 1']]);
	run(`C13 ${tag}: 기절하는 일격으로 하락 (HP 1, 얼어붙은바람)`, [SN('Thick Fat', ['Icy Wind']), BENCH], [DEF(ab), BENCH], b => b.p2.active[0].sethp(1), [['move 1', 'move 1']]);
}

for (const [ab, tag] of [['Defiant', '오기'], ['Competitive', '승기']]) {
	runFirst('C14 ' + tag + ': 보유자(공격자)가 아이언헤드로 미끈미끈(Gooey) 방어측을 때림 — 공격자 스피드 하락', [SN(ab, ['Iron Head', 'Splash']), BENCH], [SN('Gooey'), BENCH], b => b.p1.active[0].boosts.spe < 0);
}
console.log('===== D. 싱크로 (synchronize, 샘플 5) — 보유자가 p2, 공격자가 p1 =====');
const SY = ab => SN(ab || 'Synchronize', ['Splash', 'Will-O-Wisp', 'Toxic', 'Thunder Wave', 'Poison Gas']);
const AT = (mv, ab = 'Thick Fat', item) => set('Snorlax', ab, [mv, 'Splash'], item);
run('D1 도깨비불(Will-O-Wisp)', [AT('Will-O-Wisp'), BENCH], [SY(), BENCH], null, [['move 1', 'move 1']]);
run('D2 맹독(Toxic)', [AT('Toxic'), BENCH], [SY(), BENCH], null, [['move 1', 'move 1']]);
run('D3 독가루(Poison Powder)', [AT('Poison Powder'), BENCH], [SY(), BENCH], null, [['move 1', 'move 1']]);
run('D4 저리가루(Stun Spore)', [AT('Stun Spore'), BENCH], [SY(), BENCH], null, [['move 1', 'move 1']]);
run('D5 수면가루(Sleep Powder) — 수면은 복사 안 함', [AT('Sleep Powder'), BENCH], [SN('Synchronize', ['Splash']), BENCH], null, [['move 1', 'move 1']]);
run('D6 공격자가 불꽃 타입(Charizard) — 화상 면역', [set('Charizard', 'Blaze', ['Will-O-Wisp', 'Splash']), BENCH], [SY(), BENCH], null, [['move 1', 'move 1']]);
run('D7 공격자가 강철 타입(Metagross) — 독 면역', [set('Metagross', 'Clear Body', ['Toxic', 'Splash']), BENCH], [SY(), BENCH], null, [['move 1', 'move 1']]);
run('D8 공격자가 전기 타입(Raichu) — 마비 면역', [set('Raichu', 'Static', ['Thunder Wave', 'Splash']), BENCH], [SY(), BENCH], null, [['move 1', 'move 1']]);
run('D9 공격자가 이미 상태이상(마비) — 화상 복사 실패', [AT('Will-O-Wisp'), BENCH], [SY(), BENCH], b => {b.p1.active[0].setStatus('par');}, [['move 1', 'move 1']]);
run('D10 둘 다 싱크로 — 도깨비불', [SN('Synchronize', ['Will-O-Wisp', 'Splash']), BENCH], [SY(), BENCH], null, [['move 1', 'move 1']]);
run('D11 독압정(Toxic Spikes) 후 싱크로 보유자 교체 등장 — 복사 안 함', [SN('Thick Fat', ['Toxic Spikes', 'Splash']), BENCH], [SN('Thick Fat'), SY()], null, [['move 1', 'move 1'], ['move 1', 'switch 2']]);
run('D12 독구슬(Toxic Orb) 자가 부여 — 복사할 상대가 없음', [BENCH, BENCH], [set('Snorlax', 'Synchronize', ['Splash'], 'Toxic Orb'), BENCH], null, [['move 1', 'move 1']]);
runFirst('D13 접촉 반응: 공격자 싱크로 vs 방어측 정전기(Static)', [set('Snorlax', 'Synchronize', ['Tackle', 'Splash']), BENCH], [SN('Static'), BENCH], b => b.p1.active[0].status);
runFirst('D14 접촉 반응: 공격자 싱크로 vs 방어측 불꽃몸(Flame Body)', [set('Snorlax', 'Synchronize', ['Tackle', 'Splash']), BENCH], [SN('Flame Body'), BENCH], b => b.p1.active[0].status);
runFirst('D15 접촉 반응: 공격자 싱크로 vs 방어측 독가시(Poison Point)', [set('Snorlax', 'Synchronize', ['Tackle', 'Splash']), BENCH], [SN('Poison Point'), BENCH], b => b.p1.active[0].status);
run('D16 보유자가 도깨비불로 공격자(상대)에게 건 상태 — 사용자 싱크로가 자기 도깨비불에 반응?(보유자가 쓰는 쪽)', [SN('Thick Fat'), BENCH], [SN('Synchronize', ['Will-O-Wisp', 'Splash']), BENCH], null, [['move 1', 'move 1']]);
run('D17 보유자가 신비의부적(Safeguard) 보호 아래 — 공격자 화상', [AT('Will-O-Wisp'), BENCH], [SY(), BENCH], b => {b.p1.addSideCondition('safeguard', b.p1.active[0]);}, [['move 1', 'move 1']]);

runFirst('D18 방어측 싱크로가 번개(Thunder) 2차효과 마비 → 공격자도 마비?', [AT('Thunder'), BENCH], [SN('Synchronize', ['Splash']), BENCH], b => b.p2.active[0].status);
runFirst('D19 공격자 독수(Poison Touch) 접촉 → 방어측 싱크로가 중독 → 공격자도 중독?', [set('Snorlax', 'Poison Touch', ['Iron Head', 'Splash']), BENCH], [SN('Synchronize', ['Splash']), BENCH], b => b.p2.active[0].status);
console.log('===== E. 젖은접시 (raindish, 샘플 1) =====');
const RD = ab => SN(ab || 'Rain Dish');
function weatherRun(label, p1, p2, prep, turns) {
	const b = make(p1, p2, prep);
	console.log(`--- ${label}`);
	const seq = [];
	for (let t = 1; t <= turns; t++) { const n = b.log.length; b.makeChoices('move 1', 'move 1'); const d = b.p1.active[0]; seq.push(`T${t}:${d.hp}${b.field.weather ? '(' + b.field.weather + ')' : ''}`); }
	console.log('   ' + seq.join(' '));
}
weatherRun('E1 비바라기(Rain Dance) 5턴: 최대 HP의 절반에서 시작', [set('Snorlax', 'Rain Dish', ['Splash'])], [set('Snorlax', 'Thick Fat', ['Rain Dance'])], b => b.p1.active[0].sethp(Math.floor(b.p1.active[0].maxhp / 2)), 7);
weatherRun('E2 구름(Cloud Nine) 상대 — 날씨 효과 정지', [set('Snorlax', 'Rain Dish', ['Splash'])], [set('Snorlax', 'Cloud Nine', ['Rain Dance'])], b => b.p1.active[0].sethp(Math.floor(b.p1.active[0].maxhp / 2)), 3);
weatherRun('E3 쾌청이면 회복 없음', [set('Snorlax', 'Rain Dish', ['Splash'])], [set('Snorlax', 'Thick Fat', ['Sunny Day'])], b => b.p1.active[0].sethp(Math.floor(b.p1.active[0].maxhp / 2)), 3);
weatherRun('E4 회복불가(Heal Block) 중', [set('Snorlax', 'Rain Dish', ['Splash'])], [set('Snorlax', 'Thick Fat', ['Rain Dance'])], b => { b.p1.active[0].sethp(Math.floor(b.p1.active[0].maxhp / 2)); b.p1.active[0].addVolatile('healblock'); }, 3);
{ // 최대 HP 별 회복량(floor(maxhp/16)와 같은가) — 종족값이 다른 포켓몬 몇 마리
	const out = [];
	for (const sp of ['Snorlax', 'Shedinja', 'Blissey', 'Magikarp', 'Mew']) {
		const b = make([set(sp, 'Rain Dish', ['Splash'])], [set('Snorlax', 'Thick Fat', ['Rain Dance'])], b => b.p1.active[0].sethp(1));
		b.makeChoices('move 1', 'move 1');
		const d = b.p1.active[0]; out.push(`${sp} max=${d.maxhp} +${d.hp - 1} (maxhp/16=${d.maxhp / 16})`);
	}
	console.log('[E5 회복량 vs maxhp/16] ' + out.join(' | '));
}
