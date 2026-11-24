// fix-34 검수 실행 대조 (Showdown 965a535). 사용: node showdown-build.cjs ~/showdown-ref <출력 폴더> <프로젝트>/node_modules/typescript/lib/typescript.js 로 빌드한 뒤 node fix-34-run.cjs <출력 폴더>(프로젝트 package.json이 ESM이라 .cjs)
// 2026-11-24 회사 PC에서 showdown-build.cjs(TypeScript 변환)로 실행해 확인했다. 원본 대비 수정: 로그 중복 줄 제거, 동속 파싱(slice)·Leftovers 정규식, setTerrain 소스 인자.
const PS = process.argv[2] || require('os').homedir() + '/showdown-ref';
const {Battle, Teams} = require(PS + '/dist/sim');
const F = 'gen9championsbssregmc';
const mon = item => `Snorlax${item ? ' @ ' + item : ''}\nAbility: Thick Fat\n- Splash`;
function start({bench = false, item = '', seed = [1, 2, 3, 4], spe = [100, 100]} = {}) {
	const b = new Battle({formatid: F, seed});
	for (const p of ['p1', 'p2']) b.setPlayer(p, {name: p, team: Teams.import(mon(item) + (bench ? '\n\n' + mon('') : ''))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	b.p1.active[0].storedStats.spe = spe[0]; b.p2.active[0].storedStats.spe = spe[1];
	return [b, b.p1.active[0], b.p2.active[0]];
}
const turn = b => {
	const n = b.log.length; b.makeChoices('move 1', 'move 1');
	// 같은 사건이 `|split|` 때문에 공개용·비공개용으로 두 번 찍히므로 연속 중복 줄은 하나로 줄인다
	return b.log.slice(n).filter(l => /^\|(-damage|-heal|faint|win|-start\|.*perish)/.test(l)).filter((l, i, a) => l !== a[i - 1]);
};
const out = (k, ...a) => console.log(`[${k}]`, ...a);
const SP = [[200, 100], [100, 200]];

for (const spe of SP) { // 사례 B: a 화상(10)·b 독(9), 둘 다 HP 1, 예비 없음 → 독 먼저, p1 승, a 화상 미처리
	const [b, a, d] = start({spe}); a.setStatus('brn'); d.setStatus('psn'); a.sethp(1); d.sethp(1);
	out('B', `a스피드${spe[0]}`, turn(b).join(' / '), `승자=${b.winner} aHP=${a.hp}`);
}
for (const spe of SP) { // 사례 C: 둘 다 독 HP 1 → 빠른 쪽이 먼저 쓰러져 느린 쪽 승
	const [b, a, d] = start({spe}); a.setStatus('psn'); d.setStatus('psn'); a.sethp(1); d.sethp(1);
	out('C', `a스피드${spe[0]}`, turn(b).join(' / '), `승자=${b.winner}`);
}
{ // 상호 씨뿌리기: a 느림·HP < 최대/8 → b 씨뿌리기 흡수로 a가 먼저 회복되어 생존(현행 a 먼저면 기절)
	const [b, a, d] = start({bench: true, spe: [50, 200]}); a.sethp(10);
	a.addVolatile('leechseed', d); d.addVolatile('leechseed', a);
	out('씨상호', turn(b).join(' / '), `aHP=${a.hp} 기절=${a.fainted}`);
}
{ // 씨뿌리기 원천이 뒤 order(독 9)에서 쓰러질 처지: b 씨뿌리기(8) 흡수가 먼저 → a 회복 후 독
	const [b, a, d] = start({bench: true}); a.setStatus('psn'); a.sethp(1); d.addVolatile('leechseed', a);
	out('씨원천', turn(b).join(' / '), `aHP=${a.hp} bHP=${d.hp}/${d.maxhp}`);
}
for (const spe of SP) { // 자리 효과: 양쪽 희망사항 → 자리 주인 스피드순(시드를 바꿔도 순서 고정이어야 함)
	const seen = new Set();
	for (let s = 1; s <= 20; s++) {
		const [b, a, d] = start({spe, seed: [s, 2, 3, 4]});
		b.p1.addSlotCondition(a, 'wish', a); b.p2.addSlotCondition(d, 'wish', d);
		a.sethp(50); d.sethp(50); turn(b);
		seen.add(turn(b).filter(l => l.includes('Wish')).map(l => l.slice(7, 10)).join('>'));
	}
	out('자리', `a스피드${spe[0]}`, [...seen].join(' | '));
}
{ // 동속: order마다 독립 난수인가(먹다남은음식 순서 × 독 순서 조합 4가지가 모두 나오면 묶음별)
	const combo = {};
	for (let s = 1; s <= 200; s++) {
		const [b, a, d] = start({item: 'Leftovers', seed: [s, 7, 7, 7]});
		a.setStatus('psn'); d.setStatus('psn'); a.sethp(100); d.sethp(100);
		const l = turn(b), first = (re, o = 7) => l.find(x => re.test(x))?.slice(o, o + 2);
		const k = `먹다남은=${first(/-heal.*Leftovers/)}먼저 독=${first(/-damage.*psn/, 9)}먼저`;
		combo[k] = (combo[k] || 0) + 1;
	}
	out('동속', JSON.stringify(combo));
}
{ // 동속 + 그래스필드(5/2)·먹다남은음식(5/4): 그래스필드 2줄이 먹다남은음식 2줄보다 모두 먼저인가
	const [b, a, d] = start({item: 'Leftovers'}); a.sethp(50); d.sethp(50); b.field.setTerrain('grassyterrain', a);
	out('동속교차', turn(b).filter(l => l.startsWith('|-heal')).map(l => l.slice(7, 9) + (l.includes('Leftovers') ? '먹다남은' : '필드')).join(' > '));
}
for (const spe of SP) { // 모래바람 동시 기절(예비 없음): 둘 다 faint 줄, 느린 쪽 승
	const [b, a, d] = start({spe}); a.sethp(1); d.sethp(1); b.field.setWeather('sandstorm', 'debug');
	out('모래', `a스피드${spe[0]}`, turn(b).join(' / '), `승자=${b.winner}`);
}
for (const spe of SP) { // 멸망의노래 동시 0(예비 없음): 둘 다 faint 줄, 느린 쪽 승
	const [b, a, d] = start({spe}); a.addVolatile('perishsong'); d.addVolatile('perishsong');
	a.volatiles.perishsong.duration = 1; d.volatiles.perishsong.duration = 1;
	out('멸망', `a스피드${spe[0]}`, turn(b).join(' / '), `승자=${b.winner}`);
}