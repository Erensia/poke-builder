// E7(교체·등장) 검수 실행 대조 (Showdown 965a535). 빌드: node showdown-build.cjs ~/showdown-ref <출력 폴더> <프로젝트>/node_modules/typescript/lib/typescript.js
// 실행: node e7-run.cjs <출력 폴더>   (프로젝트가 ESM이라 .cjs. 숫자 시드만 가능)
const PS = process.argv[2];
const { Battle, Teams } = require(PS + '/dist/sim');
const F = 'gen9championsbssregmc';
const mon = (sp, item, ab, moves = 'Splash') => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n- ${moves}`;
const start = (a, b, seed = [1, 2, 3, 4]) => {
	const bt = new Battle({ formatid: F, seed });
	bt.setPlayer('p1', { name: 'p1', team: Teams.import(a.join('\n\n')) });
	bt.setPlayer('p2', { name: 'p2', team: Teams.import(b.join('\n\n')) });
	if (bt.requestState === 'teampreview') bt.makeChoices('default', 'default');
	return bt;
};
const KEEP = /^\|(switch|drag|-damage|-heal|-sideend|-sidestart|-activate|-status|-unboost|-boost|-fail|-ability|-weather|-fieldstart|-start|-end|-formechange|-item|-enditem|faint|-block|-immune)/;
const lines = (bt, n) => bt.log.slice(n).filter((l) => KEEP.test(l)).filter((l, i, a) => l !== a[i - 1]).map((l) => l.replace(/^\|/, '').replace(/: (\w+)\|/g, ':$1|').slice(0, 96));
const out = (k, ...a) => console.log(`[${k}]`, ...a);
// p2가 2번째 포켓몬으로 교체하는 턴의 줄 목록
const swap = (bt, p1move = 'move 1') => { const n = bt.log.length; bt.makeChoices(p1move, 'switch 2'); return lines(bt, n); };
const src = (bt) => bt.p1.active[0];

{ // 독압정 + 비접지 독 타입(풍선을 든 아보크 — 로스터에 독/비행은 없다): Showdown은 접지일 때만 흡수한다
	const bt = start([mon('Snorlax', '', 'Thick Fat')], [mon('Snorlax', '', 'Thick Fat'), mon('Arbok', 'Air Balloon', 'Intimidate')]);
	bt.p2.addSideCondition('toxicspikes', src(bt));
	const l = swap(bt);
	out('독압정+풍선독', l.join(' / '), `| 설치물=${bt.p2.sideConditions.toxicspikes ? '남음' : '제거'} 상태=${bt.p2.active[0].status || '없음'}`);
}
{ // 독압정 + 접지 독 타입(독/땅)
	const bt = start([mon('Snorlax', '', 'Thick Fat')], [mon('Snorlax', '', 'Thick Fat'), mon('Nidoqueen', '', 'Poison Point')]);
	bt.p2.addSideCondition('toxicspikes', src(bt));
	const l = swap(bt);
	out('독압정+독땅', l.join(' / '), `| 설치물=${bt.p2.sideConditions.toxicspikes ? '남음' : '제거'}`);
}
{ // 끈적끈적네트: 접지면 -activate가 먼저, 클리어바디면 랭크 변화만 막힌다
	for (const [sp, ab] of [['Snorlax', 'Thick Fat'], ['Metagross', 'Clear Body']]) {
		const bt = start([mon('Snorlax', '', 'Thick Fat')], [mon('Snorlax', '', 'Thick Fat'), mon(sp, '', ab)]);
		bt.p2.addSideCondition('stickyweb', src(bt));
		out('네트', `${sp}(${ab})`, swap(bt).join(' / '), `| spe랭크=${bt.p2.active[0].boosts.spe}`);
	}
}
{ // 설치 순서: 스텔스록 → 독압정(체력 1 독/물 포켓몬 — 스텔스록에서 먼저 쓰러지면 독압정이 남는가) / 독압정 → 스텔스록
	for (const order of [['stealthrock', 'toxicspikes'], ['toxicspikes', 'stealthrock']]) {
		const bt = start([mon('Snorlax', '', 'Thick Fat')], [mon('Snorlax', '', 'Thick Fat'), mon('Toxapex', '', 'Regenerator')]);
		for (const c of order) bt.p2.addSideCondition(c, src(bt));
		bt.p2.pokemon[1].sethp(1);
		out('설치순서', order.join('→'), swap(bt).join(' / '), `| 독압정=${bt.p2.sideConditions.toxicspikes ? '남음' : '제거'}`);
	}
}
{ // 설치 순서와 로그: 압정(1겹) → 스텔스록 vs 스텔스록 → 압정 — 데미지 줄 순서
	for (const order of [['spikes', 'stealthrock'], ['stealthrock', 'spikes']]) {
		const bt = start([mon('Snorlax', '', 'Thick Fat')], [mon('Snorlax', '', 'Thick Fat'), mon('Snorlax', '', 'Thick Fat')]);
		for (const c of order) bt.p2.addSideCondition(c, src(bt));
		out('압정/스텔스록 순서', order.join('→'), swap(bt).join(' / '));
	}
}
{ // 기분파(Forecast): 쾌청에서 등장 — 스텔스록 데미지가 노말 타입 기준인가(불꽃 기준이면 절반)
	for (const [label, weather] of [['쾌청', 'sunnyday'], ['날씨없음', null]]) {
		const bt = start([mon('Snorlax', '', 'Thick Fat')], [mon('Snorlax', '', 'Thick Fat'), mon('Castform', '', 'Forecast')]);
		if (weather) bt.field.setWeather(weather, src(bt));
		bt.p2.addSideCondition('stealthrock', src(bt));
		out('기분파', label, swap(bt).join(' / '));
	}
}
{ // 치유소원: 설치물과의 순서(회복이 먼저인가) — 체력 30·독 상태 포켓몬
	const bt = start([mon('Snorlax', '', 'Thick Fat')], [mon('Snorlax', '', 'Thick Fat'), mon('Snorlax', '', 'Thick Fat')]);
	bt.p2.addSideCondition('stealthrock', src(bt)); bt.p2.addSideCondition('toxicspikes', src(bt));
	bt.p2.addSlotCondition(bt.p2.active[0], 'healingwish', bt.p2.active[0]);
	bt.p2.pokemon[1].sethp(30); bt.p2.pokemon[1].setStatus('psn');
	const l = swap(bt);
	out('치유소원+설치물', l.join(' / '), `| HP=${bt.p2.active[0].hp}/${bt.p2.active[0].maxhp} 상태=${bt.p2.active[0].status || '없음'}`);
}
{ // 압정 층수별 데미지(최대 HP 대비)
	for (const layers of [1, 2, 3]) {
		const bt = start([mon('Snorlax', '', 'Thick Fat')], [mon('Snorlax', '', 'Thick Fat'), mon('Snorlax', '', 'Thick Fat')]);
		bt.p2.addSideCondition('spikes', src(bt));
		for (let i = 1; i < layers; i++) bt.p2.addSideCondition('spikes', src(bt));
		const before = bt.p2.pokemon[1].maxhp;
		swap(bt);
		out('압정', `${layers}겹`, `피해=${before - bt.p2.active[0].hp}/${before} (${((before - bt.p2.active[0].hp) / before).toFixed(4)})`);
	}
}
{ // 소금절이는 교체하면 사라지는가
	const bt = start([mon('Snorlax', '', 'Thick Fat')], [mon('Snorlax', '', 'Thick Fat'), mon('Snorlax', '', 'Thick Fat')]);
	const old = bt.p2.active[0];
	old.addVolatile('saltcure', src(bt));
	swap(bt);
	out('소금절이', `교체 후 나간 포켓몬의 소금절이=${old.volatiles.saltcure ? '남음' : '사라짐'}`);
}
{ // 분노의주먹 카운터(timesAttacked)는 교체하면 0으로
	const bt = start([mon('Snorlax', '', 'Thick Fat')], [mon('Snorlax', '', 'Thick Fat'), mon('Snorlax', '', 'Thick Fat')]);
	const old = bt.p2.active[0]; old.timesAttacked = 3;
	swap(bt);
	out('분노의주먹 카운터', `교체 후 나간 포켓몬 timesAttacked=${old.timesAttacked}`);
}
{ // 등장 특성(위협)과 스텔스록 순서
	const bt = start([mon('Snorlax', '', 'Thick Fat')], [mon('Snorlax', '', 'Thick Fat'), mon('Gyarados', '', 'Intimidate')]);
	bt.p2.addSideCondition('stealthrock', src(bt));
	out('위협+스텔스록', swap(bt).join(' / '));
}
{ // 도주(Run Away, champions 재정의): 검은눈빛으로 잡혀도 교체 가능한가
	for (const [sp, ab] of [['Rapidash', 'Run Away'], ['Rapidash', 'Flash Fire']]) {
		const bt = start([mon('Snorlax', '', 'Thick Fat', 'Mean Look')], [mon(sp, '', ab), mon('Snorlax', '', 'Thick Fat')]);
		bt.makeChoices('move 1', 'move 1');
		const req = bt.p2.activeRequest;
		out('도주', `${sp}(${ab})`, `교체 불가(trapped)=${!!req?.active?.[0]?.trapped} 교체 가능한 포켓몬 수=${req?.side?.pokemon?.filter((p, i) => i > 0 && !p.condition.endsWith('fnt')).length}`);
	}
}
{ // 위협 vs 클리어바디(E8 경계): 능력치 하락 방지 특성이 위협을 막는가
	const bt = start([mon('Snorlax', '', 'Thick Fat'), mon('Arbok', '', 'Intimidate')], [mon('Metagross', '', 'Clear Body')]);
	const n = bt.log.length; bt.makeChoices('switch 2', 'move 1');
	out('위협 vs 클리어바디', lines(bt, n).join(' / '), `| 상대 atk랭크=${bt.p2.active[0].boosts.atk}`);
}
{ // 치유소원: HP가 가득·상태 없음인 포켓몬이 나오면 소모되지 않고 남는다(회복이 필요한 포켓몬이 나올 때까지)
	const bt = start([mon('Snorlax', '', 'Thick Fat')], [mon('Snorlax', '', 'Thick Fat'), mon('Snorlax', '', 'Thick Fat')]);
	bt.p2.addSlotCondition(bt.p2.active[0], 'healingwish', bt.p2.active[0]);
	const l = swap(bt);
	out('치유소원(회복 불필요 등장)', l.join(' / ') || '(줄 없음)', `| 슬롯 조건=${bt.p2.slotConditions[0].healingwish ? '남음' : '소모'}`);
}
