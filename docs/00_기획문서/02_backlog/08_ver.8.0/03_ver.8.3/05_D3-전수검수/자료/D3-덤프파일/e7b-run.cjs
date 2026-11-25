// E7 2차 검수 실행 대조 (Showdown 965a535). node e7b-run.cjs [Showdown 경로]
// 2026-11-24 검수 채팅에서는 빌드가 차단되어 미실행 — 집 PC(~/showdown-ref, dist 빌드 후)에서 실행한다.
// 기대값은 각 시나리오 주석의 "기대:" (소스 판정). 하나라도 다르면 검수 문서의 해당 판정을 다시 본다.
const PS = process.argv[2] || require('os').homedir() + '/showdown-ref';
const {Battle, Teams} = require(PS + '/dist/sim');
const F = 'gen9championsbssregmc';
const set = (sp, ab, item = '', moves = ['Splash']) =>
	`${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${moves.map(m => '- ' + m).join('\n')}`;
const SNOR = set('Snorlax', 'Thick Fat');
function start(p1 = [SNOR], p2 = [SNOR, SNOR]) {
	const b = new Battle({formatid: F, seed: [1, 2, 3, 4]});
	b.setPlayer('p1', {name: 'p1', team: Teams.import(p1.join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import(p2.join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	return b;
}
const RE = /^\|(-damage|-activate|-boost|-unboost|-fail|-ability|-enditem|-start|-sidestart|-sideend|-swapsideconditions)/;
const step = (b, c1, c2) => { const n = b.log.length; b.makeChoices(c1, c2); return b.log.slice(n).filter(l => RE.test(l)); };
const out = (k, l) => console.log(`[${k}]`, l.join(' / '));
const hz = (b, side, ...ids) => { for (const id of ids) b[side].addSideCondition(id, 'debug'); };

{ // ① 층만 늘 때: 압정 → 스텔스록 → 압정(2겹). 기대: 피해 줄 Spikes 먼저, Stealth Rock 다음(순서 불변)
	const b = start(); hz(b, 'p2', 'spikes', 'stealthrock', 'spikes');
	out('①층증가', step(b, 'move 1', 'switch 2'));
}
{ // ② 제거 후 재설치: 압정 → 스텔스록 → 압정 제거 → 압정 재설치. 기대: Stealth Rock 먼저, Spikes 다음(맨 뒤)
	const b = start(); hz(b, 'p2', 'spikes', 'stealthrock'); b.p2.removeSideCondition('spikes'); hz(b, 'p2', 'spikes');
	out('②재설치', step(b, 'move 1', 'switch 2'));
}
for (const order of [['spikes', 'stealthrock'], ['stealthrock', 'spikes']]) {
	// ③ 코트체인지: p1 쪽에 깔린 순서가 p2 쪽으로 넘어가도 유지. 기대: p2 교체 시 피해 줄이 order와 같은 순서
	const b = start([SNOR], [set('Cinderace', 'Blaze', '', ['Court Change']), SNOR]);
	hz(b, 'p1', ...order);
	step(b, 'move 1', 'move 1');
	out(`③코트체인지 ${order.join('→')}`, step(b, 'move 1', 'switch 2'));
}
{ // ③' 코트체인지 뒤 받은 쪽에서 새로 깐 것은 맨 뒤. p1: 스텔스록 → 코트체인지 → p2쪽에 압정 추가. 기대: Stealth Rock → Spikes
	const b = start([SNOR], [set('Cinderace', 'Blaze', '', ['Court Change']), SNOR]);
	hz(b, 'p1', 'stealthrock'); step(b, 'move 1', 'move 1'); hz(b, 'p2', 'spikes');
	out('③\'코트체인지+추가', step(b, 'move 1', 'switch 2'));
}
{ // ④ 등장 순서 우선도 −1: 의태(특성, sub 7) vs 시드(도구, sub 8). 기대: 의태 typechange 줄이 시드 -enditem 줄보다 먼저
	const b = start([SNOR], [SNOR, set('Stunfisk-Galar', 'Mimicry', 'Electric Seed')]);
	b.field.setTerrain('electricterrain', 'debug');
	out('④의태vs시드', step(b, 'move 1', 'switch 2'));
}
{ // ⑤ 끈적끈적네트 + 오기(대도각참). 기대: -activate → spe -1 → Defiant atk +2
	const b = start([SNOR], [SNOR, set('Kingambit', 'Defiant')]); hz(b, 'p2', 'stickyweb');
	out('⑤네트+오기', step(b, 'move 1', 'switch 2'));
}
{ // ⑥ 위협 vs 미러아머(아머까오). 기대: 위협 줄 → Mirror Armor 발동 → 위협을 쓴 쪽 atk -1, 아머까오 atk 0
	const b = start([SNOR, set('Arbok', 'Intimidate')], [set('Corviknight', 'Mirror Armor')]);
	const l = step(b, 'switch 2', 'move 1');
	out('⑥위협vs미러아머', l.concat([`p1 atk=${b.p1.active[0].boosts.atk} p2 atk=${b.p2.active[0].boosts.atk}`]));
}